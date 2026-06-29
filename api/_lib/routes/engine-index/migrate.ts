/**
 * GrandForge — Engine–Game Index Migration
 *
 * POST /api/engine-index/migrate
 *
 * Admin-only utility (header `x-admin-key` must match env `ADMIN_KEY`) that
 * walks every game where `engineReady !== true`, runs `indexGame(pgn)` on it,
 * and writes the resulting Engine–Game Bridge index back to the document.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { indexGame } from '../../indexGame';
import Game from '../../models/Game';

const app = createApp();

app.post('/api/engine-index/migrate', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Invalid or missing admin key' });
    }

    await connectDB();

    let migrated = 0;
    let failed = 0;

    const cursor = Game.find({ engineReady: { $ne: true } })
      .select('_id pgn')
      .lean()
      .cursor();

    for await (const doc of cursor) {
      const g = doc as { _id: unknown; pgn?: string };
      if (!g.pgn) {
        failed++;
        continue;
      }
      try {
        const index = indexGame(g.pgn);
        if (!index.engineReady) {
          failed++;
          continue;
        }
        await Game.updateOne(
          { _id: g._id },
          {
            $set: {
              fenPositions: index.fenPositions,
              moveUciList: index.moveUciList,
              moveSanList: index.moveSanList,
              plyCount: index.plyCount,
              engineReady: index.engineReady,
              phase: index.phase,
            },
          }
        );
        migrated++;
      } catch {
        failed++;
      }
    }

    return res.status(200).json({ migrated, failed });
  } catch (err) {
    // SEC-2: log detail server-side, return a generic message to clients.
    console.error('GrandForge engine index migration error:', err);
    return res.status(500).json({ error: 'Engine index migration failed' });
  }
});

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as never, res as never);
}
