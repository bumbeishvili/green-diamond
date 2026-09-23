// Static collision world in the three.js ground plane (x, z).
// Items are vertical extrusions: wall segments, cylinders and oriented boxes, each with a
// vertical span [minY, maxY]. Used for player/zombie movement and bullet ray tests.

const SEG = 0, CIR = 1, BOX = 2;

export class Colliders {
  constructor({ minX = -240, minZ = -240, size = 480, cell = 4 } = {}) {
    this.minX = minX; this.minZ = minZ; this.cell = cell;
    this.n = Math.ceil(size / cell);
    this.cells = Array.from({ length: this.n * this.n }, () => []);
    this.items = [];
    this.stamp = new Uint32Array(1024);
    this.tick = 1;
  }

  _cellRange(x0, z0, x1, z1) {
    const c = this.cell, n = this.n;
    const ix0 = Math.max(0, Math.floor((Math.min(x0, x1) - this.minX) / c));
    const iz0 = Math.max(0, Math.floor((Math.min(z0, z1) - this.minZ) / c));
    const ix1 = Math.min(n - 1, Math.floor((Math.max(x0, x1) - this.minX) / c));
    const iz1 = Math.min(n - 1, Math.floor((Math.max(z0, z1) - this.minZ) / c));
    return [ix0, iz0, ix1, iz1];
  }

  _insert(item, x0, z0, x1, z1) {
    const id = this.items.length;
    item.id = id;
    this.items.push(item);
    if (this.stamp.length <= id) {
      const s = new Uint32Array(this.stamp.length * 2);
      s.set(this.stamp);
      this.stamp = s;
    }
    const [ix0, iz0, ix1, iz1] = this._cellRange(x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5);
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) this.cells[iz * this.n + ix].push(id);
    return item;
  }

  addSegment(x1, z1, x2, z2, { height = 200, minY = -20, kind = 'wall', walk = true, shoot = true } = {}) {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    if (len < 1e-3) return null;
    return this._insert({ t: SEG, x1, z1, x2, z2, dx: dx / len, dz: dz / len, len, minY, maxY: height, kind, walk, shoot },
      Math.min(x1, x2), Math.min(z1, z2), Math.max(x1, x2), Math.max(z1, z2));
  }

  addPolyline(pts, opts) { for (let i = 0; i < pts.length - 1; i++) this.addSegment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], opts); }
  addRing(pts, opts) { this.addPolyline([...pts, pts[0]], opts); }

  addCircle(x, z, r, { height = 3, minY = -20, kind = 'post', walk = true, shoot = true } = {}) {
    return this._insert({ t: CIR, x, z, r, minY, maxY: height, kind, walk, shoot }, x - r, z - r, x + r, z + r);
  }

  // Oriented box: centre, half extents along its local x (hw) and z (hd), rotation about y.
  addBox(x, z, hw, hd, angle, { height = 1.5, minY = -20, kind = 'box', walk = true, shoot = true } = {}) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const ex = Math.abs(c) * hw + Math.abs(s) * hd, ez = Math.abs(s) * hw + Math.abs(c) * hd;
    return this._insert({ t: BOX, x, z, hw, hd, c, s, minY, maxY: height, kind, walk, shoot }, x - ex, z - ez, x + ex, z + ez);
  }

  // Visit unique items near an AABB.
  forEachNear(x0, z0, x1, z1, fn) {
    const tick = ++this.tick;
    const [ix0, iz0, ix1, iz1] = this._cellRange(x0, z0, x1, z1);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const cell = this.cells[iz * this.n + ix];
        for (let k = 0; k < cell.length; k++) {
          const id = cell[k];
          if (this.stamp[id] === tick) continue;
          this.stamp[id] = tick;
          if (fn(this.items[id]) === false) return;
        }
      }
    }
  }

  // Push a vertical capsule (circle of radius r spanning [y0, y1]) out of everything.
  // Mutates p = {x, z}. Returns true if anything was hit.
  resolve(p, r, y0, y1, iterations = 3, skip = null) {
    let hit = false;
    for (let it = 0; it < iterations; it++) {
      let moved = false;
      this.forEachNear(p.x - r, p.z - r, p.x + r, p.z + r, (o) => {
        if (!o.walk || o.maxY <= y0 + 0.05 || o.minY >= y1) return;
        if (skip && skip[o.kind]) return;
        if (o.t === SEG) {
          const px = p.x - o.x1, pz = p.z - o.z1;
          let t = px * o.dx + pz * o.dz;
          t = Math.max(0, Math.min(o.len, t));
          const cx = o.x1 + o.dx * t, cz = o.z1 + o.dz * t;
          let ddx = p.x - cx, ddz = p.z - cz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < r * r) {
            let d = Math.sqrt(d2);
            if (d < 1e-5) { ddx = -o.dz; ddz = o.dx; d = 1; }
            const push = r - d;
            p.x += (ddx / d) * push; p.z += (ddz / d) * push;
            moved = hit = true;
          }
        } else if (o.t === CIR) {
          const ddx = p.x - o.x, ddz = p.z - o.z, rr = r + o.r;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < rr * rr) {
            const d = Math.sqrt(d2) || 1e-5;
            p.x += (ddx / d) * (rr - d); p.z += (ddz / d) * (rr - d);
            moved = hit = true;
          }
        } else {
          // to box local space
          const lx = (p.x - o.x) * o.c + (p.z - o.z) * o.s;
          const lz = -(p.x - o.x) * o.s + (p.z - o.z) * o.c;
          const qx = Math.max(-o.hw, Math.min(o.hw, lx)), qz = Math.max(-o.hd, Math.min(o.hd, lz));
          let ddx = lx - qx, ddz = lz - qz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < r * r) {
            let nx, nz, push;
            if (d2 > 1e-8) {
              const d = Math.sqrt(d2);
              nx = ddx / d; nz = ddz / d; push = r - d;
            } else {
              // centre inside the box: push out along the shallowest axis
              const px = o.hw - Math.abs(lx), pz = o.hd - Math.abs(lz);
              if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; push = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; push = pz + r; }
            }
            const wx = nx * o.c - nz * o.s, wz = nx * o.s + nz * o.c;
            p.x += wx * push; p.z += wz * push;
            moved = hit = true;
          }
        }
      });
      if (!moved) break;
    }
    return hit;
  }

  // 3D ray vs all shootable items. Returns {t, item, nx, nz} or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, filter = null) {
    const hd = Math.hypot(dx, dz);
    let best = null, bestT = maxDist;
    const test = (o) => {
      if (!o.shoot || (filter && !filter(o))) return;
      let t = Infinity, nx = 0, nz = 0;
      if (o.t === SEG) {
        // ray vs infinite vertical plane through the segment, then bounds
        const sx = o.dx, sz = o.dz;
        const denom = dx * -sz + dz * sx; // dot(dir, normal) with normal (-sz, sx)
        if (Math.abs(denom) < 1e-8) return;
        const tt = ((o.x1 - ox) * -sz + (o.z1 - oz) * sx) / denom;
        if (tt <= 0 || tt >= bestT) return;
        const hx = ox + dx * tt, hz = oz + dz * tt;
        const along = (hx - o.x1) * sx + (hz - o.z1) * sz;
        if (along < 0 || along > o.len) return;
        const hy = oy + dy * tt;
        if (hy < o.minY || hy > o.maxY) return;
        t = tt; nx = -sz; nz = sx;
        if (nx * dx + nz * dz > 0) { nx = -nx; nz = -nz; }
      } else if (o.t === CIR) {
        const fx = ox - o.x, fz = oz - o.z;
        const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - o.r * o.r;
        const disc = b * b - 4 * a * c;
        if (disc < 0 || a < 1e-10) return;
        const tt = (-b - Math.sqrt(disc)) / (2 * a);
        if (tt <= 0 || tt >= bestT) return;
        const hy = oy + dy * tt;
        if (hy < o.minY || hy > o.maxY) return;
        t = tt; nx = (ox + dx * tt - o.x) / o.r; nz = (oz + dz * tt - o.z) / o.r;
      } else {
        // slab test in box local space (x, y, z)
        const lox = (ox - o.x) * o.c + (oz - o.z) * o.s, loz = -(ox - o.x) * o.s + (oz - o.z) * o.c;
        const ldx = dx * o.c + dz * o.s, ldz = -dx * o.s + dz * o.c;
        let tmin = 0, tmax = bestT, axis = -1, sign = 1;
        const slab = (o0, d, lo, hi, ax) => {
          if (Math.abs(d) < 1e-9) return o0 >= lo && o0 <= hi;
          let t1 = (lo - o0) / d, t2 = (hi - o0) / d, s = -1;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
          if (t1 > tmin) { tmin = t1; axis = ax; sign = s; }
          tmax = Math.min(tmax, t2);
          return tmin <= tmax;
        };
        if (!slab(lox, ldx, -o.hw, o.hw, 0) || !slab(oy, dy, o.minY, o.maxY, 1) || !slab(loz, ldz, -o.hd, o.hd, 2)) return;
        if (tmin <= 0 || tmin >= bestT) return;
        t = tmin;
        const lnx = axis === 0 ? sign : 0, lnz = axis === 2 ? sign : 0;
        nx = lnx * o.c - lnz * o.s; nz = lnx * o.s + lnz * o.c;
      }
      if (t < bestT) { bestT = t; best = { t, item: o, nx, nz }; }
    };
    // Walk the grid along the ray (2D DDA).
    const c = this.cell;
    let x = ox, z = oz;
    let ix = Math.floor((x - this.minX) / c), iz = Math.floor((z - this.minZ) / c);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDX = hd > 1e-9 && Math.abs(dx) > 1e-9 ? Math.abs(c / dx) : Infinity;
    const tDZ = hd > 1e-9 && Math.abs(dz) > 1e-9 ? Math.abs(c / dz) : Infinity;
    let tMX = Math.abs(dx) > 1e-9 ? ((stepX > 0 ? (ix + 1) * c + this.minX - x : x - (ix * c + this.minX)) / Math.abs(dx)) : Infinity;
    let tMZ = Math.abs(dz) > 1e-9 ? ((stepZ > 0 ? (iz + 1) * c + this.minZ - z : z - (iz * c + this.minZ)) / Math.abs(dz)) : Infinity;
    const tick = ++this.tick;
    let tCell = 0;
    for (let guard = 0; guard < 400; guard++) {
      if (ix >= 0 && iz >= 0 && ix < this.n && iz < this.n) {
        const cell = this.cells[iz * this.n + ix];
        for (let k = 0; k < cell.length; k++) {
          const id = cell[k];
          if (this.stamp[id] === tick) continue;
          this.stamp[id] = tick;
          test(this.items[id]);
        }
      }
      if (best && best.t <= Math.min(tMX, tMZ)) break;
      if (tMX < tMZ) { tCell = tMX; tMX += tDX; ix += stepX; } else { tCell = tMZ; tMZ += tDZ; iz += stepZ; }
      if (tCell > bestT || tCell > maxDist) break;
    }
    return best;
  }

  // Line of sight between two points at a given height (zombie senses, spawn checks).
  clear(x1, y1, z1, x2, y2, z2) {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1, len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return !this.raycast(x1, y1, z1, dx / len, dy / len, dz / len, len);
  }
}
