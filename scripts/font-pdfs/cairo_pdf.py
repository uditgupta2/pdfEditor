"""Cairo (used by Inkscape, GTK apps, many Linux tools). Fonts are picked through
fontconfig, so the run script points FONTCONFIG_FILE at a single folder to choose
the format: TrueType → simple TrueType, CFF .otf → Type1C, Type 1 .t1 → Type 1
(FontFile), color emoji → Type3."""
import sys
import cairo

out, kind = sys.argv[1], sys.argv[2]
lines = {
    'truetype': [('Liberation Serif', False, 'Alpha serif regular text here'),
                 ('Liberation Serif', True, 'Bravo serif bold text here'),
                 ('Noto Sans', False, 'Echo café naïve 42 €')],
    'cff': [('Nimbus Sans', False, 'Charlie sans text in compact font'),
            ('Nimbus Sans', True, 'Bravo sans bold text here')],
    'type1': [('Nimbus Sans', False, 'Foxtrot sans text in type one'),
              ('C059', False, 'Golf serif text in type one')],
    'emoji': [('Liberation Serif', False, 'Hotel plain text line'),
              ('Noto Color Emoji', False, '😀🎉')],
}[kind]

surface = cairo.PDFSurface(out, 450, 80 + 40 * len(lines))
ctx = cairo.Context(surface)
for i, (family, bold, text) in enumerate(lines):
    ctx.select_font_face(family, cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL)
    ctx.set_font_size(16)
    ctx.move_to(40, 60 + 40 * i)
    ctx.show_text(text)
surface.finish()
