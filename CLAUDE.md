# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

GrandForge is a browser-based chess analysis platform: React 18 + Vite 5 + TypeScript frontend, Stockfish (16/17/18) WASM running in a Web Worker, and a Vercel-serverless / Express API backed by MongoDB Atlas. There is no git repository here.

## Commands

```bash
npm run dev          # concurrently runs the API (tsx scripts/apiDev.ts, :3000) and Vite web (:5173)
npm run web:dev      # frontend only (Vite, :5173) — proxies /api to :3000
npm run api:dev      # API only (Express dev shim, :3000)
npm run build        # tsc (typecheck, noEmit) then vite build → dist/
npm run typecheck    # tsc --noEmit
npm test             # vitest run (node env, src/**/*.test.ts)
npm run test:watch   # vitest watch
npx vitest run src/utils/reviewUtils.test.ts   # single test file
vercel dev           # full prod-like local stack (serverless API + web), see README
```

Seeding (requires `.env` with `MONGODB_URI`):

```bash
npx tsx scripts/seedOpenings.ts       # Lichess ECO opening book → MongoDB
npx tsx scripts/seedMasterGames.ts    # master games corpus → MongoDB
```

`predev` / `prebuild` hooks run `scripts/copyStockfish.mjs` automatically, copying the sf18 WASM binaries from `node_modules/stockfish/bin` into `public/stockfish/`. The sf16 and sf17.1 binaries (plus `nn-5af11540bbfe.nnue`, the ~40 MB sf16 runtime network) are committed directly under `public/stockfish/` — the copy script only guards their presence, it does not produce them. After `npm install`, run the script once before the first dev/build if it didn't fire.

Quality gate for any change: `npm run typecheck` → `npm test` → `npm run build`, all green. For engine/board/review UI changes also run `npm run test:e2e` (Playwright; boots the Vite dev server itself).

## Environment notes

- Windows / PowerShell is the primary shell. A Bash tool is available for POSIX scripts.
- `.env` (gitignored, already present) holds `MONGODB_URI` and `JWT_SECRET` — do not modify these. The DB layer reads `.env` itself (see below); don't add a dotenv dependency.
- **`.env` also sets `NODE_ENV=development`** (fine for local `npm run dev`). Vite honours `NODE_ENV` from env files, so a *local* `npm run build` bakes `import.meta.env.DEV=true`/`PROD=false` — a React **development** bundle. This does **not** affect Vercel: Vercel builds with its own `NODE_ENV=production` (and the README's `vercel env add NODE_ENV production`), and `.env` is gitignored so it never reaches the build there. Consequence for code: never gate prod-excluded code on `import.meta.env.DEV` (it's `true` even in `vite build` locally) — gate on `import.meta.env.MODE === 'development'`, which tracks the real build mode and is *not* overridden by `NODE_ENV`. See `src/main.tsx` (dev test-hooks loader).
- WASM threading requires cross-origin isolation: both the Vite dev server (`vite.config.ts` `server`+`preview`) and production (`vercel.json`) send `COOP: same-origin` + `COEP: credentialless`. `credentialless` (not `require-corp`) keeps the page `crossOriginIsolated` (so the multi-threaded engine build gets `SharedArrayBuffer`) while letting cross-origin no-cors subresources — chess.com/lichess avatars, Google Fonts — load without each CDN sending a CORP header. The single-threaded `*-single.js` engine builds don't need isolation at all; cross-origin `fetch()` (e.g. the lichess tablebase) is CORS and unaffected.
- `optimizeDeps.exclude: ['stockfish']` and the manual copy step exist because the WASM/worker glue cannot go through Vite's dep pre-bundling.

## Architecture

### Engine layer (the core)

`src/services/EngineManager.ts` is a **serialized UCI wrapper** around one Stockfish Web Worker. The central invariant: only one `go` is ever in flight. Understand these three entry points before touching it:

- `analyze(req)` — fire-and-forget live analysis. A new request mid-search marks the current one `aborted`, sends `stop`, and queues the new one; the queue holds at most the *latest* request (live analyses supersede each other).
- `evaluate(req)` — one-shot, returns `Promise<SearchResult>`. Used by the review pipeline.
- `beginSession()` — sends one `ucinewgame` so the transposition hash survives across a batch of `evaluate({ skipNewGame: true })` calls (review reuses hash across plies).

The UCI sequence per search (startSearch): `ucinewgame?` → `setoption MultiPV` (before position so the count applies) → `position` → `isready` (barrier) → the `go` command. Search-mode precedence in `startSearch`: `moveTimeMs>0` → `go movetime N`; else `req.infinite` → `go infinite`; else `go depth N`. `bestmove` is the search terminator — only then does a queued request start.

**Infinite (continuous) analysis** is the lichess/chess.com-style "deepen until I stop" mode. `AnalyzeRequest.infinite` (live `analyze()` only — `evaluate()`/review never set it, they need a `bestmove` to resolve) makes `startSearch` emit `go infinite`; the search runs until `stop()` (position change supersede, engine off, or the Stop button). engineStore owns `infiniteMode` (persisted) + `setInfiniteMode`; `startAnalysis`/`startIndexedAnalysis` thread it through and null out `moveTimeMs` so infinite wins. UI: the "Infinite analysis" toggle + Stop/Resume in `EngineControls`.

**Two timers guard against hangs**, both keyed off `currentGraceMs` which is set per-search in `startSearch` via `infoGapGraceMs(req)`:
- Movetime searches → 15 s grace (they finish on their own clock).
- Fixed-depth searches → 90 s grace (depth-24+ can legitimately go 30–60 s between depth transitions; a tight gap would reap a healthy deep think). **Do not shrink `DEPTH_GRACE_MS`** — that was the bug behind "depth freezes at 20–26."
- Infinite searches → 300 s grace (`INFINITE_GRACE_MS`). `go infinite` only ends on our `stop`, so the info-gap watchdog is its *only* hang backstop; the grace must be long enough never to reap a search that has plateaued at high depth (info still flows while deepening, so a true wedge is still caught).

`ENGINE_CONFIGS` maps the four engine ids (`sf18-lite`, `sf18-lite-mt`, `sf17-lite`, `sf16-lite`) to their `public/stockfish/*.js` worker file. (The 113 MB `sf18-full` build was dropped for the public Vercel deploy — too heavy for worldwide users to download and it blew past Hobby bandwidth/size limits. To restore it, re-add an `ENGINE_CONFIGS` entry, the `EngineVersion` union member, and a `copyStockfish.mjs` target.) The `label`/`file` must match a real on-disk binary — there is no aliasing fallback. `sf18-lite-mt` carries `multiThreaded: true` (worker `stockfish-18-lite.js`, copied by `copyStockfish.mjs`); it spawns multiple WASM threads and so needs cross-origin isolation (COOP/COEP, already set) — the single-threaded `*-single.js` builds do not.

Two strength/telemetry options ride on `EngineOptions`, both off by default (default behavior byte-identical to before): `limitStrength`+`uciElo` emit `UCI_LimitStrength`/`UCI_Elo` (Elo clamped ~1320..3190) to cap engine strength; `UCI_ShowWDL` adds a per-mille `wdl W D L` triple (mover-relative) to score-bearing info lines → `EngineLine.wdl` → eval-bar display.

### State (zustand stores in `src/store/`)

- `engineStore.ts` — owns the `EngineManager` instance, subscribes to its event stream, and translates raw UCI `info` lines into displayable `EngineLine[]`. Two subtleties: (1) **eval-bar stability gate** `MIN_RENDER_DEPTH = 4` — the lines panel updates every depth, but the headline eval/bar only refresh once the search clears the gate for the current FEN, so it never flashes a depth-1 spike or collapses to center on a move; (2) on position change it does **not** blank `evalFormatted`/`rawCp`/`currentDepth` — it holds the previous valid values until the new search clears the gate. Persisted (localStorage `grandforge-engine`): only `engineVersion`, `depth`, `multiPV`, `engineSettings`, `moveTimeMs`, `infiniteMode` — never the runtime manager/lines/eval. UCI→SAN conversion is memoized via a bounded (2000-entry) LRU `sanCache`. **`initEngine` uses a module-level generation counter** (`engineInitGeneration`): a concurrent re-init (React StrictMode's dev double-mount, Vite HMR, rapid engine switches) could otherwise let the *older* `loadEngine()` resolve last and publish — then terminate — its own worker, leaving a dead manager in the store (no analysis until the next move). Only the latest generation may write `manager`; superseded calls terminate their orphan and return. Don't remove it.
- `gameStore.ts` — the move tree (`MoveTree`/`MoveNode`, a node map with a `root`), navigation, PGN/FEN/indexed-game loading. Any game (imported or hand-played) becomes reviewable via `buildIndexedGameFromTree`. Loading a new game calls `resetTransientStateForNewGame` (clears engine state, arrows, highlights, review); navigation calls `clearManualAnnotations` (manual arrows/highlights annotate one position only — review arrows live in their own layer and survive).
- `reviewStore.ts`, `uiStore.ts`, `importStore.ts` — review results/progress, UI prefs + manual arrows/highlights, and game-import flow.

Stores reference each other directly (e.g. `engineStore` reads `reviewStore.progress.phase`). The recurring guard `if (reviewStore.progress.phase === 'analyzing') return;` blocks live analysis **only while a batch review is crunching the worker** — browsing finished review results still gets live analysis. Gating on the whole review session (not just `'analyzing'`) is a known regression that freezes the eval bar.

### Review pipeline

`src/services/GameReviewService.ts` analyzes a game ply-by-ply. Per position it resolves an eval in priority order: **(1)** MongoDB position cache → **(2)** Syzygy tablebase (≤7 pieces) → **(3)** Stockfish WASM at the requested depth. Newly computed evals are pushed back to the cache (stored White-relative; flip if mover is black). Cross-ply reuse: eval *after* move N == eval *before* move N+1, so each position is searched once (`searchAtPly[]` cache, ~2× speedup).

`src/utils/reviewUtils.ts` holds the scoring math — keep ported constants exact:
- **Win%**: `0.5 + 0.5*(2/(1+e^(-0.00368208*cp)) - 1)`; forced mate bypasses to 1.0/0.0.
- **Move accuracy**: `103.1668*exp(-0.04354*ΔWin%) - 3.1669 + 1`, clamped [0,100] (Lichess `AccuracyPercent.scala`).
- **Game accuracy**: blend of weighted mean (weight = clamped stdev of Win% over a sliding window) and harmonic mean.
- **Classification ladder** (`classifyMove`, ΔWin in 0..1): Best ≤0.005 · Excellent ≤0.02 · Good ≤0.05 · Inaccuracy ≤0.10 · Mistake ≤0.20 · Blunder >0.20, with Brilliant/Great/Miss overrides. Comments document the spec — keep them in sync with the constants.
- **Brilliant / Great calibration**: `classifyMove` accepts optional player Elo metadata and uses deterministic rating bands to make special classifications slightly more forgiving below master strength while preserving the normal Expected Points ladder. Unknown Elo defaults to 1500.
- **Performance rating** (`accuracyToGameRating`): CAPS-style cubic on accuracy minus per-30-move incident penalties, plus a complexity bonus. Returns `null` below 3 non-book rated moves; 3-4 moves are shown as `provisional`, 5-9 as `low`, 10-24 as `medium`, and 25+ as `high` confidence via `gameRatingConfidence`. The complexity bonus is built so `avgComplexity = 0` ⇒ bonus = 0 (byte-identical to the pre-complexity behavior); complexity = per-ply top-2 MultiPV Win% spread, averaged over rated moves.
- **Phase summaries** (`phaseSummary`): Opening / Middlegame / Endgame rows carry per-side accuracy, rated move count, average CPL, and a representative icon. Book and unscored moves are excluded from phase scoring.
- **Phase boundaries** (`computePhaseBoundaries`): Lichess `Divider.scala` port (majors/minors, backrank sparseness, mixedness).

### API (`api/`)

Route modules live under `api/_lib/routes/**`, each exporting a default Express app built by `createApp()` (CORS + 5 MB JSON + rate limit 150/15min). They are **all mounted behind one regex dispatch table in `api/_lib/router.ts`**, which is re-exported as the *single* Vercel Serverless Function `api/[...path].ts`. This is deliberate: Vercel Hobby allows at most **12 functions per deployment** and there are ~25 routes, so one-file-per-function would fail to deploy. `api/_lib/**` is underscore-prefixed, so Vercel never turns those modules (routes, models, helpers) into their own functions — only `api/[...path].ts` is a function. `scripts/apiDev.ts` imports the **same** `router.ts` and only adds `.listen()`, so dev and prod run one identical routing table — **to add a route, drop it under `api/_lib/routes/**` and register one line in `api/_lib/router.ts`** (the route URLs are unchanged; each inner app still registers its full `/api/...` path).

- DB connection: `api/_lib/db.ts` — `connectDB()` caches the mongoose connection and shares one in-flight connect promise (concurrent handlers at game load would otherwise race a half-open socket since `bufferCommands: false`). It loads `.env` manually (`loadLocalEnv`); `dbName` is always `chess-analyzer`.
- Auth: `api/_lib/auth.ts` — JWT bearer tokens, 7-day expiry. `requireAuth` (401 if absent) vs `optionalAuth` (attaches user if present, never blocks). Most analysis/import endpoints are intentionally public.
- Models in `api/_lib/models/`, Zod request schemas in `api/_lib/zodSchemas.ts`. Cached evals are stored **White-relative** (Position model convention) — the review service flips to/from mover-relative at the boundary.

### Frontend

Single-page app (`src/App.tsx`): two routes (`/` and `/game/:id`) both render `AnalyzerPage`; everything else is `NotFoundPage`. The board is `react-chessboard`, move legality/SAN/FEN via `chess.js`. `useAutoAnalysis` debounces (150 ms) live analysis on every FEN change and stops on terminal positions. Components are grouped by domain under `src/components/` (board, engine, evaluation, review, import, navigation, layout, ui). Path alias `@/*` → `src/*`.

## Testing

Vitest runs in the **node** environment (`vite.config.ts` test config) — only pure-logic units (`src/**/*.{test,spec}.ts`). WASM/worker glue and browser-dependent code are excluded (`*.browser.test.ts`) and are not covered by `npm test`. When adding logic to `reviewUtils.ts` / `EngineManager.ts` pure functions, add or update adjacent `*.test.ts` files such as `src/utils/reviewUtils.test.ts`. Do not put new tests under `src/**/__tests__/`; that path is ignored by git in this repo.

**Playwright E2E** (`tests/e2e/`, config `playwright.config.ts`, run `npm run test:e2e`) covers what unit tests can't: the real Stockfish WASM engine and the review pipeline in a Chromium browser. The config's `webServer` boots the Vite **dev** server itself (no API/MongoDB needed — the engine and review run in-browser; the review's `/api` cache fetch fails over to WASM). Specs: `smoke` (load + `crossOriginIsolated` + board), `analysis` (move → eval → depth → MultiPV line count → fixed-depth terminates), `infinite` (depth blows past the fixed cap and keeps running, then Stop/Resume), `review` (short game → per-player accuracy). Tests drive deterministic moves via zustand stores exposed on `window` by `src/devHooks.ts`, which `main.tsx` imports **only** under `import.meta.env.MODE === 'development'` (see the `NODE_ENV` note in Environment notes for why not `DEV`). `tests/**` is outside the `tsc` include, so Playwright type-checks its own specs.
