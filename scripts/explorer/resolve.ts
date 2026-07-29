/**
 * GrandForge explorer ingest — pass 2: SAN trie → FEN-keyed aggregate.
 *
 * Pass 1 keyed on the move *path*, which is cheap but splits transpositions.
 * This pass walks the trie once with a single chess.js board, so every node
 * learns its FEN, and merges nodes that share one — the merge that makes the
 * explorer report "games that reached this position" rather than "games that
 * reached it by this exact move order".
 *
 * Cost: one `move()`/`undo()` pair per trie *node*, not per game move. A corpus
 * of 500 K games has ~40 M move applications but only a few million distinct
 * paths after the pass-1 prune, and the board is mutated in place rather than
 * re-created — which is why the two passes are split at all.
 */
import { Chess, type Move } from 'chess.js';
import { normalizeExplorerFen } from '../../backend/models/ExplorerNode';
import { TrieNode, type GameResult, type TopGameRecord } from './trie';

/** Per-move counters inside an aggregated position, keyed by UCI. */
export interface AggMove {
  uci: string;
  san: string;
  total: number;
  white: number;
  draws: number;
  black: number;
}

/**
 * One aggregated position, mid-ingest. Mirrors `IExplorerNode` but keeps `moves`
 * as a Map for O(1) merging — the array shape is produced at write time.
 */
export interface AggNode {
  total: number;
  white: number;
  draws: number;
  black: number;
  eloSum: number;
  eloGames: number;
  minPly: number;
  moves: Map<string, AggMove>;
  topGames: TopGameRecord[];
}

/** fen → aggregate. The global accumulator that survives across input months. */
export type FenAccumulator = Map<string, AggNode>;

/** Representative games kept per merged position. */
export const TOP_GAMES_PER_FEN = 4;

/**
 * Moves stored per position. Beyond this the tail is single-game noise that no
 * panel displays, and on a 512 MB tier every stored subdocument is real space.
 */
export const MAX_MOVES_PER_FEN = 30;

export function emptyAgg(minPly: number): AggNode {
  return {
    total: 0, white: 0, draws: 0, black: 0,
    eloSum: 0, eloGames: 0,
    minPly,
    moves: new Map(),
    topGames: [],
  };
}

/** chess.js Move → UCI, including the promotion suffix. */
export function toUci(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

/**
 * Add a game to a position's representative list, keeping the strongest few.
 *
 * Ranked on the *lower* of the two ratings — a 2800 beating a 1400 is not a
 * representative game for the position, and ranking on the mean would admit it.
 */
export function offerTopGameTo(list: TopGameRecord[], game: TopGameRecord, cap: number): void {
  if (list.length < cap) {
    list.push(game);
    return;
  }
  let weakestIndex = 0;
  let weakest = Infinity;
  for (let i = 0; i < list.length; i++) {
    const s = Math.min(list[i].whiteElo, list[i].blackElo);
    if (s < weakest) { weakest = s; weakestIndex = i; }
  }
  if (Math.min(game.whiteElo, game.blackElo) > weakest) list[weakestIndex] = game;
}

function addMove(agg: AggNode, uci: string, san: string, child: TrieNode): void {
  let entry = agg.moves.get(uci);
  if (!entry) {
    entry = { uci, san, total: 0, white: 0, draws: 0, black: 0 };
    agg.moves.set(uci, entry);
  }
  entry.total += child.total;
  entry.white += child.white;
  entry.draws += child.draws;
  entry.black += child.black;
}

export interface ResolveStats {
  /** Trie nodes visited. */
  nodesVisited: number;
  /** Distinct FENs in the accumulator after this trie was merged. */
  positions: number;
  /**
   * Trie nodes dropped because their move was illegal on the board. Non-zero is
   * expected and harmless at low rates (mangled PGN, `--` null moves); a large
   * count means the tokenizer is producing junk and should be investigated.
   */
  illegalMoves: number;
  /** Trie nodes skipped as a consequence of an illegal ancestor. */
  droppedSubtreeNodes: number;
}

export interface ResolveOptions {
  /** Deepest ply to resolve. Nodes below are ignored. */
  maxPlies: number;
  /** Deepest ply at which representative games are stored. */
  topGamesMaxPly: number;
}

function countSubtree(node: TrieNode): number {
  let n = 1;
  if (node.children) for (const c of node.children.values()) n += countSubtree(c);
  return n;
}

/**
 * Merge one trie into the FEN accumulator.
 *
 * Recursion, not an explicit stack: depth is bounded by `maxPlies` (~20), so
 * there is no stack-overflow risk, and the board's move/undo discipline maps
 * exactly onto call/return.
 */
export function resolveTrie(
  root: TrieNode,
  acc: FenAccumulator,
  opts: ResolveOptions,
): ResolveStats {
  const board = new Chess();
  const stats: ResolveStats = {
    nodesVisited: 0, positions: 0, illegalMoves: 0, droppedSubtreeNodes: 0,
  };

  const visit = (node: TrieNode, ply: number): void => {
    stats.nodesVisited++;

    const fen = normalizeExplorerFen(board.fen());
    let agg = acc.get(fen);
    if (!agg) {
      agg = emptyAgg(ply);
      acc.set(fen, agg);
    } else if (ply < agg.minPly) {
      // Shallowest sighting wins: a position first reached at ply 4 is opening
      // theory even if some other game transposed into it at ply 30.
      agg.minPly = ply;
    }

    agg.total += node.total;
    agg.white += node.white;
    agg.draws += node.draws;
    agg.black += node.black;
    agg.eloSum += node.eloSum;
    agg.eloGames += node.eloGames;

    if (node.topGames && ply <= opts.topGamesMaxPly) {
      for (const g of node.topGames) offerTopGameTo(agg.topGames, g, TOP_GAMES_PER_FEN);
    }

    if (!node.children || ply >= opts.maxPlies) return;

    for (const [san, child] of node.children) {
      let move: Move;
      try {
        move = board.move(san);
      } catch {
        // Illegal SAN: the path below it is unreachable, so drop the subtree
        // rather than trying to resynchronize. Counted, not silent.
        stats.illegalMoves++;
        stats.droppedSubtreeNodes += countSubtree(child) - 1;
        continue;
      }

      // Record the move on the PARENT (the position it is played from), using
      // the child's counters — those are the games that played it.
      addMove(agg, toUci(move), move.san, child);

      visit(child, ply + 1);
      board.undo();
    }
  };

  visit(root, 0);
  stats.positions = acc.size;
  return stats;
}

/** Merge `src` into `dst` in place. Used when folding a checkpoint back in. */
export function mergeAgg(dst: AggNode, src: AggNode): void {
  dst.total += src.total;
  dst.white += src.white;
  dst.draws += src.draws;
  dst.black += src.black;
  dst.eloSum += src.eloSum;
  dst.eloGames += src.eloGames;
  if (src.minPly < dst.minPly) dst.minPly = src.minPly;

  for (const [uci, m] of src.moves) {
    const existing = dst.moves.get(uci);
    if (!existing) {
      dst.moves.set(uci, { ...m });
      continue;
    }
    existing.total += m.total;
    existing.white += m.white;
    existing.draws += m.draws;
    existing.black += m.black;
  }

  for (const g of src.topGames) offerTopGameTo(dst.topGames, g, TOP_GAMES_PER_FEN);
}

/**
 * Sort a position's moves by popularity and drop the long tail.
 *
 * Deliberately does NOT renormalize `total`: the node total must keep counting
 * every game that reached the position, including those whose continuation was
 * trimmed. The read path divides by the node total for exactly this reason, so
 * shares stay honest and simply don't sum to 1.
 */
export function finalizeMoves(agg: AggNode): AggMove[] {
  return [...agg.moves.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_MOVES_PER_FEN);
}

/** Shape one accumulator entry into the document the model expects. */
export function toDocument(fen: string, agg: AggNode, topGamesMaxPly: number) {
  return {
    _id: fen,
    total: agg.total,
    white: agg.white,
    draws: agg.draws,
    black: agg.black,
    eloSum: agg.eloSum,
    eloGames: agg.eloGames,
    minPly: agg.minPly,
    moves: finalizeMoves(agg),
    // Re-checked here as well as during resolve: a transposition can lower a
    // position's minPly after its games were offered, and a position that turns
    // out to be deep should not carry named games.
    topGames: agg.minPly <= topGamesMaxPly ? agg.topGames : [],
  };
}

export type { GameResult, TopGameRecord };
