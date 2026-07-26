import { HTMLAttributes, ReactNode } from 'react';

export type BadgeVariant = 'gold' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: ReactNode;
  outline?: boolean;
  children: ReactNode;
}

const VARIANT_STYLES: Record<BadgeVariant, { solid: string; outline: string }> = {
  gold: {
    solid: 'bg-[var(--gold)] text-[#1a1814]',
    outline: 'border border-[var(--gold)] text-[var(--gold)] bg-[var(--gold-glow)]',
  },
  success: {
    solid: 'bg-[var(--best)] text-[#0a1a08]',
    outline: 'border border-[var(--best)] text-[var(--best)] bg-[var(--best)]/15',
  },
  warning: {
    solid: 'bg-[var(--inaccuracy)] text-[#1a1408]',
    outline:
      'border border-[var(--inaccuracy)] text-[var(--inaccuracy)] bg-[var(--inaccuracy)]/15',
  },
  danger: {
    solid: 'bg-[var(--blunder)] text-white',
    outline: 'border border-[var(--blunder)] text-[var(--blunder)] bg-[var(--blunder)]/15',
  },
  info: {
    solid: 'bg-[var(--great)] text-white',
    outline: 'border border-[var(--great)] text-[var(--great)] bg-[var(--great)]/15',
  },
  neutral: {
    solid: 'bg-[var(--bg-elevated)] text-[var(--text-primary)]',
    outline: 'border border-[var(--border-strong)] text-[var(--text-secondary)]',
  },
};

const SIZE_STYLES: Record<BadgeSize, string> = {
  sm: 'h-4 px-1.5 text-[10px] gap-1',
  md: 'h-5 px-2 text-xs gap-1',
  lg: 'h-6 px-2.5 text-sm gap-1.5',
};

function Badge({
  variant = 'neutral',
  size = 'md',
  icon,
  outline = false,
  className = '',
  children,
  ...props
}: BadgeProps) {
  const variantStyle = outline ? VARIANT_STYLES[variant].outline : VARIANT_STYLES[variant].solid;

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold whitespace-nowrap select-none ${variantStyle} ${SIZE_STYLES[size]} ${className}`}
      {...props}
    >
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      {children}
    </span>
  );
}

export default Badge;
