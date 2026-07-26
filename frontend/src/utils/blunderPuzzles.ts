// Extract solvable "fix your blunder" puzzles from a completed game review.
// Each mistake / blunder / miss becomes a puzzle: the position BEFORE the bad
// move, with the engine's best move as the solution. The FEN-before-move is the
// fen stored on the reviewed node at the SAME plyIndex (a node's fen is the
// position AFTER its move, so node[plyIndex] == position before move plyIndex).
import type { GameReviewResult, MoveClassification } from '../types/review';
import type { MoveTree } from '../types/moveTree';
import { getNodeIdAtPly } from '../store/gameStore';

export interface BlunderPuzzle {
  id: string;
  plyIndex: number;
  fenBefore: string;          // position to solve (side-to-move must find best)
  solutionUci: string;        // engine's best move (bestMoveUci)
  solutionSan: string;        // engine's best move in SAN
  playedSan: string;          // the move the player actually made
  classification: MoveClassification;
  sideToMove: 'w' | 'b';
  cpl: number;                // centipawn loss of the played move
}

// Only these three are "you had a clearly better move" situations worth drilling.
const PUZZLE_CLASSES: ReadonlySet<MoveClassification> = new Set<MoveClassification>([
  'mistake',
  'blunder',
  'miss',
]);

/**
 * Build the puzzle list for a review. Sorted worst-first (highest CPL) so the
 * biggest lessons come first. Puzzles with no resolvable position or no best
 * move are skipped.
 */
export function buildBlunderPuzzles(
  result: GameReviewResult,
  tree: MoveTree,
): BlunderPuzzle[] {
  const puzzles: BlunderPuzzle[] = [];
  for (const mv of result.moveReviews) {
    if (!PUZZLE_CLASSES.has(mv.classification)) continue;
    if (!mv.bestMoveUci) continue;

    // Position BEFORE the played move == reviewed node at plyIndex (root at 0,
    // move at plyIndex lives at reviewedNodeIds[plyIndex+1], so [plyIndex] is
    // the position it was played from).
    const nodeId = getNodeIdAtPly(tree, mv.plyIndex, result.reviewedNodeIds);
    const node = nodeId ? tree.nodes[nodeId] : null;
    const fenBefore = node?.fen;
    if (!fenBefore) continue;

    const sideToMove = (fenBefore.split(' ')[1] as 'w' | 'b') ?? 'w';

    puzzles.push({
      id: `puz_${mv.plyIndex}_${mv.uci}`,
      plyIndex: mv.plyIndex,
      fenBefore,
      solutionUci: mv.bestMoveUci,
      solutionSan: mv.bestMoveSan || mv.bestMoveUci,
      playedSan: mv.san,
      classification: mv.classification,
      sideToMove,
      cpl: mv.cpl,
    });
  }
  puzzles.sort((a, b) => b.cpl - a.cpl);
  return puzzles;
}
