import { Chess } from 'chess.js';
import mongoose from 'mongoose';
import { z } from 'zod';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { optionalAuth, requireAuth, type AuthRequest } from '../../auth';
import { gameReviewResultSchema } from '../../zodSchemas';
import Session from '../../models/Session';

const moveTreeNodeSchema = z.object({
  id: z.string(),
  san: z.string().max(20).optional(),
  uci: z.string().max(6).optional(),
  fen: z.string().max(120).optional(),
  parentId: z.string().nullable().optional(),
  children: z.array(z.string()).optional(),
}).passthrough();

const moveTreeSchema = z.record(z.string(), moveTreeNodeSchema).refine(
  (tree) => Object.keys(tree).length <= 5000,
  { message: 'Move tree too large (max 5000 nodes)' },
);

const updateSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  pgn: z.string().min(1).max(500_000).optional(),
  currentNodeId: z.string().nullable().optional(),
  moveTree: moveTreeSchema.optional(),
  notes: z.string().max(10_000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  isPublic: z.boolean().optional(),
  reviewResult: gameReviewResultSchema.nullable().optional(),
}).strict();

function isValidObjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}

function getSessionId(req: AuthRequest): string | null {
  const id = (req.params?.id as string | undefined) ?? (req.query?.id as string | undefined);
  return id ?? null;
}

const app = createApp();

app.get('/api/sessions/:id', optionalAuth, async (req: AuthRequest, res) => {
  const id = getSessionId(req);
  if (!id || !isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid session id' });
  }

  try {
    await connectDB();

    const session = await Session.findById(id).lean();
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const isOwner = req.userId && session.userId.toString() === req.userId;
    if (!session.isPublic && !isOwner) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.status(200).json({ session });
  } catch (err) {
    console.error('GrandForge get session error:', err);
    return res.status(500).json({ error: 'Failed to fetch session' });
  }
});

app.put('/api/sessions/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = getSessionId(req);
  if (!id || !isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid session id' });
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', issues: parsed.error.flatten() });
  }

  if (parsed.data.pgn) {
    try {
      new Chess().loadPgn(parsed.data.pgn);
    } catch {
      return res.status(400).json({ error: 'Invalid PGN' });
    }
  }

  try {
    await connectDB();

    const session = await Session.findById(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.userId.toString() !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    Object.assign(session, parsed.data);
    session.updatedAt = new Date();
    await session.save();

    return res.status(200).json({ session: session.toObject() });
  } catch (err) {
    console.error('GrandForge update session error:', err);
    return res.status(500).json({ error: 'Failed to update session' });
  }
});

app.delete('/api/sessions/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = getSessionId(req);
  if (!id || !isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid session id' });
  }

  try {
    await connectDB();

    const session = await Session.findById(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.userId.toString() !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await session.deleteOne();
    return res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('GrandForge delete session error:', err);
    return res.status(500).json({ error: 'Failed to delete session' });
  }
});

export default app;
