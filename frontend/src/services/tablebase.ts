// src/services/tablebase.ts
//
// Syzygy endgame tablebase client. Queries the public Lichess tablebase
// service for positions with ≤ 7 pieces, returning exact game-theoretic
// values (Win / Draw / Loss with DTZ). Used by the review engine to bypass
// heuristic Stockfish search for guaranteed-correct endgame evaluation.
//
// Endpoint: https://tablebase.lichess.ovh/standard?fen=<urlencoded>
// Docs:    https://github.com/lichess-org/lila-tablebase
//
// Response shape (truncated):
//   {
//     "category": "win" | "loss" | "draw" | "cursed-win" | "blessed-loss" | "maybe-loss" | "maybe-win",
//     "dtz": number | null,
//     "dtm": number | null,
//     "checkmate": boolean,
//     "stalemate": boolean,
//     "variant_win": boolean,
//     "variant_loss": boolean,
//     "insufficient_material": boolean,
//     "moves": [
//       { "uci": "e2e4", "san": "e4", "category": "win", "dtz": -12, "dtm": -16, ... }
//     ]
//   }

export type TablebaseCategory =
  | 'win'
  | 'loss'
  | 'draw'
  | 'cursed-win'
  | 'blessed-loss'
  | 'maybe-loss'
  | 'maybe-win'
  | 'syzygy-win'
  | 'syzygy-loss'
  | 'unknown';

export interface TablebaseMove {
  uci: string;
  san: string;
  category: TablebaseCategory;
  dtz: number | null;
  dtm: number | null;
  zeroing: boolean;
  checkmate: boolean;
  stalemate: boolean;
}

export interface TablebaseResult {
  category: TablebaseCategory;
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficient_material: boolean;
  moves: TablebaseMove[];
}

const TABLEBASE_DIRECT_ENDPOINT = 'https://tablebase.lichess.ovh/standard';
const TABLEBASE_PROXY_ENDPOINT = '/api/positions/tablebase';
const TABLEBASE_TIMEOUT_MS = 4000;
const CACHE_MAX_SIZE = 2000;

const cache = new Map<string, TablebaseResult | null>();

function cacheSet(key: string, value: TablebaseResult | null) {
  if (cache.size >= CACHE_MAX_SIZE) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
  }
  cache.set(key, value);
}

/**
 * Count total pieces on the board (kings included). Used to decide whether to
 * query the tablebase — only positions with ≤ 7 pieces are reliably covered.
 */
export function pieceCount(fen: string): number {
  const placement = fen.split(' ')[0] ?? '';
  let count = 0;
  for (const ch of placement) {
    if (/[prnbqkPRNBQK]/.test(ch)) count++;
  }
  return count;
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TABLEBASE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Query Syzygy tablebase. Tries the GrandForge server-side proxy first
 * (which caches in MongoDB and reduces upstream traffic), then falls back
 * to the public Lichess endpoint directly. Returns null on miss / error.
 */
export async function lookupTablebase(fen: string): Promise<TablebaseResult | null> {
  if (pieceCount(fen) > 7) return null;
  if (cache.has(fen)) return cache.get(fen) ?? null;
  // Lichess Syzygy excludes positions that still carry castling rights (it would
  // return not-found). Skip the probe entirely and let Stockfish handle them.
  const castling = fen.split(' ')[2];
  if (castling && castling !== '-') {
    cacheSet(fen, null);
    return null;
  }

  // Try Mongo-backed proxy first.
  const proxyRes = await fetchWithTimeout(
    `${TABLEBASE_PROXY_ENDPOINT}?fen=${encodeURIComponent(fen)}`,
  );
  if (proxyRes && proxyRes.ok) {
    try {
      const data = (await proxyRes.json()) as { entry: TablebaseResult | null };
      if (data?.entry) {
        cacheSet(fen, data.entry);
        return data.entry;
      }
    } catch {
      // Fall through to direct.
    }
  }

  // Fall back to public Lichess endpoint.
  const directRes = await fetchWithTimeout(
    `${TABLEBASE_DIRECT_ENDPOINT}?fen=${encodeURIComponent(fen)}`,
  );
  if (!directRes || !directRes.ok) {
    cacheSet(fen, null);
    return null;
  }
  try {
    const data = (await directRes.json()) as TablebaseResult;
    cacheSet(fen, data);
    return data;
  } catch {
    cacheSet(fen, null);
    return null;
  }
}

/**
 * Convert tablebase result into a Stockfish-compatible eval pair from the
 * **moving player's** perspective.
 *
 * Mapping rules:
 *   - "win"   → mate = +max(1, dtm) cp = null
 *   - "loss"  → mate = -max(1, dtm) cp = null
 *   - "draw"  → cp = 0
 *   - cursed/blessed → treated as draw (50-move rule renders them drawn in practice)
 *
 * `dtm` (distance-to-mate) may be null in the response — fall back to a large
 * sentinel mate-in-50 so the Win% bypass still triggers correctly.
 */
export function tablebaseToScore(result: TablebaseResult): { cp: number | null; mate: number | null } {
  const dtmAbs = result.dtm !== null ? Math.max(1, Math.abs(result.dtm)) : 50;
  switch (result.category) {
    case 'win':
    case 'syzygy-win':
      return { cp: null, mate: dtmAbs };
    case 'loss':
    case 'syzygy-loss':
      return { cp: null, mate: -dtmAbs };
    case 'draw':
    case 'cursed-win':
    case 'blessed-loss':
    case 'maybe-win':
    case 'maybe-loss':
    case 'unknown':
    default:
      return { cp: 0, mate: null };
  }
}
