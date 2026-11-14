export type PdfEditorErrorCode =
  /** The input is not a PDF (missing `%PDF-` header). */
  | 'INVALID_PDF'
  /** The file is larger than `maxFileSize`. */
  | 'TOO_LARGE'
  /** The PDF is encrypted and no (correct) password was provided. */
  | 'PASSWORD_REQUIRED'
  /** The file looks like a PDF but pdf.js could not parse it. */
  | 'CORRUPT'
  /** The input type is not supported (e.g. a number or a non-PDF File). */
  | 'UNSUPPORTED_INPUT'
  /** A URL could not be fetched. */
  | 'FETCH_FAILED'
  /** Any other failure while loading. */
  | 'LOAD_FAILED';

export class PdfEditorError extends Error {
  readonly code: PdfEditorErrorCode;
  readonly cause?: unknown;

  constructor(code: PdfEditorErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'PdfEditorError';
    this.code = code;
    this.cause = cause;
  }
}

export function isPdfEditorError(value: unknown): value is PdfEditorError {
  return value instanceof PdfEditorError;
}
