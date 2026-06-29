import { test, expect } from '@playwright/test';
import { gotoApp, makeMove, engineSnapshot, renderedArrowParts } from './helpers';

test('clears live engine arrows when Legal Mate finishes the game', async ({ page }) => {
  await gotoApp(page);

  const moves = [
    ['e2', 'e4'], ['e7', 'e5'],
    ['g1', 'f3'], ['b8', 'c6'],
    ['b1', 'c3'], ['d7', 'd6'],
    ['f1', 'c4'], ['c8', 'g4'],
    ['h2', 'h3'], ['g4', 'h5'],
    ['f3', 'e5'], ['h5', 'd1'],
    ['c4', 'f7'], ['e8', 'e7'],
  ] as const;

  for (const [from, to] of moves) {
    expect(await makeMove(page, from, to)).toBe(true);
    await page.waitForTimeout(250);
  }

  await expect.poll(async () => renderedArrowParts(page), { timeout: 30_000 }).toBeGreaterThan(0);

  expect(await makeMove(page, 'c3', 'd5')).toBe(true);

  await expect.poll(async () => renderedArrowParts(page), { timeout: 10_000 }).toBe(0);

  const state = await engineSnapshot(page);
  expect(state.isRunning).toBe(false);
  expect(state.bestMoveUci).toBeNull();
  expect(state.analyzedFen).toBeNull();
  expect(state.linesLen).toBe(0);
});
