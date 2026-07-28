# exec-server — Task 13 running log

Task 13 of `docs/superpowers/plans/2026-07-28-phase0-1-correctness.md`:
backend boot assert + import hardening + JSON error surface + `loadLocalEnv` fix.

## Reading pass (done)

- Plan Task 13 read in full.
- `backend-audit.md` F1 (state-changing GET imports, no upstream timeout), F5 (no boot
  env assert — Render green with no secrets), F6 (`ipHits` leak in `review/save.ts`),
  F9 (no security headers / 404 / error handler on the Render path), F10
  (`review/save` 500s on a non-ObjectId `gameId`), §4 gaps 1-4 (boot assert,
  process-level handlers, `closeIdleConnections`, request timeout), §2 (dispatch
  table verified correct — append only, no restructure).
- `data-audit.md` §5: `loadLocalEnv()` early-returns on `process.env.MONGODB_URI`,
  so an exported `MONGODB_URI` makes `.env` never parse and `JWT_SECRET` /
  `ADMIN_KEY` / `LICHESS_API_TOKEN` / `CHESS_COM_USER_AGENT` silently vanish.
- Confirmed `importChessComSchema` / `importLichessSchema` use `z.coerce.number()`
  for `count`, so the same schemas validate a JSON body unchanged — no
  `zodSchemas.ts` edit needed (that file is owned by another agent).

### Frontend call-site finding

Grepping `import/chesscom` / `import/lichess` under `frontend/src/` hits exactly
two lines: `frontend/src/services/apiClient.ts:126,129` (`importApi`).
`importApi` is exported but **has no consumers** — the live import UI goes
browser-direct to chess.com/lichess via `frontend/src/services/chessApiClient.ts`
(`fetchChessComGames` / `fetchLichessGames`), which `importStore.ts` calls. So the
GET→POST switch is an API-surface change with no behavioral effect on the app
today; only the two `apiClient.ts` lines needed editing, exactly as scoped.

## Implementation

### `backend/db.ts`

- `loadLocalEnv()` early-return now keys on `envLoaded` alone; exported so
  `index.ts` can populate `process.env` from `.env` before the boot assert runs.
- Real environment values still win — the per-key `process.env[key] !== undefined`
  check inside the loop was already there and is unchanged, so Render/Vercel
  platform config is unaffected. Comment records why the old guard was wrong.

### `backend/index.ts`

- Boot assert (skipped when `NODE_ENV === 'test'`): calls `loadLocalEnv()`, then
  collects problems — `MONGODB_URI` missing/empty, `JWT_SECRET` shorter than 32
  chars (reports the actual length) — prints all of them plus a "set these in the
  Render dashboard" pointer and `process.exit(1)`.
- `server.requestTimeout = 30_000` (Node's default is 300 s; Vercel's
  `maxDuration: 30` was doing this job on the serverless path only).
- `process.on('unhandledRejection')` / `('uncaughtException')` → log + `exit(1)`.
- `server.closeIdleConnections()` added to the SIGTERM/SIGINT drain, before the
  10 s hard-exit timer. Without it, `server.close()` waited on keep-alive sockets
  governed by `keepAliveTimeout = 120_000`, so the "graceful" path always ended
  in `exit(1)`.

### `backend/router.ts` (append-only, dispatch table untouched)

- Security-header middleware registered first, so it covers `/api/health` and
  every inner app: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Content-Security-Policy: default-src 'none'` (JSON API — never serves HTML).
- `routes` table now `export`ed for the test. Order and contents unchanged.
- Terminal JSON 404 after the dispatch loop: `{ error: 'Not found' }`.
- Terminal 4-arg error handler: logs server-side, then 400
  `{ error: 'Invalid request' }` for a body-parse `SyntaxError` /
  `err.type === 'entity.parse.failed'`, else 500
  `{ error: 'Internal server error' }`. Guards `res.headersSent`. This makes
  stack-trace suppression structural rather than dependent on `NODE_ENV` being
  set correctly on two platforms.

### `backend/routes/import/{chesscom,lichess}.ts`

- `app.get(...)` → `app.post(...)`; input read from `req.body` via the same Zod
  schemas. Success shape (`{ games, playerProfile }`) and every error status are
  unchanged; two 400 message strings were reworded off "query" ("Invalid request",
  "username is required") since they no longer describe a query string.
- `app.get` retained as a 405 `{ error: 'Use POST' }` pointer on both routes.
- `fetchText()` helper per file: `AbortController` at 8 s, and the signal stays
  armed through the body read (clearing after headers would leave the multi-MB
  chess.com archive / Lichess NDJSON download unbounded). `AbortError` is
  rethrown as an `UpstreamTimeoutError` and answered 504 rather than a generic
  500. All four upstream fetches are covered; no bare `fetch(` remains in either
  file. Chess.com's per-month archive loop catches and `continue`s, preserving
  the existing "skip an unavailable month" behavior.
- Lichess games-stream failure still forwards the upstream status verbatim, as
  before.
- Both default handlers now accept and forward the dispatcher's third argument
  (`next`). These two modules export the Vercel-style 2-arg `handler`, so errors
  used to terminate in express's HTML finalhandler — inert while the routes read
  only a query string, reachable now that they parse a JSON body. On Vercel
  `next` is undefined and express falls back to finalhandler, as before. The
  other three handler-wrapped modules (`review/[gameId]`, `engine-index/migrate`,
  `engine-index/status`) still have the old behavior; they are outside this
  task's file ownership.

### `backend/routes/review/save.ts`

- Deleted `ipHits` / `RATE_LIMIT_*` / `clientIp()` / `rateLimited()` and the 429
  branch. `createApp()`'s `express-rate-limit` already covers this module with
  its own 150/15min bucket; the hand-rolled map pruned timestamps within a key
  but never deleted keys, leaking one entry per distinct IP forever on a
  long-uptime Render process.
- `mongoose.isValidObjectId(gameId)` → 400 `{ error: 'Invalid gameId' }` before
  `Game.findById`, matching every other id-taking route.
- Header comment updated to say where rate limiting now comes from.

### `backend/router.test.ts` (new)

19 assertions over the exported table, resolved exactly the way the dispatcher
does, comparing **handler identity** against the directly-imported modules:

- 5 literal paths (`/api/games/upload`, `/api/review/save`, `/api/review/job`,
  `/api/sessions/create`, `/api/master/games`) resolve to their own module.
- 4 param paths still reach `[id]` / `[gameId]` modules.
- `/api/games`, `/api/games/`, `/api/sessions` reach the collection routes.
- 5 non-matching paths (incl. `/api/nope`, `/api/games/upload/extra`,
  `/api/health`) resolve to nothing — i.e. fall through to the new JSON 404.
- Explicit literal-before-param ordering check on 5 shadowing pairs.
- Every registered pattern is the first match for a path it accepts (no
  unreachable entry, no duplicate handler).

**Note on plan Step 1:** the plan framed this as a *failing* test first, but
backend-audit §2 had already swept the table programmatically and found it
correct. The test passes on unmodified dispatch logic — it lands as a regression
pin against a future misordered append, which is what §2's finding calls for.

### `frontend/src/services/apiClient.ts`

- `importApi.chesscom` / `importApi.lichess`: `apiClient.get(path, { params })`
  → `apiClient.post(path, params)`. Method and body only; signatures unchanged.

## Verification

- `npx vitest run backend/router.test.ts backend/corsOrigins.test.ts` →
  **24/24 passed** (19 router + 5 corsOrigins).
- `npx tsc --noEmit` → **clean, zero errors**. (An earlier run showed 6
  `TS2353 deltaWin` errors in `frontend/src/utils/reviewUtils.test.ts` — exec-review's
  in-flight Task 7, not my files; they were gone by the final run.)
- Not run, per instructions: dev server / curl smoke (lead owns it),
  `npm run build`, any `git` command.
