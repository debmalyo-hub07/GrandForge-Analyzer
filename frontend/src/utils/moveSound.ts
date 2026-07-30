/**
 * Which sound a move should make.
 *
 * Classification is kept separate from playback so it can be unit-tested without
 * an AudioContext, and so the priority order is written down once rather than
 * being implied by the order of if-statements inside an audio routine.
 *
 * Input is the chess.js move flags plus the state of the resulting position —
 * deliberately NOT the SAN string. SAN encodes all of this (`x`, `+`, `#`, `=Q`,
 * `O-O`), but parsing it back out means splitting on those characters, and
 * treating SAN as a delimited format is exactly the class of bug that made 8% of
 * the ECO book unmatchable (see the explorer invariant in CLAUDE.md).
 */

export type MoveSound =
  | 'move'
  | 'capture'
  | 'castle'
  | 'promote'
  | 'check'
  | 'gameEnd';

export interface MoveSoundInput {
  /** chess.js `Move.flags` — 'c' capture, 'e' en passant, 'p' promotion,
   *  'k'/'q' castling, 'b' big pawn push, 'n' normal. */
  flags: string;
  /** The side to move is in check after this move. */
  isCheck: boolean;
  /** Any terminal position: mate, stalemate, threefold, 50-move, insufficient. */
  isGameOver: boolean;
}

/**
 * Highest-priority event wins. The order encodes what a player most needs to
 * hear: the game ending outranks a check, a check outranks the mechanics of how
 * the move was made, and a capture outranks a quiet move.
 *
 * Note that check and capture are not combined — a capture-with-check plays the
 * check sound only. Layering both reads as a glitch at these durations.
 */
export function classifyMoveSound(input: MoveSoundInput): MoveSound {
  const { flags, isCheck, isGameOver } = input;

  if (isGameOver) return 'gameEnd';
  if (isCheck) return 'check';
  if (flags.includes('p')) return 'promote';
  if (flags.includes('k') || flags.includes('q')) return 'castle';
  // 'e' is en passant, which is a capture that does not land on the captured
  // piece's square — chess.js sets 'e' without 'c', so it must be named here or
  // en passant would play the quiet move sound.
  if (flags.includes('c') || flags.includes('e')) return 'capture';
  return 'move';
}
