#!/usr/bin/env python3
"""
The car park under the south block, between Spar and Nikora, stamped into data/level.json.

OSM has its ramp only as a retaining wall: a U of walls 5.4 m apart along the north side of the
pool court, shut at the west end and open to the east, with a service way (1411127590) running
down the middle to the dead end. build_level.py didn't know it for a ramp (it isn't in RAMP_IDS),
so it stood there as a low wall round a strip of road. Here it becomes the ramp, sloping down to
the west, and the parking level it leads to: under the pool court and the podiums either side,
laid out like the other two (aisles 6.5 m wide, 2.5 x 5 m stalls both sides, a column every
three stalls, strip lights, a lane in from the ramp, cross aisles), cars in about half the stalls
and a few places deep inside where zombies come from.

Changes to level.json: the ramp (and its heightmap patch), the car park, its cars and spawns; the
zones cut round the ramp; the wall that stood for it dropped; anything standing on the ramp
moved off it. Run once: python3 tools/south_parking.py (it won't add it twice).
"""
import json
import math
import random
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon, box, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / 'data' / 'level.json'
L = json.loads(PATH.read_text())
if any(u['name'] == 'south' for u in L['underground']):
    raise SystemExit('the south car park is already in level.json')


def rnd(v, n=2):
    return round(v, n)


def poly_out(p):
    return {'outer': [[rnd(x), rnd(y)] for x, y in list(p.exterior.coords)[:-1]],
            'holes': [[[rnd(x), rnd(y)] for x, y in list(h.coords)[:-1]] for h in p.interiors]}


def polys(g):
    if g.is_empty:
        return []
    if g.geom_type == 'Polygon':
        return [g]
    return [q for gg in getattr(g, 'geoms', []) for q in polys(gg)]


def poly_in(d):
    return Polygon(d['outer'], d.get('holes') or []).buffer(0)


# ---- the ramp: between the walls, from the open east end down to the west end ----
WALL = [[83.54, -89.47], [61.03, -89.28], [61.03, -83.89], [83.73, -84.0]]
TOP, BOTTOM, WIDTH, DEPTH = (83.6, -86.74), (61.3, -86.6), 5.2, 3.4
line = LineString([TOP, BOTTOM])
rpoly = line.buffer(WIDTH / 2, cap_style='flat')
ramp = {'top': list(TOP), 'bottom': list(BOTTOM), 'width': WIDTH, 'depth': DEPTH, 'poly': poly_out(rpoly)}
L['ramps'].append(ramp)
L['heightmap'].setdefault('patches', []).append({'poly': ramp['poly']['outer'], 'top': list(TOP), 'bottom': list(BOTTOM), 'depth': DEPTH})
L['walls'] = [w for w in L['walls'] if w != WALL]

# the ground round it: every zone cut back from the ramp
cut = rpoly.buffer(0.05, join_style=2)
for k, zs in L['zones'].items():
    out = []
    for d in zs:
        for q in polys(poly_in(d).difference(cut)):
            if q.area > 0.5:
                out.append(poly_out(q))
    L['zones'][k] = out

# nothing standing on it (parked cars, bays, trees, lamps, benches ...)
clear = rpoly.buffer(0.9)
for k in ('cars', 'stalls', 'trees', 'lamps', 'benches', 'pergolas', 'playgrounds', 'sport', 'spawns', 'doors', 'breaches'):
    if k in L:
        L[k] = [it for it in L[k] if not (isinstance(it, dict) and 'x' in it and it.get('f') is None and clear.contains(Point(it['x'], it['y'])))]

# ---- the parking level ----
U_AISLE, U_STALL_W, U_STALL_D, U_CEIL = 6.5, 2.5, 5.0, 2.95
U_MODULE = U_AISLE + 2 * U_STALL_D
urng = random.Random(4243)
floor = -DEPTH
play = poly_in(L['play'])
pool_block = unary_union([poly_in(p['poly']) for p in L['pools']]).buffer(2.5)
ramp_block = unary_union([poly_in(r['poly']).buffer(0.15, join_style=2) for r in L['ramps']])
# under the pool court and the podiums of F3, 30a, 30 and H3; and in past the ramp's end
region = box(19.5, -128.2, 128.5, -89.9).union(box(53.5, -89.9, 61.45, -83.2))
region = region.intersection(play.buffer(-1.5)).difference(pool_block).difference(ramp_block)
bx, by = BOTTOM
ax, ay = (BOTTOM[0] - TOP[0]) / line.length, (BOTTOM[1] - TOP[1]) / line.length
door_pt = Point(bx, by)
parts = [q for q in polys(region) if q.distance(door_pt) < 0.6]
area = max(parts, key=lambda q: q.area).simplify(0.05)

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

nx, ny = -ay, ax
hw = WIDTH / 2
da, db = (bx + nx * hw, by + ny * hw), (bx - nx * hw, by - ny * hw)
doors = [{'a': [rnd(da[0]), rnd(da[1])], 'b': [rnd(db[0]), rnd(db[1])], 'axis': [rnd(ax, 4), rnd(ay, 4)],
          'in': [rnd(bx + ax * 2.5), rnd(by + ay * 2.5)], 'out': [rnd(bx - ax * 3.0), rnd(by - ay * 3.0)]}]
lanes = [Polygon([(bx + nx * 3.6, by + ny * 3.6), (bx - nx * 3.6, by - ny * 3.6),
                  (bx - nx * 3.6 + ax * 14, by - ny * 3.6 + ay * 14), (bx + nx * 3.6 + ax * 14, by + ny * 3.6 + ay * 14)])]
n_cross = max(1, int((umax - umin) // 40))
for k in range(1, n_cross + 1):
    uc = umin + (umax - umin) * k / (n_cross + 1)
    lanes.append(Polygon([world(uc - 3.25, vmin - 1), world(uc + 3.25, vmin - 1), world(uc + 3.25, vmax + 1), world(uc - 3.25, vmax + 1)]))
keep_clear = unary_union(lanes).buffer(0.2)
inner = area.buffer(-0.3)
stalls, columns, lights, aisles = [], [], [], []
v = vmin + U_STALL_D + U_AISLE / 2
while v < vmax - U_AISLE / 2:
    aisles.append(v)
    v += U_MODULE
for va in aisles:
    u = umin + 3.75
    while u < umax:
        c = Point(*world(u, va))
        if area.buffer(-1).contains(c):
            lights.append([rnd(c.x), rnd(c.y)])
        u += 7.5
    for sd in (-1, 1):
        vc = va + sd * (U_AISLE / 2 + U_STALL_D / 2)
        u = umin + U_STALL_W / 2
        while u < umax:
            st = Polygon([world(u - U_STALL_W / 2 + 0.05, vc - U_STALL_D / 2), world(u + U_STALL_W / 2 - 0.05, vc - U_STALL_D / 2),
                          world(u + U_STALL_W / 2 - 0.05, vc + U_STALL_D / 2), world(u - U_STALL_W / 2 + 0.05, vc + U_STALL_D / 2)])
            if inner.contains(st) and not st.intersects(keep_clear):
                c = Point(*world(u, vc))
                stalls.append({'x': rnd(c.x), 'y': rnd(c.y), 'h': rnd(math.atan2(vy * sd, vx * sd), 3)})
            u += U_STALL_W
        vb = va + sd * (U_AISLE / 2 + U_STALL_D + 0.05)
        u = umin
        while u < umax:
            c = Point(*world(u, vb))
            if area.buffer(-0.6).contains(c) and not c.buffer(0.5).intersects(keep_clear):
                if all(math.hypot(c.x - q[0], c.y - q[1]) > 1.0 for q in columns):
                    columns.append([rnd(c.x), rnd(c.y)])
            u += 3 * U_STALL_W
for st in stalls:
    if urng.random() < 0.55:
        h = st['h'] + (0 if urng.random() < 0.7 else math.pi)
        L['cars'].append({'x': st['x'], 'y': st['y'], 'h': rnd(h, 3), 'v': urng.randrange(1000), 'f': floor})
far = []
for va in aisles:
    for f in (0.2, 0.5, 0.8):
        c = Point(*world(umin + (umax - umin) * f, va))
        if area.buffer(-1.5).contains(c) and c.distance(door_pt) > 18:
            far.append(c)
for c in far[:4]:
    L['spawns'].append({'kind': 'parking', 'x': rnd(c.x), 'y': rnd(c.y), 'f': floor})
L['underground'].append({'name': 'south', 'poly': poly_out(area), 'floor': floor, 'ceiling': rnd(floor + U_CEIL),
                         'axis': [rnd(ux, 4), rnd(uy, 4)], 'doors': doors, 'columns': columns, 'stalls': stalls, 'lights': lights})

PATH.write_text(json.dumps(L, ensure_ascii=False, separators=(',', ':')))
print('south car park:', round(area.area), 'm2,', len(stalls), 'stalls,', len(columns), 'columns,', len(lights), 'lights,',
      sum(1 for c in L['cars'] if c.get('f') == floor and any(abs(c['x'] - s['x']) < 0.01 and abs(c['y'] - s['y']) < 0.01 for s in stalls)), 'cars,', len(far[:4]), 'spawns')
