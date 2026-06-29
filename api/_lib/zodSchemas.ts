import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  username: z.string().trim().min(3).max(30),
  password: z.string().min(8).max(128),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updatePreferencesSchema = z
  .object({
    boardTheme: z.string().min(1).max(40).optional(),
    pieceSet: z.string().min(1).max(40).optional(),
    defaultEngine: z.enum(['sf18-lite', 'sf18-full', 'sf17-lite', 'sf16-lite']).optional(),
    defaultDepth: z.number().int().min(1).max(30).optional(),
    defaultMultiPV: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
    showCoordinates: z.boolean().optional(),
    showLegalMoves: z.boolean().optional(),
    animationSpeed: z.enum(['fast', 'normal', 'slow']).optional(),
    inlineNotation: z.boolean().optional(),
    disclosureButtons: z.boolean().optional(),
    moveAnnotations: z.boolean().optional(),
    variationOpacity: z.number().min(0).max(100).optional(),
  })
  .strict();
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

// ─────────────────────────────────────────────────────────────
// Games
// ─────────────────────────────────────────────────────────────

export const uploadPgnSchema = z.object({
  pgn: z.string().min(1).max(500_000),
  metadata: z
    .object({
      white: z.string().max(120).optional(),
      black: z.string().max(120).optional(),
      whiteElo: z.number().int().min(0).max(4000).optional(),
      blackElo: z.number().int().min(0).max(4000).optional(),
      event: z.string().max(200).optional(),
      site: z.string().max(200).optional(),
      date: z.string().max(40).optional(),
      result: z.string().max(20).optional(),
      timeControl: z.string().max(60).optional(),
      opening: z.string().max(200).optional(),
      ecoCode: z.string().max(10).optional(),
      variant: z.string().max(40).optional(),
    })
    .optional(),
});
export type UploadPgnInput = z.infer<typeof uploadPgnSchema>;

// ─────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────

export const createSessionSchema = z.object({
  pgn: z.string().min(1).max(500_000),
  title: z.string().max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const updateSessionSchema = z.object({
  title: z.string().max(200).optional(),
  pgn: z.string().min(1).max(500_000).optional(),
  notes: z.string().max(50_000).optional(),
  isPublic: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

// ─────────────────────────────────────────────────────────────
// Import
// ─────────────────────────────────────────────────────────────

export const importChessComSchema = z.object({
  username: z.string().trim().min(1).max(50),
  type: z.enum(['bullet', 'blitz', 'rapid', 'classical', 'all']).optional(),
  count: z.coerce.number().int().min(1).max(50).optional(),
});
export type ImportChessComInput = z.infer<typeof importChessComSchema>;

export const importLichessSchema = z.object({
  username: z.string().trim().min(1).max(50),
  perfType: z.enum(['bullet', 'blitz', 'rapid', 'classical', 'correspondence', 'all']).optional(),
  count: z.coerce.number().int().min(1).max(50).optional(),
});
export type ImportLichessInput = z.infer<typeof importLichessSchema>;

// ─────────────────────────────────────────────────────────────
// Review
// ─────────────────────────────────────────────────────────────

const moveClassificationSchema = z.enum([
  'brilliant',
  'great',
  'book',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
]);

const moveReviewSchema = z.object({
  plyIndex: z.number().int().min(0),
  san: z.string().min(1).max(20),
  uci: z.string().min(4).max(6),
  classification: moveClassificationSchema,
  evalBefore: z.number(),
  evalAfter: z.number(),
  cpl: z.number().min(0),
  bestMoveUci: z.string().min(0).max(6),
  bestMoveSan: z.string().min(0).max(20),
  bestMoveEval: z.number(),
  isBookMove: z.boolean(),
  isBrilliant: z.boolean(),
  mateBefore: z.number().nullable(),
  mateAfter: z.number().nullable(),
  pvLine: z.array(z.string()).max(50),
  complexity: z.number().min(0).max(1).optional().default(0),
  reason: z.string().max(500).optional().default(''),
});

const phaseReviewSchema = z.object({
  label: z.enum(['Opening', 'Middlegame', 'Endgame']),
  accuracy: z.number().min(0).max(100),
  icon: z.union([moveClassificationSchema, z.literal('none')]),
});

const playerReviewSchema = z.object({
  color: z.enum(['white', 'black']),
  accuracy: z.number().min(0).max(100),
  counts: z.record(moveClassificationSchema, z.number().int().min(0)),
  gameRating: z.number().int().min(0).max(4000).nullable(),
  phaseReviews: z.array(phaseReviewSchema).length(3),
});

export const gameReviewResultSchema = z.object({
  moveReviews: z.array(moveReviewSchema),
  white: playerReviewSchema,
  black: playerReviewSchema,
  reviewDepth: z.number().int().min(1).max(40),
  engineVersion: z.string().min(1).max(40),
  reviewedAt: z.string().min(1),
  openingName: z.string().nullable(),
  ecoCode: z.string().nullable(),
});
export type GameReviewResultInput = z.infer<typeof gameReviewResultSchema>;

export const reviewSaveSchema = z
  .object({
    gameId: z.string().min(1).max(64).optional(),
    sessionId: z.string().min(1).max(64).optional(),
    reviewResult: gameReviewResultSchema,
  })
  .refine((data) => Boolean(data.gameId) || Boolean(data.sessionId), {
    message: 'Either gameId or sessionId must be provided',
  });
export type ReviewSaveInput = z.infer<typeof reviewSaveSchema>;

// ─────────────────────────────────────────────────────────────
// Positions
// ─────────────────────────────────────────────────────────────

export const positionEvalQuerySchema = z.object({
  fen: z.string().min(1).max(120),
  engine: z.enum(['sf18-lite', 'sf18-full', 'sf17-lite', 'sf16-lite']).optional(),
});
export type PositionEvalQueryInput = z.infer<typeof positionEvalQuerySchema>;

export const positionCacheSchema = z.object({
  fen: z.string().min(1).max(120),
  engineVersion: z.enum(['sf18-lite', 'sf18-full', 'sf17-lite', 'sf16-lite']),
  depth: z.number().int().min(1).max(40),
  evaluation: z.object({
    cp: z.number().nullable().optional(),
    mate: z.number().nullable().optional(),
  }),
  lines: z
    .array(
      z.object({
        multipv: z.number().int().min(1).max(5),
        cp: z.number().nullable().optional(),
        mate: z.number().nullable().optional(),
        pv: z.array(z.string()),
      })
    )
    .max(5),
});
export type PositionCacheInput = z.infer<typeof positionCacheSchema>;
