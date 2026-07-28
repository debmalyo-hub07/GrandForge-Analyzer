# Self-Hosted Opening Explorer — Design (lead-authored after agent quota failure)

Goal: lichess-style explorer panel (per-move games count, W/D/L %, avg Elo, top games)
served entirely from our MongoDB. Zero runtime third-party calls. No attribution string
required in the UI (source data CC0 / uncopyrightable game facts).

## 1. Data source (verified live 2026-07-28)

**Lichess Elite Database** — https://database.nikonoel.fr/ (OBSERVED via fetch):
- Monthly zips `lichess_elite_YYYY-MM.zip`, 2020-06 → 2025-11 listed; recent months ~60-95 MB zip each.
- Filter: 2400+ vs 2200+ (bullet excluded); Dec 2021+ narrowed to 2500+ vs 2300+.
- ~300-800K games/month (784,161 in 2021-05 OBSERVED; recent narrower months INFERRED ~250-400K).
- Page states no license of its own; it is a mechanical filter of database.lichess.org dumps, which are CC0. Game scores/facts are not copyrightable. Excludes lichess broadcasts (the CC BY-SA subset) by construction — it only contains lichess-played rated games. → usable without attribution.
- Fallback source if the mirror disappears: filter the CC0 monthly dumps ourselves with the published pgn-extract scripts (also downloadable there) — same result, more bandwidth (~20 GB/month raw).

**Recommended corpus:** latest 6 elite months (~2M games, ~500 MB zip download total). Enough for
stable percentages to ply ~20; deeper coverage adds bytes faster than value.

## 2. Sizing math

Aggregate keyed on normalized FEN (4-field), pruned by depth D (plies) and min-games T.

Per-doc estimate: FEN key ~55-70 B + counters (total/white/draws/black ~16 B) + eloSum (8 B)
+ moves array (avg 8 moves × {uci 5, san ~5, 4 counters} ≈ 8×~40 B = 320 B) + topGames (only
plies ≤ 12, 4 × ~80 B = 320 B) + BSON/_id overhead ≈ **450-750 B data + ~120 B _id index**.

Unique positions with ≥T occurrences in a 2M-game corpus (INFERRED from opening-tree statistics):
- D=24, T=5 → ~500-900K docs → 300-700 MB. **Too risky.**
- D=20, T=8 → ~250-400K docs → **~150-280 MB. Recommended.**
- D=16, T=10 → ~120-200K docs → 80-150 MB. Fallback if overflow.

Coverage lost at (D=20, T=8): stats end at move 10 for offbeat lines, ~move 15-20 for main lines
(rare deep positions fail T anyway — their percentages would be noise). Matches the useful range
of lichess's masters panel for our purposes.

**Budget guard is empirical, not predictive:** ingest writes in ECO-popularity order and checks
`db.stats()` every 25K upserts; hard-stops new-position inserts at 320 MB (updates to existing
docs continue). Post-pass prune: delete depth>12 docs with total < 2T if over 300 MB.

## 3. Schema

New collection `explorerNodes` (do NOT overload `Position` — different key semantics, different TTL policy: explorer is permanent, Position cache is TTL'd):

```ts
{
  _id: string,           // normalized 4-field FEN (matches positionCache.normalizeFenForCache convention)
  total: number, white: number, draws: number, black: number,
  eloSum: number,        // avgElo = eloSum / (2*total), computed at read time
  maxPly: number,        // shallowest ply this position was seen at (for pruning)
  moves: [{ uci: string, san: string, total: number, white: number, draws: number, black: number }],
  topGames?: [{ white: string, black: string, whiteElo: number, blackElo: number,
                result: '1-0'|'0-1'|'1/2-1/2', year: number, lichessUrl?: string }], // ply ≤ 12 only, cap 4, highest-Elo
}
```
Indexes: `_id` only (free). No secondary indexes — all reads are point lookups by FEN.
Transpositions merge naturally (FEN key). `moves` capped at 30 subdocs (beyond that = noise).

## 4. Ingest pipeline (one-shot, offline, Windows/Node 20)

Two-pass to avoid chess.js replay of 48M moves (~day of CPU):

- **Pass 1 — SAN-prefix trie (string ops only, no board):** stream-unzip each monthly zip
  (`yauzl`/`unzipper`), regex-strip headers/comments, tokenize movetext to SAN array, truncate at
  D=20, insert path into an in-memory trie with W/D/L counters + eloSum. Periodic prune (every
  200K games, drop count==1 leaves deeper than ply 12) caps RAM at ~1-2 GB. Serialize trie to
  disk per month (checkpoint/resume = restart at next month file).
- **Pass 2 — FEN resolution + merge:** DFS the pruned trie with ONE chess.js instance doing
  incremental move/undo — each trie node costs exactly one `.move()` + one `.undo()`, so
  ~400K nodes ≈ minutes, not hours. Illegal-SAN branches (parser junk) dropped here for free.
  Emit `{fen → merged counters}` map (transpositions merge), bulk-upsert to Atlas in 1K batches
  with `bulkWrite`, budget guard as §2.
- Wall-clock estimate: download ~30-60 min (500 MB) + pass 1 ~45-90 min + pass 2 + upload
  ~30-60 min ≈ **2-4 h total, resumable per month**.

## 5. API (matches backend/routes/** conventions)

`backend/routes/explorer/lookup.ts`, registered in `backend/router.ts`:
- `GET /api/explorer/lookup?fen=<4-or-6-field FEN>` → normalize → point read →
  `{ node: { total, white, draws, black, avgElo, moves:[{uci,san,total,white,draws,black,pct...}], topGames } | null }`.
  Public, no auth, cache-control `public, max-age=86400, immutable-ish` (data is static between ingests).
  Served from the same 150/15min per-module bucket — one browse session ≈ 1 req/move, fine.

Frontend: `Explore` tab in the right panel (already in the reference bar); on FEN change fetch
lookup; render move rows with W/D/L bars; theory prose (own-authored, stored on `Opening.description`)
shown above the stats when the position matches a known opening.

## 6. Risks

- **Trie RAM blowup** (pass 1): mitigated by periodic count-1 pruning + per-month processing; worst case drop D to 16.
- **Atlas overflow:** empirical budget guard + prune pass (§2); explorer and Position cache must share the 512 MB — Position TTL (data-audit §4) must land first.
- **Elite mirror disappears:** re-derive from CC0 dumps with published scripts (slower, same output).
- **Thin coverage deep lines:** by design; UI falls back to "no data" + engine analysis (which we always have).
