import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useGameStore, getPathToNode } from '../store/gameStore';
import { explorer } from '../services/apiClient';
import type { ExplorerLookupResponse } from '../types/explorer';

/**
 * Explorer lookup for the position currently on the board.
 *
 * Two things keep this cheap, and both matter on the free tier:
 *
 * 1. **`enabled` is gated on the panel being visible.** Every distinct position
 *    a user steps through is one request, and a game review walks hundreds of
 *    them. Fetching for users who never open the Explore tab would spend the
 *    whole `browse` rate-limit bucket on data nobody looks at. `SidePanel` only
 *    mounts the selected tab, so in practice the gate is doubled — but the flag
 *    stays because a future always-mounted layout would silently undo it.
 * 2. **The response is cached hard.** The aggregate only changes when an
 *    operator re-ingests, so the route sends `Cache-Control: max-age=86400` and
 *    react-query keeps it for the session. Stepping back and forth through a
 *    game — the dominant access pattern — costs one request per position, once.
 */

/** Debounce, matched to the board's own analysis debounce so they settle together. */
const DEBOUNCE_MS = 200;

/**
 * Don't ask past this ply. The ingest's own depth (`--max-plies`, default 20) is
 * the real limit — beyond it every answer is `null` — so this is a cheap guard
 * against a long game firing dozens of requests that can only miss. Set slightly
 * above the default depth so a deeper re-ingest still gets used.
 */
const MAX_EXPLORE_PLIES = 24;

export interface UseExplorerResult {
  data: ExplorerLookupResponse | undefined;
  isLoading: boolean;
  /** True when the request failed — distinct from "no data for this position". */
  isError: boolean;
  /** True when we deliberately didn't ask (too deep, or panel closed). */
  isBeyondBook: boolean;
}

export function useExplorer(active: boolean): UseExplorerResult {
  const currentFen = useGameStore((s) => s.currentFen);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const moveTree = useGameStore((s) => s.moveTree);

  // SAN path to the position on the board — the *current line*, not the
  // mainline, so exploring inside a variation resolves that variation's opening.
  const sanPath = useMemo(() => {
    if (!currentNodeId) return [];
    return getPathToNode(moveTree, currentNodeId)
      .map((id) => moveTree.nodes[id]?.san)
      .filter((san): san is string => typeof san === 'string' && san.length > 0);
  }, [moveTree, currentNodeId]);

  const ply = sanPath.length;
  const movesKey = sanPath.join(' ');

  // Debounce the *position*, not the request: holding an arrow key to scrub
  // through a game would otherwise queue one lookup per frame.
  const [debounced, setDebounced] = useState({ fen: currentFen, moves: movesKey });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ fen: currentFen, moves: movesKey }), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [currentFen, movesKey]);

  const tooDeep = ply > MAX_EXPLORE_PLIES;
  const enabled = active && !tooDeep && debounced.fen.length > 0;

  const query = useQuery<ExplorerLookupResponse>({
    // The FEN alone identifies the node; `moves` only affects which opening name
    // comes back, and that is a function of the path, so both belong in the key.
    queryKey: ['explorer-lookup', debounced.fen, debounced.moves],
    queryFn: () =>
      explorer.lookup({
        fen: debounced.fen,
        ...(debounced.moves ? { moves: debounced.moves } : {}),
      }),
    enabled,
    // The aggregate is static between ingests; never refetch within a session.
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return {
    data: query.data,
    // A debounce in flight is still "loading" from the panel's point of view —
    // otherwise it flashes "no data" for 200 ms on every move.
    isLoading: enabled && (query.isLoading || query.isFetching || debounced.fen !== currentFen),
    isError: query.isError,
    isBeyondBook: tooDeep,
  };
}

export default useExplorer;
