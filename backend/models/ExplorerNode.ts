import mongoose, { Document, Schema } from 'mongoose';

/**
 * ExplorerNode — one aggregated position in the self-hosted opening explorer.
 *
 * Built once, offline, by `scripts/ingestExplorer.ts` from a CC0-derived game
 * corpus; served by `GET /api/explorer/lookup`. There are **no runtime
 * third-party calls** anywhere in the explorer feature — that independence is
 * the whole point of self-hosting the aggregate rather than proxying somebody
 * else's explorer API.
 *
 * Deliberately NOT folded into `Position`: different key semantics (a position
 * aggregate vs. an engine eval keyed by engine+depth) and an opposite retention
 * policy (explorer rows are permanent and rebuilt by re-ingest; `Position` is
 * TTL'd as an LRU cache). Sharing one collection would mean either TTL-ing the
 * explorer away or removing the cache's only storage bound.
 *
 * Sizing: ~450-750 B/doc, ~250-400 K docs at the recommended ingest bounds
 * (depth 20 plies, min 8 games) ⇒ ~150-280 MB. Atlas M0 is 512 MB total and
 * `positions` shares it, hence the ingest budget guard.
 * Design + sizing math: docs/superpowers/audits/explorer-design.md.
 */

/**
 * One candidate move from a position, with the results of the games that played
 * it. `white`/`draws`/`black` are outcome counts of the *game*, not of the
 * mover — a `white` here means White eventually won, whichever side moved.
 */
export interface IExplorerMove {
  uci: string;
  san: string;
  total: number;
  white: number;
  draws: number;
  black: number;
}

/**
 * A representative high-rating game reaching this position. Stored only for
 * shallow plies (opening territory) because that is the only place a handful of
 * named games is informative rather than arbitrary.
 *
 * No source-platform id or URL is stored: the explorer must not link out to,
 * or otherwise disclose, where the corpus came from (project independence
 * constraint). Player names, Elos, result and year are game facts.
 */
export interface IExplorerTopGame {
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  result: '1-0' | '0-1' | '1/2-1/2';
  year: number;
}

export interface IExplorerNode extends Document<string> {
  /** Normalized 4-field FEN — see `normalizeExplorerFen`. */
  _id: string;
  total: number;
  white: number;
  draws: number;
  black: number;
  /**
   * Sum of both players' Elos over the games where both ratings were known, so
   * the average is `eloSum / (2 * eloGames)`. Stored as a sum rather than a mean
   * so a re-ingest can merge months additively without weighting bugs.
   */
  eloSum: number;
  /**
   * Games contributing to `eloSum` — the divisor for the average, and NOT the
   * same as `total`. A corpus with unrated or header-less games has
   * `eloGames < total`; dividing by `total` would then report an average
   * hundreds of points below the real one, and the shortfall would grow with
   * exactly the games that carry no rating information at all.
   */
  eloGames: number;
  /**
   * Shallowest ply at which this position was ever reached (0-based; 0 = the
   * initial position). The ingest prune and the `topGames` cutoff both key off
   * it: a position first seen at ply 4 is opening theory even if some game
   * transposed into it at ply 30.
   *
   * Named for what it holds. The design doc called this `maxPly` while
   * describing it as "shallowest ply seen" — the name was simply wrong, and
   * nothing had been built against it yet.
   */
  minPly: number;
  moves: IExplorerMove[];
  topGames: IExplorerTopGame[];
}

/**
 * Normalize a FEN to the explorer's key form: the first four fields (piece
 * placement, side to move, castling rights, en-passant target), dropping the
 * halfmove clock and fullmove number.
 *
 * Identical convention to `normalizeFenForCache` in
 * `frontend/src/services/positionCache.ts` — kept as a separate copy rather
 * than imported because the backend must not depend on frontend sources (the
 * server build compiles `backend/**` alone). Parity is unit-tested.
 *
 * Transpositions merge naturally under this key, which is the reason the
 * explorer aggregates on FEN rather than on a move sequence.
 */
export function normalizeExplorerFen(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return fen.trim();
  return parts.slice(0, 4).join(' ');
}

const ExplorerMoveSchema = new Schema<IExplorerMove>({
  uci:   { type: String, required: true },
  san:   { type: String, required: true },
  total: { type: Number, required: true, default: 0 },
  white: { type: Number, required: true, default: 0 },
  draws: { type: Number, required: true, default: 0 },
  black: { type: Number, required: true, default: 0 },
}, { _id: false });

const ExplorerTopGameSchema = new Schema<IExplorerTopGame>({
  white:    { type: String, default: '' },
  black:    { type: String, default: '' },
  whiteElo: { type: Number, default: 0 },
  blackElo: { type: Number, default: 0 },
  result:   { type: String, enum: ['1-0', '0-1', '1/2-1/2'], required: true },
  year:     { type: Number, default: 0 },
}, { _id: false });

const ExplorerNodeSchema = new Schema<IExplorerNode>({
  // The normalized FEN IS the primary key, so the only index this collection
  // needs is the free `_id` one. Every read is a point lookup by FEN; there is
  // no query that sorts or ranges over these documents. On a 512 MB tier a
  // secondary index over 300 K string keys is real money for no benefit.
  _id:     { type: String, required: true },
  total:   { type: Number, required: true, default: 0 },
  white:   { type: Number, required: true, default: 0 },
  draws:   { type: Number, required: true, default: 0 },
  black:   { type: Number, required: true, default: 0 },
  eloSum:  { type: Number, required: true, default: 0 },
  eloGames:{ type: Number, required: true, default: 0 },
  minPly:  { type: Number, required: true, default: 0 },
  moves:   { type: [ExplorerMoveSchema], default: [] },
  topGames:{ type: [ExplorerTopGameSchema], default: [] },
}, {
  // `_id` is our own string, and there is no created/updated semantics to
  // track: a re-ingest replaces counters wholesale.
  _id: false,
  versionKey: false,
  timestamps: false,
  collection: 'explorernodes',
});

export default (mongoose.models.ExplorerNode as mongoose.Model<IExplorerNode>) ||
  mongoose.model<IExplorerNode>('ExplorerNode', ExplorerNodeSchema);
