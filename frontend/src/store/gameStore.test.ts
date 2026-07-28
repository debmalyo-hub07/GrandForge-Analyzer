import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildIndexedGameFromTree,
  getNodeIdAtPly,
  pathKey,
  useGameStore,
} from './gameStore';
import { useReviewStore } from './reviewStore';
import { useUIStore } from './uiStore';

function move(from: string, to: string, promotion?: string): boolean {
  return useGameStore.getState().makeMove({ from: from as any, to: to as any, promotion });
}

describe('review line identity', () => {
  beforeEach(() => {
    useGameStore.getState().resetBoard();
    useReviewStore.getState().clearReview();
  });

  it('builds an active variation review with the exact reviewed node path', () => {
    expect(move('e2', 'e4')).toBe(true);
    expect(move('e7', 'e5')).toBe(true);
    expect(move('g1', 'f3')).toBe(true);
    const mainlineThird = useGameStore.getState().currentNodeId;

    useGameStore.getState().goBack();
    expect(move('f1', 'c4')).toBe(true);
    const variationThird = useGameStore.getState().currentNodeId;

    const tree = useGameStore.getState().moveTree;
    const game = buildIndexedGameFromTree(tree);

    expect(game?.moveUciList).toEqual(['e2e4', 'e7e5', 'f1c4']);
    expect(game?.reviewedNodeIds).toHaveLength(4);
    expect(game?.reviewedNodeIds.at(-1)).toBe(variationThird);
    expect(game?.reviewedNodeIds).not.toContain(mainlineThird);
  });

  it('resolves ply positions from the reviewed path instead of children[0]', () => {
    expect(move('e2', 'e4')).toBe(true);
    expect(move('e7', 'e5')).toBe(true);
    expect(move('g1', 'f3')).toBe(true);

    useGameStore.getState().goBack();
    expect(move('f1', 'c4')).toBe(true);
    const game = buildIndexedGameFromTree(useGameStore.getState().moveTree);

    expect(getNodeIdAtPly(useGameStore.getState().moveTree, 3)).not.toBe(game?.reviewedNodeIds.at(3));
    expect(getNodeIdAtPly(useGameStore.getState().moveTree, 3, game?.reviewedNodeIds)).toBe(game?.reviewedNodeIds.at(3));
  });

  it('path keys distinguish same-ply mainline and variation nodes', () => {
    expect(pathKey(['root', 'a', 'b'])).toBe('root/a/b');
    expect(pathKey(['root', 'a', 'c'])).toBe('root/a/c');
  });
});

describe('manual annotations follow the board', () => {
  beforeEach(() => {
    useGameStore.getState().resetBoard();
    useReviewStore.getState().clearReview();
    useUIStore.getState().clearArrows();
    useUIStore.getState().clearHighlights();
  });

  it('makeMove clears manual arrows and highlights when creating a new node', () => {
    useUIStore.getState().addArrow(['e2', 'e4', '#ff0000']);
    useUIStore.getState().toggleHighlight('d4' as never);
    expect(useUIStore.getState().customArrows).toHaveLength(1);
    expect(useUIStore.getState().highlightedSquares.size).toBe(1);

    expect(move('e2', 'e4')).toBe(true);

    expect(useUIStore.getState().customArrows).toHaveLength(0);
    expect(useUIStore.getState().highlightedSquares.size).toBe(0);
  });

  it('makeMove clears them on the transposition branch too', () => {
    expect(move('e2', 'e4')).toBe(true);
    useGameStore.getState().goBack();
    const nodesBefore = Object.keys(useGameStore.getState().moveTree.nodes).length;

    useUIStore.getState().addArrow(['g1', 'f3', '#ff0000']);
    // Replaying an existing move must reuse the child, not grow the tree.
    expect(move('e2', 'e4')).toBe(true);

    expect(Object.keys(useGameStore.getState().moveTree.nodes)).toHaveLength(nodesBefore);
    expect(useUIStore.getState().customArrows).toHaveLength(0);
  });

  it('an illegal move leaves annotations untouched', () => {
    useUIStore.getState().addArrow(['e2', 'e4', '#ff0000']);
    expect(move('e2', 'e5')).toBe(false);
    expect(useUIStore.getState().customArrows).toHaveLength(1);
  });
});
