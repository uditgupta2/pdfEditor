import { PdfEditorError } from './errors';

/** Anything the editor can open. */
export type PdfInput = File | Blob | ArrayBuffer | Uint8Array | string | URL;

export interface NormalizedPdf {
  bytes: Uint8Array;
  name: string;
  size: number;
}

export interface NormalizeOptions {
  /** Maximum size in bytes. `0` or `Infinity` disables the check. */
  maxFileSize?: number;
  /** Used when the input carries no name (ArrayBuffer, Blob). */
  fallbackName?: string;
  /** Passed to `fetch` for URL inputs. */
  fetchInit?: RequestInit;
}

export const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * The PDF spec allows junk before the header; Acrobat accepts it within the
 * first 1024 bytes, so we do the same rather than requiring offset 0.
 */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - PDF_MAGIC.length, 1024);
  outer: for (let i = 0; i <= limit; i++) {
    for (let j = 0; j < PDF_MAGIC.length; j++) {
      if (bytes[i + j] !== PDF_MAGIC[j]) continue outer;
    }
    return true;
  }
  return false;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function nameFromUrl(url: string): string | null {
  try {
    const last = new URL(url, 'http://x').pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

function checkSize(size: number, max: number) {
  if (max > 0 && Number.isFinite(max) && size > max) {
    throw new PdfEditorError(
      'TOO_LARGE',
      `File is ${formatBytes(size)}; the limit is ${formatBytes(max)}.`,
    );
  }
}

/**
 * Turn any supported input into bytes plus metadata, validating size and the
 * PDF header. Nothing is uploaded anywhere: File/Blob inputs are read locally.
 */
export async function normalizePdfInput(
  input: PdfInput,
  options: NormalizeOptions = {},
): Promise<NormalizedPdf> {
  const max = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  let bytes: Uint8Array;
  let name = options.fallbackName ?? 'document.pdf';

  if (typeof input === 'string' || input instanceof URL) {
    const url = input.toString();
    let res: Response;
    try {
      res = await fetch(url, options.fetchInit);
    } catch (e) {
      throw new PdfEditorError('FETCH_FAILED', `Could not fetch ${url}.`, e);
    }
    if (!res.ok) {
      throw new PdfEditorError('FETCH_FAILED', `Fetching ${url} failed with HTTP ${res.status}.`);
    }
    const declared = Number(res.headers.get('content-length'));
    if (declared) checkSize(declared, max);
    bytes = new Uint8Array(await res.arrayBuffer());
    name = nameFromUrl(url) ?? name;
  } else if (typeof Blob !== 'undefined' && input instanceof Blob) {
    // Check the size before reading so a huge file is rejected instantly.
    checkSize(input.size, max);
    if (typeof File !== 'undefined' && input instanceof File && input.name) name = input.name;
    bytes = new Uint8Array(await input.arrayBuffer());
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    throw new PdfEditorError('UNSUPPORTED_INPUT', 'Unsupported input type for a PDF.');
  }

  checkSize(bytes.byteLength, max);
  if (!hasPdfHeader(bytes)) {
    throw new PdfEditorError('INVALID_PDF', `"${name}" is not a PDF file.`);
  }
  return { bytes, name, size: bytes.byteLength };
}

/** Quick pre-check for picker/drop handlers, before reading any bytes. */
export function looksLikePdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name) || file.type === '';
}
