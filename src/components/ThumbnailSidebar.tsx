import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEditor } from './context';

const THUMB_WIDTH = 112;

/**
 * Thumbnails are rendered one at a time (the worker is shared with the main
 * view) and stored as compressed image blobs rather than live canvases, so a
 * 500-page document doesn't hold 500 canvases in memory.
 */
class ThumbnailCache {
  private urls = new Map<number, string>();
  private queue: Promise<void> = Promise.resolve();
  private destroyed = false;

  constructor(private doc: PDFDocumentProxy) {}

  get(index: number) {
    return this.urls.get(index);
  }

  request(index: number): Promise<string | undefined> {
    const job = this.queue.then(() => this.render(index));
    this.queue = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  private async render(index: number) {
    if (this.destroyed) return undefined;
    const cached = this.urls.get(index);
    if (cached) return cached;
    const page = await this.doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale: (THUMB_WIDTH * dpr) / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob || this.destroyed) return undefined;
    const url = URL.createObjectURL(blob);
    this.urls.set(index, url);
    return url;
  }

  destroy() {
    this.destroyed = true;
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls.clear();
  }
}

const Thumbnail = memo(function Thumbnail({
  cache,
  index,
  aspect,
  active,
  onSelect,
  root,
}: {
  cache: ThumbnailCache;
  index: number;
  aspect: number;
  active: boolean;
  onSelect(index: number): void;
  root: HTMLElement | null;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState(() => cache.get(index));

  useEffect(() => {
    if (src) return;
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const start = () => {
      void cache.request(index).then((url) => alive && url && setSrc(url));
    };
    if (typeof IntersectionObserver === 'undefined') {
      start();
      return () => {
        alive = false;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { root, rootMargin: '200px 0px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [cache, index, root, src]);

  // Keep the active thumbnail visible as the user scrolls the document.
  useEffect(() => {
    // Scroll only the sidebar; scrollIntoView() would also scroll the host page.
    const el = ref.current;
    if (!active || !el || !root) return;
    const top = el.offsetTop; // .rpe-sidebar is position: relative
    const bottom = top + el.offsetHeight;
    if (top < root.scrollTop) root.scrollTop = top - 8;
    else if (bottom > root.scrollTop + root.clientHeight) root.scrollTop = bottom - root.clientHeight + 8;
  }, [active, root]);

  return (
    <button
      ref={ref}
      type="button"
      className={`rpe-thumb${active ? ' is-active' : ''}`}
      onClick={() => onSelect(index)}
      aria-label={`Go to page ${index + 1}`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="rpe-thumb-img" style={{ aspectRatio: String(aspect) }}>
        {src && <img src={src} alt="" draggable={false} />}
      </span>
      <span className="rpe-thumb-label">{index + 1}</span>
    </button>
  );
});

export interface ThumbnailSidebarProps {
  /** Called after a thumbnail is chosen (the editor uses it to close the mobile drawer). */
  onNavigate?(index: number): void;
  className?: string;
}

export function ThumbnailSidebar({ onNavigate, className }: ThumbnailSidebarProps) {
  const { document: doc, pageSizes, currentPage, goToPage } = useEditor();
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [cache, setCache] = useState<ThumbnailCache | null>(null);

  useEffect(() => {
    if (!doc) return;
    const c = new ThumbnailCache(doc);
    setCache(c);
    return () => {
      c.destroy();
      setCache(null);
    };
  }, [doc]);

  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const select = useCallback(
    (i: number) => {
      goToPage(i);
      onNavigateRef.current?.(i);
    },
    [goToPage],
  );

  return (
    <nav ref={setRoot} className={`rpe-sidebar${className ? ` ${className}` : ''}`} aria-label="Pages">
      {cache &&
        pageSizes.map((p, i) => (
          <Thumbnail
            key={i}
            cache={cache}
            index={i}
            aspect={p.width / p.height}
            active={i === currentPage}
            onSelect={select}
            root={root}
          />
        ))}
    </nav>
  );
}
