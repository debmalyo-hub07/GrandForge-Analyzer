import { describe, expect, it } from 'vitest';
import { cachedLineToMoverWin, tbMoveScore } from './GameReviewService';
import { bookFensUpTo } from '../components/review/useOpeningBookFens';
import { whiteCpAfter } from '../components/review/EvalGraph';
import type { MoveReview } from '../types/review';

// ────────────────────────────────────────────────────────────────────────────
// F3 — per-move tablebase perspective.
//
// The lichess tablebase reports moves[].category / dtm from the perspective of
// the side to move AFTER the move, while the top-level category is
// mover-relative. Live response quoted in review-audit.md F3 for
// `4k3/6KP/8/8/8/8/8/8 w - -` (a win for White, DTM 15):
//
//   top level : category "win",  dtz 1,   dtm 15
//   moves[0]  : h7h8q, category "loss", dtz -14, dtm -14
//   moves[1]  : g7f6,  category "loss", dtz -2,  dtm -14
//
// White's best move is reported as a "loss" — a loss for Black, who moves next.
// tbMoveScore takes the RAW api values and must return a score from the
// perspective of the side that PLAYS the move.
// ────────────────────────────────────────────────────────────────────────────
describe('tbMoveScore', () => {
  it('reads a winning move reported as loss-for-the-replier as a win for the mover', () => {
    expect(tbMoveScore('loss', -14)).toEqual({ cp: null, mate: 14 });
    expect(tbMoveScore('syzygy-loss', -14)).toEqual({ cp: null, mate: 14 });
  });

  it('reads a move that hands the opponent a win as a loss for the mover', () => {
    expect(tbMoveScore('win', 14)).toEqual({ cp: null, mate: -14 });
    expect(tbMoveScore('syzygy-win', 14)).toEqual({ cp: null, mate: -14 });
  });

  it('treats draws and 50-move-rule categories as drawn from either side', () => {
    expect(tbMoveScore('draw', null)).toEqual({ cp: 0, mate: null });
    expect(tbMoveScore('cursed-win', 30)).toEqual({ cp: 0, mate: null });
    expect(tbMoveScore('blessed-loss', -30)).toEqual({ cp: 0, mate: null });
    expect(tbMoveScore('unknown', null)).toEqual({ cp: 0, mate: null });
  });

  it('falls back to a mate-in-50 sentinel when dtm is null', () => {
    expect(tbMoveScore('loss', null)).toEqual({ cp: null, mate: 50 });
  });

  it('never returns mate 0 for a dtm of 0', () => {
    // mate 0 means "already checkmated" to cpAndMateToWin — it must not be
    // produced by a move that merely mates immediately.
    expect(tbMoveScore('loss', 0)).toEqual({ cp: null, mate: 1 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Cached lines are stored White-relative (Position model convention) and must
// be flipped at the boundary when the mover is Black.
// ────────────────────────────────────────────────────────────────────────────
describe('cachedLineToMoverWin', () => {
  it('flips a White-relative centipawn score for a black mover', () => {
    const line = { eval: { type: 'cp' as const, value: 300 } };
    const white = cachedLineToMoverWin(line, 'w');
    const black = cachedLineToMoverWin(line, 'b');
    expect(white).toBeGreaterThan(0.5);
    expect(black).toBeLessThan(0.5);
    // Win% is symmetric around 0.5, so the two must mirror exactly.
    expect(white + black).toBeCloseTo(1, 12);
  });

  it('flips mate scores too', () => {
    const line = { eval: { type: 'mate' as const, value: 3 } };
    expect(cachedLineToMoverWin(line, 'w')).toBe(1);
    expect(cachedLineToMoverWin(line, 'b')).toBe(0);
  });

  it('accepts the flat scoreType/scoreValue shape', () => {
    expect(cachedLineToMoverWin({ scoreType: 'cp', scoreValue: 0 }, 'w')).toBe(0.5);
    expect(cachedLineToMoverWin({}, 'w')).toBe(0.5);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// F6 — book detection off by one ply.
//
// `fensAlongLine[k]` is the position reached AFTER k plies, and a move at
// plyIndex j is played FROM `fensAlongLine[j]`. With `matchedPlies` confirmed
// theory moves, the book positions are therefore indices 0 .. matchedPlies-1.
// Including index `matchedPlies` labels the FIRST out-of-book move as 'book',
// which removes it from accuracy, rated moves and phase scoring entirely.
// ────────────────────────────────────────────────────────────────────────────
describe('bookFensUpTo', () => {
  const fens = ['startpos', 'after-e4', 'after-e5', 'after-Qh5', 'after-Nc6'];

  it('marks exactly the positions the matched theory moves were played from', () => {
    // ECO matched "e4 e5" → plies 0 and 1 are book; ply 2 (3.Qh5) is not.
    expect([...bookFensUpTo(fens, 2)]).toEqual(['startpos', 'after-e4']);
  });

  it('leaves the first out-of-book move classifiable', () => {
    const book = bookFensUpTo(fens, 2);
    expect(book.has('after-e5')).toBe(false);
  });

  it('returns an empty set when nothing matched', () => {
    expect(bookFensUpTo(fens, 0).size).toBe(0);
  });

  it('never reads past the end of the line', () => {
    expect([...bookFensUpTo(['startpos', 'after-e4'], 9)]).toEqual(['startpos', 'after-e4']);
  });

  it('skips gaps without truncating the rest', () => {
    expect([...bookFensUpTo(['a', undefined, 'c'], 3)]).toEqual(['a', 'c']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// F11 — the eval graph must not assume White moved first.
// ────────────────────────────────────────────────────────────────────────────
describe('whiteCpAfter', () => {
  const move = (overrides: Partial<MoveReview> = {}): MoveReview => ({
    plyIndex: 0,
    san: 'e4',
    uci: 'e2e4',
    classification: 'best',
    evalBefore: 20,
    evalAfter: 120,
    cpl: 0,
    bestMoveUci: 'e2e4',
    bestMoveSan: 'e4',
    bestMoveEval: 20,
    isBookMove: false,
    isBrilliant: false,
    mateBefore: null,
    mateAfter: null,
    pvLine: [],
    complexity: 0,
    reason: '',
    ...overrides,
  });

  it('keeps a white mover\'s eval as-is and flips a black mover\'s', () => {
    expect(whiteCpAfter(move({ plyIndex: 0 }), 'w')).toBe(120);
    expect(whiteCpAfter(move({ plyIndex: 1 }), 'w')).toBe(-120);
  });

  it('attributes even plies to Black in a black-to-move game', () => {
    expect(whiteCpAfter(move({ plyIndex: 0 }), 'b')).toBe(-120);
    expect(whiteCpAfter(move({ plyIndex: 1 }), 'b')).toBe(120);
  });

  it('folds mate to a saturated centipawn value on the right side', () => {
    expect(whiteCpAfter(move({ plyIndex: 0, mateAfter: 4 }), 'w')).toBe(1000);
    expect(whiteCpAfter(move({ plyIndex: 0, mateAfter: -4 }), 'w')).toBe(-1000);
    expect(whiteCpAfter(move({ plyIndex: 0, mateAfter: 4 }), 'b')).toBe(-1000);
  });
});
