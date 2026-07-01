import { useEffect } from 'react';
import { useReviewStore } from '../store/reviewStore';
import { useGameStore, getNodeIdAtPly } from '../store/gameStore';

export function useReviewPlayback() {
  const isReviewMode = useReviewStore((s) => s.isReviewMode);
  const currentReviewPly = useReviewStore((s) => s.currentReviewPly);
  const hasResult = useReviewStore((s) => Boolean(s.result));

  // Read moveTree + goToNode lazily inside the effect so unrelated tree
  // mutations (e.g. setOpening) don't re-fire navigation and snap the board.
  useEffect(() => {
    if (!isReviewMode || !hasResult) return;
    const tree = useGameStore.getState().moveTree;
    // Follow the exact line the review was computed on (reviewedNodeIds). This
    // is what fixes the variation desync: a review of an off-mainline line plays
    // back along THAT line, not children[0]. Legacy results without line
    // identity fall back to the mainline walk inside getNodeIdAtPly.
    const reviewedNodeIds = useReviewStore.getState().result?.reviewedNodeIds;
    const nodeId = getNodeIdAtPly(tree, currentReviewPly, reviewedNodeIds);
    if (nodeId) useGameStore.getState().goToNode(nodeId);
  }, [currentReviewPly, isReviewMode, hasResult]);
}