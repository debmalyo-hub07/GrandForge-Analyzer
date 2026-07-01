import { describe, expect, it } from 'vitest';
import {
  accuracyToGameRating,
  classifyMove,
  gameRatingConfidence,
  phaseSummary,
} from './reviewUtils';
import type { MoveReview } from '../types/review';

const baseMove = (overrides: Partial<MoveReview> = {}): MoveReview => ({
  plyIndex: 0,
  san: 'Nf3',
  uci: 'g1f3',
  classification: 'best',
  evalBefore: 80,
  evalAfter: 72,
  cpl: 8,
  bestMoveUci: 'g1f3',
  bestMoveSan: 'Nf3',
  bestMoveEval: 80,
  isBookMove: false,
  isBrilliant: false,
  mateBefore: null,
  mateAfter: null,
  pvLine: [],
  complexity: 0.02,
  reason: '',
  ...overrides,
});

describe('classifyMove rating-aware special classifications', () => {
  it('allows a strong practical sacrifice to be brilliant for club-level players', () => {
    const classification = classifyMove({
      winBefore: 0.42,
      winAfter: 0.63,
      isBookMove: false,
      isBestMove: false,
      isSingularChoice: false,
      isMaterialSacrifice: true,
      deltaWin: 0.012,
      playerRating: 1200,
    });

    expect(classification).toBe('brilliant');
  });

  it('keeps the same non-forcing sacrifice below brilliant at master strength', () => {
    const classification = classifyMove({
      winBefore: 0.42,
      winAfter: 0.63,
      isBookMove: false,
      isBestMove: false,
      isSingularChoice: false,
      isMaterialSacrifice: true,
      deltaWin: 0.012,
      playerRating: 2400,
    });

    expect(classification).toBe('excellent');
  });

  it('recognizes near-best singular turnarounds as great moves', () => {
    const classification = classifyMove({
      winBefore: 0.31,
      winAfter: 0.55,
      isBookMove: false,
      isBestMove: false,
      isSingularChoice: true,
      isMaterialSacrifice: false,
      deltaWin: 0.004,
      playerRating: 1800,
    });

    expect(classification).toBe('great');
  });
});

describe('gameRatingConfidence', () => {
  it('labels single-game rating confidence from rated move counts', () => {
    expect(gameRatingConfidence(2)).toBe('none');
    expect(gameRatingConfidence(4)).toBe('provisional');
    expect(gameRatingConfidence(9)).toBe('low');
    expect(gameRatingConfidence(24)).toBe('medium');
    expect(gameRatingConfidence(25)).toBe('high');
  });

  it('keeps game rating unavailable for very short games', () => {
    expect(accuracyToGameRating(92, 8, 0, 0, 2)).toBeNull();
  });

  it('returns a provisional game rating once a side has three rated moves', () => {
    expect(accuracyToGameRating(92, 8, 0, 0, 3)).not.toBeNull();
    expect(gameRatingConfidence(3)).toBe('provisional');
  });
});

describe('phaseSummary', () => {
  it('reports rated move count, average CPL, and representative icon', () => {
    const summary = phaseSummary([
      baseMove({ cpl: 12, classification: 'excellent' }),
      baseMove({
        plyIndex: 2,
        cpl: 58,
        classification: 'inaccuracy',
        evalBefore: 200,
        evalAfter: 90,
      }),
      baseMove({ plyIndex: 4, cpl: 0, classification: 'book', isBookMove: true }),
    ]);

    expect(summary.moveCount).toBe(2);
    expect(summary.avgCpl).toBe(35);
    expect(summary.accuracy).toBeGreaterThan(80);
    expect(summary.icon).toBe('excellent');
  });
});
