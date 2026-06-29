/**
 * Format nodes-per-second as a compact "1.2 MN/s" / "850 KN/s" string.
 */
export function formatNPS(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 N/s';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MN/s`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KN/s`;
  return `${Math.round(n)} N/s`;
}

/**
 * Format an ISO timestamp or Date into a short locale string.
 * Returns "—" for empty / unparseable input.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

/**
 * Format a numeric rating, returning "—" for missing values.
 */
export function formatRating(rating: number | null | undefined): string {
  if (rating === null || rating === undefined || !Number.isFinite(rating)) return '—';
  return String(Math.round(rating));
}

/**
 * Truncate a string to `max` chars, appending an ellipsis when shortened.
 */
export function truncate(text: string, max: number): string {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Format a centipawn-loss value for UI display.
 *   • Mate-territory CPLs (≥ MATE_THRESHOLD) render as "M" since the move
 *     dropped a forced mate, not a meaningful centipawn delta.
 *   • Otherwise clamps display to 999 to keep tooltips/badges narrow.
 */
const CPL_MATE_THRESHOLD = 5000;
export function formatCPL(cpl: number | null | undefined): string {
  if (cpl === null || cpl === undefined || !Number.isFinite(cpl)) return '—';
  const v = Math.max(0, cpl);
  if (v >= CPL_MATE_THRESHOLD) return 'M';
  return String(Math.min(999, Math.round(v)));
}
