import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ISession extends Document {
  userId: Types.ObjectId;
  title: string;
  pgn: string;
  currentNodeId: string | null;
  moveTree: Record<string, unknown>;
  notes: string;
  tags: string[];
  isPublic: boolean;
  reviewResult?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<ISession>({
  userId:        { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title:         { type: String, required: true, trim: true, default: 'Untitled session' },
  pgn:           { type: String, required: true, default: '' },
  currentNodeId: { type: String, default: null },
  moveTree:      { type: Schema.Types.Mixed, default: {} },
  notes:         { type: String, default: '' },
  tags:          { type: [String], default: [] },
  isPublic:      { type: Boolean, default: false, index: true },
  reviewResult:  { type: Schema.Types.Mixed, default: null },
  createdAt:     { type: Date, default: Date.now },
  updatedAt:     { type: Date, default: Date.now },
});

SessionSchema.index({ userId: 1, updatedAt: -1 });

SessionSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

export default (mongoose.models.Session as mongoose.Model<ISession>) || mongoose.model<ISession>('Session', SessionSchema);
