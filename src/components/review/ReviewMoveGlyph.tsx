// src/components/review/ReviewMoveGlyph.tsx
import type { MoveClassification } from '../../types/review';
import { useReviewStore } from '../../store/reviewStore';

const GLYPH: Record<MoveClassification, string> = {
  brilliant: '!!',
  great: '!',
  book: '📖',
  best: '★',
  excellent: '👍',
  good: '✓',
  inaccuracy: '?!',
  mistake: '?',
  miss: '✗',
  blunder: '??',
};

const GLYPH_COLOR: Record<MoveClassification, string> = {
  brilliant: '#1baca6',
  great: '#5c8bb0',
  book: '#c8a84b',
  best: '#96bc4b',
  excellent: '#96bc4b',
  good: '#82ac49',
  inaccuracy: '#f0c945',
  mistake: '#e68f39',
  miss: '#e05a5a',
  blunder: '#ca3431',
};

export function MoveNodeGlyph({ plyIndex }: { plyIndex: number }) {
  const result = useReviewStore((s) => s.result);
  const isReviewMode = useReviewStore((s) => s.isReviewMode);
  if (!isReviewMode || !result) return null;

  const review = result.moveReviews[plyIndex];
  if (!review) return null;
  if (review.classification === 'book') return null;

  return (
    <span
      className="move-glyph"
      style={{ color: GLYPH_COLOR[review.classification] }}
      title={review.reason || review.classification}
    >
      {GLYPH[review.classification]}
    </span>
  );
}
