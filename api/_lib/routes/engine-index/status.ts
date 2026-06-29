/**
 * GrandForge — Engine–Game Index Status
 *
 * GET /api/engine-index/status?gameId=
 *
 * Returns whether a given game has been engine-indexed (engineReady === true)
 * and the size of its pre-computed FEN/UCI arrays.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import mongoose from 'mongoose';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { optionalAuth, type AuthRequest } from '../../auth';
import Game from '../../models/Game';

const app = createApp();

app.get('/api/engine-index/status', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const gameId = String(req.query.gameId || '').trim();
    // SEC-2: validate the id shape up front (clean 400 instead of a cast error).
    if (!gameId || !mongoose.isValidObjectId(gameId)) {
      return res.status(400).json({ error: 'Invalid game id' });
    }

    await connectDB();

    const game = await Game.findById(gameId)
      .select('engineReady plyCount fenPositions userId')
      .lean();

    if (!game) return res.status(404).json({ error: 'Game not found' });

    const g = game as {
      engineReady?: boolean;
      plyCount?: number;
      fenPositions?: string[];
      userId?: { toString(): string };
    };

    // SEC-2: owned games are private — only the owner may read index status.
    // Anonymous games (userId null) remain publicly readable (mirrors
    // api/games/[id].ts), preserving the intentionally-public anonymous flow.
    if (g.userId && g.userId.toString() !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.status(200).json({
      gameId,
      engineReady: Boolean(g.engineReady),
      plyCount: g.plyCount ?? 0,
      fenCount: Array.isArray(g.fenPositions) ? g.fenPositions.length : 0,
    });
  } catch (err) {
    // SEC-2: log detail server-side, return a generic message to clients.
    console.error('GrandForge engine index status error:', err);
    return res.status(500).json({ error: 'Engine index status failed' });
  }
});

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as never, res as never);
}
