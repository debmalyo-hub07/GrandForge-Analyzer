# Game-Review Scoring Pipeline — Audit

Scope: `frontend/src/services/GameReviewService.ts`, `frontend/src/utils/reviewUtils.ts`
(+ `reviewUtils.test.ts`), `frontend/src/types/review.ts`, `frontend/src/store/reviewStore.ts`,
`frontend/src/services/positionCache.ts`, `frontend/src/services/tablebase.ts`.
Read-only audit — no source file was modified.

Working-tree state at audit time: uncommitted changes introduce a `forced` classification.
`npx tsc --noEmit` fails with 5 `TS2741` errors (verified, output quoted in F2).

Reference bar: chess.com Game Review (11 labels, expected-points, rating-sensitive) and
Lichess accuracy math. Two upstream sources were fetched live during this audit and are
quoted where they settle a question:

- `scalachess/core/src/main/scala/Divider.scala` (phase detection).
- `lila/modules/analyse/src/main/AccuracyPercent.scala` (game accuracy).
- `https://tablebase.lichess.ovh/standard?fen=4k3/6KP/8/8/8/8/8/8_w_-_-_0_1` (live response,
  settles the per-move perspective question in F1).

Findings are ordered most-severe first.

---

## F1 — CRITICAL: `Brilliant` is mathematically unreachable

**Where:** `frontend/src/utils/reviewUtils.ts:680-704` (`netMaterialSacrifice`,
`isTruePieceSacrifice`), called from `frontend/src/services/GameReviewService.ts:396-397`.

**Defect.** `netMaterialSacrifice(fenBefore, fenAfter)` measures material across a **single
ply** — the mover's own move:

```
const moverLoss = moverBefore - moverAfter;   // reviewUtils.ts:694
const captured  = oppBefore - oppAfter;       // reviewUtils.ts:696
return moverLoss - captured;                  // reviewUtils.ts:699
```

A player can never lose material on their *own* move. `moverAfter >= moverBefore` always
(equal for a normal move, strictly greater after a promotion), so `moverLoss <= 0`. And
`captured >= 0`. Therefore `moverLoss - captured <= 0` for **every legal move in chess**, and
`isTruePieceSacrifice` (`>= 2`, reviewUtils.ts:703) always returns `false`.

`isMaterialSacrifice` is consequently always `false` at `GameReviewService.ts:396`, and the
Brilliant gate at `reviewUtils.ts:327-334` requires it. **No game can ever produce a
`brilliant` classification.** `MoveReview.isBrilliant` (`GameReviewService.ts:485`) is
therefore always `false` too.

**Failure scenario.** Black plays the classic Greek-gift-style sac Bxh7+. Before: mover has
B(3) among their material; after: the bishop is still on h7, so `moverLoss = 0`, and the
captured pawn gives `captured = 1`. Net = `-1`. Not `>= 2`. The move is graded on the plain
ΔWin ladder and shows as `best`/`excellent`. The same holds for Qxh7+, Rxf7, Nd5, every
positional exchange sac — the sacrificed piece is only *lost* on the opponent's reply ply,
which this function never looks at.

**Suggested fix.** Measure the sacrifice across the reply, or against the alternative:
compare `fenPositions[ply]` with `fenPositions[ply + 2]` (material after the opponent's
best reply), or run the engine PV two plies deep from `fenBefore` and diff material along it.
A cheaper approximation used by several open implementations: a move is a sacrifice if the
moved piece lands on a square defended by the opponent and is worth more than the exchange it
initiates (static exchange evaluation < 0) while the engine eval holds. Whichever route, the
function must see at least the opponent's recapture. Add a unit test with a real sacrifice
FEN pair — there is currently no test for this function at all (see F16).

---

## F2 — CRITICAL: `forced` is only half-wired; typecheck is red and three runtime paths break

The uncommitted work adds `'forced'` to `MoveClassification` (`types/review.ts:9`) and to
`classifyMove` (`reviewUtils.ts:320`), but the union member was not propagated everywhere.
Complete enumeration of every site that must learn about `forced`:

### 2a. Compile errors (5, blocking) — verified `npx tsc --noEmit` output

| Site | Symbol | Error |
|---|---|---|
| `frontend/src/utils/boardUtils.ts:5` | `REVIEW_COLORS: Record<MoveClassification, string>` | TS2741 `'forced'` missing |
| `frontend/src/utils/boardUtils.ts:18` | `REVIEW_GLYPHS: Record<MoveClassification, string>` | TS2741 |
| `frontend/src/utils/pgnUtils.ts:9` | `NAG_BY_CLASSIFICATION: Record<MoveClassification, string>` | TS2741 |
| `frontend/src/components/review/ReviewMoveGlyph.tsx:30` | `GLYPH: Record<MoveClassification, string>` | TS2741 |
| `frontend/src/components/review/ReviewMoveGlyph.test.ts:28` | `counts` fixture literal | TS2741 |

Note the asymmetry inside one file: `ReviewMoveGlyph.tsx:44` **did** gain
`forced: '#a88850'` in `GLYPH_COLOR`, but the sibling `GLYPH` record at line 30 did not.
Already-updated records (no action needed): `ReviewSummaryCard.tsx:13`,
`ReviewMoveList.tsx:15`, `ReviewMovePanel.tsx:21`.

For `pgnUtils.ts` the value matters, not just the key: `forced` has no PGN NAG. Emitting
`$1`/`$5` would annotate a forced recapture as a good move in exported PGN. Use an empty
string and make the emitter skip empty NAGs.

### 2b. `counts` record silently omits `forced` — renders a phantom row

`frontend/src/services/GameReviewService.ts:520-523`:

```ts
const counts = Object.fromEntries(
  ['brilliant', 'great', 'book', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder']
    .map((k) => [k, scored.filter((m) => m.classification === k).length]),
) as Record<MoveClassification, number>;
```

Ten literals, eleven union members. The `as` cast suppresses the very error that the new
`ALL_CLASSIFICATIONS` export (`types/review.ts:24-33`) was added to catch — and
`ALL_CLASSIFICATIONS` is **imported nowhere**, so its `AssertExhaustive` guard protects
nothing today.

Failure scenario: `counts.forced` is `undefined`. `ReviewSummaryCard.tsx:124-126` reads
`result.white.counts[key]` for every key of `CLASSIFICATION_CONFIG` (which now has 11 keys)
and skips a row with `if (wCount === 0 && bCount === 0) return null;`. `undefined === 0` is
`false`, so the row is **never** skipped: every review — including games with zero forced
moves — renders a permanent `— Forced —` row with em-dashes in both count cells.
`counts.forced` is also `undefined` in the JSON persisted to MongoDB.

Fix: `Object.fromEntries(ALL_CLASSIFICATIONS.map((k) => [k, scored.filter(...).length]))` and
drop the `as` cast (use a typed accumulator so the exhaustiveness guard is load-bearing).

### 2c. Backend Zod enum rejects `forced` — review persistence 400s, silently

`backend/zodSchemas.ts:105-116` — `moveClassificationSchema` lists the same ten labels, no
`forced`. It gates `moveReviewSchema.classification` (line 122), `phaseReviewSchema.icon`
(line 141), and `playerReviewSchema.counts` as a `z.record` **key** schema (line 149).

Consumers: `POST /api/review/save` via `reviewSaveSchema` (`zodSchemas.ts:167-176`) and
`backend/routes/sessions/[id].ts:32`.

Failure scenario: any game containing a single forced move (a forced recapture, a king walk
out of a double check — common in almost every decisive game) produces a `moveReviews[]`
entry with `classification: 'forced'`. The save request fails Zod validation with 400. The
call site swallows it — `frontend/src/components/review/ReviewTab.tsx:140-144`:

```ts
try { await reviewApi.save({ gameId: game._id, reviewResult }); } catch { /* best-effort */ }
```

The user sees "Review complete", the review is never persisted, and reloading the game loses
it. No log, no toast.

Fix: add `'forced'` to `moveClassificationSchema`. Better, derive the backend enum from a
single shared list so frontend and backend cannot drift again; at minimum add a backend unit
test asserting the enum's members equal `ALL_CLASSIFICATIONS`, and stop swallowing the save
error (log it / surface a non-blocking toast).

### 2d. Non-blocking but incomplete

- `frontend/src/hooks/useArrowLayers.ts:53-54` — `default:` returns `REVIEW_ARROW_GREEN`, so a
  forced move draws a *green (good)* review arrow. Should be neutral/grey.
- `frontend/src/components/review/EvalGraph.tsx:14-22` — key-moment dot palette has no
  `forced` entry. Correct by omission (forced moves shouldn't be key moments), but it is an
  untyped partial record, so it will not tell you when that assumption changes.
- `frontend/src/pages/LearnClassificationsPage.tsx:5-16` — the public `/learn/move-classifications`
  ladder lists 10 labels. Users see a `→ Forced` badge in the app that the docs page never
  explains. Add the row.
- `frontend/src/utils/blunderPuzzles.ts:23-27` — `PUZZLE_CLASSES` correctly excludes `forced`.
  No change needed.
- `backend/models/Game.ts:7` types `classification: string` — permissive, no change needed.

---

## F3 — HIGH: tablebase per-move `category`/`dtm` are read with the wrong perspective

**Where:** `GameReviewService.ts:176-196` (top-2 win computation and `tbMoves` map),
`GameReviewService.ts:432-458` (the C6 slow-win override), `GameReviewService.ts:611-618`
(`tbMoveScore`).

**Defect.** The code treats each entry of `TablebaseResult.moves[]` as if its `category` and
`dtm` were **mover-relative**, the same convention as the top-level `category`. They are not:
a move's category is reported from the perspective of the side to move **after** the move.

Live evidence — `GET https://tablebase.lichess.ovh/standard?fen=4k3/6KP/8/8/8/8/8/8 w - -`:

```
top level:  "category": "win",  "dtz": 1,   "dtm": 15
moves[0]:   "uci": "h7h8q",     "category": "loss", "dtz": -14, "dtm": -14
moves[1]:   "uci": "g7f6",      "category": "loss", "dtz": -2,  "dtm": -14
```

The position is won for White; White's best move (promoting with check) is reported as
`"loss"` with negative `dtm` — a loss for Black, who moves next. `tablebase.ts:163-181`
(`tablebaseToScore`) applies to the *top-level* result and is correct. Only the per-move
reads are inverted.

**Consequences, all of them silent:**

1. `GameReviewService.ts:177-180` — in a won endgame, `bestWin` and `secondWin` both come out
   `0.0` (category `'loss'` → `mate: -dtmAbs` → `cpAndMateToWin` → 0.0). In a lost endgame
   both come out `1.0`.
2. `isSingularChoice` (`GameReviewService.ts:391-393`) is `topMoveWin - secondMoveWin > 0.05`
   — always `0 - 0` or `1 - 1`, i.e. **never true in any tablebase position**. `great` is
   unreachable for every ≤7-piece endgame.
3. `complexity` (`GameReviewService.ts:489-492`) is `max(0, topMoveWin - secondMoveWin)` —
   always `0` for tablebase plies, so endgame sharpness never feeds the complexity bonus in
   `accuracyToGameRating`.
4. The entire C6 override at `GameReviewService.ts:432-458` is **dead code**. Its trigger is
   `wasWin = bestTb.category === 'win'` (line 439). In a genuinely won position `moves[0].category`
   is `'loss'`, so `wasWin` is `false` and the block never runs. In a *lost* position `wasWin`
   is `true`, but `moves` are sorted best-first for us (longest resistance first), so
   `|playedTb.dtm| > |bestTb.dtm| + 10` (line 446) can never hold either.

**Failure scenario.** A KRP vs KR endgame reached at move 45. The player is winning
(`category: "win"`, DTM 22) and plays a move that keeps the win but pushes DTM to 68 — a
46-ply conversion regression that chess.com grades as an inaccuracy/mistake. Here: top-level
Win% is 1.0 both before and after, ΔWin is 0, the C6 override never fires, and the move is
labelled `best`. Conversely a move that throws the win away into a draw ΔWin-drops from 1.0 to
0.5 and is caught by the plain ladder as a blunder — so the *only* thing C6 was written to
catch is precisely what it fails to catch.

**Suggested fix.** Normalize on ingestion, in one place. When building the `tbMoves` map at
`GameReviewService.ts:181-184` (and `best`/`second` at 177-180), invert each move to the
mover's perspective: `win ↔ loss`, `cursed-win ↔ blessed-loss`, `maybe-win ↔ maybe-loss`,
`draw` unchanged, and negate `dtz`/`dtm`. Best done as an exported helper in `tablebase.ts`
(e.g. `moveToMoverPerspective(m)`) next to `tablebaseToScore`, with a unit test using the
literal JSON above as the fixture. After the fix, re-check the C6 thresholds — `wasWin` will
start firing for the first time, so the +10/+25 DTM bands are effectively unvalidated.

Secondary note, same block: `GameReviewService.ts:432` guards on `!isBookMove` but not on
`isForced`, so once C6 is alive it can overwrite a `forced` label. Add `&& !isForced`.

---

## F4 — HIGH: forced-mate horizon produces spurious `miss` on the engine's own top move

**Where:** `reviewUtils.ts:342-354` (the C3 block).

```ts
if (
  mateBefore !== null && mateBefore > 0 &&
  (mateAfter === null || (mateAfter > 0 && mateAfter > Math.abs(mateBefore) + 2))
) {
  if (mateAfter !== null || winAfter >= 0.35) {
    if (dw > DELTA_WIN_THRESHOLDS.mistake) return 'blunder';
    return 'miss';
  }
}
```

**Defect.** The `mateAfter === null` arm fires whenever the engine reported a mate score
*before* the move but a plain cp score *after* it. That is the normal behaviour of a
fixed-depth search near the mate horizon, and it happens even when the player plays the
engine's number-one move. `isBestMove` is never consulted in this block.

**Failure scenario.** Depth-18 review. At ply N the engine returns `mate 8`; the player plays
the engine's top move; at ply N+1 the remaining mate is 7 plies deeper than the horizon and
the engine returns `cp 2800` instead. Then `mateBefore = 8`, `mateAfter = null`,
`winBefore = 1.0`, `winAfter ≈ 0.99`, `dw ≈ 0.01` → not `> 0.20` → the block returns `'miss'`.
The player is told they missed a forced win on the single strongest move on the board. This
recurs on nearly every ply of a long mating sequence, and each one also inflates
`missCount`, which carries a `missRate * 200` penalty in `accuracyToGameRating`
(`reviewUtils.ts:443`) — a clean mating attack can cost several hundred rating points.

**Suggested fix.** Require actual evidence that the win degraded before calling it a miss:
skip the block when `isBestMove` is true, and require a meaningful Win% drop
(`dw > DELTA_WIN_THRESHOLDS.good`) or a categorical loss of the win
(`winAfter < 0.90`) for the `mateAfter === null` arm. The `mateAfter > |mateBefore| + 2` arm
is sound and can stay as-is. Add unit tests for both arms — neither is covered today.

---

## F5 — HIGH: `deltaWin` is a free parameter, so Great's rating calibration is dead code

**Where:** `reviewUtils.ts:284-300` (`ClassifyMoveParams`), `reviewUtils.ts:364-373` (the C1
Great block), producer at `GameReviewService.ts:411`.

**Defect.** `classifyMove` accepts `winBefore`, `winAfter` **and** `deltaWin` as three
independent inputs, with no invariant enforced between them. The only production caller
computes `const deltaWin = Math.max(0, winBefore - winAfter);` (`GameReviewService.ts:411`).

All three Great gates (`reviewUtils.ts:367-369`) require `winAfter > winBefore`:

- `lostToEqual`: `winBefore < 0.35 && winAfter >= 0.45 && swing > 0.15`
- `equalToWinning`: `winBefore in [0.35, 0.7) && winAfter > 0.7 && swing > 0.2`
- `losingToWinning`: `winBefore < 0.2 && winAfter > 0.4`

In that region `Math.max(0, winBefore - winAfter)` is **exactly 0**, so
`isGreatEquivalent = isBestMove || dw <= greatDropLimit(playerRating)`
(`reviewUtils.ts:364`) is unconditionally `true`. `greatDropLimit` (`reviewUtils.ts:273-282`)
and the rating bands it reads are never consulted in production. The documented behaviour
("rating-calibrated near-best play", `reviewUtils.ts:224-226` and `358-363`) does not exist.

The same free-parameter design lets the tests assert impossible states — see F16.

**Failure scenario.** A 900-rated player and a 2600-rated player play the identical
losing→winning resource. The comment block and the CLAUDE.md spec promise the master gets a
stricter bar. Both receive `great`. Only `isSingularChoice` discriminates, and per F3 that is
already always `false` in endgames.

**Suggested fix.** Derive `deltaWin` inside `classifyMove` from `winBefore`/`winAfter` and
remove it from `ClassifyMoveParams` (or keep it optional and assert it matches in dev). Then
re-express the Great tolerance against something that varies in the swing region — e.g. how
far the played move's resulting Win% is below the engine top move's
(`before.topMoveWin` is already computed at `GameReviewService.ts:299` but is never passed to
`classifyMove`). Passing `topMoveWin`/`secondMoveWin` through would make both Great and
Brilliant calibration meaningful and would give the "engine-equivalent" language in the
comments an actual referent.

---

## F6 — HIGH: book detection is off by one ply, suppressing the first out-of-book move

**Where:** `frontend/src/components/review/useOpeningBookFens.ts:67-77`, consumed at
`GameReviewService.ts:328`.

**Defect.** The ECO endpoint is well-behaved: `backend/routes/openings/lookup.ts:57-60`
explicitly verifies the matched `moveSequence` is a true prefix of the input, so
`matchedPlies` is exactly the number of confirmed theory plies. The FEN set built from it is
one entry too long:

```ts
const root = moveTree.nodes[mainline[0]];
if (root?.fen) fens.add(root.fen);                                   // position after 0 plies
for (let i = 1; i <= matchedPlies; i++) { ... fens.add(node.fen); }  // after 1..matchedPlies
```

That is `matchedPlies + 1` positions. `isBookMove` is `openingBookFens.has(fenBefore)` where
`fenBefore = fenPositions[ply]` is the position the move was played *from*, so moves at
plyIndex `0 .. matchedPlies` are flagged book — one more than the `matchedPlies` moves that
are actually theory. Move `matchedPlies` (0-based) is by definition the **first move out of
book**, and it is being labelled `book`.

**Failure scenario.** ECO matches `e4 e5` (`matchedPlies = 2`). White's third move is played
from the after-`e5` position, which is in the set, so `3.Qh5` is classified `book`. Because
book moves are excluded from the accuracy series (`reviewUtils.ts:164`), from `ratedMoves`
(`GameReviewService.ts:526`), and from phase scoring (`reviewUtils.ts:484`), a genuine
opening blunder is silently removed from the score entirely. This happens once per game,
every game.

**Suggested fix.** `for (let i = 1; i < matchedPlies; i++)` — or, clearer, build the set from
the positions after `0 .. matchedPlies - 1` plies and drop the special-cased root add. Add a
unit test for the hook's index arithmetic; there is none.

**Two further book issues in the same file:**

- `useOpeningBookFens.ts:26,29` — `cacheRef` is a `useRef` with no invalidation and no
  dependency on game identity. `ReviewTab` is not remounted when a new game is loaded into the
  move tree, so **reviewing game B reuses game A's book FEN set**. Because the set is matched by
  exact FEN string this usually degrades to "no book moves detected" for game B, but if the two
  games share an opening prefix it mislabels. Fix: key the cache on the mainline SAN sequence,
  or invalidate it from `resetTransientStateForNewGame`.
- `useOpeningBookFens.ts:31-32` builds the SAN sequence from `getMainlinePath(moveTree)` while
  the review runs on whatever line was passed to `buildIndexedGameFromTree`. Today
  `ReviewTab.tsx:92` always passes the mainline leaf so the two agree, but variation review is a
  documented capability — the moment a variation is reviewed, book detection reads the wrong
  line. Fix: pass the reviewed node path into the hook.

---

## F7 — MEDIUM-HIGH: `forced` moves are excluded from accuracy but still counted as rated moves

**Where:** `GameReviewService.ts:526-536` vs `reviewUtils.ts:164` and `reviewUtils.ts:484`.

`playerAccuracy` skips forced moves (`reviewUtils.ts:164`,
`if (m.isBookMove || m.classification === 'forced') continue;`) and `phaseSummary` skips them
(`reviewUtils.ts:484`, `!m.isBookMove && m.classification !== 'forced'`). The player-level
rated set does not:

```ts
const ratedMoves = scored.filter((m) => !m.isBookMove);   // GameReviewService.ts:526
```

**Consequences.** Forced moves contribute their CPL to `avgCpl` (lines 527-529), their
`complexity` to `avgComplexity` (lines 530-532), and inflate `ratedMoves.length`, which is the
`moveCount` denominator passed to `accuracyToGameRating` (line 555) and the input to
`gameRatingConfidence` (line 560).

**Failure scenario.** A short game ending in a forced king walk out of a double check. The
forced move's CPL is large — the position collapsed *before* the move and the mover had no
choice. It is excluded from accuracy, so accuracy stays high, but it drags `avgCpl` up and
`accuracyToGameRating` charges `Math.max(0, cpl - 10) * 2.0` (`reviewUtils.ts:441`) against a
move that had no alternative. Separately, the Opening/Middlegame/Endgame `moveCount` values
shown in `ReviewSummaryCard` no longer sum to the rated-move count behind the game rating,
because the phase rows exclude forced moves and the rating denominator does not.

**Suggested fix.** One shared predicate — e.g. `isRatedMove(m)` in `reviewUtils.ts` returning
`!m.isBookMove && m.classification !== 'forced'` — used at all three sites (`playerAccuracy`,
`phaseSummary`, `GameReviewService.ts:526`). That also stops the next non-rated label repeating
this.

---

## F8 — MEDIUM: `playerAccuracy` volatility windows deviate from the Lichess algorithm

**Where:** `reviewUtils.ts:141-191`.

The port's own comment (`reviewUtils.ts:135-137`) asserts "Lichess computes windowSize and the
sliding stdev window over the player's own cp-series, not the interleaved two-color sequence."
The upstream source says the opposite.

`lila/modules/analyse/src/main/AccuracyPercent.scala`:

```scala
val allWinPercents = (Some(Cp.initial) :: cps).map(_.map(WinPercent.fromCentiPawns))
val windowSize = (cps.size / 10).squeeze(2, 8)
val windows = List.fill(windowSize.atMost(allWinPercents.size) - 2)(allWinPercents.take(windowSize))
  ::: allWinPercents.sliding(windowSize).toList
```

`allWinPercents` is the whole-game **interleaved** series; colours are separated afterwards by
index parity (`(i % 2 == 0) == startColor.white`). Three concrete divergences:

1. **Window size is roughly halved.** Upstream `cps.size` is the full ply count; the port uses
   `colorSeries.length` (`reviewUtils.ts:177`), which is per-colour, so about half. For a
   60-ply game upstream gets `clamp(6, 2, 8) = 6`; the port gets
   `clamp(floor(31/10) = 3, 2, 8) = 3`. Narrower windows give smaller standard deviations, which
   push more weights onto the `0.5` floor (`WEIGHT_MIN`, line 108) and flatten the volatility
   weighting the algorithm exists to apply.
2. **Window contents differ.** Upstream windows span both players' evals, so a weight reflects
   the sharpness of the position including the opponent's swings. The port's windows hold only
   one player's before-move Win% values, which are much smoother.
3. **Leading-window padding is missing.** Upstream prepends `windowSize - 2` copies of the first
   window so early moves get full-width windows. The port truncates instead
   (`lo = Math.max(0, idx - window + 1)`, `reviewUtils.ts:185`), so the first moves get
   degenerate 1-2 element windows and therefore near-floor weights.

**Failure scenario.** A sharp 40-ply game where both sides trade blows. Upstream weights the
volatile middlegame moves up to 12x; the port's narrower single-colour windows keep most weights
near the floor, so the weighted mean converges toward a plain arithmetic mean and the reported
accuracy drifts from what Lichess reports for the same PGN. The number is self-consistent but
not comparable to the reference bar, which is the stated goal.

**Suggested fix.** Build one interleaved White-relative Win% series over all plies (the port
already computes the White-relative flip at `reviewUtils.ts:155-161`), take `windowSize` from
the full ply count, build windows over that series with the `windowSize - 2` leading pad, then
select per colour by parity. Pin the result with a golden test against a known
Lichess-analysed game.

**Related, same function:** `reviewUtils.ts:172` returns `100` when a player has no rated
moves, so a player whose every move was book or forced is reported at 100.0% accuracy. Prefer
`null` (or an explicit "not enough data", as `gameRating` already does).

---

## F9 — MEDIUM: `computePhaseBoundaries` loses the endgame phase when middlegame and endgame start on the same ply

**Where:** `reviewUtils.ts:618-644`.

Upstream `scalachess/core/src/main/scala/Divider.scala`:

```scala
Division(
  Ply.from(midGame.filter(m => endGame.fold(true)(m < _))),   // midGame dropped if m >= endGame
  Ply.from(endGame),
  Ply(boards.size)
)
```

When both trigger at the same index, upstream reports **no middlegame** and an endgame starting
there. The port does the reverse (`reviewUtils.ts:641-642`):

```ts
let middlegameEndsAtPly = endgameStart ?? plyCount;
if (middlegameEndsAtPly <= openingEndsAtPly) middlegameEndsAtPly = plyCount;
```

`endgameStart === middlegameStart` makes `middlegameEndsAtPly = plyCount`, so
`endgameMoves = scored.filter((m) => m.plyIndex >= middlegameEndsAtPly)`
(`GameReviewService.ts:540`) is empty.

**Failure scenario.** A line where a queen trade on move 12 drops `majorsAndMinors` from 12
straight to 6 — both conditions fire on the same board. The remaining 50 plies of a pure rook
endgame are all labelled **Middlegame** and the Endgame row shows "No rated moves". The user's
endgame technique is invisible in the summary.

**Suggested fix.** Mirror upstream: when `endgameStart !== null && middlegameStart >= endgameStart`,
treat the middlegame as absent (`openingEndsAtPly = endgameStart`, empty middlegame band) rather
than discarding the endgame.

**Secondary divergence, same function:** `reviewUtils.ts:640`,
`openingEndsAtPly = middlegameStart ?? Math.min(plyCount, 20)`. Upstream's
`openingSize = middle | plies` — with no middlegame detected the *whole game* is opening. The
invented 20-ply fallback splits a game that never left the opening by the material/development
criteria. Low impact, but it is an undocumented deviation from the cited source.

**Verified correct — no action.** The `mixedness` score table at `reviewUtils.ts:593-611` is an
exact match for upstream `Divider.score` on all thirteen non-zero cases, and the
`const y = 7 - yTop` mapping (`reviewUtils.ts:590`) correctly translates the port's
rank-8-first board indexing to upstream's `val y = i / 7 + 1` (1..7, White's home rank = 1).
`majorsAndMinors` (`reviewUtils.ts:552-562`) matches `occupied & ~(kings | pawns)`, and
`backrankSparse` (`reviewUtils.ts:564-568`) matches
`firstRank & white < 4 || lastRank & black < 4`. Both loop ranges (0..6 x 0..6) match. The
earlier `6 - yTop` mis-transcription noted in project history is genuinely fixed.

---

## F10 — MEDIUM: unscored plies are excluded from aggregates but still shown as graded moves

**Where:** `GameReviewService.ts:294-304` (placeholder entry), `:353-356` (`unscoredPlies`),
`:473-494` (the `MoveReview` is pushed regardless), `types/review.ts:46-64`.

The REV-4 work correctly keeps engine failures out of accuracy, CPL, complexity, counts and
phase rows. It does not keep them out of the move-level output. When the engine yields nothing
twice, `entry.win` is set to the neutral placeholder `0.5` (`GameReviewService.ts:279`) and
`cp`/`mate` to `null` (`:295-296`), but a full `MoveReview` is still pushed with a real
`classification`, `cpl` and `reason`. `MoveReview` has **no `unscored` flag**, so no consumer
can tell.

**Failure scenario.** The worker stalls on ply 31 of a 60-ply game. `winBefore = 0.5`,
`winAfter = 1 - 0.5 = 0.5`, `deltaWin = 0`, so the move is labelled **`best`** with reason
"Engine top move" and an empty `bestMoveUci`. `ReviewMoveList` shows a green star.
`EvalGraph` plots `evalAfter = 0` — a flat dead-equal point in the middle of a decided game,
visibly wrong. `buildBlunderPuzzles` skips it only incidentally, via the empty-`bestMoveUci`
guard at `blunderPuzzles.ts:41`.

**Suggested fix.** Add `unscored?: boolean` to `MoveReview`, set it from `isPlyUnscored`, and
have `ReviewMoveList` / `ReviewMovePanel` / `EvalGraph` render an explicit "not analysed" state
(skip the graph segment, grey glyph) instead of a fabricated `best`. `unscoredPlies` is
currently a local `Set` that never leaves `reviewGame`, so the information is lost the moment
the function returns — including from the persisted result.

---

## F11 — MEDIUM: `GameReviewResult` carries no starting colour, so `EvalGraph` inverts black-to-move games

**Where:** `types/review.ts:86-106` (no `startingColor` field),
`frontend/src/components/review/EvalGraph.tsx:25-29`.

`GameReviewService` derives `startingColor` from `fenPositions[0]`
(`GameReviewService.ts:152`) and threads it into `playerAccuracy` and the `moverIsWhite`
filters — correctly, including for black-to-move starts. It is never stored on the result, so
`EvalGraph` has to guess:

```ts
const moverIsWhite = m.plyIndex % 2 === 0;   // EvalGraph.tsx:26
```

**Failure scenario.** A position imported from a FEN with black to move, or any puzzle-style
game. Every point on the evaluation graph is sign-flipped: White's winning position is drawn as
Black's. The same guess would break any future consumer, and a persisted review reloaded from
MongoDB cannot recompute accuracy correctly because the field it needs was never saved.

**Suggested fix.** Add `startingColor: 'w' | 'b'` to `GameReviewResult` (and to
`gameReviewResultSchema` in `backend/zodSchemas.ts`, optional for legacy rows), set it at
`GameReviewService.ts:569-583`, and read it in `EvalGraph.whiteCpAfter`.

**Related fragility:** `playerAccuracy`'s `moverIsWhite(i)` uses the **array index** into
`moveReviews` (`reviewUtils.ts:125-126`) while `isExcluded(i)` uses `moveReviews[i].plyIndex`
(`:131-132`). These agree only because `moveReviews` is dense with `plyIndex === i`.
`whiteMoves` / `blackMoves` at `GameReviewService.ts:510-511` share the assumption. Index on
`plyIndex` throughout so the functions stay correct if a future change ever skips pushing a ply
(which F10's fix might).

---

## F12 — MEDIUM: `sf18-lite-mt` silently disables the position cache; a stale duplicate schema hides it

**Where:** `GameReviewService.ts:153-154`, `backend/routes/positions/cache.ts:23`,
`backend/zodSchemas.ts:182-207`.

```ts
const engineVersion = (this.engine.getVersion() ?? 'sf18-lite') as
  'sf18-lite' | 'sf17-lite' | 'sf16-lite';
```

`EngineVersion` has four members — `ENGINE_CONFIGS` at `EngineManager.ts:22` includes
`'sf18-lite-mt'`. The cast is a lie and it propagates into `CachePayload.engineVersion`
(`positionCache.ts:106`), whose server-side validator (`backend/routes/positions/cache.ts:23`)
enumerates only `['sf18-lite', 'sf18-full', 'sf17-lite', 'sf16-lite']`.

**Failure scenario.** A user picks the multi-threaded engine — the fastest option, so the
natural choice for review — and runs a 60-ply review. Every one of the ~61
`POST /api/positions/cache` calls returns 400 `Invalid request body`, and `pushCachedEval`
swallows it (`positionCache.ts:129-131`). Nothing is written to the federated cache, so every
later review of those positions re-runs the full search. The read path is unaffected
(`backend/routes/positions/eval.ts:30-32` does not validate the engine string) but can never
hit, because nothing was ever written under that key.

**Suggested fix.** Add `'sf18-lite-mt'` to the route enum and widen the cast to the real
`EngineVersion` union — or map MT to `'sf18-lite'` deliberately, since the two share a network
and produce interchangeable evals. That is arguably the better cache key, but it should be an
explicit mapping, not a cast. `'sf18-full'` in the enum is dead (the build was dropped per
CLAUDE.md).

**Dead duplicate:** `backend/zodSchemas.ts:182-207` defines `positionEvalQuerySchema` and
`positionCacheSchema`, neither imported anywhere (verified by repo-wide grep).
`positionCacheSchema` describes a payload shape (`evaluation: { cp, mate }`,
`lines: [{ multipv, cp, mate, pv }]`) that does **not** match what the client sends
(`evaluation: { type, value }`, `lines: [{ multipv, eval: { type, value }, pv }]`,
`positionCache.ts:111-116`). The live route defines its own, correct schema. Delete both dead
exports: as written they are a trap for whoever wires them up next, and would reintroduce
exactly the silent key-stripping corruption that the comment at
`backend/routes/positions/cache.ts:68-71` warns about.
