import React from 'react';
import type { Square } from 'chess.js';

/**
 * Absolutely-positioned marker layer drawn on top of <Chessboard/>. Renders the
 * click-to-move selection ring, legal-move dots, and capture rings as real DOM
 * elements (styled in board.css) so they can carry gradients, glow and CSS
 * animation that react-chessboard's inline `customSquareStyles` cannot.
 *
 * Square → cell position mirrors react-chessboard's own getRelativeCoords:
 * squareWidth = boardWidth / 8, columns/rows flip with orientation. Each cell is
 * 12.5% of the board; we emit left/top as percentages so the layer stays
 * pixel-aligned at any board size without threading boardSize through.
 */
export interface BoardMarkerOverlayProps {
  selectedSquare: Square | null;
  legalTargets: Square[];
  captureTargets: Set<Square>;
  orientation: 'white' | 'black';
}

function cellPos(
  square: Square,
  orientation: 'white' | 'black',
): { left: number; top: number } {
  const file = square.charCodeAt(0) - 97; // 'a' -> 0 … 'h' -> 7
  const rank = parseInt(square[1], 10); // 1 … 8
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 8 - rank : rank - 1;
  return { left: col * 12.5, top: row * 12.5 };
}

function BoardMarkerOverlayImpl({
  selectedSquare,
  legalTargets,
  captureTargets,
  orientation,
}: BoardMarkerOverlayProps) {
  return (
    <div className="gf-marker-layer" aria-hidden="true">
      {selectedSquare &&
        (() => {
          const { left, top } = cellPos(selectedSquare, orientation);
          return (
            <div
              className="gf-marker gf-sel"
              style={{ left: `${left}%`, top: `${top}%` }}
            />
          );
        })()}

      {legalTargets.map((sq) => {
        const { left, top } = cellPos(sq, orientation);
        const capture = captureTargets.has(sq);
        return (
          <div
            key={sq}
            className={`gf-marker ${capture ? 'gf-cap' : 'gf-dot'}`}
            style={{ left: `${left}%`, top: `${top}%` }}
          />
        );
      })}
    </div>
  );
}

export const BoardMarkerOverlay = React.memo(BoardMarkerOverlayImpl);
export default BoardMarkerOverlay;
