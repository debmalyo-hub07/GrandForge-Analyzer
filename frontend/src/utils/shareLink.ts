/**
 * Share-link encoding for the analysis board.
 *
 * A share link carries the position, not a server record: everything needed to
 * rebuild the board is in the URL, so a link works for anonymous visitors, needs
 * no database row, and cannot rot when a game is pruned. Two shapes:
 *
 *   ?pgn=<moves>   mainline SAN moves, space-separated
 *   ?fen=<fen>     a single position
 *   &ply=<n>       optional: which half-move to open at (pgn links only)
 *
 * Both are plain query params rather than a hash so the link is legible and can
 * be read server-side later if we ever want OG previews. Encoding is
 * `encodeURIComponent` only — no compression scheme to get wrong, and a
 * 40-move mainline is ~200 characters, well inside every URL limit.
 */

export interface ShareState {
  /** Space-separated mainline SAN, e.g. "e4 e5 Nf3". Empty when sharing a FEN. */
  pgn?: string;
  /** A full FEN. Used when the board was set up from a position, not a game. */
  fen?: string;
  /** Half-move index to open at. Omitted when it points at the final position. */
  ply?: number;
}

/** Longest `?pgn=` we will emit. Past this the link is unwieldy in chat clients
 *  that linkify on whitespace, and a FEN of the current position is the better
 *  share anyway. Callers fall back to `fen` when `buildShareUrl` returns a
 *  FEN-shaped link for a long game. */
export const MAX_SHARE_PGN_CHARS = 1800;

/** Read share state out of a query string. Returns `{}` when nothing shareable
 *  is present, so callers can treat "no share params" and "empty share params"
 *  identically. Unknown params are ignored. */
export function parseShareParams(search: string): ShareState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const out: ShareState = {};

  const pgn = params.get('pgn')?.trim();
  if (pgn) out.pgn = pgn;

  const fen = params.get('fen')?.trim();
  // A link carrying both is ambiguous; the move list is the richer artifact, so
  // it wins and the FEN is dropped rather than half-applied.
  if (fen && !out.pgn) out.fen = fen;

  const rawPly = params.get('ply');
  if (rawPly !== null && out.pgn) {
    const ply = Number.parseInt(rawPly, 10);
    // Reject NaN and negatives here so the caller never has to; an out-of-range
    // high value is clamped against the real move count by the caller, which is
    // the only place that knows it.
    if (Number.isFinite(ply) && ply >= 0) out.ply = ply;
  }

  return out;
}

/** Build the query string for a share state. Returns '' for an empty state. */
export function buildShareQuery(state: ShareState): string {
  const params = new URLSearchParams();
  if (state.pgn) {
    params.set('pgn', state.pgn);
    if (state.ply !== undefined && state.ply >= 0) params.set('ply', String(state.ply));
  } else if (state.fen) {
    params.set('fen', state.fen);
  }
  const q = params.toString();
  return q ? `?${q}` : '';
}

/**
 * Absolute share URL for a state, given an origin+path base.
 *
 * Pass `sanMoves` and the caller's current ply; when the resulting `?pgn=` would
 * exceed MAX_SHARE_PGN_CHARS this falls back to sharing `fen` alone, which is
 * always short. That trade is deliberate: a too-long URL that gets truncated by
 * a chat client is worse than a link that opens the right position without the
 * move history.
 */
export function buildShareUrl(
  base: string,
  opts: { sanMoves: string[]; ply: number; fen: string },
): string {
  const { sanMoves, ply, fen } = opts;
  const cleanBase = base.replace(/[?#].*$/, '');

  if (sanMoves.length > 0) {
    const pgn = sanMoves.join(' ');
    if (pgn.length <= MAX_SHARE_PGN_CHARS) {
      // Only pin the ply when it isn't the end of the line — a link to the final
      // position is the common case and reads better without the extra param.
      const atEnd = ply >= sanMoves.length;
      return cleanBase + buildShareQuery({ pgn, ply: atEnd ? undefined : ply });
    }
  }

  return cleanBase + buildShareQuery({ fen });
}
