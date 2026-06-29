import { describe, it, expect } from 'vitest';
import { validateFen, fenToBoardArray, getSideToMove, normalizeFen } from '../fenUtils';

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('validateFen', () => {
  it('accepts startpos, rejects garbage/empty', () => {
    expect(validateFen(STARTPOS)).toBe(true);
    expect(validateFen('')).toBe(false);
    expect(validateFen('not a fen')).toBe(false);
    // 9 pawns on a rank is illegal.
    expect(validateFen('rnbqkbnr/ppppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(false);
  });
});

describe('fenToBoardArray', () => {
  it('rank 0 is the 8th rank (black back rank), rank 7 is white back rank', () => {
    const b = fenToBoardArray(STARTPOS);
    expect(b).toHaveLength(8);
    expect(b[0][0]).toEqual({ type: 'r', color: 'b' });
    expect(b[0][4]).toEqual({ type: 'k', color: 'b' });
    expect(b[7][4]).toEqual({ type: 'k', color: 'w' });
    expect(b[4].every((c) => c === null)).toBe(true); // empty middle rank
  });
});

describe('getSideToMove', () => {
  it('reads field 1', () => {
    expect(getSideToMove(STARTPOS)).toBe('w');
    expect(getSideToMove('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toBe('b');
  });
});

describe('normalizeFen — opening-book identity', () => {
  it('strips halfmove clock + fullmove number (last 2 fields)', () => {
    const a = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const b = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 5 12';
    expect(normalizeFen(a)).toBe(normalizeFen(b));
    expect(normalizeFen(a)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3');
  });
});
