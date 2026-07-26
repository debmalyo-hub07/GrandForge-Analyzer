import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useGameStore, getMainlinePath } from '../store/gameStore';
import { openings } from '../services/apiClient';

interface Opening {
  ecoCode: string;
  name: string;
  family: string;
  variation?: string;
  moveSequence: string;
  plyDepth: number;
}

interface OpeningLookupResponse {
  opening: Opening | null;
}

/** Global in-memory cache for opening lookups keyed by exact move string. */
const OPENING_CACHE = new Map<string, OpeningLookupResponse>();

/** Bound the cache so many games in one session don't leak memory. Lookups are
 *  capped at 10 plies + prefix-deduped, so 500 entries is generous headroom. */
const OPENING_CACHE_MAX = 500;

function openingCacheSet(key: string, value: OpeningLookupResponse): void {
  if (!OPENING_CACHE.has(key) && OPENING_CACHE.size >= OPENING_CACHE_MAX) {
    const oldest = OPENING_CACHE.keys().next().value;
    if (oldest !== undefined) OPENING_CACHE.delete(oldest);
  }
  OPENING_CACHE.set(key, value);
}

/** Maximum plies to bother looking up (opening phase only). */
const MAX_LOOKUP_PLIES = 10;

export function useOpeningDetect() {
  const moveTree = useGameStore((s) => s.moveTree);
  const setOpening = useGameStore((s) => s.setOpening);

  const sanMoves = useMemo(() => {
    const path = getMainlinePath(moveTree);
    return path
      .map((id) => moveTree.nodes[id]?.san)
      .filter((san): san is string => typeof san === 'string' && san.length > 0);
  }, [moveTree]);

  const moveCount = sanMoves.length;
  const movesKey = sanMoves.join(' ');

  // Increase debounce so rapid move-making (e.g. during playback) doesn't fire lookups
  const [debouncedMoves, setDebouncedMoves] = useState<string>(movesKey);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedMoves(movesKey), 1000);
    return () => clearTimeout(t);
  }, [movesKey]);

  // Early-exit sentinel: after two consecutive null results, game has left theory
  const consecutiveNullsRef = useRef(0);

  // Reset consecutive nulls when game resets (moveCount drops to 0)
  useEffect(() => {
    if (moveCount === 0) consecutiveNullsRef.current = 0;
  }, [moveCount]);

  // Determine whether we need to fetch at all
  const shouldFetch = useMemo(() => {
    if (!debouncedMoves) return false;
    if (moveCount === 0) return false;
    if (moveCount > MAX_LOOKUP_PLIES) return false;
    // Game left theory — stop asking
    if (consecutiveNullsRef.current >= 2) return false;

    // If we already cached this exact string, don't fetch again
    if (OPENING_CACHE.has(debouncedMoves)) return false;

    // If a cached parent opening exists and its known plyDepth is already
    // exceeded by current move count, there is no need to keep fetching.
    for (const [cachedKey, cachedValue] of OPENING_CACHE) {
      if (cachedKey === debouncedMoves) continue;
      const isPrefix =
        debouncedMoves === cachedKey ||
        debouncedMoves.startsWith(cachedKey + ' ');
      if (
        isPrefix &&
        cachedValue.opening?.plyDepth != null &&
        moveCount > cachedValue.opening.plyDepth
      ) {
        return false;
      }
    }

    return true;
  }, [debouncedMoves, moveCount]);

  const query = useQuery<OpeningLookupResponse>({
    queryKey: ['opening-lookup', debouncedMoves],
    queryFn: async () => {
      if (!debouncedMoves) return { opening: null };
      try {
        const data = await openings.lookup({ moves: debouncedMoves });
        const response: OpeningLookupResponse = data;
        openingCacheSet(debouncedMoves, response);
        consecutiveNullsRef.current = response.opening ? 0 : consecutiveNullsRef.current + 1;
        return response;
      } catch {
        // Cache a negative result so a down API doesn't keep getting hit
        const noResult: OpeningLookupResponse = { opening: null };
        openingCacheSet(debouncedMoves, noResult);
        consecutiveNullsRef.current += 1;
        return noResult;
      }
    },
    enabled: shouldFetch,
    staleTime: 1000 * 60 * 5,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Resolve the best available opening: exact query result → exact cache hit → parent cache hit
  const resolvedOpening = useMemo<Opening | null>(() => {
    if (query.data?.opening) return query.data.opening;

    const exact = OPENING_CACHE.get(debouncedMoves);
    if (exact?.opening) return exact.opening;

    // Walk backwards through move prefixes to find the deepest cached opening
    const parts = debouncedMoves.split(' ');
    for (let i = parts.length; i > 0; i--) {
      const prefix = parts.slice(0, i).join(' ');
      const hit = OPENING_CACHE.get(prefix);
      if (hit?.opening) return hit.opening;
    }

    return null;
  }, [query.data, debouncedMoves]);

  // Sync resolved opening into the game store
  useEffect(() => {
    if (resolvedOpening) {
      setOpening(`${resolvedOpening.ecoCode} ${resolvedOpening.name}`);
    } else if (debouncedMoves.length === 0) {
      setOpening('');
    }
  }, [resolvedOpening, setOpening, debouncedMoves]);

  return {
    opening: resolvedOpening,
    isLoading: query.isLoading && shouldFetch,
  };
}
