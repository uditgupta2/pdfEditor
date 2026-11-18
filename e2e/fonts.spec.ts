import { expect, test, type Page } from '@playwright/test';
import { embeddedFontCount, fromBase64, helveticaPdf, pageText, readRuns, subsetFontPdf, toBase64 } from './pdfs';

async function openPdf(page: Page, bytes: Uint8Array) {
  await page.goto('/e2e/harness.html');
  await page.waitForFunction(() => typeof window.loadPdf === 'function');
  await page.evaluate((b64) => window.loadPdf(b64), toBase64(bytes));
  await expect(page.locator('.rpe-page canvas').first()).toBeVisible();
  expect(await page.evaluate(() => window.editorError)).toBeNull();
}

/** Turn on edit mode and open the inline editor on the paragraph that reads `text`. */
async function editParagraph(page: Page, text: string) {
  await page.getByTitle('Edit text').click();
  const blocks = page.locator('.rpe-block');
  await expect(blocks.first()).toBeVisible();
  const box = page.getByRole('textbox', { name: 'Edit text' });
  for (let i = 0; i < (await blocks.count()); i++) {
    await blocks.nth(i).click();
    await expect(box).toBeVisible();
    if ((await box.innerText()).trim() === text) return box;
    await box.press('Escape');
  }
  throw new Error(`no paragraph reads "${text}"`);
}

/** Commit the inline edit by clicking outside the editor, save, and return the saved PDF. */
async function commitAndSave(page: Page) {
  await page.locator('#outside').click();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeHidden();
  const before = await page.evaluate(() => window.savedPdfs.length);
  await page.getByTitle('Save changes (Ctrl+S)').click();
  await page.waitForFunction((n) => window.savedPdfs.length > n, before);
  return fromBase64(await page.evaluate(() => window.savedPdfs[window.savedPdfs.length - 1]!));
}

const fontPicker = (page: Page) => page.getByRole('combobox', { name: 'Font', exact: true });

test.describe('editing in the original font', () => {
  test('writes edited text with the page font itself, embedding nothing new', async ({ page }) => {
    const input = await subsetFontPdf();
    await openPdf(page, input);
    const box = await editParagraph(page, 'Hello world');
    await expect(fontPicker(page)).toHaveValue(/^pdf:/);

    await box.press('ControlOrMeta+a');
    await box.pressSequentially('Hello there');
    const saved = await commitAndSave(page);

    const runs = await readRuns(saved);
    // The edited paragraph is drawn after the untouched text, so check each separately.
    expect(pageText(runs)).toContain('Hellothere');
    expect(pageText(runs)).toContain('Boldline');
    expect(pageText(runs)).not.toContain('world');
    for (const r of runs.filter((r) => /Hello|there/.test(r.text))) expect(r.font).toBe('LiberationSans');
    expect(await embeddedFontCount(saved)).toBe(await embeddedFontCount(input));
  });

  test('sets characters the subset lacks in a stand-in, one by one', async ({ page }) => {
    await openPdf(page, await subsetFontPdf());
    const box = await editParagraph(page, 'Hello world');
    await box.press('ControlOrMeta+a');
    // Z and q are not in the subset; the rest are.
    await box.pressSequentially('Hello Zeq');
    const saved = await commitAndSave(page);

    const runs = await readRuns(saved);
    expect(pageText(runs)).toContain('HelloZeq');
    const edited = runs.filter((r) => !/Bold|line/.test(r.text));
    const fontOf = (ch: string) => edited.find((r) => r.text.includes(ch))!.font;
    expect(fontOf('H')).toBe('LiberationSans');
    expect(fontOf('e')).toBe('LiberationSans');
    expect(fontOf('Z')).not.toBe('LiberationSans');
    expect(fontOf('q')).not.toBe('LiberationSans');
  });

  test('undo brings the original text back', async ({ page }) => {
    await openPdf(page, await subsetFontPdf());
    const box = await editParagraph(page, 'Hello world');
    await box.press('ControlOrMeta+a');
    await box.pressSequentially('Changed');
    await page.locator('#outside').click();
    await expect(page.locator('.rpe-frame')).toContainText('Changed');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.rpe-frame')).toHaveCount(0);
    // Nothing left to save.
    await expect(page.getByTitle('Save (Ctrl+S)')).toBeVisible();
  });
});

test.describe('font picker', () => {
  test('offers the document font, app fonts and the standard fonts', async ({ page }) => {
    await openPdf(page, await subsetFontPdf());
    await editParagraph(page, 'Hello world');
    const labels = await fontPicker(page).locator('option').allTextContents();
    expect(labels).toEqual(['Liberation Sans (original)', 'Test Sans', 'Helvetica', 'Times', 'Courier']);
  });

  test('switches the whole box to an app font, on screen and in the saved PDF', async ({ page }) => {
    const input = await helveticaPdf();
    await openPdf(page, input);
    const box = await editParagraph(page, 'Hello world');
    await fontPicker(page).selectOption({ label: 'Test Sans' });
    await expect(fontPicker(page)).toHaveValue('lib:test-sans');

    // The browser has the font file itself, not a look-alike.
    // (`document.fonts.check()` can't tell: it is also true when no such font is registered.)
    await page.waitForFunction(() =>
      [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'rpe-lib-test-sans' && f.status === 'loaded'),
    );
    expect(await box.evaluate((el) => getComputedStyle(el.querySelector('*') ?? el).fontFamily)).toContain('rpe-lib-test-sans');

    const saved = await commitAndSave(page);
    const runs = await readRuns(saved);
    expect(pageText(runs)).toBe('Helloworld');
    for (const r of runs) expect(r.font).toMatch(/^LiberationSans/);
    expect(await embeddedFontCount(saved)).toBe((await embeddedFontCount(input)) + 1);
  });

  test('changes only the selected word when text is selected', async ({ page }) => {
    await openPdf(page, await helveticaPdf());
    const box = await editParagraph(page, 'Hello world');
    await box.press('End');
    for (let i = 0; i < 'world'.length; i++) await box.press('Shift+ArrowLeft');
    await fontPicker(page).selectOption({ label: 'Test Sans' });

    const saved = await commitAndSave(page);
    const runs = await readRuns(saved);
    expect(pageText(runs)).toBe('Helloworld');
    expect(runs.find((r) => r.text.includes('Hello'))!.font).toBe('Helvetica');
    expect(runs.find((r) => r.text.includes('world'))!.font).toMatch(/^LiberationSans/);
  });
});
