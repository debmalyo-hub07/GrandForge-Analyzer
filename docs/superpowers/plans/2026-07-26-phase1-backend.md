# Phase 1: Persistent Backend (Render + Vercel fallback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the existing Express API as a persistent server on Render's free tier while keeping the Vercel serverless function as an automatic fallback, with the frontend failing over transparently.

**Architecture:** One shared routing table (`api/_lib/router.ts`) gets a second entrypoint (`server/index.ts`) for Render. The client resolves its API base from `VITE_API_BASE_URL` (set in committed `.env.production`) and falls back sticky to same-origin `/api` on network/5xx-gateway failures. CORS/limiter/db settings become environment-aware.

**Tech Stack:** Express 4, mongoose 8, tsx runtime (no build step for the server), Render Blueprint (`render.yaml`), Vite env files.

## Global Constraints

- Node >= 18 (`package.json` engines). Render runs `npm ci --omit=dev` → everything the server needs at runtime must be in `dependencies` (notably `tsx`).
- `api/_lib/**` must stay at repo root (Vercel functions convention; underscore prefix prevents extra functions).
- Quality gate: `npm run typecheck` → `npm test` → `npm run build`, all green. Playwright e2e if present on disk.
- No secrets in the repo: `.env` stays gitignored; `render.yaml` uses `sync: false` for MONGODB_URI / JWT_SECRET / ADMIN_KEY.
- Local dev behavior must not change: `npm run dev` still runs API :3000 + Vite :5173 with the `/api` proxy.

---

### Task 1: Server entry + scripts + dependency hygiene

**Files:**
- Create: `server/index.ts`
- Delete: `scripts/apiDev.ts`
- Modify: `package.json` (scripts, deps), `tsconfig.json:34` (include `server/**/*.ts`)

**Interfaces:**
- Produces: `server/index.ts` default-imports `api/_lib/router` and listens on `PORT ?? API_PORT ?? 3000`; exits gracefully on SIGTERM/SIGINT (close server, `mongoose.disconnect()`).

- [ ] **Step 1:** Write `server/index.ts`:

```ts
/**
 * GrandForge — persistent API server entry (Render primary; also local dev).
 * Imports the SAME consolidated Express app the Vercel serverless function
 * re-exports, so both deployments run one identical routing table.
 */
import mongoose from 'mongoose';
import app from '../api/_lib/router';

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);

const server = app.listen(port, () => {
  console.log(`GrandForge API listening on :${port} (${process.env.NODE_ENV ?? 'development'})`);
});

// Render's proxy holds keep-alive connections; Node's 5 s default causes
// intermittent 502s when the proxy reuses a socket the server just closed.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 121_000;

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — draining connections`);
  server.close(() => {
    mongoose.disconnect().finally(() => process.exit(0));
  });
  // Hard exit if drain hangs (Render sends SIGKILL at ~30 s anyway).
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- [ ] **Step 2:** `package.json`: `api:dev` → `tsx server/index.ts`; add `api:start` → `tsx server/index.ts`; move `tsx` from devDependencies to dependencies; move `@vercel/node` from dependencies to devDependencies. Delete `scripts/apiDev.ts`.
- [ ] **Step 3:** Add `server/**/*.ts` to tsconfig `include`.
- [ ] **Step 4:** `npm run typecheck` — PASS. `npm run dev` boot check — API answers on :3000 `/api/health`.
- [ ] **Step 5:** Commit `feat: server entry for persistent deploys`.

### Task 2: Environment-aware createApp (CORS allowlist + shared limiter)

**Files:**
- Create: `api/_lib/corsOrigins.ts`, `api/_lib/corsOrigins.test.ts`
- Modify: `api/_lib/createApp.ts`, `vite.config.ts:11` (test include gains `api/_lib/**/*.{test,spec}.ts`)

**Interfaces:**
- Produces: `buildAllowedOrigins(env: Record<string, string | undefined>): string[]` — `[FRONTEND_URL?, ...CORS_EXTRA_ORIGINS.split(',')]`, trimmed, deduped, trailing slashes stripped, plus always `http://localhost:5173` and `http://localhost:4173`.

- [ ] **Step 1:** Write failing tests: default env → the two localhost origins; FRONTEND_URL included; CSV parsing trims/drops empties; dedupe; trailing slash stripped.
- [ ] **Step 2:** Run — FAIL (module missing).
- [ ] **Step 3:** Implement `buildAllowedOrigins`; in `createApp.ts` use `cors({ origin: buildAllowedOrigins(process.env), credentials: true })` and hoist ONE `rateLimit` instance to module scope (single shared 150/15 min bucket per process instead of 25 per-route buckets).
- [ ] **Step 4:** Run tests — PASS.
- [ ] **Step 5:** Commit `feat: env-aware CORS allowlist + shared rate-limit bucket`.

### Task 3: DB pool tuning for persistent processes

**Files:**
- Modify: `api/_lib/db.ts:51-58`

- [ ] **Step 1:** `const serverless = !!process.env.VERCEL;` → `maxPoolSize: serverless ? 5 : 20`, `socketTimeoutMS: serverless ? 10000 : 45000`; keep `serverSelectionTimeoutMS: 5000`, `bufferCommands: false`. Comment why.
- [ ] **Step 2:** `npm run typecheck` — PASS. Commit `perf: env-aware mongoose pool`.

### Task 4: Bound the migrate walk + ReviewJob TTL

**Files:**
- Modify: `api/_lib/routes/engine-index/migrate.ts:30-34`, `api/_lib/models/ReviewJob.ts:68`

- [ ] **Step 1:** migrate: `const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 5000);` → `.limit(limit)` on the query; response adds `remaining` (`countDocuments({ engineReady: { $ne: true } })` after the loop). Rationale: the serverless 30 s ceiling no longer bounds this on Render.
- [ ] **Step 2:** ReviewJob: replace the plain `{ updatedAt: -1 }` index with `ReviewJobSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 2_592_000 })` (30-day TTL; job records are progress telemetry, results live on Game/Session). Note: the old `-1` index may linger in Atlas; harmless, drop manually if noticed.
- [ ] **Step 3:** typecheck + tests — PASS. Commit `feat: bounded migrate batches + ReviewJob TTL`.

### Task 5: Client API base resolution + sticky failover

**Files:**
- Create: `src/services/apiBase.ts`, `src/services/apiBase.test.ts`, `.env.production`
- Modify: `src/services/apiClient.ts:1-18`

**Interfaces:**
- Produces: `resolveApiBases(raw: string | undefined): { primary: string; fallback: string | null }`; `isFailoverEligible(error: { response?: { status?: number } } | null | undefined): boolean`; `getActiveApiBase()` / internal sticky state used by apiClient interceptors.
- Contract: `VITE_API_BASE_URL` is the FULL base including the `/api` path (e.g. `https://grandforge-api.onrender.com/api`). If the URL has no path, `/api` is appended. Unset/empty/`/api` → same-origin only, no failover machinery.

- [ ] **Step 1:** Failing tests: unset → `{ primary: '/api', fallback: null }`; `'https://x.onrender.com/api'` → `{ primary: same, fallback: '/api' }`; `'https://x.onrender.com'` → primary gains `/api`; trailing slash stripped; `isFailoverEligible`: no response → true; 502/503/504 → true; 400/401/404/500 → false.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `apiBase.ts`: the two pure functions + sticky runtime (`activeBase`, `markPrimaryFailed()`, `getActiveApiBase()`, boot probe `GET {primary}/health` with 4 s AbortController when primary is remote — on failure switch to fallback and schedule a 5-min re-probe that switches back on success; fire-and-forget warm-up ping either way).
- [ ] **Step 4:** `apiClient.ts`: request interceptor sets `config.baseURL = getActiveApiBase()`; response error interceptor — if eligible, fallback exists, request not already retried (`_gfRetried` flag) → `markPrimaryFailed()`, replay once against the fallback. No behavior change when `VITE_API_BASE_URL` is unset (dev/e2e).
- [ ] **Step 5:** `.env.production` (committed; verified NOT gitignored): `VITE_API_BASE_URL=https://grandforge-api.onrender.com/api` with a comment that the name must match `render.yaml`.
- [ ] **Step 6:** Tests + typecheck — PASS. Commit `feat: API base failover (Render primary, Vercel fallback)`.

### Task 6: render.yaml + CSP + health

**Files:**
- Create: `render.yaml`
- Modify: `vercel.json:17` (connect-src), `api/_lib/router.ts:61-63` (health uptime)

- [ ] **Step 1:** `render.yaml`: web service `grandforge-api`, runtime node, plan free, region singapore (comment: pick the region closest to the Atlas cluster), `buildCommand: npm ci --omit=dev`, `startCommand: npm run api:start`, `healthCheckPath: /api/health`, envVars: NODE_ENV=production, FRONTEND_URL=https://grand-forge-analyzer.vercel.app, MONGODB_URI/JWT_SECRET/ADMIN_KEY `sync: false`.
- [ ] **Step 2:** vercel.json CSP `connect-src` += `https://grandforge-api.onrender.com`.
- [ ] **Step 3:** health handler adds `uptime: process.uptime()`.
- [ ] **Step 4:** Commit `feat: Render blueprint + CSP for cross-origin API`.

### Task 7: Docs

**Files:**
- Create: `docs/deploy-render.md` (user runbook: Blueprint deploy, env var names — values come from local `.env`, never committed; keep-alive pinger via cron-job.org/UptimeRobot every 10 min at `/api/health`; verify + rollback steps)
- Modify: `README.md` (deploy section pointer), `CLAUDE.md` (Commands, API architecture, Environment notes: dual-deploy, `server/index.ts`, `VITE_API_BASE_URL`, CORS/limiter/pool env awareness; remove `scripts/apiDev.ts` references)

- [ ] **Step 1:** Write runbook + update README/CLAUDE.md. Commit `docs: Render deploy runbook + backend docs sync`.

### Task 8: Quality gates + adversarial verification

- [ ] **Step 1:** `npm run typecheck` && `npm test` && `npm run build` — all green.
- [ ] **Step 2:** e2e if present on disk (`npm run test:e2e`); restore from `67f6ab2^` if missing.
- [ ] **Step 3:** Multi-agent adversarial review of the full diff (correctness / security / deploy-config / regression dimensions); fix confirmed findings; re-run gates.
- [ ] **Step 4:** Final commit + push (push triggers the Vercel side of the dual deploy).
