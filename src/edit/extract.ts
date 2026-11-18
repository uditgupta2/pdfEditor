import { PDFDict, PDFName, type PDFContext, type PDFObject, type PDFPage } from 'pdf-lib';
import { parseContentStream, type Operand, type Operation } from './contentStream';
import { fontFamilyName, loadFontInfo, resolve, streamText, stripSubset, type FontInfo, type FontStyle } from './fonts';
import type { PdfFont } from './model';

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 × m2 (PDF row-vector convention). */
export function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

export type RGB = [number, number, number];

/** One string inside a Tj/TJ/'/" operator. The unit we can remove. */
export interface TextRun {
  id: string;
  opIndex: number;
  /** Index of the string within a TJ array (0 for Tj). */
  segIndex: number;
  text: string;
  /** Per-character x start/end (page space), parallel to `text`'s chars. */
  charX: { ch: string; x0: number; x1: number }[];
  x0: number;
  x1: number;
  baseline: number;
  /** Font size in page space. */
  size: number;
  fontKey: string;
  style: FontStyle;
  color: RGB;
  /** Horizontal advance in unscaled text space (used to keep positions when removed). */
  advance: number;
  /** Tfs*Th at the time, to convert advance to TJ units. */
  tfsTh: number;
  upright: boolean;
  editable: boolean;
}

export interface TextLine {
  runs: TextRun[];
  text: string;
  x0: number;
  x1: number;
  baseline: number;
  size: number;
  /** Page-space x ranges of drawn underlines that belong to this line. */
  underlines?: [number, number][];
}

/**
 * A painted path (from its first construction operator to its painting
 * operator) made only of thin horizontal bars or lines: a candidate underline.
 * Many PDF producers draw underlines as separate graphics rather than as part
 * of the text, so they have to be found and moved together with the text.
 */
export interface GraphicItem {
  id: string;
  startOp: number;
  endOp: number;
  /** Bounding boxes of the subpaths, page space (y up). */
  segs: { x0: number; x1: number; y0: number; y1: number }[];
}

export type Align = 'left' | 'center' | 'right' | 'justify';

export interface StyledSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: RGB;
  /** `pdf:<key>` when the span's page font can be written with. */
  font?: string;
}

export interface Paragraph {
  spans: StyledSpan[];
}

export interface TextBlock {
  id: string;
  /** Content items that make up this block: text runs plus any underline graphics. */
  runIds: string[];
  lines: TextLine[];
  paragraphs: Paragraph[];
  /** Box in page space (y up). */
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  firstBaseline: number;
  size: number;
  lineHeight: number;
  family: FontStyle['family'];
  /** Most used writable page font (`pdf:<key>`), if any. */
  font?: string;
  color: RGB;
  align: Align;
  editable: boolean;
}

export interface PageAnalysis {
  runs: TextRun[];
  /** Underline-like graphics (see GraphicItem). */
  graphics: GraphicItem[];
  blocks: TextBlock[];
  /** Concatenated, decoded content stream (binary string). */
  content: string;
  ops: Operation[];
  /**
   * Positions (in the page's /Contents list) of streams that could not be
   * decoded. Each sits in `content` as an `unresolvedMarker(position)` comment,
   * so rewriting the page can put the original stream back in the same place.
   */
  unresolved: number[];
  /** Page fonts new text can be written in, by resource name, with the characters each can draw. */
  fonts: Record<string, PdfFont>;
}

/** PDF comment line standing in for an undecodable content stream. */
export const unresolvedMarker = (position: number) => `\n%rpe-unresolved:${position}\n`;
export const UNRESOLVED_MARKER_RE = /\n%rpe-unresolved:(\d+)\n/g;

interface GState {
  ctm: Matrix;
  fill: RGB;
  lineWidth: number;
}

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  x * m[0] + y * m[2] + m[4],
  x * m[1] + y * m[3] + m[5],
];

function n(o: Operand | undefined): number {
  return o && o.type === 'num' ? o.value : 0;
}

function colorFrom(ops: Operand[], op: string): RGB | null {
  const v = ops.filter((o) => o.type === 'num').map((o) => (o as { value: number }).value);
  if (op === 'g') return [v[0] ?? 0, v[0] ?? 0, v[0] ?? 0];
  if (op === 'rg') return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
  if (op === 'k') {
    const [c = 0, m = 0, y = 0, k = 0] = v;
    return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  // sc/scn: guess by component count
  if (v.length === 1) return [v[0]!, v[0]!, v[0]!];
  if (v.length === 3) return [v[0]!, v[1]!, v[2]!];
  if (v.length === 4) return colorFrom(ops, 'k');
  return null;
}

/** The page's /Contents entries, in order. */
export function contentRefs(page: PDFPage): PDFObject[] {
  const contents = page.node.Contents();
  if (!contents) return [];
  return 'asArray' in contents && typeof (contents as { asArray?: unknown }).asArray === 'function'
    ? (contents as unknown as { asArray(): PDFObject[] }).asArray()
    : [contents as unknown as PDFObject];
}

/**
 * Read the page's content streams as one decoded binary string. A stream that
 * can't be decoded is replaced by a marker comment (see `unresolvedMarker`)
 * and its position is listed in `unresolved`.
 */
export function readPageContent(page: PDFPage): { content: string; unresolved: number[] } {
  const context = page.doc.context;
  const parts: string[] = [];
  const unresolved: number[] = [];
  contentRefs(page).forEach((ref, position) => {
    const text = streamTextSafe(context, ref as Parameters<typeof streamText>[1]);
    if (text != null) parts.push(text);
    else {
      unresolved.push(position);
      parts.push(unresolvedMarker(position));
    }
  });
  return { content: parts.join('\n'), unresolved };
}

function streamTextSafe(context: PDFContext, obj: Parameters<typeof streamText>[1]) {
  try {
    return streamText(context, obj);
  } catch {
    return null;
  }
}

export function analyzePage(page: PDFPage, pageIndex: number): PageAnalysis {
  const context = page.doc.context;
  const { content, unresolved } = readPageContent(page);
  const ops = parseContentStream(content);

  const resources = page.node.Resources();
  const fontDict = resources ? resolve(context, resources.get(PDFName.of('Font'))) : undefined;
  const fontCache = new Map<string, FontInfo>();
  const getFont = (key: string): FontInfo => {
    let f = fontCache.get(key);
    if (!f) {
      f = loadFontInfo(context, fontDict instanceof PDFDict ? fontDict.get(PDFName.of(key)) : undefined);
      fontCache.set(key, f);
    }
    return f;
  };

  const runs: TextRun[] = [];
  const usedCodes = new Map<string, Set<number>>();
  const stack: GState[] = [];
  let gs: GState = { ctm: IDENTITY, fill: [0, 0, 0], lineWidth: 1 };
  const graphics: GraphicItem[] = [];
  // Current path: subpaths as page-space points.
  let pathStart = -1;
  let subpaths: [number, number][][] = [];
  let clipping = false;
  const resetPath = () => {
    pathStart = -1;
    subpaths = [];
    clipping = false;
  };
  const pathPoint = (i: number, x: number, y: number, newSub: boolean) => {
    if (pathStart < 0) pathStart = i;
    const p = apply(gs.ctm, x, y);
    if (newSub || !subpaths.length) subpaths.push([p]);
    else subpaths[subpaths.length - 1]!.push(p);
  };
  const paint = (i: number, op: string) => {
    const start = pathStart;
    const subs = subpaths;
    const clip = clipping;
    resetPath();
    if (start < 0 || clip || !subs.length) return;
    const stroke = op === 'S' || op === 's';
    const fill = op === 'f' || op === 'F' || op === 'f*';
    if (!stroke && !fill) return;
    // Stroke width in page space (assumes no skew, true for underlines).
    const half = (gs.lineWidth * Math.hypot(gs.ctm[2], gs.ctm[3])) / 2;
    const segs: GraphicItem['segs'] = [];
    for (const pts of subs) {
      if (pts.length < 2) continue; // a bare moveto draws nothing
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      let seg = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      if (stroke) {
        if (seg.y1 - seg.y0 > 0.5) return; // not a horizontal line
        seg = { ...seg, y0: seg.y0 - half, y1: seg.y1 + half };
      } else if (pts.length < 3) continue; // fills ignore degenerate subpaths
      if (seg.x1 - seg.x0 < 1 || seg.y1 - seg.y0 > 6 || seg.x1 - seg.x0 < (seg.y1 - seg.y0) * 3) return;
      segs.push(seg);
    }
    if (segs.length) graphics.push({ id: `${pageIndex}:g${i}`, startOp: start, endOp: i, segs });
  };
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let tc = 0;
  let tw = 0;
  let th = 1;
  let tl = 0;
  let ts = 0;
  let fontKey = '';
  let tfs = 0;
  let font: FontInfo | null = null;

  const nextLine = () => {
    tlm = mul([1, 0, 0, 1, 0, -tl], tlm);
    tm = tlm;
  };

  const show = (opIndex: number, items: Operand[]) => {
    if (!font) return;
    let segIndex = 0;
    for (const item of items) {
      if (item.type === 'num') {
        const tx = (-item.value / 1000) * tfs * th;
        tm = mul([1, 0, 0, 1, tx, 0], tm);
        continue;
      }
      if (item.type !== 'str') continue;
      const codes = font.codes(item.bytes);
      let used = usedCodes.get(fontKey);
      if (!used) usedCodes.set(fontKey, (used = new Set()));
      for (const c of codes) used.add(c);
      const charX: TextRun['charX'] = [];
      let text = '';
      let advance = 0;
      const trmStart = mul(mul([tfs * th, 0, 0, tfs, 0, ts], tm), gs.ctm);
      for (const code of codes) {
        const w0 = font.width(code) / 1000;
        const trm = mul(mul([tfs * th, 0, 0, tfs, 0, ts], tm), gs.ctm);
        const tx = (w0 * tfs + tc + (font.isSpace(code) ? tw : 0)) * th;
        const next = mul([1, 0, 0, 1, tx, 0], tm);
        const trmEnd = mul(mul([tfs * th, 0, 0, tfs, 0, ts], next), gs.ctm);
        const ch = font.unicode(code);
        text += ch;
        for (const c of Array.from(ch)) charX.push({ ch: c, x0: trm[4], x1: trmEnd[4] });
        tm = next;
        advance += tx;
      }
      const end = mul(mul([tfs * th, 0, 0, tfs, 0, ts], tm), gs.ctm);
      const sizeY = Math.hypot(trmStart[2], trmStart[3]);
      const upright =
        Math.abs(trmStart[1]) < 1e-3 * Math.abs(trmStart[0]) &&
        Math.abs(trmStart[2]) < 1e-3 * Math.abs(trmStart[3]) &&
        trmStart[0] > 0 &&
        trmStart[3] > 0;
      runs.push({
        id: `${pageIndex}:${opIndex}:${segIndex}`,
        opIndex,
        segIndex,
        text,
        charX,
        x0: trmStart[4],
        x1: end[4],
        baseline: trmStart[5],
        size: sizeY,
        fontKey,
        style: font.style,
        color: gs.fill,
        advance,
        tfsTh: tfs * th,
        upright,
        editable: font.editable && upright && tfs !== 0,
      });
      segIndex++;
    }
  };

  ops.forEach((o, i) => {
    const a = o.operands;
    switch (o.op) {
      case 'q':
        stack.push({ ...gs });
        break;
      case 'Q':
        gs = stack.pop() ?? gs;
        break;
      case 'w':
        gs = { ...gs, lineWidth: n(a[0]) };
        break;
      case 'm':
        pathPoint(i, n(a[0]), n(a[1]), true);
        break;
      case 'l':
        pathPoint(i, n(a[0]), n(a[1]), false);
        break;
      case 'c':
        pathPoint(i, n(a[4]), n(a[5]), false);
        break;
      case 'v':
      case 'y':
        pathPoint(i, n(a[2]), n(a[3]), false);
        break;
      case 're': {
        const [x, y, w, h] = [n(a[0]), n(a[1]), n(a[2]), n(a[3])];
        pathPoint(i, x, y, true);
        pathPoint(i, x + w, y, false);
        pathPoint(i, x + w, y + h, false);
        pathPoint(i, x, y + h, false);
        break;
      }
      case 'h':
        break;
      case 'W':
      case 'W*':
        clipping = true;
        break;
      case 'S':
      case 's':
      case 'f':
      case 'F':
      case 'f*':
      case 'B':
      case 'B*':
      case 'b':
      case 'b*':
      case 'n':
        paint(i, o.op);
        break;
      case 'cm':
        gs = { ...gs, ctm: mul([n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5])], gs.ctm) };
        break;
      case 'g':
      case 'rg':
      case 'k':
      case 'sc':
      case 'scn': {
        const c = colorFrom(a, o.op);
        if (c) gs = { ...gs, fill: c };
        break;
      }
      case 'BT':
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case 'Tf': {
        const name = a[0];
        fontKey = name && name.type === 'name' ? name.value : '';
        tfs = n(a[1]);
        font = getFont(fontKey);
        break;
      }
      case 'Tc':
        tc = n(a[0]);
        break;
      case 'Tw':
        tw = n(a[0]);
        break;
      case 'Tz':
        th = n(a[0]) / 100;
        break;
      case 'TL':
        tl = n(a[0]);
        break;
      case 'Ts':
        ts = n(a[0]);
        break;
      case 'Td':
        tlm = mul([1, 0, 0, 1, n(a[0]), n(a[1])], tlm);
        tm = tlm;
        break;
      case 'TD':
        tl = -n(a[1]);
        tlm = mul([1, 0, 0, 1, n(a[0]), n(a[1])], tlm);
        tm = tlm;
        break;
      case 'Tm':
        tlm = [n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5])];
        tm = tlm;
        break;
      case 'T*':
        nextLine();
        break;
      case 'Tj':
        show(i, a.slice(0, 1));
        break;
      case 'TJ':
        show(i, a[0]?.type === 'arr' ? a[0].items : []);
        break;
      case "'":
        nextLine();
        show(i, a.slice(0, 1));
        break;
      case '"':
        tw = n(a[0]);
        tc = n(a[1]);
        nextLine();
        show(i, a.slice(2, 3));
        break;
    }
  });

  const fonts = writableFonts(fontCache, usedCodes);
  const fontOf = (r: TextRun) => (fonts[r.fontKey] ? `pdf:${r.fontKey}` : undefined);
  const blocks = groupBlocks(runs.filter((r) => r.text.trim().length > 0 || r.text.length > 0), graphics, pageIndex, fontOf);
  return { runs, graphics, blocks, content, ops, unresolved, fonts };
}

/**
 * The page fonts new text can be written in, and which characters each can
 * draw. For an embedded TrueType program the glyphs are looked up in the
 * program itself, so a subset offers every character the *document* uses, not
 * only this page's. Otherwise a subset font offers only the codes seen on this
 * page, and a complete (or non-embedded) font every character its encoding maps.
 */
function writableFonts(cache: Map<string, FontInfo>, usedCodes: Map<string, Set<number>>): Record<string, PdfFont> {
  const out: Record<string, PdfFont> = {};
  for (const [key, info] of cache) {
    if (!info.writable || !info.editable) continue;
    const used = usedCodes.get(key) ?? new Set<number>();
    const check = info.embedded ? trustedGlyphCheck(info, used) : null;
    // Codes the page uses come first, so they win when two codes map to one character.
    const candidates = info.embedded && info.subset && !check ? [...used] : [...new Set([...used, ...info.allCodes()])];
    const glyphs: PdfFont['glyphs'] = {};
    for (const code of candidates) {
      const ch = info.unicode(code);
      if (Array.from(ch).length !== 1 || ch < ' ' || glyphs[ch]) continue;
      const w = info.width(code);
      if (!used.has(code)) {
        if (check) {
          const state = check(code);
          if (state === 'missing' || (state === 'blank' && !/\s/.test(ch))) continue;
        } else if (info.embedded && !(w > 0) && ch !== ' ') continue; // no width: most likely a missing glyph
      }
      glyphs[ch] = [code, w];
    }
    if (!Object.keys(glyphs).length) continue;
    out[key] = {
      name: stripSubset(info.baseName),
      familyName: fontFamilyName(info.baseName),
      family: info.style.family,
      bold: info.style.bold,
      italic: info.style.italic,
      codeBytes: info.codeBytes,
      glyphs,
    };
  }
  return out;
}

/**
 * The font program's glyph check, if it agrees with what the page draws: every
 * code the page shows with a visible character must have an outline. If not,
 * our code → glyph mapping is wrong for this font, and trusting it could draw
 * the wrong glyphs, so it isn't used.
 */
function trustedGlyphCheck(info: FontInfo, used: Set<number>) {
  const check = info.glyphCheck();
  if (!check) return null;
  let seen = 0;
  for (const code of used) {
    const ch = info.unicode(code);
    if (!ch || /^\s+$/.test(ch)) continue;
    if (check(code) !== 'drawn') return null;
    seen++;
  }
  return seen ? check : null;
}

// ---------------------------------------------------------------------------
// Geometry → lines → blocks

function buildLines(runs: TextRun[]): TextLine[] {
  const lines: TextLine[] = [];
  for (const r of runs) {
    if (!r.upright || r.size <= 0) continue;
    let target: TextLine | undefined;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) {
      const l = lines[i]!;
      const tol = Math.max(l.size, r.size);
      if (Math.abs(l.baseline - r.baseline) > tol * 0.25) continue;
      // Same line if horizontally adjacent (gaps > ~1.2em mean separate columns/cells).
      if (r.x0 >= l.x1 - tol * 0.3 && r.x0 <= l.x1 + tol * 1.2) {
        target = l;
        break;
      }
    }
    if (target) {
      target.runs.push(r);
      target.x1 = Math.max(target.x1, r.x1);
      target.x0 = Math.min(target.x0, r.x0);
      target.size = Math.max(target.size, r.size);
    } else {
      lines.push({ runs: [r], text: '', x0: r.x0, x1: r.x1, baseline: r.baseline, size: r.size });
    }
  }
  for (const l of lines) {
    l.runs.sort((a, b) => a.x0 - b.x0);
    l.text = joinRuns(l.runs).map((s) => s.text).join('');
    l.x1 = Math.max(...l.runs.map((r) => r.x1));
    // Trailing spaces inflate the right edge; trim using char positions.
    const lastRun = l.runs[l.runs.length - 1]!;
    const visible = lastRun.charX.filter((c) => c.ch.trim());
    if (visible.length) l.x1 = Math.max(l.x0, visible[visible.length - 1]!.x1);
  }
  return lines.filter((l) => l.text.trim().length > 0);
}

/**
 * Runs → spans, inserting spaces where there is a visible gap. Characters
 * whose centre lies inside one of `underlines` (page-space x ranges) get the
 * underline style, so a run can split into several spans.
 */
function joinRuns(
  runs: TextRun[],
  underlines: [number, number][] = [],
  fontOf: (r: TextRun) => string | undefined = () => undefined,
): (StyledSpan & { run: TextRun })[] {
  const under = (x: number) => underlines.some(([a, b]) => x >= a - 0.5 && x <= b + 0.5);
  const out: (StyledSpan & { run: TextRun })[] = [];
  const push = (r: TextRun, text: string, underline: boolean) => {
    const last = out[out.length - 1];
    if (last && last.run === r && !!last.underline === underline) last.text += text;
    else {
      const font = fontOf(r);
      out.push({
        text,
        bold: r.style.bold,
        italic: r.style.italic,
        ...(underline ? { underline } : {}),
        color: r.color,
        ...(font ? { font } : {}),
        run: r,
      });
    }
  };
  let prev: TextRun | null = null;
  for (const r of runs) {
    if (prev) {
      const gap = r.x0 - prev.x1;
      if (gap > r.size * 0.15 && !/\s$/.test(prev.text) && !/^\s/.test(r.text)) push(r, ' ', under((prev.x1 + r.x0) / 2));
    }
    const chars = Array.from(r.text);
    if (!underlines.length || chars.length !== r.charX.length) push(r, r.text, !!underlines.length && under((r.x0 + r.x1) / 2));
    else chars.forEach((ch, i) => push(r, ch, under((r.charX[i]!.x0 + r.charX[i]!.x1) / 2)));
    prev = r;
  }
  return out;
}

/**
 * Attach underline graphics to the text lines they sit under. Returns, per
 * graphic id, the lines it was attached to.
 */
function matchUnderlines(lines: TextLine[], graphics: GraphicItem[]) {
  const matches = new Map<string, TextLine[]>();
  for (const g of graphics) {
    const hit: TextLine[] = [];
    for (const seg of g.segs) {
      const mid = (seg.y0 + seg.y1) / 2;
      const line = lines.find((l) => {
        const s = l.size;
        return (
          seg.y1 - seg.y0 <= Math.max(1.5, s * 0.2) &&
          mid <= l.baseline + s * 0.02 &&
          mid >= l.baseline - s * 0.4 &&
          seg.x0 >= l.x0 - s * 0.6 &&
          seg.x1 <= l.x1 + s * 0.6 &&
          Math.min(seg.x1, l.x1) - Math.max(seg.x0, l.x0) > s * 0.2
        );
      });
      if (!line) break;
      hit.push(line);
    }
    if (hit.length === g.segs.length) matches.set(g.id, hit);
  }
  return matches;
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function sameColor(a?: RGB, b?: RGB) {
  if (!a || !b) return a === b;
  return Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01 && Math.abs(a[2] - b[2]) < 0.01;
}

function mergeSpans(spans: StyledSpan[]): StyledSpan[] {
  const out: StyledSpan[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (
      last &&
      !!last.bold === !!s.bold &&
      !!last.italic === !!s.italic &&
      !!last.underline === !!s.underline &&
      last.font === s.font &&
      sameColor(last.color, s.color)
    ) {
      last.text += s.text;
    } else out.push({ ...s });
  }
  return out;
}

function groupBlocks(
  runs: TextRun[],
  graphics: GraphicItem[],
  pageIndex: number,
  fontOf: (r: TextRun) => string | undefined,
): TextBlock[] {
  const lines = buildLines(runs).sort((a, b) => b.baseline - a.baseline || a.x0 - b.x0);
  const underlineMatches = matchUnderlines(lines, graphics);
  const groups: TextLine[][] = [];

  for (const line of lines) {
    let best: TextLine[] | undefined;
    for (const g of groups) {
      const last = g[g.length - 1]!;
      const sizeRatio = line.size / last.size;
      if (sizeRatio < 0.8 || sizeRatio > 1.25) continue;
      const gap = last.baseline - line.baseline;
      if (gap < last.size * 0.8 || gap > last.size * 2.0) continue;
      if (g.length >= 2) {
        const spacing = g[g.length - 2]!.baseline - last.baseline;
        if (Math.abs(gap - spacing) > spacing * 0.3) continue;
      }
      // must overlap horizontally with the block
      const gx0 = Math.min(...g.map((l) => l.x0));
      const gx1 = Math.max(...g.map((l) => l.x1));
      const overlap = Math.min(gx1, line.x1) - Math.max(gx0, line.x0);
      if (overlap <= 0) continue;
      if (Math.abs(line.x0 - gx0) > last.size * 4 && Math.abs((line.x0 + line.x1) / 2 - (gx0 + gx1) / 2) > last.size * 2) continue;
      best = g;
      break;
    }
    if (best) best.push(line);
    else groups.push([line]);
  }

  // A graphic is moved with a block only if all of it belongs to that block;
  // one path underlining text in two blocks is left where it is.
  const graphicIds = groups.map(() => [] as string[]);
  for (const g of graphics) {
    const hit = underlineMatches.get(g.id);
    if (!hit) continue;
    const owner = groups.findIndex((grp) => grp.includes(hit[0]!));
    if (owner < 0 || !hit.every((l) => groups[owner]!.includes(l))) continue;
    graphicIds[owner]!.push(g.id);
    g.segs.forEach((seg, i) => (hit[i]!.underlines ??= []).push([seg.x0, seg.x1]));
  }

  return groups.map((g, gi) => {
    const block = toBlock(g, `${pageIndex}:b${gi}`, fontOf);
    block.runIds.push(...graphicIds[gi]!);
    return block;
  });
}

function toBlock(lines: TextLine[], id: string, fontOf: (r: TextRun) => string | undefined): TextBlock {
  const x0 = Math.min(...lines.map((l) => l.x0));
  const x1 = Math.max(...lines.map((l) => l.x1));
  const size = median(lines.map((l) => l.size));
  const lineHeight =
    lines.length > 1 ? (lines[0]!.baseline - lines[lines.length - 1]!.baseline) / (lines.length - 1) : size * 1.2;
  const width = x1 - x0;

  // Alignment from edge statistics (ignore the last line for justify/left).
  let align: Align = 'left';
  if (lines.length > 1) {
    const tol = size * 0.5;
    const lefts = lines.map((l) => l.x0);
    const rights = lines.map((l) => l.x1);
    const leftAligned = lefts.every((v) => Math.abs(v - x0) < tol);
    const rightAligned = rights.every((v) => Math.abs(v - x1) < tol);
    const centered = lines.every((l) => Math.abs((l.x0 + l.x1) / 2 - (x0 + x1) / 2) < tol);
    const bodyRightAligned = rights.slice(0, -1).every((v) => Math.abs(v - x1) < tol);
    if (leftAligned && bodyRightAligned && lines.length > 2 && !rightAligned) align = 'justify';
    else if (leftAligned && rightAligned) align = lines.length > 2 ? 'justify' : 'left';
    else if (centered && !leftAligned) align = 'center';
    else if (rightAligned && !leftAligned) align = 'right';
  }

  // Soft wrap vs hard break: if the next line's first word would have fit on
  // this line, the author must have pressed Enter.
  const paragraphs: Paragraph[] = [];
  let current: StyledSpan[] = [];
  lines.forEach((line, i) => {
    const spans = joinRuns(line.runs, line.underlines, fontOf).map(({ run: _run, ...s }) => s);
    if (i > 0) {
      const prev = lines[i - 1]!;
      const firstWord = line.runs[0]!.charX;
      let wordEnd = firstWord.findIndex((c) => !c.ch.trim());
      if (wordEnd < 0) wordEnd = firstWord.length;
      const wordWidth = wordEnd > 0 ? firstWord[wordEnd - 1]!.x1 - firstWord[0]!.x0 : 0;
      const space = size * 0.28;
      const room = x0 + width - prev.x1;
      const hard = align !== 'center' && align !== 'right' && room > wordWidth + space + size * 0.1;
      if (hard || align === 'center' || align === 'right') {
        paragraphs.push({ spans: mergeSpans(current) });
        current = [];
      } else {
        const last = current[current.length - 1];
        const endsWithHyphen = last && /[-­]$/.test(last.text);
        if (last && endsWithHyphen && /­$/.test(last.text)) last.text = last.text.slice(0, -1);
        else if (last && !/\s$/.test(last.text) && !endsWithHyphen) {
          const underline = !!last.underline && !!spans[0]!.underline;
          const { underline: _u, ...style } = spans[0]!;
          current.push({ ...style, ...(underline ? { underline } : {}), text: ' ' });
        }
      }
    }
    current.push(...spans);
  });
  paragraphs.push({ spans: mergeSpans(current) });
  for (const p of paragraphs) {
    // normalise whitespace inside spans
    p.spans = p.spans
      .map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ') }))
      .filter((s) => s.text.length);
    if (p.spans.length) {
      p.spans[0]!.text = p.spans[0]!.text.replace(/^\s+/, '');
      const l = p.spans[p.spans.length - 1]!;
      l.text = l.text.replace(/\s+$/, '');
    }
  }

  const allRuns = lines.flatMap((l) => l.runs);
  const families = allRuns.map((r) => r.style.family);
  const family = (['sans', 'serif', 'mono'] as const).reduce((best, f) =>
    families.filter((x) => x === f).length > families.filter((x) => x === best).length ? f : best,
  );
  const colorCounts = new Map<string, { c: RGB; n: number }>();
  for (const r of allRuns) {
    const k = r.color.join(',');
    const e = colorCounts.get(k) ?? { c: r.color, n: 0 };
    e.n += r.text.length;
    colorCounts.set(k, e);
  }
  const color = [...colorCounts.values()].sort((a, b) => b.n - a.n)[0]?.c ?? [0, 0, 0];
  // Spans that match the block colour don't need their own colour.
  for (const p of paragraphs) for (const s of p.spans) if (sameColor(s.color, color)) delete s.color;

  // The font used for most characters becomes the frame's default font.
  const fontCounts = new Map<string, number>();
  for (const r of allRuns) {
    const f = fontOf(r);
    if (f) fontCounts.set(f, (fontCounts.get(f) ?? 0) + r.text.length);
  }
  const font = [...fontCounts].sort((a, b) => b[1] - a[1])[0]?.[0];

  const first = lines[0]!;
  const last = lines[lines.length - 1]!;
  return {
    id,
    runIds: allRuns.map((r) => r.id),
    lines,
    paragraphs,
    x0,
    x1,
    top: first.baseline + first.size * 0.9,
    bottom: last.baseline - last.size * 0.25,
    firstBaseline: first.baseline,
    size,
    lineHeight,
    family,
    ...(font ? { font } : {}),
    color,
    align,
    editable: allRuns.every((r) => r.editable),
  };
}
