import { test, expect } from '@playwright/test';
import { gotoApp, engineSnapshot, makeMove, engineSet, waitForEval, renderedArrowParts, renderedArrowStrokes, engineLineSnapshot } from './helpers';

const WIN_SLOPE = 0.00368208;
const ENGINE_ARROW_MAX_DELTA_WIN = 0.05;

function cpAndMateToWin(cp: number | null, mate: number | null): number {
  if (mate !== null) {
    if (mate > 0) return 1;
    return 0;
  }
  const c = cp ?? 0;
  return 0.5 + 0.5 * (2 / (1 + Math.exp(-WIN_SLOPE * c)) - 1);
}

function expectedLiveArrowCount(lines: Awaited<ReturnType<typeof engineLineSnapshot>>, fen: string): number {
  const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const moverScore = (line: (typeof lines)[number]) => ({
    cp: line.rawCp === null ? null : turn === 'b' ? -line.rawCp : line.rawCp,
    mate: line.mate === null ? null : turn === 'b' ? -line.mate : line.mate,
  });
  const ranked = lines
    .filter((line) => line.firstMove.length >= 4)
    .slice()
    .sort((a, b) => a.multipv - b.multipv)
    .slice(0, 5);
  const best = ranked.find((line) => line.multipv === 1) ?? ranked[0];
  if (!best) return 0;

  const bestScore = moverScore(best);
  const selected = ranked.filter((line) => {
    if (line.multipv === best.multipv) return true;
    const lineScore = moverScore(line);
    if (line.rawCp === null && line.mate === null) return false;
    if (best.rawCp === null && best.mate === null) return false;
    if (bestScore.mate !== null && bestScore.mate > 0) {
      return lineScore.mate !== null && lineScore.mate > 0 && lineScore.mate <= Math.abs(bestScore.mate) + 2;
    }
    return cpAndMateToWin(bestScore.cp, bestScore.mate) - cpAndMateToWin(lineScore.cp, lineScore.mate) <= ENGINE_ARROW_MAX_DELTA_WIN;
  });

  return new Set(selected.map((line) => line.firstMove.slice(0, 4))).size;
}

test.describe('live analysis', () => {
  test('analyzes the start position with multi-PV lines', async ({ page }) => {
    await gotoApp(page);

    await expect(page.getByTestId('infinite-toggle')).toHaveCount(0);
    await expect(page.getByText(/^Depth$/)).toHaveCount(0);
    await expect(page.getByText(/^Move time$/)).toHaveCount(0);
    await expect.poll(async () => (await engineSnapshot(page)).infiniteMode, { timeout: 10_000 }).toBe(true);

    await waitForEval(page, 12);
    await expect.poll(async () => (await engineSnapshot(page)).linesLen, { timeout: 20_000 }).toBe(3);

    const snap = await engineSnapshot(page);
    expect(snap.isEnabled).toBe(true);
    expect(snap.linesLen).toBe(snap.multiPV);

    const strokes = await renderedArrowStrokes(page);
    expect(strokes.length).toBeGreaterThan(0);
    expect(new Set(strokes)).toEqual(new Set(['#16a34a80']));

    const label = (await page.locator('.eval-label').first().textContent())?.trim() ?? '';
    expect(label).toMatch(/^[+\-]?\d|^M|^#|^0\.00$/);
  });

  test('re-analyzes after a move', async ({ page }) => {
    await gotoApp(page);
    await waitForEval(page, 10);

    const ok = await makeMove(page, 'e2', 'e4');
    expect(ok).toBe(true);

    await waitForEval(page, 12);
    await expect.poll(async () => {
      const snap = await engineSnapshot(page);
      return snap.linesLen === snap.multiPV ? snap.linesLen : 0;
    }, { timeout: 20_000 }).toBe(3);
  });

  test('clears engine arrows and analyzed FEN on terminal imported PGN', async ({ page }) => {
    await gotoApp(page);

    await expect.poll(async () => renderedArrowParts(page), { timeout: 30_000 }).toBeGreaterThan(0);

    const ok = await page.evaluate(() =>
      (window as unknown as { __gameStore: { getState: () => { loadPGN: (p: string) => boolean } } }).__gameStore
        .getState()
        .loadPGN('1. e4 e5 2. Nf3 Nc6 3. Nc3 d6 4. Bc4 Bg4 5. h3 Bh5 6. Nxe5 Bxd1 7. Bxf7+ Ke7 8. Nd5#'),
    );
    expect(ok).toBe(true);

    await expect.poll(async () => renderedArrowParts(page), { timeout: 10_000 }).toBe(0);

    const snap = await engineSnapshot(page);
    expect(snap.isRunning).toBe(false);
    expect(snap.analyzedFen).toBeNull();
    expect(snap.bestMoveUci).toBeNull();
    expect(snap.linesLen).toBe(0);
  });

  test('MultiPV control changes the number of lines', async ({ page }) => {
    await gotoApp(page);
    await waitForEval(page, 10);

    await engineSet(page, 'setMultiPV', 5);
    await expect.poll(async () => (await engineSnapshot(page)).linesLen, { timeout: 40_000 }).toBe(5);

    const expectedArrowCount = expectedLiveArrowCount(
      await engineLineSnapshot(page),
      await page.evaluate(() =>
        (window as unknown as { __gameStore: { getState: () => { currentFen: string } } }).__gameStore.getState().currentFen,
      ),
    );
    const strokes = await renderedArrowStrokes(page);
    expect(strokes.length).toBe(expectedArrowCount);
    expect(strokes.length).toBeLessThanOrEqual(5);
    expect(new Set(strokes)).toEqual(new Set(['#16a34a80']));

    await engineSet(page, 'setMultiPV', 1);
    await expect.poll(async () => (await engineSnapshot(page)).linesLen, { timeout: 40_000 }).toBe(1);
  });
});
