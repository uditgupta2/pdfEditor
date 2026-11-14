import { PDF_TO_CSS_UNITS, type PageSize } from './zoom';

export const PAGE_GAP = 16;

export interface PageLayout {
  /** Top offset of each page inside the scroll content, CSS px. */
  tops: number[];
  /** Rendered size of each page, CSS px. */
  sizes: { width: number; height: number }[];
  totalHeight: number;
  maxWidth: number;
}

/** Pure layout math so scrolling, virtualization and "go to page" agree. */
export function computeLayout(pages: PageSize[], scale: number, padding: number): PageLayout {
  const tops: number[] = [];
  const sizes: { width: number; height: number }[] = [];
  let y = padding;
  let maxWidth = 0;
  for (const p of pages) {
    const width = Math.floor(p.width * PDF_TO_CSS_UNITS * scale);
    const height = Math.floor(p.height * PDF_TO_CSS_UNITS * scale);
    tops.push(y);
    sizes.push({ width, height });
    maxWidth = Math.max(maxWidth, width);
    y += height + PAGE_GAP;
  }
  const totalHeight = pages.length ? y - PAGE_GAP + padding : 0;
  return { tops, sizes, totalHeight, maxWidth };
}

/** Index of the last page whose top is <= y (binary search). */
export function pageAtOffset(layout: PageLayout, y: number): number {
  const { tops } = layout;
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** Pages intersecting [top, bottom], expanded by `overscan` pages each side. */
export function visibleRange(layout: PageLayout, top: number, bottom: number, overscan = 1) {
  if (!layout.tops.length) return { start: 0, end: -1 };
  const start = Math.max(0, pageAtOffset(layout, top) - overscan);
  const end = Math.min(layout.tops.length - 1, pageAtOffset(layout, bottom) + overscan);
  return { start, end };
}
