import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PDFDocument } from 'pdf-lib';
import { assetUrls, getPdfjs, type PdfjsOptions } from '../render/pdfjs';
import type { PageAnalysis } from './extract';
import type { DocumentEdits } from './model';

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

  /** The page rendered without the removed runs (cached per removal set). */
  async renderPage(pageIndex: number, removed: string[]): Promise<PDFPageProxy> {
    const key = removalKey(removed);
    const existing = this.renders.get(pageIndex);
    if (existing?.key === key) return (await existing.doc).getPage(1);
    const docP = (async () => {
      const [engine, doc, analysis, pdfjs] = await Promise.all([
        this.engine(),
        this.doc(),
        this.analyze(pageIndex),
        getPdfjs(this.options),
      ]);
      const bytes = await engine.buildPageWithoutRuns(doc, pageIndex, analysis, removed);
      return pdfjs.getDocument({ data: bytes, ...assetUrls(pdfjs, this.options.assetsBaseUrl) }).promise;
    })();
    this.renders.set(pageIndex, { key, doc: docP });
    // Free the previous variant once the new one is ready.
    if (existing) void docP.then(() => existing.doc.then((d) => d.destroy()), () => undefined);
    if (this.destroyed) void docP.then((d) => d.destroy());
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
