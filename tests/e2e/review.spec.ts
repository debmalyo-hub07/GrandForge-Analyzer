import { test, expect } from '@playwright/test';
import { gotoApp, loadPGN } from './helpers';

/**
 * End-to-end game review: loads a short game and runs the full review pipeline
 * (cache → tablebase → Stockfish WASM). In this env the /api cache is
 * unreachable, so every ply resolves via the in-browser engine — exactly the
 * fallback path that must work offline. Asserts per-player accuracy is produced.
 */
test.describe('game review', () => {
  test('reviews a short game and reports accuracy', async ({ page }) => {
    test.setTimeout(180_000);
    await gotoApp(page);

    const ok = await loadPGN(page, '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6');
    expect(ok).toBe(true);

    // Open the Review tab and start the review at the default depth. The idle
    // hero button is labelled "Run Review" (the "Run review at d…" label only
    // appears on the post-result re-run button).
    await page.getByRole('tab', { name: /review/i }).click();
    const runBtn = page.getByRole('button', { name: /^run review$/i });
    await runBtn.waitFor({ state: 'visible' });
    await expect(runBtn).toBeEnabled({ timeout: 60_000 });
    await runBtn.click();

    // Wait for the pipeline to finish.
    await expect
      .poll(
        async () =>
          page.evaluate(
            () =>
              (window as unknown as { __reviewStore: { getState: () => { progress: { phase: string } } } }).__reviewStore.getState()
                .progress.phase,
          ),
        { timeout: 170_000, message: 'review never reached phase=complete' },
      )
      .toBe('complete');

    // Result object carries a per-player accuracy in [0,100].
    const accuracies = await page.evaluate(() => {
      const r = (window as unknown as { __reviewStore: { getState: () => { result: unknown } } }).__reviewStore.getState().result as
        | Record<string, { accuracy?: number }>
        | null;
      if (!r) return null;
      const white = r.white?.accuracy;
      const black = r.black?.accuracy;
      return { white, black };
    });
    expect(accuracies, 'review result missing').not.toBeNull();
    expect(typeof accuracies!.white).toBe('number');
    expect(typeof accuracies!.black).toBe('number');
    expect(accuracies!.white!).toBeGreaterThanOrEqual(0);
    expect(accuracies!.white!).toBeLessThanOrEqual(100);

    // Summary card renders the accuracy in the DOM.
    await expect(page.locator('.accuracy-value').first()).toBeVisible();
  });
});
