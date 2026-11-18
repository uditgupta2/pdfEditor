/**
 * Everything that needs pdf-lib lives behind this module so it can be loaded
 * lazily (only once the user starts editing or exports).
 */
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setCharacterSqueeze,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  setTextRise,
  setWordSpacing,
  showText,
  type PDFFont,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
import { loadFacesFor, type Face } from './faces';
import { loadFontkit } from './fontLibrary';
import { binaryToBytes, fmtNum, type Operand, type Operation } from './contentStream';
import { analyzePage, contentRefs, UNRESOLVED_MARKER_RE, type PageAnalysis, type TextRun } from './extract';
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

/**
 * What to do with content streams the editor could not decode when a page is
 * rewritten: `'keep'` puts the original streams back untouched, in their
 * original position; `'remove'` leaves them out of the saved page.
 */
export type UnresolvedPolicy = 'keep' | 'remove';

/**
 * Replace the page's content with `content` (as produced by `removeRuns`).
 * Undecodable streams appear in it as marker comments; with `'keep'` each
 * marker becomes the page's original stream at that position.
 */
export function setPageContent(doc: PDFDocument, page: PDFPage, content: string, policy: UnresolvedPolicy = 'keep') {
  const original = contentRefs(page);
  // Alternating: decoded text, original stream, decoded text, ... text.
  const texts: string[] = [];
  const kept: PDFObject[] = [];
  let pending = '';
  let cursor = 0;
  for (const m of content.matchAll(UNRESOLVED_MARKER_RE)) {
    pending += content.slice(cursor, m.index);
    cursor = m.index! + m[0].length;
    const ref = original[Number(m[1])];
    if (policy === 'keep' && ref) {
      texts.push(pending);
      kept.push(ref);
      pending = '';
    } else {
      pending += '\n'; // 'remove': the marker comment is dropped
    }
  }
  texts.push(pending + content.slice(cursor));

  // Wrap the whole page in q/Q so whatever state the original leaves behind
  // cannot affect text we add afterwards.
  const entries: PDFObject[] = [];
  texts.forEach((text, i) => {
    const body = `${i === 0 ? 'q\n' : ''}${text}${i === texts.length - 1 ? '\nQ\n' : ''}`;
    entries.push(doc.context.register(doc.context.flateStream(binaryToBytes(body))));
    if (i < kept.length) entries.push(kept[i]!);
  });
  page.node.set(PDFName.of('Contents'), entries.length === 1 ? entries[0]! : doc.context.obj(entries));
}

type FontCache = Map<string, PDFFont>;

async function standardFont(doc: PDFDocument, cache: FontCache, face: Extract<Face, { kind: 'std' }>) {
  const name = standardFontName(face.family, face.bold, face.italic) as unknown as StandardFonts;
  let f = cache.get(name);
  if (!f) {
    f = await doc.embedFont(name);
    cache.set(name, f);
  }
  return f;
}

/**
 * Embed a library font (subset to the characters used, unless its license
 * forbids subsetting). Ligatures and
 * kerning are off: layout measures character by character, and the PDF must
 * advance by exactly those widths.
 */
async function libraryFont(doc: PDFDocument, cache: FontCache, face: Extract<Face, { kind: 'lib' }>) {
  let f = cache.get(face.id);
  if (!f) {
    doc.registerFontkit((await loadFontkit()) as unknown as Parameters<PDFDocument['registerFontkit']>[0]);
    f = await doc.embedFont(face.face.bytes, {
      subset: face.face.subset,
      features: { liga: false, clig: false, dlig: false, calt: false, kern: false },
    });
    cache.set(face.id, f);
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
      const c = frag.color ?? frame.color;
      const x = frame.x + frag.x;
      const face = frag.face;
      if (face.kind === 'pdf') {
        if (frag.text.trim()) drawWithPageFont(page, face, frag.text, x, y, frame.size, c);
      } else if (face.kind === 'lib') {
        const font = await libraryFont(doc, cache, face);
        if (frag.text.trim()) page.drawText(frag.text, { x, y, size: frame.size, font, color: rgb(c[0], c[1], c[2]) });
      } else {
        const font = await standardFont(doc, cache, face);
        const text = toEncodable(frag.text);
        if (text !== frag.text) for (const ch of Array.from(frag.text)) if (!text.includes(ch)) warn.substituted.add(ch);
        if (text.trim()) page.drawText(text, { x, y, size: frame.size, font, color: rgb(c[0], c[1], c[2]) });
      }
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

/**
 * Write text with one of the page's own fonts, by its resource name. Layout
 * only gives a page font the characters it has glyphs for, so every character
 * here has a code; one that doesn't (a trailing space kept for an underline)
 * draws nothing anyway and is skipped.
 */
function drawWithPageFont(
  page: PDFPage,
  face: Extract<Face, { kind: 'pdf' }>,
  text: string,
  x: number,
  y: number,
  size: number,
  color: [number, number, number],
) {
  const { glyphs, codeBytes } = face.font;
  let hex = '';
  for (const ch of Array.from(text)) {
    const g = glyphs[ch];
    if (g) hex += g[0].toString(16).padStart(codeBytes * 2, '0');
  }
  if (!hex) return;
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setFillingRgbColor(color[0], color[1], color[2]),
    setFontAndSize(face.key, size),
    // Text state survives BT/ET; reset what the original content may have left behind.
    setCharacterSpacing(0),
    setWordSpacing(0),
    setCharacterSqueeze(100),
    setTextRise(0),
    setTextRenderingMode(TextRenderingMode.Fill),
    setTextMatrix(1, 0, 0, 1, x, y),
    showText(PDFHexString.of(hex)),
    endText(),
    popGraphicsState(),
  );
}

export async function applyPageEdits(
  doc: PDFDocument,
  page: PDFPage,
  pageIndex: number,
  edits: PageEdits,
  warn: DrawWarnings,
  policy: UnresolvedPolicy = 'keep',
) {
  if (edits.removedRuns.length) {
    const analysis = analyzePage(page, pageIndex);
    setPageContent(doc, page, removeRuns(analysis, new Set(edits.removedRuns)), policy);
  }
  const cache: FontCache = new Map();
  await loadFacesFor(edits.frames);
  for (const frame of edits.frames) await drawFrame(doc, page, frame, cache, warn);
}

export interface ExportOptions {
  /** What to do with undecodable content streams on rewritten pages. Default `'keep'`. */
  unresolved?: UnresolvedPolicy;
}

export async function exportEdited(bytes: Uint8Array, edits: DocumentEdits, options: ExportOptions = {}) {
  const doc = await loadForEditing(bytes);
  const warn: DrawWarnings = { substituted: new Set() };
  const pages = doc.getPages();
  for (const [key, pageEdits] of Object.entries(edits)) {
    const page = pages[Number(key)];
    if (page) await applyPageEdits(doc, page, Number(key), pageEdits, warn, options.unresolved);
  }
  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out, substituted: [...warn.substituted] };
}

/**
 * A one-page PDF containing page `index` with its edits applied: the removed
 * runs gone and the frames drawn, in the same fonts the export uses. The
 * viewer renders it underneath the (then transparent) HTML frames.
 */
export async function buildEditedPage(source: PDFDocument, index: number, analysis: PageAnalysis, edits: PageEdits) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const [copy] = await doc.copyPages(source, [index]);
  doc.addPage(copy);
  // The preview always keeps undecodable streams, so it matches the viewer.
  if (edits.removedRuns.length) setPageContent(doc, copy!, removeRuns(analysis, new Set(edits.removedRuns)), 'keep');
  const cache: FontCache = new Map();
  const warn: DrawWarnings = { substituted: new Set() };
  await loadFacesFor(edits.frames);
  for (const frame of edits.frames) await drawFrame(doc, copy!, frame, cache, warn);
  return doc.save({ useObjectStreams: false });
}
