import { describe, it, expect } from 'vitest';
import { gameReviewResultSchema } from './zodSchemas';

// Frontend counterpart lives in frontend/src/types/review.ts (ALL_CLASSIFICATIONS).
// Keep this list in sync — the parity test below is the guard.
const EXPECTED_CLASSIFICATIONS = [
  'brilliant', 'great', 'book', 'forced', 'best', 'excellent',
  'good', 'inaccuracy', 'mistake', 'miss', 'blunder',
] as const;

function moveReview(classification: string) {
  return {
    plyIndex: 0,
    san: 'e4',
    uci: 'e2e4',
    classification,
    evalBefore: 20,
    evalAfter: 20,
    cpl: 0,
    bestMoveUci: 'e2e4',
    bestMoveSan: 'e4',
    bestMoveEval: 20,
    isBookMove: false,
    isBrilliant: false,
    mateBefore: null,
    mateAfter: null,
    pvLine: ['e2e4'],
  };
}

function playerReview() {
  return {
    color: 'white',
    accuracy: 100,
    counts: Object.fromEntries(EXPECTED_CLASSIFICATIONS.map((k) => [k, 0])),
    gameRating: null,
    phaseReviews: [
      { label: 'Opening', accuracy: 100, icon: 'none' },
      { label: 'Middlegame', accuracy: 0, icon: 'none' },
      { label: 'Endgame', accuracy: 0, icon: 'none' },
    ],
  };
}

function reviewResult(classification: string) {
  return {
    moveReviews: [moveReview(classification)],
    white: { ...playerReview(), color: 'white' },
    black: { ...playerReview(), color: 'black' },
    reviewDepth: 14,
    engineVersion: 'sf18-lite',
    reviewedAt: new Date().toISOString(),
    openingName: null,
    ecoCode: null,
  };
}

describe('gameReviewResultSchema classification parity', () => {
  it.each(EXPECTED_CLASSIFICATIONS)('accepts classification %s', (c) => {
    const parsed = gameReviewResultSchema.safeParse(reviewResult(c));
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown classification', () => {
    const parsed = gameReviewResultSchema.safeParse(reviewResult('galaxy-brain'));
    expect(parsed.success).toBe(false);
  });
});
