import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useGameStore, getMainlinePath, getNodeIdAtPly } from '../store/gameStore';
import { parseShareParams } from '../utils/shareLink';

/**
 * Applies `?pgn=` / `?fen=` / `&ply=` from the URL to the board, once.
 *
 * Deliberately fires only on first mount for a given search string: after the
 * board loads, the user navigates freely and we do NOT keep the URL in sync.
 * Rewriting the URL on every move would spam history and make the back button
 * step through plies instead of leaving the page — and reapplying the param on
 * each render would yank the user back to the shared ply.
 *
 * A `/game/:id` deep link wins over share params: that route fetches a stored
 * game, and applying a URL position on top of it would race the fetch.
 */
export function useShareParams(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const { search } = useLocation();
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // One shot per distinct query string. Guards both re-renders and the
    // dev-mode double-effect.
    if (appliedRef.current === search) return;

    const state = parseShareParams(search);
    if (!state.pgn && !state.fen) return;
    appliedRef.current = search;

    const store = useGameStore.getState();

    if (state.fen) {
      if (!store.loadFEN(state.fen)) toast.error('Shared position could not be read');
      return;
    }

    if (!state.pgn) return;
    // A bare move list is valid PGN; loadPGN normalizes and validates it, and
    // returns false rather than throwing on a move that does not play.
    if (!store.loadPGN(state.pgn)) {
      toast.error('Shared moves could not be read');
      return;
    }

    if (state.ply === undefined) return;
    // Clamp here rather than in the parser — only now do we know how many moves
    // the line actually has. Ply 0 is the starting position.
    const tree = useGameStore.getState().moveTree;
    const lastPly = Math.max(0, getMainlinePath(tree).length - 1);
    const target = getNodeIdAtPly(tree, Math.min(state.ply, lastPly));
    if (target) useGameStore.getState().goToNode(target);
  }, [search, enabled]);
}

export default useShareParams;
