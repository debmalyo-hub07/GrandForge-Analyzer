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

## Verifying failover

- Suspend the Render service (dashboard → Suspend) → reload the app → imports/openings/review-cache still work via `/api` (Vercel). The console logs one `[GrandForge] API primary … failing over` warning.
- Resume the service → within ~5 minutes the client switches back (console `API primary recovered`).

## Rollback

Delete or blank `VITE_API_BASE_URL` in `.env.production` and push — the client returns to same-origin `/api` (Vercel serverless) unconditionally. The Render service can stay up or be suspended; nothing else references it.

## Operational notes

- **Rate limit**: 150 requests / 15 min / IP **per route module** (~25 independent buckets, `backend/createApp.ts` — a single global bucket would 429 a normal game review's ~160 position-cache requests). In-memory — resets on restart/deploy.
- **Admin migrate**: `POST /api/engine-index/migrate` (header `x-admin-key`) now pages: `?limit=N` (default 500, max 5000), response includes `remaining` — repeat until 0. The serverless 30 s ceiling no longer applies on Render.
- **ReviewJob TTL**: job telemetry auto-expires 30 days after last update (Mongo TTL on `updatedAt`). Review RESULTS are unaffected (they live on Game/Session).
- **DB pool**: the persistent server uses `maxPoolSize 20` / `socketTimeoutMS 45000`; serverless keeps the old tight settings (`backend/db.ts`, keyed on `process.env.VERCEL`).
- **Logs**: Render dashboard → Logs streams the request logger output (method, path, status, ms).

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
