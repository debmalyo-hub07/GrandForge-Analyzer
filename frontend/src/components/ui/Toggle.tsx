import { useId } from 'react';

export interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
  className?: string;
  /** Optional stable selector for the switch button (E2E tests). */
  testId?: string;
}

function Toggle({
  label,
  checked,
  onChange,
  description,
  disabled = false,
  className = '',
  testId,
}: ToggleProps) {
  const id = useId();

  return (
    <label
      htmlFor={id}
      className={`flex items-center justify-between gap-3 py-1.5 ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      {(label || description) && (
        <div className="flex flex-col min-w-0">
          {label && (
            <span className="text-sm text-[var(--text-primary)] select-none">{label}</span>
          )}
          {description && (
            <span className="text-xs text-[var(--text-secondary)] select-none">
              {description}
            </span>
          )}
        </div>
      )}
      <button
        id={id}
        role="switch"
        type="button"
        aria-checked={checked}
        disabled={disabled}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] ${
          checked
            ? 'bg-gradient-to-r from-[var(--gold-dim)] to-[var(--gold)]'
            : 'bg-[var(--bg-elevated)] border border-[var(--border)]'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
    </label>
  );
}

export default Toggle;
