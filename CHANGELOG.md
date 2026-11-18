# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). While the version is `0.x`, minor
releases may contain breaking changes.

## [Unreleased]

### Added

- Edited text is written in the document's own font, by its existing
  resource, instead of Helvetica/Times/Courier. Characters a subset font lacks
  fall back one by one: a bold/italic sibling, a stand-in, then the closest
  standard font. For embedded TrueType fonts the glyphs are read from the
  font program itself, so a subset offers every character the document uses,
  not only the current page's.
- `fonts` prop (`EditorFont[]`) for app-provided fonts, and `standInFonts()`
  for the metric-compatible stand-ins (Carlito, Caladea, Arimo, Tinos,
  Cousine). App fonts are embedded as subsets on export. Their embedding
  flags (`OS/2.fsType`) are respected: fonts that forbid embedding are not
  used, and fonts that forbid subsetting are embedded whole.
- Font picker (`'fontFamily'` in `toolbarOptions`), shown by default.
- Edited pages are re-rendered with their new text drawn in, so the screen
  shows the real fonts after each edit.

### Fixed

- Picking an app font while editing now shows the text in that font right
  away; before, the font file only loaded once the edit was committed.
- Stand-in fonts are downloaded only when a character actually needs one;
  before, any paragraph in a font with a stand-in downloaded it.
- A font finishing loading redraws only the pages whose text uses it; before,
  every edited page was rebuilt and re-rendered each time any font loaded.
- Only text in the document's own fonts is drawn into the re-rendered page;
  text in app or standard fonts shows as HTML, so editing it no longer rebuilds
  the page or re-embeds its font on every change.
- Fonts shared by several pages are parsed once per document instead of once
  per page.
- A page preview that fails to build no longer leaks the previous one, and is
  retried on the next render.
- Re-registering an app font with new files removes the old face from
  `document.fonts`.

### Changed

- Spans and frames carry their font (`Span.font`, `TextFrame.font`,
  `TextFrame.fonts`). Saved `DocumentEdits` from 0.1.0 still work: without a
  font they use the standard font as before.
- `@pdf-lib/fontkit` is a new dependency, loaded only when an app font is used.

## [0.1.0] - 2026-11-14

First public release.

### Added

- `<PdfEditor>` component: a responsive, client-side PDF viewer and editor.
- Opening files by file picker, drag and drop, Ctrl/⌘+O, or the `file` prop
  (`File`, `Blob`, `ArrayBuffer`, `Uint8Array` or URL).
- In-place paragraph text editing with size, bold, italic, underline, colour
  and alignment. Original text is removed from the content stream on export,
  and new text is written as real, searchable PDF text. Edited text uses
  whichever of Helvetica, Times or Courier is closest to the original font.
  There is no font picker yet; it will come once more fonts are supported.
- Undo/redo, a Save button (`onSave`), Download, and `exportPdf()`.
- Configurable toolbar (`toolbarOptions`) and custom toolbar buttons
  (`customTools`), with overflow into a **More** menu on narrow layouts.
- Props for controlling the editor from your app: `enableEditMode`, `onOpen`,
  `maxFileSize`, `loadingState` and `loadingComponent`, plus an exported
  `PdfLoader`.
- Container-query responsive layout, thumbnail sidebar, pinch and
  Ctrl/⌘+wheel zoom, light/dark/system themes.
- Password-protected PDF support (built-in dialog or `onPasswordRequest`).
- Restricted PDFs (owner permissions forbid changes) stay view-only. Clicking
  **Edit** shows a warning that lists what the owner has restricted, and
  `exportPdf()` rejects with the same warning, so a custom UI can't get around
  the check. Other encrypted files are view-only for now.
- Content the editor can't read is never dropped silently. When you save,
  download or export, and an edited page contains such content (for example a
  damaged stream), a dialog asks whether to **Keep** it unchanged, **Remove**
  it, or **Cancel** the save. Use `onUnresolvedContent`,
  `exportPdf({ unresolvedContent })` or the exported `UnresolvedContentDialog`
  to handle this in your own UI.
- Error codes on `PdfEditorError`, including `CANCELLED` when the user cancels
  a save from a prompt.
- Headless building blocks: `usePdfEditor`, `EditorProvider`, `PdfViewer`,
  `PdfDropzone`, `useFilePicker`, `useDropTarget`.

[Unreleased]: https://github.com/uditgupta2/pdfEditor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/uditgupta2/pdfEditor/releases/tag/v0.1.0
