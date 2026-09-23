// Ground height lookup baked by tools/build_level.py (8-bit PNG, h = v / 40 - 4 metres).

export class Heightmap {
  constructor(meta, data) {
    this.res = meta.res;
    this.minX = meta.min[0];
    this.minY = meta.min[1];
    this.size = meta.size;
    this.data = data; // Float32Array size*size, row 0 = north edge
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
