import { test, expect } from '@playwright/test';
import { gotoApp, engineSnapshot, makeMove, waitForEval } from './helpers';

/**
 * Live analysis always uses Stockfish's `go infinite`. There is no user mode
 * switch; depth climbing past the old fixed cap while still running proves the
 * default path is infinite.
 */
test.describe('infinite analysis', () => {
  test('is the default mode and keeps running until stopped', async ({ page }) => {
    await gotoApp(page);

    await expect(page.getByTestId('infinite-toggle')).toHaveCount(0);
    await expect.poll(async () => (await engineSnapshot(page)).infiniteMode, { timeout: 10_000 }).toBe(true);

    await makeMove(page, 'e2', 'e4');

    const oldFixedCap = (await engineSnapshot(page)).depth;
    await waitForEval(page, oldFixedCap + 3);

    expect((await engineSnapshot(page)).isRunning).toBe(true);

    await page.getByTestId('analysis-stop').click();
    await expect.poll(async () => (await engineSnapshot(page)).isRunning, { timeout: 20_000 }).toBe(false);

    await page.getByTestId('analysis-resume').click();
    await expect.poll(async () => (await engineSnapshot(page)).isRunning, { timeout: 20_000 }).toBe(true);
  });
});
