import { Chess, type Square } from 'chess.js';

/**
 * Replays a list of UCI moves against the starting FEN and returns SAN strings.
 * Throws if any UCI move is illegal in the resulting position.
 */
export function convertUciToSan(fen: string, uciMoves: string[]): string[] {
  const chess = new Chess(fen);
  const san: string[] = [];
  for (const uci of uciMoves) {
    if (uci.length < 4) throw new Error(`convertUciToSan: invalid UCI "${uci}"`);
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const promotion = uci.length >= 5 ? (uci[4] as 'q' | 'r' | 'b' | 'n') : undefined;
    const move = chess.move({ from, to, promotion });
    if (!move) throw new Error(`convertUciToSan: illegal UCI move "${uci}" at FEN ${chess.fen()}`);
    san.push(move.san);
  }
  return san;
}

/**
 * Convert a single UCI move to SAN for the given FEN.
 * Returns the UCI string itself on failure (caller may use as fallback).
 */
export function uciMoveToSan(fen: string, uci: string): string {
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const promotion = uci.length >= 5 ? (uci[4] as 'q' | 'r' | 'b' | 'n') : undefined;
    const move = chess.move({ from, to, promotion });
    return move?.san ?? uci;
  } catch {
    return uci;
  }
}
