/**
 * GrandForge — Fetch Game Review Result
 *
 * GET /api/review/:gameId
 *
 * Returns the persisted GameReviewResult for a game (or null if none).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import mongoose from 'mongoose';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { optionalAuth, type AuthRequest } from '../../auth';
import Game from '../../models/Game';

const app = createApp();

app.get('/api/review/:gameId', optionalAuth, async (req: AuthRequest, res) => {
  try {
    // Vercel maps the [gameId].ts dynamic segment to req.query.gameId
    const gameId =
      (req.params && req.params.gameId) ||
      (req.query && (req.query.gameId as string)) ||
      '';

    // SEC-2: validate the id shape up front so a malformed id is a clean 400
    // (a cast error otherwise) and never reaches Mongo.
    if (!gameId || !mongoose.isValidObjectId(gameId)) {
      return res.status(400).json({ error: 'Invalid game id' });
    }

    await connectDB();

    // Need userId to enforce ownership on the read (mirrors api/games/[id].ts).
    const game = await Game.findById(gameId).select('reviewResult userId').lean();
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // SEC-2: owned games are private — only the owner may read the review.
    // Anonymous games (userId null) remain publicly readable, preserving the
    // intentionally-public anonymous flow.
    const g = game as { reviewResult?: unknown; userId?: { toString(): string } };
    if (g.userId && g.userId.toString() !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.status(200).json({ reviewResult: g.reviewResult ?? null });
  } catch (err) {
    // SEC-2: log the detail server-side, return a generic message to clients.
    console.error('GrandForge review fetch error:', err);
    return res.status(500).json({ error: 'Review fetch failed' });
  }
});

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as never, res as never);
}
