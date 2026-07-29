import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Engine versions — single source of truth for every server enum
// ─────────────────────────────────────────────────────────────

/**
 * The engine ids that actually exist on disk (`ENGINE_CONFIGS` in
 * `frontend/src/services/EngineManager.ts`). Every server-side enum derives
 * from this const so the set can never drift again.
 *
 * `sf18-full` was dropped (113 MB, too heavy for the public deploy) but was
 * still accepted here, letting a client shard the position cache into a
 * namespace no reader queries. `sf18-lite-mt` is the multi-threaded build and
 * was missing, so MT users could neither read nor write the shared cache and
 * could not persist it as their `defaultEngine` (data-audit §2c).
 */
export const ENGINE_VERSION_VALUES = ['sf18-lite', 'sf18-lite-mt', 'sf17-lite', 'sf16-lite'] as const;
export type EngineVersionValue = (typeof ENGINE_VERSION_VALUES)[number];
export const engineVersionSchema = z.enum(ENGINE_VERSION_VALUES);

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
  'forced',
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

  // Set when the engine produced no eval for this ply, so it must be excluded
  // from accuracy / CPL / complexity / counts / phase scoring. Omitted (rather
  // than `false`) on the normal path. Must be declared here or a reloaded
  // review re-scores the ply as a genuine 0cp "Good" move — the same
  // strip-on-save class of bug as the `reviewedNodeIds` loss below.
  unscored: z.boolean().optional(),

  // Where this ply's eval came from (shared cache / tablebase / local search).
  // Informational only, but it must be declared for the same strip-on-save
  // reason as `unscored`: a reloaded review would otherwise report every
  // position as locally searched.
  evalSource: z.enum(['cache', 'tablebase', 'engine']).optional(),
});

const phaseReviewSchema = z.object({
  label: z.enum(['Opening', 'Middlegame', 'Endgame']),
  accuracy: z.number().min(0).max(100),
  icon: z.union([moveClassificationSchema, z.literal('none')]),
  moveCount: z.number().int().min(0).optional().default(0),
  avgCpl: z.number().int().min(0).nullable().optional().default(null),
});

const playerReviewSchema = z.object({
  color: z.enum(['white', 'black']),
  accuracy: z.number().min(0).max(100),
  counts: z.record(moveClassificationSchema, z.number().int().min(0)),
  gameRating: z.number().int().min(0).max(4000).nullable(),
  gameRatingConfidence: z.enum(['none', 'provisional', 'low', 'medium', 'high']).optional().default('none'),
  phaseReviews: z.array(phaseReviewSchema).length(3),
});

export const gameReviewResultSchema = z.object({
  moveReviews: z.array(moveReviewSchema).max(600),
  white: playerReviewSchema,
  black: playerReviewSchema,
  reviewDepth: z.number().int().min(1).max(40),
  engineVersion: z.string().min(1).max(40),
  reviewedAt: z.string().min(1),
  openingName: z.string().nullable(),
  ecoCode: z.string().nullable(),

  // Side to move at ply 0, derived from the starting FEN. `'w'`/`'b'` (the
  // chess.js / FEN spelling), NOT `'white'`/`'black'` as `playerReviewSchema`
  // uses for colors. Absent on legacy results, where consumers assume 'w'.
  // Stripping it would flip every move to the wrong player on a review of a
  // game that starts with black to move.
  startingColor: z.enum(['w', 'b']).optional(),

  // Review line identity (see CLAUDE.md "Review line identity"). These pin a
  // saved review to the exact move-tree line it was computed on. They must be
  // declared explicitly: this is a strip-mode `z.object`, so before they were
  // listed here they were silently dropped on save and every reloaded review
  // fell back to mainline-only glyph decoration — the exact bug
  // `reviewedNodeIds` was introduced to fix (data-audit §2d).
  // Explicit fields rather than `.passthrough()`, which would reopen the
  // shape-drift class of bug documented in backend-audit F13.
  reviewedNodeIds: z.array(z.string().max(64)).max(600).optional(),
  reviewedPathKey: z.string().max(40_000).optional(),
  reviewedLineUciKey: z.string().max(6_000).optional(),
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
