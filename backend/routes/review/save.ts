/**
 * GrandForge — Save Game Review Result
 *
 * POST /api/review/save
 *
 * Persists a GameReviewResult produced by GameReviewService.reviewGame()
 * to either a game document (games.reviewResult) or a session document
 * (sessions.reviewResult, owner-only).
 *
 * Rate limiting comes from createApp() (express-rate-limit, 150/15min per IP on
 * this module's own bucket). A hand-rolled per-IP Map used to sit here as well;
 * it never evicted keys, so on the persistent server every IP that ever POSTed
 * leaked an entry for the process lifetime — harmless on serverless, a slow leak
 * on a 512 MB box with 30-day uptime.
 */
import mongoose from 'mongoose';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { optionalAuth, type AuthRequest } from '../../auth';
import { reviewSaveSchema } from '../../zodSchemas';
import Game from '../../models/Game';
import Session from '../../models/Session';

const app = createApp();

app.post('/api/review/save', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = reviewSaveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    const { gameId, sessionId, reviewResult } = parsed.data;

    await connectDB();

    if (gameId) {
      // The schema types gameId as a bounded string, so a non-ObjectId reaches
      // findById and throws a CastError → generic 500. Every other id-taking
      // route validates the shape first; this one was the outlier.
      if (!mongoose.isValidObjectId(gameId)) {
        return res.status(400).json({ error: 'Invalid gameId' });
      }
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
