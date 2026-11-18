/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { analyzePage, exportEdited } from '../src/edit/engine';
import { faceChain } from '../src/edit/faces';
import { fontFamilyName } from '../src/edit/fonts';
import { frameFromBlock } from '../src/edit/frames';
import { layoutFrame } from '../src/edit/layout';
import { readTrueType } from '../src/edit/trueType';
import type { TextFrame } from '../src/edit/model';

const fixture = (name: string) => new Uint8Array(readFileSync(resolve(process.cwd(), 'tests/fixtures/fonts', name)));

async function pdfjsText(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  // Words are positioned one by one, so compare without spaces.
  return (tc.items as { str: string }[]).map((i) => i.str).join('').replace(/\s+/g, '');
}

function pageFontKeys(doc: PDFDocument) {
  const fonts = doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  return fonts.keys().map((k) => k.decodeText());
}

/** Content stream operators of the exported page that select a font. */
async function usedFontKeys(bytes: Uint8Array) {
  const { analyzePage: analyze } = await import('../src/edit/extract');
  const a = analyze((await PDFDocument.load(bytes)).getPage(0), 0);
  return new Set(a.ops.filter((o) => o.op === 'Tf').map((o) => (o.operands[0] as { value: string }).value));
}

/** A page with one paragraph in a subset-embedded TrueType font, and a bold word. */
async function subsetPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fixture('LiberationSans-Regular.ttf'), { subset: true });
  const bold = await doc.embedFont(fixture('LiberationSans-Bold.ttf'), { subset: true });
  const page = doc.addPage([400, 300]);
  page.drawText('Hello world', { x: 40, y: 200, size: 14, font: regular });
  page.drawText('Bold', { x: 40, y: 100, size: 14, font: bold });
  return doc.save();
}

const editedFrame = (frame: TextFrame, text: string, extra: Partial<TextFrame['paragraphs'][0]['spans'][0]> = {}): TextFrame => ({
  ...frame,
  paragraphs: [{ spans: [{ text, ...extra }] }],
});

describe('fontFamilyName', () => {
  it.each([
    ['ABCDEF+Calibri-Bold', 'Calibri'],
    ['TimesNewRomanPS-BoldItalicMT', 'Times New Roman'],
    ['TimesNewRomanPSMT', 'Times New Roman'],
    ['ArialMT', 'Arial'],
    ['Arial,Bold', 'Arial'],
    ['Helvetica-BoldOblique', 'Helvetica'],
    ['Times-Roman', 'Times'],
  ])('%s → %s', (name, family) => expect(fontFamilyName(name)).toBe(family));
});

describe('editing with the original font', () => {
  it('lists only the glyphs a subset font really has', async () => {
    const a = analyzePage((await PDFDocument.load(await subsetPdf())).getPage(0), 0);
    const fonts = Object.values(a.fonts);
    expect(fonts).toHaveLength(2);
    const regular = fonts.find((f) => !f.bold)!;
    expect(regular.familyName).toBe('Liberation Sans');
    expect(regular.codeBytes).toBe(2);
    expect(Object.keys(regular.glyphs).sort().join('')).toBe(' Hdelorw');
  });

  it('gives frames the paragraph font as their default, with its bold sibling', async () => {
    const a = analyzePage((await PDFDocument.load(await subsetPdf())).getPage(0), 0);
    const block = a.blocks.find((b) => b.lines[0]!.text === 'Hello world')!;
    const frame = frameFromBlock(block, a.fonts, undefined);
    expect(frame.font).toMatch(/^pdf:/);
    expect(Object.values(frame.fonts!).map((f) => f.bold).sort()).toEqual([false, true]);
    // The span is in the frame's font, so it doesn't repeat it.
    expect(frame.paragraphs[0]!.spans[0]!.font).toBeUndefined();
  });

  it('lays out with the original widths, so unchanged text keeps its length', async () => {
    const a = analyzePage((await PDFDocument.load(await subsetPdf())).getPage(0), 0);
    const block = a.blocks.find((b) => b.lines[0]!.text === 'Hello world')!;
    const frame = frameFromBlock(block, a.fonts, undefined);
    const line = layoutFrame(frame).lines[0]!;
    expect(line.width).toBeCloseTo(block.x1 - block.x0, 2);
    expect(line.fragments.every((f) => f.face.kind === 'pdf')).toBe(true);
  });

  it('falls back per character for glyphs the subset lacks', async () => {
    const a = analyzePage((await PDFDocument.load(await subsetPdf())).getPage(0), 0);
    const block = a.blocks.find((b) => b.lines[0]!.text === 'Hello world')!;
    const frame = editedFrame(frameFromBlock(block, a.fonts, undefined), 'Hello Zed');
    const frags = layoutFrame(frame).lines[0]!.fragments;
    expect(frags.map((f) => [f.text, f.face.kind])).toEqual([
      ['Hello', 'pdf'],
      ['Z', 'std'],
      ['ed', 'pdf'],
    ]);
  });

  it('uses the bold sibling for bold text, and the standard bold face when there is none', async () => {
    const a = analyzePage((await PDFDocument.load(await subsetPdf())).getPage(0), 0);
    const block = a.blocks.find((b) => b.lines[0]!.text === 'Hello world')!;
    const frame = frameFromBlock(block, a.fonts, undefined);
    const [bold] = faceChain(frame, { bold: true });
    expect(bold!.kind === 'pdf' && bold!.font.bold).toBe(true);
    const [italic] = faceChain(frame, { italic: true });
    expect(italic).toMatchObject({ kind: 'std', family: 'sans', italic: true });
  });

  it('exports with the page font itself, without embedding a replacement', async () => {
    const bytes = await subsetPdf();
    const a = analyzePage((await PDFDocument.load(bytes)).getPage(0), 0);
    const block = a.blocks.find((b) => b.lines[0]!.text === 'Hello world')!;
    const frame = editedFrame(frameFromBlock(block, a.fonts, undefined), 'world Hello');
    const { bytes: out, substituted } = await exportEdited(bytes, { 0: { removedRuns: block.runIds, frames: [frame] } });
    expect(substituted).toEqual([]);
    expect(await pdfjsText(out)).toContain('worldHello');
    // No new font: the text uses the original resource.
    const before = pageFontKeys(await PDFDocument.load(bytes));
    expect(pageFontKeys(await PDFDocument.load(out))).toEqual(before);
    expect(await usedFontKeys(out)).toContain(frame.font!.slice(4));
  });

  it('mixes in the standard font only for the missing characters', async () => {
    const bytes = await subsetPdf();
    const a = analyzePage((await PDFDocument.load(bytes)).getPage(0), 0);
    const block = a.blocks.find((b) => b.lines[0]!.text === 'Hello world')!;
    const frame = editedFrame(frameFromBlock(block, a.fonts, undefined), 'Hello Zed');
    const { bytes: out } = await exportEdited(bytes, { 0: { removedRuns: block.runIds, frames: [frame] } });
    expect(await pdfjsText(out)).toContain('HelloZed');
    const after = analyzePage((await PDFDocument.load(out)).getPage(0), 0);
    const zRun = after.runs.find((r) => r.text === 'Z')!;
    expect(after.fonts[zRun.fontKey]?.name ?? zRun.fontKey).not.toMatch(/Liberation/);
  });

  it('can write any character of a font that is not embedded', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    page.drawText('Short note', { x: 40, y: 200, size: 12, font: await doc.embedFont(StandardFonts.TimesRoman) });
    const bytes = await doc.save();
    const a = analyzePage((await PDFDocument.load(bytes)).getPage(0), 0);
    const block = a.blocks[0]!;
    const frame = editedFrame(frameFromBlock(block, a.fonts, undefined), 'Quite different: 42 €');
    expect(layoutFrame(frame).lines[0]!.fragments.every((f) => f.face.kind === 'pdf')).toBe(true);
    const { bytes: out } = await exportEdited(bytes, { 0: { removedRuns: block.runIds, frames: [frame] } });
    expect(await pdfjsText(out)).toContain('Quitedifferent:42€');
    expect(pageFontKeys(await PDFDocument.load(out))).toEqual(pageFontKeys(await PDFDocument.load(bytes)));
  });
});

describe('fonts in the inline editor', () => {
  it('keeps each span font through the editable HTML', async () => {
    const { paragraphsToHtml, readParagraphs } = await import('../src/edit/dom');
    const { cssFontStack } = await import('../src/edit/faces');
    const frame = { family: 'sans' as const, fonts: {} };
    const root = document.createElement('div');
    root.style.fontFamily = cssFontStack(frame, 'pdf:F1');
    root.innerHTML = paragraphsToHtml(
      [{ spans: [{ text: 'Original ' }, { text: 'Times', font: 'std:serif' }, { text: ' again' }] }],
      (font) => cssFontStack(frame, font),
    );
    document.body.appendChild(root);
    expect(readParagraphs(root, [0, 0, 0], 'pdf:F1')[0]!.spans).toEqual([
      { text: 'Original ' },
      { text: 'Times', font: 'std:serif' },
      { text: ' again' },
    ]);
    root.remove();
  });
});

describe('page preview', () => {
  it('draws the frames into the rendered page, in the original font', async () => {
    const { buildEditedPage } = await import('../src/edit/engine');
    const { pageRenderKey } = await import('../src/edit/session');
    const bytes = await subsetPdf();
    const doc = await PDFDocument.load(bytes);
    const a = analyzePage(doc.getPage(0), 0);
    const block = a.blocks.find((b) => b.lines[0]!.text === 'Hello world')!;
    const frame = editedFrame(frameFromBlock(block, a.fonts, [1, 1, 1]), 'world Hello');
    const edits = { removedRuns: block.runIds, frames: [frame] };
    const page = await buildEditedPage(doc, 0, a, edits);
    expect(await pdfjsText(page)).toContain('worldHello');
    expect(await usedFontKeys(page)).toContain(frame.font!.slice(4));
    // Changing the frame changes the key; the screen-only cover colour does not.
    expect(pageRenderKey(edits)).not.toBe(pageRenderKey({ ...edits, frames: [{ ...frame, x: frame.x + 1 }] }));
    expect(pageRenderKey(edits)).toBe(pageRenderKey({ ...edits, frames: [{ ...frame, cover: [0, 0, 0] }] }));
    expect(pageRenderKey(undefined)).toBe('original');
  });
});

describe('font picker options', () => {
  it('lists document fonts once per family, then app fonts, then the standard three', async () => {
    const { fontOptions } = await import('../src/components/FormatBar');
    const { fontLibrary } = await import('../src/edit/fontLibrary');
    fontLibrary.register([
      { id: 'picker-test', label: 'Picker Sans', regular: new Uint8Array() },
      { id: 'picker-hidden', label: 'Hidden', regular: new Uint8Array(), hidden: true },
    ]);
    const a = analyzePage((await PDFDocument.load(await subsetPdf())).getPage(0), 0);
    const block = a.blocks.find((b) => b.lines[0]!.text === 'Hello world')!;
    const frame = frameFromBlock(block, a.fonts, undefined);
    const groups = fontOptions(frame);
    expect(groups.map((g) => g.label)).toEqual(['In this document', 'Fonts', 'Standard']);
    // Regular and Bold are one family; the entry is the regular face.
    expect(groups[0]!.options).toEqual([{ value: frame.font, label: 'Liberation Sans (original)' }]);
    expect(groups[1]!.options.map((o) => o.label)).toContain('Picker Sans');
    expect(groups[1]!.options.map((o) => o.label)).not.toContain('Hidden');
    expect(groups[2]!.options.map((o) => o.label)).toEqual(['Helvetica', 'Times', 'Courier']);
  });
});

describe('app fonts', () => {
  const regular = () => fixture('LiberationSans-Regular.ttf');

  it('lays out and exports text in a picked app font', async () => {
    const { fontLibrary } = await import('../src/edit/fontLibrary');
    fontLibrary.register([{ id: 'test-lib', label: 'Test Sans', regular: regular() }]);
    await fontLibrary.load('test-lib', false, false);
    const frame: TextFrame = {
      id: 'lib', x: 40, baseline: 200, width: 300, size: 12, lineHeight: 14, family: 'serif', font: 'lib:test-lib',
      color: [0, 0, 0], align: 'left', paragraphs: [{ spans: [{ text: 'Ligatures off: fi ffl' }] }],
    };
    const frags = layoutFrame(frame).lines[0]!.fragments;
    expect(frags.every((f) => f.face.kind === 'lib')).toBe(true);

    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    const { bytes: out } = await exportEdited(await doc.save(), { 0: { removedRuns: [], frames: [frame] } });
    expect(await pdfjsText(out)).toContain('Ligaturesoff:fiffl');
    const a = analyzePage((await PDFDocument.load(out)).getPage(0), 0);
    // Embedded as a subset, and positioned exactly where layout put it.
    const font = Object.values(a.fonts)[0]!;
    expect(font.name).toMatch(/LiberationSans/);
    const last = a.runs.find((r) => r.text === 'ffl')!;
    const lastFrag = frags[frags.length - 1]!;
    expect(last.x1).toBeCloseTo(40 + lastFrag.x + lastFrag.width, 2);
  });

  it('stands in for a page font when the subset lacks a character', async () => {
    const { fontLibrary } = await import('../src/edit/fontLibrary');
    fontLibrary.register([{ id: 'stand-in', label: 'Stand In', regular: regular(), replaces: ['Liberation Sans'], hidden: true }]);
    await fontLibrary.load('stand-in', false, false);
    const a = analyzePage((await PDFDocument.load(await subsetPdf())).getPage(0), 0);
    const block = a.blocks.find((b) => b.lines[0]!.text === 'Hello world')!;
    const frame = editedFrame(frameFromBlock(block, a.fonts, undefined), 'Hello Zed');
    const frags = layoutFrame(frame).lines[0]!.fragments;
    expect(frags.map((f) => [f.text, f.face.kind])).toEqual([
      ['Hello', 'pdf'],
      ['Z', 'lib'],
      ['ed', 'pdf'],
    ]);
  });

  it('knows the usual metric-compatible stand-ins by name', async () => {
    const { fontLibrary, standInFonts } = await import('../src/edit/fontLibrary');
    fontLibrary.register(standInFonts('/fonts'));
    expect(fontLibrary.standInFor('Calibri')?.id).toBe('carlito');
    expect(fontLibrary.standInFor('Times New Roman')?.id).toBe('tinos');
    expect(fontLibrary.get('carlito')?.bold).toBe('/fonts/Carlito-Bold.ttf');
  });
});

/** Offset of a table in a TrueType file. */
function tableOffset(bytes: Uint8Array, tag: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < view.getUint16(4); i++) {
    const rec = 12 + i * 16;
    if (String.fromCharCode(...bytes.subarray(rec, rec + 4)) === tag) return view.getUint32(rec + 8);
  }
  throw new Error(`no ${tag} table`);
}

/** Copy of a TrueType file with `OS/2.fsType` set to `value`. */
function withFsType(bytes: Uint8Array, value: number) {
  const out = bytes.slice();
  new DataView(out.buffer).setUint16(tableOffset(out, 'OS/2') + 8, value); // fsType is at offset 8 of the table
  return out;
}

/** Length of every embedded TrueType program in the PDF. */
async function fontFileLengths(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const out: number[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || !obj.has(PDFName.of('FontFile2'))) continue;
    const file = doc.context.lookup(obj.get(PDFName.of('FontFile2'))) as unknown as { getContents(): Uint8Array };
    const { decodePDFRawStream, PDFRawStream } = await import('pdf-lib');
    out.push(file instanceof PDFRawStream ? decodePDFRawStream(file).decode().length : file.getContents().length);
  }
  return out;
}

describe('font licensing (OS/2 fsType)', () => {
  const regular = () => fixture('LiberationSans-Regular.ttf');
  const libFrame = (fontId: string): TextFrame => ({
    id: 'fs', x: 40, baseline: 200, width: 300, size: 12, lineHeight: 14, family: 'serif', font: `lib:${fontId}`,
    color: [0, 0, 0], align: 'left', paragraphs: [{ spans: [{ text: 'Licensed' }] }],
  });

  it('refuses fonts whose license forbids embedding, and falls back to the standard font', async () => {
    const { fontLibrary } = await import('../src/edit/fontLibrary');
    fontLibrary.register([
      { id: 'restricted', label: 'Restricted', regular: withFsType(regular(), 0x0002) },
      { id: 'bitmap-only', label: 'Bitmap Only', regular: withFsType(regular(), 0x0200) },
    ]);
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(await fontLibrary.load('restricted', false, false)).toBeNull();
      expect(await fontLibrary.load('bitmap-only', false, false)).toBeNull();
    } finally {
      console.warn = warn;
    }
    const frags = layoutFrame(libFrame('restricted')).lines[0]!.fragments;
    expect(frags.map((f) => f.face.kind)).toEqual(['std']);
    expect(frags[0]!.face).toMatchObject({ family: 'serif' });
  });

  it('allows preview & print and editable embedding', async () => {
    const { fontLibrary } = await import('../src/edit/fontLibrary');
    fontLibrary.register([
      { id: 'preview-print', label: 'Preview Print', regular: withFsType(regular(), 0x0004) },
      { id: 'editable', label: 'Editable', regular: withFsType(regular(), 0x0008) },
    ]);
    expect((await fontLibrary.load('preview-print', false, false))?.subset).toBe(true);
    expect((await fontLibrary.load('editable', false, false))?.subset).toBe(true);
  });

  it('embeds the whole font when its license forbids subsetting', async () => {
    const { fontLibrary } = await import('../src/edit/fontLibrary');
    const full = withFsType(regular(), 0x0100);
    fontLibrary.register([
      { id: 'no-subset', label: 'No Subset', regular: full },
      { id: 'may-subset', label: 'May Subset', regular: regular() },
    ]);
    expect((await fontLibrary.load('no-subset', false, false))?.subset).toBe(false);
    await fontLibrary.load('may-subset', false, false);

    const blank = await (await PDFDocument.create()).save();
    const page = async (fontId: string) => {
      const doc = await PDFDocument.load(blank);
      doc.addPage([400, 300]);
      return (await exportEdited(await doc.save(), { 0: { removedRuns: [], frames: [libFrame(fontId)] } })).bytes;
    };
    const [whole] = await fontFileLengths(await page('no-subset'));
    const [subset] = await fontFileLengths(await page('may-subset'));
    expect(whole).toBe(full.length);
    expect(subset).toBeLessThan(full.length / 4);
  });
});

/** Copy of a TrueType file in which the glyphs for `chars` have no outline, as a subsetter leaves them. */
function withBlankGlyphs(bytes: Uint8Array, chars: string) {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  const font = readTrueType(out)!;
  const longLoca = view.getInt16(tableOffset(out, 'head') + 50) === 1;
  const loca = tableOffset(out, 'loca');
  const glyf = tableOffset(out, 'glyf');
  for (const ch of chars) {
    const gid = font.cmap(3, 1)!(ch.codePointAt(0)!);
    const at = longLoca ? view.getUint32(loca + gid * 4) : view.getUint16(loca + gid * 2) * 2;
    view.setInt16(glyf + at, 0); // numberOfContours = 0
  }
  return out;
}

/**
 * A page showing `text` in a simple (WinAnsi) TrueType font whose embedded
 * program is `program`, named like a subset.
 */
async function simpleTrueTypePdf(program: Uint8Array, text: string) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const ctx = doc.context;
  const name = 'ABCDEF+LiberationSans';
  const descriptor = ctx.register(
    ctx.obj({
      Type: 'FontDescriptor', FontName: name, Flags: 32, FontBBox: [0, -212, 1000, 905], ItalicAngle: 0,
      Ascent: 905, Descent: -212, CapHeight: 716, StemV: 80,
      FontFile2: ctx.register(ctx.flateStream(program, { Length1: program.length })),
    }),
  );
  const font = ctx.register(
    ctx.obj({
      Type: 'Font', Subtype: 'TrueType', BaseFont: name, FirstChar: 32, LastChar: 255,
      Widths: Array.from({ length: 224 }, () => 556), Encoding: 'WinAnsiEncoding', FontDescriptor: descriptor,
    }),
  );
  page.node.setFontDictionary(PDFName.of('F1'), font);
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(`BT /F1 14 Tf 40 200 Td (${text}) Tj ET`)));
  return doc.save();
}

const glyphList = (bytes: Uint8Array) =>
  PDFDocument.load(bytes).then((d) => Object.keys(Object.values(analyzePage(d.getPage(0), 0).fonts)[0]?.glyphs ?? {}).sort().join(''));

describe('glyphs a subset font program really has', () => {
  const regular = () => fixture('LiberationSans-Regular.ttf');

  it('reads glyph presence from a TrueType program', () => {
    const font = readTrueType(withBlankGlyphs(regular(), 'Z'))!;
    const gid = (ch: string) => font.cmap(3, 1)!(ch.codePointAt(0)!);
    expect(font.glyph(gid('A'))).toBe('drawn');
    expect(font.glyph(gid('Z'))).toBe('blank');
    expect(font.glyph(gid(' '))).toBe('blank');
    expect(font.glyph(0)).toBe('missing');
    expect(font.glyph(font.numGlyphs)).toBe('missing');
    expect(readTrueType(new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull(); // CFF ('OTTO')
    expect(readTrueType(new Uint8Array(4))).toBeNull();
  });

  it('offers glyphs the subset has for other pages (Identity-H)', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(regular(), { subset: true });
    doc.addPage([400, 300]).drawText('Hello world', { x: 40, y: 200, size: 14, font });
    doc.addPage([400, 300]).drawText('Zebra', { x: 40, y: 200, size: 14, font });
    // pdf-lib names subsets `Name-1234`; give it the standard `ABCDEF+` prefix so it is read as a subset.
    const saved = await PDFDocument.load(await doc.save());
    for (const [, obj] of saved.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      for (const key of ['BaseFont', 'FontName']) if (obj.has(PDFName.of(key))) obj.set(PDFName.of(key), PDFName.of('ABCDEF+LiberationSans'));
    }
    // Page 1 alone uses " Hdelorw"; the subset also has Z, b and a from page 2.
    expect(await glyphList(await saved.save())).toBe(' HZabdelorw');
  });

  it('offers every glyph a simple TrueType subset has, and none that it lacks', async () => {
    const glyphs = await glyphList(await simpleTrueTypePdf(withBlankGlyphs(regular(), 'Zq'), 'Hello'));
    expect(glyphs).toContain('A');
    expect(glyphs).toContain('é');
    expect(glyphs).toContain(' ');
    expect(glyphs).not.toContain('Z');
    expect(glyphs).not.toContain('q');
  });

  it("doesn't trust the program when it disagrees with the page, and offers only the page's glyphs", async () => {
    // 'H' is drawn on the page but blank in the program: our code → glyph mapping can't be right.
    const glyphs = await glyphList(await simpleTrueTypePdf(withBlankGlyphs(regular(), 'H'), 'Hello'));
    expect(glyphs).toBe('Helo');
  });
});
