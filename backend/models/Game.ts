import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IGameReviewMove {
  plyIndex: number;
  san: string;
  uci: string;
  classification: string;
  evalBefore: number;
  evalAfter: number;
  cpl: number;
  bestMoveUci: string;
  bestMoveSan: string;
  isBookMove: boolean;
  isBrilliant: boolean;
  mateBefore: number | null;
  mateAfter: number | null;
  pvLine: string[];
}

export interface IGamePlayerReview {
  accuracy: number;
  gameRating: number | null;
  gameRatingConfidence?: 'none' | 'provisional' | 'low' | 'medium' | 'high';
  counts: Record<string, number>;
  phaseReviews: Array<{ label: string; accuracy: number; icon: string; moveCount?: number; avgCpl?: number | null }>;
}

export interface IGameReviewResult {
  moveReviews: IGameReviewMove[];
  white: IGamePlayerReview;
  black: IGamePlayerReview;
  reviewDepth: number;
  engineVersion: string;
  reviewedAt: string;
  openingName: string | null;
  ecoCode: string | null;
}

export interface IGame extends Document {
  userId?: Types.ObjectId;
  pgn: string;

  fenPositions: string[];
  moveUciList: string[];
  moveSanList: string[];
  plyCount: number;
  engineReady: boolean;
  phase: {
    openingEndsAtPly: number;
    middlegameEndsAtPly: number;
    isEndgame: boolean;
  };

  reviewResult?: IGameReviewResult | null;

  metadata: {
    white: string;
    black: string;
    whiteElo?: number;
    blackElo?: number;
    event?: string;
    site?: string;
    date?: string;
    result: string;
    timeControl?: string;
    opening?: string;
    ecoCode?: string;
    variant?: string;
    source: 'chesscom' | 'lichess' | 'pgn_upload' | 'master';
    sourceGameId?: string;
    sourceUrl?: string;
    importedAt: Date;
  };
  createdAt: Date;
}

const GameSchema = new Schema<IGame>({
  userId:       { type: Schema.Types.ObjectId, ref: 'User', index: true },
  pgn:          { type: String, required: true },
  fenPositions: { type: [String], required: true, default: [] },
  moveUciList:  { type: [String], required: true, default: [] },
  moveSanList:  { type: [String], required: true, default: [] },
  plyCount:     { type: Number, required: true, default: 0 },
  engineReady:  { type: Boolean, required: true, default: false, index: true },
  phase: {
    openingEndsAtPly:    { type: Number, default: 0 },
    middlegameEndsAtPly: { type: Number, default: 0 },
    isEndgame:           { type: Boolean, default: false },
  },
  reviewResult: { type: Schema.Types.Mixed, default: null },
  metadata: {
    white:        { type: String, default: '' },
    black:        { type: String, default: '' },
    whiteElo:     { type: Number },
    blackElo:     { type: Number },
    event:        { type: String },
    site:         { type: String },
    date:         { type: String },
    result:       { type: String, default: '*' },
    timeControl:  { type: String },
    opening:      { type: String },
    ecoCode:      { type: String },
    variant:      { type: String },
    source:       { type: String, enum: ['chesscom', 'lichess', 'pgn_upload', 'master'], required: true },
    sourceGameId: { type: String, index: true },
    sourceUrl:    { type: String },
    importedAt:   { type: Date, default: Date.now },
  },
  createdAt: { type: Date, default: Date.now },
});

GameSchema.index({ userId: 1, 'metadata.importedAt': -1 });
GameSchema.index({ 'metadata.ecoCode': 1 });
// SEC-1: scope the source-game uniqueness to the owner so each user gets their
// OWN imported copy of a shared game. Previously keyed on
// (source, sourceGameId) globally, which let user B's import hijack user A's
// document (userId + reviewResult overwrite). userId is part of the key now;
// anonymous imports (userId null) still collide under the sparse index, which
// is the intended "one shared anonymous copy" behavior.
GameSchema.index(
  { 'metadata.source': 1, 'metadata.sourceGameId': 1, userId: 1 },
  { unique: true, sparse: true }
);

export default (mongoose.models.Game as mongoose.Model<IGame>) || mongoose.model<IGame>('Game', GameSchema);
