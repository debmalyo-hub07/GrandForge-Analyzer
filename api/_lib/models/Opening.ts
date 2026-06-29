import mongoose, { Document, Schema } from 'mongoose';

/**
 * Opening — ECO + transposition lookup record + lila-openingexplorer-shaped
 * aggregate statistics.
 *
 * Schema compatibility note: `white`, `black`, `draws` aggregates and
 * `topGames` cache mirror the lila-openingexplorer response shape so future
 * sync jobs can ingest Lichess data dumps without remapping. See
 * https://github.com/lichess-org/lila-openingexplorer for the upstream schema.
 */

export interface IOpeningTopGame {
  id: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  result: string;          // '1-0' | '0-1' | '1/2-1/2'
  year?: number;
  month?: string;
}

export interface IOpening extends Document {
  ecoCode: string;
  name: string;
  family: string;
  variation: string;
  pgn: string;
  fen: string;
  moveSequence: string;
  plyDepth: number;

  // ── lila-openingexplorer aggregate stats ──────────────────────────────
  white: number;             // master/lichess games where white won
  black: number;             // games where black won
  draws: number;             // drawn games
  averageRating?: number;    // mean Elo across sampled games
  topGames: IOpeningTopGame[];

  // Rating buckets (Lichess-style histogram): masters / 2500+ / 2200+ / etc.
  byRating?: Array<{
    bucket: string;          // e.g. '2500', '2200', 'masters'
    white: number;
    black: number;
    draws: number;
  }>;

  updatedAt: Date;
}

const OpeningTopGameSchema = new Schema<IOpeningTopGame>({
  id:        { type: String, required: true },
  white:     { type: String, default: '' },
  black:     { type: String, default: '' },
  whiteElo:  { type: Number },
  blackElo:  { type: Number },
  result:    { type: String, required: true },
  year:      { type: Number },
  month:     { type: String },
}, { _id: false });

const OpeningRatingBucketSchema = new Schema<{ bucket: string; white: number; black: number; draws: number }>({
  bucket: { type: String, required: true },
  white:  { type: Number, default: 0 },
  black:  { type: Number, default: 0 },
  draws:  { type: Number, default: 0 },
}, { _id: false });

const OpeningSchema = new Schema<IOpening>({
  ecoCode:      { type: String, required: true, trim: true, index: true },
  name:         { type: String, required: true, trim: true },
  family:       { type: String, required: true, trim: true },
  variation:    { type: String, default: '', trim: true },
  pgn:          { type: String, required: true },
  fen:          { type: String, required: true },
  moveSequence: { type: String, required: true, index: true },
  plyDepth:     { type: Number, required: true, default: 0 },

  white:         { type: Number, default: 0 },
  black:         { type: Number, default: 0 },
  draws:         { type: Number, default: 0 },
  averageRating: { type: Number },
  topGames:      { type: [OpeningTopGameSchema], default: [] },
  byRating:      { type: [OpeningRatingBucketSchema], default: [] },

  updatedAt:    { type: Date, default: Date.now },
});

OpeningSchema.index({ fen: 1 }, { unique: true, sparse: true });
OpeningSchema.index({ ecoCode: 1, plyDepth: 1 });

export default (mongoose.models.Opening as mongoose.Model<IOpening>) || mongoose.model<IOpening>('Opening', OpeningSchema);

