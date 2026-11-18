import { faceChain, faceFor, faceWidth, type Face } from './faces';
import type { RGB, SpanStyle, TextFrame } from './model';

/**
 * One layout engine for both the screen and the exported PDF, so line breaks
 * and word positions are identical in both.
 */

export interface Fragment extends SpanStyle {
  text: string;
  /** The face that draws this text (the span's font, or a fallback for characters it lacks). */
  face: Face;
  /** A word space follows this fragment (for copy/paste and screen readers). */
  spaceAfter?: boolean;
  /** Offset from the frame's left edge, points. */
  x: number;
  width: number;
}

export interface LaidOutLine {
  fragments: Fragment[];
  /** Offset of this baseline below the frame's first baseline, points. */
  dy: number;
  width: number;
}

export interface FrameLayout {
  lines: LaidOutLine[];
  /** Height from first-line top to last-line bottom, points. */
  height: number;
  /** Widest line, points. */
  contentWidth: number;
}

interface Glyph extends SpanStyle {
  ch: string;
  face: Face;
}

const sameStyle = (a: SpanStyle & { face: Face }, b: SpanStyle & { face: Face }) =>
  a.face.id === b.face.id &&
  a.font === b.font &&
  !!a.bold === !!b.bold &&
  !!a.italic === !!b.italic &&
  !!a.underline === !!b.underline &&
  (a.color?.join() ?? '') === (b.color?.join() ?? '');

export function layoutFrame(frame: TextFrame): FrameLayout {
  const { width: maxWidth, size, align } = frame;
  const w = (g: Glyph) => faceWidth(g.face, g.ch, size);
  const lines: LaidOutLine[] = [];
  let contentWidth = 0;
  const tolerance = maxWidth * 0.005 + 0.01;

  for (const para of frame.paragraphs) {
    const glyphs: Glyph[] = [];
    for (const s of para.spans) {
      const { text, ...style } = s;
      const chain = faceChain(frame, style);
      for (const raw of Array.from(text)) {
        const ch = raw === '\t' ? ' ' : raw;
        glyphs.push({ ...style, ch, face: faceFor(chain, ch) });
      }
    }

    // tokens: words and single spaces
    const tokens: Glyph[][] = [];
    let cur: Glyph[] = [];
    for (const g of glyphs) {
      if (g.ch === ' ') {
        if (cur.length) tokens.push(cur);
        tokens.push([g]);
        cur = [];
      } else cur.push(g);
    }
    if (cur.length) tokens.push(cur);

    const paraLines: Glyph[][][] = [];
    let line: Glyph[][] = [];
    let lineW = 0;
    const tokenW = (t: Glyph[]) => t.reduce((a, g) => a + w(g), 0);
    const flush = () => {
      while (line.length && line[line.length - 1]![0]!.ch === ' ') line.pop();
      paraLines.push(line);
      line = [];
      lineW = 0;
    };
    for (const t of tokens) {
      const tw = tokenW(t);
      const isSpace = t[0]!.ch === ' ';
      if (isSpace) {
        if (!line.length) continue; // no leading spaces after a wrap
        line.push(t);
        lineW += tw;
        continue;
      }
      if (lineW + tw > maxWidth + tolerance && line.some((x) => x[0]!.ch !== ' ')) flush();
      if (tw > maxWidth + tolerance) {
        // a single word longer than the frame: break it by character
        let piece: Glyph[] = [];
        let pw = 0;
        for (const g of t) {
          const gw = w(g);
          if (pw + gw > maxWidth - lineW + tolerance && (piece.length || line.length)) {
            if (piece.length) line.push(piece);
            flush();
            piece = [];
            pw = 0;
          }
          piece.push(g);
          pw += gw;
        }
        if (piece.length) {
          line.push(piece);
          lineW += pw;
        }
        continue;
      }
      line.push(t);
      lineW += tw;
    }
    flush();

    paraLines.forEach((tokensOfLine, li) => {
      const isLast = li === paraLines.length - 1;
      const natural = tokensOfLine.reduce((a, t) => a + tokenW(t), 0);
      const spaces = tokensOfLine.filter((t) => t[0]!.ch === ' ').length;
      let x = 0;
      let extra = 0;
      if (align === 'center') x = (maxWidth - natural) / 2;
      else if (align === 'right') x = maxWidth - natural;
      else if (align === 'justify' && !isLast && spaces > 0) extra = Math.max(0, (maxWidth - natural) / spaces);
      x = Math.max(0, x);
      const fragments: Fragment[] = [];
      for (const t of tokensOfLine) {
        if (t[0]!.ch === ' ') {
          const before = fragments[fragments.length - 1];
          if (before) before.spaceAfter = true;
          x += tokenW(t) + extra;
          // keep underline continuous across spaces
          const prev = fragments[fragments.length - 1];
          if (prev?.underline && !extra) {
            prev.text += ' ';
            prev.width += tokenW(t);
          }
          continue;
        }
        for (const g of t) {
          const gw = w(g);
          const prev = fragments[fragments.length - 1];
          if (prev && sameStyle(prev, g) && Math.abs(prev.x + prev.width - x) < 1e-6) {
            prev.text += g.ch;
            prev.width += gw;
          } else {
            const { ch, ...style } = g;
            fragments.push({ ...style, text: ch, x, width: gw });
          }
          x += gw;
        }
      }
      const width = natural + extra * spaces;
      contentWidth = Math.max(contentWidth, width);
      lines.push({ fragments, dy: lines.length * frame.lineHeight, width });
    });
  }

  const height = lines.length ? (lines.length - 1) * frame.lineHeight + size * 1.15 : size * 1.15;
  return { lines, height, contentWidth };
}

export type { RGB };
