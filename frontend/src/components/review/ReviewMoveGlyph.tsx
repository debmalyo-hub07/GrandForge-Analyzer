// src/components/review/ReviewMoveGlyph.tsx
import type { GameReviewResult, MoveClassification, MoveReview } from '../../types/review';
import { useReviewStore } from '../../store/reviewStore';

/**
 * Resolve the review for a specific move-tree node, honoring which LINE the
 * review was computed on. A move at `plyIndex` only carries a review if `nodeId`
 * is the node that actually sits at that ply on the reviewed line
 * (`reviewedNodeIds[plyIndex + 1]`, root being index 0). This stops a review of
 * one line from decorating a same-ply node on a different branch.
 *
 * Legacy results without `reviewedNodeIds` can't distinguish branches, so they
 * fall back to decorating mainline nodes only (`isOnMainline`).
 */
export function getReviewForNode(
  result: GameReviewResult,
  nodeId: string,
  plyIndex: number,
  isOnMainline: boolean,
): MoveReview | null {
  const review = result.moveReviews.find((m) => m.plyIndex === plyIndex) ?? null;
  if (!review) return null;
  const ids = result.reviewedNodeIds;
  if (ids && ids.length > 0) {
    return ids[plyIndex + 1] === nodeId ? review : null;
  }
  return isOnMainline ? review : null;
}

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

export function MoveNodeGlyph({
  plyIndex,
  nodeId,
  isMainline,
}: {
  plyIndex: number;
  nodeId: string;
  isMainline: boolean;
}) {
  const result = useReviewStore((s) => s.result);
  const isReviewMode = useReviewStore((s) => s.isReviewMode);
  if (!isReviewMode || !result) return null;

  const review = getReviewForNode(result, nodeId, plyIndex, isMainline);
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
