import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useGameStore } from '../../store/gameStore';

export function NavigationControls() {
  const goToStart = useGameStore((s) => s.goToStart);
  const goBack = useGameStore((s) => s.goBack);
  const goForward = useGameStore((s) => s.goForward);
  const goToEnd = useGameStore((s) => s.goToEnd);
  const isAtStart = useGameStore((s) => s.isAtStart);
  const isAtEnd = useGameStore((s) => s.isAtEnd);

  return (
    <div
      className="navigation-controls flex items-center justify-center gap-1 border-t border-[var(--border)] bg-[var(--bg-surface)] px-2 py-2"
      role="toolbar"
      aria-label="Move navigation"
    >
      <NavButton
        onClick={goToStart}
        disabled={isAtStart}
        label="Go to start"
        shortcut="↑"
      >
        <ChevronFirst size={16} />
      </NavButton>
      <NavButton
        onClick={goBack}
        disabled={isAtStart}
        label="Previous move"
        shortcut="←"
      >
        <ChevronLeft size={16} />
      </NavButton>
      <NavButton
        onClick={goForward}
        disabled={isAtEnd}
        label="Next move"
        shortcut="→"
      >
        <ChevronRight size={16} />
      </NavButton>
      <NavButton
        onClick={goToEnd}
        disabled={isAtEnd}
        label="Go to end"
        shortcut="↓"
      >
        <ChevronLast size={16} />
      </NavButton>
    </div>
  );
}

function NavButton({
  onClick,
  disabled,
  label,
  shortcut,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  shortcut: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={`${label} (${shortcut})`}
      className="inline-flex h-8 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[var(--bg-elevated)]"
    >
      {children}
    </button>
  );
}

export default NavigationControls;
