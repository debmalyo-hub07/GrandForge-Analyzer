import React from 'react';
import type { Square } from '../types/chess';
import type { MoveClassification, MoveReview } from '../types/review';

export const REVIEW_COLORS: Record<MoveClassification, string> = {
  brilliant: '#1baca6',
  great: '#5c8bb0',
  book: '#c8a84b',
  best: '#96bc4b',
  excellent: '#96bc4b',
  good: '#82ac49',
  inaccuracy: '#f0c945',
  mistake: '#e68f39',
  miss: '#e05a5a',
  blunder: '#ca3431',
};

export const REVIEW_GLYPHS: Record<MoveClassification, string> = {
  brilliant: '!!',
  great: '!',
  book: '\uD83D\uDCD6',
  best: '\u2605',
  excellent: '\uD83D\uDC4D',
  good: '\u2713',
  inaccuracy: '?!',
  mistake: '?',
  miss: '\u2717',
  blunder: '??',
};

/**
 * Pick a text colour (near-black or white) that meets WCAG AA contrast against
 * the given badge background. The classification palette is the recognizable
 * chess.com-style set, but white text fails AA on the light greens/yellows
 * (e.g. inaccuracy #f0c945 \u2192 1.6:1). Per-luminance selection keeps the brand
 * colours while making the glyph/label legible (all 10 reach \u2265 AA).
 */
const BADGE_TEXT_DARK = '#1a1a1a';
const BADGE_TEXT_LIGHT = '#ffffff';

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length < 6) return 0;
  const channels = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function readableTextColor(bgHex: string): string {
  const contrast = (a: number, b: number) => {
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  };
  const bg = relativeLuminance(bgHex);
  const darkRatio = contrast(relativeLuminance(BADGE_TEXT_DARK), bg);
  const lightRatio = contrast(relativeLuminance(BADGE_TEXT_LIGHT), bg);
  return darkRatio >= lightRatio ? BADGE_TEXT_DARK : BADGE_TEXT_LIGHT;
}

/**
 * Build the `customSquareStyles` map for react-chessboard.
 *
 * - Right-click highlights render a red filled overlay.
 * - When `moveAnnotations` is enabled and a review exists, the destination
 *   square of the move that LED to the current position gets a colored border
 *   PLUS a badge-like circle in the top-right corner, making the classification
 *   clearly visible on the board (not just a border).
 *
 * `currentPly` here is the ply we are CURRENTLY DISPLAYING. Ply N means the
 * board shows the position AFTER move N — so we decorate moveReviews[N-1].
 */
export function buildSquareStyles(
  highlightedSquares: Set<Square> | Iterable<Square>,
  reviewedMoves: MoveReview[] = [],
  currentPly: number = -1,
  moveAnnotations: boolean = false
): Record<string, React.CSSProperties> {
  const styles: Record<string, React.CSSProperties> = {};

  for (const sq of highlightedSquares) {
    styles[sq] = { background: 'rgba(235, 97, 80, 0.8)', borderRadius: '50%' };
  }

  if (moveAnnotations && reviewedMoves.length > 0 && currentPly > 0) {
    const review = reviewedMoves[currentPly - 1];
    if (review && review.uci.length >= 4) {
      const toSq = review.uci.slice(2, 4);
      const color = REVIEW_COLORS[review.classification] ?? '#888';
      styles[toSq] = {
        ...styles[toSq],
        boxShadow: `inset 0 0 0 4px ${color}, 0 0 12px ${color}80`,
      };
    }
  }

  return styles;
}

/**
 * Build the `customPieces` map for react-chessboard from a piece-set base path.
 * Returns a record of piece keys (e.g. 'wN', 'bQ') → component renderer.
 */
export function buildCustomPieces(
  basePath: string
): Record<string, React.FC<{ squareWidth: number }>> {
  const pieces: Record<string, React.FC<{ squareWidth: number }>> = {};
  const colors = ['w', 'b'] as const;
  const types = ['P', 'N', 'B', 'R', 'Q', 'K'] as const;
  const normalized = basePath.endsWith('/') ? basePath : `${basePath}/`;

  for (const c of colors) {
    for (const t of types) {
      const key = `${c}${t}`;
      const src = `${normalized}${key}.svg`;
      const Renderer: React.FC<{ squareWidth: number }> = ({ squareWidth }) =>
        React.createElement('img', {
          src,
          alt: key,
          style: { width: squareWidth, height: squareWidth },
        });
      Renderer.displayName = `Piece(${key})`;
      pieces[key] = Renderer;
    }
  }
  return pieces;
}
