import { describe, it, expect } from 'vitest';
import { infoGapGraceMs } from '../EngineManager';

describe('infoGapGraceMs — mode-aware watchdog grace', () => {
  it('depth searches get the 90s deep-think grace', () => {
    expect(infoGapGraceMs({ moveTimeMs: null })).toBe(90000);
    expect(infoGapGraceMs({ moveTimeMs: 0 })).toBe(90000);
    expect(infoGapGraceMs({})).toBe(90000);
  });

  it('movetime searches keep the tight 15s grace', () => {
    expect(infoGapGraceMs({ moveTimeMs: 1000 })).toBe(15000);
    expect(infoGapGraceMs({ moveTimeMs: 100 })).toBe(15000);
  });

  it('infinite searches get the long 5min grace so a deepening search is never reaped', () => {
    expect(infoGapGraceMs({ moveTimeMs: null, infinite: true })).toBe(300000);
    expect(infoGapGraceMs({ infinite: true })).toBe(300000);
  });

  it('movetime takes precedence over infinite (explicit clock wins)', () => {
    expect(infoGapGraceMs({ moveTimeMs: 2000, infinite: true })).toBe(15000);
  });

  it('infinite:false falls back to the depth grace', () => {
    expect(infoGapGraceMs({ moveTimeMs: null, infinite: false })).toBe(90000);
  });
});
