import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { useReviewStore } from '../store/reviewStore';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useKeyboardNav() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      const game = useGameStore.getState();
      const ui = useUIStore.getState();
      const review = useReviewStore.getState();

      // In review playback mode, arrow keys drive the review cursor
      // (which in turn moves pieces via useReviewPlayback effect).
      if (review.isReviewMode && review.result) {
        const total = review.result.moveReviews.length;
        const ply = review.currentReviewPly;
        switch (e.key) {
          case ' ':
            e.preventDefault();
            review.togglePlayback();
            return;
          case 'ArrowLeft':
            e.preventDefault();
            review.setCurrentReviewPly(Math.max(0, ply - 1));
            return;
          case 'ArrowRight':
            e.preventDefault();
            review.setCurrentReviewPly(Math.min(total, ply + 1));
            return;
          case 'ArrowUp':
            e.preventDefault();
            review.setCurrentReviewPly(0);
            return;
          case 'ArrowDown':
            e.preventDefault();
            review.setCurrentReviewPly(total);
            return;
          case 'f':
          case 'F':
            e.preventDefault();
            ui.flipBoard();
            return;
          default:
            return;
        }
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          game.goBack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          game.goForward();
          break;
        case 'ArrowUp':
          e.preventDefault();
          game.goToStart();
          break;
        case 'ArrowDown':
          e.preventDefault();
          game.goToEnd();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          ui.flipBoard();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
