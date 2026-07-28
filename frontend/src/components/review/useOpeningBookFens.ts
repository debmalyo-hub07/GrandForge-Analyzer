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
 * Positions the confirmed-book moves were played FROM.
 *
 * `fensAlongLine[k]` is the position reached AFTER k plies, and the move at
 * plyIndex j is played from `fensAlongLine[j]`. With `matchedPlies` confirmed
 * theory moves those are indices `0 .. matchedPlies - 1`.
 *
 * F6 (2026-07-29): the old loop added indices `0 .. matchedPlies`, one too many.
 * Index `matchedPlies` is by definition the position the FIRST OUT-OF-BOOK move
 * is played from, so that move was labelled `book` and thereby dropped from the
 * accuracy series, from `ratedMoves` and from phase scoring — once per game,
 * every game. A genuine opening blunder (3.Qh5 after `e4 e5`) vanished from the
 * score entirely.
 */
export function bookFensUpTo(
  fensAlongLine: readonly (string | undefined)[],
  matchedPlies: number,
): Set<string> {
  const fens = new Set<string>();
  const upTo = Math.min(Math.max(0, matchedPlies), fensAlongLine.length);
  for (let i = 0; i < upTo; i++) {
    const fen = fensAlongLine[i];
    if (fen) fens.add(fen);
  }
  return fens;
}

/**
 * Returns a Set of book FENs for the review service.
 *
 * Strategy: ask the ECO lookup endpoint to match the longest prefix of the
 * mainline move sequence (up to 16 plies). The response tells us exactly how
 * many plies are confirmed-book; `bookFensUpTo` turns that into the set of
 * positions those moves were played from.
 *
 * Falls back to a conservative empty set if the lookup fails — better to
 * classify a real opening move as "Best" than to suppress a legitimate blunder
 * by tagging it Book heuristically.
 *
 * The result is memoised against the mainline node path. ReviewTab is not
 * remounted when a new game is loaded into the move tree, so an unkeyed cache
 * (the previous behaviour) served game A's book FENs when reviewing game B.
 */
export function useOpeningBookFens(): () => Promise<Set<string>> {
  const cacheRef = useRef<{ key: string; fens: Set<string> } | null>(null);

  return async () => {
    const moveTree = useGameStore.getState().moveTree;
    const mainline = getMainlinePath(moveTree);
    const key = mainline.join('/');
    if (cacheRef.current?.key === key) return cacheRef.current.fens;

    const remember = (fens: Set<string>) => {
      cacheRef.current = { key, fens };
      return fens;
    };

    if (mainline.length <= 1) return remember(new Set<string>());

    // Build SAN sequence for the first MAX_BOOK_PLIES.
    const sanSeq: string[] = [];
    for (let i = 1; i <= Math.min(MAX_BOOK_PLIES, mainline.length - 1); i++) {
      const node = moveTree.nodes[mainline[i]];
      if (!node?.san) break;
      sanSeq.push(node.san);
    }
    if (sanSeq.length === 0) return remember(new Set<string>());

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
      return remember(new Set<string>());
    }

    // fensAlongLine[k] = position after k plies along the mainline.
    const fensAlongLine = mainline.map((nodeId) => moveTree.nodes[nodeId]?.fen);
    return remember(bookFensUpTo(fensAlongLine, matchedPlies));
  };
}
