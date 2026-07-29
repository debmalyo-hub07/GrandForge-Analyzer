import mongoose, { Document, Schema } from 'mongoose';

/**
 * Opening — ECO name + transposition lookup record, plus per-opening aggregate
 * statistics and own-authored theory prose (`description`).
 *
 * Scope note: this collection is the ECO *book* — it answers "what is this line
 * called, and what should a player know about it". Per-position game statistics
 * (counts, W/D/L, top games) live in `ExplorerNode`, keyed by normalized FEN and
 * built by `scripts/ingestExplorer.ts`. The `white`/`black`/`draws`/`topGames`
 * fields here predate that split and are seeded per-opening; new statistics work
 * belongs in `ExplorerNode`, which merges transpositions correctly.
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

  /**
   * Own-authored theory prose for this opening, shown in the Explore panel above
   * the statistics (design decision D2). Seeded by
   * `scripts/seedOpeningTheory.ts` from `scripts/data/openingTheory/` (one file
   * per ECO letter), which is the reviewable source of truth — absent for the
   * long tail of openings, where the panel shows the ECO name and statistics
   * alone.
   *
   * This text is written for GrandForge. Nothing is copied from, or derived
   * from, another platform's opening articles.
   */
  description?: string;

  // ── Aggregate stats ───────────────────────────────────────────────────
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
  ecoCode:      { type: String, required: true, trim: true },
  name:         { type: String, required: true, trim: true },
  family:       { type: String, required: true, trim: true },
  variation:    { type: String, default: '', trim: true },
  pgn:          { type: String, required: true },
  fen:          { type: String, required: true },
  moveSequence: { type: String, required: true, index: true },
  plyDepth:     { type: Number, required: true, default: 0 },

  // Bounded so a bad seed run can't push arbitrarily large prose into a
  // collection that is otherwise a few hundred bytes per row.
  description:  { type: String, maxlength: 2000 },

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

