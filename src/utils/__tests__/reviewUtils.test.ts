import { describe, it, expect } from 'vitest';
import {
  classifyMove,
  cpAndMateToWin,
  accuracyFromWin,
  accuracyToGameRating,
  playerAccuracy,
  computePhaseBoundaries,
  netMaterialSacrifice,
  isTruePieceSacrifice,
  type ClassifyMoveParams,
} from '../reviewUtils';
import type { MoveReview } from '../../types/review';

// Regression net for the move-classification ladder. These lock the behavior
// fixed across review batches — especially the C3 mate-miss blunder-promotion
// guard (a 'miss' that collapses Win% by blunder magnitude must score 'blunder')
// and the winBefore>0.85 miss path. Pure logic, no engine needed.

function base(overrides: Partial<ClassifyMoveParams> = {}): ClassifyMoveParams {
  return {
    winBefore: 0.5,
    winAfter: 0.5,
    isBookMove: false,
    isBestMove: false,
    isSingularChoice: false,
    isMaterialSacrifice: false,
    deltaWin: 0,
    mateBefore: null,
    mateAfter: null,
    ...overrides,
  };
}

describe('classifyMove — ladder', () => {
  it('book move short-circuits everything', () => {
    expect(classifyMove(base({ isBookMove: true, deltaWin: 0.9 }))).toBe('book');
  });

  it('best move / near-best -> best', () => {
    expect(classifyMove(base({ isBestMove: true }))).toBe('best');
    expect(classifyMove(base({ deltaWin: 0.004 }))).toBe('best');
  });

  it('ΔWin thresholds map to the right rungs', () => {
    expect(classifyMove(base({ deltaWin: 0.02 }))).toBe('excellent');
    expect(classifyMove(base({ deltaWin: 0.05 }))).toBe('good');
    expect(classifyMove(base({ deltaWin: 0.10 }))).toBe('inaccuracy');
    expect(classifyMove(base({ deltaWin: 0.20 }))).toBe('mistake');
    expect(classifyMove(base({ deltaWin: 0.21 }))).toBe('blunder');
  });
});

describe('classifyMove — C3 mate-miss guard (batch-4 regression)', () => {
  it('mate dropped but still clearly winning, small ΔWin -> miss', () => {
    // Mate gone (mateAfter null) but position still winning AND the Win% drop
    // is below blunder magnitude (dw <= 0.20 mistake threshold) -> near-miss.
    const r = classifyMove(base({
      winBefore: 0.7, winAfter: 0.6, deltaWin: 0.10,
      mateBefore: 3, mateAfter: null,
    }));
    expect(r).toBe('miss');
  });

  it('mate kept but slower (>2 ply) and still winning -> miss', () => {
    const r = classifyMove(base({
      winBefore: 1.0, winAfter: 0.95, deltaWin: 0.05,
      mateBefore: 2, mateAfter: 6,
    }));
    expect(r).toBe('miss');
  });

  it('mate thrown away into blunder-magnitude collapse -> blunder, NOT miss', () => {
    // The exact regression: 1.0 -> 0.36, dw 0.64 used to return 'miss'.
    const r = classifyMove(base({
      winBefore: 1.0, winAfter: 0.36, deltaWin: 0.64,
      mateBefore: 4, mateAfter: null,
    }));
    expect(r).toBe('blunder');
  });
});

describe('classifyMove — winBefore>0.85 miss path', () => {
  it('lost winning advantage, moderate drop -> miss', () => {
    expect(classifyMove(base({ winBefore: 0.9, winAfter: 0.55, deltaWin: 0.18 }))).toBe('miss');
  });
  it('lost winning advantage, blunder-magnitude drop -> blunder', () => {
    expect(classifyMove(base({ winBefore: 0.9, winAfter: 0.30, deltaWin: 0.60 }))).toBe('blunder');
  });
});

describe('classifyMove — special cases', () => {
  it('brilliant requires sacrifice + winning result + small ΔWin', () => {
    const r = classifyMove(base({
      winBefore: 0.7, winAfter: 0.7, deltaWin: 0.0,
      isBestMove: true, isMaterialSacrifice: true,
    }));
    expect(r).toBe('brilliant');
  });

  it('great: losing -> winning, singular best', () => {
    const r = classifyMove(base({
      winBefore: 0.15, winAfter: 0.55, deltaWin: 0,
      isBestMove: true, isSingularChoice: true,
    }));
    expect(r).toBe('great');
  });
});

describe('cpAndMateToWin — normalization (mover-relative)', () => {
  it('mate-positive = winning (1.0), mate-negative = lost (0.0)', () => {
    expect(cpAndMateToWin(null, 3)).toBe(1.0);
    expect(cpAndMateToWin(null, -3)).toBe(0.0);
    expect(cpAndMateToWin(null, 0)).toBe(0.0);
  });
  it('cp 0 = 0.5, monotone increasing, bounded (0,1)', () => {
    expect(cpAndMateToWin(0, null)).toBeCloseTo(0.5, 6);
    expect(cpAndMateToWin(100, null)).toBeGreaterThan(0.5);
    expect(cpAndMateToWin(-100, null)).toBeLessThan(0.5);
    expect(cpAndMateToWin(100000, null)).toBeLessThanOrEqual(1.0);
    expect(cpAndMateToWin(-100000, null)).toBeGreaterThanOrEqual(0.0);
  });
});

describe('accuracyToGameRating — complexity factor (Extra 2)', () => {
  const args = [92, 20, 0, 1, 40, 2, 0] as const; // acc, cpl, blun, mist, moves, inacc, miss

  it('is a no-op when complexity is omitted or zero', () => {
    const baseline = accuracyToGameRating(...args);
    expect(accuracyToGameRating(...args, 0)).toBe(baseline);
    expect(accuracyToGameRating(...args, undefined)).toBe(baseline);
  });

  it('rewards the same accuracy more in a sharper game', () => {
    const quiet = accuracyToGameRating(...args, 0.02);
    const sharp = accuracyToGameRating(...args, 0.30);
    expect(quiet).not.toBeNull();
    expect(sharp).not.toBeNull();
    expect(sharp as number).toBeGreaterThan(quiet as number);
  });

  it('stays bounded — sharp high-accuracy game never exceeds the 3000 cap', () => {
    const r = accuracyToGameRating(99, 5, 0, 0, 60, 0, 0, 1.0);
    expect(r).not.toBeNull();
    expect(r as number).toBeLessThanOrEqual(3000);
  });

  it('does not rescue a blunder-ridden game just because it was sharp', () => {
    const r = accuracyToGameRating(45, 200, 6, 4, 40, 5, 3, 0.5) ?? 0;
    expect(r).toBeLessThan(1400);
  });
});

// ── REV-2 / REV-4: weighted game accuracy + unscored exclusion ──────────────
function mr(over: Partial<MoveReview>): MoveReview {
  return {
    plyIndex: 0,
    san: '',
    uci: '',
    classification: 'good',
    evalBefore: 0,
    evalAfter: 0,
    cpl: 0,
    bestMoveUci: '',
    bestMoveSan: '',
    bestMoveEval: 0,
    isBookMove: false,
    isBrilliant: false,
    mateBefore: null,
    mateAfter: null,
    pvLine: [],
    complexity: 0,
    reason: '',
    ...over,
  } as unknown as MoveReview;
}

describe('playerAccuracy — weighted/harmonic blend', () => {
  it('all-book game returns 100 (no rated moves)', () => {
    const moves = [mr({ plyIndex: 0, isBookMove: true }), mr({ plyIndex: 1, isBookMove: true })];
    expect(playerAccuracy(moves, 'white', 'w')).toBe(100);
    expect(playerAccuracy(moves, 'black', 'w')).toBe(100);
  });

  it('a flawless side scores 100', () => {
    // White = even plies. evalBefore === evalAfter → no Win% drop → 100% each.
    const moves = [
      mr({ plyIndex: 0, evalBefore: 20, evalAfter: 20 }),
      mr({ plyIndex: 1, evalBefore: -10, evalAfter: -10 }),
      mr({ plyIndex: 2, evalBefore: 25, evalAfter: 25 }),
    ];
    expect(playerAccuracy(moves, 'white', 'w')).toBe(100);
  });

  it('excludePlyIndices (REV-4) lifts accuracy by dropping an unscored blunder', () => {
    const moves = [
      mr({ plyIndex: 0, evalBefore: 300, evalAfter: -300 }), // white blunder
      mr({ plyIndex: 1, evalBefore: 0, evalAfter: 0 }),
      mr({ plyIndex: 2, evalBefore: 20, evalAfter: 20 }),    // white flawless
      mr({ plyIndex: 3, evalBefore: 0, evalAfter: 0 }),
    ];
    const included = playerAccuracy(moves, 'white', 'w');
    const excluded = playerAccuracy(moves, 'white', 'w', new Set([0]));
    expect(excluded).toBeGreaterThan(included);
    expect(excluded).toBe(100); // only remaining white move is flawless
  });
});

describe('computePhaseBoundaries — Divider port', () => {
  it('pure opening (startpos) sets no middlegame trigger', () => {
    const startpos = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const fens = Array.from({ length: 10 }, () => startpos);
    const { openingEndsAtPly } = computePhaseBoundaries(fens);
    expect(openingEndsAtPly).toBe(Math.min(fens.length - 1, 20));
  });

  it('a bare K+P endgame triggers the endgame from ply 0', () => {
    const eg = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'; // 0 majors/minors
    const { openingEndsAtPly, middlegameEndsAtPly } = computePhaseBoundaries([eg, eg]);
    expect(openingEndsAtPly).toBe(0);
    expect(middlegameEndsAtPly).toBeGreaterThanOrEqual(openingEndsAtPly);
  });
});

describe('netMaterialSacrifice / isTruePieceSacrifice', () => {
  it('a quiet pawn push is not a sacrifice', () => {
    const before = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    const after = '4k3/8/8/4P3/8/8/8/4K3 b - - 0 1';
    expect(netMaterialSacrifice(before, after)).toBe(0);
    expect(isTruePieceSacrifice(before, after)).toBe(false);
  });

  it('a promotion is NOT a sacrifice (mover gains material → negative loss)', () => {
    const before = '8/4P3/8/8/8/8/8/4K1k1 w - - 0 1';
    const after = '4Q3/8/8/8/8/8/8/4K1k1 b - - 0 1';
    expect(netMaterialSacrifice(before, after)).toBeLessThan(0);
    expect(isTruePieceSacrifice(before, after)).toBe(false);
  });

  it('giving up a knight for nothing is a true piece sacrifice', () => {
    const before = '4k3/8/8/8/8/5N2/8/4K3 w - - 0 1';
    const after = '4k3/8/8/8/8/8/8/4K3 b - - 0 1';
    expect(netMaterialSacrifice(before, after)).toBe(3);
    expect(isTruePieceSacrifice(before, after)).toBe(true);
  });
});

describe('cpAndMateToWin / accuracyFromWin — reference values', () => {
  it('matches the Lichess Win% at 100cp (~59.1%)', () => {
    expect(cpAndMateToWin(100, null)).toBeCloseTo(0.5911, 3);
  });

  it('accuracyFromWin short-circuits to 100 when no Win% was lost', () => {
    expect(accuracyFromWin(0.6, 0.6)).toBe(100);
    expect(accuracyFromWin(0.6, 0.7)).toBe(100);
  });

  it('accuracyFromWin clamps a catastrophic drop into [0,100]', () => {
    const a = accuracyFromWin(1.0, 0.0);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(5);
  });
});

describe('classifyMove — Brilliant chess.com guards', () => {
  it('not brilliant when already winning (winBefore >= 0.85)', () => {
    const r = classifyMove(base({
      winBefore: 0.9, winAfter: 0.9, deltaWin: 0,
      isBestMove: true, isMaterialSacrifice: true,
    }));
    expect(r).not.toBe('brilliant');
  });

  it('a sacrifice that loses the game is not brilliant', () => {
    const r = classifyMove(base({
      winBefore: 0.7, winAfter: 0.4, deltaWin: 0.3,
      isBestMove: true, isMaterialSacrifice: true,
    }));
    expect(r).not.toBe('brilliant');
  });
});
