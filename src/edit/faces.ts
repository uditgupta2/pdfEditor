import { fontLibrary, libCssFamily, type LoadedFace } from './fontLibrary';
import { CSS_FAMILY, measure } from './metrics';
import type { FamilyClass, FontChoice, PdfFont, SpanStyle, TextFrame } from './model';

/**
 * A concrete font face text is drawn with. Layout picks one per character:
 * the span's font if it can draw the character, otherwise a fallback, ending
 * with the standard font (Helvetica, Times or Courier), which is always used
 * as a last resort.
 */
export type Face =
  | { kind: 'std'; id: string; family: FamilyClass; bold: boolean; italic: boolean }
  | { kind: 'pdf'; id: string; key: string; font: PdfFont }
  | { kind: 'lib'; id: string; face: LoadedFace };

const libFace = (fontId: string, bold: boolean, italic: boolean): Face | null => {
  const face = fontLibrary.face(fontId, bold, italic);
  return face ? { kind: 'lib', id: face.id, face } : null;
};

const flags = (bold: boolean, italic: boolean) => `${bold ? 'b' : ''}${italic ? 'i' : ''}`;

export function stdFace(family: FamilyClass, bold: boolean, italic: boolean): Face {
  return { kind: 'std', id: `std:${family}:${flags(bold, italic)}`, family, bold, italic };
}

const FAMILIES: readonly FamilyClass[] = ['sans', 'serif', 'mono'];

/** Split `pdf:F1` into its kind and value. */
export function parseChoice(choice: FontChoice): { kind: 'pdf' | 'lib' | 'std'; value: string } | null {
  const m = /^(pdf|lib|std):(.+)$/.exec(choice);
  return m ? { kind: m[1] as 'pdf' | 'lib' | 'std', value: m[2]! } : null;
}

export const frameFont = (frame: Pick<TextFrame, 'font' | 'family'>): FontChoice => frame.font ?? `std:${frame.family}`;

/** The page font `key` in the requested style, or a sibling of the same family that has it. */
function pdfFace(frame: Pick<TextFrame, 'fonts'>, key: string, bold: boolean, italic: boolean): Face | null {
  const fonts = frame.fonts ?? {};
  const f = fonts[key];
  if (!f) return null;
  if (f.bold === bold && f.italic === italic) return { kind: 'pdf', id: `pdf:${key}`, key, font: f };
  for (const [k, g] of Object.entries(fonts)) {
    if (g.familyName === f.familyName && g.bold === bold && g.italic === italic) return { kind: 'pdf', id: `pdf:${k}`, key: k, font: g };
  }
  return null;
}

/** Standard family the choice falls back to. */
export function choiceFamily(frame: Pick<TextFrame, 'fonts' | 'family'>, choice: FontChoice): FamilyClass {
  const c = parseChoice(choice);
  if (c?.kind === 'std' && (FAMILIES as string[]).includes(c.value)) return c.value as FamilyClass;
  if (c?.kind === 'pdf') return frame.fonts?.[c.value]?.family ?? frame.family;
  if (c?.kind === 'lib') return fontLibrary.get(c.value)?.family ?? frame.family;
  return frame.family;
}

/** Faces to try, in order, for text in `style`. Always ends with a standard face. */
export function faceChain(frame: Pick<TextFrame, 'fonts' | 'family' | 'font'>, style: SpanStyle): Face[] {
  const choice = style.font ?? frameFont(frame);
  const bold = !!style.bold;
  const italic = !!style.italic;
  const c = parseChoice(choice);
  const chain: Face[] = [];
  if (c?.kind === 'pdf') {
    const f = pdfFace(frame, c.value, bold, italic);
    if (f) chain.push(f);
    // Characters (or a style) the page font lacks: its stand-in, if the app
    // provides one and it has loaded. Building the chain never downloads it;
    // `facePicker` does, once a character actually needs it.
    const standIn = standInId(frame, c.value);
    const loaded = standIn ? fontLibrary.peek(standIn, bold, italic) : null;
    if (loaded) chain.push({ kind: 'lib', id: loaded.id, face: loaded });
  } else if (c?.kind === 'lib') {
    const lf = libFace(c.value, bold, italic);
    if (lf) chain.push(lf);
  }
  chain.push(stdFace(choiceFamily(frame, choice), bold, italic));
  return chain;
}

export function faceHas(face: Face, ch: string): boolean {
  if (face.kind === 'pdf') return !!face.font.glyphs[ch];
  if (face.kind === 'lib') return face.face.has(ch);
  return true;
}

/** First face in the chain that can draw `ch`. */
export function faceFor(chain: Face[], ch: string): Face {
  for (const f of chain) if (faceHas(f, ch)) return f;
  return chain[chain.length - 1]!;
}

/** Id of the library font standing in for page font `key`, if any. */
function standInId(frame: Pick<TextFrame, 'fonts'>, key: string): string | undefined {
  const familyName = frame.fonts?.[key]?.familyName;
  return familyName ? fontLibrary.standInFor(familyName)?.id : undefined;
}

/**
 * The stand-in face text in `style` would fall back to, when the page font
 * lacks a character. Null when the span isn't in a page font or it has none.
 */
function standInFor(frame: Pick<TextFrame, 'fonts' | 'family' | 'font'>, style: SpanStyle): [string, boolean, boolean] | null {
  const c = parseChoice(style.font ?? frameFont(frame));
  const id = c?.kind === 'pdf' ? standInId(frame, c.value) : undefined;
  return id && fontLibrary.hasVariant(id, !!style.bold, !!style.italic) ? [id, !!style.bold, !!style.italic] : null;
}

/**
 * Picks the face for each character of text in `style`, like `faceFor`. The
 * first time a character falls through to the standard font while the page
 * font's stand-in hasn't loaded, it starts loading the stand-in; layout runs
 * again when it arrives.
 */
export function facePicker(frame: Pick<TextFrame, 'fonts' | 'family' | 'font'>, style: SpanStyle): (ch: string) => Face {
  const chain = faceChain(frame, style);
  let pending = standInFor(frame, style);
  if (pending && fontLibrary.peek(...pending)) pending = null;
  return (ch) => {
    const face = faceFor(chain, ch);
    if (pending && face.kind === 'std') {
      fontLibrary.face(...pending);
      pending = null;
    }
    return face;
  };
}

/** Advance width of `ch` in points at `size`. */
export function faceWidth(face: Face, ch: string, size: number): number {
  if (face.kind === 'pdf') return ((face.font.glyphs[ch]?.[1] ?? 0) * size) / 1000;
  if (face.kind === 'lib') return (face.face.width(ch) * size) / 1000;
  return measure(ch, face.family, face.bold, face.italic, size);
}

// ---------------------------------------------------------------------------
// Screen

/**
 * Prefix of a CSS family name that identifies a font choice. The browser has
 * no such font and moves on to the next family in the list, but the editor
 * can read the choice back from the computed style of edited text.
 */
const TOKEN = 'rpe-font:';
const quote = (s: string) => `"${s.replace(/["\\]/g, '')}"`;

/** Read the font choice from a computed `font-family` value. */
export function choiceFromCss(fontFamily: string): FontChoice | undefined {
  const m = /rpe-font:([^"',\s]+)/.exec(fontFamily);
  return m ? decodeURIComponent(m[1]!) : undefined;
}

/** CSS `font-family` list that shows a font choice as closely as the browser can. */
export function cssFontStack(frame: Pick<TextFrame, 'fonts' | 'family'>, choice: FontChoice): string {
  const c = parseChoice(choice);
  const names: string[] = [quote(TOKEN + encodeURIComponent(choice))];
  if (c?.kind === 'pdf') {
    // If the original font is installed on this computer, the browser uses it.
    const f = frame.fonts?.[c.value];
    if (f) {
      names.push(quote(f.familyName));
      const raw = f.familyName.replace(/\s+/g, '');
      if (raw !== f.familyName) names.push(quote(raw));
      const standIn = fontLibrary.standInFor(f.familyName);
      if (standIn) names.push(quote(libCssFamily(standIn.id)));
    }
  } else if (c?.kind === 'lib') {
    names.push(quote(libCssFamily(c.value)));
  }
  return `${names.join(', ')}, ${CSS_FAMILY[choiceFamily(frame, choice)]}`;
}

/** Human-readable name of a font choice. */
export function choiceLabel(frame: Pick<TextFrame, 'fonts' | 'family'>, choice: FontChoice): string {
  const c = parseChoice(choice);
  if (c?.kind === 'pdf') return frame.fonts?.[c.value]?.familyName ?? 'Original font';
  if (c?.kind === 'std') return STD_LABELS[c.value as FamilyClass] ?? 'Helvetica';
  if (c?.kind === 'lib') return fontLibrary.get(c.value)?.label ?? c.value;
  return choice;
}

export const STD_LABELS: Record<FamilyClass, string> = { sans: 'Helvetica', serif: 'Times', mono: 'Courier' };

/**
 * Whether the frame's text is (partly) in one of the page's own fonts. Those
 * frames are drawn into the rendered page, because the browser can't show an
 * embedded PDF font; text in app fonts and the standard fonts shows correctly
 * as HTML and stays out of it.
 */
export function usesPageFont(frame: Pick<TextFrame, 'font' | 'paragraphs'>): boolean {
  if (frame.font?.startsWith('pdf:')) return true;
  return frame.paragraphs.some((p) => p.spans.some((s) => s.font?.startsWith('pdf:')));
}

/**
 * Start loading a library font the user picked (every style it has), without
 * waiting. The inline editor shows text with CSS alone, so nothing else would
 * load the font before the edit is committed. Page fonts' stand-ins are left
 * alone: they load only when a character needs one (see `facePicker`).
 */
export function preloadChoice(choice: FontChoice) {
  const c = parseChoice(choice);
  if (c?.kind !== 'lib') return;
  for (const bold of [false, true]) for (const italic of [false, true]) {
    if (fontLibrary.hasVariant(c.value, bold, italic)) void fontLibrary.load(c.value, bold, italic);
  }
}

/**
 * The library faces the frames' text is drawn in: the fonts spans ask for,
 * and a page font's stand-in only when the page font lacks one of the span's
 * characters. Never starts a download.
 */
export function libFacesNeeded(frames: readonly TextFrame[]): [string, boolean, boolean][] {
  const wanted = new Map<string, [string, boolean, boolean]>();
  const add = (face: [string, boolean, boolean]) => wanted.set(face.join(':'), face);
  for (const frame of frames) {
    for (const p of frame.paragraphs) {
      for (const s of p.spans) {
        const c = parseChoice(s.font ?? frameFont(frame));
        if (c?.kind === 'lib') {
          if (fontLibrary.hasVariant(c.value, !!s.bold, !!s.italic)) add([c.value, !!s.bold, !!s.italic]);
          continue;
        }
        const standIn = standInFor(frame, s);
        if (!standIn) continue;
        const chain = faceChain(frame, s);
        if (Array.from(s.text).some((ch) => faceFor(chain, ch).kind !== 'pdf')) add(standIn);
      }
    }
  }
  return [...wanted.values()];
}

/**
 * Which of the faces the frames need have loaded, as a short string. It
 * changes only when a face these frames use arrives, not when unrelated
 * fonts load.
 */
export function libFacesState(frames: readonly TextFrame[]): string {
  return libFacesNeeded(frames)
    .map(([id, b, i]) => `${id}:${flags(b, i)}=${fontLibrary.peek(id, b, i) ? 1 : 0}`)
    .join(',');
}

/**
 * Load every library face the frames need, and wait for them, so the export
 * lays text out exactly as the screen does once fonts arrive.
 */
export async function loadFacesFor(frames: readonly TextFrame[]): Promise<void> {
  await Promise.all(libFacesNeeded(frames).map(([id, b, i]) => fontLibrary.load(id, b, i)));
}
