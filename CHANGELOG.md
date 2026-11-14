# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). While the version is `0.x`, minor
releases may contain breaking changes.

## [Unreleased]

### Fixed

- Encrypted PDFs that open without a password no longer get a notice calling
  them password-protected. Clicking **Edit** on a restricted file now shows a
  warning that lists what its owner has restricted. Other encrypted files get a
  notice that editing them isn't supported yet.
- `exportPdf()` rejects with the same warning if edits are applied to a
  restricted file, so a custom UI can't get around the check.

### Documentation

- Added a **Restricted PDFs** section to the README. It covers what the warning
  says, what the editor does and doesn't enforce, and how to run the check in a
  custom UI.

## [0.0.1] - 2026-11-08

### Added

- `<PdfEditor>` component: a responsive, client-side PDF viewer and editor.
- Opening files by file picker, drag and drop, Ctrl/⌘+O, or the `file` prop
  (`File`, `Blob`, `ArrayBuffer`, `Uint8Array` or URL).
- In-place paragraph text editing with font, size, bold, italic, underline,
  colour and alignment. Original text is removed from the content stream on
  export, and new text is written as real, searchable PDF text.
- Undo/redo, a Save button (`onSave`), Download, and `exportPdf()`.
- Configurable toolbar (`toolbarOptions`) and custom toolbar buttons
  (`customTools`), with overflow into a **More** menu on narrow layouts.
- Props for controlling the editor from your app: `enableEditMode`, `onOpen`,
  `maxFileSize`, `loadingState` and `loadingComponent`, plus an exported
  `PdfLoader`.
- Container-query responsive layout, thumbnail sidebar, pinch and
  Ctrl/⌘+wheel zoom, light/dark/system themes.
- Password-protected PDF support (built-in dialog or `onPasswordRequest`).
- Headless building blocks: `usePdfEditor`, `EditorProvider`, `PdfViewer`,
  `PdfDropzone`, `useFilePicker`, `useDropTarget`.
