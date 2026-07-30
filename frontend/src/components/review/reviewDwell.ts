/**
 * Review autoplay speed steps.
 *
 * Dwell per ply, slowest to fastest, labelled as multipliers against the 1800 ms
 * default so the control reads like a video player's speed button.
 *
 * Extracted from ReviewMovePanel so the step arithmetic can be unit-tested — the
 * cycling has to keep working for a persisted value that is not exactly on a
 * step (an older build, or a hand-edited localStorage), and a wrong answer there
 * shows up as a button that silently refuses to change speed.
 */

export interface DwellStep {
  ms: number;
  label: string;
}

export const DWELL_STEPS: readonly DwellStep[] = [
  { ms: 3600, label: '0.5x' },
  { ms: 1800, label: '1x' },
  { ms: 900, label: '2x' },
  { ms: 450, label: '4x' },
];

/** Index of the step closest to `ms`. Ties resolve to the slower step, since
 *  the array is ordered slowest-first and the comparison is strict. */
export function nearestStep(ms: number): number {
  let best = 0;
  for (let i = 1; i < DWELL_STEPS.length; i++) {
    if (Math.abs(DWELL_STEPS[i].ms - ms) < Math.abs(DWELL_STEPS[best].ms - ms)) best = i;
  }
  return best;
}

export function dwellLabel(ms: number): string {
  return DWELL_STEPS[nearestStep(ms)].label;
}

/** Next speed, wrapping past the fastest back to the slowest. */
export function nextDwell(ms: number): number {
  return DWELL_STEPS[(nearestStep(ms) + 1) % DWELL_STEPS.length].ms;
}
