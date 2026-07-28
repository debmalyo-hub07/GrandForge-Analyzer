import { useEffect, useState } from 'react';
import { useEngineStore } from '../store/engineStore';
import type { EngineManager, EngineVersion } from '../services/EngineManager';

interface UseStockfishOptions {
  /** Force a specific build. Omit it (the normal case) so `initEngine` falls
   *  back to the hydrated `engineVersion` — passing a literal here made the
   *  persisted choice unreachable AND overwrote it with the literal on every
   *  boot, so picking SF16 never survived a reload. */
  defaultEngine?: EngineVersion;
}

export function useStockfish(options: UseStockfishOptions = {}) {
  const { defaultEngine } = options;
  const initEngine = useEngineStore((s) => s.initEngine);
  const manager = useEngineStore((s) => s.manager);
  const isLoading = useEngineStore((s) => s.isLoading);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: EngineManager | null = null;
    (async () => {
      try {
        const localManager = await initEngine(defaultEngine);
        created = localManager;
        if (cancelled) {
          // Unmounted during the (potentially multi-second) WASM load. initEngine
          // has now written the manager into the store, but our cleanup already
          // ran and saw a null manager — so terminate the orphaned worker here.
          localManager?.terminate();
          return;
        }
        setIsReady(true);
      } catch (err) {
        console.error('GrandForge useStockfish: failed to init engine', err);
        if (!cancelled) {
          setIsReady(false);
          setError(err instanceof Error ? err.message : 'Failed to load engine');
        }
      }
    })();
    return () => {
      cancelled = true;
      // Terminate the manager if it's already in the store. If init is still
      // mid-load, the orphan-termination branch above handles it once it lands.
      const published = useEngineStore.getState().manager;
      const target = created ?? published;
      target?.terminate();
      // Never leave a terminated manager in the store: every downstream guard
      // checks only for presence, so startAnalysis would set isRunning:true and
      // then silently no-op inside send() — "Searching – depth N" forever.
      if (published !== null && published === target) {
        useEngineStore.setState({ manager: null, adapter: null, isRunning: false });
      }
    };
  }, [defaultEngine, initEngine]);

  return { isReady: isReady && !isLoading, manager, error };
}
