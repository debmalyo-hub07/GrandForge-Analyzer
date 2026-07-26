import { useEngineStore } from '../../store/engineStore';
import { useUIStore } from '../../store/uiStore';
import { evalToBarPercent } from '../../utils/parseUCI';

export interface EvaluationBarProps {
  height: number;
}

/** Per-mille WDL the engine may emit on the headline line (lines[0]). */
interface WdlInfo {
  win: number;
  draw: number;
  loss: number;
}

export function EvaluationBar({ height }: EvaluationBarProps) {
  const evalFormatted = useEngineStore((s) => s.evalFormatted);
  // Headline line is lines[0]; read its optional WDL (per-mille). Older engines
  // (or before the first emit) leave it undefined — we render nothing then.
  const wdl = useEngineStore(
    (s) => (s.lines[0] as { wdl?: WdlInfo } | undefined)?.wdl,
  );
  const orientation = useUIStore((s) => s.orientation);

  const whitePercent = evalToBarPercent(evalFormatted);
  const topPercent = orientation === 'white' ? 100 - whitePercent : whitePercent;
  const botPercent = 100 - topPercent;

  const labelOnTop = topPercent > 50;

  // No evaluation data available — render an empty bar placeholder
  if (!evalFormatted) {
    return (
      <div
        className="eval-bar relative w-8 overflow-hidden rounded-md border border-[var(--border)] shadow-inner"
        style={{ height }}
        role="meter"
        aria-label="Engine evaluation"
        aria-valuenow={50}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="eval-label absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-1 text-[10px] font-mono font-semibold tracking-tight text-[var(--text-secondary)]"
        >
          -
        </div>
      </div>
    );
  }

  return (
    <div className="eval-bar-wrap flex flex-col items-center gap-1">
      <div
        className="eval-bar relative w-8 overflow-hidden rounded-md border border-[var(--border)] shadow-inner"
        style={{ height }}
        role="meter"
        aria-label={`Engine evaluation: ${evalFormatted}`}
        aria-valuenow={whitePercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="eval-black-fill absolute inset-x-0 top-0 bg-[var(--eval-black)]"
          style={{ height: `${topPercent}%`, transition: 'height 0.2s ease-in-out' }}
        />
        <div
          className="eval-white-fill absolute inset-x-0 bottom-0 bg-[var(--eval-white)]"
          style={{ height: `${botPercent}%`, transition: 'height 0.2s ease-in-out' }}
        />
        <div
          className={`eval-label absolute left-1/2 -translate-x-1/2 px-1 text-[10px] font-mono font-semibold tracking-tight ${
            labelOnTop
              ? 'top-1 text-[var(--eval-white)]'
              : 'bottom-1 text-[var(--eval-black)]'
          }`}
        >
          {evalFormatted === '0.00' ? '=' : evalFormatted}
        </div>
      </div>

      {wdl && (
        <div
          className="eval-wdl flex gap-1 font-mono text-[9px] leading-none tracking-tight text-[var(--text-muted)]"
          title="Win / Draw / Loss (White)"
        >
          <span className="eval-wdl-win text-[var(--text-secondary)]">
            {(wdl.win / 10).toFixed(0)}%
          </span>
          <span className="eval-wdl-draw">{(wdl.draw / 10).toFixed(0)}%</span>
          <span className="eval-wdl-loss">{(wdl.loss / 10).toFixed(0)}%</span>
        </div>
      )}
    </div>
  );
}

export default EvaluationBar;
