import { z } from 'zod';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { requireAuth, type AuthRequest } from '../../auth';
import Session from '../../models/Session';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['newest', 'oldest', 'updated', 'title']).default('updated'),
});

const SORT_MAP: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  updated: { updatedAt: -1 },
  title: { title: 1 },
};

const app = createApp();

app.get('/api/sessions', requireAuth, async (req: AuthRequest, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query', issues: parsed.error.flatten() });
  }
  const { page, limit, sort } = parsed.data;

  try {
    await connectDB();

    const filter = { userId: req.userId };
    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      Session.find(filter).sort(SORT_MAP[sort]).skip(skip).limit(limit).lean(),
      Session.countDocuments(filter),
    ]);

    return res.status(200).json({
      sessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('GrandForge list sessions error:', err);
    return res.status(500).json({ error: 'Failed to list sessions' });
  }
});

export default app;
