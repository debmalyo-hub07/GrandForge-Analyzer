# State & Store Audit — `frontend/src/store/**`, `frontend/src/hooks/**`

Scope audited: `engineStore.ts`, `gameStore.ts`, `reviewStore.ts`, `uiStore.ts`, `importStore.ts`,
`gameStore.test.ts`, all of `frontend/src/hooks/**`, plus `App.tsx` / `AnalyzerPage.tsx` /
`components/layout/AnalyzerLayout.tsx` for mount and effect ordering. Cross-boundary claims were
verified against `services/EngineManager.ts`, `services/GameReviewService.ts`,
`components/review/ReviewTab.tsx`, `components/review/ReviewMoveGlyph.tsx`,
`components/engine/EngineVersionSelector.tsx`, `components/engine/EngineControls.tsx`.

**Nothing in this report has been applied.** Every item is a proposal.

Line numbers are against the working tree as of this audit (which includes the pre-existing uncommitted
modifications to `EngineManager.ts`, `GameReviewService.ts`, `ReviewMove*.tsx`, `reviewUtils*.ts`, and
`EngineVersionSelector.tsx` that were present at session start). Every cited line was re-verified at the
end of the pass.

## Verification of the briefed assumptions

| Claim | Verdict |
| --- | --- |
| `engineStore` owns `EngineManager`; `engineInitGeneration` guards concurrent re-init | Holds (`engineStore.ts:144`, `171`, `274-280`). The guard is correct for *publication*; it does **not** guard *teardown* — see S1 and S6. |
| Eval-bar gate `MIN_RENDER_DEPTH = 4` | Holds (`engineStore.ts:88`, `252-260`), correctly floored by target depth. |
| Position change does not blank the previous eval | Holds (`engineStore.ts:311-324`, `339-345`). `stopAnalysis`/`resetAnalysisState` do blank, which is a different and intended path. |
| Live analysis suppressed only while `progress.phase === 'analyzing'` | Holds in all five gates (`engineStore.ts:310`, `382`, `392`, `432`, `447`, `useAutoAnalysis.ts:32`). |
| Tree helpers `getMainlinePath` / `getPathToNode` / `getNodeIdAtPly` / `pathKey` | All present and exported (`gameStore.ts:58`, `69`, `597`, `584`, `613`). `pathKey` has **no production caller** — tests only. |
| Reviews pin via `reviewedNodeIds` / `reviewedPathKey` / `reviewedLineUciKey` | Partially. `reviewedNodeIds` is genuinely load-bearing (`ReviewMoveGlyph.tsx:23-27`, `useReviewPlayback.ts:19-21`). `reviewedPathKey` and `reviewedLineUciKey` are **written and never read** — see S10. |
| localStorage `grandforge-engine` persists `engineVersion`, `depth`, `multiPV`, `engineSettings`, `moveTimeMs`, `infiniteMode` | **Drift.** `partialize` persists only the first four (`engineStore.ts:471-476`). `moveTimeMs`/`infiniteMode` are deliberately non-persisted now that live analysis is always infinite — CLAUDE.md is stale. See S15. |

---

## 1. Races, stale closures, and ordering bugs across store boundaries

### S1 — HIGH — `terminate()` abandons the in-flight `evaluate()` promise, wedging review and killing live analysis for the rest of the session

`EngineManager.terminate()` clears `current`/`queued` **without rejecting them**:

```ts
// services/EngineManager.ts:643-651
terminate(): void {
  try { this.worker?.terminate(); } catch {}
  this.worker = null;
  this.isReady = false;
  this.isSearching = false;
  this.current = null;   // <- the pending resolve/reject is dropped on the floor
  this.queued = null;
  this.clearTimers();
}
```

Compare `handlePostLoadError` (`EngineManager.ts:356-364`) and `abort()` (`EngineManager.ts:628-641`),
which both explicitly reject before clearing. `terminate()` is the odd one out.

`engineStore.initEngine` terminates the existing manager unconditionally as its first act
(`engineStore.ts:173-176`), and `GameReviewService` captures the manager **by value** at construction
(`GameReviewService.ts:111`, `121`) and never re-reads it from the store. So:

1. A review is running; `GameReviewService` is awaiting `this.engine.evaluate(...)` (`GameReviewService.ts:236`).
2. The user picks a different engine → `EngineVersionSelector.tsx:27` → `switchEngine` → `initEngine`
   → `existing.terminate()`.
3. That `evaluate()` promise **never settles**. `reviewGame` is parked on the `await` forever.
4. `reviewStore.progress.phase` stays `'analyzing'`, so every one of the five suppression gates
   (`engineStore.ts:310`, `382`, `392`, `432`, `447`, `useAutoAnalysis.ts:32`) blocks live analysis
   **permanently**. The eval bar freezes and the engine looks dead until a page reload.

The watchdog cannot rescue this: `terminate()` sets `isSearching = false` and calls `clearTimers()`,
so the info-gap watchdog (`EngineManager.ts:401-404`) is already gone. The only user escape is the
Cancel button, which stays visible while `phase === 'analyzing'` (`ReviewTab.tsx:164-170`).

Same trigger via a different path: navigating `/` → `/privacy` (a real Footer link) and back unmounts
`AnalyzerPage`, and `useStockfish`'s cleanup terminates the manager (`useStockfish.ts:42`). `ReviewTab`'s
own unmount cleanup (`ReviewTab.tsx:66`) does call `cancel()`, and child cleanups run before parent
cleanups, so that particular ordering happens to be safe — but only by accident of tree position.

Suggested fix: make `terminate()` reject `current`/`queued` with an `Engine terminated` error, exactly as
`handlePostLoadError` does. Second, have `GameReviewService` take a manager *getter* rather than a
snapshot so a mid-review switch fails fast instead of silently using a corpse.

### S2 — HIGH — the persisted `engineVersion` is discarded and overwritten on every boot

`AnalyzerPage` passes an explicit default and `useStockfish` forwards it unconditionally:

```ts
// pages/AnalyzerPage.tsx:38
const { isReady } = useStockfish({ defaultEngine: 'sf18-lite' });
// hooks/useStockfish.ts:21
const localManager = await initEngine(defaultEngine);
```

`initEngine` resolves `const requested = version ?? get().engineVersion` (`engineStore.ts:177`) — since
`version` is always the literal `'sf18-lite'`, the hydrated `engineVersion` is never consulted. Worse,
`initEngine` then writes the forced value back into the store (`engineStore.ts:282`), and `engineVersion`
**is** in `partialize` (`engineStore.ts:472`) — so the persisted blob is overwritten with `sf18-lite`.

Net effect: selecting `sf18-lite-mt`, `sf17-lite`, or `sf16-lite` survives until the next reload and then
silently reverts, and the localStorage record of the choice is destroyed. The persistence key exists and
does nothing.

Suggested fix: call `initEngine()` with no argument (let it read `get().engineVersion`) and treat
`defaultEngine` as a *fallback only when nothing is persisted*, i.e. change the option's meaning rather
than its value.

### S3 — HIGH — a persisted `engineVersion` naming a removed engine crashes the page before `initEngine`'s fallback can run

`engineStore.initEngine` has an explicit guard for this, with a comment naming the exact scenario:

```ts
// engineStore.ts:178-181
// Fall back if a stale persisted/profile value names a removed engine (e.g.
// the dropped 'sf18-full') ...
const target: EngineVersion = ENGINE_CONFIGS[requested] ? requested : 'sf18-lite';
```

But `EngineVersionSelector` dereferences the same value during **render**, with no guard:

```ts
// components/engine/EngineVersionSelector.tsx:22
const current = ENGINE_CONFIGS[engineVersion];
// :30 and :42
title={current.description}   ... <span>{current.label}</span>
```

Ordering makes the guard unreachable. `persist` hydrates synchronously from localStorage at store
creation, React commits the first render, `ENGINE_CONFIGS['sf18-full']` is `undefined`,
`current.description` throws → the nested `ErrorBoundary` in `App.tsx:71-74` catches it →
`AnalyzerPage`'s effects **never run**, so `initEngine` is never called and `engineVersion` is never
normalized. The crash reproduces on every load, permanently, for any user who had `sf18-full` selected
before it was dropped.

The selector only renders when the Analysis tab is active — `SidePanel` renders `panel[effectiveTab]`
and nothing else (`SidePanel.tsx:63`). Since `activeTab` defaults to `'analysis'` (`uiStore.ts:95`) and
`isReviewMode` is not persisted, the default path does render it, so the crash is the common case; a user
whose persisted `activeTab` is `'moves'` instead gets a working page that explodes the moment they open
Analysis.

The `migrate` function does not normalize it either (`engineStore.ts:460-468` only touches
`engineSettings`, `moveTimeMs`, `infiniteMode`), and a blob already written at `version: 3` skips
`migrate` entirely.

Suggested fix: normalize in `migrate` (`if (!ENGINE_CONFIGS[p.engineVersion]) p.engineVersion = 'sf18-lite'`)
so the value is sanitized at hydrate time, and add a `?? ENGINE_CONFIGS['sf18-lite']` fallback at the
selector's dereference as defence in depth.

### S4 — HIGH — only one of the two engine-enable flags is persisted, so a reload starts an invisible infinite search

The two flags are correctly kept in sync *while the app runs*. `uiStore.setComputerAnalysis` pushes into
the engine (`uiStore.ts:138-142`) and `EngineControls`' toggle writes both sides
(`EngineControls.tsx:25-28`), each guarded by an early-return on no-change (`uiStore.ts:139`,
`engineStore.ts:401`) so there is no ping-pong. The defect is at **hydration**:

- `computerAnalysis` **is** persisted (`uiStore.ts:166`).
- `isEnabled` is **not** — it is absent from `engineStore.partialize` (`engineStore.ts:471-476`) and
  re-initialises to `true` on every load (`engineStore.ts:151`).
- Nothing reconciles them at boot. `setComputerAnalysis` is only ever called from a user gesture, so a
  hydrated `computerAnalysis: false` never reaches `setEnabled`.

So: turn analysis off, reload. `computerAnalysis` is `false`; `isEnabled` is `true`. `useAutoAnalysis`
gates only on `isEnabled` (`useAutoAnalysis.ts:24`), so it starts a search — and since live analysis is
always `infinite: true` (`engineStore.ts:325`), that search **never terminates on its own**. Meanwhile
the eval bar (`AnalyzerPage.tsx:113`), engine arrows (`useArrowLayers.ts:161`) and both toggle UIs read
`computerAnalysis` and correctly show "off". The user sees analysis disabled while a WASM search pins a
core indefinitely — potentially a multi-threaded one on `sf18-lite-mt`.

Suggested fix: persist `isEnabled` and make it the single owner, with `computerAnalysis` reading through
to it — one value, no reconciliation step to forget. Failing that, gate `startAnalysis` on
`useUIStore.getState().computerAnalysis` as well, so the flag that *is* persisted is the one that wins.

### S5 — MEDIUM-HIGH — `clearReview()` does not cancel a running review, so loading a game mid-review leaves a zombie

`reviewStore.clearReview` resets progress to `idle` and nulls `result`, but has no handle on the
`GameReviewService` (`reviewStore.ts:52-64`). The service handle lives only in `ReviewTab`'s
`serviceRef` (`ReviewTab.tsx:46`), and only `handleCancel` and the unmount cleanup call `cancel()`
(`ReviewTab.tsx:66`, `165`).

`clearReview` is, however, invoked by `gameStore.resetTransientStateForNewGame` (`gameStore.ts:120`),
which runs on `loadPGN`, `loadIndexedGame`, `loadFEN`, and `resetBoard` (`gameStore.ts:330`, `398`,
`476`, `495`). So importing a game while a review is crunching:

1. Sets `progress.phase = 'idle'` and `result = null`.
2. Leaves the review loop running against the **old** game's positions, hammering the worker.
3. The loop's next `onProgress` call flips `phase` back to `'analyzing'` (`ReviewTab.tsx:112`), which
   re-blocks live analysis on the newly loaded game — eval bar frozen with no visible cause.
4. On completion it calls `setResult` (`ReviewTab.tsx:132`) with `reviewedNodeIds` pointing at nodes of
   a tree that no longer exists. `getReviewForNode` then matches nothing (`ReviewMoveGlyph.tsx:25`) and
   `useReviewPlayback`'s `goToNode` no-ops (`gameStore.ts:308-309`), so it fails quiet rather than
   loud — but the stale result is displayed as if it belonged to the new game.

Suggested fix: give `reviewStore` an abort registration (`registerCanceller(fn)` set by `ReviewTab`
when it constructs the service, cleared in `finally`), and have `clearReview` invoke it. Also stamp each
review run with a monotonic `reviewEpoch` and have `setResult` drop results from a superseded epoch.

### S6 — MEDIUM — `useStockfish` cleanup terminates the store's manager but leaves the dead reference in the store

```ts
// hooks/useStockfish.ts:38-43
return () => {
  cancelled = true;
  useEngineStore.getState().manager?.terminate();
};
```

`manager` is never set to `null`, so between unmount and the next mount the store advertises a live
manager whose worker is gone and whose `isReady` is `false`. Any store action taken in that window —
`reviewStore.exitReviewMode()` → `startAnalysis` (`reviewStore.ts:40-43`), `setDepth`, `setMultiPV` —
passes the `if (!manager)` check and then silently no-ops inside `EngineManager.send()`
(`EngineManager.ts:420`, `429`, which early-return on `!isReady`). It self-heals on the next
`initEngine` (which terminates the corpse again at `engineStore.ts:174`), but the intervening state is a
lie, and double-`terminate()` on the same instance is only survivable because `terminate()` is
defensively idempotent.

This is also the teardown-side hole in the `engineInitGeneration` design: the generation counter
prevents an *old init* from publishing, but nothing prevents an *old cleanup* from terminating a
*newer* manager, because the cleanup reads `getState().manager` rather than the instance its own
effect created (which it already has in `localManager`).

Suggested fix: capture the instance in the effect and tear down only that one, and pair the terminate
with `set({ manager: null, adapter: null })` when the instance being torn down is still the published one.

### S7 — MEDIUM — `makeMove` clears manual annotations only when transposing, not when creating a move

Both branches of `makeMove` navigate the board, but only one clears:

- existing-child branch: `clearManualAnnotations()` at `gameStore.ts:178`.
- new-node branch: `set({...})` at `gameStore.ts:225-232` with **no** call.

Every other navigator does clear (`goBack` `:243`, `goForward` `:261`, `goToStart` `:275`,
`goToEnd` `:296`, `goToNode` `:310`). So drawing an arrow and then playing a *new* move keeps the arrow
pointing at squares from the previous position, while playing a move that happens to already exist in
the tree clears it. The doc comment at `gameStore.ts:123-129` states the intended rule ("clear them on
every navigation"), so this is an omission, not a design choice.

Suggested fix: hoist `clearManualAnnotations()` above the `existingChildId` branch so both paths share it.

### S8 — MEDIUM — `setEngineSettings` pushes `Threads`/`Hash` while the search is still in flight

```ts
// store/engineStore.ts:428-435
manager.stop();
manager.setOptions(next);
```

`stop()` only marks the search aborted and posts `stop` to the worker (`EngineManager.ts:617-625`); the
engine is not idle until `bestmove` arrives. `setOptions` sends its `setoption` commands synchronously
on the same tick (`EngineManager.ts:226-232`). So `setoption name Threads`/`Hash` reaches Stockfish
mid-search — undefined behaviour per UCI, and the exact thing the comment at `engineStore.ts:428-429`
claims to be avoiding ("Threads/Hash only apply when idle — stop, push options, then restart").

Suggested fix: `EngineManager` should queue option commands behind the next `bestmove` when
`isSearching` is true (it already has the machinery: the `queued` slot and the readyok marker FIFO).

### S9 — MEDIUM — `reviewedNodeIds` are session-scoped, so any persisted review can never re-bind (all glyphs vanish)

`generateNodeId` mixes `Date.now()`, a module counter, and `Math.random()` (`gameStore.ts:50-56`) — ids
are not stable across reloads or across two loads of the same PGN. `getReviewForNode` treats the
presence of `reviewedNodeIds` as authoritative:

```ts
// components/review/ReviewMoveGlyph.tsx:23-27
const ids = result.reviewedNodeIds;
if (ids && ids.length > 0) {
  return ids[plyIndex + 1] === nodeId ? review : null;
}
return isOnMainline ? review : null;   // legacy fallback
```

A review round-tripped through the server (`ReviewTab.tsx:141` `reviewApi.save`) or carried on
`IndexedGame.reviewResult` (`GameEngineAdapter.ts:17`) would have `reviewedNodeIds` populated with dead
ids — which fails the strict equality and decorates **nothing**, strictly worse than the legacy
mainline fallback it was meant to improve on.

Currently latent: the only `setResult` caller is a freshly computed review (`ReviewTab.tsx:132`), and
`loadIndexedGame` ignores `game.reviewResult` entirely (`gameStore.ts:397-467`) while
`resetTransientStateForNewGame` clears any review. But the save path, the `reviewResult` field, and the
`/game/:id` load path all exist, so the first attempt to restore a saved review lands on this.

Suggested fix: persist reviews keyed on `reviewedLineUciKey` (which *is* reload-stable) and re-derive
`reviewedNodeIds` against the freshly built tree at hydrate time; keep the node ids as an in-memory
optimisation only.

### S10 — MEDIUM — `reviewedPathKey` / `reviewedLineUciKey` are written but never read; there is no staleness check anywhere

`GameReviewService.ts:581-582` populates both, `types/review.ts:104-105` documents them as "cheap path
equality" / "cheap line equality", and no production code reads either (only
`ReviewMoveGlyph.test.ts:60-61` sets them). `pathKey` in `gameStore.ts:584` is likewise exported
(`gameStore.ts:613`) with no production caller.

The consequence is that the documented cheap-equality guard against a review outliving its line does
not exist — S5's zombie result and S9's dead ids both slip through unnoticed. Note also the naming
mismatch versus CLAUDE.md, which describes `buildIndexedGameFromTree(tree, leafNodeId?)`; the actual
second parameter is `currentNodeId` and is used as "the active node, which may be mid-line"
(`gameStore.ts:525-537`), while the one production caller passes a mainline leaf
(`ReviewTab.tsx:92`, `180`).

Suggested fix: add `isReviewStaleForTree(result, tree)` comparing `result.reviewedLineUciKey` against
the current line's UCI join, call it in `ReviewTab` before rendering, and surface a "review is for a
different line" state instead of silently decorating nothing.

### S11 — LOW-MEDIUM — tree walkers have no cycle or depth guard

`getMainlinePath` (`gameStore.ts:58-67`), `getPathToNode` (`gameStore.ts:69-78`), `goToEnd`
(`gameStore.ts:289-294`) and `getNodeIdAtPly`'s legacy branch (`gameStore.ts:602-609`) all loop on
`children[0]` / `parentId` with no visited set and no iteration cap. A malformed tree (a `parentId`
cycle, or a child list that includes an ancestor) hangs the tab — and `getMainlinePath` runs on every
tree mutation via `useOpeningDetect`'s memo (`useOpeningDetect.ts:42-46`). All construction sites are
internal today, so this is defence-in-depth rather than a live bug.

Suggested fix: cap iterations at `Object.keys(tree.nodes).length` in all four walkers and `console.warn`
on overrun.

### S12 — LOW — `switchEngine` starts two analyses for one switch

`switchEngine` calls `startAnalysis` itself (`engineStore.ts:295-297`), and the `manager` identity
change also re-fires `useAutoAnalysis`'s effect (`useAutoAnalysis.ts:19`, `44`) 150 ms later. The second
`analyze()` supersedes the first via the documented abort-and-queue path, so it is correct — just a
wasted `ucinewgame`/`position`/`go` round-trip and one extra worker stall per switch.

Suggested fix: drop the explicit `startAnalysis` from `switchEngine` and let `useAutoAnalysis` be the
single trigger.

### S13 — LOW — `ReviewMovePanel` unmounting leaves `isPlaying: true` in the store

`useReviewAutoPlayback` lives only in `ReviewMovePanel` (`ReviewMovePanel.tsx:123`). Its unmount cleanup
clears the timer but not the flag (`useReviewAutoPlayback.ts:88`). `ReviewTab` swaps that panel out when
`showPuzzles` flips (`ReviewTab.tsx:45`), so entering the blunder trainer mid-playback leaves
`isPlaying === true` with no timer: playback silently stops, and the next Space keypress
(`useKeyboardNav.ts:31` → `togglePlayback`) reads as "pause" when the user expects "play".

Suggested fix: call `setIsPlaying(false)` in the unmount cleanup alongside `clear()`.

---

## 2. Persistence correctness

**Non-serializable leakage: none found.** `engineStore.partialize` (`engineStore.ts:471-476`) emits only
the four primitive/plain-object prefs — `manager`, `adapter`, `lines`, `evalFormatted`, `rawCp`,
`currentDepth` are all excluded, as documented. `uiStore.partialize` (`uiStore.ts:154-173`) correctly
excludes `highlightedSquares` (a `Set`, which would JSON-serialize to `{}` and hydrate as a non-`Set`,
breaking `.has`/`.size` at `uiStore.ts:123-126` and `gameStore.ts:134`) as well as `customArrows` and
`boardSize`. `importStore` and `reviewStore` are not persisted at all — correct, since both hold large
derived blobs (`games: IndexedGame[]`, `result: GameReviewResult`).

**S14 — MEDIUM — migration risk when a persisted enum value disappears.** Covered concretely by S3 for
`engineVersion`. The same class of risk exists for other persisted enums, with mixed handling:

| Persisted key | Disappearing-value behaviour |
| --- | --- |
| `engineVersion` (`engineStore.ts:472`) | **Crashes** — `EngineVersionSelector.tsx:22,30`. See S3. |
| `boardTheme` (`uiStore.ts:157`) | Safe — `BOARD_THEMES.find(...) ?? BOARD_THEMES[0]` at `ChessBoardWrapper.tsx:47`, `BoardEditor.tsx:100`, `BlunderPuzzleTrainer.tsx:33`. |
| `activeTab` (`uiStore.ts:161`) | Unvalidated. A stale `'import'` after a tab removal renders an empty side panel with no way back. |
| `multiPV` (`engineStore.ts:474`) | Typed `1|2|3|4|5` but hydrated unchecked; an out-of-range number reaches `setoption name MultiPV`. |
| `depth` (`engineStore.ts:473`) | Only clamped in `setDepth` (`engineStore.ts:378`), not on hydrate. A corrupt `depth: 0` makes the render gate `Math.min(4, 0) === 0` (`engineStore.ts:253`), publishing depth-1 spikes — the exact behaviour the gate exists to prevent. |

**S15 — LOW — corrupt/stale blob behaviour.** Neither store supplies a `merge`, so zustand's default
shallow merge applies: a blob whose top level is not an object (`"null"`, `'"x"'`, an array) is spread
over the initial state. `uiStore.migrate` compounds this by spreading unconditionally
(`uiStore.ts:176` `{...persisted, ...}`) — spreading a string yields `{0:'a',1:'b',...}`, and the
function's return type `PersistedUIState` is a cast, not a check. A totally unparseable blob is handled
(zustand catches the `JSON.parse` throw and falls back to initial state), but a *parseable wrong-shape*
blob is not.

Suggested fix: add a `merge(persisted, current)` to both stores that validates each field's type and
enum membership before accepting it, and clamp `depth`/`multiPV`/`variationOpacity` there rather than
only in their setters.

**S16 — LOW — documentation drift.** CLAUDE.md lists `moveTimeMs` and `infiniteMode` as persisted; they
are not (`engineStore.ts:471-476`). Both are now vestigial: `setMoveTime` ignores its argument
(`engineStore.ts:438-441`) and `setInfiniteMode` ignores `on` and always forces `true`
(`engineStore.ts:443-451`). The `migrate` function still writes them (`engineStore.ts:465-466`) even
though `partialize` will never emit them again. Also `devHooks.ts`'s header comment still describes the
`import.meta.env.DEV` gate, while `main.tsx:33` correctly uses `MODE === 'development'`.

**S17 — LOW — `boardSize` has two sources of truth.** `useBoardSize` owns local state
(`useBoardSize.ts:11`, default 480) and `ResizableBoardWrapper` mirrors it into `uiStore.boardSize`
(default 560, `uiStore.ts:96`) via an effect (`ResizableBoardWrapper.tsx:11`). `AnalyzerPage` reads the
store copy for the eval-bar height (`AnalyzerPage.tsx:51`, `114`) while the board reads the local copy,
so they disagree for one commit on every resize. `boardSize` is (correctly) not persisted, but its
presence in `UIState` implies otherwise.

---

## 3. Memory leaks

**Verified sound:**

- **`sanCache` LRU bound genuinely holds.** `sanCacheSet` evicts the oldest key when
  `size >= SAN_CACHE_MAX` *before* inserting (`engineStore.ts:97-103`), so the map never exceeds 2000.
  The hit path deletes and re-inserts to refresh recency (`engineStore.ts:107-113`), which is
  size-neutral. The `catch` path returns without caching (`engineStore.ts:133-135`) — no unbounded
  growth on malformed FENs either. Keys are `fen + '|' + pv.join(',')`, so the worst case is bounded
  strings, not retained objects.
- **`OPENING_CACHE` bound holds** at 500 (`useOpeningDetect.ts:24-32`), with the same evict-before-insert
  shape plus an `!has(key)` check so re-caching an existing key doesn't evict needlessly.
- **DOM listeners are all released:** `keydown` (`useKeyboardNav.ts:86-87`), `ResizeObserver`
  (`useBoardSize.ts:33-34`), playback timers (`useReviewAutoPlayback.ts:32-37`, `88`), the auto-analysis
  debounce (`useAutoAnalysis.ts:43`), and the opening-detect debounce (`useOpeningDetect.ts:55`).
- **`manager.subscribe()` discarding its unsubscribe function** (`engineStore.ts:190`) is safe *as
  written*, because `initEngine` always constructs a fresh `EngineManager` (`engineStore.ts:183`) and the
  listener set dies with the instance. It is fragile, though: `EngineManager.recover()` reuses the same
  instance (`EngineManager.ts:387-398`), so if `initEngine` were ever changed to reuse a manager, every
  re-init would stack another listener that fans out every `info` line. Worth capturing the returned
  disposer even though it is currently unused.

**Leaks found:**

- **S1's hung promise is a retention leak**, not just a hang: the never-settled `evaluate()` keeps the
  `GameReviewService` instance, its accumulated `moveReviews[]`, the whole `searchAtPly[]` cache, and the
  terminated `EngineManager` alive for the life of the page.
- **S6 retains a terminated `EngineManager`** in `engineStore.manager` across the unmounted interval.
- **`moveTree.nodes` is fully spread on every move** (`gameStore.ts:216-223`, and again per ply in
  `loadPGN`/`loadIndexedGame` at `gameStore.ts:361`, `433`). That is O(n²) allocation churn over a long
  game rather than a leak — nodes are correctly discarded — but a 300-ply import allocates ~45k node
  references. `loadPGN`/`loadIndexedGame` build a local tree and could mutate `parent.children` in place
  before the single `set`.
- **`useOpeningDetect` rebuilds the full mainline SAN join on every tree change**
  (`useOpeningDetect.ts:41-49`) even though lookups stop after 10 plies (`useOpeningDetect.ts:70`).
  Transient garbage, not retained, but it scales with game length for no benefit.
- **No worker is left running by any normal path**: `initEngine` terminates the predecessor
  (`engineStore.ts:174`), the generation guard terminates orphans (`engineStore.ts:278`), and
  `useStockfish`'s cancelled branch terminates a late arrival (`useStockfish.ts:26`). The overlapping
  responsibility means a given manager can be terminated two or three times, which `terminate()`
  tolerates.

---

## 4. Cross-store coupling to invert or mediate

The dependency graph is a cycle: `gameStore → {engine, ui, review}`, `reviewStore → {engine, game}`,
`engineStore → review`, `uiStore → engine`. Every edge is a direct `getState()` reach-in
(21 call sites across `store/` and `hooks/`). Five clusters, one refactor each:

**(a) `engineStore → reviewStore`, five copies of the same guard.**
`engineStore.ts:307-310`, `382`, `392`, `432`, `447` each re-read
`useReviewStore.getState().progress.phase === 'analyzing'`. The invariant is duplicated, so a sixth
entry point silently omits it (and CLAUDE.md records that broadening this check once froze the eval bar).
*Refactor:* invert it — give `engineStore` a private `analysisSuppressed: boolean` plus
`setAnalysisSuppressed(on)`, checked in exactly one place inside `startAnalysis`. The review orchestrator
calls `setAnalysisSuppressed(true)` when the batch starts and `false` in its `finally`. `engineStore`
then imports nothing from `reviewStore`, breaking the cycle.

**(b) `reviewStore → engineStore` for analysis lifecycle.**
`exitReviewMode` restarts analysis (`reviewStore.ts:39-43`) and `clearReview` resets it
(`reviewStore.ts:56`), so a pure state store performs engine I/O and its `clearReview` cannot be used in
tests without an engine.
*Refactor:* move both side effects into a `useReviewSideEffects()` hook mounted next to
`useReviewPlayback` in `AnalyzerPage`, subscribing to `isReviewMode` transitions. `reviewStore` becomes
side-effect-free.

**(c) `gameStore → three stores` in `resetTransientStateForNewGame`.**
`gameStore.ts:116-121` reaches into engine, ui, and review, each wrapped in its own `try/catch` — a
tell that the coupling is known to be fragile. It also double-resets analysis, since `clearReview`
itself calls `resetAnalysisState` (`reviewStore.ts:56`).
*Refactor:* have `gameStore` increment a `gameEpoch: number` on every load/reset and let each other store
own its reaction via `useGameStore.subscribe`. `gameStore` then imports nothing, and the epoch doubles as
the staleness token S5 and S9 both need.

**(d) `uiStore → engineStore` one-way toggle.** `uiStore.ts:141`, mirrored by `EngineControls.tsx:25-28`.
The runtime sync is correct; the problem (S4) is that the two flags have different persistence lifetimes
and three separate call sites are responsible for keeping them equal.
*Refactor:* collapse them into one owned, persisted value in `engineStore` and make
`uiStore.computerAnalysis` a read-through selector — one owner, no reconciliation step to forget, and the
hydration desync becomes structurally impossible rather than merely fixed.

**(e) `ReviewTab` snapshots the manager into `GameReviewService`.** `ReviewTab.tsx:111`,
`GameReviewService.ts:121`. See S1.
*Refactor:* change the constructor to take `getEngine: () => EngineManager | null` and have
`reviewGame` re-resolve per ply, throwing a clear `Engine changed mid-review` if the identity moves.

Also worth noting: `clearManualAnnotations` (`gameStore.ts:130-136`) is a good model of what the other
edges should look like — it guards on current state before writing so it doesn't emit fresh empty
references and churn the board.

---

## 5. Manual annotations vs review arrow layers

**Correctly separated, with one gap (S7).**

The three arrow layers are genuinely disjoint (`useArrowLayers.ts:1-6` documents the intent and the code
matches): `useEngineArrows` reads only `engineStore` + `uiStore` prefs (`:140-208`), `useReviewArrows`
reads only `reviewStore` + `uiStore` prefs (`:213-247`), `useManualArrows` reads only
`uiStore.customArrows` (`:250-256`). Nothing writes another layer's source.

- **On navigation:** manual arrows/highlights are cleared by all five navigators, but **not** when
  `makeMove` creates a new node — see S7.
- **On new-game load:** `resetTransientStateForNewGame` clears arrows *and* highlights *and* the review
  (`gameStore.ts:117-120`). Correct.
- **On review exit:** `exitReviewMode` deliberately does **not** touch `customArrows`
  (`reviewStore.ts:34-37`), and `useReviewArrows` self-empties on `!isReviewMode`
  (`useArrowLayers.ts:221`). Correct — and the comment explains why, which is the right defence against
  someone "fixing" it later.
- **On `clearReview`:** likewise leaves manual arrows alone, with a comment naming
  `resetTransientStateForNewGame` as the sole owner of wiping them (`reviewStore.ts:53-55`). Consistent.
- **Review-mode overlap:** while `isReviewMode` is true, engine arrows suppress themselves
  (`useArrowLayers.ts:162`) so review and engine arrows never co-render. Manual arrows *do* render
  during review, which is the right call (the user drew them deliberately) — but note they are not
  cleared as the review cursor advances, because playback navigates via `goToNode`
  (`useReviewPlayback.ts:21`) which *does* call `clearManualAnnotations` (`gameStore.ts:310`). So manual
  arrows are wiped by the first playback step. Consistent with the "annotates one position" rule, though
  it means drawing an arrow during review playback is erased 1.8 s later by the auto-advance tick
  (`useReviewAutoPlayback.ts:12`, `74-78`) — arguably surprising, but not incorrect.

---

## 6. Test coverage holes in `gameStore.test.ts`

`store/gameStore.test.ts` is 56 lines and 3 cases, all narrowly about review line identity. It covers
`buildIndexedGameFromTree` on a variation, `getNodeIdAtPly` with and without `reviewedNodeIds`, and
`pathKey` on two literal arrays. Gaps, roughly in the order I would close them:

1. **`getMainlinePath` and `getPathToNode` are never tested at all** despite being exported
   (`gameStore.ts:613`) and used in production (`ReviewTab.tsx:92`, `useOpeningDetect.ts:42`). No case
   pins `getMainlinePath`'s children[0] rule against a node with multiple children, nor
   `getPathToNode`'s root-first ordering.
2. **No navigation test would catch S7.** There is no assertion anywhere that navigating clears
   `uiStore.customArrows` / `highlightedSquares`, so the `makeMove` omission is invisible to the suite.
   This is the single highest-value gap.
3. **`getNodeIdAtPly` boundary behaviour is untested:** `ply < 0` and `ply >= reviewedNodeIds.length`
   both return `null` (`gameStore.ts:599`), and the legacy branch clamps to the last mainline node rather
   than returning `null` when `ply` overruns (`gameStore.ts:602-610`) — an asymmetry between the two
   branches that no test documents.
4. **`buildIndexedGameFromTree`'s null and invariant cases:** returns `null` for a root-only tree
   (`gameStore.ts:539`); `reviewedNodeIds.length === plyCount + 1`; `fenPositions[0] === root.fen`;
   `fenPositions.length === plyCount + 1`. `GameEngineAdapter.ts:19` states the length invariant in a
   comment and nothing enforces it.
5. **The explicit-node-argument path is untested.** Both production callers pass an argument
   (`ReviewTab.tsx:92`, `180`), but every test calls the one-argument form and relies on the
   `useGameStore.getState().currentNodeId` fallback (`gameStore.ts:529`). Nothing covers passing a
   *mainline* leaf while the store's current node is on a variation — which is exactly what `ReviewTab`
   does, and the reason reviews default to the mainline.
6. **`pathKey` is only tested on hand-written arrays**, never against `buildIndexedGameFromTree` output
   or `GameReviewService`'s `reviewedPathKey` (`GameReviewService.ts:581`). The two must agree and
   nothing asserts it.
7. **Label derivation is untested in both loaders.** `makeMove`'s `fullmove - 1` correction for black
   (`gameStore.ts:196-198`) and `loadIndexedGame`'s side-to-move inversion from the FEN-after
   (`gameStore.ts:408-416`) are both subtle, both commented as handling a black-to-move start FEN, and
   neither has a test — including no `loadFEN` case with a black-to-move position.
8. **`makeMove`'s transposition branch is untested** (`gameStore.ts:175-187`): playing a move that
   already exists must reuse the child and not grow `moveTree.nodes`.
9. **`isMainline` / `depth` propagation is untested:** the `parent.isMainline && parent.children.length === 0`
   rule (`gameStore.ts:199-200`, `345-346`, `417-418`) is what `ReviewMoveGlyph`'s legacy fallback keys
   on (`ReviewMoveGlyph.tsx:27`).
10. **`resetTransientStateForNewGame` has no test** — that `loadPGN`/`loadFEN`/`resetBoard` clear the
    review, arrows, and highlights. The suite calls `clearReview()` manually in `beforeEach`
    (`gameStore.test.ts:17`), which would mask a regression where `resetBoard` stopped doing it.
11. **`loadPGN` failure path untested:** invalid PGN must return `false` *without* having reset transient
    state — note the current ordering does parse-then-reset (`gameStore.ts:321-330`), which is correct
    and worth locking in.
12. **`generateNodeId` uniqueness under a synchronous load loop** (`gameStore.ts:50-56`) — the counter
    exists specifically because `Date.now()` is constant inside `loadPGN`'s loop; a test loading a
    100-ply PGN and asserting `Object.keys(nodes).length === 101` would pin it.

---

## Summary of proposed changes, by file

| File | Items |
| --- | --- |
| `frontend/src/services/EngineManager.ts` | S1 (reject on `terminate`), S8 (defer options while searching) |
| `frontend/src/hooks/useStockfish.ts` | S2 (stop forcing `defaultEngine`), S6 (tear down own instance, null the store) |
| `frontend/src/store/engineStore.ts` | S3 (`migrate` normalizes `engineVersion`), S4, S8, S12, S14 (`merge` validation), S16 (drop vestigial `moveTimeMs`/`infiniteMode`), coupling (a) |
| `frontend/src/components/engine/EngineVersionSelector.tsx` | S3 (guard the `ENGINE_CONFIGS` dereference) |
| `frontend/src/store/uiStore.ts` | S4, S14 (`activeTab` validation), S15 (`migrate` shape check), coupling (d) |
| `frontend/src/store/reviewStore.ts` | S5 (canceller registration + epoch), coupling (b) |
| `frontend/src/store/gameStore.ts` | S7 (hoist `clearManualAnnotations`), S11 (walker caps), coupling (c) |
| `frontend/src/services/GameReviewService.ts` | S1/S9 (engine getter, stable line key), coupling (e) |
| `frontend/src/components/review/ReviewMoveGlyph.tsx` | S9 (re-bind by UCI key, not node ids) |
| `frontend/src/hooks/useReviewAutoPlayback.ts` | S13 (clear `isPlaying` on unmount) |
| `frontend/src/store/gameStore.test.ts` | Section 6, items 1-12 |
| `CLAUDE.md` | S16 (persistence list, `buildIndexedGameFromTree` parameter name) |
