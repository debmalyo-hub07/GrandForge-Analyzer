# Phase 0+1: Forced Classification Landing + Correctness Blitz — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the in-flight `forced` classification (tree is currently red) and fix every Critical/High finding from the 2026-07-28 audits so the platform is correct before new features are built.

**Architecture:** No new subsystems. Surgical fixes across the engine layer (`frontend/src/services/EngineManager.ts`, `frontend/src/store/engineStore.ts`), review math (`frontend/src/utils/reviewUtils.ts`, `frontend/src/services/GameReviewService.ts`), backend routes/models, and build config. Test-first for every pure-math change.

**Tech Stack:** existing — React 18 + Vite 5 + TS, zustand, chess.js, Express + Mongoose, vitest (node env), Playwright (local).

## Global Constraints

- Quality gate for EVERY task: `npm run typecheck` → `npm test` → `npm run build` all green before commit.
- Engine/board/review UI tasks additionally: `npm run test:e2e` (local Playwright).
- Do not modify `.env`. Do not touch `MONGODB_URI`/`JWT_SECRET` values.
- Never gate prod-excluded code on `import.meta.env.DEV` — use `MODE === 'development'` (CLAUDE.md).
- Accuracy math must stay lichess-comparable: do NOT change Win% constants (`0.00368208`), move-accuracy constants, or the ΔWin ladder thresholds. Fixes here are about reachability/wiring, not re-tuning.
- Do not shrink `DEPTH_GRACE_MS` / `INFINITE_GRACE_MS` (CLAUDE.md invariant).
- No new tests under `frontend/src/**/__tests__/` (path is git-ignored). Put tests adjacent: `foo.test.ts` next to `foo.ts`.
- New tests must run in vitest **node** env (no DOM, no worker, no localStorage assumptions).
- Every task's implementer MUST first read the referenced audit section in `docs/superpowers/audits/*.md` — it contains the file:line evidence and failure scenario. The audit is the source of truth for the defect; this plan is the source of truth for scope and interfaces.
- Commit after every task with a conventional-commit message. Working tree starts with 11 modified files (the `forced` WIP) — Task 1 owns committing them; later tasks must not sweep unrelated WIP into their commits.

---

### Task 1: Land `forced` classification (Phase 0 — tree is red)

**Files:**
- Modify: `frontend/src/utils/boardUtils.ts` (two `Record<MoveClassification, string>` tables at lines ~5 and ~18)
- Modify: `frontend/src/utils/pgnUtils.ts:9` (NAG/glyph record)
- Modify: `frontend/src/components/review/ReviewMoveGlyph.tsx:30` (color record)
- Modify: `frontend/src/components/review/ReviewMoveGlyph.test.ts:28` (counts literal)
- Modify: `frontend/src/services/GameReviewService.ts:520` (counts builder)
- Modify: `backend/zodSchemas.ts:105` (`moveClassificationSchema`)
- Test: `frontend/src/utils/reviewUtils.test.ts` (add parity test)

**Audit refs:** review-audit.md F2 (2a/2b/2c), test-audit.md §3 items 7-8.

**Interfaces:**
- Consumes: `ALL_CLASSIFICATIONS` (already exported from `frontend/src/types/review.ts:24`, `readonly MoveClassification[]`, 11 members incl. `'forced'`).
- Produces: `PlayerReview.counts` now always contains a `forced` key; backend accepts `'forced'` in review payloads.

- [ ] **Step 1: Write the failing parity test** in `frontend/src/utils/reviewUtils.test.ts`:

```ts
import { ALL_CLASSIFICATIONS } from '@/types/review';

describe('classification parity', () => {
  it('ALL_CLASSIFICATIONS has 11 members including forced', () => {
    expect(ALL_CLASSIFICATIONS).toHaveLength(11);
    expect(ALL_CLASSIFICATIONS).toContain('forced');
  });
});
```

Also add to `backend/zodSchemas` coverage — create `backend/zodSchemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gameReviewResultSchema } from './zodSchemas';
// moveClassificationSchema may not be exported; test via a minimal review payload
// containing a move with classification 'forced' and assert safeParse succeeds.
```

(Read `backend/zodSchemas.ts` first; if `moveClassificationSchema` is module-private, test through `gameReviewResultSchema.safeParse` with a minimal valid `moveReviews[0].classification = 'forced'` fixture.)

- [ ] **Step 2: Run `npm run typecheck`** — expect the known 5 `TS2741` errors; run `npx vitest run frontend/src/utils/reviewUtils.test.ts backend/zodSchemas.test.ts` — expect the new zod test to FAIL (forced rejected).

- [ ] **Step 3: Fix the five records.** In each `Record<MoveClassification, ...>` add a `forced` entry consistent with the WIP palette (`#a88850`, glyph `→`, label `Forced`). For `pgnUtils.ts` NAG map: `forced: ''` (no NAG — forced moves carry no annotation). For `boardUtils.ts` follow the existing color/glyph table shape.

- [ ] **Step 4: Wire `ALL_CLASSIFICATIONS` into the counts builder.** `GameReviewService.ts:520`:

```ts
import { ALL_CLASSIFICATIONS } from '@/types/review';
// ...
const counts = Object.fromEntries(
  ALL_CLASSIFICATIONS.map((k) => [k, scored.filter((m) => m.classification === k).length]),
) as Record<MoveClassification, number>;
```

- [ ] **Step 5: Add `'forced'` to `backend/zodSchemas.ts:105`** `moveClassificationSchema` enum (keep it ordered like `ALL_CLASSIFICATIONS`).

- [ ] **Step 6: Full gate.** `npm run typecheck && npm test && npm run build` — all green.

- [ ] **Step 7: Commit the entire WIP** (the 11 pre-modified files + these fixes):

```bash
git add -A && git commit -m "feat: forced move classification, wired end to end

Only-legal-move plies are labelled 'forced' and excluded from accuracy,
phase scoring and rating. Counts built from ALL_CLASSIFICATIONS so a
future label can't silently vanish; backend enum accepts it."
```

---

### Task 2: Fix Tailwind content glob (prod CSS ships zero utilities)

**Files:**
- Modify: `tailwind.config.ts:4`

**Audit ref:** perf-audit.md finding #1 (P0 regression from dda9c75).

- [ ] **Step 1: Reproduce.** `npx vite build 2>&1 | grep -i "utility"` — expect the "No utility classes were detected" warning; `grep -c "flex" dist/assets/*.css` → 0 relevant hits.
- [ ] **Step 2: Fix globs** to `./frontend/index.html` and `./frontend/src/**/*.{ts,tsx}` (verify actual current values first; keep any other entries).
- [ ] **Step 3: Rebuild.** Warning gone; built CSS contains `.flex`/`.items-center`; note new CSS size in the commit body.
- [ ] **Step 4: Visual sanity.** `npm run web:dev`, load the app, confirm layout grid/spacing/spinner render.
- [ ] **Step 5: Commit** `fix: tailwind content globs after frontend/ split`.

---

### Task 3: Second PGN upload no longer 500s (sparse unique index)

**Files:**
- Modify: `backend/models/Game.ts:120-123`
- Test: `backend/models/Game.index.test.ts` (new; pure — assert the index definition object, no DB)

**Audit ref:** data-audit.md §0 (Critical).

**Interfaces:** Produces: `GameSchema` index `{ 'metadata.source': 1, 'metadata.sourceGameId': 1, userId: 1 }` with `{ unique: true, partialFilterExpression: { 'metadata.sourceGameId': { $type: 'string' } } }` — no `sparse`.

- [ ] **Step 1: Failing test** — read the schema's declared indexes via `GameSchema.indexes()` and assert the compound index carries `partialFilterExpression` and not `sparse`:

```ts
import { describe, it, expect } from 'vitest';
import Game from './Game';

it('source dedupe index only applies to imported games', () => {
  const idx = (Game.schema as any).indexes()
    .find(([k]: any) => k['metadata.source'] === 1 && k['metadata.sourceGameId'] === 1);
  expect(idx).toBeDefined();
  expect(idx[1].unique).toBe(true);
  expect(idx[1].sparse).toBeUndefined();
  expect(idx[1].partialFilterExpression).toEqual({ 'metadata.sourceGameId': { $type: 'string' } });
});
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Apply the index change** (keep the SEC-1 comment, update it to explain the partial filter). **Step 4: Run — PASS; full gate.**
- [ ] **Step 5: Note in commit body:** existing Atlas index must be dropped manually once (name it: run `db.games.getIndexes()`); mongoose autoIndex will recreate the new one. Add this to `docs/deploy-render.md` operational notes.
- [ ] **Step 6: Commit** `fix: partial unique index so repeat PGN uploads don't E11000`.

---

### Task 4: Engine load failure must not brick the UI + terminate() rejects in-flight

**Files:**
- Modify: `frontend/src/services/EngineManager.ts` (`terminate()` ~:643-651; load-error path)
- Modify: `frontend/src/store/engineStore.ts` (surface `engineError` state + retry action)
- Modify: `frontend/src/components/engine/EngineControls.tsx` (render error banner + Retry button; follow existing component idioms)

**Audit refs:** engine-audit.md S1 (Critical), S4, S5b; state-audit.md S1.

**Interfaces:**
- Produces: `EngineManager.terminate()` rejects `current`/`queued` promises with `new Error('engine terminated')` before nulling them (mirroring the existing `abort()` pattern at its call sites).
- Produces: `engineStore` gains `engineError: string | null` and `retryEngineInit(): Promise<void>` (calls `initEngine` with the current `engineVersion`). Not persisted (exclude from `partialize`).

- [ ] **Step 1: Read** engine-audit.md S1/S5b in full plus `EngineManager.terminate`, `abort`, `handlePostLoadError` — copy the exact rejection idiom `abort()` already uses.
- [ ] **Step 2:** vitest can't run the worker; add a pure test for the store reducer shape instead — `frontend/src/store/engineStore.test.ts` (new): assert `engineError` defaults null and `partialize` output (exported or accessed via the persist options) does not contain `engineError`. If `partialize` isn't reachable without `window`, limit the test to the default-state assertion and note it.
- [ ] **Step 3: Implement** — `terminate()` rejects both promise slots first; `initEngine` catch-path sets `engineError` with the load failure message instead of leaving a dead manager; `retryEngineInit` clears it and re-runs.
- [ ] **Step 4: Banner** in `EngineControls`: when `engineError` non-null render a compact inline alert (existing button styles) with the message + Retry. No modal.
- [ ] **Step 5: e2e check** — run existing `npm run test:e2e` suite (engine specs must still pass; S5b regression is covered indirectly by `review.spec.ts`).
- [ ] **Step 6: Full gate + commit** `fix: engine load failure surfaces retryable error; terminate rejects in-flight`.

---

### Task 5: sf18-lite-mt — isolation preflight, Threads honesty, server enums

**Files:**
- Modify: `frontend/src/services/EngineManager.ts` (`ENGINE_CONFIGS` already has the entry; add preflight helper `isEngineSupported(version): { ok: boolean; reason?: string }`)
- Modify: `frontend/src/components/engine/EngineVersionSelector.tsx` (disable MT option with tooltip when `!crossOriginIsolated`)
- Modify: `backend/zodSchemas.ts:24,184,190`, `backend/routes/positions/cache.ts:23`, `backend/routes/auth/preferences.ts:10`, `backend/models/User.ts:11,37` — replace stale enum `['sf18-lite','sf18-full','sf17-lite','sf16-lite']` with `['sf18-lite','sf18-lite-mt','sf17-lite','sf16-lite']` everywhere (single shared const in `backend/zodSchemas.ts`, exported, imported by the route/model files).
- Test: extend `backend/zodSchemas.test.ts`.

**Audit refs:** engine-audit.md S2 (Critical), S10; data-audit.md §2c.

**Interfaces:** Produces: `export const ENGINE_VERSION_VALUES = ['sf18-lite','sf18-lite-mt','sf17-lite','sf16-lite'] as const;` in `backend/zodSchemas.ts`; all server enums derive from it.

- [ ] **Step 1: Failing test:** `positionCacheSchema`-equivalent route schema accepts `engineVersion: 'sf18-lite-mt'` and rejects `'sf18-full'`. (Route schema is inline in `cache.ts` — export it or test the shared const's usage; simplest: export the shared const and assert route behavior via the zod object if exported, else assert `ENGINE_VERSION_VALUES` contents + grep-level import wiring in test comments.)
- [ ] **Step 2: Implement enum unification.** **Step 3:** preflight: in `EngineVersionSelector`, when `typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated`, render the MT option disabled with title "Requires cross-origin isolation — multi-threading unavailable in this context". In `initEngine`, if MT requested and unsupported, fall back to `sf18-lite` and set a one-line notice via existing store messaging (do not throw).
- [ ] **Step 4: Full gate + e2e + commit** `fix: sf18-lite-mt reachable with isolation preflight; server enums accept it`.

---

### Task 6: reviewedNodeIds survive save/load (zod strip)

**Files:**
- Modify: `backend/zodSchemas.ts:155-164` (`gameReviewResultSchema`)
- Test: extend `backend/zodSchemas.test.ts`

**Audit ref:** data-audit.md §2d (High).

**Interfaces:** Produces: `gameReviewResultSchema` gains explicit optional fields: `reviewedNodeIds: z.array(z.string().max(64)).max(600).optional()`, `reviewedPathKey: z.string().max(40000).optional()`, `reviewedLineUciKey: z.string().max(6000).optional()`. Explicit fields, NOT `.passthrough()` (backend-audit F13 warns against loose shapes). Also add `.max(600)` to `moveReviews` (data §2e).

- [ ] **Step 1: Failing test:** `safeParse` a fixture containing the three fields → today `success` but parsed `data.reviewedNodeIds === undefined`; assert `parsed.data.reviewedNodeIds` deep-equals input.
- [ ] **Step 2: Implement.** **Step 3: PASS + gate.**
- [ ] **Step 4: Commit** `fix: review save round-trips line identity (reviewedNodeIds et al)`.

---

### Task 7: Brilliant reachability + Great real deltaWin (review math, test-first)

**Files:**
- Modify: `frontend/src/utils/reviewUtils.ts` (`classifyMove` region ~:302-392)
- Modify: `frontend/src/services/GameReviewService.ts` (call-site wiring if F5 requires threading a value)
- Test: `frontend/src/utils/reviewUtils.test.ts`

**Audit refs:** review-audit.md **F1 (Critical: Brilliant mathematically unreachable — read the section for the exact contradiction, likely between the sacrifice gate and a preceding early return)** and **F5 (High: `deltaWin` free parameter makes Great's rating calibration dead code)**. Implementer MUST read both sections before coding; the fix direction is specified there with file:line.

- [ ] **Step 1: Write failing tests capturing the audit's failure scenarios:**

```ts
it('true sacrifice near-best from non-won position is brilliant', () => {
  expect(classifyMove({
    isBookMove: false, isBestMove: true, winBefore: 0.55, winAfter: 0.62,
    isSingularChoice: false, isMaterialSacrifice: true, deltaWin: 0,
  })).toBe('brilliant');
});
it('same sacrifice from already-won position is not brilliant', () => {
  expect(classifyMove({
    isBookMove: false, isBestMove: true, winBefore: 0.92, winAfter: 0.95,
    isSingularChoice: false, isMaterialSacrifice: true, deltaWin: 0,
  })).not.toBe('brilliant');
});
```

Adjust parameter values to the audit's documented reachability hole so the first test FAILS on current code (verify it fails for the audited reason, not a typo).

- [ ] **Step 2: Add the six-rung ladder boundary table test** (test-audit §4 item 8) and the miss/blunder discriminator test (item 9) — pin current intended behavior before touching the function:

```ts
it.each([
  [0.005, 'best'], [0.02, 'excellent'], [0.05, 'good'],
  [0.10, 'inaccuracy'], [0.20, 'mistake'], [0.201, 'blunder'],
])('ΔWin %f → %s', (dw, expected) => {
  expect(classifyMove({
    isBookMove: false, isBestMove: false, winBefore: 0.5, winAfter: 0.5 - dw,
    isSingularChoice: false, isMaterialSacrifice: false, deltaWin: dw,
  })).toBe(expected);
});
it('miss vs blunder discriminates on resulting position', () => {
  const base = { isBookMove: false, isBestMove: false, isSingularChoice: false, isMaterialSacrifice: false };
  expect(classifyMove({ ...base, winBefore: 0.9, winAfter: 0.5, deltaWin: 0.4 })).toBe('miss');
  expect(classifyMove({ ...base, winBefore: 0.9, winAfter: 0.3, deltaWin: 0.6 })).toBe('blunder');
});
```

- [ ] **Step 3: Fix F1 per the audit's suggested fix; fix F5** (thread the real ΔWin/wire the calibration input at the `GameReviewService` call site if that's the specified direction). Ladder-boundary tests must stay green — the constants don't move.
- [ ] **Step 4: Full gate + commit** `fix: brilliant reachable; great uses real deltaWin for rating calibration`.

---

### Task 8: Review pipeline — tablebase perspective, mate horizon, book off-by-one, EvalGraph inversion

**Files:**
- Modify: `frontend/src/services/GameReviewService.ts` (tablebase move scoring ~`tbMoveScore`:611; mate normalization; book-ply logic)
- Modify: `frontend/src/components/review/EvalGraph.tsx` + `frontend/src/types/review.ts` (add `startingColor: 'white' | 'black'` to `GameReviewResult`)
- Modify: `frontend/src/components/review/useOpeningBookFens.ts` or the book-check call site (whichever the audit pins for F6)
- Test: `frontend/src/utils/reviewUtils.test.ts` + new `frontend/src/services/GameReviewService.helpers.test.ts` — **export** the private helpers under test (`tbMoveScore`, `cachedLineToMoverWin`) per test-audit §3 item 10.

**Audit refs:** review-audit.md F3, F4, F6, F11 (all High/Medium — read each section; each includes the concrete failure scenario and fix direction). test-audit §4 item 14.

**Interfaces:** Produces: `GameReviewResult.startingColor` (set in `GameReviewService` from the game's first FEN via existing `startingColorFromFen`); `EvalGraph` uses it instead of assuming white-to-move at ply 0. Exports: `tbMoveScore`, `cachedLineToMoverWin` from `GameReviewService.ts`.

- [ ] **Step 1: Failing tests:** `cachedLineToMoverWin` flips a White-relative cached cp for `mover==='b'` and not for `'w'`; `tbMoveScore` perspective case exactly as the F3 scenario describes; book off-by-one: fixture where ply N is the last book position — assert first out-of-book move is classified (not swallowed).
- [ ] **Step 2: Implement all four fixes.** F11: thread `startingColor` through result construction and flip logic in `EvalGraph` (white-relative folding must key on actual mover parity, not `ply % 2`).
- [ ] **Step 3: Full gate + e2e (`review.spec.ts`) + commit** `fix: review tablebase perspective, mate horizon, book ply, black-start eval graph`.

---

### Task 9: playerAccuracy + phase boundaries + rating pins (lock the math)

**Files:**
- Modify: `frontend/src/utils/reviewUtils.ts` (F8 volatility-window deviation, F9 endgame collapse — read audit sections; F8 may be accept-and-document rather than change if fixing breaks comparability, decide per audit recommendation)
- Test: `frontend/src/utils/reviewUtils.test.ts`

**Audit refs:** review-audit.md F7, F8, F9, F10; test-audit §4 items 1-7, 10-11; test-audit §6 (fix the 3 wrong assertions in this file).

- [ ] **Step 1: Pin current-correct behavior with exact-value tests** (compute expected values by executing the current function once and hard-coding the output — legitimate for regression pins; mark each with `// regression pin, derived 2026-07-28`):
  - `playerAccuracy` fixed 6-ply fixture both colors, with `excludePlyIndices`, with a `forced` move.
  - `computePhaseBoundaries([START_FEN])` opening non-empty; K+R endgame boundary; F9 same-ply middlegame/endgame case (this one is a FAILING test first — fix, then pin).
  - `accuracyToGameRating(90,20,0,0,30)` exact int; `avgComplexity=0` byte-identity invariant.
  - `cpAndMateToWin(0,null)===0.5`, `(null,3)===1.0`, `(null,0)===0.0`; `accuracyFromWin(0.5,0.6)===100`.
  - `isTruePieceSacrifice`: knight sac true / pawn gambit false / promotion false (real FENs).
- [ ] **Step 2: Fix F9 (+F7/F10 adjustments per audit) — the pins from Step 1 guard everything else.** Replace the three wrong assertions from test-audit §6 with positive exact ones.
- [ ] **Step 3: Full gate + commit** `test: pin review math; fix phase-boundary endgame collapse + rated-move consistency`.

---

### Task 10: Engine UCI hygiene — conditional options, no setoption mid-search, info parsing

**Files:**
- Modify: `frontend/src/services/EngineManager.ts` (options table per build; `setOptions` gating; `parseInfoLine` ~:691-735)
- Test: `frontend/src/services/EngineManager.parse.test.ts` (new) — export `parseInfoLine`.

**Audit refs:** engine-audit.md S5, S6, S7, S8, S9, S11, S17 (read each). test-audit §4 item 13.

**Interfaces:** Produces: `export function parseInfoLine(line: string): ParsedInfo | null` (same shape it returns today); `ENGINE_CONFIGS` entries gain `supportedOptions?: string[]` (options not listed are never sent).

- [ ] **Step 1: Failing parse tests:**

```ts
it('upperbound token does not shift pv and bound scores are flagged', () => {
  const r = parseInfoLine('info depth 20 seldepth 30 multipv 2 score cp -34 upperbound wdl 120 700 180 nps 1500000 pv e2e4 e7e5');
  expect(r).toMatchObject({ multipv: 2, cp: -34, depth: 20, pv: ['e2e4', 'e7e5'] });
  expect(r!.wdl).toEqual({ win: 120, draw: 700, loss: 180 });
  expect(r!.bound).toBe('upper'); // new field per S9 — bound lines must not overwrite exact scores
});
it('info string lines are ignored, not parsed as PV-1', () => {
  expect(parseInfoLine('info string NNUE evaluation using nn-9067e33176e8.nnue')).toBeNull();
});
```

- [ ] **Step 2: Implement:** S5 (watchdog escalation: when the info-gap grace expires and `stop` produces no `bestmove` within a further 5 s, terminate the worker and surface `engineError` via the Task 4 path — never hang forever), S8 (skip `info string`), S9 (parse `bound`, consumer keeps last exact score), S6 (per-build `supportedOptions`; send `Use NNUE`/`UCI_ShowWDL`/`UCI_LimitStrength` only where supported — audit Q1 lists which builds have what), S7 (queue option pushes until idle — engineStore already stops first; enforce in the manager as a guard), S11 (error line doesn't mark idle while searching — per audit direction), S17 (clear `readyokQueue` in terminate).
- [ ] **Step 3: Full gate + e2e (analysis + infinite specs) + commit** `fix: engine UCI option/info-line hygiene`.

---

### Task 11: Persisted engine choice honored + safe migration

**Files:**
- Modify: `frontend/src/pages/AnalyzerPage.tsx:38`, `frontend/src/hooks/useStockfish.ts:21` (stop forcing `'sf18-lite'`; pass `undefined` so `initEngine` falls back to the hydrated `engineVersion`)
- Modify: `frontend/src/store/engineStore.ts` (persist `migrate`: unknown/removed `engineVersion` → `'sf18-lite'`)
- Modify: `frontend/src/components/engine/EngineVersionSelector.tsx:22,30` (guard `ENGINE_CONFIGS[engineVersion]` with fallback so render never throws on stale id)

**Audit refs:** engine-audit.md S3; state-audit.md S2, S3; perf-audit.md #9 caveat (fetch-size implication: sf16 users now auto-redownload the 40 MB net on load — acceptable because it's their explicit persisted choice; note in commit body).

- [ ] **Step 1:** Read state-audit S2/S3 sections. **Step 2: Implement** all three. **Step 3:** Manual check: set `localStorage['grandforge-engine']` version to `sf17-lite`, reload dev app, engine selector shows 17.1; set to `sf18-full`, reload, no ErrorBoundary, normalized to `sf18-lite`.
- [ ] **Step 4: Full gate + commit** `fix: honor persisted engine choice; migrate removed engine ids`.

---

### Task 12: State hygiene — isEnabled hydration, clearReview cancels, makeMove annotations

**Files:**
- Modify: `frontend/src/store/engineStore.ts` (persist `computerAnalysis`↔`isEnabled` reconciliation on hydrate)
- Modify: `frontend/src/store/reviewStore.ts` + `frontend/src/components/review/ReviewTab.tsx` (move cancellation authority: `clearReview()` aborts the running `GameReviewService` — register the active service/abort fn on the store)
- Modify: `frontend/src/store/gameStore.ts` (`makeMove` new-node branch calls `clearManualAnnotations()` like every other navigator)
- Test: extend `frontend/src/store/gameStore.test.ts` (makeMove clears annotations — pure store test)

**Audit refs:** state-audit.md S4, S5, S7.

- [ ] **Step 1: Failing test** for S7 (set a manual arrow via uiStore, `makeMove`, expect arrows empty — if cross-store in node env is awkward, test the gameStore hook point: spy that `clearManualAnnotations` is invoked). **Step 2: Implement all three.** **Step 3: Full gate + e2e + commit** `fix: store hygiene — analysis toggle hydration, review cancellation, annotation clearing`.

---

### Task 13: Backend boot assert + import hardening + JSON error surface

**Files:**
- Modify: `backend/index.ts` (env assert; `unhandledRejection`/`uncaughtException` handlers; `server.closeIdleConnections()` in drain; request timeout via `server.requestTimeout = 30_000`)
- Modify: `backend/routes/import/chesscom.ts`, `backend/routes/import/lichess.ts` (GET→POST, `AbortController` 8 s per upstream fetch, keep GET returning 405 with pointer)
- Modify: `frontend/src/services/chessApiClient.ts` or the import call sites (switch to POST — grep `import/chesscom` in frontend)
- Modify: `backend/router.ts` (terminal JSON 404 + JSON error handler; 4 security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, minimal CSP for API responses `default-src 'none'`)
- Modify: `backend/routes/review/save.ts` (delete `ipHits` map — redundant with createApp limiter; add `mongoose.isValidObjectId(gameId)` guard)
- Modify: `backend/db.ts:9-27` (`loadLocalEnv` early-return must key on `envLoaded` alone — today an exported `MONGODB_URI` skips `.env` entirely and `JWT_SECRET` et al silently vanish; data-audit §5)
- Test: `backend/router.test.ts` (new) — dispatch-order test per test-audit §4 item 16 (pure: import the table or exercise regexes).

**Audit refs:** backend-audit.md F1, F5, F6, F9, F10, §4 gaps 1-4.

- [ ] **Step 1: Failing router test:** `/api/games/upload`, `/api/review/save`, `/api/review/job`, `/api/sessions/create` each match their own entry before the `[^/]+` param patterns; `/api/nope` matches nothing (will be handled by new JSON 404).
- [ ] **Step 2: Implement backend changes.** Boot assert: `MONGODB_URI` present, `JWT_SECRET` length ≥ 32 — `console.error` + `process.exit(1)`. Guard the assert with `if (process.env.NODE_ENV !== 'test')`.
- [ ] **Step 3: Frontend import call sites → POST.** **Step 4:** Manual smoke: `npm run api:dev`, `curl -X POST localhost:3000/api/import/lichess -H 'content-type: application/json' -d '{"username":"DrNykterstein","count":2}'` succeeds; GET returns 405 JSON; `curl localhost:3000/api/nope` returns JSON 404.
- [ ] **Step 5: Full gate + commit** `fix: backend boot assert, import POST+timeouts, JSON errors, security headers`.

---

### Task 14: Position model + TTLs + dead code sweep

**Files:**
- Modify: `backend/models/Position.ts` (unique index → `{fen: 1, engineVersion: 1}`; add TTL index `computedAt` 60 d; keep `depth` ordinary field)
- Modify: `backend/routes/positions/cache.ts` (upsert guard: `findOne(...).sort({depth: -1})` until index migrated; bound `lines` `.max(5)` and `pv` `.max(64)` items × regex `/^[a-h][1-8][a-h][1-8][qrbn]?$/`; response → `{ ok: true, depth }`)
- Modify: `backend/routes/positions/eval.ts` (`$set: { computedAt: new Date() }` on hit → LRU; add zod query validation)
- Modify: `backend/models/Game.ts` (anonymous-game TTL: partial index `{'metadata.importedAt': 1}` expireAfterSeconds 604800, partialFilterExpression `{ userId: { $exists: false } }`)
- Modify: `backend/models/TablebaseEntry.ts` (TTL 180 d on `fetchedAt`)
- Modify: `backend/routes/sessions/create.ts` (per-user cap 100 → 409 with message)
- Delete: `backend/openingBook.ts`; the 8 dead schemas in `backend/zodSchemas.ts` (F13 list); `node-fetch` from `package.json` dependencies
- Modify: drop the 17 redundant/unused indexes per data-audit §1c (each model file listed there)
- Test: extend `backend/models/Game.index.test.ts` pattern for the new TTL/partial indexes.

**Audit refs:** data-audit.md §1c, §2a, §2b, §2f, §4; backend-audit.md F4, F13, §3 items (1)(4)(6)(13)(14).

- [ ] **Step 1: Failing index tests** (same `schema.indexes()` technique as Task 3). **Step 2: Implement.** **Step 3:** Commit body documents the one-time Atlas manual index drops (list exact index names) — same operational note file as Task 3.
- [ ] **Step 4: Full gate + commit** `fix: position cache integrity, TTL/LRU policy, dead code sweep`.

---

### Task 15: `/game/:id` deep links + games auth alignment

**Files:**
- Modify: `backend/routes/games/[id].ts:18` (`requireAuth` → `optionalAuth`; keep the existing ownership check — anonymous games readable, owned games only by owner)

**Audit ref:** backend-audit.md F3.

- [ ] **Step 1:** Read F3 + the route. **Step 2: Implement.** **Step 3:** Smoke: upload a PGN anonymously via API, GET `/api/games/<id>` without token → 200. **Step 4: Gate + commit** `fix: anonymous game deep links readable (auth-optional read path)`.

---

### Task 16: SEO — per-route canonical/meta; perf quick wins

**Files:**
- Modify: `frontend/src/pages/StaticPage.tsx` (set `<link rel=canonical>`, `meta description`, `og:title/url` per route via a tiny `useEffect` head-manager — no new dependency; document.head mutation, restore on unmount)
- Modify: `frontend/src/store/engineStore.ts` (`convertUciToSan` call site: `info.pv.slice(0, 8)`)
- Modify: `vercel.json` (add `/assets/(.*)` → `Cache-Control: public, max-age=31536000, immutable`)

**Audit refs:** perf-audit.md #7, #8, cheapest-first list items 2-4.

- [ ] **Step 1: Implement all three.** **Step 2:** Verify: dev app, navigate `/privacy`, `document.querySelector('link[rel=canonical]').href` ends with `/privacy`; back to `/`, restored. **Step 3:** `npm run test:e2e` (engine lines still render SAN correctly with 8-ply cap — EngineLines shows 7).
- [ ] **Step 4: Gate + commit** `fix: per-route canonical/meta, PV SAN cap, immutable asset caching`.

---

### Task 17: GPL compliance files + footer pointer

**Files:**
- Modify: `scripts/copyStockfish.mjs` (also copy `node_modules/stockfish/Copying.txt` → `frontend/public/stockfish/Copying.txt`; generate `frontend/public/stockfish/AUTHORS.txt` — copy from npm package if present, else write a pointer file listing upstreams)
- Create: `frontend/public/stockfish/SOURCE.txt` — exact provenance text: sf18 builds = npm stockfish@18.0.7 (github.com/nmrugg/stockfish.js); sf17.1/sf16 = nmrugg/stockfish.js releases 17.1/16 lite builds; net nn-5af11540bbfe.nnue from official-stockfish networks (per license-audit.md completion table)
- Modify: `frontend/src/components/layout/Footer.tsx:9-10` — extend: link text stays "Stockfish 18"; add ` · GPL-3.0 · <a href="/stockfish/Copying.txt">license</a> · <a href="https://github.com/nmrugg/stockfish.js">engine source</a>`
- Modify: `scripts/seedOpenings.ts:5` — verify lichess-org/chess-openings license via its repo (WebFetch README/LICENSE) and correct the comment (audit expects CC0)

**Audit ref:** license-audit.md SF-1..SF-4.

- [ ] **Step 1: Implement; run `node scripts/copyStockfish.mjs`; verify files exist in `frontend/public/stockfish/`.** **Step 2:** These files are gitignored? Check — sf16/17 binaries are committed, so the dir is tracked; commit Copying/AUTHORS/SOURCE too. **Step 3: Gate + commit** `chore: ship Stockfish GPL-3.0 license/authors/source pointers (compliance)`.

---

### Task 18: apiBase failover + remaining wrong-assertion tests

**Files:**
- Modify: `frontend/src/services/apiBase.ts` (500-on-`/health` failover eligibility per backend F14 — smallest change: `isFailoverEligible` also true when `error.config?.url?.endsWith('/health') && status >= 500`; read the module first and follow its existing per-request guard pattern from the phase-1 review catches — per-request `config.baseURL !== fallback`, never global)
- Modify: `frontend/src/store/gameStore.test.ts` (positive mainline fallback assertion; real same-ply mainline/variation pathKey test)
- Modify: `frontend/src/utils/blunderPuzzles.test.ts` (one real-FEN case; fix the illegal START constant)
- Test: extend `frontend/src/services/apiBase.test.ts` for the new eligibility branch.

**Audit refs:** backend-audit.md F14; test-audit.md §6 (remaining items).

- [ ] **Step 1: Failing tests. Step 2: Implement. Step 3: Gate + commit** `fix: failover on broken-deploy health 500s; strengthen weak test assertions`.

---

### Task 19: CLAUDE.md sync + memory

**Files:**
- Modify: `CLAUDE.md` — update: `forced` in the classification ladder; counts from `ALL_CLASSIFICATIONS`; corrected persisted-keys list (perf #9 found `moveTimeMs`/`infiniteMode` NOT in partialize — verify actual and document truth); engine error/retry behavior; import routes now POST; new TTL policies; GPL files; per-route canonical pattern.

- [ ] **Step 1: Re-verify each claim against the now-fixed code (don't copy from this plan blindly).** **Step 2: Commit** `docs: sync CLAUDE.md with phase 0+1 changes`.

---

## Verification (end of phase)

- [ ] `npm run typecheck && npm test && npm run build` green.
- [ ] `npm run test:e2e` full suite green.
- [ ] Manual smoke list: upload 2 PGNs in a row (Task 3); review a short game incl. a forced recapture — summary shows Forced row, accuracy sane; switch engine mid-review — eval bar recovers; kill network — review completes on WASM; `/privacy` canonical correct; footer license links resolve.
- [ ] `git log --oneline` shows ~19 conventional commits; push to main.
