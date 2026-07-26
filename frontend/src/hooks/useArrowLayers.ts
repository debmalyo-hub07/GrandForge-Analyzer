// src/hooks/useArrowLayers.ts
//
// Per-source arrow selectors so analysis, review, and manual layers stay
// isolated. ChessBoardWrapper concats the three arrays at render time. None of
// the selectors share state with the others — engine/review/UI stores own
// their respective layers exclusively.
import { useMemo } from 'react';
import { Chess, type Square } from 'chess.js';
import { useEngineStore, type EngineLine } from '../store/engineStore';
import { useReviewStore } from '../store/reviewStore';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import type { MoveClassification } from '../types/review';
import { cpAndMateToWin } from '../utils/reviewUtils';

export type BoardArrow = [Square, Square, string?];

export const ENGINE_ARROW_BASE_COLOR = '#16a34a';
// Rank hierarchy: the best move is a vibrant emerald at full strength; each
// weaker MultiPV alternative uses a deeper green and fades in alpha, so the
// recommendation reads at a glance instead of a wall of identical arrows.
// Vibrant-classic palette (chess.com / lichess register), not muddy.
const ENGINE_ARROW_BEST_COLOR = '#2fc85a';
const ENGINE_ARROW_ALT_COLOR = '#1f9d4d';
const MAX_ENGINE_ARROW_LINES = 5;
export const ENGINE_ARROW_MAX_DELTA_WIN = 0.05;

const REVIEW_ARROW_GREEN = '#16a34a99';
const REVIEW_ARROW_BOOK = '#c8a84b99';
const REVIEW_ARROW_INACCURACY = '#f0c945b3';
const REVIEW_ARROW_MISTAKE = '#e68f39b3';
const REVIEW_ARROW_MISS = '#e05a5ab3';
const REVIEW_ARROW_BLUNDER = '#ca3431cc';

export function reviewPlayedArrowColor(classification: MoveClassification): string {
  switch (classification) {
    case 'brilliant':
    case 'great':
    case 'best':
    case 'excellent':
    case 'good':
      return REVIEW_ARROW_GREEN;
    case 'book':
      return REVIEW_ARROW_BOOK;
    case 'inaccuracy':
      return REVIEW_ARROW_INACCURACY;
    case 'mistake':
      return REVIEW_ARROW_MISTAKE;
    case 'miss':
      return REVIEW_ARROW_MISS;
    case 'blunder':
      return REVIEW_ARROW_BLUNDER;
    default:
      return REVIEW_ARROW_GREEN;
  }
}

/** Engine arrow color for a given display rank (0 = best move). Alpha folds in
 *  the user's variation-opacity so the settings slider still applies. */
function engineArrowColor(rank: number, opacity: number): string {
  const base = rank === 0 ? ENGINE_ARROW_BEST_COLOR : ENGINE_ARROW_ALT_COLOR;
  const alpha = rank === 0 ? 1 : Math.max(0.4, 0.82 - (rank - 1) * 0.13);
  const clamped = Math.max(0, Math.min(1, opacity));
  const byte = Math.round(255 * alpha * clamped);
  return `${base}${byte.toString(16).padStart(2, '0')}`;
}

function uciToArrow(uci: string, color: string): BoardArrow | null {
  if (!uci || uci.length < 4) return null;
  return [uci.slice(0, 2) as Square, uci.slice(2, 4) as Square, color];
}

function isTerminalFen(fen: string): boolean {
  try {
    return new Chess(fen).isGameOver();
  } catch {
    return false;
  }
}

function moverRelativeScore(line: EngineLine, turn: 'w' | 'b'): { cp: number | null; mate: number | null } {
  return {
    cp: line.rawCp === null ? null : turn === 'b' ? -line.rawCp : line.rawCp,
    mate: line.mate === null ? null : turn === 'b' ? -line.mate : line.mate,
  };
}

function lineWinForMover(line: EngineLine, turn: 'w' | 'b'): number | null {
  if (line.rawCp === null && line.mate === null) return null;
  const score = moverRelativeScore(line, turn);
  return cpAndMateToWin(score.cp, score.mate);
}

function isGoodEnoughEngineAlternative(line: EngineLine, bestLine: EngineLine, turn: 'w' | 'b'): boolean {
  const bestScore = moverRelativeScore(bestLine, turn);
  const lineScore = moverRelativeScore(line, turn);

  if (bestScore.mate !== null && bestScore.mate > 0) {
    return (
      lineScore.mate !== null &&
      lineScore.mate > 0 &&
      lineScore.mate <= Math.abs(bestScore.mate) + 2
    );
  }

  const bestWin = cpAndMateToWin(bestScore.cp, bestScore.mate);
  const lineWin = cpAndMateToWin(lineScore.cp, lineScore.mate);
  return bestWin - lineWin <= ENGINE_ARROW_MAX_DELTA_WIN;
}

export function recommendedEngineFirstMoves(lines: EngineLine[], fen: string): string[] {
  const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const ranked = lines
    .filter((line) => (line.uciMoves[0] ?? '').length >= 4)
    .slice()
    .sort((a, b) => a.multipv - b.multipv)
    .slice(0, MAX_ENGINE_ARROW_LINES);

  if (ranked.length === 0) return [];

  const bestLine = ranked.find((line) => line.multipv === 1) ?? ranked[0];
  const bestWin = lineWinForMover(bestLine, turn);

  return ranked
    .filter((line) => {
      if (line === bestLine || line.multipv === bestLine.multipv) return true;
      if (bestWin === null || (line.rawCp === null && line.mate === null)) return false;
      return isGoodEnoughEngineAlternative(line, bestLine, turn);
    })
    .map((line) => line.uciMoves[0])
    .filter((move): move is string => Boolean(move));
}

export function recommendedEngineFirstMovesKey(lines: EngineLine[], fen: string): string {
  return recommendedEngineFirstMoves(lines, fen).join('|');
}

/** Engine analysis arrows — only when engine is enabled, not in review,
 *  position is non-terminal, and analysis FEN matches current FEN. */
export function useEngineArrows(): BoardArrow[] {
  // Subscribe to a stable key of displayable recommendation arrows, not the raw
  // `lines` array. MultiPV can include poor alternatives, but board arrows
  // should only show line 1 plus alternatives still within the "Good" threshold.
  const firstMovesKey = useEngineStore((s) =>
    recommendedEngineFirstMovesKey(s.lines, s.currentFen),
  );
  const bestMoveUci = useEngineStore((s) => s.bestMoveUci);
  const analyzedFen = useEngineStore((s) => s.analyzedFen);
  const engineEnabled = useEngineStore((s) => s.isEnabled);

  const computerAnalysis = useUIStore((s) => s.computerAnalysis);
  const bestMoveArrow = useUIStore((s) => s.bestMoveArrow);
  const variationOpacity = useUIStore((s) => s.variationOpacity);

  const isReviewMode = useReviewStore((s) => s.isReviewMode);
  const reviewPhase = useReviewStore((s) => s.progress.phase);

  const currentFen = useGameStore((s) => s.currentFen);

  return useMemo<BoardArrow[]>(() => {
    if (!engineEnabled || !computerAnalysis || !bestMoveArrow) return [];
    if (isReviewMode || reviewPhase === 'analyzing') return [];
    if (analyzedFen !== currentFen) return [];
    if (isTerminalFen(currentFen)) return [];

    const opacity = Math.max(0, Math.min(100, variationOpacity)) / 100;
    const out: BoardArrow[] = [];

    // Dedup by from→to: react-chessboard keys each arrow on `${from}-${to}`, so
    // two arrows sharing one (e.g. two MultiPV lines transiently reporting the
    // same first move during a re-sort, or MultiPV reduction near a forcing line)
    // collide on the key — React drops/duplicates the child and can ORPHAN a
    // stale arrow that never unmounts when the set later shrinks to empty (the
    // "arrows persist after game over" bug). Keep the first (best-ranked) line's
    // arrow + color; skip any later line whose first move repeats it.
    const seen = new Set<string>();

    const firstMoves = firstMovesKey ? firstMovesKey.split('|') : [];
    const hasLine = firstMoves.some((m) => m.length >= 4);
    if (hasLine) {
      const count = Math.min(firstMoves.length, MAX_ENGINE_ARROW_LINES);
      for (let i = 0; i < count; i++) {
        const first = firstMoves[i];
        if (first && first.length >= 4) {
          const key = first.slice(0, 4);
          if (seen.has(key)) continue;
          seen.add(key);
          const a = uciToArrow(first, engineArrowColor(out.length, opacity));
          if (a) out.push(a);
        }
      }
    } else if (bestMoveUci && bestMoveUci.length >= 4) {
      const a = uciToArrow(bestMoveUci, engineArrowColor(0, opacity));
      if (a) out.push(a);
    }
    return out;
  }, [
    engineEnabled,
    computerAnalysis,
    bestMoveArrow,
    isReviewMode,
    reviewPhase,
    analyzedFen,
    currentFen,
    variationOpacity,
    firstMovesKey,
    bestMoveUci,
  ]);
}

/** Review arrows: engine top move is green; the played move uses the review
 *  classification color when it differs from the engine top move. */
export function useReviewArrows(): BoardArrow[] {
  const result = useReviewStore((s) => s.result);
  const isReviewMode = useReviewStore((s) => s.isReviewMode);
  const currentReviewPly = useReviewStore((s) => s.currentReviewPly);
  const computerAnalysis = useUIStore((s) => s.computerAnalysis);
  const bestMoveArrow = useUIStore((s) => s.bestMoveArrow);

  return useMemo<BoardArrow[]>(() => {
    if (!isReviewMode || !result || currentReviewPly <= 0) return [];
    if (!computerAnalysis || !bestMoveArrow) return [];

    const review = result.moveReviews[currentReviewPly - 1];
    if (!review) return [];

    // Best move (green) + played move (blue). When the played move IS the best
    // move (every Best/Book/great ply) the two UCIs are identical — emitting
    // both produces a duplicate from-to, which react-chessboard keys collide on
    // ("two children with the same key") and one arrow is silently dropped.
    // In that case show a single green arrow: the played move was best.
    const out: BoardArrow[] = [];
    const bestUci = review.bestMoveUci && review.bestMoveUci.length >= 4 ? review.bestMoveUci : null;
    const playedUci = review.uci && review.uci.length >= 4 ? review.uci : null;
    const sameMove = bestUci !== null && bestUci === playedUci;

    if (bestUci) {
      const a = uciToArrow(bestUci, REVIEW_ARROW_GREEN);
      if (a) out.push(a);
    }
    if (playedUci && !sameMove) {
      const a = uciToArrow(playedUci, reviewPlayedArrowColor(review.classification));
      if (a) out.push(a);
    }
    return out;
  }, [isReviewMode, result, currentReviewPly, computerAnalysis, bestMoveArrow]);
}

/** Manual arrows — user-drawn via right-click drag (uiStore.customArrows). */
export function useManualArrows(): BoardArrow[] {
  const customArrows = useUIStore((s) => s.customArrows);

  return useMemo<BoardArrow[]>(() => {
    return customArrows.map((ca) => [ca[0] as Square, ca[1] as Square, ca[2]] as BoardArrow);
  }, [customArrows]);
}
