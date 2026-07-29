/**
 * Opening-explorer DTOs — the shape `GET /api/explorer/lookup` returns.
 *
 * Mirrors `backend/routes/explorer/lookup.ts`. The aggregate is our own
 * (`explorerNodes` in MongoDB, built offline by `scripts/ingestExplorer.ts`), so
 * there is no third-party response shape to conform to and no external link to
 * carry — `topGames` is names, ratings, result and year, nothing more.
 */

/** One candidate move from a position, with its record across the corpus. */
export interface ExplorerMove {
  uci: string;
  san: string;
  /** Games in the corpus that played this move from here. */
  total: number;
  white: number;
  draws: number;
  black: number;
  /**
   * Fraction of games from this position that chose this move, 0..1.
   * Computed server-side against the *position* total, not the summed move
   * totals — games can end at a position, so the two differ.
   */
  share: number;
}

/** A representative game, kept only for positions inside opening territory. */
export interface ExplorerTopGame {
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  result: '1-0' | '0-1' | '1/2-1/2';
  year: number;
}

export interface ExplorerNode {
  /** Normalized (4-field) FEN this row is keyed by. */
  fen: string;
  total: number;
  white: number;
  draws: number;
  black: number;
  /** Mean rating of both players over *rated* games here, or null if none were. */
  avgElo: number | null;
  moves: ExplorerMove[];
  topGames: ExplorerTopGame[];
}

/** The matched ECO opening, returned alongside the node when `moves` is sent. */
export interface ExplorerOpening {
  ecoCode: string;
  name: string;
  family: string;
  variation?: string;
  moveSequence: string;
  plyDepth: number;
  /** Our own theory prose. Absent until the position's opening has been written. */
  description?: string;
}

export interface ExplorerLookupResponse {
  /** null when the position is absent from the corpus or below the report floor. */
  node: ExplorerNode | null;
  opening: ExplorerOpening | null;
}
