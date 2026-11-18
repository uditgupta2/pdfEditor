# react-pdf-editor-kit

A responsive PDF viewer and **in-place text editor** component for React. It runs
entirely in the browser: files opened from the user's computer are never
uploaded anywhere.

> **Status: 0.2.0 (early).** Viewing, opening files, and in-place text editing
> in the document's own fonts work. Images, shapes, signatures and page
> operations come next ([roadmap](#roadmap)). The API may change between minor
> versions until 1.0.

## Features

- **Drop-in editor.** `<PdfEditor />` gives you a toolbar, a thumbnail sidebar,
  zoom, page navigation, download and save.
- **Real text editing.** Click a paragraph and type. The original text is
  removed from the PDF content stream, and the new text is written as real,
  searchable PDF text, not a white box with text on top.
- **Keeps the document's fonts.** Edited text is written in the font already
  in the PDF, so it looks and measures like the original. Add your own fonts
  to the font picker, or self-hosted stand-ins (Carlito for Calibri, Arimo for
  Arial, …) for characters a document's font doesn't have.
- **Opens files several ways.** File picker, drag and drop, Ctrl/⌘+O, or a
  `file` prop (`File`, `Blob`, `ArrayBuffer`, `Uint8Array` or URL).
- **Responsive.** The layout follows the editor's own width, not the
  window's, so it works in a narrow panel. Supports touch pinch-zoom.
- **Customisable.** Pick which toolbar buttons show, add your own buttons,
  theme it with CSS variables, or build your own UI from the hooks.
- **Typed.** Written in TypeScript and ships ESM, CommonJS and type
  declarations. Works in Next.js App Router (`"use client"` included).

## What's new in 0.2.0

0.2.0 is about **fonts**. In 0.1.0, edited text was always rewritten in
Helvetica, Times or Courier, so an edited paragraph often looked different from
the rest of the page. Now it keeps the document's look.

- **Edited text stays in the document's own font.** New text is written with
  the font already embedded in the PDF and measured with its real widths, so
  line breaks and spacing match the original.
- **Missing characters are handled one by one.** Embedded fonts are usually
  subsets. If one lacks a character you type, only that character falls back:
  to a bold/italic face of the same family, then a stand-in font you provide,
  then the closest standard font. For TrueType fonts, every character the
  document uses on *any* page is available, not just the current page's.
- **Font picker.** A new `'fontFamily'` toolbar tool lists the document's
  fonts, your fonts and the standard fonts. It is shown by default.
- **Bring your own fonts.** A new `fonts` prop adds fonts to the picker.
  `standInFonts()` sets up self-hosted, metric-compatible replacements for
  common fonts (Carlito for Calibri, Caladea for Cambria, Arimo for
  Arial/Helvetica, Tinos for Times New Roman, Cousine for Courier New).
  Fonts are embedded as subsets on export, and their licence flags
  (`OS/2.fsType`) are respected.

  ```tsx
  <PdfEditor
    fonts={[
      { id: 'inter', label: 'Inter', regular: '/fonts/Inter-Regular.ttf', bold: '/fonts/Inter-Bold.ttf' },
      ...standInFonts('/fonts/'),
    ]}
  />
  ```

  More setups are in [Providing fonts](#providing-fonts).
- **What you see is what you export.** After each edit the page is re-rendered
  with the new text drawn in its real font.
- **Faster and lighter.** Stand-in fonts download only when a character needs
  one. A font finishing loading redraws only the pages that use it. Shared
  fonts are parsed once per document. A page preview leak was fixed.

**Know before you upgrade: only characters the font has keep the font.** PDFs
usually embed just the characters the document already uses. Text you type is
kept in the original font only where that font has the character. Any other
character is written in a plain standard font (Helvetica, Times or Courier,
whichever is closest), unless you provide a stand-in or your own font for it.
For example, typing a "Q" into a document that never used one gives a "Q" that
doesn't match the letters around it. Rearranging or deleting text never has
this problem. See [Current limitations](#current-limitations) for the full
list.

**Upgrading from 0.1.0:** no code changes are needed. Saved `DocumentEdits`
from 0.1.0 still load and keep their standard fonts. `@pdf-lib/fontkit` is a
new dependency, downloaded only when an app font is first used. If you pass
your own `toolbarOptions`, add `'fontFamily'` to get the font picker. See
[Fonts](#fonts) for details and the [changelog](./CHANGELOG.md) for the full
list.

## Roadmap

Where the project stands, roughly in order:

- [x] Viewing, opening files, responsive layout, theming (0.1.0)
- [x] In-place paragraph editing with real, searchable PDF text (0.1.0)
- [x] Editing in the document's own fonts, font picker, app fonts (0.2.0)
- [ ] Show the document's embedded font *while typing*, not only after the edit is confirmed
- [ ] Better coverage for subset CFF/Type 1 fonts and non-Identity CID encodings
- [ ] Noto fallbacks for non-Latin scripts
- [ ] Images, shapes and signatures
- [ ] Page operations (add, delete, reorder, rotate)
- [ ] OCR-based editing for scanned pages

See [Current limitations](#current-limitations) for what doesn't work yet.

## Contents

- [What's new in 0.2.0](#whats-new-in-020)
- [Roadmap](#roadmap)
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
| `onUnresolvedContent` | `({ fileName, pages, streams }) => 'keep' \| 'remove' \| null \| Promise<…>` | built-in dialog | Decide what happens to content the editor can't read on edited pages; return `null` to cancel the save. See [Unreadable content](#unreadable-content) |
| `fonts` | `EditorFont[]` | none | Extra fonts for the font picker, and stand-ins for the document's own fonts. See [Fonts](#fonts) |
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
| `CANCELLED` | The user cancelled a save from a prompt. `exportPdf()` rejects with it; the built-in Save, Download and custom tools ignore it quietly |

If a new file fails to open, the current document stays open and an error
banner appears. Use `isPdfEditorError(err)` to narrow unknown errors.

## Toolbar

### Choosing tools

`toolbarOptions` takes one list covering both bars. Anything you leave out is hidden.

| Bar | Names |
|---|---|
| Main toolbar | `'sidebar'`, `'open'`, `'fileName'`, `'pageNav'`, `'zoom'`, `'edit'`, `'download'`, `'save'` |
| Formatting bar (Edit mode) | `'undo'`, `'redo'`, `'fontFamily'`, `'fontSize'`, `'bold'`, `'italic'`, `'underline'`, `'textColor'`, `'alignment'`, `'deleteText'` |

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
- Use the formatting bar for font, size, bold, italic, underline, colour and alignment (left, centre, right or justify). The font applies to the selected text, or to the whole box when nothing is selected.
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

### Fonts

Edited text keeps the **document's own font**: the new text is written with the
font already in the PDF, so it looks and measures exactly like the original.

Most PDFs embed fonts as subsets, which only contain the characters the
document uses. For TrueType fonts the editor reads the embedded font file to see
which characters it really has, so anything the document uses on *any* page is
available. A character the subset lacks (say, a "Q" in a document that never
used one) is set in a fallback, character by character:

1. a bold/italic face of the same family on the page, for bold or italic text;
2. the font's **stand-in** from `fonts`, if you provide one (see below). It is
   downloaded only when a character needs it;
3. Helvetica, Times or Courier, whichever is closest.

While you type, fonts you provide (and stand-ins) show in their real font as
soon as you pick them. The document's own font shows only if it is installed on
the computer (otherwise a similar font); once you confirm, that text is drawn
into the page by the PDF renderer, so you see the real result. Text in fonts
the browser can show (yours, stand-ins, and Helvetica/Times/Courier through
their metric-compatible system fonts) stays HTML, so editing it never re-renders
the page.

The **font picker** lists the document's fonts, the fonts you provide, and
Helvetica, Times and Courier. It applies to the selected text, or to the whole
box when nothing is selected. Hide it with `toolbarOptions` (leave out
`'fontFamily'`).

#### Providing fonts

```tsx
import { PdfEditor, standInFonts } from 'react-pdf-editor-kit';

<PdfEditor
  fonts={[
    // Offered in the picker. Bold/italic files are optional.
    { id: 'inter', label: 'Inter', regular: '/fonts/Inter-Regular.ttf', bold: '/fonts/Inter-Bold.ttf' },
    // Carlito for Calibri, Caladea for Cambria, Arimo for Arial/Helvetica,
    // Tinos for Times New Roman, Cousine for Courier New (self-hosted .ttf files).
    ...standInFonts('/fonts/'),
  ]}
/>
```

Common setups:

```tsx
import { PdfEditor, type EditorFont } from 'react-pdf-editor-kit';

// 1. Your brand font with all four styles, offered in the picker. `family` is the
//    standard font used for characters the font doesn't have.
const brand: EditorFont = {
  id: 'acme-serif',
  label: 'Acme Serif',
  family: 'serif',
  regular: '/fonts/AcmeSerif-Regular.ttf',
  bold: '/fonts/AcmeSerif-Bold.ttf',
  italic: '/fonts/AcmeSerif-Italic.ttf',
  boldItalic: '/fonts/AcmeSerif-BoldItalic.ttf',
};

// 2. A stand-in only: your documents use "Acme Sans", embedded as a subset.
//    Characters the subset lacks are written in your full copy of the font
//    instead of Helvetica. Hidden from the picker.
const acmeSans: EditorFont = {
  id: 'acme-sans',
  label: 'Acme Sans',
  regular: '/fonts/AcmeSans-Regular.ttf',
  bold: '/fonts/AcmeSans-Bold.ttf',
  replaces: ['Acme Sans'], // the PDF font's family name, without "ABCDEF+" or "-Bold"
  hidden: true,
};

// 3. A font the user picks from their computer: pass the bytes.
async function fontFromFile(file: File): Promise<EditorFont> {
  return {
    id: `user:${file.name}`,
    label: file.name.replace(/\.(ttf|otf)$/i, ''),
    regular: new Uint8Array(await file.arrayBuffer()),
  };
}

function App({ userFonts }: { userFonts: EditorFont[] }) {
  // An inline array is fine: fonts already registered with the same files are skipped.
  return <PdfEditor fonts={[brand, acmeSans, ...userFonts]} />;
}
```

Fonts from URLs are fetched only when first used, so a long list costs nothing
up front. The fonts from `standInFonts()` also appear in the picker. To use them
only as stand-ins, map them with `hidden: true`:
`standInFonts('/fonts/').map((f) => ({ ...f, hidden: true }))`.

| `EditorFont` field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique id. Fonts are shared by every editor on the page, by id |
| `label` | `string` | Name shown in the font picker |
| `regular` | `string \| Uint8Array \| ArrayBuffer` | Font file: a URL, or its bytes |
| `bold`, `italic`, `boldItalic` | same | Optional styles. Without one, that style falls back to the standard font |
| `family` | `'sans' \| 'serif' \| 'mono'` | Standard font for characters this font lacks. Default `'sans'` |
| `replaces` | `string[]` | PDF font families it stands in for, e.g. `['Calibri']` |
| `hidden` | `boolean` | Use only as a stand-in; leave out of the picker |

`standInFonts(baseUrl)` returns the five metric-compatible stand-ins (SIL OFL /
Apache licensed). Download them and serve them from your own folder, named
`<Name>-Regular.ttf`, `<Name>-Bold.ttf`, `<Name>-Italic.ttf` and
`<Name>-BoldItalic.ttf`, where `<Name>` is `Carlito`, `Caladea`, `Arimo`,
`Tinos` or `Cousine`. Nothing is fetched from a CDN.

Font files load on first use. The font parser (fontkit) is downloaded only
when an app font is first used. On export, fonts are embedded as subsets with
ligatures and kerning off, so the PDF matches the screen. TrueType (`.ttf`)
works best; some CFF-based `.otf` files don't subset cleanly.

Font licences are respected through the font's own embedding flags
(`OS/2.fsType`): a font marked as not embeddable (Restricted License, or
bitmap-only) is not loaded, and its text uses the fallback standard font; a
font marked "no subsetting" is embedded whole. You are still responsible for
having the right to use the fonts you provide.

### Current limitations

- **Fonts:**
  - **Only characters the embedded font has stay in that font.** Most PDFs embed fonts as subsets that contain only the characters the document already uses. A character you type that isn't in the subset is written in a plain standard font (Helvetica, Times or Courier, whichever is closest), so it can look different from the text around it. Provide a stand-in or your own font with `fonts` to avoid this.
  - For subset fonts in CFF or Type 1 format, only the characters used on the current page are known to be available; others use the fallback. TrueType subsets offer every character the document uses.
  - Characters outside Western European (WinAnsi) can only be written in the document's fonts or fonts you provide. Otherwise they are substituted on export, and you'll see a notice.
  - A document font that the PDF doesn't encode simply (non-Identity CID encodings) falls back to the closest standard font.
  - Editing a paragraph re-lays it with the font's own widths, without kerning. Text from producers that fine-tune glyph positions (Chrome's "Save as PDF", for example) can come out up to about 2% narrower.
  - Ligatures in PDFs from Chrome (ﬀ, ﬁ, ﬄ) are read as single ligature characters, not separate letters.
- **Right-to-left and complex scripts:** paragraphs in Hebrew, Arabic, Devanagari and other Indic scripts, Thai, Lao, Tibetan, Myanmar, Khmer or Mongolian are locked. The editor writes text character by character, and these scripts need shaping or right-to-left ordering. A paragraph with any such text, even one word, is locked as a whole. So is a paragraph with characters the PDF doesn't map to real text. Their tooltip says the script can't be edited yet.
- **Not editable yet:**
  - text inside form XObjects
  - Type3 fonts. Chrome's "Save as PDF" writes OpenType/CFF (`.otf`) web fonts as Type3, so that text can't be edited. It also isn't outlined as locked yet
  - CID fonts without a ToUnicode map
  - rotated text
  - rotated pages
  - encrypted PDFs that allow changes

  Blocks the editor can't edit are outlined but locked.
- **Restricted PDFs:** these stay view-only by design. See [Restricted PDFs](#restricted-pdfs).
- **Paragraph size:** a paragraph grows downwards. It doesn't push content below it, because PDFs have no document flow.
- **Scanned pages:** these have no text to edit. OCR-based editing is planned.

### Unreadable content

To change a paragraph, the editor rewrites that page's content. Occasionally a
page contains a content stream it can't decode, for example because the stream
is damaged or uses a format the editor doesn't support. That content still
displays in the viewer, but the editor can't read it.

The editor never drops it silently. When you save or download, and an edited
page contains such content, a dialog lists the pages and offers three choices:

- **Keep** (default) saves that content exactly as it was, in its original place.
- **Remove** leaves it out of the saved file, so anything it draws on the page disappears.
- **Cancel** stops the save.

Pages where you only added new text aren't affected, because their original
content is left untouched.

To decide in code, or show your own UI, pass `onUnresolvedContent`, or pass the
choice straight to `exportPdf`:

```tsx
<PdfEditor onUnresolvedContent={({ pages }) => (confirm(`Keep unreadable content on pages ${pages.join(', ')}?`) ? 'keep' : 'remove')} />

const bytes = await editor.exportPdf({ unresolvedContent: 'keep' });
```

If you build your own UI with `usePdfEditor`, render
`<UnresolvedContentDialog request={editor.unresolvedRequest} />` while
`editor.unresolvedRequest` is set, or pass `onUnresolvedContent`.

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
| Editing state | `mode`, `edits`, `isDirty`, `canUndo`, `canRedo`, `activeEdit`, `saving`, `unresolvedRequest`, `session` (`null` until a document is open; `session.editability()` checks whether it can be edited) |
| Navigation | `load(input)`, `close()`, `goToPage(index)`, `setZoom(zoom)`, `zoomIn()`, `zoomOut()` |
| Editing | `setMode(mode)`, `endEdit({ discard? })`, `deleteActive()`, `undo()`, `redo()` |
| Output | `exportPdf({ unresolvedContent? })` → `Promise<Uint8Array>`, `download(fileName?)`, `save(handler)`, `markSaved()` |
| Messages | `showNotice(message)`, `clearError()`, `reportError(error, context?)` |

Other exports: `Toolbar`, `FormatBar`, `ThumbnailSidebar`, `PdfPage`,
`TextEditLayer`, `PasswordDialog`, `UnresolvedContentDialog`, `PdfLoader`, `useEditor`, `useDropTarget`,
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

Editing and fonts are covered by end-to-end tests in Chromium and Firefox (see
[End-to-end tests](#end-to-end-tests)). Safari (WebKit) is set up in the test
suite but isn't part of the regular runs yet.

## Development

```bash
npm install
npm run dev            # playground at http://localhost:5173 (Load sample, width presets, theme)
npm test               # vitest
npm run test:e2e       # Playwright: Chromium and Firefox; WebKit needs system libraries (see below)
npm run typecheck
npm run build          # dist/ (ESM + CJS + d.ts + styles.css)
npm run lint:package   # check package.json exports and types (publint + arethetypeswrong)
```

### End-to-end tests

`e2e/` drives the editor in real browsers through `e2e/harness.html`, which Vite
serves (the test run starts it). The tests build their PDFs in Node, edit and
save in the browser, then read the saved file back. First run:

```bash
npx playwright install chromium firefox webkit
sudo npx playwright install-deps   # Linux: system libraries the browsers need (WebKit in particular)
npm run test:e2e -- --project=chromium   # one browser
```

### Font test PDFs

`tests/producers.test.ts` edits PDFs made by real producers (Chromium, Cairo,
Ghostscript), which embed fonts as CID TrueType, simple TrueType, Type 1C, Type 1
and Type 3. The PDFs in `tests/fixtures/pdfs/` are committed. To rebuild them,
run `scripts/font-pdfs/make.sh` (needs Playwright's Chromium, pycairo, groff,
Ghostscript and the Liberation, DejaVu, Noto and URW fonts).

### Releasing

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under the new version, then
   bump it: `npm version patch` (or `minor` / `major`), which also creates the git tag.
2. `npm publish`. `prepublishOnly` runs the typecheck, tests and build first.
3. `git push --follow-tags`.

Contributions are welcome. Please open an issue to discuss larger changes, and
make sure `npm test` and `npm run typecheck` pass.

## License

[MIT](./LICENSE) © Udit Gupta
