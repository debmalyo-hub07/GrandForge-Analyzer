# GrandForge Upgrade — Design & Roadmap (2026-07-26)

Approved direction from the 2026-07-26 planning session (full-project audit + hosting/classification/explorer research). Reference bar: chess.com analysis/review UX + lichess analysis board (engine panel, opening explorer, WikiBook).

## Audit summary (what exists today)

- **Analytical core is already near-reference.** All 10 chess.com move classifications (brilliant, great, best, excellent, good, book, inaccuracy, mistake, miss, blunder) are implemented with rating-aware calibration, true sacrifice detection for Brilliant, Lichess accuracy math, CAPS-style performance rating, phase summaries, tablebase overrides. Only `forced` is missing.
- **Frontend**: eval bar + WDL, MultiPV lines, custom arrow overlays, move tree with variations, review suite (eval graph, autoplay, blunder trainer), board editor, 7 board themes / 6 piece sets, hotkeys, chess.com/lichess/PGN/FEN import.
- **Backend**: 30 Express routes (auth, games, sessions, review jobs, openings, positions, tablebase proxy, master games) behind one consolidated router; already pure Express with zero Vercel runtime coupling.
- **Notable gaps**: no settings modal (controls scattered), no sounds, no opening explorer/WikiBook, no play-vs-computer, no share URL, no threat arrows, auth + saved-games UI built but unrouted, `sf18-lite-mt` unreachable (Threads slider inert), no crossOriginIsolated fallback, ~10 small bugs / doc drifts catalogued in the audit reports (this session's conversation).

## Decisions

- **D1 — API topology: dual-deploy.** Render free tier runs the persistent Express server (primary). The existing Vercel serverless function (same `api/_lib/router.ts`) stays deployed as automatic fallback. Client resolves API base from `VITE_API_BASE_URL` with sticky failover to same-origin `/api`. Keep-alive pinger (external, every 10 min) hides Render's 15-min spin-down; 24/7 uptime fits the 750 instance-hours/month budget (~744 h). Research: Koyeb free tier closed to new users (Mistral acquisition, Feb 2026); Railway is a $5 trial; Cloud Run requires a credit card. Render is the best genuinely-free, no-card option.
- **D2 — No server-side Stockfish.** Render free = 0.1 vCPU — weaker than any user's browser running our WASM builds. Analysis stays client-side (chess.com/lichess do the same for local analysis). The MongoDB position cache becomes a first-class **cloud-eval layer** in Phase 3 (serve cached deep evals with a CLOUD badge, crowd-source deep client evals back). The API shape leaves room for a real engine farm if funding ever appears.
- **D3 — Repo layout: full frontend/backend split (amended 2026-07-27 at user request).** `frontend/` = React app (Vite `root`, with `envDir` pinned to the repo root so `.env` / `.env.production` keep loading); `backend/` = the whole Express API + persistent entry (`backend/index.ts`); root `api/[...path].ts` remains ONLY as a 1-file Vercel adapter re-exporting `backend/router` (Vercel's functions convention requires root `api/`; `vercel.json` sets `includeFiles: "backend/**"`). One root `package.json` serves both. The originally-planned "light restructure" was superseded when the user asked twice for physical folder separation.
- **D4 — Phase order**: 1 Backend → 2 Fixes/parity → 3 Explorer + cloud evals → 4 UI/UX premium → 5 Accounts → 6 Hardening.
- **Constraints**: platform stays 100% free for users; no login required (auth optional); all current functionality intact; quality gate `typecheck → test → build` (+ e2e for engine/board/review changes).

## Phases

1. **Backend deploy (this phase)** — see `docs/superpowers/plans/2026-07-26-phase1-backend.md`.
2. **Fixes & parity** — add `forced` classification; fix audit catalogue (coordinates-toggle mislabel, best/excellent shared color, sf16 "~1MB" label, MT engine reachable + isolation fallback + Threads wiring, counts-array hardcode, doc drift ×6); sync CLAUDE.md.
3. **Opening explorer + WikiBook + cloud evals** — Explore tab with per-move W/D/L stats (lichess explorer API proxied + Mongo-cached, fallback to seeded master DB), WikiBook prose panel (MediaWiki API by move path), cloud-eval badge from position cache.
4. **UI/UX premium** — unified settings modal (Engine / Interface / Board tabs), sounds, share (URL/PGN/FEN), threat arrows, play-vs-computer (UCI_Elo already plumbed), animations/coordinates options, review autoplay controls.
5. **Accounts** — route the existing AuthPage/SessionsPage, saved games + review persistence UX.
6. **Hardening** — shared rate-limit store, monitoring/alerting, load testing, TTLs, abuse guards on import routes.
