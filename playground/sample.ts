import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

/** A small multi-page PDF with mixed page sizes for manual testing. */
export async function makeSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sizes: [number, number][] = [
    [612, 792], // Letter
    [595, 842], // A4
    [842, 595], // A4 landscape
    [612, 792],
    [612, 792],
  ];
  sizes.forEach(([w, h], i) => {
    const page = doc.addPage([w, h]);
    page.drawRectangle({ x: 0, y: h - 90, width: w, height: 90, color: rgb(0.18, 0.44, 0.93) });
    page.drawText(`Sample page ${i + 1}`, { x: 48, y: h - 58, size: 28, font: bold, color: rgb(1, 1, 1) });
    const lines = [
      `This page is ${w} x ${h} points.`,
      'Select this text to check the text layer lines up with the image.',
      'Pinch or Ctrl+scroll to zoom; the point under your fingers stays put.',
    ];
    lines.forEach((t, j) => page.drawText(t, { x: 48, y: h - 140 - j * 24, size: 14, font }));
    page.drawText('DRAFT', {
      x: w / 2 - 120,
      y: h / 2 - 40,
      size: 96,
      font: bold,
      color: rgb(0.9, 0.9, 0.92),
      rotate: degrees(30),
    });
  });
  return doc.save();
}
