import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { PdfInput } from '../core/load';
import { DEFAULT_MAX_FILE_SIZE } from '../core/load';
import { useDropTarget } from '../hooks/useDropTarget';
import { useElementSize } from '../hooks/useElementSize';
import { PDF_ACCEPT, pickFiles } from '../hooks/useFilePicker';
import { usePdfEditor, type PdfEditorController, type SaveInfo, type UsePdfEditorOptions } from '../hooks/usePdfEditor';
import { EditorProvider } from './context';
import { IconAlert, IconClose, IconInfo, IconUpload } from './icons';
import { FormatBar } from './FormatBar';
import { PasswordDialog } from './PasswordDialog';
import { PdfDropzone } from './PdfDropzone';
import { PdfViewer } from './PdfViewer';
import { ThumbnailSidebar } from './ThumbnailSidebar';
import { PdfLoader } from './PdfLoader';
import { Toolbar } from './Toolbar';
import {
  MAIN_TOOLBAR_OPTIONS,
  ToolbarConfigProvider,
  makeToolbarConfig,
  type CustomTool,
  type ToolbarOption,
} from './toolbarConfig';

/** Below this width (of the editor itself, not the window) the layout goes compact. */
export const COMPACT_BREAKPOINT = 768;

export interface PdfEditorProps extends UsePdfEditorOptions {
  /** A PDF to open. Changing it opens the new file. Omit to start on the upload screen. */
  file?: PdfInput | null;
  /** Bring your own controller from `usePdfEditor()`. Option props are then ignored. */
  editor?: PdfEditorController;
  /** Allow opening files from the user's computer (button, drag & drop, Ctrl+O). Default true. */
  allowUpload?: boolean;
  /** Show the Edit button and allow in-place text editing. Default true. */
  enableEditMode?: boolean;
  /**
   * Called with the PDF (edits applied) when the user clicks Save or presses
   * Ctrl/⌘+S. Adds a Save button. Return a promise (e.g. an upload) to keep
   * the saving state until it settles; throw to report a failure. Without
   * `onSave`, Ctrl/⌘+S downloads the file.
   */
  onSave?(bytes: Uint8Array, info: SaveInfo): void | Promise<void>;
  /**
   * Called when the user opens a file from their device (file picker or drag
   * & drop), before it is loaded. Return `false` to stop the editor from
   * opening it (for example to upload it first and pass it back via `file`).
   */
  onOpen?(file: File): boolean | void | Promise<boolean | void>;
  /**
   * Which tools to show. Default: all. Main toolbar:
   * 'sidebar' | 'open' | 'fileName' | 'pageNav' | 'zoom' | 'edit' | 'download' | 'save'.
   * Formatting bar (Edit mode): 'undo' | 'redo' | 'fontSelection' | 'fontSize' | 'bold' |
   * 'italic' | 'underline' | 'textColor' | 'alignment' | 'deleteText'.
   * Tools always appear in this order. Hidden formatting tools also lose their
   * keyboard shortcut. `[]` hides the toolbar (custom tools still show).
   */
  toolbarOptions?: readonly ToolbarOption[];
  /** Your own buttons, shown in the toolbar before Save. `onClick` receives the edited PDF bytes. */
  customTools?: readonly CustomTool[];
  /** Show the loading overlay (e.g. while your app fetches or saves). Default false. */
  loadingState?: boolean;
  /** Replaces the default spinner in every loading overlay. */
  loadingComponent?: ReactNode;
  /** Show the thumbnail sidebar toggle. Default true. */
  showSidebar?: boolean;
  /** Render selectable text over pages. Default true. */
  textLayer?: boolean;
  theme?: 'light' | 'dark' | 'system';
  /** Extra toolbar controls. */
  toolbarExtras?: ReactNode;
  /** Replace the default empty state. */
  emptyState?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function PdfEditor(props: PdfEditorProps) {
  const {
    file,
    editor: external,
    allowUpload = true,
    enableEditMode = true,
    onSave,
    onOpen,
    toolbarOptions,
    customTools,
    loadingState = false,
    loadingComponent,
    showSidebar = true,
    textLayer = true,
    theme = 'system',
    toolbarExtras,
    emptyState,
    className,
    style,
    ...options
  } = props;
  const internal = usePdfEditor(options);
  const toolbarKey = toolbarOptions ? toolbarOptions.join('|') : '*';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const toolbarConfig = useMemo(() => makeToolbarConfig(toolbarOptions), [toolbarKey]);
  const editor = external ?? internal;

  const rootRef = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(rootRef);
  const measured = width > 0;
  const compact = measured && width < COMPACT_BREAKPOINT;

  // ---- open the `file` prop ----------------------------------------------
  const { load } = editor;
  useEffect(() => {
    if (file) void load(file);
  }, [file, load]);

  // ---- sidebar: docked on wide layouts, a drawer on compact ones ----------
  const [sidebarPref, setSidebarPref] = useState<boolean | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const docked = !compact && (sidebarPref ?? width >= 1024);
  useEffect(() => {
    if (!compact) setDrawerOpen(false);
  }, [compact]);
  const sidebarVisible = showSidebar && editor.pageCount > 0 && (compact ? drawerOpen : docked);
  const toggleSidebar = useCallback(() => {
    if (compact) setDrawerOpen((o) => !o);
    else setSidebarPref(!docked);
  }, [compact, docked]);

  // ---- open from computer ---------------------------------------------------
  const isDirty = editor.isDirty;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const openFile = useCallback(
    async (f: File) => {
      if (isDirty && !window.confirm('Open a new file? Your unsaved edits to this one will be lost.')) return;
      setDrawerOpen(false);
      const proceed = await onOpenRef.current?.(f);
      if (proceed === false) return;
      void load(f);
    },
    [load, isDirty],
  );

  // ---- save ----------------------------------------------------------------
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const hasSave = !!onSave;
  const save = useCallback(() => {
    const handler = onSaveRef.current;
    if (handler) void editor.save(handler);
    else void editor.download();
  }, [editor]);

  // ---- editing ------------------------------------------------------------
  const { session, setMode, showNotice } = editor;
  const editing = editor.mode === 'edit';
  // Turning the prop off mid-edit commits and leaves edit mode.
  useEffect(() => {
    if (!enableEditMode && editing) setMode('view');
  }, [enableEditMode, editing, setMode]);
  const toggleEdit = useCallback(async () => {
    if (editing) {
      setMode('view');
      return;
    }
    const check = await session?.editability();
    if (check && !check.ok) {
      showNotice(check.reason ?? "This PDF can't be edited.");
      return;
    }
    setMode('edit');
  }, [editing, session, setMode, showNotice]);

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);
  const openPicker = useCallback(() => {
    void pickFiles({ accept: PDF_ACCEPT }).then((files) => files[0] && openFile(files[0]));
  }, [openFile]);

  // Dropping onto an open document replaces it (merging comes with page ops).
  const hasDoc = editor.pageCount > 0;
  const isDragOver = useDropTarget(rootRef, {
    onFiles: (files) => files[0] && openFile(files[0]),
    disabled: !allowUpload || !hasDoc,
  });

  type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'preventDefault'> & {
    target: EventTarget | null;
  };
  const onKeyDown = (e: ShortcutEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape' && drawerOpen) {
      setDrawerOpen(false);
      return;
    }
    if (!mod) return;
    if (e.key.toLowerCase() === 's' && hasDoc) {
      // Ctrl/⌘+S saves (or downloads) instead of saving the web page.
      e.preventDefault();
      save();
      return;
    }
    const inField = (e.target as Element | null)?.closest?.('input, select, textarea, [contenteditable="true"]');
    if (!inField && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
      return;
    }
    if (!inField && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      editor.redo();
      return;
    }
    if (e.key === 'o' && allowUpload) {
      e.preventDefault();
      openPicker();
    } else if (hasDoc && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      editor.zoomIn();
    } else if (hasDoc && e.key === '-') {
      e.preventDefault();
      editor.zoomOut();
    } else if (hasDoc && e.key === '0') {
      e.preventDefault();
      editor.setZoom('auto');
    }
  };

  // Shortcuts also work when focus has fallen back to <body> (e.g. after a
  // text box closes on mobile), as long as the user last interacted with this
  // editor. Keys typed into the host app's own fields are never intercepted.
  const keyHandlerRef = useRef(onKeyDown);
  keyHandlerRef.current = onKeyDown;
  useEffect(() => {
    let engaged = false;
    const onDown = (e: PointerEvent) => {
      engaged = !!rootRef.current?.contains(e.target as Node);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      const active = document.activeElement;
      if (!engaged || (active && active !== document.body)) return;
      keyHandlerRef.current(e);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const showLoading = loadingState || editor.status === 'loading';
  const loadingLabel = editor.status === 'loading' ? `Opening ${editor.loadingName ?? 'PDF'}…` : 'Loading…';
  const rootClass = [
    'rpe-root',
    compact && 'rpe-compact',
    !measured && 'rpe-unmeasured',
    theme !== 'system' && `rpe-theme-${theme}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <EditorProvider editor={editor}>
      <ToolbarConfigProvider value={toolbarConfig}>
      <div ref={rootRef} className={rootClass} style={style} onKeyDown={onKeyDown}>
        {(MAIN_TOOLBAR_OPTIONS.some((o) => toolbarConfig.has(o)) || customTools?.length || toolbarExtras) && (
          <Toolbar
            customTools={customTools}
            onOpen={allowUpload ? openPicker : undefined}
            onToggleSidebar={showSidebar ? toggleSidebar : undefined}
            sidebarOpen={sidebarVisible}
            onToggleEdit={enableEditMode ? () => void toggleEdit() : undefined}
            onSave={hasSave ? save : undefined}
          >
            {toolbarExtras}
          </Toolbar>
        )}

        {editing && enableEditMode && hasDoc && <FormatBar />}

        {editor.notice && (
          <div className="rpe-alert rpe-alert--info" role="status">
            <IconInfo />
            <span className="rpe-alert-text">{editor.notice}</span>
            <button
              type="button"
              className="rpe-btn rpe-btn--icon rpe-btn--ghost"
              onClick={() => showNotice(null)}
              aria-label="Dismiss"
            >
              <IconClose />
            </button>
          </div>
        )}

        {editor.error && (
          <div className="rpe-alert" role="alert">
            <IconAlert />
            <span className="rpe-alert-text">{editor.error.message}</span>
            <button
              type="button"
              className="rpe-btn rpe-btn--icon rpe-btn--ghost"
              onClick={editor.clearError}
              aria-label="Dismiss"
            >
              <IconClose />
            </button>
          </div>
        )}

        <div className="rpe-body">
          {hasDoc ? (
            <>
              {sidebarVisible && compact && (
                <div className="rpe-drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
              )}
              {sidebarVisible && (
                <ThumbnailSidebar
                  className={compact ? 'rpe-sidebar--drawer' : undefined}
                  onNavigate={compact ? () => setDrawerOpen(false) : undefined}
                />
              )}
              <PdfViewer textLayer={textLayer} />
            </>
          ) : showLoading ? null : allowUpload ? (
            (emptyState ?? <PdfDropzone onFile={openFile} maxFileSize={maxFileSize} />)
          ) : (
            (emptyState ?? <div className="rpe-empty">No document</div>)
          )}

          {isDragOver && (
            <div className="rpe-drop-overlay" aria-hidden="true">
              <IconUpload width={32} height={32} />
              <span>Drop to open</span>
            </div>
          )}
        </div>

        {/* Covers the toolbar too, so nothing can be clicked mid-load. */}
        {showLoading && (
          <div className="rpe-loading" aria-busy="true">
            {loadingComponent ?? <PdfLoader label={loadingLabel} />}
          </div>
        )}

        {editor.passwordRequest && <PasswordDialog request={editor.passwordRequest} />}
      </div>
      </ToolbarConfigProvider>
    </EditorProvider>
  );
}
