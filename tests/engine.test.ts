import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { analyzePage, exportEdited, removeRuns } from '../src/edit/engine';
import { parseContentStream } from '../src/edit/contentStream';
import { layoutFrame } from '../src/edit/layout';
import type { TextFrame } from '../src/edit/model';
import { EditSession } from '../src/edit/session';

// pdf.js (legacy build works in Node) to verify output like a real viewer.
async function pdfjsText(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  return (tc.items as { str: string; transform: number[] }[])
    .filter((i) => i.str.trim())
    .map((i) => ({ str: i.str, x: Math.round(i.transform[4]!), y: Math.round(i.transform[5]!) }));
}

async function sample() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText('Quarterly Report', { x: 72, y: 700, size: 24, font: bold, color: rgb(0.1, 0.2, 0.6) });
  const body = [
    'Revenue grew strongly this quarter thanks to new',
    'customers in Europe.',
    'Costs were flat.',
  ];
  body.forEach((t, i) => page.drawText(t, { x: 72, y: 650 - i * 16, size: 12, font: helv }));
  page.drawText('Footer text', { x: 72, y: 60, size: 9, font: helv });
  return doc.save();
}

describe('editability of encrypted PDFs', () => {
  async function encrypted(permissions: number) {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.context.trailerInfo.Encrypt = doc.context.register(
      doc.context.obj({ Filter: 'Standard', V: 4, R: 4, P: permissions }),
    );
    return doc.save({ useObjectStreams: false });
  }

  const editability = (bytes: Uint8Array) => new EditSession(bytes).editability();

  it('allows unencrypted files', async () => {
    expect(await editability(await sample())).toEqual({ ok: true });
  });

  it('says the file is restricted and lists what its owner forbids', async () => {
    // -3388 is what Acrobat writes for print-only: the file opens without a password.
    const check = await editability(await encrypted(-3388));
    expect(check.ok).toBe(false);
    expect(check.reason).toBe(
      "This PDF is restricted by its owner, so it can't be edited. Not allowed: changing its content, copying text and adding comments. To make changes, ask the owner for an unrestricted copy.",
    );
  });

  it('includes printing when that is forbidden too', async () => {
    const check = await editability(await encrypted(-3904));
    expect(check.reason).toContain('changing its content, copying text, adding comments and printing.');
  });

  it('refuses to export edits to a restricted file', async () => {
    const session = new EditSession(await encrypted(-3388));
    await expect(session.export({ 0: { removedRuns: [], frames: [] } })).rejects.toThrow(/restricted by its owner/);
  });

  it('reports other encrypted files as unsupported', async () => {
    const check = await editability(await encrypted(-4));
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('Editing encrypted PDFs is not supported yet.');
  });
});

describe('content stream parser', () => {
  it('parses strings, arrays, names and keeps offsets', () => {
    const s = 'BT /F1 12 Tf 72 700 Td [(Hel) -20 (lo\\)) <414243>] TJ ET';
    const ops = parseContentStream(s);
    expect(ops.map((o) => o.op)).toEqual(['BT', 'Tf', 'Td', 'TJ', 'ET']);
    const tj = ops[3]!;
    expect(s.slice(tj.start, tj.end)).toBe('[(Hel) -20 (lo\\)) <414243>] TJ');
    const arr = tj.operands[0]!;
    expect(arr.type === 'arr' && arr.items.length).toBe(4);
  });
  it('skips inline image data', () => {
    const ops = parseContentStream('q BI /W 1 /H 1 ID \x00\xffEI\x01 EI Q');
    expect(ops.map((o) => o.op)).toEqual(['q', 'BI', 'Q']);
  });
});

describe('analyzePage', () => {
  it('finds text runs with positions and groups paragraphs', async () => {
    const doc = await PDFDocument.load(await sample());
    const a = analyzePage(doc.getPage(0), 0);
    const texts = a.blocks.map((b) => b.paragraphs.map((p) => p.spans.map((s) => s.text).join('')).join(' / '));
    expect(texts).toContain('Quarterly Report');
    expect(texts).toContain(
      'Revenue grew strongly this quarter thanks to new customers in Europe. / Costs were flat.',
    );
    expect(texts).toContain('Footer text');
    const heading = a.blocks.find((b) => b.paragraphs[0]!.spans[0]!.text === 'Quarterly Report')!;
    expect(heading.paragraphs[0]!.spans[0]!.bold).toBe(true);
    expect(heading.color[2]).toBeCloseTo(0.6, 2);
    expect(heading.x0).toBeCloseTo(72, 1);
    expect(heading.firstBaseline).toBeCloseTo(700, 1);
    expect(heading.size).toBeCloseTo(24, 1);
    const body = a.blocks.find((b) => b.lines.length === 3)!;
    expect(body.lineHeight).toBeCloseTo(16, 1);
  });
});

describe('removeRuns', () => {
  it('removes a run but keeps following text in place', async () => {
    // Two strings in one text object: removing the first must not shift the second.
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const key = page.node.newFontDictionary('F1', font.ref);
    page.pushOperators(); // ensure content stream exists
    const content = `BT /${key.decodeText()} 12 Tf 20 100 Td (Hello ) Tj (World) Tj ET`;
    page.node.set(
      (await import('pdf-lib')).PDFName.of('Contents'),
      doc.context.register(doc.context.stream(content)),
    );
    const bytes = await doc.save();
    // "World" starts after the advance of "Hello " in Helvetica 12pt.
    const expectedX = Math.round(20 + font.widthOfTextAtSize('Hello ', 12));

    const loaded = await PDFDocument.load(bytes);
    const a = analyzePage(loaded.getPage(0), 0);
    const hello = a.runs.find((r) => r.text === 'Hello ')!;
    const rewritten = removeRuns(a, new Set([hello.id]));
    expect(rewritten).not.toContain('(Hello )');

    const { bytes: out } = await exportEdited(bytes, { 0: { removedRuns: [hello.id], frames: [] } });
    const after = await pdfjsText(out);
    expect(after.map((t) => t.str).join('')).not.toContain('Hello');
    const worldAfter = after.find((t) => t.str.includes('World'))!;
    expect(worldAfter.x).toBe(expectedX);
    expect(worldAfter.y).toBe(100);
  });
});

describe('exportEdited', () => {
  it('replaces a paragraph: old text is really gone, new text is real text', async () => {
    const bytes = await sample();
    const doc = await PDFDocument.load(bytes);
    const a = analyzePage(doc.getPage(0), 0);
    const body = a.blocks.find((b) => b.lines.length === 3)!;
    const frame: TextFrame = {
      id: 'x',
      sourceBlockId: body.id,
      x: body.x0,
      baseline: body.firstBaseline,
      width: body.x1 - body.x0,
      size: body.size,
      lineHeight: body.lineHeight,
      family: 'sans',
      color: [0, 0, 0],
      align: 'left',
      paragraphs: [{ spans: [{ text: 'Revenue fell slightly. ' }, { text: 'Profit', bold: true }, { text: ' rose.' }] }],
    };
    const { bytes: out, substituted } = await exportEdited(bytes, { 0: { removedRuns: body.runIds, frames: [frame] } });
    expect(substituted).toEqual([]);
    const text = (await pdfjsText(out)).map((t) => t.str).join(' ');
    expect(text).not.toContain('grew strongly');
    expect(text).not.toContain('Costs were flat');
    expect(text).toContain('Revenue fell slightly.');
    expect(text).toContain('Profit');
    expect(text).toContain('Quarterly Report'); // untouched text survives
    expect(text).toContain('Footer text');
  });
});

describe('layoutFrame', () => {
  const base: TextFrame = {
    id: 'l', x: 0, baseline: 0, width: 100, size: 10, lineHeight: 12, family: 'sans', color: [0, 0, 0], align: 'left',
    paragraphs: [{ spans: [{ text: 'one two three four five six seven' }] }, { spans: [{ text: 'next' }] }],
  };
  it('wraps words within the width and starts paragraphs on new lines', () => {
    const l = layoutFrame(base);
    expect(l.lines.length).toBeGreaterThan(2);
    for (const line of l.lines) expect(line.width).toBeLessThanOrEqual(100.6);
    expect(l.lines[l.lines.length - 1]!.fragments[0]!.text).toBe('next');
    expect(l.lines[1]!.dy).toBe(12);
  });
  it('right-aligns and centers', () => {
    const r = layoutFrame({ ...base, align: 'right', paragraphs: [{ spans: [{ text: 'hi' }] }] });
    const f = r.lines[0]!.fragments[0]!;
    expect(f.x + f.width).toBeCloseTo(100, 3);
  });
  it('justifies all but the last line', () => {
    const j = layoutFrame({ ...base, align: 'justify' });
    expect(j.lines[0]!.width).toBeCloseTo(100, 3);
  });
});

describe('drawn underlines', () => {
  // Word draws underlines as stroked lines, Chrome/Skia as thin filled
  // rectangles; neither is part of the text itself.
  async function underlined() {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const key = page.node.newFontDictionary('F1', font.ref).decodeText();
    const linkW = font.widthOfTextAtSize('Visit ', 12);
    const siteW = font.widthOfTextAtSize('our site', 12);
    const content = [
      // A fully underlined heading, stroked.
      `BT /${key} 12 Tf 20 250 Td (Terms apply) Tj ET`,
      `0.8 w 20 248.2 m ${20 + font.widthOfTextAtSize('Terms apply', 12)} 248.2 l S`,
      // One underlined phrase inside a sentence, filled rectangle.
      `BT /${key} 12 Tf 20 200 Td (Visit our site today) Tj ET`,
      `${20 + linkW} 198.3 ${siteW} 0.7 re f`,
      // A table rule well below the text and wider than it: not an underline.
      `BT /${key} 12 Tf 20 100 Td (Cell) Tj ET`,
      `0.5 w 10 92 m 390 92 l S`,
    ].join('\n');
    page.node.set((await import('pdf-lib')).PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
    return doc.save();
  }

  it('attaches underline graphics to the text as underline style', async () => {
    const doc = await PDFDocument.load(await underlined());
    const a = analyzePage(doc.getPage(0), 0);
    expect(a.graphics).toHaveLength(3);
    const blockOf = (t: string) => a.blocks.find((b) => b.lines[0]!.text.startsWith(t))!;

    const terms = blockOf('Terms');
    expect(terms.paragraphs[0]!.spans).toEqual([{ text: 'Terms apply', bold: false, italic: false, underline: true }]);
    expect(terms.runIds.filter((id) => id.includes(':g'))).toHaveLength(1);

    const visit = blockOf('Visit');
    expect(visit.paragraphs[0]!.spans.map((s) => [s.text, !!s.underline])).toEqual([
      ['Visit ', false],
      ['our site', true],
      [' today', false],
    ]);

    const cell = blockOf('Cell');
    expect(cell.runIds.some((id) => id.includes(':g'))).toBe(false);
    expect(cell.paragraphs[0]!.spans[0]!.underline).toBeFalsy();
  });

  it('removes the underline from the content along with its text', async () => {
    const doc = await PDFDocument.load(await underlined());
    const a = analyzePage(doc.getPage(0), 0);
    const terms = a.blocks.find((b) => b.lines[0]!.text.startsWith('Terms'))!;
    const out = removeRuns(a, new Set(terms.runIds));
    expect(out).not.toContain('(Terms apply)');
    expect(out).not.toMatch(/248\.2 l S/);
    // The other underline and the table rule stay.
    expect(out).toContain('re f');
    expect(out).toContain('390 92 l S');
    // Still a valid stream.
    expect(parseContentStream(out).map((o) => o.op).filter((op) => op === 'BT').length).toBe(3);
  });

  it('moves the underline with the text when the block is moved', async () => {
    const bytes = await underlined();
    const a = analyzePage((await PDFDocument.load(bytes)).getPage(0), 0);
    const terms = a.blocks.find((b) => b.lines[0]!.text.startsWith('Terms'))!;
    const frame: TextFrame = {
      id: 'moved',
      x: terms.x0 + 150,
      baseline: terms.firstBaseline - 20,
      width: 200,
      size: terms.size,
      lineHeight: terms.lineHeight,
      family: 'sans',
      color: [0, 0, 0],
      align: 'left',
      paragraphs: terms.paragraphs.map((p) => ({ spans: p.spans.map((s) => ({ ...s })) })),
    };
    const { bytes: out } = await exportEdited(bytes, { 0: { removedRuns: terms.runIds, frames: [frame] } });
    const after = analyzePage((await PDFDocument.load(out)).getPage(0), 0);
    const moved = after.blocks.find((b) => b.lines[0]!.text.startsWith('Terms'))!;
    expect(moved.x0).toBeCloseTo(170, 0);
    expect(moved.paragraphs[0]!.spans[0]!.underline).toBe(true);
    // Nothing is left at the old position.
    const old = after.graphics.flatMap((g) => g.segs).filter((s) => Math.abs(s.y0 - 248) < 2 && s.x0 < 30);
    expect(old).toHaveLength(0);
  });
});

describe('content the editor cannot decode', () => {
  // Page with three content streams; the middle one uses a filter pdf-lib
  // can't decode, so the editor can't read it.
  async function withUnreadableStream() {
    const { PDFName } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const key = page.node.newFontDictionary('F1', font.ref).decodeText();
    const ctx = doc.context;
    const readable1 = ctx.register(ctx.stream(`BT /${key} 12 Tf 20 150 Td (Hello ) Tj (World) Tj ET`));
    const unreadable = ctx.register(ctx.stream('0 0 1 rg 10 10 50 50 re f', { Filter: 'JBIG2Decode' }));
    const readable2 = ctx.register(ctx.stream(`BT /${key} 12 Tf 20 100 Td (After) Tj ET`));
    page.node.set(PDFName.of('Contents'), ctx.obj([readable1, unreadable, readable2]));
    return doc.save();
  }

  async function contentFilters(bytes: Uint8Array) {
    const { PDFName, PDFRawStream } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    const contents = doc.getPage(0).node.Contents()!;
    const list = 'asArray' in contents ? contents.asArray() : [contents];
    return list.map((ref) => {
      const s = doc.context.lookup(ref);
      return s instanceof PDFRawStream ? String(s.dict.get(PDFName.of('Filter'))) : '?';
    });
  }

  async function removeHello(bytes: Uint8Array) {
    const doc = await PDFDocument.load(bytes);
    const a = analyzePage(doc.getPage(0), 0);
    return a.runs.find((r) => r.text === 'Hello ')!.id;
  }

  it('marks the unreadable stream instead of silently dropping it', async () => {
    const doc = await PDFDocument.load(await withUnreadableStream());
    const a = analyzePage(doc.getPage(0), 0);
    expect(a.unresolved).toEqual([1]);
    expect(a.runs.map((r) => r.text)).toEqual(expect.arrayContaining(['Hello ', 'World', 'After']));
  });

  it("'keep' saves the unreadable stream unchanged, in its original position", async () => {
    const bytes = await withUnreadableStream();
    const id = await removeHello(bytes);
    const { bytes: out } = await exportEdited(bytes, { 0: { removedRuns: [id], frames: [] } }, { unresolved: 'keep' });
    const filters = await contentFilters(out);
    expect(filters).toHaveLength(3);
    expect(filters[1]).toBe('/JBIG2Decode');
    const text = (await pdfjsText(out)).map((t) => t.str).join(' ');
    expect(text).not.toContain('Hello');
    expect(text).toContain('World');
    expect(text).toContain('After');
  });

  it("'remove' leaves the unreadable stream out", async () => {
    const bytes = await withUnreadableStream();
    const id = await removeHello(bytes);
    const { bytes: out } = await exportEdited(bytes, { 0: { removedRuns: [id], frames: [] } }, { unresolved: 'remove' });
    expect(await contentFilters(out)).not.toContain('/JBIG2Decode');
    const text = (await pdfjsText(out)).map((t) => t.str).join(' ');
    expect(text).toContain('World');
    expect(text).toContain('After');
  });

  it('the session reports only edited pages whose content will be rewritten', async () => {
    const bytes = await withUnreadableStream();
    const id = await removeHello(bytes);
    const session = new EditSession(bytes);
    expect(await session.unresolvedContent({ 0: { removedRuns: [id], frames: [] } })).toEqual([{ page: 0, streams: 1 }]);
    // Only adding text doesn't rewrite the original content, so there's nothing to ask.
    expect(await session.unresolvedContent({ 0: { removedRuns: [], frames: [] } })).toEqual([]);
  });
});
