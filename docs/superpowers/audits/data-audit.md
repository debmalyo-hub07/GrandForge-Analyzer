Audit complete. Findings below, most severe first.

---

# MongoDB / Mongoose audit — GrandForge (Atlas M0, 512 MB)

## 0. Critical: the second PGN upload always fails with a 500

`backend/models/Game.ts:120-123`

```ts
GameSchema.index(
  { 'metadata.source': 1, 'metadata.sourceGameId': 1, userId: 1 },
  { unique: true, sparse: true }
);
```

MongoDB semantics for a **sparse compound** index: a document is indexed if it contains **at least one** of the keys — not all of them. `metadata.source` is `required: true` (`Game.ts:104`), so **every** game document is indexed, and games without a `sourceGameId` are indexed with a `null` key.

`backend/routes/games/upload.ts:62-72` creates `pgn_upload` games and never sets `metadata.sourceGameId`. Index key for every upload by one user is therefore identical: `{'pgn_upload', null, <userId|null>}`.

- Anonymous user: key `{'pgn_upload', null, null}` — the **second PGN upload ever made on the deployment** throws `E11000`, caught at `upload.ts:79`, returned as `500 Failed to upload game`.
- Authed user: second upload by the same account, same failure.

This is a live user-facing path — `frontend/src/components/import/PGNImport.tsx:17` → `apiClient.ts:109` → `POST /api/games/upload`. The `games` collection being tiny (dataSize 1.6 MB, dominated by 3733 openings) is consistent with uploads having been broken.

Fix direction: replace `sparse` with a partial filter that keys on the field that is actually optional.

```ts
{ unique: true, partialFilterExpression: { 'metadata.sourceGameId': { $type: 'string' } } }
```

The SEC-1 intent documented at `Game.ts:114-119` is preserved; only never-imported (`pgn_upload`) docs drop out of the constraint, which is correct — they have no source identity to dedupe on.

---

## 1. Index audit

### 1a. Queries that will collection-scan

| Query | Location | Why it scans |
|---|---|---|
| `Opening.find({$or:[{name:/…/i},{family:/…/i},{variation:/…/i}]})` | `backend/routes/openings/search.ts:36-42` | Case-insensitive, unanchored regex on three **unindexed** fields. Full scan of all 3733 docs + in-memory sort on `{plyDepth,name}` (`:43`). No text index exists. |
| `MasterGame.find({$or:[{'metadata.white':/…/i},{'metadata.black':/…/i}]})` | `backend/routes/master/games.ts:34-35` | The `{metadata.white:1}` / `{metadata.black:1}` indexes (`MasterGame.ts:69-70`) **cannot** serve a `/…/i` unanchored regex. Full scan. Free today (0 docs), a 32 MB-sort hazard at corpus scale. |
| `.sort({featured:-1,'metadata.date':-1})` | `master/games.ts:51` | No index contains `metadata.date`. The `{featured:1,createdAt:-1}` index (`MasterGame.ts:71`) is on `createdAt`, a different field. Always a blocking in-memory sort. |
| `conn.collection('openings').find({}, {projection:{fen:1,_id:0}})` | `backend/openingBook.ts:17-20` | Unpredicated scan of all 3733 docs. **Dead code** — no route or script imports `loadOpeningFens`; the frontend uses `/api/openings/lookup` instead (`frontend/src/components/review/useOpeningBookFens.ts:54`). Delete it. |
| `Game.find({engineReady:{$ne:true}})` + `countDocuments` same filter | `routes/engine-index/migrate.ts:35`, `:72` | `$ne` on a boolean that is `true` for ~100 % of docs. Index-scannable but non-selective; the index costs bytes on every insert to serve one admin route. |

### 1b. Queries that are correctly indexed

`auth/login.ts:25` (`email` unique) · `auth/register.ts:26` ($or over two unique indexes) · `games/index.ts:31-33` (`{userId,'metadata.importedAt':-1}`) · `import/chesscom.ts:146`, `import/lichess.ts:147` (exact match on the `{source,sourceGameId,userId}` key) · `openings/lookup.ts:48` (`moveSequence` `$in`) · `openings/tree.ts:33` (anchored case-sensitive `^A` regex → index bounds on `ecoCode`) · `positions/cache.ts:88,93` and `positions/eval.ts:41` (prefix of `{fen,engineVersion,depth}`) · `positions/tablebase.ts:42` (`fen` unique) · `review/job.ts:89,110` (`{clientJobId,userId}`) · `sessions/index.ts:36` for `sort=updated` · all `findById` paths.

Two partial cases worth noting, both low cost:
- `positions/eval.ts:42` sorts `{depth:-1, computedAt:-1}`; `computedAt` is not in the index, so a blocking sort always runs (matched set is normally 1 doc).
- `sessions/index.ts` `sort=newest|oldest|title` (`:14-17`) has no supporting index — in-memory sort of one user's sessions.

### 1c. Dead and duplicated indexes — 17 of ~39 are removable

Index bytes are the scarce resource here: **indexSize 2.1 MB exceeds dataSize 1.6 MB**, and most of it is per-index minimum allocation across 8 collections (5 of which are empty or near-empty).

**Redundant (a strict prefix of another index — Mongo never needs both):**
- `Game.ts:78` `userId` — prefix of `{userId,'metadata.importedAt':-1}` (`:112`)
- `MasterGame.ts:64` `featured` — prefix of `{featured,createdAt:-1}` (`:71`)
- `ReviewJob.ts:45` `userId` — prefix of `{userId,status,updatedAt}` (`:66`)
- `ReviewJob.ts:47` `clientJobId` — prefix of `{clientJobId,userId}` (`:67`)
- `Session.ts:18` `userId` — prefix of `{userId,updatedAt:-1}` (`:31`)
- `Opening.ts:71` `ecoCode` — prefix of `{ecoCode,plyDepth}` (`:91`)
- `TablebaseEntry.ts:48` declares `unique: true, index: true` on the same path — one index results, but the double declaration is misleading.

**Unused (no query in `backend/routes/**` filters or sorts on them):**
- `Game.ts:105` `metadata.sourceGameId` — never queried alone; the import filters always include `metadata.source`
- `Game.ts:113` `metadata.ecoCode` — grep shows no `Game` query on it; only `MasterGame` is filtered by ECO (`master/games.ts:30`)
- `Game.ts:84` / `MasterGame.ts:43` `engineReady` — `MasterGame`'s is queried nowhere at all
- `MasterGame.ts:63` `tags` — no route queries tags
- `MasterGame.ts:69,70` `metadata.white`, `metadata.black` — unusable by the only queries that touch them (ci-regex)
- `ReviewJob.ts:46` `gameId` — no query filters on it
- `ReviewJob.ts:48` `status` — never a standalone predicate
- `ReviewJob.ts:66` `{userId,status,updatedAt:-1}` — there is **no** "list my review jobs" route; only `findOne({clientJobId,userId})` exists
- `Session.ts:25` `isPublic` — read off a fetched doc (`sessions/[id].ts:59`), never a query predicate

Note `connectDB()` never sets `autoIndex: false`, so Mongoose issues `createIndexes` for every touched model on each cold start. Harmless on Render, wasteful on Vercel; and it means dropping an index in Atlas without changing the schema silently recreates it.

---

## 2. Schema audit

### 2a. `Position.lines` is unbounded — the sharpest storage-amplification hole

`backend/routes/positions/cache.ts:30-41` declares its own inline schema:

```ts
lines: z.array(z.object({
  multipv: z.number().int().min(1).max(5),
  eval: z.object({ type: …, value: … }),
  pv: z.array(z.string()),          // ← no .max(), no per-string length cap
})).default([]),                     // ← no .max() on the array either
```

`backend/zodSchemas.ts:188-206` already contains a `positionCacheSchema` with `.max(5)` on `lines` — **it is imported nowhere** (verified by grep). The route bypasses it. `multipv ≤ 5` bounds the *value*, not the array length, so one authenticated request can persist thousands of lines into a single `Position` document. The only ceiling is `express.json({limit:'5mb'})` (`backend/createApp.ts:23`) — i.e. ~5 MB per document, ~100 requests to consume the tier. `requireAuth` (`cache.ts:44`) gates this, so it is an authenticated-abuse vector rather than an open one.

Same file, same class of gap: `positions/eval.ts` performs **no** schema validation at all (`:20-39`, hand-rolled `typeof` checks), and `positionEvalQuerySchema` (`zodSchemas.ts:182`) is likewise unused.

### 2b. `Position`'s unique key does not match the upsert key

`Position.ts:47` — `{fen, engineVersion, depth}` unique. `positions/cache.ts:93-108` upserts on `{fen, engineVersion}`.

Consequences:
1. The upsert filter is not protected by any unique constraint. Two concurrent writers for the same `(fen, engineVersion)` both miss the `findOne` at `:88`, both insert. If their `depth` differs, both rows survive (different index keys) — permanent duplicates. If `depth` matches, one gets `E11000` → `500` at `:112`.
2. Because `$set` rewrites `depth` in place on the "deepest wins" path (`:96-101`), steady state is one doc per `(fen, engineVersion)`. `depth` in the unique key therefore does nothing except widen every index entry and license the duplicate above. Make the index `{fen:1, engineVersion:1}` unique to match the actual write key.

### 2c. `sf18-lite-mt` cannot use or populate the position cache; `sf18-full` is still enumerated

The engine id union per CLAUDE.md is `sf18-lite | sf18-lite-mt | sf17-lite | sf16-lite`. Every server-side enum disagrees:

- `positions/cache.ts:23` — `z.enum(['sf18-lite','sf18-full','sf17-lite','sf16-lite'])`
- `zodSchemas.ts:184`, `:190` — same stale list
- `User.ts:11`, `:37` and `routes/auth/preferences.ts:10` — same stale list

Runtime effect: `frontend/src/services/GameReviewService.ts:153-154` does `(this.engine.getVersion() ?? 'sf18-lite') as 'sf18-lite'|'sf17-lite'|'sf16-lite'` — a cast, not a coercion. A user on the multi-threaded engine sends `engineVersion: 'sf18-lite-mt'`, which

- **400s** on `POST /api/positions/cache`, swallowed silently by `positionCache.ts:129-131`, and
- is a **permanent cache miss** on `GET /api/positions/eval` (no validation there, so it just matches nothing).

So MT users neither read nor write the shared cache, and the failure is invisible. Separately, a user can never persist `defaultEngine: 'sf18-lite-mt'` (400 from `preferences.ts`), while `sf18-full` — the 113 MB build that was dropped — is still an accepted value.

### 2d. `reviewedNodeIds` is silently stripped on save, defeating review line identity

`backend/zodSchemas.ts:155-164` `gameReviewResultSchema` has no `reviewedNodeIds` / `reviewedPathKey` / `reviewedLineUciKey` fields and is a plain `z.object` (strip mode, not `.passthrough()`).

`GameReviewService.ts:580-582` sets all three; `ReviewTab.tsx:141` POSTs the result to `/api/review/save`; `routes/review/save.ts:51` parses with that schema and `:73` writes **`parsed.data`-derived `reviewResult`** to `Game.reviewResult`. The three keying fields are dropped before they reach Mongo — even though `Game.reviewResult` is `Schema.Types.Mixed` (`Game.ts:90`) and would have stored them.

Result: any review reloaded from the server has no line identity and falls back to mainline-only glyph decoration — the exact bug `reviewedNodeIds` was introduced to fix. Same strip applies to `PUT /api/sessions/:id` (`routes/sessions/[id].ts:32`). Also missing from the `IGameReviewMove` TS interface (`Game.ts:3-18`): `bestMoveEval`, `complexity`, `reason`, all present in the zod schema — cosmetic only, since the field is `Mixed`.

### 2e. Unbounded arrays and 16 MB BSON headroom

No collection is at realistic risk of the 16 MB limit; the binding constraint everywhere is the 5 MB JSON body cap, not BSON.

- `Game.fenPositions` / `moveUciList` / `moveSanList` scale with ply count, bounded by `pgn ≤ 500_000` (`upload.ts:10`) → worst case ~1 MB doc. **But the import routes have no PGN size bound at all** — `chesscom.ts:154` / `lichess.ts:155` `$set` whatever upstream returns.
- `gameReviewResultSchema.moveReviews` (`zodSchemas.ts:156`) has **no `.max()`**; `pvLine` is capped at 50 strings (`:133`). A 300-ply review is ~135 KB. Add `.max(600)` for hygiene.
- `Opening.topGames` (`Opening.ts:84`) is unbounded by schema. No writer populates it today (the seeder sets `[]`), but the documented lila-openingexplorer sync plan (`Opening.ts:5-10`) would grow it per-document with no cap.
- `Session.moveTree` is capped at 5000 nodes (`sessions/[id].ts:19-22`) → ~1 MB per session, and there is **no per-user session quota** (`sessions/create.ts` creates unconditionally). One account can consume the tier.
- `MasterGame.tags` unbounded (seed-only path).

### 2f. Missing TTLs and missing/incorrect unique constraints

TTL exists on exactly one collection: `ReviewJob.ts:72` (30 d on `updatedAt`) — correctly placed, since results live on `Game`/`Session`.

Missing, in priority order:
1. **`Position`** — no TTL, no cap. Unbounded global growth, no owner to prune by. See §4.
2. **`Game` for anonymous docs** — `userId` is absent for anonymous imports (`chesscom.ts:176` `$setOnInsert: {}`), and `DELETE /api/games/:id` refuses to delete ownerless games (`games/[id].ts:53`: `if (!game.userId …) 403`). Anonymous games are **immortal and unreachable** — nothing in the codebase can ever remove them.
3. **`TablebaseEntry`** — deliberately eternal (`TablebaseEntry.ts:5-8`), which is defensible for immutable data but not for a 512 MB tier at ~3 KB/doc.

Unique constraints:
- `MasterGame` has **no** unique key. `seedMasterGames.ts:18` does `deleteMany({})` first, so no duplicates today; any future upsert or partial re-seed duplicates the corpus.
- `Opening.fen` unique + `insertMany(…, {ordered:false})` (`seedOpenings.ts:81`) means **duplicate-FEN rows are silently dropped** — different ECO rows legitimately transpose to the same FEN. The per-group log prints `openings.length` (attempted), not inserted, so only the final `countDocuments` (`:87`) reveals the gap.
- `Session`, `User` are correct.

Field types / defaults: `metadata.date` is a `String` (`Game.ts:98`, `MasterGame.ts:54`) while `master/games.ts:51` sorts on it — lexicographic sort happens to work for `YYYY-MM-DD` (what `chesscom.ts:167` and `lichess.ts:168` write), but breaks for PGN-native `YYYY.MM.DD` and for `????.??.??`. `Game.ts` has `createdAt` but no `updatedAt`, so there is no field to TTL or LRU on. `import/*.ts:176,179` pass `$setOnInsert: {}` for anonymous imports — this only works because Mongoose strips empty update operators; the raw driver rejects it.

---

## 3. White-relative convention — both sides verified, they agree

**Write side** — `frontend/src/services/GameReviewService.ts:645-671`:

```ts
// Store evals White-relative per Position model schema convention.
const toWhiteRelative = (cp, mate) => {
  if (mover === 'w') return { cp, mate };
  return { cp: cp !== null ? -cp : null, mate: mate !== null ? -mate : null };
};
```
applied to the headline eval (`:651`) **and** to each MultiPV line (`:658`), with `turn: mover` sent at `:668`.

**Read side** — `GameReviewService.ts:207-211` for the headline eval and `:629-632` (`cachedLineToMoverWin`) for each line, both flipping back on `mover === 'b'`.

**Server boundary** — `routes/positions/cache.ts:73-85` maps `{type,value}` → `{cp,mate}` verbatim (no sign change) and stores `evaluation.turn` from the client-supplied `turn`, falling back to the FEN's side-to-move field. `routes/positions/eval.ts:41-46` returns the document untouched. The server never flips; both flips live in the client, symmetrically. **The convention holds.**

Two robustness notes on this boundary:
- `mover` is derived independently on each side (`moverFromFen(fen)` at `GameReviewService.ts:165` on read, `pushFromSearchResult(…, mover, …)` on write) rather than read back from the stored `evaluation.turn`. It happens to be safe because the cache key is the 4-field FEN (`positionCache.ts:37-41`), which retains side-to-move — so `turn` is always recoverable from the key and can never disagree. Worth a comment; the stored `turn` is effectively decorative.
- `cachedLineToMoverWin` defaults `value` to `0` when both `scoreValue` and `eval.value` are absent (`:626`) — a shape-corruption regression there reads back as a dead draw, the same failure mode `cache.ts:68-72` documents having already fixed once.

---

## 4. Storage forecast

Live baseline: dataSize 1.6 MB + indexSize 2.1 MB ≈ 3.7 MB, essentially all of it 3733 `openings` docs (~430 B/doc) plus the ~4 KB–36 KB per-index floor across 39 declared indexes on 8 collections. **Index bloat is already 57 % of consumed space** — that is what §1c is about. Usable remainder ≈ 500 MB.

| Collection | Est. bytes/doc (BSON + index entries) | Docs in 500 MB | Growth driver |
|---|---|---|---|
| `positions` | **~800 B** (600 B doc: 4-field FEN 64 B + 2 lines × ~230 B PV; + ~130 B unique-index entry + `_id`) | **~625,000** | **global, per unique position, never pruned** |
| `games` unreviewed | ~13 KB (PGN w/ clock comments 3.5 KB + `fenPositions` 81 × 80 B = 6.5 KB + uci/san 2.2 KB) | ~38,000 | per import |
| `games` reviewed | ~49 KB (+36 KB `reviewResult`; `pvLine` is ~half of it) | **~10,200** | per review |
| `tablebaseEntries` | ~3 KB (30–60 moves × ~90 B) | ~170,000 | per ≤7-piece position |
| `sessions` | ~80 KB typical (200-node tree + review); **~1.1 MB** at the 5000-node cap | ~6,400 / ~450 | per user, **unquotaed** |
| `masterGames` | ~12 KB | ~42,000 | seed-only, bounded |
| `openings` | ~450 B | static 3733 | none |
| `reviewJobs` | ~400 B | TTL'd 30 d | negligible |
| `users` | ~700 B | negligible | negligible |

**Which exhausts the tier first: `positions`.** One 80-ply review caches ~81 documents ≈ 65 KB, and unlike every other collection it is global, has no owner, no TTL, and no natural pruning trigger — middlegame FENs are never re-hit by anyone. Realistic engaged user (import 20 games, review 3): ~260 KB of `games` + ~108 KB of review payload + ~195 KB of `positions` + ~90 KB of `tablebaseEntries` ≈ **650 KB per user → ~770 engaged users fills the tier.**

`positions` reads 0 today only because writes require auth (`cache.ts:44`, `positionCache.ts:121`) and there are no accounts. It becomes the dominant collection the moment accounts exist or that gate is relaxed — and §2a means it is also the abuse vector at that point.

**Recommended eviction/TTL policy, highest value first:**

1. **`games`, anonymous only** — partial TTL, the single biggest win, and it fixes the "immortal ownerless doc" problem:
   ```ts
   GameSchema.index({ 'metadata.importedAt': 1 },
     { expireAfterSeconds: 604_800, partialFilterExpression: { userId: { $exists: false } } });
   ```
2. **`positions`** — TTL 30–60 d on `computedAt`, and `$set: { computedAt: new Date() }` on every cache **hit** in `positions/eval.ts` to turn it into an LRU rather than a TTFB-from-creation clock. Simultaneously cap the document: `.max(5)` on `lines` and `.max(64)` on each `pv` (or just use the already-written `positionCacheSchema`).
3. **`tablebaseEntries`** — TTL 180 d on `fetchedAt`. Upstream is free and cache-aside re-fetches transparently (`tablebase.ts:47-89`).
4. **`sessions`** — per-user quota (e.g. 100) enforced in `sessions/create.ts`; without it one account can take the tier.
5. **`reviewJobs`** — 30 d → 7 d. Pure progress telemetry.
6. **Shrink before evicting.** Two cheap changes cut steady-state growth roughly in half:
   - Stop persisting `Game.fenPositions` — it is 6.5 KB of a 13 KB document and is fully derivable from `pgn` via `indexGame()` in milliseconds (`backend/indexGame.ts:16-50`). `engine-index/status.ts:29` already pulls the whole array over the wire only to read `.length` (`:52`) — it should use `plyCount`.
   - Truncate `pvLine` to ~8 plies before save; it dominates the 36 KB review payload and the UI shows only the first few moves.

---

## 5. `connectDB()` correctness

`backend/db.ts:34-82`

**In-flight promise sharing — correct, and the comment at `:38-43` accurately states why it exists.** One subtlety: callers that enter at `:44` return the shared promise directly and never run the `finally` at `:78-81`; only the caller that created it clears the marker. That is the right behavior. The `.catch` at `:69-73` nulls `connecting` before rethrowing so a later request retries rather than awaiting a permanently-rejected promise — also correct.

**Pool sizing.** Persistent (Render) `maxPoolSize: 20`, `socketTimeoutMS: 45000` — appropriate. Serverless `maxPoolSize: 5` is the problem: **Atlas M0 caps at 500 concurrent connections**, and Vercel scales instances horizontally, so 100 concurrent invocations × 5 = the entire cluster limit. A serverless invocation handles one request at a time, so a pool >1–2 buys nothing. Recommend `maxPoolSize: 2` and add `maxIdleTimeMS: 10_000` (absent today) so sockets from frozen containers are reaped rather than held against the 500 cap.

**`serverSelectionTimeoutMS: 5000` vs the 4 s failover probe.** Per CLAUDE.md, `apiBase.ts` probes `{primary}/health` with a 4 s timeout. `/api/health` (`router.ts:60-68`) deliberately does not touch the DB, so the probe is unaffected — but any *real* request racing a cold Atlas will spend 5 s in server selection while the client has already decided the primary is healthy. Aligning these (Mongo selection ≤ 4 s) would make failover behavior predictable.

**`bufferCommands: false` implications.** Every route `await connectDB()` before its first query, so the normal path is safe. Two exposures:

1. **No wait for `readyState === 2`.** The fast path at `:36` requires `readyState === 1`. During a transient reconnect (`readyState 2`, Mongoose auto-reconnecting) with `connecting === null` — i.e. the original promise long since settled — control falls through to a second `mongoose.connect()` at `:57`. Same URI and options, so Mongoose returns the existing connection promise and it resolves; but if options ever diverge this throws `Can't call openUri() on an active connection with different connection strings`. More importantly, with buffering off, any query issued in that window throws instead of queueing → user-visible 500s during a blip. A `readyState === 2` branch that awaits `connection.asPromise()` would close this.
2. **The 5 MB/150-req rate limiter is per route module** (`createApp.ts:29-33`, ~25 buckets) — orthogonal to the DB, but it means a review's ~160 `positions/*` calls each open a fresh serverless container in the Vercel fallback path, each with its own pool. That is the multiplier behind the 500-connection concern above.

**Behavior when `MONGODB_URI` is absent.** `hasMongoUri()` (`:29-32`) → false → `connectDB()` throws `'MONGODB_URI is not configured'` (`:47-49`). Only three routes guard on it and degrade gracefully: `openings/lookup.ts:19`, `openings/search.ts:24`, `openings/tree.ts:19` (return empty payloads, 200). **Every other route returns 500** — `positions/eval`, `positions/tablebase`, `review/*`, `games/*`, `sessions/*`, `auth/*`. For the documented Playwright/dev flow ("the review's `/api` cache fetch fails over to WASM") this still works because `positionCache.ts:93` swallows the error, but the server logs a stack per position (~160 per review) and a genuinely missing URI is indistinguishable from an outage. The three openings routes' pattern should be the norm for read-only cache endpoints.

**One real `loadLocalEnv()` bug** (`:9-27`): the guard is `if (envLoaded || process.env.MONGODB_URI) return`. If `MONGODB_URI` is present in the real environment, `.env` is **never parsed** — so `JWT_SECRET`, `ADMIN_KEY`, `LICHESS_API_TOKEN`, `CHESS_COM_USER_AGENT` are all silently skipped. On Render/Vercel every var comes from the platform, so production is fine. Locally, exporting `MONGODB_URI` in the shell makes `backend/auth.ts:10-12` throw `'JWT_SECRET must be set and at least 32 characters'` on every authed request, with no hint that `.env` was skipped. The early-return should key on `envLoaded` alone.

---

## Quick-reference: files and lines to act on

| Severity | Location | Issue |
|---|---|---|
| Critical | `backend/models/Game.ts:120-123` | sparse compound unique → 2nd PGN upload 500s (§0) |
| High | `backend/routes/positions/cache.ts:30-41` | unbounded `lines`/`pv`; `zodSchemas.ts:188` version unused (§2a) |
| High | `backend/models/Position.ts:47` vs `cache.ts:93` | unique key ≠ upsert key → dup/E11000 race (§2b) |
| High | `cache.ts:23`, `zodSchemas.ts:184,190`, `User.ts:11,37`, `auth/preferences.ts:10` | enums missing `sf18-lite-mt`, still list dropped `sf18-full` → MT users get no cache (§2c) |
| High | `backend/zodSchemas.ts:155-164` | strips `reviewedNodeIds`/`reviewedPathKey`/`reviewedLineUciKey` (§2d) |
| High | no TTL on `positions`; `games/[id].ts:53` | anonymous games immortal; `positions` unbounded (§2f, §4) |
| Medium | `openings/search.ts:36-42`, `master/games.ts:34-35,51` | collection scans + unindexed sorts (§1a) |
| Medium | 17 indexes listed in §1c | 57 % of consumed bytes is index overhead |
| Medium | `backend/db.ts:9-27` | `.env` skipped when `MONGODB_URI` is in the environment (§5) |
| Medium | `backend/db.ts:55,61-63` | serverless pool 5 × N instances vs M0's 500-conn cap; no `maxIdleTimeMS` (§5) |
| Low | `backend/openingBook.ts` (whole file) | dead code, unpredicated full scan |
| Low | `engine-index/status.ts:29,52` | fetches entire `fenPositions` to read `.length` |
| Low | `scripts/seedOpenings.ts:81` | `ordered:false` + unique `fen` silently drops rows |
| Low | `backend/models/MasterGame.ts` | no unique key; `metadata.date` is a sorted String |