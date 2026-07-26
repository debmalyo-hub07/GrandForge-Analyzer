/**
 * GrandForge — Master Game By ID Endpoint
 *
 * GET /api/master/games/:id
 *
 * Returns a single master game by its MongoDB ObjectId. The full
 * indexed game payload (fenPositions, moveUciList, etc.) is included so
 * the engine bridge can replay it immediately.
 */
import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import MasterGame from '../../models/MasterGame';

const app = createApp();

app.get('/api/master/games/:id', async (req: Request, res: Response) => {
  try {
    await connectDB();

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid master game id' });
    }

    const game = await MasterGame.findById(id).lean().exec();
    if (!game) {
      return res.status(404).json({ error: 'Master game not found' });
    }

    return res.status(200).json({ game });
  } catch (err) {
    console.error('GrandForge master/[id] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
