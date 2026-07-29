import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CHECKPOINT_VERSION,
  serializeNode,
  deserializeNode,
  writeCheckpoint,
  readCheckpoint,
  readState,
  writeState,
  foldInto,
  emptyAgg,
  type IngestState,
} from './checkpoint';
import type { AggNode, FenAccumulator } from './resolve';

const dirs: string[] = [];

function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gf-ckpt-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fully-populated node: every field non-default, so a dropped field shows up. */
function richNode(): AggNode {
  const agg = emptyAgg(3);
  agg.total = 17;
  agg.white = 8;
  agg.draws = 5;
  agg.black = 4;
  agg.eloSum = 46_200;
  agg.eloGames = 9;
  agg.moves.set('e2e4', { uci: 'e2e4', san: 'e4', total: 10, white: 5, draws: 3, black: 2 });
  agg.moves.set('g7g8q', { uci: 'g7g8q', san: 'g8=Q+', total: 7, white: 3, draws: 2, black: 2 });
  agg.topGames.push(
    { white: 'Ana Müller-Ø', black: '李雲', whiteElo: 2712, blackElo: 2688, result: '1-0', year: 2021 },
    { white: 'A. B', black: 'C. D', whiteElo: 2500, blackElo: 2490, result: '1/2-1/2', year: 1997 },
  );
  return agg;
}

describe('serializeNode / deserializeNode', () => {
  it('round-trips every field losslessly', () => {
    const agg = richNode();
    const { fen, agg: back } = deserializeNode(serializeNode('fen-a', agg));

    expect(fen).toBe('fen-a');
    expect(back.total).toBe(17);
    expect(back.white).toBe(8);
    expect(back.draws).toBe(5);
    expect(back.black).toBe(4);
    expect(back.eloSum).toBe(46_200);
    expect(back.eloGames).toBe(9);
    expect(back.minPly).toBe(3);
    expect([...back.moves.keys()]).toEqual(['e2e4', 'g7g8q']);
    expect(back.moves.get('g7g8q')).toEqual({
      uci: 'g7g8q', san: 'g8=Q+', total: 7, white: 3, draws: 2, black: 2,
    });
    expect(back.topGames).toEqual(agg.topGames);
  });

  it('preserves promotion UCIs and non-ASCII player names', () => {
    const { agg } = deserializeNode(serializeNode('fen-a', richNode()));
    expect(agg.moves.has('g7g8q')).toBe(true);
    expect(agg.topGames[0].white).toBe('Ana Müller-Ø');
    expect(agg.topGames[0].black).toBe('李雲');
  });

  it('emits exactly one line per node (no embedded newlines)', () => {
    const line = serializeNode('fen-a', richNode());
    expect(line).not.toContain('\n');
  });

  it('tolerates a node with no moves and no top games', () => {
    const { agg } = deserializeNode(serializeNode('fen-a', emptyAgg(0)));
    expect(agg.moves.size).toBe(0);
    expect(agg.topGames).toEqual([]);
    expect(agg.minPly).toBe(0);
  });

  it('defaults absent move/game arrays rather than throwing', () => {
    const { agg } = deserializeNode(
      JSON.stringify({ f: 'fen-a', t: 1, w: 1, d: 0, b: 0, es: 0, eg: 0, p: 0 })
    );
    expect(agg.moves.size).toBe(0);
    expect(agg.topGames).toEqual([]);
  });
});

describe('writeCheckpoint / readCheckpoint', () => {
  it('round-trips an accumulator through the file', async () => {
    const path = join(workDir(), 'ckpt.ndjson');
    const acc: FenAccumulator = new Map([
      ['fen-a', richNode()],
      ['fen-b', emptyAgg(1)],
    ]);
    acc.get('fen-b')!.total = 4;

    await writeCheckpoint(path, acc);
    const back = await readCheckpoint(path);

    expect(back.size).toBe(2);
    expect(back.get('fen-a')!.total).toBe(17);
    expect(back.get('fen-a')!.moves.size).toBe(2);
    expect(back.get('fen-b')!.total).toBe(4);
  });

  it('writes one NDJSON line per position', async () => {
    const path = join(workDir(), 'ckpt.ndjson');
    const acc: FenAccumulator = new Map([
      ['fen-a', richNode()],
      ['fen-b', emptyAgg(1)],
      ['fen-c', emptyAgg(2)],
    ]);

    await writeCheckpoint(path, acc);
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
  });

  it('leaves no .tmp file behind after a successful write', async () => {
    const dir = workDir();
    const path = join(dir, 'ckpt.ndjson');
    await writeCheckpoint(path, new Map([['fen-a', emptyAgg(0)]]));
    // The atomic rename must consume the temp file, otherwise a later crash
    // could resume from a half-written shadow copy.
    expect(() => readFileSync(`${path}.tmp`, 'utf8')).toThrow();
  });

  it('survives a large accumulator (exercises the drain path)', async () => {
    const path = join(workDir(), 'ckpt.ndjson');
    const acc: FenAccumulator = new Map();
    for (let i = 0; i < 5_000; i++) {
      const agg = emptyAgg(i % 20);
      agg.total = i + 1;
      acc.set(`fen-${i}`, agg);
    }
    await writeCheckpoint(path, acc);
    const back = await readCheckpoint(path);
    expect(back.size).toBe(5_000);
    expect(back.get('fen-4999')!.total).toBe(5_000);
  });

  it('returns an empty accumulator for a missing file', async () => {
    const back = await readCheckpoint(join(workDir(), 'nope.ndjson'));
    expect(back.size).toBe(0);
  });

  it('skips a torn final line instead of aborting the resume', async () => {
    const path = join(workDir(), 'ckpt.ndjson');
    const acc: FenAccumulator = new Map([['fen-a', richNode()]]);
    await writeCheckpoint(path, acc);
    // Simulate a kill mid-write: a truncated JSON object as the last line.
    appendFileSync(path, '{"f":"fen-b","t":4,"w":2,"d', 'utf8');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const back = await readCheckpoint(path);

    expect(back.size).toBe(1);
    expect(back.get('fen-a')!.total).toBe(17);
    expect(warn).toHaveBeenCalled();
  });

  it('merges duplicate FENs appearing on separate lines', async () => {
    const path = join(workDir(), 'ckpt.ndjson');
    const first = emptyAgg(4);
    first.total = 3;
    first.white = 2;
    first.draws = 1;
    first.moves.set('e2e4', { uci: 'e2e4', san: 'e4', total: 3, white: 2, draws: 1, black: 0 });

    const second = emptyAgg(2);
    second.total = 5;
    second.black = 5;
    second.moves.set('d2d4', { uci: 'd2d4', san: 'd4', total: 5, white: 0, draws: 0, black: 5 });

    writeFileSync(
      path,
      `${serializeNode('fen-dup', first)}\n${serializeNode('fen-dup', second)}\n`,
      'utf8'
    );

    const back = await readCheckpoint(path);
    expect(back.size).toBe(1);
    const merged = back.get('fen-dup')!;
    expect(merged.total).toBe(8);
    expect(merged.white).toBe(2);
    expect(merged.draws).toBe(1);
    expect(merged.black).toBe(5);
    expect(merged.minPly).toBe(2);
    expect([...merged.moves.keys()].sort()).toEqual(['d2d4', 'e2e4']);
  });

  it('ignores blank lines', async () => {
    const path = join(workDir(), 'ckpt.ndjson');
    writeFileSync(path, `\n${serializeNode('fen-a', emptyAgg(0))}\n\n`, 'utf8');
    const back = await readCheckpoint(path);
    expect(back.size).toBe(1);
  });
});

describe('readState / writeState', () => {
  const state: IngestState = {
    version: CHECKPOINT_VERSION,
    completed: ['a.pgn:123', 'b.pgn:456'],
    maxPlies: 20,
    minGames: 8,
  };

  it('round-trips state', () => {
    const path = join(workDir(), 'state.json');
    writeState(path, state);
    expect(readState(path)).toEqual(state);
  });

  it('returns null for a missing file', () => {
    expect(readState(join(workDir(), 'nope.json'))).toBeNull();
  });

  it('returns null on a version mismatch', () => {
    const path = join(workDir(), 'state.json');
    writeState(path, { ...state, version: CHECKPOINT_VERSION + 1 });
    // A format change must invalidate the checkpoint rather than resume into it
    // with the wrong reader.
    expect(readState(path)).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    const path = join(workDir(), 'state.json');
    writeFileSync(path, '{ not json', 'utf8');
    expect(readState(path)).toBeNull();
  });
});

describe('foldInto', () => {
  it('adds new positions and merges shared ones', () => {
    const global: FenAccumulator = new Map();
    const a = emptyAgg(3);
    a.total = 2;
    a.white = 2;
    global.set('fen-a', a);

    const month: FenAccumulator = new Map();
    const aAgain = emptyAgg(1);
    aAgain.total = 5;
    aAgain.black = 5;
    month.set('fen-a', aAgain);
    const b = emptyAgg(6);
    b.total = 1;
    month.set('fen-b', b);

    foldInto(global, month);

    expect(global.size).toBe(2);
    expect(global.get('fen-a')!.total).toBe(7);
    expect(global.get('fen-a')!.white).toBe(2);
    expect(global.get('fen-a')!.black).toBe(5);
    expect(global.get('fen-a')!.minPly).toBe(1);
    expect(global.get('fen-b')!.total).toBe(1);
  });

  it('is additive across repeated folds (six months of the same line)', () => {
    const global: FenAccumulator = new Map();
    for (let i = 0; i < 6; i++) {
      const month: FenAccumulator = new Map();
      const agg = emptyAgg(5);
      agg.total = 3;
      agg.draws = 3;
      month.set('fen-a', agg);
      foldInto(global, month);
    }
    // 3 games a month over 6 months is 18 games globally — the whole reason the
    // min-games threshold is applied to the global accumulator, not per file.
    expect(global.get('fen-a')!.total).toBe(18);
    expect(global.get('fen-a')!.draws).toBe(18);
  });

  it('adopts a brand-new position by reference rather than deep-copying it', () => {
    const global: FenAccumulator = new Map();
    const month: FenAccumulator = new Map();
    const agg = emptyAgg(2);
    agg.total = 4;
    month.set('fen-a', agg);

    foldInto(global, month);

    // Deliberate: the month accumulator is dropped immediately after the fold,
    // so adopting its nodes avoids copying millions of objects. This test pins
    // that intent — if a caller ever keeps using a month map after folding, it
    // has to copy first.
    expect(global.get('fen-a')).toBe(agg);
  });
});
