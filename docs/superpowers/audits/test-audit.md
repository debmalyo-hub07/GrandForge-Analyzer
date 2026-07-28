All reads done. Here is the report.

---

# Test-coverage audit — GrandForge

## 1. `npm test` — real output

```
 ✓ ../backend/corsOrigins.test.ts               (5 tests)  24ms
 ✓ src/services/apiBase.test.ts                 (8 tests)  23ms
 ✓ src/utils/reviewUtils.test.ts               (10 tests)  25ms
 ✓ src/components/review/ReviewMoveGlyph.test.ts (2 tests)  9ms
 ✓ src/utils/blunderPuzzles.test.ts             (2 tests)  14ms
 ✓ src/store/gameStore.test.ts                  (3 tests)  56ms

 Test Files  6 passed (6)
      Tests  30 passed (30)
   Duration  15.11s
```

**Zero failures.** The only stderr noise is benign: `[zustand persist middleware] Unable to update item 'grandforge-engine', the given storage is currently unavailable.` — no `localStorage` in the node env; it does not affect assertions.

Note: `npx tsc --noEmit` fails with exactly the 5 expected `TS2741` errors, and **one of them is inside a test file** — `frontend/src/components/review/ReviewMoveGlyph.test.ts:28` (the `counts` literal is missing `forced`). Vitest does not typecheck, so it still passes. The other four are `ReviewMoveGlyph.tsx:30`, `boardUtils.ts:5`, `boardUtils.ts:18`, `pgnUtils.ts:9`.

**Playwright files: both present on disk.** `playwright.config.ts` exists, and `tests/e2e/` contains `helpers.ts`, `smoke.spec.ts`, `analysis.spec.ts`, `infinite.spec.ts`, `review.spec.ts`, `import.spec.ts`, `legal-mate.spec.ts`. No restore needed. (They are git-ignored, so they are local-only and won't survive a clean clone.)

## 2. Inventory of existing tests

| File | Tests | What it actually covers |
|---|---|---|
| `backend/corsOrigins.test.ts` | 5 | `buildAllowedOrigins` only. Exact array equality on: empty env → localhost 5173/4173; `FRONTEND_URL` first; `CORS_EXTRA_ORIGINS` CSV trim + empty-drop; trailing-slash strip; dedupe across sources. Genuinely thorough for a 29-line module. |
| `frontend/src/services/apiBase.test.ts` | 8 | `resolveApiBases` (undefined/empty/whitespace → `/api`+null; explicit `/api`; remote base; bare origin gets `/api`; trailing-slash strip) and `isFailoverEligible` (no-response → true; 502/503/504 → true; 400/401/403/404/429/**500** → false). **Covers neither** `markPrimaryFailed`, `scheduleReprobe`, `probe`, `initApiBaseProbe`, nor `getActiveApiBase` — i.e. the entire sticky-failover state machine the module is named for. |
| `frontend/src/utils/reviewUtils.test.ts` | 10 | `classifyMove`: 3 `forced` cases (forced wins over ladder; book beats forced; absent `isForced` → best) + 3 rating-band cases (sac brilliant at 1200, same sac excellent at 2400, singular swing great at 1800). `gameRatingConfidence`: 5 exact boundary values. `accuracyToGameRating`: null at 2 moves, non-null at 3. `phaseSummary`: one case (moveCount 2, avgCpl 35, accuracy >80, icon `excellent`). |
| `frontend/src/store/gameStore.test.ts` | 3 | Review line identity only. `buildIndexedGameFromTree` on an active variation (uci list, `reviewedNodeIds` length 4, last id, mainline id absent); `getNodeIdAtPly` with vs. without `reviewedNodeIds`; `pathKey` on two literal arrays. |
| `frontend/src/utils/blunderPuzzles.test.ts` | 2 | `buildBlunderPuzzles`: filters to mistake/blunder/miss, sorts worst-first by CPL, resolves `fenBefore` at `plyIndex`; skips empty `bestMoveUci` and out-of-range plies. Uses synthetic FEN strings (`'fen1'`, `'fen2'`), never a real position. |
| `frontend/src/components/review/ReviewMoveGlyph.test.ts` | 2 | `getReviewForNode`: scoped to the reviewed path (mainline node returns null, variation node returns the review); legacy result with no `reviewedNodeIds` decorates mainline only. |

**E2E (`tests/e2e/`, 6 specs, not run by `npm test`)** — `smoke` (board 64 squares, `crossOriginIsolated`, tabs, eval label, zero pageerrors); `analysis` (MultiPV line count, arrow palette `#2fc85a`/`#1f9d4d`, terminal-PGN arrow clearing, MultiPV 5↔1); `infinite` (infinite is the default, depth exceeds the old cap, Stop/Resume); `review` (short game → phase=complete → per-player accuracy numeric in [0,100]); `import` (PGN + FEN import paths); `legal-mate` (arrows clear on checkmate).

## 3. Highest-risk untested pure logic, ranked

1. **`playerAccuracy` (`reviewUtils.ts:119-202`) — zero tests.** The single most intricate function in the repo: per-color Win% series construction, mover-relative→White-relative flipping, `INITIAL_CP` prepend, trailing-window `stdev` weighting, weighted+harmonic blend. Every displayed accuracy number flows through it. The uncommitted work added a `classification === 'forced'` skip at line 164 with no test.
2. **`computePhaseBoundaries` + `mixedness` (`reviewUtils.ts:570-644`) — zero tests.** The `Divider.scala` port with a 15-case score table and a `y = 7 - yTop` index mapping that the comment says was *previously mis-transcribed* (`6 - yTop`), silently collapsing the opening phase to empty. A regression here is invisible — no crash, just wrong phase rows.
3. **`accuracyToGameRating` numerics (`reviewUtils.ts:400-468`).** Only null/non-null is asserted. The cubic, the 2700 cap, the 800 floor at <56%, all four incident-rate penalties, `lengthConfidence` blending toward 1200, and the complexity bonus are entirely unpinned — including the documented invariant that `avgComplexity = 0` ⇒ bonus = 0.
4. **`classifyMove` standard ladder + the two `miss` paths (`reviewUtils.ts:302-392`).** Tests cover only `forced` and the rating-band overrides. Untested: all six ΔWin rungs; the `winBefore > 0.85 && winAfter < 0.60` split where `winAfter < 0.35` promotes to blunder (the comment explicitly records that a prior ΔWin-gated version made `miss` *unreachable*); the forced-mate-missed branch at 342-354.
5. **`netMaterialSacrifice` / `isTruePieceSacrifice` (`reviewUtils.ts:680-704`) — zero tests.** Sole gate for Brilliant. The promotion case (pawn→queen makes `moverLoss` negative) is called out in a comment and unverified.
6. **`cpAndMateToWin`, `accuracyFromWin`, `moveAccuracy`, `engineScoreToCentipawns` — zero tests.** The Lichess constants every other number depends on. `mate === 0` → 0.0 and the `MATE_FLOOR_CP` clamp are both untested.
7. **`GameReviewService.ts:521` counts builder omits `'forced'`.** `Object.fromEntries([...10 strings]) as Record<MoveClassification, number>` — the `as` cast hides it from tsc, so `PlayerReview.counts.forced` is `undefined` at runtime while the type promises a number. `ALL_CLASSIFICATIONS` was added to `types/review.ts:24` with a compile-time exhaustiveness assert but **is never imported anywhere** — the guard exists and is not wired to the thing it was meant to guard.
8. **`backend/zodSchemas.ts:105` `moveClassificationSchema` lacks `'forced'`.** `POST /api/review/save` will 400 on any review containing a forced move. Also `playerReviewSchema.counts` is `z.record(moveClassificationSchema, ...)`. No test asserts frontend↔schema classification parity.
9. **`parseInfoLine` (`EngineManager.ts:691-735`) — zero tests, and not exported.** Hand-rolled UCI tokenizer: `score cp/mate` with `lowerbound`/`upperbound` skipping, `wdl` triple, `pv` consuming the tail. Every eval in the app originates here.
10. **`GameReviewService` helpers are all module-private and therefore untestable**: `tbMoveScore` (611), `cachedLineToMoverWin` (620) — the White↔mover flip at the cache boundary, exactly the "position-cache shape corruption" class of bug — `buildClassificationReason` (674), `terminalCheck`/`isCheckmateFen`/`startingColorFromFen`, and `ratingFromMetadata`. None are exported.
11. **`buildIndexedGameFromTree` edge cases (`gameStore.ts:525`).** Untested: root-only tree → `null`; explicit `leafNodeId` argument (only the store-fallback path is exercised); a black-to-move start FEN; the mid-loop `if (!node) break` truncation.
12. **`apiBase` sticky failover.** `markPrimaryFailed` → `activeBase` switch → 5-min reprobe → switch-back. Untestable as written: `BASES` is a module-level const captured from `import.meta.env` at import time, so there's no seam to inject a config.
13. **`backend/router.ts:72-97` route-table ordering.** A pure array of regexes where "order matters" is load-bearing (`/games/upload` before `/games/[^/]+`, `/review/save` and `/review/job` before `/review/[^/]+`, `/sessions/create` before `/sessions/[^/]+`). Trivially testable, currently not.
14. **`recommendedEngineFirstMoves` (`useArrowLayers.ts:111`) — zero unit tests.** Note the maintenance hazard: `tests/e2e/analysis.spec.ts:8-42` *reimplements* the same selection algorithm (`expectedLiveArrowCount`) rather than importing it. The copy is independent enough to catch drift, but it duplicates the `0.05` threshold and the mate-within-2 rule in two places.
15. **`positionCache.normalizeFenForCache`, `tablebase.pieceCount` / `tablebaseToScore`, `backend/indexGame`, `pgnUtils.*`, `boardUtils.readableTextColor`** — all zero tests. `readableTextColor` carries an explicit WCAG-AA claim ("all 10 reach ≥ AA") that nothing verifies, and its `REVIEW_COLORS`/`REVIEW_GLYPHS` tables are 2 of the 5 current TS errors.

## 4. The ~15 test cases that should exist (one-line assertions)

1. `playerAccuracy` on a fixed 6-ply review with `startingColor='w'` returns a specific pinned number (e.g. `92.4`), locking the weighted+harmonic blend.
2. `playerAccuracy` with `startingColor='b'` attributes even plies to Black, not White.
3. `playerAccuracy` excludes plies listed in `excludePlyIndices` from both the accuracy terms and the Win% volatility series.
4. `playerAccuracy` skips a `classification: 'forced'` move from the accuracy series while still pushing its Win% into the volatility window (the new uncommitted branch).
5. `computePhaseBoundaries([startpos])` returns `openingEndsAtPly` > 0 — i.e. `mixedness(startpos) <= 150`, the exact regression the `7 - yTop` fix addressed.
6. `computePhaseBoundaries` on a K+R vs K FEN sets `middlegameEndsAtPly` at the ply where majors+minors first drops to ≤ 6.
7. `accuracyToGameRating(90, 20, 0, 0, 30)` equals a pinned integer, and the same call with `avgComplexity = 0` equals the 7-argument result exactly (the documented byte-identity invariant).
8. `classifyMove` returns `best/excellent/good/inaccuracy/mistake/blunder` at ΔWin `0.005 / 0.02 / 0.05 / 0.10 / 0.20 / 0.201` with `isBestMove: false` — one table-driven case per rung boundary.
9. `classifyMove` with `winBefore: 0.9, winAfter: 0.5` returns `'miss'`, and with `winAfter: 0.30` returns `'blunder'` — proving `miss` is reachable and the discriminator is the resulting position, not ΔWin.
10. `isTruePieceSacrifice` is `true` for a knight-for-nothing sac, `false` for a single-pawn gambit, and `false` for a pawn promotion to queen.
11. `cpAndMateToWin(0, null) === 0.5`, `cpAndMateToWin(null, 3) === 1.0`, `cpAndMateToWin(null, 0) === 0.0`, and `accuracyFromWin(0.5, 0.6) === 100`.
12. Every member of `ALL_CLASSIFICATIONS` is a key of the `counts` record produced by a review — and mirrored on the backend, every member parses against `zodSchemas.moveClassificationSchema`.
13. `parseInfoLine('info depth 20 seldepth 30 multipv 2 score cp -34 upperbound wdl 120 700 180 nps 1500000 pv e2e4 e7e5')` yields `{multipv: 2, cp: -34, depth: 20, wdl: {win:120,draw:700,loss:180}, pv: ['e2e4','e7e5']}` — the `upperbound` token must not shift the `pv`.
14. `cachedLineToMoverWin` (once exported) negates a White-relative cached score when `mover === 'b'` and leaves it alone for `'w'`.
15. `buildIndexedGameFromTree` returns `null` for a root-only tree, and honours an explicit `leafNodeId` that is neither the current node nor on the mainline.
16. Each of `/api/games/upload`, `/api/review/save`, `/api/review/job`, `/api/sessions/create` dispatches to its own handler and not to the `[^/]+` param route that follows it in `backend/router.ts`.
17. `recommendedEngineFirstMoves` drops a MultiPV-3 line whose mover-relative Win% is more than 0.05 below the best line, and keeps every mate-in-≤(best+2) line when the best line is a forced mate.
18. `normalizeFenForCache` strips only the halfmove/fullmove fields, preserves the en-passant target, and returns a <4-field input trimmed and unchanged.

## 5. Gaps that only Playwright can cover

Unit tests genuinely cannot reach: the Stockfish WASM worker lifecycle (`EngineManager` `startSearch` UCI ordering, `bestmove` as terminator, the abort/queue supersede path, the three info-gap watchdogs), `engineStore`'s `MIN_RENDER_DEPTH = 4` eval-bar stability gate and its hold-previous-values-on-position-change behaviour, the `initEngine` generation-counter race under StrictMode double-mount, `useAutoAnalysis`'s 150 ms debounce and terminal-position stop, `crossOriginIsolated` / COOP+COEP, `SharedArrayBuffer` availability for `sf18-lite-mt`, the real `apiBase` boot probe against a live `/health`, DOM overlays (`BoardArrowOverlay` polygons, `BoardMarkerOverlay`), and drag-and-drop in the blunder trainer.

Minimal e2e spec list for engine + review end to end — the four already-present specs `smoke`, `analysis`, `infinite`, `review` cover the core. The three missing ones I'd add:

- **`engine-switch.spec.ts`** — switch to `sf18-lite-mt` and back to `sf16-lite` via `EngineVersionSelector`; assert a fresh manager loads, a new search reaches depth ≥ 12 on each, and the previous worker's lines don't bleed through (this is the `engineInitGeneration` guard, currently untested anywhere).
- **`review-variation.spec.ts`** — play a mainline, step back, play a variation, run the review, and assert `result.reviewedNodeIds` matches the variation path and that clicking ply N in `ReviewMoveList` navigates to the variation node (the line-identity contract has unit tests for the resolver but nothing exercising the full pipeline through it).
- **`review-artifacts.spec.ts`** — after a completed review, assert the eval-graph has one point per ply and clicking one navigates the board, and that "Fix Your Blunders" produces ≥ 1 puzzle where the correct `bestMoveUci` drop is accepted and a wrong drop snaps back.

## 6. Tests currently asserting the wrong thing

- **`frontend/src/utils/reviewUtils.test.ts:138`** — `expect(accuracyToGameRating(92, 8, 0, 0, 3)).not.toBeNull()`. This is the *only* assertion on the rating value in the repo. Replacing the entire 68-line CAPS cubic, all four penalty terms, the confidence blend, and the complexity bonus with `return 1` keeps the suite green. Strictly speaking it does test the `moves < 3` guard's complement, but the test's `describe` block and the function's real behaviour are unprotected.
- **`frontend/src/store/gameStore.test.ts:48`** — `expect(getNodeIdAtPly(tree, 3)).not.toBe(game?.reviewedNodeIds.at(3))`. A negative assertion: the legacy `children[0]` mainline walk could break and return `null` (or the root id, or any wrong node) and this still passes. It needs a positive counterpart asserting the fallback returns the *mainline* third node specifically.
- **`frontend/src/utils/reviewUtils.test.ts:159`** — `expect(summary.accuracy).toBeGreaterThan(80)`. The sibling assertions on `moveCount`/`avgCpl`/`icon` are exact; this one is a loose bound over the `moveAccuracy` blend and would tolerate a substantial drift in `ACC_A`/`ACC_K`/`ACC_B`.
- **`frontend/src/store/gameStore.test.ts:52-55`** — titled "path keys distinguish same-ply mainline and variation nodes", but it passes two hand-written string arrays to `pathKey` and never compares them, never touches a tree, and never exercises a same-ply mainline/variation pair. It is a test of `Array.prototype.join`.
- **`frontend/src/utils/blunderPuzzles.test.ts:50`** — `expect(puzzles[0].fenBefore).toBe('fen2')`. The load-bearing off-by-one (a node's FEN is the position *after* its move, so `node[plyIndex]` is the position move `plyIndex` was played *from*) is asserted against placeholder strings the test itself laid out to match that convention. If the convention were inverted in both the code and the fixture, the test agrees. It needs one case built from real FENs. Related: `blunderPuzzles.test.ts:6`'s `START` constant is not a legal FEN (rank 3 is a duplicate piece row) — harmless today because nothing parses it, but it will bite the moment a real-position case is added.

**Files referenced:** `d:\Stockfish 2.0\frontend\src\utils\reviewUtils.ts`, `d:\Stockfish 2.0\frontend\src\utils\reviewUtils.test.ts`, `d:\Stockfish 2.0\frontend\src\services\GameReviewService.ts`, `d:\Stockfish 2.0\frontend\src\services\EngineManager.ts`, `d:\Stockfish 2.0\frontend\src\services\apiBase.ts`, `d:\Stockfish 2.0\frontend\src\services\apiBase.test.ts`, `d:\Stockfish 2.0\frontend\src\services\positionCache.ts`, `d:\Stockfish 2.0\frontend\src\services\tablebase.ts`, `d:\Stockfish 2.0\frontend\src\store\gameStore.ts`, `d:\Stockfish 2.0\frontend\src\store\gameStore.test.ts`, `d:\Stockfish 2.0\frontend\src\types\review.ts`, `d:\Stockfish 2.0\frontend\src\utils\blunderPuzzles.ts`, `d:\Stockfish 2.0\frontend\src\utils\blunderPuzzles.test.ts`, `d:\Stockfish 2.0\frontend\src\utils\pgnUtils.ts`, `d:\Stockfish 2.0\frontend\src\utils\boardUtils.ts`, `d:\Stockfish 2.0\frontend\src\hooks\useArrowLayers.ts`, `d:\Stockfish 2.0\frontend\src\components\review\ReviewMoveGlyph.test.ts`, `d:\Stockfish 2.0\backend\corsOrigins.test.ts`, `d:\Stockfish 2.0\backend\zodSchemas.ts`, `d:\Stockfish 2.0\backend\router.ts`, `d:\Stockfish 2.0\backend\indexGame.ts`, `d:\Stockfish 2.0\tests\e2e\`, `d:\Stockfish 2.0\playwright.config.ts`, `d:\Stockfish 2.0\vite.config.ts`.