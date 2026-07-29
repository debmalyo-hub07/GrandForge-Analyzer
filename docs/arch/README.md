# Architecture reference — routing index

These files hold the detail that used to sit in `CLAUDE.md`. None of them load
automatically. Read one only when you are about to work in that area.

| File | Read it when you are working on |
|---|---|
| [engine.md](engine.md) | `EngineManager.ts`, UCI, watchdogs, engine ids/options, WASM builds |
| [state.md](state.md) | `engineStore`, `gameStore`, `MoveTree`, persistence/migrations |
| [review.md](review.md) | game review, classification, accuracy/Win%, phase summary, eval tiers |
| [api.md](api.md) | `backend/**`, routes, rate limits, Render/Vercel deploy, `db.ts`, server build |
| [position-cache.md](position-cache.md) | shared eval cache, `positionCacheGuards.ts`, anonymous writes |
| [explorer.md](explorer.md) | `ExplorerNode`, `explorer/lookup`, `ingestExplorer.ts` |
| [opening-theory.md](opening-theory.md) | `scripts/data/openingTheory/**`, `seedOpeningTheory.ts` |
| [frontend.md](frontend.md) | routes, pages, board overlays, panels, eval graph, trainer |
| [testing.md](testing.md) | vitest config, what is excluded, E2E, DB safety in tests |
| [environment.md](environment.md) | env vars, CSP/COOP/COEP, the `NODE_ENV` trap, Vite config |

Nothing here duplicates `CLAUDE.md`; it is the same text, moved. If you change
an invariant, change it in the one file that owns it.

## Everything else under `docs/`

`docs/superpowers/audits/**` (~250 KB) and `docs/superpowers/exec-*.log.md`
(~77 KB) are **archival**: a record of one-time audits and execution logs from
the July 2026 upgrade. Their findings are already reflected in the code and in
these reference files. Do not read them to get oriented — only open one if a
comment or doc cites it by path and section, or the user asks for it.

`docs/superpowers/specs/**` and `docs/superpowers/plans/**` are the approved
design and phase plans. Read the spec when you need to know what phase the work
is in; skip the plans unless you are resuming a specific phase.
