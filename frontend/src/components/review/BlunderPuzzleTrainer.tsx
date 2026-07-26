// "Fix Your Blunders" trainer — replays every mistake/blunder/miss from the
// review as a solvable puzzle on a self-contained mini-board. The user drags the
// move they think is best; correct == the engine's bestMoveUci for that position.
// Fully local: its own chess.js instance, no engine call, no store mutation.
import { useMemo, useState, useCallback } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, type Square } from 'chess.js';
import { motion } from 'framer-motion';
import { Trophy, Target, ChevronLeft, ChevronRight, RotateCcw, Lightbulb, Check, X } from 'lucide-react';
import type { GameReviewResult } from '../../types/review';
import { useGameStore } from '../../store/gameStore';
import { buildBlunderPuzzles, type BlunderPuzzle } from '../../utils/blunderPuzzles';
import { useUIStore } from '../../store/uiStore';
import { BOARD_THEMES } from '../../types/themes';
import Button from '../ui/Button';

type Attempt = 'unsolved' | 'wrong' | 'solved';

/** Normalize a chess.js move to UCI (from+to+promotion), matching engine UCI. */
function moveToUci(from: string, to: string, promotion?: string): string {
  return `${from}${to}${promotion ? promotion.toLowerCase() : ''}`;
}

export function BlunderPuzzleTrainer({
  result,
  onExit,
}: {
  result: GameReviewResult;
  onExit: () => void;
}) {
  const moveTree = useGameStore((s) => s.moveTree);
  const boardTheme = useUIStore((s) => s.boardTheme);
  const theme = BOARD_THEMES.find((t) => t.id === boardTheme) ?? BOARD_THEMES[0];

  const puzzles = useMemo(
    () => buildBlunderPuzzles(result, moveTree),
    [result, moveTree],
  );

  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState<Record<string, Attempt>>({});
  const [showHint, setShowHint] = useState(false);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);

  const puzzle: BlunderPuzzle | undefined = puzzles[index];
  const status: Attempt = puzzle ? (attempts[puzzle.id] ?? 'unsolved') : 'unsolved';

  const solvedCount = useMemo(
    () => Object.values(attempts).filter((a) => a === 'solved').length,
    [attempts],
  );

  const goTo = useCallback((next: number) => {
    setIndex(next);
    setShowHint(false);
    setFeedback(null);
  }, []);

  const handleDrop = useCallback(
    (from: string, to: string): boolean => {
      if (!puzzle || status === 'solved') return false;
      // Validate legality against the puzzle position (fresh instance).
      const chess = new Chess(puzzle.fenBefore);
      let played;
      try {
        played = chess.move({ from, to, promotion: 'q' });
      } catch {
        return false;
      }
      if (!played) return false;

      const uci = moveToUci(played.from, played.to, played.promotion);
      const correct = uci === puzzle.solutionUci;
      setAttempts((prev) => ({
        ...prev,
        [puzzle.id]: correct ? 'solved' : 'wrong',
      }));
      setFeedback(correct ? 'correct' : 'wrong');
      // Accept the piece drop visually only when correct; a wrong move snaps back.
      return correct;
    },
    [puzzle, status],
  );

  const revealSolution = useCallback(() => {
    if (!puzzle) return;
    setShowHint(true);
    setAttempts((prev) => ({ ...prev, [puzzle.id]: prev[puzzle.id] ?? 'wrong' }));
  }, [puzzle]);

  // ── Empty state ───────────────────────────────────────────────────────────
  if (puzzles.length === 0) {
    return (
      <div className="bpt-root bpt-empty">
        <Trophy size={32} className="bpt-empty-icon" />
        <h3 className="bpt-empty-title">No blunders to drill</h3>
        <p className="bpt-empty-sub">
          This game had no mistakes, blunders, or misses. Clean play.
        </p>
        <Button variant="ghost" size="md" fullWidth leftIcon={<X size={12} />} onClick={onExit}>
          Back to review
        </Button>
      </div>
    );
  }

  // ── All solved ────────────────────────────────────────────────────────────
  const allSolved = solvedCount === puzzles.length;

  const boardSize = 300;
  const orientation = puzzle?.sideToMove === 'w' ? 'white' : 'black';

  return (
    <motion.div
      className="bpt-root"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="bpt-header">
        <div className="bpt-title-row">
          <Target size={16} />
          <span className="bpt-title">Fix Your Blunders</span>
        </div>
        <div className="bpt-progress">
          {solvedCount}/{puzzles.length} solved
        </div>
      </div>

      <div className="bpt-progress-track" aria-hidden="true">
        <div
          className="bpt-progress-fill"
          style={{ width: `${(solvedCount / puzzles.length) * 100}%` }}
        />
      </div>

      {puzzle && (
        <>
          <div className="bpt-prompt">
            <span className={`bpt-badge bpt-badge--${puzzle.classification}`}>
              {puzzle.classification}
            </span>
            <span className="bpt-prompt-text">
              You played <strong>{puzzle.playedSan}</strong>. Find the best move for{' '}
              <strong>{puzzle.sideToMove === 'w' ? 'White' : 'Black'}</strong>.
            </span>
          </div>

          <div className="bpt-board" style={{ width: boardSize, margin: '0 auto' }}>
            <Chessboard
              id={`bpt-${puzzle.id}`}
              position={puzzle.fenBefore}
              onPieceDrop={(from, to) => handleDrop(from as Square, to as Square)}
              boardOrientation={orientation}
              boardWidth={boardSize}
              arePiecesDraggable={status !== 'solved'}
              customDarkSquareStyle={{ backgroundColor: theme.darkSquare }}
              customLightSquareStyle={{ backgroundColor: theme.lightSquare }}
              customBoardStyle={{ borderRadius: '4px' }}
              animationDuration={200}
            />
          </div>

          <div className="bpt-feedback-row">
            {feedback === 'correct' && (
              <span className="bpt-feedback bpt-feedback--ok">
                <Check size={14} /> Correct — {puzzle.solutionSan}
              </span>
            )}
            {feedback === 'wrong' && status !== 'solved' && (
              <span className="bpt-feedback bpt-feedback--bad">
                <X size={14} /> Not the best. Try again.
              </span>
            )}
            {showHint && status !== 'solved' && (
              <span className="bpt-feedback bpt-feedback--hint">
                Best was <strong>{puzzle.solutionSan}</strong>
              </span>
            )}
          </div>

          <div className="bpt-controls">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ChevronLeft size={14} />}
              disabled={index === 0}
              onClick={() => goTo(index - 1)}
            >
              Prev
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Lightbulb size={14} />}
              disabled={status === 'solved' || showHint}
              onClick={revealSolution}
            >
              Hint
            </Button>
            <Button
              variant="ghost"
              size="sm"
              rightIcon={<ChevronRight size={14} />}
              disabled={index >= puzzles.length - 1}
              onClick={() => goTo(index + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}

      {allSolved && (
        <div className="bpt-done">
          <Trophy size={18} /> All {puzzles.length} solved — mistakes mastered.
        </div>
      )}

      <div className="bpt-footer">
        <Button
          variant="ghost"
          size="md"
          fullWidth
          leftIcon={<RotateCcw size={12} />}
          onClick={() => {
            setAttempts({});
            goTo(0);
          }}
        >
          Reset progress
        </Button>
        <Button variant="ghost" size="md" fullWidth leftIcon={<X size={12} />} onClick={onExit}>
          Back to review
        </Button>
      </div>
    </motion.div>
  );
}
