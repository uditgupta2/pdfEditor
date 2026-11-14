import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { hasPdfHeader, normalizePdfInput } from '../src/core/load';
import { PdfEditorError } from '../src/core/errors';

const enc = (s: string) => new TextEncoder().encode(s);

async function realPdf() {
  const doc = await PDFDocument.create();
  doc.addPage();
  return doc.save();
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(PdfEditorError);
  await expect(p).rejects.toMatchObject({ code });
}

describe('hasPdfHeader', () => {
  it('accepts %PDF- at the start', () => expect(hasPdfHeader(enc('%PDF-1.7\n'))).toBe(true));
  it('accepts junk before the header (within 1 KB)', () =>
    expect(hasPdfHeader(enc('\x00\x00garbage%PDF-1.4'))).toBe(true));
  it('rejects a header after 1 KB', () => expect(hasPdfHeader(enc(' '.repeat(2000) + '%PDF-1.4'))).toBe(false));
  it('rejects non-PDFs', () => expect(hasPdfHeader(enc('PK\x03\x04 zip file'))).toBe(false));
  it('rejects tiny inputs', () => expect(hasPdfHeader(enc('%PD'))).toBe(false));
});

describe('normalizePdfInput', () => {
  it('reads a File from the user’s computer and keeps its name', async () => {
    const bytes = await realPdf();
    const file = new File([bytes as BlobPart], 'report.pdf', { type: 'application/pdf' });
    const out = await normalizePdfInput(file);
    expect(out.name).toBe('report.pdf');
    expect(out.size).toBe(bytes.byteLength);
    expect(hasPdfHeader(out.bytes)).toBe(true);
  });

  it('accepts ArrayBuffer and Uint8Array', async () => {
    const bytes = await realPdf();
    await expect(normalizePdfInput(bytes)).resolves.toMatchObject({ name: 'document.pdf' });
    await expect(normalizePdfInput(bytes.slice().buffer)).resolves.toMatchObject({ size: bytes.byteLength });
  });

  it('rejects a renamed non-PDF file with INVALID_PDF', async () => {
    const file = new File(['hello world'], 'fake.pdf', { type: 'application/pdf' });
    await expectCode(normalizePdfInput(file), 'INVALID_PDF');
  });

  it('rejects files over maxFileSize with TOO_LARGE before reading them', async () => {
    const file = new File([new Uint8Array(2048)], 'big.pdf');
    await expectCode(normalizePdfInput(file, { maxFileSize: 1024 }), 'TOO_LARGE');
  });

  it('maxFileSize 0 disables the limit', async () => {
    const bytes = await realPdf();
    await expect(normalizePdfInput(bytes, { maxFileSize: 0 })).resolves.toBeTruthy();
  });

  it('rejects unsupported inputs', async () => {
    await expectCode(normalizePdfInput(42 as never), 'UNSUPPORTED_INPUT');
  });
});
