"""Turn a recorded run (tools/preview.mjs --dump) into an animated GIF.

    node tools/preview.mjs --speed 40 --dump frames.txt > /dev/null
    python tools/make_gif.py frames.txt docs/images/meerkat-run.gif [--scale 0.75] [--colors 64] [--delay 180] [--hold 3500] [--every 1]

--scale shrinks every frame (the file gets smaller), --colors is the palette size per frame, --delay is the time one frame shows in
milliseconds, --hold is how long the last frame stays. --every keeps one frame in N (the first and the last are always kept). Defaults: full size, 128 colours, 180 ms, 3500 ms.

Each recorded frame is drawn with tools/screenshot.py (so it looks exactly like the terminal) and the frames are joined into a GIF
that loops, holding the last frame for a few seconds. Needs Python 3 and Pillow."""
import os
import subprocess
import sys
import tempfile
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
opts = {'--scale': 1.0, '--colors': 128, '--delay': 180, '--hold': 3500, '--every': 1}
rest = sys.argv[3:]
for k in opts:
    if k in rest:
        opts[k] = float(rest[rest.index(k) + 1]) if k == '--scale' else int(rest[rest.index(k) + 1])
here = os.path.dirname(os.path.abspath(__file__))
frames = [f.strip('\n') for f in open(src, encoding='utf-8').read().split('\n\f\n') if f.strip()]
frames = [f for i, f in enumerate(frames) if i % opts['--every'] == 0 or i == len(frames) - 1]
if not frames:
    sys.exit('no frames in ' + src)
images = []
with tempfile.TemporaryDirectory() as tmp:
    for i, text in enumerate(frames):
        a, p = os.path.join(tmp, f'{i}.ansi'), os.path.join(tmp, f'{i}.png')
        open(a, 'w', encoding='utf-8').write(text)
        subprocess.run([sys.executable, os.path.join(here, 'screenshot.py'), a, p], check=True)
        im = Image.open(p).convert('RGB')
        if opts['--scale'] != 1.0:
            im = im.resize((int(im.width * opts['--scale']), int(im.height * opts['--scale'])), Image.Resampling.LANCZOS)
        images.append(im)
    w = max(im.width for im in images)
    h = max(im.height for im in images)
    padded = []
    for im in images:
        canvas = Image.new('RGB', (w, h), im.getpixel((0, 0)))
        canvas.paste(im, (0, 0))
        padded.append(canvas.quantize(colors=opts['--colors'], method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    durations = [opts['--delay']] * len(padded)
    durations[-1] = opts['--hold']
    padded[0].save(out, save_all=True, append_images=padded[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(f'{out}: {len(padded)} frames, {os.path.getsize(out) // 1024} KB')
