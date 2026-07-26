/**
 * GrandForge — Master Games List Endpoint
 *
 * GET /api/master/games?ecoCode=&player=&featured=true&limit=10
 *
 * Returns curated grandmaster games filtered by ECO code, player (matches
 * either white or black metadata), and/or featured flag. Default limit 10,
 * max 100.
 */
import type { Request, Response } from 'express';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import MasterGame from '../../models/MasterGame';

const app = createApp();

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.get('/api/master/games', async (req: Request, res: Response) => {
  try {
    await connectDB();

    const { ecoCode, player, featured, limit: limitRaw } = req.query;

    const query: Record<string, unknown> = {};

    if (typeof ecoCode === 'string' && ecoCode.trim().length > 0) {
      query['metadata.ecoCode'] = ecoCode.trim().toUpperCase();
    }

    if (typeof player === 'string' && player.trim().length > 0) {
      const pattern = new RegExp(escapeRegex(player.trim()), 'i');
      query.$or = [{ 'metadata.white': pattern }, { 'metadata.black': pattern }];
    }

    if (typeof featured === 'string' && (featured === 'true' || featured === '1')) {
      query.featured = true;
    }

    let limit = 10;
    if (typeof limitRaw === 'string') {
      const parsed = parseInt(limitRaw, 10);
      if (Number.isFinite(parsed)) {
        limit = Math.max(1, Math.min(100, parsed));
      }
    }

    const games = await MasterGame.find(query)
      .sort({ featured: -1, 'metadata.date': -1 })
      .limit(limit)
      .lean()
      .exec();

    return res.status(200).json({ games });
  } catch (err) {
    console.error('GrandForge master/games error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
