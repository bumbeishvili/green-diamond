import * as THREE from 'three';
import { pointInPoly, mulberry } from './geom.js';

// The shop pavilions round the twin towers, from the user's photos, a 2022 photosphere in the car
// park and photos of the shops: white rendered walls (rough on Nikora's block), tall arch-headed
// shopfronts in dark aluminium, a row of shallow arched panels along the parapet. The two big shops
// have their colours as a fascia band along the top of the wall (Nikora's wine-and-magenta band
// wraps its corner, Spar's red one runs round the glazed corner onto the pool side); the small ones
// put a panel across the shopfront at door height (2 Nabiji's white, the pharmacy's teal, the
// greengrocer's green, dark ones on Studio 21 and the café). Format Fit's block has two floors of dark curtain glass and
// the gym's big black F.
//
// The facade shader reads the layout from a float texture: a pair of rows per podium wall, one
// texel per half-metre slot along it. Row 2k (shopfronts): [start, end, flags, door centre] of the
// opening over that slot; row 2k+1 (parapet / upper floor): [start, end, flags, 0].

export const SHOP_SLOT = 0.5;
const SLOTS = 128;
// shopfront flags
const GLASS = 1, RED = 2, DARK_BAND = 8, SQUARE = 16, GREEN = 32;
// parapet / upper floor flags
const ARCH = 1, LOUVRE = 2, CURTAIN = 4, SCALLOP = 8, ROUGH = 16;

const BAND_H = 1.1, BAND_D = 0.1, BAND_OFF = 0.03;

// Fascia colours (Nikora's: wine red with a magenta stripe along the bottom, from a close-up photo)
const BRANDS = {
  nikora: { band: 0x9c1d4f, stripe: 0xe2357f },
  spar: { band: 0xcf1f2c },
};
const DOOR_SIGN = 2.92;   // the panels across the shopfronts, just above the doors

// Hand-placed facades. `at` picks the podium wall nearest that map point. Distances run along the
// wall from its left end as you face it from outside. g: an opening [from, to]; door: centre of
// its door; lean: how far its left and right jambs lean in by the top, in metres (the piers between
// the shopfronts are wedges, wider at the top, in the photos of Nikora's block and the street side);
// bands: [brand, from, to] (a band reaching a corner wraps round it); signs: painted panels
// (y: 'band' sits on the fascia, otherwise height of the centre).
const FACADES = [
  { // Nikora, a blue TBC Pay kiosk by its pilaster, 2 Nabiji and pharmacy 36.6, facing the car park
    // (the photosphere, and a close-up photo of Nikora's door)
    at: [42, -83.15],
    units: [
      { g: [0.8, 4.4], door: 2.6, lean: [0, 0.3] },
      { g: [5.4, 7.6] },
      { g: [8.8, 13.8], door: 11.3, lean: [0.3, 0] },
      { g: [15.0, 16.6] },
      { g: [17.8, 22.4], door: 20.1, lean: [0.5, 0] },
    ],
    bands: [['nikora', 0, 4.9]],
    signs: [
      { s: 'nikora', u: 2.55, y: 'band' }, { s: 'nikoraDoor', u: 2.6, y: DOOR_SIGN },
      { s: 'kiosk', u: 4.9, y: 1.02, kiosk: true },
      { s: 'nabiji', u: 11.3, y: DOOR_SIGN }, { s: 'pharmacy', u: 20.1, y: DOOR_SIGN },
    ],
  },
  { // Nikora's long blank side on the pool court: a tall glass strip, a billboard, the band all along
    at: [53.6, -100],
    units: [{ g: [17.2, 21.4] }],
    bands: [['nikora', 15.6, 99]],
    signs: [{ s: 'nikora', u: 18.9, y: 'band' }, { s: 'billboard', u: 34.5, y: 4.3 }, { s: 'nikoraDiamond', u: 42.6, y: 'crest' }],
    fridges: [22.6, 23.5, 24.4],
  },
  { // the café on the corner of the west wing, with the scalloped parapet
    at: [24.7, -97.1],
    units: [{ g: [1.2, 5.0], lean: [0.3, 0] }, { g: [6.2, 9.8], door: 8.0, lean: [0.3, 0] }],
    signs: [{ s: 'cafe', u: 8.0, y: DOOR_SIGN }],
    scallop: true,
  },
  { at: [30.15, -90], units: [{ g: [2.0, 5.8], lean: [0.3, 0] }, { g: [8.4, 12.2], door: 10.3, lean: [0.3, 0] }], scallop: true },
  { // ხილ ბოსტანი (a greengrocer's) by Gate 1, Studio 21 and the café (the user's photo, 360-degree
    // video frames by the gate, photos of the café's terrace): four tall arched shopfronts under a
    // plain white parapet; the greengrocer's has produce pictures across its glass, the others dark
    // panels; the café's lit magenta disc on its pilaster (the café there now is called Artichoke; the
    // game's shop is Assorti). (The game's 'Diamond' shop stands at the greengrocer's.)
    at: [117, -87.1],
    units: [
      { g: [1.3, 5.4], door: 4.1, lean: [0.2, 0] },
      { g: [6.9, 11.0], door: 9.0, dark: true, lean: [0.2, 0] },
      { g: [12.7, 17.5], lean: [0.2, 0] },
      { g: [18.3, 22.8], door: 21.0, dark: true },
    ],
    signs: [
      { s: 'khil', u: 3.35, y: DOOR_SIGN }, { s: 'khilGlass', u: 3.35, y: 3.95 }, { s: 'studio21', u: 8.95, y: 3.08 },
      { s: 'disc', u: 17.9, y: 3.4, blade: true }, { s: 'assortiDark', u: 20.55, y: 3.08 },
    ],
    planters: [0.6, 6.15, 11.85], cafe: [21.6, 23.3],
  },
  { at: [104.55, -91], units: [], plain: true },          // the blank end wall next to Spar
  { // Spar: a blank stretch, then the big glazed corner with the red-framed door
    at: [98.7, -94.95],
    units: [{ g: [3.6, 10.7], door: 6.2, redDoor: true, square: true }],
    bands: [['spar', 0, 99]],
    signs: [{ s: 'sparKa', u: 5.4, y: 'band' }, { s: 'sparGlass', u: 9.0, y: 3.9 }],
  },
  { // Spar's side on the pool court: three display windows in red frames
    at: [92.9, -105],
    units: [{ g: [1.8, 6.0], red: true, square: true }, { g: [6.8, 11.0], red: true, square: true }, { g: [11.8, 16.0], red: true, square: true }],
    bands: [['spar', 0, 19.6]],
    signs: [
      { s: 'sparKa', u: 4.0, y: 'band' }, { s: 'sparEn', u: 13.9, y: 'band' },
      { s: 'sparGlass', u: 3.9, y: 3.9 }, { s: 'sparGlass2', u: 8.9, y: 3.9 }, { s: 'sparGlass', u: 13.9, y: 3.9 },
    ],
  },
  { // the Spar block's street side (a photo from Bob Walsh Street): three dark shopfronts, then a
    // shop in green frames with dark green sign boxes on the white fascia
    at: [110.6, -127.8],
    units: [
      { g: [1.2, 5.2], lean: [0.5, 0] }, { g: [6.2, 10.2], door: 8.2, lean: [0.5, 0] }, { g: [11.2, 15.2], lean: [0.5, 0] },
      { g: [16.4, 20.4], green: true, square: true }, { g: [21.2, 25.2], green: true, square: true, door: 23.2 },
      { g: [26.0, 30.0], green: true, square: true }, { g: [30.8, 34.8], green: true, square: true },
    ],
    signs: [{ s: 'greenBox', u: 18.4, y: 'band' }, { s: 'greenBox', u: 25.6, y: 'band' }, { s: 'greenBox', u: 32.8, y: 'band' }],
  },
  { // Format Fit on the pool court (photos from the towers): by Spar a white wall with the gym's big
    // black F, then two floors of dark curtain glass
    at: [73, -114.4],
    units: [{ g: [8.4, 18.6] }, { g: [19.6, 28.8], door: 24.2 }, { g: [29.8, 38.4] }],
    upper: [[8.4, 18.6, CURTAIN], [19.6, 28.8, CURTAIN], [29.8, 38.4, CURTAIN]],
    signs: [{ s: 'formatF', u: 2.4, y: 5.2 }, { s: 'formatfit', u: 5.6, y: 4.7 }],
  },
  { // the west twin's podium on the dirt road south of the complex (the user's photo from the road):
    // five tall bays, three with raked jambs; a FOR SALE banner, a restaurant's board and a pizza oven,
    // Cove Cafe's two fronts (its name in Georgian over a striped awning, then in English), another
    // FOR SALE banner, a little yellow disc
    at: [36, -128.5],
    units: [
      { g: [0.3, 7.6], door: 4.2, lean: [1.6, 0] },
      { g: [9.0, 18.9], door: 12.3, lean: [0.7, 0.8] },
      { g: [19.9, 23.9], door: 21.9 },
      { g: [25.2, 29.5], door: 27.6, lean: [0, 0.7] },
      { g: [30.3, 33.9], door: 32.2, lean: [0, 0.8] },
    ],
    signs: [
      { s: 'forSale', u: 4.4, y: 3.35 }, { s: 'restaurant', u: 12.3, y: 3.3 }, { s: 'bladeStar', u: 13.95, y: 4.4, blade: true },
      { s: 'kouv', u: 16.4, y: 3.35 }, { s: 'coveCafe', u: 21.9, y: 3.3 }, { s: 'forSale2', u: 27.3, y: 3.4 }, { s: 'yellowDisc', u: 30.9, y: 4.0 },
    ],
    awnings: [[14.6, 18.3]], ovens: [10.2], cafe: [15.3, 17.5],
  },
  { // Format Fit's street side, set back beside the twin's podium: one tall glazed bay
    at: [57, -126.15],
    units: [{ g: [1.2, 6.1], door: 3.7, square: true }],
    upper: [[1.2, 6.1, CURTAIN]],
  },
  { // ...then its main face: the big F and the name on the blank west end, a glazed front under
    // louvres further along (the user's photo from the road)
    at: [72, -127.2],
    units: [{ g: [8.5, 23.5], door: 16.0, square: true }],
    upper: [[8.5, 23.5, LOUVRE]],
    signs: [{ s: 'formatF', u: 2.0, y: 4.6 }, { s: 'formatfit', u: 5.3, y: 4.2 }],
  },
];

// Lay out every podium wall: the slot texture for the shader, the fascia bands, signs and props
// (worked out once per level: the buildings and the props both ask for it).
const layouts = new WeakMap();
export function shopLayout(level, heightOf) {
  if (!layouts.has(level)) layouts.set(level, makeLayout(level, heightOf));
  return layouts.get(level);
}

function makeLayout(level, heightOf) {
  const podiums = level.buildings.filter((b) => heightOf(b).style === 'podium');
  const gymPoi = level.pois.find((p) => p.name === 'Format Fit');
  const walls = [];
  for (const b of podiums) {
    const pts = b.poly.outer;
    const { top } = heightOf(b);
    const gym = !!gymPoi && pointInPoly(gymPoi.x, gymPoi.y, pts);
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.05) continue;
      const tx = (bx - ax) / len, ty = (by - ay) / len;
      walls.push({ b, i, ax, ay, bx, by, len, tx, ty, nx: ty, ny: -tx, top, gym, row: walls.length, n: pts.length });
    }
  }
  const byKey = new Map(walls.map((w) => [`${w.b.id}:${w.i}`, w]));
  const wallAt = (id, i) => byKey.get(`${id}:${i}`);
  // stretches of wall hidden inside a neighbouring podium (Format Fit's block joins both towers' podiums)
  const hidden = (w, u) => {
    const x = w.ax + w.tx * u + w.nx * 0.3, y = w.ay + w.ty * u + w.ny * 0.3;
    return podiums.some((o) => o !== w.b && pointInPoly(x, y, o.poly.outer));
  };
  const specFor = (w) => {
    let best = null, bd = 1.5;
    for (const f of FACADES) {
      const [px, py] = f.at;
      const t = Math.max(0, Math.min(w.len, (px - w.ax) * w.tx + (py - w.ay) * w.ty));
      const d = Math.hypot(px - (w.ax + w.tx * t), py - (w.ay + w.ty * t));
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  };

  const data = new Float32Array(SLOTS * Math.max(2, walls.length * 2) * 4);
  for (let k = 0; k < data.length; k += 4) data.set([-1, -1, 0, -1], k);
  const put = (row, u0, u1, flags, extra = -1) => {
    for (let s = Math.max(0, Math.floor(u0 / SHOP_SLOT)); s <= Math.min(SLOTS - 1, Math.floor((u1 - 1e-4) / SHOP_SLOT)); s++) {
      data.set([u0, u1, flags, extra], (row * SLOTS + s) * 4);
    }
  };
  const bands = [], signs = [], props = { planters: [], cafe: [], fridges: [], ovens: [], awnings: [] };

  for (const w of walls) {
    const spec = specFor(w);
    const rand = mulberry((w.b.id % 100000) * 13 + w.i);
    const vis = (u0, u1) => !hidden(w, u0 + 0.1) && !hidden(w, u1 - 0.1) && !hidden(w, (u0 + u1) / 2);
    let units = [], upper = [], wallBands = [];
    if (spec) {
      units = spec.units.map((q) => ({ ...q }));
      upper = spec.upper || [];
      wallBands = (spec.bands || []).map(([brand, u0, u1]) => [brand, u0, Math.min(u1, w.len)]);
      for (const s of spec.signs || []) signs.push({ ...s, w });
      for (const k of ['planters', 'cafe', 'fridges', 'ovens', 'awnings']) for (const u of spec[k] || []) props[k].push({ w, u });
    } else if (w.len > 4.5) {
      // anywhere else: a regular run of openings, some left blank, all under parapet arches
      const W = w.gym ? 5.2 : 3.8, P = w.gym ? 1.0 : 1.8;
      const n = Math.max(1, Math.floor((w.len - P) / (W + P)));
      const s0 = (w.len - (n * W + (n - 1) * P)) / 2;
      for (let k = 0; k < n; k++) {
        const u0 = s0 + k * (W + P);
        const blank = !w.gym && n > 1 && rand() < 0.3;
        units.push({ g: [u0, u0 + W], door: !blank && rand() < 0.35 ? u0 + W / 2 : undefined, blank, lean: w.gym ? null : [0.35, 0] });
        if (w.gym) upper.push([u0, u0 + W, CURTAIN]);
      }
    }
    // shopfronts
    for (const q of units) {
      if (!vis(q.g[0], q.g[1])) continue;
      if (!q.blank) {
        const flags = GLASS | (q.red ? RED : 0) | (q.dark ? DARK_BAND : 0) | (q.square ? SQUARE : 0) | (q.green ? GREEN : 0);
        // (the jambs' lean rides in the flags' high bits, in decimetres)
        const [ll, lr] = (q.lean || [0, 0]).map((m) => Math.max(0, Math.min(63, Math.round(m * 10))));
        put(w.row * 2, q.g[0], q.g[1], flags + 256 * ll + 16384 * lr, q.door ?? -1);
      }
      if (q.redDoor && q.door != null) signs.push({ s: 'redDoor', u: q.door, y: 1.4, w });
    }
    // bands: clip to the visible wall, wrap convex corners, stop short of concave ones
    const banded = [];
    for (let [brand, u0, u1] of wallBands) {
      while (u1 > u0 + 0.5 && hidden(w, u1 - 0.3)) u1 -= 0.25;
      while (u1 > u0 + 0.5 && hidden(w, u0 + 0.3)) u0 += 0.25;
      if (u1 - u0 < 0.5) continue;
      banded.push([u0, u1]);
      const prev = wallAt(w.b.id, (w.i - 1 + w.n) % w.n), next = wallAt(w.b.id, (w.i + 1) % w.n);
      // (> 0: a convex corner on these anticlockwise rings; about 0: the wall carries straight on)
      const turn = (a, c) => (a && c ? a.tx * c.ty - a.ty * c.tx : 0);
      const cut = (t) => (t > 0.3 ? 1 : t < -0.3 ? -1 : 0);
      let e0 = u0, e1 = u1;
      if (u0 <= 0.05) e0 = [BAND_OFF + BAND_D, 0, -BAND_OFF][cut(turn(prev, w)) + 1];
      if (u1 >= w.len - 0.05) e1 = w.len + [-(BAND_OFF + BAND_D), 0, BAND_OFF + BAND_D][cut(turn(w, next)) + 1];
      bands.push({ w, brand, u0: e0, u1: e1, top: w.top + 1.0 });
    }
    // the parapet's inset panels (long rounded rectangles, about 4.5 m: two over a wide shopfront) over
    // every shopfront and along the longer blank stretches (not under a band)
    const underBand = (u0, u1) => banded.some(([b0, b1]) => u1 > b0 - 0.2 && u0 < b1 + 0.2);
    if (w.gym) {
      for (const [u0, u1, f] of upper) if (vis(u0, u1)) put(w.row * 2 + 1, u0, u1, f);
    } else if (!(spec && spec.plain) && w.len > 2.5) {
      const spans = [];
      let last = 0.4;
      const sorted = [...units].filter((q) => vis(q.g[0], q.g[1])).sort((a, c) => a.g[0] - c.g[0]);
      const blankRun = (a, c) => {
        const L = c - a;
        if (L < 3.2) return;
        const n = Math.max(1, Math.round(L / 4.4)), step = L / n;
        for (let k = 0; k < n; k++) spans.push([a + k * step + 0.45, a + (k + 1) * step - 0.45]);
      };
      for (const q of sorted) {
        blankRun(last, q.g[0] - 0.3);
        const n = Math.max(1, Math.round((q.g[1] - q.g[0]) / 5.2)), step = (q.g[1] - q.g[0]) / n;
        for (let k = 0; k < n; k++) spans.push([q.g[0] + k * step + (k ? 0.5 : 0.15), q.g[0] + (k + 1) * step - (k < n - 1 ? 0.5 : 0.15)]);
        last = q.g[1] + 0.3;
      }
      blankRun(last, w.len - 0.4);
      const flags = ARCH | (spec && spec.scallop ? SCALLOP : 0);
      for (const [u0, u1] of spans) if (u1 - u0 > 1.2 && vis(u0, u1) && !underBand(u0, u1)) put(w.row * 2 + 1, u0, u1, flags);
      if (spec && spec.scallop) {
        // the scalloped top runs the whole wall, even where there's no arch below it
        for (let s = 0; s < Math.ceil(w.len / SHOP_SLOT) && s < SLOTS; s++) {
          const o = (w.row * 2 + 1) * SLOTS * 4 + s * 4;
          if (data[o + 2] === 0) data.set([-1, -1, SCALLOP, 0], o);
        }
      }
    }
  }

  // Nikora's block has a rough, pitted render (the user's description, a close-up photo)
  const nikora = level.pois.find((p) => p.name === 'Nikora');
  for (const w of walls) {
    if (!nikora || !pointInPoly(nikora.x, nikora.y, w.b.poly.outer)) continue;
    for (let k = 0; k < Math.min(SLOTS, Math.ceil(w.len / SHOP_SLOT)); k++) {
      const o = ((w.row * 2 + 1) * SLOTS + k) * 4;
      data[o + 2] = (data[o + 2] | 0) | ROUGH;
    }
  }

  const tex = new THREE.DataTexture(data, SLOTS, Math.max(2, walls.length * 2), THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return {
    texture: tex,
    // the shader row of a podium wall (-1: not a shop wall), and whether its block has two floors
    row: (id, i) => (byKey.get(`${id}:${i}`)?.row ?? -1),
    gym: (b) => walls.some((w) => w.b === b && w.gym),
    bands, signs, props,
  };
}

// Fascia bands (boxes into the buildings' instanced mesh), little lamps over Nikora's band, and the
// signs (onto the sign board: see SignBoard).
export function buildShopDecor(layout, boxes, board) {
  const P = (w, u, out) => [w.ax + w.tx * u + w.nx * out, w.ay + w.ty * u + w.ny * out];
  const ang = (w) => Math.atan2(w.ny, w.nx);
  for (const bd of layout.bands) {
    const { w, u0, u1, top } = bd, def = BRANDS[bd.brand];
    const [x, y] = P(w, (u0 + u1) / 2, BAND_OFF + BAND_D / 2);
    boxes.push({ x, y: top - BAND_H / 2, z: -y, sx: BAND_D, sy: BAND_H, sz: u1 - u0, ry: ang(w), color: def.band });
    // the band's face goes on the sign board too, so that it can be lit at night
    board.patch(def.band, 0.4, P(w, u0, BAND_OFF + BAND_D + 0.004), P(w, u1, BAND_OFF + BAND_D + 0.004), top - BAND_H, top, [w.nx, w.ny]);
    if (def.stripe) {
      const [sx, sy] = P(w, (u0 + u1) / 2, BAND_OFF + BAND_D / 2 + 0.015);
      boxes.push({ x: sx, y: top - BAND_H + 0.1, z: -sy, sx: BAND_D + 0.03, sy: 0.2, sz: u1 - u0 + 0.03, ry: ang(w), color: def.stripe });
      board.patch(def.stripe, 0.4, P(w, u0 - 0.015, BAND_OFF + BAND_D + 0.034), P(w, u1 + 0.015, BAND_OFF + BAND_D + 0.034), top - BAND_H, top - BAND_H + 0.2, [w.nx, w.ny]);
      // little spot lamps along the top of the band
      for (let u = u0 + 1.2; u < u1 - 0.6; u += 2.6) {
        const [hx, hy] = P(w, u, BAND_OFF + BAND_D + 0.12);
        boxes.push({ x: hx, y: top + 0.06, z: -hy, sx: 0.22, sy: 0.1, sz: 0.1, ry: ang(w), color: 0x2a2b2d });
      }
    }
  }
  for (const s of layout.signs) {
    const { w } = s, def = SIGNS[s.s];
    if (!def) continue;
    if (s.kiosk) {
      // TBC Pay's terminal: a blue box with a curved white canopy, its screen on the sign board
      const [kx, ky] = P(w, s.u, 0.45);
      boxes.push({ x: kx, y: 0.9, z: -ky, sx: 0.5, sy: 1.8, sz: 0.62, ry: ang(w), color: 0x1f6fb5 });
      const [cx, cy] = P(w, s.u, 0.52);
      boxes.push({ x: cx, y: 1.86, z: -cy, sx: 0.66, sy: 0.08, sz: 0.7, ry: ang(w), color: 0xe8ecef });
      const [fx, fy] = P(w, s.u, 0.71);
      board.add(s.s, def, fx, fy, s.y, [w.tx, w.ty], [w.nx, w.ny]);
      continue;
    }
    if (s.blade) {
      // blade signs hang off a short dark arm, square to the wall
      const [x, y] = P(w, s.u, 0.3);
      boxes.push({ x, y: s.y + def.h / 2 + 0.04, z: -y, sx: 0.6, sy: 0.05, sz: 0.05, ry: ang(w), color: 0x2a2b2d });
    }
    // (a 'full' sign covers the whole band, stripe and all, so it stands a little further out)
    const out = s.y === 'band' || s.y === 'crest' ? BAND_OFF + BAND_D + (def.full ? 0.05 : 0.02) : s.blade ? 0.5 : 0.07;
    const [x, y] = P(w, s.u, out);
    const band = bandAt(layout, w, s.u);
    const bandTop = band ? band.top : w.top + 1.05, stripe = band && BRANDS[band.brand].stripe ? 0.2 : 0;
    const h = s.y === 'band' ? (def.full ? bandTop - BAND_H / 2 : bandTop - (BAND_H - stripe) / 2 + 0.01)
      : s.y === 'crest' ? bandTop + def.h * 0.12 : s.y;
    if (s.y === 'band' && !band) {
      // (a box sign on a plain parapet: its box behind the face)
      const [bx, by] = P(w, s.u, (BAND_OFF + BAND_D) / 2 + 0.01);
      boxes.push({ x: bx, y: h, z: -by, sx: BAND_OFF + BAND_D, sy: def.h, sz: def.w, ry: ang(w), color: def.box || 0x222222 });
    }
    if (s.blade) board.add(s.s, def, x, y, h, [w.nx, w.ny], [-w.tx, -w.ty]);
    else board.add(s.s, def, x, y, h, [w.tx, w.ty], [w.nx, w.ny]);
  }
}

// Painted signs all over the complex share one atlas (a second one holds what glows at night) and
// one mesh. add(): a painted panel centred at map (x, y), height h, its width along `along`, facing
// `normal` (as you face it, `along` runs left to right). patch(): a plain rectangle of one colour.
export class SignBoard {
  constructor() { this.kinds = new Map(); this.quads = []; }
  add(key, def, x, y, h, along, normal) {
    this.kinds.set(key, def);
    const [ax, ay] = along, hw = def.w / 2, hh = def.h / 2;
    this.quads.push({ key, c: [[x - ax * hw, y - ay * hw, h - hh], [x + ax * hw, y + ay * hw, h - hh], [x + ax * hw, y + ay * hw, h + hh], [x - ax * hw, y - ay * hw, h + hh]], normal });
  }
  patch(color, glow, p0, p1, h0, h1, normal) {
    const key = `patch:${color}:${glow}`;
    const hex = '#' + color.toString(16).padStart(6, '0'), dim = '#' + new THREE.Color(color).multiplyScalar(glow).getHexString();
    this.kinds.set(key, { patch: true, paint(ctx, w, h, lit) { ctx.fillStyle = lit ? dim : hex; ctx.fillRect(0, 0, w, h); } });
    this.quads.push({ key, c: [[p0[0], p0[1], h0], [p1[0], p1[1], h0], [p1[0], p1[1], h1], [p0[0], p0[1], h1]], normal, flat: true });
  }
  build(group) {
    if (!this.quads.length) return { update() {} };
    // shelf-pack the panels into an atlas 2048 wide at ~128 px per metre (small ones sharper); plain
    // patches get 32 px swatches along the bottom row
    const W = 2048, pad = 4;
    const kinds = [...this.kinds].map(([k, def]) => ({ k, def }));
    const panels = kinds.filter((q) => !q.def.patch), patches = kinds.filter((q) => q.def.patch);
    for (const q of panels) { const ppm = q.def.ppm || (q.def.w < 2 ? 180 : 128); q.pw = Math.round(q.def.w * ppm); q.ph = Math.round(q.def.h * ppm); }
    panels.sort((a, c) => c.ph - a.ph);
    let cx = 0, cy = 0, rowH = 0;
    for (const q of panels) {
      if (cx + q.pw + pad > W) { cx = 0; cy += rowH + pad; rowH = 0; }
      q.x = cx; q.y = cy; cx += q.pw + pad; rowH = Math.max(rowH, q.ph);
    }
    const H = Math.min(4096, Math.ceil((cy + rowH + 40) / 256) * 256);
    patches.forEach((q, k) => Object.assign(q, { x: k * 32, y: H - 32, pw: 32, ph: 32 }));
    const color = document.createElement('canvas'), glow = document.createElement('canvas');
    color.width = glow.width = W; color.height = glow.height = H;
    const cc = color.getContext('2d'), gc = glow.getContext('2d');
    gc.fillStyle = '#000'; gc.fillRect(0, 0, W, H);
    const cell = new Map();
    for (const q of kinds) {
      for (const [ctx, lit] of [[cc, false], [gc, true]]) {
        ctx.save(); ctx.translate(q.x, q.y);
        ctx.beginPath(); ctx.rect(0, 0, q.pw, q.ph); ctx.clip();
        q.def.paint(ctx, q.pw, q.ph, lit);
        ctx.restore();
      }
      cell.set(q.k, q);
    }
    const pos = [], uv = [], nor = [];
    for (const qd of this.quads) {
      const q = cell.get(qd.key);
      const c = qd.c.map(([x, y, h]) => [x, h, -y]);
      pos.push(...c[0], ...c[1], ...c[2], ...c[0], ...c[2], ...c[3]);
      if (qd.flat) {
        const cu = (q.x + q.pw / 2) / W, cv = 1 - (q.y + q.ph / 2) / H;
        for (let k = 0; k < 6; k++) uv.push(cu, cv);
      } else {
        const u0 = q.x / W, u1 = (q.x + q.pw) / W, v1 = 1 - q.y / H, v0 = 1 - (q.y + q.ph) / H;
        uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      }
      for (let k = 0; k < 6; k++) nor.push(qd.normal[0], 0, -qd.normal[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
    const mat = new THREE.MeshStandardMaterial({
      map: tex(color), emissiveMap: tex(glow), emissive: 0xffffff, emissiveIntensity: 0.1,
      roughness: 0.55, alphaTest: 0.5, side: THREE.DoubleSide,
      // (a few millimetres proud of the bands and glass: pulled forward in depth so they never flicker)
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'signs';
    mesh.receiveShadow = true;
    group.add(mesh);
    return {
      mesh,
      update(lamp) { mat.emissiveIntensity = 0.1 + lamp * 1.1; },
    };
  }
}

// A lobby's name board: white lettering on black ("დ1 ბლოკი   D1 BLOCK")
export function nameBoard(ka, en) {
  return {
    w: 3.9, h: 0.5,
    paint(ctx, w, h, lit) {
      bgFill(ctx, w, h, '#17181a', lit);
      ctx.fillStyle = '#f4f4f2'; ctx.textBaseline = 'middle';
      const t = caps(ka, ctx);
      ctx.textAlign = 'right'; font(ctx, 'bold', h * 0.46, SANS, t, w * 0.44); ctx.fillText(t, w * 0.47, h * 0.54);
      ctx.textAlign = 'left'; font(ctx, 'bold', h * 0.46, SANS, en, w * 0.44); ctx.fillText(en, w * 0.53, h * 0.54);
    },
  };
}

function bandAt(layout, w, u) {
  return layout.bands.find((q) => q.w === w && u >= q.u0 - 0.5 && u <= q.u1 + 0.5);
}

// ------------------------------------------------------------------------------------------
// Sign painters: (ctx, width px, height px, lit) - `lit` paints the night-glow atlas, where only
// the lettering and logos shine.
// ------------------------------------------------------------------------------------------
const SANS = '"Helvetica Neue", Arial, "Noto Sans Georgian", sans-serif';
const HEAVY = '"Arial Black", "Helvetica Neue", Arial, "Noto Sans Georgian", sans-serif';

function font(ctx, weight, px, family, text, maxW) {
  ctx.font = `${weight} ${px}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w > maxW) ctx.font = `${weight} ${Math.floor(px * maxW / w)}px ${family}`;
}
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
// Georgian capitals (mtavruli) where the browser has them, as on Spar's sign; plain letters otherwise
let capsOk = null;
function caps(text, ctx) {
  if (capsOk === null) {
    ctx.save(); ctx.font = `bold 40px ${SANS}`;
    capsOk = Math.abs(ctx.measureText('ᲡᲞᲐ').width - ctx.measureText('').width) > 2;
    ctx.restore();
  }
  if (!capsOk) return text;
  return [...text].map((ch) => { const c = ch.codePointAt(0); return c >= 0x10D0 && c <= 0x10FA ? String.fromCodePoint(c - 0x10D0 + 0x1C90) : ch; }).join('');
}
const bgFill = (ctx, w, h, col, lit) => { ctx.fillStyle = lit ? '#000' : col; ctx.fillRect(0, 0, w, h); };

// the Spar fir tree in a green ring on a white square
function sparLogo(ctx, x, y, s, lit) {
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, s, s);
  const cx = x + s / 2, cy = y + s / 2, r = s * 0.4;
  ctx.fillStyle = lit ? '#b8ffcf' : '#00843d';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = lit ? '#b8ffcf' : '#00843d';
  ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.66); ctx.lineTo(cx + r * 0.58, cy + r * 0.3); ctx.lineTo(cx + r * 0.14, cy + r * 0.3);
  ctx.lineTo(cx + r * 0.14, cy + r * 0.62); ctx.lineTo(cx - r * 0.14, cy + r * 0.62); ctx.lineTo(cx - r * 0.14, cy + r * 0.3);
  ctx.lineTo(cx - r * 0.58, cy + r * 0.3); ctx.closePath(); ctx.fill();
}
function sparPanel(ctx, w, h, lit, text) {
  // a white panel with a thin red border on the red band (photos of the pavilion)
  bgFill(ctx, w, h, '#cf1f2c', lit);
  const m = h * 0.1;
  ctx.fillStyle = lit ? '#e8e0d8' : '#ffffff'; ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
  ctx.strokeStyle = '#cf1f2c'; ctx.lineWidth = h * 0.04;
  ctx.strokeRect(m * 1.6, m * 1.6, w - 3.2 * m, h - 3.2 * m);
  const s = h - 2 * m - h * 0.16;
  sparLogo(ctx, w - m * 1.9 - s, m + h * 0.08, s, lit);
  ctx.fillStyle = '#d0202e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const t = text === 'სპარი' ? caps(text, ctx) : text;
  font(ctx, 'bold', h * 0.52, SANS, t, w - s - 5 * m);
  ctx.fillText(t, (w - s - m) / 2 + m / 2, h * 0.53);
}
// The developer's FOR SALE banners on the empty shops: white on pale blue, with the sales number
function forSale(ctx, w, h, lit) {
  bgFill(ctx, w, h, '#98c4e8', lit);
  ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const parts = ['იყიდება', '032 200 10 10', 'FOR SALE'];
  parts.forEach((t, k) => {
    font(ctx, 'bold', h * 0.5, SANS, t, w / 3.4);
    ctx.fillText(t, w * (k + 0.5) / 3, h * 0.54);
  });
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  for (const k of [1, 2]) ctx.fillRect(w * k / 3 - 1, 0, 2, h);
}

// Window graphics: fruit and vegetables printed across the glass (Spar's, on green with a slogan;
// the greengrocer's, a band of produce pictures on dark)
function produce(ctx, w, h, lit, seed, band = false) {
  if (lit) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); return; }
  const r = mulberry(seed);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, band ? '#2a2620' : '#2c5b3c'); g.addColorStop(1, band ? '#1a1814' : '#193826');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  if (band) {
    // photographs of produce heaped in crates, a picture to a pane (muted behind the glass)
    const cols = ['#a8473a', '#b8763a', '#b89a3e', '#6b8c44', '#6e3a4c', '#95a656', '#8a5a34'];
    for (let pane = 0; pane < 4; pane++) {
      const x0 = pane * w / 4;
      for (let i = 0; i < 26; i++) {
        const x = x0 + r() * w / 4, y = h * (0.3 + r() * 0.7), rad = h * (0.06 + r() * 0.07);
        ctx.fillStyle = cols[Math.floor(r() * cols.length)];
        ctx.beginPath(); ctx.ellipse(x, y, rad * (0.9 + r() * 0.4), rad, r() * 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,240,220,0.18)';
        ctx.beginPath(); ctx.arc(x - rad * 0.3, y - rad * 0.35, rad * 0.35, 0, Math.PI * 2); ctx.fill();
      }
    }
    const v = ctx.createLinearGradient(0, 0, 0, h);   // the glass darkens it towards the top
    v.addColorStop(0, 'rgba(15,14,12,0.55)'); v.addColorStop(0.5, 'rgba(15,14,12,0.15)'); v.addColorStop(1, 'rgba(15,14,12,0.3)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#15130f';
    for (let k = 1; k < 4; k++) ctx.fillRect(w * k / 4 - 2, 0, 4, h);   // the mullions between the panes
    return;
  }
  const cols = ['#d8322a', '#f08a1c', '#f5c518', '#6cb33f', '#8e2f5c', '#e8d6a6', '#c0392b', '#3d8b37'];
  for (let i = 0; i < 70; i++) {
    const x = r() * w, y = h * 0.25 + r() * h * 0.75, rad = h * (0.05 + r() * 0.09);
    ctx.fillStyle = cols[Math.floor(r() * cols.length)];
    ctx.beginPath(); ctx.ellipse(x, y, rad * (0.8 + r() * 0.5), rad, r() * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(x - rad * 0.3, y - rad * 0.35, rad * 0.25, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  font(ctx, 'bold', h * 0.1, SANS, 'ყოველდღე ახალი', w * 0.8);
  ctx.fillText('ყოველდღე ახალი', w * 0.06, h * 0.12);
}

// Nikora's mark: a white rounded blob with a leaf (the chain's logo, simplified)
function nikoraMark(ctx, x, y, s, lit) {
  // a white bull's head: a round head, a swept horn, a maroon eye
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(x + s * 0.5, y + s * 0.58, s * 0.36, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + s * 0.3, y + s * 0.34);
  ctx.quadraticCurveTo(x + s * 0.2, y + s * 0.02, x + s * 0.62, y + s * 0.06);
  ctx.quadraticCurveTo(x + s * 0.4, y + s * 0.18, x + s * 0.52, y + s * 0.3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = lit ? '#000' : '#9c1d4f';
  ctx.beginPath(); ctx.arc(x + s * 0.6, y + s * 0.52, s * 0.07, 0, Math.PI * 2); ctx.fill();
}
// Nikora's box signs: maroon, a magenta strip along the bottom with სუპერმარკეტი (a close-up photo)
function nikoraBox(ctx, w, h, lit, strip) {
  bgFill(ctx, w, h, '#9c1d4f', lit);
  const hs = h * strip, hm = h - hs;
  ctx.fillStyle = lit ? '#5a0f2c' : '#e2357f'; ctx.fillRect(0, hm, w, hs);
  nikoraMark(ctx, w * 0.5 - hm * 1.5, hm * 0.12, hm * 0.76, lit);
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  font(ctx, 'bold', hm * 0.62, SANS, 'ნიკორა', w * 0.5);
  ctx.fillText('ნიკორა', w * 0.5 - hm * 0.55, hm * 0.56);
  ctx.textAlign = 'center';
  font(ctx, '600', hs * 0.72, SANS, caps('სუპერმარკეტი', ctx), w * 0.5);
  ctx.fillText(caps('სუპერმარკეტი', ctx), w * 0.5 + hm * 0.3, hm + hs * 0.55);
}

const SIGNS = {
  nikora: { w: 4.6, h: 1.1, full: true, paint: (ctx, w, h, lit) => nikoraBox(ctx, w, h, lit, 0.2) },
  nikoraDoor: { w: 3.4, h: 0.66, paint: (ctx, w, h, lit) => nikoraBox(ctx, w, h, lit, 0.3) },
  nikoraDiamond: {
    w: 1.5, h: 1.5,
    paint(ctx, w, h, lit) {
      ctx.clearRect(0, 0, w, h);
      if (lit) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }
      const c = w / 2, r = w * 0.47;
      const diamond = (k) => { ctx.beginPath(); ctx.moveTo(c, c - r * k); ctx.lineTo(c + r * k, c); ctx.lineTo(c, c + r * k); ctx.lineTo(c - r * k, c); ctx.closePath(); };
      ctx.fillStyle = '#ffffff'; diamond(1); ctx.fill();
      ctx.fillStyle = lit ? '#000' : '#c2185b'; diamond(0.86); ctx.fill();
      // a crown over a shopping basket
      ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'; ctx.lineWidth = w * 0.035; ctx.lineJoin = 'round';
      const b = c + w * 0.04;
      ctx.beginPath(); ctx.moveTo(c - w * 0.2, b - w * 0.04); ctx.lineTo(c + w * 0.2, b - w * 0.04);
      ctx.lineTo(c + w * 0.14, b + w * 0.17); ctx.lineTo(c - w * 0.14, b + w * 0.17); ctx.closePath(); ctx.stroke();
      for (const k of [-0.07, 0, 0.07]) { ctx.beginPath(); ctx.moveTo(c + w * k, b - w * 0.02); ctx.lineTo(c + w * k * 0.8, b + w * 0.15); ctx.stroke(); }
      const k0 = c - w * 0.17;
      ctx.beginPath(); ctx.moveTo(c - w * 0.11, k0 + w * 0.08); ctx.lineTo(c - w * 0.13, k0 - w * 0.04); ctx.lineTo(c - w * 0.05, k0 + w * 0.02);
      ctx.lineTo(c, k0 - w * 0.07); ctx.lineTo(c + w * 0.05, k0 + w * 0.02); ctx.lineTo(c + w * 0.13, k0 - w * 0.04); ctx.lineTo(c + w * 0.11, k0 + w * 0.08); ctx.closePath(); ctx.fill();
    },
  },
  billboard: {
    w: 7.0, h: 3.2,
    paint(ctx, w, h, lit) {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, lit ? '#6a5a66' : '#d9c6d6'); g.addColorStop(1, lit ? '#584858' : '#bda6bc');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = lit ? '#000' : '#8e6f8a'; ctx.lineWidth = h * 0.03; ctx.strokeRect(0, 0, w, h);
      // a wicker basket full of shopping
      const bx = w * 0.62, by = h * 0.62, bw = w * 0.3, bh = h * 0.28;
      const item = (x, y, iw, ih, col, r = 0) => { ctx.save(); ctx.translate(x, y); ctx.rotate(r); ctx.fillStyle = col; rrect(ctx, -iw / 2, -ih, iw, ih, iw * 0.35); ctx.fill(); ctx.restore(); };
      item(bx - bw * 0.3, by + 4, bw * 0.12, h * 0.55, '#e4c38a', -0.35);  // a baguette
      item(bx - bw * 0.05, by + 4, bw * 0.1, h * 0.5, '#2f5a3a', -0.05);   // a wine bottle
      item(bx + bw * 0.12, by + 4, bw * 0.1, h * 0.44, '#e9e5da', 0.08);   // milk
      item(bx + bw * 0.32, by + 4, bw * 0.12, h * 0.36, '#c23b3b', 0.3);   // a tomato-red pack
      item(bx + bw * 0.02, by + 4, bw * 0.08, h * 0.38, '#b05a2a', 0.22);  // juice
      ctx.fillStyle = '#9a6a3a';
      ctx.beginPath(); ctx.moveTo(bx - bw / 2, by); ctx.lineTo(bx + bw / 2, by); ctx.lineTo(bx + bw * 0.4, by + bh); ctx.lineTo(bx - bw * 0.4, by + bh); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#6e4724'; ctx.lineWidth = 3;
      for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(bx - bw / 2 + k * bw * 0.02, by + k * bh / 5); ctx.lineTo(bx + bw / 2 - k * bw * 0.02, by + k * bh / 5); ctx.stroke(); }
      ctx.fillStyle = lit ? '#e8dde6' : '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      font(ctx, 'italic 600', h * 0.13, SANS, 'ყველაფერი', w * 0.4);
      ctx.fillText('ყველაფერი', w * 0.08, h * 0.38);
      font(ctx, 'italic 600', h * 0.13, SANS, 'ერთ ადგილას', w * 0.44);
      ctx.fillText('ერთ ადგილას', w * 0.08, h * 0.56);
      nikoraMark(ctx, w * 0.08, h * 0.7, h * 0.18, lit);
    },
  },
  sparKa: { w: 4.3, h: 0.9, paint: (ctx, w, h, lit) => sparPanel(ctx, w, h, lit, 'სპარი') },
  sparEn: { w: 3.4, h: 0.85, paint: (ctx, w, h, lit) => sparPanel(ctx, w, h, lit, 'SPAR') },
  redDoor: {
    // Spar's red door surround (a flat frame on the glass)
    w: 2.3, h: 2.8,
    paint(ctx, w, h, lit) {
      ctx.clearRect(0, 0, w, h);
      if (lit) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); return; }
      const t = w * 0.07;
      ctx.fillStyle = '#c81e28';
      ctx.fillRect(0, 0, w, t * 1.3); ctx.fillRect(0, 0, t, h); ctx.fillRect(w - t, 0, t, h);
    },
  },
  kiosk: {
    // TBC Pay's terminal: blue, a screen, a keypad and the logo
    w: 0.56, h: 1.5,
    paint(ctx, w, h, lit) {
      bgFill(ctx, w, h, '#1f6fb5', lit);
      ctx.fillStyle = lit ? '#000' : '#e9eef2'; ctx.fillRect(w * 0.08, h * 0.08, w * 0.84, h * 0.34);
      ctx.fillStyle = lit ? '#8fd4ff' : '#2d8fd0'; ctx.fillRect(w * 0.16, h * 0.12, w * 0.68, h * 0.24);
      ctx.fillStyle = lit ? '#000' : '#d9dee3';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) ctx.fillRect(w * (0.2 + i * 0.22), h * (0.47 + j * 0.05), w * 0.16, h * 0.035);
      ctx.fillStyle = lit ? '#bfe6ff' : '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      font(ctx, 'bold', h * 0.09, HEAVY, 'TBC', w * 0.8);
      ctx.fillText('TBC', w / 2, h * 0.8);
      font(ctx, '600', h * 0.06, SANS, 'Pay', w * 0.8);
      ctx.fillText('Pay', w / 2, h * 0.88);
    },
  },
  nabiji: {
    // a white panel: the green 2 in a rounded square, dark lettering (the close-up photo)
    w: 4.2, h: 0.62,
    paint(ctx, w, h, lit) {
      bgFill(ctx, w, h, '#f4f5f2', lit);
      ctx.fillStyle = lit ? '#7dffae' : '#2aa24a';
      rrect(ctx, h * 0.14, h * 0.12, h * 0.76, h * 0.76, h * 0.14); ctx.fill();
      ctx.fillStyle = lit ? '#000' : '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      font(ctx, 'bold', h * 0.6, HEAVY, '2', h);
      ctx.fillText('2', h * 0.52, h * 0.54);
      ctx.fillStyle = lit ? '#f4f5f2' : '#2b2e2b';
      font(ctx, 'bold', h * 0.5, SANS, 'ნაბიჯი', w - h * 1.4);
      ctx.fillText('ნაბიჯი', (w + h) / 2, h * 0.54);
    },
  },
  pharmacy: {
    // the teal band across the shopfront: აფთიაქი, 36·6 in a blue disc, APOTHEKA (a 2022 photo)
    w: 4.3, h: 0.56,
    paint(ctx, w, h, lit) {
      bgFill(ctx, w, h, '#16a0a2', lit);
      ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      font(ctx, 'bold', h * 0.5, SANS, 'აფთიაქი', w * 0.34);
      ctx.fillText('აფთიაქი', w * 0.03, h * 0.54);
      const cx = w * 0.43;
      ctx.fillStyle = lit ? '#5a86ff' : '#1d3f8f';
      ctx.beginPath(); ctx.arc(cx, h / 2, h * 0.44, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
      font(ctx, 'bold', h * 0.34, SANS, '36·6', h * 0.78);
      ctx.fillText('36·6', cx, h * 0.53);
      ctx.textAlign = 'left';
      font(ctx, 'bold', h * 0.52, SANS, 'APOTHEKA', w * 0.46);
      ctx.fillText('APOTHEKA', w * 0.51, h * 0.55);
    },
  },
  khil: {
    // ხილ ბოსტანი, the greengrocer's by Gate 1. Its name board isn't legible in any photo: this is a
    // green board with white lettering and an apple, in the way of Tbilisi's greengrocers
    w: 3.4, h: 0.6,
    paint(ctx, w, h, lit) {
      bgFill(ctx, w, h, '#2e8b3a', lit);
      const c = h * 0.52, r = h * 0.24;
      ctx.fillStyle = lit ? '#ff6b5a' : '#e0352b';
      ctx.beginPath(); ctx.arc(c - r * 0.35, c + r * 0.1, r * 0.72, 0, Math.PI * 2); ctx.arc(c + r * 0.35, c + r * 0.1, r * 0.72, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lit ? '#b8ffb0' : '#8fd14f';
      ctx.beginPath(); ctx.ellipse(c + r * 0.35, c - r * 0.8, r * 0.38, r * 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      font(ctx, 'bold', h * 0.46, SANS, 'ხილ ბოსტანი', w - h * 1.2);
      ctx.fillText('ხილ ბოსტანი', h * 1.0, h * 0.54);
    },
  },
  khilGlass: { w: 3.9, h: 1.3, paint: (ctx, w, h, lit) => produce(ctx, w, h, lit, 5, true) },
  disc: {
    // the café's round blade sign: lit magenta, CAFE (the user's photo, the café's terrace photo)
    w: 0.8, h: 0.8,
    paint(ctx, w, h, lit) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = lit ? '#ff3cf2' : '#c81fc0';
      ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.47, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lit ? '#ffd6fb' : '#fbe3f9'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      font(ctx, '600', h * 0.22, 'Georgia, "Times New Roman", serif', 'CAFE', w * 0.7);
      ctx.fillText('CAFE', w / 2, h * 0.52);
    },
  },
  studio21: {
    // dark panel on the glass (as in the user's photo)
    w: 2.6, h: 0.62,
    paint(ctx, w, h, lit) {
      bgFill(ctx, w, h, '#34373b', lit);
      ctx.fillStyle = '#f2f2f2';
      ctx.beginPath(); ctx.arc(h * 0.45, h * 0.5, h * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lit ? '#000' : '#34373b';
      ctx.beginPath(); ctx.arc(h * 0.5, h * 0.44, h * 0.13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f2f2f2'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      font(ctx, '600', h * 0.4, SANS, 'STUDIO 21', w - h * 1.1);
      ctx.fillText('STUDIO 21', h * 0.95, h * 0.5);
      font(ctx, '400', h * 0.24, SANS, 'beauty & more', w - h * 1.1);
      ctx.fillText('beauty & more', h * 0.97, h * 0.82);
    },
  },
  assortiDark: {
    // a black panel with purple lettering and a little leafy mark, in the style of the café's sign
    w: 3.6, h: 0.62,
    paint(ctx, w, h, lit) {
      bgFill(ctx, w, h, '#1c1c1f', lit);
      const col = lit ? '#c46bff' : '#9b4fd0';
      ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      font(ctx, '500', h * 0.42, SANS, 'ასორტი', w * 0.4);
      ctx.fillText('ასორტი', w * 0.25, h * 0.54);
      font(ctx, '500', h * 0.36, 'Georgia, "Times New Roman", serif', 'ASSORTI', w * 0.36);
      ctx.fillText('ASSORTI', w * 0.75, h * 0.54);
      ctx.strokeStyle = col; ctx.lineWidth = h * 0.04;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(w * 0.5, h * (0.36 + k * 0.12), h * (0.1 - k * 0.02), h * 0.07, 0, 0, Math.PI * 2); ctx.stroke(); }
    },
  },
  formatF: {
    // the gym's big black F, drawn in a double line (photos of the pool court and the street side)
    w: 2.0, h: 2.6,
    paint(ctx, w, h, lit) {
      ctx.clearRect(0, 0, w, h);
      if (lit) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }
      const t = w * 0.07;
      ctx.fillStyle = lit ? '#5a5a5a' : '#161616';
      const F = (o) => {
        ctx.fillRect(w * 0.12 + o, h * 0.05 + o, t, h * 0.9 - o);           // the stem
        ctx.fillRect(w * 0.12 + o, h * 0.05 + o, w * 0.76 - o, t);          // the top bar
        ctx.fillRect(w * 0.12 + o, h * 0.42 + o, w * 0.56 - o, t);          // the middle bar
      };
      F(0); F(w * 0.16);
    },
  },
  formatfit: {
    w: 3.0, h: 0.8,
    paint(ctx, w, h, lit) {
      ctx.clearRect(0, 0, w, h);
      if (lit) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }
      ctx.fillStyle = lit ? '#6a6a6a' : '#1a1a1a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      font(ctx, 'bold', h * 0.34, SANS, 'ფორმატ ფიტ', w * 0.95);
      ctx.fillText('ფორმატ ფიტ', w * 0.03, h * 0.3);
      font(ctx, 'bold', h * 0.36, HEAVY, 'FORMAT FIT', w * 0.95);
      ctx.fillText('FORMAT FIT', w * 0.03, h * 0.74);
    },
  },
  sparGlass: { w: 4.0, h: 2.6, paint: (ctx, w, h, lit) => produce(ctx, w, h, lit, 3) },
  sparGlass2: { w: 4.0, h: 2.6, paint: (ctx, w, h, lit) => produce(ctx, w, h, lit, 8) },
  forSale: { w: 6.2, h: 0.55, paint: (ctx, w, h, lit) => forSale(ctx, w, h, lit) },
  forSale2: { w: 4.1, h: 0.5, paint: (ctx, w, h, lit) => forSale(ctx, w, h, lit) },
  restaurant: {
    // a black board: რესტორანი over a rule, RESTAURANT under it
    w: 2.8, h: 0.8,
    paint(ctx, w, h, lit) {
      bgFill(ctx, w, h, '#161616', lit);
      ctx.fillStyle = '#f4f4f2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      font(ctx, 'bold', h * 0.3, SANS, caps('რესტორანი', ctx), w * 0.86);
      ctx.fillText(caps('რესტორანი', ctx), w / 2, h * 0.33);
      ctx.fillRect(w * 0.12, h * 0.52, w * 0.76, h * 0.025);
      font(ctx, 'bold', h * 0.19, SANS, 'R E S T A U R A N T', w * 0.8);
      ctx.fillText('R E S T A U R A N T', w / 2, h * 0.73);
    },
  },
  kouv: {
    // Cove Cafe's name in Georgian: white on a black band
    w: 4.1, h: 0.7,
    paint(ctx, w, h, lit) {
      bgFill(ctx, w, h, '#141414', lit);
      ctx.fillStyle = '#f4f4f2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      font(ctx, 'bold', h * 0.62, HEAVY, 'კოუვ კაფე', w * 0.94);
      ctx.fillText('კოუვ კაფე', w / 2, h * 0.52);
    },
  },
  coveCafe: {
    w: 4.0, h: 0.62,
    paint(ctx, w, h, lit) {
      bgFill(ctx, w, h, '#141414', lit);
      ctx.fillStyle = '#f4f4f2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      font(ctx, 'bold', h * 0.56, 'Georgia, "Times New Roman", serif', 'COVE  CAFE', w * 0.9);
      ctx.fillText('COVE  CAFE', w / 2, h * 0.54);
    },
  },
  bladeStar: {
    // the restaurant's round blade sign: black, a white star
    w: 0.6, h: 0.6,
    paint(ctx, w, h, lit) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = lit ? '#2a2a2a' : '#141414';
      ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.47, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f4f4f2';
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 4, r = k % 2 ? w * 0.1 : w * 0.3;
        ctx.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
    },
  },
  yellowDisc: {
    w: 0.55, h: 0.55,
    paint(ctx, w, h, lit) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = lit ? '#ffd24a' : '#f0bf2a';
      ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.47, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2b2620'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      font(ctx, 'bold', h * 0.46, HEAVY, 'F', w * 0.6);
      ctx.fillText('F', w / 2, h * 0.54);
    },
  },
  greenBox: {
    // the street-side shop's sign boxes: dark green, a white leaf
    w: 2.1, h: 0.6, box: 0x1f4a33,
    paint(ctx, w, h, lit) {
      bgFill(ctx, w, h, '#1f4a33', lit);
      ctx.fillStyle = lit ? '#e6ffe9' : '#f2f5f0';
      ctx.beginPath(); ctx.ellipse(w / 2 - h * 0.1, h / 2, h * 0.3, h * 0.14, -0.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(w / 2 + h * 0.16, h / 2, h * 0.24, h * 0.11, 0.6, 0, Math.PI * 2); ctx.fill();
    },
  },
  cafe: {
    w: 3.2, h: 0.6,
    paint(ctx, w, h, lit) {
      bgFill(ctx, w, h, '#3b2a20', lit);
      ctx.fillStyle = '#f0dcc0';
      rrect(ctx, h * 0.3, h * 0.3, h * 0.38, h * 0.36, h * 0.08); ctx.fill();          // a cup
      ctx.lineWidth = h * 0.06; ctx.strokeStyle = '#f0dcc0';
      ctx.beginPath(); ctx.arc(h * 0.72, h * 0.46, h * 0.09, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      font(ctx, 'bold', h * 0.46, SANS, 'ყავა · COFFEE', w - h * 1.2);
      ctx.fillText('ყავა · COFFEE', h * 1.0, h * 0.52);
    },
  },
};
