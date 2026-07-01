export type MoveClassification =
  | 'brilliant'    // !! — best move AND a sacrifice/quiet move found by engine, CPL ≤ 0
  | 'great'        // !  — best move (top engine choice), CPL ≤ 0
  | 'book'         // 📖 — a known opening theory move
  | 'best'         // ★  — best move, CPL ≤ 5
  | 'excellent'    // 👍 — very good move, CPL ≤ 15
  | 'good'         // ✓  — good move, CPL ≤ 30
  | 'inaccuracy'   // ?! — inaccuracy, CPL 31–90
  | 'mistake'      // ?  — mistake, CPL 91–200
  | 'miss'         // ✗  — missed a forced win (engine had M# but player didn't play it)
  | 'blunder';     // ?? — blunder, CPL > 200 or drops mating combination

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
  /** Estimated performance rating, or null when too few moves to estimate (<5). */
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
}

export interface ReviewProgress {
  currentPly: number;
  totalPlies: number;
  percent: number;
  phase: 'analyzing' | 'complete' | 'idle';
}
