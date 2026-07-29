// src/services/positionCache.ts
//
// Client wrapper for the MongoDB-backed Position eval cache.
//
//   GET  /api/positions/eval?fen=...&engine=...&depth=N
//        → returns the deepest *confirmed* cached evaluation ≥ N for (fen, engine)
//   POST /api/positions/cache (no auth required)
//        → submits a finished search result keyed by (fen, engineVersion)
//
// The review engine uses these to skip Stockfish work entirely when another
// user has already evaluated the same position at sufficient depth. This is
// the multiplayer-cache-federation pattern referenced from Lichess cloud eval.
//
// Both directions are anonymous. Writes used to require an account, which meant
// that on a platform where sign-up is optional the cache never filled and every
// reader got a permanent miss. The server now defends itself instead of leaning
// on the auth gate: it verifies the payload against the position (PV legality,
// score bounds, matching top line) and only *serves* an entry once two
// independent submissions agree on it — see `backend/positionCacheGuards.ts`.
//
// Consequence worth knowing: a freshly deployed cache serves nothing until
// positions have been seen twice. Misses are free (the review falls through to
// local WASM), so this shows up as "no speedup yet", not as an error.

import { apiClient } from './apiClient';
import type { EngineVersion } from '../types/engine';

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

/**
 * Longest PV the cache-write endpoint accepts per line. `POST
 * /api/positions/cache` bounds `pv` at this length and **rejects** anything
 * longer with a 400 that `pushCachedEval` swallows — so writers must truncate,
 * not rely on the server to. Must equal the `.max(...)` on `pv` in
 * `backend/routes/positions/cache.ts` (parity-tested).
 */
export const MAX_CACHED_PV = 64;

/**
 * Shallowest search the cache-write endpoint accepts. Mirrors `MIN_CACHE_DEPTH`
 * in `backend/positionCacheGuards.ts` (parity-tested) — a shallow eval is
 * worthless to a shared cache and is what a spam script sends.
 */
export const MIN_CACHE_DEPTH = 12;

export interface CachedPositionEval {
  fen: string;
  engineVersion: string;
  depth: number;
  /** How many independent submissions agree on this evaluation. The server only
   *  returns entries at or above its trust threshold, so this is always ≥ 2 —
   *  it's surfaced so the UI can say where a "free" eval came from. */
  confirmations?: number;
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

export interface CachePayload {
  fen: string;
  engineVersion: EngineVersion;
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
  // Guard 7 server-side: a shallow eval is rejected with a 400 that this function
  // swallows. Skipping the request outright saves a pointless round trip on every
  // ply of a low-depth review.
  if (payload.depth < MIN_CACHE_DEPTH) return;
  try {
    // Normalize the FEN on the write path too (REV-1) so the entry is stored
    // under the same transposition-stable key that fetchCachedEval reads. The
    // server now *rejects* a non-normalized FEN rather than storing a row no
    // reader can match, so this is load-bearing, not just tidy.
    await apiClient.post('/positions/cache', {
      ...payload,
      fen: normalizeFenForCache(payload.fen),
    });
  } catch {
    // Best-effort cache write. Never block the review on cache failure — a 429
    // from the write budget or a 400 from a guard both land here and are correct
    // outcomes, not errors the user should see.
  }
}
