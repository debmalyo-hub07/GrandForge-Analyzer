import { z } from 'zod';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { requireAuth, type AuthRequest } from '../../auth';
import Game from '../../models/Game';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  source: z.enum(['chesscom', 'lichess', 'pgn_upload', 'master']).optional(),
});

const app = createApp();

app.get('/api/games', requireAuth, async (req: AuthRequest, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query', issues: parsed.error.flatten() });
  }
  const { page, limit, source } = parsed.data;

  try {
    await connectDB();

    const filter: Record<string, unknown> = { userId: req.userId };
    if (source) filter['metadata.source'] = source;

    const skip = (page - 1) * limit;

    const [games, total] = await Promise.all([
      Game.find(filter)
        .select('-fenPositions -moveUciList -moveSanList -reviewResult')
        .sort({ 'metadata.importedAt': -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Game.countDocuments(filter),
    ]);

    return res.status(200).json({
      games,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('GrandForge list games error:', err);
    return res.status(500).json({ error: 'Failed to list games' });
  }
});

export default app;
