import { type Page, expect } from '@playwright/test';

/** react-chessboard v4 tags the board container with data-boardid (not id) and
 *  every square with data-square="<algebraic>". */
export const BOARD_SELECTOR = '[data-boardid="grandforge-board"]';

/**
 * Snapshot of the engine store, read live from the page. Used for deterministic,
 * tab-independent assertions about what the engine actually computed.
 */
export interface EngineSnapshot {
  hasManager: boolean;
  isLoading: boolean;
  isEnabled: boolean;
  isRunning: boolean;
  currentDepth: number;
  linesLen: number;
  analyzedFen: string | null;
  bestMoveUci: string | null;
  multiPV: number;
  depth: number;
  infiniteMode: boolean;
  evalFormatted: string;
}

export interface EngineLineSnapshot {
  multipv: number;
  rawCp: number | null;
  mate: number | null;
  firstMove: string;
}

/** Navigate to the app and wait until the board, the DEV store hooks, and the
 *  engine manager are all live. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator(BOARD_SELECTOR).first().waitFor({ state: 'visible' });
  // DEV test hooks (window.__*Store) are attached asynchronously in main.tsx.
  await page.waitForFunction(() => (window as unknown as { __grandforgeTestHooks?: boolean }).__grandforgeTestHooks === true, null, {
    timeout: 30_000,
  });
  // The engine boots via useStockfish (multi-second WASM load). Wait until the
  // manager exists and the initial load finished.
  await expect
    .poll(async () => (await engineSnapshot(page)).hasManager && !(await engineSnapshot(page)).isLoading, {
      timeout: 60_000,
      message: 'engine manager did not finish loading',
    })
    .toBe(true);
  // Explicitly (re)kick a search on the current position. Auto-analysis already
  // fires on mount; this one-shot supersede guarantees a search is in flight by
  // the time a test starts asserting, independent of mount timing.
  await page.evaluate(() => {
    const es = (window as unknown as { __engineStore: { getState: () => { isEnabled: boolean; currentFen: string; startAnalysis: (f: string) => void } } }).__engineStore.getState();
    if (es.isEnabled && es.currentFen) es.startAnalysis(es.currentFen);
  });
}

/** Read the engine store state from the running page. */
export async function engineSnapshot(page: Page): Promise<EngineSnapshot> {
  return page.evaluate(() => {
    const s = (window as unknown as { __engineStore: { getState: () => Record<string, unknown> } }).__engineStore.getState();
    return {
      hasManager: s.manager !== null && s.manager !== undefined,
      isLoading: Boolean(s.isLoading),
      isEnabled: Boolean(s.isEnabled),
      isRunning: Boolean(s.isRunning),
      currentDepth: Number(s.currentDepth ?? 0),
      linesLen: Array.isArray(s.lines) ? s.lines.length : 0,
      analyzedFen: typeof s.analyzedFen === 'string' ? s.analyzedFen : null,
      bestMoveUci: typeof s.bestMoveUci === 'string' ? s.bestMoveUci : null,
      multiPV: Number(s.multiPV ?? 0),
      depth: Number(s.depth ?? 0),
      infiniteMode: Boolean(s.infiniteMode),
      evalFormatted: String(s.evalFormatted ?? ''),
    };
  });
}

/** Minimal serializable engine-line data for board-arrow assertions. */
export async function engineLineSnapshot(page: Page): Promise<EngineLineSnapshot[]> {
  return page.evaluate(() => {
    const s = (window as unknown as { __engineStore: { getState: () => Record<string, unknown> } }).__engineStore.getState();
    const lines = Array.isArray(s.lines) ? s.lines : [];
    return lines.map((line) => {
      const l = line as Record<string, unknown>;
      const moves = Array.isArray(l.uciMoves) ? l.uciMoves : [];
      return {
        multipv: Number(l.multipv ?? 0),
        rawCp: typeof l.rawCp === 'number' ? l.rawCp : null,
        mate: typeof l.mate === 'number' ? l.mate : null,
        firstMove: typeof moves[0] === 'string' ? moves[0] : '',
      };
    });
  });
}

/** Make a legal move through the game store (deterministic — no pixel drag). */
export async function makeMove(page: Page, from: string, to: string, promotion?: string): Promise<boolean> {
  return page.evaluate(
    ({ from, to, promotion }) =>
      (window as unknown as { __gameStore: { getState: () => { makeMove: (m: unknown) => boolean } } }).__gameStore
        .getState()
        .makeMove({ from, to, promotion }),
    { from, to, promotion },
  );
}

/** Load a PGN through the game store. */
export async function loadPGN(page: Page, pgn: string): Promise<boolean> {
  return page.evaluate(
    (pgn) =>
      (window as unknown as { __gameStore: { getState: () => { loadPGN: (p: string) => boolean } } }).__gameStore
        .getState()
        .loadPGN(pgn),
    pgn,
  );
}

/** Call an engine-store setter by name with a single argument. */
export async function engineSet(page: Page, method: string, arg: unknown): Promise<void> {
  await page.evaluate(
    ({ method, arg }) => {
      const st = (window as unknown as { __engineStore: { getState: () => Record<string, (a: unknown) => void> } }).__engineStore.getState();
      st[method](arg);
    },
    { method, arg },
  );
}

/** Wait until the engine has produced a scored search at >= minDepth. If the
 *  engine is genuinely idle (depth 0 and not searching — e.g. a mount race
 *  dropped the auto-analysis), nudge it; an in-progress search (isRunning) is
 *  never interrupted, so this can't thrash a live search back to depth 0. */
export async function waitForEval(page: Page, minDepth = 6): Promise<void> {
  await expect
    .poll(
      async () => {
        const snap = await engineSnapshot(page);
        if (snap.currentDepth === 0 && !snap.isRunning && snap.hasManager && snap.isEnabled) {
          await page.evaluate(() => {
            const es = (window as unknown as { __engineStore: { getState: () => { currentFen: string; startAnalysis: (f: string) => void } } }).__engineStore.getState();
            if (es.currentFen) es.startAnalysis(es.currentFen);
          });
        }
        return (await engineSnapshot(page)).currentDepth;
      },
      {
        timeout: 60_000,
        intervals: [500, 1000, 1500, 2500],
        message: `engine never reached depth ${minDepth}`,
      },
    )
    .toBeGreaterThanOrEqual(minDepth);
}

/** Count rendered board arrow primitives. react-chessboard renders the arrow
 * SVG as a sibling of the `[data-boardid]` square grid, so the board root is
 * the square grid's parent. */
export async function renderedArrowParts(page: Page): Promise<number> {
  return page.evaluate((boardSel) => {
    const board = document.querySelector(boardSel);
    if (!board) return -1;
    const root = board.parentElement ?? board;
    let count = 0;
    for (const svg of root.querySelectorAll('svg')) {
      count += svg.querySelectorAll('line[marker-end], marker').length;
    }
    return count;
  }, BOARD_SELECTOR);
}

/** Rendered board arrow stroke colors from react-chessboard's arrow SVG. */
export async function renderedArrowStrokes(page: Page): Promise<string[]> {
  return page.evaluate((boardSel) => {
    const board = document.querySelector(boardSel);
    if (!board) return [];
    const root = board.parentElement ?? board;
    return [...root.querySelectorAll('line[marker-end]')]
      .map((line) => line.getAttribute('stroke') ?? '')
      .filter(Boolean);
  }, BOARD_SELECTOR);
}
