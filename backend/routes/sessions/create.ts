import { Chess } from 'chess.js';
import { z } from 'zod';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { requireAuth, type AuthRequest } from '../../auth';
import Session from '../../models/Session';
import User from '../../models/User';

const createSchema = z.object({
  pgn: z.string().min(1).max(500_000),
  title: z.string().min(1).max(200).trim().optional(),
  notes: z.string().max(10_000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  isPublic: z.boolean().optional(),
});

const app = createApp();

/** Per-user session cap. A session's move tree is capped at 5000 nodes
 *  (~1.1 MB), so without a quota one account can consume the whole 512 MB
 *  Atlas tier (data-audit §2e, §4). */
const MAX_SESSIONS_PER_USER = 100;

app.post('/api/sessions/create', requireAuth, async (req: AuthRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', issues: parsed.error.flatten() });
  }
  const { pgn, title, notes, tags, isPublic } = parsed.data;

  try {
    new Chess().loadPgn(pgn);
  } catch {
    return res.status(400).json({ error: 'Invalid PGN' });
  }

  try {
    await connectDB();

    const existing = await Session.countDocuments({ userId: req.userId });
    if (existing >= MAX_SESSIONS_PER_USER) {
      return res.status(409).json({
        error: `Session limit reached (${MAX_SESSIONS_PER_USER}). Delete an existing session to create a new one.`,
      });
    }

    const session = await Session.create({
      userId: req.userId,
      pgn,
      title: title ?? 'Untitled session',
      notes: notes ?? '',
      tags: tags ?? [],
      isPublic: isPublic ?? false,
    });

    await User.updateOne({ _id: req.userId }, { $inc: { 'stats.totalSessions': 1 } });

    return res.status(201).json({ session: session.toObject() });
  } catch (err) {
    console.error('GrandForge create session error:', err);
    return res.status(500).json({ error: 'Failed to create session' });
  }
});

export default app;
