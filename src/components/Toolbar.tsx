import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { formatBytes } from '../core/load';
import { hasEdits } from '../edit/model';
import type { ZoomValue } from '../core/zoom';
import { useEditor } from './context';
import { useToolbarConfig, type CustomTool, type MainToolbarOption } from './toolbarConfig';
import {
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconEdit,
  IconFitWidth,
  IconMinus,
  IconMore,
  IconPlus,
  IconSave,
  IconSidebar,
  IconUpload,
} from './icons';

export interface ToolbarProps {
  /** Buttons added by the app, shown before Save. */
  customTools?: readonly CustomTool[];
  /** Save handler. Omit to hide the Save button. */
  onSave?(): void;
  /** Open the file picker. Omit to hide the Open button. */
  onOpen?(): void;
  onToggleSidebar?(): void;
  sidebarOpen?: boolean;
  /** Toggle text editing. Omit to hide the Edit button. */
  onToggleEdit?(): void;
  /** Extra controls rendered at the end of the toolbar. */
  children?: ReactNode;
}

const ZOOM_PRESETS: { value: ZoomValue; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'page-width', label: 'Page width' },
  { value: 'page-fit', label: 'Whole page' },
  { value: 0.5, label: '50%' },
  { value: 0.75, label: '75%' },
  { value: 1, label: '100%' },
  { value: 1.25, label: '125%' },
  { value: 1.5, label: '150%' },
  { value: 2, label: '200%' },
  { value: 3, label: '300%' },
];

function PageNumberInput() {
  const { currentPage, pageCount, goToPage } = useEditor();
  const [draft, setDraft] = useState(String(currentPage + 1));
  useEffect(() => setDraft(String(currentPage + 1)), [currentPage]);

  const commit = () => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n)) goToPage(n - 1);
    else setDraft(String(currentPage + 1));
  };

  return (
    <span className="rpe-pagenum">
      <input
        className="rpe-input rpe-pagenum-input"
        inputMode="numeric"
        aria-label="Page number"
        value={draft}
        disabled={!pageCount}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        onFocus={(e) => e.target.select()}
      />
      <span className="rpe-pagenum-total">/ {pageCount || '–'}</span>
    </span>
  );
}

/** Runs custom tools with the current PDF bytes; one busy state per tool. */
function useCustomToolRunner() {
  const editor = useEditor();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const run = useCallback(
    async (tool: CustomTool) => {
      if (busy.has(tool.id)) return;
      setBusy((b) => new Set(b).add(tool.id));
      try {
        const bytes = await editor.exportPdf();
        const base = editor.fileName ?? 'document.pdf';
        const edited = editor.isDirty || hasEdits(editor.edits);
        await tool.onClick(bytes, { fileName: edited ? base.replace(/(\.pdf)?$/i, '-edited.pdf') : base, edited });
      } catch (e) {
        editor.reportError(e, tool.label);
      } finally {
        setBusy((b) => {
          const next = new Set(b);
          next.delete(tool.id);
          return next;
        });
      }
    },
    [busy, editor],
  );
  return { busy, run };
}

const spinner = <span className="rpe-spinner rpe-spinner--sm" aria-hidden="true" />;

interface MenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect(): void;
  disabled?: boolean;
  busy?: boolean;
}

/** The ⋯ menu that holds toolbar items which don't fit. */
function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      wrapRef.current?.querySelector<HTMLButtonElement>('.rpe-more-btn')?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
    );
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  };

  return (
    <span ref={wrapRef} className="rpe-more" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="rpe-btn rpe-btn--icon rpe-more-btn"
        aria-label="More tools"
        title="More tools"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {items.some((i) => i.busy) ? spinner : <IconMore />}
      </button>
      {open && (
        <div ref={menuRef} className="rpe-menu" role="menu" aria-label="More tools">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="rpe-menu-item"
              data-tool-id={item.id.startsWith('custom:') ? item.id.slice(7) : undefined}
              disabled={item.disabled || item.busy}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              <span className="rpe-menu-icon">{item.busy ? spinner : item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * True when a group's items need more width than it has. Summed by hand
 * because right-aligned groups overflow to the left, which `scrollWidth`
 * does not report.
 */
function groupOverflows(group: Element): boolean {
  const style = getComputedStyle(group);
  const gap = parseFloat(style.columnGap) || 0;
  let needed = 0;
  let count = 0;
  for (const child of Array.from(group.children)) {
    const cs = getComputedStyle(child);
    if (cs.display === 'none' || cs.position === 'absolute') continue;
    // Shrinkable items (the file name) can give their space up.
    const min = parseFloat(cs.flexShrink) > 0 && cs.minWidth === '0px' ? 0 : child.getBoundingClientRect().width;
    needed += min + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
    count++;
  }
  needed += gap * Math.max(0, count - 1);
  const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  return needed > group.clientWidth - pad + 1;
}

/**
 * Moves items into the ⋯ menu, least important first, until the toolbar fits.
 * Measured in a layout effect so the intermediate states are never painted.
 */
function useOverflowCollapse(steps: string[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState(0);
  const stepsKey = steps.join('|');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const overflows = el.scrollWidth > el.clientWidth + 1 || Array.from(el.children).some(groupOverflows);
    if (overflows && level < steps.length) setLevel(level + 1);
  });

  // Start over when the toolbar is resized or its items change.
  useEffect(() => setLevel(0), [stepsKey]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== last) {
        last = el.clientWidth;
        setLevel(0);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, collapsed: new Set(steps.slice(0, level)) };
}

export function Toolbar({
  customTools = [],
  onSave,
  onOpen,
  onToggleSidebar,
  sidebarOpen,
  onToggleEdit,
  children,
}: ToolbarProps) {
  const config = useToolbarConfig();
  const show = (o: MainToolbarOption) => config.has(o);
  const editor = useEditor();
  const { status, fileName, fileSize, pageCount, currentPage, zoom, scale, mode, saving, isDirty } = editor;
  const editing = mode === 'edit';
  const ready = status === 'ready' || (status === 'loading' && pageCount > 0);
  const zoomSelectValue =
    typeof zoom === 'string' ? zoom : ZOOM_PRESETS.some((p) => p.value === zoom) ? String(zoom) : 'custom';
  const tools = useCustomToolRunner();

  // What can move into the ⋯ menu, least important first. 'packed' first
  // drops the centred page navigation so the right-hand side gets the room.
  const hasSidebar = show('sidebar') && !!onToggleSidebar;
  const hasOpen = show('open') && !!onOpen;
  const steps = [
    'packed',
    ...[...customTools].reverse().map((t) => `custom:${t.id}`),
    ...(show('download') ? ['download'] : []),
    ...(show('zoom') ? ['zoom'] : []),
    ...(hasOpen ? ['open'] : []),
    ...(hasSidebar ? ['sidebar'] : []),
  ];
  const { ref: barRef, collapsed } = useOverflowCollapse(steps);
  const inline = (id: string) => !collapsed.has(id);

  const menuItems: MenuItem[] = [];
  if (hasSidebar && !inline('sidebar'))
    menuItems.push({
      id: 'sidebar',
      label: sidebarOpen ? 'Hide thumbnails' : 'Show thumbnails',
      icon: <IconSidebar />,
      onSelect: onToggleSidebar!,
      disabled: !ready,
    });
  if (hasOpen && !inline('open'))
    menuItems.push({ id: 'open', label: 'Open PDF…', icon: <IconUpload />, onSelect: onOpen! });
  if (show('zoom') && !inline('zoom')) {
    menuItems.push(
      {
        id: 'zoom-in',
        label: `Zoom in (${Math.round(scale * 100)}%)`,
        icon: <IconPlus />,
        onSelect: editor.zoomIn,
        disabled: !ready,
      },
      { id: 'zoom-out', label: 'Zoom out', icon: <IconMinus />, onSelect: editor.zoomOut, disabled: !ready },
      {
        id: 'zoom-fit',
        label: 'Fit to width',
        icon: <IconFitWidth />,
        onSelect: () => editor.setZoom('page-width'),
        disabled: !ready,
      },
    );
  }
  if (show('download') && !inline('download'))
    menuItems.push({
      id: 'download',
      label: isDirty ? 'Download edited PDF' : 'Download PDF',
      icon: <IconDownload />,
      onSelect: () => void editor.download(),
      disabled: !ready || saving,
      busy: saving,
    });
  for (const t of customTools)
    if (!inline(`custom:${t.id}`))
      menuItems.push({
        id: `custom:${t.id}`,
        label: t.label,
        icon: t.icon,
        onSelect: () => void tools.run(t),
        disabled: !ready || t.disabled,
        busy: tools.busy.has(t.id),
      });

  return (
    <div
      ref={barRef}
      className={`rpe-toolbar${inline('packed') ? '' : ' rpe-toolbar--packed'}`}
      role="toolbar"
      aria-label="PDF editor"
    >
      <div className="rpe-toolbar-group rpe-toolbar-start">
        {hasSidebar && inline('sidebar') && (
          <button
            type="button"
            className="rpe-btn rpe-btn--icon"
            onClick={onToggleSidebar}
            disabled={!ready}
            aria-label={sidebarOpen ? 'Hide page thumbnails' : 'Show page thumbnails'}
            aria-pressed={sidebarOpen}
            title="Thumbnails"
          >
            <IconSidebar />
          </button>
        )}
        {hasOpen && inline('open') && (
          <button type="button" className="rpe-btn" onClick={onOpen} title="Open a PDF from your device (Ctrl+O)">
            <IconUpload />
            <span className="rpe-btn-label">Open</span>
          </button>
        )}
        {show('fileName') && fileName && (
          <span className="rpe-filename" title={`${fileName} · ${formatBytes(fileSize)}`}>
            {fileName}
          </span>
        )}
      </div>

      <div className="rpe-toolbar-group rpe-toolbar-center">
        {show('pageNav') && (
          <>
            <button
              type="button"
              className="rpe-btn rpe-btn--icon rpe-hide-xs"
              onClick={() => editor.goToPage(currentPage - 1)}
              disabled={!ready || currentPage <= 0}
              aria-label="Previous page"
            >
              <IconChevronUp />
            </button>
            <PageNumberInput />
            <button
              type="button"
              className="rpe-btn rpe-btn--icon rpe-hide-xs"
              onClick={() => editor.goToPage(currentPage + 1)}
              disabled={!ready || currentPage >= pageCount - 1}
              aria-label="Next page"
            >
              <IconChevronDown />
            </button>
          </>
        )}
      </div>

      <div className="rpe-toolbar-group rpe-toolbar-end">
        {show('zoom') && inline('zoom') && (
          <>
            <button
              type="button"
              className="rpe-btn rpe-btn--icon"
              onClick={editor.zoomOut}
              disabled={!ready}
              aria-label="Zoom out"
            >
              <IconMinus />
            </button>
            <select
              className="rpe-input rpe-zoom-select rpe-hide-sm"
              aria-label="Zoom"
              value={zoomSelectValue}
              disabled={!ready}
              onChange={(e) => {
                const v = e.target.value;
                editor.setZoom(v === 'auto' || v === 'page-width' || v === 'page-fit' ? v : Number(v));
              }}
            >
              {ZOOM_PRESETS.map((p) => (
                <option key={String(p.value)} value={String(p.value)}>
                  {p.label}
                </option>
              ))}
              {zoomSelectValue === 'custom' && <option value="custom">{Math.round(scale * 100)}%</option>}
            </select>
            <span className="rpe-zoom-readout rpe-show-sm" aria-live="polite">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className="rpe-btn rpe-btn--icon"
              onClick={editor.zoomIn}
              disabled={!ready}
              aria-label="Zoom in"
            >
              <IconPlus />
            </button>
            <span className="rpe-divider" aria-hidden="true" />
          </>
        )}
        {show('edit') && onToggleEdit && (
          <button
            type="button"
            className={`rpe-btn rpe-edit-toggle${editing ? ' is-active' : ''}`}
            onClick={onToggleEdit}
            disabled={!ready}
            aria-pressed={editing}
            title={editing ? 'Finish editing' : 'Edit text'}
          >
            <IconEdit />
            <span className="rpe-btn-label">Edit</span>
          </button>
        )}
        {show('download') && inline('download') && (
          <button
            type="button"
            className="rpe-btn rpe-btn--icon rpe-download"
            onClick={() => void editor.download()}
            disabled={!ready || saving}
            aria-label={isDirty ? 'Download edited PDF' : 'Download PDF'}
            title={isDirty ? 'Download edited PDF' : 'Download'}
            aria-busy={saving}
          >
            {saving ? <span className="rpe-spinner rpe-spinner--sm" aria-hidden="true" /> : <IconDownload />}
            {isDirty && !saving && !onSave && <span className="rpe-dirty-dot" aria-hidden="true" />}
          </button>
        )}
        {customTools.map((t) =>
          inline(`custom:${t.id}`) ? (
            <button
              key={t.id}
              type="button"
              className={`rpe-btn rpe-custom-tool${t.showLabel ? '' : ' rpe-btn--icon'}`}
              data-tool-id={t.id}
              onClick={() => void tools.run(t)}
              disabled={!ready || t.disabled || tools.busy.has(t.id)}
              aria-busy={tools.busy.has(t.id)}
              aria-label={t.label}
              title={t.label}
            >
              {tools.busy.has(t.id) ? spinner : <span className="rpe-custom-icon">{t.icon}</span>}
              {t.showLabel && <span className="rpe-btn-label">{t.label}</span>}
            </button>
          ) : null,
        )}
        {menuItems.length > 0 && <MoreMenu items={menuItems} />}
        {show('save') && onSave && (
          <button
            type="button"
            className="rpe-btn rpe-btn--primary rpe-save"
            onClick={onSave}
            disabled={!ready || saving}
            aria-busy={saving}
            title={isDirty ? 'Save changes (Ctrl+S)' : 'Save (Ctrl+S)'}
          >
            {saving ? (
              <span className="rpe-spinner rpe-spinner--sm rpe-spinner--on-accent" aria-hidden="true" />
            ) : (
              <IconSave />
            )}
            <span className="rpe-btn-label">{saving ? 'Saving…' : 'Save'}</span>
            {isDirty && !saving && <span className="rpe-dirty-dot" aria-label="Unsaved changes" />}
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
