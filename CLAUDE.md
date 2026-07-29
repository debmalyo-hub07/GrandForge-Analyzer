# CLAUDE.md

Guidance for Claude Code in this repository. This file loads on every session,
so it stays short: commands, hard invariants, and a routing table. All detail
lives in `docs/arch/*.md` — read one only when working in that area.

GrandForge is a browser-based chess analysis platform: React 18 + Vite 5 + TypeScript frontend, Stockfish (16/17/18) WASM running in a Web Worker, and one Express API (`backend/router.ts`) **dual-deployed** — persistent server on Render (primary, `backend/index.ts`) + Vercel serverless function (fallback, `api/[...path].ts`) — backed by MongoDB Atlas.

Repo layout: `frontend/` (React app — `src`, `index.html`, `public`; Vite `root` with `envDir` kept at the repo root so `.env` / `.env.production` still load), `backend/` (the whole Express API + server entry), `api/` (1-file Vercel adapter only — never put logic here), `scripts/` (seeds + copyStockfish), one root `package.json` for both.

## Commands

```bash
npm run dev          # concurrently runs the API (tsx backend/index.ts, :3000) and Vite web (:5173)
npm run web:dev      # frontend only (Vite, :5173) — proxies /api to :3000
npm run api:dev      # API only (Express, :3000)
npm run api:start    # runs dist-server/backend/index.js (Render's start command; needs api:build first)
npm run build        # tsc (typecheck, noEmit) then vite build → dist/
npm run api:build    # compile the API to dist-server/ (CommonJS) — what Render deploys
npm run typecheck    # tsc --noEmit
npm test             # vitest run (node env, frontend/src + backend + scripts tests)
npm run test:watch   # vitest watch
npx vitest run frontend/src/utils/reviewUtils.test.ts   # single test file
vercel dev           # full prod-like local stack (serverless API + web), see README
```

Seeding (requires `.env` with `MONGODB_URI`):

```bash
npx tsx scripts/seedOpenings.ts       # CC0 ECO opening book → MongoDB (preserves `description`)
npx tsx scripts/seedOpeningTheory.ts --dry-run   # our own theory prose → Opening.description
npx tsx scripts/seedMasterGames.ts    # master games corpus → MongoDB
npx tsx scripts/ingestExplorer.ts --from <dir|file> --dry-run   # opening-explorer aggregate (docs/explorer-ingest.md)
```

Run `seedOpenings` before `seedOpeningTheory` on a fresh database — the theory seeder only ever updates rows that already exist.

`predev` / `prebuild` hooks run `scripts/copyStockfish.mjs` automatically, copying the sf18 WASM binaries from `node_modules/stockfish/bin` into `frontend/public/stockfish/`. The sf16 and sf17.1 binaries (plus `nn-5af11540bbfe.nnue`, the ~40 MB sf16 runtime network) are committed directly under `frontend/public/stockfish/` — the copy script only guards their presence, it does not produce them. After `npm install`, run the script once before the first dev/build if it didn't fire.

**Quality gate for any change: `npm run typecheck` → `npm test` → `npm run build`, all green.** For engine/board/review UI changes also run `npm run test:e2e` (Playwright; boots the Vite dev server itself).

## Routing table — read only what the task needs

| Working on | Read first |
|---|---|
| `EngineManager.ts`, UCI, watchdogs, engine builds/options | `docs/arch/engine.md` |
| `engineStore` / `gameStore` / move tree / persistence | `docs/arch/state.md` |
| review, classification, accuracy, phases, eval tiers | `docs/arch/review.md` |
| `backend/**`, routes, rate limits, deploy, `db.ts` | `docs/arch/api.md` |
| shared eval cache, anonymous writes, guards | `docs/arch/position-cache.md` |
| explorer model / lookup / offline ingest | `docs/arch/explorer.md` |
| `scripts/data/openingTheory/**`, theory seeder | `docs/arch/opening-theory.md` |
| pages, board overlays, panels, eval graph, trainer | `docs/arch/frontend.md` |
| adding or fixing tests | `docs/arch/testing.md` |
| env vars, CSP/COOP/COEP, Vite config, the `NODE_ENV` trap | `docs/arch/environment.md` |

Index and archival policy: `docs/arch/README.md`. `docs/superpowers/audits/**` and `exec-*.log.md` are **archival — do not read for orientation** (see `docs/superpowers/README.md`).

## Working economically

Context is cost. Default to the cheapest thing that answers the question.

- **Read narrowly.** Grep or glob to find the lines that matter, then read that file — or that range. Don't read a directory to get oriented; the routing table above is the orientation.
- **Skills and plugins: on demand only.** Do not invoke a skill because it *might* apply. Invoke one when the task plainly is the thing that skill does, or when the user names it. A skill body is thousands of tokens, and a wrong guess pays for them twice.
- **Subagents** are for work that is genuinely parallel or genuinely large (a sweep across many files). One directed grep does not need an agent.
- **Don't re-verify what's already green.** Run the quality gate once per change set, at the end — not after each edit.
- **Don't restate.** No plan recaps, no summaries of files just read, no narration between tool calls.

## Hard invariants

Each line is a rule that has already been broken once. The pointer is the file with the reasoning.

- Gate prod-excluded code on `import.meta.env.MODE === 'development'`, never `DEV` — `.env` sets `NODE_ENV=development`, so a local `vite build` has `DEV=true`. → environment.md
- Do not shrink `DEPTH_GRACE_MS` (90 s). A tight info-gap grace reaps healthy deep searches — that was "depth freezes at 20–26". → engine.md
- Never `setoption` something a build's `supportedOptions` doesn't advertise, and never mid-search (post before `position`). → engine.md
- Don't remove `engineInitGeneration` in `initEngine` — without it a concurrent re-init leaves a dead manager in the store. → state.md
- The live-analysis guard is `phase === 'analyzing'` only. Gating on the whole review session freezes the eval bar. → state.md
- Adding a field to `GameReviewResult`/`MoveReview` means adding it to `gameReviewResultSchema`/`moveReviewSchema` — the schema strips unknown keys, so it is silently lost on save. → review.md
- Scoring constants are exact ports; `ALL_CLASSIFICATIONS` is the single source of truth for the 11 classifications. → review.md
- `ENGINE_VERSION_VALUES` in `zodSchemas.ts` is the only server-side engine list; the `EngineVersion` union lives in exactly three places and they move together. → engine.md, api.md
- New routes go under `backend/routes/**` plus one line in `backend/router.ts`. No logic in `api/` — Vercel Hobby caps at 12 functions. → api.md
- `/api/health` stays DB-free (Render health check + client failover probe). Deep checks belong in `/api/health/deep`. → api.md
- `dependencies` means "the API imports this at runtime". Frontend packages stay in devDependencies or the Render slug bloats. → api.md
- Never split a SAN move param on `+`. That silently made 297 of 3,733 ECO openings (8.0%) unmatchable. → explorer.md
- `averageElo` divides by `eloGames`, not `total` — unrated games would drag the average hundreds of points low, silently. → explorer.md
- Keep the explorer ingest's two passes separate (text trie, then one chess.js resolve). Collapsing them costs ~a day of CPU. → explorer.md
- `seedOpenings.ts` must snapshot and restore `Opening.description` around its `deleteMany` — otherwise a routine reseed destroys all hand-written theory. → opening-theory.md
- A theory entry's `moves` must equal `Opening.moveSequence` byte-for-byte. A wrong key doesn't error; it attaches prose to a line nobody opens. → opening-theory.md
- In `EvalGraph`, the white fill sits *below* the curve. Don't flip it back. → frontend.md
- Tests must never write to the real database. → testing.md
- No new tests under `frontend/src/**/__tests__/` — that path is gitignored here. → testing.md
- Do not modify `.env` (`MONGODB_URI`, `JWT_SECRET`).

## Product constraints

- **Independence.** The platform must not depend on, or reveal a dependency on, any other chess site's engine, database, algorithm or servers. Stockfish is open source and self-hosted here; the opening catalogue is CC0; the explorer aggregate and all theory prose are our own. No app code path contacts a third-party chess service (the lichess tablebase is the one deliberate, CORS-only exception).
- **No third-party platform names in the UI.** Engine and binary names are fine in files, configs and docs — they must not appear in user-facing copy or design. Both this and the independence rule are grep-enforced in `scripts/data/openingTheory.test.ts`.
- **Free for everyone, no forced sign-up.** Accounts are optional; analysis, review and explorer must work fully for anonymous visitors. The free-tier cost controls are load-bearing — long cache headers, render-only-the-active-panel, ply caps, per-route rate-limit tiers. Don't remove one for convenience.
- **Windows / PowerShell is the primary shell.** A Bash tool is available for POSIX scripts.

