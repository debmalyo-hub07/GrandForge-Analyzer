// src/components/review/useOpeningBookFens.ts
import { useRef } from 'react';
import { getMainlinePath } from '../../store/gameStore';
import { useGameStore } from '../../store/gameStore';
import { openings } from '../../services/apiClient';

const MAX_BOOK_PLIES = 16;

interface OpeningLookupResponse {
  opening: { moveSequence?: string; plyDepth?: number } | null;
}

/**
 * Returns a Set of book FENs for the review service.
 *
 * Strategy: ask the ECO lookup endpoint to match the longest prefix of the
 * mainline move sequence (up to 16 plies). The response tells us exactly how
 * many plies are confirmed-book. We mark fens[0..matchedPlies] as book FENs;
 * everything else falls through to engine classification.
 *
 * Falls back to a conservative empty set if the lookup fails — better to
 * classify a real opening move as "Best" than to suppress a legitimate blunder
 * by tagging it Book heuristically.
 */
export function useOpeningBookFens(): () => Promise<Set<string>> {
  const cacheRef = useRef<Set<string> | null>(null);

  return async () => {
    if (cacheRef.current) return cacheRef.current;

    const moveTree = useGameStore.getState().moveTree;
    const mainline = getMainlinePath(moveTree);
    const fens = new Set<string>();

    if (mainline.length <= 1) {
      cacheRef.current = fens;
      return fens;
    }

    // Build SAN sequence for the first MAX_BOOK_PLIES.
    const sanSeq: string[] = [];
    for (let i = 1; i <= Math.min(MAX_BOOK_PLIES, mainline.length - 1); i++) {
      const node = moveTree.nodes[mainline[i]];
      if (!node?.san) break;
      sanSeq.push(node.san);
    }
    if (sanSeq.length === 0) {
      cacheRef.current = fens;
      return fens;
    }

    let matchedPlies = 0;
    try {
      const res = (await openings.lookup({ moves: sanSeq.join(' ') })) as OpeningLookupResponse;
      const seq = res?.opening?.moveSequence ?? '';
      if (seq) {
        // Count how many plies of our input the matched sequence covers.
        const matched = seq.split(/\s+/).filter(Boolean);
        matchedPlies = matched.length;
      }
    } catch {
      // Network/API failure — be conservative, no book suppression.
      cacheRef.current = fens;
      return fens;
    }

    // Always mark the starting position as book (no real move yet).
    const root = moveTree.nodes[mainline[0]];
    if (root?.fen) fens.add(root.fen);

    // FENs reached AFTER plies 1..matchedPlies are in book theory.
    for (let i = 1; i <= matchedPlies; i++) {
      const nodeId = mainline[i];
      if (!nodeId) break;
      const node = moveTree.nodes[nodeId];
      if (node?.fen) fens.add(node.fen);
    }

    cacheRef.current = fens;
    return fens;
  };
}
