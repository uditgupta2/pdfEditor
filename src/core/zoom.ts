/**
 * `zoom` is what the user chose; `scale` is the resolved number.
 * A scale of 1 means 100%: the page is shown at its physical size
 * (1 PDF point = 1/72 inch, rendered at 96 CSS px per inch).
 */
export type ZoomMode = 'auto' | 'page-width' | 'page-fit';
export type ZoomValue = ZoomMode | number;

export const PDF_TO_CSS_UNITS = 96 / 72;
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5;
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

export interface PageSize {
  /** Width in PDF points, rotation applied. */
  width: number;
  /** Height in PDF points, rotation applied. */
  height: number;
  /** Visible box in page space [x0, y0, x1, y1] (the CropBox). */
  view?: [number, number, number, number];
  /** Page rotation in degrees (0, 90, 180, 270). */
  rotation?: number;
}

export interface ViewportBox {
  width: number;
  height: number;
}

export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Horizontal/vertical space the viewer keeps around pages, in CSS px. */
export function viewerPadding(containerWidth: number) {
  // Tighter gutters on phones so the page uses most of the screen.
  return containerWidth < 600 ? 8 : 24;
}

export function resolveScale(zoom: ZoomValue, page: PageSize | undefined, box: ViewportBox): number {
  if (typeof zoom === 'number') return clampScale(zoom);
  if (!page || box.width <= 0) return 1;
  const pad = viewerPadding(box.width);
  const widthScale = (box.width - pad * 2) / (page.width * PDF_TO_CSS_UNITS);
  const heightScale = (box.height - pad * 2) / (page.height * PDF_TO_CSS_UNITS);
  switch (zoom) {
    case 'page-width':
      return clampScale(widthScale);
    case 'page-fit':
      return clampScale(Math.min(widthScale, heightScale));
    case 'auto': {
      // Like pdf.js: fit the width, but never blow pages up past 125% on
      // large screens; landscape pages fit entirely.
      const landscape = page.width > page.height;
      const s = landscape ? Math.min(widthScale, heightScale) : widthScale;
      return clampScale(Math.min(1.25, s));
    }
  }
}

export function nextZoomStep(scale: number, direction: 1 | -1): number {
  const eps = 0.001;
  if (direction > 0) return ZOOM_STEPS.find((s) => s > scale + eps) ?? MAX_SCALE;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const s = ZOOM_STEPS[i]!;
    if (s < scale - eps) return s;
  }
  return MIN_SCALE;
}
