import { describe, expect, it } from 'vitest';
import { computeLayout, pageAtOffset, visibleRange, PAGE_GAP } from '../src/core/layout';
import { nextZoomStep, resolveScale, PDF_TO_CSS_UNITS, MAX_SCALE } from '../src/core/zoom';

const letter = { width: 612, height: 792 };

describe('resolveScale', () => {
  it('page-width fills the container minus padding', () => {
    const s = resolveScale('page-width', letter, { width: 1000, height: 800 });
    expect(s * letter.width * PDF_TO_CSS_UNITS).toBeCloseTo(1000 - 48);
  });
  it('uses tighter padding on phones', () => {
    const s = resolveScale('page-width', letter, { width: 375, height: 700 });
    expect(s * letter.width * PDF_TO_CSS_UNITS).toBeCloseTo(375 - 16);
  });
  it('auto never exceeds 125% on wide screens', () => {
    expect(resolveScale('auto', letter, { width: 3000, height: 2000 })).toBe(1.25);
  });
  it('page-fit fits the height on short containers', () => {
    const s = resolveScale('page-fit', letter, { width: 2000, height: 600 });
    expect(s * letter.height * PDF_TO_CSS_UNITS).toBeCloseTo(600 - 48);
  });
  it('clamps numeric zoom', () => expect(resolveScale(99, letter, { width: 1, height: 1 })).toBe(MAX_SCALE));
});

describe('nextZoomStep', () => {
  it('steps up and down through presets', () => {
    expect(nextZoomStep(1, 1)).toBe(1.1);
    expect(nextZoomStep(1, -1)).toBe(0.9);
    expect(nextZoomStep(1.03, 1)).toBe(1.1);
  });
});

describe('layout', () => {
  const pages = [letter, letter, { width: 792, height: 612 }];
  const l = computeLayout(pages, 1, 10);

  it('stacks pages with gaps', () => {
    const h = Math.floor(792 * PDF_TO_CSS_UNITS);
    expect(l.tops).toEqual([10, 10 + h + PAGE_GAP, 10 + 2 * (h + PAGE_GAP)]);
    expect(l.maxWidth).toBe(Math.floor(792 * PDF_TO_CSS_UNITS));
  });
  it('finds the page at an offset', () => {
    expect(pageAtOffset(l, 0)).toBe(0);
    expect(pageAtOffset(l, l.tops[1]! + 1)).toBe(1);
    expect(pageAtOffset(l, 1e9)).toBe(2);
  });
  it('computes visible range with overscan', () => {
    expect(visibleRange(l, 0, 100, 1)).toEqual({ start: 0, end: 1 });
    expect(visibleRange(computeLayout([], 1, 0), 0, 100)).toEqual({ start: 0, end: -1 });
  });
});
