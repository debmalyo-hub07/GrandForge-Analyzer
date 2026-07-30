# Deploying the GrandForge API to Render (free tier)

The repo dual-deploys one API codebase (`backend/router.ts`):

- **Primary** — persistent Express server on Render (`backend/index.ts`, blueprint `render.yaml`).
- **Fallback** — the existing Vercel serverless function (`api/[...path].ts`), same routing table, kept deployed. The client (`frontend/src/services/apiBase.ts`) probes the primary at boot and fails over stickily to same-origin `/api` whenever Render is unreachable, re-probing every 5 minutes.

## One-time setup (~10 minutes, no credit card)

1. **Create the service from the blueprint**
   - <https://dashboard.render.com> → New → **Blueprint** → connect the GitHub repo.
   - Render reads `render.yaml` and proposes the `grandforge-api` web service (free plan, Singapore region — change the region in `render.yaml` first if your Atlas cluster lives elsewhere).
2. **Fill in the secret env vars when prompted** (values are in your local `.env` — copy them from there, never commit them):
   - `MONGODB_URI`
   - `JWT_SECRET`
   - `ADMIN_KEY`
   - `NODE_ENV=production` and `FRONTEND_URL` are pre-filled by the blueprint.

   **Check `FRONTEND_URL` against your real Vercel domain before deploying.** The
   blueprint ships `https://grand-forge-analyzer.vercel.app`. This value is the
   CORS allowlist (`backend/corsOrigins.ts`), and Render is a cross-origin host,
   so a mismatch means every browser request is blocked by CORS — with a clean
   200 in Render's logs and the failure visible only in the browser console. Copy
   the domain from the Vercel dashboard verbatim, no trailing slash. Preview
   deployments need `CORS_EXTRA_ORIGINS` (comma-separated) since each gets its
   own subdomain.
3. **Allow Render to reach Atlas**: MongoDB Atlas → Network Access → ensure `0.0.0.0/0` is allowed (already the case if Vercel works, since Vercel egress IPs are dynamic too).
4. **Deploy** and wait for "Live". Verify:
   - `https://grandforge-api.onrender.com/api/health` → `{"ok":true,"uptime":…}`
   - `https://grandforge-api.onrender.com/api/openings/search?q=sicilian` → JSON results (proves DB connectivity).
5. **Keep-alive pinger** (hides the 15-min free-tier spin-down): create a free monitor at [cron-job.org](https://cron-job.org) or [UptimeRobot](https://uptimerobot.com) that GETs `https://grandforge-api.onrender.com/api/health` **every 10 minutes**. One always-on service fits the 750 instance-hours/month budget (~744 h).
6. **Ship the frontend switch**: the committed `.env.production` already points `VITE_API_BASE_URL` at the Render URL, and `vercel.json`'s CSP `connect-src` already allows it — the next `git push` (Vercel build) activates the dual-deploy client.

## If you rename the service

The service name IS the URL. Update all three together:

1. `render.yaml` → `name:`
2. `.env.production` → `VITE_API_BASE_URL`
3. `vercel.json` → CSP `connect-src` entry

## Verify once, right after the first deploy

These two can only be checked against a real deploy, and both are silent when wrong.

**1. Proxy hop count.** `backend/createApp.ts` sets `trust proxy` to 1, which assumes exactly one proxy prepends to `X-Forwarded-For`. If Render fronts the service with two, every request rate-limit-keys to the same intermediate address and one client can exhaust a bucket for everybody — with no error anywhere.

```bash
curl -s https://grandforge-api.onrender.com/api/health/deep
# → {"ok":true,...,"proxy":{"hops":1,"trustProxy":1,"clientIp":"<your real IP>"}}
```

`hops` must be `1` and `clientIp` must be **your** address, not a `10.x`/`172.x` internal one. If `hops` is 2, raise `trust proxy` to match in `createApp.ts` **and** in `router.ts` (the outer app sets it separately for the health routes).

**2. DB reachability from Render's region.** The same response carries `db.latencyMs` — a real `admin().ping()`, not a `readyState` check. Expect double-digit ms if the Atlas cluster is in/near `region: singapore`; 200 ms+ means the region pair is wrong and every request pays it.

Note `/api/health/deep` is deliberately **not** the Render health-check path and **not** the client's failover probe — both use the DB-free `/api/health`, so an Atlas blip can neither restart the service nor stampede every browser into failover.

## Verifying failover

- Suspend the Render service (dashboard → Suspend) → reload the app → imports/openings/review-cache still work via `/api` (Vercel). The console logs one `[GrandForge] API primary … failing over` warning.
- Resume the service → within ~5 minutes the client switches back (console `API primary recovered`).

## Rollback

Delete or blank `VITE_API_BASE_URL` in `.env.production` and push — the client returns to same-origin `/api` (Vercel serverless) unconditionally. The Render service can stay up or be suspended; nothing else references it.

## Operational notes

- **Build/start**: `npm ci && npm run api:build && npm prune --omit=dev`, then `node dist-server/backend/index.js`. The API ships as compiled CommonJS (`tsconfig.server.json` → `dist-server/`, with a `{"type":"commonjs"}` marker written by `scripts/buildServer.mjs` to override the root `"type": "module"`). Two reasons: free-tier Render spins down after 15 min idle so cold start is the normal path and `tsx` re-transpiled the whole backend on each one; and with a build step the frontend tree (react, the stockfish WASM package, vite, playwright, the vercel CLI) is all devDependencies that the prune deletes. `npm run api:start:tsx` still runs from source if you need it.
  **`dependencies` in package.json now means "the API imports this at runtime."** Anything else belongs in devDependencies, or the prune leaves it in the slug.
- **Rate limit**: per-IP, per 15 min, **per route module** (~25 independent buckets — a single global bucket would 429 a normal review partway through). Four tiers in `backend/createApp.ts`: `review` 900 (positions eval/cache/tablebase — one review is ~1 read per ply and `moveReviews` is bounded at 600), `browse` 400 (openings lookup/tree, master games), `default` 150, `strict` 20 (login/register brute-force surface, the chess.com/lichess import routes, admin migrate). In-memory — resets on restart/deploy; a shared store is the Phase 6 item.
- **Admin migrate**: `POST /api/engine-index/migrate` (header `x-admin-key`) now pages: `?limit=N` (default 500, max 5000), response includes `remaining` — repeat until 0. The serverless 30 s ceiling no longer applies on Render.
- **ReviewJob TTL**: job telemetry auto-expires 30 days after last update (Mongo TTL on `updatedAt`). Review RESULTS are unaffected (they live on Game/Session).
- **DB pool**: the persistent server uses `maxPoolSize 20` / `socketTimeoutMS 45000` / `maxIdleTimeMS 60000`; serverless is `maxPoolSize 2` / `maxIdleTimeMS 15000` (Atlas M0 caps at 500 connections total and dozens of lambdas can be warm during a review — a bigger per-lambda pool only reserves slots it never uses). Keyed on `process.env.VERCEL` in `backend/db.ts`.
- **Logs**: Render dashboard → Logs streams the request logger output (method, path, status, ms).

## Seed data — already applied

Both seeders have been run against the live Atlas cluster; you do not need to
repeat them for the deploy.

- `seedOpenings.ts` — 3,733 CC0 ECO openings.
- `seedOpeningTheory.ts` — 330 own-authored descriptions attached to their
  openings. Verified idempotent (a second run reports `Updated 0; 330 already
  current`). Re-run it after any `seedOpenings.ts` reseed.

## One-time Atlas index migration (after deploying the 2026-07 correctness fixes)
`autoIndex` creates new indexes but never drops old ones. **The PGN-upload fix does not
take effect until #1 is dropped** (same key, different options → `IndexOptionsConflict`
blocks the new build). Confirm real names with `db.<coll>.getIndexes()` first; do NOT
drop `tablebaseentries.fen_1` or any `_id_`.

```js
// 1. REQUIRED — old sparse dedupe index blocks the new partial one
db.games.dropIndex('metadata.source_1_metadata.sourceGameId_1_userId_1');
// 2. Superseded unique key (positions had 0 docs at audit time)
db.positions.dropIndex('fen_1_engineVersion_1_depth_1');
// 3. Redundant/unused (data-audit §1c)
db.games.dropIndex('userId_1');
db.games.dropIndex('metadata.sourceGameId_1');
db.games.dropIndex('metadata.ecoCode_1');
db.games.dropIndex('engineReady_1');
db.masterGames.dropIndex('featured_1');
db.masterGames.dropIndex('engineReady_1');
db.masterGames.dropIndex('tags_1');
db.masterGames.dropIndex('metadata.white_1');
db.masterGames.dropIndex('metadata.black_1');
db.reviewjobs.dropIndex('userId_1');
db.reviewjobs.dropIndex('gameId_1');
db.reviewjobs.dropIndex('clientJobId_1');
db.reviewjobs.dropIndex('status_1');
db.reviewjobs.dropIndex('userId_1_status_1_updatedAt_-1');
db.sessions.dropIndex('userId_1');
db.sessions.dropIndex('isPublic_1');
db.openings.dropIndex('ecoCode_1');
```
