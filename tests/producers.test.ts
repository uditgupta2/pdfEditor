/// <reference types="node" />
/**
 * Editing PDFs made by real producers. Each producer embeds fonts its own way
 * (simple vs CID fonts, TrueType vs CFF vs Type 1, with or without ToUnicode),
 * which the pdf-lib-made PDFs in fonts.test.ts don't cover. The fixtures are
 * built by scripts/font-pdfs/make.sh; `pdffonts` output is noted per file.
 *
 * `it.fails` marks known problems: the test states the right behaviour, and
 * starts erroring once it's fixed, as a reminder to turn it into `it`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { analyzePage, exportEdited } from '../src/edit/engine';
import { scriptLock } from '../src/edit/extract';
import { frameFromBlock } from '../src/edit/frames';
import { layoutFrame } from '../src/edit/layout';
import type { TextFrame } from '../src/edit/model';

const pdf = (name: string) => new Uint8Array(readFileSync(resolve(process.cwd(), 'tests/fixtures/pdfs', name)));

async function analyze(bytes: Uint8Array) {
  return analyzePage((await PDFDocument.load(bytes)).getPage(0), 0);
}

const blockText = (b: { lines: { text: string }[] }) => b.lines.map((l) => l.text).join(' ');

async function findBlock(bytes: Uint8Array, start: string) {
  const a = await analyze(bytes);
  const block = a.blocks.find((b) => blockText(b).startsWith(start));
  return { a, block };
}

/** The frame with its (single) paragraph's text replaced, keeping the span's style. */
function withText(frame: TextFrame, text: string): TextFrame {
  const span = frame.paragraphs[0]!.spans[0]!;
  return { ...frame, paragraphs: [{ ...frame.paragraphs[0]!, spans: [{ ...span, text }] }] };
}

async function pdfjsDoc(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false, verbosity: 0 }).promise;
}

/** Page 1 text as pdf.js reads it, without spaces (words are positioned one by one). */
async function pdfjsText(bytes: Uint8Array) {
  const tc = await (await (await pdfjsDoc(bytes)).getPage(1)).getTextContent();
  return (tc.items as { str: string }[]).map((i) => i.str).join('').replace(/\s+/g, '');
}

/** Font resource keys of page 1, and the number of embedded font programs in the file. */
async function fontInventory(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const keys = doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict).keys().map((k) => k.decodeText()).sort();
  let programs = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => obj.has(PDFName.of(k)))) programs++;
  }
  return { keys, programs };
}

/** Words in reverse order: only glyphs the subset already has. */
const reversedWords = (s: string) => s.split(' ').reverse().join(' ');

interface Case {
  file: string;
  /** How the producer embedded the font, as `pdffonts` reports it. */
  kind: string;
  text: string;
  /** PostScript name of the font, without the subset prefix. */
  font: string;
  bold?: boolean;
}

const CASES: Case[] = [
  // Chromium / Skia (Chrome "Save as PDF", Puppeteer, Playwright): CID fonts, Identity-H.
  { file: 'chromium.pdf', kind: 'CID TrueType', text: 'Alpha serif regular text here', font: 'LiberationSerif' },
  { file: 'chromium.pdf', kind: 'CID TrueType, bold', text: 'Bravo serif bold text here', font: 'LiberationSerif-Bold', bold: true },
  { file: 'chromium.pdf', kind: 'CID TrueType, accents and €', text: 'Echo café naïve 42 €', font: 'NotoSans-Regular' },
  // Cairo (Inkscape, GTK apps, many Linux tools): simple fonts, WinAnsi.
  { file: 'cairo-truetype.pdf', kind: 'TrueType', text: 'Alpha serif regular text here', font: 'LiberationSerif' },
  { file: 'cairo-truetype.pdf', kind: 'TrueType, bold', text: 'Bravo serif bold text here', font: 'LiberationSerif-Bold', bold: true },
  { file: 'cairo-truetype.pdf', kind: 'TrueType, accents and €', text: 'Echo café naïve 42 €', font: 'NotoSans-Regular' },
  { file: 'cairo-cff.pdf', kind: 'Type 1C (CFF)', text: 'Charlie sans text in compact font', font: 'NimbusSans-Regular' },
  { file: 'cairo-cff.pdf', kind: 'Type 1C (CFF), bold', text: 'Bravo sans bold text here', font: 'NimbusSans-Bold', bold: true },
  { file: 'cairo-type1.pdf', kind: 'Type 1', text: 'Foxtrot sans text in type one', font: 'NimbusSans-Regular' },
  { file: 'cairo-type1.pdf', kind: 'Type 1, serif', text: 'Golf serif text in type one', font: 'C059-Roman' },
  { file: 'cairo-emoji.pdf', kind: 'TrueType next to a Type 3 font', text: 'Hotel plain text line', font: 'LiberationSerif' },
  // groff → Ghostscript (ps2pdf): Type 1C subsets with no ToUnicode map.
  { file: 'ghostscript.pdf', kind: 'Type 1C, no ToUnicode', text: 'India times roman text in ghostscript', font: 'Times-Roman' },
  { file: 'ghostscript.pdf', kind: 'Type 1C, no ToUnicode, bold', text: 'Juliet bold text in ghostscript', font: 'Times-Bold', bold: true },
  { file: 'ghostscript.pdf', kind: 'Type 1C, no ToUnicode, sans', text: 'Kilo helvetica text in ghostscript', font: 'Helvetica' },
];

describe.each(CASES)('$file: $kind ("$text")', ({ file, text, font, bold }) => {
  it('reads the text, as an editable paragraph in its own font', async () => {
    const { a, block } = await findBlock(pdf(file), text);
    expect(block, `no paragraph starts with "${text}"`).toBeDefined();
    expect(blockText(block!)).toBe(text);
    expect(block!.editable).toBe(true);
    const frame = frameFromBlock(block!, a.fonts, undefined);
    expect(frame.font).toMatch(/^pdf:/);
    expect(a.fonts[frame.font!.slice(4)]!.name.replace(/^[A-Z]{6}\+/, '')).toBe(font);
    expect(!!frame.paragraphs[0]!.spans[0]!.bold).toBe(!!bold);
  });

  it('lays out the unchanged text in the page font, at its original width', async () => {
    const { a, block } = await findBlock(pdf(file), text);
    const frame = frameFromBlock(block!, a.fonts, undefined);
    const lines = layoutFrame(frame).lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.fragments.every((f) => f.face.kind === 'pdf')).toBe(true);
    // Within 2%: producers like Chromium nudge glyphs by small amounts (hinting,
    // kerning) that the font's own widths don't include.
    const width = block!.x1 - block!.x0;
    expect(Math.abs(lines[0]!.width - width) / width).toBeLessThan(0.02);
  });

  it('writes rearranged text with the page font itself, embedding nothing new', async () => {
    const bytes = pdf(file);
    const { a, block } = await findBlock(bytes, text);
    const frame = withText(frameFromBlock(block!, a.fonts, undefined), reversedWords(text));
    expect(layoutFrame(frame).lines.flatMap((l) => l.fragments).every((f) => f.face.kind === 'pdf')).toBe(true);

    const { bytes: out, substituted } = await exportEdited(bytes, { 0: { removedRuns: block!.runIds, frames: [frame] } });
    expect(substituted).toEqual([]);
    const outText = await pdfjsText(out);
    expect(outText).toContain(reversedWords(text).replace(/\s+/g, ''));
    expect(outText).not.toContain(text.replace(/\s+/g, ''));
    expect(await fontInventory(out)).toEqual(await fontInventory(bytes));

    // Read back by the editor itself: same text, same font.
    const after = await findBlock(out, reversedWords(text));
    expect(after.block).toBeDefined();
    expect(after.a.fonts[after.block!.font!.slice(4)]?.name.replace(/^[A-Z]{6}\+/, '')).toBe(font);
  });

  it('falls back only for characters the subset lacks', async () => {
    const bytes = pdf(file);
    const { a, block } = await findBlock(bytes, text);
    const first = text.split(' ')[0]!;
    // Q and Z appear in none of the fixture lines, so the subsets lack them.
    const frame = withText(frameFromBlock(block!, a.fonts, undefined), `${first} QZ`);
    const frags = layoutFrame(frame).lines.flatMap((l) => l.fragments);
    expect(frags.map((f) => [f.text, f.face.kind])).toEqual([
      [first, 'pdf'],
      ['QZ', 'std'],
    ]);
    const { bytes: out, substituted } = await exportEdited(bytes, { 0: { removedRuns: block!.runIds, frames: [frame] } });
    expect(substituted).toEqual([]);
    expect(await pdfjsText(out)).toContain(`${first}QZ`);
  });

  it('exports a PDF that pdf.js can draw', async () => {
    const bytes = pdf(file);
    const { a, block } = await findBlock(bytes, text);
    const frame = withText(frameFromBlock(block!, a.fonts, undefined), reversedWords(text));
    const { bytes: out } = await exportEdited(bytes, { 0: { removedRuns: block!.runIds, frames: [frame] } });
    const page = await (await pdfjsDoc(out)).getPage(1);
    // Builds the drawing operations, which parses every font the page uses.
    const ops = await page.getOperatorList();
    expect(ops.fnArray.length).toBeGreaterThan(0);
  });
});

describe('other text in producer PDFs', () => {
  it('reads text without a ToUnicode map from the font encoding (Ghostscript)', async () => {
    const a = await analyze(pdf('ghostscript.pdf'));
    expect(a.blocks.map(blockText)).toEqual([
      'India times roman text in ghostscript',
      'Juliet bold text in ghostscript',
      'Kilo helvetica text in ghostscript',
    ]);
  });

  it('keeps a Type 3 emoji as it was when the text next to it is edited (Cairo)', async () => {
    const bytes = pdf('cairo-emoji.pdf');
    const { a, block } = await findBlock(bytes, 'Hotel plain text line');
    // The emoji line is never offered for editing.
    expect(a.blocks.filter((b) => b.editable).map(blockText)).toEqual(['Hotel plain text line']);
    const frame = withText(frameFromBlock(block!, a.fonts, undefined), 'line text plain Hotel');
    const { bytes: out } = await exportEdited(bytes, { 0: { removedRuns: block!.runIds, frames: [frame] } });
    // The edited paragraph is drawn after the rest, so check each separately.
    const outText = await pdfjsText(out);
    expect(outText).toContain('linetextplainHotel');
    expect(outText).toContain('😀🎉');
  });

  it('leaves Type 3 text (Chromium writes CFF .otf fonts as Type 3) untouched by edits elsewhere', async () => {
    const bytes = pdf('chromium.pdf');
    const { a, block } = await findBlock(bytes, 'Alpha');
    const frame = withText(frameFromBlock(block!, a.fonts, undefined), 'here text regular serif Alpha');
    const { bytes: out } = await exportEdited(bytes, { 0: { removedRuns: block!.runIds, frames: [frame] } });
    expect(await pdfjsText(out)).toContain('Charliesanstextincompactfont');
  });
});

describe('known problems', () => {
  it.fails('shows Type 3 text as a locked paragraph, so the user sees why it cannot be edited', async () => {
    const { block } = await findBlock(pdf('chromium.pdf'), 'Charlie');
    expect(block).toBeDefined();
    expect(block!.editable).toBe(false);
  });

  it.fails('reads ligatures as separate letters, like pdf.js does (Chromium maps them to U+FB00…)', async () => {
    const { block } = await findBlock(pdf('chromium.pdf'), 'Delta');
    expect(blockText(block!)).toBe('Delta office affinity waffle');
  });
});

// Text is rewritten character by character, which can't shape Indic scripts or
// order right-to-left text: even unchanged, such a paragraph came back garbled.
describe('scripts the editor cannot write yet', () => {
  it('locks Devanagari text, with the script as the reason', async () => {
    const a = await analyze(pdf('chromium.pdf'));
    const deva = a.blocks.find((b) => /[ऀ-ॿ]/.test(blockText(b)));
    expect(deva).toBeDefined();
    expect(deva!.editable).toBe(false);
    expect(deva!.lockReason).toBe('script');
  });

  it('locks Arabic text, with the script as the reason', async () => {
    const a = await analyze(pdf('chromium.pdf'));
    const arabic = a.blocks.find((b) => /[؀-ۿﭐ-﻿]/.test(blockText(b)));
    expect(arabic).toBeDefined();
    expect(arabic!.editable).toBe(false);
    expect(arabic!.lockReason).toBe('script');
  });

  it('keeps every Latin paragraph on the same page editable', async () => {
    const a = await analyze(pdf('chromium.pdf'));
    const latin = a.blocks.filter((b) => /^[A-Z]/.test(blockText(b)));
    expect(latin.map(blockText)).toEqual([
      'Alpha serif regular text here',
      'Bravo serif bold text here',
      'Delta oﬀice aﬀinity waﬄe',
      'Echo café naïve 42 €',
    ]);
    for (const b of latin) {
      expect(b.editable).toBe(true);
      expect(b.lockReason).toBeUndefined();
    }
  });

  it.each([
    ['Hebrew', 'שלום'],
    ['Arabic', 'مرحبا'],
    ['Arabic presentation forms', 'ﻣﺮﺣ'],
    ['Devanagari', 'नमस्ते'],
    ['Bengali', 'নমস্কার'],
    ['Tamil', 'வணக்கம்'],
    ['Thai', 'สวัสดี'],
    ['Khmer', 'សួស្តី'],
    ['a glyph mapped to no character', 'ab\u0000c'],
    ['a replacement character', 'ab�c'],
    ['one word in a Latin sentence', 'Hello مرحبا world'],
  ])('flags %s', (_, text) => expect(scriptLock(text)).toBe('script'));

  it.each([
    ['English', 'Hello, world!'],
    ['Western European accents', 'café naïve Ærø ß'],
    ['Central European', 'Łódź Žižek ő'],
    ['Greek', 'Καλημέρα'],
    ['Cyrillic', 'Привет'],
    ['symbols and ligatures', '42 € © ™ “quotes” — ﬁ ﬀ'],
    ['tabs and line breaks', 'a\tb\nc'],
    ['CJK', '你好 こんにちは 안녕'],
  ])('leaves %s alone', (_, text) => expect(scriptLock(text)).toBeUndefined());
});
