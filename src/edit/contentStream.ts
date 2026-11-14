/**
 * A tolerant tokenizer/parser for PDF content streams (ISO 32000-1 §7.8).
 * It keeps byte offsets for every operator so edits can rewrite individual
 * operators while leaving the rest of the stream byte-for-byte untouched.
 *
 * The stream is handled as a "binary string" (one char per byte, latin1).
 */

export type Operand =
  | { type: 'num'; value: number; raw: string }
  | { type: 'name'; value: string; raw: string }
  | { type: 'str'; bytes: number[]; raw: string }
  | { type: 'arr'; items: Operand[]; raw: string }
  | { type: 'dict'; raw: string }
  | { type: 'kw'; value: string; raw: string };

export interface Operation {
  op: string;
  operands: Operand[];
  /** Offset of the first operand (or the operator when there are none). */
  start: number;
  /** Offset just past the operator. */
  end: number;
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

export function bytesToBinary(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return s;
}

export function binaryToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

class Lexer {
  pos = 0;
  constructor(readonly s: string) {}

  private code(i = this.pos) {
    return this.s.charCodeAt(i);
  }

  skipWs() {
    const s = this.s;
    while (this.pos < s.length) {
      const c = this.code();
      if (WS.has(c)) this.pos++;
      else if (c === 0x25) {
        // comment to end of line
        while (this.pos < s.length && this.code() !== 0x0a && this.code() !== 0x0d) this.pos++;
      } else break;
    }
  }

  /** Returns the next token, or null at EOF. `kind` 'op' for bare keywords. */
  next(): Operand | { type: 'op'; value: string; start: number } | { type: 'arrEnd' } | { type: 'dictEnd' } | null {
    this.skipWs();
    const s = this.s;
    if (this.pos >= s.length) return null;
    const start = this.pos;
    const c = this.code();

    if (c === 0x28) return this.literalString(start);
    if (c === 0x3c) {
      if (this.code(start + 1) === 0x3c) return this.dict(start);
      return this.hexString(start);
    }
    if (c === 0x3e && this.code(start + 1) === 0x3e) {
      this.pos += 2;
      return { type: 'dictEnd' };
    }
    if (c === 0x5b) {
      this.pos++;
      const items: Operand[] = [];
      for (;;) {
        const t = this.next();
        if (!t || t.type === 'arrEnd') break;
        if (t.type === 'op' || t.type === 'dictEnd') {
          // Keywords inside arrays (true/false/null) are kept as kw.
          if (t.type === 'op') items.push({ type: 'kw', value: t.value, raw: t.value });
          continue;
        }
        items.push(t);
      }
      return { type: 'arr', items, raw: s.slice(start, this.pos) };
    }
    if (c === 0x5d) {
      this.pos++;
      return { type: 'arrEnd' };
    }
    if (c === 0x2f) {
      this.pos++;
      while (this.pos < s.length && !WS.has(this.code()) && !DELIM.has(this.code())) this.pos++;
      const raw = s.slice(start, this.pos);
      const value = raw.slice(1).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      return { type: 'name', value, raw };
    }
    // number or keyword
    while (this.pos < s.length && !WS.has(this.code()) && !DELIM.has(this.code())) this.pos++;
    if (this.pos === start) {
      // stray delimiter like ')' or '}' — skip it
      this.pos++;
      return this.next();
    }
    const word = s.slice(start, this.pos);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { type: 'num', value: parseFloat(word), raw: word };
    return { type: 'op', value: word, start };
  }

  private literalString(start: number): Operand {
    const s = this.s;
    this.pos++;
    let depth = 1;
    const bytes: number[] = [];
    while (this.pos < s.length) {
      const c = this.code();
      this.pos++;
      if (c === 0x5c) {
        const n = this.code();
        this.pos++;
        switch (n) {
          case 0x6e: bytes.push(0x0a); break; // \n
          case 0x72: bytes.push(0x0d); break; // \r
          case 0x74: bytes.push(0x09); break; // \t
          case 0x62: bytes.push(0x08); break; // \b
          case 0x66: bytes.push(0x0c); break; // \f
          case 0x0d: if (this.code() === 0x0a) this.pos++; break; // line continuation
          case 0x0a: break;
          default:
            if (n >= 0x30 && n <= 0x37) {
              let v = n - 0x30;
              for (let k = 0; k < 2; k++) {
                const d = this.code();
                if (d >= 0x30 && d <= 0x37) {
                  v = v * 8 + (d - 0x30);
                  this.pos++;
                } else break;
              }
              bytes.push(v & 0xff);
            } else bytes.push(n);
        }
      } else if (c === 0x28) {
        depth++;
        bytes.push(c);
      } else if (c === 0x29) {
        depth--;
        if (depth === 0) break;
        bytes.push(c);
      } else bytes.push(c);
    }
    return { type: 'str', bytes, raw: s.slice(start, this.pos) };
  }

  private hexString(start: number): Operand {
    const s = this.s;
    this.pos++;
    let hex = '';
    while (this.pos < s.length && this.code() !== 0x3e) {
      const ch = s[this.pos]!;
      if (/[0-9a-fA-F]/.test(ch)) hex += ch;
      this.pos++;
    }
    this.pos++; // '>'
    if (hex.length % 2) hex += '0';
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    return { type: 'str', bytes, raw: s.slice(start, this.pos) };
  }

  private dict(start: number): Operand {
    this.pos += 2;
    let depth = 1;
    while (this.pos < this.s.length && depth > 0) {
      const t = this.next();
      if (!t) break;
      if (t.type === 'dictEnd') depth--;
      else if (t.type === 'dict') {
        /* nested dicts are consumed by recursion */
      }
    }
    return { type: 'dict', raw: this.s.slice(start, this.pos) };
  }

  /** Skip inline image data after `ID` up to and including `EI`. */
  skipInlineImage() {
    const s = this.s;
    this.pos++; // single whitespace after ID
    for (;;) {
      const i = s.indexOf('EI', this.pos);
      if (i < 0) {
        this.pos = s.length;
        return;
      }
      const before = s.charCodeAt(i - 1);
      const after = s.charCodeAt(i + 2);
      if (WS.has(before) && (Number.isNaN(after) || WS.has(after) || DELIM.has(after))) {
        this.pos = i + 2;
        return;
      }
      this.pos = i + 2;
    }
  }
}

export function parseContentStream(s: string): Operation[] {
  const lx = new Lexer(s);
  const ops: Operation[] = [];
  let operands: Operand[] = [];
  let operandStart = -1;

  for (;;) {
    const before = lx.pos;
    const t = lx.next();
    if (!t) break;
    if (t.type === 'arrEnd' || t.type === 'dictEnd') continue;
    if (t.type === 'op') {
      const start = operandStart >= 0 ? operandStart : t.start;
      if (t.value === 'BI') {
        // inline image: dictionary pairs until ID, then binary data until EI
        for (;;) {
          const k = lx.next();
          if (!k) break;
          if (k.type === 'op' && k.value === 'ID') {
            lx.skipInlineImage();
            break;
          }
        }
        ops.push({ op: 'BI', operands: [], start, end: lx.pos });
      } else if (t.value === 'true' || t.value === 'false' || t.value === 'null') {
        if (operandStart < 0) operandStart = t.start;
        operands.push({ type: 'kw', value: t.value, raw: t.value });
        continue;
      } else {
        ops.push({ op: t.value, operands, start, end: lx.pos });
      }
      operands = [];
      operandStart = -1;
      continue;
    }
    if (operandStart < 0) {
      // position of the operand's first char (skip leading whitespace)
      let p = before;
      while (p < s.length && WS.has(s.charCodeAt(p))) p++;
      operandStart = p;
    }
    operands.push(t);
  }
  return ops;
}

/** Serialize bytes as a PDF hex string. */
export function hexOf(bytes: number[]): string {
  return '<' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('') + '>';
}

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}
