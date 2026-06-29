import { useEffect } from 'react';
import { useReviewStore } from '../store/reviewStore';
import { useGameStore } from '../store/gameStore';
import type { MoveTree } from '../types/moveTree';

function getMainlineIdAtPly(tree: MoveTree, ply: number): string | null {
  let node = tree.nodes[tree.rootId];
  let i = 0;
  while (node && i < ply) {
    if (node.children.length === 0) break;
    const nextId: string = node.children[0];
    node = tree.nodes[nextId];
    i++;
  }
  return node ? node.id : null;
}

export function useReviewPlayback() {
  const isReviewMode = useReviewStore((s) => s.isReviewMode);
  const currentReviewPly = useReviewStore((s) => s.currentReviewPly);
  const hasResult = useReviewStore((s) => Boolean(s.result));

  // Read moveTree + goToNode lazily inside the effect so unrelated tree
  // mutations (e.g. setOpening) don't re-fire navigation and snap the board.
  useEffect(() => {
    if (!isReviewMode || !hasResult) return;
    const tree = useGameStore.getState().moveTree;
    const nodeId = getMainlineIdAtPly(tree, currentReviewPly);
    if (nodeId) useGameStore.getState().goToNode(nodeId);
  }, [currentReviewPly, isReviewMode, hasResult]);
}