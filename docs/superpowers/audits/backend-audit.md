# GrandForge backend / API security + correctness audit

Read-only. **No files were modified.** Scope read in full: `backend/**` (all 42 files), `api/[...path].ts`, `render.yaml`, `vercel.json`, `frontend/src/services/{apiBase,apiClient,positionCache,tablebase}.ts`, plus the frontend call sites that determine what the API actually receives.

**Your three premises — all confirmed:**
- `GET https://grandforge-api.onrender.com/api/health` → `HTTP/1.1 404`, `x-render-routing: no-server`, `Server: cloudflare`, **and no `Access-Control-Allow-Origin` header**. That last detail matters (F14).
- `positions/cache.ts:44` is `requireAuth`; `positionCache.ts:121` is `if (!getAuthToken()) return;`. `frontend/src/pages/AuthPage.tsx` exists and is imported by **nothing** — `App.tsx:60-93` routes only `/`, `/game/:id`, `/privacy`, `/learn/*`, `*`. No token is obtainable, so the cache write is unreachable code.
- Rate limiting is per `createApp()` (`createApp.ts:29-34`), ~25 buckets of 150/15min per IP.

---

## 1. Findings, most severe first

### F1 — Unauthenticated **state-changing GET** import endpoints, no outbound timeout: cross-site-triggerable, CPU bomb on 0.1 vCPU, upstream amplifier
**Defect.** `backend/routes/import/chesscom.ts:73` and `import/lichess.ts:76` are `app.get(..., optionalAuth, ...)` yet perform Mongo upserts (`chesscom.ts:146`, `lichess.ts:147`). Three problems compound:

1. **CORS does not block execution.** `cors` with an array origin only *omits* ACAO for a disallowed origin — it calls `next()` and the handler runs (`node_modules/cors/lib/index.js:57-63`). A simple GET triggers no preflight.
2. **No timeout on any upstream fetch:** `chesscom.ts:99`, `chesscom.ts:112`, `lichess.ts:97`, `lichess.ts:116`. Contrast `positions/tablebase.ts:47-52`, which does it correctly with a 4 s abort.
3. **Cost per request:** 3 upstream fetches + up to 50 full `chess.js` PGN replays (`indexGame.ts:16-41`) + 50 upserts, at 150 req/15 min/IP.

**Failure scenario.** `<img src="https://grandforge-api.onrender.com/api/import/chesscom?username=x">` on any third-party page silently executes the full import from each visitor's IP — the browser can't read the response, but the DB writes and upstream fetches already happened. Separately, a slow chess.com response holds a connection and a DB pool slot for undici's ~300 s default; Vercel's `maxDuration: 30` (`vercel.json:9`) was the only bound. Under modest abuse the 0.1 vCPU instance saturates on chess.js replays alone.

**Fix.** Convert both to `POST`; add `AbortController` with a 5-8 s budget per upstream call; lower the `count` cap for anonymous callers; make the CORS middleware *reject* disallowed origins rather than pass through. Also set a real `CHESS_COM_USER_AGENT` — it defaults to `grandforge/1.0` with no contact info (`chesscom.ts:52`), which is what chess.com's politeness policy exists to prevent, and the Render egress IP is what gets throttled.

### F2 — Once Render is the single process, the rate limiter will 429 real reviews
**Defect.** `createApp.ts:29-34` uses the default `MemoryStore` at 150/15 min. On Vercel this was effectively inert — each cold invocation is a fresh process with a fresh counter. On one persistent process the counter is real.

**Failure scenario.** `GameReviewService.ts:203` calls `fetchCachedEval` once per resolved position (deduped by `searchAtPly[]`), i.e. **plyCount + 1 GETs to `/api/positions/eval` per review**, against a 150 budget. A single ~75-move game, **or two ordinary 37-move games in the same 15-minute window**, exhausts it. `/api/review/job` is throttled to one write per 1500 ms (`ReviewTab.tsx:62-64, 111-121`), so a 3-minute review is ~120 upserts — two reviews exceed that bucket too. It degrades rather than crashes (`positionCache.ts:93, :129` swallow errors), so the visible symptom is "the cloud cache and job checkpointing stopped working right after the Render cutover."

**Fix.** Raise the per-bucket max for the read-heavy position routes to cover a worst-case game (≥400), or key the limiter on cost rather than request count. The shared store (Upstash, Phase 6) becomes necessary rather than optional at cutover.

### F3 — Two whole surfaces are dead by construction, from one root cause
**Defect.** The missing auth route doesn't only kill the position cache:
- **Cloud eval cache:** `positions/cache.ts:44` + `positionCache.ts:121` + no login route ⇒ `Position` stays empty ⇒ `GameReviewService.ts:203` always misses.
- **`/game/:id` deep links:** `AnalyzerPage.tsx:61-67` calls `gamesApi.get(id)` → `GET /api/games/:id`, which is `requireAuth` (`games/[id].ts:18`).
- **`POST /api/review/save`:** anonymous games require a token (`review/save.ts:69-71`).

**Failure scenario.** Every `/game/:id` deep link 401s for every visitor. And `POST /api/games/upload` is `optionalAuth` (`upload.ts:21`), so an anonymous upload creates a row nobody can ever read back — the write path and read path disagree on auth.

**Fix.** The `requireAuth` on `games/[id].ts:18` buys nothing anyway: line 30 then permits any authenticated user to read any `userId`-less game. `optionalAuth` plus the identical ownership check is strictly more correct and un-breaks the route. For the cache, see §3. Also dead: `backend/openingBook.ts` (`loadOpeningFens` imported nowhere; the frontend uses its own `useOpeningBookFens`) and `node-fetch` in `dependencies` with zero imports.

### F4 — `Position` upsert filter doesn't match its unique index: duplicate rows and a reachable `E11000` → 500
**Defect.** `models/Position.ts:47` is unique on `{fen, engineVersion, depth}`; `positions/cache.ts:93-108` upserts on `{fen, engineVersion}` (no depth) while `$set`ting `depth`. And `cache.ts:88` `findOne({fen, engineVersion}).select('depth')` has **no `sort`**.

**Failure scenario.** Two concurrent first-writes at different depths both insert (distinct index keys) ⇒ two documents for the same (fen, engineVersion). The depth guard then reads whichever row Mongo returns, possibly the shallower one. Given rows at depth 20 and 22, a POST at depth 22 passes the guard (read the 20) and `$set depth: 22` on the arbitrarily-matched row ⇒ collides with the sibling ⇒ `E11000` ⇒ generic 500 (`cache.ts:111-114`). This becomes reachable the moment Render and the Vercel fallback are both live against one Atlas cluster (F16/§5.5).

**Fix.** Make the unique index `{fen, engineVersion}` with `depth` an ordinary field, or add `depth` to the filter and make the guard `findOne(...).sort({depth: -1})`. Fix this *before* the §3 depth guard is relied on.

### F5 — No fail-fast on missing secrets; a misconfigured Render env is invisible
**Defect.** `backend/index.ts:13` binds the port and `render.yaml:24` health-checks `/api/health`, which touches nothing (`router.ts:60-68`). `auth.ts:9-15` `getJwtSecret()` throws, but every call site swallows it: `requireAuth` (`auth.ts:27`, inside `try`) ⇒ every authenticated request 401s; `optionalAuth` (`auth.ts:48`, `/* ignore */`) ⇒ **every request silently proceeds as anonymous**; `register.ts:39` / `login.ts:34` ⇒ 500 *after* `User.create` already committed (`register.ts:33`).

**Failure scenario.** Render reports **green** with no `MONGODB_URI` and no `JWT_SECRET`. All three of those plus `ADMIN_KEY` are `sync: false` in `render.yaml:32-37`, i.e. hand-entered — exactly the case that needs a boot assert. A misconfigured secret is indistinguishable from a logged-out user. Combined with F14 this is the worst realistic outage: health green, every request 500, no failover.

**Fix.** Assert `MONGODB_URI` and `JWT_SECRET` (length ≥32) at the top of `index.ts` and exit non-zero. (`ADMIN_KEY` unset does fail *closed* at `migrate.ts:21` — that part is right.)

### F6 — Unbounded in-process memory on a 512 MB box
**Defect.** `review/save.ts:21` `const ipHits = new Map<string, number[]>()`; `rateLimited()` (`:28-38`) prunes timestamps *within* a key but never deletes keys.

**Failure scenario.** Every distinct IP that ever POSTs leaves a permanent entry for the process lifetime. Harmless on serverless (fresh process); a slow leak on a 30-day-uptime Render instance.

**Fix.** Delete it — `createApp()` already applied `express-rate-limit` to that same app, so this hand-rolled limiter is redundant as well as leaky.

### F7 — Render's install pulls 348 MB of Stockfish WASM the server never touches
**Defect.** `stockfish` is in `dependencies`, so `npm ci --omit=dev` (`render.yaml:22`) installs it — I measured `node_modules/stockfish` at **348 MB** — plus `react`, `react-dom`, `framer-motion`, `react-chessboard`, `react-router-dom`, `@tanstack/react-query`, `lucide-react`, `@vercel/analytics`. No backend file imports any of them.

**Failure scenario.** Every cold start pays that install/disk cost, plus `tsx` transpiling `router.ts` + all 25 route modules + mongoose + chess.js on 0.1 vCPU with no prebuilt JS. On a free instance that spins down every 15 min, this is the dominant cold-start term.

**Fix.** Split server-only deps into their own install, or prebuild the backend to JS. (Verified safe: the five `import type { VercelRequest, VercelResponse }` imports — `chesscom.ts:11`, `lichess.ts:10`, `review/[gameId].ts:8`, `migrate.ts:10`, `status.ts:9` — are all type-only, so `--omit=dev` does not break despite `@vercel/node` being a devDependency.)

### F8 — `trust proxy: 1` is likely wrong behind Cloudflare, collapsing all clients into one rate-limit bucket
**Defect.** `createApp.ts:16` sets `app.set('trust proxy', 1)`. The live probe shows `Server: cloudflare` plus `x-render-routing`, i.e. Cloudflare in front of Render's router — likely ≥2 hops.

**Failure scenario.** Express's numeric trust-proxy takes the address *n* hops back from the socket. With the wrong hop count, `req.ip` becomes a proxy address (every client shares one bucket — this compounds F2 into an outage) or becomes client-spoofable via `X-Forwarded-For` (the limiter becomes bypassable).

**Fix.** I can't settle which without a live service. Temporarily echo `req.ip` and `req.headers['x-forwarded-for']` from `/api/health` against the real deploy and set the hop count from the measurement. Do this before trusting the limiter at all.

### F9 — Missing security headers, 404 handler, and error handler on the Render path
**Defect.** `vercel.json:18-28` sets CSP / `nosniff` / `X-Frame-Options` / `Referrer-Policy` — Vercel-served responses only. Render sends none (`grep helmet` across `package.json` and `backend/` returns nothing). `router.ts` has no terminal 404 or error middleware.

**Failure scenario.** I swept the dispatch table programmatically: `/api/nope` and `/api/games/upload/extra` fall through to express's `finalhandler`, returning HTML `Cannot GET …` from a JSON API. A malformed JSON body hits express's **default error handler**, which includes `err.stack` when `NODE_ENV !== 'production'`. `render.yaml:26-27` sets `NODE_ENV=production` and Vercel sets it automatically, so production is covered today — but the protection is an env var, not code. Also `/api/health` returns `process.uptime()` (`router.ts:67`) under `ACAO: *` — an unauthenticated restart-timing fingerprint to any origin.

**Fix.** Add `helmet` (or the 4 headers manually) plus a JSON 404 and a JSON error handler at the end of `router.ts`, so the stack-trace suppression is structural rather than env-dependent.

### F10 — `review/save` accepts a non-ObjectId `gameId` and 500s on it
**Defect.** `zodSchemas.ts:169` types it `z.string().min(1).max(64)`; `review/save.ts:61` passes it straight to `Game.findById`.

**Failure scenario.** Any non-ObjectId string ⇒ CastError ⇒ generic 500 instead of 400. Every other id-taking route validates shape first (`games/[id].ts:20`, `sessions/[id].ts:48/:72/:111`, `master/[id].ts:23`, `review/[gameId].ts:27`, `status.ts:22`) — this one is the outlier.

**Fix.** `mongoose.isValidObjectId(gameId)` guard before the query, matching the other routes.

### F11 — `POST /api/review/job` is an unauthenticated shared namespace keyed on a client-chosen id
**Defect.** `review/job.ts:52` is `optionalAuth` with `userId: null` for anonymous, and the unique key is `{clientJobId, userId}` (`models/ReviewJob.ts:67`) where `clientJobId` is entirely client-supplied (`job.ts:35`).

**Failure scenario.** Any anonymous caller knowing another's `clientJobId` reads (`job.ts:110`) and overwrites that job. Generated ids are `job_<base36 timestamp>_<7 random chars>` (`ReviewTab.tsx:55-59`), so not practically enumerable, and only progress telemetry leaks.

**Fix.** Low priority. If tightened: bind anonymous jobs to a server-issued opaque id rather than accepting a client-chosen key.

### F12 — `POST /api/engine-index/migrate` is now unbounded, with a non-constant-time key compare
**Defect.** `migrate.ts:20-22` compares with `!==`; `migrate.ts:33` allows up to 5000 games per call.

**Failure scenario.** With the serverless 30 s ceiling gone on Render, one valid key pins the 0.1 vCPU instance for minutes. It shares the ordinary 150/15min bucket rather than a tighter one.

**Fix.** `crypto.timingSafeEqual`, a much tighter dedicated rate limit, and lower the max page size now that paging works.

### F13 — Dead, already-drifted duplicate Zod schemas
**Defect.** `backend/zodSchemas.ts` contains eight schemas with **zero importers**, each shadowed by a route-local copy: `positionCacheSchema`, `positionEvalQuerySchema`, `uploadPgnSchema` (vs `upload.ts:9`), `createSessionSchema` (vs `sessions/create.ts:9`), `updateSessionSchema` (vs `sessions/[id].ts:24`), `registerSchema` (vs `auth/register.ts:8`), `loginSchema` (vs `auth/login.ts:8`), `updatePreferencesSchema` (vs `auth/preferences.ts:7`). Only `importChessComSchema`, `importLichessSchema`, `gameReviewResultSchema`, `reviewSaveSchema` are live.

**Failure scenario.** The drift is already real: `zodSchemas.ts:188-206` `positionCacheSchema` describes `evaluation: {cp, mate}` and `lines[].{cp, mate, pv}` with **no `turn` field** — the wrong shape entirely. The enforced schema is `cache.ts:21-42` (`{type, value}` + `turn`). This is exactly the mismatch class that produced the earlier silently-stripped-evaluation corruption documented at `cache.ts:68-72`; the next person to "reuse the shared schema" reintroduces it.

**Fix.** Delete the eight dead schemas, or make the routes import them. Related: `sf18-full` is still an accepted enum in six places (`zodSchemas.ts:24/:184/:190`, `cache.ts:23`, `auth/preferences.ts:10`, `models/User.ts:37`) though the build was dropped — a client can shard the cache into a namespace no reader queries. And `gameReviewResultSchema.moveReviews` (`zodSchemas.ts:156`) has no `.max()`, bounded only by the 5 MB body limit.

### F14 — Failover has a blind spot that pairs badly with F5
**Defect.** `apiBase.ts:41-47` retries only on 502/503/504 or a transport-level error.

**Failure scenario.** Today the primary 404s with **no ACAO header**, so a browser cross-origin fetch fails at the CORS layer, `error.response` is undefined, and failover fires correctly — the current dead-Render state is handled. But once the service exists, any 4xx/5xx from a genuinely broken deploy **sticks**. With F5: Render boots without `MONGODB_URI`, health is green, every request 500s, and the client never falls back to the working Vercel function.

**Fix.** Treat a 500 on `/health` (or a 500-rate threshold) as failover-eligible.

---

## 2. Correctness

**Router dispatch table (`router.ts:72-104`) is correct.** I re-implemented the table and swept every registered path plus edge cases. Every route resolves to its own module; **nothing is shadowed or unreachable.** `/api/games/upload` correctly precedes `/api/games/[^/]+`; `/api/master/games`, `/api/review/{save,job}` and `/api/sessions/create` all precede their param patterns. `/api/games` and `/api/games/` both reach `gamesIndex` (express default `strict routing: false`). `/api/health` is handled by the outer `app.get` at `router.ts:60` before the dispatcher, so its non-match in the table is expected.

One subtlety to know rather than change: five modules export `function handler(req, res)` (`chesscom.ts:193`, `lichess.ts:196`, `review/[gameId].ts:55`, `migrate.ts:81`, `status.ts:61`) while the dispatcher calls `match[1](req, res, next)` (`router.ts:103`). The third argument is dropped, so an unmatched method inside those apps terminates in the inner `finalhandler` instead of continuing the outer chain. Inert today because the table is path-exact, but those five behave differently from the twenty that export the app directly.

`app.set('trust proxy', 1)` is on the *inner* apps only (`createApp.ts:16`), not the outer router. That's correct — express re-prototypes `req` in each app's `expressInit`, so `req.app` is the inner app by the time `req.ip` is read. Whether the value `1` is right is F8.

**DB connection reuse (`db.ts:34-82`) is correct for both shapes.** The `readyState === 1` fast path, the shared in-flight promise, the `connecting = null` reset on rejection (`:72`) so a failed connect is retryable, and the `process.env.VERCEL`-keyed pool sizing (`:55` — 5/10 s serverless vs 20/45 s persistent) are all right, and the comment at `:38-43` accurately explains why the shared promise is load-bearing under `bufferCommands: false`. One gap specific to the persistent server: no `connection.on('error'|'disconnected')` handler resetting `cached`, so after a socket drop `cached` points at a stale Connection object. Mongoose reuses one default connection and reconnects itself, so this is a documentation gap, not a bug — but it's the one thing that behaves differently on a 30-day process than a 30-second one.

**Error handling does not leak internals in production.** Every route catch logs server-side and returns a fixed string (`cache.ts:112-113`, `eval.ts:48-49`, `review/[gameId].ts:50-51`, consistently throughout). The two exceptions are structural, not per-route: express's default handler (F9), and Zod issue arrays echoed on 400s (`cache.ts:50`, `job.ts:57`, `review/save.ts:53`, `chesscom.ts:79`, `lichess.ts:81`) — field names and constraints only, acceptable for a public API.

**Outbound timeouts:** correct on the tablebase proxy (`tablebase.ts:47-52, 93-95`); **absent** on all four import fetches (F1).

---

## 3. What must change for the position cache to accept anonymous writes safely

Two distinct threats: **poisoning** (one bad eval silently corrupts every future review of that position, cross-user, permanently — `Position` has no TTL) and **storage exhaustion** (Atlas M0 is 512 MB).

**A. Prove the payload is self-consistent — server-side, cheap, no engine.**
1. **Reject any FEN that isn't the normalized 4-field key.** `cache.ts:59-60` accepts a 6-field FEN and stores it verbatim (`:88, :94, :104`) while every reader queries the 4-field form (`positionCache.ts:83`) — a 6-field write creates a permanently unreachable row.
2. **Derive `turn` from the FEN; ignore the client field.** `cache.ts:73` currently *prefers* `parsed.data.turn`. The current reader ignores stored `turn` (`GameReviewService.ts:205-212` derives `mover` from the FEN it queried), so this is latent — but it's a stored lie awaiting the first reader that trusts it.
3. **Verify every `lines[].pv[0]` is legal in that FEN**, and `lines[0].pv[0]` equals the claimed best move. One `new Chess(fen).moves({verbose:true})` per line, ≤5 lines, sub-millisecond. This alone defeats the cheapest poison: you can no longer claim "the best move here is a blunder."
4. **Bound scores:** `|cp| ≤ 10000`, `1 ≤ |mate| ≤ 100`, reject both present, require consistent mate sign. Today `evaluation.value` is only `z.number().int()` (`cache.ts:28`).
5. **Require `lines.length ≥ 1`, `lines[0].multipv === 1`,** multipv distinct and contiguous from 1.
6. **Constrain `pv`:** `cache.ts:38` is `pv: z.array(z.string())` — unbounded count, arbitrary strings. Cap ~40 plies, match `/^[a-h][1-8][a-h][1-8][qrbn]?$/`.
7. **Reject `depth < 12`** — shallow evals are worthless to the cache and are what a spam script sends. Costs an honest reviewer nothing.
8. **Reject `engineVersion` outside the live `ENGINE_CONFIGS` set** — drop `sf18-full` (F13).

**B. Make a poisoned entry non-authoritative rather than trusted.**
9. **Trust-on-second-confirmation.** Store an agreement counter; a reader only *uses* an entry once ≥2 independent submissions agree within ~30 cp. Until then it's advisory. Highest-value guard by a wide margin — it turns poisoning from "one POST" into sustained coordinated effort, and it's the cheap version of Lichess's federated cloud eval.
10. **Never let a shallower-or-equal write overwrite a deeper one.** `cache.ts:88-91` has the right idea — but **fix F4 first**, or the guard reads the wrong row.
11. **Record `createdBy: userId ?? null` plus a salted IP hash** (not raw IP) so a bad batch is findable and purgeable without storing PII. With (9), one abuser's rows never reach readers.

**C. Bound cost and volume.**
12. **Give this route its own, much tighter limit, decoupled from the read bucket** — writes are ~1 per position, so roughly "one game's worth per few minutes" (e.g. 200/hour, 20/min burst) fits an honest reviewer and starves a script. Needs the shared store the moment Render is single-process: a `MemoryStore` limit resets on every cold start, and per F8 the key may not even be the client.
13. **Add a TTL or hard size cap to `Position`** — `models/Position.ts:33-45` has neither. `computedAt` TTL ~90 days plus a document-count watch. At ~1 KB/doc, 512 MB is ~500 k positions; a writer at the (12) burst rate reaches that in weeks, unthrottled in hours.
14. **Stop echoing the stored document.** `cache.ts:110` returns the whole row — a free confirmation oracle for a writer. `{ ok: true, depth }` suffices.

**Minimum viable set:** (1)(2)(3)(4)(6) validation + (10) after fixing F4 + (12) a separate tighter limit + (13) a TTL. I'd add (9) before letting cache hits drive anything user-visible — a poisoned eval is silent, cross-user, and permanent, which is the hardest failure mode to notice.

**Alternative worth considering:** mint a server-signed anonymous session token at page load (no account, no UI). It doesn't stop poisoning, but it makes (12) enforceable per-browser instead of per-IP — which is what actually matters behind carrier NAT — and it unblocks the cache without building the auth pages.

---

## 4. Is `backend/index.ts` production-grade for free-tier Render?

**Close, with five real gaps.** Already right: `keepAliveTimeout = 120_000` / `headersTimeout = 121_000` (`index.ts:21-22`) correctly exceeds Render's proxy reuse window (this is the fix for the intermittent-502 class); SIGTERM/SIGINT drain with a 10 s `unref()`'d hard exit (`:24-36`) and `mongoose.disconnect()` before exit (`:30`); `PORT ?? API_PORT ?? 3000` (`:11`) matches Render's injection; health endpoint is DB-free and cheap (`router.ts:60-68`) and sets its own `ACAO: *` because the outer app has no `cors()` — the comment at `:62-65` is correct and wildcard is right for a credential-free public probe.

Gaps:
1. **No boot-time env validation** (F5) — highest-value single line to add.
2. **No `unhandledRejection` / `uncaughtException` handler.** On Node 20 an unhandled rejection terminates the process and Render restarts *cold* (30-60 s). One bug in a rare path becomes a minute of downtime.
3. **The graceful drain will essentially never complete.** `server.close()` waits for idle keep-alive sockets, and `keepAliveTimeout` is 120 s — far past the 10 s hard-exit timer. `server.closeIdleConnections()` is the missing call; without it the "graceful" path is always `process.exit(1)`.
4. **No request timeout**, so a hung chess.com fetch (F1) holds a connection and pool slot for ~300 s. Vercel's `maxDuration: 30` was doing this job.
5. **Memory / cold-start:** 348 MB unused deps (F7), runtime `tsx` transpile of 25+ modules per boot, plus the `ipHits` leak (F6). On 512 MB / 0.1 vCPU these are not cosmetic.

**Cold start vs. the client probe — the most consequential item here.** `render.yaml:10-12` documents a 30-60 s spin-up, but the client's boot probe times out at **4 s** (`apiBase.ts:89`). The first visitor after any idle period *always* fails the probe and gets stickily pinned to the Vercel fallback for a full 5 minutes (`apiBase.ts:83`). So the keep-alive pinger in `docs/deploy-render.md:22` is not a nice-to-have — it is load-bearing for the primary ever being used. Without it the Render service is a 750-hour/month no-op.

**Health endpoint caveat.** Deliberately not touching Mongo is correct for a keep-alive target, but it means `healthCheckPath` (`render.yaml:24`) cannot detect F5. A separate `/api/health/deep` that pings the DB — used by monitoring, not by Render's health check — closes that.

---

## 5. What breaks when the Render service starts existing

1. **Reviews start hitting 429** (F2). The limiter was inert on serverless; it isn't on one process. Most likely to be perceived as "the app got worse after deploy."
2. **Missing outbound timeouts become unbounded** (F1) — the 30 s serverless ceiling was the only backstop.
3. **`ipHits` becomes a real leak** (F6) on a 512 MB instance with long uptime.
4. **A broken deploy becomes un-failoverable** (F14 + F5): health green, all requests 500, client never falls back.
5. **The duplicate-`Position` race becomes reachable** (F4). The Vercel function stays deployed and live, so two processes write the same collection concurrently — plus every client pinned by a 5-minute sticky failover.
6. **Vercel preview deployments never exercise the primary.** The allowlist is `FRONTEND_URL` + localhost only (`corsOrigins.ts:15-22`, `render.yaml:28-29`). A `*-git-*.vercel.app` preview gets no ACAO → browser reports a network-class error → `isFailoverEligible` returns true (`apiBase.ts:45`) → silent fallback to same-origin. Working-but-degraded, and previews then test only the fallback path. Set `CORS_EXTRA_ORIGINS`.
7. **`/api/positions/tablebase` never migrates.** `tablebase.ts:60` hardcodes `TABLEBASE_PROXY_ENDPOINT = '/api/positions/tablebase'` — same-origin, bypassing `getActiveApiBase()` entirely. The tablebase cache keeps running on the Vercel function with its own Mongo pool while everything else moves. Functionally harmless (it also has a direct-to-Lichess fallback at `:132-139`), but it's the one client call that can never fail over, and it feeds (5).
8. **`trust proxy: 1` correctness becomes load-bearing** (F8) — it only matters once the limiter matters.
9. **`/api/engine-index/migrate` loses its natural bound** (F12).

---

## 6. Verified sound — don't re-audit

- **No NoSQL operator injection anywhere.** Every `req.query` value reaching a Mongo filter is `typeof === 'string'`-guarded first: `eval.ts:24/:30/:34`, `tablebase.ts:32`, `master/games.ts:29/:33/:38/:43`, `openings/lookup.ts:25`, `openings/search.ts:30`, `openings/tree.ts:24`. `?engine[$ne]=x` parses to an object under express's default `qs` parser and is dropped.
- **Regex from user input is escaped:** `openings/search.ts:18-19`, `master/games.ts:17-19`. `openings/tree.ts:33` interpolates `^${letter}` but only after `/^[A-E]$/` at `:29`.
- **No SSRF in either import proxy or the tablebase proxy.** Base URLs are module constants (`chesscom.ts:19`, `lichess.ts:18`, `tablebase.ts:17`); the only user-controlled segment passes through `encodeURIComponent` (`chesscom.ts:99/:111`, `lichess.ts:97/:115`, `tablebase.ts:51`), which encodes `/ : ? # @` and traversal sequences; Zod caps `username` at 50 chars. The host cannot be redirected.
- **Auth primitives correct:** HS256 pinned against alg-confusion (`auth.ts:27, :48`), secret length asserted ≥32 (`auth.ts:11`), bcrypt cost 12 (`register.ts:31`), `passwordHash` stripped from every response (`register.ts:42`, `login.ts:37`, `me.ts:12`), uniform `Invalid credentials` on both login branches (`login.ts:26, :29`), single combined message for the email-or-username collision (`register.ts:26-28`) — the right call for enumeration resistance.
- **`sessions/[id].ts:98` `Object.assign(session, parsed.data)` is safe** because `updateSchema` is `.strict()` (`:33`). Caveat: `moveTreeNodeSchema` is `.passthrough()` (`:17`), so arbitrary nested keys land in a `Mixed` field and are replayed into the client's move tree later. Own-data only — a hardening note (tighten the node schema), not a vulnerability.
- **Ownership checks consistently correct** where they exist: `games/[id].ts:30, :53`, `sessions/[id].ts:58-61, :94, :120`, `review/[gameId].ts:43`, `status.ts:44`, `review/save.ts:65-71`. `userId` correctly goes in `$setOnInsert` never `$set` on both import paths (`chesscom.ts:176`, `lichess.ts:179`) so a re-import can't reassign ownership, and the `{source, sourceGameId, userId}` unique index (`models/Game.ts:120-123`) matches those filters.
- **Payload limits set** (`express.json({ limit: '5mb' })`, `createApp.ts:23`) with PGN/notes/tag/array bounds throughout the Zod schemas.
- **CORS allowlist construction correct and unit-tested** (`corsOrigins.ts`, `corsOrigins.test.ts` — 5 cases: FRONTEND_URL precedence, CSV parsing, trailing-slash stripping, dedupe).

---

## Suggested order of work

**Before Render goes live** — these turn a working app into a broken one at cutover: F2 (rate-limit budget), F5 (boot env assert), F1 (outbound timeouts), F8 (verify `trust proxy`), F6 (drop redundant `ipHits`).

**Then, to make the cache real:** F3 (route `AuthPage`, or take the anonymous-token path in §3), F4 (index/filter), then the §3 guard set.

**Then hardening:** F9, F7, F14, F10, F11, F12, F13.