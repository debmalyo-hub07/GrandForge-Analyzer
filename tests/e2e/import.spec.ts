import { test, expect } from '@playwright/test';
import { gotoApp, engineSnapshot, renderedArrowParts } from './helpers';

test.describe('game import', () => {
  test('loads a terminal PGN through the import UI without leaving engine arrows', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (text.includes('Failed to load resource') && text.includes('500')) return;
      pageErrors.push(text);
    });

    await gotoApp(page);
    await expect.poll(async () => renderedArrowParts(page), { timeout: 30_000 }).toBeGreaterThan(0);

    await page.getByRole('tab', { name: /^import$/i }).click();
    await page.getByRole('tab', { name: /^pgn$/i }).click();

    await page.locator('.pgn-import-textarea').fill(
      '1. e4 e5 2. Nf3 Nc6 3. Nc3 d6 4. Bc4 Bg4 5. h3 Bh5 6. Nxe5 Bxd1 7. Bxf7+ Ke7 8. Nd5#',
    );
    await page.getByRole('button', { name: /^load pgn$/i }).click();

    await expect.poll(async () => renderedArrowParts(page), { timeout: 10_000 }).toBe(0);

    const snap = await engineSnapshot(page);
    expect(snap.isRunning).toBe(false);
    expect(snap.analyzedFen).toBeNull();
    expect(snap.bestMoveUci).toBeNull();
    expect(snap.linesLen).toBe(0);

    const fen = await page.evaluate(() =>
      (window as unknown as { __gameStore: { getState: () => { currentFen: string } } }).__gameStore.getState().currentFen,
    );
    expect(fen).toContain(' b ');

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('loads a FEN through the import UI and starts analysis for non-terminal positions', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await gotoApp(page);

    await page.getByRole('tab', { name: /^import$/i }).click();
    await page.getByRole('tab', { name: /^fen$/i }).click();
    await page.getByRole('textbox', { name: /^fen$/i }).fill('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2');
    await page.getByRole('button', { name: /^load position$/i }).click();

    await expect.poll(async () => {
      const snap = await engineSnapshot(page);
      return snap.linesLen;
    }, { timeout: 40_000 }).toBeGreaterThan(0);

    const snap = await engineSnapshot(page);
    expect(snap.analyzedFen).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2');
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});
