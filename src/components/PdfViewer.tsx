import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { computeLayout, pageAtOffset, visibleRange, type PageLayout } from '../core/layout';
import { clampScale, resolveScale, viewerPadding, type PageSize } from '../core/zoom';
import { useElementSize } from '../hooks/useElementSize';
import { useEditor } from './context';
import { PdfPage } from './PdfPage';
import { TextEditLayer } from './TextEditLayer';
import { pageRenderKey } from '../edit/session';
import { useFontLibraryVersion } from '../hooks/useFontLibrary';

export interface PdfViewerProps {
  className?: string;
  /** Render selectable text. Default true. */
  textLayer?: boolean;
}

interface Anchor {
  /** Point in viewer coordinates (px from the viewer's top-left) to keep fixed. */
  x: number;
  y: number;
}

function dominantPageSize(pages: PageSize[]): PageSize | undefined {
  const counts = new Map<string, { size: PageSize; n: number }>();
  let best: { size: PageSize; n: number } | undefined;
  for (const p of pages) {
    const key = `${Math.round(p.width)}x${Math.round(p.height)}`;
    const entry = counts.get(key) ?? { size: p, n: 0 };
    entry.n++;
    counts.set(key, entry);
    if (!best || entry.n > best.n) best = entry;
  }
  return best?.size;
}

/**
 * Map a content offset from one layout to another, keeping the same spot on
 * the same page. Offsets in padding/gaps keep their pixel distance.
 */
function remapOffset(prev: PageLayout, next: PageLayout, y: number): number {
  const p = pageAtOffset(prev, y);
  const prevTop = prev.tops[p] ?? 0;
  const prevH = prev.sizes[p]?.height ?? 0;
  const nextTop = next.tops[p] ?? 0;
  const nextH = next.sizes[p]?.height ?? 0;
  const delta = y - prevTop;
  if (delta < 0) return nextTop + delta;
  if (delta > prevH) return nextTop + nextH + (delta - prevH);
  return nextTop + (prevH ? (delta / prevH) * nextH : 0);
}

function contentWidthOf(layout: PageLayout, viewerWidth: number, pad: number) {
  return Math.max(viewerWidth, layout.maxWidth + pad * 2);
}

export function PdfViewer({ className, textLayer = true }: PdfViewerProps) {
  const editor = useEditor();
  const { document: doc, documentKey, pageSizes, zoom, scrollRequest, mode, edits, session } = editor;
  useFontLibraryVersion(); // page render keys depend on loaded fonts
  // The frame open in the inline editor is left out of the rendered page, so
  // the old text doesn't show underneath while it is being changed.
  const reEditing = editor.activeEdit?.existingFrameId ? editor.activeEdit : null;
  const reEditedPage = useMemo(() => {
    if (!reEditing) return null;
    const page = edits[reEditing.pageIndex];
    if (!page) return null;
    return { index: reEditing.pageIndex, edits: { ...page, frames: page.frames.filter((f) => f.id !== reEditing.existingFrameId) } };
  }, [edits, reEditing?.pageIndex, reEditing?.existingFrameId]); // eslint-disable-line react-hooks/exhaustive-deps
  const renderEdits = (i: number) => (reEditedPage?.index === i ? reEditedPage.edits : edits[i]);
  const editing = mode === 'edit';
  const viewerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const box = useElementSize(viewerRef);
  const pad = viewerPadding(box.width);

  // Fit modes use the most common page size. Following the page in view
  // would make the scale (and scroll position) jump while scrolling mixed
  // documents; using the largest page would shrink every page because of one
  // landscape insert. Odd-sized pages may scroll horizontally instead.
  const refPage = useMemo(() => dominantPageSize(pageSizes), [pageSizes]);
  const scale = useMemo(() => resolveScale(zoom, refPage, box), [zoom, refPage, box]);
  const layout = useMemo(() => computeLayout(pageSizes, scale, pad), [pageSizes, scale, pad]);
  const contentWidth = box.width > 0 ? contentWidthOf(layout, box.width, pad) : 0;

  const { _reportScale, _reportCurrentPage, setZoom } = editor;
  useEffect(() => _reportScale(scale), [scale, _reportScale]);

  // ---- scroll tracking -------------------------------------------------
  const scrollPos = useRef({ top: 0, left: 0 });
  const [range, setRange] = useState({ start: 0, end: -1 });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const update = useCallback(() => {
    const el = viewerRef.current;
    if (!el) return;
    const l = layoutRef.current;
    scrollPos.current = { top: el.scrollTop, left: el.scrollLeft };
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    const next = visibleRange(l, top, bottom, 1);
    setRange((r) => (r.start === next.start && r.end === next.end ? r : next));
    if (!l.tops.length) return;
    const atEnd = bottom >= l.totalHeight - 2;
    _reportCurrentPage(atEnd ? l.tops.length - 1 : pageAtOffset(l, top + el.clientHeight * 0.35));
  }, [_reportCurrentPage]);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [update]);

  // ---- keep the same spot under the anchor when the scale changes --------
  const prevLayout = useRef<{ layout: PageLayout; width: number; key: number } | null>(null);
  const pendingAnchor = useRef<Anchor | null>(null);

  useLayoutEffect(() => {
    const el = viewerRef.current;
    const prev = prevLayout.current;
    prevLayout.current = { layout, width: contentWidth, key: documentKey };
    if (!el) return;
    // A layout computed before the viewer was measured is meaningless; so is
    // a different document. Start at the top in both cases.
    if (!prev || prev.key !== documentKey || prev.width === 0) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
      update();
      return;
    }
    if (prev.layout.tops.length && prev.layout !== layout) {
      const anchor = pendingAnchor.current ?? { x: el.clientWidth / 2, y: 0 };
      pendingAnchor.current = null;
      const contentY = scrollPos.current.top + anchor.y;
      el.scrollTop = remapOffset(prev.layout, layout, contentY) - anchor.y;
      const fracX = (scrollPos.current.left + anchor.x) / prev.width;
      el.scrollLeft = fracX * contentWidth - anchor.x;
    }
    update();
  }, [layout, contentWidth, documentKey, update]);

  // ---- go to page --------------------------------------------------------
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || !scrollRequest) return;
    const top = layoutRef.current.tops[scrollRequest.page];
    if (top != null) el.scrollTo({ top: Math.max(0, top - pad) });
  }, [scrollRequest, pad]);

  // ---- ctrl/⌘ + wheel and trackpad pinch (desktop) -------------------------
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      pendingAnchor.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002));
      const next = clampScale(Math.round(scaleRef.current * factor * 1000) / 1000);
      scaleRef.current = next;
      setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  // ---- two-finger pinch (touch screens) ------------------------------------
  useEffect(() => {
    const el = viewerRef.current;
    const pages = pagesRef.current;
    if (!el || !pages) return;
    let start: { dist: number; scale: number; cx: number; cy: number } | null = null;
    let ratio = 1;

    const metrics = (t: TouchList) => {
      const a = t[0]!;
      const b = t[1]!;
      const rect = el.getBoundingClientRect();
      return {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        cx: (a.clientX + b.clientX) / 2 - rect.left,
        cy: (a.clientY + b.clientY) / 2 - rect.top,
      };
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const m = metrics(e.touches);
      start = { ...m, scale: scaleRef.current };
      ratio = 1;
      // Scale the existing pages with CSS for instant feedback.
      pages.style.transformOrigin = `${el.scrollLeft + m.cx}px ${el.scrollTop + m.cy}px`;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const m = metrics(e.touches);
      ratio = clampScale(start.scale * (m.dist / start.dist)) / start.scale;
      pages.style.transform = `scale(${ratio})`;
    };
    const onEnd = () => {
      if (!start) return;
      pages.style.transform = '';
      if (Math.abs(ratio - 1) > 0.01) {
        pendingAnchor.current = { x: start.cx, y: start.cy };
        setZoom(clampScale(start.scale * ratio));
      }
      start = null;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [setZoom, doc]);

  return (
    <div
      ref={viewerRef}
      className={`rpe-viewer${editing ? ' is-editing' : ''}${className ? ` ${className}` : ''}`}
      tabIndex={0}
      aria-label="Document pages"
    >
      {doc && box.width > 0 && (
        <div
          ref={pagesRef}
          className="rpe-pages"
          style={{ height: layout.totalHeight, width: contentWidth }}
        >
          {layout.sizes.map((size, i) => {
            // Center in the visible width, not the content width: one wide
            // page must not push every other page off-centre on phones.
            const left = Math.max(pad, (box.width - size.width) / 2);
            const top = layout.tops[i]!;
            const inRange = i >= range.start && i <= range.end;
            const pageEdits = renderEdits(i);
            const key = pageRenderKey(pageEdits);
            const hasPageEdits = !!edits[i];
            return inRange ? (
              <PdfPage
                key={`${documentKey}-${i}`}
                document={doc}
                index={i}
                scale={scale}
                width={size.width}
                height={size.height}
                // Selectable text comes from our own layer while editing.
                textLayer={textLayer && !editing}
                style={{ position: 'absolute', top, left }}
                renderKey={key}
                getPage={pageEdits && key !== 'original' && session ? () => session.renderPage(i, pageEdits) : undefined}
                overlay={
                  editing || hasPageEdits
                    ? (renderedKey) => (
                        <TextEditLayer
                          pageIndex={i}
                          scale={scale}
                          size={pageSizes[i]!}
                          baseUpToDate={renderedKey === key}
                        />
                      )
                    : undefined
                }
              />
            ) : (
              <div
                key={`${documentKey}-${i}`}
                className="rpe-page rpe-page--placeholder"
                style={{ position: 'absolute', top, left, width: size.width, height: size.height }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
