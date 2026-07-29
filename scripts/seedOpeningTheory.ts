/**
 * GrandForge — Opening Theory Seeder
 *
 * Attaches our own opening prose (scripts/data/openingTheory/) to the catalogued
 * openings already in MongoDB. This is a *narrow* seeder by design: it only ever
 * runs `$set: { description }` on rows matched by `moveSequence`. It never
 * inserts, never deletes, and never touches any other field, so running it twice
 * is a no-op and running it after `seedOpenings.ts` is always safe.
 *
 * `moveSequence` is the join key — space-separated SAN with move numbers
 * stripped, exactly as seedOpenings.ts builds it from the CC0 ECO catalogue.
 * `scripts/data/openingTheory.test.ts` replays every sequence on a real board, so
 * a bad key fails in `npm test` rather than silently matching nothing here.
 *
 * Run: npx tsx scripts/seedOpeningTheory.ts [--dry-run]
 */
import { connectDB } from '../backend/db';
import Opening from '../backend/models/Opening';
import { OPENING_THEORY } from './data/openingTheory/index';

/** Mirrors the `maxlength` on Opening.description. */
const MAX_DESCRIPTION = 2000;

interface Mismatch {
  eco: string;
  name: string;
  moves: string;
  /** Catalogue name for the matched row, when the row exists but is named differently. */
  catalogueName?: string;
}

async function seedOpeningTheory(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  // Fail before touching the DB rather than half-way through a run.
  const overlong = OPENING_THEORY.filter((t) => t.text.length > MAX_DESCRIPTION);
  if (overlong.length > 0) {
    console.error(`✗ ${overlong.length} entr(ies) exceed the ${MAX_DESCRIPTION}-char bound:`);
    for (const t of overlong) console.error(`    ${t.eco} ${t.name} (${t.text.length})`);
    process.exit(1);
  }

  await connectDB();
  console.log(`✓ Connected to chess-analyzer${dryRun ? ' (dry run — nothing will be written)' : ''}`);
  console.log(`→ ${OPENING_THEORY.length} theory entries to apply`);

  let updated = 0;
  let unchanged = 0;
  const unmatched: Mismatch[] = [];
  const renamed: Mismatch[] = [];

  for (const entry of OPENING_THEORY) {
    const row = await Opening.findOne(
      { moveSequence: entry.moves },
      { _id: 1, name: 1, description: 1 },
    ).lean();

    if (!row) {
      unmatched.push({ eco: entry.eco, name: entry.name, moves: entry.moves });
      continue;
    }
    // Not fatal: the catalogue occasionally renames a line upstream. Worth
    // reporting so the prose can be checked against what it is now attached to.
    if (row.name !== entry.name) {
      renamed.push({ eco: entry.eco, name: entry.name, moves: entry.moves, catalogueName: row.name });
    }
    if (row.description === entry.text) {
      unchanged += 1;
      continue;
    }
    if (!dryRun) {
      await Opening.updateOne({ _id: row._id }, { $set: { description: entry.text } });
    }
    updated += 1;
  }

  console.log(`\n${dryRun ? 'Would update' : '✓ Updated'} ${updated} opening(s); ${unchanged} already current`);

  if (renamed.length > 0) {
    console.warn(`\n⚠ ${renamed.length} entr(ies) matched a row with a different catalogue name:`);
    for (const m of renamed) console.warn(`    ${m.eco} "${m.name}" → catalogue says "${m.catalogueName}"`);
  }

  if (unmatched.length > 0) {
    console.error(`\n✗ ${unmatched.length} entr(ies) matched no catalogued opening:`);
    for (const m of unmatched) console.error(`    ${m.eco} ${m.name} — "${m.moves}"`);
    console.error('  The catalogue may not be seeded yet: run `npx tsx scripts/seedOpenings.ts` first.');
    process.exit(1);
  }

  process.exit(0);
}

seedOpeningTheory().catch((err) => {
  console.error('✗ Opening theory seed failed:', err);
  process.exit(1);
});
