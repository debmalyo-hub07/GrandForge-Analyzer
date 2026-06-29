import { motion } from 'framer-motion';
import { useEngineStore } from '../../store/engineStore';
import { useUIStore } from '../../store/uiStore';
import { evalToBarPercent } from '../../utils/parseUCI';

export interface EvalBarHorizontalProps {
  width?: number | string;
  height?: number;
}

export function EvalBarHorizontal({
  width = '100%',
  height = 18,
}: EvalBarHorizontalProps) {
  const evalFormatted = useEngineStore((s) => s.evalFormatted);
  const orientation = useUIStore((s) => s.orientation);

  // No evaluation yet (engine off, new game, terminal position). Render a
  // neutral placeholder rather than feeding '' into evalToBarPercent — that
  // parses to NaN and silently snaps the bar to dead-center 50%, which reads
  // as a "drew level" spike. Matches the vertical EvaluationBar placeholder.
  if (!evalFormatted) {
    return (
      <div
        className="eval-bar-horizontal relative flex items-center justify-center overflow-hidden rounded-md border border-[var(--border)] shadow-inner"
        style={{ width, height }}
      >
        <div className="px-1.5 text-[11px] font-mono font-semibold tracking-tight text-[var(--text-secondary)]">
          –
        </div>
      </div>
    );
  }

  const whitePercent = evalToBarPercent(evalFormatted);
  // In horizontal mode, white sits on the LEFT when orientation is white.
  const leftPercent = orientation === 'white' ? whitePercent : 100 - whitePercent;
  const rightPercent = 100 - leftPercent;

  const labelOnLeft = leftPercent > 50;

  return (
    <div
      className="eval-bar-horizontal relative flex overflow-hidden rounded-md border border-[var(--border)] shadow-inner"
      style={{ width, height }}
    >
      <motion.div
        className="absolute inset-y-0 left-0 bg-[var(--eval-white)]"
        animate={{ width: `${leftPercent}%` }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute inset-y-0 right-0 bg-[var(--eval-black)]"
        animate={{ width: `${rightPercent}%` }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
      />
      <div
        className={`absolute top-1/2 -translate-y-1/2 px-1.5 text-[11px] font-mono font-semibold tracking-tight ${
          labelOnLeft
            ? 'left-2 text-[var(--eval-black)]'
            : 'right-2 text-[var(--eval-white)]'
        }`}
      >
        {evalFormatted === '0.00' ? '=' : evalFormatted}
      </div>
    </div>
  );
}

export default EvalBarHorizontal;
