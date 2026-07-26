import { useMemo, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { BOARD_THEMES, PIECE_SETS } from '../../types/themes';
import { buildCustomPieces } from '../../utils/boardUtils';

const STARTING_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

const PALETTE: { key: string; label: string }[] = [
  { key: 'wK', label: 'White King' },
  { key: 'wQ', label: 'White Queen' },
  { key: 'wR', label: 'White Rook' },
  { key: 'wB', label: 'White Bishop' },
  { key: 'wN', label: 'White Knight' },
  { key: 'wP', label: 'White Pawn' },
  { key: 'bK', label: 'Black King' },
  { key: 'bQ', label: 'Black Queen' },
  { key: 'bR', label: 'Black Rook' },
  { key: 'bB', label: 'Black Bishop' },
  { key: 'bN', label: 'Black Knight' },
  { key: 'bP', label: 'Black Pawn' },
];

type PieceKey =
  | 'wK' | 'wQ' | 'wR' | 'wB' | 'wN' | 'wP'
  | 'bK' | 'bQ' | 'bR' | 'bB' | 'bN' | 'bP';

interface BoardEditorProps {
  initialFen?: string;
  onClose: () => void;
  onConfirm: (fen: string) => void;
}

/** Parse FEN board portion → 64 cell array indexed a8..h1 row-major. */
function fenToBoard(fen: string): (PieceKey | null)[] {
  const board: (PieceKey | null)[] = Array(64).fill(null);
  const placement = fen.split(' ')[0];
  const rows = placement.split('/');
  for (let r = 0; r < 8; r++) {
    const row = rows[r] ?? '';
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += parseInt(ch, 10);
      } else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        const type = ch.toUpperCase();
        if (file < 8) board[r * 8 + file] = `${color}${type}` as PieceKey;
        file++;
      }
    }
  }
  return board;
}

/** Convert 64-cell board → FEN with default castling/clock/turn fields. */
function boardToFen(board: (PieceKey | null)[], turn: 'w' | 'b' = 'w'): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    let empties = 0;
    for (let f = 0; f < 8; f++) {
      const cell = board[r * 8 + f];
      if (!cell) {
        empties++;
      } else {
        if (empties > 0) {
          row += empties.toString();
          empties = 0;
        }
        const color = cell[0];
        const type = cell[1];
        row += color === 'w' ? type.toUpperCase() : type.toLowerCase();
      }
    }
    if (empties > 0) row += empties.toString();
    rows.push(row);
  }
  return `${rows.join('/')} ${turn} KQkq - 0 1`;
}

function squareToIndex(sq: string): number {
  const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = parseInt(sq[1], 10);
  const r = 8 - rank;
  return r * 8 + file;
}

export function BoardEditor({
  initialFen = STARTING_FEN,
  onClose,
  onConfirm,
}: BoardEditorProps) {
  const { boardTheme, pieceSet } = useUIStore();
  const theme = BOARD_THEMES.find((t) => t.id === boardTheme) ?? BOARD_THEMES[0];
  const pieces = PIECE_SETS.find((p) => p.id === pieceSet) ?? PIECE_SETS[0];
  const customPieces = useMemo(() => buildCustomPieces(pieces.path), [pieces.path]);

  const [board, setBoard] = useState<(PieceKey | null)[]>(() =>
    fenToBoard(initialFen)
  );
  const [selectedPiece, setSelectedPiece] = useState<PieceKey | null>(null);
  const [turn, setTurn] = useState<'w' | 'b'>('w');
  const [error, setError] = useState<string | null>(null);

  const currentFen = useMemo(() => boardToFen(board, turn), [board, turn]);

  const handleSquareClick = (sq: string) => {
    const idx = squareToIndex(sq);
    setError(null);
    setBoard((prev) => {
      const next = [...prev];
      if (selectedPiece === null) {
        // No piece selected → clear the square
        next[idx] = null;
      } else {
        next[idx] = selectedPiece;
      }
      return next;
    });
  };

  const handlePieceDrop = (src: string, tgt: string): boolean => {
    const srcIdx = squareToIndex(src);
    const tgtIdx = squareToIndex(tgt);
    setError(null);
    setBoard((prev) => {
      const next = [...prev];
      const piece = next[srcIdx];
      if (!piece) return prev;
      next[tgtIdx] = piece;
      next[srcIdx] = null;
      return next;
    });
    return true;
  };

  const handleClearBoard = () => {
    setBoard(fenToBoard(EMPTY_FEN));
    setError(null);
  };

  const handleResetStart = () => {
    setBoard(fenToBoard(STARTING_FEN));
    setTurn('w');
    setError(null);
  };

  const handleSetPosition = () => {
    try {
      new Chess(currentFen);
    } catch {
      setError('Position is invalid (need both kings, no illegal check, etc.)');
      return;
    }
    onConfirm(currentFen);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="board-editor-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 4 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
          className="board-editor-modal relative bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] shadow-2xl p-5 flex gap-5 max-w-[860px] w-full"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close board editor"
            className="absolute top-3 right-3 p-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X size={16} />
          </button>

          <div className="board-editor-left flex flex-col gap-3" style={{ width: 420 }}>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">
              Board editor
            </h3>
            <Chessboard
              id="grandforge-editor"
              position={currentFen}
              onPieceDrop={(src, tgt) =>
                handlePieceDrop(src as Square, tgt as Square)
              }
              onSquareClick={(sq) => handleSquareClick(sq as Square)}
              boardWidth={400}
              arePiecesDraggable={true}
              arePremovesAllowed={false}
              customDarkSquareStyle={{ backgroundColor: theme.darkSquare }}
              customLightSquareStyle={{ backgroundColor: theme.lightSquare }}
              customBoardStyle={{ borderRadius: '4px' }}
              customPieces={customPieces}
              showBoardNotation
              animationDuration={0}
            />
            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <label className="flex items-center gap-1.5">
                <span>Side to move:</span>
                <select
                  value={turn}
                  onChange={(e) => setTurn(e.target.value as 'w' | 'b')}
                  className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--text-primary)]"
                >
                  <option value="w">White</option>
                  <option value="b">Black</option>
                </select>
              </label>
            </div>
          </div>

          <div className="board-editor-right flex flex-col gap-3 flex-1 min-w-[200px]">
            <div className="palette-label text-xs uppercase tracking-widest text-[var(--text-muted)]">
              Piece palette
            </div>
            <div className="piece-palette grid grid-cols-3 gap-2">
              {PALETTE.map((p) => {
                const isActive = selectedPiece === p.key;
                const PieceRenderer = customPieces[p.key];
                return (
                  <button
                    key={p.key}
                    type="button"
                    title={p.label}
                    aria-pressed={isActive}
                    onClick={() => setSelectedPiece(p.key as PieceKey)}
                    className={`palette-cell flex items-center justify-center aspect-square rounded-md border transition-colors ${
                      isActive
                        ? 'border-[var(--gold)] bg-[var(--gold-glow)]'
                        : 'border-[var(--border)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {PieceRenderer ? <PieceRenderer squareWidth={40} /> : p.key}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setSelectedPiece(null)}
              className={`text-xs px-2 py-1 rounded border ${
                selectedPiece === null
                  ? 'border-[var(--gold)] text-[var(--gold)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Eraser (click squares to clear)
            </button>

            <div className="editor-actions flex flex-col gap-2 mt-auto">
              <button
                type="button"
                onClick={handleClearBoard}
                className="px-3 py-2 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-sm text-[var(--text-primary)]"
              >
                Clear board
              </button>
              <button
                type="button"
                onClick={handleResetStart}
                className="px-3 py-2 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-sm text-[var(--text-primary)]"
              >
                Reset to start
              </button>
              <button
                type="button"
                onClick={handleSetPosition}
                className="px-3 py-2 rounded-md text-sm font-semibold text-white bg-gradient-to-br from-[var(--gold)] to-[var(--gold-dim)] hover:opacity-90"
              >
                Set Position
              </button>
              {error && (
                <p className="text-xs text-[var(--blunder)]">{error}</p>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default BoardEditor;
