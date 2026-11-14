# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). While the version is `0.x`, minor
releases may contain breaking changes.

## [Unreleased]

### Added

- When you save, download or export, and an edited page contains content the
  editor can't read (for example a damaged or unusually compressed stream), a
  dialog asks whether to **Keep** it unchanged, **Remove** it, or **Cancel** the
  save. Previously that content was silently dropped from the saved page.
- `onUnresolvedContent` option and prop to make that decision in code or with
  your own UI, `exportPdf({ unresolvedContent: 'keep' | 'remove' })` to skip
  the prompt, and an exported `UnresolvedContentDialog` for custom UIs.
- `CANCELLED` error code. `exportPdf()` rejects with it when the user cancels
  the prompt. The built-in Save and Download buttons and custom tools ignore it.
- `repository`, `homepage` and `bugs` links in `package.json`.

### Removed

- The font picker (`'fontSelection'` toolbar option). Only Helvetica, Times and
  Courier are available today, so edited text now keeps whichever is closest to
  the original font. The picker will return when more fonts are supported. If
  you list `'fontSelection'` in `toolbarOptions`, it is ignored, but TypeScript
  will flag it.

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
