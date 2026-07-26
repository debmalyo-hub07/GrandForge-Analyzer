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

PositionSchema.index({ fen: 1, engineVersion: 1, depth: 1 }, { unique: true });

export default (mongoose.models.Position as mongoose.Model<IPosition>) || mongoose.model<IPosition>('Position', PositionSchema);
