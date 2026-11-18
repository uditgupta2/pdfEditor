import { useEffect, useLayoutEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { cssBaselineOffset, paragraphsToHtml, readParagraphs } from '../edit/dom';
import { cssFontStack, frameFont } from '../edit/faces';
import { useFontLibraryVersion } from '../hooks/useFontLibrary';
import { cssColor } from '../edit/model';
import type { ActiveEdit } from '../hooks/usePdfEditor';
import { useEditor } from './context';
import { useToolbarConfig } from './toolbarConfig';

export interface InlineEditorProps {
  active: ActiveEdit;
  /** CSS px per PDF point. */
  s: number;
  /** Page-space → CSS px within the page. */
  toCss(x: number, y: number): { left: number; top: number };
  /** Where the user clicked (client coords), to place the caret there. */
  caretAt?: { x: number; y: number } | null;
  /** Page right edge in page space (limits resizing). */
  maxRight: number;
}

/** Selector for UI that may take focus without closing the editor. */
export const KEEP_EDITING_ATTR = 'data-rpe-keep-editing';

function placeCaret(el: HTMLElement, at?: { x: number; y: number } | null) {
  const sel = window.getSelection();
  if (!sel) return;
  let range: Range | null = null;
  if (at) {
    const doc = document as Document & {
      caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?(x: number, y: number): Range | null;
    };
    if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(at.x, at.y);
      if (p && el.contains(p.offsetNode)) {
        range = document.createRange();
        range.setStart(p.offsetNode, p.offset);
      }
    } else if (doc.caretRangeFromPoint) {
      const r = doc.caretRangeFromPoint(at.x, at.y);
      if (r && el.contains(r.startContainer)) range = r;
    }
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function InlineEditor({ active, s, toCss, caretAt, maxRight }: InlineEditorProps) {
  const editor = useEditor();
  const { endEdit, updateActiveFrame, inlineEditorRef, markActiveChanged } = editor;
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const { frame } = active;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const tools = useToolbarConfig();
  useFontLibraryVersion(); // font stacks name library fonts once they are registered

  // Fill once per frame; afterwards the DOM is owned by the browser.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.innerHTML = paragraphsToHtml(frame.paragraphs, (font) => cssFontStack(frame, font));
    try {
      document.execCommand('defaultParagraphSeparator', false, 'div');
      document.execCommand('styleWithCSS', false, 'true');
    } catch {
      /* not supported: harmless */
    }
    el.focus({ preventScroll: true });
    placeCaret(el, caretAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.id]);

  // When the editor closes, keep keyboard focus in the viewer so shortcuts
  // (undo, zoom...) keep working instead of falling through to <body>.
  useEffect(() => {
    const viewer = boxRef.current?.closest<HTMLElement>('.rpe-viewer');
    return () => {
      setTimeout(() => {
        const a = document.activeElement;
        if (viewer && (!a || a === document.body)) viewer.focus({ preventScroll: true });
      }, 0);
    };
  }, []);

  // Remember the selection so toolbar controls that steal focus can restore it.
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      const el = textRef.current;
      if (sel && sel.rangeCount && el && el.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  // Register the imperative API used by the format bar and by commit.
  const frameColor = frame.color;
  const defaultFont = frameFont(frame);
  useEffect(() => {
    inlineEditorRef.current = {
      read: () => (textRef.current ? readParagraphs(textRef.current, frameColor, defaultFont) : frame.paragraphs),
      focus: () => textRef.current?.focus({ preventScroll: true }),
      exec: (command, value) => {
        const el = textRef.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        const sel = window.getSelection();
        if (savedRange.current && sel) {
          sel.removeAllRanges();
          sel.addRange(savedRange.current);
        }
        document.execCommand(command, false, value);
      },
      setFont: (font) => {
        const el = textRef.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        const sel = window.getSelection();
        if (savedRange.current && sel) {
          sel.removeAllRanges();
          sel.addRange(savedRange.current);
        }
        const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
        if (!range || range.collapsed || !el.contains(range.commonAncestorContainer)) {
          // Nothing selected: the whole box changes font.
          el.querySelectorAll<HTMLElement>('[style]').forEach((n) => n.style.removeProperty('font-family'));
          el.querySelectorAll('font[face]').forEach((n) => n.removeAttribute('face'));
          updateActiveFrame({ font });
          markActiveChanged();
          return;
        }
        document.execCommand('fontName', false, cssFontStack(frameRef.current, font));
        markActiveChanged();
      },
    };
    return () => {
      inlineEditorRef.current = null;
    };
  }, [inlineEditorRef, frameColor, defaultFont, frame.paragraphs, updateActiveFrame, markActiveChanged]);

  // Clicking anywhere else commits, like leaving a text box in a word processor.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (boxRef.current?.contains(t)) return;
      if (t.closest(`[${KEEP_EDITING_ATTR}]`)) return;
      endEdit();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [endEdit]);

  // ---- move / resize ----------------------------------------------------
  const drag = (kind: 'move' | 'resize') => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { x: frame.x, baseline: frame.baseline, width: frame.width };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / s;
      const dy = (ev.clientY - startY) / s;
      if (kind === 'move') updateActiveFrame({ x: start.x + dx, baseline: start.baseline - dy });
      else updateActiveFrame({ width: Math.max(frame.size * 2, Math.min(maxRight - start.x, start.width + dx)) });
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      textRef.current?.focus({ preventScroll: true });
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const fontPx = frame.size * s;
  const lineHeightPx = frame.lineHeight * s;
  const pos = toCss(frame.x, frame.baseline);
  const top = pos.top - cssBaselineOffset(frame.family, fontPx, lineHeightPx);
  const style: CSSProperties = {
    left: pos.left,
    top,
    width: frame.width * s,
  };
  const textStyle: CSSProperties = {
    fontFamily: cssFontStack(frame, defaultFont),
    fontSize: fontPx,
    lineHeight: `${lineHeightPx}px`,
    color: cssColor(frame.color),
    textAlign: frame.align,
    background: frame.cover ? cssColor(frame.cover) : undefined,
    minHeight: lineHeightPx,
  };

  return (
    <div ref={boxRef} className="rpe-inline" style={style}>
      <div
        ref={textRef}
        className="rpe-inline-text"
        style={textStyle}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Edit text"
        spellCheck
        onKeyDown={(e) => {
          e.stopPropagation();
          // Formatting the app has hidden must not be reachable by shortcut either.
          if (e.ctrlKey || e.metaKey) {
            const k = e.key.toLowerCase();
            const blocked =
              (k === 'b' && !tools.has('bold')) ||
              (k === 'i' && !tools.has('italic')) ||
              (k === 'u' && !tools.has('underline'));
            if (blocked) {
              e.preventDefault();
              return;
            }
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            endEdit({ discard: true });
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            endEdit();
          }
        }}
        onInput={markActiveChanged}
        onPaste={(e) => {
          // Paste as plain text so foreign fonts/sizes don't leak in.
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
      />
      <button
        type="button"
        className="rpe-inline-handle rpe-inline-move"
        aria-label="Move text box"
        title="Drag to move"
        onPointerDown={drag('move')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
        </svg>
      </button>
      <span
        className="rpe-inline-handle rpe-inline-resize"
        role="slider"
        aria-label="Text box width"
        aria-valuenow={Math.round(frame.width)}
        title="Drag to change width"
        onPointerDown={drag('resize')}
      />
    </div>
  );
}
