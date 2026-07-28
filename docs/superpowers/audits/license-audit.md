# GrandForge — Licensing / GPL Compliance Audit

**Date:** 2026-07-28
**Scope:** GPL obligations for the Stockfish WASM binaries served to browsers, plus licensing of every other redistributed asset.
**Status of this document:** written incrementally during the audit.

> **Headline:** the repository contains **no `LICENSE`, no `COPYING`, no `AUTHORS`, no `NOTICE`, and no third-party-attribution file of any kind** (`git ls-files | grep -iE 'licen[cs]e|copying|authors|notice|third.?party|credits'` returns nothing). The app conveys four GPL-3.0 Stockfish builds to every visitor. This is a live, uncured GPL-3.0 §4/§6 violation, and it is straightforward to fix.

---

## 1. Inventory — `frontend/public/stockfish/`

All ten files below are served publicly (Vite `publicDir`; they land at `/stockfish/*` in `dist/`).

| File | Size | Provenance | Upstream |
|---|---:|---|---|
| `stockfish-18-lite.js` | 32,109 B | copied from npm at build time — `scripts/copyStockfish.mjs:25` | `stockfish@18.0.7` → `node_modules/stockfish/bin/stockfish-18-lite.js` |
| `stockfish-18-lite.wasm` | 7,093,151 B | copied from npm — `scripts/copyStockfish.mjs:26` | `stockfish@18.0.7` |
| `stockfish-18-lite-single.js` | 20,670 B | copied from npm — `scripts/copyStockfish.mjs:21` | `stockfish@18.0.7` |
| `stockfish-18-lite-single.wasm` | 7,295,411 B | copied from npm — `scripts/copyStockfish.mjs:22` | `stockfish@18.0.7` |
| `stockfish-17.1-lite-single.js` | 20,672 B | **committed by hand** (git-tracked) | Stockfish.js 17.1, © 2025 Chess.com LLC |
| `stockfish-17.1-lite-single.wasm` | 7,280,741 B | **committed by hand** | Stockfish.js 17.1 |
| `stockfish-16-lite-single.js` | 25,594 B | **committed by hand** | Stockfish.js 16, © 2023 Chess.com LLC |
| `stockfish-16-lite-single.wasm` | 575,029 B | **committed by hand** | Stockfish.js 16 |
| `nn-5af11540bbfe.nnue` | 40,119,326 B | **committed by hand** | Official Stockfish 16 NNUE network, fetched at runtime by the sf16 build |
| *(dir total)* | ~61 MB | | |

`scripts/copyStockfish.mjs:53-57` only *asserts the presence* of the sf16/sf17.1/nnue files (`REQUIRED_REAL`); it never produces them. `scripts/copyStockfish.mjs:16-18` states this explicitly.

The npm package also ships a `sf18-full` 113 MB build (`node_modules/stockfish/bin/stockfish.wasm`) that is deliberately **not** deployed (CLAUDE.md, Hobby size limits) — no obligation attaches to what is not conveyed.

### 1a. Version / provenance evidence (extracted from the shipped files themselves)

Every JS glue file carries an intact upstream banner comment — this is good, it is real attribution that is already being conveyed:

- `frontend/public/stockfish/stockfish-16-lite-single.js:1-12` —
  `Stockfish.js 16 (c) 2023, Chess.com, LLC / https://github.com/nmrugg/stockfish.js / License: GPLv3`, "Based on stockfish.wasm (c) Niklas Fiekas, Hiroshi Ogawa", "Based on Stockfish (c) T. Romstad, M. Costalba, J. Kiiski, G. Linscott and other contributors".
- `frontend/public/stockfish/stockfish-17.1-lite-single.js:1-11` — `Stockfish.js 17.1 (c) 2025, Chess.com, LLC`, `License: GPLv3`, "Nets by Linmiao Xu (linrock)".
- `frontend/public/stockfish/stockfish-18-lite.js:1-11` and `stockfish-18-lite-single.js:1-11` — `Stockfish.js 18 (c) 2026, Chess.com, LLC`, `License: GPLv3`.

NNUE network references embedded in the WASM payloads:

- `stockfish-16-lite-single.wasm` → `nn-5af11540bbfe.nnue` (matches the 40 MB committed file — the sf16 lite build fetches its net at runtime, which is why that file must ship).
- `stockfish-17.1-lite-single.wasm`, `stockfish-18-lite.wasm`, `stockfish-18-lite-single.wasm` → `nn-9067e33176e8.nnue` (embedded in the binary; no separate file needed).

npm provenance is pinned and unambiguous:

- `package.json:45` — `"stockfish": "^18.0.0"`
- `package-lock.json:7089-7094` — resolved `stockfish@18.0.7`, `"license": "GPL-3.0"`, integrity `sha512-tJ+bfMAHs4fV...`
- `node_modules/stockfish/package.json` — author Nathan Rugg (nmrugg), contributor Chess.com, repo `git://github.com/nmrugg/stockfish.js`, `buildVersion: "18"`.

**The npm package ships the full GPL text at `node_modules/stockfish/Copying.txt` (35,821 B) — `copyStockfish.mjs` does not copy it, so it never reaches `dist/` and is never conveyed to users.** That single omission is the core of finding SF-1 below.

---
## Completion (finished inline by lead after agent quota failure)

### Shipped engine artifacts (frontend/public/stockfish/, on disk)
| file | bytes | provenance |
|---|---|---|
| stockfish-18-lite.js / .wasm | 32,109 / 7,093,151 | npm `stockfish@18.0.7` (nmrugg/stockfish.js), copied by copyStockfish.mjs |
| stockfish-18-lite-single.js / .wasm | 20,670 / 7,295,411 | npm `stockfish@18.0.7`, copied |
| stockfish-17.1-lite-single.js / .wasm | 20,672 / 7,280,741 | committed by hand (nmrugg/stockfish.js v17.1 lite build) |
| stockfish-16-lite-single.js / .wasm | 25,594 / 575,029 | committed by hand (nmrugg/stockfish.js v16 lite build) |
| nn-5af11540bbfe.nnue | 40,119,326 | committed by hand — sf16 runtime net (official-stockfish nets) |

### Current compliance state
- PRESENT: GPLv3 banner comments intact in every .js glue file; visible UI credit in `Footer.tsx:9-10` ("Stockfish 18 (GPLv3)" linking stockfishchess.org).
- MISSING (SF-1): `Copying.txt` (full GPL text — exists at node_modules/stockfish/Copying.txt, 35,821 B, never copied to public/) and `AUTHORS`. Neither is conveyed with the binaries.
- MISSING (SF-2): corresponding-source pointer per exact binary (nmrugg/stockfish.js releases 16 / 17.1 / 18.0.7). Footer links stockfishchess.org (upstream engine), not the WASM build source.
- MISSING (SF-3): no LICENSE file for GrandForge's own code.
- VERIFY (SF-4): `scripts/seedOpenings.ts:5` claims lichess-org/chess-openings is "AGPL-3.0" — upstream repo actually declares CC0; confirm and correct the comment; no attribution required if CC0.

### Minimal compliance checklist
1. Copy `Copying.txt` + generate `AUTHORS.stockfish.txt` into `frontend/public/stockfish/` (extend copyStockfish.mjs).
2. Footer credit line extends to: "Powered by Stockfish 16/17.1/18 (GPL-3.0) — engine builds: github.com/nmrugg/stockfish.js — license: /stockfish/Copying.txt".
3. Add repo LICENSE for GrandForge itself (owner decision; engine stays GPL regardless; app communicates with engine over UCI/postMessage worker boundary).
4. Correct seedOpenings.ts source-license comment after verification.
