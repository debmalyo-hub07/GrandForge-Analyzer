import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--gold)] text-[#1a1814] hover:bg-[var(--gold-dim)] border border-[var(--gold)] hover:border-[var(--gold-dim)] shadow-[0_0_0_0_var(--gold-glow)] hover:shadow-[0_0_16px_2px_var(--gold-glow)]',
  secondary:
    'bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border)]',
  ghost:
    'bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent',
  danger:
    'bg-[var(--blunder)] text-white hover:opacity-90 border border-[var(--blunder)]',
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-4 text-sm gap-2 rounded-md',
  lg: 'h-11 px-5 text-base gap-2 rounded-lg',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    leftIcon,
    rightIcon,
    loading = false,
    fullWidth = false,
    disabled,
    className = '',
    children,
    ...props
  },
  ref,
) {
  const base =
    'inline-flex items-center justify-center font-medium transition-all duration-150 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`${base} ${VARIANT_STYLES[variant]} ${SIZE_STYLES[size]} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      {...props}
    >
      {loading ? (
        <span className="inline-block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : (
        leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>
      )}
      {children}
      {!loading && rightIcon && <span className="inline-flex shrink-0">{rightIcon}</span>}
    </button>
  );
});

export default Button;
