import { describe, it, expect } from 'vitest';
import { rankLabel } from '../engineLineLabel';

describe('rankLabel — engine MultiPV rank, not quality tier', () => {
  it('rank 1 is the engine best move', () => {
    expect(rankLabel(1)).toBe('Best');
  });

  it('lower ranks are honest ordinals, never fabricated quality words', () => {
    expect(rankLabel(2)).toBe('#2');
    expect(rankLabel(3)).toBe('#3');
    expect(rankLabel(5)).toBe('#5');
  });

  it('guards against bad input by flooring at rank 1', () => {
    expect(rankLabel(0)).toBe('Best');
    expect(rankLabel(-4)).toBe('Best');
  });
});
