/// <reference types="node" />
/**
 * Node-side helpers for the e2e tests: build input PDFs, and read back what
 * the editor saved with the editor's own content parser.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { analyzePage } from '../src/edit/extract';

const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../tests/fixtures/fonts/${name}`, import.meta.url))));

export const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
export const fromBase64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

/**
 * One page with a paragraph in subset-embedded Liberation Sans (regular) and
 * a bold line, named with the standard `ABCDEF+` subset prefix.
 */
export async function subsetFontPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fixture('LiberationSans-Regular.ttf'), { subset: true });
  const bold = await doc.embedFont(fixture('LiberationSans-Bold.ttf'), { subset: true });
  const page = doc.addPage([400, 300]);
  page.drawText('Hello world', { x: 40, y: 220, size: 18, font: regular });
  page.drawText('Bold line', { x: 40, y: 120, size: 18, font: bold });
  // pdf-lib names subsets `Name-1234`; use the prefix real producers use.
  const saved = await PDFDocument.load(await doc.save());
  for (const [, obj] of saved.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const name = obj.get(PDFName.of('BaseFont')) ?? obj.get(PDFName.of('FontName'));
    if (!(name instanceof PDFName)) continue;
    const fixed = name.decodeText().startsWith('LiberationSans-Bold') ? 'ABCDEF+LiberationSans-Bold' : 'GHIJKL+LiberationSans';
    for (const key of ['BaseFont', 'FontName']) if (obj.has(PDFName.of(key))) obj.set(PDFName.of(key), PDFName.of(fixed));
  }
  return saved.save();
}

/** One page of plain Helvetica text (a standard font, not embedded). */
export async function helveticaPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([400, 300]).drawText('Hello world', { x: 40, y: 220, size: 18, font });
  return doc.save();
}

export interface SavedRun {
  text: string;
  /** BaseFont of the font the run is drawn with, without the subset prefix. */
  font: string;
}

/** Text runs of page 1 in content order, with their fonts. */
export async function readRuns(bytes: Uint8Array): Promise<SavedRun[]> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const fonts = page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
  const baseName = (key: string) => {
    const dict = fonts?.lookup(PDFName.of(key), PDFDict);
    const name = dict?.get(PDFName.of('BaseFont'));
    return name instanceof PDFName ? name.decodeText().replace(/^[A-Z]{6}\+/, '') : '?';
  };
  return analyzePage(page, 0).runs.filter((r) => r.text.trim()).map((r) => ({ text: r.text, font: baseName(r.fontKey) }));
}

/** All text on page 1 without spaces (words are positioned one by one). */
export const pageText = (runs: SavedRun[]) => runs.map((r) => r.text).join('').replace(/\s+/g, '');

/** Number of embedded font programs in the file. */
export async function embeddedFontCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => obj.has(PDFName.of(k)))) n++;
  }
  return n;
}
