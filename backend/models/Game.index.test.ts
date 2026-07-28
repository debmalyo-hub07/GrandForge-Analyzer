import { describe, it, expect } from 'vitest';
import Game from './Game';
import Position from './Position';
import TablebaseEntry from './TablebaseEntry';
import MasterGame from './MasterGame';
import ReviewJob from './ReviewJob';
import SessionModel from './Session';
import Opening from './Opening';

/**
 * Pure schema-definition tests — no MongoDB connection. `schema.indexes()`
 * returns the declared `[keys, options]` tuples (including path-level
 * `index: true` / `unique: true` declarations), which is exactly the surface
 * mongoose's `autoIndex` sends to Atlas on cold start.
 *
 * Two things are guarded here:
 *   1. the corrected index definitions (data-audit §0, §2b, §2f)
 *   2. the 17 redundant/unused indexes that were removed (data-audit §1c) —
 *      re-adding one should fail a test, because index bytes already exceed
 *      data bytes on the M0 tier.
 */

type IndexTuple = [Record<string, unknown>, Record<string, unknown>];

function indexes(model: { schema: unknown }): IndexTuple[] {
  return (model.schema as { indexes(): IndexTuple[] }).indexes();
}

function sameKeys(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k, i) => kb[i] === k && a[k] === b[k]);
}

function findIndex(model: { schema: unknown }, keys: Record<string, unknown>): IndexTuple | undefined {
  return indexes(model).find(([k]) => sameKeys(k, keys));
}

function hasIndex(model: { schema: unknown }, keys: Record<string, unknown>): boolean {
  return findIndex(model, keys) !== undefined;
}

// ─────────────────────────────────────────────────────────────
// Game — §0 Critical: the second PGN upload used to 500
// ─────────────────────────────────────────────────────────────

describe('Game indexes', () => {
  it('source dedupe index only applies to imported games', () => {
    const idx = findIndex(Game, {
      'metadata.source': 1,
      'metadata.sourceGameId': 1,
      userId: 1,
    });
    expect(idx).toBeDefined();
    expect(idx![1].unique).toBe(true);
    // `sparse` on a COMPOUND index indexes a doc that has ANY of the keys, and
    // `metadata.source` is required — so every pgn_upload row was indexed under
    // the identical {pgn_upload, null, null} key and the 2nd upload hit E11000.
    expect(idx![1].sparse).toBeUndefined();
    expect(idx![1].partialFilterExpression).toEqual({
      'metadata.sourceGameId': { $type: 'string' },
    });
  });

  it('anonymous games expire after 7 days', () => {
    const idx = findIndex(Game, { 'metadata.importedAt': 1 });
    expect(idx).toBeDefined();
    expect(idx![1].expireAfterSeconds).toBe(604_800);
    expect(idx![1].partialFilterExpression).toEqual({ userId: { $exists: false } });
  });

  it('keeps the owner listing index', () => {
    expect(hasIndex(Game, { userId: 1, 'metadata.importedAt': -1 })).toBe(true);
  });

  it('drops the redundant and unused single-field indexes', () => {
    expect(hasIndex(Game, { userId: 1 })).toBe(false); // prefix of the listing index
    expect(hasIndex(Game, { 'metadata.sourceGameId': 1 })).toBe(false); // never queried alone
    expect(hasIndex(Game, { 'metadata.ecoCode': 1 })).toBe(false); // only MasterGame is ECO-filtered
    expect(hasIndex(Game, { engineReady: 1 })).toBe(false); // $ne:true on a ~100%-true boolean
  });
});

// ─────────────────────────────────────────────────────────────
// Position — §2b unique key must equal the upsert key; §4 LRU/TTL
// ─────────────────────────────────────────────────────────────

describe('Position indexes', () => {
  it('unique key matches the (fen, engineVersion) upsert filter', () => {
    const idx = findIndex(Position, { fen: 1, engineVersion: 1 });
    expect(idx).toBeDefined();
    expect(idx![1].unique).toBe(true);
  });

  it('no longer carries depth in the unique key', () => {
    expect(hasIndex(Position, { fen: 1, engineVersion: 1, depth: 1 })).toBe(false);
  });

  it('expires 60 days after the last read (LRU via computedAt touch)', () => {
    const idx = findIndex(Position, { computedAt: 1 });
    expect(idx).toBeDefined();
    expect(idx![1].expireAfterSeconds).toBe(5_184_000);
  });
});

// ─────────────────────────────────────────────────────────────
// TablebaseEntry — §2f
// ─────────────────────────────────────────────────────────────

describe('TablebaseEntry indexes', () => {
  it('keeps exactly one unique fen index', () => {
    const fenIndexes = indexes(TablebaseEntry).filter(([k]) => sameKeys(k, { fen: 1 }));
    expect(fenIndexes).toHaveLength(1);
    expect(fenIndexes[0][1].unique).toBe(true);
  });

  it('expires 180 days after fetch', () => {
    const idx = findIndex(TablebaseEntry, { fetchedAt: 1 });
    expect(idx).toBeDefined();
    expect(idx![1].expireAfterSeconds).toBe(15_552_000);
  });
});

// ─────────────────────────────────────────────────────────────
// Redundant/unused index removal on the remaining collections
// ─────────────────────────────────────────────────────────────

describe('MasterGame indexes', () => {
  it('keeps the ECO filter and the featured listing index', () => {
    expect(hasIndex(MasterGame, { 'metadata.ecoCode': 1 })).toBe(true);
    expect(hasIndex(MasterGame, { featured: 1, createdAt: -1 })).toBe(true);
  });

  it('drops the redundant featured prefix and the unusable/unqueried indexes', () => {
    expect(hasIndex(MasterGame, { featured: 1 })).toBe(false);
    expect(hasIndex(MasterGame, { engineReady: 1 })).toBe(false);
    expect(hasIndex(MasterGame, { tags: 1 })).toBe(false);
    // ci-regex queries cannot use these, so they only cost insert bytes
    expect(hasIndex(MasterGame, { 'metadata.white': 1 })).toBe(false);
    expect(hasIndex(MasterGame, { 'metadata.black': 1 })).toBe(false);
  });
});

describe('ReviewJob indexes', () => {
  it('keeps the resume lookup key and the 30-day TTL', () => {
    const resume = findIndex(ReviewJob, { clientJobId: 1, userId: 1 });
    expect(resume).toBeDefined();
    expect(resume![1].unique).toBe(true);

    const ttl = findIndex(ReviewJob, { updatedAt: 1 });
    expect(ttl).toBeDefined();
    expect(ttl![1].expireAfterSeconds).toBe(2_592_000);
  });

  it('drops the prefix indexes and the index for a route that does not exist', () => {
    expect(hasIndex(ReviewJob, { userId: 1 })).toBe(false);
    expect(hasIndex(ReviewJob, { clientJobId: 1 })).toBe(false);
    expect(hasIndex(ReviewJob, { gameId: 1 })).toBe(false);
    expect(hasIndex(ReviewJob, { status: 1 })).toBe(false);
    // there is no "list my review jobs" route — only findOne({clientJobId, userId})
    expect(hasIndex(ReviewJob, { userId: 1, status: 1, updatedAt: -1 })).toBe(false);
  });
});

describe('Session indexes', () => {
  it('keeps the owner listing index', () => {
    expect(hasIndex(SessionModel, { userId: 1, updatedAt: -1 })).toBe(true);
  });

  it('drops the userId prefix and the never-queried isPublic index', () => {
    expect(hasIndex(SessionModel, { userId: 1 })).toBe(false);
    expect(hasIndex(SessionModel, { isPublic: 1 })).toBe(false);
  });
});

describe('Opening indexes', () => {
  it('keeps the lookup and tree indexes', () => {
    expect(hasIndex(Opening, { moveSequence: 1 })).toBe(true);
    expect(hasIndex(Opening, { ecoCode: 1, plyDepth: 1 })).toBe(true);
    const fen = findIndex(Opening, { fen: 1 });
    expect(fen).toBeDefined();
    expect(fen![1].unique).toBe(true);
  });

  it('drops the ecoCode prefix index', () => {
    expect(hasIndex(Opening, { ecoCode: 1 })).toBe(false);
  });
});
