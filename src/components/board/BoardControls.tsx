import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { RotateCw, RefreshCw, Copy, Maximize, Wrench } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useGameStore } from '../../store/gameStore';
import { useReviewStore } from '../../store/reviewStore';

export interface BoardControlsProps {
  /** Optional callback to open the BoardToolsPanel (parent may render it as popover). */
  onOpenBoardTools?: () => void;
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}

function IconButton({ label, onClick, children, active }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`board-control-btn inline-flex items-center justify-center w-9 h-9 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] transition-colors${
        active ? ' ring-2 ring-[var(--gold)]' : ''
      }`}
    >
      {children}
    </button>
  );
}

export function BoardControls({ onOpenBoardTools }: BoardControlsProps) {
  const flipBoard = useUIStore((s) => s.flipBoard);
  const setBoardToolsOpen = useUIStore((s) => s.setBoardToolsOpen);
  const boardToolsOpen = useUIStore((s) => s.boardToolsOpen);
  const resetBoard = useGameStore((s) => s.resetBoard);
  const currentFen = useGameStore((s) => s.currentFen);
  const isReviewMode = useReviewStore((s) => s.isReviewMode);

  const handleCopyFEN = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentFen);
      toast.success('FEN copied to clipboard');
    } catch {
      toast.error('Failed to copy FEN');
    }
  }, [currentFen]);

  const handleFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => toast.error('Fullscreen unavailable'));
    } else {
      document.exitFullscreen?.().catch(() => undefined);
    }
  }, []);

  const handleToggleTools = useCallback(() => {
    if (onOpenBoardTools) {
      onOpenBoardTools();
      return;
    }
    setBoardToolsOpen(!boardToolsOpen);
  }, [onOpenBoardTools, setBoardToolsOpen, boardToolsOpen]);

  return (
    <div className="board-controls flex items-center gap-2 py-2">
      <IconButton label="Flip board" onClick={flipBoard}>
        <RotateCw size={16} />
      </IconButton>
      {!isReviewMode && (
        <>
          <IconButton label="Reset to starting position" onClick={resetBoard}>
            <RefreshCw size={16} />
          </IconButton>
          <IconButton label="Copy FEN" onClick={handleCopyFEN}>
            <Copy size={16} />
          </IconButton>
          <IconButton label="Fullscreen" onClick={handleFullscreen}>
            <Maximize size={16} />
          </IconButton>
          <IconButton label="Board tools" onClick={handleToggleTools} active={boardToolsOpen}>
            <Wrench size={16} />
          </IconButton>
        </>
      )}
    </div>
  );
}

export default BoardControls;
