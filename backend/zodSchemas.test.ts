import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  ENGINE_VERSION_VALUES,
  engineVersionSchema,
  gameReviewResultSchema,
} from './zodSchemas';

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

describe('engine version enum', () => {
  it('is the four builds that exist on disk', () => {
    expect([...ENGINE_VERSION_VALUES]).toEqual(['sf18-lite', 'sf18-lite-mt', 'sf17-lite', 'sf16-lite']);
  });

  it('accepts the multi-threaded build and rejects the dropped full build', () => {
    expect(engineVersionSchema.safeParse('sf18-lite-mt').success).toBe(true);
    expect(engineVersionSchema.safeParse('sf18-full').success).toBe(false);
  });

  // The four consumers below must derive from ENGINE_VERSION_VALUES rather than
  // re-inlining a literal list — that drift is what made `sf18-lite-mt` users a
  // permanent cache miss while `sf18-full` stayed writable (data-audit §2c).
  // Matching on the quoted form so prose mentioning the dropped build is fine.
  it.each([
    'zodSchemas.ts',
    'routes/positions/cache.ts',
    'routes/positions/eval.ts',
    'routes/auth/preferences.ts',
    'models/User.ts',
  ])('%s carries no hardcoded engine-version list', (relPath) => {
    const source = readFileSync(join(__dirname, relPath), 'utf8');
    expect(source).not.toContain("'sf18-full'");
    if (relPath !== 'zodSchemas.ts') {
      expect(source).toContain('ENGINE_VERSION_VALUES');
    }
  });
});

describe('gameReviewResultSchema line identity', () => {
  it('round-trips reviewedNodeIds, reviewedPathKey and reviewedLineUciKey', () => {
    const input = {
      ...reviewResult('best'),
      reviewedNodeIds: ['root', 'n1', 'n2'],
      reviewedPathKey: 'root/n1/n2',
      reviewedLineUciKey: 'e2e4 e7e5',
    };
    const parsed = gameReviewResultSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.reviewedNodeIds).toEqual(['root', 'n1', 'n2']);
    expect(parsed.success && parsed.data.reviewedPathKey).toBe('root/n1/n2');
    expect(parsed.success && parsed.data.reviewedLineUciKey).toBe('e2e4 e7e5');
  });

  it('still accepts a legacy result with no line identity', () => {
    const parsed = gameReviewResultSchema.safeParse(reviewResult('best'));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.reviewedNodeIds).toBeUndefined();
  });

  it('bounds moveReviews and reviewedNodeIds at 600 entries', () => {
    const base = reviewResult('best');
    const tooManyMoves = { ...base, moveReviews: Array.from({ length: 601 }, () => moveReview('best')) };
    expect(gameReviewResultSchema.safeParse(tooManyMoves).success).toBe(false);

    const tooManyNodes = { ...base, reviewedNodeIds: Array.from({ length: 601 }, (_, i) => `n${i}`) };
    expect(gameReviewResultSchema.safeParse(tooManyNodes).success).toBe(false);
  });
});
