# TODO

## Font support

### Done

- [x] **Phase 0: edit with the original font.** Edited text is written with the page's own font resource ([src/edit/engine.ts](src/edit/engine.ts) `drawWithPageFont`), measured with its own widths ([src/edit/faces.ts](src/edit/faces.ts)). Subset fonts only offer the codes the page uses ([src/edit/extract.ts](src/edit/extract.ts) `writableFonts`); missing characters fall back per character (bold/italic sibling → stand-in → standard font)
- [x] Edited pages re-render with the frames drawn in, so the screen shows the real fonts after each edit ([src/edit/session.ts](src/edit/session.ts) `pageRenderKey`, `buildEditedPage`)
- [x] **Phase 1: stand-ins.** `standInFonts(baseUrl)` and `EditorFont.replaces`; known pairs (Calibri → Carlito, Cambria → Caladea, Arial/Helvetica → Arimo, Times New Roman → Tinos, Courier New → Cousine) ([src/edit/fontLibrary.ts](src/edit/fontLibrary.ts))
- [x] `@pdf-lib/fontkit`, loaded lazily; app fonts embedded as subsets with ligatures/kerning off so the PDF matches layout
- [x] **Phase 2: font picker** (`'fontFamily'` tool) and the `fonts` prop

### Left to do

- [ ] Show the embedded original font *while typing*: extract `FontFile2`, add a Unicode `cmap` from ToUnicode, load it with `FontFace` (TrueType only; CFF/Type 1 stay as they are)
- [ ] Write fonts with non-Identity CID encodings (needs code → CID mapping through the CMap)
- [x] Count glyphs used on *all* pages for a shared subset font: done for TrueType (read from the font program); CFF/Type 1 subsets still offer only the current page's glyphs
- [x] Check a real glyph exists in subset fonts: `FontFile2` is read by a small TrueType reader (`src/edit/trueType.ts`; fontkit is too large to load for analysis). The mapping is trusted only if it agrees with the glyphs the page draws
- [ ] Same check for CFF (`FontFile3`) and Type 1 (`FontFile`) programs
- [x] Respect `OS/2.fsType` of app fonts; refuse fonts that forbid embedding (and embed whole when subsetting is forbidden)
- [ ] Noto fallbacks for other scripts (removes the "characters substituted" notice)
- [ ] New text added on an empty spot uses Helvetica; consider the page's most used font instead
- [ ] Word spaces aren't written as characters (words are positioned one by one), which affects copy/paste in some viewers
- [x] Try in real browsers: picker with a selection (`execCommand('fontName')`) and Firefox are covered by Playwright tests (`e2e/`)
- [ ] Run the e2e tests in WebKit (Safari): needs `sudo npx playwright install-deps` on this machine
- [ ] Known risk: pdf-lib subsetting breaks some CFF-based `.otf` files; prefer TTF
