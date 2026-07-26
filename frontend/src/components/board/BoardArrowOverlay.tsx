import React from 'react';
import type { Square } from 'chess.js';
import type { BoardArrow } from '../../hooks/useArrowLayers';

/**
 * Single-shape arrow overlay (chess.com / lichess style). react-chessboard
 * draws each arrow as a thin <line> plus a small detached <polygon> head, which
 * reads as a broken "3-fold" arrow and can't be reshaped via CSS. Instead we
 * suppress the library's arrows (customArrows=[] + areArrowsAllowed=false) and
 * render each arrow here as ONE filled polygon: a thick shaft that flows into a
 * proportional arrowhead, exactly like the mainstream chess sites.
 *
 * Coordinates use a 0..100 viewBox in percentage space so the SVG scales with
 * the board at any size. Square centers mirror react-chessboard's own
 * getRelativeCoords: 12.5% per square, flipped with orientation.
 */
export interface BoardArrowOverlayProps {
  arrows: BoardArrow[];
  orientation: 'white' | 'black';
}

const SQ = 12.5; // one square, in % of board
const HALF = SQ / 2;

// Arrow geometry, all in % units (tuned to the lichess/chess.com proportions).
const SHAFT_HALF = 1.35; // half shaft thickness
const HEAD_HALF = 3.5; // half arrowhead width
const HEAD_LEN = 6.6; // arrowhead length
const TAIL_GAP = 1.6; // lift tail off the source-piece center
const TIP_GAP = 1.1; // pull tip just inside the target square

function center(square: Square, orientation: 'white' | 'black'): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10);
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 8 - rank : rank - 1;
  return { x: col * SQ + HALF, y: row * SQ + HALF };
}

function arrowPoints(from: Square, to: Square, orientation: 'white' | 'black'): string | null {
  const a = center(from, orientation);
  const b = center(to, orientation);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return null;

  const ux = dx / len;
  const uy = dy / len; // unit along the arrow
  const px = -uy;
  const py = ux; // unit perpendicular

  // Clamp head length for very short arrows so the head never eats the shaft.
  const headLen = Math.min(HEAD_LEN, len - TAIL_GAP - TIP_GAP - 0.5);
  const hl = headLen > 1 ? headLen : HEAD_LEN;

  const tailX = a.x + ux * TAIL_GAP;
  const tailY = a.y + uy * TAIL_GAP;
  const tipX = b.x - ux * TIP_GAP;
  const tipY = b.y - uy * TIP_GAP;
  const baseX = tipX - ux * hl;
  const baseY = tipY - uy * hl;

  const pt = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
  return [
    pt(tailX + px * SHAFT_HALF, tailY + py * SHAFT_HALF),
    pt(baseX + px * SHAFT_HALF, baseY + py * SHAFT_HALF),
    pt(baseX + px * HEAD_HALF, baseY + py * HEAD_HALF),
    pt(tipX, tipY),
    pt(baseX - px * HEAD_HALF, baseY - py * HEAD_HALF),
    pt(baseX - px * SHAFT_HALF, baseY - py * SHAFT_HALF),
    pt(tailX - px * SHAFT_HALF, tailY - py * SHAFT_HALF),
  ].join(' ');
}

function BoardArrowOverlayImpl({ arrows, orientation }: BoardArrowOverlayProps) {
  if (arrows.length === 0) return null;
  return (
    <svg
      className="gf-arrow-svg"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {arrows.map(([from, to, color]) => {
        const points = arrowPoints(from as Square, to as Square, orientation);
        if (!points) return null;
        return (
          <polygon
            key={`${from}-${to}`}
            className="gf-arrow-shape"
            points={points}
            fill={color ?? '#2fc85a'}
          />
        );
      })}
    </svg>
  );
}

export const BoardArrowOverlay = React.memo(BoardArrowOverlayImpl);
export default BoardArrowOverlay;
