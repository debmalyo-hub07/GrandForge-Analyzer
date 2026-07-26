import type { Square } from 'chess.js';

export type { Square };

export type Color = 'w' | 'b';

export type PieceSymbol = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Move {
  from: Square;
  to: Square;
  promotion?: 'q' | 'r' | 'b' | 'n';
  san?: string;
  uci?: string;
  color?: Color;
  piece?: PieceSymbol;
  captured?: PieceSymbol;
  flags?: string;
}

export interface Position {
  fen: string;
  turn: Color;
  fullmoveNumber: number;
  halfmoveClock: number;
  castling: string;
  enPassant: string | null;
}

export interface GameMetadata {
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  event?: string;
  site?: string;
  date?: string;
  result: string;
  timeControl?: string;
  opening?: string;
  ecoCode?: string;
  variant?: string;
  source?: 'chesscom' | 'lichess' | 'pgn_upload' | 'master';
  sourceGameId?: string;
  sourceUrl?: string;
}
