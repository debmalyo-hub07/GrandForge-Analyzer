/**
 * DEV-only test hooks. Exposes the zustand stores on `window` so Playwright E2E
 * tests can drive deterministic moves/loads without pixel-dragging the board.
 *
 * This module is imported ONLY via `if (import.meta.env.DEV) import('./devHooks')`
 * in main.tsx, so the production build's `if (false)` drops the dynamic import
 * and excludes this file (and the `window.__*` assignments) from the bundle
 * entirely.
 */
import { useGameStore } from './store/gameStore';
import { useEngineStore } from './store/engineStore';
import { useReviewStore } from './store/reviewStore';
import { useUIStore } from './store/uiStore';

const w = window as unknown as Record<string, unknown>;
w.__gameStore = useGameStore;
w.__engineStore = useEngineStore;
w.__reviewStore = useReviewStore;
w.__uiStore = useUIStore;
w.__grandforgeTestHooks = true;
