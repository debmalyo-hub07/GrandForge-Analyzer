import mongoose, { Document, Schema } from 'mongoose';

/**
 * TablebaseEntry — Mongo cache for Syzygy tablebase lookups.
 *
 * Tablebase positions are mathematically immutable, so an entry is never
 * *wrong* — but at ~3 KB/doc and ~170k reachable ≤7-piece positions the
 * collection would happily consume the 512 MB tier on its own, so entries
 * expire after 180 days (data-audit §2f). Upstream is free and the proxy is
 * cache-aside, so an expired entry costs one transparent re-fetch.
 *
 * Stored mover-relative `(cp, mate)` so the client can consume them without
 * re-deriving sign convention.
 *
 * Source: https://tablebase.lichess.ovh/standard
 */

export interface ITablebaseMove {
  uci: string;
  san: string;
  category: string;       // 'win' | 'loss' | 'draw' | ...
  dtz: number | null;
  dtm: number | null;
  zeroing: boolean;
  checkmate: boolean;
  stalemate: boolean;
}

export interface ITablebaseEntry extends Document {
  fen: string;
  category: string;
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficient_material: boolean;
  moves: ITablebaseMove[];
  fetchedAt: Date;
}

const TablebaseMoveSchema = new Schema<ITablebaseMove>({
  uci:       { type: String, required: true },
  san:       { type: String, default: '' },
  category:  { type: String, required: true },
  dtz:       { type: Number, default: null },
  dtm:       { type: Number, default: null },
  zeroing:   { type: Boolean, default: false },
  checkmate: { type: Boolean, default: false },
  stalemate: { type: Boolean, default: false },
}, { _id: false });

const TablebaseEntrySchema = new Schema<ITablebaseEntry>({
  fen:                   { type: String, required: true, unique: true },
  category:              { type: String, required: true },
  dtz:                   { type: Number, default: null },
  dtm:                   { type: Number, default: null },
  checkmate:             { type: Boolean, default: false },
  stalemate:             { type: Boolean, default: false },
  insufficient_material: { type: Boolean, default: false },
  moves:                 { type: [TablebaseMoveSchema], default: [] },
  fetchedAt:             { type: Date, default: Date.now },
});

TablebaseEntrySchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 15_552_000 });

export default (mongoose.models.TablebaseEntry as mongoose.Model<ITablebaseEntry>)
  || mongoose.model<ITablebaseEntry>('TablebaseEntry', TablebaseEntrySchema);
