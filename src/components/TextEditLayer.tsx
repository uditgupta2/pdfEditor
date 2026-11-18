import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { cssBaselineOffset, sampleBackground } from '../edit/dom';
import type { PageAnalysis, TextBlock } from '../edit/extract';
import { cssFontStack, frameFont } from '../edit/faces';
import { layoutFrame } from '../edit/layout';
import { CSS_FONT_METRICS } from '../edit/metrics';
import { useFontLibraryVersion } from '../hooks/useFontLibrary';
import { frameFromBlock } from '../edit/frames';
import { cssColor, newId, type TextFrame } from '../edit/model';
import { PDF_TO_CSS_UNITS, type PageSize } from '../core/zoom';
import { useEditor } from './context';
import { InlineEditor } from './InlineEditor';

export interface TextEditLayerProps {
  pageIndex: number;
  scale: number;
  size: PageSize;
  /** True once the page bitmap reflects the current removals. */
  baseUpToDate: boolean;
}

/** Committed frame rendered as positioned HTML text (selectable, crisp at any zoom). */
const FrameView = memo(function FrameView({
  frame,
  s,
  toCss,
  covered,
  baked,
  interactive,
  onEdit,
}: {
  frame: TextFrame;
  s: number;
  toCss(x: number, y: number): { left: number; top: number };
  covered: boolean;
  /** The page bitmap already shows this frame's text (drawn by the PDF renderer, in its real fonts). */
  baked: boolean;
  interactive: boolean;
  onEdit(frame: TextFrame, e: MouseEvent): void;
}) {
  const fontsVersion = useFontLibraryVersion();
  const layout = useMemo(() => layoutFrame(frame), [frame, fontsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const fontPx = frame.size * s;
  const origin = toCss(frame.x, frame.baseline);
  const asc = CSS_FONT_METRICS[frame.family].ascent * fontPx;
  const top = origin.top - asc;
  const height = Math.max(layout.height * s, fontPx);
  const fragTop = cssBaselineOffset(frame.family, fontPx, fontPx);
  return (
    <div
      className={`rpe-frame${interactive ? ' is-interactive' : ''}${baked ? ' is-baked' : ''}`}
      style={{
        left: origin.left,
        top,
        width: frame.width * s,
        height,
        background: covered && frame.cover ? cssColor(frame.cover) : undefined,
      }}
      onClick={interactive ? (e) => onEdit(frame, e) : undefined}
    >
      {layout.lines.map((line, li) =>
        line.fragments.map((f, fi) => (
          <span
            key={`${li}-${fi}`}
            className="rpe-frag"
            style={{
              left: f.x * s,
              top: asc + line.dy * s - fragTop,
              fontFamily: cssFontStack(frame, f.font ?? frameFont(frame)),
              fontSize: fontPx,
              lineHeight: `${fontPx}px`,
              fontWeight: f.bold ? 700 : 400,
              fontStyle: f.italic ? 'italic' : 'normal',
              textDecoration: f.underline ? 'underline' : undefined,
              color: cssColor(f.color ?? frame.color),
            }}
          >
            {f.text}
            {/* invisible, so copied text keeps word and line breaks */}
            {f.spaceAfter || fi === line.fragments.length - 1 ? ' ' : ''}
          </span>
        )),
      )}
    </div>
  );
});

export function TextEditLayer({ pageIndex, scale, size, baseUpToDate }: TextEditLayerProps) {
  const editor = useEditor();
  const { mode, edits, activeEdit, session, beginEdit } = editor;
  const editing = mode === 'edit';
  const layerRef = useRef<HTMLDivElement>(null);
  const [analysis, setAnalysis] = useState<PageAnalysis | null>(null);
  const [caretAt, setCaretAt] = useState<{ x: number; y: number } | null>(null);

  const s = scale * PDF_TO_CSS_UNITS;
  const view = size.view ?? [0, 0, size.width, size.height];
  const rotated = (size.rotation ?? 0) % 360 !== 0;
  const toCss = useMemo(
    () => (x: number, y: number) => ({ left: (x - view[0]) * s, top: (view[3] - y) * s }),
    [s, view[0], view[3]], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (!editing || !session || rotated) return;
    let alive = true;
    session.analyze(pageIndex).then(
      (a) => alive && setAnalysis(a),
      (e) => console.warn('[pdf-editor] could not analyse page', pageIndex + 1, e),
    );
    return () => {
      alive = false;
    };
  }, [editing, session, pageIndex, rotated]);

  const pageEdits = edits[pageIndex];
  const removed = useMemo(() => new Set(pageEdits?.removedRuns ?? []), [pageEdits]);
  const frames = pageEdits?.frames ?? [];
  const activeHere = activeEdit?.pageIndex === pageIndex ? activeEdit : null;

  const canvas = () => layerRef.current?.closest('.rpe-page')?.querySelector('canvas') ?? null;

  const editBlock = (block: TextBlock, e: MouseEvent) => {
    e.stopPropagation();
    const left = (block.x0 - view[0]) * s;
    const top = (view[3] - block.top) * s;
    const cover = sampleBackground(canvas(), { left, top, width: (block.x1 - block.x0) * s, height: (block.top - block.bottom) * s }, size.width * s);
    setCaretAt({ x: e.clientX, y: e.clientY });
    beginEdit({ pageIndex, frame: frameFromBlock(block, analysis?.fonts ?? {}, cover), sourceRunIds: block.runIds });
  };

  const editFrame = (frame: TextFrame, e: MouseEvent) => {
    e.stopPropagation();
    setCaretAt({ x: e.clientX, y: e.clientY });
    beginEdit({ pageIndex, frame, existingFrameId: frame.id, sourceRunIds: [] });
  };

  const addText = (e: MouseEvent) => {
    if (!editing || rotated || e.target !== layerRef.current) return;
    const rect = layerRef.current.getBoundingClientRect();
    const x = view[0] + (e.clientX - rect.left) / s;
    const fontSize = 12;
    const baseline = view[3] - (e.clientY - rect.top) / s - fontSize * 0.35;
    const margin = 36;
    setCaretAt(null);
    beginEdit({
      pageIndex,
      sourceRunIds: [],
      frame: {
        id: newId(),
        x,
        baseline,
        width: Math.max(72, view[2] - margin - x),
        size: fontSize,
        lineHeight: fontSize * 1.2,
        family: 'sans',
        color: [0, 0, 0],
        align: 'left',
        paragraphs: [{ spans: [] }],
      },
    });
  };

  const blocks = editing && analysis ? analysis.blocks.filter((b) => !b.runIds.some((id) => removed.has(id))) : [];
  const activeSource = activeHere?.frame.sourceBlockId;

  if (!editing && !frames.length) return null;

  return (
    <div
      ref={layerRef}
      className={`rpe-edit-layer${editing ? ' is-editing' : ''}`}
      onClick={addText}
      aria-hidden={!editing}
    >
      {blocks.map((b) =>
        b.id === activeSource && !activeHere?.existingFrameId ? null : (
          <div
            key={b.id}
            className={`rpe-block${b.editable ? '' : ' is-locked'}`}
            style={{
              left: (b.x0 - view[0]) * s - 2,
              top: (view[3] - b.top) * s - 2,
              width: (b.x1 - b.x0) * s + 4,
              height: (b.top - b.bottom) * s + 4,
            }}
            title={b.editable ? 'Click to edit' : "This text uses a font that can't be edited yet"}
            onClick={b.editable ? (e) => editBlock(b, e) : (e) => e.stopPropagation()}
          />
        ),
      )}
      {frames.map((f) =>
        activeHere?.existingFrameId === f.id ? null : (
          <FrameView
            key={f.id}
            frame={f}
            s={s}
            toCss={toCss}
            covered={!baseUpToDate}
            baked={baseUpToDate}
            interactive={editing}
            onEdit={editFrame}
          />
        ),
      )}
      {activeHere &&
        activeSource &&
        !activeHere.existingFrameId &&
        (() => {
          // Hide the original paragraph's full area while it is being rewritten.
          const b = analysis?.blocks.find((x) => x.id === activeSource);
          if (!b) return null;
          return (
            <div
              className="rpe-cover"
              style={{
                left: (b.x0 - view[0]) * s - 1,
                top: (view[3] - b.top) * s - 1,
                width: (b.x1 - b.x0) * s + 2,
                height: (b.top - b.bottom) * s + 2,
                background: cssColor(activeHere.frame.cover ?? [1, 1, 1]),
              }}
            />
          );
        })()}
      {activeHere && (
        <InlineEditor active={activeHere} s={s} toCss={toCss} caretAt={caretAt} maxRight={view[2]} />
      )}
    </div>
  );
}
