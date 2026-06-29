import { describe, expect, it } from 'vitest';
import {
  ENGINE_ARROW_BASE_COLOR,
  ENGINE_ARROW_MAX_DELTA_WIN,
  recommendedEngineFirstMoves,
  reviewPlayedArrowColor,
} from '../useArrowLayers';
import type { EngineLine } from '../../store/engineStore';

function line(partial: Partial<EngineLine> & Pick<EngineLine, 'multipv' | 'rawCp' | 'mate' | 'uciMoves'>): EngineLine {
  return {
    eval: '0.00',
    sanMoves: [],
    moveColor: 'equal',
    bestMove: partial.uciMoves[0] ?? '',
    wdl: undefined,
    ...partial,
  };
}

describe('arrow color palette', () => {
  it('uses one green color family for live engine suggestion arrows', () => {
    expect(ENGINE_ARROW_BASE_COLOR).toBe('#16a34a');
  });

  it('maps positive reviewed moves to the same green arrow color', () => {
    const positive = ['brilliant', 'great', 'best', 'excellent', 'good'] as const;
    const colors = new Set(positive.map((classification) => reviewPlayedArrowColor(classification)));
    expect([...colors]).toEqual(['#16a34a99']);
  });

  it('uses distinct warning colors for inaccurate and losing reviewed moves', () => {
    expect(reviewPlayedArrowColor('inaccuracy')).toBe('#f0c945b3');
    expect(reviewPlayedArrowColor('mistake')).toBe('#e68f39b3');
    expect(reviewPlayedArrowColor('miss')).toBe('#e05a5ab3');
    expect(reviewPlayedArrowColor('blunder')).toBe('#ca3431cc');
  });

  it('only allows live engine arrows for best and good-enough MultiPV alternatives', () => {
    const moves = recommendedEngineFirstMoves(
      [
        line({ multipv: 1, rawCp: 100, mate: null, uciMoves: ['e2e4'] }),
        line({ multipv: 2, rawCp: 80, mate: null, uciMoves: ['d2d4'] }),
        line({ multipv: 3, rawCp: -50, mate: null, uciMoves: ['g1f3'] }),
        line({ multipv: 4, rawCp: -300, mate: null, uciMoves: ['b1c3'] }),
        line({ multipv: 5, rawCp: -900, mate: null, uciMoves: ['f2f4'] }),
      ],
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    );

    expect(ENGINE_ARROW_MAX_DELTA_WIN).toBe(0.05);
    expect(moves).toEqual(['e2e4', 'd2d4']);
  });

  it('filters poor live engine alternatives from black-to-move positions', () => {
    const moves = recommendedEngineFirstMoves(
      [
        line({ multipv: 1, rawCp: -100, mate: null, uciMoves: ['e7e5'] }),
        line({ multipv: 2, rawCp: -80, mate: null, uciMoves: ['c7c5'] }),
        line({ multipv: 3, rawCp: 250, mate: null, uciMoves: ['f7f6'] }),
      ],
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    );

    expect(moves).toEqual(['e7e5', 'c7c5']);
  });

  it('keeps much slower forced-mate alternatives out of live arrows', () => {
    const moves = recommendedEngineFirstMoves(
      [
        line({ multipv: 1, rawCp: null, mate: 2, uciMoves: ['d1h5'] }),
        line({ multipv: 2, rawCp: null, mate: 4, uciMoves: ['d1f3'] }),
        line({ multipv: 3, rawCp: null, mate: 8, uciMoves: ['b1c3'] }),
        line({ multipv: 4, rawCp: 120, mate: null, uciMoves: ['f1c4'] }),
      ],
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
    );

    expect(moves).toEqual(['d1h5', 'd1f3']);
  });
});
