// src/components/import/ImportedGameCard.tsx
import type { IndexedGame } from '../../services/GameEngineAdapter';

interface ImportedGameCardProps {
  game: IndexedGame;
  onClick: () => void;
}

function getMetaString(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key];
  return typeof v === 'string' ? v : undefined;
}

function getMetaNumber(meta: Record<string, unknown>, key: string): number | undefined {
  const v = meta[key];
  return typeof v === 'number' ? v : undefined;
}

function getMetaDateEpoch(meta: Record<string, unknown>, key: string): number | undefined {
  const v = meta[key];
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
  }
  return undefined;
}

function relTime(epochSec?: number): string {
  if (!epochSec || !Number.isFinite(epochSec)) return '';
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000 - epochSec));
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d`;
  const d = new Date(epochSec * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

export function ImportedGameCard({ game, onClick }: ImportedGameCardProps) {
  const meta = game.metadata ?? {};
  const white = getMetaString(meta, 'white') ?? 'White';
  const black = getMetaString(meta, 'black') ?? 'Black';
  const whiteElo = getMetaNumber(meta, 'whiteElo');
  const blackElo = getMetaNumber(meta, 'blackElo');
  const result = getMetaString(meta, 'result') ?? '*';

  const resultClass =
    result === '1-0' ? 'bg-[#3a9c4d] text-white'
    : result === '0-1' ? 'bg-[#5c8bb0] text-white'
    : result === '1/2-1/2' ? 'bg-[var(--bg-active)] text-[var(--text-secondary)]'
    : 'bg-[var(--bg-active)] text-[var(--text-secondary)]';
  const resultLabel = result === '1/2-1/2' ? '½' : result === '*' ? '*' : result;

  const directEndTime = (game as unknown as { endTime?: number }).endTime;
  const directTimeClass = (game as unknown as { timeClass?: string }).timeClass;

  const epoch =
    typeof directEndTime === 'number' && Number.isFinite(directEndTime)
      ? directEndTime
      : getMetaDateEpoch(meta, 'importedAt');

  const tclass =
    (typeof directTimeClass === 'string' && directTimeClass) ||
    getMetaString(meta, 'timeControl') ||
    '';

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 w-full text-left px-3 py-2 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] cursor-pointer border border-transparent hover:border-[var(--border)] transition-colors"
    >
      <span className={`inline-flex items-center justify-center w-9 h-6 rounded font-mono text-[11px] font-bold ${resultClass}`}>
        {resultLabel}
      </span>
      <span className="flex-1 truncate text-sm text-[var(--text-primary)]">
        <span className="font-medium">{white}</span>
        {whiteElo !== undefined ? <span className="text-[var(--text-secondary)]"> ({whiteElo})</span> : null}
        <span className="text-[var(--text-muted)] mx-1.5">vs</span>
        <span className="font-medium">{black}</span>
        {blackElo !== undefined ? <span className="text-[var(--text-secondary)]"> ({blackElo})</span> : null}
      </span>
      <span className="flex items-center gap-2 text-[10px] font-mono text-[var(--text-secondary)] flex-shrink-0">
        {tclass && <span className="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] uppercase tracking-wide">{tclass}</span>}
        {epoch && <span>{relTime(epoch)}</span>}
      </span>
    </button>
  );
}
