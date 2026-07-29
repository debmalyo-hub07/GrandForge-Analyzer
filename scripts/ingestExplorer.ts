/**
 * GrandForge — Opening Explorer ingest.
 *
 * Builds the `explorernodes` collection: one aggregated document per position,
 * holding how often each continuation was played and how those games finished.
 * This is what `GET /api/explorer/lookup` serves, and it is the reason the
 * explorer makes **no runtime third-party calls at all** — the statistics live in
 * our own database rather than being proxied from someone else's API.
 *
 * Run: npx tsx scripts/ingestExplorer.ts --from <dir|file> [...]
 * Full runbook, including corpus acquisition and sizing: docs/explorer-ingest.md
 *
 * Two passes per input file, for a reason worth understanding before changing
 * anything here:
 *
 *   Pass 1 (`explorer/trie.ts`) streams the PGN as *text* into a SAN-prefix
 *   trie. No board, no legality checking — inserting a game is a few Map
 *   lookups. Replaying a corpus of 40M+ moves through chess.js during the
 *   streaming pass would cost roughly a day of CPU.
 *
 *   Pass 2 (`explorer/resolve.ts`) walks that trie once with a single chess.js
 *   instance, move/undo, so each node learns its FEN — and nodes sharing a FEN
 *   merge. Legality is therefore established once per distinct *path* rather
 *   than once per game move: three orders of magnitude less work for an
 *   identical result.
 *
 * The whole run is resumable. A six-month corpus is a multi-hour job and the
 * accumulator is global across inputs, so a crash on month five must not cost
 * months one through four (`explorer/checkpoint.ts`).
 *
 * No download URL appears anywhere in this file or its modules: the operator
 * supplies local files. That is deliberate — see the runbook.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve as resolvePath } from 'node:path';
import mongoose from 'mongoose';
import { connectDB } from '../backend/db';
import ExplorerNode from '../backend/models/ExplorerNode';
import { streamGamesFromFile, type RawGame } from './explorer/pgn';
import { TrieNode, insertGame, pruneTrie, countNodes, type TopGameRecord } from './explorer/trie';
import { resolveTrie, toDocument, type FenAccumulator } from './explorer/resolve';
import {
  CHECKPOINT_VERSION, foldInto, readCheckpoint, readState, writeCheckpoint, writeState,
  type IngestState,
} from './explorer/checkpoint';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Ingest depth in plies. 20 covers essentially all named opening theory; past
 * it, positions are near-unique and each one is a document nobody looks up.
 */
const DEFAULT_MAX_PLIES = 20;

/**
 * Final games-per-position threshold. Below this the W/D/L split is decided by
 * one or two results and would be displayed as if it meant something.
 */
const DEFAULT_MIN_GAMES = 8;

/**
 * Database size at which NEW inserts stop. Atlas M0 gives 512 MB total and the
 * `positions` eval cache shares it, so the explorer cannot have all of it.
 */
const DEFAULT_BUDGET_MB = 320;

/** Deepest ply at which representative games are stored. */
const TOP_GAMES_MAX_PLY = 12;

/**
 * Depth below which the in-memory prune is allowed to drop thin nodes, and the
 * count it drops at.
 *
 * This is the only approximation in the pipeline and it is a deliberate trade.
 * The prune runs per input file, so it can only see one file's counts: a
 * position played exactly once in each of twelve monthly files would total 12
 * games (reportable) yet be dropped from each file individually. The exposure is
 * bounded to positions deeper than ply 12 that are that rare, which are the
 * least valuable rows in the collection — and without the prune, pass 1's trie
 * grows without limit and the run dies of memory instead.
 *
 * Shallower than PRUNE_DEPTH nothing is ever dropped: a rare early move is still
 * theory somebody looks up, and there are few enough of them to be free.
 */
const PRUNE_DEPTH = 12;
const PRUNE_MIN_TOTAL = 2;

/** Games between in-memory prunes. Bounds peak trie size within one file. */
const PRUNE_EVERY_GAMES = 250_000;

/** Documents per bulkWrite. Large enough to amortize the round trip, small
 *  enough that one failed batch is cheap to diagnose. */
const WRITE_BATCH = 1_000;

/** Documents between budget checks. `db.stats()` is not free; this is often
 *  enough to catch the ceiling within a few MB of it. */
const BUDGET_CHECK_EVERY = 25_000;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
  from: string[];
  work: string;
  maxPlies: number;
  minGames: number;
  budgetMb: number;
  dryRun: boolean;
  fresh: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    from: [],
    work: '.explorer-ingest',
    maxPlies: DEFAULT_MAX_PLIES,
    minGames: DEFAULT_MIN_GAMES,
    budgetMb: DEFAULT_BUDGET_MB,
    dryRun: false,
    fresh: false,
  };

  const requireValue = (flag: string, value: string | undefined): string => {
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  const requireNumber = (flag: string, value: string | undefined): number => {
    const n = Number.parseInt(requireValue(flag, value), 10);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive integer`);
    return n;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--from':       opts.from.push(requireValue(arg, argv[++i])); break;
      case '--work':       opts.work = requireValue(arg, argv[++i]); break;
      case '--max-plies':  opts.maxPlies = requireNumber(arg, argv[++i]); break;
      case '--min-games':  opts.minGames = requireNumber(arg, argv[++i]); break;
      case '--budget-mb':  opts.budgetMb = requireNumber(arg, argv[++i]); break;
      case '--dry-run':    opts.dryRun = true; break;
      case '--fresh':      opts.fresh = true; break;
      // Resuming is automatic when a compatible checkpoint exists; the flag is
      // accepted so the documented invocation works verbatim.
      case '--resume':     break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (opts.from.length === 0) throw new Error('At least one --from <dir|file> is required');
  return opts;
}

function printUsage(): void {
  console.log(`
GrandForge opening-explorer ingest

  npx tsx scripts/ingestExplorer.ts --from <dir|file> [--from ...] [options]

  --from <path>      PGN/ZIP file, or a directory of them. Repeatable. Required.
  --work <dir>       Checkpoint directory (default .explorer-ingest)
  --max-plies <n>    Ingest depth in plies (default ${DEFAULT_MAX_PLIES})
  --min-games <n>    Drop positions below this many games (default ${DEFAULT_MIN_GAMES})
  --budget-mb <n>    Stop new inserts above this DB size (default ${DEFAULT_BUDGET_MB})
  --dry-run          Aggregate and report; write nothing to MongoDB
  --resume           Continue from the checkpoint (automatic when compatible)
  --fresh            Discard any existing checkpoint and start over

See docs/explorer-ingest.md for corpus requirements and sizing.
`);
}

/** Expand each --from into concrete files. Directories are scanned one level
 *  deep: corpora arrive as a flat folder of monthly archives. */
function collectInputs(paths: string[]): string[] {
  const files: string[] = [];
  const accepted = /\.(pgn|txt|zip)$/i;

  for (const raw of paths) {
    const path = resolvePath(raw);
    if (!existsSync(path)) throw new Error(`--from path does not exist: ${path}`);

    if (statSync(path).isDirectory()) {
      const found = readdirSync(path)
        .filter((name) => accepted.test(name))
        .sort()
        .map((name) => join(path, name));
      if (found.length === 0) console.warn(`  warning: no .pgn/.txt/.zip files in ${path}`);
      files.push(...found);
    } else {
      files.push(path);
    }
  }

  // Same file named twice (a directory plus an explicit file) would be counted
  // twice into every position it touches.
  return [...new Set(files)];
}

/**
 * Identity used to record an input as done.
 *
 * Name plus byte size, not mtime: copying or re-downloading a file changes its
 * timestamp without changing its contents, and re-ingesting a month already
 * folded in would double every count it contributed.
 */
function inputId(path: string): string {
  return `${basename(path)}:${statSync(path).size}`;
}

// ---------------------------------------------------------------------------
// Pass 1 + pass 2, per file
// ---------------------------------------------------------------------------

function topGameFrom(game: RawGame): TopGameRecord | null {
  if (game.whiteElo <= 0 || game.blackElo <= 0) return null;
  return {
    white: game.white,
    black: game.black,
    whiteElo: game.whiteElo,
    blackElo: game.blackElo,
    result: game.result,
    year: game.year,
  };
}

async function ingestFile(path: string, opts: Options): Promise<FenAccumulator> {
  const root = new TrieNode();
  const insertOpts = { maxPlies: opts.maxPlies, topGamesMaxPly: TOP_GAMES_MAX_PLY };

  let games = 0;
  let sinceLastPrune = 0;
  const started = Date.now();

  console.log(`  pass 1: reading ${basename(path)}`);
  for await (const game of streamGamesFromFile(path, opts.maxPlies)) {
    insertGame(root, game.moves, game.result, game.whiteElo, game.blackElo, topGameFrom(game), insertOpts);
    games++;
    sinceLastPrune++;

    if (sinceLastPrune >= PRUNE_EVERY_GAMES) {
      const before = countNodes(root);
      const removed = pruneTrie(root, PRUNE_DEPTH, PRUNE_MIN_TOTAL);
      sinceLastPrune = 0;
      console.log(
        `    ${games.toLocaleString()} games · pruned ${removed.toLocaleString()} of ` +
        `${before.toLocaleString()} nodes · ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB heap`
      );
    }
  }

  // Final prune before pass 2: every node it removes is a node pass 2 would
  // otherwise pay a chess.js move/undo for.
  pruneTrie(root, PRUNE_DEPTH, PRUNE_MIN_TOTAL);
  const nodes = countNodes(root);
  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`    ${games.toLocaleString()} games → ${nodes.toLocaleString()} trie nodes (${elapsed}s)`);

  if (games === 0) {
    console.warn('    warning: no usable games — wrong format, or every result was "*"?');
    return new Map();
  }

  console.log('  pass 2: resolving positions');
  const acc: FenAccumulator = new Map();
  const stats = resolveTrie(root, acc, { maxPlies: opts.maxPlies, topGamesMaxPly: TOP_GAMES_MAX_PLY });
  console.log(`    ${stats.positions.toLocaleString()} distinct positions`);

  if (stats.illegalMoves > 0) {
    // A trickle is normal (mangled exports, null moves). A large fraction means
    // the tokenizer is producing junk and the aggregate is missing real games.
    const pct = ((stats.illegalMoves / Math.max(stats.nodesVisited, 1)) * 100).toFixed(2);
    const note = Number(pct) > 1 ? '  <-- investigate: see docs/explorer-ingest.md' : '';
    console.log(
      `    ${stats.illegalMoves.toLocaleString()} illegal moves (${pct}% of nodes), ` +
      `${stats.droppedSubtreeNodes.toLocaleString()} descendant nodes dropped${note}`
    );
  }

  return acc;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/** Current logical data size of the database, in MB. */
async function dbSizeMb(): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) return 0;
  const stats = (await db.stats()) as { dataSize?: number; indexSize?: number };
  return ((stats.dataSize ?? 0) + (stats.indexSize ?? 0)) / 1e6;
}

interface WriteSummary {
  written: number;
  skippedThin: number;
  skippedOverBudget: number;
  budgetTripped: boolean;
}

async function writeAggregate(acc: FenAccumulator, opts: Options): Promise<WriteSummary> {
  const summary: WriteSummary = {
    written: 0, skippedThin: 0, skippedOverBudget: 0, budgetTripped: false,
  };

  type Op = Parameters<typeof ExplorerNode.bulkWrite>[0][number];
  let batch: Op[] = [];
  let sinceBudgetCheck = 0;

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    // Unordered: one rejected document must not abandon the rest of the batch.
    await ExplorerNode.bulkWrite(batch, { ordered: false });
    summary.written += batch.length;
    batch = [];
  };

  for (const [fen, agg] of acc) {
    // The min-games threshold is applied HERE, against the global accumulator,
    // not per input file. A line played three times a month across six months is
    // 18 games and belongs in the collection; a per-file threshold would have
    // discarded it six separate times.
    if (agg.total < opts.minGames) {
      summary.skippedThin++;
      continue;
    }

    if (sinceBudgetCheck >= BUDGET_CHECK_EVERY) {
      sinceBudgetCheck = 0;
      await flush();
      const sizeMb = await dbSizeMb();
      if (!summary.budgetTripped && sizeMb >= opts.budgetMb) {
        summary.budgetTripped = true;
        console.warn(
          `\n  BUDGET: database at ${sizeMb.toFixed(0)} MB (limit ${opts.budgetMb} MB). ` +
          'No further NEW positions will be inserted; existing rows still update.'
        );
      }
    }

    const doc = toDocument(fen, agg, TOP_GAMES_MAX_PLY);
    const { _id, ...fields } = doc;

    if (summary.budgetTripped) {
      // Past the ceiling, keep the collection *correct* without growing it:
      // refresh rows that already exist, insert nothing new.
      batch.push({ updateOne: { filter: { _id }, update: { $set: fields }, upsert: false } });
      summary.skippedOverBudget++;
    } else {
      batch.push({ updateOne: { filter: { _id }, update: { $set: fields }, upsert: true } });
    }

    sinceBudgetCheck++;
    if (batch.length >= WRITE_BATCH) {
      await flush();
      if (summary.written % (WRITE_BATCH * 25) === 0) {
        console.log(`    ${summary.written.toLocaleString()} documents written`);
      }
    }
  }

  await flush();
  return summary;
}

/**
 * Remove rows left behind by an earlier ingest with looser bounds.
 *
 * Nothing this run wrote can be below the threshold, so this only ever catches
 * rows from a previous run — but leaving them means the read path serves
 * statistics the current bounds say are too thin to trust.
 */
async function pruneThinRows(minGames: number): Promise<number> {
  const result = await ExplorerNode.deleteMany({ total: { $lt: minGames } });
  return result.deletedCount ?? 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const inputs = collectInputs(opts.from);

  if (inputs.length === 0) throw new Error('No input files matched --from');

  console.log('GrandForge opening-explorer ingest');
  console.log(`  inputs      ${inputs.length} file(s)`);
  console.log(`  depth       ${opts.maxPlies} plies`);
  console.log(`  min games   ${opts.minGames}`);
  console.log(`  budget      ${opts.budgetMb} MB`);
  console.log(`  work dir    ${resolvePath(opts.work)}`);
  if (opts.dryRun) console.log('  DRY RUN — MongoDB will not be touched');
  console.log('');

  mkdirSync(opts.work, { recursive: true });
  const checkpointPath = join(opts.work, 'accumulator.ndjson');
  const statePath = join(opts.work, 'state.json');

  // ---- resume ------------------------------------------------------------
  let global: FenAccumulator = new Map();
  let completed = new Set<string>();
  const previous = opts.fresh ? null : readState(statePath);

  if (previous) {
    // Counters in the checkpoint were accumulated under the old bounds; folding
    // new work in on top would produce a collection that is neither.
    if (previous.maxPlies !== opts.maxPlies || previous.minGames !== opts.minGames) {
      throw new Error(
        `Checkpoint was built with --max-plies ${previous.maxPlies} --min-games ${previous.minGames}, ` +
        `but this run asks for ${opts.maxPlies}/${opts.minGames}. ` +
        'Re-run with the original bounds, or with --fresh to start over.'
      );
    }
    global = await readCheckpoint(checkpointPath);
    completed = new Set(previous.completed);
    console.log(
      `Resuming: ${global.size.toLocaleString()} positions, ` +
      `${completed.size} input(s) already folded in\n`
    );
  } else if (opts.fresh && existsSync(checkpointPath)) {
    console.log('--fresh: ignoring the existing checkpoint\n');
  }

  // ---- per-file passes ---------------------------------------------------
  for (const [index, path] of inputs.entries()) {
    const id = inputId(path);
    const label = `[${index + 1}/${inputs.length}] ${basename(path)}`;

    if (completed.has(id)) {
      console.log(`${label} — already ingested, skipping`);
      continue;
    }

    console.log(label);
    const month = await ingestFile(path, opts);
    foldInto(global, month);
    completed.add(id);

    // Checkpoint after each input, before starting the next: this is the unit of
    // work a crash can cost.
    console.log(`  fold: ${global.size.toLocaleString()} positions total — checkpointing`);
    await writeCheckpoint(checkpointPath, global);
    const state: IngestState = {
      version: CHECKPOINT_VERSION,
      completed: [...completed],
      maxPlies: opts.maxPlies,
      minGames: opts.minGames,
    };
    writeState(statePath, state);
    console.log('');
  }

  // ---- report ------------------------------------------------------------
  let reportable = 0;
  let games = 0;
  for (const agg of global.values()) {
    games += agg.total;
    if (agg.total >= opts.minGames) reportable++;
  }

  console.log('Aggregate complete');
  console.log(`  positions          ${global.size.toLocaleString()}`);
  console.log(`  reportable (>=${opts.minGames})  ${reportable.toLocaleString()}`);
  console.log(`  position-visits    ${games.toLocaleString()}`);
  // ~600 B/doc measured on the recommended bounds; see ExplorerNode.ts sizing.
  console.log(`  estimated size     ~${((reportable * 600) / 1e6).toFixed(0)} MB\n`);

  if (opts.dryRun) {
    console.log('Dry run — nothing written. Checkpoint is on disk; re-run without --dry-run to write.');
    return;
  }

  // ---- write -------------------------------------------------------------
  await connectDB();
  console.log('Connected — writing to chess-analyzer.explorernodes');
  console.log(`  database currently ${(await dbSizeMb()).toFixed(0)} MB\n`);

  const summary = await writeAggregate(global, opts);
  const deleted = await pruneThinRows(opts.minGames);

  console.log('\nWrite complete');
  console.log(`  documents upserted   ${summary.written.toLocaleString()}`);
  console.log(`  skipped (too thin)   ${summary.skippedThin.toLocaleString()}`);
  if (summary.budgetTripped) {
    console.log(`  skipped (budget)     ${summary.skippedOverBudget.toLocaleString()}`);
  }
  console.log(`  stale rows deleted   ${deleted.toLocaleString()}`);
  console.log(`  database now         ${(await dbSizeMb()).toFixed(0)} MB`);

  if (summary.budgetTripped) {
    console.log(
      '\nThe budget guard stopped new inserts. Raise --min-games (cheaper, and the ' +
      'dropped rows are the least-browsed ones) before lowering --max-plies.'
    );
  }
}

main()
  .then(async () => {
    await mongoose.disconnect().catch(() => { /* never connected on a dry run */ });
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\nIngest failed:', err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    // The checkpoint is intact: re-running resumes from the last completed input.
    await mongoose.disconnect().catch(() => { /* not connected */ });
    process.exit(1);
  });
