import { describe, it, expect } from 'vitest';
import {
  PgnSplitter, parseGame, readTag, splitPgnGames, stripSanAnnotations, tokenizeMovetext,
} from './pgn';

describe('stripSanAnnotations', () => {
  it('removes evaluation annotations', () => {
    expect(stripSanAnnotations('Nf3!')).toBe('Nf3');
    expect(stripSanAnnotations('Qh4??')).toBe('Qh4');
    expect(stripSanAnnotations('Bb5!?')).toBe('Bb5');
    expect(stripSanAnnotations('e4?!')).toBe('e4');
  });

  // Load-bearing. A sibling function in the opening lookup treated `+` as a
  // separator, which split `Bb5+` into `Bb5` and made 8% of ECO lines silently
  // unmatchable. `+` and `#` are part of SAN: they appear in the stored ECO move
  // sequences and chess.js emits them, so stripping them here would desync the
  // trie keys from every SAN comparison downstream.
  it('preserves check and mate markers', () => {
    expect(stripSanAnnotations('Bb5+')).toBe('Bb5+');
    expect(stripSanAnnotations('Qxf7#')).toBe('Qxf7#');
    expect(stripSanAnnotations('Bb5+!')).toBe('Bb5+');
  });
});

describe('tokenizeMovetext', () => {
  it('reads a plain move list', () => {
    expect(tokenizeMovetext('1. e4 e5 2. Nf3 Nc6')).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('skips brace comments, which online exports attach to every move', () => {
    expect(tokenizeMovetext('1. e4 { [%clk 0:03:00] } e5 { [%eval 0.2] }')).toEqual(['e4', 'e5']);
  });

  it('skips semicolon line comments without eating the next line', () => {
    expect(tokenizeMovetext('1. e4 ; a remark\ne5 2. Nf3')).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('skips NAGs', () => {
    expect(tokenizeMovetext('1. e4 $1 e5 $14 2. Nf3')).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('drops move numbers in every form they appear', () => {
    expect(tokenizeMovetext('1. e4 e5 2. Nf3 Nc6 3... a6')).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'a6']);
  });

  it('splits a move number glued to its move', () => {
    expect(tokenizeMovetext('1.e4 e5 2.Nf3')).toEqual(['e4', 'e5', 'Nf3']);
  });

  // Variations are the game's sidelines, not its moves. Counting them would
  // attribute games to continuations nobody played.
  it('excludes variation moves and handles nesting by depth', () => {
    expect(tokenizeMovetext('1. e4 (1. d4 d5 (1... Nf6 2. c4)) e5 2. Nf3')).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('stops at the result token', () => {
    expect(tokenizeMovetext('1. e4 e5 1-0 [Event "next"]')).toEqual(['e4', 'e5']);
    expect(tokenizeMovetext('1. e4 e5 1/2-1/2')).toEqual(['e4', 'e5']);
  });

  it('honours the limit so a 120-move game does not build a 240-entry array', () => {
    expect(tokenizeMovetext('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6', 3)).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('survives an unterminated comment from a truncated file', () => {
    expect(() => tokenizeMovetext('1. e4 { never closed')).not.toThrow();
    expect(tokenizeMovetext('1. e4 { never closed')).toEqual(['e4']);
  });

  it('ignores null-move placeholders', () => {
    expect(tokenizeMovetext('1. e4 -- 2. Nf3')).toEqual(['e4', 'Nf3']);
  });
});

describe('readTag', () => {
  const headers = '[Event "Test"]\n[White "Ann Player"]\n[Result "1-0"]';

  it('reads a tag value', () => {
    expect(readTag(headers, 'White')).toBe('Ann Player');
  });

  it('returns empty string for an absent tag rather than undefined', () => {
    expect(readTag(headers, 'WhiteElo')).toBe('');
  });
});

describe('parseGame', () => {
  const headers = [
    '[White "Ann"]', '[Black "Bo"]',
    '[WhiteElo "2600"]', '[BlackElo "2550"]',
    '[UTCDate "2024.03.01"]', '[Result "1-0"]',
  ].join('\n');

  it('extracts the facts the aggregate needs', () => {
    const game = parseGame(headers, '1. e4 e5 1-0', 20);
    expect(game).toMatchObject({
      result: '1-0', white: 'Ann', black: 'Bo',
      whiteElo: 2600, blackElo: 2550, year: 2024,
      moves: ['e4', 'e5'],
    });
  });

  // An unfinished game would add to `total` while belonging to none of the
  // W/D/L buckets, so every percentage computed from that position would be
  // quietly short of 100% — with no error anywhere to point at it.
  it('drops games with an unknown result', () => {
    expect(parseGame('[Result "*"]', '1. e4 e5 *', 20)).toBeNull();
  });

  it('drops games with no moves', () => {
    expect(parseGame(headers, '1-0', 20)).toBeNull();
  });

  it('treats a missing or placeholder Elo as 0 rather than guessing', () => {
    const game = parseGame('[Result "1-0"]\n[WhiteElo "?"]', '1. e4', 20);
    expect(game?.whiteElo).toBe(0);
    expect(game?.blackElo).toBe(0);
  });

  it('rejects an implausibly low Elo', () => {
    expect(parseGame('[Result "1-0"]\n[WhiteElo "12"]', '1. e4', 20)?.whiteElo).toBe(0);
  });

  it('prefers UTCDate over Date for the year', () => {
    const both = '[Result "1-0"]\n[UTCDate "2024.01.01"]\n[Date "1999.01.01"]';
    expect(parseGame(both, '1. e4', 20)?.year).toBe(2024);
  });

  it('reports 0 for an unparseable date instead of NaN', () => {
    expect(parseGame('[Result "1-0"]\n[Date "????.??.??"]', '1. e4', 20)?.year).toBe(0);
  });

  it('bounds absurdly long names — these end up in subdocuments on a 512 MB tier', () => {
    const long = `[Result "1-0"]\n[White "${'x'.repeat(500)}"]`;
    expect(parseGame(long, '1. e4', 20)!.white.length).toBeLessThanOrEqual(48);
  });

  it('truncates moves to the ingest depth', () => {
    expect(parseGame(headers, '1. e4 e5 2. Nf3 Nc6', 2)?.moves).toEqual(['e4', 'e5']);
  });
});

describe('splitPgnGames', () => {
  const gameA = '[White "A"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
  const gameB = '[White "B"]\n[Result "0-1"]\n\n1. d4 d5 0-1';

  it('splits concatenated games', () => {
    const games = splitPgnGames(`${gameA}\n\n${gameB}\n`);
    expect(games).toHaveLength(2);
    expect(games[0].white).toBe('A');
    expect(games[1].white).toBe('B');
  });

  // Blank-line counting is the obvious implementation and it is wrong: exports
  // disagree on how many blank lines they emit, and some omit them entirely.
  // The splitter keys on "a header line after movetext" instead.
  it('splits with no blank line between games', () => {
    const games = splitPgnGames('[White "A"]\n[Result "1-0"]\n1. e4 1-0\n[White "B"]\n[Result "0-1"]\n1. d4 0-1');
    expect(games.map((g) => g.white)).toEqual(['A', 'B']);
  });

  it('handles CRLF line endings', () => {
    const games = splitPgnGames(`${gameA}\r\n\r\n${gameB}`.replace(/\n/g, '\r\n'));
    expect(games).toHaveLength(2);
  });

  it('emits the final game when the file ends without a newline', () => {
    expect(splitPgnGames(`${gameA}\n\n${gameB}`)).toHaveLength(2);
  });

  it('returns nothing for input with no games', () => {
    expect(splitPgnGames('')).toEqual([]);
    expect(splitPgnGames('not a pgn at all')).toEqual([]);
  });
});

describe('PgnSplitter', () => {
  it('emits a game only once the next one starts, and the last on flush', () => {
    const splitter = new PgnSplitter(20);
    expect(splitter.push('[White "A"]')).toBeNull();
    expect(splitter.push('[Result "1-0"]')).toBeNull();
    expect(splitter.push('1. e4 e5 1-0')).toBeNull();
    const first = splitter.push('[White "B"]');
    expect(first?.white).toBe('A');
    expect(splitter.push('[Result "0-1"]')).toBeNull();
    expect(splitter.push('1. d4 0-1')).toBeNull();
    expect(splitter.flush()?.white).toBe('B');
  });

  it('is reusable after flush', () => {
    const splitter = new PgnSplitter(20);
    splitter.push('[Result "1-0"]');
    splitter.push('1. e4 1-0');
    expect(splitter.flush()).not.toBeNull();
    expect(splitter.flush()).toBeNull();
  });
});
