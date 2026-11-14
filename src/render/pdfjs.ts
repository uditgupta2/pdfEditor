import type * as PdfjsLib from 'pdfjs-dist';

export type Pdfjs = typeof PdfjsLib;

export interface PdfjsOptions {
  /**
   * URL of `pdf.worker.min.mjs`. Recommended in production, e.g. with Vite:
   * `import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`.
   * Defaults to the matching version on unpkg.
   */
  workerSrc?: string;
  /**
   * Base URL for pdf.js data files (`cmaps/`, `standard_fonts/`, `wasm/`).
   * Needed for CJK text and some fonts/images. Defaults to unpkg.
   */
  assetsBaseUrl?: string;
}

let pdfjsPromise: Promise<Pdfjs> | null = null;

/**
 * Load pdf.js lazily. It touches `window`/`DOMMatrix` at import time, so it
 * must never be imported at module scope (that would break SSR).
 */
export function getPdfjs(options: PdfjsOptions = {}): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((lib) => {
      // `default` interop for CJS consumers.
      const pdfjs = ((lib as unknown as { default?: Pdfjs }).default ?? lib) as Pdfjs;
      return pdfjs;
    });
  }
  return pdfjsPromise.then((pdfjs) => {
    const src = options.workerSrc ?? `${defaultAssetsBase(pdfjs)}build/pdf.worker.min.mjs`;
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = src;
    }
    return pdfjs;
  });
}

export function defaultAssetsBase(pdfjs: Pdfjs) {
  return `https://unpkg.com/pdfjs-dist@${pdfjs.version}/`;
}

export function assetUrls(pdfjs: Pdfjs, base?: string) {
  const root = (base ?? defaultAssetsBase(pdfjs)).replace(/\/?$/, '/');
  return {
    cMapUrl: `${root}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${root}standard_fonts/`,
    wasmUrl: `${root}wasm/`,
  };
}
