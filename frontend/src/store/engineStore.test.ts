import { beforeEach, describe, expect, it } from 'vitest';
import { ENGINE_CONFIGS, type EngineVersion } from '../services/EngineManager';

// vitest runs in the node env, so the real Worker/WASM engine is unavailable —
// these cover the pure store shape and the persist config only. zustand's
// persist middleware skips installing its api entirely when no storage exists,
// so an in-memory localStorage must be in place BEFORE the store module is
// evaluated; hence the dynamic import below.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const { useEngineStore } = await import('./engineStore');

describe('engineStore default state', () => {
  beforeEach(() => {
    useEngineStore.setState({ engineError: null });
  });

  it('starts with no engine error', () => {
    expect(useEngineStore.getState().engineError).toBeNull();
  });

  it('exposes a retry action for a failed load', () => {
    expect(typeof useEngineStore.getState().retryEngineInit).toBe('function');
  });

  it('defaults to an engine id that exists in ENGINE_CONFIGS', () => {
    const v = useEngineStore.getState().engineVersion;
    expect(ENGINE_CONFIGS[v]).toBeDefined();
  });
});

describe('engineStore persistence config', () => {
  // zustand exposes the resolved persist options on the store api.
  const persistApi = (useEngineStore as unknown as {
    persist: {
      getOptions: () => {
        version?: number;
        partialize?: (s: unknown) => Record<string, unknown>;
        migrate?: (persisted: unknown, from: number) => Record<string, unknown>;
      };
    };
  }).persist;

  it('partialize keeps runtime-only fields out of localStorage', () => {
    const { partialize } = persistApi.getOptions();
    expect(partialize).toBeTypeOf('function');
    const persisted = partialize!(useEngineStore.getState());
    expect(Object.keys(persisted).sort()).toEqual([
      'depth',
      'engineSettings',
      'engineVersion',
      'multiPV',
    ]);
    // engineError is a transient UI concern — persisting it would resurrect a
    // stale "engine failed" banner on every future page load.
    expect(persisted).not.toHaveProperty('engineError');
    expect(persisted).not.toHaveProperty('manager');
    expect(persisted).not.toHaveProperty('adapter');
    expect(persisted).not.toHaveProperty('lines');
  });

  it('migrate normalizes an engineVersion naming a removed engine', () => {
    const { migrate } = persistApi.getOptions();
    expect(migrate).toBeTypeOf('function');
    // 'sf18-full' was dropped; EngineVersionSelector dereferences the id during
    // render, so leaving it in place crashed the page before initEngine's own
    // fallback could run.
    expect(migrate!({ engineVersion: 'sf18-full' }, 3).engineVersion).toBe('sf18-lite');
    expect(migrate!({}, 3).engineVersion).toBe('sf18-lite');
    expect(migrate!({ engineVersion: 42 }, 3).engineVersion).toBe('sf18-lite');
  });

  it('migrate preserves a still-valid engineVersion', () => {
    const { migrate } = persistApi.getOptions();
    for (const v of Object.keys(ENGINE_CONFIGS) as EngineVersion[]) {
      expect(migrate!({ engineVersion: v }, 3).engineVersion).toBe(v);
    }
  });

  it('migrate runs for blobs written at the previous version', () => {
    const { version } = persistApi.getOptions();
    // Bumped past 3 so the engineVersion normalization actually reaches users
    // whose blob was already at 3 (zustand skips migrate at the same version).
    expect(version).toBeGreaterThan(3);
  });
});
