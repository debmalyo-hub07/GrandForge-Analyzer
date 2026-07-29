/**
 * GrandForge — Position Eval Lookup Endpoint
 *
 * GET /api/positions/eval?fen=<fen>&engine=sf18-lite&depth=20
 *
 * Returns a cached Position document matching the given FEN, engine, and
 * (optional) minimum depth, or null if no such cached evaluation exists.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import Position from '../../models/Position';
import { ENGINE_VERSION_VALUES } from '../../zodSchemas';
import { TRUST_THRESHOLD } from '../../positionCacheGuards';

const app = createApp('review');

const EvalQuerySchema = z.object({
  fen: z.string().trim().min(1).max(120),
  engine: z.enum(ENGINE_VERSION_VALUES).optional(),
  depth: z.coerce.number().int().min(1).max(60).optional(),
});

app.get('/api/positions/eval', async (req: Request, res: Response) => {
  try {
    await connectDB();

    // `req.query` values are strings (or arrays/objects under the default qs
    // parser); zod both narrows the type and rejects an unknown engine id
    // instead of letting it become a silent permanent cache miss.
    const parsed = EvalQuerySchema.safeParse({
      fen: typeof req.query.fen === 'string' ? req.query.fen : undefined,
      engine: typeof req.query.engine === 'string' ? req.query.engine.trim() : undefined,
      depth: typeof req.query.depth === 'string' && req.query.depth.trim().length > 0
        ? req.query.depth.trim()
        : undefined,
    });
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', issues: parsed.error.issues });
    }

    const { fen, engine, depth } = parsed.data;

    const query: Record<string, unknown> = { fen };
    if (engine) query.engineVersion = engine;
    if (depth !== undefined) query.depth = { $gte: depth };
    // Guard 9. Only serve an entry that at least two independent submissions
    // agree on. Writes are anonymous (`positions/cache.ts`), so without this a
    // single POST could hand every future reader of a position a wrong eval —
    // silent, cross-user, and invisible in a finished review. Unconfirmed rows
    // stay stored (they are what a second submission agrees *with*) but are never
    // read. Rows predating this field have no value and so never match, which is
    // the intended conservative default.
    query.confirmations = { $gte: TRUST_THRESHOLD };

    // Bump `computedAt` on the hit, in the same round trip as the read: the
    // 60-day TTL on that field is what keeps `positions` from growing without
    // bound, and touching it on read turns the TTL into an LRU so positions
    // people actually revisit survive (data-audit §4). `findOneAndUpdate`
    // never inserts here — a miss matches nothing and returns null.
    const evaluation = await Position.findOneAndUpdate(
      query,
      { $set: { computedAt: new Date() } },
      {
        sort: { depth: -1, computedAt: -1 },
        new: true,
        lean: true,
        // Project explicitly. `contributors` holds salted contributor hashes and
        // `challenger` holds a dissenting evaluation that deliberately isn't
        // authoritative — neither belongs in a public response, and echoing the
        // hashes back would hand an abuser a way to test whether their own writes
        // are being recorded.
        projection: 'fen engineVersion depth evaluation lines confirmations',
      }
    ).exec();

    return res.status(200).json({ evaluation: evaluation ?? null });
  } catch (err) {
    console.error('GrandForge positions/eval error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
