# exec-data — Tasks 3, 5 (backend half), 6, 14, 15

Agent: data/models/zod cluster. Started 2026-07-29.
Plan: `docs/superpowers/plans/2026-07-28-phase0-1-correctness.md`
Audits read: data-audit §0, §1c, §2a–§2f, §4; backend-audit F3, F4, F13, §3 (1)(4)(6)(13)(14).

## Pre-flight observations

- `backend/zodSchemas.ts:105` `moveClassificationSchema` **already contains `'forced'`** — Task 1
  landed before this cluster started. No action needed there.
- Confirmed by grep that the 8 F13 schemas have **zero importers**: the only `loginSchema` /
  `registerSchema` hits outside `zodSchemas.ts` are route-local `const` declarations in
  `backend/routes/auth/{login,register}.ts`. Safe to delete all 8 plus their exported types.
- Confirmed `backend/openingBook.ts` (`loadOpeningFens`) is imported nowhere in `backend/`,
  `scripts/`, or `api/`. Safe to delete.
- Confirmed `node-fetch` has zero imports anywhere in the repo.
- Confirmed the POST `/api/positions/cache` response body is **never read** by the client
  (`frontend/src/services/positionCache.ts:118-131` awaits and discards), so shrinking the
  response to `{ ok, depth }` is not a breaking change.

## Log

### RED — failing tests first

Created `backend/models/Game.index.test.ts` (17 cases, pure — reads `schema.indexes()`, no DB)
and extended `backend/zodSchemas.test.ts` (+17 cases). First run: **11 failed / 6 passed**,
each failure for the audited reason.

### Task 3 — sparse compound unique → partial filter (data-audit §0, Critical)

`backend/models/Game.ts`: the dedupe index is now
`{ unique: true, partialFilterExpression: { 'metadata.sourceGameId': { $type: 'string' } } }`.
The SEC-1 comment is kept and extended to explain *why* `sparse` was wrong (a compound sparse
index covers a document holding **any** of the keys, and `metadata.source` is `required`, so
every `pgn_upload` row shared the key `{pgn_upload, null, <userId|null>}`).

### Task 5 (backend half) — engine-version enum unified

`backend/zodSchemas.ts` now exports `ENGINE_VERSION_VALUES`
(`['sf18-lite','sf18-lite-mt','sf17-lite','sf16-lite']`), `EngineVersionValue`, and
`engineVersionSchema`. Consumed by `routes/positions/cache.ts`, `routes/positions/eval.ts`
(new), `routes/auth/preferences.ts`, `models/User.ts` (both the TS interface and the mongoose
`enum`, spread to a mutable array). `sf18-full` is gone from every server enum.
Frontend files deliberately untouched — owned by another agent.

A source-scanning test guards the wiring: each consumer must not contain the literal
`'sf18-full'` and must reference `ENGINE_VERSION_VALUES`. First cut asserted on the bare
substring and failed on my own explanatory comment in `zodSchemas.ts`; tightened to the quoted
form so prose about the dropped build is still allowed.

### Task 6 — review line identity round-trips (data-audit §2d)

`gameReviewResultSchema` gains explicit optional `reviewedNodeIds`
(`z.array(z.string().max(64)).max(600)`), `reviewedPathKey` (`max(40_000)`),
`reviewedLineUciKey` (`max(6_000)`), and `moveReviews` gains `.max(600)` (§2e). Explicit
fields, not `.passthrough()` — F13 is about loose shapes causing exactly this class of drift.
Tests cover the three-field round trip, a legacy result with none of them, and both 601-entry
rejections.

`backend/models/Game.ts` `IGameReviewMove` / `IGameReviewResult` were also missing
`bestMoveEval`, `complexity`, `reason` and the three identity fields that the zod schema and
the client both produce (§2d, cosmetic — the mongoose path is `Mixed`). Added so the interface
describes what is actually stored.

### Task 14 — Position integrity, TTL/LRU policy, dead-code sweep

- `models/Position.ts`: unique index → `{fen: 1, engineVersion: 1}` (matches the upsert filter;
  `depth` stays an ordinary field). New TTL `{computedAt: 1}` 60 d.
- `routes/positions/cache.ts`: `lines` `.max(5)`; each `pv` `.max(64)` items and every entry
  must match `/^[a-h][1-8][a-h][1-8][qrbn]?$/`; depth guard is now
  `findOne(...).sort({depth: -1})`; both responses are `{ ok, depth }` (+`skipped`) instead of
  echoing the stored row.
- `routes/positions/eval.ts`: zod query validation (`fen`/`engine`/`depth`, engine constrained
  to `ENGINE_VERSION_VALUES`), and the read is now a `findOneAndUpdate` that `$set`s
  `computedAt` — one round trip, so the LRU touch costs no extra latency and can't be dropped
  by a serverless container freezing after the response.
- `models/Game.ts`: anonymous-game TTL `{'metadata.importedAt': 1}`, 604 800 s, partial on
  `{userId: {$exists: false}}`. Verified the precondition: `routes/games/upload.ts:63` passes
  `userId: req.userId`, which is `undefined` for anonymous callers, and both import routes use
  `$setOnInsert: {}` — mongoose omits undefined paths, so the field is **absent** (not `null`)
  and `$exists: false` matches. If a future writer ever sets `userId: null` explicitly, those
  rows silently stop expiring.
- `models/TablebaseEntry.ts`: TTL `{fetchedAt: 1}` 180 d; removed the misleading
  `unique: true, index: true` double declaration on `fen` (one index either way); header
  comment updated — it claimed entries never expire.
- `routes/sessions/create.ts`: `MAX_SESSIONS_PER_USER = 100`, `countDocuments` pre-check → 409
  with an actionable message.
- Dropped 17 redundant/unused index declarations across Game, MasterGame, ReviewJob, Session,
  Opening (§1c). Exact Atlas names below.
- Deleted `backend/openingBook.ts` (zero importers; unpredicated full scan of all 3733
  openings) and the 8 dead zod schemas + their exported types (F13), after grep-confirming
  zero importers — the `loginSchema`/`registerSchema` hits elsewhere are route-local `const`s.
- Removed `node-fetch` from `package.json` dependencies (zero imports repo-wide). No other
  line touched; `npm install` deliberately not run.

**ReviewJob TTL left at 30 days.** data-audit §4 item 5 suggests 7 d, but it wasn't in my
directive and CLAUDE.md documents 30 d — changing it would desync the docs. Flagging, not doing.

### Task 15 — anonymous deep links readable (backend-audit F3)

`routes/games/[id].ts` GET is `optionalAuth`; the ownership check is byte-identical
(`if (game.userId && game.userId.toString() !== req.userId) → 403`). DELETE stays `requireAuth`.

### Verification

- `npx vitest run backend/` → **63 passed / 63** (4 files: `corsOrigins` 5, `zodSchemas` 22,
  `models/Game.index` 17, `router` 19 — the last is another agent's).
- `npx tsc --noEmit` → **clean, zero errors** (confirmed `tsconfig.json` `include` covers
  `backend/**/*.ts`, so this is real coverage, not a vacuous pass).

### Known risk I did not resolve

`.max(64)` on `pv` is a **rejection**, not a truncation, and the client sends the raw engine PV
(`GameReviewService.ts:661` → `pushCachedEval`). A PV longer than 64 plies now 400s and the
cache write is silently swallowed by `positionCache.pushCachedEval`'s empty catch — the same
invisible-failure shape as the §2c bug this cluster fixes. 64 plies is generous for depth ≤ 24
so this should be rare, but the durable fix is a `.slice(0, 64)` on the client write path,
which is in another agent's ownership.

## Atlas manual index drops

`autoIndex` is on, so mongoose creates the new indexes on the next cold start but **never drops
the old ones**. Run these against the `chess-analyzer` DB.

**Ordering matters for one of them.** `games` keeps the same key with different options
(`sparse` → `partialFilterExpression`), which Mongo rejects as an `IndexOptionsConflict` — so
the §0 Critical upload fix **does not take effect until the old index is dropped**. Drop it
first, or immediately after deploy and then restart the service so `autoIndex` rebuilds.

```js
// 1. MUST drop before the new definition can build (option change on same key)
db.games.dropIndex('metadata.source_1_metadata.sourceGameId_1_userId_1');

// 2. Superseded unique key (new one is {fen:1, engineVersion:1})
//    If this collection ever held rows, de-duplicate first or the new unique
//    index build fails: duplicates on (fen, engineVersion) were possible under
//    the old 3-field key. It measured 0 docs at audit time, so likely a no-op.
db.positions.dropIndex('fen_1_engineVersion_1_depth_1');

// 3. The 17 redundant/unused indexes (data-audit §1c)
db.games.dropIndex('userId_1');                       // prefix of userId_1_metadata.importedAt_-1
db.games.dropIndex('metadata.sourceGameId_1');        // never queried alone
db.games.dropIndex('metadata.ecoCode_1');             // only MasterGame is ECO-filtered
db.games.dropIndex('engineReady_1');                  // $ne:true on a ~100%-true boolean

db.masterGames.dropIndex('featured_1');               // prefix of featured_1_createdAt_-1
db.masterGames.dropIndex('engineReady_1');            // queried nowhere
db.masterGames.dropIndex('tags_1');                   // queried nowhere
db.masterGames.dropIndex('metadata.white_1');         // unusable by ci-regex queries
db.masterGames.dropIndex('metadata.black_1');         // unusable by ci-regex queries

db.reviewjobs.dropIndex('userId_1');                  // prefix
db.reviewjobs.dropIndex('gameId_1');                  // queried nowhere
db.reviewjobs.dropIndex('clientJobId_1');             // prefix of clientJobId_1_userId_1
db.reviewjobs.dropIndex('status_1');                  // never a standalone predicate
db.reviewjobs.dropIndex('userId_1_status_1_updatedAt_-1');  // no "list my jobs" route exists

db.sessions.dropIndex('userId_1');                    // prefix of userId_1_updatedAt_-1
db.sessions.dropIndex('isPublic_1');                  // read off a doc, never a predicate

db.openings.dropIndex('ecoCode_1');                   // prefix of ecoCode_1_plyDepth_1
```

Verify the exact collection names and any lingering `updatedAt_-1` on `reviewjobs` with
`db.getCollectionNames()` and `db.<coll>.getIndexes()` before running — the names above are
Mongo's default `key_direction` form and mongoose pluralizes/lowercases model names.

Do **not** drop `db.tablebaseentries` `fen_1` (still the unique key) or any `_id_`.
