import { useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import { useGameStore } from '../store/gameStore';
import { useEngineStore } from '../store/engineStore';
import { useReviewStore } from '../store/reviewStore';

function isTerminalFen(fen: string): boolean {
  try {
    const chess = new Chess(fen);
    return chess.isGameOver();
  } catch {
    return false;
  }
}

export function useAutoAnalysis() {
  const currentFen = useGameStore((s) => s.currentFen);
  const isEnabled = useEngineStore((s) => s.isEnabled);
  const manager = useEngineStore((s) => s.manager);
  const reviewPhase = useReviewStore((s) => s.progress.phase);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isEnabled || !manager) return;

    // Only suppress live analysis while the BATCH review is crunching — that
    // run drives the engine itself and a competing interactive search would
    // thrash the worker. Once the batch completes (phase 'complete'), browsing
    // review plies must get live analysis for the displayed position, exactly
    // like Lichess move navigation. Gating on isReviewMode (the whole browsing
    // session) was the regression that froze the eval bar and engine lines.
    if (reviewPhase === 'analyzing') return;

    if (isTerminalFen(currentFen)) {
      useEngineStore.getState().stopAnalysis();
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      useEngineStore.getState().startAnalysis(currentFen);
    }, 150);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [currentFen, isEnabled, manager, reviewPhase]);
}
