"""Turn Meerkat's terminal output (with its colour codes) into a PNG, the way a true-colour terminal would draw it.
Used to make the pictures in docs/images. Needs Python 3 and Pillow.

    node preview.mjs --final --speed 4000 > board.ansi
    python tools/screenshot.py board.ansi docs/images/board-done.png

Half blocks are painted exactly (so the pixel-art meerkat is exact); other characters come from a monospace font. Set
MEERKAT_FONT to a .ttf file to choose the font, otherwise a common one is looked for."""
import os
import re, sys
from PIL import Image, ImageDraw, ImageFont

# Render ANSI text (the real output of Meerkat) to a PNG the way a truecolor terminal would draw it:
# half blocks are painted exactly, the other glyphs come from a monospace font.
src, out = sys.argv[1], sys.argv[2]
text = open(src, encoding='utf-8').read().replace('\r', '')
CW, CH = 9, 18
DEF_FG, DEF_BG = (216, 210, 200), (20, 17, 15)
BASIC = {30: (0, 0, 0), 31: (205, 49, 49), 32: (13, 188, 121), 33: (229, 229, 16), 34: (36, 114, 200), 35: (188, 63, 188), 36: (17, 168, 205), 37: (229, 229, 229),
         90: (120, 116, 108), 91: (241, 76, 76), 92: (35, 209, 139), 93: (245, 245, 67), 94: (59, 142, 234), 95: (214, 112, 214), 96: (41, 184, 219), 97: (255, 255, 255)}

def c256(n):
    if n < 16:
        return [(0, 0, 0), (205, 49, 49), (13, 188, 121), (229, 229, 16), (36, 114, 200), (188, 63, 188), (17, 168, 205), (229, 229, 229), (102, 102, 102), (241, 76, 76), (35, 209, 139), (245, 245, 67), (59, 142, 234), (214, 112, 214), (41, 184, 219), (255, 255, 255)][n]
    if n >= 232:
        v = 8 + (n - 232) * 10
        return (v, v, v)
    n -= 16
    lv = [0, 95, 135, 175, 215, 255]
    return (lv[n // 36], lv[(n // 6) % 6], lv[n % 6])

lines = text.split('\n')
cells = []  # per line: list of (char, fg, bg, bold)
sgr = re.compile(r'\x1b\[([0-9;]*)([A-Za-z])')
for line in lines:
    fg, bg, bold = DEF_FG, DEF_BG, False
    row, pos = [], 0
    for m in sgr.finditer(line):
        for ch in line[pos:m.start()]:
            row.append((ch, fg, bg, bold))
        pos = m.end()
        if m.group(2) != 'm':
            continue
        p = [int(x) if x else 0 for x in m.group(1).split(';')]
        i = 0
        while i < len(p):
            v = p[i]
            if v == 0: fg, bg, bold = DEF_FG, DEF_BG, False
            elif v == 1: bold = True
            elif v in BASIC: fg = BASIC[v]
            elif v == 38 and i + 1 < len(p) and p[i + 1] == 2: fg = tuple(p[i + 2:i + 5]); i += 4
            elif v == 48 and i + 1 < len(p) and p[i + 1] == 2: bg = tuple(p[i + 2:i + 5]); i += 4
            elif v == 38 and i + 1 < len(p) and p[i + 1] == 5: fg = c256(p[i + 2]); i += 2
            elif v == 48 and i + 1 < len(p) and p[i + 1] == 5: bg = c256(p[i + 2]); i += 2
            i += 1
    for ch in line[pos:]:
        row.append((ch, fg, bg, bold))
    cells.append(row)

W = max(len(r) for r in cells)
img = Image.new('RGB', (W * CW + 20, len(cells) * CH + 20), DEF_BG)
d = ImageDraw.Draw(img)
CANDIDATES = [os.environ.get('MEERKAT_FONT', ''), 'CascadiaMono.ttf', 'consola.ttf', 'DejaVuSansMono.ttf', 'Menlo.ttc', 'LiberationMono-Regular.ttf']
SYMBOLS = ['seguisym.ttf', 'DejaVuSans.ttf', 'Arial Unicode.ttf']
def load(name, size=15):
    for base in ('', os.path.join(os.environ.get('WINDIR', 'C:/Windows'), 'Fonts'), '/usr/share/fonts/truetype/dejavu', '/System/Library/Fonts', '/Library/Fonts'):
        try:
            return ImageFont.truetype(os.path.join(base, name) if base else name, size)
        except Exception:
            continue
    return None
main = next((f for f in (load(n) for n in CANDIDATES if n) if f), None)
sym = next((f for f in (load(n) for n in SYMBOLS) if f), None) or main
for y, row in enumerate(cells):
    for x, (ch, fg, bg, bold) in enumerate(row):
        X, Y = 10 + x * CW, 10 + y * CH
        d.rectangle([X, Y, X + CW - 1, Y + CH - 1], fill=bg)
        if ch == '▀':
            d.rectangle([X, Y, X + CW - 1, Y + CH // 2 - 1], fill=fg)
        elif ch == '▄':
            d.rectangle([X, Y + CH // 2, X + CW - 1, Y + CH - 1], fill=fg)
        elif ch == '█':
            d.rectangle([X, Y, X + CW - 1, Y + CH - 1], fill=fg)
        elif ch == '▌':
            d.rectangle([X, Y, X + CW // 2 - 1, Y + CH - 1], fill=fg)
        elif ch in '░▒▓':
            a = {'░': 0.25, '▒': 0.5, '▓': 0.75}[ch]
            d.rectangle([X, Y, X + CW - 1, Y + CH - 1], fill=tuple(int(bg[i] * (1 - a) + fg[i] * a) for i in range(3)))
        elif ch != ' ':
            f = sym if (ch in '✔✖▶·' or '⠀' <= ch <= '⣿') else main
            try:
                if f is None or f.getmask(ch).getbbox() is None:
                    f = sym
            except Exception:
                f = sym
            d.text((X, Y + 1), ch, font=f, fill=fg)
img.save(out)
print(out, img.size)
