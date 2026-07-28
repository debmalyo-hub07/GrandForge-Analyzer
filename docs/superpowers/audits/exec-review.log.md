# Execution log — review math (plan Tasks 7, 8, 9)

Agent: exec-review. Started 2026-07-29.
Owned files: `frontend/src/utils/reviewUtils.ts` (+test), `frontend/src/services/GameReviewService.ts`
(+ new `GameReviewService.helpers.test.ts`), `frontend/src/components/review/EvalGraph.tsx`,
`frontend/src/types/review.ts`, `frontend/src/components/review/useOpeningBookFens.ts`.

Test command used throughout:
`npx vitest run frontend/src/utils/reviewUtils.test.ts frontend/src/services/GameReviewService.helpers.test.ts`

---

## Task 7 — Brilliant reachability (F1) + `deltaWin` free parameter (F5) — DONE

### Step 1/2: failing tests first

Added to `reviewUtils.test.ts`: an `isTruePieceSacrifice` block built from six real,
legal FENs (knight-for-nothing, Greek-gift `Bxh7+`, Queen's-Gambit pawn offer,
`b8=Q` into `Rxb8`, an even `Bxc6` trade, plus garbage input), a table-driven
ΔWin ladder boundary test, and the miss-vs-blunder discriminator.

First run: **9 failed / 16 passed**. Verified each failure is the audited cause:

- `netMaterialSacrifice` returned `0` for every real sacrifice. Confirms F1's
  algebra — the old implementation diffed material across the mover's OWN ply,
  where `moverAfter >= moverBefore` always, so the result was `<= 0` for every
  legal move in chess and `>= 2` could never hold. Brilliant was unreachable and
  `MoveReview.isBrilliant` was always false.
- Every ladder rung returned `blunder`. Cause: `deltaWin` was a **required**
  parameter, so a fixture that only supplies `winBefore`/`winAfter` leaves
  `dw === undefined` and all `<=` comparisons are false. That is F5's
  free-parameter defect made visible: the number the whole ladder reads was not
  derivable from the position data.

### Step 3: fixes

**F1** — `netMaterialSacrifice(fenBefore, playedUci)` (signature changed from
`(fenBefore, fenAfter)`) now runs a **static exchange evaluation** on the move's
destination square using chess.js, and returns
`seeGainOn(dest) - capturedByMove - promotionGain`:

| move | SEE on dest | captured | promo gain | net |
|---|---|---|---|---|
| `Nd5` (knight for nothing) | 3 | 0 | 0 | **3** → sacrifice |
| `Bxh7+` (Greek gift) | 3 | 1 | 0 | **2** → sacrifice |
| `c4` (Queen's Gambit) | 1 | 0 | 0 | 1 → gambit, not a sacrifice |
| `b8=Q` then `Rxb8` | 9 | 0 | 8 | 1 → only a pawn was invested |
| `Bxc6` (even trade) | 3 | 3 | 0 | 0 |

SEE recursion allows declining at every level (0 floor), skips under-promotions,
and is depth-capped at 10. `totalMaterialOf` deleted (now unused); `parseFen` is
still used by `computePhaseBoundaries`. Documented known limit: only the moved
piece's own square is examined, so a deflection that hangs a *different* piece is
not counted.

**F5** — `deltaWin` **removed** from `ClassifyMoveParams`; `classifyMove` derives
`dw = Math.max(0, winBefore - winAfter)` itself. Callers can no longer describe
impossible states. Two existing tests were asserting exactly such a state and had
to be rewritten (`winBefore 0.42 → winAfter 0.63` with `deltaWin: 0.012`: the move
*improved* the position, so the real ΔWin is 0). They now use `0.635 → 0.62`
(ΔWin ≈ 0.015), which genuinely sits between the club (0.018) and master (0.005)
brilliance tolerances — same expected labels, now reachable for the stated reason.

**F5 second half — the audit's suggested fix does not work.** The audit proposes
re-expressing Great's tolerance as `topMoveWin - winAfter` because
`before.topMoveWin` "is never passed to classifyMove". Verified in
`GameReviewService.ts`: the engine path sets `win: topWin, topMoveWin: topWin`
(identical), and the cache/tablebase paths derive both from the same top line, so
`topMoveWin === winBefore` for all three sources and `topMoveWin - winAfter` is
*numerically identical* to ΔWin. Threading it would have added an inert parameter
that only looks like a fix. Instead: all three Great swing gates require
`winAfter > winBefore`, so derived ΔWin is 0 inside them and `greatDropLimit` is
satisfied at every rating band — this is now documented in the C1 block and
**pinned by a test** ('grants Great at every rating band inside the swing gates').
Making the bands bite there requires rating-dependent *swing* thresholds, i.e. a
re-tune of frozen constants — out of scope per the plan's global constraints.

Call-site change in `GameReviewService.ts`: `isMaterialSacrifice` now passes
`playedUci` (moved below its declaration); the local `deltaWin` const is gone.

**Result: 26/26 pass** in `reviewUtils.test.ts`.

---

## Task 8 — tablebase perspective (F3), mate horizon (F4), book ply (F6), eval graph (F11) — DONE

### Step 1: failing tests first

New file `frontend/src/services/GameReviewService.helpers.test.ts` (16 tests) covering
`tbMoveScore`, `cachedLineToMoverWin`, `bookFensUpTo` and `whiteCpAfter`; five more
tests added to `reviewUtils.test.ts` for the mate horizon. First run:
**19 failed** — 16 because the helpers were module-private (test-audit §3 item 10),
3 because `classifyMove` returned `'miss'` for a mate that merely slipped past the
search horizon.

### Step 2: fixes

**F3 — per-move tablebase perspective.** `tbMoveToMoverPerspective(category, dtm)`
added and exported: mirrors `win↔loss`, `syzygy-win↔syzygy-loss`,
`cursed-win↔blessed-loss`, `maybe-win↔maybe-loss` and negates `dtz`/`dtm`. The audit
suggested putting it in `tablebase.ts`; that file is not mine to touch, so it lives in
`GameReviewService.ts` next to the only consumer. Applied at all three ingestion
points: `best`/`second` scoring, the `tbMoves` map, and `tbBest`. `tbMoveScore` is now
exported, takes the RAW api values, inverts, and additionally understands the
`syzygy-win`/`syzygy-loss` categories it previously dropped to "draw" (a second, smaller
bug — `tablebaseToScore` handles them but `tbMoveScore` did not).

Consequences now live for the first time: `topMoveWin`/`secondMoveWin` are real in
≤7-man endgames instead of pinned at 0.0/1.0, so `isSingularChoice` and `complexity`
can fire there, and the whole C6 slow-win override is reachable. **Caveat for the
lead:** the C6 `+10`/`+25` DTM bands have therefore never executed against real data
and are unvalidated. C6 also now skips forced plies (`&& !isForced`) per the audit's
secondary note, and its category checks accept the `syzygy-*` spellings.

**F4 — mate horizon.** The C3 block now (a) never fires when `isBestMove`, and (b) for
the `mateAfter === null` arm additionally requires real degradation:
`dw > DELTA_WIN_THRESHOLDS.good || winAfter < 0.90`. The `mateAfter > |mateBefore| + 2`
arm is unchanged apart from the `isBestMove` guard. Pinned by five tests including both
"still a miss" directions, so the fix cannot silently disable `miss`.

**F6 — book off-by-one.** Extracted `bookFensUpTo(fensAlongLine, matchedPlies)` as an
exported pure function and fixed the range: book positions are indices
`0 .. matchedPlies - 1`, not `0 .. matchedPlies`. The old set included the position the
FIRST out-of-book move was played from, so that move was labelled `book` and dropped
from accuracy, `ratedMoves` and phase scoring — once per game, every game.

Also fixed in the same file (same audit section): `cacheRef` had no key, and `ReviewTab`
is not remounted on game load, so reviewing game B reused game A's book FEN set. The
cache is now keyed on the mainline node path. **Not fixed, needs a call site I don't
own:** the hook still reads `getMainlinePath` while a review may run on a variation
(`ReviewTab.tsx:92` currently always passes the mainline leaf, so they agree today).

**F11 — starting colour.** `GameReviewResult.startingColor?: 'w' | 'b'` added (optional
for legacy rows) and set from `startingColorFromFen(fenPositions[0])`. `whiteCpAfter` is
now exported, takes `startingColor`, and is used for the curve, the caption eval and the
caption move numbering; the graph's leading edge also mirrors for a black-to-move start.
**Type note:** the task brief said `'white' | 'black'`, the audit and
`startingColorFromFen`/`playerAccuracy` all use `'w' | 'b'` — I followed the latter.

**Result: 47/47 pass** across both files.

---

## Task 9 — playerAccuracy, phase boundaries, rating pins (F7, F8, F9, F10) — DONE

### Step 1: pins first

Added a shared 6-ply fixture (`SERIES_CP` → `fixtureMoves`) plus exact-value pins for
`cpAndMateToWin`, `accuracyFromWin`, `accuracyToGameRating`, `computePhaseBoundaries`
and `playerAccuracy` (both colours, both starting colours, with `excludePlyIndices`,
with a `forced` move). Derived by executing the current functions and hard-coding the
output; each is marked `// regression pin, derived 2026-07-29`.

First run: all pins held, with exactly **3 intended failures** — the two F9 phase cases
and the plyIndex-attribution case.

### Step 2: fixes

**F7 — one rated-move predicate.** New exported `isRatedMove(m)` =
`!isBookMove && classification !== 'forced' && unscored !== true`, now used by
`playerAccuracy`, `phaseSummary` and `GameReviewService`'s `ratedMoves` (which
previously filtered on `!isBookMove` alone). Forced plies no longer feed `avgCpl`,
`avgComplexity`, or the `moveCount` denominator behind `accuracyToGameRating` /
`gameRatingConfidence`, so the phase-row move counts can sum to the rating's
denominator again.

**F8 — FIXED, not documented-and-kept.** The audit's own recommendation is to fix, and
fixing is what *restores* lichess comparability rather than breaking it: the port
deviated from the quoted `AccuracyPercent.scala` in three ways at once (window size
roughly halved because it was taken from the per-colour series, windows holding only one
colour's evals, and truncated instead of padded leading windows) — all three push
weights toward the 0.5 floor and flatten the volatility weighting. `playerAccuracy` now
builds ONE interleaved White-relative Win% series over all plies, takes
`windowSize = clamp(floor(plies/10), 2, 8)` from the full ply count, applies the
`windowSize - 2` leading pad, and splits by colour only at the end. A 60-ply game now
gets window 6 (upstream's value) instead of 3.

No Lichess golden game was available, so the port is verified structurally (one window
per ply; `slice(i-ws+2, i+2)` always yields `ws` entries ending at the value after
move `i`) and pinned. Accuracy numbers moved as expected — recorded for audit:

| case | before | after |
|---|---|---|
| white, white-start | 96.8 | **95.7** |
| black, white-start | 90.3 | **89.6** |
| white, black-start | 95.9 | **95.0** |
| black, black-start | 94.2 | **95.4** |
| with ply 2 excluded | 99.6 | 99.6 |
| with ply 2 forced | 99.7 | **99.6** |

Two deviations kept and documented in the docstring: per-move accuracy still uses each
move's own `evalBefore`/`evalAfter` (two independent searches, which is *better* data
than consecutive entries of one series), and excluded/unrated plies carry the previous
series value forward rather than injecting their placeholder eval — that keeps the 1:1
ply→window mapping without fabricating a dead-equal point.

**Also documented-and-kept (F8 tail):** `playerAccuracy` still returns `100` when a
player has no rated move. `null` is more honest but `PlayerReview.accuracy` is typed
`number` and read by `ReviewSummaryCard` / `ReviewMovePanel`, which are outside this
change's file ownership.

**F9 — phase boundary collapse.** Now mirrors `Divider.scala` exactly:
`openingEndsAtPly = middlegameStart ?? plyCount`,
`middlegameEndsAtPly = endgameStart ?? plyCount`, and nothing else. Because
`endgameStart` is only ever set at or after `middlegameStart`, the same-ply collision
naturally produces an empty MIDDLEGAME band (upstream's behaviour) instead of an empty
ENDGAME band. Verified with a K+R-vs-K fixture: was `{opening: 1, middlegame: 3}` (50
plies of rook ending labelled Middlegame, Endgame row empty), now `{1, 1}`.

The invented 20-ply opening fallback is also gone — upstream's `openingSize = middle |
plies` means a game that satisfies no middlegame criterion is entirely opening.

**F10 — unscored plies.** `MoveReview.unscored?: boolean` added and set from
`isPlyUnscored`, so the flag now survives `reviewGame` and reaches persistence.
`EvalGraph` holds the previous eval across an unscored ply instead of plotting the
placeholder 0 (a dead-equal point in the middle of a decided game), suppresses its
key-moment dot, and captions it "not analysed". `isRatedMove` also excludes it, so it
can never reach a phase row or the rated set even if a caller forgets `excludePlyIndices`.
**Not done, files not mine:** `ReviewMoveList` / `ReviewMovePanel` still render an
unscored ply with a normal (usually green `best`) glyph — the flag is there for them now.

**F11 tail — plyIndex indexing.** `playerAccuracy` sorts by `plyIndex` and derives
colour from `plyIndex`, and `GameReviewService`'s `whiteMoves`/`blackMoves` filter on
`m.plyIndex` instead of array position. Byte-identical while `moveReviews` is dense;
pinned by a test where every White move scores 100 and every Black move collapses, so
a parity shift is immediately visible.

**test-audit §6 (items in my files only):** replaced
`expect(accuracyToGameRating(92, 8, 0, 0, 3)).not.toBeNull()` with the exact value
`1342`, and `expect(summary.accuracy).toBeGreaterThan(80)` with `82.1`. The three
remaining §6 items live in `gameStore.test.ts` / `blunderPuzzles.test.ts`, which belong
to plan Task 18.

**Result: 63/63 pass; `npx tsc --noEmit` exit 0, zero errors repo-wide.**

---

## For the lead — backend/zod changes I could not make

`backend/zodSchemas.ts` is owned by another agent. Two **new optional fields** must be
added or they will be silently stripped on `POST /api/review/save`, exactly like the
`reviewedNodeIds` loss in plan Task 6:

1. `gameReviewResultSchema`: `startingColor: z.enum(['w', 'b']).optional()`
   — note `'w' | 'b'`, not `'white' | 'black'` (matches the audit, `startingColorFromFen`
   and `playerAccuracy`'s existing parameter).
2. `moveReviewSchema`: `unscored: z.boolean().optional()`.

Also worth a follow-up ticket: the C6 tablebase slow-win `+10` / `+25` DTM bands now
execute for the first time (F3 made them reachable) and have never been validated
against real endgame data.


