import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { normalizeExplorerFen } from '../../backend/models/ExplorerNode';
import { TrieNode, insertGame, type GameResult, type TopGameRecord } from './trie';
import {
  MAX_MOVES_PER_FEN, TOP_GAMES_PER_FEN,
  emptyAgg, finalizeMoves, mergeAgg, offerTopGameTo, resolveTrie, toDocument, toUci,
  type FenAccumulator,
} from './resolve';

const OPTS = { maxPlies: 20, topGamesMaxPly: 12 };

const game = (over: Partial<TopGameRecord> = {}): TopGameRecord => ({
  white: 'A', black: 'B', whiteElo: 2500, blackElo: 2500, result: '1-0', year: 2024, ...over,
});

function trieOf(...games: Array<{ moves: string[]; result?: GameResult; top?: TopGameRecord | null }>): TrieNode {
  const root = new TrieNode();
  for (const g of games) {
    insertGame(root, g.moves, g.result ?? '1-0', 2500, 2500, g.top ?? null, OPTS);
  }
  return root;
}

/** Normalized explorer key for a position reached by these SAN moves. */
function keyAfter(moves: string[]): string {
  const board = new Chess();
  for (const san of moves) board.move(san);
  return normalizeExplorerFen(board.fen());
}

describe('toUci', () => {
  it('renders a plain move', () => {
    const board = new Chess();
    expect(toUci(board.move('e4'))).toBe('e2e4');
  });

  it('includes the promotion piece — without it two different moves collide', () => {
    const board = new Chess('8/P7/8/8/8/8/8/K6k w - - 0 1');
    expect(toUci(board.move('a8=Q'))).toBe('a7a8q');
  });
});

describe('resolveTrie', () => {
  it('keys positions by normalized FEN', () => {
    const acc: FenAccumulator = new Map();
    resolveTrie(trieOf({ moves: ['e4', 'e5'] }), acc, OPTS);
    expect(acc.has(keyAfter([]))).toBe(true);
    expect(acc.has(keyAfter(['e4', 'e5']))).toBe(true);
  });

  // The reason pass 2 exists at all. Pass 1 keys on the move path, so
  // `1.e4 e5 2.Nf3` and `1.Nf3 e5 2.e4` are separate trie nodes; the explorer
  // must report them as one position with both games. If this ever regresses,
  // every transposition splits into fractional rows and the statistics are wrong
  // everywhere without a single error being raised.
  it('merges transpositions into one position with summed counts', () => {
    const trie = trieOf(
      { moves: ['e4', 'e5', 'Nf3'], result: '1-0' },
      { moves: ['Nf3', 'e5', 'e4'], result: '0-1' },
    );
    const acc: FenAccumulator = new Map();
    const stats = resolveTrie(trie, acc, OPTS);

    const merged = acc.get(keyAfter(['e4', 'e5', 'Nf3']))!;
    expect(merged.total).toBe(2);
    expect(merged.white).toBe(1);
    expect(merged.black).toBe(1);
    // 7 trie nodes (root + 3 + 3) collapse to 6 distinct positions.
    expect(stats.nodesVisited).toBe(7);
    expect(acc.size).toBe(6);
  });

  it('records each move on the position it is played from, with the child counts', () => {
    const trie = trieOf(
      { moves: ['e4', 'e5'] },
      { moves: ['e4', 'c5'] },
      { moves: ['e4', 'c5'] },
    );
    const acc: FenAccumulator = new Map();
    resolveTrie(trie, acc, OPTS);

    const afterE4 = acc.get(keyAfter(['e4']))!;
    expect(afterE4.total).toBe(3);
    expect(afterE4.moves.get('e7e5')).toMatchObject({ san: 'e5', total: 1 });
    expect(afterE4.moves.get('c7c5')).toMatchObject({ san: 'c5', total: 2 });
  });

  it('stores UCI keys and SAN from the board, not the raw PGN token', () => {
    const acc: FenAccumulator = new Map();
    resolveTrie(trieOf({ moves: ['e4', 'e5', 'Bb5'] }), acc, OPTS);
    const afterE5 = acc.get(keyAfter(['e4', 'e5']))!;
    expect([...afterE5.moves.keys()]).toEqual(['f1b5']);
  });

  // A position first reached at ply 4 is opening theory even if another game
  // transposed into it at ply 12. minPly drives both the prune and whether named
  // games are kept, so it must never drift upward.
  it('keeps the shallowest ply when a deeper line transposes in', () => {
    const shallow = keyAfter(['e4', 'e5', 'Nf3', 'Nc6']);
    const acc: FenAccumulator = new Map();
    resolveTrie(trieOf({ moves: ['e4', 'e5', 'Nf3', 'Nc6'] }), acc, OPTS);
    expect(acc.get(shallow)!.minPly).toBe(4);

    // Same position, reached one move-order later via a knight detour.
    resolveTrie(trieOf({ moves: ['Nf3', 'Nc6', 'Ng1', 'Nb8', 'e4', 'e5', 'Nf3', 'Nc6'] }), acc, OPTS);
    expect(acc.get(shallow)!.minPly).toBe(4);
  });

  it('drops an illegal subtree, counts it, and does not throw', () => {
    const trie = trieOf({ moves: ['e4', 'Qh8', 'Nf3', 'Nc6'] });
    const acc: FenAccumulator = new Map();
    const stats = resolveTrie(trie, acc, OPTS);
    expect(stats.illegalMoves).toBe(1);
    // Qh8 plus its two descendants.
    expect(stats.droppedSubtreeNodes).toBe(2);
    expect(acc.size).toBe(2);   // start + after e4
  });

  it('keeps a legal sibling when one continuation is illegal', () => {
    const trie = trieOf({ moves: ['e4', 'Qh8'] }, { moves: ['e4', 'e5'] });
    const acc: FenAccumulator = new Map();
    const stats = resolveTrie(trie, acc, OPTS);
    expect(stats.illegalMoves).toBe(1);
    expect(acc.has(keyAfter(['e4', 'e5']))).toBe(true);
  });

  // The whole pass shares one mutable board. A missing `undo()` on any path
  // would silently desync every position after it.
  it('restores the board, so resolving twice gives identical results', () => {
    const trie = trieOf({ moves: ['e4', 'e5', 'Nf3'] }, { moves: ['d4', 'd5'] });
    const first: FenAccumulator = new Map();
    const second: FenAccumulator = new Map();
    resolveTrie(trie, first, OPTS);
    resolveTrie(trie, second, OPTS);
    expect([...second.keys()].sort()).toEqual([...first.keys()].sort());
  });

  it('stops at the resolve depth', () => {
    const acc: FenAccumulator = new Map();
    resolveTrie(trieOf({ moves: ['e4', 'e5', 'Nf3'] }), acc, { ...OPTS, maxPlies: 2 });
    expect(acc.has(keyAfter(['e4', 'e5']))).toBe(true);
    expect(acc.has(keyAfter(['e4', 'e5', 'Nf3']))).toBe(false);
  });

  it('collects representative games only within opening territory', () => {
    const acc: FenAccumulator = new Map();
    resolveTrie(
      trieOf({ moves: ['e4', 'e5', 'Nf3'], top: game() }),
      acc,
      { ...OPTS, topGamesMaxPly: 1 },
    );
    expect(acc.get(keyAfter(['e4']))!.topGames).toHaveLength(1);
    expect(acc.get(keyAfter(['e4', 'e5']))!.topGames).toHaveLength(0);
  });
});

describe('mergeAgg', () => {
  it('adds counters, mins minPly, and unions moves by UCI', () => {
    const dst = emptyAgg(6);
    dst.total = 5; dst.white = 3; dst.draws = 1; dst.black = 1;
    dst.eloSum = 10_000; dst.eloGames = 2;
    dst.moves.set('e2e4', { uci: 'e2e4', san: 'e4', total: 4, white: 3, draws: 1, black: 0 });

    const src = emptyAgg(2);
    src.total = 3; src.white = 0; src.draws = 0; src.black = 3;
    src.eloSum = 5_000; src.eloGames = 1;
    src.moves.set('e2e4', { uci: 'e2e4', san: 'e4', total: 1, white: 0, draws: 0, black: 1 });
    src.moves.set('d2d4', { uci: 'd2d4', san: 'd4', total: 2, white: 0, draws: 0, black: 2 });

    mergeAgg(dst, src);

    expect(dst).toMatchObject({ total: 8, white: 3, draws: 1, black: 4, eloSum: 15_000, eloGames: 3, minPly: 2 });
    expect(dst.moves.get('e2e4')).toMatchObject({ total: 5, black: 1 });
    expect(dst.moves.get('d2d4')).toMatchObject({ total: 2 });
  });

  it('copies new move entries rather than aliasing the source', () => {
    const dst = emptyAgg(0);
    const src = emptyAgg(0);
    src.moves.set('e2e4', { uci: 'e2e4', san: 'e4', total: 1, white: 1, draws: 0, black: 0 });
    mergeAgg(dst, src);
    src.moves.get('e2e4')!.total = 999;
    expect(dst.moves.get('e2e4')!.total).toBe(1);
  });

  it('does not raise minPly when the source is deeper', () => {
    const dst = emptyAgg(2);
    mergeAgg(dst, emptyAgg(9));
    expect(dst.minPly).toBe(2);
  });

  it('caps merged representative games', () => {
    const dst = emptyAgg(0);
    const src = emptyAgg(0);
    for (let i = 0; i < 10; i++) src.topGames.push(game({ white: `p${i}` }));
    mergeAgg(dst, src);
    expect(dst.topGames).toHaveLength(TOP_GAMES_PER_FEN);
  });
});

describe('offerTopGameTo', () => {
  it('fills up to the cap then replaces only the weakest', () => {
    const list: TopGameRecord[] = [];
    for (let i = 0; i < 4; i++) offerTopGameTo(list, game({ white: `p${i}`, whiteElo: 2400, blackElo: 2400 }), 4);
    offerTopGameTo(list, game({ white: 'stronger', whiteElo: 2700, blackElo: 2700 }), 4);
    expect(list).toHaveLength(4);
    expect(list.map((g) => g.white)).toContain('stronger');
    offerTopGameTo(list, game({ white: 'weakest', whiteElo: 2300, blackElo: 2300 }), 4);
    expect(list.map((g) => g.white)).not.toContain('weakest');
  });
});

describe('finalizeMoves', () => {
  function withMoves(count: number) {
    const agg = emptyAgg(0);
    agg.total = 1_000;
    for (let i = 0; i < count; i++) {
      agg.moves.set(`m${i}`, { uci: `m${i}`, san: `m${i}`, total: count - i, white: 0, draws: 0, black: 0 });
    }
    return agg;
  }

  it('sorts by popularity, most played first', () => {
    const shaped = finalizeMoves(withMoves(3));
    expect(shaped.map((m) => m.total)).toEqual([3, 2, 1]);
  });

  it('caps the stored tail', () => {
    expect(finalizeMoves(withMoves(60))).toHaveLength(MAX_MOVES_PER_FEN);
  });

  // The read path divides each move by the NODE total. Renormalizing here — or
  // shrinking `total` to match the kept moves — would silently inflate every
  // percentage on positions whose tail was trimmed.
  it('leaves the node total alone when trimming', () => {
    const agg = withMoves(60);
    finalizeMoves(agg);
    expect(agg.total).toBe(1_000);
  });
});

describe('toDocument', () => {
  it('produces the shape the model declares, with the FEN as _id', () => {
    const agg = emptyAgg(4);
    agg.total = 10; agg.white = 6; agg.draws = 3; agg.black = 1;
    agg.eloSum = 20_000; agg.eloGames = 4;
    agg.moves.set('e2e4', { uci: 'e2e4', san: 'e4', total: 7, white: 4, draws: 2, black: 1 });
    agg.topGames.push(game());

    const doc = toDocument('fen-key', agg, 12);
    expect(doc).toMatchObject({
      _id: 'fen-key', total: 10, white: 6, draws: 3, black: 1,
      eloSum: 20_000, eloGames: 4, minPly: 4,
    });
    expect(doc.moves).toHaveLength(1);
    expect(doc.topGames).toHaveLength(1);
  });

  it('blanks representative games on a position that turned out to be deep', () => {
    const agg = emptyAgg(30);
    agg.topGames.push(game());
    expect(toDocument('fen-key', agg, 12).topGames).toHaveLength(0);
  });
});
