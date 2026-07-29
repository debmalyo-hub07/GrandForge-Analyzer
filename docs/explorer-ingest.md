# Opening explorer — building the position aggregate

`scripts/ingestExplorer.ts` builds the `explorerNodes` collection that
`GET /api/explorer/lookup` reads. It is an **offline, operator-run** job: it is
never invoked by the app, never by CI, and never on a schedule. You run it on a
laptop or a workstation with a corpus of PGN files, it writes a few hundred MB
to MongoDB, and the platform serves point reads out of that collection forever
after.

Everything below assumes a shell at the repo root with a working `.env`
(`MONGODB_URI`).

---

## 1. What it builds

One document per chess position, keyed by a transposition-stable FEN:

```js
{
  _id: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3",
  total: 1284302, white: 512044, draws: 331100, black: 441158,
  eloSum: 6100482000, eloGames: 1201942, minPly: 1,
  moves: [ { uci: "c7c5", san: "c5", total: 401221, white: 158..., draws: ..., black: ... }, ... ],
  topGames: [ { white: "...", black: "...", whiteElo: 2712, blackElo: 2688, result: "1-0", year: 2021 }, ... ]
}
```

Three things about that shape are load-bearing:

- **`_id` is the FEN.** The read path is a point lookup and nothing else, so the
  collection carries no secondary index at all. On a 512 MB Atlas M0 an index on
  a multi-million-document collection is real money for no benefit here.
- **The `_id` FEN is the first four fields only** — placement, side to move,
  castling, en passant. The halfmove clock and fullmove number are dropped, which
  is what makes two different move orders reaching the same position collapse to
  one row. En passant is deliberately kept: a position where a capture is
  available is not the same position. `normalizeExplorerFen` in
  `backend/models/ExplorerNode.ts` is the single implementation; the ingest
  imports it rather than keeping a second copy.
- **`eloGames` is the divisor for the average, not `total`.** Games without
  rating headers contribute to `total` but to neither side of the Elo fraction.
  Dividing by `total` would report an average hundreds of points low on any
  corpus with unrated games, with nothing to signal it.

## 2. Getting a corpus

**This script hardcodes no download URL and contacts no third party.** You supply
local files. That is a deliberate constraint, not an oversight — the platform
must not have a runtime or build-time dependency on anyone else's service.

What the parser accepts: `.pgn`, `.txt`, or `.zip` containing them (streamed, so
a 30 GB archive does not need 30 GB of disk unpacked). Standard PGN with
`[Result "..."]` headers. Games with a `*` result are dropped; `[WhiteElo]` /
`[BlackElo]` / `[UTCDate]` / `[Date]` are used when present and simply absent
otherwise.

Before ingesting a corpus, check every box:

- [ ] The licence permits redistribution of **derived aggregate statistics**. You
      are not republishing games; you are publishing counts. Most open game
      databases allow this, but confirm rather than assume.
- [ ] Attribution obligations, if any, are satisfied somewhere you can point to.
- [ ] The corpus is not scraped from a service whose terms forbid it.
- [ ] Player names in `topGames` are acceptable to display. If in doubt, ingest
      with `--max-plies` low enough that `topGames` stays empty (they are only
      collected at ply ≤ 12), or drop the field before writing.
- [ ] You have a note of where the corpus came from and under what terms, so a
      future re-ingest does not have to re-litigate this.

Practical shape: monthly files ingest well because the job checkpoints per file
and folds them into one global accumulator. Six one-month files give the same
result as one six-month file, but a crash costs one month instead of everything.

## 3. Sizing

Rough numbers, from the observed document shape:

| Reportable positions | Approx. collection size |
|---|---|
| 100 k | ~60 MB |
| 300 k | ~180 MB |
| 500 k | ~300 MB |
| 1 M | ~600 MB — **over an M0** |

"Reportable" means positions surviving `--min-games`. The dry run prints an
estimate before anything is written.

Three dials, in the order you should reach for them:

1. **`--min-games` (default 8).** Cheapest lever by far. The dropped rows are the
   least-browsed positions in the database — a line played 3 times total is noise
   whose W/D/L split means nothing. Raising this from 8 to 20 typically halves
   the collection.
2. **`--max-plies` (default 20).** Ten moves a side. Going deeper grows the
   position count superlinearly, and past move ~15 the explorer stops being an
   opening explorer.
3. **`--budget-mb` (default 320).** A hard stop, not a target. When `db.stats()`
   crosses it the job switches to `upsert: false`, so existing rows keep getting
   refreshed while no new ones are inserted, and it says so at the end. It is a
   guard against filling the tier mid-run, not a sizing strategy.

The threshold is applied against the **global** accumulator, after all files are
folded. A position played 3 times a month across 6 months is 18 games and is kept.

## 4. Running it

Dry run first, always. It does the entire aggregate and writes nothing:

```bash
npx tsx scripts/ingestExplorer.ts --from ./corpus --dry-run
```

`--from` takes a file or a directory (scanned one level deep) and is repeatable:

```bash
npx tsx scripts/ingestExplorer.ts --from ./corpus/2024-01.pgn --from ./corpus/2024-02.pgn.zip
```

The dry run leaves a checkpoint on disk, so the real run does not redo pass 1:

```bash
npx tsx scripts/ingestExplorer.ts --from ./corpus
```

All flags:

| Flag | Default | Meaning |
|---|---|---|
| `--from <path>` | — | PGN/TXT/ZIP file or directory of them. Repeatable. Required. |
| `--work <dir>` | `.explorer-ingest` | Checkpoint directory. |
| `--max-plies <n>` | 20 | Ingest depth. |
| `--min-games <n>` | 8 | Positions below this are not written. |
| `--budget-mb <n>` | 320 | Stop inserting new rows above this DB size. |
| `--dry-run` | off | Aggregate and report; never touch MongoDB. |
| `--resume` | — | Accepted for clarity; resuming is automatic. |
| `--fresh` | off | Discard the existing checkpoint and start over. |
| `--help` | — | Print this table. |

### What it does, and why it takes two passes

**Pass 1** builds a SAN-prefix trie straight from the text. No board, no legality
check — just "this game's move tokens, one node per prefix." That is the only way
to get through tens of millions of games in reasonable time; replaying every move
through `chess.js` during the stream would cost roughly a day of CPU.

**Pass 2** walks that trie once with a single `chess.js` board, doing
`move()` / `undo()` depth-first. Each node learns its real FEN, illegal tokens
(from a malformed export) drop their subtree with a count, and — the point —
positions reached by different move orders land on the same FEN key and merge.
Legality is established once per distinct *path*, not once per game move, which
is why this is affordable.

The per-file prune (`PRUNE_DEPTH = 12`, `PRUNE_MIN_TOTAL = 2`) keeps pass 1's
trie from growing without bound. It has one documented cost: a position played
exactly once per month across many months can be pruned per-file even though its
global total would clear the threshold. Exposure is limited to very rare
positions deeper than ply 12.

## 5. Resuming

State lives in `--work` (default `.explorer-ingest/`): the NDJSON checkpoint plus
a small state file listing which inputs are already folded in. Re-running the
same command picks up where it stopped and prints `already ingested, skipping`
for finished files. Nothing to pass — `--resume` exists only so the intent can be
written down.

Files are identified by **name + byte size**, not mtime, so re-downloading a file
does not cause it to be counted twice.

Changing `--max-plies` or `--min-games` makes the checkpoint invalid, and the job
refuses to continue rather than silently mixing bounds:

```
Checkpoint was built with --max-plies 20 --min-games 8, ...
Re-run with the original bounds, or with --fresh to start over.
```

The checkpoint is NDJSON — one position per line — rather than one JSON document,
because a few million positions exceed V8's maximum string length and
`JSON.stringify` would throw at exactly the corpus size the checkpoint exists to
protect against. Writes go to a `.tmp` and are renamed, so an interrupted write
cannot destroy the previous good checkpoint. A torn final line is skipped with a
warning.

Delete the work directory (or pass `--fresh`) to start clean.

## 6. Verifying

In `mongosh`:

```js
use('chess-analyzer')
db.explorernodes.countDocuments()
db.stats().dataSize / 1e6                     // MB

// The starting position — a sanity check on the whole run.
db.explorernodes.findOne({ _id: /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w/ })

// Buckets must sum to total on every row. This should return nothing.
db.explorernodes.find({ $expr: { $ne: ['$total', { $add: ['$white', '$draws', '$black'] }] } }).limit(5)

// Nothing thinner than the threshold should have been written.
db.explorernodes.countDocuments({ total: { $lt: 8 } })
```

Then against the API (`npm run api:dev` in another shell):

```bash
curl 'http://localhost:3000/api/explorer/lookup?fen=rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR%20w%20KQkq%20-'
```

Expect `node.total` in the millions, `node.moves` sorted most-played-first with
`share` values summing to ≈1, and a plausible `avgElo`. Add
`&moves=e4%20e5%20Nf3` to also get the matched ECO opening in the same response.

Note the encoding: send spaces as `%20` and any SAN check marker as `%2B`.
Express decodes a raw `+` in a query string as a space, so `Bb5+` sent literally
arrives as `Bb5 ` and matches nothing.

The transposition check worth doing by hand — these two must return the same
`node.total`:

```
1.e4 e5 2.Nf3      →  fen after
1.Nf3 e5 2.e4      →  same fen
```

If they differ, pass 2 is not merging and every statistic in the explorer is
split across duplicate rows.

## 7. Re-ingesting

The write is an idempotent upsert keyed on `_id`, so re-running over the same
corpus produces the same collection. To extend an existing aggregate with a new
month, just add another `--from` and re-run: finished files are skipped and the
new one folds into the global accumulator.

To rebuild from scratch with different bounds:

```bash
rm -rf .explorer-ingest
npx tsx scripts/ingestExplorer.ts --from ./corpus --min-games 20 --dry-run
```

Rows below the new threshold are deleted at the end of a real run
(`stale rows deleted` in the summary), so the collection does not keep rows from
a previous, looser ingest.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `warning: no usable games` | Not PGN, or every `[Result]` is `*` | Check the file actually has headers; unfinished games are dropped by design |
| `no .pgn/.txt/.zip files in <dir>` | Wrong directory, or files one level deeper | `--from` scans one level; point it at the directory that holds the files |
| High `illegalMoves` in pass 2 | Corpus has non-standard SAN or corrupted movetext | A handful is normal; thousands means the export needs cleaning |
| Refuses to resume, bounds mismatch | `--max-plies`/`--min-games` changed | Re-run with the original values, or `--fresh` |
| `skipped (budget)` non-zero | DB hit `--budget-mb` | Raise `--min-games` and re-run — cheaper than lowering depth |
| Process OOMs in pass 1 | Trie outgrew RAM | Split the input into smaller files (it checkpoints per file), or lower `--max-plies` |
| `checkpoint: skipping unparseable line` | Previous run was killed mid-write | Expected and harmless; one position is lost from that resume |
| Explorer panel shows "no data" everywhere | Collection empty, or FEN normalization mismatch | `countDocuments()`, then compare the `_id` you get from `normalizeExplorerFen` against a row |
| `avgElo` implausibly low | Corpus is largely unrated | Expected — but confirm the divisor is `eloGames`, not `total` |

---

Tests for the pipeline live beside the source: `scripts/explorer/{pgn,trie,resolve,checkpoint}.test.ts`,
run by `npm test`.
