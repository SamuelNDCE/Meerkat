"""Turn a recorded run (preview.mjs --dump) into an animated GIF.

    node preview.mjs --speed 40 --dump frames.txt > /dev/null
    python tools/make_gif.py frames.txt docs/images/meerkat-run.gif

Each recorded frame is drawn with tools/screenshot.py (so it looks exactly like the terminal) and the frames are joined into a GIF
that loops, holding the last frame for a few seconds. Needs Python 3 and Pillow."""
import os
import subprocess
import sys
import tempfile
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
here = os.path.dirname(os.path.abspath(__file__))
frames = [f.strip('\n') for f in open(src, encoding='utf-8').read().split('\n\f\n') if f.strip()]
if not frames:
    sys.exit('no frames in ' + src)
images = []
with tempfile.TemporaryDirectory() as tmp:
    for i, text in enumerate(frames):
        a, p = os.path.join(tmp, f'{i}.ansi'), os.path.join(tmp, f'{i}.png')
        open(a, 'w', encoding='utf-8').write(text)
        subprocess.run([sys.executable, os.path.join(here, 'screenshot.py'), a, p], check=True)
        images.append(Image.open(p).convert('RGB'))
    w = max(im.width for im in images)
    h = max(im.height for im in images)
    padded = []
    for im in images:
        canvas = Image.new('RGB', (w, h), im.getpixel((0, 0)))
        canvas.paste(im, (0, 0))
        padded.append(canvas.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    durations = [180] * len(padded)
    durations[-1] = 3500
    padded[0].save(out, save_all=True, append_images=padded[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(f'{out}: {len(padded)} frames, {os.path.getsize(out) // 1024} KB')
