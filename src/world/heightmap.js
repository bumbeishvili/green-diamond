import { pointInPoly } from './geom.js';

// Ground height lookup baked by tools/build_level.py (8-bit PNG, h = v / 40 - 4 metres), with the
// corrections made since stamped on top (level.json: heightmap.patches).

export class Heightmap {
  constructor(meta, data) {
    this.res = meta.res;
    this.minX = meta.min[0];
    this.minY = meta.min[1];
    this.size = meta.size;
    this.data = data; // Float32Array size*size, row 0 = north edge
    for (const p of meta.patches || []) this.patch(p);
  }

  static async load(meta) {
    const img = new Image();
    img.src = meta.file;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = meta.size;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, meta.size, meta.size).data;
    const data = new Float32Array(meta.size * meta.size);
    for (let i = 0; i < data.length; i++) data[i] = px[i * 4] / 40 - 4;
    return new Heightmap(meta, data);
  }

  // One correction to the baked map, over a polygon (map coords):
  //  {poly, h}                    level ground at h
  //  {poly, top, bottom, depth}   a ramp sloping from 0 at its top to -depth at its bottom
  // Pixels just outside the polygon that still sit lower (what's left of an old ramp's edge) are
  // brought to the same height, so nothing of the old shape shows through the bilinear lookup.
  patch(p) {
    const pts = p.poly, M = 0.2, ramp = !!p.top;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const [tx, ty] = ramp ? p.top : [0, 0];
    const dx = ramp ? p.bottom[0] - tx : 0, dy = ramp ? p.bottom[1] - ty : 0, L2 = dx * dx + dy * dy || 1;
    const col = (x) => (x - this.minX) / this.res - 0.5, row = (y) => this.size - (y - this.minY) / this.res - 0.5;
    const i0 = Math.max(0, Math.floor(col(x0 - M))), i1 = Math.min(this.size - 1, Math.ceil(col(x1 + M)));
    const j0 = Math.max(0, Math.floor(row(y1 + M))), j1 = Math.min(this.size - 1, Math.ceil(row(y0 - M)));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = this.minX + (i + 0.5) * this.res, y = this.minY + (this.size - j - 0.5) * this.res;
        const k = j * this.size + i;
        const h = ramp ? -Math.min(1, Math.max(0, ((x - tx) * dx + (y - ty) * dy) / L2)) * p.depth : p.h;
        if (pointInPoly(x, y, pts)) this.data[k] = h;
        else if (this.data[k] < Math.min(h, 0) - 0.01 && distToPoly(x, y, pts) < M) this.data[k] = h;
      }
    }
  }

  // Map coordinates (x = east, y = north). Bilinear.
  at(x, y) {
    const fx = (x - this.minX) / this.res - 0.5;
    const fy = this.size - (y - this.minY) / this.res - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 >= this.size - 1 || y0 >= this.size - 1) return 0;
    const tx = fx - x0, ty = fy - y0;
    const i = y0 * this.size + x0, d = this.data, s = this.size;
    const a = d[i] * (1 - tx) + d[i + 1] * tx;
    const b = d[i + s] * (1 - tx) + d[i + s + 1] * tx;
    return a * (1 - ty) + b * ty;
  }

  // Highest value in a small disc: used so feet don't sink at curb edges.
  maxAround(x, y, r) {
    let h = this.at(x, y);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      h = Math.max(h, this.at(x + Math.cos(a) * r, y + Math.sin(a) * r));
    }
    return h;
  }

  // Three.js coordinate helper.
  atWorld(wx, wz) { return this.at(wx, -wz); }
}

// Distance from a point to the edges of a polygon.
function distToPoly(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return best;
}
