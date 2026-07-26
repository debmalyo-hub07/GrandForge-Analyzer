/**
 * GrandForge — Opening Search Endpoint
 *
 * GET /api/openings/search?q=sicilian
 *
 * Case-insensitive regex text search across name, family, and variation.
 * Limit 50 results, sorted shortest-name first (so the root family appears
 * before its sub-variations).
 */
import type { Request, Response } from 'express';
import { createApp } from '../../createApp';
import { connectDB, hasMongoUri } from '../../db';
import Opening from '../../models/Opening';

const app = createApp();

// Escape user input before placing it into a regex
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.get('/api/openings/search', async (req: Request, res: Response) => {
  try {
    if (!hasMongoUri()) {
      return res.status(200).json({ openings: [] });
    }
    await connectDB();

    const q = req.query.q;
    if (typeof q !== 'string' || q.trim().length === 0) {
      return res.status(400).json({ error: 'Query param "q" is required' });
    }

    const pattern = new RegExp(escapeRegex(q.trim()), 'i');

    const openings = await Opening.find({
      $or: [
        { name: pattern },
        { family: pattern },
        { variation: pattern },
      ],
    })
      .sort({ plyDepth: 1, name: 1 })
      .limit(50)
      .lean()
      .exec();

    return res.status(200).json({ openings });
  } catch (err) {
    console.error('GrandForge openings/search error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
