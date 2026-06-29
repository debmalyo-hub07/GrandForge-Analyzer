import { describe, it, expect } from 'vitest';
import { formatEval, evalToBarPercent } from '../parseUCI';

// Regression net for evaluation normalization. Locks the white-centric
// perspective contract and the eval-bar percent mapping that the post-move
// spike fix depends on.

describe('formatEval — white-centric perspective', () => {
  it('white to move: positive cp stays positive (white better)', () => {
    expect(formatEval({ type: 'cp', value: 40 }, 'w')).toBe('0.40');
  });
  it('black to move: cp is negated so + always means white better', () => {
    // SF reports +40 from black POV = black better = white -0.40.
    expect(formatEval({ type: 'cp', value: 40 }, 'b')).toBe('-0.40');
  });
  it('mate sign follows the same white-centric rule', () => {
    expect(formatEval({ type: 'mate', value: 3 }, 'w')).toBe('M3');
    expect(formatEval({ type: 'mate', value: 3 }, 'b')).toBe('-M3');
    expect(formatEval({ type: 'mate', value: -3 }, 'w')).toBe('-M3');
    expect(formatEval({ type: 'mate', value: -3 }, 'b')).toBe('M3');
  });
  it('undefined score = 0.00, and -0.00 normalizes to 0.00', () => {
    expect(formatEval(undefined, 'w')).toBe('0.00');
    expect(formatEval({ type: 'cp', value: 0 }, 'b')).toBe('0.00');
  });
});

describe('evalToBarPercent — bar mapping', () => {
  it('mate strings pin near the edges (with breathing room)', () => {
    expect(evalToBarPercent('M5')).toBe(99);
    expect(evalToBarPercent('-M5')).toBe(1);
  });
  it('0.00 maps to ~50 (dead center)', () => {
    expect(evalToBarPercent('0.00')).toBeCloseTo(50, 5);
  });
  it('positive eval > 50, negative < 50, clamped to [0.5, 99.5]', () => {
    expect(evalToBarPercent('1.00')).toBeGreaterThan(50);
    expect(evalToBarPercent('-1.00')).toBeLessThan(50);
    expect(evalToBarPercent('50.00')).toBeLessThanOrEqual(99.5);
    expect(evalToBarPercent('-50.00')).toBeGreaterThanOrEqual(0.5);
  });
  it('non-finite / empty input falls back to center (50) — but the UI now guards empty before calling this', () => {
    // This documents the raw-fn behavior the EvalBarHorizontal placeholder
    // now intercepts: '' would map to 50 here, which is why the component
    // must short-circuit empty BEFORE calling evalToBarPercent.
    expect(evalToBarPercent('')).toBe(50);
    expect(evalToBarPercent('abc')).toBe(50);
  });
});
