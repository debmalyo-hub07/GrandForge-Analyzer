# Execution log — engine cluster (Tasks 4, 10, 11, 12 + Task 5 frontend half + perf #8)

Agent: E1. Plan: `docs/superpowers/plans/2026-07-28-phase0-1-correctness.md`.
Audit refs: engine-audit S1/S3/S4/S5/S5b/S6/S7/S8/S9/S11/S17/Q1, state-audit S1/S2/S3/S4/S5/S7.

---

## Task 10 — Engine UCI hygiene (`frontend/src/services/EngineManager.ts`)

Test-first: `frontend/src/services/EngineManager.parse.test.ts` (new, 11 cases) written and
confirmed RED (`parseInfoLine`/`engineSupportsOption` not exported), then GREEN.

- `EngineConfigEntry.supportedOptions: readonly string[]` (required field) + `COMMON_OPTIONS`
  const; all four `ENGINE_CONFIGS` entries carry it. sf16 alone adds `Use NNUE` +
  `UCI_AnalyseMode` (audit S6 wasm-verified table). **S6**
- `engineSupportsOption(version, option)` exported; permissive for `null`/unknown id so a
  future engine can't silently lose every option. **S6**
- `isMultiThreadingAvailable()` exported — `SharedArrayBuffer` + `crossOriginIsolated`
  preflight for the MT build (Task 5 frontend half consumes it).
- `buildOptionCommands()` now gates every emit on `supportsOption(...)`; `UCI_Elo` additionally
  gated. uciok block gates `UCI_AnalyseMode` / `UCI_ShowWDL` the same way. **S6**
- `setOptions()` no longer posts mid-search: sets `pendingOptions` when `isSearching`, and the
  `bestmove` handler calls the new `flushOptions()` **before** starting the queued request —
  the only idle moment. `Hash` reallocates the TT and `Threads` respawns the pool, so this was
  the UCI-illegal case. **S7 / state-audit S8**
- Watchdog escalation: `wedgeStopAt` + `WEDGE_ESCALATION_MS = 5000`. First trip sends `stop`
  (unchanged); if neither info nor bestmove arrives 5 s later, `failEngine()` rejects every
  outstanding promise, tears the worker down, publishes `{type:'error'}` and `recover()`s. No
  more infinite `stop` loop / permanently parked `await evaluate()`. `DEPTH_GRACE_MS`,
  `INFINITE_GRACE_MS`, `MOVETIME_GRACE_MS` untouched. **S5**
- `handlePostLoadError` refactored to delegate to the new `failEngine(message)` (same body) so
  the crash path and the wedge path share one teardown. `wedgeStopAt` reset on every info line,
  on `bestmove`, in `startSearch`, in `terminate`, and in `loadEngine`'s re-entry block.
- `parseInfoLine` exported. Returns `null` for `info string …` and for any info line carrying
  neither a score nor a pv (periodic `nodes/nps/time` and `currmove` lines) — these previously
  overwrote the real multipv-1 entry with a `{cp:null,mate:null,depth:0,pv:[]}` stub, which fed
  a bogus `SearchResult` to review and flashed "depth 0". **S8**
- `SearchInfoLine.bound?: 'lower' | 'upper'`; parser records the bound marker instead of only
  stepping over it, and `handleMessage` drops bound lines from `latestLines` (last EXACT score
  stands). Prevents a fail-high/fail-low score becoming the review eval and being pushed to the
  shared Mongo position cache. **S9**
- `error`-line branch no longer sets `isSearching = false` / clears `current` while a search may
  still be live (Stockfish ignores `position`/`go` mid-search, so the next analyze() would have
  attributed the OLD position's stream to the new request). Now: publish, reject the in-flight
  promise with the error, mark aborted, send a real `stop`, and let `bestmove` stay the single
  terminator. Non-searching case still drains the queue inline. **S11**
- `terminate()` rejects `current`/`queued` with `Error('Engine terminated')` before nulling
  (mirrors `handlePostLoadError`), and drains + clears `readyokQueue`. This is the fix for the
  mid-review engine switch that permanently froze live analysis. **S5b / S17 / state-audit S1**
- Extra (not in the plan, same function): `failEngine`'s `recover()` is now `void …catch()`.
  It re-throws internally, so the un-awaited call was an unhandled rejection whenever recovery
  failed — pre-existing, but the new watchdog path made it reachable without a worker crash.

Verified: `npx vitest run frontend/src/services/EngineManager.parse.test.ts` → 11/11 green.
`DEPTH_GRACE_MS` / `INFINITE_GRACE_MS` / `MOVETIME_GRACE_MS` unchanged; `bestmove` is still the
only search terminator; the abort/queue discipline and the readyok FIFO are untouched.

---

## Task 4 — Engine load failure must not brick the UI

Manager half is above (`terminate()` rejection). Store + UI half:

- `frontend/src/store/engineStore.ts`: `engineError: string | null` (initial `null`) and
  `retryEngineInit(): Promise<void>`. Excluded from `partialize` (it is an allow-list, and the
  new test asserts the exact key set) — a persisted banner would resurrect on every load.
- `initEngine` now wraps `loadEngine` in try/catch: on failure it terminates the half-built
  manager and, **only if it is still the newest generation**, writes
  `{isLoading:false, manager:null, adapter:null, isRunning:false, engineError}`. Previously
  `isLoading` was cleared on the success path only, so one failed load left the engine dropdown
  disabled forever with no error anywhere. The `engineInitGeneration` guard is intact — a
  superseded call stays silent. **S1**
- The manager subscription handles two more event types: `error` → publish `engineError`
  (+ `isRunning:false`), `ready` → clear it *only* when the error came from this manager's own
  event stream (closure-local `selfHealing` flag), so `recover()` succeeding drops the banner
  while a load failure / MT notice survives until the user acts.
- `switchEngine` catches: `EngineVersionSelector.handleSelect` awaits it without a catch, so a
  failed switch used to be an unhandled rejection. It now returns quietly with the banner set
  and the previous `engineVersion` intact so Retry targets something real.
- `retryEngineInit` clears the error, re-runs `initEngine(get().engineVersion)`, and resumes
  live analysis on success. Never throws.
- `frontend/src/components/engine/EngineControls.tsx`: inline `role="alert"` banner
  (`data-testid="engine-error"`, `--miss` token) with the message and a Retry button, disabled
  while `isLoading`. No modal.
- `frontend/src/hooks/useStockfish.ts` cleanup now tears down the instance **it** created and
  nulls `{manager, adapter, isRunning}` in the store when that is the published one. A
  terminated manager left in the store passes every `if (!manager)` guard, so `startAnalysis`
  set `isRunning:true` and then silently no-op'd inside `send()` — "Searching – depth N"
  forever. **engine-audit S4 / state-audit S6**

Test: `frontend/src/store/engineStore.test.ts` (new, 7 cases). vitest's node env has no
`localStorage`, and zustand's persist middleware skips installing its api entirely in that
case, so the file installs an in-memory `localStorage` shim before a dynamic
`import('./engineStore')` — that makes `partialize` / `migrate` / `version` reachable and
assertable, rather than falling back to the plan's default-state-only option.

---

## Task 11 — Persisted engine choice honored + safe migration

- `frontend/src/pages/AnalyzerPage.tsx`: `useStockfish()` with no `defaultEngine`.
- `frontend/src/hooks/useStockfish.ts`: `defaultEngine` no longer defaults to `'sf18-lite'`; it
  is forwarded as `undefined` so `initEngine`'s `version ?? get().engineVersion` finally
  reaches the hydrated value. Before this, the literal was also written back via
  `set({engineVersion: target})`, so choosing SF16/SF17/MT was *erased* from localStorage on
  the next boot. **S3 / state-audit S2**
- `engineStore` persist `version: 3 → 4` with `migrate` normalizing `engineVersion`: any
  non-string or id absent from `ENGINE_CONFIGS` becomes `'sf18-lite'`. The bump is load-bearing
  — zustand skips `migrate` for a blob already at the current version, so leaving it at 3 would
  never reach the affected users. **state-audit S3**
- `frontend/src/components/engine/EngineVersionSelector.tsx:22`:
  `ENGINE_CONFIGS[engineVersion] ?? ENGINE_CONFIGS['sf18-lite']`. The dereference happens during
  render, before any effect, so a stale `sf18-full` threw into the ErrorBoundary and the page
  could never self-heal (the effects that would have normalized the value never ran).
- Note for the commit body (perf-audit #9): a user whose persisted choice is `sf16-lite` now
  really gets SF16 on load, which re-downloads the 40 MB `nn-5af11540bbfe.nnue`. That is their
  explicit stored choice and was the intent of persisting it.

---

## Task 12 — State hygiene

- **isEnabled hydration (state-audit S4).** `uiStore.computerAnalysis` is persisted,
  `engineStore.isEnabled` is not, and nothing reconciled them — so "analysis off" + reload gave
  `isEnabled:true` and an invisible `go infinite` pinning a core while every UI affordance read
  "off". `initEngine` now reconciles once (persisted flag wins) before anything can start a
  search. Done there rather than in `onRehydrateStorage` because `uiStore` imports `engineStore`
  at module scope; reading it from a function body that runs at mount time is cycle-safe,
  hydrate-time module-eval is not.
- **Review cancellation authority (state-audit S5).** `frontend/src/store/reviewStore.ts` gains
  `registerCanceller(fn | null)` backed by a module-level slot (kept out of the state object so
  it can't churn subscribers), and `clearReview()` invokes it first. `ReviewTab` registers
  `() => svc.cancel()` right after constructing the service and deregisters in `finally`.
  `clearReview` runs from `gameStore.resetTransientStateForNewGame` on every
  loadPGN/loadFEN/resetBoard, so importing a game mid-review previously left a zombie loop
  crunching the old game — whose next `onProgress` flipped `phase` back to `'analyzing'` and
  re-froze live analysis on the newly loaded game.
- **makeMove annotations (state-audit S7).** `frontend/src/store/gameStore.ts`:
  `clearManualAnnotations()` hoisted above the `existingChildId` branch (after move validation,
  so an illegal move still leaves annotations alone). Previously only the transposition branch
  cleared, so drawing an arrow and playing a *new* move left it on the previous position's
  squares — inconsistent with all five navigators.
- Test: `frontend/src/store/gameStore.test.ts` +3 cases (new-node clears, transposition clears
  and does not grow the tree, illegal move preserves).

---

## Task 5 (frontend half only) — MT preflight

- `isMultiThreadingAvailable()` in `EngineManager.ts`: `SharedArrayBuffer` present **and**
  `crossOriginIsolated` (permissive when the global is undefined, e.g. node).
- `EngineVersionSelector` renders the MT option `disabled`, greyed, with title/description
  "Requires cross-origin isolation — multi-threading unavailable in this context".
- `initEngine` degrades a requested MT build to `sf18-lite` when unavailable and publishes a
  one-line notice through `engineError` instead of letting the worker throw during module init
  (which, pre-Task-4, was a permanent brick). **S2**
- `EngineControls`: Threads slider disabled with an explanatory line on `-single` builds (the
  option exists but there is no thread pool), and the NNUE toggle is hidden unless the loaded
  build implements `Use NNUE` (sf16 only) — it used to restart the search from depth 1 to send
  a command the engine answers with `No such option`. **S6 / Q3**

**Not done here (outside file ownership):** the server-side enum unification
(`backend/zodSchemas.ts` et al.) and `GameReviewService`'s `sf18-lite-mt → sf18-lite` cache-key
normalization (engine-audit S10) remain for Task 5's backend half.

---

## Extra — perf-audit #8

`engineStore.ts`: `convertUciToSan(currentFen, info.pv.slice(0, MAX_SAN_PLIES))` with
`MAX_SAN_PLIES = 8`. `EngineLines` renders `sanMoves.slice(0, 7)` plus a "+N" indicator, so the
visible output is unchanged, but a 40-ply PV no longer replays 40 chess.js moves per info line
per multipv — and the cache key collapses to a stable 8-ply prefix, so a deepening search reuses
`sanCache` entries instead of minting one per depth. `uciMoves` stays full (arrows read `pv[0]`).

---

## Verification

- `npx vitest run frontend/src/services/EngineManager.parse.test.ts frontend/src/store/engineStore.test.ts frontend/src/store/gameStore.test.ts` → **24/24 green**.
- `npx vitest run frontend/src/services/GameReviewService.helpers.test.ts frontend/src/services/apiBase.test.ts` (nearest neighbours) → 27/27 green.
- `npx tsc --noEmit` → **clean** (an earlier run showed 5 errors in
  `frontend/src/components/review/EvalGraph.tsx`, another agent's in-flight Task 8 file; they
  were gone by the final run).
- Not run per instructions: `npm run build`, `npm test` (full), `npm run test:e2e`, any `git`
  command.
