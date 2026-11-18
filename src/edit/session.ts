import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PDFDocument } from 'pdf-lib';
import { assetUrls, getPdfjs, type PdfjsOptions } from '../render/pdfjs';
import type { PageAnalysis } from './extract';
import { libFacesState, usesPageFont } from './faces';
import { fontLibrary } from './fontLibrary';
import type { DocumentEdits, PageEdits, PdfFont } from './model';

type Engine = typeof import('./engine');

/** A page with content the editor could not read (see `EditSession.unresolvedContent`). */
export interface UnresolvedPage {
  /** Zero-based page index. */
  page: number;
  /** Number of content streams on that page that could not be decoded. */
  streams: number;
}

/** Must match the label in `forbiddenActions`. A value import would pull pdf-lib into the main bundle. */
const CHANGING_CONTENT = 'changing its content';

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function joinList(items: string[]) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function removalKey(removed: string[] | undefined) {
  return removed && removed.length ? hash([...removed].sort().join('|')) : 'original';
}

/** A page font's glyph table never changes once analysed, so its identity stands for it. */
const fontIdentity = new WeakMap<PdfFont, number>();
let nextFontId = 0;
function fontIds(fonts: Record<string, PdfFont> | undefined) {
  if (!fonts) return undefined;
  return Object.keys(fonts)
    .sort()
    .map((k) => {
      let id = fontIdentity.get(fonts[k]!);
      if (id === undefined) fontIdentity.set(fonts[k]!, (id = nextFontId++));
      return `${k}#${id}`;
    });
}

const renderKeys = new WeakMap<PageEdits, { base: string; version: number; key: string }>();

/**
 * Identifies how a page should look with its edits: which original text is
 * removed, which frames are drawn, and which of the app fonts they are drawn
 * in have loaded. `'original'` when there is nothing to change. A font that
 * the page's text doesn't use loading elsewhere leaves the key (and the
 * rendered page) as it is.
 */
export function pageRenderKey(edits: PageEdits | undefined): string {
  if (!edits) return 'original';
  const version = fontLibrary.getVersion();
  const cached = renderKeys.get(edits);
  if (cached?.version === version) return cached.key;
  // Only frames in the page's own fonts are drawn into the rendered page (see `buildEditedPage`).
  const drawn = edits.frames.filter(usesPageFont);
  if (!edits.removedRuns.length && !drawn.length) {
    renderKeys.set(edits, { base: 'original', version, key: 'original' });
    return 'original';
  }
  // Edits are immutable, so the frames are serialised once per edits object.
  // The screen-only cover colour doesn't change the rendered page, and page
  // fonts are named by identity rather than serialised with their glyph tables.
  const base =
    cached?.base ??
    `${removalKey(edits.removedRuns)}-${hash(
      JSON.stringify(drawn.map(({ cover: _cover, fonts, ...f }) => ({ ...f, fonts: fontIds(fonts) }))),
    )}`;
  const fonts = drawn.length ? libFacesState(drawn) : '';
  const key = fonts ? `${base}-${hash(fonts)}` : base;
  renderKeys.set(edits, { base, version, key });
  return key;
}

/**
 * Per-document editing state that is expensive to compute: the pdf-lib
 * document, page analyses (detected paragraphs) and pages re-rendered with
 * edited text removed. pdf-lib is only downloaded when this is first used.
 */
export class EditSession {
  private engineP: Promise<Engine> | null = null;
  private docP: Promise<PDFDocument> | null = null;
  private analyses = new Map<number, Promise<PageAnalysis>>();
  private renders = new Map<number, { key: string; doc: Promise<PDFDocumentProxy> }>();
  private destroyed = false;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly options: PdfjsOptions = {},
  ) {}

  private engine() {
    this.engineP ??= import('./engine');
    return this.engineP;
  }

  private doc() {
    this.docP ??= this.engine().then((e) => e.loadForEditing(this.bytes));
    return this.docP;
  }

  /**
   * Encrypted files can't be edited: their content streams are unreadable, and
   * a file whose permissions forbid changes must stay view-only.
   */
  async editability(): Promise<{ ok: boolean; reason?: string }> {
    try {
      const [engine, doc] = await Promise.all([this.engine(), this.doc()]);
      if (!doc.isEncrypted) return { ok: true };
      const forbidden = engine.forbiddenActions(doc);
      return {
        ok: false,
        reason: forbidden.includes(CHANGING_CONTENT)
          ? `This PDF is restricted by its owner, so it can't be edited. Not allowed: ${joinList(forbidden)}. To make changes, ask the owner for an unrestricted copy.`
          : 'Editing encrypted PDFs is not supported yet.',
      };
    } catch (e) {
      return { ok: false, reason: `This PDF can't be edited: ${(e as Error).message}` };
    }
  }

  analyze(pageIndex: number): Promise<PageAnalysis> {
    let p = this.analyses.get(pageIndex);
    if (!p) {
      p = Promise.all([this.engine(), this.doc()]).then(([engine, doc]) => engine.analyzePage(doc.getPage(pageIndex), pageIndex));
      this.analyses.set(pageIndex, p);
    }
    return p;
  }

  /** The page with its edits applied: removed text gone, frames drawn (cached per `pageRenderKey`). */
  async renderPage(pageIndex: number, edits: PageEdits): Promise<PDFPageProxy> {
    const key = pageRenderKey(edits);
    const existing = this.renders.get(pageIndex);
    if (existing?.key === key) return (await existing.doc).getPage(1);
    const docP = (async () => {
      const [engine, doc, analysis, pdfjs] = await Promise.all([
        this.engine(),
        this.doc(),
        this.analyze(pageIndex),
        getPdfjs(this.options),
      ]);
      const bytes = await engine.buildEditedPage(doc, pageIndex, analysis, edits);
      return pdfjs.getDocument({ data: bytes, ...assetUrls(pdfjs, this.options.assetsBaseUrl) }).promise;
    })();
    const entry = { key, doc: docP };
    this.renders.set(pageIndex, entry);
    // Free the previous variant once the new one has settled. If the new one
    // failed, the previous one is no longer reachable either, so free it then too.
    if (existing) {
      const release = () => void existing.doc.then((d) => d.destroy(), () => undefined);
      docP.then(release, release);
    }
    // A failed build must not stay cached under its key, or it would never be retried.
    docP.catch(() => {
      if (this.renders.get(pageIndex) === entry) this.renders.delete(pageIndex);
    });
    if (this.destroyed) void docP.then((d) => d.destroy(), () => undefined);
    return (await docP).getPage(1);
  }

  /**
   * Pages that will be rewritten on export (they have removed text) and contain
   * content streams the editor could not decode. Zero-based page indexes.
   */
  async unresolvedContent(edits: DocumentEdits): Promise<UnresolvedPage[]> {
    const out: UnresolvedPage[] = [];
    for (const [key, page] of Object.entries(edits)) {
      if (!page.removedRuns.length) continue;
      const { unresolved } = await this.analyze(Number(key));
      if (unresolved.length) out.push({ page: Number(key), streams: unresolved.length });
    }
    return out.sort((a, b) => a.page - b.page);
  }

  async export(edits: DocumentEdits, options: { unresolved?: 'keep' | 'remove' } = {}) {
    // Headless callers can reach this without going through the edit-mode check.
    const check = await this.editability();
    if (!check.ok) throw new Error(check.reason);
    const engine = await this.engine();
    return engine.exportEdited(this.bytes, edits, options);
  }

  destroy() {
    this.destroyed = true;
    for (const r of this.renders.values()) void r.doc.then((d) => d.destroy(), () => undefined);
    this.renders.clear();
    this.analyses.clear();
  }
}
