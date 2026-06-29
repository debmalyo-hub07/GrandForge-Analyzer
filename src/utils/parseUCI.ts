import type { UCIInfo } from '../types/engine';

const WIN_SLOPE = 0.00368208;

// NOTE: The canonical UCI info parser lives in EngineManager.parseInfoLine
// (src/services/EngineManager.ts). This module retains only formatting
// helpers used by the engine store / eval bar to avoid drift.

export function formatEval(score: UCIInfo['score'], turnToMove: 'w' | 'b'): string {
  if (!score) return '0.00';
  if (score.type === 'mate') {
    const m = score.value;
    return turnToMove === 'b'
      ? m > 0
        ? `-M${m}`
        : `M${Math.abs(m)}`
      : m > 0
        ? `M${m}`
        : `-M${Math.abs(m)}`;
  }
  let cp = score.value;
  if (turnToMove === 'b') cp = -cp;
  return (cp / 100).toFixed(2).replace('-0.00', '0.00');
}

export function evalToBarPercent(evalString: string): number {
  // Mate: pin near 100/0 with slight breathing room based on |N|
  if (evalString.startsWith('-M')) return 1;
  if (evalString.startsWith('M')) return 99;
  const cp = parseFloat(evalString) * 100;
  if (!Number.isFinite(cp)) return 50;
  const winPct = 50 + 50 * (2 / (1 + Math.exp(-WIN_SLOPE * cp)) - 1);
  return Math.max(0.5, Math.min(99.5, winPct));
}
