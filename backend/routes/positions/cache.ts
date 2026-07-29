/**
 * GrandForge — Position Cache Endpoint
 *
 * POST /api/positions/cache
 * Auth: optional — **anonymous writes are accepted**, deliberately.
 * Body: { fen, engineVersion, depth, evaluation, lines }
 *
 * Sign-up is optional on this platform, so gating cache writes on an account
 * meant the shared eval cache never filled: readers got a permanent miss and
 * every review paid full WASM cost. Opening writes up is what makes the cache
 * real — and it is why every guard in `positionCacheGuards.ts` exists.
 *
 * The write is validated for self-consistency against the actual position (PV
 * legality, score bounds, matching top line), attributed to an opaque
 * contributor key, and then reconciled against what is already stored:
 * agreement confirms, disagreement goes to a challenger slot rather than
 * overwriting. Readers are only served entries with `confirmations >= 2`.
 */
import type { Response } from 'express';
import { z } from 'zod';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { optionalAuth, type AuthRequest } from '../../auth';
import Position from '../../models/Position';
import { ENGINE_VERSION_VALUES } from '../../zodSchemas';
import {
  MAX_ABS_CP,
  MIN_CACHE_DEPTH,
  contributorKey,
  isNormalizedCacheFen,
  linesRejection,
  mergeContributors,
  reconcileCacheWrite,
  scoreRejection,
  toValidatableFen,
  turnFromFen,
  type StoredRow,
} from '../../positionCacheGuards';
import { Chess } from 'chess.js';

// Its own bucket, much tighter than the `review` read tier: writes are ~1 per
// position, so an honest reviewer needs a couple of games' worth per window and a
// spam script needs orders of magnitude more (guard 12).
const app = createApp('contribute');

/** A UCI move: from-square, to-square, optional promotion piece. */
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

const ScoreSchema = z.object({
  type: z.enum(['cp', 'mate']),
  value: z.number().int().min(-MAX_ABS_CP).max(MAX_ABS_CP),
});

const CachePositionSchema = z.object({
  fen: z.string().min(1).max(120),
  engineVersion: z.enum(ENGINE_VERSION_VALUES),
  // Guard 7: a shallow eval is worthless to a shared cache and is what a spam
  // script sends. Costs an honest reviewer nothing — the review default is well
  // above this.
  depth: z.number().int().min(MIN_CACHE_DEPTH).max(60),
  // Accepted for backward compatibility and then ignored: `turn` is derived from
  // the FEN (guard 2). A client-supplied side-to-move is a stored lie waiting for
  // the first reader that trusts it.
  turn: z.enum(['w', 'b']).optional(),
  evaluation: ScoreSchema,
  // Bounded on every axis. `multipv <= 5` constrains the line *label*, not the
  // array length, so without these caps one request could push thousands of lines
  // (bounded only by the 5 MB body limit) into a single document — ~100 requests
  // to consume the whole 512 MB tier (data-audit §2a).
  lines: z
    .array(
      z.object({
        multipv: z.number().int().min(1).max(5),
        eval: ScoreSchema,
        pv: z.array(z.string().regex(UCI_MOVE)).min(1).max(64),
      })
    )
    .min(1)
    .max(5),
});

app.post('/api/positions/cache', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    await connectDB();

    const parsed = CachePositionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
    }

    const { engineVersion, depth, evaluation, lines } = parsed.data;
    const fen = parsed.data.fen.trim();

    // Guard 1. Every reader queries the transposition-stable 4-field key, so a
    // 6-field write would store a row nothing can ever match — an invisible leak
    // rather than an error. Reject it instead of orphaning it.
    if (!isNormalizedCacheFen(fen)) {
      return res.status(400).json({
        error: 'FEN must be the normalized 4-field cache key (placement, side, castling, en passant)',
      });
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _validate = new Chess(toValidatableFen(fen));
    } catch {
      return res.status(400).json({ error: 'Invalid FEN' });
    }

    // Guard 4: bound the scores. The zod schema caps magnitude; this catches the
    // mate-specific range (a mate distance of 0 or 5000 is not a real claim).
    for (const score of [evaluation, ...lines.map((l) => l.eval)]) {
      const reason = scoreRejection(score);
      if (reason) return res.status(400).json({ error: reason });
    }

    // Guards 3 + 5: the lines must be legal in this position, labelled
    // contiguously from 1, and the top line must match the headline evaluation.
    // This is what stops a writer claiming "the best move here is a blunder".
    const linesReason = linesRejection(fen, evaluation, lines);
    if (linesReason) return res.status(400).json({ error: linesReason });

    // Guard 2: side to move comes from the FEN, never from the body.
    const turn = turnFromFen(fen);

    // Map the client payload (type/value + eval/pv) into the Position model shape
    // (evaluation.{cp,mate,turn} + lines.{scoreType,scoreValue,uciMoves}). Without
    // this mapping mongoose strict-mode silently STRIPPED the unknown keys,
    // persisting empty evaluations that read back as a bogus 0.5 Win% draw —
    // corrupting every cached review hit.
    const evaluationDoc = {
      cp: evaluation.type === 'cp' ? evaluation.value : null,
      mate: evaluation.type === 'mate' ? evaluation.value : null,
      turn,
    };
    const lineDocs = lines.map((l) => ({
      multipv: l.multipv,
      uciMoves: l.pv,
      sanMoves: [],
      scoreType: l.eval.type,
      scoreValue: l.eval.value,
    }));

    // Guard 11: attribute the write without storing PII. `null` when no secret is
    // configured to salt the hash with — the write still counts, it just can't be
    // deduped, which is strictly better than storing a reversible IP hash.
    const contributor = contributorKey(req.userId, req.ip);

    // The `sort({depth: -1})` matters while legacy rows from the old
    // {fen, engineVersion, depth} unique index survive: with duplicates present an
    // unsorted findOne could return the shallower row, pass the depth guard, and
    // then collide with its sibling on write (backend-audit F4).
    const existing = await Position.findOne({ fen, engineVersion })
      .sort({ depth: -1 })
      .select('depth evaluation confirmations contributors challenger')
      .lean();

    const stored: StoredRow | null = existing
      ? {
          primary: {
            depth: existing.depth,
            evaluation: {
              cp: existing.evaluation?.cp ?? null,
              mate: existing.evaluation?.mate ?? null,
            },
            confirmations: existing.confirmations ?? 1,
            contributors: existing.contributors ?? [],
          },
          challenger: existing.challenger
            ? {
                depth: existing.challenger.depth,
                evaluation: {
                  cp: existing.challenger.evaluation?.cp ?? null,
                  mate: existing.challenger.evaluation?.mate ?? null,
                },
                confirmations: existing.challenger.confirmations ?? 1,
                contributors: existing.challenger.contributors ?? [],
              }
            : null,
        }
      : null;

    const decision = reconcileCacheWrite(stored, {
      depth,
      evaluation: { cp: evaluationDoc.cp, mate: evaluationDoc.mate },
      contributor,
    });

    const now = new Date();
    const incomingCandidate = { depth, evaluation: evaluationDoc, lines: lineDocs };

    switch (decision.action) {
      case 'ignore':
        return res.status(200).json({ ok: true, skipped: true, reason: decision.reason });

      case 'insert':
        await Position.findOneAndUpdate(
          { fen, engineVersion },
          {
            $set: {
              ...incomingCandidate,
              computedAt: now,
              confirmations: decision.confirmations,
              contributors: mergeContributors([], contributor),
              challenger: null,
            },
            $setOnInsert: { fen, engineVersion },
          },
          { upsert: true }
        ).exec();
        break;

      case 'confirm-primary':
        await Position.updateOne(
          { fen, engineVersion },
          {
            $set: {
              // A shallower confirmation vouches for the stored eval without
              // replacing it (guard 10).
              ...(decision.replaceData ? incomingCandidate : {}),
              computedAt: now,
              confirmations: decision.confirmations,
              contributors: mergeContributors(stored?.primary.contributors ?? [], contributor),
            },
          }
        ).exec();
        break;

      case 'set-challenger': {
        // A reinforced challenger keeps its original contributors and its clock; a
        // brand-new opinion displacing the slot starts both over.
        const reinforcing = decision.confirmations > 1;
        await Position.updateOne(
          { fen, engineVersion },
          {
            $set: {
              challenger: {
                ...incomingCandidate,
                confirmations: decision.confirmations,
                contributors: mergeContributors(
                  reinforcing ? (existing?.challenger?.contributors ?? []) : [],
                  contributor
                ),
                firstSeenAt: reinforcing ? (existing?.challenger?.firstSeenAt ?? now) : now,
              },
            },
          }
        ).exec();
        break;
      }

      case 'supersede-primary':
        await Position.updateOne(
          { fen, engineVersion },
          {
            $set: {
              ...incomingCandidate,
              computedAt: now,
              confirmations: decision.confirmations,
              contributors: mergeContributors([], contributor),
              // The displaced primary keeps its dissent alive in the challenger
              // slot rather than vanishing.
              challenger: existing
                ? {
                    depth: existing.depth,
                    evaluation: existing.evaluation,
                    lines: existing.lines ?? [],
                    confirmations: existing.confirmations ?? 1,
                    contributors: existing.contributors ?? [],
                    firstSeenAt: now,
                  }
                : null,
            },
          }
        ).exec();
        break;

      case 'promote-challenger': {
        const promoted = decision.useIncomingData
          ? incomingCandidate
          : {
              depth: existing?.challenger?.depth ?? depth,
              evaluation: existing?.challenger?.evaluation ?? evaluationDoc,
              lines: existing?.challenger?.lines ?? lineDocs,
            };
        await Position.updateOne(
          { fen, engineVersion },
          {
            $set: {
              ...promoted,
              computedAt: now,
              confirmations: decision.confirmations,
              contributors: mergeContributors(
                existing?.challenger?.contributors ?? [],
                contributor
              ),
              challenger: null,
            },
          }
        ).exec();
        break;
      }
    }

    // Don't echo the stored document — a writer that can read back what it just
    // wrote gets a free confirmation oracle (guard 14). The client discards this
    // body anyway (`positionCache.pushCachedEval`).
    return res.status(200).json({ ok: true, action: decision.action });
  } catch (err) {
    console.error('GrandForge positions/cache error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
