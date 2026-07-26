import { describe, expect, it } from 'vitest';
import { buildBlunderPuzzles } from './blunderPuzzles';
import type { GameReviewResult, MoveReview } from '../types/review';
import type { MoveTree, MoveNode } from '../types/moveTree';

const START = 'rnbqkbnr/pppppppp/rnbqkbnr/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Minimal move node with just the fields buildBlunderPuzzles reads.
const node = (id: string, fen: string, parentId: string | null): MoveNode => ({
  id, san: '', uci: '', fen, parentId, children: [],
  isMainline: true, depth: 0, plyNumber: 0, moveNumber: 1, color: 'w',
});

const move = (o: Partial<MoveReview>): MoveReview => ({
  plyIndex: 0, san: 'e4', uci: 'e2e4', classification: 'best',
  evalBefore: 0, evalAfter: 0, cpl: 0,
  bestMoveUci: 'd2d4', bestMoveSan: 'd4', bestMoveEval: 0,
  isBookMove: false, isBrilliant: false, mateBefore: null, mateAfter: null,
  pvLine: [], complexity: 0, reason: '', ...o,
});

function makeTree(fensByPly: string[]): { tree: MoveTree; ids: string[] } {
  const ids: string[] = [];
  const nodes: Record<string, MoveNode> = {};
  fensByPly.forEach((fen, i) => {
    const id = `n${i}`;
    ids.push(id);
    nodes[id] = node(id, fen, i === 0 ? null : `n${i - 1}`);
  });
  return { tree: { nodes, rootId: ids[0] }, ids };
}

describe('buildBlunderPuzzles', () => {
  it('extracts only mistakes/blunders/misses, worst-first', () => {
    const { tree, ids } = makeTree([START, 'fen1', 'fen2', 'fen3']);
    const result = {
      moveReviews: [
        move({ plyIndex: 0, classification: 'best', cpl: 2 }),
        move({ plyIndex: 1, classification: 'mistake', cpl: 120, bestMoveUci: 'g1f3', bestMoveSan: 'Nf3' }),
        move({ plyIndex: 2, classification: 'blunder', cpl: 400, bestMoveUci: 'd1h5', bestMoveSan: 'Qh5' }),
      ],
      reviewedNodeIds: ids,
    } as unknown as GameReviewResult;

    const puzzles = buildBlunderPuzzles(result, tree);
    expect(puzzles).toHaveLength(2);
    // worst-first: blunder (cpl 400) before mistake (cpl 120)
    expect(puzzles[0].classification).toBe('blunder');
    expect(puzzles[0].solutionUci).toBe('d1h5');
    expect(puzzles[0].fenBefore).toBe('fen2'); // position BEFORE ply 2 == node at index 2
    expect(puzzles[1].classification).toBe('mistake');
  });

  it('skips moves with no best move and unresolvable positions', () => {
    const { tree, ids } = makeTree([START, 'fen1']);
    const result = {
      moveReviews: [
        move({ plyIndex: 0, classification: 'blunder', cpl: 300, bestMoveUci: '' }),
        move({ plyIndex: 5, classification: 'blunder', cpl: 300, bestMoveUci: 'a2a4' }),
      ],
      reviewedNodeIds: ids,
    } as unknown as GameReviewResult;

    expect(buildBlunderPuzzles(result, tree)).toHaveLength(0);
  });
});
