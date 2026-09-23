import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Level polygons are {outer: [[x,y]...], holes: [[[x,y]...]]} in map coords (x east, y north).
// Three.js world: (x, height, z = -y).

export function shapeFromPoly(p) {
  const s = new THREE.Shape(p.outer.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of p.holes || []) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
}

// Horizontal surface at height y. UVs are world metres / uvScale.
export function flatGeometry(polys, y, uvScale = 1) {
  const parts = [];
  for (const p of polys) {
    const g = new THREE.ShapeGeometry(shapeFromPoly(p));
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / uvScale, -pos.getZ(i) / uvScale);
    parts.push(g);
  }
  return parts.length ? mergeGeometries(parts.map(toNonIndexedIfNeeded)) : new THREE.BufferGeometry();
}

function toNonIndexedIfNeeded(g) { return g.index ? g.toNonIndexed() : g; }

// Vertical faces along every ring of the polygons, from y0 up to y1, facing outward.
export function sideGeometry(polys, y0, y1, uvScale = 1) {
  const pos = [], nor = [], uv = [];
  const ring = (pts) => {
    let u = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-4) continue;
      // outward normal in map coords for CCW outer / CW hole rings: (dy, -dx)
      const nx = (by - ay) / len, ny = -(bx - ax) / len;
      const A = [ax, y0, -ay], B = [bx, y0, -by], C = [bx, y1, -by], D = [ax, y1, -ay];
      // winding so that the face normal points to (nx, 0, -ny)
      pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      for (let k = 0; k < 6; k++) nor.push(nx, 0, -ny);
      const u0 = u / uvScale, u1 = (u + len) / uvScale, v0 = y0 / uvScale, v1 = y1 / uvScale;
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      u += len;
    }
  };
  for (const p of polys) {
    ring(p.outer);
    for (const h of p.holes || []) ring(h);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fixWinding(g);
  return g;
}

// Make triangle winding agree with the stored normals (so front faces face outward).
export function fixWinding(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    fn.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    vn.fromBufferAttribute(n, i);
    if (fn.dot(vn) < 0) {
      // swap b and c (positions, normals, uvs)
      for (const attr of Object.values(g.attributes)) {
        const s = attr.itemSize;
        for (let k = 0; k < s; k++) {
          const t = attr.array[(i + 1) * s + k];
          attr.array[(i + 1) * s + k] = attr.array[(i + 2) * s + k];
          attr.array[(i + 2) * s + k] = t;
        }
      }
    }
  }
}

// A ribbon along a polyline (roads outside the complex, paint lines).
export function ribbonGeometry(line, width, y, uvScale = 1) {
  const pos = [], uv = [], nor = [];
  let u = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-4) continue;
    const nx = -(by - ay) / len * width / 2, ny = (bx - ax) / len * width / 2;
    const P = (x, yy) => [x, y, -yy];
    const A = P(ax + nx, ay + ny), B = P(ax - nx, ay - ny), C = P(bx - nx, by - ny), D = P(bx + nx, by + ny);
    pos.push(...A, ...B, ...C, ...A, ...C, ...D);
    const u0 = u / uvScale, u1 = (u + len) / uvScale, w = width / uvScale;
    uv.push(0, u0, w, u0, w, u1, 0, u0, w, u1, 0, u1);
    for (let k = 0; k < 6; k++) nor.push(0, 1, 0);
    u += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fixWinding(g);
  return g;
}

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function polyCentroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Deterministic hash -> [0,1)
export function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
