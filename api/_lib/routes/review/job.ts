/**
 * GrandForge — Review Job Endpoint
 *
 * POST /api/review/job
 *   Upsert review job state. Auth optional — anonymous users get jobs scoped
 *   to their clientJobId only. Authed users get jobs scoped to (userId, clientJobId).
 *   Body: {
 *     clientJobId: string,
 *     status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled',
 *     depth: number,
 *     engineVersion: string,
 *     gameId?: string,
 *     progress?: { currentPly, totalPlies, percent },
 *     errorMessage?: string,
 *     resultRef?: { kind: 'game' | 'session', id: string }
 *   }
 *
 * GET /api/review/job?clientJobId=<id>
 *   Fetch a job by clientJobId. Authed users see only their own jobs.
 *
 * Used by the browser review worker to checkpoint progress so a tab refresh
 * mid-review can be resumed against the same clientJobId.
 */
import type { Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { optionalAuth, type AuthRequest } from '../../auth';
import ReviewJob from '../../models/ReviewJob';

const app = createApp();

const ReviewJobUpsertSchema = z.object({
  clientJobId: z.string().min(1).max(120),
  status: z.enum(['queued', 'running', 'complete', 'failed', 'cancelled']),
  depth: z.number().int().min(1).max(60),
  engineVersion: z.string().min(1).max(40),
  gameId: z.string().optional(),
  progress: z.object({
    currentPly: z.number().int().min(0),
    totalPlies: z.number().int().min(0),
    percent: z.number().min(0).max(100),
  }).optional(),
  errorMessage: z.string().max(500).optional(),
  resultRef: z.object({
    kind: z.enum(['game', 'session']),
    id: z.string(),
  }).optional(),
});

app.post('/api/review/job', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    await connectDB();
    const parsed = ReviewJobUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    const body = parsed.data;
    const userId = req.userId ? new mongoose.Types.ObjectId(req.userId) : null;

    const update: Record<string, unknown> = {
      status: body.status,
      depth: body.depth,
      engineVersion: body.engineVersion,
      updatedAt: new Date(),
    };
    if (body.progress) update.progress = body.progress;
    if (body.errorMessage) update.errorMessage = body.errorMessage;
    if (body.gameId && mongoose.isValidObjectId(body.gameId)) {
      update.gameId = new mongoose.Types.ObjectId(body.gameId);
    }
    if (body.resultRef && mongoose.isValidObjectId(body.resultRef.id)) {
      update.resultRef = {
        kind: body.resultRef.kind,
        id: new mongoose.Types.ObjectId(body.resultRef.id),
      };
    }
    if (body.status === 'complete' || body.status === 'failed' || body.status === 'cancelled') {
      update.finishedAt = new Date();
    }

    const setOnInsert: Record<string, unknown> = {
      clientJobId: body.clientJobId,
      userId,
      startedAt: new Date(),
    };

    const doc = await ReviewJob.findOneAndUpdate(
      { clientJobId: body.clientJobId, userId },
      { $set: update, $setOnInsert: setOnInsert },
      { upsert: true, new: true, lean: true },
    ).exec();

    return res.status(200).json({ job: doc });
  } catch (err) {
    console.error('GrandForge review/job POST error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/review/job', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    await connectDB();
    const clientJobId = req.query.clientJobId;
    if (typeof clientJobId !== 'string' || clientJobId.length === 0) {
      return res.status(400).json({ error: 'Query param "clientJobId" is required' });
    }
    const userId = req.userId ? new mongoose.Types.ObjectId(req.userId) : null;
    const job = await ReviewJob.findOne({ clientJobId, userId }).lean().exec();
    return res.status(200).json({ job: job ?? null });
  } catch (err) {
    console.error('GrandForge review/job GET error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
