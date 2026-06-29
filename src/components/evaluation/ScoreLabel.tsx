export interface ScoreLabelProps {
  value: string;
  color?: 'white' | 'black' | 'equal';
  size?: 'sm' | 'md';
  className?: string;
}

const COLOR_STYLES: Record<NonNullable<ScoreLabelProps['color']>, string> = {
  white: 'bg-[var(--eval-white)] text-[var(--eval-black)] border-[var(--border)]',
  black: 'bg-[var(--eval-black)] text-[var(--eval-white)] border-[var(--border-strong)]',
  equal:
    'bg-[var(--bg-elevated)] text-[var(--text-primary)] border-[var(--border)]',
};

const SIZE_STYLES: Record<NonNullable<ScoreLabelProps['size']>, string> = {
  sm: 'h-5 min-w-[2.4rem] px-1.5 text-[11px]',
  md: 'h-6 min-w-[2.8rem] px-2 text-xs',
};

function deriveColor(value: string): NonNullable<ScoreLabelProps['color']> {
  if (value === '0.00' || value === '=') return 'equal';
  if (value.startsWith('-')) return 'black';
  return 'white';
}

export function ScoreLabel({
  value,
  color,
  size = 'md',
  className = '',
}: ScoreLabelProps) {
  const resolvedColor = color ?? deriveColor(value);
  return (
    <span
      className={`eval-badge inline-flex items-center justify-center rounded-md border font-mono font-semibold tracking-tight ${COLOR_STYLES[resolvedColor]} ${SIZE_STYLES[size]} ${className}`}
    >
      {value === '0.00' ? '=' : value}
    </span>
  );
}

export default ScoreLabel;
