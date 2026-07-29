/**
 * GrandForge — Position Cache Endpoint
 *
 * POST /api/positions/cache
 * Auth: Required (Bearer JWT)
 * Body: { fen, engineVersion, depth, evaluation, lines }
 *
 * Validates the FEN with chess.js, then upserts the Position document
 * keyed by (fen, engineVersion). The deepest evaluation wins on conflicts.
 */
import type { Response } from 'express';
import { Chess } from 'chess.js';
import { z } from 'zod';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { requireAuth, type AuthRequest } from '../../auth';
import Position from '../../models/Position';
import { ENGINE_VERSION_VALUES } from '../../zodSchemas';

const app = createApp('review');

/** A UCI move: from-square, to-square, optional promotion piece. */
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

const CachePositionSchema = z.object({
  fen: z.string().min(1).max(120),
  engineVersion: z.enum(ENGINE_VERSION_VALUES),
  depth: z.number().int().min(1).max(60),
  turn: z.enum(['w', 'b']).optional(),
  evaluation: z.object({
    type: z.enum(['cp', 'mate']),
    value: z.number().int(),
  }),
  // Bounded on every axis. `multipv <= 5` constrains the line *label*, not the
  // array length, so without these caps one authenticated request could push
  // thousands of lines (bounded only by the 5 MB body limit) into a single
  // document — ~100 requests to consume the whole 512 MB tier (data-audit §2a).
  lines: z
    .array(
      z.object({
        multipv: z.number().int().min(1).max(5),
        eval: z.object({
          type: z.enum(['cp', 'mate']),
          value: z.number().int(),
        }),
        pv: z.array(z.string().regex(UCI_MOVE)).max(64),
      })
    )
    .max(5)
    .default([]),
});

app.post('/api/positions/cache', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await connectDB();

    const parsed = CachePositionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
    }

    const { fen, engineVersion, depth, evaluation, lines } = parsed.data;

    // The client caches under a transposition-stable 4-field FEN (no move
    // clocks, REV-1). chess.js requires a full 6-field FEN to validate, so
    // re-append placeholder clocks for the check while still storing the
    // normalized key the lookup path queries by.
    const trimmedFen = fen.trim();
    const sixFieldFen = trimmedFen.split(/\s+/).length < 6 ? `${trimmedFen} 0 1` : trimmedFen;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _validate = new Chess(sixFieldFen);
    } catch {
      return res.status(400).json({ error: 'Invalid FEN' });
    }

    // Map the client payload (type/value + eval/pv) into the Position model
    // shape (evaluation.{cp,mate,turn} + lines.{scoreType,scoreValue,uciMoves}).
    // Without this mapping mongoose strict-mode silently STRIPPED the unknown
    // keys, persisting empty evaluations that read back as a bogus 0.5 Win%
    // draw — corrupting every cached review hit.
    const turn = parsed.data.turn ?? (sixFieldFen.split(/\s+/)[1] === 'b' ? 'b' : 'w');
    const evaluationDoc = {
      cp: evaluation.type === 'cp' ? evaluation.value : null,
      mate: evaluation.type === 'mate' ? evaluation.value : null,
      turn,
    };
    const lineDocs = lines.map((l) => ({
      multipv: l.multipv,
      uciMoves: l.pv ?? [],
      sanMoves: [],
      scoreType: l.eval.type,
      scoreValue: l.eval.value,
    }));

    // Only upsert if incoming depth is deeper than what's cached. The
    // `sort({depth: -1})` matters while legacy rows from the old
    // {fen, engineVersion, depth} unique index survive: with duplicates
    // present an unsorted findOne could return the shallower row, pass the
    // guard, and then collide with its sibling on write (backend-audit F4).
    const existing = await Position.findOne({ fen: trimmedFen, engineVersion })
      .sort({ depth: -1 })
      .select('depth')
      .lean();
    if (existing && existing.depth >= depth) {
      return res.status(200).json({ ok: true, depth: existing.depth, skipped: true });
    }

    const cached = await Position.findOneAndUpdate(
      { fen: trimmedFen, engineVersion },
      {
        $set: {
          depth,
          evaluation: evaluationDoc,
          lines: lineDocs,
          computedAt: new Date(),
        },
        $setOnInsert: {
          fen: trimmedFen,
          engineVersion,
        },
      },
      { upsert: true, new: true, lean: true }
    ).exec();

    // Don't echo the stored document — a writer that can read back what it
    // just wrote gets a free confirmation oracle (backend-audit §3 item 14).
    // The client discards this body anyway (`positionCache.pushCachedEval`).
    return res.status(200).json({ ok: true, depth: cached?.depth ?? depth });
  } catch (err) {
    console.error('GrandForge positions/cache error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
