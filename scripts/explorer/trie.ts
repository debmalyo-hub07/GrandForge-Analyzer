/**
 * GrandForge explorer ingest — the SAN trie (pass 1 accumulator).
 *
 * Each node is one position reached by one exact move order, holding the
 * outcomes of every game that passed through it. Keying on the move *path*
 * rather than the position is what makes pass 1 cheap: inserting a game is a
 * handful of Map lookups, no board state.
 *
 * Transpositions are therefore still split at this stage — two move orders
 * reaching the same position are separate trie nodes. Pass 2 (`resolve.ts`)
 * merges them once it knows each node's FEN, which is the only place the
 * distinction costs anything.
 *
 * Memory is the binding constraint (a month is several hundred thousand games),
 * so the node is a fixed-shape class with numeric fields — V8 gives it a packed
 * hidden-class layout — and `children` stays null on leaves rather than holding
 * an empty Map.
 */

/** Game result from White's point of view. */
export type GameResult = '1-0' | '0-1' | '1/2-1/2';

export interface TopGameRecord {
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  result: GameResult;
  year: number;
}

export class TrieNode {
  /** SAN → child. Null until this node has a continuation, to keep leaves small. */
  children: Map<string, TrieNode> | null = null;
  /** Games that reached this position. */
  total = 0;
  white = 0;
  draws = 0;
  black = 0;
  /** Sum of both players' Elos over games where both were known. */
  eloSum = 0;
  /** Games contributing to `eloSum` — the divisor for the average. */
  eloGames = 0;
  /** Best-rated games reaching here; only populated in opening territory. */
  topGames: TopGameRecord[] | null = null;
}

/** How many representative games to keep per position. */
export const TOP_GAMES_PER_NODE = 4;

/** Weakest game worth remembering as representative. */
const TOP_GAME_MIN_ELO = 2200;

function applyResult(node: TrieNode, result: GameResult): void {
  node.total++;
  if (result === '1-0') node.white++;
  else if (result === '0-1') node.black++;
  else node.draws++;
}

/**
 * Insert a candidate into a node's top-games list, keeping the highest-rated
 * `TOP_GAMES_PER_NODE`.
 *
 * Ranked on the *lower* of the two ratings: a 2800 beating a 1500 is not a
 * representative game for the position, and ranking on the average or the max
 * would let those in.
 */
export function offerTopGame(node: TrieNode, game: TopGameRecord): void {
  const strength = Math.min(game.whiteElo, game.blackElo);
  if (strength < TOP_GAME_MIN_ELO) return;

  if (!node.topGames) {
    node.topGames = [game];
    return;
  }
  if (node.topGames.length < TOP_GAMES_PER_NODE) {
    node.topGames.push(game);
    return;
  }

  // Full: replace the weakest entry, but only if this game beats it.
  let weakestIndex = 0;
  let weakestStrength = Infinity;
  for (let i = 0; i < node.topGames.length; i++) {
    const g = node.topGames[i];
    const s = Math.min(g.whiteElo, g.blackElo);
    if (s < weakestStrength) { weakestStrength = s; weakestIndex = i; }
  }
  if (strength > weakestStrength) node.topGames[weakestIndex] = game;
}

export interface InsertOptions {
  /** Plies to record. Moves past this are ignored entirely. */
  maxPlies: number;
  /** Deepest ply (0-based) at which representative games are kept. */
  topGamesMaxPly: number;
}

/**
 * Add one game to the trie.
 *
 * The root accumulates the game too — it is the initial position, and "how do
 * games from the start position go" is a real query. Counters are applied to
 * each node *after* the move that reaches it, so a node's totals describe games
 * that reached that position, which is what the explorer reports.
 */
export function insertGame(
  root: TrieNode,
  moves: string[],
  result: GameResult,
  whiteElo: number,
  blackElo: number,
  topGame: TopGameRecord | null,
  opts: InsertOptions,
): void {
  // Only count Elo when both sides are known, so the average is never dragged
  // down by a game that simply had no rating headers.
  const hasElo = whiteElo > 0 && blackElo > 0;

  const visit = (node: TrieNode, ply: number): void => {
    applyResult(node, result);
    if (hasElo) {
      node.eloSum += whiteElo + blackElo;
      node.eloGames++;
    }
    if (topGame && ply <= opts.topGamesMaxPly) offerTopGame(node, topGame);
  };

  visit(root, 0);

  let node = root;
  const limit = Math.min(moves.length, opts.maxPlies);
  for (let i = 0; i < limit; i++) {
    const san = moves[i];
    if (!node.children) node.children = new Map();
    let child = node.children.get(san);
    if (!child) {
      child = new TrieNode();
      node.children.set(san, child);
    }
    node = child;
    visit(node, i + 1);
  }
}

/**
 * Drop subtrees that can never contribute a reportable position.
 *
 * A node deeper than `minDepth` whose whole subtree describes fewer than
 * `minTotal` games is noise — its percentages would be decided by one or two
 * results — and dropping it also drops everything below it, since a child can
 * never have more games than its parent. This is the mechanism that keeps pass 1
 * memory flat across a large corpus.
 *
 * Deliberately conservative about depth: shallow nodes are kept regardless of
 * count, because a rare early move is still opening theory a user may look up,
 * and there are few enough of them to be free.
 *
 * Returns the number of nodes removed.
 */
export function pruneTrie(root: TrieNode, minDepth: number, minTotal: number): number {
  let removed = 0;

  const countSubtree = (node: TrieNode): number => {
    let n = 1;
    if (node.children) for (const child of node.children.values()) n += countSubtree(child);
    return n;
  };

  const walk = (node: TrieNode, depth: number): void => {
    if (!node.children) return;
    for (const [san, child] of node.children) {
      if (depth + 1 > minDepth && child.total < minTotal) {
        removed += countSubtree(child);
        node.children.delete(san);
        continue;
      }
      walk(child, depth + 1);
    }
    if (node.children.size === 0) node.children = null;
  };

  walk(root, 0);
  return removed;
}

/** Total node count, for progress reporting and memory sanity checks. */
export function countNodes(root: TrieNode): number {
  let n = 1;
  if (root.children) for (const child of root.children.values()) n += countNodes(child);
  return n;
}

/** Deepest ply present in the trie. */
export function maxDepth(root: TrieNode): number {
  if (!root.children) return 0;
  let deepest = 0;
  for (const child of root.children.values()) {
    const d = 1 + maxDepth(child);
    if (d > deepest) deepest = d;
  }
  return deepest;
}
