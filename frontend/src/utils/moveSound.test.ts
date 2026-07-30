import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { classifyMoveSound, type MoveSound } from './moveSound';

/** Play a line from the start and classify its final move the way the store
 *  does, so the tests pin real chess.js flag values rather than my guesses. */
function soundOfLine(sanMoves: string[], startFen?: string): MoveSound {
  const chess = startFen ? new Chess(startFen) : new Chess();
  let last = null;
  for (const san of sanMoves) last = chess.move(san);
  if (!last) throw new Error('no move played');
  return classifyMoveSound({
    flags: last.flags,
    isCheck: chess.inCheck(),
    isGameOver: chess.isGameOver(),
  });
}

describe('classifyMoveSound', () => {
  it('plays the quiet sound for a normal move', () => {
    expect(soundOfLine(['e4'])).toBe('move');
    expect(soundOfLine(['Nf3'])).toBe('move');
  });

  it('plays capture for an ordinary capture', () => {
    expect(soundOfLine(['e4', 'd5', 'exd5'])).toBe('capture');
  });

  it('plays capture for en passant, which chess.js flags as e without c', () => {
    // Verify the premise, then the classification — en passant would fall
    // through to 'move' if only 'c' were checked.
    const chess = new Chess();
    for (const san of ['e4', 'a6', 'e5', 'd5']) chess.move(san);
    const ep = chess.move('exd6');
    expect(ep.flags).toContain('e');
    expect(ep.flags).not.toContain('c');
    expect(soundOfLine(['e4', 'a6', 'e5', 'd5', 'exd6'])).toBe('capture');
  });

  it('plays castle for both sides', () => {
    expect(soundOfLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'])).toBe('castle');
    expect(soundOfLine(['d4', 'd5', 'Nc3', 'Nc6', 'Bf4', 'Bf5', 'Qd2', 'Qd7', 'O-O-O'])).toBe(
      'castle',
    );
  });

  it('plays promote for a promotion', () => {
    expect(soundOfLine(['a8=Q'], '8/P6k/8/8/8/8/7K/8 w - - 0 1')).toBe('promote');
  });

  it('plays check for a checking move', () => {
    expect(soundOfLine(['e4', 'f5', 'Qh5'])).toBe('check');
  });

  it('plays gameEnd for checkmate rather than check', () => {
    expect(soundOfLine(['f3', 'e5', 'g4', 'Qh4'])).toBe('gameEnd');
  });

  it('plays gameEnd for stalemate, which is not a check', () => {
    // Qa6-g6 leaves the h8 king with g7/g8/h7 all covered and h8 unattacked.
    const chess = new Chess('7k/8/Q7/8/8/8/8/K7 w - - 0 1');
    chess.move('Qg6');
    expect(chess.isStalemate()).toBe(true);
    expect(chess.inCheck()).toBe(false);
    expect(soundOfLine(['Qg6'], '7k/8/Q7/8/8/8/8/K7 w - - 0 1')).toBe('gameEnd');
  });

  it('ranks the events: game end over check over promotion over castle over capture', () => {
    const base = { flags: 'c', isCheck: false, isGameOver: false };
    expect(classifyMoveSound({ ...base, isGameOver: true, isCheck: true })).toBe('gameEnd');
    expect(classifyMoveSound({ ...base, isCheck: true })).toBe('check');
    expect(classifyMoveSound({ ...base, flags: 'pc' })).toBe('promote');
    expect(classifyMoveSound({ ...base, flags: 'k' })).toBe('castle');
    expect(classifyMoveSound(base)).toBe('capture');
    expect(classifyMoveSound({ ...base, flags: 'n' })).toBe('move');
  });

  it('does not layer check and capture — a capture with check is just check', () => {
    // 3.Qxe5+ takes a pawn and checks along the e-file.
    expect(soundOfLine(['e4', 'e5', 'Qh5', 'Nc6', 'Qxe5+'])).toBe('check');
    expect(classifyMoveSound({ flags: 'c', isCheck: true, isGameOver: false })).toBe('check');
  });
});
