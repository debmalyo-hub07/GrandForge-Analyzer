/**
 * GrandForge — Opening Tree Endpoint
 *
 * GET /api/openings/tree?ecoFamily=A
 *
 * Returns all openings whose ecoCode starts with the given letter (A–E),
 * grouped by full ecoCode prefix (e.g. "A00", "A01", ...).
 */
import type { Request, Response } from 'express';
import { createApp } from '../../createApp';
import { connectDB, hasMongoUri } from '../../db';
import Opening, { type IOpening } from '../../models/Opening';

const app = createApp();

app.get('/api/openings/tree', async (req: Request, res: Response) => {
  try {
    if (!hasMongoUri()) {
      return res.status(200).json({ tree: {} });
    }
    await connectDB();

    const ecoFamily = req.query.ecoFamily;
    if (typeof ecoFamily !== 'string' || ecoFamily.trim().length === 0) {
      return res.status(400).json({ error: 'Query param "ecoFamily" is required' });
    }

    const letter = ecoFamily.trim().toUpperCase();
    if (!/^[A-E]$/.test(letter)) {
      return res.status(400).json({ error: 'ecoFamily must be a single letter A–E' });
    }

    const openings = await Opening.find({ ecoCode: { $regex: `^${letter}`, $options: '' } })
      .sort({ ecoCode: 1, plyDepth: 1, name: 1 })
      .limit(2000)
      .lean()
      .exec();

    const tree: Record<string, IOpening[]> = {};
    for (const opening of openings) {
      const key = opening.ecoCode;
      if (!tree[key]) tree[key] = [];
      tree[key].push(opening as unknown as IOpening);
    }

    return res.status(200).json({ tree });
  } catch (err) {
    console.error('GrandForge openings/tree error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
