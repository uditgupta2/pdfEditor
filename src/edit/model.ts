/**
 * The edit model is plain, serialisable data in PDF page space (points, y up),
 * independent of zoom. It is what undo/redo snapshots and what export reads.
 */
export type RGB = [number, number, number];
export type FamilyClass = 'sans' | 'serif' | 'mono';
export type Align = 'left' | 'center' | 'right' | 'justify';

export interface SpanStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: RGB;
}

export interface Span extends SpanStyle {
  text: string;
}

export interface Paragraph {
  spans: Span[];
}

/** A text frame written by the user: replaced original text or new text. */
export interface TextFrame {
  id: string;
  /** Id of the detected source block it replaces, if any. */
  sourceBlockId?: string;
  /** Left edge, page space. */
  x: number;
  /** Baseline of the first line, page space. */
  baseline: number;
  /** Wrap width in points. */
  width: number;
  size: number;
  /** Baseline-to-baseline distance in points. */
  lineHeight: number;
  family: FamilyClass;
  color: RGB;
  align: Align;
  paragraphs: Paragraph[];
  /**
   * Screen-only: background colour sampled from the page pixels behind the
   * original text. Covers the old glyphs until the page re-renders without them.
   * Never written to the PDF.
   */
  cover?: RGB;
}

export interface PageEdits {
  /** Original text runs removed from the page content. */
  removedRuns: string[];
  frames: TextFrame[];
}

export type DocumentEdits = Record<number, PageEdits>;

export const EMPTY_PAGE_EDITS: PageEdits = { removedRuns: [], frames: [] };

export function hasEdits(edits: DocumentEdits) {
  return Object.values(edits).some((p) => p.removedRuns.length || p.frames.length);
}

export function framePlainText(f: Pick<TextFrame, 'paragraphs'>) {
  return f.paragraphs.map((p) => p.spans.map((s) => s.text).join('')).join('\n');
}

let idCounter = 0;
export function newId(prefix = 'f') {
  idCounter++;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export const cssColor = (c: RGB) =>
  `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;

export function parseCssColor(s: string): RGB | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s);
  if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  const h = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (h) {
    const v = parseInt(h[1]!, 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  return null;
}

export const hexColor = (c: RGB) =>
  '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
