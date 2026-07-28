import { describe, expect, it } from 'vitest';
import {
  parseInfoLine,
  engineSupportsOption,
  infoGapGraceMs,
} from './EngineManager';

describe('parseInfoLine', () => {
  it('parses a normal score-bearing multipv line', () => {
    const r = parseInfoLine(
      'info depth 18 seldepth 26 multipv 1 score cp 34 nodes 1234567 nps 1500000 hashfull 300 time 800 pv e2e4 e7e5 g1f3',
    );
    expect(r).toMatchObject({ multipv: 1, cp: 34, mate: null, depth: 18 });
    expect(r!.pv).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(r!.nps).toBe(1500000);
    expect(r!.hashfull).toBe(300);
    expect(r!.bound).toBeUndefined();
  });

  it('parses mate scores', () => {
    const r = parseInfoLine('info depth 12 multipv 1 score mate -3 pv e1g1');
    expect(r).toMatchObject({ cp: null, mate: -3, depth: 12 });
  });

  it('upperbound token does not shift pv and bound scores are flagged', () => {
    const r = parseInfoLine(
      'info depth 20 seldepth 30 multipv 2 score cp -34 upperbound wdl 120 700 180 nps 1500000 pv e2e4 e7e5',
    );
    expect(r).toMatchObject({ multipv: 2, cp: -34, depth: 20 });
    expect(r!.pv).toEqual(['e2e4', 'e7e5']);
    expect(r!.wdl).toEqual({ win: 120, draw: 700, loss: 180 });
    // Bound lines are one-sided aspiration-window signals, not evaluations.
    expect(r!.bound).toBe('upper');
  });

  it('flags lowerbound scores too', () => {
    const r = parseInfoLine('info depth 20 multipv 1 score cp 900 lowerbound pv d2d4');
    expect(r!.bound).toBe('lower');
    expect(r!.pv).toEqual(['d2d4']);
  });

  it('info string lines are ignored, not parsed as PV-1', () => {
    expect(parseInfoLine('info string NNUE evaluation using nn-9067e33176e8.nnue')).toBeNull();
  });

  it('ignores info lines that carry neither a score nor a pv', () => {
    // Periodic progress lines would otherwise overwrite the real multipv-1
    // entry with a {depth: 0, cp: null, pv: []} stub.
    expect(parseInfoLine('info nodes 1234567 nps 1500000 hashfull 420 time 900')).toBeNull();
    expect(parseInfoLine('info depth 22 currmove e2e4 currmovenumber 1')).toBeNull();
  });

  it('returns null for non-info lines', () => {
    expect(parseInfoLine('bestmove e2e4 ponder e7e5')).toBeNull();
    expect(parseInfoLine('readyok')).toBeNull();
  });
});

describe('engineSupportsOption', () => {
  it('only sf16 accepts Use NNUE / UCI_AnalyseMode', () => {
    expect(engineSupportsOption('sf16-lite', 'Use NNUE')).toBe(true);
    expect(engineSupportsOption('sf16-lite', 'UCI_AnalyseMode')).toBe(true);
    expect(engineSupportsOption('sf18-lite', 'Use NNUE')).toBe(false);
    expect(engineSupportsOption('sf18-lite-mt', 'Use NNUE')).toBe(false);
    expect(engineSupportsOption('sf17-lite', 'UCI_AnalyseMode')).toBe(false);
  });

  it('options common to every build are supported everywhere', () => {
    for (const v of ['sf18-lite', 'sf18-lite-mt', 'sf17-lite', 'sf16-lite'] as const) {
      expect(engineSupportsOption(v, 'Hash')).toBe(true);
      expect(engineSupportsOption(v, 'Threads')).toBe(true);
      expect(engineSupportsOption(v, 'Skill Level')).toBe(true);
      expect(engineSupportsOption(v, 'UCI_LimitStrength')).toBe(true);
      expect(engineSupportsOption(v, 'UCI_ShowWDL')).toBe(true);
    }
  });

  it('unknown engine ids are permissive (never silently drop options)', () => {
    expect(engineSupportsOption(null, 'Use NNUE')).toBe(true);
  });
});

describe('infoGapGraceMs', () => {
  it('movetime < depth < infinite', () => {
    expect(infoGapGraceMs({ moveTimeMs: 500 })).toBe(15000);
    expect(infoGapGraceMs({})).toBe(90000);
    expect(infoGapGraceMs({ infinite: true })).toBe(300000);
    // movetime wins over infinite (matches startSearch precedence).
    expect(infoGapGraceMs({ moveTimeMs: 500, infinite: true })).toBe(15000);
  });
});
