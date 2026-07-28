# Task 18 (partial) — apiBase failover + weak-assertion test fixes

Scope: `frontend/src/services/apiBase.ts`, `frontend/src/services/apiBase.test.ts`,
`frontend/src/utils/blunderPuzzles.test.ts`. `gameStore.test.ts` items are owned by
another agent and are deliberately skipped.

## Context read

- `docs/superpowers/plans/2026-07-28-phase0-1-correctness.md` Task 18.
- `backend-audit.md` F14 — failover blind spot. Today `isFailoverEligible`
  (`apiBase.ts:41-47`) retries only on 502/503/504 or a transport-level error. Once the
  Render service exists but is *broken* (F5: boots without `MONGODB_URI`, `/health` green
  at the proxy but every request 500s), the client never falls back to the working Vercel
  function. Fix per audit: treat a 500 on `/health` as failover-eligible.
- `test-audit.md` §2 — apiBase.test.ts covers `resolveApiBases` + `isFailoverEligible`
  only; the whole sticky-failover state machine is untested (module-level `BASES` const
  captured from `import.meta.env` leaves no injection seam — out of scope here).
- `test-audit.md` §6 — `blunderPuzzles.test.ts:50` asserts the load-bearing fenBefore
  off-by-one against placeholder strings the fixture itself laid out to match the
  convention (inverting both code and fixture keeps it green); `:6`'s `START` constant is
  not a legal FEN (rank 3 duplicates the rank-1 piece row).

## Design notes

- `probe()` uses raw `fetch`, not axios, and already treats a non-`ok` `/health` as
  unreachable — so the boot probe was never the gap. The gap is the axios response
  interceptor path in `apiClient.ts:32-52`, which is the only caller of
  `isFailoverEligible`. Failover eligibility must therefore learn about health URLs.
- The interceptor's replay guard stays exactly as-is: per-request
  `config.baseURL !== fallback` + `_gfRetried`, never global sticky state.
- axios puts the *request-relative* path in `error.config.url` (`/health`) but an
  absolute URL is also possible when a caller passes one, so the match normalizes both
  (strip query/hash, then compare the path tail).

## Steps

1. **RED (apiBase).** Added four `isFailoverEligible` cases: 5xx on `/health` (absolute
   URL, relative URL, 503, and with a query string) → true; plain 500 on
   `/games/upload` and on `/positions/healthcheck` → false; 404/429 on `/health` → false
   (the deploy answered — that is not a host-level failure). Ran
   `npx vitest run frontend/src/services/apiBase.test.ts frontend/src/utils/blunderPuzzles.test.ts`
   → 1 failed / 13 passed, failing exactly on the health-500 case
   (`expected false to be true`) — i.e. for the audited reason, not a typo.

2. **RED/GREEN (blunderPuzzles).** Fixed the `START` constant to the legal start FEN
   (`rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1` — the old value duplicated
   the rank-1 piece row on rank 3). Added a real-position case: plays
   `1.e4 e5 2.Nf3 Nc6 3.Bb5` through `chess.js`, captures `fen()` after each ply into the
   tree, marks 2.Nf3 a mistake (best `f1c4`) and 3.Bb5 a blunder (best `f3g5`), then for
   each produced puzzle asserts via `chess.js` `moves({verbose:true}).lan` that **the move
   actually played at that plyIndex is legal in `fenBefore`**, that the solution is legal
   there, and that `sideToMove === board.turn()`. That is the assertion the placeholder
   fixture could not make: under the inverted convention the played move would not be
   available in `fenBefore`. Also pinned `fens[2]` to its literal FEN and checked
   worst-first ordering `[4, 2]`. This case passed on first run — the production
   convention in `blunderPuzzles.ts:43-49` is correct; what changed is that it is now
   verified against a real board instead of against strings chosen to agree with it.

3. **GREEN (implementation).** `apiBase.ts`: `isFailoverEligible` param type gains
   `config?: { url?: string }`; body becomes gateway-status check, then
   `status >= 500 && isHealthUrl(error?.config?.url)`. New module-private
   `isHealthUrl(url)` strips query/hash + trailing slashes and matches `health` /
   `*/health`, so `/positions/healthcheck` does not match. Doc comment updated to state
   why health is the single exception (a broken deploy 5xxs everything while the proxy
   reports the host up, so no 502/503/504 is ever produced) and why replay is safe there
   (health duplicates no work). No change to the interceptor in `apiClient.ts` — its
   per-request replay guard (`config.baseURL !== fallback` + `_gfRetried`) is untouched
   and no global sticky state was introduced.

4. **Verify.** `npx vitest run frontend/src/services/apiBase.test.ts frontend/src/utils/blunderPuzzles.test.ts`
   → **2 files / 14 tests passed** (apiBase 11, blunderPuzzles 3).

5. **`npx tsc --noEmit`** → 7 errors, **all outside my three files** and all the same
   cause: `deltaWin` not yet on `ClassifyMoveParams` (Task 7 work in flight by another
   agent) — `frontend/src/services/GameReviewService.ts:422` and
   `frontend/src/utils/reviewUtils.test.ts:42,57,72,88,103,118`. Nothing to do here;
   reported upward.

## Out of scope / not done

- `frontend/src/store/gameStore.test.ts` items (positive mainline-fallback assertion, real
  same-ply pathKey test) — owned by another agent, skipped entirely per instructions.
- `test-audit.md` §2's larger gap (`markPrimaryFailed` / `scheduleReprobe` / `probe` /
  `initApiBaseProbe` untested) is untouched: `BASES` is a module-level const captured from
  `import.meta.env` at import time, so there is no injection seam without restructuring
  the module — out of Task 18's "smallest change wins" scope.
- No `git` commands run; no `npm run build` run (both prohibited for this task).
