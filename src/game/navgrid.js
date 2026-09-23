// Flow-field navigation for the horde. A 1 m grid over the complex and its edges; every few
// hundred milliseconds a Dijkstra pass from the player's cell gives each cell its distance to
// the player, and zombies walk downhill. The pass is time-sliced so it never causes a hitch.

const SQ2 = 14, ONE = 10;
const DIRS = [[1, 0, ONE], [-1, 0, ONE], [0, 1, ONE], [0, -1, ONE], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];

export class NavGrid {
  constructor(colliders, { minX = -178, minZ = -178, size = 356, cell = 1 } = {}) {
    this.minX = minX; this.minZ = minZ; this.cell = cell;
    this.n = Math.ceil(size / cell);
    const N = this.n * this.n;
    this.blocked = new Uint8Array(N);
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

  rasterize(col) {
    const n = this.n, c = this.cell, b = this.blocked;
    const mark = (x, z, r) => {
      const ix0 = Math.floor((x - r - this.minX) / c), ix1 = Math.floor((x + r - this.minX) / c);
      const iz0 = Math.floor((z - r - this.minZ) / c), iz1 = Math.floor((z + r - this.minZ) / c);
      for (let iz = Math.max(0, iz0); iz <= Math.min(n - 1, iz1); iz++) {
        for (let ix = Math.max(0, ix0); ix <= Math.min(n - 1, ix1); ix++) {
          const cx = this.minX + (ix + 0.5) * c, cz = this.minZ + (iz + 0.5) * c;
          if ((cx - x) ** 2 + (cz - z) ** 2 <= r * r) b[iz * n + ix] = 1;
        }
      }
    };
    for (const o of col.items) {
      if (!o.walk || o.kind === 'playerOnly' || o.kind === 'barrier') continue;
      if (o.maxY < 0.35 && o.kind !== 'pool') continue; // low curbs etc.
      if (o.t === 0) {
        for (let s = 0; s <= o.len; s += 0.3) mark(o.x1 + o.dx * s, o.z1 + o.dz * s, 0.55);
      } else if (o.t === 1) {
        mark(o.x, o.z, o.r + 0.35);
      } else {
        const step = 0.4;
        for (let u = -o.hw; u <= o.hw + 1e-6; u += step) for (let v = -o.hd; v <= o.hd + 1e-6; v += step) {
          mark(o.x + u * o.c - v * o.s, o.z + u * o.s + v * o.c, 0.5);
        }
      }
    }
  }

  // Start (or restart) a field towards world point (x, z).
  request(x, z) {
    const t = this.idx(x, z);
    if (t < 0) return;
    if (this.busy && t === this.pendingTarget) return;
    this.pendingTarget = t;
    this.busy = true;
    this.work.fill(0xffffffff);
    this.hs = 0;
    // if the player stands in a blocked cell (next to a wall), seed from free neighbours
    const seeds = [t];
    if (this.blocked[t]) for (const [dx, dz] of DIRS) { const j = t + dx + dz * this.n; if (j >= 0 && j < this.work.length && !this.blocked[j]) seeds.push(j); }
    for (const s of seeds) { this.work[s] = 0; this.push(s, 0); }
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
}
