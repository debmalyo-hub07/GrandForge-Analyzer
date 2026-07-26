# Piece Sets

This directory holds piece set SVGs for the GrandForge board. Each subdirectory contains 12 SVGs:

```
wK.svg wQ.svg wR.svg wB.svg wN.svg wP.svg
bK.svg bQ.svg bR.svg bB.svg bN.svg bP.svg
```

## Current state

The committed SVGs are **placeholder unicode-glyph renders** so the board has something to display in development. They are deliberately minimal so the build is self-contained.

## Replacing with real piece sets

Replace each set directory with the production SVGs from the upstream sources:

| Set        | Upstream / License                                                        |
| ---------- | ------------------------------------------------------------------------- |
| `cburnett` | Wikipedia / Colin M.L. Burnett — CC BY-SA 3.0                             |
| `neo`      | Lichess (lila) `public/piece/cburnett` derivatives or your own commission |
| `classic`  | Public domain / staunton-style                                            |
| `alpha`    | Eric Bentzen — free for non-commercial                                    |
| `cardinal` | Lichess piece set                                                         |
| `merida`   | Armando H. Marroquin — free                                               |

Lichess maintains a curated mirror of common piece sets at:
https://github.com/lichess-org/lila/tree/master/public/piece

Drop the 12 SVG files into each directory using the exact filenames above. No code changes needed — `ChessBoardWrapper.tsx` builds the `customPieces` map dynamically from the `path` field in `src/types/themes.ts`.

## Per the spec (§27)

Cburnett piece set requires attribution: "CBurnett piece set by Colin Burnett". This is rendered in the app footer.
