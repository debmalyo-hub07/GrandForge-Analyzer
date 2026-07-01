import { describe, expect, it } from 'vitest';
import { getReviewForNode } from './ReviewMoveGlyph';
import type { GameReviewResult, MoveReview, PlayerReview } from '../../types/review';

const moveReview: MoveReview = {
  plyIndex: 2,
  san: 'Bc4',
  uci: 'f1c4',
  classification: 'great',
  evalBefore: 42,
  evalAfter: 45,
  cpl: 0,
  bestMoveUci: 'f1c4',
  bestMoveSan: 'Bc4',
  bestMoveEval: 42,
  isBookMove: false,
  isBrilliant: false,
  mateBefore: null,
  mateAfter: null,
  pvLine: ['f1c4'],
  complexity: 0.08,
  reason: 'Best move on the reviewed variation.',
};

const playerReview: PlayerReview = {
  color: 'white',
  accuracy: 100,
  counts: {
    brilliant: 0,
    great: 1,
    book: 0,
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    miss: 0,
    blunder: 0,
  },
  gameRating: null,
  gameRatingConfidence: 'none',
  phaseReviews: [
    { label: 'Opening', accuracy: 100, icon: 'great', moveCount: 1, avgCpl: 0 },
    { label: 'Middlegame', accuracy: 0, icon: 'none', moveCount: 0, avgCpl: null },
    { label: 'Endgame', accuracy: 0, icon: 'none', moveCount: 0, avgCpl: null },
  ],
};

function resultWithPath(reviewedNodeIds?: string[]): GameReviewResult {
  return {
    moveReviews: [moveReview],
    white: playerReview,
    black: { ...playerReview, color: 'black' },
    reviewDepth: 18,
    engineVersion: 'test',
    reviewedAt: '2026-07-01T00:00:00.000Z',
    openingName: null,
    ecoCode: null,
    reviewedNodeIds,
    reviewedPathKey: reviewedNodeIds?.join('/'),
    reviewedLineUciKey: 'e2e4 e7e5 f1c4',
  };
}

describe('getReviewForNode', () => {
  it('only returns a review for the node on the reviewed path', () => {
    const result = resultWithPath(['root', 'first', 'second', 'variation-third']);

    expect(getReviewForNode(result, 'mainline-third', 2, true)).toBeNull();
    expect(getReviewForNode(result, 'variation-third', 2, false)?.uci).toBe('f1c4');
  });

  it('keeps legacy unscoped reviews off variation nodes', () => {
    const result = resultWithPath(undefined);

    expect(getReviewForNode(result, 'variation-third', 2, false)).toBeNull();
    expect(getReviewForNode(result, 'mainline-third', 2, true)?.uci).toBe('f1c4');
  });
});
