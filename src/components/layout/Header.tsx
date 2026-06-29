import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { useUIStore } from '../../store/uiStore';
import { useEngineStore } from '../../store/engineStore';
import { ENGINE_CONFIGS, type EngineVersion } from '../../services/EngineManager';

function EngineVersionSelector() {
  const engineVersion = useEngineStore((s) => s.engineVersion);
  const isLoading = useEngineStore((s) => s.isLoading);
  const switchEngine = useEngineStore((s) => s.switchEngine);
  const [open, setOpen] = useState(false);

  const current = ENGINE_CONFIGS[engineVersion];

  const handleSelect = useCallback(
    async (version: EngineVersion) => {
      setOpen(false);
      if (version === engineVersion) return;
      try {
        await switchEngine(version);
        toast.success(`Loaded ${ENGINE_CONFIGS[version].label}`);
      } catch {
        toast.error('Failed to switch engine');
      }
    },
    [engineVersion, switchEngine]
  );

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isLoading}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-sm text-[var(--text-primary)] transition-colors disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="font-mono text-[var(--gold)] text-xs">⚙</span>
        <span className="font-medium">{current.label}</span>
        {isLoading && (
          <span className="inline-block w-3 h-3 rounded-full border-2 border-[var(--gold)] border-t-transparent animate-spin" />
        )}
        <ChevronDown size={14} className="text-[var(--text-secondary)]" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 mt-1 w-72 z-50 rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl overflow-hidden"
        >
          {(Object.keys(ENGINE_CONFIGS) as EngineVersion[]).map((id) => {
            const cfg = ENGINE_CONFIGS[id];
            const isActive = id === engineVersion;
            return (
              <button
                key={id}
                role="option"
                aria-selected={isActive}
                onClick={() => handleSelect(id)}
                className={`w-full text-left px-3 py-2.5 hover:bg-[var(--bg-hover)] transition-colors border-l-2 ${
                  isActive ? 'border-[var(--gold)] bg-[var(--bg-hover)]' : 'border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-[var(--text-primary)]">
                    {cfg.label}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--text-muted)]">
                    {cfg.sizeMB}MB
                  </span>
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5 leading-snug">
                  {cfg.description}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ThemeToggleButton() {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('theme-light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label="Toggle theme"
      className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-[var(--border)] bg-[var(--bg-base)]/95 backdrop-blur-md">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        <Link
          to="/"
          className="inline-flex items-baseline gap-2 group select-none"
          aria-label="GrandForge home"
        >
          <span
            className="text-[var(--gold)] text-2xl leading-none transition-transform group-hover:rotate-[6deg]"
            aria-hidden
          >
            ♟
          </span>
          <span
            className="font-display font-semibold text-lg tracking-wide text-[var(--text-primary)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Grand<span className="text-[var(--gold)]">Forge</span>
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <EngineVersionSelector />
          <ThemeToggleButton />
        </div>
      </div>
    </header>
  );
}

export default Header;
