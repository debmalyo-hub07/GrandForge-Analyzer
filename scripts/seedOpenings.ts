/**
 * GrandForge — ECO Opening Database Seeder
 *
 * Seeds the `openings` collection from the Lichess open-source ECO TSV files.
 * Source: https://github.com/lichess-org/chess-openings (AGPL-3.0)
 *
 * Run: npx tsx scripts/seedOpenings.ts
 */
import { Chess } from 'chess.js';
import { connectDB } from '../api/_lib/db';
import Opening from '../api/_lib/models/Opening';

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
