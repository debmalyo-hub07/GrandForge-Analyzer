import { forwardRef, SelectHTMLAttributes, useId } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  helpText?: string;
  error?: string;
  options?: SelectOption[];
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

const SIZE_STYLES: Record<NonNullable<SelectProps['size']>, string> = {
  sm: 'h-7 pl-2.5 pr-7 text-xs',
  md: 'h-9 pl-3 pr-8 text-sm',
  lg: 'h-11 pl-4 pr-9 text-base',
};

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    helpText,
    error,
    options,
    size = 'md',
    fullWidth = false,
    className = '',
    children,
    id: providedId,
    ...props
  },
  ref,
) {
  const autoId = useId();
  const id = providedId ?? autoId;

  return (
    <div className={`flex flex-col gap-1 ${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label
          htmlFor={id}
          className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={id}
          className={`appearance-none w-full bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border)] rounded-md transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus:border-[var(--gold)] focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] disabled:opacity-50 disabled:cursor-not-allowed ${
            SIZE_STYLES[size]
          } ${error ? 'border-[var(--blunder)]' : ''} ${className}`}
          {...props}
        >
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        <ChevronDown
          size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16}
          className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-secondary)]"
        />
      </div>
      {error ? (
        <span className="text-xs text-[var(--blunder)]">{error}</span>
      ) : helpText ? (
        <span className="text-xs text-[var(--text-muted)]">{helpText}</span>
      ) : null}
    </div>
  );
});

export default Select;
