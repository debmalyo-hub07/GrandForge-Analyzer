/**
 * GrandForge — Master Games Seeder
 *
 * Seeds the `masterGames` collection with curated historical games,
 * each pre-indexed via indexGame() so they are engine-ready.
 *
 * Run: npx tsx scripts/seedMasterGames.ts
 */
import { connectDB } from '../api/_lib/db';
import MasterGame from '../api/_lib/models/MasterGame';
import { indexGame } from '../api/_lib/indexGame';
import { MASTER_GAMES_PGN } from './masterGamesPGN';

async function seedMasterGames(): Promise<void> {
  await connectDB();
  console.log('✓ Connected to chess-analyzer');

  await MasterGame.deleteMany({});
  console.log('✓ Cleared existing master games');

  let inserted = 0;
  let failed = 0;

  for (const entry of MASTER_GAMES_PGN) {
    try {
      const index = indexGame(entry.pgn);
      await MasterGame.create({
        pgn: entry.pgn,
        ...index,
        metadata: entry.metadata,
        tags: entry.tags,
        featured: entry.featured ?? false,
      });
      inserted++;
      console.log(`  ✓ ${entry.metadata.white} vs ${entry.metadata.black} (${entry.metadata.date})`);
    } catch (err) {
      failed++;
      console.error(
        `  ✗ Failed: ${entry.metadata.white} vs ${entry.metadata.black} — ${(err as Error).message}`
      );
    }
  }

  console.log(`\n✓ Master games seeded: ${inserted} inserted, ${failed} failed`);
  process.exit(0);
}

seedMasterGames().catch((err) => {
  console.error('✗ Master games seed failed:', err);
  process.exit(1);
});
