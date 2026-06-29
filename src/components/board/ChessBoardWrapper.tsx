import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, type Square } from 'chess.js';
import { useUIStore } from '../../store/uiStore';
import { useGameStore } from '../../store/gameStore';
import { useReviewStore } from '../../store/reviewStore';
import { BOARD_THEMES, PIECE_SETS } from '../../types/themes';
import { buildSquareStyles, buildCustomPieces, REVIEW_COLORS, REVIEW_GLYPHS, readableTextColor } from '../../utils/boardUtils';
import { computeMotifs } from '../../utils/motifs';
import { useEngineArrows, useReviewArrows, useManualArrows } from '../../hooks/useArrowLayers';

export interface ChessBoardWrapperProps {
  boardSize: number;
}

export function ChessBoardWrapper({ boardSize }: ChessBoardWrapperProps) {
  const makeMove = useGameStore((s) => s.makeMove);
  const currentFen = useGameStore((s) => s.currentFen);
  const lastUci = useGameStore((s) => s.lastUci);

  const orientation = useUIStore((s) => s.orientation);
  const showCoordinates = useUIStore((s) => s.showCoordinates);
  const highlightedSquares = useUIStore((s) => s.highlightedSquares);
  const boardTheme = useUIStore((s) => s.boardTheme);
  const pieceSet = useUIStore((s) => s.pieceSet);
  const moveAnnotations = useUIStore((s) => s.moveAnnotations);
  const computerAnalysis = useUIStore((s) => s.computerAnalysis);
  const undefendedPieces = useUIStore((s) => s.undefendedPieces);
  const pinnedPieces = useUIStore((s) => s.pinnedPieces);
  const checkableKing = useUIStore((s) => s.checkableKing);

  const result = useReviewStore((s) => s.result);
  const currentReviewPly = useReviewStore((s) => s.currentReviewPly);
  const isReviewMode = useReviewStore((s) => s.isReviewMode);

  const engineArrows = useEngineArrows();
  const reviewArrows = useReviewArrows();
  const manualArrows = useManualArrows();

  const theme = BOARD_THEMES.find((t) => t.id === boardTheme) ?? BOARD_THEMES[0];
  const pieces = PIECE_SETS.find((p) => p.id === pieceSet) ?? PIECE_SETS[0];

  const motifs = useMemo(() => computeMotifs(currentFen), [currentFen]);

  const chessAtFen = useMemo(() => {
    try {
      return new Chess(currentFen);
    } catch {
      return null;
    }
  }, [currentFen]);

  const isTerminal = chessAtFen ? chessAtFen.isGameOver() : false;

  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);

  // boardPosition is what react-chessboard actually renders.
  // During review navigation we apply the UCI move against the previous FEN so
  // the library can compute a from→to diff and animate the piece over the 200ms
  // animationDuration.  For all other navigation (goBack, goForward, loads,
  // resets) lastUci is null and we sync directly, which is instantaneous and
  // intentional (non-review jumps have no single move to animate).
  const [boardPosition, setBoardPosition] = useState<string>(currentFen);
  const prevFenRef = useRef<string>(currentFen);

  useEffect(() => {
    if (lastUci && lastUci.length >= 4) {
      // Apply the UCI move on top of the previous board position so
      // react-chessboard sees a single-piece delta and plays its CSS animation.
      const from = lastUci.slice(0, 2) as Square;
      const to   = lastUci.slice(2, 4) as Square;
      const promotion = lastUci.length === 5 ? lastUci[4] : undefined;
      try {
        const chess = new Chess(prevFenRef.current);
        chess.move({ from, to, promotion });
        setBoardPosition(chess.fen());
      } catch {
        // Fallback: illegal on prevFen (e.g. after a game load race) — sync directly.
        setBoardPosition(currentFen);
      }
    } else {
      setBoardPosition(currentFen);
    }
    prevFenRef.current = currentFen;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFen, lastUci]);

  useEffect(() => {
    setSelectedSquare(null);
    setLegalTargets([]);
  }, [currentFen]);

  const handleSquareClick = (sq: Square) => {
    if (isReviewMode) return;
    if (!chessAtFen) return;
    const piece = chessAtFen.get(sq);
    if (selectedSquare && legalTargets.includes(sq)) {
      const sel = chessAtFen.get(selectedSquare);
      const isPromotion =
        !!sel && sel.type === 'p' && (sq[1] === '8' || sq[1] === '1');
      if (isPromotion) {
        // Let react-chessboard's promotion dialog handle it via onPieceDrop flow.
        // For click-to-move, just default to queen since the library's dialog
        // only fires on drag-drop. Click-based underpromotion is rare.
      }
      makeMove({
        from: selectedSquare,
        to: sq,
        promotion: isPromotion ? 'q' : undefined,
      });
      setSelectedSquare(null);
      setLegalTargets([]);
      return;
    }
    if (piece && piece.color === chessAtFen.turn()) {
      setSelectedSquare(sq);
      const moves = chessAtFen.moves({ square: sq, verbose: true });
      setLegalTargets(moves.map((m) => m.to as Square));
    } else {
      setSelectedSquare(null);
      setLegalTargets([]);
    }
  };

  const isPromotionMove = (src: Square, tgt: Square): boolean => {
    if (!chessAtFen) return false;
    const piece = chessAtFen.get(src);
    if (!piece || piece.type !== 'p') return false;
    return (piece.color === 'w' && tgt[1] === '8') || (piece.color === 'b' && tgt[1] === '1');
  };

  const reviewedMoves = isReviewMode && result ? result.moveReviews : [];

  const reviewBadgeSquare = useMemo(() => {
    if (!isReviewMode || !result) return null;
    const reviewIdx = currentReviewPly - 1;
    if (reviewIdx < 0 || reviewIdx >= reviewedMoves.length) return null;
    const review = reviewedMoves[reviewIdx];
    if (!review || review.uci.length < 4) return null;
    return {
      square: review.uci.slice(2, 4) as Square,
      classification: review.classification,
    };
  }, [isReviewMode, result, currentReviewPly, reviewedMoves]);

  // Stable base pieces — only rebuilds when piece-set path changes.
  const basePieces = useMemo(() => buildCustomPieces(pieces.path), [pieces.path]);

  // Resolve which piece-key sits on the badge square (depends on FEN, but only
  // the resolved key is used downstream — chessAtFen is NOT in renderer deps).
  const badgePieceKey = useMemo(() => {
    if (!reviewBadgeSquare || !chessAtFen) return null;
    const p = chessAtFen.get(reviewBadgeSquare.square);
    if (!p) return null;
    return `${p.color}${p.type.toUpperCase()}`;
  }, [reviewBadgeSquare, chessAtFen]);

  const customPieces = useMemo(() => {
    if (!reviewBadgeSquare || !badgePieceKey) return basePieces;
    const original = basePieces[badgePieceKey];
    if (!original) return basePieces;

    const badgeColor = REVIEW_COLORS[reviewBadgeSquare.classification] ?? '#888';
    const badgeGlyph = REVIEW_GLYPHS[reviewBadgeSquare.classification] ?? '';
    const targetSquare = reviewBadgeSquare.square;

    const BadgeRenderer = (args: { squareWidth: number; square?: string }) => {
      if ((args as any).square !== targetSquare) {
        return original(args);
      }
      const sw = args.squareWidth;
      return React.createElement(
        'div',
        { style: { position: 'relative', width: sw, height: sw } },
        original(args),
        React.createElement('span', {
          className: `review-badge review-badge--${reviewBadgeSquare.classification}`,
          style: {
            position: 'absolute',
            top: 2,
            right: 2,
            background: badgeColor,
            color: readableTextColor(badgeColor),
            fontSize: Math.max(10, sw * 0.30),
            fontWeight: 900,
            lineHeight: 1,
            padding: `${Math.max(1, sw * 0.02)}px ${Math.max(2, sw * 0.04)}px`,
            borderRadius: '3px',
            boxShadow: `0 0 10px ${badgeColor}, 0 0 20px ${badgeColor}66, 0 0 3px ${badgeColor}`,
            zIndex: 20,
            fontFamily: "'Segoe UI', monospace",
            pointerEvents: 'none',
          },
        }, badgeGlyph)
      );
    };

    return { ...basePieces, [badgePieceKey]: BadgeRenderer as any };
  }, [basePieces, reviewBadgeSquare, badgePieceKey]);

  const squareStyles = useMemo(() => {
    const base = buildSquareStyles(
      highlightedSquares,
      reviewedMoves,
      currentReviewPly,
      moveAnnotations
    );

    if (computerAnalysis) {
      if (undefendedPieces) {
        for (const sq of motifs.undefended) {
          base[sq] = {
            ...base[sq],
            boxShadow: 'inset 0 0 0 3px rgba(220,80,80,0.85)',
          };
        }
      }
      if (pinnedPieces) {
        for (const sq of motifs.pinned) {
          base[sq] = {
            ...base[sq],
            boxShadow: 'inset 0 0 0 3px rgba(255,180,0,0.85)',
          };
        }
      }
      if (checkableKing && motifs.checkableKing) {
        base[motifs.checkableKing] = {
          ...base[motifs.checkableKing],
          boxShadow: 'inset 0 0 12px rgba(220,40,40,0.9)',
        };
      }
    }

    if (selectedSquare) {
      const prevSelBg = base[selectedSquare]?.background;
      base[selectedSquare] = {
        ...base[selectedSquare],
        background: prevSelBg
          ? `${prevSelBg}, radial-gradient(circle, rgba(255,215,0,0.45) 36%, transparent 36%)`
          : 'radial-gradient(circle, rgba(255,215,0,0.45) 36%, transparent 36%)',
      };
      for (const t of legalTargets) {
        const target = chessAtFen ? chessAtFen.get(t) : null;
        const prevTgtBg = base[t]?.background;
        base[t] = {
          ...base[t],
          background: prevTgtBg ?? (target
            ? 'radial-gradient(circle, transparent 56%, rgba(20,180,80,0.55) 56%, rgba(20,180,80,0.55) 70%, transparent 70%)'
            : 'radial-gradient(circle, rgba(20,180,80,0.55) 22%, transparent 22%)'),
        };
      }
    }

    if (chessAtFen && chessAtFen.inCheck()) {
      const turn = chessAtFen.turn();
      const board = chessAtFen.board();
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const p = board[r][f];
          if (p && p.type === 'k' && p.color === turn) {
            const file = String.fromCharCode(97 + f);
            const rank = String(8 - r);
            const sq = (file + rank) as Square;
            const checkPrevBg = base[sq]?.background;
            base[sq] = {
              ...base[sq],
              background: checkPrevBg
                ? `${checkPrevBg}, radial-gradient(circle, rgba(220,40,40,0.7) 35%, transparent 75%)`
                : 'radial-gradient(circle, rgba(220,40,40,0.7) 35%, transparent 75%)',
              boxShadow: 'inset 0 0 14px rgba(220,40,40,0.7)',
            };
          }
        }
      }
    }

    return base;
  }, [
    highlightedSquares,
    reviewedMoves,
    currentReviewPly,
    moveAnnotations,
    computerAnalysis,
    undefendedPieces,
    pinnedPieces,
    checkableKing,
    motifs,
    selectedSquare,
    legalTargets,
    chessAtFen,
  ]);

  const mergedArrows = useMemo<[Square, Square, string?][]>(
    () => [...engineArrows, ...reviewArrows, ...manualArrows],
    [engineArrows, reviewArrows, manualArrows],
  );

  return (
    <Chessboard
      id="grandforge-board"
      position={boardPosition}
      onPieceDrop={(src, tgt) => {
        if (isReviewMode) return false;
        if (isPromotionMove(src as Square, tgt as Square)) return false;
        return makeMove({ from: src as Square, to: tgt as Square });
      }}
      onPromotionCheck={(src, tgt) => {
        return !isReviewMode && isPromotionMove(src as Square, tgt as Square);
      }}
      onPromotionPieceSelect={(piece, src, tgt) => {
        if (!piece || !src || !tgt) return false;
        const promoChar = piece[1]?.toLowerCase();
        return makeMove({ from: src as Square, to: tgt as Square, promotion: promoChar });
      }}
      boardOrientation={orientation}
      boardWidth={boardSize}
      customDarkSquareStyle={{ backgroundColor: theme.darkSquare }}
      customLightSquareStyle={{ backgroundColor: theme.lightSquare }}
      customBoardStyle={{
        borderRadius: '4px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
      }}
      customSquareStyles={squareStyles}
      customArrows={mergedArrows}
      customPieces={customPieces}
      onSquareClick={(sq) => handleSquareClick(sq as Square)}
      onSquareRightClick={(sq) =>
        useUIStore.getState().toggleHighlight(sq as Square)
      }
      showBoardNotation={showCoordinates}
      animationDuration={200}
      promotionDialogVariant="modal"
    />
  );
}

export default React.memo(ChessBoardWrapper);
