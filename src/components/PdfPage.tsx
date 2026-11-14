import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { PDF_TO_CSS_UNITS } from '../core/zoom';
import { getPdfjs } from '../render/pdfjs';

/** iOS Safari refuses canvases above ~16.7M pixels; stay under it. */
const MAX_CANVAS_PIXELS = 16_000_000;

export interface PdfPageProps {
  document: PDFDocumentProxy;
  /** Zero-based. */
  index: number;
  scale: number;
  width: number;
  height: number;
  /** Render the selectable text layer. Default true. */
  textLayer?: boolean;
  style?: CSSProperties;
  /**
   * Alternative source for the page (e.g. the page with edited text removed).
   * Changing `renderKey` re-renders from it.
   */
  getPage?: () => Promise<PDFPageProxy>;
  renderKey?: string;
  /** Overlay content (editing layer). Receives the key of the bitmap currently shown. */
  overlay?: (renderedKey: string | null) => ReactNode;
}

function isCancel(e: unknown) {
  const name = (e as { name?: string } | null)?.name;
  return name === 'RenderingCancelledException' || name === 'AbortException';
}

export const PdfPage = memo(function PdfPage({
  document: doc,
  index,
  scale,
  width,
  height,
  textLayer = true,
  style,
  getPage,
  renderKey = 'original',
  overlay,
}: PdfPageProps) {
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const textWrapRef = useRef<HTMLDivElement>(null);
  const renderedOnce = useRef(false);
  const getPageRef = useRef(getPage);
  getPageRef.current = getPage;
  const [renderedKey, setRenderedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    let text: { cancel(): void } | null = null;

    // Re-rendering on every zoom tick is wasteful; the previous bitmap is
    // stretched meanwhile, so a short debounce is invisible.
    const delay = renderedOnce.current ? 120 : 0;
    const timer = setTimeout(async () => {
      try {
        const page = getPageRef.current ? await getPageRef.current() : await doc.getPage(index + 1);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: scale * PDF_TO_CSS_UNITS });
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        let outputScale = dpr;
        const pixels = viewport.width * viewport.height * dpr * dpr;
        if (pixels > MAX_CANVAS_PIXELS) outputScale = Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height));

        const canvas = window.document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.className = 'rpe-canvas';
        canvas.setAttribute('aria-hidden', 'true');

        task = page.render({
          canvas,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        });
        await task.promise;
        if (cancelled) return;
        // Swap in the finished bitmap only now, so zooming never flashes blank.
        canvasWrapRef.current?.replaceChildren(canvas);
        renderedOnce.current = true;
        setRenderedKey(renderKey);

        const wrap = textWrapRef.current;
        if (textLayer && wrap) {
          const { TextLayer } = await getPdfjs();
          if (cancelled) return;
          // Build off-screen, then swap, for the same no-flash reason.
          const div = window.document.createElement('div');
          div.className = 'textLayer';
          const layer = new TextLayer({
            textContentSource: page.streamTextContent(),
            container: div,
            viewport,
          });
          text = layer;
          await layer.render();
          if (cancelled) return;
          wrap.replaceChildren(div);
        } else wrap?.replaceChildren();
      } catch (e) {
        if (!cancelled && !isCancel(e)) console.error(`[pdf-editor] page ${index + 1} failed to render`, e);
      }
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
      text?.cancel();
    };
  }, [doc, index, scale, textLayer, renderKey]);

  return (
    <div
      className="rpe-page"
      data-page-index={index}
      role="group"
      aria-label={`Page ${index + 1}`}
      style={
        {
          width,
          height,
          '--scale-factor': scale * PDF_TO_CSS_UNITS,
          '--total-scale-factor': scale * PDF_TO_CSS_UNITS,
          ...style,
        } as CSSProperties
      }
    >
      <div ref={canvasWrapRef} className="rpe-canvas-wrap" />
      <div ref={textWrapRef} className="rpe-text-wrap" hidden={!textLayer} />
      {overlay?.(renderedKey)}
    </div>
  );
});
