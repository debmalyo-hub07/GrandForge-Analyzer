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

export function playerAccuracy(
  moveReviews: MoveReview[],
  color: 'white' | 'black',
  startingColor: 'w' | 'b' = 'w',
  excludePlyIndices?: ReadonlySet<number>,
): number {
  const moverIsWhite = (i: number) =>
    startingColor === 'w' ? i % 2 === 0 : i % 2 !== 0;
  const isPlayerMove = (i: number) =>
    color === 'white' ? moverIsWhite(i) : !moverIsWhite(i);
  // REV-4: plies the engine could not evaluate are skipped entirely — neither
  // their (placeholder) Win% nor their accuracy contributes.
  const isExcluded = (i: number) =>
    excludePlyIndices !== undefined && excludePlyIndices.has(moveReviews[i]?.plyIndex);

  // Build the PER-COLOR Win% (0..100) series for this player, White-relative so
  // the magnitude is meaningful (REV-2). Lichess computes windowSize and the
  // sliding stdev window over the player's own cp-series, not the interleaved
  // two-color sequence. Each entry is the Win% BEFORE one of this player's
  // moves; we prepend the game's initial Win% so the first move still has a
  // (degenerate) trailing window. evalBefore is mover-relative → flip to White
  // POV for black moves so signs are consistent across the series.
  const colorSeries: number[] = [
    cpToWinPercent(startingColor === 'w' ? INITIAL_CP : -INITIAL_CP),
  ];
  // Parallel arrays: for each player move, its accuracy and the index into
  // colorSeries of its "before" Win% (used as the trailing-window anchor).
  const playerAccs: number[] = [];
  const anchorIdx: number[] = [];
  for (let i = 0; i < moveReviews.length; i++) {
    if (!isPlayerMove(i)) continue;
    // Excluded (unscored) plies don't contribute their placeholder Win% to the
    // volatility series or an accuracy term.
    if (isExcluded(i)) continue;
    const m = moveReviews[i];
    const isMoverWhite = moverIsWhite(i);
    const whiteRelativeCp = m.evalBefore !== null
      ? (isMoverWhite ? m.evalBefore : -m.evalBefore)
      : null;
    const whiteRelativeMate = m.mateBefore !== null
      ? (isMoverWhite ? m.mateBefore : -m.mateBefore)
      : null;
    colorSeries.push(cpAndMateToWin(whiteRelativeCp, whiteRelativeMate) * 100);
    if (m.isBookMove) continue;
    // Anchor on the just-pushed entry (index = colorSeries.length - 1).
    anchorIdx.push(colorSeries.length - 1);
    const wBefore = cpAndMateToWin(m.evalBefore, m.mateBefore) * 100;
    const wAfter = cpAndMateToWin(m.evalAfter, m.mateAfter) * 100;
    playerAccs.push(accuracyFromWin(wBefore / 100, wAfter / 100));
  }

  if (playerAccs.length === 0) return 100;

  // windowSize from the PER-COLOR series length (Lichess: clamp(len/10, 2, 8)).
  const window = Math.max(
    WINDOW_MIN,
    Math.min(WINDOW_MAX, Math.floor(colorSeries.length / 10)),
  );

  const accs: number[] = [];
  const weights: number[] = [];
  for (let k = 0; k < playerAccs.length; k++) {
    const idx = anchorIdx[k];
    // TRAILING sliding window: the `window` entries up to and including idx.
    const lo = Math.max(0, idx - window + 1);
    const slice = colorSeries.slice(lo, idx + 1);
    const sd = stdev(slice);
    const weight = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, sd));
    accs.push(playerAccs[k]);
    weights.push(weight);
  }

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
// Standard ladder uses ΔWin in 0..1 scale:
//   Best        : 0.00 drop
//   Excellent   : > 0.00, ≤ 0.02
//   Good        : > 0.02, ≤ 0.05
//   Inaccuracy  : > 0.05, ≤ 0.10
//   Mistake     : > 0.10, ≤ 0.20
//   Blunder     : > 0.20
//
// Special overrides (winBefore/winAfter in 0..1). Values below MUST match the
// constants declared just under this block — keep them in sync:
//   Miss        : winBefore > 0.85 AND winAfter < 0.60 (unless ΔWin > 0.20 → blunder)
//   Great       : winBefore < 0.20 AND winAfter > 0.40 AND singular engine choice
//   Brilliant   : true piece sacrifice AND winAfter >= 0.60 AND winBefore < 0.85
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
  winBefore: number;
  winAfter: number;
  isBookMove: boolean;
  isBestMove: boolean;
  isSingularChoice: boolean;
  isMaterialSacrifice: boolean;
  deltaWin: number;
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
    deltaWin,
    mateBefore = null,
    mateAfter = null,
    playerRating = DEFAULT_PLAYER_RATING,
  } = params;

  if (isBookMove) return 'book';

  const dw = deltaWin;

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
  if (
    mateBefore !== null && mateBefore > 0 &&
    (mateAfter === null || (mateAfter > 0 && mateAfter > Math.abs(mateBefore) + 2))
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
    // If the Win% drop is severe enough to be a blunder, classify as blunder.
    // "Miss" is for losing a winning advantage, not for catastrophic collapses.
    if (dw > DELTA_WIN_THRESHOLDS.mistake) return 'blunder';
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
  // Below 5 moves there isn't enough signal to estimate performance — return
  // null so callers can suppress the badge instead of showing a misleading
  // blended-to-1200 number.
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
  const rated = phaseMoves.filter((m) => !m.isBookMove);
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

  const openingEndsAtPly = middlegameStart ?? Math.min(plyCount, 20);
  let middlegameEndsAtPly = endgameStart ?? plyCount;
  if (middlegameEndsAtPly <= openingEndsAtPly) middlegameEndsAtPly = plyCount;
  return { openingEndsAtPly, middlegameEndsAtPly };
}

// ────────────────────────────────────────────────────────────────────────────
// Material delta — true piece-sacrifice detector for Brilliant classification.
//
// Returns the change in moving-player's aggregate material **after the move**
// MINUS what the move captured. A positive value means the player sacrificed
// material. Pawn-only sacrifices (≤ 1 pawn) are excluded — chess.com Brilliant
// requires a piece sacrifice.
//
// Standard piece values: P=1, N=3, B=3, R=5, Q=9, K=0.
// ────────────────────────────────────────────────────────────────────────────
const PIECE_VALUES: Record<string, number> = {
  p: 1, n: 3, b: 3, r: 5, q: 9, k: 0,
};

function totalMaterialOf(board: (string | null)[][], color: 'w' | 'b'): number {
  let total = 0;
  for (const row of board) {
    for (const p of row) {
      if (!p) continue;
      const isWhite = p === p.toUpperCase();
      if ((color === 'w') !== isWhite) continue;
      total += PIECE_VALUES[p.toLowerCase()] ?? 0;
    }
  }
  return total;
}

/**
 * Compute the moving player's net material loss from the move (positive = lost
 * material, i.e., sacrifice). Compares aggregate material on both sides BEFORE
 * and AFTER the move and returns the player's drop.
 *
 * Threshold for "true piece sacrifice": net loss ≥ 2 (excludes single-pawn sacs).
 */
export function netMaterialSacrifice(fenBefore: string, fenAfter: string): number {
  const before = parseFen(fenBefore);
  const after = parseFen(fenAfter);
  if (!before || !after) return 0;

  const moverColor: 'w' | 'b' = fenBefore.split(' ')[1] === 'b' ? 'b' : 'w';
  const opponentColor: 'w' | 'b' = moverColor === 'w' ? 'b' : 'w';

  const moverBefore = totalMaterialOf(before.board, moverColor);
  const moverAfter = totalMaterialOf(after.board, moverColor);
  const oppBefore = totalMaterialOf(before.board, opponentColor);
  const oppAfter = totalMaterialOf(after.board, opponentColor);

  // Mover's piece value loss (e.g., promoted pawn → queen makes this NEGATIVE).
  const moverLoss = moverBefore - moverAfter;
  // Opponent material lost (i.e., what mover captured).
  const captured = oppBefore - oppAfter;

  // Net material spent (mover loss minus what they captured back).
  return moverLoss - captured;
}

export function isTruePieceSacrifice(fenBefore: string, fenAfter: string): boolean {
  return netMaterialSacrifice(fenBefore, fenAfter) >= 2;
}
