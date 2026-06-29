import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * ReviewJob — orchestration record for asynchronous game-review tasks.
 *
 * Architecture note: Stockfish itself runs in the user's browser via a Web
 * Worker (WASM), not on the server. This collection records job state,
 * progress, and final result location so multiple concurrent reviews can be
 * tracked, resumed, and shared across the user's devices without contention.
 *
 * Scale model: each browser tab holds one Stockfish worker. The MongoDB
 * Position cache (separate collection) stores per-position evaluations
 * keyed by (fen, engineVersion, depth) so subsequent reviews of the same
 * position are O(1) DB lookups instead of repeating Stockfish search. This
 * mirrors the federated cloud-eval pattern in lichess-org/lila.
 */

export type ReviewJobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';

export interface IReviewJob extends Document {
  userId?: Types.ObjectId | null;
  gameId?: Types.ObjectId | null;
  /** Stable client-side identifier for resuming a job after a tab reload. */
  clientJobId: string;
  status: ReviewJobStatus;
  depth: number;
  engineVersion: string;
  progress: {
    currentPly: number;
    totalPlies: number;
    percent: number;
  };
  /** Set on `complete` — points at Game.reviewResult or session-scoped result. */
  resultRef?: {
    kind: 'game' | 'session';
    id: Types.ObjectId;
  } | null;
  errorMessage?: string;
  startedAt: Date;
  updatedAt: Date;
  finishedAt?: Date | null;
}

const ReviewJobSchema = new Schema<IReviewJob>({
  userId:        { type: Schema.Types.ObjectId, ref: 'User', index: true, default: null },
  gameId:        { type: Schema.Types.ObjectId, ref: 'Game', index: true, default: null },
  clientJobId:   { type: String, required: true, index: true },
  status:        { type: String, enum: ['queued', 'running', 'complete', 'failed', 'cancelled'], required: true, default: 'queued', index: true },
  depth:         { type: Number, required: true, min: 1, max: 60 },
  engineVersion: { type: String, required: true },
  progress: {
    currentPly: { type: Number, default: 0 },
    totalPlies: { type: Number, default: 0 },
    percent:    { type: Number, default: 0 },
  },
  resultRef: {
    kind: { type: String, enum: ['game', 'session'] },
    id:   { type: Schema.Types.ObjectId },
  },
  errorMessage: { type: String },
  startedAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now },
  finishedAt:   { type: Date, default: null },
});

ReviewJobSchema.index({ userId: 1, status: 1, updatedAt: -1 });
ReviewJobSchema.index({ clientJobId: 1, userId: 1 }, { unique: true, sparse: true });
ReviewJobSchema.index({ updatedAt: -1 });

export default (mongoose.models.ReviewJob as mongoose.Model<IReviewJob>) || mongoose.model<IReviewJob>('ReviewJob', ReviewJobSchema);
