import { describe, it, expect } from 'vitest';
import {
  parseShareParams,
  buildShareQuery,
  buildShareUrl,
  MAX_SHARE_PGN_CHARS,
} from './shareLink';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('parseShareParams', () => {
  it('returns an empty state for no params', () => {
    expect(parseShareParams('')).toEqual({});
    expect(parseShareParams('?')).toEqual({});
    expect(parseShareParams('?utm_source=x')).toEqual({});
  });

  it('reads a pgn link with and without the leading ?', () => {
    expect(parseShareParams('?pgn=e4 e5')).toEqual({ pgn: 'e4 e5' });
    expect(parseShareParams('pgn=e4 e5')).toEqual({ pgn: 'e4 e5' });
  });

  it('decodes percent-encoded moves', () => {
    expect(parseShareParams('?pgn=e4%20e5%20Nf3')).toEqual({ pgn: 'e4 e5 Nf3' });
  });

  it('reads a fen link', () => {
    expect(parseShareParams(`?fen=${encodeURIComponent(START_FEN)}`)).toEqual({
      fen: START_FEN,
    });
  });

  it('prefers pgn when a link carries both, dropping the fen', () => {
    const parsed = parseShareParams(`?pgn=e4&fen=${encodeURIComponent(START_FEN)}`);
    expect(parsed).toEqual({ pgn: 'e4' });
    expect(parsed.fen).toBeUndefined();
  });

  it('reads ply only alongside a pgn', () => {
    expect(parseShareParams('?pgn=e4 e5&ply=1')).toEqual({ pgn: 'e4 e5', ply: 1 });
    // A ply with no moves to index into is meaningless, so it is dropped.
    expect(parseShareParams(`?fen=${encodeURIComponent(START_FEN)}&ply=3`)).toEqual({
      fen: START_FEN,
    });
  });

  it('accepts ply 0 (the starting position)', () => {
    expect(parseShareParams('?pgn=e4&ply=0').ply).toBe(0);
  });

  it('rejects a non-numeric or negative ply rather than passing NaN on', () => {
    expect(parseShareParams('?pgn=e4&ply=abc').ply).toBeUndefined();
    expect(parseShareParams('?pgn=e4&ply=-2').ply).toBeUndefined();
    expect(parseShareParams('?pgn=e4&ply=').ply).toBeUndefined();
  });

  it('treats whitespace-only values as absent', () => {
    expect(parseShareParams('?pgn=%20%20')).toEqual({});
  });
});

describe('buildShareQuery', () => {
  it('returns an empty string for an empty state', () => {
    expect(buildShareQuery({})).toBe('');
  });

  it('encodes a pgn state', () => {
    expect(buildShareQuery({ pgn: 'e4 e5' })).toBe('?pgn=e4+e5');
  });

  it('includes ply when set', () => {
    expect(buildShareQuery({ pgn: 'e4 e5', ply: 1 })).toBe('?pgn=e4+e5&ply=1');
  });

  it('ignores fen when pgn is present', () => {
    expect(buildShareQuery({ pgn: 'e4', fen: START_FEN })).toBe('?pgn=e4');
  });

  it('round-trips through parseShareParams', () => {
    const state = { pgn: 'e4 e5 Nf3 Nc6', ply: 2 };
    expect(parseShareParams(buildShareQuery(state))).toEqual(state);
  });

  it('round-trips a fen', () => {
    expect(parseShareParams(buildShareQuery({ fen: START_FEN }))).toEqual({
      fen: START_FEN,
    });
  });
});

describe('buildShareUrl', () => {
  const base = 'https://grandforge.app/';

  it('strips an existing query and hash off the base', () => {
    const url = buildShareUrl('https://grandforge.app/?pgn=old#frag', {
      sanMoves: ['e4'],
      ply: 1,
      fen: START_FEN,
    });
    expect(url).toBe('https://grandforge.app/?pgn=e4');
  });

  it('omits ply when the link points at the end of the line', () => {
    const url = buildShareUrl(base, { sanMoves: ['e4', 'e5'], ply: 2, fen: START_FEN });
    expect(url).toBe('https://grandforge.app/?pgn=e4+e5');
  });

  it('pins ply when the link points mid-game', () => {
    const url = buildShareUrl(base, { sanMoves: ['e4', 'e5'], ply: 1, fen: START_FEN });
    expect(url).toBe('https://grandforge.app/?pgn=e4+e5&ply=1');
  });

  it('shares the fen when there are no moves', () => {
    const url = buildShareUrl(base, { sanMoves: [], ply: 0, fen: START_FEN });
    expect(url).toBe(`https://grandforge.app/?fen=${encodeURIComponent(START_FEN).replace(/%20/g, '+')}`);
  });

  it('falls back to the fen when the pgn would be too long', () => {
    // Each "Nf3 " is 4 chars; overshoot the cap comfortably.
    const sanMoves = Array.from({ length: MAX_SHARE_PGN_CHARS }, () => 'Nf3');
    const url = buildShareUrl(base, { sanMoves, ply: 4, fen: START_FEN });
    expect(url).toContain('fen=');
    expect(url).not.toContain('pgn=');
    expect(url.length).toBeLessThan(MAX_SHARE_PGN_CHARS);
  });

  it('keeps a pgn that sits just under the cap', () => {
    // 449 moves of "Nf3" joined by spaces = 449*3 + 448 = 1795 chars.
    const sanMoves = Array.from({ length: 449 }, () => 'Nf3');
    const url = buildShareUrl(base, { sanMoves, ply: 449, fen: START_FEN });
    expect(url).toContain('pgn=');
    expect(url).not.toContain('fen=');
  });
});
