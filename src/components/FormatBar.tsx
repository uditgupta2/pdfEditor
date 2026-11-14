import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { hexColor, parseCssColor, type Align } from '../edit/model';
import { useEditor } from './context';
import { KEEP_EDITING_ATTR } from './InlineEditor';
import { useToolbarConfig, type FormatToolOption } from './toolbarConfig';

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

const svg = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICONS = {
  undo: svg('M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3'),
  redo: svg('m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3'),
  bold: svg('M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z'),
  italic: svg('M15 4h-5M14 20H9M14 4l-4 16'),
  underline: svg('M7 4v7a5 5 0 0 0 10 0V4M5 20h14'),
  left: svg('M4 6h16M4 10h10M4 14h16M4 18h10'),
  center: svg('M4 6h16M7 10h10M4 14h16M7 18h10'),
  right: svg('M4 6h16M10 10h10M4 14h16M10 18h10'),
  justify: svg('M4 6h16M4 10h16M4 14h16M4 18h16'),
  trash: svg('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'),
  check: svg('M5 12l5 5 9-11'),
};

function useSelectionState(enabled: boolean) {
  const [state, setState] = useState({ bold: false, italic: false, underline: false, color: '#000000' });
  useEffect(() => {
    if (!enabled) return;
    const update = () => {
      try {
        const color = parseCssColor(String(document.queryCommandValue('foreColor')));
        setState({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          color: color ? hexColor(color) : '#000000',
        });
      } catch {
        /* queryCommandState unsupported */
      }
    };
    update();
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [enabled]);
  return state;
}

const MIN_SIZE = 4;
const MAX_SIZE = 400;
const roundSize = (n: number) => Math.round(n * 10) / 10;

/** Next/previous preset size, like a word processor's grow/shrink font. */
export function stepFontSize(size: number, dir: 1 | -1): number {
  if (dir > 0) return SIZES.find((s) => s > size + 0.05) ?? Math.min(MAX_SIZE, Math.ceil(size + 1));
  for (let i = SIZES.length - 1; i >= 0; i--) if (SIZES[i]! < size - 0.05) return SIZES[i]!;
  return Math.max(MIN_SIZE, Math.floor(size - 1));
}

function FontSizeStepper({
  size,
  disabled,
  onChange,
}: {
  size: number | undefined;
  disabled: boolean;
  /** `refocus`: return the caret to the text being edited afterwards. */
  onChange(size: number, refocus: boolean): void;
}) {
  const shown = size != null ? String(roundSize(size)) : '';
  const [draft, setDraftState] = useState(shown);
  // A ref, not just state: blur can fire synchronously in the middle of a
  // change, before React re-renders, and must not re-apply a stale value.
  const draftRef = useRef(shown);
  const setDraft = (v: string) => {
    draftRef.current = v;
    setDraftState(v);
  };
  useEffect(() => setDraft(shown), [shown]);

  const apply = (n: number, refocus: boolean) => {
    const next = roundSize(Math.min(MAX_SIZE, Math.max(MIN_SIZE, n)));
    setDraft(String(next));
    onChange(next, refocus);
  };
  const commit = (refocus: boolean) => {
    const n = parseFloat(draftRef.current.replace(',', '.'));
    if (!Number.isFinite(n)) return setDraft(shown);
    if (size != null && roundSize(n) === roundSize(size)) return;
    apply(n, refocus);
  };
  const step = (dir: 1 | -1, refocus: boolean) => size != null && apply(stepFontSize(size, dir), refocus);

  return (
    <span className={`rpe-stepper${disabled ? ' is-disabled' : ''}`} role="group" aria-label="Font size">
      <button
        type="button"
        className="rpe-stepper-btn"
        aria-label="Decrease font size"
        title="Smaller"
        disabled={disabled || (size ?? 0) <= MIN_SIZE}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => step(-1, true)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M5 12h14" />
        </svg>
      </button>
      <input
        className="rpe-stepper-input"
        type="text"
        inputMode="decimal"
        aria-label="Font size in points"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, '').slice(0, 5))}
        onFocus={(e) => e.target.select()}
        onBlur={() => commit(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(true);
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            // Stay in the box so the arrows can be pressed repeatedly.
            e.preventDefault();
            step(e.key === 'ArrowUp' ? 1 : -1, false);
          } else if (e.key === 'Escape') {
            setDraft(shown);
          }
        }}
      />
      <button
        type="button"
        className="rpe-stepper-btn"
        aria-label="Increase font size"
        title="Larger"
        disabled={disabled || (size ?? 0) >= MAX_SIZE}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => step(1, true)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </span>
  );
}

function Btn({
  label,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string;
  onClick(): void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rpe-btn rpe-btn--icon${active ? ' is-active' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep focus and selection inside the text being edited.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function FormatBar() {
  const editor = useEditor();
  const { activeEdit, inlineEditorRef, updateActiveFrame, canUndo, canRedo } = editor;
  const frame = activeEdit?.frame;
  const on = !!frame;
  const sel = useSelectionState(on);
  const exec = (cmd: 'bold' | 'italic' | 'underline' | 'foreColor', v?: string) => inlineEditorRef.current?.exec(cmd, v);
  const setAlign = (align: Align) => updateActiveFrame({ align });
  const setSize = (size: number, refocus: boolean) => {
    if (!frame || !(size > 0)) return;
    updateActiveFrame({ size, lineHeight: (frame.lineHeight / frame.size) * size });
    if (refocus) inlineEditorRef.current?.focus();
  };

  const has = useToolbarConfig().has;
  const tool = (name: FormatToolOption, node: ReactNode) => (has(name) ? <Fragment key={name}>{node}</Fragment> : null);

  // Groups are separated by dividers; empty groups (all tools hidden) vanish.
  const groups: ReactNode[][] = [
    [
      tool(
        'undo',
        <Btn label="Undo (Ctrl+Z)" onClick={editor.undo} disabled={!canUndo || on}>
          {ICONS.undo}
        </Btn>,
      ),
      tool(
        'redo',
        <Btn label="Redo (Ctrl+Shift+Z)" onClick={editor.redo} disabled={!canRedo || on}>
          {ICONS.redo}
        </Btn>,
      ),
    ],
    // No font picker yet: edited text keeps the closest standard font to the
    // original (sans, serif or mono) until custom fonts are supported.
    [tool('fontSize', <FontSizeStepper size={frame?.size} disabled={!on} onChange={setSize} />)],
    [
      tool(
        'bold',
        <Btn label="Bold (Ctrl+B)" onClick={() => exec('bold')} active={on && sel.bold} disabled={!on}>
          {ICONS.bold}
        </Btn>,
      ),
      tool(
        'italic',
        <Btn label="Italic (Ctrl+I)" onClick={() => exec('italic')} active={on && sel.italic} disabled={!on}>
          {ICONS.italic}
        </Btn>,
      ),
      tool(
        'underline',
        <Btn label="Underline (Ctrl+U)" onClick={() => exec('underline')} active={on && sel.underline} disabled={!on}>
          {ICONS.underline}
        </Btn>,
      ),
      tool(
        'textColor',
        <label className={`rpe-color${on ? '' : ' is-disabled'}`} title="Text colour">
          <span className="rpe-color-swatch" style={{ background: on ? sel.color : undefined }} />
          <input
            type="color"
            aria-label="Text colour"
            disabled={!on}
            value={sel.color}
            onChange={(e) => exec('foreColor', e.target.value)}
          />
        </label>,
      ),
    ],
    [
      tool(
        'alignment',
        (['left', 'center', 'right', 'justify'] as const).map((a) => (
          <Btn key={a} label={`Align ${a}`} onClick={() => setAlign(a)} active={frame?.align === a} disabled={!on}>
            {ICONS[a]}
          </Btn>
        )),
      ),
    ],
    [
      tool(
        'deleteText',
        <Btn label="Delete text" onClick={editor.deleteActive} disabled={!on}>
          {ICONS.trash}
        </Btn>,
      ),
    ],
  ].map((g) => g.filter(Boolean));
  const visible = groups.filter((g) => g.length);

  return (
    <div className="rpe-formatbar" role="toolbar" aria-label="Text formatting" {...{ [KEEP_EDITING_ATTR]: '' }}>
      <div className="rpe-formatbar-scroll">
        {visible.map((g, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="rpe-divider" aria-hidden="true" />}
            {g}
          </Fragment>
        ))}
        {on ? (
          <button
            type="button"
            className="rpe-btn rpe-btn--primary rpe-done"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.endEdit()}
          >
            {ICONS.check}
            <span className="rpe-btn-label">Done</span>
          </button>
        ) : (
          <span className="rpe-formatbar-hint">Click any text to edit it · click an empty spot to add text</span>
        )}
      </div>
    </div>
  );
}
