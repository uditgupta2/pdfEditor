# react-pdf-editor-kit

A responsive PDF viewer and **in-place text editor** component for React. It runs
entirely in the browser: files opened from the user's computer are never
uploaded anywhere.

> **Status: 0.0.x (early).** Viewing, opening files, and in-place text editing
> work. Images, shapes, signatures and page operations come next. The API may
> change between minor versions until 1.0.

## Features

- **Drop-in editor.** `<PdfEditor />` gives you a toolbar, a thumbnail sidebar,
  zoom, page navigation, download and save.
- **Real text editing.** Click a paragraph and type. The original text is
  removed from the PDF content stream, and the new text is written as real,
  searchable PDF text, not a white box with text on top.
- **Opens files several ways.** File picker, drag and drop, Ctrl/⌘+O, or a
  `file` prop (`File`, `Blob`, `ArrayBuffer`, `Uint8Array` or URL).
- **Responsive.** The layout follows the editor's own width, not the
  window's, so it works in a narrow panel. Supports touch pinch-zoom.
- **Customisable.** Pick which toolbar buttons show, add your own buttons,
  theme it with CSS variables, or build your own UI from the hooks.
- **Typed.** Written in TypeScript and ships ESM, CommonJS and type
  declarations. Works in Next.js App Router (`"use client"` included).

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Opening files](#opening-files)
- [Props](#props)
- [Toolbar](#toolbar)
- [Editing text](#editing-text)
- [Responsive behaviour](#responsive-behaviour)
- [Build your own UI](#build-your-own-ui)
- [Theming](#theming)
- [Frameworks: Vite, Next.js, webpack](#frameworks-vite-nextjs-webpack)
- [Browser support](#browser-support)
- [Development](#development)
- [License](#license)

## Requirements

| Package | Version |
|---|---|
| `react`, `react-dom` | 18 or 19 |
| `pdfjs-dist` | 5.x (peer dependency, so you control the version) |

## Install

```bash
npm install react-pdf-editor-kit pdfjs-dist
# or
pnpm add react-pdf-editor-kit pdfjs-dist
# or
yarn add react-pdf-editor-kit pdfjs-dist
```

## Quick start

```tsx
import { PdfEditor } from 'react-pdf-editor-kit';
import 'react-pdf-editor-kit/styles.css';
// Recommended: serve the pdf.js worker yourself (Vite shown here).
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export function App() {
  return (
    <div style={{ height: '100vh' }}>
      <PdfEditor workerSrc={workerSrc} onFileLoad={(m) => console.log(m)} />
    </div>
  );
}
```

Two things to remember:

1. **Import the stylesheet** (`react-pdf-editor-kit/styles.css`) once in your app.
2. **Give the parent element a height.** The editor fills its parent.

If you leave out `workerSrc`, the pdf.js worker is loaded from unpkg, matched to
your installed `pdfjs-dist` version. That's handy for prototypes, but serving it
yourself is better in production. See
[Frameworks](#frameworks-vite-nextjs-webpack).

## Opening files

With no `file` prop, the editor opens on an upload screen. Users can open a PDF
from their device in three ways:

- the **Choose PDF** button or the toolbar's **Open** button, which open the system file picker
- **drag and drop** onto the editor
- **Ctrl/⌘ + O** while the editor has focus

To open a file yourself, pass `file`. It accepts a `File`, `Blob`,
`ArrayBuffer`, `Uint8Array`, or a URL (string or `URL`).

```tsx
<PdfEditor file="/docs/contract.pdf" allowUpload={false} />
```

## Props

```tsx
<PdfEditor
  file={file}
  enableEditMode
  toolbarOptions={['pageNav', 'zoom', 'edit', 'save']}
  onOpen={(file) => console.log('user picked', file.name)}
  onSave={async (bytes, { fileName }) => {
    await fetch('/api/documents', { method: 'PUT', body: bytes });
  }}
  loadingState={isFetching}
  loadingComponent={<MySpinner />}
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `file` | `File \| Blob \| ArrayBuffer \| Uint8Array \| string \| URL` | none | PDF to open |
| `allowUpload` | `boolean` | `true` | Open button, drop zone, drag & drop, Ctrl+O |
| `enableEditMode` | `boolean` | `true` | Edit button and in-place text editing. Turning it off mid-edit commits and leaves edit mode |
| `onSave` | `(bytes, { fileName, edited }) => void \| Promise<void>` | none | Adds a **Save** button and makes Ctrl/⌘+S call it with the edited PDF. Return a promise (e.g. an upload) to show "Saving…" until it settles; throw to show an error. Success clears the unsaved-changes dot. Without it, Ctrl/⌘+S downloads |
| `onOpen` | `(file: File) => boolean \| void \| Promise<…>` | none | Called when the user picks or drops a file from their device, before it's opened. Return `false` to stop the editor opening it |
| `toolbarOptions` | `ToolbarOption[]` | all | Which tools to show (see [Toolbar](#toolbar)). Tools always appear in a fixed order. `[]` hides the toolbar |
| `customTools` | `CustomTool[]` | none | Your own buttons with an icon. `onClick` receives the current PDF bytes with edits applied (see [Custom tools](#custom-tools)) |
| `loadingState` | `boolean` | `false` | Shows the loading overlay over the whole editor, e.g. while your app fetches or saves |
| `loadingComponent` | `ReactNode` | `<PdfLoader />` | Replaces the default spinner in every loading overlay. `<PdfLoader label size />` is exported if you only want a different label |
| `maxFileSize` | `number` (bytes) | 100 MB | `0` disables the limit |
| `initialZoom` | `'auto' \| 'page-width' \| 'page-fit' \| number` | `'auto'` | `1` = 100% |
| `showSidebar` | `boolean` | `true` | Thumbnail sidebar |
| `textLayer` | `boolean` | `true` | Selectable text |
| `theme` | `'system' \| 'light' \| 'dark'` | `'system'` | Colour scheme |
| `workerSrc` | `string` | unpkg CDN | URL of `pdf.worker.min.mjs` |
| `assetsBaseUrl` | `string` | unpkg CDN | Base URL for pdf.js `cmaps/`, `standard_fonts/`, `wasm/` |
| `onFileLoad` | `({ name, size, pageCount }) => void` | none | Called after a document opens |
| `onError` | `(error: PdfEditorError) => void` | none | See [error codes](#error-codes) |
| `onPasswordRequest` | `({ reason, fileName }) => string \| null \| Promise<…>` | built-in dialog | Supply a password for encrypted files; return `null` to cancel |
| `toolbarExtras` | `ReactNode` | none | Extra content rendered in the toolbar |
| `emptyState` | `ReactNode` | none | Replaces the upload screen shown when no file is open |

### Error codes

`error.code` is one of:

| Code | Meaning |
|---|---|
| `INVALID_PDF` | Not a PDF (the file's bytes are checked, not its name) |
| `TOO_LARGE` | Bigger than `maxFileSize` |
| `PASSWORD_REQUIRED` | Encrypted and no password was given |
| `CORRUPT` | The PDF is damaged |
| `UNSUPPORTED_INPUT` | `file` isn't a supported type |
| `FETCH_FAILED` | A URL couldn't be downloaded |
| `LOAD_FAILED` | Any other loading failure |

If a new file fails to open, the current document stays open and an error
banner appears. Use `isPdfEditorError(err)` to narrow unknown errors.

## Toolbar

### Choosing tools

`toolbarOptions` takes one list covering both bars. Anything you leave out is hidden.

| Bar | Names |
|---|---|
| Main toolbar | `'sidebar'`, `'open'`, `'fileName'`, `'pageNav'`, `'zoom'`, `'edit'`, `'download'`, `'save'` |
| Formatting bar (Edit mode) | `'undo'`, `'redo'`, `'fontSelection'`, `'fontSize'`, `'bold'`, `'italic'`, `'underline'`, `'textColor'`, `'alignment'`, `'deleteText'` |

```tsx
// Simple editing: size, bold and italic only
<PdfEditor
  toolbarOptions={['pageNav', 'zoom', 'edit', 'save', 'undo', 'redo', 'fontSize', 'bold', 'italic']}
  onSave={upload}
/>
```

- Hiding a formatting tool also disables its shortcut. Without `'bold'`, Ctrl/⌘+B does nothing.
- Unknown names are ignored.
- The **Done** button always shows in Edit mode.
- `TOOLBAR_OPTIONS`, `MAIN_TOOLBAR_OPTIONS` and `FORMAT_TOOL_OPTIONS` are exported if you want to build the list programmatically.

### Custom tools

```tsx
<PdfEditor
  customTools={[
    {
      id: 'email',
      label: 'Send by email',
      icon: <MailIcon />,
      showLabel: true, // text next to the icon on wide layouts
      onClick: async (bytes, { fileName, edited }) => {
        await api.sendPdf(bytes, fileName); // spinner shows until this resolves
      },
    },
  ]}
/>
```

How `onClick` behaves:

- It receives the PDF exactly as Save would produce it, including a text box that is still open.
- If it returns a promise, the button shows a spinner until the promise settles.
- If it throws, an error banner appears and `onError` is called.

Custom tools appear before Save, and they still show when `toolbarOptions` is `[]`.

### Small screens

Buttons never squash. When the toolbar runs out of room, it moves items into a
**⋯ More** menu, least important first: your custom tools, then Download, Zoom,
Open and Thumbnails. **Edit** and **Save** always stay visible. This responds to
the editor's own width, so it also works when the editor is embedded in a
narrow panel.

## Editing text

Click **Edit** in the toolbar, then:

- **Click any paragraph** to edit it in place, like a word processor. Text rewraps as you type, Enter starts a new paragraph, and Ctrl/⌘+B / I / U work.
- **Click an empty spot** to add new text there.
- Use the formatting bar for font (sans, serif or mono), size, bold, italic, underline, colour and alignment (left, centre, right or justify).
- Drag the handle above the box to move it, and the side handle to change its width.
- **Undo/redo:** Ctrl/⌘+Z and Ctrl/⌘+Shift+Z.
- Inside the box, Escape cancels and Ctrl/⌘+Enter or clicking elsewhere confirms.

When you download, the original text is **really removed** from the page
content, not just covered by a white box. The new text is written as real,
searchable PDF text. Everything else on the page stays byte-for-byte as it was.

How it works:

1. The page's content stream is parsed and its text decoded (ToUnicode CMaps, font encodings and widths).
2. The text is grouped into lines and paragraphs. Bold, italic, colour, alignment and soft-wrap versus hard breaks are detected.
3. On save, the edited text operators are replaced by equivalent spacing, so nothing else on the page moves.
4. The new text is laid out by one engine, shared by the screen and the PDF, so line breaks match.

While a paragraph is open, the editor reads the page pixels around it to match
the background colour. That hides the old text immediately, before the page is
re-rendered without it.

### Current limitations

- **Fonts:** edited paragraphs are set in Helvetica, Times or Courier (closest match), not the document's original font. Characters outside Western European (WinAnsi) are substituted on export, and you'll see a notice when that happens.
- **Not editable yet:**
  - text inside form XObjects
  - Type3 fonts
  - CID fonts without a ToUnicode map
  - rotated text
  - rotated pages
  - encrypted PDFs that allow changes

  Blocks the editor can't edit are outlined but locked.
- **Restricted PDFs:** these stay view-only by design. See [Restricted PDFs](#restricted-pdfs).
- **Paragraph size:** a paragraph grows downwards. It doesn't push content below it, because PDFs have no document flow.
- **Scanned pages:** these have no text to edit. OCR-based editing is planned.

### Restricted PDFs

A PDF's owner can set permissions that forbid changes, and the file may still
open without a password. These files stay view-only, and there is no option to
override this.

When someone clicks **Edit** on one, the editor shows a warning that lists what
the owner has restricted in that file. For example:

> This PDF is restricted by its owner, so it can't be edited. Not allowed: changing its content, copying text and adding comments. To make changes, ask the owner for an unrestricted copy.

The editor only enforces the restriction on editing. The warning describes the
file's other permissions, but copying and printing aren't blocked. To stop
people selecting text, set `textLayer={false}`.

If you build your own UI, `setMode('edit')` doesn't run this check. Call it
yourself and show the reason, and note that `exportPdf()` rejects with the same
reason if edits are applied to a restricted file:

```tsx
const check = await editor.session?.editability();
if (check && !check.ok) editor.showNotice(check.reason ?? "This PDF can't be edited.");
else editor.setMode('edit');
```

## Responsive behaviour

The layout responds to the **editor's own width** (CSS container queries), not
the window's, so it also works inside a narrow column.

| Editor width | Layout |
|---|---|
| ≥ 1024px | Thumbnail sidebar docked open; full toolbar |
| 768–1023px | Sidebar docked but closed by default |
| < 768px | Sidebar becomes a slide-in drawer that closes after you pick a page |
| ≤ 640px | Icon-only buttons; the zoom menu becomes a percentage readout |
| ≤ 420px | Previous/next page buttons are hidden (type a page number instead) |

On touch screens:

- buttons grow to 44px tap targets
- two-finger pinch zooms around your fingers
- the password dialog becomes a bottom sheet
- safe-area insets are respected

On desktop, Ctrl/⌘ + scroll wheel (and trackpad pinch) zooms around the pointer.

## Build your own UI

Every piece of `<PdfEditor>` is exported, so you can assemble your own layout.

```tsx
import {
  usePdfEditor,
  EditorProvider,
  PdfViewer,
  PdfDropzone,
  useFilePicker,
} from 'react-pdf-editor-kit';

function MyEditor() {
  const editor = usePdfEditor({ workerSrc });
  const { open } = useFilePicker({ accept: 'application/pdf', onFiles: ([f]) => editor.load(f) });
  return (
    <EditorProvider editor={editor}>
      <button onClick={open}>Upload</button>
      {editor.pageCount ? <PdfViewer /> : <PdfDropzone onFile={editor.load} />}
    </EditorProvider>
  );
}
```

The controller returned by `usePdfEditor` exposes:

| Group | Members |
|---|---|
| Document state | `status`, `fileName`, `fileSize`, `pageCount`, `pageSizes`, `currentPage`, `zoom`, `scale`, `error`, `notice` |
| Editing state | `mode`, `edits`, `isDirty`, `canUndo`, `canRedo`, `activeEdit`, `saving`, `session` (`null` until a document is open; `session.editability()` checks whether it can be edited) |
| Navigation | `load(input)`, `close()`, `goToPage(index)`, `setZoom(zoom)`, `zoomIn()`, `zoomOut()` |
| Editing | `setMode(mode)`, `endEdit({ discard? })`, `deleteActive()`, `undo()`, `redo()` |
| Output | `exportPdf()` → `Promise<Uint8Array>`, `download(fileName?)`, `save(handler)`, `markSaved()` |
| Messages | `showNotice(message)`, `clearError()`, `reportError(error, context?)` |

Other exports: `Toolbar`, `FormatBar`, `ThumbnailSidebar`, `PdfPage`,
`TextEditLayer`, `PasswordDialog`, `PdfLoader`, `useEditor`, `useDropTarget`,
`pickFiles`, plus helpers such as `normalizePdfInput`, `hasPdfHeader` and
`formatBytes`. All types are exported too.

## Theming

Override the CSS variables on `.rpe-root`, for example:

```css
.rpe-root {
  --rpe-accent: #0a7d55;
  --rpe-radius: 4px;
  --rpe-sidebar-width: 200px;
}
```

Use the `theme` prop to force `'light'` or `'dark'`; the default `'system'`
follows the user's OS setting.

## Frameworks: Vite, Next.js, webpack

pdf.js does its parsing in a Web Worker. Point `workerSrc` at a copy of
`pdfjs-dist/build/pdf.worker.min.mjs` that your bundler serves.

**Vite**

```ts
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
```

**webpack 5 / Next.js**

```ts
const workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
```

**Next.js App Router.** pdf.js is loaded lazily on the client, and the build
includes a `"use client"` banner, so the editor works inside client
components. To keep it out of server rendering completely, load it with
`dynamic`:

```tsx
'use client';
import dynamic from 'next/dynamic';
import 'react-pdf-editor-kit/styles.css';

const PdfEditor = dynamic(() => import('react-pdf-editor-kit').then((m) => m.PdfEditor), {
  ssr: false,
});
```

**CJK text and some fonts.** pdf.js needs its `cmaps/`, `standard_fonts/` and
`wasm/` folders. By default these come from unpkg. To self-host them, copy them
from `node_modules/pdfjs-dist/` to your public folder and pass `assetsBaseUrl`
(e.g. `"/pdfjs/"`).

## Browser support

Current versions of Chrome, Edge, Firefox and Safari (desktop and mobile). The
layout uses CSS container queries, so the minimum is about Chrome/Edge 105,
Safari 16 and Firefox 110. pdf.js 5 has similar requirements.

## Development

```bash
npm install
npm run dev            # playground at http://localhost:5173 (Load sample, width presets, theme)
npm test               # vitest
npm run typecheck
npm run build          # dist/ (ESM + CJS + d.ts + styles.css)
npm run lint:package   # check package.json exports and types (publint + arethetypeswrong)
```

### Releasing

1. Update `CHANGELOG.md` and bump the version: `npm version patch` (or `minor` / `major`).
2. `npm publish`. `prepublishOnly` runs the typecheck, tests and build first.
3. `git push --follow-tags`.

Contributions are welcome. Please open an issue to discuss larger changes, and
make sure `npm test` and `npm run typecheck` pass.

## License

[MIT](./LICENSE) © Udit Gupta
