import { describe, it, expect } from 'vitest';
import {
  TOP_GAMES_PER_NODE, TrieNode, countNodes, insertGame, maxDepth, offerTopGame, pruneTrie,
  type GameResult, type TopGameRecord,
} from './trie';

const OPTS = { maxPlies: 20, topGamesMaxPly: 12 };

const game = (over: Partial<TopGameRecord> = {}): TopGameRecord => ({
  white: 'A', black: 'B', whiteElo: 2500, blackElo: 2500, result: '1-0', year: 2024, ...over,
});

function add(
  root: TrieNode,
  moves: string[],
  result: GameResult = '1-0',
  whiteElo = 0,
  blackElo = 0,
  top: TopGameRecord | null = null,
  opts = OPTS,
): void {
  insertGame(root, moves, result, whiteElo, blackElo, top, opts);
}

/** Walk to a node by SAN path; throws if the path was pruned away. */
function at(root: TrieNode, path: string[]): TrieNode {
  let node = root;
  for (const san of path) {
    const child = node.children?.get(san);
    if (!child) throw new Error(`no node at ${path.join(' ')} (missing ${san})`);
    node = child;
  }
  return node;
}

describe('insertGame', () => {
  it('counts the root as well as every node after every move', () => {
    const root = new TrieNode();
    add(root, ['e4', 'e5']);
    expect(root.total).toBe(1);
    expect(at(root, ['e4']).total).toBe(1);
    expect(at(root, ['e4', 'e5']).total).toBe(1);
  });

  it('buckets results by outcome, and the buckets always sum to total', () => {
    const root = new TrieNode();
    add(root, ['e4'], '1-0');
    add(root, ['e4'], '0-1');
    add(root, ['e4'], '1/2-1/2');
    add(root, ['e4'], '1/2-1/2');
    const node = at(root, ['e4']);
    expect(node).toMatchObject({ total: 4, white: 1, black: 1, draws: 2 });
    expect(node.white + node.black + node.draws).toBe(node.total);
  });

  // The divisor for the displayed average is `eloGames`, not `total`. A game with
  // no rating header must not enter either side of that fraction: counting it as
  // a zero would drag the average down, and counting it in the divisor only would
  // do the same thing more subtly.
  it('accumulates Elo only when both ratings are known', () => {
    const root = new TrieNode();
    add(root, ['e4'], '1-0', 2600, 2400);
    add(root, ['e4'], '1-0', 0, 2400);      // white unrated
    add(root, ['e4'], '1-0', 2600, 0);      // black unrated
    add(root, ['e4'], '1-0', 0, 0);         // neither rated
    const node = at(root, ['e4']);
    expect(node.total).toBe(4);
    expect(node.eloGames).toBe(1);
    expect(node.eloSum).toBe(5000);
    expect(node.eloSum / (2 * node.eloGames)).toBe(2500);
  });

  it('shares nodes across a common prefix instead of duplicating them', () => {
    const root = new TrieNode();
    add(root, ['e4', 'e5', 'Nf3']);
    add(root, ['e4', 'e5', 'Bc4']);
    // root + e4 + e5 + two continuations.
    expect(countNodes(root)).toBe(5);
    expect(at(root, ['e4', 'e5']).total).toBe(2);
  });

  it('ignores moves past the ingest depth', () => {
    const root = new TrieNode();
    add(root, ['e4', 'e5', 'Nf3', 'Nc6'], '1-0', 0, 0, null, { ...OPTS, maxPlies: 2 });
    expect(maxDepth(root)).toBe(2);
    expect(() => at(root, ['e4', 'e5', 'Nf3'])).toThrow();
  });

  it('leaves children null on a leaf', () => {
    const root = new TrieNode();
    add(root, ['e4']);
    expect(at(root, ['e4']).children).toBeNull();
  });

  it('handles a game with no moves without creating nodes', () => {
    const root = new TrieNode();
    add(root, []);
    expect(root.total).toBe(1);
    expect(countNodes(root)).toBe(1);
  });

  it('stops recording representative games past the topGames depth', () => {
    const root = new TrieNode();
    add(root, ['e4', 'e5', 'Nf3'], '1-0', 2500, 2500, game(), { ...OPTS, topGamesMaxPly: 1 });
    expect(at(root, ['e4']).topGames).toHaveLength(1);
    expect(at(root, ['e4', 'e5']).topGames).toBeNull();
  });
});

describe('offerTopGame', () => {
  it('rejects games below the strength floor', () => {
    const node = new TrieNode();
    offerTopGame(node, game({ whiteElo: 1500, blackElo: 1500 }));
    expect(node.topGames).toBeNull();
  });

  // Ranking on the mean (or the max) would let a 2800-vs-1400 rout stand in as
  // the representative game for a position. It represents nothing.
  it('ranks on the weaker player, so a lopsided pairing loses to an even one', () => {
    const node = new TrieNode();
    for (let i = 0; i < TOP_GAMES_PER_NODE; i++) {
      offerTopGame(node, game({ white: `even${i}`, whiteElo: 2500, blackElo: 2500 }));
    }
    offerTopGame(node, game({ white: 'lopsided', whiteElo: 2800, blackElo: 2400 }));
    expect(node.topGames!.map((g) => g.white)).not.toContain('lopsided');
  });

  it('caps the list and keeps the strongest entries', () => {
    const node = new TrieNode();
    for (let i = 0; i < 12; i++) {
      offerTopGame(node, game({ white: `p${i}`, whiteElo: 2300 + i * 20, blackElo: 2300 + i * 20 }));
    }
    expect(node.topGames).toHaveLength(TOP_GAMES_PER_NODE);
    const weakest = Math.min(...node.topGames!.map((g) => g.whiteElo));
    expect(weakest).toBeGreaterThanOrEqual(2300 + 8 * 20);
  });

  it('replaces the weakest entry only when the candidate beats it', () => {
    const node = new TrieNode();
    for (let i = 0; i < TOP_GAMES_PER_NODE; i++) {
      offerTopGame(node, game({ white: `strong${i}`, whiteElo: 2700, blackElo: 2700 }));
    }
    offerTopGame(node, game({ white: 'weaker', whiteElo: 2250, blackElo: 2250 }));
    expect(node.topGames!.map((g) => g.white)).not.toContain('weaker');
  });
});

describe('pruneTrie', () => {
  /** e4 (many games) with a deep single-game tail hanging off it. */
  function thinTail(): TrieNode {
    const root = new TrieNode();
    const line = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let i = 0; i < 10; i++) add(root, line.slice(0, 3));
    add(root, line);          // one game continues deeper
    return root;
  }

  it('never drops anything at or above the depth floor, however rare', () => {
    const root = new TrieNode();
    add(root, ['a', 'b']);    // a single game, two plies deep
    expect(pruneTrie(root, 4, 2)).toBe(0);
    expect(countNodes(root)).toBe(3);
  });

  it('drops thin nodes below the floor', () => {
    const root = thinTail();
    const removed = pruneTrie(root, 3, 2);
    // Plies 4, 5 and 6 each carry one game.
    expect(removed).toBe(3);
    expect(() => at(root, ['a', 'b', 'c', 'd'])).toThrow();
    expect(at(root, ['a', 'b', 'c']).total).toBe(11);
  });

  // The count must include descendants: a caller logging "pruned N nodes" as a
  // memory metric would otherwise under-report by the whole subtree.
  it('counts every removed descendant, not just the subtree root', () => {
    const root = new TrieNode();
    for (let i = 0; i < 10; i++) add(root, ['a']);
    add(root, ['a', 'x', 'y', 'z']);   // 3 thin nodes in one chain
    expect(pruneTrie(root, 1, 2)).toBe(3);
  });

  it('nulls children when a node is emptied, matching the leaf shape', () => {
    const root = new TrieNode();
    for (let i = 0; i < 10; i++) add(root, ['a']);
    add(root, ['a', 'x']);
    pruneTrie(root, 1, 2);
    expect(at(root, ['a']).children).toBeNull();
  });

  it('leaves a healthy trie untouched and is idempotent', () => {
    const root = new TrieNode();
    for (let i = 0; i < 10; i++) add(root, ['a', 'b', 'c', 'd', 'e']);
    const before = countNodes(root);
    expect(pruneTrie(root, 2, 2)).toBe(0);
    expect(pruneTrie(root, 2, 2)).toBe(0);
    expect(countNodes(root)).toBe(before);
  });

  it('does not disturb the surviving counters', () => {
    const root = thinTail();
    pruneTrie(root, 3, 2);
    expect(root.total).toBe(11);
    expect(at(root, ['a']).total).toBe(11);
  });
});

describe('countNodes and maxDepth', () => {
  it('report a bare root as one node at depth zero', () => {
    const root = new TrieNode();
    expect(countNodes(root)).toBe(1);
    expect(maxDepth(root)).toBe(0);
  });

  it('measure the deepest branch, not the last one inserted', () => {
    const root = new TrieNode();
    add(root, ['a', 'b', 'c', 'd']);
    add(root, ['z']);
    expect(maxDepth(root)).toBe(4);
  });
});
