/**
 * GrandForge — ECO Opening Database Seeder
 *
 * Seeds the `openings` collection from the Lichess open-source ECO TSV files.
 * Source: https://github.com/lichess-org/chess-openings (CC0-1.0 — public domain
 * dedication; verified 2026-07-28 against the upstream README and repo metadata.
 * No attribution obligation attaches to this data.)
 *
 * The catalogue (ECO code, name, move sequence) comes from that CC0 source. The
 * `description` field does NOT — it is our own prose, seeded separately by
 * `scripts/seedOpeningTheory.ts`. Because this seeder is wipe-and-replace, it
 * snapshots every existing `description` by `moveSequence` before clearing and
 * restores it after inserting; otherwise a routine re-seed would silently
 * destroy hand-written theory.
 *
 * Run: npx tsx scripts/seedOpenings.ts
 */
import { Chess } from 'chess.js';
import { connectDB } from '../backend/db';
import Opening from '../backend/models/Opening';

const ECO_FILES = ['a', 'b', 'c', 'd', 'e'];
const BASE_URL = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';

interface OpeningSeedDoc {
  ecoCode: string;
  name: string;
  family: string;
  variation: string;
  pgn: string;
  fen: string;
  moveSequence: string;
  plyDepth: number;
}

async function seedOpenings(): Promise<void> {
  await connectDB();
  console.log('✓ Connected to chess-analyzer');

  // Snapshot our own prose before the wipe. Keyed on moveSequence — the same
  // join key seedOpeningTheory.ts uses — because _id is regenerated on insert.
  const existingTheory = new Map<string, string>();
  for (const doc of await Opening.find(
    { description: { $exists: true, $ne: '' } },
    { moveSequence: 1, description: 1 },
  ).lean()) {
    if (doc.moveSequence && doc.description) existingTheory.set(doc.moveSequence, doc.description);
  }
  console.log(`✓ Snapshotted ${existingTheory.size} existing description(s)`);

  await Opening.deleteMany({});
  console.log('✓ Cleared existing openings');

  // Drop stale indexes from previous schema versions (e.g. unique ecoCode).
  try {
    await Opening.collection.dropIndexes();
    console.log('✓ Dropped old indexes');
  } catch { /* no indexes to drop */ }
  await Opening.syncIndexes();
  console.log('✓ Synced schema indexes');

  let totalInserted = 0;

  for (const letter of ECO_FILES) {
    const url = `${BASE_URL}/${letter}.tsv`;
    console.log(`→ Fetching ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`✗ Failed to fetch ${letter}.tsv (status ${res.status})`);
      continue;
    }
    const text = await res.text();
    const lines = text.trim().split('\n').slice(1); // drop header row

    const openings: OpeningSeedDoc[] = lines
      .map((line): OpeningSeedDoc | null => {
        const cols = line.split('\t');
        // Lichess TSV: eco \t name \t pgn (3 cols). Older format had 4 (+ fen).
        if (cols.length < 3) return null;
        const [ecoCode, name, pgn] = cols;
        const fen = cols.length >= 4 && cols[3].trim()
          ? cols[3].trim()
          : pgnToFen(pgn.trim());
        if (!fen) return null;
        const [family, ...variationParts] = name.split(':');
        const moveSequence = pgn.replace(/\d+\./g, '').replace(/\s+/g, ' ').trim();
        return {
          ecoCode: ecoCode.trim(),
          name: name.trim(),
          family: family.trim(),
          variation: variationParts.join(':').trim(),
          pgn: pgn.trim(),
          fen,
          moveSequence,
          plyDepth: moveSequence.split(' ').filter(Boolean).length,
        };
      })
      .filter((x): x is OpeningSeedDoc => x !== null);

    if (openings.length > 0) {
      await Opening.insertMany(openings, { ordered: false });
      totalInserted += openings.length;
      console.log(`  ✓ Inserted ${openings.length} openings for ECO group ${letter.toUpperCase()}`);
    }
  }

  // Put our prose back on the rows it belonged to. A miss means the catalogue
  // renamed or dropped that line upstream — report it rather than swallow it.
  let restored = 0;
  const orphaned: string[] = [];
  for (const [moveSequence, description] of existingTheory) {
    const res = await Opening.updateOne({ moveSequence }, { $set: { description } });
    if (res.matchedCount > 0) restored += 1;
    else orphaned.push(moveSequence);
  }
  if (existingTheory.size > 0) {
    console.log(`✓ Restored ${restored}/${existingTheory.size} description(s)`);
  }
  if (orphaned.length > 0) {
    console.warn(`⚠ ${orphaned.length} description(s) had no matching row after re-seed:`);
    for (const m of orphaned) console.warn(`    ${m}`);
    console.warn('  Re-run `npx tsx scripts/seedOpeningTheory.ts` to reseed from source.');
  }

  const final = await Opening.countDocuments();
  console.log(`\n✓ Total openings seeded: ${final} (this run inserted ${totalInserted})`);
  process.exit(0);
}

function pgnToFen(pgn: string): string | null {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    return chess.fen();
  } catch {
    return null;
  }
}

seedOpenings().catch((err) => {
  console.error('✗ Opening seed failed:', err);
  process.exit(1);
});
