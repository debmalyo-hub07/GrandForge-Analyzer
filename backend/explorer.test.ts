import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { normalizeExplorerFen } from './models/ExplorerNode';
import { averageElo, shapeMoves } from './routes/explorer/lookup';
import { parseMoveSequence } from './openingLookup';
import type { IExplorerMove } from './models/ExplorerNode';

const move = (over: Partial<IExplorerMove> & { uci: string }): IExplorerMove => ({
  san: over.uci,
  total: 0,
  white: 0,
  draws: 0,
  black: 0,
  ...over,
});

describe('normalizeExplorerFen', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  it('drops the halfmove clock and fullmove number', () => {
    expect(normalizeExplorerFen(START)).toBe(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'
    );
  });

  it('collapses transposition-identical positions to one key', () => {
    // Same position, different move counters — the entire reason the explorer
    // keys on 4 fields. If these ever split, every transposition becomes a
    // separate row with a fraction of the games.
    const a = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const b = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 6 12';
    expect(normalizeExplorerFen(a)).toBe(normalizeExplorerFen(b));
  });

  it('keeps the en-passant field distinct', () => {
    // Two positions differing only in ep target are genuinely different (one
    // side has a capture the other doesn't) — collapsing them would serve the
    // wrong statistics.
    const withEp = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2';
    const withoutEp = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    expect(normalizeExplorerFen(withEp)).not.toBe(normalizeExplorerFen(withoutEp));
  });

  it('is idempotent — a normalized key normalizes to itself', () => {
    const once = normalizeExplorerFen(START);
    expect(normalizeExplorerFen(once)).toBe(once);
  });

  it('returns malformed input trimmed rather than throwing', () => {
    expect(normalizeExplorerFen('  garbage  ')).toBe('garbage');
    expect(normalizeExplorerFen('8/8/8 w')).toBe('8/8/8 w');
  });

  // The explorer key and the eval-cache key MUST be the same convention: the
  // ingest writes explorer rows and the review writes cache rows from the same
  // client FEN, and a reader that normalized differently would miss every row.
  // The two implementations are deliberate copies (the server build compiles
  // `backend/**` alone and cannot import from `frontend/`), so parity is pinned
  // here rather than by construction.
  it('matches the client eval-cache normalization, field-for-field', () => {
    const source = readFileSync(
      join(__dirname, '..', 'frontend', 'src', 'services', 'positionCache.ts'),
      'utf8'
    );
    const sliceCount = source.match(/parts\.slice\(0,\s*(\d+)\)\.join\(' '\)/);
    expect(sliceCount, 'normalizeFenForCache shape changed').not.toBeNull();
    expect(Number(sliceCount![1])).toBe(4);
    expect(normalizeExplorerFen(START).split(' ')).toHaveLength(4);
  });
});

describe('averageElo', () => {
  it('divides by twice the rated-game count — eloSum counts both players', () => {
    // 10 rated games, both players 2500 ⇒ eloSum 50000, average 2500 (not 5000).
    expect(averageElo(50_000, 10)).toBe(2500);
  });

  // The divisor is `eloGames`, not `total`. A corpus where only half the games
  // carried rating headers would otherwise report ~1250 for a field of 2500s —
  // an average that is not wrong by a rounding error but by half.
  it('ignores unrated games rather than counting them as zero', () => {
    const ratedGames = 10;
    expect(averageElo(50_000, ratedGames)).toBe(2500);
  });

  it('returns null for an empty node instead of dividing by zero', () => {
    expect(averageElo(0, 0)).toBeNull();
    expect(averageElo(1234, 0)).toBeNull();
  });

  it('returns null rather than a bogus low rating when eloSum is missing', () => {
    expect(averageElo(0, 500)).toBeNull();
  });
});

describe('shapeMoves', () => {
  it('sorts by popularity, most-played first', () => {
    const shaped = shapeMoves(
      [move({ uci: 'g1f3', total: 30 }), move({ uci: 'e2e4', total: 100 }), move({ uci: 'd2d4', total: 60 })],
      190
    );
    expect(shaped.map((m) => m.uci)).toEqual(['e2e4', 'd2d4', 'g1f3']);
  });

  it('computes share against the node total, not the summed move totals', () => {
    // 100 games reached this position but only 90 continued (10 ended here).
    // Dividing by 90 would report 100% of games playing the two known moves.
    const shaped = shapeMoves(
      [move({ uci: 'e2e4', total: 60 }), move({ uci: 'd2d4', total: 30 })],
      100
    );
    expect(shaped[0].share).toBeCloseTo(0.6, 10);
    expect(shaped[1].share).toBeCloseTo(0.3, 10);
    expect(shaped[0].share + shaped[1].share).toBeLessThan(1);
  });

  it('never divides by zero on an empty node', () => {
    const shaped = shapeMoves([move({ uci: 'e2e4', total: 1 })], 0);
    expect(Number.isFinite(shaped[0].share)).toBe(true);
  });

  it('trims the long tail of single-game moves', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      move({ uci: `a${(i % 8) + 1}a${(i % 8) + 1}`, total: 40 - i })
    );
    const shaped = shapeMoves(many, 1000);
    expect(shaped).toHaveLength(15);
    expect(shaped[0].total).toBe(40);
  });

  it('preserves W/D/L counts verbatim', () => {
    const shaped = shapeMoves([move({ uci: 'e2e4', san: 'e4', total: 10, white: 5, draws: 3, black: 2 })], 10);
    expect(shaped[0]).toMatchObject({ san: 'e4', white: 5, draws: 3, black: 2 });
  });

  it('does not mutate the caller array', () => {
    const moves = [move({ uci: 'g1f3', total: 1 }), move({ uci: 'e2e4', total: 9 })];
    shapeMoves(moves, 10);
    expect(moves[0].uci).toBe('g1f3');
  });
});

describe('parseMoveSequence', () => {
  it('splits on whitespace', () => {
    expect(parseMoveSequence('e4 e5 Nf3')).toEqual(['e4', 'e5', 'Nf3']);
  });

  // Regression pin. Express parses the query with `qs`, which decodes `+` as a
  // space before we ever see it — so `?moves=e4+e5` is already `"e4 e5"` here.
  // A `+` that survives to this function was sent as `%2B`, and the only thing
  // that produces one is a SAN check marker. The previous implementation
  // replaced `+` with a space, which split `Bxd7+` into `Bxd7` and made every
  // ECO line containing a check silently unmatchable.
  it('keeps SAN check and mate markers intact', () => {
    expect(parseMoveSequence('e4 e5 Bb5+ c6')).toEqual(['e4', 'e5', 'Bb5+', 'c6']);
    expect(parseMoveSequence('Qxf7#')).toEqual(['Qxf7#']);
  });

  it('drops empty tokens from sloppy separators', () => {
    expect(parseMoveSequence('  e4   e5  ')).toEqual(['e4', 'e5']);
  });

  it('returns an empty array for empty input', () => {
    expect(parseMoveSequence('')).toEqual([]);
    expect(parseMoveSequence('   ')).toEqual([]);
  });
});
