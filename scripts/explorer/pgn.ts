/**
 * GrandForge explorer ingest — PGN reading (pass 1 input).
 *
 * Streams games out of a PGN file (plain or inside a .zip) and reduces each one
 * to the few facts the explorer aggregate needs: result, both Elos, player
 * names, year, and the SAN move list truncated to the ingest depth.
 *
 * Everything here is string work — no chess board, no legality checking. That is
 * deliberate: replaying 40M+ moves through chess.js during the streaming pass
 * would cost about a day of CPU, whereas tokenizing text is I/O-bound. Legality
 * is established once per *unique position* in pass 2 (`resolve.ts`), which is
 * three orders of magnitude less work.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

/** One game as it comes out of the PGN, before any board replay. */
export interface RawGame {
  result: '1-0' | '0-1' | '1/2-1/2';
  white: string;
  black: string;
  /** 0 when the header was absent or unparseable. */
  whiteElo: number;
  blackElo: number;
  year: number;
  /** SAN tokens in order, annotation characters stripped. */
  moves: string[];
}

/**
 * Player names longer than this are corrupt input, not names. Bounded because
 * these strings end up in `topGames` subdocuments on a 512 MB tier.
 */
const MAX_NAME_LENGTH = 48;

/** Below this an Elo header is junk (or a placeholder like "0"/"?"). */
const MIN_PLAUSIBLE_ELO = 100;

/**
 * Strip the characters PGN allows around a SAN token that are not part of the
 * move itself.
 *
 * `!` and `?` (and their doubled forms) are annotations. `+` and `#` are NOT
 * stripped — they are part of SAN, they appear in the stored ECO move sequences,
 * and chess.js emits them. Removing them here is the same class of mistake as
 * the `+`-as-separator bug in the opening lookup.
 */
export function stripSanAnnotations(token: string): string {
  return token.replace(/[!?]+/g, '');
}

const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '1/2', '*']);

/**
 * Extract SAN tokens from a PGN movetext blob.
 *
 * Handles, in one left-to-right pass: `{...}` comments (clock/eval annotations
 * are everywhere in online-game exports), `;` line comments, `(...)` recursive
 * variations, `$n` NAGs, move numbers (`12.` and `12...`), and the terminating
 * result token. Anything else is a move.
 *
 * `limit` truncates the output — the ingest only aggregates the first N plies, so
 * there is no reason to build arrays for a 120-move game.
 */
export function tokenizeMovetext(movetext: string, limit = Infinity): string[] {
  const out: string[] = [];
  let i = 0;
  let variationDepth = 0;
  const n = movetext.length;

  while (i < n && out.length < limit) {
    const ch = movetext[i];

    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') { i++; continue; }

    if (ch === '{') {
      // PGN comments do not nest; scan to the first '}'. An unterminated
      // comment (truncated file) consumes the rest, which is correct.
      const end = movetext.indexOf('}', i + 1);
      i = end === -1 ? n : end + 1;
      continue;
    }

    if (ch === ';') {
      const end = movetext.indexOf('\n', i + 1);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Variations DO nest, so track depth rather than scanning for one ')'.
    if (ch === '(') { variationDepth++; i++; continue; }
    if (ch === ')') { if (variationDepth > 0) variationDepth--; i++; continue; }

    if (ch === '$') {
      while (i < n && !/\s/.test(movetext[i])) i++;
      continue;
    }

    // Read one whitespace-delimited token.
    let j = i;
    while (j < n && !/[\s{;()]/.test(movetext[j])) j++;
    const token = movetext.slice(i, j);
    i = j;

    if (variationDepth > 0) continue;          // sideline — not the game's line
    if (token.length === 0) continue;
    if (RESULT_TOKENS.has(token)) break;       // game over; ignore any trailer
    if (/^\d+\.*$/.test(token)) continue;      // "12." / "12..." / "12"
    if (token === '...' || token === '--' || token === 'Z0') continue;

    const san = stripSanAnnotations(token);
    // A bare move number glued to its move ("12.e4") is legal PGN.
    const stripped = san.replace(/^\d+\.+/, '');
    if (stripped.length === 0) continue;
    out.push(stripped);
  }

  return out;
}

/** Pull one `[Tag "value"]` out of a header block. Returns '' when absent. */
export function readTag(headers: string, tag: string): string {
  // Non-greedy so a value containing a quote-like sequence can't swallow the
  // rest of the block.
  const re = new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`);
  return headers.match(re)?.[1]?.trim() ?? '';
}

function cleanName(raw: string): string {
  // Strip control characters: they would corrupt the checkpoint NDJSON lines
  // and have no business in a player name. Written as a code-point filter
  // rather than a regex so the source file stays pure printable ASCII.
  const out: string[] = [];
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code !== 127) out.push(ch);
  }
  return out.join('').slice(0, MAX_NAME_LENGTH);
}

function parseElo(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= MIN_PLAUSIBLE_ELO ? n : 0;
}

function parseYear(headers: string): number {
  const date = readTag(headers, 'UTCDate') || readTag(headers, 'Date');
  const year = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) && year > 1400 && year < 2200 ? year : 0;
}

/**
 * Turn one game's header block + movetext into a `RawGame`, or null if it can't
 * contribute to the aggregate.
 *
 * Games with an unfinished/unknown result (`*`) are dropped: they would inflate
 * `total` while belonging to none of the W/D/L buckets, so every percentage
 * computed from that position would be quietly short of 100%.
 */
export function parseGame(headers: string, movetext: string, moveLimit: number): RawGame | null {
  const rawResult = readTag(headers, 'Result');
  if (rawResult !== '1-0' && rawResult !== '0-1' && rawResult !== '1/2-1/2') return null;

  const moves = tokenizeMovetext(movetext, moveLimit);
  if (moves.length === 0) return null;

  return {
    result: rawResult,
    white: cleanName(readTag(headers, 'White')),
    black: cleanName(readTag(headers, 'Black')),
    whiteElo: parseElo(readTag(headers, 'WhiteElo')),
    blackElo: parseElo(readTag(headers, 'BlackElo')),
    year: parseYear(headers),
    moves,
  };
}

/**
 * Line-fed splitter for concatenated PGN games.
 *
 * A game ends when a header line appears after movetext has been seen. This is
 * more robust than counting blank lines: exports differ in how many blank lines
 * they emit, and some omit the one between the header block and the movetext
 * entirely.
 */
export class PgnSplitter {
  private headers: string[] = [];
  private movetext: string[] = [];
  private sawMovetext = false;

  constructor(private readonly moveLimit: number) {}

  /** Feed one line; returns a game if this line terminated the previous one. */
  push(line: string): RawGame | null {
    const trimmed = line.trim();
    const isHeader = trimmed.startsWith('[');

    if (isHeader && this.sawMovetext) {
      const game = this.flush();
      this.headers.push(trimmed);
      return game;
    }

    if (isHeader) {
      this.headers.push(trimmed);
      return null;
    }

    if (trimmed.length > 0) {
      this.movetext.push(trimmed);
      this.sawMovetext = true;
    }
    return null;
  }

  /** Emit the game currently being accumulated (call once at end of input). */
  flush(): RawGame | null {
    const game = this.sawMovetext || this.headers.length > 0
      ? parseGame(this.headers.join('\n'), this.movetext.join(' '), this.moveLimit)
      : null;
    this.headers = [];
    this.movetext = [];
    this.sawMovetext = false;
    return game;
  }
}

/** Split a complete PGN text into games. Convenience wrapper for tests. */
export function splitPgnGames(text: string, moveLimit = Infinity): RawGame[] {
  const splitter = new PgnSplitter(moveLimit);
  const games: RawGame[] = [];
  for (const line of text.split(/\r?\n/)) {
    const game = splitter.push(line);
    if (game) games.push(game);
  }
  const last = splitter.flush();
  if (last) games.push(last);
  return games;
}

/** Stream games from any readable PGN source without buffering the whole file. */
export async function* streamPgnGames(
  input: Readable,
  moveLimit: number,
): AsyncGenerator<RawGame> {
  const splitter = new PgnSplitter(moveLimit);
  // `crlfDelay: Infinity` so a CRLF file doesn't yield phantom empty lines.
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    const game = splitter.push(line);
    if (game) yield game;
  }
  const last = splitter.flush();
  if (last) yield last;
}

/**
 * Open a PGN source: a `.pgn`/`.txt` file directly, or every `.pgn` entry inside
 * a `.zip` without extracting it to disk (a month of games is ~60-95 MB
 * compressed and several hundred MB expanded — six months of extracted PGN is
 * gigabytes of scratch space for no benefit).
 */
export async function* streamGamesFromFile(
  path: string,
  moveLimit: number,
): AsyncGenerator<RawGame> {
  if (!path.toLowerCase().endsWith('.zip')) {
    yield* streamPgnGames(createReadStream(path), moveLimit);
    return;
  }

  // Imported lazily so a plain-.pgn run doesn't need the zip library at all.
  const yauzl = await import('yauzl');
  const zip = await new Promise<import('yauzl').ZipFile>((resolve, reject) => {
    // lazyEntries keeps memory flat: entries are pulled one at a time and each
    // one's data is a stream, so the archive is never fully buffered.
    yauzl.open(path, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) reject(err ?? new Error(`Cannot open zip: ${path}`));
      else resolve(zipFile);
    });
  });

  try {
    while (true) {
      const entry = await new Promise<import('yauzl').Entry | null>((resolve, reject) => {
        const onEntry = (e: import('yauzl').Entry) => { cleanup(); resolve(e); };
        const onEnd = () => { cleanup(); resolve(null); };
        const onErr = (e: Error) => { cleanup(); reject(e); };
        const cleanup = () => {
          zip.removeListener('entry', onEntry);
          zip.removeListener('end', onEnd);
          zip.removeListener('error', onErr);
        };
        zip.once('entry', onEntry);
        zip.once('end', onEnd);
        zip.once('error', onErr);
        zip.readEntry();
      });

      if (!entry) break;

      const name = entry.fileName.toLowerCase();
      if (entry.fileName.endsWith('/') || (!name.endsWith('.pgn') && !name.endsWith('.txt'))) {
        continue;
      }

      const stream = await new Promise<Readable>((resolve, reject) => {
        zip.openReadStream(entry, (err, rs) => {
          if (err || !rs) reject(err ?? new Error(`Cannot read ${entry.fileName}`));
          else resolve(rs as unknown as Readable);
        });
      });

      yield* streamPgnGames(stream, moveLimit);
    }
  } finally {
    zip.close();
  }
}
