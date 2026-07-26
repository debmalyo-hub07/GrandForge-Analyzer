import { Chess } from 'chess.js';
import type { GameMetadata } from '../types/chess';
import type { GameReviewResult, MoveClassification } from '../types/review';

const PGN_HEADER_REGEX = /\[(\w+)\s+"([^"]*)"\]/g;

// PGN NAG codes per spec — chess.com / Lichess use these for move quality.
//   $1 good, $2 mistake, $3 brilliant, $4 blunder, $5 interesting, $6 dubious
const NAG_BY_CLASSIFICATION: Record<MoveClassification, string> = {
  brilliant:  '$3',
  great:      '$5',
  best:       '$1',
  excellent:  '$1',
  good:       '',
  book:       '',
  inaccuracy: '$6',
  mistake:    '$2',
  miss:       '$2',
  blunder:    '$4',
};

const WIN_SLOPE = 0.00368208;
function winFromCpMate(cp: number | null, mate: number | null): number {
  if (mate !== null) {
    if (mate > 0) return 1.0;
    if (mate < 0) return 0.0;
    return 0.0;
  }
  return 0.5 + 0.5 * (2 / (1 + Math.exp(-WIN_SLOPE * (cp ?? 0))) - 1);
}

/**
 * Format a PGN string with review annotations: NAGs ($1-$6) and a Win%/swing
 * comment per ply derived from a GameReviewResult.
 *
 * Mainline SAN tokens align 1:1 with `result.moveReviews` by ply index.
 */
export function formatAnnotatedPgn(
  metadata: Partial<GameMetadata>,
  mainlineSan: string[],
  result: GameReviewResult,
): string {
  const headers: Array<[string, string]> = [
    ['Event', metadata.event ?? 'GrandForge Review'],
    ['Site', metadata.site ?? 'grandforge.local'],
    ['Date', metadata.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.')],
    ['White', metadata.white ?? '?'],
    ['Black', metadata.black ?? '?'],
    ['Result', metadata.result ?? '*'],
  ];
  if (metadata.whiteElo) headers.push(['WhiteElo', String(metadata.whiteElo)]);
  if (metadata.blackElo) headers.push(['BlackElo', String(metadata.blackElo)]);
  if (metadata.timeControl) headers.push(['TimeControl', metadata.timeControl]);
  if (metadata.opening) headers.push(['Opening', metadata.opening]);
  if (metadata.ecoCode) headers.push(['ECO', metadata.ecoCode]);
  if (metadata.variant) headers.push(['Variant', metadata.variant]);
  headers.push(['Annotator', `Stockfish (depth ${result.reviewDepth}, ${result.engineVersion})`]);
  headers.push(['WhiteAccuracy', result.white.accuracy.toFixed(1)]);
  headers.push(['BlackAccuracy', result.black.accuracy.toFixed(1)]);

  const headerBlock = headers.map(([k, v]) => `[${k} "${v}"]`).join('\n');

  const tokens: string[] = [];
  for (let i = 0; i < mainlineSan.length; i++) {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`);
    const review = result.moveReviews[i];
    let moveTok = mainlineSan[i];
    if (review) {
      const nag = NAG_BY_CLASSIFICATION[review.classification];
      if (nag) moveTok = `${moveTok} ${nag}`;
    }
    tokens.push(moveTok);

    if (review && review.classification !== 'book') {
      const win = winFromCpMate(review.evalAfter, review.mateAfter);
      const winPct = (win * 100).toFixed(1);
      const cls = review.classification.charAt(0).toUpperCase() + review.classification.slice(1);
      let comment = `[%cls ${cls}] [%win ${winPct}]`;
      if (review.bestMoveSan && review.bestMoveSan !== review.san) {
        comment += ` Best: ${review.bestMoveSan}.`;
      }
      tokens.push(`{ ${comment} }`);
    }
  }
  const finalResult = metadata.result ?? '*';
  tokens.push(finalResult);

  return `${headerBlock}\n\n${tokens.join(' ')}\n`;
}

/**
 * Format a PGN string from metadata + an array of SAN main-line moves.
 */
export function formatPgn(metadata: Partial<GameMetadata>, mainlineSan: string[]): string {
  const headers: Array<[string, string]> = [
    ['Event', metadata.event ?? 'GrandForge Analysis'],
    ['Site', metadata.site ?? 'grandforge.local'],
    ['Date', metadata.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.')],
    ['White', metadata.white ?? '?'],
    ['Black', metadata.black ?? '?'],
    ['Result', metadata.result ?? '*'],
  ];
  if (metadata.whiteElo) headers.push(['WhiteElo', String(metadata.whiteElo)]);
  if (metadata.blackElo) headers.push(['BlackElo', String(metadata.blackElo)]);
  if (metadata.timeControl) headers.push(['TimeControl', metadata.timeControl]);
  if (metadata.opening) headers.push(['Opening', metadata.opening]);
  if (metadata.ecoCode) headers.push(['ECO', metadata.ecoCode]);
  if (metadata.variant) headers.push(['Variant', metadata.variant]);

  const headerBlock = headers.map(([k, v]) => `[${k} "${v}"]`).join('\n');

  const moveTokens: string[] = [];
  for (let i = 0; i < mainlineSan.length; i++) {
    if (i % 2 === 0) moveTokens.push(`${i / 2 + 1}.`);
    moveTokens.push(mainlineSan[i]);
  }
  const result = metadata.result ?? '*';
  moveTokens.push(result);

  return `${headerBlock}\n\n${moveTokens.join(' ')}\n`;
}

/**
 * Validate a PGN by attempting to load it via chess.js.
 */
export function validatePgn(pgn: string): { valid: boolean; error?: string } {
  if (typeof pgn !== 'string' || pgn.trim().length === 0) {
    return { valid: false, error: 'Empty PGN' };
  }
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Invalid PGN' };
  }
}

/**
 * Parse the [Tag "value"] header block of a PGN into a GameMetadata object.
 */
export function parsePgnHeaders(pgn: string): GameMetadata {
  const raw: Record<string, string> = {};
  let match: RegExpExecArray | null;
  PGN_HEADER_REGEX.lastIndex = 0;
  while ((match = PGN_HEADER_REGEX.exec(pgn)) !== null) {
    raw[match[1]] = match[2];
  }

  const metadata: GameMetadata = {
    white: raw.White ?? '?',
    black: raw.Black ?? '?',
    result: raw.Result ?? '*',
  };
  if (raw.WhiteElo) metadata.whiteElo = parseInt(raw.WhiteElo, 10) || undefined;
  if (raw.BlackElo) metadata.blackElo = parseInt(raw.BlackElo, 10) || undefined;
  if (raw.Event) metadata.event = raw.Event;
  if (raw.Site) metadata.site = raw.Site;
  if (raw.Date) metadata.date = raw.Date;
  if (raw.TimeControl) metadata.timeControl = raw.TimeControl;
  if (raw.Opening) metadata.opening = raw.Opening;
  if (raw.ECO) metadata.ecoCode = raw.ECO;
  if (raw.Variant) metadata.variant = raw.Variant;
  return metadata;
}
