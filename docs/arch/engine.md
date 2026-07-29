# Engine layer

_GrandForge reference. Load this file only when working in this area; see [CLAUDE.md](../../CLAUDE.md) for the routing table._

`frontend/src/services/EngineManager.ts` is a **serialized UCI wrapper** around one Stockfish Web Worker. The central invariant: only one `go` is ever in flight. Understand these three entry points before touching it:

- `analyze(req)` — fire-and-forget live analysis. A new request mid-search marks the current one `aborted`, sends `stop`, and queues the new one; the queue holds at most the *latest* request (live analyses supersede each other).
- `evaluate(req)` — one-shot, returns `Promise<SearchResult>`. Used by the review pipeline.
- `beginSession()` — sends one `ucinewgame` so the transposition hash survives across a batch of `evaluate({ skipNewGame: true })` calls (review reuses hash across plies).

The UCI sequence per search (startSearch): `ucinewgame?` → `setoption MultiPV` (before position so the count applies) → `position` → `isready` (barrier) → the `go` command. Search-mode precedence in `startSearch`: `moveTimeMs>0` → `go movetime N`; else `req.infinite` → `go infinite`; else `go depth N`. `bestmove` is the search terminator — only then does a queued request start.

**Infinite (continuous) analysis** is the lichess/chess.com-style "deepen until I stop" mode. `AnalyzeRequest.infinite` (live `analyze()` only — `evaluate()`/review never set it, they need a `bestmove` to resolve) makes `startSearch` emit `go infinite`; the search runs until `stop()` (position change supersede, engine off, or the Stop button). engineStore owns `infiniteMode` (persisted) + `setInfiniteMode`; `startAnalysis`/`startIndexedAnalysis` thread it through and null out `moveTimeMs` so infinite wins. UI: the "Infinite analysis" toggle + Stop/Resume in `EngineControls`.

**Two timers guard against hangs**, both keyed off `currentGraceMs` which is set per-search in `startSearch` via `infoGapGraceMs(req)`:
- Movetime searches → 15 s grace (they finish on their own clock).
- Fixed-depth searches → 90 s grace (depth-24+ can legitimately go 30–60 s between depth transitions; a tight gap would reap a healthy deep think). **Do not shrink `DEPTH_GRACE_MS`** — that was the bug behind "depth freezes at 20–26."
- Infinite searches → 300 s grace (`INFINITE_GRACE_MS`). `go infinite` only ends on our `stop`, so the info-gap watchdog is its *only* hang backstop; the grace must be long enough never to reap a search that has plateaued at high depth (info still flows while deepening, so a true wedge is still caught).

`ENGINE_CONFIGS` maps the four engine ids (`sf18-lite`, `sf18-lite-mt`, `sf17-lite`, `sf16-lite`) to their `frontend/public/stockfish/*.js` worker file. (The 113 MB `sf18-full` build was dropped for the public Vercel deploy — too heavy for worldwide users to download and it blew past Hobby bandwidth/size limits. To restore it, re-add an `ENGINE_CONFIGS` entry, the `EngineVersion` union member, and a `copyStockfish.mjs` target.) The `label`/`file` must match a real on-disk binary — there is no aliasing fallback. `sf18-lite-mt` carries `multiThreaded: true` (worker `stockfish-18-lite.js`, copied by `copyStockfish.mjs`); it spawns multiple WASM threads and so needs cross-origin isolation (COOP/COEP, already set) — the single-threaded `*-single.js` builds do not.

Two strength/telemetry options ride on `EngineOptions`, both off by default (default behavior byte-identical to before): `limitStrength`+`uciElo` emit `UCI_LimitStrength`/`UCI_Elo` (Elo clamped ~1320..3190) to cap engine strength; `UCI_ShowWDL` adds a per-mille `wdl W D L` triple (mover-relative) to score-bearing info lines → `EngineLine.wdl` → eval-bar display. Each build declares a `supportedOptions` set — never `setoption` something the build doesn't advertise, and never mid-search (post it before `position`).

**Engine failure is surfaced, never swallowed.** A load or search failure publishes a retryable `engineError` on the store instead of leaving a dead manager behind, `terminate()` rejects in-flight `evaluate()` promises (an engine switch mid-review used to deadlock live analysis permanently), and the info-gap watchdog escalates `stop` → terminate-and-recover after 5 s so a wedged worker can't hang the session. `sf18-lite-mt` is preflighted against `crossOriginIsolated`: without isolation the option is disabled with a tooltip and selection degrades to `sf18-lite` rather than spawning a build that can't get `SharedArrayBuffer`.

The `EngineVersion` union appears in two places — `EngineManager.ts` (canonical, exported) and `frontend/src/types/engine.ts` — plus `ENGINE_VERSION_VALUES` server-side. All three list the same four builds; keep them together.
