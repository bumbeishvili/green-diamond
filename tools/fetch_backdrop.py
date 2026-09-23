#!/usr/bin/env python3
"""
Fetch the far backdrop around Green Diamond:
  data/terrain.png      elevation grid (16-bit in R,G: v = (h + 100) * 10), local metres grid
  data/terrain.jpg      Sentinel-2 cloudless 2024 imagery for the same square
  data/skyline.json     high-rises within ~5 km (OSM building:levels >= 8) as oriented boxes

Sources:
  Elevation: AWS Terrain Tiles (terrarium), Mapzen/Linux Foundation, open data (SRTM etc.)
  Imagery:   Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH
             (Contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0
  Buildings: © OpenStreetMap contributors, ODbL 1.0
"""
import io
import json
import math
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LAT0, LON0 = 41.7958, 44.7798
M_LON, M_LAT = 83107.4, 111069.3
HALF = 18000.0      # the backdrop square is +-18 km
GRID = 257          # elevation samples per side (~140 m spacing)
UA = {'User-Agent': 'green-diamond-game/1.0 (personal project)'}


def get(url, tries=6):
    import time
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read()
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(1.5 * (k + 1))


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def mosaic(url_fmt, z, lat_min, lat_max, lon_min, lon_max, mode):
    x0, y1 = lonlat_to_tile(lon_min, lat_min, z)
    x1, y0 = lonlat_to_tile(lon_max, lat_max, z)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    jobs = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    with ThreadPoolExecutor(4) as ex:
        tiles = list(ex.map(lambda t: (t, Image.open(io.BytesIO(get(url_fmt.format(z=z, x=t[0], y=t[1])))).convert(mode)), jobs))
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    img = Image.new(mode, (W, H))
    for (tx, ty), im in tiles:
        img.paste(im, ((tx - tx0) * 256, (ty - ty0) * 256))
    return img, tx0, ty0


def local_to_lonlat(x, y):
    return LON0 + x / M_LON, LAT0 + y / M_LAT


def main():
    lon_min, lat_min = local_to_lonlat(-HALF, -HALF)
    lon_max, lat_max = local_to_lonlat(HALF, HALF)

    # ---- elevation ----
    z = 11
    img, tx0, ty0 = mosaic('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', z,
                           lat_min, lat_max, lon_min, lon_max, 'RGB')
    a = np.asarray(img).astype(np.float64)
    elev = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    out = np.zeros((GRID, GRID), dtype=np.float64)
    for j in range(GRID):
        y = HALF - j * (2 * HALF) / (GRID - 1)
        for i in range(GRID):
            x = -HALF + i * (2 * HALF) / (GRID - 1)
            lon, lat = local_to_lonlat(x, y)
            px, py = lonlat_to_tile(lon, lat, z)
            fx, fy = (px - tx0) * 256 - 0.5, (py - ty0) * 256 - 0.5
            ix, iy = int(math.floor(fx)), int(math.floor(fy))
            tx, ty = fx - ix, fy - iy
            e = (elev[iy, ix] * (1 - tx) + elev[iy, ix + 1] * tx) * (1 - ty) + \
                (elev[iy + 1, ix] * (1 - tx) + elev[iy + 1, ix + 1] * tx) * ty
            out[j, i] = e
    base = out[GRID // 2, GRID // 2]
    v = np.clip(np.round((out + 100) * 10), 0, 65535).astype(np.uint32)
    rgb = np.zeros((GRID, GRID, 3), dtype=np.uint8)
    rgb[..., 0] = v >> 8
    rgb[..., 1] = v & 255
    Image.fromarray(rgb, 'RGB').save(ROOT / 'data' / 'terrain.png')
    print('elevation: site', round(base, 1), 'm, min', round(out.min()), 'max', round(out.max()))

    # ---- imagery (Web Mercator tiles resampled onto the same local square) ----
    zi = 13
    img, tx0, ty0 = mosaic('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg', zi,
                           lat_min, lat_max, lon_min, lon_max, 'RGB')
    S = 2048
    src = np.asarray(img)
    ii, jj = np.meshgrid(np.arange(S), np.arange(S))
    xs = -HALF + (ii + 0.5) * (2 * HALF) / S
    ys = HALF - (jj + 0.5) * (2 * HALF) / S
    lons, lats = LON0 + xs / M_LON, LAT0 + ys / M_LAT
    n = 2 ** zi
    px = ((lons + 180.0) / 360.0 * n - tx0) * 256
    py = ((1.0 - np.arcsinh(np.tan(np.radians(lats))) / math.pi) / 2.0 * n - ty0) * 256
    px = np.clip(px.astype(int), 0, src.shape[1] - 1)
    py = np.clip(py.astype(int), 0, src.shape[0] - 1)
    tex = src[py, px]
    Image.fromarray(tex, 'RGB').save(ROOT / 'data' / 'terrain.jpg', quality=86)
    print('imagery', tex.shape)

    # ---- distant high-rises ----
    r = 5000
    q = f"""[out:json][timeout:120];
    way["building"]["building:levels"](around:{r},{LAT0},{LON0});
    out geom;"""
    data = json.loads(get('https://overpass-api.de/api/interpreter?data=' + urllib.parse.quote(q)))
    towers = []
    for e in data['elements']:
        try:
            lv = float(e['tags']['building:levels'])
        except (ValueError, KeyError):
            continue
        if lv < 8 or 'geometry' not in e:
            continue
        pts = np.array([[(p['lon'] - LON0) * M_LON, (p['lat'] - LAT0) * M_LAT] for p in e['geometry']])
        c = pts.mean(axis=0)
        if abs(c[0]) < 330 and abs(c[1]) < 330:
            continue  # the complex and its neighbours are modelled already
        # oriented box from the longest edge
        best, ang = 0, 0
        for a, b in zip(pts, pts[1:]):
            d = b - a
            L = math.hypot(*d)
            if L > best:
                best, ang = L, math.atan2(d[1], d[0])
        ca, sa = math.cos(-ang), math.sin(-ang)
        loc = (pts - c) @ np.array([[ca, sa], [-sa, ca]])
        w, dpt = np.ptp(loc[:, 0]), np.ptp(loc[:, 1])
        if w * dpt < 80:
            continue
        towers.append([round(c[0], 1), round(c[1], 1), round(w, 1), round(dpt, 1), round(ang, 3), int(lv)])
    (ROOT / 'data' / 'skyline.json').write_text(json.dumps({
        'attribution': '© OpenStreetMap contributors', 'towers': towers}))
    print('skyline towers', len(towers))


if __name__ == '__main__':
    main()
