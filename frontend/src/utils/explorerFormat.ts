/**
 * Presentation helpers for the opening explorer.
 *
 * Pure functions, kept out of the component so the arithmetic — which is where
 * a statistics panel goes quietly wrong — can be unit-tested.
 */
import type { ExplorerMove, ExplorerTopGame } from '../types/explorer';

/**
 * Compact game counts: an explorer row reading "1284302" is unreadable, and the
 * exact figure carries no meaning to the reader at that magnitude.
 */
export function formatGameCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

/** A share (0..1) as a whole-number percentage string. */
export function formatShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  const pct = share * 100;
  // Below 1% round up rather than to "0%" — the row exists, so it isn't zero.
  if (pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

export interface WdlPercents {
  white: number;
  draws: number;
  black: number;
}

/**
 * W/D/L as percentages that sum to exactly 100.
 *
 * Rounding each independently gives 33/33/33 or 34/33/34 depending on the
 * inputs, and the bar then under- or over-fills. The largest bucket absorbs the
 * remainder, which is both the least visible place to put it and the one least
 * likely to change a reader's impression.
 */
export function wdlPercents(white: number, draws: number, black: number): WdlPercents {
  const total = white + draws + black;
  if (total <= 0) return { white: 0, draws: 0, black: 0 };

  const raw = {
    white: (white / total) * 100,
    draws: (draws / total) * 100,
    black: (black / total) * 100,
  };
  const rounded = {
    white: Math.round(raw.white),
    draws: Math.round(raw.draws),
    black: Math.round(raw.black),
  };

  const drift = 100 - (rounded.white + rounded.draws + rounded.black);
  if (drift !== 0) {
    const largest = (Object.keys(raw) as Array<keyof WdlPercents>).reduce((a, b) =>
      raw[a] >= raw[b] ? a : b
    );
    rounded[largest] += drift;
  }
  return rounded;
}

/**
 * White's score from this position as a percentage — the single number that
 * answers "is this line good for me?".
 *
 * A draw counts a half point, which is the scoring convention, not an average of
 * the win rates.
 */
export function scorePercent(white: number, draws: number, black: number): number | null {
  const total = white + draws + black;
  if (total <= 0) return null;
  return Math.round(((white + draws / 2) / total) * 100);
}

/** Sort key for move rows: most-played first, ties broken deterministically. */
export function sortMoves(moves: ExplorerMove[]): ExplorerMove[] {
  return [...moves].sort((a, b) => b.total - a.total || a.san.localeCompare(b.san));
}

/** "Carlsen 2847" — rating omitted when the corpus had none for that player. */
export function formatPlayer(name: string, elo: number): string {
  const trimmed = name.trim() || 'Unknown';
  return elo > 0 ? `${trimmed} ${elo}` : trimmed;
}

/** Strongest games first — the ones worth showing as representative. */
export function sortTopGames(games: ExplorerTopGame[]): ExplorerTopGame[] {
  // Rank on the weaker player, same rule the ingest uses: a 2800-vs-1400 rout
  // represents nothing, however high its average.
  const strength = (g: ExplorerTopGame) => Math.min(g.whiteElo || 0, g.blackElo || 0);
  return [...games].sort((a, b) => strength(b) - strength(a) || b.year - a.year);
}
