import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { buildBlunderPuzzles } from './blunderPuzzles';
import type { GameReviewResult, MoveReview } from '../types/review';
import type { MoveTree, MoveNode } from '../types/moveTree';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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

  // test-audit §6: the fenBefore off-by-one was only ever asserted against
  // placeholder strings laid out to match the convention, so inverting the
  // convention in both code and fixture would still pass. This case builds the
  // tree from real chess.js positions, so the convention is checked against
  // reality: the move recorded at plyIndex N must actually be LEGAL in the
  // puzzle's fenBefore, and so must its solution.
  it('resolves fenBefore to a real position the played move and solution are legal in', () => {
    const chess = new Chess();
    const fens = [chess.fen()]; // fens[i] === position after i plies
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']) {
      chess.move(san);
      fens.push(chess.fen());
    }
    const { tree, ids } = makeTree(fens);

    const result = {
      moveReviews: [
        move({ plyIndex: 0, san: 'e4', uci: 'e2e4', classification: 'best', cpl: 3 }),
        move({ plyIndex: 1, san: 'e5', uci: 'e7e5', classification: 'best', cpl: 4 }),
        // 2.Nf3 called a mistake; engine preferred 2.Bc4 (legal after 1.e4 e5).
        move({
          plyIndex: 2, san: 'Nf3', uci: 'g1f3', classification: 'mistake', cpl: 130,
          bestMoveUci: 'f1c4', bestMoveSan: 'Bc4',
        }),
        move({ plyIndex: 3, san: 'Nc6', uci: 'b8c6', classification: 'good', cpl: 20 }),
        // 3.Bb5 called a blunder; engine preferred 3.Ng5 (legal after 2...Nc6).
        move({
          plyIndex: 4, san: 'Bb5', uci: 'f1b5', classification: 'blunder', cpl: 410,
          bestMoveUci: 'f3g5', bestMoveSan: 'Ng5',
        }),
      ],
      reviewedNodeIds: ids,
    } as unknown as GameReviewResult;

    const puzzles = buildBlunderPuzzles(result, tree);
    expect(puzzles.map((p) => p.plyIndex)).toEqual([4, 2]); // worst-first by CPL

    const played: Record<number, string> = { 2: 'g1f3', 4: 'f1b5' };
    for (const p of puzzles) {
      const board = new Chess(p.fenBefore);
      const legal = board.moves({ verbose: true }).map((m) => m.lan);
      // If node[plyIndex] were the position AFTER the move (the inverted
      // convention), the played move would no longer be available here.
      expect(legal).toContain(played[p.plyIndex]);
      expect(legal).toContain(p.solutionUci);
      expect(p.sideToMove).toBe(board.turn());
    }

    const mistake = puzzles.find((p) => p.plyIndex === 2)!;
    expect(mistake.fenBefore).toBe(fens[2]);
    expect(mistake.fenBefore).toBe(
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
    );
    expect(mistake.playedSan).toBe('Nf3');
    expect(mistake.solutionSan).toBe('Bc4');
  });
});
