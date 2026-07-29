import mongoose, { Document, Schema } from 'mongoose';

export interface IPositionLine {
  multipv: number;
  uciMoves: string[];
  sanMoves: string[];
  scoreType: 'cp' | 'mate';
  scoreValue: number;
}

/**
 * A disagreeing submission held aside. See `positionCacheGuards.ts` — a write
 * that contradicts a trusted entry lands here instead of overwriting it, and only
 * becomes the primary once independently confirmed in its own right.
 */
export interface IPositionChallenger {
  depth: number;
  evaluation: {
    cp: number | null;
    mate: number | null;
    turn: 'w' | 'b';
  };
  lines: IPositionLine[];
  confirmations: number;
  contributors: string[];
  firstSeenAt: Date;
}

export interface IPosition extends Document {
  fen: string;
  engineVersion: string;
  depth: number;
  evaluation: {
    cp: number | null;
    mate: number | null;
    turn: 'w' | 'b';
  };
  lines: IPositionLine[];
  nodesSearched: number;
  computedAt: Date;
  /**
   * How many independent submissions back this evaluation. Readers are only
   * served an entry at or above `TRUST_THRESHOLD`, which is what turns cache
   * poisoning from "one anonymous POST" into sustained coordinated effort.
   */
  confirmations: number;
  /** Opaque contributor keys (`u:<userId>` or a salted IP hash) — never raw IPs.
   *  Exists so one writer cannot confirm their own entry, and so a bad batch is
   *  purgeable without storing PII. */
  contributors: string[];
  challenger?: IPositionChallenger | null;
}

const PositionLineSchema = new Schema<IPositionLine>({
  multipv:    { type: Number, required: true },
  uciMoves:   { type: [String], default: [] },
  sanMoves:   { type: [String], default: [] },
  scoreType:  { type: String, enum: ['cp', 'mate'], required: true },
  scoreValue: { type: Number, required: true },
}, { _id: false });

const PositionChallengerSchema = new Schema<IPositionChallenger>({
  depth: { type: Number, required: true, min: 1, max: 60 },
  evaluation: {
    cp:   { type: Number, default: null },
    mate: { type: Number, default: null },
    turn: { type: String, enum: ['w', 'b'], required: true },
  },
  lines:         { type: [PositionLineSchema], default: [] },
  confirmations: { type: Number, default: 1, min: 1 },
  contributors:  { type: [String], default: [] },
  firstSeenAt:   { type: Date, default: Date.now },
}, { _id: false });

const PositionSchema = new Schema<IPosition>({
  fen:           { type: String, required: true },
  engineVersion: { type: String, required: true },
  depth:         { type: Number, required: true, min: 1, max: 50 },
  evaluation: {
    cp:   { type: Number, default: null },
    mate: { type: Number, default: null },
    turn: { type: String, enum: ['w', 'b'], required: true },
  },
  lines:         { type: [PositionLineSchema], default: [] },
  nodesSearched: { type: Number, default: 0 },
  computedAt:    { type: Date, default: Date.now },
  // Defaults to 1 rather than 0 so a row counts as its own first submission.
  // Rows written before this field existed have no value at all, so the reader's
  // `confirmations: {$gte: TRUST_THRESHOLD}` filter simply doesn't match them:
  // they are treated as untrusted until someone re-submits the position. No
  // migration is needed — and there is almost nothing to migrate, since writes
  // required an account and the auth pages were never routed.
  confirmations: { type: Number, default: 1, min: 0 },
  contributors:  { type: [String], default: [] },
  challenger:    { type: PositionChallengerSchema, default: null },
});

// The upsert in `routes/positions/cache.ts` filters on (fen, engineVersion),
// so the unique key must be exactly that. It used to include `depth`, which
// left the actual write key unprotected: two concurrent first-writes at
// different depths produced two permanent rows for the same position, and a
// later deeper write could then read the shallower row, pass the depth guard,
// and collide with its sibling → E11000 → 500 (data-audit §2b, backend F4).
// `depth` stays an ordinary field; the "deepest wins" guard reads it.
PositionSchema.index({ fen: 1, engineVersion: 1 }, { unique: true });
// 60-day TTL. `routes/positions/eval.ts` bumps `computedAt` on every cache
// hit, which turns this from a time-to-live-from-creation clock into an LRU:
// positions people actually revisit survive, one-off middlegame FENs (which
// nobody ever transposes back into) age out. `positions` is the collection
// that exhausts the 512 MB tier first — global, ownerless, and previously
// unprunable (data-audit §4).
PositionSchema.index({ computedAt: 1 }, { expireAfterSeconds: 5_184_000 });

export default (mongoose.models.Position as mongoose.Model<IPosition>) || mongoose.model<IPosition>('Position', PositionSchema);
