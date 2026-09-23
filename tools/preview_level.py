#!/usr/bin/env python3
"""Draw data/level.json over the satellite crop for a visual check (dev tool)."""
import json, math, sys
from pathlib import Path
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parent.parent
L = json.load(open(ROOT / 'data' / 'level.json'))
sat_path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
S = 4.0            # px per metre
X0, Y0, X1, Y1 = -170, -160, 170, 170
W, H = int((X1 - X0) * S), int((Y1 - Y0) * S)
if sat_path and sat_path.exists():
    import numpy as np
    z, tx0, ty0, _, _ = map(int, open(sat_path.with_name('sat_z19_georef.txt')).read().split())
    sat = Image.open(sat_path).convert('RGB')
    n = 2 ** z
    lat0, lon0 = L['meta']['origin']
    def m2sat(mx, my):
        lat = lat0 + my / 111069.3; lon = lon0 + mx / 83107.4
        xt = (lon + 180) / 360 * n
        yt = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
        return (xt - tx0) * 256, (yt - ty0) * 256
    a = m2sat(X0, Y1); b = m2sat(X1, Y0)
    img = sat.crop((int(a[0]), int(a[1]), int(b[0]), int(b[1]))).resize((W, H)).convert('RGBA')
    base = Image.new('RGBA', (W, H), (0, 0, 0, 0))
else:
    img = Image.new('RGBA', (W, H), (40, 40, 40, 255))
    base = None
ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(ov)
def P(x, y): return ((x - X0) * S, (Y1 - y) * S)
def poly(p, fill, outline=None, width=1):
    d.polygon([P(*q) for q in p['outer']], fill=fill, outline=outline)
    for h in p['holes']:
        d.polygon([P(*q) for q in h], fill=(0, 0, 0, 0))
A = 110
cols = {'road': (70, 70, 80, A), 'parking': (120, 120, 140, A), 'pavers': (230, 200, 150, A),
        'lawn': (60, 200, 60, A), 'deck': (250, 250, 230, A + 40)}
for k, zs in L['zones'].items():
    for p in zs:
        poly(p, cols[k])
for p in L['pools']:
    poly(p, (40, 160, 255, 200))
for r in L['ramps']:
    poly(r['poly'], (255, 60, 60, 160))
for b in L['buildings']:
    c = {'mid': (200, 60, 200, 150), 'north': (60, 60, 220, 150), 'tower': (220, 120, 0, 170),
         'podium': (160, 90, 40, 150), 'small': (90, 90, 90, 200), 'guard': (0, 0, 0, 220)}[b['group']]
    poly(b['poly'], c, (255, 255, 255, 255))
for f in L['fences']:
    d.line([P(*q) for q in f['line']], fill=(255, 140, 0, 255) if f['type'] == 'perimeter' else (255, 255, 0, 255), width=3)
for w in L['walls']:
    d.line([P(*q) for q in w], fill=(255, 0, 0, 255), width=2)
for t in L['trees']:
    x, y = P(t['x'], t['y']); r = 2.2 * t['s'] * S
    d.ellipse([x - r, y - r, x + r, y + r], outline=(0, 90, 0, 255), width=2)
for c in L['cars']:
    x, y = P(c['x'], c['y']); hx, hy = math.cos(c['h']) * 2.3 * S, -math.sin(c['h']) * 2.3 * S
    d.line([(x - hx, y - hy), (x + hx, y + hy)], fill=(255, 255, 255, 230), width=int(1.8 * S))
for l in L['lamps']:
    x, y = P(l['x'], l['y']); d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 255, 0, 255))
for b in L['benches']:
    x, y = P(b['x'], b['y']); d.rectangle([x - 3, y - 3, x + 3, y + 3], fill=(150, 75, 0, 255))
for f in L['playgrounds'] + L['sport']:
    x, y = P(f['x'], f['y']); w, h = f['w'] * S / 2, f['d'] * S / 2
    d.rectangle([x - w, y - h, x + w, y + h], outline=(255, 0, 255, 255), width=3)
for f in L['pergolas']:
    x, y = P(f['x'], f['y']); d.rectangle([x - 8, y - 8, x + 8, y + 8], outline=(0, 255, 255, 255), width=3)
for s in L['spawns']:
    x, y = P(s['x'], s['y']); col = {'door': (255, 0, 0), 'ramp': (255, 0, 255), 'gate': (0, 255, 255), 'breach': (255, 255, 255)}[s['kind']]
    d.ellipse([x - 6, y - 6, x + 6, y + 6], outline=col + (255,), width=3)
out = Image.alpha_composite(img, ov).convert('RGB')
dst = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'reference' / 'level_preview.jpg'
out.save(dst, quality=88)
print('saved', dst, out.size)
