import { useState } from 'react';
import { ChevronDown, Cpu } from 'lucide-react';
import { useEngineStore } from '../../store/engineStore';
import {
  ENGINE_CONFIGS,
  isMultiThreadingAvailable,
  type EngineVersion,
} from '../../services/EngineManager';

const ENGINE_ORDER: EngineVersion[] = [
  'sf18-lite',
  'sf18-lite-mt',
  'sf17-lite',
  'sf16-lite',
];

const MT_UNAVAILABLE_TITLE =
  'Requires cross-origin isolation — multi-threading unavailable in this context';

export function EngineVersionSelector() {
  const engineVersion = useEngineStore((s) => s.engineVersion);
  const switchEngine = useEngineStore((s) => s.switchEngine);
  const isLoading = useEngineStore((s) => s.isLoading);
  const [open, setOpen] = useState(false);

  // A persisted id naming a removed engine (the dropped 'sf18-full') reaches
  // render before initEngine can normalize it, so an unguarded dereference threw
  // and the ErrorBoundary swallowed the page — permanently, since the effects
  // that would have fixed the value never ran.
  const current = ENGINE_CONFIGS[engineVersion] ?? ENGINE_CONFIGS['sf18-lite'];
  const mtAvailable = isMultiThreadingAvailable();

  const handleSelect = async (v: EngineVersion) => {
    setOpen(false);
    if (v === engineVersion) return;
    await switchEngine(v);
  };

  return (
    <div className="engine-version-selector relative inline-block">
      <button
        type="button"
        disabled={isLoading}
        onClick={() => setOpen((v) => !v)}
        title={current.description}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:opacity-50 disabled:cursor-not-allowed"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Cpu size={12} className="text-[var(--gold)]" />
        <span>{current.label}</span>
        <ChevronDown
          size={12}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            className="absolute right-0 z-50 mt-1 min-w-[280px] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-surface)] shadow-xl"
          >
            {ENGINE_ORDER.map((v) => {
              const cfg = ENGINE_CONFIGS[v];
              const active = v === engineVersion;
              const disabled = cfg.multiThreaded === true && !mtAvailable;
              return (
                <li key={v} role="option" aria-selected={active}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSelect(v)}
                    title={disabled ? MT_UNAVAILABLE_TITLE : cfg.description}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${
                      disabled
                        ? 'cursor-not-allowed text-[var(--text-muted)] opacity-50'
                        : active
                          ? 'bg-[var(--bg-hover)] text-[var(--text-accent)]'
                          : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-sm font-medium">{cfg.label}</span>
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">
                        ~{cfg.sizeMB}MB
                      </span>
                    </div>
                    <span className="text-[11px] text-[var(--text-secondary)] leading-tight">
                      {disabled ? MT_UNAVAILABLE_TITLE : cfg.description}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export default EngineVersionSelector;
