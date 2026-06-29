import { useEffect, useState } from 'react';
import { useEngineStore } from '../store/engineStore';
import type { EngineVersion } from '../services/EngineManager';

interface UseStockfishOptions {
  defaultEngine?: EngineVersion;
}

export function useStockfish(options: UseStockfishOptions = {}) {
  const { defaultEngine = 'sf18-lite' } = options;
  const initEngine = useEngineStore((s) => s.initEngine);
  const manager = useEngineStore((s) => s.manager);
  const isLoading = useEngineStore((s) => s.isLoading);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const localManager = await initEngine(defaultEngine);
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
      useEngineStore.getState().manager?.terminate();
    };
  }, [defaultEngine, initEngine]);

  return { isReady: isReady && !isLoading, manager, error };
}
