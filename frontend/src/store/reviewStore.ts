import { create } from 'zustand';
import type { GameReviewResult, ReviewProgress } from '../types/review';
import { useEngineStore } from './engineStore';
import { useGameStore } from './gameStore';

interface ReviewState {
  result: GameReviewResult | null;
  progress: ReviewProgress;
  isReviewMode: boolean;
  currentReviewPly: number;
  isPlaying: boolean;

  setResult: (r: GameReviewResult) => void;
  setProgress: (p: ReviewProgress) => void;
  enterReviewMode: () => void;
  exitReviewMode: () => void;
  setCurrentReviewPly: (ply: number) => void;
  clearReview: () => void;
  setIsPlaying: (playing: boolean) => void;
  togglePlayback: () => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  result: null,
  progress: { currentPly: 0, totalPlies: 0, percent: 0, phase: 'idle' },
  isReviewMode: false,
  currentReviewPly: 0,
  isPlaying: false,

  setResult: (result) => set({ result }),
  setProgress: (progress) => set({ progress }),
  enterReviewMode: () => set({ isReviewMode: true, currentReviewPly: 0, isPlaying: false }),
  exitReviewMode: () => {
    // NOTE: do NOT clear manual arrows here. The review-arrow layer
    // (useReviewArrows) returns [] automatically once isReviewMode is false, so
    // there is nothing review-owned to clean up — clearing uiStore.customArrows
    // would silently destroy the user's own drawn annotations.
    set({ isReviewMode: false, isPlaying: false });
    // Restart engine analysis on current position after exiting review
    const fen = useGameStore.getState().currentFen;
    if (fen) {
      useEngineStore.getState().startAnalysis(fen);
    }
  },
  setCurrentReviewPly: (ply) => set({ currentReviewPly: ply }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  togglePlayback: () => {
    const { isPlaying, isReviewMode, result } = get();
    if (!isReviewMode || !result) return;
    set({ isPlaying: !isPlaying });
  },
  clearReview: () => {
    // Arrow/highlight wiping is owned by gameStore.resetTransientStateForNewGame
    // (the only full-reset entry point). Keeping it out of here means a stray
    // clearReview() can't nuke the user's manual arrows.
    useEngineStore.getState().resetAnalysisState();
    set({
      result: null,
      isReviewMode: false,
      currentReviewPly: 0,
      isPlaying: false,
      progress: { currentPly: 0, totalPlies: 0, percent: 0, phase: 'idle' },
    });
  },
}));
