import { describe, expect, it } from 'vitest';
import {
  accuracyFromWin,
  accuracyToGameRating,
  classifyMove,
  computePhaseBoundaries,
  cpAndMateToWin,
  gameRatingConfidence,
  isTruePieceSacrifice,
  netMaterialSacrifice,
  phaseSummary,
  playerAccuracy,
  summarizeEvalSources,
} from './reviewUtils';
import type { MoveReview } from '../types/review';

// White-relative centipawn evaluation of each position along a 6-ply fixture
// game: index k is the position after k plies.
const SERIES_CP = [20, 15, 40, 10, -30, 5, 60];

// Pinned playerAccuracy outputs for that fixture (see the describe block below).
// All six were re-derived after the F8 interleaved-window rewrite.
const PIN_ACC_W_WHITE = 95.7;
const PIN_ACC_W_BLACK = 89.6;
const PIN_ACC_B_WHITE = 95;
const PIN_ACC_B_BLACK = 95.4;
const PIN_ACC_EXCLUDED = 99.6;
const PIN_ACC_FORCED = 99.6;

/**
 * Build a dense `MoveReview[]` from `SERIES_CP`. `evalBefore`/`evalAfter` are
 * mover-relative (the MoveReview contract), so they are flipped on the plies
 * the given colour did not move.
 */
function fixtureMoves(
  startingColor: 'w' | 'b' = 'w',
  overrides: Record<number, Partial<MoveReview>> = {},
): MoveReview[] {
  const moves: MoveReview[] = [];
  for (let i = 0; i < SERIES_CP.length - 1; i++) {
    const moverIsWhite = startingColor === 'w' ? i % 2 === 0 : i % 2 !== 0;
    const before = moverIsWhite ? SERIES_CP[i] : -SERIES_CP[i];
    const after = moverIsWhite ? SERIES_CP[i + 1] : -SERIES_CP[i + 1];
    moves.push({
      plyIndex: i,
      san: `m${i}`,
      uci: 'e2e4',
      classification: 'good',
      evalBefore: before,
      evalAfter: after,
      cpl: Math.max(0, before - after),
      bestMoveUci: 'e2e4',
      bestMoveSan: 'e4',
      bestMoveEval: before,
      isBookMove: false,
      isBrilliant: false,
      mateBefore: null,
      mateAfter: null,
      pvLine: [],
      complexity: 0,
      reason: '',
      ...overrides[i],
    });
  }
  return moves;
}

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

describe('classifyMove forced moves', () => {
  it('classifies the only legal move as forced regardless of outcome', () => {
    const classification = classifyMove({
      winBefore: 0.3,
      winAfter: 0.1,
      isBookMove: false,
      isBestMove: true,
      isSingularChoice: false,
      isMaterialSacrifice: false,
      isForced: true,
    });

    expect(classification).toBe('forced');
  });

  it('book beats forced when both apply', () => {
    const classification = classifyMove({
      winBefore: 0.5,
      winAfter: 0.5,
      isBookMove: true,
      isBestMove: true,
      isSingularChoice: false,
      isMaterialSacrifice: false,
      isForced: true,
    });

    expect(classification).toBe('book');
  });

  it('does not mark moves forced when isForced is absent', () => {
    const classification = classifyMove({
      winBefore: 0.5,
      winAfter: 0.5,
      isBookMove: false,
      isBestMove: true,
      isSingularChoice: false,
      isMaterialSacrifice: false,
    });

    expect(classification).toBe('best');
  });
});

describe('classifyMove rating-aware special classifications', () => {
  // ΔWin is derived from winBefore/winAfter (F5), so these fixtures encode the
  // drop in the win values: 0.635 → 0.62 is a ~0.015 ΔWin, which sits between
  // the club (0.018) and master (0.005) brilliance tolerances.
  const sacrifice = {
    winBefore: 0.635,
    winAfter: 0.62,
    isBookMove: false,
    isBestMove: false,
    isSingularChoice: false,
    isMaterialSacrifice: true,
  };

  it('allows a strong practical sacrifice to be brilliant for club-level players', () => {
    expect(classifyMove({ ...sacrifice, playerRating: 1200 })).toBe('brilliant');
  });

  it('keeps the same non-forcing sacrifice below brilliant at master strength', () => {
    expect(classifyMove({ ...sacrifice, playerRating: 2400 })).toBe('excellent');
  });

  it('recognizes near-best singular turnarounds as great moves', () => {
    const classification = classifyMove({
      winBefore: 0.31,
      winAfter: 0.55,
      isBookMove: false,
      isBestMove: false,
      isSingularChoice: true,
      isMaterialSacrifice: false,
      playerRating: 1800,
    });

    expect(classification).toBe('great');
  });

  it('grants Great at every rating band inside the swing gates', () => {
    // Documented consequence of F5: the swing gates all require
    // winAfter > winBefore, so derived ΔWin is 0 there and greatDropLimit is
    // satisfied for every band. isSingularChoice + the swing gates are the only
    // live discriminators. Pinned so a future re-tune has to face this.
    for (const playerRating of [800, 1200, 1800, 2300, 2700]) {
      expect(
        classifyMove({
          winBefore: 0.15,
          winAfter: 0.55,
          isBookMove: false,
          isBestMove: false,
          isSingularChoice: true,
          isMaterialSacrifice: false,
          playerRating,
        }),
      ).toBe('great');
    }
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
    // regression pin, derived 2026-07-29 — an exact value, so gutting the CAPS
    // cubic or the confidence blend can no longer keep this test green.
    expect(accuracyToGameRating(92, 8, 0, 0, 3)).toBe(1342);
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
    // regression pin, derived 2026-07-29 — exact, so ACC_A/ACC_K/ACC_B drift shows up.
    expect(summary.accuracy).toBe(82.1);
    expect(summary.icon).toBe('excellent');
  });

  it('excludes forced and unscored plies from phase scoring', () => {
    const summary = phaseSummary([
      baseMove({ cpl: 12, classification: 'excellent' }),
      baseMove({ plyIndex: 1, cpl: 400, classification: 'forced' }),
      baseMove({ plyIndex: 2, cpl: 400, classification: 'blunder', unscored: true }),
    ]);

    expect(summary.moveCount).toBe(1);
    expect(summary.avgCpl).toBe(12);
  });
});

describe('classification parity', () => {
  it('ALL_CLASSIFICATIONS has 11 members including forced', async () => {
    const { ALL_CLASSIFICATIONS } = await import('../types/review');
    expect(ALL_CLASSIFICATIONS).toHaveLength(11);
    expect(ALL_CLASSIFICATIONS).toContain('forced');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// F1 — Brilliant reachability. `isTruePieceSacrifice` is the sole gate for the
// Brilliant label, so a detector that can never fire makes Brilliant dead.
// Every FEN below is a real, legal position; the second argument is the UCI of
// the move under test.
// ────────────────────────────────────────────────────────────────────────────
describe('isTruePieceSacrifice', () => {
  // Nc3-d5 walks into exd5 with no recapture: a whole knight for nothing.
  const KNIGHT_SAC = 'r1bqkb1r/pppp1ppp/2n1p3/8/8/2N2N2/PPPP1PPP/R1BQKB1R w - - 0 1';
  // Greek-gift Bxh7+: bishop (3) for a pawn (1), King recaptures.
  const GREEK_GIFT = 'rn1q1rk1/ppp2ppp/4p3/3p4/3P4/3B1N2/PPP2PPP/RNBQ1RK1 w - - 0 1';
  // Queen's Gambit c4: a single pawn offered — a gambit, not a piece sacrifice.
  const PAWN_GAMBIT = 'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w - - 0 2';
  // b7-b8=Q into Rxb8: the queen is lost but only a pawn was invested.
  const PROMOTION = 'r6k/1P5p/8/8/8/8/8/6K1 w - - 0 1';
  // Bxc6 bxc6 — an even trade, nothing is given up.
  const EVEN_TRADE = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w - - 0 1';

  it('detects a knight sacrificed for nothing', () => {
    expect(netMaterialSacrifice(KNIGHT_SAC, 'c3d5')).toBe(3);
    expect(isTruePieceSacrifice(KNIGHT_SAC, 'c3d5')).toBe(true);
  });

  it('detects a Greek-gift bishop sacrifice for a pawn', () => {
    expect(netMaterialSacrifice(GREEK_GIFT, 'd3h7')).toBe(2);
    expect(isTruePieceSacrifice(GREEK_GIFT, 'd3h7')).toBe(true);
  });

  it('does not treat a single-pawn gambit as a piece sacrifice', () => {
    expect(netMaterialSacrifice(PAWN_GAMBIT, 'c2c4')).toBe(1);
    expect(isTruePieceSacrifice(PAWN_GAMBIT, 'c2c4')).toBe(false);
  });

  it('does not treat a promotion whose new queen is captured as a sacrifice', () => {
    // Only the pawn was ever invested, so the net spend is 1, not 9.
    expect(netMaterialSacrifice(PROMOTION, 'b7b8q')).toBe(1);
    expect(isTruePieceSacrifice(PROMOTION, 'b7b8q')).toBe(false);
  });

  it('does not treat an even exchange as a sacrifice', () => {
    expect(netMaterialSacrifice(EVEN_TRADE, 'b5c6')).toBe(0);
    expect(isTruePieceSacrifice(EVEN_TRADE, 'b5c6')).toBe(false);
  });

  it('returns 0 for an unparseable position or illegal move', () => {
    expect(netMaterialSacrifice('not a fen', 'e2e4')).toBe(0);
    expect(netMaterialSacrifice(KNIGHT_SAC, 'a1a8')).toBe(0);
    expect(netMaterialSacrifice(KNIGHT_SAC, '')).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ΔWin ladder — the six rungs at their exact boundaries. ΔWin is derived from
// winBefore/winAfter inside classifyMove (F5), so the fixture uses
// winAfter = 0 to make `winBefore - winAfter` exactly the intended value:
// 0.5 - 0.495 is 0.005000000000000004 in IEEE-754 and would cross the rung.
// ────────────────────────────────────────────────────────────────────────────
describe('classifyMove ΔWin ladder', () => {
  const ladder = (dw: number) =>
    classifyMove({
      winBefore: dw,
      winAfter: 0,
      isBookMove: false,
      isBestMove: false,
      isSingularChoice: false,
      isMaterialSacrifice: false,
    });

  it.each([
    [0.005, 'best'],
    [0.02, 'excellent'],
    [0.05, 'good'],
    [0.1, 'inaccuracy'],
    [0.2, 'mistake'],
    [0.201, 'blunder'],
  ])('ΔWin %f classifies as %s', (dw, expected) => {
    expect(ladder(dw as number)).toBe(expected);
  });

  it('treats the engine top move as best regardless of ΔWin', () => {
    expect(
      classifyMove({
        winBefore: 0.6,
        winAfter: 0.2,
        isBookMove: false,
        isBestMove: true,
        isSingularChoice: false,
        isMaterialSacrifice: false,
      }),
    ).toBe('best');
  });
});

describe('classifyMove miss vs blunder', () => {
  const base = {
    isBookMove: false,
    isBestMove: false,
    isSingularChoice: false,
    isMaterialSacrifice: false,
  };

  it('discriminates on the resulting position, not the size of the drop', () => {
    // Both drops are far past the blunder threshold (>0.20); only winAfter differs.
    expect(classifyMove({ ...base, winBefore: 0.9, winAfter: 0.5 })).toBe('miss');
    expect(classifyMove({ ...base, winBefore: 0.9, winAfter: 0.3 })).toBe('blunder');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// F4 — forced-mate horizon. A fixed-depth search routinely reports `mate N`
// before a move and a plain cp score after it, simply because the remaining
// mate has slipped past the horizon. That must not be read as "you missed a
// forced win", least of all on the engine's own top move.
// ────────────────────────────────────────────────────────────────────────────
describe('classifyMove at the forced-mate horizon', () => {
  const base = {
    isBookMove: false,
    isSingularChoice: false,
    isMaterialSacrifice: false,
  };

  it('does not call the engine top move a miss when the mate slips past the horizon', () => {
    expect(
      classifyMove({
        ...base,
        isBestMove: true,
        winBefore: 1.0,
        winAfter: 0.99,
        mateBefore: 8,
        mateAfter: null,
      }),
    ).toBe('best');
  });

  it('does not call a mate report dropping to a still-winning cp score a miss', () => {
    expect(
      classifyMove({
        ...base,
        isBestMove: false,
        winBefore: 1.0,
        winAfter: 0.99,
        mateBefore: 8,
        mateAfter: null,
      }),
    ).toBe('excellent');
  });

  it('still reports a miss when dropping the mate actually costs Win%', () => {
    expect(
      classifyMove({
        ...base,
        isBestMove: false,
        winBefore: 1.0,
        winAfter: 0.85,
        mateBefore: 5,
        mateAfter: null,
      }),
    ).toBe('miss');
  });

  it('still reports a miss when a non-best move pushes the mate more than 2 plies out', () => {
    expect(
      classifyMove({
        ...base,
        isBestMove: false,
        winBefore: 1.0,
        winAfter: 1.0,
        mateBefore: 3,
        mateAfter: 8,
      }),
    ).toBe('miss');
  });

  it('never penalises the engine top move for a slower mate', () => {
    expect(
      classifyMove({
        ...base,
        isBestMove: true,
        winBefore: 1.0,
        winAfter: 1.0,
        mateBefore: 3,
        mateAfter: 8,
      }),
    ).toBe('best');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Regression pins. Values below were derived by executing the functions once
// and hard-coding the output — they lock behaviour, they do not independently
// re-derive it. Marked individually where a fix in this pass moved the number.
// ════════════════════════════════════════════════════════════════════════════

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// King + rook vs king: majors+minors is 1, so both the middlegame (≤10) and the
// endgame (≤6) conditions fire on the very same board.
const KR_ENDGAME_FEN = '8/8/4k3/8/8/3K4/8/4R3 w - - 0 1';

describe('cpAndMateToWin / accuracyFromWin', () => {
  it('anchors the Win% sigmoid', () => {
    expect(cpAndMateToWin(0, null)).toBe(0.5);
    expect(cpAndMateToWin(100, null)).toBeCloseTo(0.5910258971916129, 15);
    // A cp score is symmetric around 0.5.
    expect(cpAndMateToWin(100, null) + cpAndMateToWin(-100, null)).toBeCloseTo(1, 12);
  });

  it('bypasses the sigmoid for forced mate, including mate 0', () => {
    expect(cpAndMateToWin(null, 3)).toBe(1.0);
    expect(cpAndMateToWin(null, -3)).toBe(0.0);
    // mate 0 = the mover is already checkmated, not a win.
    expect(cpAndMateToWin(null, 0)).toBe(0.0);
  });

  it('never penalises a move that improved the position', () => {
    expect(accuracyFromWin(0.5, 0.6)).toBe(100);
    expect(accuracyFromWin(0.5, 0.5)).toBe(100);
  });

  it('applies the Lichess accuracy curve to a real drop', () => {
    // regression pin, derived 2026-07-29
    expect(accuracyFromWin(0.6, 0.5)).toBeCloseTo(64.5798284537207, 10);
  });
});

describe('accuracyToGameRating', () => {
  it('pins the CAPS cubic plus penalty blend', () => {
    // regression pin, derived 2026-07-29
    expect(accuracyToGameRating(90, 20, 0, 0, 30)).toBe(1993);
  });

  it('keeps avgComplexity = 0 byte-identical to the pre-complexity result', () => {
    const withoutComplexity = accuracyToGameRating(90, 20, 0, 0, 30, 0, 0);
    expect(accuracyToGameRating(90, 20, 0, 0, 30, 0, 0, 0)).toBe(withoutComplexity);
    expect(accuracyToGameRating(90, 20, 0, 0, 30, 0, 0, undefined)).toBe(withoutComplexity);
  });

  it('rewards sustained accuracy in sharp positions', () => {
    // regression pin, derived 2026-07-29 — complexity 0.5 is the clamp ceiling.
    expect(accuracyToGameRating(90, 20, 0, 0, 30, 0, 0, 0.5)).toBe(2128);
  });
});

describe('computePhaseBoundaries', () => {
  it('does not collapse the opening on the starting position', () => {
    // mixedness(startpos) must stay ≤ 150 — the `6 - yTop` mis-transcription
    // made it score above the threshold and reported ply 0 as the middlegame.
    const { openingEndsAtPly } = computePhaseBoundaries([START_FEN, START_FEN, START_FEN]);
    expect(openingEndsAtPly).toBe(2);
  });

  it('keeps the endgame when middlegame and endgame trigger on the same ply', () => {
    // F9: scalachess drops the MIDDLEGAME in this collision; the port used to
    // drop the endgame instead, so a 50-ply rook ending read as "Middlegame"
    // and the Endgame row showed "No rated moves".
    const boundaries = computePhaseBoundaries([
      START_FEN, KR_ENDGAME_FEN, KR_ENDGAME_FEN, KR_ENDGAME_FEN,
    ]);
    expect(boundaries).toEqual({ openingEndsAtPly: 1, middlegameEndsAtPly: 1 });
  });

  it('treats a game that never leaves the opening as all opening', () => {
    // Upstream `openingSize = middle | plies` — no invented 20-ply cap.
    const boundaries = computePhaseBoundaries(new Array(30).fill(START_FEN));
    expect(boundaries).toEqual({ openingEndsAtPly: 29, middlegameEndsAtPly: 29 });
  });
});

describe('playerAccuracy', () => {
  it('pins the weighted + harmonic blend for both colours', () => {
    // regression pin, derived 2026-07-29 (post-F8 interleaved windows)
    expect(playerAccuracy(fixtureMoves('w'), 'white', 'w')).toBe(PIN_ACC_W_WHITE);
    expect(playerAccuracy(fixtureMoves('w'), 'black', 'w')).toBe(PIN_ACC_W_BLACK);
  });

  it('attributes even plies to Black when Black starts', () => {
    // Same underlying eval series, colours swapped: Black now owns plies 0/2/4.
    expect(playerAccuracy(fixtureMoves('b'), 'black', 'b')).toBe(PIN_ACC_B_BLACK);
    expect(playerAccuracy(fixtureMoves('b'), 'white', 'b')).toBe(PIN_ACC_B_WHITE);
  });

  it('drops excluded plies from the accuracy terms', () => {
    // regression pin, derived 2026-07-29
    expect(playerAccuracy(fixtureMoves('w'), 'white', 'w', new Set([2]))).toBe(PIN_ACC_EXCLUDED);
  });

  it('treats forced and book moves alike — neither is rated', () => {
    const forced = playerAccuracy(fixtureMoves('w', { 2: { classification: 'forced' } }), 'white', 'w');
    const book = playerAccuracy(
      fixtureMoves('w', { 2: { isBookMove: true, classification: 'book' } }),
      'white',
      'w',
    );
    expect(forced).toBe(book);
    // regression pin, derived 2026-07-29
    expect(forced).toBe(PIN_ACC_FORCED);
  });

  it('attributes plies to a colour by plyIndex, not by array position', () => {
    // Every White move here is an improvement (accuracy 100) and every Black
    // move is a collapse. Dropping one Black ply from the array must not shift
    // the parity of the plies after it — with index-based attribution White
    // would inherit ply 3 and ply 5 and stop scoring 100.
    const moves: MoveReview[] = [];
    for (let i = 0; i < 6; i++) {
      const white = i % 2 === 0;
      const magnitude = 20 + i * 200;
      moves.push({
        ...baseMove({ plyIndex: i }),
        evalBefore: white ? magnitude : -magnitude,
        evalAfter: white ? magnitude + 50 : -(magnitude + 400),
      });
    }
    const sparse = moves.filter((m) => m.plyIndex !== 1);

    expect(playerAccuracy(moves, 'white', 'w')).toBe(100);
    expect(playerAccuracy(sparse, 'white', 'w')).toBe(100);
    expect(playerAccuracy(sparse, 'black', 'w')).toBeLessThan(100);
  });
});

describe('summarizeEvalSources', () => {
  const template = fixtureMoves()[0];
  const withSources = (sources: Array<MoveReview['evalSource']>): MoveReview[] =>
    sources.map((evalSource, i) => ({ ...template, plyIndex: i, evalSource }));

  it('counts each source and totals the assisted ones', () => {
    const s = summarizeEvalSources(withSources(['cache', 'cache', 'tablebase', 'engine']));
    expect(s).toMatchObject({ cache: 2, tablebase: 1, engine: 1, unknown: 0, assisted: 3, total: 4 });
  });

  it('reports nothing rather than everything for a review saved before the field existed', () => {
    // Counting an absent source as `engine` would claim an old review did all its
    // own work — plausible, unverifiable, and wrong for the ones that hit the cache.
    const s = summarizeEvalSources(withSources([undefined, undefined]));
    expect(s).toMatchObject({ unknown: 2, engine: 0, assisted: 0, total: 2 });
  });

  it('is empty-safe', () => {
    expect(summarizeEvalSources([])).toMatchObject({ assisted: 0, total: 0 });
  });

  it('leaves the badge hidden when every position was searched locally', () => {
    expect(summarizeEvalSources(withSources(['engine', 'engine'])).assisted).toBe(0);
  });
});
