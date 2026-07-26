/**
 * Label a MultiPV line by its ENGINE RANK, not a fabricated quality tier.
 * Stockfish ranks lines strictly by evaluation: multipv=1 is the best line,
 * multipv=2 the second-best, etc. We surface that ranking honestly — "Best"
 * for #1 and plain ordinals after — rather than inventing quality words like
 * "Interesting" or "Playable" that the engine never assigned.
 */
export function rankLabel(multipv: number): string {
  const rank = Math.max(1, Math.floor(multipv));
  return rank === 1 ? 'Best' : `#${rank}`;
}
