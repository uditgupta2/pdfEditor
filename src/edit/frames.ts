import type { TextBlock } from './extract';
import { newId, type PdfFont, type TextFrame } from './model';

/** The page fonts a frame made from `block` needs: the ones it uses, plus their bold/italic siblings. */
function blockFonts(block: TextBlock, pageFonts: Record<string, PdfFont>): Record<string, PdfFont> | undefined {
  const keys = new Set<string>();
  for (const p of block.paragraphs) for (const sp of p.spans) if (sp.font?.startsWith('pdf:')) keys.add(sp.font.slice(4));
  if (block.font) keys.add(block.font.slice(4));
  const families = new Set([...keys].map((k) => pageFonts[k]?.familyName));
  const out: Record<string, PdfFont> = {};
  for (const [k, f] of Object.entries(pageFonts)) if (keys.has(k) || families.has(f.familyName)) out[k] = f;
  return Object.keys(out).length ? out : undefined;
}

export function frameFromBlock(block: TextBlock, pageFonts: Record<string, PdfFont>, cover: TextFrame['cover']): TextFrame {
  const slack = block.align === 'left' ? block.size * 0.6 : 0;
  const fonts = blockFonts(block, pageFonts);
  return {
    id: newId(),
    sourceBlockId: block.id,
    x: block.x0,
    baseline: block.firstBaseline,
    width: Math.max(block.x1 - block.x0 + slack, block.size * 2),
    size: Math.round(block.size * 100) / 100,
    lineHeight: block.lineHeight,
    family: block.family,
    ...(block.font ? { font: block.font } : {}),
    ...(fonts ? { fonts } : {}),
    color: block.color,
    align: block.align,
    paragraphs: block.paragraphs.map((p) => ({
      spans: p.spans.map((sp) => ({
        text: sp.text,
        ...(sp.font && sp.font !== block.font ? { font: sp.font } : {}),
        ...(sp.bold ? { bold: true } : {}),
        ...(sp.italic ? { italic: true } : {}),
        ...(sp.underline ? { underline: true } : {}),
        ...(sp.color ? { color: sp.color } : {}),
      })),
    })),
    cover,
  };
}
