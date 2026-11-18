import type { FamilyClass } from './model';

/** A font file: a URL to fetch, or its bytes. TrueType (.ttf) works best; .otf and .woff work too. */
export type FontFileSource = string | Uint8Array | ArrayBuffer;

/** A font the app makes available for editing. */
export interface EditorFont {
  /** Unique id, e.g. `'inter'`. Fonts are shared by every editor on the page, by id. */
  id: string;
  /** Name shown in the font picker. */
  label: string;
  /** Standard font to fall back to for characters this font lacks. Default `'sans'`. */
  family?: FamilyClass;
  regular: FontFileSource;
  bold?: FontFileSource;
  italic?: FontFileSource;
  boldItalic?: FontFileSource;
  /**
   * PDF font families this font can stand in for, e.g. `['Calibri']`. When the
   * original font of edited text lacks a character (it was embedded as a
   * subset), the character is set in this font instead of Helvetica/Times/Courier.
   * Fonts with the same widths work best (e.g. Carlito for Calibri).
   */
  replaces?: string[];
  /** Leave out of the font picker (use only as a stand-in). Default false. */
  hidden?: boolean;
}

/** A loaded font face, ready to measure, show and embed. */
export interface LoadedFace {
  /** `lib:<id>:<b|i|bi|>` */
  id: string;
  fontId: string;
  bold: boolean;
  italic: boolean;
  bytes: Uint8Array;
  /** Embed only the glyphs used. False when the font's license (`OS/2.fsType`) forbids subsetting. */
  subset: boolean;
  has(ch: string): boolean;
  /** Advance width in 1/1000 em. */
  width(ch: string): number;
}

type Variant = 'regular' | 'bold' | 'italic' | 'boldItalic';
const variantOf = (bold: boolean, italic: boolean): Variant =>
  bold ? (italic ? 'boldItalic' : 'bold') : italic ? 'italic' : 'regular';
const faceId = (fontId: string, bold: boolean, italic: boolean) => `lib:${fontId}:${bold ? 'b' : ''}${italic ? 'i' : ''}`;

/** CSS family name the browser knows a library font by (all variants share it). */
export const libCssFamily = (fontId: string) => `rpe-lib-${fontId.replace(/[^\w-]/g, '_')}`;

/**
 * Well-known metric-compatible replacements, by normalised PDF family name.
 * A library font whose label matches one of these stands in automatically,
 * without listing the family in `replaces`.
 */
const STAND_INS: Record<string, string[]> = {
  calibri: ['carlito'],
  cambria: ['caladea'],
  arial: ['arimo', 'liberationsans'],
  helvetica: ['arimo', 'liberationsans'],
  timesnewroman: ['tinos', 'liberationserif'],
  times: ['tinos', 'liberationserif'],
  couriernew: ['cousine', 'liberationmono'],
  courier: ['cousine', 'liberationmono'],
};

const FILES = ['regular', 'bold', 'italic', 'boldItalic'] as const;
const sameFont = (a: EditorFont, b: EditorFont) =>
  a === b ||
  (a.label === b.label &&
    a.family === b.family &&
    !!a.hidden === !!b.hidden &&
    (a.replaces ?? []).join('\n') === (b.replaces ?? []).join('\n') &&
    FILES.every((k) => a[k] === b[k]));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

type Fontkit = { create(bytes: Uint8Array): FontkitFont };
interface FontkitFont {
  unitsPerEm: number;
  'OS/2'?: { fsType?: { noEmbedding?: boolean; noSubsetting?: boolean; bitmapOnly?: boolean } };
  hasGlyphForCodePoint(cp: number): boolean;
  glyphForCodePoint(cp: number): { advanceWidth: number };
}

/**
 * What the font's license lets us do, from `OS/2.fsType` (OpenType spec):
 * `null` when it may not be embedded at all (Restricted License, or
 * bitmap-only embedding, which a PDF can't use), otherwise whether it may be subset.
 */
export function embeddingRights(font: Pick<FontkitFont, 'OS/2'>): { subset: boolean } | null {
  const fsType = font['OS/2']?.fsType;
  if (fsType?.noEmbedding || fsType?.bitmapOnly) return null;
  return { subset: !fsType?.noSubsetting };
}

let fontkitP: Promise<Fontkit> | null = null;
export function loadFontkit(): Promise<Fontkit> {
  fontkitP ??= import('@pdf-lib/fontkit').then((m) => ((m as { default?: Fontkit }).default ?? m) as Fontkit);
  return fontkitP;
}

async function readSource(src: FontFileSource): Promise<Uint8Array> {
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  const res = await fetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${src}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * The fonts apps provide for editing (`fonts` prop). Faces load on first use;
 * until a face has loaded, text that asks for it is laid out in the fallback
 * standard font, and `subscribe` listeners are told when it arrives.
 */
class FontLibrary {
  private fonts = new Map<string, EditorFont>();
  private faces = new Map<string, LoadedFace>();
  private loading = new Map<string, Promise<LoadedFace | null>>();
  /** Faces added to `document.fonts`, so they can be taken out again when a font's files change. */
  private browserFaces = new Map<string, FontFace>();
  private listeners = new Set<() => void>();
  private version = 0;

  /** Add or replace fonts (by id). */
  register(fonts: readonly EditorFont[]) {
    let changed = false;
    for (const f of fonts) {
      const prev = this.fonts.get(f.id);
      if (prev && sameFont(prev, f)) continue;
      this.fonts.set(f.id, f);
      changed = true;
      if (prev) {
        // Different files under the same id: forget what was loaded.
        for (const b of [false, true]) for (const i of [false, true]) {
          const id = faceId(f.id, b, i);
          this.faces.delete(id);
          this.loading.delete(id);
          const shown = this.browserFaces.get(id);
          if (shown) {
            document.fonts.delete(shown);
            this.browserFaces.delete(id);
          }
        }
      }
    }
    if (changed) this.bump();
  }

  get(id: string) {
    return this.fonts.get(id);
  }

  list(): EditorFont[] {
    return [...this.fonts.values()];
  }

  /** The library font that stands in for a PDF font family, if any. */
  standInFor(familyName: string): EditorFont | undefined {
    const n = norm(familyName);
    if (!n) return undefined;
    const fonts = this.list();
    const explicit = fonts.find((f) => f.replaces?.some((r) => norm(r) === n));
    if (explicit) return explicit;
    const known = STAND_INS[n];
    return known ? fonts.find((f) => known.includes(norm(f.label)) || known.includes(norm(f.id))) : undefined;
  }

  /** Whether the font has a file for this style. */
  hasVariant(fontId: string, bold: boolean, italic: boolean) {
    return !!this.fonts.get(fontId)?.[variantOf(bold, italic)];
  }

  /** The face if it has loaded, else null. Unlike `face`, never starts a download. */
  peek(fontId: string, bold: boolean, italic: boolean): LoadedFace | null {
    return this.faces.get(faceId(fontId, bold, italic)) ?? null;
  }

  /** The face if it has loaded; otherwise starts loading it and returns null. */
  face(fontId: string, bold: boolean, italic: boolean): LoadedFace | null {
    const loaded = this.faces.get(faceId(fontId, bold, italic));
    if (loaded) return loaded;
    if (this.hasVariant(fontId, bold, italic)) void this.load(fontId, bold, italic);
    return null;
  }

  /** Load a face (once). Resolves to null if the font has no such style or it fails to load. */
  load(fontId: string, bold: boolean, italic: boolean): Promise<LoadedFace | null> {
    const id = faceId(fontId, bold, italic);
    const done = this.faces.get(id);
    if (done) return Promise.resolve(done);
    let p = this.loading.get(id);
    if (p) return p;
    const font = this.fonts.get(fontId);
    const src = font?.[variantOf(bold, italic)];
    if (!font || !src) return Promise.resolve(null);
    p = (async () => {
      try {
        const [fontkit, bytes] = await Promise.all([loadFontkit(), readSource(src)]);
        const f = fontkit.create(bytes);
        const rights = embeddingRights(f);
        // Text in it could be shown but never saved, so don't offer it at all.
        if (!rights) throw new Error("the font's license (OS/2 fsType) does not allow embedding it in documents");
        const scale = 1000 / f.unitsPerEm;
        const face: LoadedFace = {
          id,
          fontId,
          bold,
          italic,
          bytes,
          subset: rights.subset,
          has: (ch) => f.hasGlyphForCodePoint(ch.codePointAt(0)!),
          width: (ch) => f.glyphForCodePoint(ch.codePointAt(0)!).advanceWidth * scale,
        };
        const replaced = () => !sameFont(this.fonts.get(fontId) ?? font, font);
        if (replaced()) return null;
        const shown = await browserFace(fontId, bold, italic, bytes);
        // Registered with new files meanwhile: this face is stale, so the browser never gets it.
        if (replaced()) return null;
        if (shown) {
          document.fonts.add(shown);
          this.browserFaces.set(id, shown);
        }
        this.faces.set(id, face);
        this.bump();
        return face;
      } catch (e) {
        console.warn(`[pdf-editor] could not load font "${font.label}"`, e);
        return null;
      }
    })();
    this.loading.set(id, p);
    return p;
  }

  /** Changes whenever a font is registered or a face finishes loading. */
  getVersion = () => this.version;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private bump() {
    this.version++;
    for (const l of this.listeners) l();
  }
}

/**
 * A loaded browser face for the font, so edited text can show in it; the
 * caller adds it to `document.fonts`. Null where there is no FontFace API
 * (SSR, tests) or the browser rejects the file.
 */
async function browserFace(fontId: string, bold: boolean, italic: boolean, bytes: Uint8Array): Promise<FontFace | null> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return null;
  try {
    const face = new FontFace(libCssFamily(fontId), bytes.slice().buffer, {
      weight: bold ? '700' : '400',
      style: italic ? 'italic' : 'normal',
    });
    return await face.load();
  } catch (e) {
    // Measuring and exporting still work; the screen falls back to a similar font.
    console.warn('[pdf-editor] the browser could not load a font', e);
    return null;
  }
}

export const fontLibrary = new FontLibrary();

/**
 * The five metric-compatible stand-ins (Carlito for Calibri, Caladea for
 * Cambria, Arimo for Arial/Helvetica, Tinos for Times New Roman, Cousine for
 * Courier New), served from your own folder. Download them (SIL OFL / Apache
 * licensed) and name the files like `Carlito-Regular.ttf`, `Carlito-Bold.ttf`,
 * `Carlito-Italic.ttf`, `Carlito-BoldItalic.ttf`.
 *
 * ```tsx
 * <PdfEditor fonts={standInFonts('/fonts/')} />
 * ```
 */
export function standInFonts(baseUrl: string): EditorFont[] {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const make = (name: string, family: FamilyClass, replaces: string[]): EditorFont => ({
    id: name.toLowerCase(),
    label: name,
    family,
    regular: `${base}${name}-Regular.ttf`,
    bold: `${base}${name}-Bold.ttf`,
    italic: `${base}${name}-Italic.ttf`,
    boldItalic: `${base}${name}-BoldItalic.ttf`,
    replaces,
  });
  return [
    make('Carlito', 'sans', ['Calibri']),
    make('Caladea', 'serif', ['Cambria']),
    make('Arimo', 'sans', ['Arial', 'Helvetica']),
    make('Tinos', 'serif', ['Times New Roman', 'Times']),
    make('Cousine', 'mono', ['Courier New', 'Courier']),
  ];
}
