import { ChangeEvent, useId } from 'react';

export interface SliderProps {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  label?: string;
  showValue?: boolean;
  formatValue?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

function Slider({
  min,
  max,
  value,
  onChange,
  step = 1,
  label,
  showValue = true,
  formatValue,
  disabled = false,
  className = '',
}: SliderProps) {
  const id = useId();
  const percent = ((value - min) / (max - min)) * 100;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };

  const displayValue = formatValue ? formatValue(value) : String(value);

  return (
    <div className={`flex flex-col gap-1.5 w-full ${className}`}>
      {(label || showValue) && (
        <div className="flex items-center justify-between text-xs">
          {label && (
            <label
              htmlFor={id}
              className="text-[var(--text-secondary)] font-medium uppercase tracking-wide"
            >
              {label}
            </label>
          )}
          {showValue && (
            <span className="text-[var(--text-accent)] font-mono font-medium">
              {displayValue}
            </span>
          )}
        </div>
      )}
      <div className="relative flex items-center h-5">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-[var(--bg-elevated)]" />
        <div
          className="absolute h-1.5 rounded-full bg-gradient-to-r from-[var(--gold-dim)] to-[var(--gold)] pointer-events-none"
          style={{ width: `${percent}%` }}
        />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className="relative w-full h-5 appearance-none bg-transparent cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 slider-input focus:outline-none"
          style={{ WebkitAppearance: 'none' }}
        />
      </div>
      <style>{`
        .slider-input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--gold);
          border: 2px solid var(--bg-base);
          cursor: pointer;
          box-shadow: 0 0 0 1px var(--gold-dim), 0 2px 6px rgba(0,0,0,0.3);
          transition: transform 0.1s;
        }
        .slider-input::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }
        .slider-input:focus-visible::-webkit-slider-thumb {
          box-shadow: 0 0 0 3px var(--gold-glow), 0 2px 6px rgba(0,0,0,0.3);
        }
        .slider-input::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--gold);
          border: 2px solid var(--bg-base);
          cursor: pointer;
          box-shadow: 0 0 0 1px var(--gold-dim), 0 2px 6px rgba(0,0,0,0.3);
        }
      `}</style>
    </div>
  );
}

export default Slider;
