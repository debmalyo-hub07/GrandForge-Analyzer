import { useState } from 'react';
import { Zap, ZapOff, ChevronDown, ChevronRight, Infinity as InfinityIcon, Square, Play } from 'lucide-react';
import Toggle from '../ui/Toggle';
import Slider from '../ui/Slider';
import { useEngineStore } from '../../store/engineStore';
import { useUIStore } from '../../store/uiStore';

const MULTIPV_OPTIONS: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];
const HASH_OPTIONS = [16, 32, 64, 128, 256, 512];
const MAX_THREADS =
  typeof navigator !== 'undefined' ? Math.max(1, navigator.hardwareConcurrency ?? 1) : 1;

export function EngineControls() {
  const isEnabled = useEngineStore((s) => s.isEnabled);
  const setEnabled = useEngineStore((s) => s.setEnabled);
  const multiPV = useEngineStore((s) => s.multiPV);
  const setMultiPV = useEngineStore((s) => s.setMultiPV);
  const engineSettings = useEngineStore((s) => s.engineSettings);
  const setEngineSettings = useEngineStore((s) => s.setEngineSettings);
  const isRunning = useEngineStore((s) => s.isRunning);
  const currentDepth = useEngineStore((s) => s.currentDepth);

  const [advancedOpen, setAdvancedOpen] = useState(false);

  const handleToggleEngine = (v: boolean) => {
    setEnabled(v);
    useUIStore.getState().setComputerAnalysis(v);
  };

  return (
    <div className="engine-controls flex flex-col gap-3 px-3 py-3 border-b border-[var(--border)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isEnabled ? (
            <Zap size={14} className="text-[var(--gold)]" />
          ) : (
            <ZapOff size={14} className="text-[var(--text-muted)]" />
          )}
          <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)] font-medium">
            Engine
          </span>
        </div>
        <Toggle checked={isEnabled} onChange={handleToggleEngine} />
      </div>

      <div
        className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-2"
        data-testid="infinite-status"
      >
        <div className="flex items-center gap-2 text-xs">
          <InfinityIcon size={14} className="text-[var(--gold)]" />
          <span className="text-[var(--text-secondary)]">
            {isRunning ? 'Searching' : 'Idle'} -{' '}
            <span className="font-mono text-[var(--text-accent)]">depth {currentDepth}</span>
          </span>
        </div>
        {isRunning ? (
          <button
            type="button"
            disabled={!isEnabled}
            onClick={() => useEngineStore.getState().stopAnalysis()}
            aria-label="Stop analysis"
            data-testid="analysis-stop"
            className="flex items-center gap-1 rounded px-2 h-7 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:opacity-40"
          >
            <Square size={11} /> Stop
          </button>
        ) : (
          <button
            type="button"
            disabled={!isEnabled}
            onClick={() => {
              const fen = useEngineStore.getState().currentFen;
              if (fen) useEngineStore.getState().startAnalysis(fen);
            }}
            aria-label="Resume analysis"
            data-testid="analysis-resume"
            className="flex items-center gap-1 rounded px-2 h-7 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:opacity-40"
          >
            <Play size={11} /> Resume
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--text-secondary)] font-medium uppercase tracking-wide">
            Lines
          </span>
          <span className="text-[var(--text-accent)] font-mono font-medium">
            {multiPV}
          </span>
        </div>
        <div
          role="group"
          aria-label="Multi PV selector"
          className="grid grid-cols-5 gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5"
        >
          {MULTIPV_OPTIONS.map((n) => {
            const active = n === multiPV;
            return (
              <button
                key={n}
                type="button"
                disabled={!isEnabled}
                onClick={() => setMultiPV(n)}
                className={`h-7 rounded text-xs font-mono font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:opacity-40 disabled:cursor-not-allowed ${
                  active
                    ? 'bg-gradient-to-b from-[var(--gold)] to-[var(--gold-dim)] text-[var(--bg-void)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
                aria-pressed={active}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
          className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] rounded"
        >
          {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Engine settings
        </button>

        {advancedOpen && (
          <div className="flex flex-col gap-3 pl-1">
            <Slider
              label="Threads"
              min={1}
              max={MAX_THREADS}
              value={engineSettings.threads}
              onChange={(v) => setEngineSettings({ threads: v })}
              disabled={!isEnabled}
            />

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-secondary)] font-medium uppercase tracking-wide">
                  Hash
                </span>
                <span className="text-[var(--text-accent)] font-mono font-medium">
                  {engineSettings.hash} MB
                </span>
              </div>
              <div
                role="group"
                aria-label="Hash size selector"
                className="grid grid-cols-6 gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5"
              >
                {HASH_OPTIONS.map((mb) => {
                  const active = mb === engineSettings.hash;
                  return (
                    <button
                      key={mb}
                      type="button"
                      disabled={!isEnabled}
                      onClick={() => setEngineSettings({ hash: mb })}
                      className={`h-7 rounded text-[10px] font-mono font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:opacity-40 disabled:cursor-not-allowed ${
                        active
                          ? 'bg-gradient-to-b from-[var(--gold)] to-[var(--gold-dim)] text-[var(--bg-void)] shadow-sm'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                      }`}
                      aria-pressed={active}
                    >
                      {mb}
                    </button>
                  );
                })}
              </div>
            </div>

            <Slider
              label="Skill level"
              min={0}
              max={20}
              value={engineSettings.skillLevel}
              onChange={(v) => setEngineSettings({ skillLevel: v })}
              disabled={!isEnabled}
              formatValue={(v) => (v === 20 ? 'Max' : String(v))}
            />

            <Toggle
              label="NNUE"
              description="Neural-net evaluation"
              checked={engineSettings.useNNUE}
              onChange={(v) => setEngineSettings({ useNNUE: v })}
              disabled={!isEnabled}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default EngineControls;
