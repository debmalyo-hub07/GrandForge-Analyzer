/**
 * GrandForge explorer ingest — checkpointing.
 *
 * The ingest holds one global FEN accumulator across every input month, so a
 * crash (or an OOM, or a laptop lid) three months into a six-month run must not
 * cost the first three. After each month the accumulator is written to disk and
 * the month is recorded as done; a re-run reloads and skips.
 *
 * Format is NDJSON — one position per line — rather than a single JSON document.
 * A few million positions serialize to well over V8's maximum string length
 * (~512 MB on 64-bit), so `JSON.stringify(accumulator)` would throw at exactly
 * the corpus size the checkpoint exists to protect. Line-at-a-time also means a
 * truncated file loses one position instead of all of them.
 *
 * Keys are abbreviated because this file is written and read whole, repeatedly,
 * and the long forms would roughly double it for no benefit — nothing but this
 * module ever reads it.
 */
import { createReadStream, createWriteStream, existsSync, renameSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import type { AggMove, AggNode, FenAccumulator } from './resolve';
import { emptyAgg, mergeAgg } from './resolve';
import type { GameResult, TopGameRecord } from './trie';

/** Bumped when the on-disk shape changes; a mismatched checkpoint is refused. */
export const CHECKPOINT_VERSION = 1;

type WireMove = [uci: string, san: string, total: number, white: number, draws: number, black: number];
type WireGame = [white: string, black: string, whiteElo: number, blackElo: number, result: GameResult, year: number];

interface WireNode {
  f: string;   // fen
  t: number;   // total
  w: number;   // white wins
  d: number;   // draws
  b: number;   // black wins
  es: number;  // eloSum
  eg: number;  // eloGames
  p: number;   // minPly
  m: WireMove[];
  g: WireGame[];
}

export function serializeNode(fen: string, agg: AggNode): string {
  const wire: WireNode = {
    f: fen,
    t: agg.total, w: agg.white, d: agg.draws, b: agg.black,
    es: agg.eloSum, eg: agg.eloGames, p: agg.minPly,
    m: [...agg.moves.values()].map((m): WireMove => [m.uci, m.san, m.total, m.white, m.draws, m.black]),
    g: agg.topGames.map((g): WireGame => [g.white, g.black, g.whiteElo, g.blackElo, g.result, g.year]),
  };
  return JSON.stringify(wire);
}

export function deserializeNode(line: string): { fen: string; agg: AggNode } {
  const wire = JSON.parse(line) as WireNode;
  const moves = new Map<string, AggMove>();
  for (const [uci, san, total, white, draws, black] of wire.m ?? []) {
    moves.set(uci, { uci, san, total, white, draws, black });
  }
  const topGames: TopGameRecord[] = (wire.g ?? []).map(
    ([white, black, whiteElo, blackElo, result, year]) => ({ white, black, whiteElo, blackElo, result, year })
  );
  return {
    fen: wire.f,
    agg: {
      total: wire.t, white: wire.w, draws: wire.d, black: wire.b,
      eloSum: wire.es, eloGames: wire.eg, minPly: wire.p,
      moves, topGames,
    },
  };
}

/**
 * Write the accumulator to `path`, atomically.
 *
 * Written to a sibling `.tmp` and renamed, so an interrupted write cannot leave
 * a half-file where the previous good checkpoint was — the failure mode that
 * turns "lost the last month" into "lost the whole run".
 */
export async function writeCheckpoint(path: string, acc: FenAccumulator): Promise<void> {
  const tmp = `${path}.tmp`;
  const out = createWriteStream(tmp, { encoding: 'utf8' });

  for (const [fen, agg] of acc) {
    // Respect backpressure: a few million lines written without ever awaiting
    // `drain` buffers the entire file in memory, which is the one thing this
    // format exists to avoid.
    if (!out.write(`${serializeNode(fen, agg)}\n`)) await once(out, 'drain');
  }

  await new Promise<void>((resolve, reject) => {
    out.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
  renameSync(tmp, path);
}

/** Load a checkpoint into a fresh accumulator. Missing file ⇒ empty. */
export async function readCheckpoint(path: string): Promise<FenAccumulator> {
  const acc: FenAccumulator = new Map();
  if (!existsSync(path)) return acc;

  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (line.length === 0) continue;
    let parsed: { fen: string; agg: AggNode };
    try {
      parsed = deserializeNode(line);
    } catch {
      // Only the final line can be torn (the write is atomic, but the process
      // may have been killed mid-`.tmp`). Skip it loudly rather than aborting a
      // multi-hour resume over one position.
      console.warn(`  checkpoint: skipping unparseable line ${lineNo}`);
      continue;
    }
    const existing = acc.get(parsed.fen);
    if (existing) mergeAgg(existing, parsed.agg);
    else acc.set(parsed.fen, parsed.agg);
  }
  return acc;
}

/** Progress marker sitting next to the checkpoint. */
export interface IngestState {
  version: number;
  /** Source file identities already folded into the checkpoint. */
  completed: string[];
  /** Ingest bounds the checkpoint was built with — changing them invalidates it. */
  maxPlies: number;
  minGames: number;
}

export function readState(path: string): IngestState | null {
  if (!existsSync(path)) return null;
  try {
    const state = JSON.parse(readFileSync(path, 'utf8')) as IngestState;
    return state.version === CHECKPOINT_VERSION ? state : null;
  } catch {
    return null;
  }
}

export function writeState(path: string, state: IngestState): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

/**
 * Fold a resolved month into the global accumulator.
 *
 * Merging in-process rather than with per-month Mongo `$inc` upserts is what
 * lets `moves` stay a plain array in the model: an additive database merge would
 * need the moves keyed by UCI (you cannot `$inc` into an array element that may
 * not exist yet), and that shape is both larger on disk and worse to read.
 */
export function foldInto(global: FenAccumulator, month: FenAccumulator): void {
  for (const [fen, agg] of month) {
    const existing = global.get(fen);
    if (existing) mergeAgg(existing, agg);
    else global.set(fen, agg);
  }
}

export { emptyAgg };
