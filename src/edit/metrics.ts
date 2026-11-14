import { Encodings, Font, FontNames } from '@pdf-lib/standard-fonts';
import type { FamilyClass } from './model';

/**
 * Text measurement with the Standard-14 font metrics (Helvetica, Times,
 * Courier). These are what export embeds, and they are metric-compatible
 * with the CSS fallbacks below (Arial/Liberation Sans, Times New Roman/
 * Liberation Serif, Courier New/Liberation Mono), so the screen and the
 * exported PDF break lines in the same places.
 */

export function standardFontName(family: FamilyClass, bold = false, italic = false): FontNames {
  if (family === 'serif')
    return bold ? (italic ? FontNames.TimesRomanBoldItalic : FontNames.TimesRomanBold) : italic ? FontNames.TimesRomanItalic : FontNames.TimesRoman;
  if (family === 'mono')
    return bold ? (italic ? FontNames.CourierBoldOblique : FontNames.CourierBold) : italic ? FontNames.CourierOblique : FontNames.Courier;
  return bold ? (italic ? FontNames.HelveticaBoldOblique : FontNames.HelveticaBold) : italic ? FontNames.HelveticaOblique : FontNames.Helvetica;
}

export const CSS_FAMILY: Record<FamilyClass, string> = {
  sans: "Helvetica, Arial, 'Liberation Sans', 'Nimbus Sans', 'Arimo', sans-serif",
  serif: "'Times New Roman', Times, 'Liberation Serif', 'Nimbus Roman', 'Tinos', serif",
  mono: "'Courier New', Courier, 'Liberation Mono', 'Nimbus Mono PS', 'Cousine', monospace",
};

/** Ascent/descent (em) of the CSS fonts, used to put CSS baselines exactly on PDF baselines. */
export const CSS_FONT_METRICS: Record<FamilyClass, { ascent: number; descent: number }> = {
  sans: { ascent: 0.905, descent: 0.212 },
  serif: { ascent: 0.891, descent: 0.216 },
  mono: { ascent: 0.833, descent: 0.3 },
};

const fonts = new Map<string, Font>();
function font(name: FontNames): Font {
  let f = fonts.get(name);
  if (!f) {
    f = Font.load(name);
    fonts.set(name, f);
  }
  return f;
}

/** Can this character be written with the standard (WinAnsi) fonts? */
export function isEncodable(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return Encodings.WinAnsi.canEncodeUnicodeCodePoint(cp);
}

/** Closest WinAnsi-encodable stand-in (strips accents), or '?'. */
export function toEncodable(text: string): string {
  let out = '';
  for (const ch of Array.from(text)) {
    if (isEncodable(ch)) out += ch;
    else {
      const stripped = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      out += Array.from(stripped).every(isEncodable) && stripped ? stripped : '?';
    }
  }
  return out;
}

/** Width of `text` in points at `size`. */
export function measure(text: string, family: FamilyClass, bold: boolean, italic: boolean, size: number): number {
  const f = font(standardFontName(family, bold, italic));
  let w = 0;
  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0)!;
    if (Encodings.WinAnsi.canEncodeUnicodeCodePoint(cp)) {
      const glyph = Encodings.WinAnsi.encodeUnicodeCodePoint(cp).name;
      w += f.getWidthOfGlyph(glyph) ?? 500;
    } else w += family === 'mono' ? 600 : 556;
  }
  return (w * size) / 1000;
}
