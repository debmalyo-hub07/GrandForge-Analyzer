# GrandForge — Build / Performance / SEO Audit

**Date:** 2026-07-28
**Scope:** build config, bundle output, first-visit byte cost, Vercel Hobby risk, SEO/meta, React runtime perf.
**Method:** `npx vite build` run directly from the repo root (bypasses the known-failing `tsc` step), plus static reading of config and source.

Every claim below is tagged **MEASURED** (observed from a real build or file on disk) or **INFERRED** (read from source, not executed).

---

## 0. Build status

`npx vite build` **succeeds** (exit 0, 16.42 s, 2090 modules). Full output:

```
../dist/index.html                          6.46 kB │ gzip:   2.09 kB
../dist/assets/index-DrWJ5GxS.css          35.68 kB │ gzip:   7.64 kB
../dist/assets/vendor-motion-2fwX9zIa.js  129.33 kB │ gzip:  43.79 kB
../dist/assets/vendor-chess-DxZ-5V69.js   137.83 kB │ gzip:  40.49 kB
../dist/assets/vendor-react-INjEsOKo.js   345.09 kB │ gzip: 107.58 kB
../dist/assets/index-CR_D7YRL.js          417.91 kB │ gzip: 109.86 kB
✓ built in 16.42s
```

The build also emitted one warning, which turned out to be the highest-impact finding in this audit:

```
warn - No utility classes were detected in your source files. If this is unexpected,
       double-check the `content` option in your Tailwind CSS configuration.
```

The `tsc` failure described in the task brief (5× `TS2741 'forced' is missing`) is confirmed out of scope and is not counted as a finding.

---

## P0 — Tailwind emits zero utility classes in production (layout regression)

**MEASURED. This is a live production bug introduced by the most recent commit, not a theoretical perf nit.**

`tailwind.config.ts:4` declares:

```ts
content: ['./index.html', './src/**/*.{ts,tsx,html}'],
```

These globs resolve against the repo root, where `index.html` and `src/` no longer exist. Commit `dda9c75` ("refactor: split repo into frontend/ and backend/ folders") moved them to `frontend/index.html` and `frontend/src/`, but `tailwind.config.ts` was never updated — `git log -- tailwind.config.ts` shows its only commit is `f28363a`, the original v4.0 commit, and `git ls-tree dda9c75^` confirms `index.html` and `src` *were* at the root before the split.

Consequence: Tailwind scans nothing, so `@tailwind base/components/utilities` in `frontend/src/styles/global.css:4-6` expand to nothing. Verified against the built CSS — every probe returns zero occurrences:

| probe | occurrences in `dist/assets/index-DrWJ5GxS.css` |
|---|---|
| `flex{display:flex` | 0 |
| `items-center` | 0 |
| `justify-between` | 0 |
| `text-sm` | 0 |
| `w-full` | 0 |
| `rounded-lg` | 0 |
| `gap-2` | 0 |
| Preflight (`*,::before,::after{box-sizing:border-box`) | 0 |

The 35.68 kB of shipped CSS is entirely hand-written (`tokens.css`, `global.css`, `board-themes.css`, `board.css`, `review.css`) — no Tailwind output at all.

Meanwhile **30 of 59 `.tsx` files depend on those utilities.** The layout primitives are the worst-hit, e.g. `frontend/src/components/layout/AnalyzerLayout.tsx:22-30`:

```tsx
className="analyzer-layout grid items-start gap-4 px-4 sm:px-6 py-4 max-w-[1200px] mx-auto"
className="eval-bar-vertical-wrap eval-bar-slot flex flex-col items-stretch h-full min-h-[400px]"
className="board-slot flex flex-col gap-2"
```

and `frontend/src/components/ui/Button.tsx:60`, whose spinner is pure Tailwind (`inline-block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin`) and therefore renders as an unstyled, unsized, unanimated `<span>`.

Some breakage is masked because most components pair a Tailwind utility string with a hand-written semantic class (`analyzer-layout`, `board-slot`, `.gf-*`) that carries the real grid/flex rules from `global.css`. So the page is not blank — but every utility-only rule (spacing, sizing, the `sm:` responsive variants, `animate-spin`, `shrink-0`, arbitrary values like `max-w-[1200px]` and `min-h-[400px]`) is silently absent.

Losing Preflight is the *least* of it: `frontend/src/styles/global.css:9-13` ships its own `box-sizing: border-box` reset and base `html/body/#root` rules, so the reset survives.

**Fix (one line).** Point the globs at the new location:

```ts
content: ['./frontend/index.html', './frontend/src/**/*.{ts,tsx,html}'],
```

Safer still, make them independent of the invoking cwd — Tailwind v3 supports config-relative globs:

```ts
content: { relative: true, files: ['./index.html', './src/**/*.{ts,tsx,html}'] },
```
…but note `relative: true` resolves against the *config file's* directory (repo root), so with the config staying at the root the explicit `./frontend/...` form is the simpler correct answer.

**Expect the CSS bundle to grow** once this is fixed (Preflight plus the real utilities — order of +10–15 kB raw / +3–5 kB gzip). That is the cost of the layout actually working. Re-run the build after fixing and re-check the visual result, because some hand-written CSS may have been tuned against the *broken* rendering.

**Verification after fix:** the `No utility classes were detected` warning must disappear, and `grep -c "items-center" dist/assets/*.css` must be non-zero.

---

## 1. Bundle numbers

### 1.1 Totals — MEASURED

| | raw | gzip |
|---|---:|---:|
| JS (4 chunks) | **1,030.16 kB** | **301.72 kB** |
| CSS (1 file) | 35.68 kB | 7.64 kB |
| HTML | 6.46 kB | 2.09 kB |
| **Total app shell** | **1,072.30 kB** | **311.45 kB** |

Vercel serves Brotli where the client supports it, so real transfer will be roughly 10–20 % below the gzip column. Treat gzip as an upper bound.

### 1.2 Code-splitting: there is none — MEASURED

The only splitting is the three `manualChunks` vendor buckets in `vite.config.ts:32-36`. Beyond that the app is **one monolithic 417.91 kB entry chunk**.

Evidence:

- `grep -c "import(" dist/assets/index-CR_D7YRL.js` → **0** dynamic imports in the built entry.
- `grep -rn "lazy(\|Suspense" frontend/src --include=*.tsx` → **no matches**. `React.lazy` is not used anywhere.
- The only `import(` occurrences in source are `frontend/src/main.tsx:34` (`./devHooks`, correctly stripped from prod by the `MODE === 'development'` gate) and a **type-only** `import('chess.js').Square` in `frontend/src/components/board/ChessBoardWrapper.tsx:17`, which produces no runtime chunk.

Vite emitted exactly 4 JS files, confirming no route- or feature-level splits exist.

### 1.3 What is eagerly loaded that should not be — MEASURED (import graph) / INFERRED (per-feature byte split)

`frontend/src/App.tsx:3-7` statically imports all five page components, and `frontend/src/pages/AnalyzerPage.tsx:1-30` statically imports **every** feature panel. So a visitor landing on `/privacy` still downloads the board, the engine wrapper, the review pipeline, and the import flow; and a visitor on `/` who never opens the Review or Import tab downloads both in full.

Eagerly bundled but not needed for first paint of the board:

| Feature | Entry point | Why it can wait |
|---|---|---|
| Review UI + pipeline | `ReviewTab`, `GameReviewService`, `reviewUtils`, `EvalGraph`, `ReviewSummaryCard`, `ReviewMoveList/Panel/Glyph` | Only reachable via the Review tab |
| Blunder-puzzle trainer | `BlunderPuzzleTrainer`, `blunderPuzzles` | Reachable only from a *completed* review — two clicks deep |
| Import flow | `ImportTab`, `UsernameImport`, `ImportedGameCard`, `pgn-parser` | Only reachable via the Import tab |
| Board editor | `BoardEditor`, `BoardToolsPanel` | Behind the `boardToolsOpen` toggle |
| Static content pages | `PrivacyPage`, `LearnAccuracyPage`, `LearnClassificationsPage`, `StaticPage` | Never rendered on `/` |

Two vendor chunks are also loaded unconditionally on every route:

- **`vendor-motion` (129.33 kB raw / 43.79 kB gzip)** — `framer-motion`. It is in `manualChunks`, so it is a separate file, but it is still a static import from the entry graph and therefore fetched on `/privacy` too.
- **`vendor-chess` (137.83 kB raw / 40.49 kB gzip)** — `chess.js` + `react-chessboard`. Genuinely needed on `/` and `/game/:id`; pure waste on the three content routes.

**Cheapest high-value change:** route-level `React.lazy` + `Suspense` in `App.tsx`, plus lazy tabs for Review and Import. Splitting the three content pages alone means `/privacy` stops paying for `vendor-chess` and the board subtree. Splitting Review + Import out of `AnalyzerPage` should move a meaningful slice of the 417.91 kB entry into on-demand chunks. I have **not** measured the exact per-feature split — that requires the refactor plus `rollup-plugin-visualizer`; treat the size attribution as INFERRED.

Note the ordering dependency: do the **P0 Tailwind fix first**, because lazy-loading changes which files exist but the Tailwind `content` glob must cover them either way.

---

## 2. First-visit byte cost for a board-only visitor

### 2.1 The engine loads unconditionally on mount — MEASURED

`frontend/src/pages/AnalyzerPage.tsx:38` calls `useStockfish({ defaultEngine: 'sf18-lite' })` with no gating, and `frontend/src/hooks/useStockfish.ts:17-21` fires `initEngine(defaultEngine)` from a bare `useEffect` on mount. There is no "start engine on first interaction" path.

So **every** load of `/` or `/game/:id` downloads and instantiates the Stockfish WASM engine, even for a user who only wants to look at the board.

### 2.2 Cold-cache first visit to `/` — MEASURED

| Asset | raw | transfer (gzip -6) |
|---|---:|---:|
| `index.html` | 6.46 kB | 2.09 kB |
| `index-*.css` | 35.68 kB | 7.64 kB |
| 4 JS chunks | 1,030.16 kB | 301.72 kB |
| `stockfish-18-lite-single.js` | 20.67 kB | ~6 kB |
| **`stockfish-18-lite-single.wasm`** | **7,295.41 kB** | **5,636.00 kB** |
| `favicon.svg` + `manifest.json` | ~0.7 kB | ~0.7 kB |
| Piece SVGs (one theme of 7) | ~40 kB of a 284 kB dir | ~40 kB |
| **Subtotal (first-party)** | **~8,429 kB** | **~5,994 kB** |

Plus third-party, not counted against Vercel bandwidth but counted against the user's time-to-interactive: Google Fonts CSS + font files for **three** families / seven weights (`Cinzel` 400,600 · `Inter` 400,500,600 · `JetBrains Mono` 400,500 — `frontend/index.html:74-77`), `gtag.js` (~100 kB), and `@vercel/analytics`.

**The headline: ~6 MB transferred on a cold first visit, and 94 % of it is one WASM file the user may never use.** The app shell itself (311 kB gzip) is reasonable; the engine dwarfs it by 18×.

`og-image.png` (187.72 kB) is referenced only from `og:image`/`twitter:image` meta, so real browsers do not fetch it on page view — only crawlers and social unfurlers do. It is not part of the first-visit cost.

### 2.3 Is the 40 MB NNUE ever pulled for users who never pick sf16? — MEASURED: **No.**

I resolved this by grepping the WASM binaries directly for their embedded net filename:

| binary | on-disk size | embedded net reference | net present in `public/stockfish/`? |
|---|---:|---|---|
| `stockfish-16-lite-single.wasm` | 575 kB | `nn-5af11540bbfe.nnue` | **yes — the 40,119,326-byte file** |
| `stockfish-17.1-lite-single.wasm` | 7,280 kB | `nn-9067e33176e8.nnue` | no |
| `stockfish-18-lite-single.wasm` | 7,295 kB | `nn-9067e33176e8.nnue` | no |
| `stockfish-18-lite.wasm` | 7,093 kB | `nn-9067e33176e8.nnue` | no |

The pattern is unambiguous: sf17.1 and sf18 are ~7 MB because the net is **baked into the WASM**; their `nn-9067e33176e8.nnue` string is a default option value with no matching file to fetch (and no 404 risk, since nothing requests it). sf16-lite is only 575 kB precisely because its net is **external**, and that external net — `nn-5af11540bbfe.nnue` — is the 40 MB file. `scripts/copyStockfish.mjs` confirms this in its own comment: *"sf16 NNUE network (fetched at runtime by the sf16 engine)"*.

Since the default engine is `sf18-lite` (`frontend/src/store/engineStore.ts:152`) and `useStockfish` hard-codes `'sf18-lite'` at the call site, **the 40 MB net is fetched only after a user explicitly selects "Stockfish 16" in the engine picker.** Good news for the common path.

### 2.4 Side finding: the persisted engine choice is silently discarded — MEASURED

`engineVersion` is deliberately persisted to `localStorage` (`partialize` at `frontend/src/store/engineStore.ts:471-472`), and `initEngine` is written to honour it: `const requested = version ?? get().engineVersion;` (line 177). But the only caller, `frontend/src/hooks/useStockfish.ts:21`, always passes an explicit `'sf18-lite'`, so `version` is never `undefined` and the persisted value is never consulted. Line 282 then writes `engineVersion: target` back into the store, overwriting the user's saved preference with `sf18-lite`.

Net effect: a user who selects Stockfish 16 or the multi-threaded build gets reset to `sf18-lite` on every reload, and persisting `engineVersion` accomplishes nothing.

This is a correctness/UX bug rather than a perf one, and it is **load-bearing for bandwidth in the good direction** — it is the reason a returning sf16 user does not re-pull 40 MB on boot. If someone "fixes" the persistence by dropping the explicit argument (`useStockfish()`), the 40 MB net becomes an automatic boot-time download for those users. Fix the preference properly (honour the persisted value) only together with the lazy-engine work in §3, and never in isolation.

---

## 3. Vercel Hobby risk

### 3.1 Deployment size — MEASURED

`dist/` after a clean build is **62 MB**, of which **60 MB is `dist/stockfish/`**. The app's own code is ~1.1 MB. Breakdown of what ships:

| artifact | size | origin |
|---|---:|---|
| `nn-5af11540bbfe.nnue` | 40.12 MB | committed to git |
| `stockfish-18-lite-single.wasm` | 7.30 MB | copied from `node_modules` at prebuild |
| `stockfish-17.1-lite-single.wasm` | 7.28 MB | committed to git |
| `stockfish-18-lite.wasm` (MT) | 7.09 MB | copied from `node_modules` at prebuild |
| `stockfish-16-lite-single.wasm` | 0.58 MB | committed to git |
| engine `.js` glue (4 files) | 0.10 MB | mixed |
| `og-image.png` | 0.19 MB | committed |
| piece SVGs (7 themes) | 0.28 MB | committed |
| app JS + CSS + HTML | 1.07 MB | build output |

`git ls-files` confirms 47.9 MB of engine binaries are committed to the repository (the sf18 pair is gitignored and regenerated at build time — see `.gitignore:16-21`). `.git` is 44 MB. There is no `.vercelignore`.

I have **not** verified `dist/` against Vercel's current documented deployment-size ceiling — treat "62 MB fits" as INFERRED. It is worth confirming, because 60 MB of that is engine artifacts serving a feature most users never touch.

### 3.2 Bandwidth exposure — MEASURED inputs, arithmetic conclusion

Hobby includes 100 GB/month of data transfer. Against the §2.2 measurement:

| scenario | transfer per cold visit | visits to exhaust 100 GB |
|---|---:|---:|
| Board-only / default sf18 | ~6.0 MB | **~16,600** |
| User switches to **sf16** | ~40 MB (6.0 + 34.1 NNUE) | **~2,500** |
| User switches to sf17.1 or sf18-MT | ~11.6 MB | ~8,600 |

**The 40 MB NNUE is the dominant bandwidth risk by a wide margin.** Roughly 2,500 users clicking "Stockfish 16" once would consume the entire monthly allowance. It is offered in the engine picker as *"Classic NNUE engine for comparison"* — a nice-to-have that costs 6.7× more bandwidth than the entire rest of a visit.

One compression caveat, **INFERRED**: `.nnue` has no standard MIME type and will be served as `application/octet-stream`. Vercel applies Brotli/gzip based on content type, and octet-stream is not always in that set. If it is not compressed, the transfer is the full **40.12 MB**, not the 34.08 MB gzip figure I measured locally. Verify with:

```bash
curl -sI -H 'Accept-Encoding: br,gzip' https://<domain>/stockfish/nn-5af11540bbfe.nnue | grep -i 'content-encoding\|content-length'
```

### 3.3 Cache headers — what exists, what's missing

**Already correct (MEASURED, `vercel.json:30-35`):**

```json
{ "source": "/stockfish/(.*)", "headers": [
  { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]}
```

This is the single most valuable mitigation already in place — a returning visitor re-pays nothing for the engine. Repeat visits cost only the app shell. Keep it.

**Missing (INFERRED — cheap, safe win):** there is no `Cache-Control` for `/assets/(.*)`. Vite content-hashes every filename in `dist/assets/`, so those files are immutable by construction and can safely carry a one-year immutable header. Without an explicit rule they fall back to Vercel's default static policy, which revalidates. Add:

```json
{ "source": "/assets/(.*)", "headers": [
  { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]}
```

Leave `index.html` on the default revalidating policy — it must not be cached immutably, or deploys will not roll out.

**Worth verifying (INFERRED):** `vercel.json` has three overlapping `headers` blocks; `/stockfish/foo.wasm` matches all three. Vercel merges headers across all matching sources, so the `.wasm` rule's `Content-Type` should coexist with the `Cache-Control` from the broader `/stockfish/(.*)` rule. Confirm with a `curl -I` against a deployed `.wasm` that **both** headers are present — if the narrower rule shadows rather than merges, the WASM files silently lose their year-long cache, which would multiply engine bandwidth by the repeat-visit rate.

### 3.4 Cheapest mitigations, in order of bytes saved

1. **Drop `sf16-lite` from the engine picker** — removes 40.7 MB from the deployment (66 % of `dist/`) and eliminates the entire NNUE bandwidth risk. Requires deleting the `ENGINE_CONFIGS` entry, the `EngineVersion` union member, the `REQUIRED_REAL` guard entries in `scripts/copyStockfish.mjs`, and the two committed files. Note `initEngine` already has a fallback for removed engine ids (`frontend/src/store/engineStore.ts:181`), so stale persisted values degrade gracefully — the removal path is already paved.
2. **If sf16 must stay:** host `nn-5af11540bbfe.nnue` on a free external CDN and add that origin to the CSP `connect-src`, or gate selection behind an explicit "this downloads 40 MB" confirmation. Either keeps the deploy small; the CDN option also moves the bandwidth off Hobby.
3. **Lazy engine init** (§2.1) — do not fetch the 7.3 MB WASM until the user makes a move, opens the Analysis tab, or hits Review. Saves ~5.6 MB per bounced visit, which on a content-page-driven SEO strategy is most visits.
4. **`/assets/(.*)` immutable caching** — §3.3, one JSON block.
5. **Route-level code splitting** (§1.3) — a few hundred kB per content-page visit.

---

## 4. SEO and meta

### 4.1 What is already good — MEASURED

`frontend/index.html` is genuinely well-built for the homepage: a descriptive `<title>`, a real meta description, canonical, full Open Graph set with correctly-sized `og:image` (2400×1260, and the file exists at 187.72 kB), Twitter `summary_large_image`, `WebApplication` + `FAQPage` JSON-LD, font preconnects, and a **substantive `<noscript>` block** (`index.html:91-100`) with an `<h1>` and a real paragraph rather than the usual "please enable JavaScript". `robots.txt` allows everything and points at the sitemap. `sitemap.xml` lists exactly the four real public routes — `/`, `/learn/chess-accuracy`, `/learn/move-classifications`, `/privacy` — and correctly omits `/game/:id`. Domain references are internally consistent across `index.html`, `sitemap.xml`, and `robots.txt`.

### 4.2 P1 — every content page declares the homepage as its canonical — MEASURED

This is the most damaging SEO issue and it silently defeats the entire content-page strategy.

The app ships **one** static `index.html`, and `vercel.json:14-16` rewrites every non-`/api/` path to it. So `/learn/chess-accuracy`, `/learn/move-classifications`, and `/privacy` are all served with the homepage's `<head>` verbatim — including:

```html
<link rel="canonical" href="https://grand-forge-analyzer.vercel.app/" />
<meta property="og:url" content="https://grand-forge-analyzer.vercel.app/" />
```

A canonical pointing at `/` is an explicit instruction to search engines: *"this URL is a duplicate of the homepage; index the homepage instead."* Google generally honours it. The two `/learn/*` pages exist specifically as SEO entry points (they are in the sitemap and linked from the footer), so the sitemap is asking Google to crawl pages whose own markup asks to be de-indexed. The sitemap and the canonical are giving contradictory instructions, and the canonical usually wins.

The only per-route head management that exists is `document.title` in `frontend/src/pages/StaticPage.tsx:14-16`. There is no `react-helmet`, no per-route description, canonical, or `og:*` updates — `grep -rn "Helmet\|canonical\|meta name" frontend/src` returns nothing but that one `document.title` line and two unrelated code comments.

Consequences beyond the canonical:

- **Descriptions are wrong.** `/privacy` is served with the meta description "Free online chess game review and analysis powered by Stockfish 18… no signup, unlimited reviews." So is every `/learn/*` page. If Google does index them, the snippets describe the wrong page.
- **Social unfurls are wrong.** Sharing a `/learn/*` link renders the homepage title, description, and image, because `og:title`/`og:url`/`og:description` never change.
- **`FAQPage` JSON-LD is asserted on `/privacy`.** Structured data claiming a chess-analysis FAQ on a privacy policy is a content mismatch, and mismatched structured data is a documented cause of rich-result penalties.
- **`<noscript>` describes the homepage on every route.** A non-rendering crawler on `/learn/chess-accuracy` sees homepage copy.

**Fix, cheapest first:**

- **Cheapest:** add a tiny per-route head effect to `StaticPage` (it already runs one for `document.title`) that also rewrites `<link rel=canonical>`, `meta[name=description]`, `og:title`, `og:description`, and `og:url`, restoring them on unmount exactly as the title is restored. ~20 lines, no dependency. This fixes the canonical, which is the bit that actually costs indexing.
- **Better:** prerender the three content routes to real static HTML files at build time (`vite-plugin-prerender`, or a small post-build script that renders each route and writes `dist/learn/chess-accuracy/index.html` etc.). Vercel will serve the real file before hitting the catch-all rewrite, so crawlers get correct markup with no JS execution — and the pages get genuinely fast first paint. This is the right long-term answer for pages that exist to be crawled.

### 4.3 Smaller SEO notes — MEASURED

- `sitemap.xml` has no `<lastmod>` on any entry. Harmless but it is free crawl-scheduling signal.
- `sitemap.xml` and `robots.txt` are static files with the production domain hard-coded. If the project ever moves to a custom domain, four places need updating together (`index.html` canonical/`og:url`, `sitemap.xml`, `robots.txt`, and the `vercel.json` CSP). Worth a note in the deploy doc alongside the existing Render-rename checklist.
- Three Google Font families with seven total weights are render-blocking in `<head>` (`index.html:74-77`). `display=swap` is set, so text is not invisible, but this is still two extra DNS/TLS round-trips before first paint. Self-hosting the three families (or dropping to two weights of `Inter` plus `Cinzel` for display) would remove the third-party dependency and the CSP `style-src`/`font-src` allowances that go with it.
- The `<noscript>` block is homepage-specific (see §4.2) but is otherwise better than most SPAs manage.

---

## 5. React runtime risks

### 5.1 What is already done well — MEASURED, do not "fix" these

Three patterns here are deliberate and correct; flag them to future contributors rather than refactoring them:

- **`useArrowLayers` subscribes to a derived string key, not the array.** `frontend/src/hooks/useArrowLayers.ts:144-146` selects `recommendedEngineFirstMovesKey(s.lines, s.currentFen)` — a joined string — so the arrow layer re-renders only when the *recommended moves themselves* change, not on every new `lines` array identity. The key function (lines 111-136) is a filter/sort/map over at most 5 lines with no `chess.js` involvement, so running it on every store update is cheap.
- **`BoardArrowOverlay` and `BoardMarkerOverlay` are `React.memo`-wrapped** (`BoardArrowOverlay.tsx:101`), and arrow geometry is computed in plain functions during render from percentage-space constants. There is **no per-frame work in the board overlays** — no `requestAnimationFrame` loop, no `ResizeObserver`, no scroll/mousemove listener. The overlays are static SVG recomputed only on prop change. This is the right design.
- **Every store consumer uses a narrow field selector** (`useEngineStore((s) => s.nps)` etc.) rather than destructuring the whole store, which is what keeps the next item from being much worse than it is.

Window listeners are few and all correctly scoped with cleanup: `Header.tsx:34` (click-outside), `Modal.tsx:79` (keydown), `useKeyboardNav.ts:86` (keydown), `BoardToolsPanel.tsx:94` (mousedown, deferred one tick to avoid catching the opening click), `useBoardSize.ts:26` (`ResizeObserver`), and one `setInterval` watchdog inside `EngineManager.ts:403`. I found **no leaked listeners** — each has a matching removal in its effect cleanup. The single `requestAnimationFrame` loop (`ReviewMovePanel.tsx:69-71`) is a bounded one-shot animation that self-terminates at `t >= 1`.

### 5.2 P2 — the store is written on every UCI info line, and SAN conversion rides along — MEASURED

`frontend/src/store/engineStore.ts:190-262` handles the engine event stream. Every `info` line that carries `depth`, `nps`, or `hashfull` triggers a `set(updates)`. Stockfish emits these continuously during a search — `currmove`/`currmovenumber`/`nps` lines arrive many times per second, well above frame rate.

Two costs compound:

**(a) Re-render frequency.** Each `set` causes zustand to run every selector in every subscribed component. `EngineStats` subscribes to `currentDepth`, `nps`, and `hashfull` (`components/engine/EngineStats.tsx:6-8`) — `nps` changes on essentially every info line, so `EngineStats` re-renders at info-line rate. `EngineLines` subscribes to `lines` (`components/engine/EngineLines.tsx:9`), and the handler builds a **new array identity every scoring line** (`const lines = get().lines.slice()` at line 239 plus a `.sort()`), so the MultiPV panel re-renders on every scoring line too, mapping over its lines and slicing 7 SAN moves each.

**(b) `chess.js` replay on the main thread.** For every scoring info line, `convertUciToSan(currentFen, info.pv)` (line 212) is called. The `sanCache` at `engineStore.ts:94-136` is keyed on `fen + '|' + uciMoves.join(',')` — but the PV **changes at every depth**, so during an active search the key is new almost every time and the cache **mostly misses**. Each miss constructs a `new Chess(fen)` and replays the entire PV through `chess.move()`, which runs full legal-move generation per ply. At depth 20+ with the default `multiPV: 3`, a single depth transition costs on the order of 3 × 25-40 legal-move generations, synchronously, inside the store write, before React even starts rendering.

The cache is not useless — it absorbs exact repeats and stable PVs — but it is sized and keyed for a workload it does not have during active search.

**(c) It never stops, by default.** `infiniteMode` defaults to `true` (`engineStore.ts:157`). So on a fresh visit the engine runs `go infinite` and keeps deepening — and keeps driving (a) and (b) — for as long as the user leaves the page on a position. There is no idle state. On a low-end laptop or phone this is continuous main-thread work plus continuous re-renders behind an interface the user may just be reading.

**Fixes, cheapest first:**

1. **Throttle the non-scoring metrics.** `currentDepth`/`nps`/`hashfull` are a telemetry readout; nobody needs them at 60+ Hz. Coalesce them behind a ~100-200 ms timer and `set` once per tick. This alone removes most of the re-render pressure at zero risk to correctness.
2. **Skip SAN conversion below the render gate.** The panel does not display lines meaningfully at depth 1-3, and `MIN_RENDER_DEPTH` (4) already exists as the eval-bar gate. Reusing it to skip `convertUciToSan` for very shallow lines removes the noisiest slice of the `chess.js` work.
3. **Convert only the displayed prefix.** `EngineLines.tsx:72` renders `line.sanMoves.slice(0, 7)` — only the first 7 SAN moves are ever shown, but `convertUciToSan` converts the **entire** PV, often 25-40 plies. Passing a length cap (`info.pv.slice(0, 8)`) cuts the per-line `chess.js` cost by roughly 4-5× and is a two-line change with no visible difference. **This is the single best effort-to-payoff fix in this section.**
4. Only if profiling still shows a problem: bail out of the `lines` update when the newly built line is deep-equal to the existing entry, preserving array identity and skipping the `EngineLines` re-render entirely.

I have **not** profiled this in a browser — the frequency and the per-line work are read from source and are certain, but the resulting frame cost is **INFERRED**. Before optimizing, confirm with a React DevTools Profiler recording during a depth-30 infinite search; that also tells you whether (a) or (b) dominates.

### 5.3 Doc drift found while reading the store — MEASURED

`CLAUDE.md` states that the persisted engine keys are "`engineVersion`, `depth`, `multiPV`, `engineSettings`, `moveTimeMs`, `infiniteMode`". The actual `partialize` (`frontend/src/store/engineStore.ts:471-476`) persists only the **first four** — `moveTimeMs` and `infiniteMode` are not persisted. Combined with §2.4 (the persisted `engineVersion` being overwritten at boot), three of the six documented persisted settings do not behave as documented. Worth a CLAUDE.md correction independent of any code change.

---

## 6. Prioritized fix list — cheapest first

Ordered by (impact ÷ effort). Items 1-4 are all small, contained edits.

| # | Fix | Effort | Payoff | Section |
|---|---|---|---|---|
| 1 | **Repoint Tailwind `content` to `./frontend/...`** | 1 line | Restores all utility CSS across 30 components — currently a live layout regression | P0 |
| 2 | **Per-route canonical + description + `og:*` in `StaticPage`** | ~20 lines, no dep | Stops the three content pages from telling Google they are duplicates of `/` | §4.2 |
| 3 | **Cap `convertUciToSan` to the displayed PV prefix** (`info.pv.slice(0, 8)`) | 2 lines | ~4-5× less main-thread `chess.js` work per info line, zero visual change | §5.2 |
| 4 | **Add `/assets/(.*)` immutable `Cache-Control`** | 1 JSON block | Repeat-visit shell transfer → 0; Vite already hashes the filenames | §3.3 |
| 5 | **Throttle `nps`/`depth`/`hashfull` store writes to ~150 ms** | ~10 lines | Removes the bulk of re-render pressure during infinite analysis | §5.2 |
| 6 | **Verify `.wasm` keeps its `Cache-Control` under overlapping header rules** | 1 `curl -I` | Guards against silently re-serving 7 MB per repeat visit | §3.3 |
| 7 | **Route-level `React.lazy` for the three content pages** | ~15 lines | `/privacy` and `/learn/*` stop downloading `vendor-chess` and the board subtree | §1.3 |
| 8 | **Lazy-init the engine** (on first move / Analysis tab / Review) | moderate | Saves ~5.6 MB on every bounced visit — the dominant first-visit cost | §2.1 |
| 9 | **Drop `sf16-lite` + the 40 MB NNUE** | moderate, product call | Removes 66 % of the deployment and the single largest bandwidth risk | §3.4 |
| 10 | **Lazy-load the Review and Import tabs** | moderate | Meaningful slice out of the 417.91 kB entry chunk | §1.3 |
| 11 | **Prerender `/privacy` + `/learn/*` to static HTML** | larger | Correct crawler markup with no JS, plus fast first paint on SEO entry points | §4.2 |
| 12 | **Self-host or trim the three Google Font families** | small | Removes two third-party round-trips from the critical path | §4.3 |
| 13 | Add `<lastmod>` to `sitemap.xml`; correct the CLAUDE.md persistence list | trivial | Housekeeping | §4.3, §5.3 |

**Sequencing note:** do #1 before any bundle work — it changes what CSS is emitted, so any before/after size comparison taken now will be invalidated by it. Do **not** "fix" the persisted-engine bug (§2.4) on its own; it currently prevents automatic 40 MB NNUE downloads, so it must land with #8 or #9.

---

## Appendix — how to reproduce

```bash
cd "d:/Stockfish 2.0"
npx vite build                      # bypasses the known-failing tsc step
du -sh dist dist/stockfish          # 62M / 60M
ls -la dist/assets                  # chunk sizes
grep -c "items-center" dist/assets/*.css          # 0 today; must be >0 after the P0 fix
grep -c "import(" dist/assets/index-*.js          # 0 = no code splitting
grep -aoE 'nn-[a-z0-9]+\.nnue' frontend/public/stockfish/*.wasm   # which build needs the external net
```
