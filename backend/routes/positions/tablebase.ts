/**
 * GrandForge — Tablebase Proxy Endpoint
 *
 * GET /api/positions/tablebase?fen=<urlencoded>
 *
 * Cache-aside proxy in front of `https://tablebase.lichess.ovh/standard`.
 * Tablebase positions are mathematically immutable, so cached results never
 * expire. Anonymous read access — no auth required. Only positions with
 * ≤ 7 pieces are forwarded; larger positions return `{ entry: null }`.
 */
import type { Request, Response } from 'express';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import TablebaseEntry from '../../models/TablebaseEntry';

const app = createApp();
const UPSTREAM = 'https://tablebase.lichess.ovh/standard';
const UPSTREAM_TIMEOUT_MS = 4000;

function pieceCount(fen: string): number {
  const placement = fen.split(' ')[0] ?? '';
  let count = 0;
  for (const ch of placement) {
    if (/[prnbqkPRNBQK]/.test(ch)) count++;
  }
  return count;
}

app.get('/api/positions/tablebase', async (req: Request, res: Response) => {
  try {
    const fen = req.query.fen;
    if (typeof fen !== 'string' || fen.trim().length === 0) {
      return res.status(400).json({ error: 'Query param "fen" is required' });
    }
    const trimmed = fen.trim();
    if (pieceCount(trimmed) > 7) {
      return res.status(200).json({ entry: null });
    }

    await connectDB();

    const cached = await TablebaseEntry.findOne({ fen: trimmed }).lean().exec();
    if (cached) {
      return res.status(200).json({ entry: cached, source: 'cache' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream: Response | null = null;
    try {
      const r = await fetch(`${UPSTREAM}?fen=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      });
      upstream = r as unknown as Response;
      if (!r.ok) {
        return res.status(200).json({ entry: null, source: 'upstream-miss' });
      }
      const data = await r.json();

      const doc = await TablebaseEntry.findOneAndUpdate(
        { fen: trimmed },
        {
          $set: {
            category:              String(data.category ?? 'unknown'),
            dtz:                   typeof data.dtz === 'number' ? data.dtz : null,
            dtm:                   typeof data.dtm === 'number' ? data.dtm : null,
            checkmate:             Boolean(data.checkmate),
            stalemate:             Boolean(data.stalemate),
            insufficient_material: Boolean(data.insufficient_material),
            moves: Array.isArray(data.moves)
              ? data.moves.map((m: any) => ({
                  uci:       String(m.uci ?? ''),
                  san:       String(m.san ?? ''),
                  category:  String(m.category ?? 'unknown'),
                  dtz:       typeof m.dtz === 'number' ? m.dtz : null,
                  dtm:       typeof m.dtm === 'number' ? m.dtm : null,
                  zeroing:   Boolean(m.zeroing),
                  checkmate: Boolean(m.checkmate),
                  stalemate: Boolean(m.stalemate),
                }))
              : [],
            fetchedAt: new Date(),
          },
          $setOnInsert: { fen: trimmed },
        },
        { upsert: true, new: true, lean: true },
      ).exec();

      return res.status(200).json({ entry: doc, source: 'upstream' });
    } catch (err) {
      console.warn('GrandForge tablebase upstream error:', err);
      return res.status(200).json({ entry: null, source: 'upstream-error' });
    } finally {
      clearTimeout(timer);
      void upstream;
    }
  } catch (err) {
    console.error('GrandForge positions/tablebase error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
