"""Georgian number plates for the detailed cars (520 x 110 mm, drawn at 1024 x 256).

    python3 tools/make_plates.py QQ-939-QC VV-186-RV

writes assets/textures/plates/<NUMBER>.png: white plate, black border, the Georgian flag with
"GE" on the left and the number in DIN condensed, the layout the car models' plate UVs expect.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1024, 256
FONTS = [
    '/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf',
    '/Library/Fonts/DIN Condensed Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf',
]
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'textures', 'plates')
INK = (17, 17, 17)
RED = (218, 30, 40)


def font(size):
    for f in FONTS:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    raise SystemExit('no condensed font found')


def fit(text, cap):
    """Font size whose capitals are `cap` pixels tall."""
    probe = font(200)
    top, bottom = probe.getbbox('H')[1], probe.getbbox('H')[3]
    return font(round(200 * cap / (bottom - top)))


def flag(d, x, y, w, h):
    """Five-cross flag: white field, St George's cross, a bolnur-katskhuri cross in each quarter."""
    d.rectangle([x, y, x + w, y + h], fill=(255, 255, 255), outline=(150, 150, 150), width=1)
    t = h * 0.2
    d.rectangle([x, y + h / 2 - t / 2, x + w, y + h / 2 + t / 2], fill=RED)
    d.rectangle([x + w / 2 - t / 2, y, x + w / 2 + t / 2, y + h], fill=RED)
    for cx in (x + w * 0.25, x + w * 0.75):
        for cy in (y + h * 0.25, y + h * 0.75):
            a, b = h * 0.13, h * 0.045
            d.rectangle([cx - a, cy - b, cx + a, cy + b], fill=RED)
            d.rectangle([cx - b, cy - a, cx + b, cy + a], fill=RED)


def plate(number):
    s = 4                                   # drawn 4x and scaled down: smooth edges
    img = Image.new('RGB', (W * s, H * s), (236, 236, 234))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([3 * s, 3 * s, (W - 4) * s, (H - 4) * s], radius=16 * s, outline=INK, width=7 * s)
    flag(d, 17 * s, 38 * s, 64 * s, 48 * s)
    ge = fit('GE', 40 * s)
    d.text((49 * s, 142 * s), 'GE', font=ge, fill=INK, anchor='mm')
    f = fit(number, 128 * s)
    # the characters of a real plate are spaced a little apart
    gaps = 6 * s
    widths = [d.textlength(c, font=f) for c in number]
    total = sum(widths) + gaps * (len(number) - 1)
    x = (560 * s) - total / 2
    for c, w in zip(number, widths):
        d.text((x, 131 * s), c, font=f, fill=INK, anchor="lm")
        x += w + gaps
    return img.resize((W, H), Image.LANCZOS)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for n in sys.argv[1:] or ['QQ-939-QC']:
        n = n.upper()
        path = os.path.join(OUT, f'{n}.png')
        plate(n).save(path, optimize=True)
        print(path)
