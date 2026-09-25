// Flow-field navigation for the horde. A 1 m grid over the complex and its edges; every few
// hundred milliseconds a Dijkstra pass from the player's cell gives each cell its distance to
// the player, and zombies walk downhill. The pass is time-sliced so it never causes a hitch.

const SQ2 = 14, ONE = 10;
const DIRS = [[1, 0, ONE], [-1, 0, ONE], [0, 1, ONE], [0, -1, ONE], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];

export class NavGrid {
  // filter(item): which colliders block (default: the ground level); inside(x, z): cells where it
  // returns false are blocked (used for the car-park level, which only exists inside its outline)
  // pad: extra clearance round boxes (parked cars, columns) so routes keep to proper aisles
  constructor(colliders, { minX = -178, minZ = -178, size = 356, cell = 1, filter = null, inside = null, pad = 0 } = {}) {
    this.minX = minX; this.minZ = minZ; this.cell = cell;
    this.n = Math.ceil(size / cell);
    this.filter = filter; this.inside = inside; this.pad = pad;
    // (the ground is one stretch of land: goals off it are met at its edge; see request(). The car
    // parks are islands of their own, none of them any more the land than the others)
    this.oneLand = !inside;
    const N = this.n * this.n;
    this.blocked = new Uint8Array(N);
    if (inside) for (let i = 0; i < N; i++) { const c = this.center(i, {}); if (!inside(c.x, c.z)) this.blocked[i] = 1; }
    this.dist = new Uint32Array(N).fill(0xffffffff);
    this.work = new Uint32Array(N);
    this.heap = new Int32Array(N * 4);
    this.heapKey = new Uint32Array(N * 4);
    this.target = -1;
    this.busy = false;
    this.rasterize(colliders);
  }

  idx(x, z) {
    const ix = Math.floor((x - this.minX) / this.cell), iz = Math.floor((z - this.minZ) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return -1;
    return iz * this.n + ix;
  }

  center(i, out) {
    out.x = this.minX + ((i % this.n) + 0.5) * this.cell;
    out.z = this.minZ + (Math.floor(i / this.n) + 0.5) * this.cell;
    return out;
  }

  // Recompute blocked cells in a small box (a car was driven off / parked).
  refreshArea(col, x0, z0, x1, z1) {
    const n = this.n, c = this.cell;
    const ix0 = Math.max(0, Math.floor((x0 - this.minX) / c)), ix1 = Math.min(n - 1, Math.floor((x1 - this.minX) / c));
    const iz0 = Math.max(0, Math.floor((z0 - this.minZ) / c)), iz1 = Math.min(n - 1, Math.floor((z1 - this.minZ) / c));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * n + ix;
      this.blocked[i] = this.inside && !this.inside(this.minX + (ix + 0.5) * c, this.minZ + (iz + 0.5) * c) ? 1 : 0;
    }
    const items = [];
    col.forEachNear(x0 - 2, z0 - 2, x1 + 2, z1 + 2, (o) => { items.push(o); });
    this.rasterize({ items }, [ix0, iz0, ix1, iz1]);
    this.landDirty = true;
  }

  rasterize(col, clip = null) {
    const n = this.n, c = this.cell, b = this.blocked;
    const mark = (x, z, r) => {
      const ix0 = Math.floor((x - r - this.minX) / c), ix1 = Math.floor((x + r - this.minX) / c);
      const iz0 = Math.floor((z - r - this.minZ) / c), iz1 = Math.floor((z + r - this.minZ) / c);
      for (let iz = Math.max(0, iz0); iz <= Math.min(n - 1, iz1); iz++) {
        for (let ix = Math.max(0, ix0); ix <= Math.min(n - 1, ix1); ix++) {
          if (clip && (ix < clip[0] || iz < clip[1] || ix > clip[2] || iz > clip[3])) continue;
          const cx = this.minX + (ix + 0.5) * c, cz = this.minZ + (iz + 0.5) * c;
          if ((cx - x) ** 2 + (cz - z) ** 2 <= r * r) b[iz * n + ix] = 1;
        }
      }
    };
    for (const o of col.items) {
      if (this.filter) { if (!this.filter(o)) continue; }
      else {
        if (!o.walk || o.kind === 'playerOnly' || o.kind === 'barrier') continue;
        if (o.maxY < 0.35 && o.kind !== 'pool') continue; // low curbs, and anything underground
      }
      if (o.t === 0) {
        for (let s = 0; s <= o.len; s += 0.3) mark(o.x1 + o.dx * s, o.z1 + o.dz * s, 0.55);
      } else if (o.t === 1) {
        mark(o.x, o.z, o.r + 0.35);
      } else {
        const step = 0.4;
        for (let u = -o.hw; u <= o.hw + 1e-6; u += step) for (let v = -o.hd; v <= o.hd + 1e-6; v += step) {
          mark(o.x + u * o.c - v * o.s, o.z + u * o.s + v * o.c, 0.5 + this.pad);
        }
      }
    }
  }

  // Start (or restart) a field towards world point (x, z), plus any extra goal points
  // (e.g. every lobby door of the building whose roof the player is on).
  request(x, z, extra = null) {
    const t = this.idx(x, z);
    if (t < 0) return;
    if (this.busy && t === this.pendingTarget) return;
    this.pendingTarget = t;
    this.busy = true;
    this.work.fill(0xffffffff);
    this.hs = 0;
    const goals = [t];
    if (extra) for (const p of extra) { const j = this.idx(p.x, p.z); if (j >= 0) goals.push(j); }
    // A goal the horde can't walk to (a player up on a car or on a roof with no stairs, or in a
    // walled-in corner) starts from the nearest cells it can reach instead: they gather round
    // underneath. (Seeded from the goal alone, the field would stop at the car or the walls, and
    // with nobody else to go for the whole horde would stand about.)
    const land = this.oneLand ? this.mainland() : null, id = this.landId, seeds = [];
    for (const g of goals) {
      if (land ? land[g] === id : !this.blocked[g]) seeds.push(g, 0);
      else this.nearestLand(g, seeds);
    }
    for (let k = 0; k < seeds.length; k += 2) {
      const s = seeds[k], c = seeds[k + 1];
      if (c < this.work[s]) { this.work[s] = c; this.push(s, c); }
    }
  }

  // The biggest stretch of walkable cells joined together: the ground the horde can get about on
  // (worked out again after a car parks or drives off). Returns each cell's patch; landId is its.
  mainland() {
    if (this.land && !this.landDirty) return this.land;
    const n = this.n, N = n * n, b = this.blocked;
    const comp = this.land || (this.land = new Int32Array(N));
    const stack = this.landStack || (this.landStack = new Int32Array(N));
    comp.fill(0);
    let id = 0, best = 0, bestN = 0;
    for (let s = 0; s < N; s++) {
      if (b[s] || comp[s]) continue;
      id++;
      let sp = 0, cnt = 0;
      stack[sp++] = s; comp[s] = id;
      while (sp) {
        const i = stack[--sp], ix = i % n;
        cnt++;
        if (ix > 0 && !b[i - 1] && !comp[i - 1]) { comp[i - 1] = id; stack[sp++] = i - 1; }
        if (ix < n - 1 && !b[i + 1] && !comp[i + 1]) { comp[i + 1] = id; stack[sp++] = i + 1; }
        if (i >= n && !b[i - n] && !comp[i - n]) { comp[i - n] = id; stack[sp++] = i - n; }
        if (i < N - n && !b[i + n] && !comp[i + n]) { comp[i + n] = id; stack[sp++] = i + n; }
      }
      if (cnt > bestN) { bestN = cnt; best = id; }
    }
    this.landId = best;
    this.landDirty = false;
    return comp;
  }

  // the mainland cells nearest to cell g (out to 40 m; in a car park, the nearest free ones), onto
  // seeds as [cell, cost] pairs (all at 0: a zombie's distance on the field is then how far it is
  // from getting as close as it can)
  nearestLand(g, seeds) {
    const n = this.n, land = this.oneLand ? this.land : null, id = this.landId, b = this.blocked, gx = g % n, gz = (g / n) | 0;
    let found = -1;
    for (let r = 1; r <= 40 && (found < 0 || r <= found + 1); r++) {
      for (let dz = -r; dz <= r; dz++) {
        const edge = dz === -r || dz === r;
        for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r) {
          const jx = gx + dx, jz = gz + dz;
          if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
          const j = jz * n + jx;
          if (land ? land[j] !== id : b[j]) continue;
          seeds.push(j, 0);
          if (found < 0) found = r;
        }
      }
    }
  }

  push(i, k) {
    let p = this.hs++;
    const h = this.heap, hk = this.heapKey;
    while (p > 0) {
      const parent = (p - 1) >> 1;
      if (hk[parent] <= k) break;
      h[p] = h[parent]; hk[p] = hk[parent]; p = parent;
    }
    h[p] = i; hk[p] = k;
  }

  pop() {
    const h = this.heap, hk = this.heapKey;
    const top = h[0];
    const last = h[--this.hs], lk = hk[this.hs];
    let p = 0;
    for (;;) {
      let c = 2 * p + 1;
      if (c >= this.hs) break;
      if (c + 1 < this.hs && hk[c + 1] < hk[c]) c++;
      if (hk[c] >= lk) break;
      h[p] = h[c]; hk[p] = hk[c]; p = c;
    }
    h[p] = last; hk[p] = lk;
    return top;
  }

  // Advance the running Dijkstra by up to `budget` node expansions. Returns true when done.
  step(budget = 12000) {
    if (!this.busy) return true;
    const n = this.n, w = this.work, b = this.blocked;
    while (this.hs > 0 && budget-- > 0) {
      const d = this.heapKey[0];
      const i = this.pop();
      if (d > w[i]) continue;
      const ix = i % n, iz = (i / n) | 0;
      for (let k = 0; k < 8; k++) {
        const [dx, dz, cost] = DIRS[k];
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
        const j = jz * n + jx;
        if (b[j]) continue;
        if (dx && dz && (b[iz * n + jx] || b[jz * n + ix])) continue; // no corner cutting
        const nd = d + cost;
        if (nd < w[j]) { w[j] = nd; if (this.hs < this.heap.length) this.push(j, nd); }
      }
    }
    if (this.hs === 0) {
      // swap buffers: the finished field becomes the live one
      const t = this.dist; this.dist = this.work; this.work = t;
      this.target = this.pendingTarget;
      this.busy = false;
      return true;
    }
    return false;
  }

  // Direction to walk from world point (x, z). Writes into out {x, z}; returns false if unknown.
  direction(x, z, out) {
    const i = this.idx(x, z);
    if (i < 0) return false;
    const n = this.n, d = this.dist;
    let best = d[i], bx = 0, bz = 0;
    const ix = i % n, iz = (i / n) | 0;
    for (let k = 0; k < 8; k++) {
      const [dx, dz] = DIRS[k];
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
      const j = jz * n + jx;
      if (d[j] < best && !(dx && dz && (this.blocked[iz * n + jx] || this.blocked[jz * n + ix]))) { best = d[j]; bx = dx; bz = dz; }
    }
    if (bx === 0 && bz === 0) return false;
    const L = Math.hypot(bx, bz);
    out.x = bx / L; out.z = bz / L;
    return true;
  }

  distanceAt(x, z) {
    const i = this.idx(x, z);
    return i < 0 ? Infinity : this.dist[i] === 0xffffffff ? Infinity : this.dist[i] / ONE;
  }

  // distanceAt, or in a blocked cell (a zombie pressed up against a wall) the best of its neighbours'
  distanceNear(x, z) {
    const i = this.idx(x, z);
    if (i < 0) return Infinity;
    let d = this.dist[i];
    if (d === 0xffffffff) {
      const n = this.n, ix = i % n, iz = (i / n) | 0;
      for (const [dx, dz] of DIRS) {
        const jx = ix + dx, jz = iz + dz;
        if (jx >= 0 && jz >= 0 && jx < n && jz < n) d = Math.min(d, this.dist[jz * n + jx]);
      }
    }
    return d === 0xffffffff ? Infinity : d / ONE;
  }

  // Is the straight line between two points free of walk-blocking cells (fences, walls, cars)?
  lineWalkable(x1, z1, x2, z2) {
    const d = Math.hypot(x2 - x1, z2 - z1), n = Math.ceil(d / 0.5);
    for (let i = 1; i < n; i++) {
      const t = i / n, j = this.idx(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t);
      if (j < 0 || this.blocked[j]) return false;
    }
    return true;
  }

  walkable(x, z) {
    const i = this.idx(x, z);
    return i >= 0 && !this.blocked[i];
  }

  // on the ground the horde (and everyone) can get about on: not inside a building's walls, not in
  // a walled-in corner
  onLand(x, z) {
    const i = this.idx(x, z);
    return i >= 0 && this.mainland()[i] === this.landId;
  }
}
