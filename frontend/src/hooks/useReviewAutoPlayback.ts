// src/hooks/useReviewAutoPlayback.ts
//
// Auto-advance playback for Review Mode. Drives setCurrentReviewPly forward
// on an interval. Pauses automatically when the cursor reaches the last ply.
// Pauses if the user navigates manually mid-play (deltaPly !== +1).
//
// isPlaying is now stored in reviewStore so it can be toggled imperatively
// from useKeyboardNav (Space key) without a custom event bus.
import { useCallback, useEffect, useRef } from 'react';
import { useReviewStore } from '../store/reviewStore';

const DEFAULT_DWELL_MS = 1800;

export interface UseReviewAutoPlayback {
  isPlaying: boolean;
  toggle: () => void;
  play: () => void;
  pause: () => void;
}

export function useReviewAutoPlayback(dwellMs: number = DEFAULT_DWELL_MS): UseReviewAutoPlayback {
  const isReviewMode = useReviewStore((s) => s.isReviewMode);
  const currentReviewPly = useReviewStore((s) => s.currentReviewPly);
  const setCurrentReviewPly = useReviewStore((s) => s.setCurrentReviewPly);
  const total = useReviewStore((s) => s.result?.moveReviews.length ?? 0);
  const isPlaying = useReviewStore((s) => s.isPlaying);
  const setIsPlaying = useReviewStore((s) => s.setIsPlaying);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expectedPlyRef = useRef<number>(currentReviewPly);

  const clear = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const pause = useCallback(() => {
    clear();
    setIsPlaying(false);
  }, [setIsPlaying]);

  const play = useCallback(() => {
    if (!isReviewMode || total === 0) return;
    expectedPlyRef.current = currentReviewPly;
    setIsPlaying(true);
  }, [isReviewMode, total, currentReviewPly, setIsPlaying]);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  // Manual navigation detection — if cursor jumps to something other than the
  // expected next ply, pause.
  useEffect(() => {
    if (!isPlaying) return;
    if (currentReviewPly !== expectedPlyRef.current) {
      pause();
    }
  }, [currentReviewPly, isPlaying, pause]);

  // Schedule next tick.
  useEffect(() => {
    if (!isPlaying || !isReviewMode) {
      clear();
      return;
    }
    if (currentReviewPly >= total) {
      pause();
      return;
    }
    timerRef.current = setTimeout(() => {
      const next = currentReviewPly + 1;
      expectedPlyRef.current = next;
      setCurrentReviewPly(next);
    }, dwellMs);
    return clear;
  }, [isPlaying, isReviewMode, currentReviewPly, total, dwellMs, setCurrentReviewPly, pause]);

  // Hard-pause when review mode exits.
  useEffect(() => {
    if (!isReviewMode && isPlaying) pause();
  }, [isReviewMode, isPlaying, pause]);

  // Cleanup on unmount.
  useEffect(() => () => clear(), []);

  return { isPlaying, toggle, play, pause };
}
