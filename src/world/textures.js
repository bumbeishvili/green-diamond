import * as THREE from 'three';

// PBR texture sets live in assets/textures/<name>/{color,normal,roughness,ao}.jpg.
// If a set is missing, a procedural stand-in is generated so the game still runs.

const loader = new THREE.TextureLoader();
let maxAniso = 4;
export function setAnisotropy(a) { maxAniso = a; }

function loadTex(url) {
  return new Promise((resolve) => {
    loader.load(url, (t) => resolve(t), undefined, () => resolve(null));
  });
}

function prep(t, srgb) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const cache = new Map();

export async function pbr(name) {
  if (cache.has(name)) return cache.get(name);
  const p = (async () => {
    const base = `assets/textures/${name}/`;
    const [map, normalMap, roughnessMap, aoMap] = await Promise.all([
      loadTex(base + 'color.jpg'), loadTex(base + 'normal.jpg'),
      loadTex(base + 'roughness.jpg'), loadTex(base + 'ao.jpg'),
    ]);
    if (!map) return procedural(name);
    const set = { map: prep(map, true) };
    if (normalMap) set.normalMap = prep(normalMap, false);
    if (roughnessMap) set.roughnessMap = prep(roughnessMap, false);
    if (aoMap) set.aoMap = prep(aoMap, false);
    set.source = 'file';
    return set;
  })();
  cache.set(name, p);
  return p;
}

// ------------------------------------------------------------------------------------------
// Procedural fallbacks
// ------------------------------------------------------------------------------------------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function valueNoise(size, cell, seed) {
  const r = rng(seed);
  const n = Math.ceil(size / cell) + 1;
  const g = new Float32Array(n * n).map(() => r());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / cell, fy = y / cell;
      const x0 = Math.floor(fx) % (n - 1), y0 = Math.floor(fy) % (n - 1);
      const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const x1 = (x0 + 1) % (n - 1), y1 = (y0 + 1) % (n - 1);
      const a = g[y0 * n + x0] * (1 - sx) + g[y0 * n + x1] * sx;
      const b = g[y1 * n + x0] * (1 - sx) + g[y1 * n + x1] * sx;
      out[y * size + x] = a * (1 - sy) + b * sy;
    }
  }
  return out;
}

function fbm(size, seed, octaves = 4, base = 64) {
  const out = new Float32Array(size * size);
  let amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, Math.max(2, base >> o), seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  return prep(t, srgb);
}

function fromHeight(size, h, strength = 2.0) {
  // Height field (0..1) -> tangent-space normal map (OpenGL convention).
  return canvasTex(size, (ctx) => {
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
        const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
        let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len; ny /= len; nz /= len;
        const i = (y * size + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, false);
}

function paint(size, fn) {
  return canvasTex(size, (ctx) => {
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, g, b] = fn(x, y);
        const i = (y * size + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

function gray(size, fn) {
  const t = paint(size, (x, y) => { const v = fn(x, y) * 255; return [v, v, v]; });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function procedural(name) {
  const S = 256;
  const n = fbm(S, name.length * 977, 5, 64);
  const fine = fbm(S, name.length * 331 + 7, 3, 8);
  let color, height, rough;
  switch (name) {
    case 'asphalt':
      color = (x, y) => { const v = 58 + n[y * S + x] * 30 + fine[y * S + x] * 26; return [v, v, v + 3]; };
      height = fine; rough = () => 0.9;
      break;
    case 'pavers':
    case 'pavers_alt': {
      const bw = 32, bh = 16;
      const h = new Float32Array(S * S);
      color = (x, y) => {
        const row = Math.floor(y / bh), off = (row % 2) * (bw / 2);
        const gx = (x + off) % bw, gy = y % bh;
        const joint = gx < 2 || gy < 2;
        const brick = Math.floor((x + off) / bw) * 7 + row * 13;
        const tint = (Math.sin(brick * 12.9898) * 43758.5453) % 1;
        const base = name === 'pavers' ? [150, 146, 140] : [168, 140, 118];
        const k = joint ? 0.55 : 0.88 + Math.abs(tint) * 0.18 + fine[y * S + x] * 0.12;
        h[y * S + x] = joint ? 0 : 0.8 + fine[y * S + x] * 0.2;
        return base.map((c) => c * k);
      };
      paint(S, color); // fill h
      height = h; rough = () => 0.85;
      break;
    }
    case 'grass':
      color = (x, y) => { const a = n[y * S + x], b = fine[y * S + x]; return [58 + a * 30 + b * 20, 92 + a * 45 + b * 35, 36 + a * 14]; };
      height = fine; rough = () => 0.95;
      break;
    case 'soil':
      color = (x, y) => { const a = n[y * S + x], b = fine[y * S + x]; return [104 + a * 40 + b * 20, 84 + a * 32 + b * 16, 62 + a * 22]; };
      height = n; rough = () => 0.97;
      break;
    case 'deck': {
      const tw = 64;
      color = (x, y) => {
        const joint = x % tw < 2 || y % tw < 2;
        const v = joint ? 170 : 222 + fine[y * S + x] * 18 + n[y * S + x] * 10;
        return [v, v - 6, v - 16];
      };
      height = fine; rough = () => 0.6;
      break;
    }
    case 'pool_tiles': {
      const tw = 16;
      color = (x, y) => {
        const joint = x % tw < 1 || y % tw < 1;
        const t = ((Math.floor(x / tw) * 31 + Math.floor(y / tw) * 17) % 7) / 7;
        return joint ? [210, 225, 230] : [40 + t * 25, 140 + t * 30, 190 + t * 25];
      };
      height = fine; rough = () => 0.25;
      break;
    }
    case 'concrete':
    default:
      color = (x, y) => { const v = 150 + n[y * S + x] * 35 + fine[y * S + x] * 18; return [v, v - 2, v - 6]; };
      height = fine; rough = () => 0.85;
      break;
  }
  const map = paint(S, color);
  const normalMap = fromHeight(S, height, name.startsWith('pavers') ? 6 : 2.5);
  const roughnessMap = gray(S, rough);
  return { map, normalMap, roughnessMap, source: 'procedural' };
}

// Shared radial gradient (light pools, blob shadows, blood).
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  return canvasTex(size, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}
