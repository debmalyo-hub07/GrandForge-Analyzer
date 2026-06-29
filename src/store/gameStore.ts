import { create } from 'zustand';
import { Chess, type Square } from 'chess.js';
import type { MoveNode, MoveTree } from '../types/moveTree';
import type { IndexedGame } from '../services/GameEngineAdapter';
import { useEngineStore } from './engineStore';
import { useUIStore } from './uiStore';
import { useReviewStore } from './reviewStore';

export interface GameMetadata {
  white?: string;
  black?: string;
  whiteElo?: number;
  blackElo?: number;
  event?: string;
  site?: string;
  date?: string;
  result?: string;
  timeControl?: string;
  opening?: string;
  ecoCode?: string;
  variant?: string;
}

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ROOT_NODE_ID = 'root';

function makeRootNode(fen: string = STARTING_FEN): MoveNode {
  return {
    id: ROOT_NODE_ID,
    san: '',
    uci: '',
    fen,
    parentId: null,
    children: [],
    isMainline: true,
    depth: 0,
    plyNumber: 0,
    moveNumber: 0,
    color: 'w',
  };
}

function makeEmptyTree(fen: string = STARTING_FEN): MoveTree {
  return {
    rootId: ROOT_NODE_ID,
    nodes: { [ROOT_NODE_ID]: makeRootNode(fen) },
  };
}

let nodeIdCounter = 0;
function generateNodeId(): string {
  // Date.now() is constant within a synchronous PGN/indexed load loop, so a
  // monotonic counter guarantees uniqueness even when timestamp + random collide.
  nodeIdCounter = (nodeIdCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `n_${Date.now().toString(36)}_${nodeIdCounter.toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function getMainlinePath(tree: MoveTree): string[] {
  const path: string[] = [tree.rootId];
  let current = tree.nodes[tree.rootId];
  while (current && current.children.length > 0) {
    const nextId = current.children[0];
    path.push(nextId);
    current = tree.nodes[nextId];
  }
  return path;
}

function getPathToNode(tree: MoveTree, nodeId: string): string[] {
  const path: string[] = [];
  let current: MoveNode | undefined = tree.nodes[nodeId];
  while (current) {
    path.unshift(current.id);
    if (current.parentId === null) break;
    current = tree.nodes[current.parentId];
  }
  return path;
}

interface GameState {
  chess: Chess;
  currentFen: string;
  pgn: string;
  moveTree: MoveTree;
  currentNodeId: string | null;
  gameMetadata: GameMetadata | null;
  openingName: string | null;
  isAtEnd: boolean;
  isAtStart: boolean;
  loadedIndexedGame: IndexedGame | null;
  lastUci: string | null;

  makeMove: (move: { from: Square; to: Square; promotion?: string }) => boolean;
  goBack: () => void;
  goForward: () => void;
  goToStart: () => void;
  goToEnd: () => void;
  goToNode: (nodeId: string) => void;
  loadPGN: (pgn: string, metadata?: Partial<GameMetadata>) => boolean;
  loadIndexedGame: (game: IndexedGame) => void;
  loadFEN: (fen: string) => boolean;
  resetBoard: () => void;
  setOpening: (name: string) => void;
}

function computeFlags(tree: MoveTree, currentNodeId: string | null): { isAtStart: boolean; isAtEnd: boolean } {
  if (!currentNodeId) return { isAtStart: true, isAtEnd: true };
  const node = tree.nodes[currentNodeId];
  if (!node) return { isAtStart: true, isAtEnd: true };
  return {
    isAtStart: node.parentId === null,
    isAtEnd: node.children.length === 0,
  };
}

function resetTransientStateForNewGame() {
  try { useEngineStore.getState().resetAnalysisState(); } catch { /* noop */ }
  try { useUIStore.getState().clearArrows(); } catch { /* noop */ }
  try { useUIStore.getState().clearHighlights(); } catch { /* noop */ }
  try { useReviewStore.getState().clearReview(); } catch { /* noop */ }
}

/**
 * Manual right-click highlights and drawn arrows annotate ONE position. When
 * the board moves to a different node they become semantically meaningless, so
 * clear them on every navigation. Review arrows live in their own layer
 * (useReviewArrows) and are unaffected. Guarded to avoid emitting fresh empty
 * references (and thus needless board re-renders) when nothing is set.
 */
function clearManualAnnotations() {
  try {
    const ui = useUIStore.getState();
    if (ui.customArrows.length > 0) ui.clearArrows();
    if (ui.highlightedSquares.size > 0) ui.clearHighlights();
  } catch { /* noop */ }
}

export const useGameStore = create<GameState>((set, get) => ({
  chess: new Chess(),
  currentFen: STARTING_FEN,
  pgn: '',
  moveTree: makeEmptyTree(),
  currentNodeId: ROOT_NODE_ID,
  gameMetadata: null,
  openingName: null,
  isAtEnd: true,
  isAtStart: true,
  loadedIndexedGame: null,
  lastUci: null,

  makeMove: (move) => {
    const { chess, moveTree, currentNodeId } = get();
    if (!currentNodeId) return false;
    const parent = moveTree.nodes[currentNodeId];
    if (!parent) return false;

    const chessForMove = new Chess(parent.fen);
    let result;
    try {
      result = chessForMove.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion ?? 'q',
      });
    } catch {
      return false;
    }
    if (!result) return false;

    const existingChildId = parent.children.find((cid) => {
      const c = moveTree.nodes[cid];
      return c && c.uci === `${result.from}${result.to}${result.promotion ?? ''}`;
    });

    if (existingChildId) {
      const child = moveTree.nodes[existingChildId];
      const newChess = new Chess(child.fen);
      clearManualAnnotations();
      set({
        chess: newChess,
        currentFen: child.fen,
        currentNodeId: existingChildId,
        lastUci: child.uci || null,
        ...computeFlags(moveTree, existingChildId),
      });
      return true;
    }

    const newId = generateNodeId();
    const uci = `${result.from}${result.to}${result.promotion ?? ''}`;
    const plyNumber = parent.plyNumber + 1;
    // Derive color/moveNumber from the chess.js move + resulting FEN so a
    // black-to-move root (loaded via loadFEN) still produces correct labels.
    // chess.js fullmove number == the move-pair index; after Black plays move N
    // it increments to N+1, so subtract 1 for black moves.
    const color: 'w' | 'b' = result.color === 'w' ? 'w' : 'b';
    const fullmove = parseInt(chessForMove.fen().split(' ')[5], 10) || 1;
    const moveNumber = color === 'w' ? fullmove : fullmove - 1;
    const isMainline = parent.isMainline && parent.children.length === 0;
    const depth = isMainline ? parent.depth : parent.depth + 1;

    const newNode: MoveNode = {
      id: newId,
      san: result.san,
      uci,
      fen: chessForMove.fen(),
      parentId: parent.id,
      children: [],
      isMainline,
      depth,
      plyNumber,
      moveNumber,
      color,
    };

    const newTree: MoveTree = {
      rootId: moveTree.rootId,
      nodes: {
        ...moveTree.nodes,
        [parent.id]: { ...parent, children: [...parent.children, newId] },
        [newId]: newNode,
      },
    };

    set({
      chess: chessForMove,
      currentFen: chessForMove.fen(),
      moveTree: newTree,
      currentNodeId: newId,
      lastUci: uci,
      ...computeFlags(newTree, newId),
    });
    return true;
  },

  goBack: () => {
    const { moveTree, currentNodeId } = get();
    if (!currentNodeId) return;
    const node = moveTree.nodes[currentNodeId];
    if (!node || node.parentId === null) return;
    const parent = moveTree.nodes[node.parentId];
    if (!parent) return;
    clearManualAnnotations();
    set({
      chess: new Chess(parent.fen),
      currentFen: parent.fen,
      currentNodeId: parent.id,
      lastUci: null,
      ...computeFlags(moveTree, parent.id),
    });
  },

  goForward: () => {
    const { moveTree, currentNodeId } = get();
    if (!currentNodeId) return;
    const node = moveTree.nodes[currentNodeId];
    if (!node || node.children.length === 0) return;
    const nextId = node.children[0];
    const next = moveTree.nodes[nextId];
    if (!next) return;
    clearManualAnnotations();
    set({
      chess: new Chess(next.fen),
      currentFen: next.fen,
      currentNodeId: nextId,
      lastUci: null,
      ...computeFlags(moveTree, nextId),
    });
  },

  goToStart: () => {
    const { moveTree } = get();
    const root = moveTree.nodes[moveTree.rootId];
    if (!root) return;
    clearManualAnnotations();
    set({
      chess: new Chess(root.fen),
      currentFen: root.fen,
      currentNodeId: root.id,
      lastUci: null,
      ...computeFlags(moveTree, root.id),
    });
  },

  goToEnd: () => {
    const { moveTree, currentNodeId } = get();
    if (!currentNodeId) return;
    let node = moveTree.nodes[currentNodeId];
    while (node && node.children.length > 0) {
      const nextId = node.children[0];
      const next = moveTree.nodes[nextId];
      if (!next) break;
      node = next;
    }
    if (!node) return;
    clearManualAnnotations();
    set({
      chess: new Chess(node.fen),
      currentFen: node.fen,
      currentNodeId: node.id,
      lastUci: null,
      ...computeFlags(moveTree, node.id),
    });
  },

  goToNode: (nodeId) => {
    const { moveTree } = get();
    const node = moveTree.nodes[nodeId];
    if (!node) return;
    clearManualAnnotations();
    set({
      chess: new Chess(node.fen),
      currentFen: node.fen,
      currentNodeId: nodeId,
      lastUci: node.uci || null,
      ...computeFlags(moveTree, nodeId),
    });
  },

  loadPGN: (pgn, metadata) => {
    const chess = new Chess();
    try {
      let normalized = pgn.replace(/^﻿/, '');
      normalized = normalized.replace(/\b0-0-0\b/g, 'O-O-O').replace(/\b0-0\b/g, 'O-O');
      chess.loadPgn(normalized);
    } catch (err) {
      console.warn('GrandForge: PGN parse failed:', err);
      return false;
    }
    resetTransientStateForNewGame();
    const history = chess.history({ verbose: true });
    const replay = new Chess();
    const tree = makeEmptyTree(replay.fen());
    let prevId: string = tree.rootId;

    for (let i = 0; i < history.length; i++) {
      const m = history[i];
      replay.move(m.san);
      const id = generateNodeId();
      const parent = tree.nodes[prevId];
      const plyNumber = i + 1;
      const color: 'w' | 'b' = m.color === 'w' ? 'w' : 'b';
      const fullmove = parseInt(replay.fen().split(' ')[5], 10) || 1;
      const moveNumber = color === 'w' ? fullmove : fullmove - 1;
      const isMainline = parent.isMainline && parent.children.length === 0;
      const depth = isMainline ? parent.depth : parent.depth + 1;
      const node: MoveNode = {
        id,
        san: m.san,
        uci: `${m.from}${m.to}${m.promotion ?? ''}`,
        fen: replay.fen(),
        parentId: prevId,
        children: [],
        isMainline,
        depth,
        plyNumber,
        moveNumber,
        color,
      };
      tree.nodes[id] = node;
      tree.nodes[prevId] = { ...parent, children: [...parent.children, id] };
      prevId = id;
    }

    const headers = chess.header();
    const mergedMeta: GameMetadata = {
      white: headers.White ?? 'White',
      black: headers.Black ?? 'Black',
      whiteElo: headers.WhiteElo ? parseInt(headers.WhiteElo) : undefined,
      blackElo: headers.BlackElo ? parseInt(headers.BlackElo) : undefined,
      event: headers.Event ?? undefined,
      site: headers.Site ?? undefined,
      date: headers.Date ?? undefined,
      result: headers.Result ?? '*',
      timeControl: headers.TimeControl ?? undefined,
      opening: headers.Opening ?? undefined,
      ecoCode: headers.ECO ?? undefined,
      variant: headers.Variant ?? undefined,
      ...metadata,
    };

    set({
      chess: new Chess(replay.fen()),
      currentFen: replay.fen(),
      pgn,
      moveTree: tree,
      currentNodeId: prevId,
      gameMetadata: mergedMeta,
      openingName: mergedMeta.opening ?? null,
      loadedIndexedGame: null,
      lastUci: tree.nodes[prevId]?.uci || null,
      ...computeFlags(tree, prevId),
    });
    return true;
  },

  loadIndexedGame: (game) => {
    resetTransientStateForNewGame();
    const { fenPositions, moveSanList, moveUciList, plyCount } = game;
    const startFen = fenPositions[0] ?? STARTING_FEN;
    const tree = makeEmptyTree(startFen);
    let prevId: string = tree.rootId;

    for (let i = 0; i < plyCount; i++) {
      const id = generateNodeId();
      const parent = tree.nodes[prevId];
      const plyNumber = i + 1;
      // Derive color/moveNumber from the FEN *after* the move: its active-color
      // field is the side to move next, so the side that just moved is the
      // opposite. This keeps labels correct for a black-to-move start FEN.
      const fenAfter = fenPositions[i + 1] ?? '';
      const fenParts = fenAfter.split(' ');
      const sideToMoveNext = fenParts[1] === 'b' ? 'b' : 'w';
      const color: 'w' | 'b' = sideToMoveNext === 'w' ? 'b' : 'w';
      const fullmove = parseInt(fenParts[5], 10) || 1;
      const moveNumber = color === 'w' ? fullmove : fullmove - 1;
      const isMainline = parent.isMainline && parent.children.length === 0;
      const depth = isMainline ? parent.depth : parent.depth + 1;
      const node: MoveNode = {
        id,
        san: moveSanList[i],
        uci: moveUciList[i],
        fen: fenPositions[i + 1],
        parentId: prevId,
        children: [],
        isMainline,
        depth,
        plyNumber,
        moveNumber,
        color,
      };
      tree.nodes[id] = node;
      tree.nodes[prevId] = { ...parent, children: [...parent.children, id] };
      prevId = id;
    }

    const meta = (game.metadata ?? {}) as Record<string, unknown>;
    const gameMetadata: GameMetadata = {
      white: meta.white as string | undefined,
      black: meta.black as string | undefined,
      whiteElo: meta.whiteElo as number | undefined,
      blackElo: meta.blackElo as number | undefined,
      event: meta.event as string | undefined,
      site: meta.site as string | undefined,
      date: meta.date as string | undefined,
      result: meta.result as string | undefined,
      timeControl: meta.timeControl as string | undefined,
      opening: meta.opening as string | undefined,
      ecoCode: meta.ecoCode as string | undefined,
      variant: meta.variant as string | undefined,
    };

    const endNodeId = prevId; // last move's node
    const endFen = fenPositions[plyCount] ?? startFen;
    set({
      chess: new Chess(endFen),
      currentFen: endFen,
      pgn: game.pgn,
      moveTree: tree,
      currentNodeId: endNodeId,
      gameMetadata,
      openingName: gameMetadata.opening ?? null,
      loadedIndexedGame: game,
      lastUci: tree.nodes[endNodeId]?.uci || null,
      ...computeFlags(tree, endNodeId),
    });
  },

  loadFEN: (fen) => {
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch {
      return false;
    }
    resetTransientStateForNewGame();
    const tree = makeEmptyTree(fen);
    set({
      chess,
      currentFen: fen,
      pgn: '',
      moveTree: tree,
      currentNodeId: tree.rootId,
      gameMetadata: null,
      openingName: null,
      loadedIndexedGame: null,
      lastUci: null,
      isAtStart: true,
      isAtEnd: true,
    });
    return true;
  },

  resetBoard: () => {
    resetTransientStateForNewGame();
    const tree = makeEmptyTree();
    set({
      chess: new Chess(),
      currentFen: STARTING_FEN,
      pgn: '',
      moveTree: tree,
      currentNodeId: tree.rootId,
      gameMetadata: null,
      openingName: null,
      loadedIndexedGame: null,
      lastUci: null,
      isAtStart: true,
      isAtEnd: true,
    });
  },

  setOpening: (name) => set({ openingName: name }),
}));

/**
 * Build an IndexedGame from the current moveTree so that any game
 * (imported OR manually played) can be reviewed.
 *
 * When the active node is OFF the mainline (i.e. the user is exploring a
 * variation), reviewing the mainline would analyze the wrong moves. If a
 * current node id is supplied (or available from the store) and it does not
 * lie on the mainline, the indexed game is built from the path to that node
 * (the active line) instead of children[0].
 */
function buildIndexedGameFromTree(
  tree: MoveTree,
  currentNodeId?: string | null
): IndexedGame | null {
  const activeNodeId = currentNodeId ?? useGameStore.getState().currentNodeId;
  const mainlinePath = getMainlinePath(tree);

  // Use the active line when the current node is known and off-mainline.
  let path = mainlinePath;
  if (activeNodeId && !mainlinePath.includes(activeNodeId)) {
    const activePath = getPathToNode(tree, activeNodeId);
    if (activePath.length > 1) path = activePath;
  }

  if (path.length <= 1) return null;

  const root = tree.nodes[tree.rootId];
  const moveSanList: string[] = [];
  const moveUciList: string[] = [];
  const fenPositions: string[] = [root.fen];

  for (let i = 1; i < path.length; i++) {
    const node = tree.nodes[path[i]];
    if (!node) break;
    moveSanList.push(node.san);
    moveUciList.push(node.uci);
    fenPositions.push(node.fen);
  }

  const pgn = moveSanList
    .reduce((acc: string, san: string, i: number) => {
      if (i % 2 === 0) {
        return `${acc}${Math.floor(i / 2) + 1}. ${san} `;
      }
      return `${acc}${san} `;
    }, '')
    .trim();

  return {
    _id: `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    pgn,
    fenPositions,
    moveUciList,
    moveSanList,
    plyCount: moveSanList.length,
    engineReady: true,
    metadata: {},
  };
}

export { getMainlinePath, getPathToNode, buildIndexedGameFromTree };
