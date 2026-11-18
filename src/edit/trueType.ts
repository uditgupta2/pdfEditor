/**
 * A minimal, read-only TrueType reader: just enough to tell which glyphs an
 * embedded font program (`FontFile2`) really contains. Subset fonts keep only
 * the glyphs the document uses; the rest are dropped (renumbered away) or left
 * as empty outlines. fontkit could answer this too, but it is a large download
 * and loads asynchronously, while page analysis is synchronous.
 */

/** `drawn`: the glyph has an outline. `blank`: it exists but draws nothing (fine for a space). `missing`: not in the font. */
export type GlyphState = 'drawn' | 'blank' | 'missing';

export interface TrueTypeProgram {
  numGlyphs: number;
  /** Lookup in the `cmap` subtable for (platform, encoding): code → glyph id (0 if unmapped). Null if the font has no such subtable. */
  cmap(platform: number, encoding: number): ((code: number) => number) | null;
  glyph(gid: number): GlyphState;
}

interface Table {
  offset: number;
  length: number;
}

/** Parse the font, or null if it isn't a TrueType-outline font we can read (CFF `OTTO`, collections, damaged files). */
export function readTrueType(bytes: Uint8Array): TrueTypeProgram | null {
  try {
    return parse(bytes);
  } catch {
    return null;
  }
}

function parse(bytes: Uint8Array): TrueTypeProgram | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = bytes.byteLength;
  if (size < 12) return null;
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x74727565 /* 'true' */) return null;

  const tables = new Map<string, Table>();
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > size) return null;
    const tag = String.fromCharCode(bytes[rec]!, bytes[rec + 1]!, bytes[rec + 2]!, bytes[rec + 3]!);
    const offset = view.getUint32(rec + 8);
    const length = view.getUint32(rec + 12);
    if (offset + length > size) continue; // ignore a table that runs past the end
    tables.set(tag, { offset, length });
  }
  const head = tables.get('head');
  const maxp = tables.get('maxp');
  const loca = tables.get('loca');
  const glyf = tables.get('glyf');
  if (!head || !maxp || !loca || !glyf || head.length < 54 || maxp.length < 6) return null;

  const numGlyphs = view.getUint16(maxp.offset + 4);
  const longLoca = view.getInt16(head.offset + 50) === 1;
  const entry = longLoca ? 4 : 2;
  if ((numGlyphs + 1) * entry > loca.length) return null;
  const locaAt = (i: number) => (longLoca ? view.getUint32(loca.offset + i * 4) : view.getUint16(loca.offset + i * 2) * 2);

  const glyph = (gid: number): GlyphState => {
    if (!Number.isInteger(gid) || gid <= 0 || gid >= numGlyphs) return 'missing';
    const start = locaAt(gid);
    const end = locaAt(gid + 1);
    if (end <= start) return 'blank';
    if (start + 2 > glyf.length) return 'missing';
    // numberOfContours: 0 means no outline; negative means a composite glyph.
    return view.getInt16(glyf.offset + start) === 0 ? 'blank' : 'drawn';
  };

  const cmapTable = tables.get('cmap');
  const subtables = new Map<string, ((code: number) => number) | null>();
  const cmap = (platform: number, encoding: number) => {
    const key = `${platform}/${encoding}`;
    if (!subtables.has(key)) subtables.set(key, cmapTable ? findSubtable(view, cmapTable, platform, encoding) : null);
    return subtables.get(key)!;
  };

  return { numGlyphs, cmap, glyph };
}

function findSubtable(view: DataView, table: Table, platform: number, encoding: number): ((code: number) => number) | null {
  const base = table.offset;
  const end = base + table.length;
  const count = view.getUint16(base + 2);
  for (let i = 0; i < count; i++) {
    const rec = base + 4 + i * 8;
    if (rec + 8 > end) return null;
    if (view.getUint16(rec) !== platform || view.getUint16(rec + 2) !== encoding) continue;
    const at = base + view.getUint32(rec + 4);
    if (at + 2 > end) return null;
    return subtableLookup(view, at, end);
  }
  return null;
}

/** Code → glyph id for cmap subtable formats 0, 4, 6 and 12 (the ones fonts in PDFs use). */
function subtableLookup(view: DataView, at: number, end: number): ((code: number) => number) | null {
  const u16 = (o: number) => (o + 2 <= end ? view.getUint16(o) : 0);
  const u32 = (o: number) => (o + 4 <= end ? view.getUint32(o) : 0);
  const format = u16(at);

  if (format === 0) return (code) => (code >= 0 && code < 256 ? view.getUint8(Math.min(at + 6 + code, end - 1)) : 0);

  if (format === 6) {
    const first = u16(at + 6);
    const n = u16(at + 8);
    return (code) => (code >= first && code < first + n ? u16(at + 10 + (code - first) * 2) : 0);
  }

  if (format === 4) {
    const segs = u16(at + 6) / 2;
    const ends = at + 14;
    const starts = ends + segs * 2 + 2;
    const deltas = starts + segs * 2;
    const ranges = deltas + segs * 2;
    return (code) => {
      if (code < 0 || code > 0xffff) return 0;
      for (let s = 0; s < segs; s++) {
        if (code > u16(ends + s * 2)) continue;
        const start = u16(starts + s * 2);
        if (code < start) return 0;
        const delta = view.getInt16(deltas + s * 2);
        const rangeOffset = u16(ranges + s * 2);
        if (!rangeOffset) return (code + delta) & 0xffff;
        const g = u16(ranges + s * 2 + rangeOffset + (code - start) * 2);
        return g ? (g + delta) & 0xffff : 0;
      }
      return 0;
    };
  }

  if (format === 12) {
    const groups = u32(at + 12);
    return (code) => {
      for (let g = 0; g < groups; g++) {
        const o = at + 16 + g * 12;
        const start = u32(o);
        if (code >= start && code <= u32(o + 4)) return u32(o + 8) + (code - start);
      }
      return 0;
    };
  }

  return null;
}
