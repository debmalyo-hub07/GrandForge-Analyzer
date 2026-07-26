import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  email: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  preferences: {
    boardTheme: string;
    pieceSet: string;
    defaultEngine: 'sf18-lite' | 'sf18-full' | 'sf17-lite' | 'sf16-lite';
    defaultDepth: number;
    defaultMultiPV: 1 | 2 | 3 | 4 | 5;
    showCoordinates: boolean;
    showLegalMoves: boolean;
    animationSpeed: 'fast' | 'normal' | 'slow';
    inlineNotation: boolean;
    disclosureButtons: boolean;
    moveAnnotations: boolean;
    variationOpacity: number;
  };
  stats: {
    totalSessions: number;
    totalGamesImported: number;
    lastActiveAt: Date;
  };
}

const UserSchema = new Schema<IUser>({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  username:     { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
  passwordHash: { type: String, required: true },
  createdAt:    { type: Date, default: Date.now },
  preferences: {
    boardTheme:        { type: String, default: 'brown' },
    pieceSet:          { type: String, default: 'cburnett' },
    defaultEngine:     { type: String, enum: ['sf18-lite', 'sf18-full', 'sf17-lite', 'sf16-lite'], default: 'sf18-lite' },
    defaultDepth:      { type: Number, default: 20, min: 1, max: 30 },
    defaultMultiPV:    { type: Number, default: 1, min: 1, max: 5 },
    showCoordinates:   { type: Boolean, default: true },
    showLegalMoves:    { type: Boolean, default: true },
    animationSpeed:    { type: String, enum: ['fast', 'normal', 'slow'], default: 'normal' },
    inlineNotation:    { type: Boolean, default: false },
    disclosureButtons: { type: Boolean, default: false },
    moveAnnotations:   { type: Boolean, default: true },
    variationOpacity:  { type: Number, default: 50, min: 0, max: 100 },
  },
  stats: {
    totalSessions:      { type: Number, default: 0 },
    totalGamesImported: { type: Number, default: 0 },
    lastActiveAt:       { type: Date, default: Date.now },
  },
});

export default (mongoose.models.User as mongoose.Model<IUser>) || mongoose.model<IUser>('User', UserSchema);
