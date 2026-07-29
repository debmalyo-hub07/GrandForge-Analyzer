import { describe, expect, it } from 'vitest';
import {
  formatGameCount,
  formatPlayer,
  formatShare,
  scorePercent,
  sortMoves,
  sortTopGames,
  wdlPercents,
} from './explorerFormat';
import type { ExplorerMove, ExplorerTopGame } from '../types/explorer';

const move = (san: string, total: number, extra: Partial<ExplorerMove> = {}): ExplorerMove => ({
  uci: 'e2e4',
  san,
  total,
  white: 0,
  draws: 0,
  black: 0,
  share: 0,
  ...extra,
});

const game = (
  whiteElo: number,
  blackElo: number,
  extra: Partial<ExplorerTopGame> = {}
): ExplorerTopGame => ({
  white: 'W',
  black: 'B',
  whiteElo,
  blackElo,
  result: '1-0',
  year: 2020,
  ...extra,
});

describe('formatGameCount', () => {
  it('shows small counts exactly', () => {
    expect(formatGameCount(0)).toBe('0');
    expect(formatGameCount(1)).toBe('1');
    expect(formatGameCount(999)).toBe('999');
  });

  it('compacts thousands, keeping one decimal below 10k', () => {
    expect(formatGameCount(1000)).toBe('1k');
    expect(formatGameCount(1240)).toBe('1.2k');
    expect(formatGameCount(9949)).toBe('9.9k');
  });

  it('drops the decimal from 10k up', () => {
    expect(formatGameCount(10_000)).toBe('10k');
    expect(formatGameCount(84_600)).toBe('85k');
    expect(formatGameCount(999_400)).toBe('999k');
  });

  it('compacts millions', () => {
    expect(formatGameCount(1_000_000)).toBe('1M');
    expect(formatGameCount(1_284_302)).toBe('1.3M');
    expect(formatGameCount(24_000_000)).toBe('24M');
  });

  it('never renders a non-finite or negative count as garbage', () => {
    expect(formatGameCount(Number.NaN)).toBe('0');
    expect(formatGameCount(Number.POSITIVE_INFINITY)).toBe('0');
    expect(formatGameCount(-5)).toBe('0');
  });
});

describe('formatShare', () => {
  it('rounds to whole percent', () => {
    expect(formatShare(0.5)).toBe('50%');
    expect(formatShare(0.334)).toBe('33%');
    expect(formatShare(1)).toBe('100%');
  });

  it('floors a nonzero share at "<1%" rather than "0%"', () => {
    // The row exists, so it is not zero — printing "0%" next to a real game
    // count reads as a bug.
    expect(formatShare(0.004)).toBe('<1%');
    expect(formatShare(0.0000001)).toBe('<1%');
  });

  it('still prints 0% for a genuinely absent share', () => {
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(Number.NaN)).toBe('0%');
    expect(formatShare(-1)).toBe('0%');
  });
});

describe('wdlPercents', () => {
  it('sums to exactly 100 for a thirds split', () => {
    const p = wdlPercents(1, 1, 1);
    expect(p.white + p.draws + p.black).toBe(100);
  });

  it('sums to exactly 100 across many awkward splits', () => {
    const cases: Array<[number, number, number]> = [
      [1, 1, 1],
      [1, 0, 2],
      [7, 7, 7],
      [1, 2, 4],
      [3, 3, 1],
      [10, 10, 11],
      [1, 1, 0],
      [999, 1000, 1001],
      [5, 0, 0],
      [1, 6, 2],
    ];
    for (const [w, d, b] of cases) {
      const p = wdlPercents(w, d, b);
      expect(p.white + p.draws + p.black, `${w}/${d}/${b}`).toBe(100);
    }
  });

  it('gives the rounding drift to the largest bucket', () => {
    // 1/1/1 rounds to 33/33/33; the missing point goes to the first-largest.
    const p = wdlPercents(1, 1, 1);
    expect(p.white).toBe(34);
    expect(p.draws).toBe(33);
    expect(p.black).toBe(33);
  });

  it('gives the drift to whichever bucket is actually largest', () => {
    // draws dominate, so draws absorbs the remainder — not white by position.
    const p = wdlPercents(1, 4, 1);
    expect(p.draws).toBeGreaterThan(p.white);
    expect(p.white + p.draws + p.black).toBe(100);
    expect(p.draws).toBe(100 - p.white - p.black);
  });

  it('returns all zeroes for an empty position rather than dividing by zero', () => {
    expect(wdlPercents(0, 0, 0)).toEqual({ white: 0, draws: 0, black: 0 });
  });

  it('keeps a shut-out at 100/0/0', () => {
    expect(wdlPercents(9, 0, 0)).toEqual({ white: 100, draws: 0, black: 0 });
    expect(wdlPercents(0, 0, 9)).toEqual({ white: 0, draws: 0, black: 100 });
  });
});

describe('scorePercent', () => {
  it('counts a draw as a half point, not as an average of win rates', () => {
    // All draws is a 50% score, even though white's win rate is 0%.
    expect(scorePercent(0, 10, 0)).toBe(50);
  });

  it('scores a clean sweep at 100 and a rout at 0', () => {
    expect(scorePercent(4, 0, 0)).toBe(100);
    expect(scorePercent(0, 0, 4)).toBe(0);
  });

  it('mixes wins and draws correctly', () => {
    // 2 wins + 1 draw + 1 loss over 4 games = 2.5/4 = 62.5% → 63.
    expect(scorePercent(2, 1, 1)).toBe(63);
  });

  it('returns null for a position with no games', () => {
    expect(scorePercent(0, 0, 0)).toBeNull();
  });
});

describe('sortMoves', () => {
  it('orders most-played first', () => {
    const sorted = sortMoves([move('Nf3', 10), move('e4', 400), move('c4', 90)]);
    expect(sorted.map((m) => m.san)).toEqual(['e4', 'c4', 'Nf3']);
  });

  it('breaks ties on SAN so the order is stable across renders', () => {
    // The exact collation is the runtime's; what has to hold is that equal-count
    // moves land in the same order regardless of the order Mongo handed them
    // over, so the panel doesn't reshuffle between renders.
    const forwards = sortMoves([move('Nf3', 5), move('c4', 5), move('e4', 5)]);
    const backwards = sortMoves([move('e4', 5), move('c4', 5), move('Nf3', 5)]);
    expect(forwards.map((m) => m.san)).toEqual(backwards.map((m) => m.san));
  });

  it('does not mutate the input array', () => {
    const input = [move('Nf3', 1), move('e4', 2)];
    const snapshot = input.map((m) => m.san);
    sortMoves(input);
    expect(input.map((m) => m.san)).toEqual(snapshot);
  });
});

describe('formatPlayer', () => {
  it('appends the rating when the corpus had one', () => {
    expect(formatPlayer('Carlsen', 2847)).toBe('Carlsen 2847');
  });

  it('omits the rating for an unrated player instead of printing 0', () => {
    expect(formatPlayer('Carlsen', 0)).toBe('Carlsen');
  });

  it('falls back to "Unknown" for a blank name', () => {
    expect(formatPlayer('   ', 2400)).toBe('Unknown 2400');
    expect(formatPlayer('', 0)).toBe('Unknown');
  });

  it('trims surrounding whitespace from a corpus name', () => {
    expect(formatPlayer('  Tal  ', 2700)).toBe('Tal 2700');
  });
});

describe('sortTopGames', () => {
  it('ranks on the weaker player, not the average', () => {
    // A 2800-vs-1400 rout has the higher average but represents nothing.
    const lopsided = game(2800, 1400);
    const even = game(2500, 2480);
    expect(sortTopGames([lopsided, even])[0]).toBe(even);
  });

  it('breaks ties on the more recent year', () => {
    const older = game(2600, 2600, { year: 1994 });
    const newer = game(2600, 2600, { year: 2021 });
    expect(sortTopGames([older, newer]).map((g) => g.year)).toEqual([2021, 1994]);
  });

  it('treats a missing rating as zero rather than ranking it first', () => {
    const unrated = game(0, 0);
    const rated = game(2200, 2100);
    expect(sortTopGames([unrated, rated])[0]).toBe(rated);
  });

  it('does not mutate the input array', () => {
    const input = [game(2000, 2000, { year: 1990 }), game(2600, 2600, { year: 2010 })];
    const first = input[0];
    sortTopGames(input);
    expect(input[0]).toBe(first);
  });
});
