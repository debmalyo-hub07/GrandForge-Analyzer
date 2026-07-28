import { Chess } from 'chess.js';
import type { MoveClassification, MoveReview, RatingConfidence } from '../types/review';

// ════════════════════════════════════════════════════════════════════════════
// PHASE 3 — EXPECTED POINTS (WIN PROBABILITY) MODEL
//
// Implements the exact mathematical translation used by Lichess and Chess.com.
//
//   1) Centipawns → Win Probability (0..1):
//        Win% = 0.5 + 0.5 * (2 / (1 + e^(-0.00368208 * cp)) - 1)
//
//   2) Forced mate bypass:
//        score mate +N → Win% = 1.0  (mover has forced mate)
//        score mate -N → Win% = 0.0  (mover gets mated)
//
//   3) Single-move accuracy:
//        ΔWin = winBefore - winAfter   (0..1 scale)
//        Acc% = 103.1668 * exp(-0.04354 * (ΔWin * 100)) - 3.1669 + 1
//        ( +1 = Lichess "uncertainty bonus" — see ACC_UNCERTAINTY_BONUS )
//        clamped strictly to [0, 100]
//
// Reference constants (Lichess `AccuracyPercent.scala` PR #11148):
//   slope = 0.00368208
//   acc_a = 103.1668100711649
//   acc_k = 0.04354415386753951
//   acc_b = -3.166924740191411
// ════════════════════════════════════════════════════════════════════════════

const WIN_SLOPE = 0.00368208;

const ACC_A = 103.1668100711649;
const ACC_K = 0.04354415386753951;
const ACC_B = -3.166924740191411;
const ACC_UNCERTAINTY_BONUS = 1; // Lichess "uncertainty bonus due to imperfect analysis"

/**
 * Convert (cp, mate) Stockfish score from the **moving player's** perspective
 * into a Win Probability in 0..1 range. Forced mate is bypassed to 1.0 / 0.0.
 *
 * Sign convention: positive cp / mate = mover is winning.
 */
export function cpAndMateToWin(cp: number | null, mate: number | null): number {
  if (mate !== null) {
    if (mate > 0) return 1.0;
    if (mate < 0) return 0.0;
    // mate === 0 means the current position is checkmate against the mover.
    return 0.0;
  }
  const c = cp ?? 0;
  return 0.5 + 0.5 * (2 / (1 + Math.exp(-WIN_SLOPE * c)) - 1);
}

/** Backwards-compat: 0..100 percent form. Use sparingly; prefer `cpAndMateToWin`. */
export function cpToWinPercent(cp: number): number {
  return cpAndMateToWin(cp, null) * 100;
}

/**
 * Single-move accuracy in 0..100, clamped strictly.
 *
 *   ΔWin = winBefore - winAfter            (0..1 input scale)
 *   Acc% = 103.1668 * exp(-0.04354 * (ΔWin * 100)) - 3.1669 + 1
 *
 * If `winAfter >= winBefore`, returns 100 (no penalty for "good" moves).
 */
export function accuracyFromWin(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const deltaPct = (winBefore - winAfter) * 100;
  const acc = ACC_A * Math.exp(-ACC_K * deltaPct) + ACC_B + ACC_UNCERTAINTY_BONUS;
  return Math.max(0, Math.min(100, acc));
}

export function moveAccuracy(evalBefore: number, evalAfter: number, mateBefore?: number | null, mateAfter?: number | null): number {
  return accuracyFromWin(
    cpAndMateToWin(evalBefore, mateBefore ?? null),
    cpAndMateToWin(evalAfter, mateAfter ?? null),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// engineScoreToCentipawns — kept for back-compat with the historical CPL field.
// Maps mate to a finite cp magnitude so legacy MoveReview.evalBefore / evalAfter
// fields still serialize as numbers in the database. NEW classification logic
// uses `cpAndMateToWin` directly and does NOT depend on this mapping.
// ────────────────────────────────────────────────────────────────────────────
export const MATE_SCORE_CP = 10_000;
const MATE_STEP_CP = 50;
const MATE_FLOOR_CP = 5_000;

export function engineScoreToCentipawns(cp: number | null, mate: number | null): number {
  if (mate !== null) {
    if (mate === 0) return cp ?? 0;
    const sign = mate > 0 ? 1 : -1;
    const magnitude = Math.max(MATE_SCORE_CP - Math.abs(mate) * MATE_STEP_CP, MATE_FLOOR_CP);
    return sign * magnitude;
  }
  return cp ?? 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Lichess weighted game accuracy
//   gameAcc = (weightedMean + harmonicMean) / 2
//   windowSize = clamp(plies/10, 2, 8)
//   weight = stdev of Win% over window, clamped [0.5, 12]
// Source: lila/modules/analyse/src/main/AccuracyPercent.scala
// ────────────────────────────────────────────────────────────────────────────
const WINDOW_MIN = 2;
const WINDOW_MAX = 8;
const WEIGHT_MIN = 0.5;
const WEIGHT_MAX = 12;
const INITIAL_CP = 15; // Lichess `Cp.initial` for white's turn at game start.

function stdev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * A move that carries a real decision, and therefore an accuracy score.
 *
 * F7 (2026-07-29): `playerAccuracy` and `phaseSummary` each skipped book and
 * forced moves, but `GameReviewService` built its `ratedMoves` set with
 * `!m.isBookMove` alone. Forced moves therefore fed `avgCpl`, `avgComplexity`
 * and the `moveCount` denominator behind the performance rating — charging a
 * player ~2 points per centipawn for a recapture they had no choice about,
 * and leaving the phase-row move counts unable to sum to the rating's
 * denominator. One predicate, three call sites.
 */
export function isRatedMove(m: MoveReview): boolean {
  return !m.isBookMove && m.classification !== 'forced' && m.unscored !== true;
}

/**
 * Weighted game accuracy for one colour, 0..100.
 *
 * F8 (2026-07-29): the volatility weighting is now a faithful port of
 * `AccuracyPercent.gameAccuracy`, which builds ONE interleaved White-relative
 * Win% series over all plies and only splits by colour at the end:
 *
 *   allWinPercents = Cp.initial :: cps            // length plies + 1
 *   windowSize     = (cps.size / 10).squeeze(2, 8)
 *   windows        = fill(windowSize - 2)(take(windowSize)) ::: sliding(windowSize)
 *
 * The previous port built a PER-COLOUR series, which halved the window size
 * (a 60-ply game got 3 instead of 6), smoothed the windows by dropping the
 * opponent's swings, and truncated instead of padding the leading windows —
 * all three push weights onto the 0.5 floor and flatten the weighting the
 * algorithm exists to apply, so reported accuracy drifted from the Lichess
 * figure for the same PGN.
 *
 * Two deliberate deviations remain, both forced by our data model:
 *   - per-move accuracy uses each move's own `evalBefore`/`evalAfter` (two
 *     independent searches) rather than consecutive entries of one series;
 *   - excluded/unrated plies carry the previous series value forward instead of
 *     contributing their placeholder eval, so the 1:1 ply→window mapping holds
 *     without injecting a fabricated dead-equal point.
 *
 * Returns 100 when the player has no rated move at all. `null` would be more
 * honest (the audit's suggestion) but `PlayerReview.accuracy` is typed `number`
 * and consumed by components outside this change's scope.
 */
export function playerAccuracy(
  moveReviews: MoveReview[],
  color: 'white' | 'black',
  startingColor: 'w' | 'b' = 'w',
  excludePlyIndices?: ReadonlySet<number>,
): number {
  // Index on plyIndex, never on array position: the two agree only while
  // moveReviews is dense, and a single skipped ply would otherwise re-attribute
  // every later move to the wrong colour.
  const ordered = [...moveReviews].sort((a, b) => a.plyIndex - b.plyIndex);
  const moverIsWhite = (plyIndex: number) =>
    startingColor === 'w' ? plyIndex % 2 === 0 : plyIndex % 2 !== 0;
  const isPlayerMove = (plyIndex: number) =>
    color === 'white' ? moverIsWhite(plyIndex) : !moverIsWhite(plyIndex);
  const isExcluded = (plyIndex: number) =>
    excludePlyIndices !== undefined && excludePlyIndices.has(plyIndex);

  // Interleaved White-relative Win% (0..100). series[0] is the game's initial
  // value; series[k] is the value AFTER the k-th ply.
  const series: number[] = [
    cpToWinPercent(startingColor === 'w' ? INITIAL_CP : -INITIAL_CP),
  ];
  for (const m of ordered) {
    const skip = isExcluded(m.plyIndex) || m.unscored === true;
    if (skip) {
      series.push(series[series.length - 1]);
      continue;
    }
    const isMoverWhite = moverIsWhite(m.plyIndex);
    const whiteCp = m.evalAfter !== null ? (isMoverWhite ? m.evalAfter : -m.evalAfter) : null;
    const whiteMate = m.mateAfter !== null ? (isMoverWhite ? m.mateAfter : -m.mateAfter) : null;
    series.push(cpAndMateToWin(whiteCp, whiteMate) * 100);
  }

  const plies = ordered.length;
  const window = Math.max(WINDOW_MIN, Math.min(WINDOW_MAX, Math.floor(plies / 10)));

  const accs: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < plies; i++) {
    const m = ordered[i];
    if (!isPlayerMove(m.plyIndex)) continue;
    if (isExcluded(m.plyIndex)) continue;
    if (!isRatedMove(m)) continue;

    // Upstream prepends `windowSize - 2` copies of the first window so early
    // moves are weighted over a full-width window instead of a degenerate one.
    const slice = i < window - 2
      ? series.slice(0, window)
      : series.slice(i - window + 2, i + 2);
    weights.push(Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, stdev(slice))));
    accs.push(accuracyFromWin(
      cpAndMateToWin(m.evalBefore, m.mateBefore),
      cpAndMateToWin(m.evalAfter, m.mateAfter),
    ));
  }

  if (accs.length === 0) return 100;

  const totalW = weights.reduce((s, v) => s + v, 0) || 1;
  const weightedMean = accs.reduce((s, a, i) => s + a * weights[i], 0) / totalW;

  // Harmonic mean penalizes a single very low value heavily.
  const safe = (a: number) => Math.max(1, a);
  const harmonic = accs.length / accs.reduce((s, a) => s + 1 / safe(a), 0);

  const blended = (weightedMean + harmonic) / 2;
  return Math.round(Math.max(0, Math.min(100, blended)) * 10) / 10;
}


// ════════════════════════════════════════════════════════════════════════════
// PHASE 4 — CLASSIFICATION (USER SPEC)
//
// Short-circuits first: Book (position in the ECO opening set), then Forced
// (only legal move — labelled, never rated).
//
// Standard ladder uses ΔWin in 0..1 scale:
//   Best        : ≤ 0.005 drop ("near_best") OR the exact engine top move
//   Excellent   : > 0.005, ≤ 0.02
//   Good        : > 0.02,  ≤ 0.05
//   Inaccuracy  : > 0.05,  ≤ 0.10
//   Mistake     : > 0.10,  ≤ 0.20
//   Blunder     : > 0.20
//
// Special overrides (winBefore/winAfter in 0..1). Values below MUST match the
// constants declared just under this block — keep them in sync:
//   Miss      : winBefore > 0.85 AND winAfter < 0.60 — 'miss' while the player
//               still keeps footing (winAfter ≥ 0.35), 'blunder' on a collapse
//               below that. (ΔWin is always > 0.25 in this region, so a plain
//               ΔWin>0.20 promotion would make 'miss' unreachable.)
//   Great     : singular engine choice + rating-calibrated near-best play +
//               one of three swing gates (losing→winning, equal→winning,
//               lost→equal) — see the C1 block below.
//   Brilliant : engine-equivalent true piece sacrifice AND winAfter ≥ 0.60
//               AND winBefore < 0.85, drop limit calibrated by player rating.
//
// "near_best" tolerance band of 0.005 ΔWin keeps Best stable across
// shallow-depth engine nondeterminism — same position can flip top-PV
// among engine-equivalent moves between reruns.
// ════════════════════════════════════════════════════════════════════════════

const DELTA_WIN_THRESHOLDS = {
  near_best: 0.005,
  excellent: 0.02,
  good: 0.05,
  inaccuracy: 0.10,
  mistake: 0.20,
  // > 0.20 = blunder
};

const MISS_WIN_BEFORE = 0.85;
const MISS_WIN_AFTER = 0.60;

const GREAT_WIN_BEFORE = 0.2;
const GREAT_WIN_AFTER = 0.4;

const BRILLIANT_WIN_BEFORE_MAX = 0.85;
const BRILLIANT_WIN_AFTER = 0.6;
const DEFAULT_PLAYER_RATING = 1500;

function ratingBand(playerRating?: number | null): 'beginner' | 'club' | 'advanced' | 'expert' | 'master' {
  const rating = Math.max(0, Math.min(4000, playerRating ?? DEFAULT_PLAYER_RATING));
  if (rating < 1000) return 'beginner';
  if (rating < 1600) return 'club';
  if (rating < 2200) return 'advanced';
  if (rating < 2400) return 'expert';
  return 'master';
}

function brilliantDropLimit(playerRating?: number | null): number {
  switch (ratingBand(playerRating)) {
    case 'beginner': return 0.025;
    case 'club': return 0.018;
    case 'advanced': return 0.012;
    case 'expert': return 0.008;
    case 'master': return DELTA_WIN_THRESHOLDS.near_best;
  }
}

function greatDropLimit(playerRating?: number | null): number {
  switch (ratingBand(playerRating)) {
    case 'beginner': return 0.012;
    case 'club': return 0.008;
    case 'advanced': return 0.006;
    case 'expert':
    case 'master':
      return DELTA_WIN_THRESHOLDS.near_best;
  }
}

export interface ClassifyMoveParams {
  /** Mover-relative Win% (0..1) of the position the move was played FROM. */
  winBefore: number;
  /** Mover-relative Win% (0..1) of the position the move led TO. */
  winAfter: number;
  isBookMove: boolean;
  isBestMove: boolean;
  isSingularChoice: boolean;
  isMaterialSacrifice: boolean;
  /** Only legal move in the position — labelled 'forced', never rated. */
  isForced?: boolean;
  /** Mate-in-N before the move (mover-positive). null = no forced mate. */
  mateBefore?: number | null;
  /** Mate-in-N after the move (new-mover-positive). null = no forced mate. */
  mateAfter?: number | null;
  /** Player rating calibrates Brilliant/Great generosity. Unknown defaults to 1500. */
  playerRating?: number | null;
}

export function classifyMove(params: ClassifyMoveParams): MoveClassification {
  const {
    winBefore,
    winAfter,
    isBookMove,
    isBestMove,
    isSingularChoice,
    isMaterialSacrifice,
    isForced = false,
    mateBefore = null,
    mateAfter = null,
    playerRating = DEFAULT_PLAYER_RATING,
  } = params;

  if (isBookMove) return 'book';
  // Forced: with a single legal move there was no decision to grade. Runs
  // before every override so a forced recapture can't score as Best/Blunder.
  if (isForced) return 'forced';

  // F5 (2026-07-29): ΔWin is DERIVED here, not accepted as a parameter. It used
  // to be a third independent input alongside winBefore/winAfter with no
  // invariant tying them together, which let callers (and tests) describe
  // states that cannot occur — e.g. a positive ΔWin on a move that improved the
  // position. Every rung and tolerance below now reads the same number.
  const dw = Math.max(0, winBefore - winAfter);

  // C2: Brilliant — strict best OR engine-equivalent (within near_best tolerance).
  // Some genuine brilliancies surface as 2nd-PV at low depth due to tactic horizon.
  const isBestEquivalent = isBestMove || dw <= brilliantDropLimit(playerRating);
  if (
    isBestEquivalent &&
    isMaterialSacrifice &&
    winAfter >= BRILLIANT_WIN_AFTER &&
    winBefore < BRILLIANT_WIN_BEFORE_MAX &&
    dw <= DELTA_WIN_THRESHOLDS.good
  ) {
    return 'brilliant';
  }

  // C3: Forced-mate-missed → Miss. Player had a forced mate, but the played
  // move either dropped it entirely or pushed it >2 ply slower. Guard: only
  // call it 'miss' (a near-miss) when the position is still competitive. If the
  // mate was thrown away INTO a losing position (mateAfter null AND winAfter
  // collapsed), fall through to the ΔWin ladder so it scores as 'blunder'.
  //
  // F4 (2026-07-29): two guards were missing.
  //   1. `isBestMove` was never consulted, so the engine's OWN top move could be
  //      reported as a miss — which happened on nearly every ply of a long
  //      mating sequence and cost hundreds of rating points through missRate.
  //   2. The `mateAfter === null` arm fired on any mate→cp transition. That is
  //      the normal behaviour of a fixed-depth search at the mate horizon
  //      (mate 8 before, cp 2800 after), not evidence of a squandered win. It
  //      now needs real degradation: a Win% drop past the 'good' rung, or the
  //      win no longer being categorical (winAfter < 0.90).
  const MATE_HORIZON_WIN_FLOOR = 0.90;
  if (
    !isBestMove &&
    mateBefore !== null && mateBefore > 0 &&
    (
      (mateAfter === null && (dw > DELTA_WIN_THRESHOLDS.good || winAfter < MATE_HORIZON_WIN_FLOOR)) ||
      (mateAfter !== null && mateAfter > 0 && mateAfter > Math.abs(mateBefore) + 2)
    )
  ) {
    if (mateAfter !== null || winAfter >= 0.35) {
      // A small-swing mate drop (mate kept but slower, or mate → still clearly
      // winning) is a genuine near-miss. But if dropping the mate also collapses
      // Win% by a blunder-magnitude margin, it's a blunder — mirror the same
      // promotion used in the winBefore>0.85 miss path below.
      if (dw > DELTA_WIN_THRESHOLDS.mistake) return 'blunder';
      return 'miss';
    }
  }

  // C1: Great — widened gates.
  //   (a) classic chess.com losing→equal+: winBefore<0.2, winAfter>0.4, singular best
  //   (b) equal→winning singular best: winBefore in [0.35,0.7], winAfter>0.7
  //   (c) losing→equal save: winBefore<0.35, winAfter in [0.45,0.7], singular best
  // All require a singular engine choice, engine-equivalent play, and a
  // meaningful swing. The rating-calibrated drop limit mirrors Chess.com's
  // public note that special classifications are more forgiving below master
  // strength, while remaining deterministic and transparent.
  //
  // HONEST LIMIT (F5, verified 2026-07-29): all three swing gates require
  // winAfter > winBefore, so the derived ΔWin is exactly 0 inside them and
  // `greatDropLimit` is satisfied for every rating band. The real
  // discriminators for Great are `isSingularChoice` plus the swing gates. The
  // audit suggested re-expressing the tolerance as `topMoveWin - winAfter`, but
  // GameReviewService sets `topMoveWin === win` for all three eval sources
  // (engine/cache/tablebase), so that quantity is identical to ΔWin and would
  // change nothing. Making the bands bite here needs rating-dependent SWING
  // thresholds — a re-tune of frozen constants, deliberately out of scope.
  const isGreatEquivalent = isBestMove || dw <= greatDropLimit(playerRating);
  if (isGreatEquivalent && isSingularChoice) {
    const swing = winAfter - winBefore;
    const lostToEqual = winBefore < 0.35 && winAfter >= 0.45 && winAfter < 0.7 && swing > 0.15;
    const equalToWinning = winBefore >= 0.35 && winBefore < 0.7 && winAfter > 0.7 && swing > 0.2;
    const losingToWinning = winBefore < GREAT_WIN_BEFORE && winAfter > GREAT_WIN_AFTER;
    if (losingToWinning || equalToWinning || lostToEqual) {
      return 'great';
    }
  }

  if (winBefore > MISS_WIN_BEFORE && winAfter < MISS_WIN_AFTER) {
    // "Miss" is for letting a winning advantage slip while keeping footing;
    // a collapse into a (near-)lost position is a blunder. NOTE: ΔWin is
    // always > 0.25 in this region (0.85 − 0.60), so gating the promotion on
    // ΔWin > 0.20 — the previous code — made 'miss' unreachable here; the
    // discriminator must be the RESULTING position, not the drop size.
    if (winAfter < 0.35) return 'blunder';
    return 'miss';
  }

  if (isBestMove || dw <= DELTA_WIN_THRESHOLDS.near_best) return 'best';
  if (dw <= DELTA_WIN_THRESHOLDS.excellent) return 'excellent';
  if (dw <= DELTA_WIN_THRESHOLDS.good) return 'good';
  if (dw <= DELTA_WIN_THRESHOLDS.inaccuracy) return 'inaccuracy';
  if (dw <= DELTA_WIN_THRESHOLDS.mistake) return 'mistake';

  return 'blunder';
}

// ────────────────────────────────────────────────────────────────────────────
// Performance rating from accuracy.
// CAPS-style cubic on accuracy plus per-30-moves incident penalty.
//   Re = 2.05 + 12.9*A - 0.256*A^2 + 0.00401*A^3   (community fit)
// Floor at 800 below 56% accuracy. Confidence blends short games toward 1200.
// ────────────────────────────────────────────────────────────────────────────
export function accuracyToGameRating(
  accuracy: number,
  avgCpl?: number,
  blunderCount?: number,
  mistakeCount?: number,
  moveCount?: number,
  inaccuracyCount?: number,
  missCount?: number,
  avgComplexity?: number,
): number | null {
  const moves = Math.max(0, moveCount ?? 0);
  // Below 3 rated moves there isn't enough signal to estimate performance —
  // return null so callers can suppress the badge instead of showing a
  // misleading blended-to-1200 number (3–4 moves render as 'provisional').
  if (moves < 3) return null;

  const a = Math.max(0, Math.min(100, accuracy));
  const blunders = blunderCount ?? 0;
  const mistakes = mistakeCount ?? 0;
  const inaccuracies = inaccuracyCount ?? 0;
  const misses = missCount ?? 0;
  const cpl = Math.max(0, Math.min(500, avgCpl ?? 0));

  let base: number;
  if (a < 56) {
    base = 800;
  } else {
    base = 2.05 + 12.9 * a - 0.256 * a * a + 0.00401 * a * a * a;
    // The cubic is monotone increasing on [56,100] and peaks at ~2742 (a=100).
    // Cap at 2700 (not 2400) so that near-perfect games in the 96.5–100%
    // accuracy band still differentiate instead of flat-lining.
    base = Math.min(base, 2700);
  }

  const denom = Math.max(20, moves);
  const blunderRate = (blunders / denom) * 30;
  const mistakeRate = (mistakes / denom) * 30;
  const missRate = (misses / denom) * 30;
  const inaccuracyRate = (inaccuracies / denom) * 30;

  const penalty =
    Math.max(0, cpl - 10) * 2.0 +
    blunderRate * 280 +
    missRate * 200 +
    mistakeRate * 90 +
    inaccuracyRate * 25;

  // Length confidence: <10 moves heavily blended toward 1200; 30+ uses raw.
  // Lower floor than before so very short games don't park at ~70% confidence.
  const lengthConfidence = moves < 10
    ? Math.max(0.15, moves / 30)
    : Math.max(0.3, Math.min(1, moves / 30));

  // Position-complexity bonus. avgComplexity is the mean per-ply top-2 MultiPV
  // Win% spread (0..1): higher = sharper "only-move" positions where accuracy is
  // harder to sustain. Reward accuracy under sharpness, but:
  //   - scale by accuracy/100 so a blunder-ridden game isn't rescued by sharpness,
  //   - clamp the proxy at 0.5 (beyond that it's already maximally sharp),
  //   - cap the bonus at COMPLEXITY_BONUS_MAX so the rating stays well-behaved.
  // Zero/undefined complexity ⇒ zero bonus ⇒ identical to the prior 7-arg result.
  const COMPLEXITY_BONUS_MAX = 150;
  const cx = Math.max(0, Math.min(0.5, avgComplexity ?? 0));
  const complexityBonus = (cx / 0.5) * COMPLEXITY_BONUS_MAX * (a / 100);

  const raw = base - penalty + complexityBonus;
  const blended = 1200 * (1 - lengthConfidence) + raw * lengthConfidence;

  return Math.round(Math.max(200, Math.min(3000, blended)));
}

export function gameRatingConfidence(moveCount: number): RatingConfidence {
  if (moveCount < 3) return 'none';
  if (moveCount < 5) return 'provisional';
  if (moveCount < 10) return 'low';
  if (moveCount < 25) return 'medium';
  return 'high';
}

export function phaseSummary(phaseMoves: MoveReview[]): {
  accuracy: number;
  icon: MoveClassification | 'none';
  moveCount: number;
  avgCpl: number | null;
} {
  const rated = phaseMoves.filter(isRatedMove);
  if (rated.length === 0) {
    return { accuracy: 0, icon: 'none', moveCount: 0, avgCpl: null };
  }

  const sumAccuracy = rated.reduce(
    (s, m) => s + moveAccuracy(m.evalBefore, m.evalAfter, m.mateBefore, m.mateAfter),
    0,
  );
  const accuracy = Math.round((sumAccuracy / rated.length) * 10) / 10;
  const avgCpl = Math.round(
    rated.reduce((sum, m) => sum + Math.min(m.cpl, 1500), 0) / rated.length,
  );

  let icon: MoveClassification | 'none';
  if (accuracy >= 90) icon = 'best';
  else if (accuracy >= 75) icon = 'excellent';
  else if (accuracy >= 60) icon = 'good';
  else if (accuracy >= 45) icon = 'inaccuracy';
  else icon = 'mistake';

  return { accuracy, icon, moveCount: rated.length, avgCpl };
}

// ────────────────────────────────────────────────────────────────────────────
// Lichess Divider — phase boundaries from material + backrank + mixedness.
// Source: scalachess `Divider.scala`.
//
//   Middlegame triggers when ANY of:
//     - majorsAndMinors ≤ 10
//     - backrankSparse: either side has < 4 pieces on home rank
//     - mixedness > 150
//   Endgame triggers when:
//     - majorsAndMinors ≤ 6
//   Midgame ply must precede endgame ply.
// ────────────────────────────────────────────────────────────────────────────
export interface PhaseBoundaries {
  openingEndsAtPly: number;
  middlegameEndsAtPly: number;
}

interface ParsedFen {
  /** 8x8 board, board[rank][file] where rank 0 = rank 8 (top). */
  board: (string | null)[][];
}

function parseFen(fen: string): ParsedFen | null {
  const placement = fen.split(' ')[0];
  if (!placement) return null;
  const ranks = placement.split('/');
  if (ranks.length !== 8) return null;
  const board: (string | null)[][] = [];
  for (const r of ranks) {
    const row: (string | null)[] = [];
    for (const ch of r) {
      if (/[1-8]/.test(ch)) {
        const n = parseInt(ch, 10);
        for (let i = 0; i < n; i++) row.push(null);
      } else {
        row.push(ch);
      }
    }
    if (row.length !== 8) return null;
    board.push(row);
  }
  return { board };
}

function majorsAndMinors(board: (string | null)[][]): number {
  let n = 0;
  for (const row of board) {
    for (const p of row) {
      if (!p) continue;
      const t = p.toLowerCase();
      if (t === 'n' || t === 'b' || t === 'r' || t === 'q') n++;
    }
  }
  return n;
}

function backrankSparse(board: (string | null)[][]): boolean {
  const whiteCount = board[7].filter((p) => p && p === p.toUpperCase()).length;
  const blackCount = board[0].filter((p) => p && p === p.toLowerCase()).length;
  return whiteCount < 4 || blackCount < 4;
}

function mixedness(board: (string | null)[][]): number {
  let total = 0;
  for (const yTop of [0, 1, 2, 3, 4, 5, 6]) {
    for (const xLeft of [0, 1, 2, 3, 4, 5, 6]) {
      let white = 0;
      let black = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const p = board[yTop + dy][xLeft + dx];
          if (!p) continue;
          if (p === p.toUpperCase()) white++;
          else black++;
        }
      }
      // scalachess Divider iterates regions from White's home rank (y=1) to
      // Black's home rank (y=7), passing `yLoop + 1`. Our board is indexed from
      // rank 8 (board[0]) down to rank 1 (board[7]), so yTop=0 is Black's side;
      // the matching scalachess row index is therefore y = 7 - yTop (range 1..7).
      // NOTE: the prior port used `6 - yTop` and fabricated *6/*9/*12 polynomials,
      // which made startpos score >150 and collapsed the opening phase to empty.
      const y = 7 - yTop;
      const key = `${white},${black}`;
      let score = 0;
      switch (key) {
        // Exact port of scalachess Divider.score(y)(white, black).
        case '0,0': score = 0; break;
        case '1,0': score = 1 + (8 - y); break;
        case '2,0': score = y > 2 ? 2 + (y - 2) : 0; break;
        case '3,0': score = y > 1 ? 3 + (y - 1) : 0; break;
        case '4,0': score = y > 1 ? 3 + (y - 1) : 0; break;
        case '0,1': score = 1 + y; break;
        case '1,1': score = 5 + Math.abs(4 - y); break;
        case '2,1': score = 4 + (y - 1); break;
        case '3,1': score = 5 + (y - 1); break;
        case '0,2': score = y < 6 ? 2 + (6 - y) : 0; break;
        case '1,2': score = 4 + (7 - y); break;
        case '2,2': score = 7; break;
        case '0,3': score = y < 7 ? 3 + (7 - y) : 0; break;
        case '1,3': score = 5 + (7 - y); break;
        case '0,4': score = y < 7 ? 3 + (7 - y) : 0; break;
        default: score = 0;
      }
      total += score;
    }
  }
  return total;
}

export function computePhaseBoundaries(fenPositions: string[]): PhaseBoundaries {
  const plyCount = Math.max(0, fenPositions.length - 1);
  let middlegameStart: number | null = null;
  let endgameStart: number | null = null;

  for (let i = 0; i < fenPositions.length; i++) {
    const fen = fenPositions[i];
    if (!fen) continue;
    const parsed = parseFen(fen);
    if (!parsed) continue;
    const mm = majorsAndMinors(parsed.board);

    if (middlegameStart === null) {
      const sparse = backrankSparse(parsed.board);
      const mix = mixedness(parsed.board);
      if (mm <= 10 || sparse || mix > 150) middlegameStart = i;
    }
    if (middlegameStart !== null && endgameStart === null && mm <= 6) {
      endgameStart = i;
    }
  }

  // Upstream `Divider.scala`:
  //   Division(midGame.filter(m => endGame.fold(true)(m < _)), endGame, boards.size)
  // i.e. when both trigger on the same board the MIDDLEGAME is dropped and the
  // endgame starts there. F9 (2026-07-29): the port did the reverse — it pushed
  // `middlegameEndsAtPly` out to `plyCount`, which emptied the endgame band, so
  // a queen trade that drops majors+minors from 12 straight to 6 left the whole
  // remaining rook ending labelled "Middlegame" and the Endgame row showing "No
  // rated moves". `endgameStart` is only ever set at or after `middlegameStart`,
  // so the equal case now naturally yields an empty middlegame band.
  //
  // The opening fallback follows upstream's `openingSize = middle | plies` too:
  // a game that never satisfies any middlegame criterion is all opening. The
  // previous 20-ply cap was invented, not ported.
  const openingEndsAtPly = middlegameStart ?? plyCount;
  const middlegameEndsAtPly = endgameStart ?? plyCount;
  return { openingEndsAtPly, middlegameEndsAtPly };
}

// ────────────────────────────────────────────────────────────────────────────
// Material delta — true piece-sacrifice detector for Brilliant classification.
//
// F1 (2026-07-29): the previous implementation diffed material between the FEN
// before and after the mover's OWN ply. A player can never lose material on
// their own move — `moverAfter >= moverBefore` always — so the function
// returned `<= 0` for every legal move in chess and Brilliant was unreachable.
//
// The sacrifice only materialises on the OPPONENT's reply, so we evaluate it
// with a static exchange evaluation (SEE) on the destination square: how much
// material the opponent wins by initiating the capture sequence there, minus
// what the move itself captured, minus the value a promotion just created.
//
//   Bxh7+  : opponent wins the bishop (3), move captured a pawn (1) → net 2.
//   c4     : opponent wins a pawn (1), captured nothing            → net 1 (gambit).
//   b8=Q   : opponent wins the queen (9) but only a pawn was ever
//            invested (promotion gain 8)                            → net 1.
//   Bxc6   : opponent wins the bishop (3), move captured a knight (3) → net 0.
//
// Known limit: only the moved piece's own square is examined, so a deflection
// that hangs a DIFFERENT piece is not counted as a sacrifice.
//
// Standard piece values: P=1, N=3, B=3, R=5, Q=9, K=0.
// ────────────────────────────────────────────────────────────────────────────
const PIECE_VALUES: Record<string, number> = {
  p: 1, n: 3, b: 3, r: 5, q: 9, k: 0,
};

/** Depth guard — a square can be contested by at most a handful of attackers. */
const SEE_MAX_DEPTH = 10;

/**
 * Static exchange evaluation on one square: the material the side to move can
 * win by capturing there, assuming both sides play the sequence optimally and
 * either may decline at any point (hence the 0 floor at every level).
 */
function seeGainOn(chess: Chess, square: string, depth = 0): number {
  if (depth >= SEE_MAX_DEPTH) return 0;
  let best = 0;
  for (const m of chess.moves({ verbose: true })) {
    if (m.to !== square || !m.captured) continue;
    // Under-promotions can't beat the queen promotion for material purposes.
    if (m.promotion && m.promotion !== 'q') continue;
    const capturedValue = PIECE_VALUES[m.captured] ?? 0;
    const promotionGain = m.promotion
      ? (PIECE_VALUES[m.promotion] ?? 0) - PIECE_VALUES.p
      : 0;
    chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    const gain = capturedValue + promotionGain - seeGainOn(chess, square, depth + 1);
    chess.undo();
    if (gain > best) best = gain;
  }
  return best;
}

/**
 * Net material the mover spends on `playedUci` (positive = sacrifice).
 * Returns 0 for an unparseable position or an illegal move.
 */
export function netMaterialSacrifice(fenBefore: string, playedUci: string): number {
  if (!playedUci || playedUci.length < 4) return 0;
  let chess: Chess;
  try {
    chess = new Chess(fenBefore);
  } catch {
    return 0;
  }

  const to = playedUci.slice(2, 4);
  let move: ReturnType<Chess['move']>;
  try {
    move = chess.move({
      from: playedUci.slice(0, 2),
      to,
      promotion: playedUci.length > 4 ? playedUci[4] : undefined,
    });
  } catch {
    return 0;
  }
  if (!move) return 0;

  const capturedValue = move.captured ? (PIECE_VALUES[move.captured] ?? 0) : 0;
  const promotionGain = move.promotion
    ? (PIECE_VALUES[move.promotion] ?? 0) - PIECE_VALUES.p
    : 0;

  // `chess` is now at the position after the move, so it is the opponent's turn.
  return seeGainOn(chess, to) - capturedValue - promotionGain;
}

/** Threshold for "true piece sacrifice": net spend ≥ 2 (excludes pawn gambits). */
export function isTruePieceSacrifice(fenBefore: string, playedUci: string): boolean {
  return netMaterialSacrifice(fenBefore, playedUci) >= 2;
}

