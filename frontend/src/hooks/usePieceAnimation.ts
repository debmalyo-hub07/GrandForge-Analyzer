import { useEffect, useState } from 'react';
import { useUIStore } from '../store/uiStore';

/**
 * Effective piece-glide duration in ms.
 *
 * `prefers-reduced-motion: reduce` is an accessibility signal, not a hint, so it
 * OVERRIDES the stored preference rather than seeding it — a user who set the OS
 * flag for vestibular reasons must not have to find an in-app toggle too. The
 * stored value is left untouched, so unsetting the OS flag restores their choice.
 *
 * The listener means a mid-session change to the OS setting takes effect without
 * a reload, which is how the flag behaves in system accessibility panels.
 */
export function usePieceAnimation(): number {
  const stored = useUIStore((s) => s.pieceAnimationMs);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    // addEventListener on MediaQueryList is unavailable on older WebKit, where
    // addListener is the only option. Without the fallback the hook throws on
    // those browsers and takes the board down with it.
    if (query.addEventListener) {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  if (reduceMotion) return 0;
  // `?? 200` covers a hydrated blob from before the v5 migration; 0 is a real
  // value (animation off) so `||` would wrongly promote it to the default.
  return stored ?? 200;
}

export default usePieceAnimation;
