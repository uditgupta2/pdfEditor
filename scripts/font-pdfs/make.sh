#!/usr/bin/env bash
# Rebuilds tests/fixtures/pdfs/*.pdf: the same kind of text written by several
# real PDF producers, each embedding fonts its own way. The PDFs are committed,
# so the tests don't need these tools; run this only to change the fixtures.
# Needs: Playwright's Chromium, python3 with pycairo, groff, ghostscript, and the
# Liberation, DejaVu, Noto and URW base35 fonts (Debian/Ubuntu packages).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../../tests/fixtures/pdfs"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

node "$here/chromium.mjs" "$out/chromium.pdf"

cairo() { # kind, font folders...
  local kind=$1; shift
  { echo '<?xml version="1.0"?><fontconfig>'
    for d in "$@"; do echo "<dir>$d</dir>"; done
    echo "<cachedir>$tmp/fc-$kind</cachedir></fontconfig>"; } > "$tmp/$kind.conf"
  FONTCONFIG_FILE="$tmp/$kind.conf" python3 "$here/cairo_pdf.py" "$out/cairo-$kind.pdf" "$kind"
}
cairo truetype /usr/share/fonts/truetype/liberation /usr/share/fonts/truetype/noto
cairo cff /usr/share/fonts/opentype/urw-base35
cairo type1 /usr/share/fonts/type1/urw-base35
cairo emoji /usr/share/fonts/truetype/liberation /usr/share/fonts/truetype/noto

groff -Tps "$here/groff.tr" > "$tmp/groff.ps"
ps2pdf "$tmp/groff.ps" "$out/ghostscript.pdf"

for f in "$out"/*.pdf; do echo "== $(basename "$f")"; pdffonts "$f"; done
