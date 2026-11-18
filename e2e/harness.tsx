/**
 * Page the Playwright tests drive: a bare PdfEditor with one app font and
 * hooks to load a PDF and collect what `onSave` receives. Served by Vite at
 * /e2e/harness.html; not part of the package.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PdfEditor, type EditorFont } from '../src';

const FONT_DIR = '/tests/fixtures/fonts';

/** Liberation Sans as an app font, under a name the tests can pick. */
const FONTS: EditorFont[] = [
  {
    id: 'test-sans',
    label: 'Test Sans',
    family: 'sans',
    regular: `${FONT_DIR}/LiberationSans-Regular.ttf`,
    bold: `${FONT_DIR}/LiberationSans-Bold.ttf`,
  },
];

declare global {
  interface Window {
    /** Load a PDF given as base64. */
    loadPdf(base64: string, name?: string): void;
    /** Base64 of every PDF passed to `onSave`, oldest first. */
    savedPdfs: string[];
    /** Last error reported by the editor. */
    editorError: string | null;
  }
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

window.savedPdfs = [];
window.editorError = null;

function Harness() {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    window.loadPdf = (b64, name = 'test.pdf') => setFile(new File([fromBase64(b64) as BlobPart], name, { type: 'application/pdf' }));
  }, []);
  return (
    <>
      {/* Somewhere to click that is outside the editor (commits an inline edit). */}
      <div id="outside">Outside the editor</div>
      <div id="stage">
        <PdfEditor
          file={file}
          workerSrc={workerSrc}
          assetsBaseUrl="/node_modules/pdfjs-dist/"
          fonts={FONTS}
          onSave={(bytes) => {
            window.savedPdfs.push(toBase64(bytes));
          }}
          onError={(e) => {
            window.editorError = `${e.code}: ${e.message}`;
          }}
        />
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
