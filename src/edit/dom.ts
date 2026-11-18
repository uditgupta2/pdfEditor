import { choiceFromCss } from './faces';
import { CSS_FONT_METRICS } from './metrics';
import { cssColor, parseCssColor, type FamilyClass, type FontChoice, type Paragraph, type RGB, type Span } from './model';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');

/**
 * Model → HTML for the contenteditable editor. One <div> per paragraph.
 * `fontCss` gives the CSS font-family list of a span's font (see `cssFontStack`).
 */
export function paragraphsToHtml(paragraphs: Paragraph[], fontCss?: (font: FontChoice) => string): string {
  return paragraphs
    .map((p) => {
      const inner = p.spans
        .filter((s) => s.text)
        .map((s) => {
          const css: string[] = [];
          if (s.bold) css.push('font-weight:700');
          if (s.italic) css.push('font-style:italic');
          if (s.underline) css.push('text-decoration:underline');
          if (s.color) css.push(`color:${cssColor(s.color)}`);
          if (s.font && fontCss) css.push(`font-family:${fontCss(s.font)}`);
          return css.length ? `<span style="${escAttr(css.join(';'))}">${esc(s.text)}</span>` : esc(s.text);
        })
        .join('');
      return `<div>${inner || '<br>'}</div>`;
    })
    .join('');
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);

const sameColor = (a?: RGB, b?: RGB) =>
  (!a && !b) || (!!a && !!b && a.every((v, i) => Math.abs(v - b[i]!) < 0.004));

/** The font choice of `el`'s text: the nearest font-family that names one, up to `root`. */
export function fontChoiceOf(el: HTMLElement, root: HTMLElement): FontChoice | undefined {
  for (let n: HTMLElement | null = el; n; n = n === root ? null : n.parentElement) {
    const choice = n.style?.fontFamily ? choiceFromCss(n.style.fontFamily) : undefined;
    if (choice) return choice;
    if (n.tagName === 'FONT' && n.getAttribute('face')) {
      const fromFace = choiceFromCss(n.getAttribute('face')!);
      if (fromFace) return fromFace;
    }
  }
  return choiceFromCss(getComputedStyle(el).fontFamily);
}

/**
 * contenteditable DOM → model. Handles Chrome (<div>), Firefox (<br>) and pasted markup.
 * Text in `frameFont` (the font of the editor box itself) gets no `font` of its own.
 */
export function readParagraphs(root: HTMLElement, frameColor: RGB, frameFont?: FontChoice): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let current: Span[] = [];
  let pendingBreak = false;
  const endParagraph = () => {
    paragraphs.push({ spans: current });
    current = [];
  };

  const walk = (node: Node, underline: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/ /g, ' ').replace(/[\r\n]+/g, ' ');
      if (!text) return;
      const el = node.parentElement ?? root;
      const cs = getComputedStyle(el);
      const color = parseCssColor(cs.color) ?? undefined;
      const span: Span = { text };
      if (parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === 'bold') span.bold = true;
      if (cs.fontStyle === 'italic' || cs.fontStyle === 'oblique') span.italic = true;
      if (underline) span.underline = true;
      if (color && !sameColor(color, frameColor)) span.color = color;
      const font = fontChoiceOf(el, root);
      if (font && font !== frameFont) span.font = font;
      current.push(span);
      pendingBreak = false;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === 'BR') {
      endParagraph();
      pendingBreak = true;
      return;
    }
    const isBlock = BLOCK_TAGS.has(node.tagName);
    if (isBlock && node !== root && (current.length || paragraphs.length) && !pendingBreak) endParagraph();
    const u =
      underline ||
      node.tagName === 'U' ||
      (node.style?.textDecorationLine || node.style?.textDecoration || '').includes('underline');
    node.childNodes.forEach((c) => walk(c, u));
    if (isBlock && node !== root) {
      // A block that ended with <br> already closed its paragraph.
      if (!pendingBreak) endParagraph();
      pendingBreak = true;
    }
  };
  pendingBreak = true;
  root.childNodes.forEach((c) => walk(c, false));
  if (current.length || !pendingBreak) endParagraph();
  if (!paragraphs.length) paragraphs.push({ spans: [] });

  // Merge neighbouring spans with identical style.
  for (const p of paragraphs) {
    const merged: Span[] = [];
    for (const s of p.spans) {
      const last = merged[merged.length - 1];
      if (
        last &&
        !!last.bold === !!s.bold &&
        !!last.italic === !!s.italic &&
        !!last.underline === !!s.underline &&
        last.font === s.font &&
        sameColor(last.color, s.color)
      ) {
        last.text += s.text;
      } else merged.push({ ...s });
    }
    p.spans = merged;
  }
  // Trailing empty paragraph from a final <br> placeholder.
  while (paragraphs.length > 1 && !paragraphs[paragraphs.length - 1]!.spans.length) paragraphs.pop();
  return paragraphs;
}

/**
 * Distance from the top of a CSS line box to the text baseline, in px.
 * Lets us place HTML text so its baseline sits exactly on the PDF baseline.
 */
export function cssBaselineOffset(family: FamilyClass, fontPx: number, lineHeightPx: number) {
  const { ascent, descent } = CSS_FONT_METRICS[family];
  return (lineHeightPx - (ascent + descent) * fontPx) / 2 + ascent * fontPx;
}

/**
 * Read the rendered page's pixels around a box and return the dominant
 * colour: what the background behind that text looks like. Used to cover the
 * original glyphs instantly while the page re-renders without them.
 */
export function sampleBackground(
  canvas: HTMLCanvasElement | null,
  box: { left: number; top: number; width: number; height: number },
  cssWidth: number,
): RGB {
  const white: RGB = [1, 1, 1];
  if (!canvas || !cssWidth) return white;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    return white;
  }
  if (!ctx) return white;
  const k = canvas.width / cssWidth;
  const pad = 3;
  const pts: [number, number][] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const x = box.left + (box.width * i) / steps;
    const y = box.top + (box.height * i) / steps;
    pts.push([x, box.top - pad], [x, box.top + box.height + pad], [box.left - pad, y], [box.left + box.width + pad, y]);
  }
  const counts = new Map<string, { c: RGB; n: number }>();
  for (const [x, y] of pts) {
    const px = Math.round(x * k);
    const py = Math.round(y * k);
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
    let d: Uint8ClampedArray;
    try {
      d = ctx.getImageData(px, py, 1, 1).data;
    } catch {
      return white;
    }
    // quantise so anti-aliasing noise doesn't split the vote
    const q = (v: number) => Math.round(v / 16) * 16;
    const key = `${q(d[0]!)},${q(d[1]!)},${q(d[2]!)}`;
    const e = counts.get(key) ?? { c: [d[0]! / 255, d[1]! / 255, d[2]! / 255] as RGB, n: 0 };
    e.n++;
    counts.set(key, e);
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best?.c ?? white;
}
