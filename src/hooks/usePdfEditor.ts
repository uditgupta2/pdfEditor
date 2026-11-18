import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, type MutableRefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfEditorError, isPdfEditorError } from '../core/errors';
import { normalizePdfInput, DEFAULT_MAX_FILE_SIZE, type PdfInput } from '../core/load';
import { nextZoomStep, type PageSize, type ZoomValue } from '../core/zoom';
import { assetUrls, getPdfjs, type PdfjsOptions } from '../render/pdfjs';
import { EditSession } from '../edit/session';
import { fontLibrary, type EditorFont } from '../edit/fontLibrary';
import { hasEdits, type DocumentEdits, type FontChoice, type PageEdits, type TextFrame } from '../edit/model';

export interface FileLoadMeta {
  name: string;
  size: number;
  pageCount: number;
}

export type PasswordReason = 'need' | 'incorrect';

export interface PasswordRequest {
  reason: PasswordReason;
  fileName: string;
  submit(password: string): void;
  cancel(): void;
}

/** What to do with page content the editor could not read, when a page is rewritten. */
export type UnresolvedContentChoice = 'keep' | 'remove';

export interface UnresolvedContentInfo {
  fileName: string;
  /** One-based numbers of the edited pages that contain unreadable content. */
  pages: number[];
  /** Total number of unreadable content streams on those pages. */
  streams: number;
}

export interface UnresolvedContentRequest extends UnresolvedContentInfo {
  choose(choice: UnresolvedContentChoice): void;
  cancel(): void;
}

export interface ExportOptions {
  /**
   * What to do with page content the editor could not read, on pages whose
   * text was edited. When omitted, the user is asked (`onUnresolvedContent`
   * or the built-in dialog).
   */
  unresolvedContent?: UnresolvedContentChoice;
}

export interface UsePdfEditorOptions extends PdfjsOptions {
  /** Max accepted file size in bytes. Default 100 MB. `0` disables the limit. */
  maxFileSize?: number;
  /** Initial zoom. Default `'auto'`. */
  initialZoom?: ZoomValue;
  onFileLoad?(meta: FileLoadMeta): void;
  onError?(error: PdfEditorError): void;
  /**
   * Supply the password for encrypted PDFs yourself. Return `null` to cancel.
   * When omitted, the built-in password dialog is used.
   */
  onPasswordRequest?(info: { reason: PasswordReason; fileName: string }): Promise<string | null> | string | null;
  /**
   * Called on save, download or export when an edited page contains content the
   * editor could not read (e.g. a damaged or unusually compressed stream).
   * Return `'keep'` to save that content unchanged, `'remove'` to leave it out,
   * or `null` to cancel the save. When omitted, the built-in dialog asks the user.
   */
  onUnresolvedContent?(
    info: UnresolvedContentInfo,
  ): Promise<UnresolvedContentChoice | null> | UnresolvedContentChoice | null;
  /**
   * Fonts users can pick for edited text, and stand-ins for the document's own
   * fonts (see `EditorFont.replaces` and `standInFonts`). Files load on first use.
   */
  fonts?: readonly EditorFont[];
}

export type EditorStatus = 'empty' | 'loading' | 'ready';
export type EditorMode = 'view' | 'edit';

/** The text frame currently open in the inline editor. */
export interface ActiveEdit {
  pageIndex: number;
  /** Draft frame; block-level properties (font, size, align...) live here. */
  frame: TextFrame;
  /** Id of an already-committed frame being re-edited. */
  existingFrameId?: string;
  /** Original runs this edit will remove when committed. */
  sourceRunIds: string[];
  /** Plain text at the start, to detect "no change". */
  initialSignature: string;
  /** The user has typed or changed formatting since opening it. */
  changed?: boolean;
}

/** Imperative handle registered by the live inline editor. */
export interface InlineEditorApi {
  exec(command: 'bold' | 'italic' | 'underline' | 'foreColor', value?: string): void;
  /** Set the font of the selected text, or of the whole box when nothing is selected. */
  setFont(font: FontChoice): void;
  /** Read paragraphs from the DOM. */
  read(): TextFrame['paragraphs'];
  focus(): void;
}

interface State {
  status: EditorStatus;
  loadingName: string | null;
  document: PDFDocumentProxy | null;
  documentKey: number;
  fileName: string | null;
  fileSize: number;
  bytes: Uint8Array | null;
  pageSizes: PageSize[];
  currentPage: number;
  zoom: ZoomValue;
  scale: number;
  error: PdfEditorError | null;
  notice: string | null;
  passwordRequest: PasswordRequest | null;
  unresolvedRequest: UnresolvedContentRequest | null;
  scrollRequest: { page: number; nonce: number } | null;
  mode: EditorMode;
  edits: DocumentEdits;
  /** The edits as of the last save/download; `edits !== savedEdits` means unsaved changes. */
  savedEdits: DocumentEdits;
  past: DocumentEdits[];
  future: DocumentEdits[];
  activeEdit: ActiveEdit | null;
  saving: boolean;
}

type Action =
  | { type: 'loading'; name: string | null }
  | {
      type: 'loaded';
      document: PDFDocumentProxy;
      name: string;
      size: number;
      bytes: Uint8Array;
      pageSizes: PageSize[];
    }
  | { type: 'failed'; error: PdfEditorError }
  | { type: 'clearError' }
  | { type: 'notice'; notice: string | null }
  | { type: 'close' }
  | { type: 'password'; request: PasswordRequest | null }
  | { type: 'unresolved'; request: UnresolvedContentRequest | null }
  | { type: 'zoom'; zoom: ZoomValue }
  | { type: 'scale'; scale: number }
  | { type: 'currentPage'; page: number }
  | { type: 'goToPage'; page: number }
  | { type: 'mode'; mode: EditorMode }
  | { type: 'edit'; update: (edits: DocumentEdits) => DocumentEdits }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'active'; active: ActiveEdit | null }
  | { type: 'activeFrame'; patch: Partial<TextFrame> }
  | { type: 'saving'; saving: boolean }
  | { type: 'markSaved' }
  | { type: 'activeChanged' };

const HISTORY_LIMIT = 100;
const EMPTY_EDITS: DocumentEdits = {};

function initialState(zoom: ZoomValue): State {
  return {
    status: 'empty',
    loadingName: null,
    document: null,
    documentKey: 0,
    fileName: null,
    fileSize: 0,
    bytes: null,
    pageSizes: [],
    currentPage: 0,
    zoom,
    scale: 1,
    error: null,
    notice: null,
    passwordRequest: null,
    unresolvedRequest: null,
    scrollRequest: null,
    mode: 'view',
    edits: EMPTY_EDITS,
    savedEdits: EMPTY_EDITS,
    past: [],
    future: [],
    activeEdit: null,
    saving: false,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loading':
      return { ...state, status: 'loading', loadingName: action.name, error: null };
    case 'loaded':
      return {
        ...state,
        status: 'ready',
        loadingName: null,
        document: action.document,
        documentKey: state.documentKey + 1,
        fileName: action.name,
        fileSize: action.size,
        bytes: action.bytes,
        pageSizes: action.pageSizes,
        currentPage: 0,
        error: null,
        notice: null,
        passwordRequest: null,
        unresolvedRequest: null,
        scrollRequest: null,
        edits: EMPTY_EDITS,
        savedEdits: EMPTY_EDITS,
        past: [],
        future: [],
        activeEdit: null,
      };
    case 'failed':
      // Keep any previously open document visible; just surface the error.
      return {
        ...state,
        status: state.document ? 'ready' : 'empty',
        loadingName: null,
        passwordRequest: null,
        error: action.error,
      };
    case 'clearError':
      return { ...state, error: null, notice: null };
    case 'notice':
      return { ...state, notice: action.notice };
    case 'close':
      return { ...initialState(state.zoom), documentKey: state.documentKey + 1 };
    case 'password':
      return { ...state, passwordRequest: action.request };
    case 'unresolved':
      return { ...state, unresolvedRequest: action.request };
    case 'zoom':
      return { ...state, zoom: action.zoom };
    case 'scale':
      return state.scale === action.scale ? state : { ...state, scale: action.scale };
    case 'currentPage':
      return state.currentPage === action.page ? state : { ...state, currentPage: action.page };
    case 'goToPage': {
      const page = Math.max(0, Math.min(state.pageSizes.length - 1, action.page));
      return {
        ...state,
        currentPage: page,
        scrollRequest: { page, nonce: (state.scrollRequest?.nonce ?? 0) + 1 },
      };
    }
    case 'mode':
      return { ...state, mode: action.mode, activeEdit: action.mode === 'view' ? null : state.activeEdit };
    case 'edit': {
      const next = action.update(state.edits);
      if (next === state.edits) return state;
      return { ...state, edits: next, past: [...state.past, state.edits].slice(-HISTORY_LIMIT), future: [] };
    }
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state,
        edits: prev,
        past: state.past.slice(0, -1),
        future: [state.edits, ...state.future],
        activeEdit: null,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        edits: next,
        past: [...state.past, state.edits],
        future: state.future.slice(1),
        activeEdit: null,
      };
    }
    case 'active':
      return { ...state, activeEdit: action.active };
    case 'activeFrame':
      return state.activeEdit
        ? {
            ...state,
            activeEdit: { ...state.activeEdit, changed: true, frame: { ...state.activeEdit.frame, ...action.patch } },
          }
        : state;
    case 'saving':
      return { ...state, saving: action.saving };
    case 'activeChanged':
      return state.activeEdit && !state.activeEdit.changed
        ? { ...state, activeEdit: { ...state.activeEdit, changed: true } }
        : state;
    case 'markSaved':
      // Actions apply in order, so this includes a frame committed by the export.
      return { ...state, savedEdits: state.edits };
  }
}

function toEditorError(e: unknown): PdfEditorError {
  if (isPdfEditorError(e)) return e;
  const name = (e as { name?: string } | null)?.name;
  const message = (e as { message?: string } | null)?.message ?? String(e);
  if (name === 'PasswordException') {
    return new PdfEditorError('PASSWORD_REQUIRED', 'This PDF is password protected.', e);
  }
  if (name === 'InvalidPDFException' || name === 'FormatError') {
    return new PdfEditorError('CORRUPT', 'This PDF is damaged and could not be opened.', e);
  }
  return new PdfEditorError('LOAD_FAILED', `Could not open the PDF: ${message}`, e);
}

async function readPageSizes(doc: PDFDocumentProxy): Promise<PageSize[]> {
  const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
  return pages.map((p) => {
    const vp = p.getViewport({ scale: 1 });
    return { width: vp.width, height: vp.height, view: p.view as [number, number, number, number], rotation: p.rotate };
  });
}

/** Stable text+style signature used to tell whether an edit changed anything. */
export function frameSignature(
  f: Pick<TextFrame, 'paragraphs' | 'family' | 'font' | 'size' | 'align' | 'color' | 'x' | 'baseline' | 'width'>,
) {
  return JSON.stringify([f.paragraphs, f.family, f.font ?? null, f.size, f.align, f.color, f.x, f.baseline, f.width]);
}

function pageEdits(edits: DocumentEdits, page: number): PageEdits {
  return edits[page] ?? { removedRuns: [], frames: [] };
}

/** Apply an inline edit to the document edits (pure; returns `edits` if nothing changed). */
export function commitEdit(
  edits: DocumentEdits,
  active: ActiveEdit,
  paragraphs: TextFrame['paragraphs'],
): DocumentEdits {
  const frame: TextFrame = { ...active.frame, paragraphs };
  // Opened and closed without changes: nothing to record.
  if (frameSignature(frame) === active.initialSignature) return edits;
  const empty = paragraphs.every((p) => p.spans.every((sp) => !sp.text.trim()));
  const page = pageEdits(edits, active.pageIndex);
  const removed = new Set(page.removedRuns);
  active.sourceRunIds.forEach((id) => removed.add(id));
  const targetId = active.existingFrameId ?? frame.id;
  const at = page.frames.findIndex((f) => f.id === targetId);
  const frames = page.frames.filter((f) => f.id !== targetId);
  if (!empty) frames.splice(at >= 0 ? at : frames.length, 0, frame);
  if (!removed.size && !frames.length) {
    const { [active.pageIndex]: _drop, ...rest } = edits;
    return rest;
  }
  return { ...edits, [active.pageIndex]: { removedRuns: [...removed], frames } };
}

export interface SaveInfo {
  /** Suggested file name, e.g. `report-edited.pdf`. */
  fileName: string;
  /** Whether the document contains edits. */
  edited: boolean;
}

export interface PdfEditorController {
  status: EditorStatus;
  loadingName: string | null;
  document: PDFDocumentProxy | null;
  documentKey: number;
  fileName: string | null;
  fileSize: number;
  /** The original file bytes. Use `exportPdf()` for the edited document. */
  bytes: Uint8Array | null;
  pageCount: number;
  pageSizes: PageSize[];
  /** Zero-based index of the page most visible in the viewer. */
  currentPage: number;
  zoom: ZoomValue;
  /** Resolved zoom factor (1 = 100%). */
  scale: number;
  error: PdfEditorError | null;
  /** Non-error information for the user (e.g. export warnings). */
  notice: string | null;
  passwordRequest: PasswordRequest | null;
  /** Set while the built-in dialog asks what to do with unreadable page content. */
  unresolvedRequest: UnresolvedContentRequest | null;
  scrollRequest: { page: number; nonce: number } | null;

  // ---- editing ----
  mode: EditorMode;
  edits: DocumentEdits;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  activeEdit: ActiveEdit | null;
  saving: boolean;
  session: EditSession | null;
  /** Live inline editor handle (set by the text layer). */
  inlineEditorRef: MutableRefObject<InlineEditorApi | null>;

  /** Open a PDF from a File (e.g. from the user's computer), Blob, bytes or URL. */
  load(input: PdfInput): Promise<boolean>;
  close(): void;
  clearError(): void;
  /** Show an informational message in the editor (pass null to clear). */
  showNotice(message: string | null): void;
  /** Show an error banner and call `onError` (e.g. a custom tool failed). */
  reportError(error: unknown, context?: string): void;
  setZoom(zoom: ZoomValue): void;
  zoomIn(): void;
  zoomOut(): void;
  goToPage(index: number): void;

  setMode(mode: EditorMode): void;
  /** Open a frame in the inline editor. */
  beginEdit(edit: Omit<ActiveEdit, 'initialSignature'>): void;
  /** Change block-level properties of the frame being edited. */
  updateActiveFrame(patch: Partial<TextFrame>): void;
  /** Commit (or with `discard`, cancel) the inline editor. */
  endEdit(options?: { discard?: boolean }): void;
  /** Report that the open text was changed (drives `isDirty` while typing). */
  markActiveChanged(): void;
  /** Delete the frame being edited (and the original text it replaces). */
  deleteActive(): void;
  undo(): void;
  redo(): void;
  /**
   * The PDF with all edits applied. Rejects with a `CANCELLED` error if the
   * user cancels the unreadable-content prompt.
   */
  exportPdf(options?: ExportOptions): Promise<Uint8Array>;
  /** Save the current document (with edits) to the user's computer. */
  download(fileName?: string): Promise<void>;
  /**
   * Export and hand the bytes to `handler` (e.g. upload them). Shows the saving
   * state while it runs and clears "unsaved changes" when it succeeds.
   */
  save(handler: (bytes: Uint8Array, info: SaveInfo) => void | Promise<void>): Promise<boolean>;
  /** Mark the current edits as saved (clears `isDirty`). */
  markSaved(): void;

  /** @internal used by the viewer to report layout results. */
  _reportScale(scale: number): void;
  /** @internal */
  _reportCurrentPage(page: number): void;
}

export function usePdfEditor(options: UsePdfEditorOptions = {}): PdfEditorController {
  const [state, dispatch] = useReducer(reducer, options.initialZoom ?? 'auto', initialState);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // Unchanged fonts are ignored, so an inline array doesn't cause extra work.
  useLayoutEffect(() => {
    if (options.fonts) fontLibrary.register(options.fonts);
  }, [options.fonts]);
  const loadIdRef = useRef(0);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const scaleRef = useRef(state.scale);
  scaleRef.current = state.scale;
  const stateRef = useRef(state);
  stateRef.current = state;
  const inlineEditorRef = useRef<InlineEditorApi | null>(null);

  // One editing session per loaded document.
  const session = useMemo(
    () => (state.bytes ? new EditSession(state.bytes, optionsRef.current) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.bytes],
  );
  useEffect(() => () => session?.destroy(), [session]);

  useEffect(
    () => () => {
      loadIdRef.current++;
      docRef.current?.destroy();
      docRef.current = null;
    },
    [],
  );

  const load = useCallback(async (input: PdfInput): Promise<boolean> => {
    const id = ++loadIdRef.current;
    const opts = optionsRef.current;
    const isCurrent = () => id === loadIdRef.current;
    const guessName = typeof File !== 'undefined' && input instanceof File ? input.name : null;
    dispatch({ type: 'loading', name: guessName });

    let passwordCancelled = false;
    try {
      const [pdfjs, file] = await Promise.all([
        getPdfjs(opts),
        normalizePdfInput(input, { maxFileSize: opts.maxFileSize ?? DEFAULT_MAX_FILE_SIZE }),
      ]);
      if (!isCurrent()) return false;

      // pdf.js transfers (detaches) the buffer it is given, so hand it a copy
      // and keep the original for editing/exporting.
      const task = pdfjs.getDocument({
        data: file.bytes.slice(),
        ...assetUrls(pdfjs, opts.assetsBaseUrl),
      });

      task.onPassword = (update: (pw: string) => void, reason: number) => {
        if (!isCurrent()) {
          void task.destroy();
          return;
        }
        const why: PasswordReason = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'need';
        const cancel = () => {
          passwordCancelled = true;
          dispatch({ type: 'password', request: null });
          void task.destroy();
        };
        const custom = optionsRef.current.onPasswordRequest;
        if (custom) {
          Promise.resolve(custom({ reason: why, fileName: file.name })).then(
            (pw) => (pw == null ? cancel() : update(pw)),
            cancel,
          );
        } else {
          dispatch({
            type: 'password',
            request: {
              reason: why,
              fileName: file.name,
              submit: (pw) => {
                dispatch({ type: 'password', request: null });
                update(pw);
              },
              cancel,
            },
          });
        }
      };

      const doc = await task.promise;
      const pageSizes = await readPageSizes(doc);
      if (!isCurrent()) {
        void doc.destroy();
        return false;
      }
      const previous = docRef.current;
      docRef.current = doc;
      dispatch({ type: 'loaded', document: doc, name: file.name, size: file.size, bytes: file.bytes, pageSizes });
      // Destroy after React has switched views over to the new document.
      if (previous) setTimeout(() => void previous.destroy(), 0);
      optionsRef.current.onFileLoad?.({ name: file.name, size: file.size, pageCount: doc.numPages });
      return true;
    } catch (e) {
      if (!isCurrent()) return false;
      const error = passwordCancelled
        ? new PdfEditorError('PASSWORD_REQUIRED', 'A password is needed to open this PDF.', e)
        : toEditorError(e);
      dispatch({ type: 'failed', error });
      optionsRef.current.onError?.(error);
      return false;
    }
  }, []);

  const close = useCallback(() => {
    loadIdRef.current++;
    const doc = docRef.current;
    docRef.current = null;
    dispatch({ type: 'close' });
    if (doc) setTimeout(() => void doc.destroy(), 0);
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'clearError' }), []);
  const showNotice = useCallback((notice: string | null) => dispatch({ type: 'notice', notice }), []);
  const reportError = useCallback((e: unknown, context?: string) => {
    if (isPdfEditorError(e) && e.code === 'CANCELLED') return; // the user chose to stop
    const msg = (e as Error)?.message ?? String(e);
    const error = isPdfEditorError(e) ? e : new PdfEditorError('LOAD_FAILED', context ? `${context}: ${msg}` : msg, e);
    dispatch({ type: 'failed', error });
    optionsRef.current.onError?.(error);
  }, []);
  const setZoom = useCallback((zoom: ZoomValue) => dispatch({ type: 'zoom', zoom }), []);
  const zoomIn = useCallback(() => dispatch({ type: 'zoom', zoom: nextZoomStep(scaleRef.current, 1) }), []);
  const zoomOut = useCallback(() => dispatch({ type: 'zoom', zoom: nextZoomStep(scaleRef.current, -1) }), []);
  const goToPage = useCallback((page: number) => dispatch({ type: 'goToPage', page }), []);
  const _reportScale = useCallback((scale: number) => dispatch({ type: 'scale', scale }), []);
  const _reportCurrentPage = useCallback((page: number) => dispatch({ type: 'currentPage', page }), []);

  // ---- editing ---------------------------------------------------------------

  const endEdit = useCallback((opts: { discard?: boolean } = {}) => {
    const active = stateRef.current.activeEdit;
    if (!active) return;
    const paragraphs = inlineEditorRef.current?.read() ?? active.frame.paragraphs;
    dispatch({ type: 'active', active: null });
    if (opts.discard) return;
    dispatch({ type: 'edit', update: (edits) => commitEdit(edits, active, paragraphs) });
  }, []);

  const beginEdit = useCallback(
    (edit: Omit<ActiveEdit, 'initialSignature'>) => {
      if (stateRef.current.activeEdit) endEdit();
      dispatch({ type: 'active', active: { ...edit, initialSignature: frameSignature(edit.frame) } });
    },
    [endEdit],
  );

  const deleteActive = useCallback(() => {
    const active = stateRef.current.activeEdit;
    if (!active) return;
    dispatch({ type: 'active', active: null });
    if (!active.sourceRunIds.length && !active.existingFrameId) return; // brand-new, never committed
    dispatch({
      type: 'edit',
      update: (edits) => {
        const page = pageEdits(edits, active.pageIndex);
        const removed = new Set([...page.removedRuns, ...active.sourceRunIds]);
        return {
          ...edits,
          [active.pageIndex]: {
            removedRuns: [...removed],
            frames: page.frames.filter((f) => f.id !== active.existingFrameId),
          },
        };
      },
    });
  }, []);

  const updateActiveFrame = useCallback((patch: Partial<TextFrame>) => dispatch({ type: 'activeFrame', patch }), []);
  const setMode = useCallback(
    (mode: EditorMode) => {
      if (mode === 'view') endEdit();
      dispatch({ type: 'mode', mode });
    },
    [endEdit],
  );
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  /** Ask (via `onUnresolvedContent` or the built-in dialog) what to do with unreadable content. */
  const askUnresolved = useCallback((info: UnresolvedContentInfo) => {
    const custom = optionsRef.current.onUnresolvedContent;
    if (custom) return Promise.resolve(custom(info));
    return new Promise<UnresolvedContentChoice | null>((resolve) => {
      const done = (choice: UnresolvedContentChoice | null) => {
        dispatch({ type: 'unresolved', request: null });
        resolve(choice);
      };
      dispatch({
        type: 'unresolved',
        request: { ...info, choose: (c) => done(c), cancel: () => done(null) },
      });
    });
  }, []);

  const exportPdf = useCallback(async (options: ExportOptions = {}): Promise<Uint8Array> => {
    const s = stateRef.current;
    if (!s.bytes) throw new PdfEditorError('LOAD_FAILED', 'No document is open.');
    // Include the frame that is still open in the editor.
    let edits = s.edits;
    if (s.activeEdit) {
      const paragraphs = inlineEditorRef.current?.read() ?? s.activeEdit.frame.paragraphs;
      edits = commitEdit(edits, s.activeEdit, paragraphs);
      endEdit();
    }
    if (!hasEdits(edits) || !session) return s.bytes;

    // Rewriting an edited page must not silently drop content we couldn't read.
    let unresolved = options.unresolvedContent;
    if (!unresolved) {
      const found = await session.unresolvedContent(edits);
      if (found.length) {
        const choice = await askUnresolved({
          fileName: s.fileName ?? 'document.pdf',
          pages: found.map((f) => f.page + 1),
          streams: found.reduce((n, f) => n + f.streams, 0),
        });
        if (!choice) throw new PdfEditorError('CANCELLED', 'Saving was cancelled.');
        unresolved = choice;
      }
    }

    const { bytes, substituted } = await session.export(edits, { unresolved });
    if (substituted.length) {
      dispatch({
        type: 'notice',
        notice: `Some characters aren't available in the replacement fonts and were substituted: ${substituted.join(' ')}`,
      });
    }
    return bytes;
  }, [endEdit, session, askUnresolved]);

  /** Export, run `handler`, then mark exactly the exported edits as saved. */
  const runSave = useCallback(
    async (handler: (bytes: Uint8Array, info: SaveInfo) => void | Promise<void>, failMessage: string) => {
      const s = stateRef.current;
      if (!s.bytes || s.saving) return false;
      dispatch({ type: 'saving', saving: true });
      try {
        let edits = s.edits;
        if (s.activeEdit)
          edits = commitEdit(edits, s.activeEdit, inlineEditorRef.current?.read() ?? s.activeEdit.frame.paragraphs);
        const base = s.fileName ?? 'document.pdf';
        const info: SaveInfo = {
          fileName: hasEdits(edits) ? base.replace(/(\.pdf)?$/i, '-edited.pdf') : base,
          edited: hasEdits(edits),
        };
        const bytes = await exportPdf();
        await handler(bytes, info);
        dispatch({ type: 'markSaved' });
        return true;
      } catch (e) {
        if (isPdfEditorError(e) && e.code === 'CANCELLED') return false;
        const error = new PdfEditorError('LOAD_FAILED', `${failMessage}: ${(e as Error)?.message ?? e}`, e);
        dispatch({ type: 'failed', error });
        optionsRef.current.onError?.(error);
        return false;
      } finally {
        dispatch({ type: 'saving', saving: false });
      }
    },
    [exportPdf],
  );

  const download = useCallback(
    async (name?: string) => {
      await runSave((bytes, info) => {
        const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name ?? info.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }, 'Could not save the PDF');
    },
    [runSave],
  );

  const save = useCallback(
    (handler: (bytes: Uint8Array, info: SaveInfo) => void | Promise<void>) => runSave(handler, 'Saving failed'),
    [runSave],
  );

  const markSaved = useCallback(() => dispatch({ type: 'markSaved' }), []);
  const markActiveChanged = useCallback(() => dispatch({ type: 'activeChanged' }), []);

  return useMemo(
    () => ({
      ...state,
      pageCount: state.pageSizes.length,
      isDirty:
        !!state.activeEdit?.changed ||
        (state.edits !== state.savedEdits && (hasEdits(state.edits) || hasEdits(state.savedEdits))),
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      session,
      inlineEditorRef,
      load,
      close,
      clearError,
      showNotice,
      reportError,
      setZoom,
      zoomIn,
      zoomOut,
      goToPage,
      setMode,
      beginEdit,
      updateActiveFrame,
      endEdit,
      deleteActive,
      undo,
      redo,
      exportPdf,
      download,
      save,
      markSaved,
      markActiveChanged,
      _reportScale,
      _reportCurrentPage,
    }),
    [
      state,
      session,
      load,
      close,
      clearError,
      showNotice,
      reportError,
      setZoom,
      zoomIn,
      zoomOut,
      goToPage,
      setMode,
      beginEdit,
      updateActiveFrame,
      endEdit,
      deleteActive,
      undo,
      redo,
      exportPdf,
      download,
      save,
      markSaved,
      markActiveChanged,
      _reportScale,
      _reportCurrentPage,
    ],
  );
}
