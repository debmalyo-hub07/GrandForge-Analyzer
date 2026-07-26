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

const app = createApp();

const CachePositionSchema = z.object({
  fen: z.string().min(1).max(120),
  engineVersion: z.enum(['sf18-lite', 'sf18-full', 'sf17-lite', 'sf16-lite']),
  depth: z.number().int().min(1).max(60),
  turn: z.enum(['w', 'b']).optional(),
  evaluation: z.object({
    type: z.enum(['cp', 'mate']),
    value: z.number().int(),
  }),
  lines: z
    .array(
      z.object({
        multipv: z.number().int().min(1).max(5),
        eval: z.object({
          type: z.enum(['cp', 'mate']),
          value: z.number().int(),
        }),
        pv: z.array(z.string()),
      })
    )
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

    // Only upsert if incoming depth is deeper than what's cached.
    const existing = await Position.findOne({ fen: trimmedFen, engineVersion }).select('depth').lean();
    if (existing && existing.depth >= depth) {
      return res.status(200).json({ cached: existing, skipped: true });
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

    return res.status(200).json({ cached });
  } catch (err) {
    console.error('GrandForge positions/cache error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
