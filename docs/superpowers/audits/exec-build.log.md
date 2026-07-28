# exec-build — running log (Tasks 2, 16 minus engineStore, 17)

Agent: exec-build. Started 2026-07-28. Plan: `docs/superpowers/plans/2026-07-28-phase0-1-correctness.md`.

Owned files only: `tailwind.config.ts`, `frontend/src/pages/StaticPage.tsx`, `vercel.json`,
`scripts/copyStockfish.mjs`, `frontend/src/components/layout/Footer.tsx`, `scripts/seedOpenings.ts`
(comment only), `frontend/public/stockfish/{Copying,AUTHORS,SOURCE}.txt`.

## Context read
- plan Tasks 2, 16, 17 in full
- `perf-audit.md` P0 (Tailwind), §4.2 (canonical), §3.3 (assets cache), cheapest-first list
- `license-audit.md` in full incl. completion/provenance table

## Verified pre-state
- `tailwind.config.ts:4` = `content: ['./index.html', './src/**/*.{ts,tsx,html}']` — matches the audit;
  both paths are stale post-`dda9c75` (files now under `frontend/`).
- `vercel.json` has 3 header blocks; `/stockfish/(.*)` immutable exists, no `/assets/(.*)` rule.
- `StaticPage.tsx` manages only `document.title` (useEffect, restores on unmount).
- `node_modules/stockfish/Copying.txt` present (35,821 B). **No AUTHORS file in the npm package**
  → will write a pointer AUTHORS.txt per task instruction.
- `frontend/public/stockfish/` holds the 4 engine pairs + the 40 MB nnue, as the audit table says.

## Task 2 — Tailwind content globs (DONE, verified)

`tailwind.config.ts:4` → `content: ['./frontend/index.html', './frontend/src/**/*.{ts,tsx,html}']`
(+ a comment explaining that the globs are root-relative, not Vite-`root`-relative, which is what
made the dda9c75 split silent).

Verified with the one permitted `npx vite build`:
- `No utility classes were detected` warning **gone**.
- CSS bundle 35.68 kB → **59.13 kB** raw (gzip 7.64 → **11.41 kB**), i.e. +23.45 kB of real utilities
  — in line with the audit's +10–15 kB estimate, slightly above it.
- Probes in `dist/assets/*.css`, all previously 0, now present exactly once each:
  `items-center`, `justify-between`, `text-sm`, `w-full`, `rounded-lg`, `gap-2`,
  `.animate-spin{animation:spin 1s linear infinite}`, Preflight `box-sizing:border-box`.
- Arbitrary values emitted: `max-w-\[1200px\]`, `min-h-\[400px\]`.
- Responsive variants emitted: `@media (min-width: 640px)` + `sm\:px-6` (the `sm:` tier existed for
  hand-written CSS before; the Tailwind `sm:` utilities are new).

Not done (out of my ownership / needs a browser): plan Step 4's visual sanity pass in `web:dev`.
Flagging the audit's own warning — some hand-written CSS may have been tuned against the broken
render, so a human should eyeball the layout once.

## Task 16 — per-route head management + asset caching (DONE)

**`frontend/src/pages/StaticPage.tsx`** — added a self-contained head manager. Constraint that shaped
the design: I own `StaticPage.tsx` but *not* `PrivacyPage`/`LearnAccuracyPage`/`LearnClassificationsPage`,
so nothing could be threaded in as a new prop. Instead the effect derives everything itself:
- `useLocation().pathname` → canonical/og:url as `${SITE_ORIGIN}${pathname}`, where `SITE_ORIGIN` is
  the same hardcoded production origin `frontend/index.html` uses. Deliberately **not**
  `window.location.origin` — preview deploys and localhost must still declare the prod canonical.
- A `ROUTE_DESCRIPTIONS` map keyed by pathname (the 3 real content routes) with a title-derived
  fallback for any future route.
- `applyHeadTag(selector, createTag, attribute, value)` overwrites the tag if it exists (all the
  index.html ones do) remembering the old value, or creates+appends it if absent. Returns an undo
  closure; the cleanup runs them in reverse and restores `document.title`.
- Tags managed: `link[rel=canonical]`, `meta[name=description]`, `og:title`, `og:description`,
  `og:url`, `twitter:title`, `twitter:description`. og:*/twitter beyond the plan's minimum because
  perf-audit §4.2 names wrong social unfurls as a consequence of the same root cause.

**`vercel.json`** — added a 4th headers block `/assets/(.*)` →
`Cache-Control: public, max-age=31536000, immutable`, alongside the existing 3. Vite content-hashes
everything in `dist/assets/`, and `index.html` is untouched so deploys still roll out.

Skipped by instruction: the `engineStore.ts` `info.pv.slice(0, 8)` item (owned by another agent).

## Task 17 — GPL-3.0 compliance (DONE, files on disk and in dist/)

- **chess-openings license VERIFIED via WebFetch of github.com/lichess-org/chess-openings:
  CC0-1.0**, not AGPL-3.0. README Copyright section: "As a collection of facts, this data set is in
  the public domain", and insofar as curation is copyrightable "the work is released under the CC0
  Public Domain Dedication"; repo metadata sidebar lists CC0-1.0. `scripts/seedOpenings.ts:5`
  corrected, with the verification date and an explicit note that no attribution obligation attaches.
- **`scripts/copyStockfish.mjs`** — now also copies `node_modules/stockfish/Copying.txt` (35,821 B,
  the GPLv3 text) into `frontend/public/stockfish/`, size-guarded like the binaries, warning if the
  package is absent. The npm package ships **no AUTHORS file**, so the script generates
  `AUTHORS.txt` from a literal (written only when missing or changed) pointing at
  official-stockfish/Stockfish AUTHORS, nmrugg/stockfish.js, and official-stockfish/networks.
  Needed `readFileSync, writeFileSync` added to the `fs` import.
- **`frontend/public/stockfish/SOURCE.txt`** (new, committed by hand — not generated): per-artifact
  corresponding-source provenance. sf18 quad = npm `stockfish@18.0.7` (nmrugg/stockfish.js);
  sf17.1-lite-single pair = nmrugg/stockfish.js release 17.1; sf16-lite-single pair = release 16;
  `nn-5af11540bbfe.nnue` = official Stockfish 16 net (official-stockfish/networks), external because
  only the sf16 lite build keeps its net outside the wasm. States the binaries are unmodified and
  that the app talks UCI over a worker boundary.
- **`frontend/src/components/layout/Footer.tsx`** — the Stockfish line now reads
  `Powered by Stockfish 18 · GPL-3.0 · license · engine source — Analysis runs in your browser.`
  with `license` → `/stockfish/Copying.txt` and `engine source` → `github.com/nmrugg/stockfish.js`.
  Same `<a target=_blank rel=noopener noreferrer>` idiom as the existing links.
- Ran `node scripts/copyStockfish.mjs`: `Copying.txt` 35,821 B, `AUTHORS.txt` 989 B, `SOURCE.txt`
  2,501 B present in `frontend/public/stockfish/` **and** in `dist/stockfish/` after the build.
- Gitignore check (plan Step 2): `.gitignore:21` only ignores `frontend/public/stockfish/stockfish-18-*`,
  so all three `.txt` files are tracked and will be committed normally.
- **NOT done — out of scope of my file ownership:** license-audit SF-3 (no `LICENSE` file for
  GrandForge's own code). That is an owner decision and a repo-root file I was not granted.

## Final typecheck

`npx tsc --noEmit` → **8 errors, all in `frontend/src/services/apiBase.test.ts` (lines 61-84),
all the same `TS2353: 'config' does not exist in type '{ response?: { status?: number } }'`.**
That file is Task 18's (another agent, mid-edit — they are adding the `config.url`-based failover
eligibility branch and the test's error-shape type has not been widened yet). **Zero errors in any
file I touched.** The 5 known `TS2741 'forced' is missing` errors are also gone, so Task 1 has
landed in the meantime.

## Files changed by this agent

- `tailwind.config.ts` (content globs + comment)
- `frontend/src/pages/StaticPage.tsx` (head manager)
- `vercel.json` (`/assets/(.*)` immutable cache block)
- `scripts/copyStockfish.mjs` (copy Copying.txt, generate AUTHORS.txt, fs import)
- `frontend/src/components/layout/Footer.tsx` (GPL-3.0 + license + engine source links)
- `scripts/seedOpenings.ts` (license comment AGPL-3.0 → CC0-1.0, verified)
- `frontend/public/stockfish/Copying.txt` (new, script-copied)
- `frontend/public/stockfish/AUTHORS.txt` (new, script-generated)
- `frontend/public/stockfish/SOURCE.txt` (new, hand-written)
- `docs/superpowers/audits/exec-build.log.md` (this log)

No `git` commands were run.



