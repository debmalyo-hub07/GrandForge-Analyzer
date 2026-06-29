---
name: grandforge-review
description: >
  Move-classification, accuracy, rating, and arrow-layer rules for the GrandForge
  review subsystem. Use when touching move classification (brilliant/great/book/
  miss/blunder etc), Win% deltas, the accuracy/rating curve, or the
  analysis/review/manual arrow layers. Encodes the verified thresholds and the
  C3 mate-miss blunder-promotion guard so they are not re-broken.
---

# GrandForge Review Rules

Verified against source on 2026-06-16. File:line refs are ground truth — an
external linter rewrites files on disk, re-check before trusting a number.

## 1. Classification inputs are white-relative Win%, made mover-relative

Classification works on `winBefore`/`winAfter` for the **mover**. `dw = winBefore
- winAfter` (drop in mover's win prob). Source: `src/utils/reviewUtils.ts`.
`winAfter` uses `cpAndMateToWin(evalAfter, mateAfter)` — no `1 -` inversion (that
was a fixed bug; the eval is already mover-relative at that point).

## 2. ΔWin thresholds (single table — do not duplicate)

`src/utils/reviewUtils.ts:205`:

```ts
const DELTA_WIN_THRESHOLDS = {
  near_best: 0.005,
  excellent: 0.02,
  good:      0.05,
  inaccuracy:0.10,
  mistake:   0.20,
  // > 0.20 = blunder
};
```

Ladder (lines 308-312): `near_best → best`, `≤0.02 → excellent`, `≤0.05 → good`,
`≤0.10 → inaccuracy`, `≤0.20 → mistake`, else `blunder`. `book` short-circuits
first (line 250). `brilliant`/`great`/`miss` are special cases gated above the
ladder.

Special-case constants:
```ts
MISS_WIN_BEFORE = 0.85;  MISS_WIN_AFTER = 0.60;
GREAT_WIN_BEFORE = 0.2;  GREAT_WIN_AFTER = 0.4;
BRILLIANT_WIN_BEFORE_MAX = 0.85;  BRILLIANT_WIN_AFTER = 0.6;
```

## 3. The C3 mate-miss blunder-promotion guard (do not remove)

Both miss paths promote to blunder when the swing is blunder-magnitude. A "miss"
is losing a winning edge, NOT a catastrophic collapse.

```ts
// C3 mate path (reviewUtils.ts ~276):
if (mateAfter !== null || winAfter >= 0.35) {
  if (dw > DELTA_WIN_THRESHOLDS.mistake) return 'blunder';
  return 'miss';
}
// winBefore>0.85 path (~304):
if (winBefore > MISS_WIN_BEFORE && winAfter < MISS_WIN_AFTER) {
  if (dw > DELTA_WIN_THRESHOLDS.mistake) return 'blunder';
  return 'miss';
}
```

Regression history: an earlier fix returned `miss` even when a mate drop collapsed
Win% by blunder magnitude (1.0→0.36, dw=0.64). The `dw > mistake` guard is the
correction. Keep both paths symmetric.

## 4. Rating cubic — monotone, cap 2700

`reviewUtils.ts:319+` CAPS-style cubic on accuracy + per-30-move incident penalty.
The cubic is monotone increasing on `[56,100]`, peaks ~2742 at a=100. Capped at
**2700** (line 353), not 2400 — near-perfect games must reach master range. The
"non-monotone" concern was a false positive (off-by-1000 arithmetic); R'(a)>0
everywhere. Do not "fix" monotonicity.

## 5. Arrow-layer isolation

`src/hooks/useArrowLayers.ts` — three independent hooks, merged only at render:

- `useEngineArrows` (line 46) — analysis-mode suggestion arrows.
- `useReviewArrows` (line 100) — best move (green) + played move (blue).
- `useManualArrows` (line 137) — user-drawn.

Critical dedup (line 122): when played === best, emit a **single green** arrow:
```ts
const sameMove = bestUci !== null && bestUci === playedUci;
...
if (playedUci && !sameMove) { /* blue */ }
```
Emitting green+blue with identical from/to crashes react-chessboard with
"Encountered two children with the same key, e2-e4". Layers must never write into
each other's state; manual annotations clear on navigation via
`gameStore.clearManualAnnotations()`.

## 6. Badge contrast

Classification badge backgrounds keep the recognizable chess.com palette; text
color is chosen per-background by `readableTextColor(bgHex)` in
`src/utils/boardUtils.ts` (WCAG AA, picks `#1a1a1a` or `#ffffff`). Do not hardcode
white text on badges — 8/10 colors fail AA against white. Tailwind `bg-*` classes
do NOT resolve for these badges; use inline `background: cfg.color`.
