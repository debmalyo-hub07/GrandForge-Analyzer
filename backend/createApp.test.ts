import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { RATE_LIMIT_TIERS } from './createApp';
import { gameReviewResultSchema } from './zodSchemas';

describe('rate limit tiers', () => {
  it('orders budgets by endpoint cost', () => {
    expect(RATE_LIMIT_TIERS.review).toBeGreaterThan(RATE_LIMIT_TIERS.browse);
    expect(RATE_LIMIT_TIERS.browse).toBeGreaterThan(RATE_LIMIT_TIERS.default);
    expect(RATE_LIMIT_TIERS.default).toBeGreaterThan(RATE_LIMIT_TIERS.strict);
  });

  // Anonymous writes to the shared eval cache are the one path where the limit is
  // a poisoning control, not a capacity one. It must sit below the read tier it
  // shares a review with — otherwise a script gets the same budget as the reads
  // an honest review depends on — while still clearing a couple of full games so
  // a real reviewer never hits it.
  it('keeps the cache-write budget below the read budget but above one game', () => {
    expect(RATE_LIMIT_TIERS.contribute).toBeLessThan(RATE_LIMIT_TIERS.review);
    expect(RATE_LIMIT_TIERS.contribute).toBeGreaterThan(200);
  });

  // The whole reason the review tier exists: one review fires roughly one
  // positions/eval read per ply, and `moveReviews` is bounded at 600 plies, so a
  // budget at or below that 429s partway through a single long game — which
  // surfaces as a silent storm of cache misses, not as an error the user sees.
  it('lets one maximum-length game review complete', () => {
    const maxPlies = 600;
    expect(gameReviewResultSchema.safeParse({}).success).toBe(false); // schema is reachable
    expect(RATE_LIMIT_TIERS.review).toBeGreaterThan(maxPlies);
  });

  const tierOf = (relPath: string): string | null => {
    const source = readFileSync(join(__dirname, relPath), 'utf8');
    const match = source.match(/createApp\((?:'([a-z]+)')?\)/);
    if (!match) return null;
    return match[1] ?? 'default';
  };

  it.each([
    ['routes/positions/eval.ts', 'review'],
    // Writes get their own, tighter bucket so a poisoning script can't 429 the
    // reads a review depends on (backend-audit §3 guard 12).
    ['routes/positions/cache.ts', 'contribute'],
    ['routes/positions/tablebase.ts', 'review'],
    ['routes/openings/lookup.ts', 'browse'],
    ['routes/openings/tree.ts', 'browse'],
    ['routes/master/games.ts', 'browse'],
    // Explorer browsing is one point read per board move — same cost profile as
    // the opening book it sits next to in the panel.
    ['routes/explorer/lookup.ts', 'browse'],
    // Abuse controls, not capacity limits: the brute-force surface and the
    // routes that spend a third-party API call on our behalf.
    ['routes/auth/login.ts', 'strict'],
    ['routes/auth/register.ts', 'strict'],
    ['routes/import/chesscom.ts', 'strict'],
    ['routes/import/lichess.ts', 'strict'],
    ['routes/engine-index/migrate.ts', 'strict'],
    ['routes/games/index.ts', 'default'],
    ['routes/review/save.ts', 'default'],
  ])('%s is on the %s tier', (relPath, tier) => {
    expect(tierOf(relPath)).toBe(tier);
  });

  it('every route module builds its app through createApp', () => {
    const source = readFileSync(join(__dirname, 'router.ts'), 'utf8');
    const imported = [...source.matchAll(/from '\.\/(routes\/[^']+)'/g)].map((m) => `${m[1]}.ts`);
    expect(imported.length).toBeGreaterThan(20);
    for (const relPath of imported) {
      expect(tierOf(relPath), relPath).not.toBeNull();
    }
  });
});
