// src/components/import/PlatformSelector.tsx
import type { ImportPlatform } from '../../store/importStore';

interface PlatformSelectorProps {
  value: ImportPlatform;
  onChange: (platform: ImportPlatform) => void;
}

export function PlatformSelector({ value, onChange }: PlatformSelectorProps) {
  return (
    <div className="platform-selector" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={value === 'chesscom'}
        className={`platform-segment ${value === 'chesscom' ? 'active' : ''}`}
        onClick={() => onChange('chesscom')}
      >
        Chess.com
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'lichess'}
        className={`platform-segment ${value === 'lichess' ? 'active' : ''}`}
        onClick={() => onChange('lichess')}
      >
        Lichess
      </button>
    </div>
  );
}
