import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { toBase64 } from './pdfs';

/** Chromium-made PDF with Latin, Devanagari and Arabic paragraphs (tests/fixtures/pdfs). */
const chromiumPdf = new Uint8Array(readFileSync(fileURLToPath(new URL('../tests/fixtures/pdfs/chromium.pdf', import.meta.url))));

test('text in scripts the editor cannot write yet is locked, and says why', async ({ page }) => {
  await page.goto('/e2e/harness.html');
  await page.waitForFunction(() => typeof window.loadPdf === 'function');
  await page.evaluate((b64) => window.loadPdf(b64), toBase64(chromiumPdf));
  await expect(page.locator('.rpe-page canvas').first()).toBeVisible();
  await page.getByTitle('Edit text').click();

  const scriptLocked = page.locator('.rpe-block.is-locked[title="Text in this script can\'t be edited yet"]');
  // Devanagari and Arabic.
  await expect(scriptLocked).toHaveCount(2);

  const box = page.getByRole('textbox', { name: 'Edit text' });
  await scriptLocked.first().click();
  await expect(box).toBeHidden();

  // Latin paragraphs on the same page still open for editing.
  await page.locator('.rpe-block:not(.is-locked)').first().click();
  await expect(box).toBeVisible();
  await expect(box).toHaveText('Alpha serif regular text here');
});
