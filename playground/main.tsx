import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PdfEditor, PdfLoader, type CustomTool, type ToolbarOption } from '../src';
import { makeSamplePdf } from './sample';
import './playground.css';

const FRAMES = [
  { label: 'Full', width: '100%' },
  { label: 'Tablet', width: '768px' },
  { label: 'Phone', width: '375px' },
] as const;

const TOOLBARS: Record<string, ToolbarOption[] | undefined> = {
  'All tools': undefined,
  'Simple editing': ['pageNav', 'zoom', 'edit', 'save', 'undo', 'redo', 'fontSize', 'bold', 'italic'],
  'View + save only': ['pageNav', 'zoom', 'save'],
  'No toolbar': [],
};

const icon = (d: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

// Example custom tools: each receives the current PDF bytes (edits applied).
const makeCustomTools = (log: (s: string) => void): CustomTool[] => [
  {
    id: 'preview',
    label: 'Open in new tab',
    icon: icon('M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'),
    onClick: (bytes) => {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      window.open(url, '_blank');
      log(`customTool preview: ${bytes.byteLength} bytes`);
    },
  },
  {
    id: 'email',
    label: 'Send by email',
    showLabel: true,
    icon: icon('M4 6h16v12H4zM4 7l8 6 8-6'),
    onClick: async (bytes, info) => {
      log(`customTool email: sending ${info.fileName}…`);
      await wait(1000);
      log(`customTool email: sent ${info.fileName} (${bytes.byteLength} bytes, edited: ${info.edited})`);
    },
  },
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function App() {
  const [file, setFile] = useState<Uint8Array | null>(null);
  const [frame, setFrame] = useState<(typeof FRAMES)[number]['label']>('Full');
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [toolbar, setToolbar] = useState('All tools');
  const [customTools] = useState(() => makeCustomTools((s) => setLog(s)));
  const [editable, setEditable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [customLoader, setCustomLoader] = useState(false);
  const [log, setLog] = useState<string>('');
  const width = FRAMES.find((f) => f.label === frame)!.width;

  return (
    <div className="pg">
      <header className="pg-bar">
        <strong>react-pdf-editor-kit</strong>
        <button onClick={async () => setFile(await makeSamplePdf())}>Load sample</button>
        <span className="pg-seg" role="group" aria-label="Preview width">
          {FRAMES.map((f) => (
            <button key={f.label} aria-pressed={frame === f.label} onClick={() => setFrame(f.label)}>
              {f.label}
            </button>
          ))}
        </span>
        <select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)} aria-label="Theme">
          <option value="system">System theme</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        <select value={toolbar} onChange={(e) => setToolbar(e.target.value)} aria-label="Toolbar options">
          {Object.keys(TOOLBARS).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={editable} onChange={(e) => setEditable(e.target.checked)} /> Edit mode
        </label>
        <button aria-pressed={busy} onClick={() => setBusy((b) => !b)}>
          loadingState: {busy ? 'on' : 'off'}
        </button>
        <label>
          <input type="checkbox" checked={customLoader} onChange={(e) => setCustomLoader(e.target.checked)} /> Custom
          loader
        </label>
        <span className="pg-log">{log}</span>
      </header>
      <main className="pg-stage">
        <div className="pg-frame" style={{ width }}>
          <PdfEditor
            file={file}
            theme={theme}
            workerSrc={workerSrc}
            enableEditMode={editable}
            toolbarOptions={TOOLBARS[toolbar]}
            customTools={customTools}
            loadingState={busy}
            loadingComponent={customLoader ? <PdfLoader label="Fetching your contract…" size={88} /> : undefined}
            onOpen={(f) => setLog(`onOpen: ${f.name} (${Math.round(f.size / 1024)} KB)`)}
            onSave={async (bytes, info) => {
              setLog(`onSave: uploading ${info.fileName}…`);
              await wait(1200); // pretend to upload
              setLog(`onSave: saved ${info.fileName} (${Math.round(bytes.byteLength / 1024)} KB, edited: ${info.edited})`);
            }}
            onFileLoad={(m) => setLog(`Loaded ${m.name}: ${m.pageCount} pages`)}
            onError={(e) => setLog(`Error ${e.code}: ${e.message}`)}
          />
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
