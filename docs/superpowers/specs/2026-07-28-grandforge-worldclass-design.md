# GrandForge World-Class Upgrade — Design (2026-07-28)

Approved direction from the 2026-07-28 planning session. Supersedes the phase list in
`2026-07-26-grandforge-upgrade-design.md` (Phase 1 of that spec shipped as `01d77ce` + `dda9c75`;
this spec re-plans everything after it against a 10-workstream audit).

**Evidence base:** `docs/superpowers/audits/` — `engine-audit.md`, `review-audit.md`,
`backend-audit.md`, `data-audit.md`, `state-audit.md`, `ui-audit.md`, `perf-audit.md`,
`test-audit.md`, `license-audit.md`, `explorer-design.md` (~240 KB, file:line evidence
throughout). Finding IDs below (S*, F*, §*) refer to those reports.

## Goals & constraints

- World-class free chess analysis platform: chess.com Game Review parity + lichess analysis-board
  parity, self-hosted opening explorer, premium UI.
- 100% free for users; accounts optional, never required.
- **Independence:** no runtime dependency on lichess/chess.com infrastructure for core features
  (engine = local WASM; explorer = own MongoDB aggregate from CC0 data; evals = own cache).
  No third-party platform names in product UI. Exception: user-initiated game import hits
  chess.com/lichess public APIs (inherent to the feature), and the optional Syzygy tablebase
  probe remains (free, no auth, graceful fallback).
- **Stockfish GPL-3.0 compliance is mandatory and visible** (footer credit exists; license files
  must ship — this is a legal obligation, not branding).
- Hosting: Render free tier (persistent primary; only real no-card free tier in 2026) +
  existing Vercel serverless fallback. Atlas M0 512 MB is the binding data constraint.
- Quality gate per change: `npm run typecheck` → `npm test` → `npm run build` (+ `npm run
  test:e2e` for engine/board/review changes).
- Accuracy math stays lichess-comparable by default (flat logistic Win%). Stockfish's
  material-aware WDL model (win_rate_params, uci.cpp) is documented as a possible opt-in
  "precision mode" later — NOT in scope; changing it silently would break comparability.

## Key decisions

- **D1 — Explorer data:** self-hosted aggregate ingested once from the Lichess Elite Database
  (CC0-derived, 2400+/2200+ filtered, ~2M games / 6 recent months). No runtime API calls, no
  tokens, no attribution strings. Full design incl. sizing math (D=20 plies, T=8 min games,
  ~150-280 MB, empirical budget guard), `explorerNodes` schema, two-pass trie ingest:
  `audits/explorer-design.md`.
- **D2 — Theory prose:** own-authored for the ~300 most-played openings, stored on
  `Opening.description`; deeper lines show ECO name + stats only. No Wikibooks dependency.
- **D3 — Eval cache goes anonymous-write** with the full abuse-guard set from
  `backend-audit.md §3` (FEN normalization, PV legality verification, depth ≥ 12 floor,
  score bounds, trust-on-second-confirmation, per-route tight limit, TTL/LRU, salted IP hash).
  Poisoning is the failure mode to engineer against; storage is the second.
- **D4 — No server-side engine** (unchanged): Render 0.1 vCPU < browser WASM.

## Phases

### Phase 0 — land the in-flight WIP (working tree is red)
Finish the `forced` classification: fix the 5 `TS2741` errors (`boardUtils.ts` ×2,
`pgnUtils.ts`, `ReviewMoveGlyph.tsx`, `ReviewMoveGlyph.test.ts`); replace the hardcoded
10-label counts array in `GameReviewService.ts:520` with `ALL_CLASSIFICATIONS`; add `forced`
to `backend/zodSchemas.ts:105` `moveClassificationSchema` (else review save 400s); keep the
already-correct miss/blunder discriminator and Elo-band changes. Gate green, commit.

### Phase 1 — correctness blitz (fix before building anything new)
Test-first where math changes (test-audit §4 lists the ~18 pins to write).

- **Criticals:** 2nd-PGN-upload E11000 (`Game.ts:120` sparse→partialFilterExpression, data §0);
  Brilliant unreachable (review F1); engine load failure bricks UI (engine S1);
  `sf18-lite-mt` isolation preflight + fallback + server enums incl. dropping `sf18-full`
  (engine S2, data §2c); `reviewedNodeIds` stripped on save (data §2d); Tailwind content glob
  regression — zero utilities in prod CSS (perf #1).
- **Engine layer:** terminate() must reject in-flight promises (S4/S5b — engine-switch
  mid-review deadlock); watchdog escalation beyond `stop` (S5); persisted engineVersion
  honored + removed-id migration (S3, state S2/S3); conditional UCI options per build (S6);
  no setoption mid-search (S7); info-string/lowerbound parsing (S8/S9); isEnabled hydrate
  reconciliation (state S4); clearReview cancels running review (state S5).
- **Review math:** tablebase category/dtm perspective (F3); mate-horizon spurious miss (F4);
  Great rating-calibration dead code — thread real deltaWin (F5); book-detection off-by-one
  (F6); forced excluded from rated-move counts consistently (F7); phase-boundary endgame
  collapse (F9); EvalGraph black-to-move inversion (F11).
- **Backend/DB:** boot env assert (F5b); import GET→POST + 5-8 s outbound timeouts + CORS
  reject (F1b); helmet-equivalent headers + JSON 404/error handlers (F9b); Position unique-key
  vs upsert mismatch (F4b); TTLs — anonymous games 7 d, positions LRU 30-60 d, tablebase 180 d,
  session quota (data §4); drop 17 dead indexes (data §1c); delete dead zodSchemas + openingBook
  (F13); `review/save` ObjectId guard (F10); `.env` skipped when MONGODB_URI exported (data §5);
  `/game/:id` deep-link 401 (F3b).
- **Perf/SEO quick wins:** per-route canonical/meta in StaticPage (perf #7); cap
  `convertUciToSan` to `pv.slice(0,8)` (perf #8); `/assets/*` immutable cache header.
- **License:** ship `Copying.txt` + `AUTHORS` via copyStockfish.mjs; extend footer credit with
  build-source pointer (nmrugg/stockfish.js) + exact versions; add GrandForge LICENSE (owner
  choice); verify chess-openings CC0 and fix seeder comment (license SF-1..4).
- **CLAUDE.md sync** at phase end.

### Phase 2 — Render go-live support (code side; user does dashboard after all work)
Rate-limit budgets sized for reviews (≥400 on positions read bucket or cost-keyed — backend F2);
failover on broken-deploy (health-500 eligible — F14); `/api/health/deep` (DB ping, for
monitoring not Render); prebuild backend to JS + split server deps (kills 348 MB install +
tsx cold-start — F7b); verify `trust proxy` hops empirically at first deploy (F8);
unhandledRejection handler + closeIdleConnections + request timeout (backend §4);
serverless pool 5→2 + maxIdleTimeMS (data §5). USER MANUAL (after all phases): create Render
Blueprint, paste env secrets, set up 10-min keep-alive pinger — pinger is load-bearing
(4 s probe vs 30-60 s cold start means primary is never used without it).

### Phase 3 — self-hosted explorer + theory + live cloud cache
Per `audits/explorer-design.md`: `scripts/ingestExplorer.ts` (two-pass SAN-trie → FEN merge,
checkpoint/resume, budget guard) run locally by user (~2-4 h); `explorerNodes` collection;
`GET /api/explorer/lookup`; Explore tab (W/D/L bars, avg Elo, top games, move list → click to
play). Own theory prose top ~300 openings (subagent-drafted, human-reviewable file) seeded onto
`Opening.description`; shown above stats when position matches. Eval cache: anonymous writes +
guard set (D3), MT engine included; cloud badge on cached deep evals.

### Phase 4 — premium UI/UX
Unified Settings modal (Engine / Interface / Board tabs — inventory of scattered controls in
ui-audit §2); move/capture/check sounds (own-generated or CC0 set) + sound theme + mute;
share (URL with FEN/PGN state, copy PGN/FEN); threat arrows (null-move analysis toggle);
play-vs-computer (UCI_Elo plumbed — engine S13); live-analysis depth/time user controls (S12);
code-splitting (React.lazy content pages, review suite, board editor, import flow) + lazy
engine fetch — first visit 6 MB → ~1 MB (perf #2/#3); mobile ≤600 px layout pass + a11y
(focus trap, aria, contrast — ui §5); piece animations + coordinates options; review autoplay
controls surfaced.

### Phase 5 — accounts (optional, never required)
Route AuthPage/SessionsPage; saved games/sessions UX; review persistence round-trip (depends on
Phase 1 zod passthrough); per-user quotas enforced.

### Phase 6 — hardening
Shared rate-limit store (Upstash free) replacing MemoryStore; uptime monitoring + alerting on
/api/health/deep; load test review burst + explorer browse; abuse-guard round 2 informed by
telemetry; Atlas storage watch (explorer + positions share 512 MB).

## Testing strategy

Unit (vitest, node env): the 18 pins from test-audit §4 land in Phase 1 before their fixes;
every new pure function (explorer aggregation, ingest trie ops, guards) gets adjacent tests.
Fix the 5 wrong-assertion tests (test-audit §6). E2E (Playwright, local-only): existing 6 specs
+ `engine-switch.spec.ts`, `review-variation.spec.ts`, `review-artifacts.spec.ts` (test-audit §5);
run for every engine/board/review phase. Router dispatch-order unit test (test-audit #16).

## Error handling principles

Engine: any load/search failure surfaces a visible non-fatal banner + retry, never a silent
dead manager (S1/S4/S11). API: JSON 404/error handlers, no stack leakage regardless of
NODE_ENV, fixed-string 500s. Client: failover eligibility includes broken-deploy signatures;
all cache paths remain fail-open (WASM fallback). Ingest: per-month checkpoint, resumable,
budget hard-stop.

## Out of scope (explicit)

Server-side Stockfish farm; chess variants; puzzles beyond the existing blunder trainer;
Stockfish material-aware WDL as default accuracy math; paid tiers of any kind.
