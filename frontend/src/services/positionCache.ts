// src/services/positionCache.ts
//
// Client wrapper for the MongoDB-backed Position eval cache.
//
//   GET  /api/positions/eval?fen=...&engine=...&depth=N
//        → returns the deepest cached evaluation ≥ N for (fen, engine)
//   POST /api/positions/cache (auth required)
//        → upserts a finished search result keyed by (fen, engineVersion)
//
// The review engine uses these to skip Stockfish work entirely when another
// user has already evaluated the same position at sufficient depth. This is
// the multiplayer-cache-federation pattern referenced from Lichess cloud eval.
//
// Reads are unauthenticated so anonymous review runs benefit. Writes require
// auth so cache poisoning is gated on an account.

import { apiClient, getAuthToken } from './apiClient';

/**
 * Normalize a FEN to its transposition-stable form for cache keying.
 *
 * The full 6-field FEN includes the halfmove clock (50-move counter) and the
 * fullmove number, both of which vary between transposition-identical
 * positions and would otherwise fragment the cache to a near-zero hit rate
 * (REV-1). We keep the first FOUR fields — piece placement, side-to-move,
 * castling rights, and en-passant target — and drop the two clock fields.
 *
 * The en-passant field is intentionally left as-is (not over-normalized): even
 * though it only affects play when a capture is actually available, two
 * positions with different ep targets are genuinely different positions, and
 * collapsing them could return a wrong eval for the side that has the ep
 * capture. Keeping ep is the safe choice.
 *
 * Inputs that don't have at least four whitespace-separated fields are returned
 * trimmed but otherwise unchanged, so malformed FENs never crash the cache.
 */
export function normalizeFenForCache(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return fen.trim();
  return parts.slice(0, 4).join(' ');
}

export interface CachedPositionEval {
  fen: string;
  engineVersion: string;
  depth: number;
  evaluation: {
    cp: number | null;
    mate: number | null;
    turn: 'w' | 'b';
  };
  lines: Array<{
    multipv: number;
    uciMoves?: string[];
    sanMoves?: string[];
    scoreType?: 'cp' | 'mate';
    scoreValue?: number;
    eval?: { type: 'cp' | 'mate'; value: number };
    pv?: string[];
  }>;
}

interface LookupResponse {
  evaluation: CachedPositionEval | null;
}

/** In-memory dedupe so a single review pass doesn't double-fetch identical positions. */
const inflight = new Map<string, Promise<CachedPositionEval | null>>();

function cacheKey(fen: string, engine: string, depth: number): string {
  return `${fen}|${engine}|${depth}`;
}

export async function fetchCachedEval(
  fen: string,
  engine: string,
  depth: number,
): Promise<CachedPositionEval | null> {
  // Normalize client-side BEFORE the request so the server stores/looks up a
  // transposition-stable key (REV-1). The Position model keys on the raw `fen`
  // field, so as long as read + write normalize identically the cache is
  // self-consistent.
  const normFen = normalizeFenForCache(fen);
  const key = cacheKey(normFen, engine, depth);
  if (inflight.has(key)) return inflight.get(key)!;

  const promise = (async () => {
    try {
      const { data } = await apiClient.get<LookupResponse>('/positions/eval', {
        params: { fen: normFen, engine, depth },
      });
      return data?.evaluation ?? null;
    } catch {
      return null;
    }
  })();
  inflight.set(key, promise);
  // Expire the dedupe entry once the promise settles — cache is consulted
  // again on a re-run / re-fetch.
  promise.finally(() => inflight.delete(key));
  return promise;
}

export interface CachePayload {
  fen: string;
  engineVersion: 'sf18-lite' | 'sf17-lite' | 'sf16-lite';
  depth: number;
  /** Side to move at this position. Stored on the cache doc so a reader can
   *  interpret the White-relative evaluation. */
  turn: 'w' | 'b';
  evaluation: { type: 'cp' | 'mate'; value: number };
  lines: Array<{
    multipv: number;
    eval: { type: 'cp' | 'mate'; value: number };
    pv: string[];
  }>;
}

export async function pushCachedEval(payload: CachePayload): Promise<void> {
  // Only authenticated users can write to the shared cache.
  if (!getAuthToken()) return;
  try {
    // Normalize the FEN on the write path too (REV-1) so the entry is stored
    // under the same transposition-stable key that fetchCachedEval reads.
    await apiClient.post('/positions/cache', {
      ...payload,
      fen: normalizeFenForCache(payload.fen),
    });
  } catch {
    // Best-effort cache write. Never block the review on cache failure.
  }
}
