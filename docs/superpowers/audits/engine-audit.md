# Engine-layer audit (client-side Stockfish/UCI)

Scope: `frontend/src/services/EngineManager.ts`, `frontend/src/store/engineStore.ts`,
`frontend/src/hooks/useAutoAnalysis.ts`, `frontend/src/hooks/useStockfish.ts`,
`frontend/src/components/engine/*`, `frontend/public/stockfish/`, `scripts/copyStockfish.mjs`.

Reference bar: lichess / chess.com analysis boards (MultiPV, infinite, depth/movetime/nodes
limits, Threads/Hash, UCI_Elo, WDL, threat mode, net selection).

Method note: engine capability claims below were verified by scanning the **WASM data
section** of each binary for its UCI option-name table (`python` byte scan), not from source
comments. The `setoption name …` strings inside each `*.js` are only a Node readline
tab-completion list and are **not** a validation allowlist — commands pass through
unfiltered — so the wasm table is the authoritative signal.

Findings are ordered most severe first.

---

## S1 — CRITICAL: any engine load failure permanently bricks the analysis UI

`frontend/src/store/engineStore.ts:170-284` (`initEngine`), `:286-298` (`switchEngine`),
`frontend/src/components/engine/EngineVersionSelector.tsx:24-28`, `:34`.

`initEngine` sets `isLoading: true` at `engineStore.ts:182` and clears it **only on the
success path** at `:282`. There is no `try/finally`. Before that, `:173-176` has already
terminated the previous manager and written `manager: null` to the store.

`loadEngine` (`EngineManager.ts:248-341`) can reject four ways: `new Worker()` throws
(`:276`), the 60 s `uciok` timeout (`:280-286`), `worker.onerror` before load settles
(`:318-329`), or `recover()` failing (`:394-398`).

When it rejects:
- `isLoading` stays `true` forever → `EngineVersionSelector.tsx:34` `disabled={isLoading}`
  greys out the engine dropdown permanently.
- The store holds `manager: null`, so there is no engine at all.
- `switchEngine` (`:294`) does not catch, and `handleSelect` (`EngineVersionSelector.tsx:24-28`)
  `await`s without a catch → unhandled promise rejection. No toast, no error state, no log
  visible to the user.
- On the boot path, `useStockfish.ts:30-36` does capture the error into local state, but
  `AnalyzerPage.tsx:38` destructures only `{ isReady }` and throws the `error` away.

Failure scenario: the user selects "Stockfish 18 (Lite, Multi-threaded)" on a page that is
not cross-origin isolated (see S2). The worker throws during module init. The engine
dropdown is now dead, the eval bar is frozen at whatever it last showed, `EngineLines`
shows "Awaiting engine output…" forever, and the only recovery is a full page reload.

Suggested fix: wrap the body of `initEngine` in `try/finally` so `isLoading` is always
cleared; catch in `switchEngine`, keep/restore the previously working `engineVersion`, and
publish a user-visible error (toast + a store `engineError` field); surface
`useStockfish`'s `error` in `AnalyzerPage`.

---

## S2 — CRITICAL: `sf18-lite-mt` is offered with no cross-origin-isolation preflight and no fallback

`frontend/src/components/engine/EngineVersionSelector.tsx:9-14`,
`frontend/src/services/EngineManager.ts:23`, `:30-32`.

The MT build is fully reachable from the UI — it is entry 2 of 4 in `ENGINE_ORDER`, with no
gating.

- `isMultiThreaded()` (`EngineManager.ts:30-32`) is exported and **never called anywhere**.
  Grep over `frontend/src` finds only its own definition and the `multiThreaded` field.
- `crossOriginIsolated` appears **nowhere** in `frontend/src` (only in a comment in
  `vite.config.ts:41`).

`stockfish-18-lite.js` is the only one of the four binaries that references
`SharedArrayBuffer`. It does `new WebAssembly.Memory({ initial: …, maximum: 32768, shared: true })`
and throws `"requested a shared WebAssembly.Memory but the returned buffer is not a
SharedArrayBuffer…"` when the buffer is not shared, and its pthread bootstrap aborts with
`"Current environment does not support SharedArrayBuffer, pthreads are not available!"`.

So when `crossOriginIsolated === false` there is **no fallback and no message** — the worker
throws, `loadEngine` rejects, and S1 turns it into a permanent brick. Headers are set
correctly today (`vite.config.ts`, `vercel.json`), but they are strippable by a corporate
proxy, an extension, or a mis-set header on the Render/Vercel fallback path, and the
single-threaded builds do not need isolation at all — so this is a live risk, not theoretical.

Suggested fix: compute `const mtOk = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated`
once; render the MT option `disabled` with an explanatory title when false; and on any MT
load failure auto-fall-back to `sf18-lite` with a toast.

---

## S3 — HIGH: the persisted engine choice is ignored on every page load and then destroyed

`frontend/src/pages/AnalyzerPage.tsx:38`, `frontend/src/hooks/useStockfish.ts:10`, `:21`,
`frontend/src/store/engineStore.ts:177`, `:282`, `:471-476`.

`engineVersion` **is** persisted (`partialize` at `engineStore.ts:471-476`). But
`AnalyzerPage.tsx:38` calls `useStockfish({ defaultEngine: 'sf18-lite' })`, which passes that
literal into `initEngine(defaultEngine)` at `useStockfish.ts:21`. `initEngine`'s
`const requested = version ?? get().engineVersion` (`:177`) therefore never reaches the
`??` branch — the hydrated preference is unreachable. Worse, `:282` then does
`set({ engineVersion: target })`, overwriting the persisted value with `sf18-lite`.

Failure scenario: user picks "Stockfish 16" for a comparison, reloads the page, and is
silently back on SF18 — and their stored preference has been erased, so it does not come
back on the next reload either.

Suggested fix: call `useStockfish()` with no `defaultEngine` (the `??` fallback then works),
or pass `useEngineStore.getState().engineVersion`.

---

## S4 — HIGH: the store keeps a terminated manager → silent dead engine, UI stuck on "Searching"

`frontend/src/hooks/useStockfish.ts:38-43`, `frontend/src/store/engineStore.ts:318-325`,
`frontend/src/services/EngineManager.ts:580`, `:643-651`.

The unmount cleanup at `useStockfish.ts:38-43` calls
`useEngineStore.getState().manager?.terminate()` but never `set({ manager: null })`.
`terminate()` (`EngineManager.ts:643-651`) sets `isReady = false` and drops the worker, so the
store now holds a live object reference to a dead engine.

Every downstream guard checks only for presence:
- `useAutoAnalysis.ts:24` — `if (!isEnabled || !manager) return;` passes.
- `engineStore.startAnalysis:318-325` sets `isRunning: true`, then calls `manager.analyze()`.
- `analyze()` early-returns at `EngineManager.ts:580` (`if (!this.isReady) return;`) — silently.

Result: `isRunning` is stuck `true`. `EngineControls.tsx:53` renders "Searching – depth N"
with a Stop button that does nothing, `EngineStats.tsx:23-28` spins forever, and the eval bar
holds a stale value (by design, per the `startAnalysis` hold-previous-eval invariant — which
here hides the failure rather than smoothing it).

The same shape exists during crash recovery: `handlePostLoadError` (`EngineManager.ts:366-368`)
sets `worker = null; isReady = false` while the store still holds the manager, so every
`analyze()` issued during the reload window is swallowed while the UI claims to be searching.

Suggested fix: null the store manager in the cleanup; and make `analyze()` report rejection
(return `boolean`, or publish an `{type:'error'}` event) so `startAnalysis` only sets
`isRunning: true` when the command was actually accepted.

---

## S5 — HIGH: the watchdog can only send `stop`; it never escalates, so a wedged worker hangs forever

`frontend/src/services/EngineManager.ts:401-409` (watchdog), `:524-534` (`resetAnalysisTimer`),
`:143-147` (`infoGapGraceMs`).

Both hang guards do exactly one thing: `this.send('stop')`. The interval watchdog repeats it
every 3 s indefinitely; `resetAnalysisTimer` fires once (it is only re-armed by an incoming
`info` line, `:460`). Neither ever terminates the worker, rejects `this.current`, or clears
`isSearching`.

If the WASM instance is genuinely wedged (tight loop, memory thrash) without firing
`worker.onerror`, `stop` is never read, no `bestmove` arrives, and
`current.resolve`/`current.reject` are never invoked. `GameReviewService.ts:236`
(`await this.engine.evaluate(...)`) then never settles and the review sits on one ply forever.
Review at least has an escape hatch — `cancel()` → `abort()` (`:628-641`) rejects `current`
— but live `analyze()` has none short of a page reload.

Compounding: for live analysis `infoGapGraceMs` returns `INFINITE_GRACE_MS = 300000`
(`:141`), because `startAnalysis` always passes `infinite: true` (see S12). So a wedge during
normal browsing is not even *noticed* for five minutes.

Suggested fix: count consecutive watchdog trips with no new `info` and no `bestmove`; after
2-3, `terminate()` + `recover()` and reject all outstanding promises with a distinguishable
error so the review can retry that ply instead of hanging.

---

## S5b — HIGH: `terminate()` drops in-flight promises without rejecting → switching engines mid-review permanently blocks live analysis

`frontend/src/services/EngineManager.ts:643-651`, `frontend/src/store/engineStore.ts:173-176`,
`frontend/src/services/GameReviewService.ts:324`, `:331`, `:334`.

```ts
terminate(): void {
  try { this.worker?.terminate(); } catch {}
  …
  this.current = null;
  this.queued = null;
  this.clearTimers();
}
```

`this.current` and `this.queued` are nulled **without calling their `reject`**. Compare
`loadEngine:251-252` and `handlePostLoadError:363-364`, which both reject correctly — this is
an asymmetry, not a deliberate choice.

Reachable path: a review is running, and the user opens the engine dropdown and picks a
different engine. `EngineVersionSelector.tsx:34` only disables on `isLoading`, so this is
allowed. `switchEngine` → `initEngine` → `existing.terminate()` (`engineStore.ts:174`). The
`await this.engine.evaluate(...)` inside `GameReviewService.evalAtPly` (`:236`) now never
settles.

`GameReviewService` checks `this.cancelled` only at loop boundaries (`:324`, `:331`, `:334`),
all of which sit *after* that await — so cancellation cannot break the deadlock either, and
`ReviewTab`'s `catch` block (which is the only thing that resets
`reviewStore.progress.phase` back to `'idle'`, `ReviewTab.tsx:146-157`) never runs.

The result is a permanent brick: `phase` stays `'analyzing'`, which is exactly the condition
that suppresses live analysis at `useAutoAnalysis.ts:32` and `engineStore.startAnalysis:310`.
The eval bar and engine lines are dead for the rest of the session, on the freshly loaded
engine, with no error shown. Only a page reload recovers.

(The analogous unmount path — navigating away mid-review — happens to survive, because React
runs the child `ReviewTab` cleanup, and therefore `cancel()` → `abort()` → `reject`, before
`AnalyzerPage`'s `useStockfish` cleanup calls `terminate()`. That ordering is incidental, not
guaranteed.)

Suggested fix: reject `current`/`queued` in `terminate()` exactly as `handlePostLoadError`
does; additionally, disable the engine selector while `reviewStore.progress.phase === 'analyzing'`,
and add a cancellation check that can interrupt a pending `evaluate()` (e.g. race it against a
cancellation promise).

---

## S6 — MEDIUM-HIGH: two options are sent unconditionally that 3 of the 4 engines do not have

`frontend/src/services/EngineManager.ts:207-221` (`buildOptionCommands`), `:296-298`,
`frontend/src/components/engine/EngineControls.tsx:189-195`.

Verified per-binary option tables (byte scan of the wasm data section):

| option | sf18-lite-single | sf18-lite (MT) | sf17.1-lite-single | sf16-lite-single |
|---|---|---|---|---|
| `Threads` | yes | yes | yes | yes |
| `Hash` | yes | yes | yes | yes |
| `MultiPV` | yes | yes | yes | yes |
| `Skill Level` | yes | yes | yes | yes |
| `UCI_LimitStrength` / `UCI_Elo` | yes | yes | yes | yes |
| `UCI_ShowWDL` | yes | yes | yes | yes |
| **`Use NNUE`** | **no** | **no** | **no** | yes |
| **`UCI_AnalyseMode`** | **no** | **no** | **no** | yes |
| `EvalFile` | yes | yes | yes | no (net fetched, see S10 note) |
| `UCI_Chess960`, `Ponder`, `Move Overhead`, `Clear Hash`, `nodestime` | yes | yes | yes | yes |
| `SyzygyPath` | no | no | no | no |

`buildOptionCommands` emits `setoption name Use NNUE value …` for every engine
(`EngineManager.ts:213`), and `:297-298` emits `UCI_AnalyseMode` + `UCI_ShowWDL`
unconditionally. All four builds contain the string `No such option`, so on sf17/sf18 the
first two are rejected — harmlessly, but they are no-ops.

The user-visible consequence is at `EngineControls.tsx:189-195`: the "NNUE / Neural-net
evaluation" toggle is **inert on the default engine**. Flipping it runs
`setEngineSettings` → `manager.stop()` + `setOptions` + `startAnalysis`, i.e. it kills the
current search and restarts from depth 1 in order to send a command the engine discards.

Suggested fix: put capability flags on `ENGINE_CONFIGS` (`supportsUseNNUE`,
`supportsAnalyseMode`) and filter `buildOptionCommands` / the `uciok` block by them; hide or
disable the NNUE toggle when the loaded engine lacks the option.

---

## S7 — MEDIUM-HIGH: `setoption` is pushed while a search is still running

`frontend/src/store/engineStore.ts:430-431`, `frontend/src/services/EngineManager.ts:226-233`,
`:617-625`.

`setEngineSettings` does:

```ts
manager.stop();
manager.setOptions(next);
```

`stop()` (`EngineManager.ts:617-625`) sets `current.aborted = true` and posts `stop`, but it
does **not** wait for the terminating `bestmove` — `isSearching` stays `true` until the engine
replies. `setOptions` (`:228-231`) immediately posts `setoption name Hash …` /
`setoption name Threads …`.

UCI requires `setoption` only while the engine is not searching. `Hash` reallocates the
transposition table and `Threads` tears down and respawns the thread pool; doing either
inside a live search is the classic corruption/crash case, and on `sf18-lite-mt` it races the
pthread pool directly.

(`setoption name MultiPV` at `:557` is fine — `startSearch` only ever runs from an idle
state, either from `analyze`/`evaluate` when `!isSearching` or from the `bestmove` handler.)

Failure scenario: user drags the Threads slider (`EngineControls.tsx:134-141`) during a live
infinite search on the MT engine. Threads is reconfigured mid-search.

Suggested fix: defer option pushes until the terminating `bestmove` arrives. The
`readyokQueue` FIFO (`:192`) is the right precedent — add a `pendingOptions` field applied
from the `bestmove` handler, or expose a `whenIdle(): Promise<void>`.

---

## S8 — MEDIUM: `info string` lines overwrite the real PV-1 entry in the current search

`frontend/src/services/EngineManager.ts:458-467`, `:691-736` (`parseInfoLine`),
`frontend/src/store/engineStore.ts:194-198`.

`parseInfoLine` returns a **non-null** object for any line starting with `info `, defaulting
`multipv = 1, depth = 0, cp = null, mate = null, pv = []` (`:694-701`). `handleMessage`
(`:462-464`) then unconditionally does `this.current.latestLines.set(parsed.multipv, parsed)`.

Both builds emit `info string …` — verified in the wasm data sections: `stockfish-18-lite-single.wasm`
contains the literal `info string `, and `stockfish-16-lite-single.wasm` contains
`info string NNUE evaluation enabled.` / `info string classical evaluation enabled.`

So any `info string` arriving while a search is live replaces the real multipv-1 line with
`{cp: null, mate: null, depth: 0, pv: []}`. At `bestmove` (`:479-489`) `top = cur.latestLines.get(1)`
is that stub, so the `SearchResult` carries `cp: null, mate: null, depth: 0, pv: []`.

Downstream: `GameReviewService.ts:254` sees both `cp` and `mate` null on a non-terminal
position and fires a **second full search** (the retry path), or flags the ply unscored.
Separately, `engineStore.ts:196` sets `updates.currentDepth = info.depth` (= 0) from the same
line, flashing "depth 0" in `EngineStats.tsx:16`.

Suggested fix: return `null` from `parseInfoLine` when the line is `info string …`, or more
generally when it carries neither a `score` nor a `pv`.

---

## S9 — MEDIUM: `lowerbound` / `upperbound` scores are consumed as real evaluations

`frontend/src/services/EngineManager.ts:710-719`.

```ts
if (type === 'cp') cp = val;
else if (type === 'mate') mate = val;
// Skip lowerbound/upperbound markers
if (tokens[i + 1] === 'lowerbound' || tokens[i + 1] === 'upperbound') i++;
```

The bound token is detected only to advance the index; `cp`/`mate` is assigned regardless.
Both bound strings are present in all four wasm binaries, so these lines do occur.

Aspiration-window bound scores are not evaluations — they are one-sided fail-high/fail-low
signals, and lichess's UCI parser discards those lines outright. Here they land in
`latestLines`, so they can (a) flash a bogus value on the eval bar via
`engineStore.ts:254-259`, and (b) be the last recorded line when a `stop`-induced `bestmove`
arrives, in which case the bound score becomes the review eval and is **pushed to the shared
Mongo position cache** (`GameReviewService.ts:309`), poisoning it for every other user.

Suggested fix: return `null` from `parseInfoLine` when either bound token is present.

---

## S10 — MEDIUM: reviewing on `sf18-lite-mt` silently disables the shared position cache

`frontend/src/services/GameReviewService.ts:153-154`, `backend/zodSchemas.ts:184`, `:190`.

```ts
const engineVersion = (this.engine.getVersion() ?? 'sf18-lite') as
  'sf18-lite' | 'sf17-lite' | 'sf16-lite';
```

That cast is false: `getVersion()` (`EngineManager.ts:653`) can return `'sf18-lite-mt'`.

Server side, `positionCacheSchema.engineVersion` (`backend/zodSchemas.ts:190`) is
`z.enum(['sf18-lite', 'sf18-full', 'sf17-lite', 'sf16-lite'])` — `sf18-lite-mt` is not a
member, while `sf18-full` (removed from the client months ago) still is.
`positionEvalQuerySchema.engine` (`:184`) has the same enum.

Failure scenario: a user on the MT engine runs a review. Every `pushFromSearchResult`
(`GameReviewService.ts:309`) is 400-rejected by Zod and every cache read misses, so the
review recomputes all ~80 positions from scratch on every run and contributes nothing back.
Both failures are swallowed (the push is fire-and-forget `void`), so nothing surfaces.

Note this also means the cache key does not distinguish MT from single-threaded — which is
correct behaviour, since both are the same SF18 lite net and produce the same evals.

Suggested fix: normalize `sf18-lite-mt → sf18-lite` at the cache boundary in
`GameReviewService`, and drop `sf18-full` from both enums (or replace the enums with the
client's `EngineVersion` union so the two cannot drift again).

---

## S11 — MEDIUM: an `error` line marks the engine idle while its search may still be running

`frontend/src/services/EngineManager.ts:505-521`.

Any worker line starting with `error` clears `this.current` and sets `isSearching = false`,
on the assumption that the engine has abandoned the search. If that assumption is wrong, the
next `analyze()` takes the `!isSearching` path (`:595`) straight into `startSearch`, which
emits `ucinewgame` / `setoption MultiPV` / `position` / `go` **into a live search**. Stockfish
ignores `position` while searching, so the still-pending `info`/`bestmove` stream belongs to
the *old* position but is now attributed to the new `current` — an eval displayed against the
wrong FEN, or a `SearchResult` in review resolved from a different position's lines.

Severity is capped by the fact that this branch appears to be effectively dead today: no
lowercase `error`-prefixed output exists in any of the four binaries (bad options print
`No such option:`; sf16 also has `Unknown command`).

Suggested fix: only treat the line as terminal when `isSearching` is true *and* follow it with
a real `stop`, awaiting the resulting `bestmove` before starting the queued request; or drop
the branch and let the watchdog (S5, once escalating) own the recovery.

---

## S12 — MEDIUM: `depth`, `moveTimeMs` and `infiniteMode` are all pinned; live analysis has no user-settable limit

`frontend/src/store/engineStore.ts:325`, `:346`, `:377-386`, `:438-451`,
`frontend/src/services/EngineManager.ts:569-575`.

`startAnalysis` (`:325`) and `startIndexedAnalysis` (`:346`) both hard-code
`moveTimeMs: null, infinite: true`, and `startSearch`'s precedence (`EngineManager.ts:569-575`)
gives `infinite` priority over `depth`. So the `depth` value passed in is never applied to a
live search.

- `setDepth` (`engineStore.ts:377-386`) has **no caller in the UI** — a grep for
  `setDepth` / `s.depth` across `frontend/src/**/*.tsx` returns only a prose mention in
  `PrivacyPage.tsx:54`. Review depth comes from ReviewTab's own chips
  (`ReviewTab.tsx:91 handleRun(depth)`), not from the store.
- `setMoveTime` (`:438-441`) and `setInfiniteMode` (`:443-451`) both `void` their argument and
  unconditionally write `{ moveTimeMs: null, infiniteMode: true }`.
- The only remaining effect of `depth` is the eval-bar gate `Math.min(MIN_RENDER_DEPTH, get().depth)`
  at `:253` — with the default 18 that is a constant 4.
- Consequently `MOVETIME_GRACE_MS` (`EngineManager.ts:133`) and the `go movetime` branch are
  unreachable from the UI.

Versus the reference bar this is a missing feature, not merely dead code: lichess and
chess.com both let you cap live analysis by depth, and chess.com by time. The plumbing is
already there — `AnalyzeRequest.moveTimeMs` / `depth` / `infinite` and per-mode watchdog
graces all exist and are correct. Only the controls are absent.

Suggested fix: restore a search-limit control group in `EngineControls` (Infinite / Depth N /
Movetime N) that writes `depth` / `moveTimeMs` / `infiniteMode` and threads the chosen mode
through `startAnalysis`, rather than pinning `infinite: true`.

---

## S13 — MEDIUM: `UCI_LimitStrength` / `UCI_Elo` are fully plumbed but have no UI

`frontend/src/services/EngineManager.ts:61-67`, `:84-86`, `:207-221`,
`frontend/src/components/engine/EngineControls.tsx:132-196`.

All four binaries support `UCI_LimitStrength` and `UCI_Elo` (verified in the wasm option
tables), `buildOptionCommands` emits them correctly with the Elo clamped to 1320..3190, they
are persisted in `engineSettings`, and the v1→v2 migration (`engineStore.ts:460-468`) exists
to protect them. But a grep for `limitStrength` / `uciElo` across `frontend/src` returns only
`EngineManager.ts` and comments in `engineStore.ts` — **no component reads or writes them**.
The Advanced panel exposes only Threads, Hash, Skill Level and NNUE.

So the one strength-limiting control that is actually on the reference bar (chess.com's
"play/analyse at rating X", lichess's UCI_Elo) is dead weight, while the control that *is*
exposed (Skill Level) is the cruder legacy mechanism.

Suggested fix: add a toggle + slider pair to `EngineControls` bound to
`setEngineSettings({ limitStrength, uciElo })`. Roughly ten lines using the existing `Toggle`
and `Slider` primitives — the engine side needs no changes.

---

## S14 — LOW-MEDIUM: `stopAnalysis` blanks the eval, contradicting the hold-previous-value invariant

`frontend/src/store/engineStore.ts:349-361`, `:363-375`,
`frontend/src/components/engine/EngineControls.tsx:57-67`.

`startAnalysis` goes out of its way *not* to blank `evalFormatted` / `rawCp` / `currentDepth`
on a position change (comment at `:311-317`), because doing so collapses the eval bar to
centre. But `stopAnalysis` sets `evalFormatted: ''`, `rawCp: null`, `currentDepth: 0`, and
`lines: []`.

Pressing the Stop button (`EngineControls.tsx:61`) therefore throws away a perfectly valid
depth-30 evaluation: the bar snaps to 50/50, the lines panel reverts to "Awaiting engine
output…", and `EngineStats` reads "depth 0". Lichess and chess.com keep the last evaluation on
screen when you pause. `resetAnalysisState` (`:363-375`) does the same thing, which is correct
*there* (new game), but Stop is not a new game.

Suggested fix: have `stopAnalysis` clear only `isRunning` and `analyzedFen`, leaving the eval,
depth and lines intact; keep the full blank in `resetAnalysisState`.

---

## S15 — LOW: `parseInfoLine` drops most of the `info` payload

`frontend/src/services/EngineManager.ts:97-106` (`SearchInfoLine`), `:691-736`.

The parser handles `depth`, `multipv`, `nps`, `hashfull`, `score`, `wdl`, `pv`. All four
binaries also emit `seldepth`, `nodes`, `time`, `currmove` / `currmovenumber` (`seldepth` and
`currmove` verified present in each wasm), and none of these are captured.

Lichess and chess.com both surface seldepth and node counts. Cheap to add: three more `case`
arms plus fields on `SearchInfoLine` and a couple of spans in `EngineStats.tsx`.

---

## S16 — LOW: `latestLines` can hold PVs from different depths

`frontend/src/services/EngineManager.ts:462-464`, `:479-489`.

`latestLines.set(parsed.multipv, parsed)` keeps the most recent line per multipv index with no
depth bookkeeping. After a `stop`, Stockfish typically emits only the line it was working on,
so the map can end up with PV-1 at depth 30 and PV-2 at depth 28. `SearchResult.lines` is
handed out as-is.

Review consumes exactly that pair: `GameReviewService.ts:243-244` takes `lines.get(1)` and
`lines.get(2)`, and the top-2 Win% spread is the input to the complexity bonus in
`accuracyToGameRating`. A depth-mismatched pair inflates or deflates the spread.

Suggested fix: track the depth each multipv entry was recorded at and, at `bestmove`, only
report the lines belonging to the deepest fully-completed iteration.

---

## S17 — LOW: `terminate()` leaves `readyokQueue` populated

`frontend/src/services/EngineManager.ts:643-651`, `:192`, `:428-432`.

`loadEngine` correctly drains and clears `readyokQueue` (`:263-264`), and the comment there
explains exactly why a stale `session` marker is dangerous. `terminate()` does not do the
same. A manager that is terminated and then has `setOptions()` called on it is guarded
(`sendIsReady` early-returns when `!isReady`), so this is bounded — but it is the same
FIFO-desync hazard the `loadEngine` code was written to prevent, and the two should match.

---

# Answers to the specific questions

## Q1 — UCI serialization, abort/queue, watchdogs, `bestmove`, option order

Bugs and races found: **S5** (watchdog cannot escalate), **S5b** (`terminate()` does not
reject), **S7** (`setoption` sent mid-search), **S8** (`info string` corrupts the line map),
**S9** (bound scores treated as evals), **S11** (`error` line falsely marks idle),
**S16** (mixed-depth line map), **S17** (`readyokQueue` not cleared on terminate).

Option application order in `startSearch` (`EngineManager.ts:543-576`) is **correct**:
`ucinewgame?` → `setoption name MultiPV` → `position` → `isready` barrier → `go`. MultiPV
precedes `position` so the count applies to this search, and the `isready` barrier guarantees
options are absorbed before `go`. Search-mode precedence (`:569-575`) matches its documented
contract: `moveTimeMs > 0` → `go movetime`, else `infinite` → `go infinite`, else `go depth`.

`bestmove` handling (`:469-503`) is correct and is genuinely the single search terminator:
`current` is cleared, `isSearching` flipped, the analysis timer cleared, the promise resolved
(or rejected with `Aborted` when superseded), and only then is a queued request started. The
abort/queue discipline in `analyze` (`:579-596`) and `evaluate` (`:599-614`) is also correct —
the queue holds at most one request, the superseded one is rejected rather than leaked, and a
`stop` is always sent before queueing.

The `readyok` FIFO correlation (`:192`, `:428-432`, `:446-457`, `:660-686`) is correct,
including the subtle part: the load-barrier `isready` posted from inside `loadEngine`'s
`onmessage` (`:299`) is deliberately *not* enqueued, and the matching `readyok` is consumed by
the `!settled.done` branch at `:302-314` before `handleMessage` ever sees it, so the FIFO stays
aligned. `beginSession`'s timeout removes its marker by identity (`:670-671`) rather than by
position, which is right.

Options sent **unconditionally at `uciok`** (`:296-298`): `Hash`, `Threads`, `Skill Level`,
`Use NNUE`, `UCI_LimitStrength` (+ `UCI_Elo` only when limiting), `UCI_AnalyseMode`,
`UCI_ShowWDL`. Of these, `Use NNUE` and `UCI_AnalyseMode` do not exist in sf17/sf18 — see
**S6** for the verified per-build support matrix.

## Q2 — `ENGINE_CONFIGS` ↔ files on disk

Every one of the four ids maps to a file that exists. Actual contents of
`frontend/public/stockfish/`:

| file | bytes | used by |
|---|---:|---|
| `stockfish-18-lite-single.js` | 20,670 | `sf18-lite` (default) |
| `stockfish-18-lite-single.wasm` | 7,295,411 | ↑ |
| `stockfish-18-lite.js` | 32,109 | `sf18-lite-mt` |
| `stockfish-18-lite.wasm` | 7,093,151 | ↑ |
| `stockfish-17.1-lite-single.js` | 20,672 | `sf17-lite` |
| `stockfish-17.1-lite-single.wasm` | 7,280,741 | ↑ |
| `stockfish-16-lite-single.js` | 25,594 | `sf16-lite` |
| `stockfish-16-lite-single.wasm` | 575,029 | ↑ |
| `nn-5af11540bbfe.nnue` | 40,119,326 | fetched at runtime by `sf16-lite` |

No orphans, no missing files, and `scripts/copyStockfish.mjs` is consistent with reality: it
copies the two sf18 pairs from `node_modules/stockfish/bin` (`:19-27`) and only *guards* the
presence of the committed sf16/sf17.1 files plus the NNUE net (`:53-64`).

Net handling checks out. The sf17/sf18 wasm files embed their net (each references
`nn-9067e33176e8.nnue` internally and is ~7 MB), while `stockfish-16-lite-single.wasm` is only
575 KB and references `nn-5af11540bbfe.nnue` by name — matching the 40 MB file on disk, which
it fetches relative to the worker URL (`/stockfish/`). `sizeMB: 40` on the sf16 entry
(`EngineManager.ts:25`) is therefore honest, and `sizeMB: 7` on the others is right.

One inconsistency: `sf18-lite-mt` is advertised as `~7MB` in the dropdown, but selecting it
downloads a *second* ~7 MB wasm because it is a different binary from `sf18-lite` — the label
reads as though it were free.

## Q3 — `sf18-lite-mt`: reachability, Threads, and `crossOriginIsolated === false`

**Reachable from the UI: yes.** `EngineVersionSelector.tsx:9-14` lists it unconditionally as
the second of four options.

**Does `Threads` reach the worker: yes.** `buildOptionCommands` (`EngineManager.ts:212`) emits
`setoption name Threads value N` at `uciok` (`:296`) and again on every `setOptions()` call
(`:229`), and `Threads` is present in all four wasm option tables. The default is
`defaultThreads()` = `min(4, hardwareConcurrency - 1)` (`:70-73`).

Two problems around it:
- The command is sent to the three `-single` builds too, where it is silently ignored (the
  option exists, the build has no thread pool). `EngineControls.tsx:10-11` sets the slider max
  to `navigator.hardwareConcurrency` regardless of the loaded engine, so on the **default**
  engine a user can drag Threads to 16, sit through a search restart, and get nothing. There is
  no indication that Threads only matters on the MT build. `isMultiThreaded()` exists precisely
  to answer this and is never called.
- Changing Threads mid-search pushes `setoption` into a live search — **S7**.

**When `crossOriginIsolated === false`:** there is no check, no fallback, and no message. The
MT glue throws during module init (it requires `new WebAssembly.Memory({shared:true})` to
return a `SharedArrayBuffer`, and its pthread path aborts with "Current environment does not
support SharedArrayBuffer, pthreads are not available!"). `worker.onerror` fires before load
settles, `loadEngine` rejects at `:328`, and via **S1** the result is a permanent brick: engine
dropdown greyed out forever, no engine loaded, unhandled promise rejection, no toast. See
**S1** and **S2**.

## Q4 — Missing UCI capabilities vs the reference bar

Cheap = engine already supports it in all four builds and the client plumbing mostly exists.

| capability | status | cost |
|---|---|---|
| MultiPV 1-5 | present and correct | — |
| Infinite analysis | present and correct | — |
| Threads / Hash | present (caveats: S7, Q3) | — |
| WDL | present — parsed (`:720-730`), flipped white-relative (`engineStore.ts:232-236`), rendered in `EvaluationBar.tsx:82-92` | — |
| **Fixed-depth live analysis** | plumbing exists, **no UI**, and `infinite:true` overrides it | cheap (S12) |
| **Movetime live analysis** | plumbing exists, **no UI**, permanently pinned off | cheap (S12) |
| **`go nodes N` limit** | absent entirely | cheap — one branch in `startSearch` + one field |
| **`UCI_LimitStrength` / `UCI_Elo`** | engine + manager + persistence done, **no UI** | cheap (S13) |
| **`UCI_Chess960`** | supported by all four wasm builds, never sent | cheap — matters the moment a 960 game is imported |
| **`Clear Hash`** | supported by all four, never sent | cheap |
| **Threat mode** (search with side-to-move flipped) | absent entirely | moderate — build the null-move FEN and run a second search into a separate result slot |
| **NNUE net selection (`EvalFile`)** | `EvalFile` exists in the sf17/sf18 wasm tables; never sent, no UI | moderate — needs net hosting + a large download path |
| **seldepth / nodes / time / currmove readout** | emitted by the engines, dropped by the parser | cheap (S15) |
| **Syzygy in live analysis** | `SyzygyPath` is **not compiled into any** of the four builds (`Syzygy` absent from all wasm tables), so this is not achievable client-side; the lichess tablebase HTTP API is used, but only inside review (`GameReviewService.ts:168-200`) — live analysis gets no tablebase at all | moderate — call `lookupTablebase` from the live path too |
| Hash-usage indicator | present (`hashfull` → `EngineStats.tsx:19-21`) | — |

## Q5 — Repeated engine switching, HMR, React StrictMode

**StrictMode double-mount is handled correctly.** Traced: mount A starts `initEngine`
(generation 1); StrictMode's synchronous unmount runs `useStockfish`'s cleanup, which finds
`manager === null` (still loading) and no-ops; mount B starts generation 2. When generation 1
resolves, `myGeneration !== engineInitGeneration` (`engineStore.ts:274`) so it terminates its own
worker and never publishes; generation 2 publishes. The orphan-termination branch in
`useStockfish.ts:22-28` covers the same case from the hook side. The `engineInitGeneration`
guard (`:144`, `:171`, `:274`) is load-bearing and should not be removed. Cost is one extra WASM
instantiation in dev, which is acceptable.

**Repeated engine switching is serialized correctly.** `switchEngine` (`:286-298`) routes
through `initEngine` rather than calling `manager.loadEngine()` directly, so the generation
guard applies; the comment at `:289-292` documents why. `loadEngine` itself is re-entrant-safe:
it rejects the outstanding promises (`:251-252`), terminates the old worker, clears the
`loadTimeout` to avoid an orphaned reject (`:267-270`), and drains `readyokQueue` (`:263-264`).

What still breaks under switching:
- **S5b** — switching engines while a review is running deadlocks the review and permanently
  blocks live analysis.
- **S1** — a single failed switch (bad/unsupported target) leaves `isLoading: true` forever and
  no engine at all.
- **S3** — the switch result is written to the persisted `engineVersion`, but the boot path then
  overwrites it, so switches never survive a reload.

What breaks on unmount:
- **S4** — the store keeps a terminated manager, so the next `startAnalysis` sets
  `isRunning: true` and then silently no-ops.

**HMR:** `engineInitGeneration` is module-level state in `engineStore.ts`. A Vite HMR update of
that module produces a fresh module instance with the counter reset to 0 and a fresh zustand
store, while the previous module's `EngineManager` (and its running `go infinite` worker) is
still referenced only by the old, now-unmounted store — nothing terminates it. Expect one
leaked worker burning a CPU core per HMR cycle that touches `engineStore.ts` or its import
graph. Dev-only, and I did not reproduce it live; flagging it as the expected consequence of
having no `import.meta.hot.dispose` teardown for the manager.

---

# Verified correct — do not "fix" these

Read and confirmed sound; several carry comments warning against regression, and the code
matches the comment:

- `DEPTH_GRACE_MS = 90000` (`EngineManager.ts:134`) and the per-mode `infoGapGraceMs`
  (`:143-147`). Shrinking the depth grace is the documented cause of "depth freezes at 20-26".
- The `readyok` FIFO with tagged markers, including the un-enqueued load barrier
  (`:192`, `:299`, `:302-314`, `:428-432`, `:446-457`, `:660-686`).
- `handlePostLoadError` / `recover()` (`:349-399`) — rejects every outstanding promise before
  tearing down, then self-heals. This is the pattern `terminate()` should copy (S5b).
- `MIN_RENDER_DEPTH` eval-bar stability gate and the deliberate *non*-blanking of
  `evalFormatted` / `rawCp` / `currentDepth` on position change (`engineStore.ts:88`,
  `:245-261`, `:311-324`, `:337-338`).
- `engineInitGeneration` (`engineStore.ts:144`, `:171`, `:274`).
- The `ENGINE_CONFIGS[requested] ? requested : 'sf18-lite'` fallback for stale persisted ids
  (`:181`) — this is what stops a leftover `sf18-full` from crashing the app.
- `DEFAULT_ENGINE_OPTIONS` merge before load (`:187`) and the v1→v2 `migrate` (`:460-468`),
  both of which exist to stop `UCI_LimitStrength value undefined`.
- `partialize` (`:471-476`) — runtime `manager` / `adapter` / `lines` / eval are correctly kept
  out of localStorage.
- The bounded LRU `sanCache` (`:94-136`) with recency refresh on hit.
- The `phase === 'analyzing'` (not whole-session) guard in `useAutoAnalysis.ts:32` and
  `engineStore.ts:310` / `:382` / `:392` / `:432` / `:447`. Widening it to the whole review
  session is the documented eval-bar-freeze regression.
- WDL mover-relative → white-relative flip (`engineStore.ts:232-236`), which mirrors the
  cp/mate flip immediately above it.
- The `score cp N lowerbound` index arithmetic in `parseInfoLine` (`:710-719`) — the token
  walk is correct; only the decision to *keep* the bound score is wrong (S9).

