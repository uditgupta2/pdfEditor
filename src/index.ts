import './styles.css';

// Components
export { PdfEditor, COMPACT_BREAKPOINT, type PdfEditorProps } from './components/PdfEditor';
export { PdfViewer, type PdfViewerProps } from './components/PdfViewer';
export { PdfPage, type PdfPageProps } from './components/PdfPage';
export { Toolbar, type ToolbarProps } from './components/Toolbar';
export {
  TOOLBAR_OPTIONS,
  MAIN_TOOLBAR_OPTIONS,
  FORMAT_TOOL_OPTIONS,
  type ToolbarOption,
  type MainToolbarOption,
  type FormatToolOption,
  type CustomTool,
} from './components/toolbarConfig';
export { PdfLoader, type PdfLoaderProps } from './components/PdfLoader';
export { ThumbnailSidebar, type ThumbnailSidebarProps } from './components/ThumbnailSidebar';
export { PdfDropzone, type PdfDropzoneProps } from './components/PdfDropzone';
export { PasswordDialog } from './components/PasswordDialog';
export { UnresolvedContentDialog } from './components/UnresolvedContentDialog';
export { EditorProvider, useEditor } from './components/context';
export { FormatBar } from './components/FormatBar';
export { TextEditLayer, type TextEditLayerProps } from './components/TextEditLayer';

// Hooks
export {
  usePdfEditor,
  type PdfEditorController,
  type UsePdfEditorOptions,
  type FileLoadMeta,
  type PasswordRequest,
  type PasswordReason,
  type EditorStatus,
  type EditorMode,
  type ActiveEdit,
  type SaveInfo,
  type ExportOptions,
  type UnresolvedContentChoice,
  type UnresolvedContentInfo,
  type UnresolvedContentRequest,
} from './hooks/usePdfEditor';
export type {
  TextFrame,
  DocumentEdits,
  PageEdits,
  Paragraph,
  Span,
  SpanStyle,
  Align,
  FamilyClass,
  RGB,
} from './edit/model';
export { useFilePicker, pickFiles, PDF_ACCEPT, type PickFilesOptions, type UseFilePickerOptions } from './hooks/useFilePicker';
export { useDropTarget, type UseDropTargetOptions } from './hooks/useDropTarget';

// Core
export { PdfEditorError, isPdfEditorError, type PdfEditorErrorCode } from './core/errors';
export {
  normalizePdfInput,
  hasPdfHeader,
  formatBytes,
  DEFAULT_MAX_FILE_SIZE,
  type PdfInput,
  type NormalizedPdf,
} from './core/load';
export { type ZoomValue, type ZoomMode, type PageSize } from './core/zoom';
export { type PdfjsOptions } from './render/pdfjs';
