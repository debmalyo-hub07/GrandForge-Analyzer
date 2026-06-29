import type { Square } from 'chess.js';
import { useEngineStore, type EngineLine } from '../../store/engineStore';
import { useGameStore } from '../../store/gameStore';
import { EngineStats } from './EngineStats';
import ScoreLabel from '../evaluation/ScoreLabel';
import { rankLabel } from '../../utils/engineLineLabel';

export function EngineLines() {
  const lines = useEngineStore((s) => s.lines);
  const multiPV = useEngineStore((s) => s.multiPV);
  const isEnabled = useEngineStore((s) => s.isEnabled);
  const makeMove = useGameStore((s) => s.makeMove);

  const visibleLines = lines.slice(0, multiPV);

  return (
    <div className="engine-lines flex flex-col gap-1 px-3 py-2">
      <EngineStats />

      {!isEnabled && (
        <div className="text-xs italic text-[var(--text-muted)] py-3 text-center">
          Engine is off — toggle to enable analysis
        </div>
      )}

      {isEnabled && visibleLines.length === 0 && (
        <div className="text-xs italic text-[var(--text-muted)] py-3 text-center">
          Awaiting engine output…
        </div>
      )}

      {visibleLines.map((line) => (
        <EngineLineRow
          key={line.multipv}
          line={line}
          onClick={() => {
            const u = line.uciMoves[0];
            if (!u || u.length < 4) return;
            makeMove({
              from: u.slice(0, 2) as Square,
              to: u.slice(2, 4) as Square,
              promotion: u.length > 4 ? u[4] : undefined,
            });
          }}
        />
      ))}
    </div>
  );
}

function EngineLineRow({
  line,
  onClick,
}: {
  line: EngineLine;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`engine-line group flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] line-${line.multipv}`}
    >
      <span
        className="rank-label shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] bg-[var(--bg-hover)]"
        aria-label={line.multipv === 1 ? 'Engine best line' : `Engine line ${line.multipv}`}
      >
        {rankLabel(line.multipv)}
      </span>
      <ScoreLabel value={line.eval} color={line.moveColor} size="sm" />
      <span className="pv-moves flex flex-wrap items-baseline gap-x-1.5 gap-y-0 text-sm leading-snug">
        {line.sanMoves.slice(0, 7).map((move, i) => (
          <span
            key={i}
            className={
              i === 0
                ? 'first-move font-semibold text-[var(--text-primary)]'
                : 'rest-move text-[var(--text-secondary)]'
            }
          >
            {move}
          </span>
        ))}
        {line.sanMoves.length > 7 && (
          <span className="more text-[var(--text-muted)]">…</span>
        )}
      </span>
    </button>
  );
}

export default EngineLines;
