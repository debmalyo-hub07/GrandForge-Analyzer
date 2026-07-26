import mongoose, { Document, Schema } from 'mongoose';

export interface IMasterGame extends Document {
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
  };

  tags: string[];
  featured: boolean;
  createdAt: Date;
}

const MasterGameSchema = new Schema<IMasterGame>({
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
  metadata: {
    white:       { type: String, required: true },
    black:       { type: String, required: true },
    whiteElo:    { type: Number },
    blackElo:    { type: Number },
    event:       { type: String },
    site:        { type: String },
    date:        { type: String },
    result:      { type: String, default: '*' },
    timeControl: { type: String },
    opening:     { type: String },
    ecoCode:     { type: String },
    variant:     { type: String },
  },
  tags:      { type: [String], default: [], index: true },
  featured:  { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now },
});

MasterGameSchema.index({ 'metadata.ecoCode': 1 });
MasterGameSchema.index({ 'metadata.white': 1 });
MasterGameSchema.index({ 'metadata.black': 1 });
MasterGameSchema.index({ featured: 1, createdAt: -1 });

export default (mongoose.models.MasterGame as mongoose.Model<IMasterGame>) || mongoose.model<IMasterGame>('MasterGame', MasterGameSchema);
