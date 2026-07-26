/**
 * GrandForge — Save Game Review Result
 *
 * POST /api/review/save
 *
 * Persists a GameReviewResult produced by GameReviewService.reviewGame()
 * to either a game document (games.reviewResult) or a session document
 * (sessions.reviewResult, owner-only). Rate-limited to 10 req/min per IP.
 */
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { optionalAuth, type AuthRequest } from '../../auth';
import { reviewSaveSchema } from '../../zodSchemas';
import Game from '../../models/Game';
import Session from '../../models/Session';

/* ---------- per-IP rate limit (10 req/min) ---------- */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const ipHits = new Map<string, number[]>();

function clientIp(req: AuthRequest): string {
  const fwd = (req.headers['x-forwarded-for'] || '') as string;
  return fwd.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    ipHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  return false;
}

/* ---------- handler ---------- */

const app = createApp();

app.post('/api/review/save', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      return res.status(429).json({ error: 'Too many review saves — try again in a minute' });
    }

    const parsed = reviewSaveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    const { gameId, sessionId, reviewResult } = parsed.data;

    await connectDB();

    if (gameId) {
      const game = await Game.findById(gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });

      // Ownership check: if the game has an owner, only the owner can save reviews.
      if (game.userId && String(game.userId) !== req.userId) {
        return res.status(403).json({ error: 'You do not own this game' });
      }
      // Anonymous games require authentication to prevent uncontrolled writes.
      if (!game.userId && !req.userId) {
        return res.status(401).json({ error: 'Authentication required to save review' });
      }

      await Game.findByIdAndUpdate(gameId, { $set: { reviewResult } });
      return res.status(200).json({ saved: true });
    }

    // sessionId path requires auth + ownership
    if (!req.userId) {
      return res.status(401).json({ error: 'Authentication required to save review to a session' });
    }
    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (String(session.userId) !== req.userId) {
      return res.status(403).json({ error: 'You do not own this session' });
    }
    (session as unknown as { reviewResult: unknown }).reviewResult = reviewResult;
    await session.save();
    return res.status(200).json({ saved: true });
  } catch (err) {
    console.error('Review save error:', err);
    return res.status(500).json({ error: 'Review save failed' });
  }
});

export default app;
