import { Chess } from 'chess.js';

export interface GameIndex {
  fenPositions: string[];
  moveUciList: string[];
  moveSanList: string[];
  plyCount: number;
  engineReady: boolean;
  phase: {
    openingEndsAtPly: number;
    middlegameEndsAtPly: number;
    isEndgame: boolean;
  };
}

export function indexGame(pgn: string): GameIndex {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    throw new Error('indexGame: invalid PGN');
  }

  const history = chess.history({ verbose: true });
  const fenPositions: string[] = [];
  const moveUciList: string[] = [];
  const moveSanList: string[] = [];
  const replay = new Chess();
  fenPositions.push(replay.fen());

  for (const move of history) {
    replay.move(move.san);
    fenPositions.push(replay.fen());
    moveUciList.push(`${move.from}${move.to}${move.promotion || ''}`);
    moveSanList.push(move.san);
  }

  const plyCount = moveUciList.length;
  const openingEndsAtPly = Math.min(plyCount, 20);
  const middlegameEndsAtPly = Math.min(plyCount, Math.floor(plyCount * 0.7));
  const isEndgame = plyCount > 0 && middlegameEndsAtPly >= plyCount - 10;

  return {
    fenPositions,
    moveUciList,
    moveSanList,
    plyCount,
    engineReady: true,
    phase: { openingEndsAtPly, middlegameEndsAtPly, isEndgame },
  };
}
