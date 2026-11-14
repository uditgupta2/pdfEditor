import { Encodings } from '@pdf-lib/standard-fonts';
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFontEmbedder,
  decodePDFRawStream,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib';
import { bytesToBinary, parseContentStream, type Operand } from './contentStream';

export type FontFamilyClass = 'sans' | 'serif' | 'mono';

export interface FontStyle {
  family: FontFamilyClass;
  bold: boolean;
  italic: boolean;
}

/** What the text interpreter needs to know about a font resource. */
export interface FontInfo {
  baseName: string;
  style: FontStyle;
  /** Split a string operand's bytes into character codes. */
  codes(bytes: number[]): number[];
  /** Unicode text for a code, '' if unknown. */
  unicode(code: number): string;
  /** Advance width in glyph space (1/1000 em). */
  width(code: number): number;
  /** Single-byte code 32 gets word spacing (Tw) applied. */
  isSpace(code: number): boolean;
  /** False when we cannot reliably decode the text (e.g. Type3, no ToUnicode). */
  editable: boolean;
}

// ---------------------------------------------------------------------------
// Encodings

const glyphToUnicode = new Map<string, string>();
const winAnsi = new Map<number, string>();
for (const [cp, [code, name]] of Object.entries((Encodings.WinAnsi as unknown as { unicodeMappings: Record<string, [number, string]> }).unicodeMappings)) {
  const ch = String.fromCodePoint(Number(cp));
  glyphToUnicode.set(name, ch);
  winAnsi.set(code, ch);
}
// A few names that are common in Differences arrays but not in WinAnsi.
const EXTRA_GLYPHS: Record<string, string> = {
  fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', dotlessi: 'ı', minus: '−',
  quoteleft: '‘', quoteright: '’', quotedblleft: '“', quotedblright: '”', bullet: '•',
  endash: '–', emdash: '—', ellipsis: '…', nbspace: ' ', sfthyphen: '­',
};
for (const [k, v] of Object.entries(EXTRA_GLYPHS)) if (!glyphToUnicode.has(k)) glyphToUnicode.set(k, v);

function unicodeForGlyphName(name: string): string {
  const known = glyphToUnicode.get(name);
  if (known) return known;
  let m = /^uni([0-9A-Fa-f]{4,})$/.exec(name);
  if (m) {
    const hex = m[1]!;
    let out = '';
    for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return out;
  }
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) return String.fromCodePoint(parseInt(m[1]!, 16));
  const base = name.split('.')[0]!;
  if (base !== name) return unicodeForGlyphName(base);
  if (name.length === 1) return name;
  return '';
}

/** StandardEncoding ≈ ASCII except for the curly quotes. */
function standardEncoding(code: number): string {
  if (code === 0x27) return '’';
  if (code === 0x60) return '‘';
  if (code >= 0x20 && code < 0x7f) return String.fromCharCode(code);
  return winAnsi.get(code) ?? '';
}

// ---------------------------------------------------------------------------
// ToUnicode CMap

interface CMap {
  /** Code byte lengths from codespacerange, sorted by first byte. */
  ranges: { len: number; lo: number; hi: number }[];
  map: Map<number, string>;
}

function utf16beToString(bytes: number[]) {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
  return s;
}
const bytesToInt = (b: number[]) => b.reduce((v, x) => v * 256 + x, 0);

export function parseToUnicodeCMap(text: string): CMap {
  const ops = parseContentStream(text);
  const cmap: CMap = { ranges: [], map: new Map() };
  // The CMap syntax is PostScript; operands between begin*/end* are flat.
  let mode: string | null = null;
  let buf: Operand[] = [];
  for (const o of ops) {
    if (o.op === 'begincodespacerange' || o.op === 'beginbfchar' || o.op === 'beginbfrange') {
      mode = o.op;
      buf = [];
      continue;
    }
    if (mode && o.op.startsWith('end')) {
      buf.push(...o.operands);
      const strs = buf;
      if (mode === 'begincodespacerange') {
        for (let i = 0; i + 1 < strs.length; i += 2) {
          const a = strs[i]!;
          const b = strs[i + 1]!;
          if (a.type === 'str' && b.type === 'str') {
            cmap.ranges.push({ len: a.bytes.length, lo: bytesToInt(a.bytes), hi: bytesToInt(b.bytes) });
          }
        }
      } else if (mode === 'beginbfchar') {
        for (let i = 0; i + 1 < strs.length; i += 2) {
          const a = strs[i]!;
          const b = strs[i + 1]!;
          if (a.type === 'str' && b.type === 'str') cmap.map.set(bytesToInt(a.bytes), utf16beToString(b.bytes));
          else if (a.type === 'str' && b.type === 'name') cmap.map.set(bytesToInt(a.bytes), unicodeForGlyphName(b.value));
        }
      } else if (mode === 'beginbfrange') {
        for (let i = 0; i + 2 < strs.length; i += 3) {
          const a = strs[i]!;
          const b = strs[i + 1]!;
          const dst = strs[i + 2]!;
          if (a.type !== 'str' || b.type !== 'str') continue;
          const lo = bytesToInt(a.bytes);
          const hi = bytesToInt(b.bytes);
          if (hi - lo > 0xffff) continue;
          if (dst.type === 'str') {
            const base = dst.bytes.slice();
            for (let c = lo; c <= hi; c++) {
              cmap.map.set(c, utf16beToString(base));
              // increment last byte (spec: only the last byte varies)
              base[base.length - 1] = (base[base.length - 1]! + 1) & 0xff;
            }
          } else if (dst.type === 'arr') {
            dst.items.forEach((it, k) => {
              if (it.type === 'str') cmap.map.set(lo + k, utf16beToString(it.bytes));
            });
          }
        }
      }
      mode = null;
      buf = [];
      continue;
    }
    if (mode) buf.push(...o.operands, ...(o.op ? [] : []));
  }
  return cmap;
}

// ---------------------------------------------------------------------------
// Helpers to read pdf-lib objects

export function resolve(context: PDFContext, obj: PDFObject | undefined): PDFObject | undefined {
  return obj instanceof PDFRef ? context.lookup(obj) : obj;
}

export function streamText(context: PDFContext, obj: PDFObject | undefined): string | null {
  const s = resolve(context, obj);
  if (s instanceof PDFRawStream) return bytesToBinary(decodePDFRawStream(s).decode());
  if (s instanceof PDFStream) {
    try {
      return bytesToBinary((s as unknown as { getUnencodedContents(): Uint8Array }).getUnencodedContents());
    } catch {
      return null;
    }
  }
  return null;
}

function num(context: PDFContext, obj: PDFObject | undefined): number | undefined {
  const v = resolve(context, obj);
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

function nameOf(context: PDFContext, obj: PDFObject | undefined): string | undefined {
  const v = resolve(context, obj);
  return v instanceof PDFName ? v.decodeText() : undefined;
}

// ---------------------------------------------------------------------------
// Style classification

export function classifyFont(baseName: string, flags = 0): FontStyle {
  const name = baseName.replace(/^[A-Z]{6}\+/, '');
  const lower = name.toLowerCase();
  const bold = /bold|black|heavy|semibold|demi|extrabold|ultra/.test(lower) || (flags & (1 << 18)) !== 0;
  const italic = /italic|oblique|-it\b|kursiv/.test(lower) || (flags & (1 << 6)) !== 0;
  let family: FontFamilyClass = 'sans';
  if (/courier|mono|consol|menlo|code|typewriter|fixed/.test(lower) || (flags & 1) !== 0) family = 'mono';
  else if (
    /times|serif(?!.*sans)|georgia|garamond|cambria|book|minion|palatino|baskerville|caslon|didot|bodoni|roman|charter|merriweather|tinos|libertine/.test(
      lower,
    ) &&
    !/sans/.test(lower)
  )
    family = 'serif';
  else if ((flags & 2) !== 0 && !/sans|arial|helvet|calibri|verdana|tahoma|segoe|roboto|open/.test(lower)) family = 'serif';
  return { family, bold, italic };
}

// ---------------------------------------------------------------------------
// Standard 14 metrics (for fonts without /Widths)

const STD14: Record<string, string> = {
  Helvetica: 'Helvetica', Arial: 'Helvetica', 'Helvetica-Bold': 'Helvetica-Bold', 'Arial,Bold': 'Helvetica-Bold',
  'Helvetica-Oblique': 'Helvetica-Oblique', 'Helvetica-BoldOblique': 'Helvetica-BoldOblique',
  'Times-Roman': 'Times-Roman', TimesNewRoman: 'Times-Roman', 'Times-Bold': 'Times-Bold',
  'Times-Italic': 'Times-Italic', 'Times-BoldItalic': 'Times-BoldItalic',
  Courier: 'Courier', 'Courier-Bold': 'Courier-Bold', 'Courier-Oblique': 'Courier-Oblique',
  'Courier-BoldOblique': 'Courier-BoldOblique', Symbol: 'Symbol', ZapfDingbats: 'ZapfDingbats',
};

export function standardFontNameFor(style: FontStyle): string {
  const { family, bold, italic } = style;
  if (family === 'serif') return bold ? (italic ? 'Times-BoldItalic' : 'Times-Bold') : italic ? 'Times-Italic' : 'Times-Roman';
  if (family === 'mono') return bold ? (italic ? 'Courier-BoldOblique' : 'Courier-Bold') : italic ? 'Courier-Oblique' : 'Courier';
  return bold ? (italic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : italic ? 'Helvetica-Oblique' : 'Helvetica';
}

const embedderCache = new Map<string, StandardFontEmbedder>();
export function standardEmbedder(name: string): StandardFontEmbedder {
  let e = embedderCache.get(name);
  if (!e) {
    e = StandardFontEmbedder.for(name as never);
    embedderCache.set(name, e);
  }
  return e;
}

// ---------------------------------------------------------------------------
// Font loading

export function loadFontInfo(context: PDFContext, fontObj: PDFObject | undefined): FontInfo {
  const dict = resolve(context, fontObj);
  if (!(dict instanceof PDFDict)) return unknownFont('Unknown');
  const subtype = nameOf(context, dict.get(PDFName.of('Subtype'))) ?? '';
  const baseName = nameOf(context, dict.get(PDFName.of('BaseFont'))) ?? subtype;

  let descriptor: PDFDict | undefined;
  let descendant: PDFDict | undefined;
  if (subtype === 'Type0') {
    const arr = resolve(context, dict.get(PDFName.of('DescendantFonts')));
    const d = arr instanceof PDFArray ? resolve(context, arr.get(0)) : undefined;
    if (d instanceof PDFDict) descendant = d;
  }
  const fdObj = resolve(context, (descendant ?? dict).get(PDFName.of('FontDescriptor')));
  if (fdObj instanceof PDFDict) descriptor = fdObj;
  const flags = descriptor ? num(context, descriptor.get(PDFName.of('Flags'))) ?? 0 : 0;
  const style = classifyFont(baseName, flags);

  const toUnicodeText = streamText(context, dict.get(PDFName.of('ToUnicode')));
  const cmap = toUnicodeText ? parseToUnicodeCMap(toUnicodeText) : null;

  if (subtype === 'Type3') return { ...unknownFont(baseName), style };

  if (subtype === 'Type0') {
    const encoding = nameOf(context, dict.get(PDFName.of('Encoding')));
    const identity = encoding === 'Identity-H' || encoding === 'Identity-V';
    const widths = new Map<number, number>();
    let dw = 1000;
    if (descendant) {
      dw = num(context, descendant.get(PDFName.of('DW'))) ?? 1000;
      const w = resolve(context, descendant.get(PDFName.of('W')));
      if (w instanceof PDFArray) {
        const items = w.asArray().map((x) => resolve(context, x));
        for (let i = 0; i < items.length; ) {
          const first = items[i];
          const second = items[i + 1];
          if (!(first instanceof PDFNumber)) break;
          if (second instanceof PDFArray) {
            second.asArray().forEach((v, k) => {
              const n = num(context, v);
              if (n != null) widths.set(first.asNumber() + k, n);
            });
            i += 2;
          } else {
            const last = num(context, second);
            const wv = num(context, items[i + 2]);
            if (last != null && wv != null) for (let c = first.asNumber(); c <= last; c++) widths.set(c, wv);
            i += 3;
          }
        }
      }
    }
    const codeLen = cmap?.ranges.length ? cmap.ranges[0]!.len : 2;
    return {
      baseName,
      style,
      codes: (bytes) => splitCodes(bytes, cmap, codeLen),
      unicode: (c) => cmap?.map.get(c) ?? '',
      width: (c) => widths.get(c) ?? dw,
      isSpace: () => false,
      // Without ToUnicode a CID font's text can't be decoded.
      editable: !!cmap && cmap.map.size > 0 && (identity || !!cmap),
    };
  }

  // Simple fonts: Type1, TrueType, MMType1
  const firstChar = num(context, dict.get(PDFName.of('FirstChar'))) ?? 0;
  const widthsArr = resolve(context, dict.get(PDFName.of('Widths')));
  const widths: number[] = widthsArr instanceof PDFArray ? widthsArr.asArray().map((x) => num(context, x) ?? 0) : [];
  const missingWidth = descriptor ? num(context, descriptor.get(PDFName.of('MissingWidth'))) ?? 0 : 0;
  const std = STD14[baseName.replace(/^[A-Z]{6}\+/, '')];
  const stdEmbedder = !widths.length && std && std !== 'Symbol' && std !== 'ZapfDingbats' ? standardEmbedder(std) : null;

  // Encoding: base encoding + Differences
  const diffs = new Map<number, string>();
  let base: (c: number) => string = standardEncoding;
  const enc = resolve(context, dict.get(PDFName.of('Encoding')));
  const applyBase = (n: string | undefined) => {
    if (n === 'WinAnsiEncoding') base = (c) => winAnsi.get(c) ?? (c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '');
    else if (n === 'MacRomanEncoding' || n === 'StandardEncoding') base = standardEncoding;
  };
  if (enc instanceof PDFName) applyBase(enc.decodeText());
  else if (enc instanceof PDFDict) {
    applyBase(nameOf(context, enc.get(PDFName.of('BaseEncoding'))));
    const d = resolve(context, enc.get(PDFName.of('Differences')));
    if (d instanceof PDFArray) {
      let code = 0;
      for (const item of d.asArray()) {
        const v = resolve(context, item);
        if (v instanceof PDFNumber) code = v.asNumber();
        else if (v instanceof PDFName) diffs.set(code++, unicodeForGlyphName(v.decodeText()));
      }
    }
  }
  const symbolic = /symbol|dingbat|wingding|webding/i.test(baseName);

  return {
    baseName,
    style,
    codes: (bytes) => bytes,
    unicode: (c) => cmap?.map.get(c) ?? diffs.get(c) ?? base(c),
    width: (c) => {
      const w = widths[c - firstChar];
      if (w != null) return w;
      if (stdEmbedder) {
        const ch = (cmap?.map.get(c) ?? base(c)) || ' ';
        try {
          return stdEmbedder.widthOfTextAtSize(ch, 1000);
        } catch {
          return 500;
        }
      }
      return missingWidth || 500;
    },
    isSpace: (c) => c === 32,
    editable: !symbolic,
  };
}

function splitCodes(bytes: number[], cmap: CMap | null, defaultLen: number): number[] {
  const out: number[] = [];
  const ranges = cmap?.ranges ?? [];
  for (let i = 0; i < bytes.length; ) {
    let len = defaultLen;
    if (ranges.length > 1) {
      // variable-length codespaces: pick the first range the prefix fits
      for (const r of ranges) {
        const v = bytesToInt(bytes.slice(i, i + r.len));
        if (i + r.len <= bytes.length && v >= r.lo && v <= r.hi) {
          len = r.len;
          break;
        }
      }
    }
    out.push(bytesToInt(bytes.slice(i, i + len)));
    i += len;
  }
  return out;
}

function unknownFont(baseName: string): FontInfo {
  return {
    baseName,
    style: classifyFont(baseName),
    codes: (b) => b,
    unicode: () => '',
    width: () => 500,
    isSpace: (c) => c === 32,
    editable: false,
  };
}
