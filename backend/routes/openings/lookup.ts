/**
 * GrandForge — Opening Lookup Endpoint
 *
 * GET /api/openings/lookup?moves=e4+e5+Nf3+Nc6
 *
 * Returns the deepest (most-specific) Opening whose moveSequence is a prefix of
 * the input, or null. The prefix logic itself lives in `backend/openingLookup.ts`
 * so `GET /api/explorer/lookup` resolves theory the same way.
 */
import type { Request, Response } from 'express';
import { createApp } from '../../createApp';
import { connectDB, hasMongoUri } from '../../db';
import { findOpeningByMoves, parseMoveSequence } from '../../openingLookup';

const app = createApp('browse');

app.get('/api/openings/lookup', async (req: Request, res: Response) => {
  try {
    if (!hasMongoUri()) {
      return res.status(200).json({ opening: null });
    }
    await connectDB();

    const movesParam = req.query.moves;
    if (typeof movesParam !== 'string' || movesParam.trim().length === 0) {
      return res.status(400).json({ error: 'Query param "moves" is required' });
    }

    const moves = parseMoveSequence(movesParam);
    if (moves.length === 0) {
      return res.status(200).json({ opening: null });
    }

    const opening = await findOpeningByMoves(moves);
    return res.status(200).json({ opening });
  } catch (err) {
    console.error('GrandForge openings/lookup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
