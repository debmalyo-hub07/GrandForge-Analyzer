/**
 * GrandForge — shared opening (ECO) resolution.
 *
 * Both `GET /api/openings/lookup` and `GET /api/explorer/lookup` answer the same
 * underlying question — "which named opening is this line?" — so the prefix
 * logic lives here once. The explorer needs it because theory prose hangs off
 * `Opening.description` (design decision D2: own-authored theory, no
 * third-party text), and the Explore panel should not have to make a second
 * round trip to get it.
 *
 * Keyed on the SAN move sequence rather than on FEN: `Opening.fen` is stored as
 * a full 6-field FEN (from `chess.fen()` in `scripts/seedOpenings.ts`), which
 * cannot be point-matched against the explorer's normalized 4-field key, while
 * `moveSequence` is indexed and matches by exact equality.
 */
import Opening, { type IOpening } from './models/Opening';

/** Openings deeper than this don't exist in the ECO corpus; don't build candidates past it. */
const MAX_OPENING_PLIES = 40;

/**
 * Split a SAN move string into tokens.
 *
 * Whitespace only — do NOT also treat `+` as a separator. Express parses the
 * query string with `qs`, which already decodes `+` as a space, so a client
 * sending `?moves=e4+e5` arrives here as `"e4 e5"` and needs no help. What DOES
 * arrive as a literal `+` is a percent-encoded one (`%2B`), which axios emits
 * for exactly one thing: the SAN check marker in `Bxd7+` / `Qh5+`.
 *
 * The old implementation replaced `+` with a space here, which split `Bxd7+`
 * into `["Bxd7"]` and made the prefix comparison fail against the stored
 * `moveSequence` (the ECO seed keeps check markers). Every opening line
 * containing a check was therefore unmatchable — silently, since the endpoint
 * just answered `{opening: null}`.
 */
export function parseMoveSequence(raw: string): string[] {
  return raw.split(/\s+/).filter(Boolean);
}

export type OpeningMatch = Pick<
  IOpening,
  'ecoCode' | 'name' | 'family' | 'variation' | 'moveSequence' | 'plyDepth'
> & { description?: string };

/**
 * Find the deepest (most specific) named opening whose move sequence is a
 * prefix of `moves`. Returns null when the line is outside the book.
 *
 * Builds the candidate prefixes explicitly and matches with `$in` on the
 * indexed `moveSequence` field — an equality lookup — rather than scanning with
 * a regex.
 */
export async function findOpeningByMoves(moves: string[]): Promise<OpeningMatch | null> {
  if (moves.length === 0) return null;

  const bounded = moves.slice(0, MAX_OPENING_PLIES);
  const candidates: string[] = [];
  for (let i = bounded.length; i > 0; i--) {
    candidates.push(bounded.slice(0, i).join(' '));
  }

  const matches = await Opening.find({ moveSequence: { $in: candidates } })
    .sort({ plyDepth: -1 })
    .limit(1)
    .select('ecoCode name family variation moveSequence plyDepth description')
    .lean()
    .exec();

  const opening = matches[0];
  if (!opening) return null;

  // Defensive: `$in` can only match a prefix we generated, but a corrupt row
  // (e.g. leading whitespace in moveSequence) would otherwise be reported as a
  // match for a line it isn't part of.
  const inputSequence = bounded.join(' ');
  if (!inputSequence.startsWith(opening.moveSequence)) return null;

  return opening as unknown as OpeningMatch;
}
