import { describe, it, expect } from 'vitest';
import { DWELL_STEPS, nearestStep, dwellLabel, nextDwell } from './reviewDwell';

describe('DWELL_STEPS', () => {
  it('is ordered slowest to fastest', () => {
    for (let i = 1; i < DWELL_STEPS.length; i++) {
      expect(DWELL_STEPS[i].ms).toBeLessThan(DWELL_STEPS[i - 1].ms);
    }
  });

  it('stays inside the store clamp of 300..6000 ms', () => {
    for (const step of DWELL_STEPS) {
      expect(step.ms).toBeGreaterThanOrEqual(300);
      expect(step.ms).toBeLessThanOrEqual(6000);
    }
  });
});

describe('nearestStep', () => {
  it('resolves each exact step to itself', () => {
    DWELL_STEPS.forEach((step, i) => {
      expect(nearestStep(step.ms)).toBe(i);
    });
  });

  it('snaps an off-step value to the closest step', () => {
    expect(nearestStep(1700)).toBe(1); // 1800
    expect(nearestStep(1000)).toBe(2); // 900
    expect(nearestStep(3000)).toBe(0); // 3600 (vs 1800: 600 < 1200)
  });

  it('clamps beyond both ends rather than going out of range', () => {
    expect(nearestStep(99999)).toBe(0);
    expect(nearestStep(0)).toBe(DWELL_STEPS.length - 1);
    expect(nearestStep(-500)).toBe(DWELL_STEPS.length - 1);
  });
});

describe('dwellLabel', () => {
  it('labels the default as 1x', () => {
    expect(dwellLabel(1800)).toBe('1x');
  });

  it('labels every step', () => {
    expect(DWELL_STEPS.map((s) => dwellLabel(s.ms))).toEqual(['0.5x', '1x', '2x', '4x']);
  });
});

describe('nextDwell', () => {
  it('advances one step through the list', () => {
    expect(nextDwell(3600)).toBe(1800);
    expect(nextDwell(1800)).toBe(900);
    expect(nextDwell(900)).toBe(450);
  });

  it('wraps from the fastest back to the slowest', () => {
    expect(nextDwell(450)).toBe(3600);
  });

  it('advances from an off-step value instead of sticking', () => {
    // The bug this guards: resolving 1700 to "no exact match" and returning it
    // unchanged would leave the button dead for anyone with a stale value.
    expect(nextDwell(1700)).toBe(900);
    expect(nextDwell(1700)).not.toBe(1700);
  });

  it('cycles through every step and returns to the start', () => {
    let ms = DWELL_STEPS[0].ms;
    const seen = [ms];
    for (let i = 0; i < DWELL_STEPS.length - 1; i++) {
      ms = nextDwell(ms);
      seen.push(ms);
    }
    expect(seen).toEqual(DWELL_STEPS.map((s) => s.ms));
    expect(nextDwell(ms)).toBe(DWELL_STEPS[0].ms);
  });
});
