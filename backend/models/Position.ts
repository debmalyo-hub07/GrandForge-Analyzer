import mongoose, { Document, Schema } from 'mongoose';

export interface IPositionLine {
  multipv: number;
  uciMoves: string[];
  sanMoves: string[];
  scoreType: 'cp' | 'mate';
  scoreValue: number;
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
}

const PositionLineSchema = new Schema<IPositionLine>({
  multipv:    { type: Number, required: true },
  uciMoves:   { type: [String], default: [] },
  sanMoves:   { type: [String], default: [] },
  scoreType:  { type: String, enum: ['cp', 'mate'], required: true },
  scoreValue: { type: Number, required: true },
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
