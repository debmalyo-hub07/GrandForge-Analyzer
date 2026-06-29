import { HTMLAttributes } from 'react';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type SpinnerVariant = 'gold' | 'neutral' | 'white';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  variant?: SpinnerVariant;
  label?: string;
}

const SIZE_PX: Record<SpinnerSize, number> = {
  xs: 12,
  sm: 16,
  md: 24,
  lg: 36,
  xl: 56,
};

const VARIANT_COLORS: Record<SpinnerVariant, { from: string; to: string }> = {
  gold: { from: 'var(--gold)', to: 'var(--gold-dim)' },
  neutral: { from: 'var(--text-secondary)', to: 'var(--text-muted)' },
  white: { from: '#ffffff', to: 'rgba(255,255,255,0.3)' },
};

function Spinner({
  size = 'md',
  variant = 'gold',
  label,
  className = '',
  ...props
}: SpinnerProps) {
  const px = SIZE_PX[size];
  const { from, to } = VARIANT_COLORS[variant];
  const stroke = Math.max(2, Math.round(px / 10));

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
      className={`inline-flex items-center justify-center ${className}`}
      style={{ width: px, height: px }}
      {...props}
    >
      <span
        className="block rounded-full animate-spin"
        style={{
          width: px,
          height: px,
          background: `conic-gradient(from 0deg, ${to}, ${from})`,
          WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`,
          mask: `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`,
        }}
      />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

export default Spinner;
