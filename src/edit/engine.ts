/**
 * Everything that needs pdf-lib lives behind this module so it can be loaded
 * lazily (only once the user starts editing or exports).
 */
import { PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { binaryToBytes, fmtNum, type Operand, type Operation } from './contentStream';
import { analyzePage, type PageAnalysis, type TextRun } from './extract';
import { layoutFrame } from './layout';
import { standardFontName, toEncodable } from './metrics';
import type { DocumentEdits, PageEdits, TextFrame } from './model';

export { analyzePage };
export type { PageAnalysis };

export async function loadForEditing(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return doc;
}

/** Permission flags in the encryption dictionary's /P (ISO 32000-1 table 22). */
const PERMISSIONS: [flag: number, action: string][] = [
  [8, 'changing its content'],
  [16, 'copying text'],
  [32, 'adding comments'],
  [4, 'printing'],
];

/**
 * What the owner's permission settings forbid, for display. A file can carry
 * these restrictions and still open without a password, if only its owner
 * password is set. Viewers then open it normally, but it is encrypted all the same.
 */
export function forbiddenActions(doc: PDFDocument): string[] {
  const encrypt = doc.context.lookup(doc.context.trailerInfo.Encrypt);
  if (!(encrypt instanceof PDFDict)) return [];
  const permissions = encrypt.lookup(PDFName.of('P'));
  if (!(permissions instanceof PDFNumber)) return [];
  const flags = permissions.asNumber();
  return PERMISSIONS.filter(([flag]) => (flags & flag) === 0).map(([, action]) => action);
}

/**
 * Rewrite the content stream with the given items removed. Removed strings are
 * replaced by an equivalent horizontal move, so any text that follows in the
 * same text object stays exactly where it was. Removed graphics (underlines
 * that belong to edited text) are dropped with their whole path.
 */
export function removeRuns(analysis: PageAnalysis, removed: Set<string>): string {
  const { content, ops } = analysis;
  const byOp = new Map<number, TextRun[]>();
  for (const r of analysis.runs) {
    if (!removed.has(r.id)) continue;
    const list = byOp.get(r.opIndex) ?? [];
    list.push(r);
    byOp.set(r.opIndex, list);
  }
  const patches: { start: number; end: number; text: string }[] = [];
  for (const [opIndex, runs] of byOp) {
    const op = ops[opIndex]!;
    patches.push({ start: op.start, end: op.end, text: rewriteShow(op, new Map(runs.map((r) => [r.segIndex, r]))) });
  }
  for (const g of analysis.graphics) {
    if (removed.has(g.id)) patches.push({ start: ops[g.startOp]!.start, end: ops[g.endOp]!.end, text: '' });
  }
  if (!patches.length) return content;

  patches.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const p of patches) {
    if (p.start < cursor) continue; // overlapping patches can't happen, but never corrupt the stream
    out += content.slice(cursor, p.start) + p.text;
    cursor = p.end;
  }
  out += content.slice(cursor);
  return out;
}

function spacer(run: TextRun): string {
  if (!run.tfsTh) return '';
  return fmtNum((-run.advance / run.tfsTh) * 1000);
}

function rewriteShow(op: Operation, removed: Map<number, TextRun>): string {
  const items: Operand[] =
    op.op === 'TJ' ? (op.operands[0]?.type === 'arr' ? op.operands[0].items : []) : op.op === '"' ? op.operands.slice(2, 3) : op.operands.slice(0, 1);
  const parts: string[] = [];
  let seg = 0;
  for (const it of items) {
    if (it.type === 'str') {
      const r = removed.get(seg);
      if (r) {
        const s = spacer(r);
        if (s && s !== '0') parts.push(s);
      } else parts.push(it.raw);
      seg++;
    } else if (it.type === 'num') parts.push(it.raw);
  }
  const tj = parts.length ? `[${parts.join(' ')}] TJ` : '';
  if (op.op === "'") return `T* ${tj}`;
  if (op.op === '"') return `${op.operands[0]?.raw ?? '0'} Tw ${op.operands[1]?.raw ?? '0'} Tc T* ${tj}`;
  return tj;
}

function setPageContent(doc: PDFDocument, page: PDFPage, content: string) {
  // Wrap in q/Q so whatever state the original leaves behind cannot affect
  // text we add afterwards.
  const stream = doc.context.flateStream(binaryToBytes(`q\n${content}\nQ\n`));
  page.node.set(PDFName.of('Contents'), doc.context.register(stream));
}

type FontCache = Map<string, PDFFont>;

async function fontFor(doc: PDFDocument, cache: FontCache, frame: TextFrame, bold: boolean, italic: boolean) {
  const name = standardFontName(frame.family, bold, italic) as unknown as StandardFonts;
  let f = cache.get(name);
  if (!f) {
    f = await doc.embedFont(name);
    cache.set(name, f);
  }
  return f;
}

export interface DrawWarnings {
  /** Characters that had to be substituted because the standard fonts lack them. */
  substituted: Set<string>;
}

export async function drawFrame(doc: PDFDocument, page: PDFPage, frame: TextFrame, cache: FontCache, warn: DrawWarnings) {
  const layout = layoutFrame(frame);
  for (const line of layout.lines) {
    const y = frame.baseline - line.dy;
    for (const frag of line.fragments) {
      const font = await fontFor(doc, cache, frame, !!frag.bold, !!frag.italic);
      const text = toEncodable(frag.text);
      if (text !== frag.text) for (const ch of Array.from(frag.text)) if (!text.includes(ch)) warn.substituted.add(ch);
      const c = frag.color ?? frame.color;
      const x = frame.x + frag.x;
      if (text.trim()) page.drawText(text, { x, y, size: frame.size, font, color: rgb(c[0], c[1], c[2]) });
      if (frag.underline) {
        const thickness = Math.max(0.5, frame.size * 0.06);
        page.drawLine({
          start: { x, y: y - frame.size * 0.12 },
          end: { x: x + frag.width, y: y - frame.size * 0.12 },
          thickness,
          color: rgb(c[0], c[1], c[2]),
        });
      }
    }
  }
}

export async function applyPageEdits(doc: PDFDocument, page: PDFPage, pageIndex: number, edits: PageEdits, warn: DrawWarnings) {
  if (edits.removedRuns.length) {
    const analysis = analyzePage(page, pageIndex);
    setPageContent(doc, page, removeRuns(analysis, new Set(edits.removedRuns)));
  }
  const cache: FontCache = new Map();
  for (const frame of edits.frames) await drawFrame(doc, page, frame, cache, warn);
}

export async function exportEdited(bytes: Uint8Array, edits: DocumentEdits) {
  const doc = await loadForEditing(bytes);
  const warn: DrawWarnings = { substituted: new Set() };
  const pages = doc.getPages();
  for (const [key, pageEdits] of Object.entries(edits)) {
    const page = pages[Number(key)];
    if (page) await applyPageEdits(doc, page, Number(key), pageEdits, warn);
  }
  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out, substituted: [...warn.substituted] };
}

/**
 * A one-page PDF containing page `index` with the given runs removed — used
 * to render the page underneath the live text frames.
 */
export async function buildPageWithoutRuns(source: PDFDocument, index: number, analysis: PageAnalysis, removed: string[]) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const [copy] = await doc.copyPages(source, [index]);
  doc.addPage(copy);
  setPageContent(doc, copy!, removeRuns(analysis, new Set(removed)));
  return doc.save({ useObjectStreams: false });
}
