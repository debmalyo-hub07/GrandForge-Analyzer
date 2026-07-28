// Classification is ΔWin-based (win-percent loss, see reviewUtils.ts
// DELTA_WIN_THRESHOLDS): best ≤0.005 (or engine top move) · excellent ≤0.02 ·
// good ≤0.05 · inaccuracy ≤0.10 · mistake ≤0.20 · blunder >0.20, with
// brilliant/great/miss overrides and book/forced short-circuits.
export type MoveClassification =
  | 'brilliant'    // !! — engine-equivalent true piece sacrifice from a non-won position
  | 'great'        // !  — singular engine choice producing a decisive swing
  | 'book'         // 📖 — known opening theory move (ECO DB)
  | 'forced'       // →  — only legal move; not rated for accuracy
  | 'best'         // ★  — engine top choice or within 0.005 ΔWin
  | 'excellent'    // 👍 — ΔWin ≤ 0.02
  | 'good'         // ✓  — ΔWin ≤ 0.05
  | 'inaccuracy'   // ?! — ΔWin ≤ 0.10
  | 'mistake'      // ?  — ΔWin ≤ 0.20
  | 'miss'         // ✗  — winning chance squandered (mate dropped / big advantage let slip)
  | 'blunder';     // ?? — ΔWin > 0.20 or collapse into a lost position

/**
 * Canonical order for iterating every classification (summary rows, counts).
 * The AssertExhaustive check makes adding a union member without listing it
 * here a compile error — GameReviewService builds its per-player `counts`
 * record from this array.
 */
export const ALL_CLASSIFICATIONS = [
  'brilliant', 'great', 'book', 'forced', 'best', 'excellent',
  'good', 'inaccuracy', 'mistake', 'miss', 'blunder',
] as const satisfies readonly MoveClassification[];

type AssertExhaustive<T extends never> = T;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AllClassificationsCovered = AssertExhaustive<
  Exclude<MoveClassification, (typeof ALL_CLASSIFICATIONS)[number]>
>;

// Centipawn-loss reference thresholds (legacy). Newer review code uses
// win-percent loss for classification; these are retained for reporting.
export const CPL_THRESHOLDS = {
  best:       10,
  excellent:  25,
  good:       50,
  inaccuracy: 100,
  mistake:    200,
  // > 200 = blunder
};

export interface MoveReview {
  plyIndex: number;           // 0-based ply
  san: string;                // SAN of the move played
  uci: string;                // UCI of the move played
  classification: MoveClassification;
  evalBefore: number;         // centipawns from moving-player perspective BEFORE move
  evalAfter: number;          // centipawns from moving-player perspective AFTER move
  cpl: number;                // centipawn loss (evalBefore - evalAfter), always >= 0
  bestMoveUci: string;        // UCI of engine's top choice BEFORE the move
  bestMoveSan: string;        // SAN of engine's top choice BEFORE the move
  bestMoveEval: number;       // eval BEFORE the move (used for delta display)
  isBookMove: boolean;        // true if position is in ECO opening DB
  isBrilliant: boolean;       // true if sacrifice/quiet best move
  mateBefore: number | null;  // normalized mate-in-N before move (>0 = player mates)
  mateAfter: number | null;   // normalized mate-in-N after move (>0 = player mates)
  pvLine: string[];           // engine's best continuation (UCI) from this position
  complexity: number;         // per-ply top-2 MultiPV Win% spread (0..1); 0 = forgiving
  reason: string;             // human-readable explanation of classification
  /**
   * The engine produced no usable eval for this ply even after a retry, so
   * `evalBefore`/`evalAfter`/`cpl`/`classification` are placeholders, not
   * measurements. Already excluded from accuracy, CPL, complexity, counts and
   * phase rows; consumers must not render it as a graded move (F10).
   */
  unscored?: boolean;
}

export type RatingConfidence = 'none' | 'provisional' | 'low' | 'medium' | 'high';

export interface PhaseReview {
  label: 'Opening' | 'Middlegame' | 'Endgame';
  accuracy: number;                     // 0–100
  icon: MoveClassification | 'none';    // representative icon for this phase
  moveCount: number;                    // non-book, scored moves in this phase
  avgCpl: number | null;                // average CPL for non-book phase moves
}

export interface PlayerReview {
  color: 'white' | 'black';
  accuracy: number;            // 0–100, computed via accuracy formula
  counts: Record<MoveClassification, number>;
  /** Estimated performance rating, or null when too few moves to estimate (<3). */
  gameRating: number | null;
  gameRatingConfidence: RatingConfidence;
  phaseReviews: PhaseReview[];
}

export interface GameReviewResult {
  moveReviews: MoveReview[];
  white: PlayerReview;
  black: PlayerReview;
  reviewDepth: number;         // depth used for review
  engineVersion: string;
  reviewedAt: string;          // ISO timestamp
  openingName: string | null;
  ecoCode: string | null;
  /**
   * Side to move in the game's FIRST position, so consumers can map plyIndex →
   * mover without assuming White started. Absent on results persisted before
   * 2026-07-29; consumers then fall back to `plyIndex % 2 === 0 ⇒ White`, which
   * is wrong for games imported from a black-to-move FEN.
   */
  startingColor?: 'w' | 'b';
  /**
   * Line identity — the exact move-tree line this review was computed on, so
   * playback / glyphs / arrows follow the REVIEWED path instead of blindly
   * walking the mainline (children[0]). `reviewedNodeIds[k]` is the MoveNode id
   * reached after k plies (index 0 = root), so a move at plyIndex j lives at
   * `reviewedNodeIds[j + 1]`. Absent on legacy results — consumers then fall
   * back to decorating mainline nodes only. See getReviewForNode / getNodeIdAtPly.
   */
  reviewedNodeIds?: string[];
  reviewedPathKey?: string;    // reviewedNodeIds.join('/') — cheap path equality
  reviewedLineUciKey?: string; // moveUciList.join(' ') — cheap line equality
}

export interface ReviewProgress {
  currentPly: number;
  totalPlies: number;
  percent: number;
  phase: 'analyzing' | 'complete' | 'idle';
}
