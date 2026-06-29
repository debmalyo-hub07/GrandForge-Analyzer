/**
 * GrandForge — Position Eval Lookup Endpoint
 *
 * GET /api/positions/eval?fen=<fen>&engine=sf18-lite&depth=20
 *
 * Returns a cached Position document matching the given FEN, engine, and
 * (optional) minimum depth, or null if no such cached evaluation exists.
 */
import type { Request, Response } from 'express';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import Position from '../../models/Position';

const app = createApp();

app.get('/api/positions/eval', async (req: Request, res: Response) => {
  try {
    await connectDB();

    const fen = req.query.fen;
    const engine = req.query.engine;
    const depthRaw = req.query.depth;

    if (typeof fen !== 'string' || fen.trim().length === 0) {
      return res.status(400).json({ error: 'Query param "fen" is required' });
    }

    const query: Record<string, unknown> = { fen: fen.trim() };

    if (typeof engine === 'string' && engine.trim().length > 0) {
      query.engineVersion = engine.trim();
    }

    if (typeof depthRaw === 'string' && depthRaw.trim().length > 0) {
      const minDepth = parseInt(depthRaw, 10);
      if (Number.isFinite(minDepth)) {
        query.depth = { $gte: minDepth };
      }
    }

    const evaluation = await Position.findOne(query)
      .sort({ depth: -1, computedAt: -1 })
      .lean()
      .exec();

    return res.status(200).json({ evaluation: evaluation ?? null });
  } catch (err) {
    console.error('GrandForge positions/eval error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
