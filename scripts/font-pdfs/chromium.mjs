// Chromium's "print to PDF" (Skia): TrueType → CIDFontType2, CFF .otf → CIDFontType0C,
// both Identity-H with ToUnicode, and shaped text (ligatures, Devanagari).
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const out = process.argv[2];
const face = (family, file, weight = 400) =>
  `@font-face{font-family:'${family}';src:url('file://${file}');font-weight:${weight}}`;
const html = `<!doctype html><meta charset="utf-8"><style>
${face('T-Serif', '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf')}
${face('T-Serif', '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf', 700)}
${face('C-Sans', '/usr/share/fonts/opentype/urw-base35/NimbusSans-Regular.otf')}
${face('T-Dejavu', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf')}
${face('T-Noto', '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf')}
${face('T-Deva', '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf')}
${face('T-Arab', '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf')}
body{margin:40px;font-size:18px} p{margin:0 0 28px}
</style>
<p style="font-family:T-Serif">Alpha serif regular text here</p>
<p style="font-family:T-Serif;font-weight:700">Bravo serif bold text here</p>
<p style="font-family:C-Sans">Charlie sans text in compact font</p>
<p style="font-family:T-Dejavu">Delta office affinity waffle</p>
<p style="font-family:T-Noto">Echo café naïve 42 €</p>
<p style="font-family:T-Deva">नमस्ते दुनिया</p>
<p style="font-family:T-Arab" dir="rtl">مرحبا بالعالم</p>`;

const browser = await chromium.launch();
const page = await browser.newPage();
// Loaded from a file: a page set with setContent can't load file:// fonts.
const file = join(mkdtempSync(join(tmpdir(), 'font-pdfs-')), 'page.html');
writeFileSync(file, html);
await page.goto(`file://${file}`, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: out, width: '600px', height: '560px', printBackground: false });
await browser.close();
