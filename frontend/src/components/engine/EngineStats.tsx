import { Loader2 } from 'lucide-react';
import { useEngineStore } from '../../store/engineStore';
import { formatNPS } from '../../utils/formatters';

export function EngineStats() {
  const currentDepth = useEngineStore((s) => s.currentDepth);
  const nps = useEngineStore((s) => s.nps);
  const hashfull = useEngineStore((s) => s.hashfull);
  const isRunning = useEngineStore((s) => s.isRunning);
  const isLoading = useEngineStore((s) => s.isLoading);

  return (
    <div className="engine-stats-bar flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)] py-1">
      <div className="flex items-center gap-2">
        <span className="depth-badge rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[var(--text-primary)] border border-[var(--border)]">
          depth {currentDepth || 0}
        </span>
        <span className="nps-counter font-mono">{formatNPS(nps)}</span>
        <span className="hashfull font-mono">
          hash {(hashfull / 10).toFixed(1)}%
        </span>
      </div>
      {(isRunning || isLoading) && (
        <Loader2
          size={14}
          className="analysis-spinner animate-spin text-[var(--gold)]"
        />
      )}
    </div>
  );
}

export default EngineStats;
