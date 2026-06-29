/**
 * GrandForge — Opening Lookup Endpoint
 *
 * GET /api/openings/lookup?moves=e4+e5+Nf3+Nc6
 *
 * Joins the move sequence with spaces and finds the Opening document whose
 * moveSequence is the longest prefix of the input. Returns the deepest
 * (most-specific) matching opening, or null if no match.
 */
import type { Request, Response } from 'express';
import { createApp } from '../../createApp';
import { connectDB, hasMongoUri } from '../../db';
import Opening from '../../models/Opening';

const app = createApp();

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

    // Accept both "e4+e5+Nf3" and "e4 e5 Nf3" forms
    const moves = movesParam
      .replace(/\+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    if (moves.length === 0) {
      return res.status(200).json({ opening: null });
    }

    const inputSequence = moves.join(' ');

    // Build all candidate prefixes (longest first) and look them up directly.
    // This is faster than a regex scan because moveSequence is indexed-equality.
    const candidates: string[] = [];
    for (let i = moves.length; i > 0; i--) {
      candidates.push(moves.slice(0, i).join(' '));
    }

    const matches = await Opening.find({ moveSequence: { $in: candidates } })
      .sort({ plyDepth: -1 })
      .limit(1)
      .lean()
      .exec();

    const opening = matches.length > 0 ? matches[0] : null;

    // Defensive: make sure the matched sequence is actually a prefix of the input
    if (opening && !inputSequence.startsWith(opening.moveSequence)) {
      return res.status(200).json({ opening: null });
    }

    return res.status(200).json({ opening });
  } catch (err) {
    console.error('GrandForge openings/lookup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
