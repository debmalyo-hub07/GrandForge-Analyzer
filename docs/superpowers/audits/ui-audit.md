# GrandForge — Frontend UI/UX Audit

**Date:** 2026-07-28
**Scope:** `frontend/src/components/**`, `frontend/src/pages/**`, `frontend/src/store/uiStore.ts`, `frontend/src/styles/**`, `frontend/src/App.tsx`, `frontend/src/hooks/useKeyboardNav.ts`
**Reference bar:** chess.com analysis board + lichess analysis panel (unified Settings modal, right-panel Analysis/Games/Explore tabs, bottom action row, sounds, share, threat arrows, play-vs-computer)
**Working tree note:** audited against the current working tree, which has uncommitted modifications to `BoardToolsPanel.tsx`, `EngineVersionSelector.tsx`, and 9 review/engine files (see `git status`).

---

## 1. Inventory vs. the reference bar

### 1.1 Unified Settings modal — **ABSENT**

There is no Settings modal at all. `frontend/src/components/ui/Modal.tsx` exists and is fully functional, but it has exactly **one** importer in the entire app:

```
frontend/src/pages/SessionsPage.tsx:9   import Modal from '../components/ui/Modal';
```

…and `SessionsPage` is **not routed** (see §3.1), so `Modal` never renders in the shipped app. Settings are instead scattered across three unrelated surfaces (§2).

| Reference tab | Reference control | Status | Evidence |
|---|---|---|---|
| Engine | Engine choice | **Exists ×2 (duplicated)** | `components/layout/Header.tsx:9-92` (inline `EngineVersionSelector`) **and** `components/engine/EngineVersionSelector.tsx:16` rendered at `pages/AnalyzerPage.tsx:162` |
| Engine | Max time (movetime) | **ABSENT + store setter is a no-op** | `store/engineStore.ts:438-441` — `setMoveTime` discards its argument (`void ms`) and always writes `moveTimeMs: null` |
| Engine | Number of lines (MultiPV) | **Exists** | `components/engine/EngineControls.tsx:94-118` (1–5 segmented) |
| Engine | Threads | **Exists** (behind a collapsed "Engine settings" disclosure) | `components/engine/EngineControls.tsx:134-141` |
| Engine | Search depth | **ABSENT for live analysis** | `store/engineStore.ts:377` `setDepth` has **zero callers** in `components/**`/`pages/**`. Live depth is frozen at the persisted default `18` (`engineStore.ts:153`). Depth chips exist only for *review* (`components/review/ReviewTab.tsx:21-25`, `288-305`) |
| Engine | Infinite analysis toggle | **ABSENT (documented but never built)** | CLAUDE.md claims "the 'Infinite analysis' toggle + Stop/Resume in `EngineControls`". Only Stop/Resume exists (`EngineControls.tsx:57-82`). `setInfiniteMode` at `engineStore.ts:443-451` also discards its argument (`void on`) |
| Interface | Suggestion arrow | **Exists** (labelled "Best Move Arrow") | `components/board/BoardToolsPanel.tsx:208-212` |
| Interface | Classification on board | **Exists** (labelled "Move annotations") | `BoardToolsPanel.tsx:173-177` → `components/board/ChessBoardWrapper.tsx:225` |
| Interface | Show threats | **ABSENT** | Zero matches for `threat` in any component; only a prose mention at `pages/LearnClassificationsPage.tsx:15` |
| Interface | Hotkeys (view/remap) | **ABSENT** | `hooks/useKeyboardNav.ts` hard-codes ←/→/↑/↓/F/Space; no UI surfaces or edits them |
| Interface | Move-strength colouring | **Partial** | Glyphs + colours exist (`components/review/ReviewMoveGlyph.tsx`, `ReviewSummaryCard.tsx:6-23`) but there is no on/off preference |
| Interface → Review | Show arrows | **Partial, not user-toggleable** | Review arrows are gated by the *shared* `bestMoveArrow` pref (`hooks/useArrowLayers.ts:218-246`), not a review-specific one |
| Interface → Review | Highlight key moves for (White/Black/both) | **ABSENT** | `EvalGraph.tsx` key-moment dots are unconditional |
| Interface → Review | Autoplay + delay | **Partial — hard-coded, no UI** | `hooks/useReviewAutoPlayback.ts:21` takes `dwellMs` with a `DEFAULT_DWELL_MS`; the only caller (`components/review/ReviewMovePanel.tsx:123`) passes nothing, so the delay is unconfigurable |
| Interface → Review | Show time spent | **ABSENT** | No clock/time-spent rendering anywhere in `components/review/**` |
| Board | Piece sets | **Exists** | `components/board/ThemePickerRow.tsx:49` |
| Board | Board theme | **Exists** | `ThemePickerRow.tsx:16-40` |
| Board | Sound theme | **ABSENT** | Zero matches for `new Audio`, `AudioContext`, `.mp3`, `.ogg`, `.wav`, `soundTheme` across `frontend/src/**` |
| Board | Coordinates inside/outside/none | **Partial — boolean only** | `uiStore.ts:13` `showCoordinates: boolean`; toggle at `BoardToolsPanel.tsx:168-172`. No inside/outside variant |
| Board | Piece notation (symbols vs letters) | **ABSENT** | `uiStore.ts:21` has a persisted `inlineNotation` flag but it has **zero consumers** (§3.3) |
| Board | Classification style | **ABSENT** | Single hard-coded palette at `ReviewSummaryCard.tsx:6-23` |
| Board | Piece animations | **ABSENT (hard-coded)** | `ChessBoardWrapper.tsx:338` `animationDuration={200}` is a literal |
| Board | Highlight last move | **Exists, no toggle** | `utils/boardUtils.ts:67-87` always highlights |
| Board | Play sounds | **ABSENT** | see "Sound theme" |
| Board | Show legal moves | **ABSENT toggle; pref is orphaned** | `uiStore.ts:14` persists `showLegalMoves` but there is **no setter and no consumer** (§3.3) |

### 1.2 Right panel tabs — **Analysis exists; Games and Explore absent**

Shipped tabs are `Analysis / Moves / Review / Import` (`components/layout/SidePanel.tsx:26-29`). The reference `Games` and `Explore` tabs do not exist — zero matches for an `explore` panel; the only hit is a **misleading tooltip**:

```
frontend/src/components/navigation/OpeningBadge.tsx:45   title="Click to explore opening tree"
```

### 1.3 Bottom action row — **ABSENT as a row; items scattered or missing**

There is no bottom action row. `components/board/BoardControls.tsx:70-91` is the nearest analogue (Flip / Reset / Copy FEN / Fullscreen / Board tools).

| Reference item | Status | Evidence |
|---|---|---|
| New | **Partial** — "Reset to starting position" icon-only | `BoardControls.tsx:77-79` |
| Save | **ABSENT** from the UI | `services/apiClient.ts:92` exposes `sessions.create`, unreferenced by any component |
| Review | **Exists** but only inside the Review tab | `components/review/ReviewTab.tsx:389-399` |
| Toggle Charts | **ABSENT** | `EvalGraph` renders unconditionally at `ReviewTab.tsx:228,257` |
| Edit Position | **Exists** (nested 2 levels deep) | `BoardToolsPanel.tsx:137-144` → `components/board/BoardEditor.tsx` |
| Add Games | **Exists** as the Import tab | `components/import/ImportTab.tsx` |
| Practice vs Computer | **ABSENT** | zero matches for `playVs`/`vsComputer`/`practice` |
| Saved Analysis | **Built but unreachable** | `pages/SessionsPage.tsx` is not routed (§3.1) |
| Share Game | **ABSENT** | no `navigator.share`, no share-URL builder; only `clipboard.writeText(currentFen)` at `BoardControls.tsx:46` |

### 1.4 Other reference features

- **Move sounds** — absent (§1.1).
- **Share URL** — absent. Note `/game/:id` already exists (`App.tsx:76-83`), so a share link is cheap to add.
- **Threat arrows** — absent.
- **Play vs computer** — absent, although the machinery is present: `engineSettings.skillLevel` (`EngineControls.tsx:179-187`) and `limitStrength`/`uciElo` in `EngineOptions`.

---

## 2. Where settings controls currently live

Preferences are spread across **five** surfaces with no single entry point. Every component that owns a persisted preference:

| Component | Preferences it owns | Store / persist key |
|---|---|---|
| `components/board/BoardToolsPanel.tsx:42` | `showCoordinates`, `disclosureButtons`, `moveAnnotations`, `variationOpacity`, `computerAnalysis`, `bestMoveArrow`, `evaluationGauge`, `undefendedPieces`, `pinnedPieces`, `checkableKing` — 10 of the 17 persisted UI prefs | `uiStore` / `grandforge-ui` |
| `components/board/ThemePickerRow.tsx:6` | `boardTheme`, `pieceSet` | `uiStore` / `grandforge-ui` |
| `components/layout/Header.tsx:94` (`ThemeToggleButton`) | `theme` (light/dark) | `uiStore` / `grandforge-ui` |
| `components/layout/Header.tsx:9` (inline `EngineVersionSelector`) | `engineVersion` | `engineStore` / `grandforge-engine` |
| `components/engine/EngineVersionSelector.tsx:16` | `engineVersion` — **duplicate of the above** | `engineStore` / `grandforge-engine` |
| `components/engine/EngineControls.tsx:13` | `multiPV`, `engineSettings` (`threads`, `hash`, `skillLevel`, `useNNUE`), and `isEnabled` ↔ `computerAnalysis` mirroring | `engineStore` / `grandforge-engine` |
| `components/layout/SidePanel.tsx:16` | `activeTab` (persisted) | `uiStore` / `grandforge-ui` |
| `components/board/ResizableBoardWrapper.tsx:7` | `boardSize` — runtime only, deliberately **not** persisted (`uiStore.ts:154-173`) | `uiStore` |

Persisted prefs owned by **no** component: `showLegalMoves`, `inlineNotation`, `pieceManeuverArrows` (see §3.3), and `orientation` (mutated only via `flipBoard`).

**Cross-store mirroring risk:** `computerAnalysis` is written from two directions — `uiStore.ts:138-142` (`setComputerAnalysis` → `engineStore.setEnabled`) and `EngineControls.tsx:25-28` (`setEnabled` → `uiStore.setComputerAnalysis`). The cycle is broken only by equality short-circuits at `uiStore.ts:139` and `engineStore.ts:401`. A third writer to either flag desynchronises the pair.

---

## 3. Concrete UI bugs, mislabels, and dead controls

Ordered by user impact.

### 3.1 `SessionsPage` and `AuthPage` are built but unroutable; the one internal link 404s

`App.tsx:59-88` registers `/`, `/game/:id`, `/privacy`, `/learn/chess-accuracy`, `/learn/move-classifications`, and `*`. Neither `pages/SessionsPage.tsx` (268 lines) nor `pages/AuthPage.tsx` (189 lines) is imported or routed anywhere. And `SessionsPage` links to a route that does not exist:

```
frontend/src/pages/SessionsPage.tsx:153     <Link to="/login">
```

`/login` falls through to the `*` catch-all (`App.tsx:87`) → `NotFoundPage`. The whole accounts + saved-analysis feature set is unreachable dead code. This is also why `ui/Modal.tsx` — the only focus-trapping dialog in the codebase — never renders in the shipped app.

### 3.2 Tablet layout (641–1024px): the side panel collapses into a 32px column

`AnalyzerLayout.tsx:20-33` renders three grid children: `.eval-bar-vertical-wrap.eval-bar-slot`, `.board-slot`, `.side-panel-slot`. At tablet width the grid drops to two columns and the fix-up rule targets `.side-panel`:

```
frontend/src/styles/global.css:735-748
  @media (max-width: 1024px) {
    .analyzer-layout { grid-template-columns: 32px 1fr; ... }
    .side-panel { grid-column: 1 / -1; max-height: none; min-height: 360px; }
  }
```

`.side-panel` is **not** a grid child — it is a `div` *inside* `SidePanel` (`components/layout/SidePanel.tsx:47`). The real grid child is `.side-panel-slot` (`AnalyzerLayout.tsx:30`), and **`.side-panel-slot`, `.board-slot`, and `.eval-bar-slot` have no CSS rules anywhere in `frontend/src/styles/**`** (verified by grep across all five stylesheets). `grid-column: 1 / -1` on a non-grid element is inert, so three auto-placed items in a two-column grid put the side panel at row 2 / column 1 — the **32px** column. The entire Analysis/Moves/Review/Import panel is squeezed to 32px at every tablet width.

The same broken rule is **duplicated** at `global.css:188-196`, so patching one copy will not fix it.

### 3.3 Three persisted preferences are orphaned

| Pref | Declared | Setter | Consumers |
|---|---|---|---|
| `showLegalMoves` | `uiStore.ts:14`, persisted at `:160` | **none** — no `setShowLegalMoves` in the `UIState` interface at all | **zero** |
| `inlineNotation` | `uiStore.ts:21`, persisted at `:71` | `setInlineNotation` (`uiStore.ts:133`) | **zero** |
| `pieceManeuverArrows` | `uiStore.ts:29`, persisted at `:77` | `setPieceManeuverArrows` (`uiStore.ts:144`) | **zero** |

All three are written to `localStorage` under `grandforge-ui` on every state change and read back on hydrate, and none of them affects a single pixel. `showLegalMoves` defaults to `true` (`uiStore.ts:92`) and is carried through `migrate` (`:174-188`) — a user reasonably expects a "show legal moves" setting to exist; legal-move dots are in fact rendered unconditionally by `BoardMarkerOverlay`.

### 3.4 Duplicated, conflicting responsive blocks in `global.css`

`.analyzer-layout` has two `max-width: 1024px` blocks (`global.css:188` and `:735`) and two `max-width: 640px` blocks (`global.css:198` and `:751`). Equal specificity means the later pair wins and the earlier pair is dead — and they disagree: the first 640px block hides `.eval-bar-vertical` (`global.css:204`), the second hides `.eval-bar-vertical-wrap` with `!important` (`global.css:758`). Only the latter class exists in the JSX (`AnalyzerLayout.tsx:24`), so `global.css:204-206` is dead code targeting a class that is never rendered.

### 3.5 Double eval bar between 641px and 767px

`AnalyzerPage.tsx:121` gates the horizontal eval bar with Tailwind `md:hidden` — visible below **768px**. The vertical bar is hidden by CSS only below **641px** (`global.css:751-760`). In the 641–767px band both render at once: `EvalBarHorizontal` (`AnalyzerPage.tsx:122`) plus the vertical `EvaluationBar` (`AnalyzerPage.tsx:112-118`). Two eval bars for one position, in exactly the band where §3.2 has already crushed the side panel.

### 3.6 "Disclosure buttons" does not control disclosure buttons — it deletes variations

`BoardToolsPanel.tsx:173-177` labels the pref "Disclosure buttons". Its only consumers:

```
frontend/src/components/navigation/MoveList.tsx:133   {disclosureButtons && pair.whiteVariations.length > 0 && (
frontend/src/components/navigation/MoveList.tsx:158   {disclosureButtons && pair.blackVariations.length > 0 && (
```

`MoveList.tsx` contains no disclosure/expander buttons — variations render permanently expanded (`:134-146`). Switching the toggle off removes every variation from the move list, with no affordance that hidden lines exist. The label promises the opposite of what the control does.

### 3.7 Live-analysis depth is unreachable — permanently frozen at 18

`engineStore.ts:377-386` implements `setDepth` with clamping (1–30) and auto-restart. It has **zero callers** in `components/**` or `pages/**`. Live search depth is whatever `engineStore.ts:153` (`depth: 18`) or a stale persisted value says, forever. The depth chips at `ReviewTab.tsx:288-305` write local React state (`selectedDepth`) consumed only by the review batch — they never touch `engineStore.depth`. Both reference UIs expose live depth; this is the largest single missing engine control.

### 3.8 Two store setters silently discard their arguments

```
frontend/src/store/engineStore.ts:438-441
  setMoveTime: (ms) => { void ms; set({ moveTimeMs: null, infiniteMode: true }); },
frontend/src/store/engineStore.ts:443-451
  setInfiniteMode: (on) => { void on; set({ infiniteMode: true, moveTimeMs: null }); ... },
```

Both are typed as taking a value (`setMoveTime: (ms: number | null) => void` at `engineStore.ts:67`; `setInfiniteMode: (on: boolean) => void` at `:68`) but hard-code the outcome. Any "max time" or "infinite analysis" control wired to these renders as a live toggle that cannot change state, and TypeScript will not catch it. This also contradicts CLAUDE.md, which documents an "Infinite analysis toggle … in `EngineControls`" that was never built.

### 3.9 The engine status box is mislabelled by its own icon

`EngineControls.tsx:46-83` carries `data-testid="infinite-status"` and an `InfinityIcon` (`:51`), but renders only `"Searching"`/`"Idle"` plus depth (`:53-55`). Nothing explains infinite mode and there is no control to leave it, so the user sees an infinity symbol and a depth counter that climbs without bound and no way to cap it (§3.7 removed the depth control too).

### 3.10 Side-panel tabs are silently inert during review playback

`SidePanel.tsx:41-44`:

```
const handleChange = (id: string) => {
  if (isReviewMode && id !== 'review') return;
  setActiveTab(id as TabId);
};
```

Analysis / Moves / Import keep full enabled styling (`ui/Tabs.tsx:54-60`) and stay focusable and clickable; clicking does nothing — no cursor change, no tooltip, no explanation. `TabItem.disabled` already exists (`ui/Tabs.tsx:9`) and is styled (`:54` `disabled:opacity-50 disabled:cursor-not-allowed`) but is never set anywhere in the app. Three dead controls that look live.

### 3.11 "Click to explore opening tree" — no tree, and the results are not clickable

`OpeningBadge.tsx:45` sets `title="Click to explore opening tree"`. The click handler (`:24-37`) runs a **name search** against `openingsApi.search({ q: openingName })` and renders the hits as plain `<div>`s:

```
frontend/src/components/navigation/OpeningBadge.tsx:85-95
  <div key={...} className="flex items-center gap-2 ...">
    <span>{r.ecoCode}</span><span>{r.name}</span>
  </div>
```

Two defects in one control: the tooltip promises an opening tree that does not exist anywhere in the app (§1.2), and the dropdown looks like a menu but every row is inert — there is no `onClick`, no `<button>`, no keyboard reachability. A user who opens it can only close it again.

### 3.12 Review always analyses the mainline, even while viewing a variation

`ReviewTab.tsx:92`, `:180`, and `:344` all call:

```
buildIndexedGameFromTree(moveTree, getMainlinePath(moveTree).at(-1))
```

`buildIndexedGameFromTree` accepts an arbitrary leaf id, and the entire `reviewedNodeIds` pinning system exists to support variation review, but the UI never passes `currentNodeId`. A user who navigates into a variation and presses "Run Review" silently gets a mainline review, with nothing indicating their line was ignored.

### 3.13 "Run Review" can be disabled with no reason shown

`ReviewTab.tsx:394` disables on `!gameLoaded || !manager || isStarting`. The explanatory hints (`:401-406`) both require `!gameLoaded`:

```
{!gameLoaded && moveCount === 0 && (<p>Play at least one move to review</p>)}
{!gameLoaded && moveCount > 0 && !manager && (<p>Waiting for engine to load…</p>)}
```

When moves exist but the engine is still loading, `gameLoaded` is `true`, so neither hint renders — `:407-412` shows the ply count while the button sits disabled and unexplained. The second hint is also close to unreachable, since `moveCount > 0` implies a non-null game with `plyCount > 0`, i.e. `gameLoaded === true`.

### 3.14 Board tools is a 10-toggle settings surface with none of a dialog's affordances

`BoardToolsPanel.tsx:85-99` attaches a bare `document` `mousedown` listener to close itself. It has no `role="dialog"`, no `aria-modal`, no focus trap, and **no Escape handler** — so keyboard users cannot dismiss it. Contrast `ui/Modal.tsx:49-94`, which implements Escape, a Tab cycle, focus restore, and scroll lock correctly, and is unused (§3.1).

### 3.15 Two disagreeing classification palettes; a third copy hard-coded

- TypeScript palette: `ReviewSummaryCard.tsx:10-22` sets `excellent: '#a3d35f'`, with an explicit comment (`:15-16`) that it must not collide with `best: '#96bc4b'`.
- CSS palette: `tokens.css:17-18` sets `--best: #96bc4b` and `--excellent: #96bc4b` — **byte-identical**.

Board annotation rings read the CSS vars (`board-themes.css:51-52`), so on the board Best and Excellent are indistinguishable while the summary table shows them as different colours. `EvalGraph.tsx:16-22` hard-codes a **third** copy of five of these colours under the comment "Same palette as ReviewSummaryCard" — it matches today, but three sources of truth will drift.

### 3.16 Four UI primitives are entirely unused; two switch styles ship

Zero importers anywhere in `frontend/src/**` (checked across relative, `@/` alias, and default-import forms):

- `components/ui/Select.tsx` (84 lines)
- `components/ui/Badge.tsx`
- `components/ui/Tooltip.tsx` (173 lines)
- `components/ui/Spinner.tsx`

`components/ui/Modal.tsx` has one importer, in the unroutable `SessionsPage`. `components/ui/Toggle.tsx` has one importer (`EngineControls.tsx:3`) — while `BoardToolsPanel.tsx:15-36` defines its **own** local `Toggle`, so the app ships two visually distinct switch components for the same job.

### 3.17 The eval graph does not follow the theme

`review.css:776-820` hard-codes every colour: `background: #262421` (`:780`), `.eval-graph-bg { fill: #3b3936 }` (`:793`), `.eval-graph-area { fill: #e8e6e3 }` (`:796`), `.eval-graph-hover { stroke: rgba(255,255,255,0.35) }` (`:810`). None reference a token, so in light theme (`tokens.css:42-64`) the graph stays a dark slab with a near-invisible hover cursor.

### 3.18 Dead and undefined CSS

- `.board-coord` (`board-themes.css:77-83`) has no consumer in any `.tsx` — coordinates come from react-chessboard's `showBoardNotation` (`ChessBoardWrapper.tsx:337`). It also hard-codes `rgba(255,255,255,0.5)`, which would be invisible in light theme if it were live.
- `--border-subtle` and `--accent` are referenced with fallbacks at `review.css:779`, `:790`, `:849` and `global.css:869` but are **never defined** in `tokens.css`. Every use silently takes the fallback, so the tokens are decorative.

### 3.19 `BoardControls.onOpenBoardTools` is a dead prop

Declared at `BoardControls.tsx:8-11` and branched on at `:62-68`, but the sole call site renders `<BoardControls />` with no props (`AnalyzerPage.tsx:145`). Dead API surface.

---
