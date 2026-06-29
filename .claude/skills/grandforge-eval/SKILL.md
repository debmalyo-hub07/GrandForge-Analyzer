---
name: grandforge-eval
description: >
  Evaluation normalization and evaluation-bar rendering rules for the GrandForge
  chess analysis app. Use whenever touching the eval bar, eval-to-win conversion,
  Stockfish score perspective, depth gating, or any "eval jumps/flips/snaps to
  center" bug. Encodes the white-centric perspective contract and the placeholder
  render failure mode so they are not re-derived or re-broken.
---

# GrandForge Evaluation Rules

Verified against source on 2026-06-16. File:line references are ground truth —
re-check them before relying on a number, an external linter rewrites files on disk.

## 1. Perspective contract — eval is ALWAYS white-centric

Stockfish reports score from the **side-to-move** perspective. GrandForge
normalizes to white-centric at the store boundary:

- `src/store/engineStore.ts:138` reads `turn` from FEN field 1 (`'b'` or `'w'`).
- Lines 148-149 negate when black to move:
  ```ts
  const rawCpForLine = info.cp !== null ? (turn === 'b' ? -info.cp : info.cp) : null;
  const mateForLine  = info.mate !== null ? (turn === 'b' ? -info.mate : info.mate) : null;
  ```

Rule: `+` always means white better, `-` always means black better, regardless of
whose turn it is. Board orientation is a **display** transform only
(`EvaluationBar.tsx` swaps `topPercent`/`botPercent` by `orientation`), never an
eval-sign transform. Never negate eval a second time downstream — that is the
"perspective flip" spike (white +0.5 → black +0.5 reads as a jump).

## 2. cp → Win% sigmoid (single source)

`src/utils/parseUCI.ts:evalToBarPercent` and `src/utils/reviewUtils.ts` share one
constant. Do not introduce a second slope.

```ts
const WIN_SLOPE = 0.00368208; // Lichess win-probability model
winPct = 50 + 50 * (2 / (1 + Math.exp(-WIN_SLOPE * cp)) - 1);
```

- Mate: `M…` pins to 99, `-M…` pins to 1 (not 100/0 — keep breathing room).
- Bar percent is clamped `[0.5, 99.5]`.
- Non-finite cp falls back to 50 (center) — see failure mode below.

## 3. Eval-bar placeholder render failure mode (the "snap to center" spike)

The bar reads `engineStore.evalFormatted`. Three sites overwrite it on position
change BEFORE the first valid engine result:

- `engineStore.ts:225` (`updatePosition`): `evalFormatted: fenChanged ? '' : keep`
  → empty string → `EvaluationBar` renders the `-` placeholder branch.
- `engineStore.ts:243` (`startGame`): `evalFormatted: '0.00'`
  → renders a **real-looking bar at 50% center**. This is the visible collapse.
- `engineStore.ts:259`: `''` again.

Rule for any eval-bar stability work (matches CLAUDE.md audit intent):

1. Never render `''`, `0`, `0.00`, `null`, or `undefined` as a real evaluation.
   Hold the **previous** eval until the first valid result for the new position.
2. Depth-gate the bar: ignore depth 1-3 for the bar display (unstable), keep
   processing lines internally. A `MIN_RENDER_DEPTH = 4` style gate is the fix.
3. Keep the existing `transition={{ duration: 0.3 }}` framer-motion height
   animation — that smooths legitimate changes. The spike is bad *input*, not bad
   animation.

## 4. Single owner

`evalFormatted` is owned by `engineStore` only. `reviewStore`, `uiStore`,
`gameStore` must not write it. Review mode is gated out of engine writes
(`engineStore.ts:218` returns early while `progress.phase === 'analyzing'`).
