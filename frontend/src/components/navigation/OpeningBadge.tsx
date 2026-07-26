import { useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { openings as openingsApi } from '../../services/apiClient';

interface OpeningSearchResult {
  ecoCode: string;
  name: string;
  family?: string;
  variation?: string;
}

export function OpeningBadge() {
  const openingName = useGameStore((s) => s.openingName);
  const gameMetadata = useGameStore((s) => s.gameMetadata);
  const [results, setResults] = useState<OpeningSearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [open, setOpen] = useState(false);

  if (!openingName) return null;

  const ecoCode = gameMetadata?.ecoCode ?? null;

  const handleClick = async () => {
    setOpen((v) => !v);
    if (results) return;
    setIsSearching(true);
    try {
      const data = await openingsApi.search({ q: openingName });
      const items = (data?.openings as OpeningSearchResult[] | undefined) ?? [];
      setResults(items);
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="opening-badge relative">
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex w-full items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
        title="Click to explore opening tree"
      >
        <BookOpen size={14} className="text-[var(--gold)] flex-shrink-0" />
        {ecoCode && (
          <span className="font-mono text-xs font-semibold text-[var(--text-accent)]">
            {ecoCode}
          </span>
        )}
        <span className="flex-1 truncate text-[var(--text-primary)]">
          {openingName}
        </span>
        <Search
          size={12}
          className="flex-shrink-0 text-[var(--text-muted)]"
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
          <div className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--bg-surface)] shadow-xl">
            {isSearching && (
              <div className="px-3 py-2 text-xs italic text-[var(--text-muted)]">
                Searching openings…
              </div>
            )}
            {!isSearching && results && results.length === 0 && (
              <div className="px-3 py-2 text-xs italic text-[var(--text-muted)]">
                No related openings found.
              </div>
            )}
            {!isSearching &&
              results &&
              results.map((r, i) => (
                <div
                  key={`${r.ecoCode}-${i}`}
                  className="flex items-center gap-2 border-b border-[var(--border)]/40 px-3 py-1.5 last:border-b-0"
                >
                  <span className="font-mono text-xs text-[var(--text-accent)]">
                    {r.ecoCode}
                  </span>
                  <span className="text-xs text-[var(--text-primary)] truncate">
                    {r.name}
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

export default OpeningBadge;
