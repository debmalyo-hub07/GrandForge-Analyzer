/**
 * GrandForge — Opening Explorer Lookup
 *
 * GET /api/explorer/lookup?fen=<4- or 6-field FEN>[&moves=e4+e5]
 *
 * Point read against `explorerNodes`, the self-hosted position aggregate built
 * offline by `scripts/ingestExplorer.ts`. Returns per-move game counts, W/D/L
 * splits, average rating and (in opening territory) a few representative games.
 *
 * There is **no third-party call on this path** — the whole reason the aggregate
 * is ingested into our own MongoDB rather than proxied from someone else's
 * explorer API. Public, no auth.
 *
 * `moves` is optional and purely an optimization: when the client sends the SAN
 * path it also gets the matching ECO opening + theory prose in the same
 * response, saving the Explore panel a second round trip per position.
 */
import type { Request, Response } from 'express';
import { createApp } from '../../createApp';
import { connectDB, hasMongoUri } from '../../db';
import ExplorerNode, { normalizeExplorerFen, type IExplorerMove } from '../../models/ExplorerNode';
import { findOpeningByMoves, parseMoveSequence } from '../../openingLookup';

const app = createApp('browse');

/**
 * Moves returned per position. The ingest caps stored moves at 30; a panel shows
 * ~12 rows before scrolling and the tail is single-game noise, so trimming here
 * keeps the response small without losing anything a user reads.
 */
const MAX_MOVES_RETURNED = 15;

/**
 * A position with fewer games than this is statistical noise — one or two games
 * decide a "63% for White". The ingest already applies a min-games threshold,
 * but a re-ingest with different bounds (or a merge that split counts across
 * transpositions) can leave thin rows behind, so the read path enforces it too.
 */
const MIN_GAMES_TO_REPORT = 2;

export interface ExplorerMoveDTO extends IExplorerMove {
  /** Share of games from this position that played this move, 0..1. */
  share: number;
}

/**
 * Mean player rating at this position, or null when the corpus carried no
 * ratings here.
 *
 * `eloSum` counts both players of every *rated* game, so the divisor is
 * `2 * eloGames` — not `2 * total`. Those differ whenever the corpus contains
 * games without rating headers, and using `total` would report an average
 * pulled toward zero in proportion to how many of them there were.
 */
export function averageElo(eloSum: number, eloGames: number): number | null {
  if (eloGames <= 0) return null;
  const avg = Math.round(eloSum / (2 * eloGames));
  // Defensive: a corrupt row (positive count, zero sum) should report nothing
  // rather than a number that looks authoritative.
  return avg > 0 ? avg : null;
}

/**
 * Sort by popularity and attach each move's share of the position's games.
 * `share` is computed against the *node* total rather than the summed move
 * totals: the two can differ when a game ended at this position (no next move),
 * and dividing by the move sum would then inflate every row.
 */
export function shapeMoves(moves: IExplorerMove[], nodeTotal: number): ExplorerMoveDTO[] {
  const denominator = nodeTotal > 0 ? nodeTotal : 1;
  return [...moves]
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_MOVES_RETURNED)
    .map((m) => ({
      uci: m.uci,
      san: m.san,
      total: m.total,
      white: m.white,
      draws: m.draws,
      black: m.black,
      share: m.total / denominator,
    }));
}

app.get('/api/explorer/lookup', async (req: Request, res: Response) => {
  try {
    const fenParam = req.query.fen;
    if (typeof fenParam !== 'string' || fenParam.trim().length === 0) {
      return res.status(400).json({ error: 'Query param "fen" is required' });
    }

    // The aggregate is static between ingests, so a long browser/CDN cache is
    // free hit-rate: stepping back and forth through a game re-requests the same
    // handful of positions constantly.
    res.set('Cache-Control', 'public, max-age=86400');

    // No DB configured (local dev without .env): behave like an empty explorer
    // rather than a 500, so the Explore panel degrades to "no data" and the rest
    // of the app is unaffected.
    if (!hasMongoUri()) {
      return res.status(200).json({ node: null, opening: null });
    }
    await connectDB();

    const fen = normalizeExplorerFen(fenParam);

    const movesParam = req.query.moves;
    const sanPath = typeof movesParam === 'string' ? parseMoveSequence(movesParam) : [];

    // Independent queries — run them together rather than paying two serial
    // round trips to Atlas on every board move.
    const [doc, opening] = await Promise.all([
      ExplorerNode.findById(fen).lean().exec(),
      sanPath.length > 0 ? findOpeningByMoves(sanPath) : Promise.resolve(null),
    ]);

    if (!doc || doc.total < MIN_GAMES_TO_REPORT) {
      return res.status(200).json({ node: null, opening });
    }

    return res.status(200).json({
      node: {
        fen,
        total: doc.total,
        white: doc.white,
        draws: doc.draws,
        black: doc.black,
        avgElo: averageElo(doc.eloSum, doc.eloGames),
        moves: shapeMoves(doc.moves ?? [], doc.total),
        topGames: doc.topGames ?? [],
      },
      opening,
    });
  } catch (err) {
    console.error('GrandForge explorer/lookup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
