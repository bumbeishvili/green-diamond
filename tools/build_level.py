#!/usr/bin/env python3
"""
Build data/level.json + data/heightmap.png for the Green Diamond zombie game.

Source geometry: OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0), dumped from
Overpass into tools/osm_raw.json. Missing details (floor counts of the northern blocks,
parking bays, lawns, playground spots) were filled in by hand from satellite imagery.

Coordinates: metres. x = east, y = north. Origin 41.7958 N, 44.7798 E.
In three.js the game maps (x, y) -> (x, height, -y).

Run:  python3 tools/build_level.py
"""
import json
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from shapely import affinity
from shapely.geometry import (LineString, MultiLineString, MultiPoint, MultiPolygon, Point,
                              Polygon, box)
from shapely.ops import polygonize, substring, unary_union

random.seed(20160501)  # construction start, May 2016
ROOT = Path(__file__).resolve().parent.parent
RAW = json.load(open(ROOT / 'tools' / 'osm_raw.json'))
ELEMENTS = RAW['elements']

LAT0, LON0 = 41.7958, 44.7798
M_LON, M_LAT = 83107.4, 111069.3


def xy(lat, lon):
    return ((lon - LON0) * M_LON, (lat - LAT0) * M_LAT)


WAYS = {e['id']: e for e in ELEMENTS if e['type'] == 'way'}
NODES = [e for e in ELEMENTS if e['type'] == 'node']


def coords(way_id):
    return [xy(p['lat'], p['lon']) for p in WAYS[way_id]['geometry'] if p]


def tags(e):
    return e.get('tags', {})


def polys(g):
    """Flatten any shapely geometry into a list of Polygons."""
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if hasattr(g, 'geoms'):
        out = []
        for gg in g.geoms:
            out += polys(gg)
        return out
    return []


def clean(g, min_area=1.0):
    return unary_union([p for p in polys(g.buffer(0)) if p.area >= min_area])


def opened(g, r):
    """Morphological opening: drop slivers thinner than 2r."""
    return clean(g.buffer(-r, join_style='mitre').buffer(r, join_style='mitre'))


def rnd(v, n=2):
    return round(float(v), n)


def ring_out(ring):
    pts = list(ring.coords)[:-1]
    return [[rnd(x), rnd(y)] for x, y in pts]


def poly_out(p):
    p = p.simplify(0.05)
    if not isinstance(p, Polygon) or p.area < 0.5:
        return None
    from shapely.geometry.polygon import orient
    p = orient(p, 1.0)  # CCW outer, CW holes
    return {'outer': ring_out(p.exterior), 'holes': [ring_out(h) for h in p.interiors]}


def zone_out(g):
    return [o for o in (poly_out(p) for p in polys(g)) if o]


# ----------------------------------------------------------------------------------------
# Play area: the perimeter fence of the gated complex
# ----------------------------------------------------------------------------------------
FENCE_PERIM_IDS = [1531742446, 1411127560, 1050516619]
perim_lines = [LineString(coords(i)) for i in FENCE_PERIM_IDS]
# West/south fence (NW corner -> SE gate), the east fence reversed (south -> north), then the
# north fence back to the NW corner.
ring = coords(1411127560) + list(reversed(coords(1050516619))) + coords(1531742446)
play = Polygon(ring).buffer(0)
if isinstance(play, MultiPolygon):
    play = max(play.geoms, key=lambda p: p.area)

# ----------------------------------------------------------------------------------------
# Buildings
# ----------------------------------------------------------------------------------------
FLOOR_H = 3.05
# Floor counts from the developer's block selector (greendiamond.ge/en/choose_block) and
# korter.ge: stage 3 (Bob Walsh 34) is A'+B' 9, CD1' 9, CD2' 9, E1' 11, E2' 11, F' 20,
# G' 11, H' 20. The stage-2 twins on the shop podium are 22 floors (floors 1-2 commercial).
LEVEL_OVERRIDES = {'34': 9, '34ა': 9, '34ბ': 9, '34გ': 11, '34დ': 20, '34ე': 11,
                   '34ვ': 20, '34ზ': 11, '30 F3': 22, '30 H3': 22}

buildings = []
for e in ELEMENTS:
    t = tags(e)
    if e['type'] != 'way' or 'geometry' not in e:
        continue
    if not ('building' in t or 'building:part' in t):
        continue
    if t.get('building') == 'construction':
        continue
    poly = Polygon(coords(e['id'])).buffer(0)
    if not play.buffer(3).contains(poly.centroid):
        continue
    addr = t.get('addr:housenumber', '')
    levels = t.get('building:levels')
    levels = LEVEL_OVERRIDES.get(addr) or (int(float(levels)) if levels else None)
    if 'building:part' in t:
        group = 'tower'
    elif t.get('building') == 'gatehouse':
        group, levels = 'guard', 1
    elif addr.startswith('32'):
        group = 'mid'
    elif addr.startswith('34'):
        group = 'north'
    elif addr.startswith('30'):
        group = 'podium'
    else:
        group = 'small'
        levels = levels or 1
    buildings.append({'id': e['id'], 'addr': addr, 'group': group, 'levels': levels,
                      'poly': poly})

# The tower parts stand on the podiums; the podium entries keep 2 floors.
bldg_union = unary_union([b['poly'] for b in buildings])
tall_union = unary_union([b['poly'] for b in buildings if (b['levels'] or 0) >= 5])

# ----------------------------------------------------------------------------------------
# Roads, ramps to underground parking, parking bays
# ----------------------------------------------------------------------------------------
RAMP_IDS = [1411127642, 1411127643, 1411127644, 1411127645, 1411127587, 1411127589,
            1531742436, 1531742437]
road_lines_in, ramps = [], []
for wid, w in WAYS.items():
    t = tags(w)
    if t.get('highway') != 'service' or 'geometry' not in w:
        continue
    line = LineString(coords(wid))
    if wid in RAMP_IDS:
        ramps.append(line)
        continue
    if line.intersection(play).length > 0.5 * line.length:
        road_lines_in.append(line)

road_center = unary_union(road_lines_in)
roads = clean(unary_union([l.buffer(3.0, join_style='round') for l in road_lines_in])
              .intersection(play.buffer(-0.3)))

ramp_out, ramp_polys = [], []
for line in ramps:
    a, b = Point(line.coords[0]), Point(line.coords[-1])
    # The end touching a road is the top; the dead end dives under the building/courtyard.
    top, bot = (a, b) if a.distance(road_center) < b.distance(road_center) else (b, a)
    L = LineString([top, bot])
    poly = L.buffer(3.1, cap_style='flat')
    ramp_polys.append(poly)
    ramp_out.append({'top': [rnd(top.x), rnd(top.y)], 'bottom': [rnd(bot.x), rnd(bot.y)],
                     'width': 6.2, 'depth': 3.4, 'poly': poly_out(poly)})
ramp_union = unary_union(ramp_polys)
roads = clean(roads.difference(ramp_union.buffer(0.05)))

# Courtyards (pedestrian gardens)
mid_court = Polygon(coords(1411127579)).buffer(0)
north_court = Polygon([(-104, 66), (-92, 111), (-55, 113), (-55, 105), (82, 106), (100, 104),
                       (100, 64), (87, 62), (37, 64), (-58, 63)]).buffer(0)
north_court = north_court.difference(tall_union.buffer(2.2))
courts = unary_union([mid_court, north_court])

apron = bldg_union.buffer(2.4, join_style='mitre')
blocked_for_parking = unary_union([apron, courts.buffer(0.5), ramp_union.buffer(1.2)])
bays = roads.buffer(5.2, join_style='mitre').difference(roads).intersection(play.buffer(-0.8))
parking = opened(bays.difference(blocked_for_parking), 1.6)
parking = clean(parking, 25)

# ----------------------------------------------------------------------------------------
# Pools, decks, footpaths, plazas, lawns, pavers
# ----------------------------------------------------------------------------------------
pools = []
for wid, w in WAYS.items():
    if tags(w).get('leisure') == 'swimming_pool':
        p = Polygon(coords(wid)).buffer(0)
        if play.contains(p.centroid):
            pools.append(p)
pool_union = unary_union(pools)
decks = clean(pool_union.buffer(3.2, join_style='round').difference(pool_union))

foot_lines = []
for wid, w in WAYS.items():
    t = tags(w)
    if t.get('highway') in ('footway', 'steps', 'path', 'pedestrian') and 'geometry' in w:
        line = LineString(coords(wid))
        if line.intersection(play).length > 0.3 * line.length:
            foot_lines.append(line)
paths = clean(unary_union([l.buffer(1.3, join_style='round') for l in foot_lines])
              .intersection(play))

# Everything not road/parking/building is either lawn or paving. Paving hugs the buildings,
# follows the footpaths, and fills slivers; the wide leftovers become lawns.
open_ground = play.difference(unary_union([roads, parking, bldg_union, ramp_union]))
garden_ground = open_ground.difference(unary_union([apron, paths, decks, pool_union,
                                                    ramp_union.buffer(1.0)]))
lawns = opened(garden_ground, 1.4)
lawns = clean(lawns.buffer(-0.35, join_style='mitre'), 12)  # leave a curb strip
pavers = clean(open_ground.difference(unary_union([lawns, decks, pool_union])), 0.5)

# ----------------------------------------------------------------------------------------
# Fences (with gate openings) and walls
# ----------------------------------------------------------------------------------------
entrances = [Point(xy(n['lat'], n['lon'])) for n in NODES
             if tags(n).get('barrier') == 'entrance']


gaps = []   # openings in fences: [x1, y1, x2, y2, kind]


def cut_openings(line, pts, width, kind=None):
    segs = [line]
    for p in pts:
        new = []
        for s in segs:
            if s.distance(p) < 1.0:
                d = s.project(p)
                a, b = max(0.0, d - width / 2), min(s.length, d + width / 2)
                if kind:
                    pa, pb = s.interpolate(a), s.interpolate(b)
                    gaps.append([rnd(pa.x), rnd(pa.y), rnd(pb.x), rnd(pb.y), kind])
                if a > 0.2:
                    new.append(substring(s, 0, a))
                if b < s.length - 0.2:
                    new.append(substring(s, b, s.length))
            else:
                new.append(s)
        segs = new
    return [s for s in segs if s.length > 0.3]


fences = []
court_fence = LineString(list(mid_court.exterior.coords))
for s in cut_openings(court_fence, entrances, 2.6):
    fences.append({'type': 'court', 'height': 1.4, 'line': [[rnd(x), rnd(y)] for x, y in s.coords]})

gate1, gate2 = Point(137.5, -77.0), Point(138.9, 33.0)
ped_gap = Point(139.0, 39.0)
BREACHES = [Point(-118, 62), Point(-96, -10), Point(-40, -80.2), Point(60, -134.8),
            Point(-60, 150.8), Point(60, 149.0)]
perim_openings = [(gate1, 6.4, 'gate'), (gate2, 6.4, 'gate'), (ped_gap, 3.4, 'gate')] + \
    [(bp, 3.2, 'breach') for bp in BREACHES]
for line in perim_lines:
    segs = [line]
    for p, w, kind in perim_openings:
        # snap breach points onto this fence line
        tmp = []
        for s in segs:
            if s.distance(p) < 1.0:
                tmp += cut_openings(s, [p], w, kind)
            elif kind == 'breach' and s.distance(p) < 3.0:
                q = s.interpolate(s.project(p))
                tmp += cut_openings(s, [q], w, kind)
            else:
                tmp.append(s)
        segs = tmp
    for s in segs:
        fences.append({'type': 'perimeter', 'height': 2.1,
                       'line': [[rnd(x), rnd(y)] for x, y in s.coords]})

walls = []
for wid, w in WAYS.items():
    t = tags(w)
    if t.get('barrier') == 'retaining_wall' and 'geometry' in w:
        line = LineString(coords(wid))
        # Ramp side walls are generated from the ramps themselves.
        if play.buffer(2).contains(line.centroid) and line.distance(ramp_union) > 2.5:
            walls.append([[rnd(x), rnd(y)] for x, y in line.coords])

# ----------------------------------------------------------------------------------------
# Props: trees, lamps, benches, parked cars, playgrounds, sports court
# ----------------------------------------------------------------------------------------
occupied = unary_union([bldg_union.buffer(1.0), roads, pool_union.buffer(0.6),
                        ramp_union.buffer(0.8)])


def poisson(region, spacing, keep_clear, tries=6000, jitter_seed=None):
    pts = []
    minx, miny, maxx, maxy = region.bounds
    for _ in range(tries):
        p = Point(random.uniform(minx, maxx), random.uniform(miny, maxy))
        if not region.contains(p) or keep_clear.contains(p):
            continue
        if all(p.distance(q) >= spacing for q in pts):
            pts.append(p)
    return pts


trees = []
clear_for_trees = unary_union([paths.buffer(0.9), decks, parking.buffer(0.6), occupied])
mid_trees = poisson(lawns.intersection(mid_court), 5.2, clear_for_trees)
north_trees = poisson(lawns.intersection(north_court), 8.5, clear_for_trees)
other_trees = poisson(lawns.difference(courts), 9.0, clear_for_trees)
for pts, kind, smin, smax in ((mid_trees, 'mature', 0.9, 1.25),
                              (north_trees, 'young', 0.55, 0.8),
                              (other_trees, 'street', 0.7, 1.05)):
    for p in pts:
        trees.append({'x': rnd(p.x), 'y': rnd(p.y), 'kind': kind,
                      's': rnd(random.uniform(smin, smax)), 'r': rnd(random.uniform(0, 6.283))})

# Parked cars: perpendicular stalls along both sides of every internal road.
cars, stalls = [], []
stall_w, stall_d = 2.55, 5.0
for line in road_lines_in:
    L = line.length
    for side in (-1, 1):
        d = 1.5
        while d < L - 1.5:
            p = line.interpolate(d)
            p2 = line.interpolate(min(L, d + 0.5))
            dx, dy = p2.x - p.x, p2.y - p.y
            n = math.hypot(dx, dy) or 1
            tx, ty = dx / n, dy / n
            nx, ny = -ty * side, tx * side
            c = Point(p.x + nx * (3.0 + stall_d / 2), p.y + ny * (3.0 + stall_d / 2))
            stall = affinity.rotate(box(-stall_w / 2, -stall_d / 2, stall_w / 2, stall_d / 2),
                                    math.degrees(math.atan2(ny, nx)) - 90, origin=(0, 0))
            stall = affinity.translate(stall, c.x, c.y)
            if parking.buffer(0.15).contains(stall):
                stalls.append({'x': rnd(c.x), 'y': rnd(c.y), 'h': rnd(math.atan2(ny, nx), 3)})
                if random.random() < 0.62:
                    heading = math.atan2(ny, nx) + (0 if random.random() < 0.8 else math.pi)
                    cars.append({'x': rnd(c.x), 'y': rnd(c.y), 'h': rnd(heading, 3),
                                 'v': random.randrange(1000)})
                d += stall_w
            else:
                d += 0.6
# de-duplicate stalls that two overlapping road lines produced
def dedup(items, dist):
    out = []
    for c in items:
        if all(math.hypot(c['x'] - o['x'], c['y'] - o['y']) > dist for o in out):
            out.append(c)
    return out


cars = dedup(cars, 2.3)
stalls = dedup(stalls, 2.3)

# Street lamps along roads (outer edge of parking or lawn) and along courtyard paths.
lamps = []


def place_along(lines, spacing, offset, region_ok, kind):
    for line in lines:
        d = spacing / 2
        while d < line.length:
            p = line.interpolate(d)
            q = line.interpolate(min(line.length, d + 0.5))
            dx, dy = q.x - p.x, q.y - p.y
            n = math.hypot(dx, dy) or 1
            for side in (1, -1):
                c = Point(p.x - dy / n * offset * side, p.y + dx / n * offset * side)
                if region_ok.contains(c) and all(c.distance(Point(l['x'], l['y'])) > spacing * 0.6
                                                 for l in lamps):
                    lamps.append({'x': rnd(c.x), 'y': rnd(c.y), 'kind': kind,
                                  'h': rnd(math.atan2(dy, dx) + (math.pi / 2) * side, 3)})
                    break
            d += spacing


lamp_ok = unary_union([pavers, lawns]).buffer(-0.4).difference(occupied.buffer(0.3))
place_along(road_lines_in, 24.0, 8.9, lamp_ok, 'street')
place_along([l for l in foot_lines if l.intersects(courts)], 15.0, 1.9, lamp_ok, 'garden')

benches = []
for line in foot_lines:
    if not line.intersects(courts) or line.length < 8:
        continue
    d = 6.0
    while d < line.length - 3:
        p = line.interpolate(d)
        q = line.interpolate(d + 0.5)
        dx, dy = q.x - p.x, q.y - p.y
        n = math.hypot(dx, dy) or 1
        c = Point(p.x - dy / n * 2.0, p.y + dx / n * 2.0)
        if lawns.buffer(0.3).contains(c) or pavers.contains(c):
            if all(c.distance(Point(b['x'], b['y'])) > 7 for b in benches) and \
                    all(c.distance(Point(t['x'], t['y'])) > 1.8 for t in trees):
                benches.append({'x': rnd(c.x), 'y': rnd(c.y), 'h': rnd(math.atan2(dy, dx) + math.pi, 3)})
        d += 17.0

# Hand-placed features, positioned from the satellite imagery.
playgrounds = [
    {'x': -22.0, 'y': -24.0, 'r': 0.30, 'w': 13.0, 'd': 10.0},   # middle courtyard, west half
    {'x': 62.0, 'y': -30.0, 'r': -0.27, 'w': 11.0, 'd': 9.0},    # middle courtyard, east half
    {'x': -45.0, 'y': 88.0, 'r': 0.0, 'w': 12.0, 'd': 10.0},     # north courtyard, west
    {'x': 46.0, 'y': 96.0, 'r': 0.0, 'w': 12.0, 'd': 10.0},      # north courtyard, east
]
courts_sport = [
    {'x': 80.0, 'y': 94.0, 'r': 0.0, 'w': 14.0, 'd': 14.0, 'kind': 'basketball_half'},
    # the "small stadium": round red-rubber court with a tall green mesh fence and one glass-backboard
    # hoop, west end of the middle courtyard (the dark red circle in the imagery, and the gallery photos)
    {'x': -41.0, 'y': -15.5, 'r': 0.0, 'w': 15.0, 'd': 15.0, 'kind': 'court_round'},
]
pergolas = [
    {'x': 80.0, 'y': -24.0, 'r': -0.25, 'kind': 'gazebo'},
    {'x': -26.0, 'y': 104.0, 'r': 0.0, 'kind': 'pergola'}, {'x': 24.0, 'y': 104.0, 'r': 0.0, 'kind': 'gazebo'},
]

# Remove trees and benches that collide with hand-placed features.
features = unary_union([Point(f['x'], f['y']).buffer(f['w'] / 2 + 1.2 if f.get('kind') == 'court_round' else max(f['w'], f['d']) * 0.62)
                        for f in playgrounds + courts_sport] +
                       [Point(f['x'], f['y']).buffer(4.5) for f in pergolas])
trees = [t for t in trees if not features.contains(Point(t['x'], t['y']))]
benches = [b for b in benches if not features.contains(Point(b['x'], b['y']))]
lamps = [l for l in lamps if not features.buffer(-1).contains(Point(l['x'], l['y']))]

# ----------------------------------------------------------------------------------------
# Points of interest (shops on the podium) and zombie spawns
# ----------------------------------------------------------------------------------------
pois = []
for n in NODES:
    t = tags(n)
    kind = t.get('shop') or t.get('amenity') or t.get('leisure')
    if not kind or kind in ('swimming_pool',):
        continue
    p = Point(xy(n['lat'], n['lon']))
    if play.buffer(2).contains(p):
        pois.append({'kind': kind, 'name': t.get('name:en') or t.get('brand:en') or t.get('name', ''),
                     'name_ka': t.get('name:ka') or t.get('brand:ka') or t.get('name', ''),
                     'x': rnd(p.x), 'y': rnd(p.y)})


def lobby_door(poly, prefer):
    """Door on the facade edge whose outward normal best faces `prefer` (unit vector)."""
    from shapely.geometry.polygon import orient
    ring = list(orient(poly, 1.0).exterior.coords)
    best, best_score = None, -1e9
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        L = math.hypot(x2 - x1, y2 - y1)
        if L < 4:
            continue
        nx, ny = (y2 - y1) / L, -(x2 - x1) / L  # outward for CCW
        score = nx * prefer[0] + ny * prefer[1] + L * 0.01
        if score > best_score:
            best_score = score
            best = ((x1 + x2) / 2 + nx * 0.2, (y1 + y2) / 2 + ny * 0.2, math.atan2(ny, nx))
    return best


doors = []
for b in buildings:
    if b['group'] in ('mid', 'north', 'tower') and (b['levels'] or 0) >= 5:
        c = b['poly'].centroid
        # Lobbies open towards the nearest road...
        near = road_center.interpolate(road_center.project(c))
        v = (near.x - c.x, near.y - c.y)
        n = math.hypot(*v) or 1
        d = lobby_door(b['poly'], (v[0] / n, v[1] / n))
        if d:
            doors.append({'x': rnd(d[0]), 'y': rnd(d[1]), 'h': rnd(d[2], 3), 'building': b['id']})
        # ...and blocks on a courtyard also have a garden door on that side.
        for court in (mid_court, north_court):
            if b['poly'].distance(court) < 7:
                cc = court.centroid
                v = (cc.x - c.x, cc.y - c.y)
                n = math.hypot(*v) or 1
                d2 = lobby_door(b['poly'], (v[0] / n, v[1] / n))
                if d2 and (not d or math.hypot(d2[0] - d[0], d2[1] - d[1]) > 6):
                    doors.append({'x': rnd(d2[0]), 'y': rnd(d2[1]), 'h': rnd(d2[2], 3), 'building': b['id'], 'court': True})

spawns = []
# Zombies also climb over the courtyard railing, and come out of the pool house.
ring = mid_court.exterior
for k in range(int(ring.length // 13)):
    q = ring.interpolate(k * 13 + 6)
    inward = mid_court.centroid
    v = (inward.x - q.x, inward.y - q.y)
    n = math.hypot(*v) or 1
    c = Point(q.x + v[0] / n * 1.6, q.y + v[1] / n * 1.6)
    if mid_court.contains(c) and all(c.distance(Point(t['x'], t['y'])) > 1.2 for t in trees) and c.distance(pool_union) > 2.5:
        spawns.append({'kind': 'fence', 'x': rnd(c.x), 'y': rnd(c.y)})
for b in buildings:
    if b['group'] == 'small' and mid_court.buffer(3).contains(b['poly'].centroid):
        c = b['poly'].centroid
        d = lobby_door(b['poly'], (0, 1))
        if d:
            spawns.append({'kind': 'door', 'x': rnd(d[0] + math.cos(d[2]) * 1.2), 'y': rnd(d[1] + math.sin(d[2]) * 1.2)})
for d in doors:
    spawns.append({'kind': 'door', 'x': rnd(d['x'] + math.cos(d['h']) * 1.2),
                   'y': rnd(d['y'] + math.sin(d['h']) * 1.2)})
for r in ramp_out:
    bx, by = r['bottom']
    tx, ty = r['top']
    L = math.hypot(tx - bx, ty - by)
    spawns.append({'kind': 'ramp', 'x': rnd(bx + (tx - bx) / L * 2.5), 'y': rnd(by + (ty - by) / L * 2.5)})
for p, w, kind in perim_openings:
    if kind != 'gate':
        continue
    q = play.exterior.interpolate(play.exterior.project(p))
    spawns.append({'kind': 'gate', 'x': rnd(q.x + 6.0), 'y': rnd(q.y)})
for p in BREACHES:
    q = play.exterior.interpolate(play.exterior.project(p))
    c = play.centroid
    v = (c.x - q.x, c.y - q.y)
    n = math.hypot(*v)
    spawns.append({'kind': 'breach', 'x': rnd(q.x - v[0] / n * 4.0), 'y': rnd(q.y - v[1] / n * 4.0),
                   'fx': rnd(q.x), 'fy': rnd(q.y)})

# ----------------------------------------------------------------------------------------
# Surroundings (backdrop, not playable)
# ----------------------------------------------------------------------------------------
backdrop = []
for e in ELEMENTS:
    t = tags(e)
    if e['type'] != 'way' or 'geometry' not in e or 'building' not in t:
        continue
    poly = Polygon(coords(e['id'])).buffer(0)
    if play.buffer(3).contains(poly.centroid):
        continue
    lv = t.get('building:levels')
    h = float(t['height']) if t.get('height') else None
    kind = t.get('building')
    if kind == 'construction':
        levels = int(float(lv)) if lv else max(8, min(16, int(poly.area / 110)))
    else:
        levels = int(float(lv)) if lv else (1 if poly.area < 150 else 2 if poly.area < 700 else 4)
    backdrop.append({'kind': kind, 'name': t.get('name', ''), 'levels': levels, 'height': h,
                     'poly': poly_out(poly)})
backdrop = [b for b in backdrop if b['poly']]

street_lines = []
for wid, w in WAYS.items():
    t = tags(w)
    if t.get('highway') in ('tertiary', 'residential', 'service', 'track', 'unclassified') \
            and 'geometry' in w and wid not in RAMP_IDS:
        line = LineString(coords(wid))
        if line.intersection(play).length < 0.5 * line.length:
            width = {'tertiary': 10.5, 'residential': 7.0, 'service': 5.5}.get(t['highway'], 4.0)
            surface = 'gravel' if t.get('surface') == 'gravel' or t['highway'] == 'track' else 'asphalt'
            street_lines.append({'w': width, 'surface': surface, 'name': t.get('name:en', ''),
                                 'line': [[rnd(x), rnd(y)] for x, y in line.coords]})

# Olympic complex pitches / athletics track / pools / car parks across Bob Walsh Street
outside_features = []
for wid, w in WAYS.items():
    t = tags(w)
    kind = None
    if t.get('leisure') == 'pitch':
        kind = 'pitch_' + (t.get('sport') or 'soccer').split(';')[0]
    elif t.get('leisure') == 'track' or t.get('highway') == 'raceway':
        kind = 'track'
    elif t.get('leisure') == 'swimming_pool':
        kind = 'pool'
    elif t.get('amenity') == 'parking':
        kind = 'parking'
    elif t.get('leisure') in ('stadium', 'sports_centre'):
        kind = 'sports'
    if not kind or 'geometry' not in w:
        continue
    g = coords(wid)
    if len(g) < 4:
        continue
    p = Polygon(g).buffer(0)
    if p.is_empty or play.buffer(2).contains(p.centroid) or p.centroid.distance(Point(0, 0)) > 420:
        continue
    outside_features.append({'kind': kind, 'name': t.get('name', ''), 'polys': zone_out(p)})

# Forest to the west (OSM woods) + the tree line along the west fence.
forest = []
woods = [Polygon(coords(wid)).buffer(0) for wid, w in WAYS.items()
         if tags(w).get('natural') == 'wood' and 'geometry' in w]
wood_region = unary_union(woods + [LineString(coords(1411127560)[:2]).buffer(9).difference(play.buffer(2.5))])
wood_region = wood_region.intersection(box(-420, -420, 420, 420)).difference(play.buffer(2.0))
for pnt in poisson(wood_region, 5.5, Point(9999, 9999).buffer(1), tries=9000):
    forest.append({'x': rnd(pnt.x), 'y': rnd(pnt.y), 's': rnd(random.uniform(0.9, 1.5)), 'r': rnd(random.uniform(0, 6.28))})

outside_green = []
for wid, w in WAYS.items():
    t = tags(w)
    if (t.get('landuse') in ('grass', 'greenfield', 'construction') or t.get('natural') in ('wood', 'grassland')) \
            and 'geometry' in w:
        p = Polygon(coords(wid)).buffer(0)
        p = p.difference(play)
        if not p.is_empty:
            outside_green.append({'kind': t.get('landuse') or t.get('natural'), 'polys': zone_out(p)})

# ----------------------------------------------------------------------------------------
# Heightmap (0.25 m/px). 8-bit: value = round((h + 4) * 40)  ->  h in [-4.0, 2.375] m.
# ----------------------------------------------------------------------------------------
HM_RES = 0.25
HM_MIN = (-200.0, -200.0)
HM_SIZE = 1600
H_ROAD, H_PAVE, H_LAWN, H_DECK, H_COURT = 0.0, 0.14, 0.18, 0.14, 0.62


def hm_px(x, y):
    return ((x - HM_MIN[0]) / HM_RES, HM_SIZE - (y - HM_MIN[1]) / HM_RES)


hm = np.zeros((HM_SIZE, HM_SIZE), dtype=np.float32)


def fill(g, h):
    img = Image.new('L', (HM_SIZE, HM_SIZE), 0)
    dr = ImageDraw.Draw(img)
    for p in polys(g):
        dr.polygon([hm_px(x, y) for x, y in p.exterior.coords], fill=255)
        for hole in p.interiors:
            dr.polygon([hm_px(x, y) for x, y in hole.coords], fill=0)
    m = np.array(img) > 127
    hm[m] = h


fill(pavers, H_PAVE)
fill(lawns, H_LAWN)
fill(decks, H_DECK)
fill(mid_court.buffer(-0.2), H_COURT)
fill(mid_court.intersection(lawns), H_COURT + 0.04)
# Steps at the courtyard gates: short ramps outside each opening.
for p in entrances:
    if p.distance(mid_court.exterior) < 1.5:
        fill(p.buffer(1.8), (H_COURT + H_PAVE) / 2)
fill(roads, H_ROAD)
fill(parking, H_ROAD)
POOL_FLOOR = -1.3
pool_steps = []
for p in pools:
    fill(p, POOL_FLOOR)
    rim = H_COURT if mid_court.contains(p.centroid) else H_DECK
    # Steps down one end of each pool: the shortest decent edge, 1.8 m wide, 0.3 m risers.
    from shapely.geometry.polygon import orient
    ring = list(orient(p, 1.0).exterior.coords)
    edges = [(math.hypot(b[0] - a[0], b[1] - a[1]), a, b) for a, b in zip(ring, ring[1:])]
    edges = [e for e in edges if e[0] >= 3.0] or sorted(edges, key=lambda e: -e[0])[:1]
    L, a, b = min(edges, key=lambda e: e[0])
    tx, ty = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    nx, ny = -ty, tx                      # inward for a CCW ring
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    n_steps = max(2, math.ceil((rim - POOL_FLOOR) / 0.3))
    run, half = 0.42, 0.9
    for k in range(n_steps - 1):
        h = rim - 0.3 * (k + 1)
        if h <= POOL_FLOOR + 0.05:
            break
        d0, d1 = k * run, (k + 1) * run
        quad = Polygon([(mx + tx * -half + nx * d0, my + ty * -half + ny * d0), (mx + tx * half + nx * d0, my + ty * half + ny * d0),
                        (mx + tx * half + nx * d1, my + ty * half + ny * d1), (mx + tx * -half + nx * d1, my + ty * -half + ny * d1)])
        quad = quad.intersection(p)
        if quad.is_empty:
            continue
        fill(quad, h)
        pool_steps.append({'poly': poly_out(quad), 'h': rnd(h), 'floor': POOL_FLOOR})
# Ramps slope from 0 at the top to -depth at the bottom.
yy, xx = np.mgrid[0:HM_SIZE, 0:HM_SIZE]
wx = HM_MIN[0] + (xx + 0.5) * HM_RES
wy = HM_MIN[1] + (HM_SIZE - yy - 0.5) * HM_RES
for r in ramp_out:
    img = Image.new('L', (HM_SIZE, HM_SIZE), 0)
    dr = ImageDraw.Draw(img)
    poly = Polygon(r['poly']['outer'])
    dr.polygon([hm_px(x, y) for x, y in poly.exterior.coords], fill=255)
    m = np.array(img) > 127
    tx, ty = r['top']
    bx, by = r['bottom']
    L2 = (bx - tx) ** 2 + (by - ty) ** 2
    t = ((wx - tx) * (bx - tx) + (wy - ty) * (by - ty)) / L2
    hm[m] = -np.clip(t[m], 0, 1) * r['depth']
enc = np.clip(np.round((hm + 4.0) * 40.0), 0, 255).astype(np.uint8)
Image.fromarray(enc, 'L').save(ROOT / 'data' / 'heightmap.png', optimize=True)

# ----------------------------------------------------------------------------------------
# Underground car parks. The ramps the zombies come up lead down into one continuous parking
# level under each courtyard (the middle one and the northern one), just as in the complex:
# aisles 6.5 m wide with 2.5 x 5 m stalls on both sides, back-to-back stall rows with a column
# every three stalls, cross aisles, a lane in from every ramp, strip lights over the aisles.
# 2.95 m clear under the courtyard deck. (Own RNG so the rest of the level stays the same.)
# ----------------------------------------------------------------------------------------
U_AISLE, U_STALL_W, U_STALL_D, U_CEIL = 6.5, 2.5, 5.0, 2.95
U_MODULE = U_AISLE + 2 * U_STALL_D     # 16.5 m: aisle with a stall row either side
urng = random.Random(4242)
pool_block = pool_union.buffer(2.5)
ramp_polys = [Polygon(r['poly']['outer']) for r in ramp_out]
ramp_block = unary_union([rp.buffer(0.15, join_style=2) for rp in ramp_polys])


def ramp_frame(r):
    tx, ty = r['top']
    bx, by = r['bottom']
    L = math.hypot(bx - tx, by - ty)
    return bx, by, (bx - tx) / L, (by - ty) / L


groups = {'middle': [], 'north': []}
for r in ramp_out:
    bx, by, ax, ay = ramp_frame(r)
    groups['middle' if Point(bx, by).distance(mid_court) < 30 else 'north'].append(r)

underground = []
for name, rs in groups.items():
    if not rs:
        continue
    # the space under the courtyard: everything between the ramp doors (and under the whole
    # middle courtyard), clipped to the site, around the pools and the ramps themselves
    pts = []
    for r in rs:
        bx, by, ax, ay = ramp_frame(r)
        pts += [(bx, by), (bx + ax * 10, by + ay * 10)]
    region = MultiPoint(pts).convex_hull.buffer(7, join_style=2)
    if name == 'middle':
        region = region.union(mid_court.buffer(2))
    region = region.intersection(play.buffer(-1.5)).difference(pool_block).difference(ramp_block)
    parts = [q for q in getattr(region, 'geoms', [region]) if q.geom_type == 'Polygon']
    doors_pts = [Point(ramp_frame(r)[0], ramp_frame(r)[1]) for r in rs]
    parts = [q for q in parts if any(q.distance(d) < 0.6 for d in doors_pts)]
    if not parts:
        continue
    area = unary_union(parts).simplify(0.05)
    area = max(getattr(area, 'geoms', [area]), key=lambda q: q.area) if area.geom_type != 'Polygon' else area
    # grid axis: the long side of the area's minimum rectangle
    mrr = list(area.minimum_rotated_rectangle.exterior.coords)
    e1 = (mrr[1][0] - mrr[0][0], mrr[1][1] - mrr[0][1]); e2 = (mrr[2][0] - mrr[1][0], mrr[2][1] - mrr[1][1])
    e = e1 if math.hypot(*e1) >= math.hypot(*e2) else e2
    el = math.hypot(*e)
    ux, uy = e[0] / el, e[1] / el
    vx, vy = -uy, ux
    ox, oy = area.centroid.x, area.centroid.y
    local = lambda x, y: ((x - ox) * ux + (y - oy) * uy, (x - ox) * vx + (y - oy) * vy)
    world = lambda u, v: (ox + ux * u + vx * v, oy + uy * u + vy * v)
    cs = [local(x, y) for x, y in area.exterior.coords]
    umin, umax = min(c[0] for c in cs), max(c[0] for c in cs)
    vmin, vmax = min(c[1] for c in cs), max(c[1] for c in cs)
    # keep-clear zones: a lane in from every ramp door, and a cross aisle every ~40 m
    lanes = []
    pdoors = []
    for r in rs:
        bx, by, ax, ay = ramp_frame(r)
        nx, ny = -ay, ax
        hw = r['width'] / 2
        lane = Polygon([(bx + nx * 3.6, by + ny * 3.6), (bx - nx * 3.6, by - ny * 3.6),
                        (bx - nx * 3.6 + ax * 14, by - ny * 3.6 + ay * 14), (bx + nx * 3.6 + ax * 14, by + ny * 3.6 + ay * 14)])
        lanes.append(lane)
        da, db = (bx + nx * hw, by + ny * hw), (bx - nx * hw, by - ny * hw)
        pdoors.append({'a': [rnd(da[0]), rnd(da[1])], 'b': [rnd(db[0]), rnd(db[1])], 'axis': [rnd(ax, 4), rnd(ay, 4)],
                      'in': [rnd(bx + ax * 2.5), rnd(by + ay * 2.5)], 'out': [rnd(bx - ax * 3.0), rnd(by - ay * 3.0)]})
    n_cross = max(1, int((umax - umin) // 40))
    for k in range(1, n_cross + 1):
        uc = umin + (umax - umin) * k / (n_cross + 1)
        lanes.append(Polygon([world(uc - 3.25, vmin - 1), world(uc + 3.25, vmin - 1), world(uc + 3.25, vmax + 1), world(uc - 3.25, vmax + 1)]))
    keep_clear = unary_union(lanes).buffer(0.2)
    inner = area.buffer(-0.3)
    stalls_u, columns, lights, aisles = [], [], [], []
    v = vmin + U_STALL_D + U_AISLE / 2
    while v < vmax - U_AISLE / 2:
        aisles.append(v)
        v += U_MODULE
    for va in aisles:
        # strip lights down the aisle
        u = umin + 3.75
        while u < umax:
            c = Point(*world(u, va))
            if area.buffer(-1).contains(c):
                lights.append([rnd(c.x), rnd(c.y)])
            u += 7.5
        for sd in (-1, 1):
            vc = va + sd * (U_AISLE / 2 + U_STALL_D / 2)
            k = 0
            u = umin + U_STALL_W / 2
            while u < umax:
                st = Polygon([world(u - U_STALL_W / 2 + 0.05, vc - U_STALL_D / 2), world(u + U_STALL_W / 2 - 0.05, vc - U_STALL_D / 2),
                              world(u + U_STALL_W / 2 - 0.05, vc + U_STALL_D / 2), world(u - U_STALL_W / 2 + 0.05, vc + U_STALL_D / 2)])
                if inner.contains(st) and not st.intersects(keep_clear):
                    c = Point(*world(u, vc))
                    # nose towards the back of the stall (away from the aisle)
                    hx, hy = vx * sd, vy * sd
                    stalls_u.append({'x': rnd(c.x), 'y': rnd(c.y), 'h': rnd(math.atan2(hy, hx), 3)})
                u += U_STALL_W
            # columns on the line where this row backs onto the next module's row
            vb = va + sd * (U_AISLE / 2 + U_STALL_D + 0.05)
            u = umin
            while u < umax:
                c = Point(*world(u, vb))
                if area.buffer(-0.6).contains(c) and not c.buffer(0.5).intersects(keep_clear):
                    if all(math.hypot(c.x - q[0], c.y - q[1]) > 1.0 for q in columns):
                        columns.append([rnd(c.x), rnd(c.y)])
                u += 3 * U_STALL_W
    floor = -ramp_out[0]['depth']
    for st in stalls_u:
        if urng.random() < 0.55:
            h = st['h'] + (0 if urng.random() < 0.7 else math.pi)
            cars.append({'x': st['x'], 'y': st['y'], 'h': rnd(h, 3), 'v': urng.randrange(1000), 'f': floor})
    # a few places deep inside where they come from
    far = []
    for va in aisles:
        for f in (0.2, 0.5, 0.8):
            c = Point(*world(umin + (umax - umin) * f, va))
            if area.buffer(-1.5).contains(c) and min(c.distance(d) for d in doors_pts) > 18:
                far.append(c)
    for c in far[:4]:
        spawns.append({'kind': 'parking', 'x': rnd(c.x), 'y': rnd(c.y), 'f': floor})
    underground.append({'name': name, 'poly': poly_out(area), 'floor': floor, 'ceiling': rnd(floor + U_CEIL),
                        'axis': [rnd(ux, 4), rnd(uy, 4)], 'doors': pdoors, 'columns': columns, 'stalls': stalls_u,
                        'lights': lights})
print('underground parking', [(u['name'], round(Polygon(u['poly']['outer']).area), len(u['stalls']), len(u['columns']), len(u['doors'])) for u in underground])

# ----------------------------------------------------------------------------------------
# Output
# ----------------------------------------------------------------------------------------
level = {
    'meta': {'name': 'Green Diamond, Dighomi, Tbilisi', 'origin': [LAT0, LON0],
             'units': 'metres, x=east, y=north', 'floor_h': FLOOR_H,
             'attribution': 'Map data © OpenStreetMap contributors (ODbL 1.0)'},
    'heightmap': {'file': 'data/heightmap.png', 'res': HM_RES, 'min': list(HM_MIN), 'size': HM_SIZE,
                  'decode': 'h = v / 40 - 4'},
    'play': poly_out(play),
    'buildings': [{'id': b['id'], 'addr': b['addr'], 'group': b['group'], 'levels': b['levels'],
                   'poly': poly_out(b['poly'])} for b in buildings],
    'zones': {'road': zone_out(roads), 'parking': zone_out(parking),
              'pavers': zone_out(pavers.difference(mid_court)),
              'lawn': zone_out(lawns.difference(mid_court)),
              'deck': zone_out(decks.difference(mid_court)),
              'court_pavers': zone_out(pavers.intersection(mid_court)),
              'court_lawn': zone_out(lawns.intersection(mid_court)),
              'court_deck': zone_out(decks.intersection(mid_court))},
    'heights': {'road': H_ROAD, 'parking': H_ROAD, 'pavers': H_PAVE, 'lawn': H_LAWN, 'deck': H_DECK,
                'court_pavers': H_COURT, 'court_lawn': H_COURT + 0.04, 'court_deck': H_COURT},
    'court_mid': poly_out(mid_court),
    'pools': [{'poly': poly_out(p), 'rim': H_COURT if mid_court.contains(p.centroid) else H_DECK,
               'floor': -1.3} for p in pools],
    'pool_steps': pool_steps,
    'ramps': ramp_out,
    'underground': underground,
    'fences': fences,
    'gaps': gaps,
    'walls': walls,
    'gates': [{'x': rnd(gate1.x), 'y': rnd(gate1.y), 'name': 'Gate 1', 'axis': 'y'},
              {'x': rnd(gate2.x), 'y': rnd(gate2.y), 'name': 'Gate 2', 'axis': 'y'}],
    'breaches': [{'x': s['fx'], 'y': s['fy']} for s in spawns if s['kind'] == 'breach'],
    'trees': trees, 'cars': cars, 'stalls': stalls, 'lamps': lamps, 'benches': benches,
    'playgrounds': playgrounds, 'sport': courts_sport, 'pergolas': pergolas,
    'pois': pois, 'doors': doors, 'spawns': spawns,
    'surroundings': {'buildings': backdrop, 'streets': street_lines, 'green': outside_green,
                     'features': outside_features, 'forest': forest},
}
out = ROOT / 'data' / 'level.json'
out.write_text(json.dumps(level, ensure_ascii=False, separators=(',', ':')))
print('wrote', out, round(out.stat().st_size / 1024), 'KB')
print({k: len(v) for k, v in level.items() if isinstance(v, list)})
print('zones', {k: len(v) for k, v in level['zones'].items()},
      'areas m2', {k: round(g.area) for k, g in (('road', roads), ('parking', parking), ('pavers', pavers),
                                                 ('lawn', lawns), ('deck', decks))})
print('play area m2', round(play.area))
