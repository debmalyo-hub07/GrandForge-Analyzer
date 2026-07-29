// scripts/data/openingTheory/index.ts
//
// GrandForge's own opening theory. Every `text` here is written for this
// platform: plain-language explanation of what the line is trying to do, what
// the resulting positions feel like, and what a club player should watch for.
// Nothing is copied from, adapted from, or derived from another site's opening
// articles, books, or databases.
//
// `moves` is the join key. It must match `Opening.moveSequence` exactly —
// space-separated SAN with move numbers stripped, exactly as
// `scripts/seedOpenings.ts` builds it from the CC0 ECO catalogue. The names and
// move sequences themselves come from that catalogue (public domain); the prose
// does not.
//
// Adding an entry: append it to the file for its ECO letter, then run
// `npx vitest run scripts/data/openingTheory.test.ts`. The test replays every
// move sequence on a real board, so a typo in `moves` fails loudly instead of
// silently attaching prose to a line no reader will ever open.

import { OPENING_THEORY_A } from './a';
import { OPENING_THEORY_B } from './b';
import { OPENING_THEORY_C } from './c';
import { OPENING_THEORY_D } from './d';
import { OPENING_THEORY_E } from './e';

export interface OpeningTheory {
  /** ECO code of the catalogued line this text describes. */
  eco: string;
  /** Catalogue name, kept for review and for the seeder's mismatch report. */
  name: string;
  /** Space-separated SAN. The join key against `Opening.moveSequence`. */
  moves: string;
  /** Our prose. Rendered in the Explore panel. Bounded at 2000 chars by the model. */
  text: string;
}

export const OPENING_THEORY: OpeningTheory[] = [
  ...OPENING_THEORY_A,
  ...OPENING_THEORY_B,
  ...OPENING_THEORY_C,
  ...OPENING_THEORY_D,
  ...OPENING_THEORY_E,
];
