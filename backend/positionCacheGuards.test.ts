import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  AGREE_CP,
  DECISIVE_CP,
  MAX_ABS_CP,
  MAX_CONTRIBUTORS,
  MIN_CACHE_DEPTH,
  TRUST_THRESHOLD,
  contributorKey,
  evalsAgree,
  isNormalizedCacheFen,
  linesRejection,
  mergeContributors,
  reconcileCacheWrite,
  scoreRejection,
  toValidatableFen,
  turnFromFen,
  type Candidate,
  type LineClaim,
  type StoredRow,
} from './positionCacheGuards';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  depth: 20,
  evaluation: { cp: 30, mate: null },
  confirmations: 1,
  contributors: ['a:one'],
  ...over,
});

const row = (primary: Partial<Candidate> = {}, challenger: Candidate | null = null): StoredRow => ({
  primary: candidate(primary),
  challenger,
});

describe('isNormalizedCacheFen', () => {
  it('accepts the 4-field cache key', () => {
    expect(isNormalizedCacheFen(START)).toBe(true);
  });

  it('rejects a full 6-field FEN', () => {
    // The reader queries the 4-field form, so a 6-field write would store a row
    // nothing can ever match — an invisible leak rather than an error.
    expect(isNormalizedCacheFen(`${START} 0 1`)).toBe(false);
  });

  it('rejects a truncated FEN', () => {
    expect(isNormalizedCacheFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w')).toBe(false);
  });

  it('tolerates surrounding and repeated whitespace', () => {
    expect(isNormalizedCacheFen(`  ${START.replace(/ /g, '   ')}  `)).toBe(true);
  });
});

describe('toValidatableFen', () => {
  it('appends placeholder clocks to a 4-field key', () => {
    expect(toValidatableFen(START)).toBe(`${START} 0 1`);
  });

  it('leaves a 6-field FEN alone', () => {
    expect(toValidatableFen(`${START} 3 17`)).toBe(`${START} 3 17`);
  });
});

describe('turnFromFen', () => {
  it('reads the side to move from the FEN, not from a client field', () => {
    expect(turnFromFen(START)).toBe('w');
    expect(turnFromFen(START.replace(' w ', ' b '))).toBe('b');
  });

  it('defaults to white for a malformed FEN rather than throwing', () => {
    expect(turnFromFen('garbage')).toBe('w');
  });
});

describe('scoreRejection', () => {
  it('accepts an ordinary centipawn score', () => {
    expect(scoreRejection({ type: 'cp', value: 35 })).toBeNull();
    expect(scoreRejection({ type: 'cp', value: -1200 })).toBeNull();
  });

  it('rejects a centipawn score beyond the bound', () => {
    expect(scoreRejection({ type: 'cp', value: MAX_ABS_CP + 1 })).toMatch(/out of range/);
    expect(scoreRejection({ type: 'cp', value: -(MAX_ABS_CP + 1) })).toMatch(/out of range/);
  });

  it('accepts a real mate distance in either direction', () => {
    expect(scoreRejection({ type: 'mate', value: 4 })).toBeNull();
    expect(scoreRejection({ type: 'mate', value: -9 })).toBeNull();
  });

  it('rejects mate in 0 — what a zeroed payload looks like', () => {
    expect(scoreRejection({ type: 'mate', value: 0 })).toMatch(/Mate distance/);
  });

  it('rejects an absurd mate distance', () => {
    expect(scoreRejection({ type: 'mate', value: 5000 })).toMatch(/Mate distance/);
  });

  it('rejects a non-integer score', () => {
    expect(scoreRejection({ type: 'cp', value: 12.5 })).toMatch(/integer/);
  });
});

describe('linesRejection', () => {
  const line = (over: Partial<LineClaim> = {}): LineClaim => ({
    multipv: 1,
    eval: { type: 'cp', value: 30 },
    pv: ['e2e4', 'e7e5'],
    ...over,
  });

  it('accepts a well-formed single-line payload', () => {
    expect(linesRejection(START, { type: 'cp', value: 30 }, [line()])).toBeNull();
  });

  it('accepts two MultiPV lines with distinct first moves', () => {
    const lines = [line(), line({ multipv: 2, eval: { type: 'cp', value: 20 }, pv: ['d2d4', 'd7d5'] })];
    expect(linesRejection(START, { type: 'cp', value: 30 }, lines)).toBeNull();
  });

  it('rejects an empty line list', () => {
    expect(linesRejection(START, { type: 'cp', value: 30 }, [])).toMatch(/At least one line/);
  });

  it('rejects non-contiguous multipv labels', () => {
    const lines = [line(), line({ multipv: 3, pv: ['d2d4'] })];
    expect(linesRejection(START, { type: 'cp', value: 30 }, lines)).toMatch(/contiguous/);
  });

  it('rejects a top line whose score contradicts the headline evaluation', () => {
    // The honest client derives both from the same search line, so a mismatch is
    // fabrication.
    expect(linesRejection(START, { type: 'cp', value: 900 }, [line()])).toMatch(/must match/);
  });

  it('rejects a mate headline against a cp top line', () => {
    expect(linesRejection(START, { type: 'mate', value: 3 }, [line()])).toMatch(/must match/);
  });

  it('rejects an illegal first move — the cheapest poison', () => {
    // "The best move here is e2e5" would otherwise be believed by every future
    // reader of this position.
    const bad = line({ pv: ['e2e5'] });
    expect(linesRejection(START, { type: 'cp', value: 30 }, [bad])).toMatch(/Illegal move/);
  });

  it('rejects an illegal move deep in the PV, not just the first', () => {
    // The tail is displayed as the best line, so a legal-head/garbage-tail payload
    // still shows a reader nonsense.
    const bad = line({ pv: ['e2e4', 'e7e5', 'a1a5'] });
    expect(linesRejection(START, { type: 'cp', value: 30 }, [bad])).toMatch(/Illegal move/);
  });

  it('rejects two lines claiming the same first move', () => {
    const lines = [line(), line({ multipv: 2, pv: ['e2e4', 'c7c5'] })];
    expect(linesRejection(START, { type: 'cp', value: 30 }, lines)).toMatch(/distinct moves/);
  });

  it('rejects a line with no moves at all', () => {
    expect(linesRejection(START, { type: 'cp', value: 30 }, [line({ pv: [] })])).toMatch(
      /at least one move/
    );
  });

  it('accepts a legal promotion', () => {
    const fen = '8/6P1/8/8/8/8/8/K6k w - -';
    const promo = line({ pv: ['g7g8q'], eval: { type: 'cp', value: 900 } });
    expect(linesRejection(fen, { type: 'cp', value: 900 }, [promo])).toBeNull();
  });

  it('rejects an invalid FEN outright', () => {
    expect(linesRejection('not a fen at all', { type: 'cp', value: 30 }, [line()])).toBeTruthy();
  });
});

describe('contributorKey', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.IP_HASH_SALT = 'a-test-salt-that-is-long-enough-to-be-real';
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it('keys a logged-in user by id, without touching the IP', () => {
    expect(contributorKey('user123', '203.0.113.9')).toBe('u:user123');
  });

  it('hashes an anonymous IP rather than storing it', () => {
    const key = contributorKey(undefined, '203.0.113.9');
    expect(key).toMatch(/^a:/);
    expect(key).not.toContain('203.0.113.9');
  });

  it('is stable for the same IP and distinct for different ones', () => {
    expect(contributorKey(undefined, '203.0.113.9')).toBe(contributorKey(undefined, '203.0.113.9'));
    expect(contributorKey(undefined, '203.0.113.9')).not.toBe(
      contributorKey(undefined, '203.0.113.10')
    );
  });

  it('changes when the salt changes, so hashes are not portable across deploys', () => {
    const a = contributorKey(undefined, '203.0.113.9');
    process.env.IP_HASH_SALT = 'a-completely-different-salt-value-here';
    expect(contributorKey(undefined, '203.0.113.9')).not.toBe(a);
  });

  it('falls back to JWT_SECRET so no new environment variable is required', () => {
    delete process.env.IP_HASH_SALT;
    process.env.JWT_SECRET = 'fallback-secret-long-enough-for-the-boot-assert';
    expect(contributorKey(undefined, '203.0.113.9')).toMatch(/^a:/);
  });

  it('returns null rather than an unsalted hash when no secret exists', () => {
    // An unsalted IP hash is reversible by brute force over the whole IPv4 space
    // — that would turn an abuse control into a PII store.
    delete process.env.IP_HASH_SALT;
    delete process.env.JWT_SECRET;
    expect(contributorKey(undefined, '203.0.113.9')).toBeNull();
  });

  it('returns null when there is no IP to key on', () => {
    expect(contributorKey(undefined, undefined)).toBeNull();
  });
});

describe('evalsAgree', () => {
  it('accepts evaluations within the tolerance', () => {
    expect(evalsAgree({ cp: 30, mate: null }, { cp: 30 + AGREE_CP, mate: null })).toBe(true);
  });

  it('rejects evaluations just outside it', () => {
    expect(evalsAgree({ cp: 30, mate: null }, { cp: 30 + AGREE_CP + 1, mate: null })).toBe(false);
  });

  it('rejects a sign flip even when the magnitudes are small', () => {
    // +0.20 and -0.20 are 40 cp apart and disagree about who is better.
    expect(evalsAgree({ cp: 20, mate: null }, { cp: -20, mate: null })).toBe(false);
  });

  it('treats two decisive same-signed evals as agreeing despite a wide gap', () => {
    // +12.0 and +25.0 are the same fact. Holding them to ±30 cp would leave
    // totally-won positions churning the challenger slot forever.
    expect(evalsAgree({ cp: DECISIVE_CP + 200, mate: null }, { cp: 2500, mate: null })).toBe(true);
  });

  it('does not extend that leniency across a sign flip', () => {
    expect(evalsAgree({ cp: 2000, mate: null }, { cp: -2000, mate: null })).toBe(false);
  });

  it('agrees on two mates for the same side at different distances', () => {
    expect(evalsAgree({ cp: null, mate: 6 }, { cp: null, mate: 9 })).toBe(true);
  });

  it('disagrees on mates for opposite sides', () => {
    expect(evalsAgree({ cp: null, mate: 3 }, { cp: null, mate: -3 })).toBe(false);
  });

  it('treats a mate claim and a centipawn claim as a genuine disagreement', () => {
    // A deeper search finding a forced mate is exactly what the challenger slot
    // is for — it should not silently overwrite, nor be silently discarded.
    expect(evalsAgree({ cp: 400, mate: null }, { cp: null, mate: 5 })).toBe(false);
  });

  it('disagrees when either side has no evaluation at all', () => {
    expect(evalsAgree({ cp: null, mate: null }, { cp: 30, mate: null })).toBe(false);
  });
});

describe('reconcileCacheWrite', () => {
  it('inserts when nothing is stored', () => {
    const d = reconcileCacheWrite(null, {
      depth: 20,
      evaluation: { cp: 30, mate: null },
      contributor: 'a:one',
    });
    expect(d).toEqual({ action: 'insert', confirmations: 1 });
  });

  it('confirms an agreeing write from a new contributor', () => {
    const d = reconcileCacheWrite(row(), {
      depth: 20,
      evaluation: { cp: 35, mate: null },
      contributor: 'a:two',
    });
    expect(d).toEqual({ action: 'confirm-primary', confirmations: 2, replaceData: false });
  });

  it('does not let one contributor confirm their own entry twice', () => {
    // Without this, poisoning costs one POST plus a retry.
    const d = reconcileCacheWrite(row(), {
      depth: 20,
      evaluation: { cp: 35, mate: null },
      contributor: 'a:one',
    });
    expect(d).toEqual({ action: 'ignore', reason: expect.any(String) });
  });

  it('lets the same contributor deepen their own entry without confirming it', () => {
    const d = reconcileCacheWrite(row(), {
      depth: 28,
      evaluation: { cp: 35, mate: null },
      contributor: 'a:one',
    });
    expect(d).toEqual({ action: 'confirm-primary', confirmations: 1, replaceData: true });
  });

  it('replaces the data when an agreeing write searched deeper', () => {
    const d = reconcileCacheWrite(row(), {
      depth: 30,
      evaluation: { cp: 35, mate: null },
      contributor: 'a:two',
    });
    expect(d).toEqual({ action: 'confirm-primary', confirmations: 2, replaceData: true });
  });

  it('never lets a shallower search replace deeper data', () => {
    const d = reconcileCacheWrite(row({ depth: 30 }), {
      depth: 14,
      evaluation: { cp: 35, mate: null },
      contributor: 'a:two',
    });
    expect(d).toMatchObject({ action: 'confirm-primary', replaceData: false });
  });

  it('sends a disagreeing write to the challenger slot when the primary is trusted', () => {
    const trusted = row({ confirmations: TRUST_THRESHOLD, contributors: ['a:one', 'a:two'] });
    const d = reconcileCacheWrite(trusted, {
      depth: 40,
      evaluation: { cp: 900, mate: null },
      contributor: 'a:three',
    });
    expect(d).toEqual({ action: 'set-challenger', confirmations: 1 });
  });

  it('never removes a trusted entry on the strength of one deep claim', () => {
    // `depth` is client-supplied and unverifiable, so if a deeper claim could
    // displace a trusted row, erasing the whole cache would be free.
    const trusted = row({ confirmations: 5, depth: 20 });
    const d = reconcileCacheWrite(trusted, {
      depth: 60,
      evaluation: { cp: -2000, mate: null },
      contributor: 'a:attacker',
    });
    expect(d.action).toBe('set-challenger');
  });

  it('lets a deeper write supersede an untrusted primary it disagrees with', () => {
    const d = reconcileCacheWrite(row({ confirmations: 1, depth: 18 }), {
      depth: 30,
      evaluation: { cp: 900, mate: null },
      contributor: 'a:two',
    });
    expect(d).toEqual({ action: 'supersede-primary', confirmations: 1 });
  });

  it('does not let a shallower write supersede even an untrusted primary', () => {
    const d = reconcileCacheWrite(row({ confirmations: 1, depth: 30 }), {
      depth: 14,
      evaluation: { cp: 900, mate: null },
      contributor: 'a:two',
    });
    expect(d.action).toBe('set-challenger');
  });

  it('promotes a challenger once a second independent submission backs it', () => {
    const trusted = row(
      { confirmations: 3, contributors: ['a:one', 'a:two', 'a:three'] },
      candidate({ depth: 30, evaluation: { cp: 900, mate: null }, contributors: ['a:four'] })
    );
    const d = reconcileCacheWrite(trusted, {
      depth: 32,
      evaluation: { cp: 910, mate: null },
      contributor: 'a:five',
    });
    expect(d).toEqual({ action: 'promote-challenger', confirmations: 2, useIncomingData: true });
  });

  it('keeps the challenger\u2019s own deeper numbers when the confirming write is shallower', () => {
    const trusted = row(
      { confirmations: 3 },
      candidate({ depth: 40, evaluation: { cp: 900, mate: null }, contributors: ['a:four'] })
    );
    const d = reconcileCacheWrite(trusted, {
      depth: 20,
      evaluation: { cp: 905, mate: null },
      contributor: 'a:five',
    });
    expect(d).toMatchObject({ action: 'promote-challenger', useIncomingData: false });
  });

  it('does not let one contributor confirm their own challenger', () => {
    const trusted = row(
      { confirmations: 3 },
      candidate({ depth: 30, evaluation: { cp: 900, mate: null }, contributors: ['a:four'] })
    );
    const d = reconcileCacheWrite(trusted, {
      depth: 30,
      evaluation: { cp: 905, mate: null },
      contributor: 'a:four',
    });
    expect(d).toEqual({ action: 'ignore', reason: expect.any(String) });
  });

  it('prefers agreement over depth when both a primary and a challenger are on file', () => {
    // A matching second opinion is worth more than a lone claim to have searched
    // further, so the agreement branch is checked first.
    const stored = row(
      { confirmations: 1, depth: 20, evaluation: { cp: 30, mate: null } },
      candidate({ depth: 25, evaluation: { cp: 900, mate: null }, contributors: ['a:four'] })
    );
    const d = reconcileCacheWrite(stored, {
      depth: 60,
      evaluation: { cp: 40, mate: null },
      contributor: 'a:five',
    });
    expect(d).toMatchObject({ action: 'confirm-primary', confirmations: 2 });
  });

  it('keeps the strongest dissent rather than the most recent one', () => {
    const stored = row(
      { confirmations: 4 },
      candidate({ depth: 40, evaluation: { cp: 900, mate: null }, contributors: ['a:four'] })
    );
    const shallowerThirdOpinion = reconcileCacheWrite(stored, {
      depth: 22,
      evaluation: { cp: -500, mate: null },
      contributor: 'a:five',
    });
    expect(shallowerThirdOpinion).toEqual({ action: 'ignore', reason: expect.any(String) });

    const deeperThirdOpinion = reconcileCacheWrite(stored, {
      depth: 48,
      evaluation: { cp: -500, mate: null },
      contributor: 'a:five',
    });
    expect(deeperThirdOpinion).toEqual({ action: 'set-challenger', confirmations: 1 });
  });

  it('still records a write when no contributor key is available', () => {
    // No salt configured: the write cannot be deduped, but discarding it would
    // silently disable the cache rather than degrade it.
    const d = reconcileCacheWrite(row({ depth: 20 }), {
      depth: 30,
      evaluation: { cp: 35, mate: null },
      contributor: null,
    });
    expect(d).toMatchObject({ action: 'confirm-primary', replaceData: true });
  });

  it('takes two independent writers to make a fresh position readable', () => {
    // The end-to-end property the whole design exists for.
    const first = reconcileCacheWrite(null, {
      depth: 22,
      evaluation: { cp: 30, mate: null },
      contributor: 'a:one',
    });
    expect(first).toMatchObject({ action: 'insert', confirmations: 1 });
    expect(1).toBeLessThan(TRUST_THRESHOLD); // still unreadable

    const second = reconcileCacheWrite(row({ depth: 22, confirmations: 1, contributors: ['a:one'] }), {
      depth: 22,
      evaluation: { cp: 40, mate: null },
      contributor: 'a:two',
    });
    expect(second).toMatchObject({ confirmations: TRUST_THRESHOLD });
  });
});

describe('mergeContributors', () => {
  it('appends a new contributor', () => {
    expect(mergeContributors(['a:one'], 'a:two')).toEqual(['a:one', 'a:two']);
  });

  it('does not duplicate an existing one', () => {
    expect(mergeContributors(['a:one'], 'a:one')).toEqual(['a:one']);
  });

  it('tolerates a null contributor', () => {
    expect(mergeContributors(['a:one'], null)).toEqual(['a:one']);
  });

  it('bounds the list so it cannot grow into a storage problem', () => {
    const many = Array.from({ length: MAX_CONTRIBUTORS + 4 }, (_, i) => `a:${i}`);
    const merged = mergeContributors(many, 'a:new');
    expect(merged).toHaveLength(MAX_CONTRIBUTORS);
    expect(merged.at(-1)).toBe('a:new');
  });
});

describe('constants', () => {
  it('sets a depth floor that a real review clears but a spam script does not bother with', () => {
    expect(MIN_CACHE_DEPTH).toBeGreaterThanOrEqual(12);
  });

  it('requires more than one submission before an entry is served', () => {
    expect(TRUST_THRESHOLD).toBeGreaterThan(1);
  });
});
