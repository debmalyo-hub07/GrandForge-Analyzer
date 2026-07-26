import mongoose from 'mongoose';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { requireAuth, type AuthRequest } from '../../auth';
import Game from '../../models/Game';

function isValidObjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}

function getGameId(req: AuthRequest): string | null {
  const id = (req.params?.id as string | undefined) ?? (req.query?.id as string | undefined);
  return id ?? null;
}

const app = createApp();

app.get('/api/games/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = getGameId(req);
  if (!id || !isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid game id' });
  }

  try {
    await connectDB();

    const game = await Game.findById(id).lean();
    if (!game) return res.status(404).json({ error: 'Game not found' });

    if (game.userId && game.userId.toString() !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.status(200).json({ game });
  } catch (err) {
    console.error('GrandForge get game error:', err);
    return res.status(500).json({ error: 'Failed to fetch game' });
  }
});

app.delete('/api/games/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = getGameId(req);
  if (!id || !isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid game id' });
  }

  try {
    await connectDB();

    const game = await Game.findById(id);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    if (!game.userId || game.userId.toString() !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await game.deleteOne();
    return res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('GrandForge delete game error:', err);
    return res.status(500).json({ error: 'Failed to delete game' });
  }
});

export default app;
