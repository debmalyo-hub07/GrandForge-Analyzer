// Validation for our own opening theory (scripts/data/openingTheory/).
//
// DB-free by design: this replays every `moves` string on a real chess.js board
// so a typo in the join key fails here instead of silently attaching prose to a
// line no reader will ever open. It also enforces the two contracts the data
// carries: the 2000-char model bound, and the rule that none of the prose names
// a third-party chess platform or the engine binary.
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { OPENING_THEORY } from './openingTheory/index';
import { OPENING_THEORY_A } from './openingTheory/a';
import { OPENING_THEORY_B } from './openingTheory/b';
import { OPENING_THEORY_C } from './openingTheory/c';
import { OPENING_THEORY_D } from './openingTheory/d';
import { OPENING_THEORY_E } from './openingTheory/e';

/** Matches `Opening.description`'s schema bound in backend/models/Opening.ts. */
const MAX_DESCRIPTION = 2000;
/** Anything shorter than this is a stub, not an explanation. */
const MIN_DESCRIPTION = 350;

// Substrings that must never appear in our prose. The platform names are the
// independence constraint; the engine names are the UI-copy constraint (binaries
// and internal ids may carry them, reader-facing text may not).
const FORBIDDEN = [
  'lichess',
  'chess.com',
  'chessdotcom',
  'chess24',
  'chessbase',
  'chesstempo',
  'chessable',
  'chesspuzzle',
  'stockfish',
  'wikibook',
  'opening explorer api',
];

describe('opening theory data', () => {
  it('concatenates every per-letter file exactly once', () => {
    const parts = [
      OPENING_THEORY_A,
      OPENING_THEORY_B,
      OPENING_THEORY_C,
      OPENING_THEORY_D,
      OPENING_THEORY_E,
    ];
    expect(OPENING_THEORY.length).toBe(parts.reduce((n, p) => n + p.length, 0));
    expect(OPENING_THEORY.length).toBeGreaterThan(300);
  });

  it('files are grouped by their own ECO letter', () => {
    const groups: Array<[string, typeof OPENING_THEORY_A]> = [
      ['A', OPENING_THEORY_A],
      ['B', OPENING_THEORY_B],
      ['C', OPENING_THEORY_C],
      ['D', OPENING_THEORY_D],
      ['E', OPENING_THEORY_E],
    ];
    for (const [letter, rows] of groups) {
      const strays = rows.filter((r) => r.eco[0] !== letter).map((r) => `${r.eco} ${r.name}`);
      expect(strays, `rows in ${letter}.ts with a different ECO letter`).toEqual([]);
    }
  });

  it('every ECO code is well formed', () => {
    const bad = OPENING_THEORY.filter((t) => !/^[A-E]\d{2}$/.test(t.eco)).map((t) => t.eco);
    expect(bad).toEqual([]);
  });

  // The load-bearing test. `moves` is the join key against Opening.moveSequence,
  // which the seeder builds as space-separated SAN with move numbers stripped.
  // If a move is illegal or misspelled, chess.js throws and we name the row.
  it('every move sequence is legal and replays to a real position', () => {
    const failures: string[] = [];
    for (const entry of OPENING_THEORY) {
      const board = new Chess();
      const moves = entry.moves.split(' ').filter(Boolean);
      if (moves.length === 0) {
        failures.push(`${entry.eco} ${entry.name}: empty move sequence`);
        continue;
      }
      for (const [i, san] of moves.entries()) {
        try {
          board.move(san);
        } catch {
          failures.push(`${entry.eco} ${entry.name}: illegal move ${i + 1} "${san}" in "${entry.moves}"`);
          break;
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('move sequences are normalized the way the seeder builds them', () => {
    const bad = OPENING_THEORY.filter(
      (t) => t.moves !== t.moves.trim() || /\s\s/.test(t.moves) || /\d+\./.test(t.moves),
    ).map((t) => `${t.eco} ${t.name}: "${t.moves}"`);
    expect(bad).toEqual([]);
  });

  it('has no duplicate join keys', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const t of OPENING_THEORY) {
      const prev = seen.get(t.moves);
      if (prev) dupes.push(`"${t.moves}" — ${prev} and ${t.name}`);
      else seen.set(t.moves, t.name);
    }
    expect(dupes).toEqual([]);
  });

  it('has no copy-pasted prose', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const t of OPENING_THEORY) {
      const prev = seen.get(t.text);
      if (prev) dupes.push(`${prev} and ${t.name} share identical text`);
      else seen.set(t.text, t.name);
    }
    expect(dupes).toEqual([]);
  });

  it('prose fits the model bound and is substantial', () => {
    const tooLong = OPENING_THEORY.filter((t) => t.text.length > MAX_DESCRIPTION).map(
      (t) => `${t.name}: ${t.text.length}`,
    );
    const tooShort = OPENING_THEORY.filter((t) => t.text.length < MIN_DESCRIPTION).map(
      (t) => `${t.name}: ${t.text.length}`,
    );
    expect(tooLong).toEqual([]);
    expect(tooShort).toEqual([]);
  });

  it('prose is trimmed and paragraph-separated', () => {
    const bad = OPENING_THEORY.filter(
      (t) => t.text !== t.text.trim() || !t.text.includes('\n\n'),
    ).map((t) => `${t.eco} ${t.name}`);
    expect(bad).toEqual([]);
  });

  // The independence and UI-naming constraints, enforced mechanically rather
  // than by review: no reader-facing sentence names another chess platform or
  // the engine binary.
  it('prose names no third-party platform and no engine binary', () => {
    const hits: string[] = [];
    for (const t of OPENING_THEORY) {
      const haystack = t.text.toLowerCase();
      for (const term of FORBIDDEN) {
        if (haystack.includes(term)) hits.push(`${t.eco} ${t.name}: "${term}"`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('names are non-empty and trimmed', () => {
    const bad = OPENING_THEORY.filter((t) => !t.name || t.name !== t.name.trim()).map(
      (t) => `${t.eco} "${t.name}"`,
    );
    expect(bad).toEqual([]);
  });
});
