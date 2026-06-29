import { Chess } from 'chess.js';
import type { Color } from '../types/chess';

export type BoardPiece = { type: 'p' | 'n' | 'b' | 'r' | 'q' | 'k'; color: Color } | null;

/** Returns true if `fen` parses as a legal chess.js position. */
export function validateFen(fen: string): boolean {
  if (typeof fen !== 'string' || fen.trim().length === 0) return false;
  try {
    // chess.js constructor throws on invalid FEN
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a FEN string into an 8x8 array of { type, color } | null.
 * Index [0] is rank 8 (top), index [7] is rank 1 (bottom).
 */
export function fenToBoardArray(fen: string): BoardPiece[][] {
  const board: BoardPiece[][] = [];
  const ranks = fen.split(' ')[0]?.split('/') ?? [];
  for (const rank of ranks) {
    const row: BoardPiece[] = [];
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) {
        for (let i = 0; i < parseInt(ch, 10); i++) row.push(null);
      } else {
        const isWhite = ch === ch.toUpperCase();
        row.push({
          type: ch.toLowerCase() as 'p' | 'n' | 'b' | 'r' | 'q' | 'k',
          color: isWhite ? 'w' : 'b',
        });
      }
    }
    board.push(row);
  }
  return board;
}

/** Returns 'w' or 'b' for the side to move encoded in the FEN. */
export function getSideToMove(fen: string): Color {
  const parts = fen.split(' ');
  return parts[1] === 'b' ? 'b' : 'w';
}

/**
 * Strip the halfmove clock and fullmove number from a FEN — useful for
 * opening-book lookups where these fields should not affect identity.
 */
export function normalizeFen(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return fen.trim();
  return parts.slice(0, 4).join(' ');
}
