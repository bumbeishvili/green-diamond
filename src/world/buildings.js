import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flatGeometry, polyCentroid, pointInPoly, mulberry } from './geom.js';
import { NOISE_GLSL } from './materials.js';

// Green Diamond facades, from the developer's photos:
//  - 'frame'  : 9/11-floor white blocks with thick coloured frames around balcony stacks
//  - 'tower'  : 21-floor warm-grey towers with white balcony frames and a timber pergola crown
//  - 'stripe' : phase-3 blocks, white with full-height coloured balcony stripes
//  - 'twin'   : the two 22-floor stage-2 towers, charcoal with a white balcony frame grid
//  - 'podium' : 2-floor shop podium (Spar, Nikora, 2 Nabiji, 36.6 ...)
//  - 'small'  : pool house / pavilions / guard booths
const FH = 3.05;
const STYLE_ID = { frame: 0, tower: 1, stripe: 2, podium: 3, small: 4, twin: 5 };
const PALETTE = [0xd8262e, 0xee7c3a, 0xf3c318, 0x3cae3f, 0x2a7fd0, 0xd0307f, 0x8a4fb3, 0x7f878c, 0x8fd18a, 0x5aa9e6, 0xe98a5a];
const WHITE = 0xf2f0eb;

function styleOf(b) {
  if (b.group === 'mid') return (b.levels >= 20 ? 'tower' : 'frame');
  if (b.group === 'tower') return 'twin';
  if (b.group === 'north') return 'stripe';
  if (b.group === 'podium' || b.group === 'guard') return 'podium';
  return 'small';
}

export function buildingHeight(b) {
  const style = styleOf(b);
  const gH = style === 'podium' ? 4.2 : style === 'small' ? 3.2 : 3.3;
  const levels = Math.max(1, b.levels || 1);
  return { gH, top: gH + (levels - 1) * FH, levels, style };
}

export function buildBuildings(level, scene, colliders, atmo) {
  const group = new THREE.Group();
  group.name = 'buildings';

  const walls = { pos: [], nor: [], uv: [], edge: [], mask: [] };
  const roofs = [];
  const boxes = [];   // {x,y,z, sx,sy,sz, ry, color}
  const glass = [];   // same layout, glass railings
  const heights = [];

  for (const b of level.buildings) {
    const { gH, top, levels, style } = buildingHeight(b);
    const sid = STYLE_ID[style];
    const pts = b.poly.outer;
    const parapet = style === 'small' ? 0.4 : 1.0;
    const rand = mulberry(b.id % 2147483647);
    heights.push({ id: b.id, top: top + parapet, style });

    // collision: the footprint, full height
    colliders.addRing(pts.map(([x, y]) => [x, -y]), { height: top + parapet, kind: 'building' });

    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.05) continue;
      const tx = (bx - ax) / len, ty = (by - ay) / len;
      const nx = ty, ny = -tx; // outward (CCW ring)
      const bayTarget = (style === 'tower' || style === 'twin') ? 3.2 : style === 'stripe' ? 3.3 : style === 'podium' ? 3.0 : 3.0;
      const nBays = Math.max(1, Math.round(len / bayTarget));
      const bayW = len / nBays;

      // Which bays carry balcony stacks (shared with the shader through a bitmask).
      let mask0 = 0, mask1 = 0;
      const balconyBays = [];
      if (levels >= 5 && len >= 8 && style !== 'podium' && style !== 'small') {
        const every = (style === 'tower' || style === 'twin') ? 3 : style === 'stripe' ? 2 : 3;
        const offset = Math.floor(rand() * every);
        for (let k = 1; k < nBays - 1; k++) {
          if ((k + offset) % every === 0 || (style === 'frame' && rand() < 0.12)) {
            balconyBays.push(k);
            if (k < 24) mask0 += 2 ** k; else if (k < 48) mask1 += 2 ** (k - 24);
          }
        }
      }

      // wall quad
      const y0 = -0.4, y1 = top + parapet;
      const P = (x, y, h) => [x, h, -y];
      const A = P(ax, ay, y0), B = P(bx, by, y0), C = P(bx, by, y1), D = P(ax, ay, y1);
      walls.pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      for (let k = 0; k < 6; k++) {
        walls.nor.push(nx, 0, -ny);
        walls.edge.push(len, nBays, levels, sid);
        walls.mask.push(mask0, mask1, (b.id % 997) + i * 7.31, gH);
      }
      walls.uv.push(0, y0, len, y0, len, y1, 0, y0, len, y1, 0, y1);

      // balcony stacks
      for (const k of balconyBays) {
        const s = (k + 0.5) * bayW;
        const cx = ax + tx * s, cy = ay + ty * s;
        const depth = (style === 'tower' || style === 'twin') ? 1.25 : 1.35;
        const w = bayW - ((style === 'tower' || style === 'twin') ? 0.5 : 0.35);
        const angle = Math.atan2(ny, nx); // rotation.y that points local +x along the outward normal
        const slab = (floor, color) => {
          const h = gH + (floor - 1) * FH;
          boxes.push({ x: cx + nx * depth / 2, y: h - 0.1, z: -(cy + ny * depth / 2), sx: depth, sy: 0.2, sz: w, ry: angle, color });
          glass.push({ x: cx + nx * (depth - 0.04), y: h + 0.52, z: -(cy + ny * (depth - 0.04)), sx: 0.03, sy: 1.0, sz: w - 0.1, ry: angle });
          boxes.push({ x: cx + nx * (depth - 0.03), y: h + 1.05, z: -(cy + ny * (depth - 0.03)), sx: 0.06, sy: 0.05, sz: w - 0.08, ry: angle, color: 0xd9dadc });
        };
        const frame = (f0, f1, color) => {
          const hb = gH + (f0 - 1) * FH - 0.3, ht = gH + (f1) * FH - 0.15;
          const hh = ht - hb, t = 0.32;
          for (const side of [-1, 1]) {
            const ox = cx + tx * side * (bayW / 2 - t / 2), oy = cy + ty * side * (bayW / 2 - t / 2);
            boxes.push({ x: ox + nx * depth / 2, y: hb + hh / 2, z: -(oy + ny * depth / 2), sx: depth + 0.05, sy: hh, sz: t, ry: angle, color });
          }
          boxes.push({ x: cx + nx * depth / 2, y: ht, z: -(cy + ny * depth / 2), sx: depth + 0.05, sy: t, sz: bayW, ry: angle, color });
          boxes.push({ x: cx + nx * depth / 2, y: hb, z: -(cy + ny * depth / 2), sx: depth + 0.05, sy: t, sz: bayW, ry: angle, color });
        };
        if (style === 'frame') {
          // stacks broken into framed groups of 2-4 floors, like the photos
          let f = 1 + Math.floor(rand() * 2);
          while (f <= levels - 1) {
            const n = Math.min(levels - f, 2 + Math.floor(rand() * 3));
            const framed = rand() < 0.8;
            const color = PALETTE[Math.floor(rand() * PALETTE.length)];
            for (let ff = f; ff < f + n; ff++) slab(ff, framed ? WHITE : (rand() < 0.5 ? color : WHITE));
            if (framed) frame(f, f + n - 1, color);
            f += n + (rand() < 0.35 ? 1 : 0);
          }
        } else if (style === 'stripe') {
          const color = PALETTE[Math.floor(rand() * 7)];
          const colored = rand() < 0.7;
          for (let f = 1; f <= levels - 1; f++) slab(f, colored ? color : WHITE);
          if (colored) {
            const hb = gH - 0.3, ht = top - 0.2, hh = ht - hb;
            for (const side of [-1, 1]) {
              const ox = cx + tx * side * (bayW / 2 - 0.15), oy = cy + ty * side * (bayW / 2 - 0.15);
              boxes.push({ x: ox + nx * depth / 2, y: hb + hh / 2, z: -(oy + ny * depth / 2), sx: depth + 0.05, sy: hh, sz: 0.3, ry: angle, color });
            }
          }
        } else if (style === 'tower' || style === 'twin') {
          // twins: flats start on floor 3, above the 2-floor shop podium
          const f0 = style === 'twin' ? 2 : 1;
          for (let f = f0; f <= levels - 1; f++) slab(f, WHITE);
          frame(f0, levels - 1, WHITE);
        }
      }
    }

    // roof slab + rooftop housings + timber pergolas
    roofs.push(flatGeometry([b.poly], top + 0.15, 4));
    const [cx, cy] = polyCentroid(pts);
    if (levels >= 5 && pointInPoly(cx, cy, pts)) {
      const hw = style === 'tower' ? 3 : 2.4;
      const housing = style === 'tower' ? 0x8f877d : style === 'twin' ? 0x3a3b3d : WHITE;
      boxes.push({ x: cx, y: top + 1.6, z: -cy, sx: hw * 2, sy: 3.2, sz: hw * 1.6, ry: rand() * 0.2, color: housing });
      if (style !== 'stripe') pergola(boxes, pts, top + 0.15, rand);
    }
  }

  // --- facade mesh ---
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(walls.pos, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(walls.nor, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(walls.uv, 2));
  wg.setAttribute('aEdge', new THREE.Float32BufferAttribute(walls.edge, 4));
  wg.setAttribute('aMask', new THREE.Float32BufferAttribute(walls.mask, 4));
  fixWindingByNormal(wg);
  const facadeMat = getFacadeMaterial(atmo);
  const facades = new THREE.Mesh(wg, facadeMat);
  facades.castShadow = facades.receiveShadow = true;
  facades.name = 'facades';
  group.add(facades);

  const roofMat = new THREE.MeshStandardMaterial({ color: 0x9a9894, roughness: 0.95 });
  const roofMesh = new THREE.Mesh(mergeGeometries(roofs), roofMat);
  roofMesh.receiveShadow = true;
  roofMesh.castShadow = true;
  group.add(roofMesh);

  // --- instanced balconies, frames, housings ---
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const im = new THREE.InstancedMesh(boxGeo, boxMat, boxes.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  boxes.forEach((bx, i) => {
    e.set(0, bx.ry, 0); q.setFromEuler(e);
    m4.compose(p.set(bx.x, bx.y, bx.z), q, s.set(bx.sx, bx.sy, bx.sz));
    im.setMatrixAt(i, m4);
    im.setColorAt(i, c.setHex(bx.color).convertSRGBToLinear());
  });
  im.castShadow = im.receiveShadow = true;
  im.computeBoundingSphere();
  group.add(im);

  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fb7b4, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.38, depthWrite: false });
  const gm = new THREE.InstancedMesh(boxGeo, glassMat, glass.length);
  glass.forEach((g, i) => {
    e.set(0, g.ry, 0); q.setFromEuler(e);
    m4.compose(p.set(g.x, g.y, g.z), q, s.set(g.sx, g.sy, g.sz));
    gm.setMatrixAt(i, m4);
  });
  gm.renderOrder = 1;
  group.add(gm);

  // --- lobby entrances: dark timber cladding, glass doors, canopy ---
  const doorParts = [];
  for (const d of level.doors) {
    const ang = d.h; // outward normal angle in map coords
    const nx = Math.cos(ang), ny = Math.sin(ang), tx = -ny, ty = nx;
    const ry = Math.atan2(ny, nx);
    const base = { x: d.x, y: d.y };
    const put = (along, out, h, sx, sy, sz, color, kind = 'box') =>
      doorParts.push({ x: base.x + tx * along + nx * out, y: h, z: -(base.y + ty * along + ny * out), sx, sy, sz, ry, color, kind });
    put(0, 0.08, 1.7, 0.16, 3.4, 4.2, 0x7a5236);          // timber panel
    put(0, 0.18, 1.25, 0.06, 2.5, 2.0, 0x30393e, 'glass'); // door glass
    put(0, 1.0, 3.25, 2.0, 0.18, 4.6, 0xe9e7e2);          // canopy
    put(0, 0.2, 2.62, 0.08, 0.1, 2.1, 0xc9cccf);          // door head
  }
  if (doorParts.length) {
    const dm = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 }), doorParts.length);
    doorParts.forEach((bx, i) => {
      e.set(0, bx.ry, 0); q.setFromEuler(e);
      m4.compose(p.set(bx.x, bx.y, bx.z), q, s.set(bx.sx, bx.sy, bx.sz));
      dm.setMatrixAt(i, m4);
      dm.setColorAt(i, c.setHex(bx.color).convertSRGBToLinear());
    });
    dm.castShadow = dm.receiveShadow = true;
    group.add(dm);
  }

  scene.add(group);
  return {
    group, heights,
    update() {
      facadeMat.userData.shader && (facadeMat.userData.shader.uniforms.uLamp.value = atmo.lampLevel);
    },
  };
}

// Timber pergolas on roof terraces (the brown slatted frames in every photo).
function pergola(boxes, pts, h, rand) {
  // pick the longest edge and put a pergola against one of its ends
  let best = 0, bi = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const L = Math.hypot(bx - ax, by - ay);
    if (L > best) { best = L; bi = i; }
  }
  if (best < 10) return;
  const [ax, ay] = pts[bi], [bx, by] = pts[(bi + 1) % pts.length];
  const tx = (bx - ax) / best, ty = (by - ay) / best, nx = ty, ny = -tx; // outward
  const ry = Math.atan2(ny, nx);
  const W = 6.5, D = 3.6, H = 2.7;
  for (const end of rand() < 0.5 ? [0] : [0, 1]) {
    const s0 = end === 0 ? 1.0 : best - 1.0 - W;
    const ox = ax + tx * (s0 + W / 2) - nx * (D / 2 + 0.3), oy = ay + ty * (s0 + W / 2) - ny * (D / 2 + 0.3);
    const wood = 0x6b4630;
    // posts
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const px = ox + tx * a * (W / 2 - 0.1) + nx * b * (D / 2 - 0.1), py = oy + ty * a * (W / 2 - 0.1) + ny * b * (D / 2 - 0.1);
      boxes.push({ x: px, y: h + H / 2, z: -py, sx: 0.14, sy: H, sz: 0.14, ry, color: wood });
    }
    // slats
    for (let k = 0; k <= 12; k++) {
      const a = -W / 2 + (k / 12) * W;
      boxes.push({ x: ox + tx * a, y: h + H, z: -(oy + ty * a), sx: D + 0.3, sy: 0.16, sz: 0.07, ry, color: wood });
    }
    for (const b of [-1, 1]) {
      boxes.push({ x: ox + nx * b * (D / 2 - 0.1), y: h + H - 0.14, z: -(oy + ny * b * (D / 2 - 0.1)), sx: 0.12, sy: 0.14, sz: W + 0.3, ry, color: wood });
    }
  }
}

function fixWindingByNormal(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    fn.crossVectors(b.clone().sub(a), c.clone().sub(a));
    vn.fromBufferAttribute(n, i);
    if (fn.dot(vn) < 0) {
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

let sharedFacade = null;
function getFacadeMaterial(atmo) {
  if (!sharedFacade) sharedFacade = makeFacadeMaterial(atmo);
  return sharedFacade;
}

// Procedural facade: windows, balcony doors, frames, plinth, shopfronts, lit rooms at night.
function makeFacadeMaterial(atmo) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLamp = { value: atmo ? atmo.lampLevel : 0 };
    shader.uniforms.uFH = { value: FH };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aEdge; attribute vec4 aMask;
        varying vec2 vFac; varying vec4 vEdge; varying vec4 vMask; varying float vViewDist;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vFac = uv; vEdge = aEdge; vMask = aMask;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vViewDist = -mvPosition.z;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vFac; varying vec4 vEdge; varying vec4 vMask; varying float vViewDist;
        uniform float uLamp; uniform float uFH;
        ${NOISE_GLSL}
        float bitAt(float m, float i) { return mod(floor(m / exp2(i)), 2.0); }
        // anti-aliased box: 1 inside [a,b] on x and [c,d] on y
        float aaBox(vec2 p, vec4 r, vec2 fw) {
          vec2 lo = smoothstep(r.xz - fw, r.xz + fw, p);
          vec2 hi = 1.0 - smoothstep(r.yw - fw, r.yw + fw, p);
          return lo.x * lo.y * hi.x * hi.y;
        }
        float fh1(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        `)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float edgeLen = vEdge.x, nBays = max(vEdge.y, 1.0), levels = vEdge.z; int style = int(vEdge.w + 0.5);
        float bayW = edgeLen / nBays;
        float gH = vMask.w;
        float top = gH + (levels - 1.0) * uFH;
        float u = vFac.x, v = vFac.y;
        float bay = floor(u / bayW);
        float lx = u - bay * bayW;                  // metres across the bay
        float fl = v < gH ? 0.0 : 1.0 + floor((v - gH) / uFH);
        float ly = v < gH ? v : (v - gH) - (fl - 1.0) * uFH; // metres above this floor's level
        float balc = bay < 24.0 ? bitAt(vMask.x, bay) : bitAt(vMask.y, bay - 24.0);
        vec2 fw = max(fwidth(vec2(u, v)), vec2(0.004)) * 0.8;
        float farFade = smoothstep(0.35, 0.9, fw.x); // pixel bigger than ~35cm: average things out

        vec3 white = vec3(0.84, 0.835, 0.815);
        vec3 wallC = white;
        if (style == 1) wallC = vec3(0.47, 0.44, 0.40);           // warm grey tower cladding
        if (style == 5) wallC = vec3(0.13, 0.135, 0.14);           // charcoal twins
        if (style == 6) wallC = vec3(0.50, 0.49, 0.47);            // raw concrete shell
        if (style == 7) wallC = vec3(0.80, 0.81, 0.82) * (0.92 + 0.08 * step(0.5, fract(vFac.x / 0.9))); // ribbed cladding
        if (style == 8) {                                          // plaster houses in assorted colours
          float hue = fract(vMask.z * 0.137);
          wallC = hue < 0.3 ? vec3(0.86, 0.80, 0.66) : hue < 0.55 ? vec3(0.83, 0.74, 0.62) : hue < 0.75 ? vec3(0.88, 0.86, 0.80) : vec3(0.80, 0.68, 0.62);
        }
        if (style == 3) wallC = vec3(0.86, 0.86, 0.85);
        if (style == 4) wallC = vec3(0.24, 0.45, 0.72);              // the blue courtyard service block
        // subtle plaster variation + grime at the bottom
        float n1 = gdFbm(vec2(u, v) * 0.35 + vMask.z);
        wallC *= 0.95 + n1 * 0.08;
        wallC *= mix(0.82, 1.0, smoothstep(0.0, 1.6, v));

        float glassA = 0.0, frameA = 0.0;
        float roomSeed = fh1(vec3(bay, fl, vMask.z));
        bool aboveTop = v > top;
        if (!aboveTop && style != 4) {
          if (style == 3) {
            // shop podium: storefront glass on the ground floor, ribbon windows above
            if (fl < 0.5) {
              float mull = abs(fract(u / 1.6) - 0.5) * 1.6;
              glassA = aaBox(vec2(lx, v), vec4(0.15, bayW - 0.15, 0.35, 3.3), fw) * smoothstep(0.03, 0.03 + fw.x, mull - 0.04);
              frameA = aaBox(vec2(lx, v), vec4(0.1, bayW - 0.1, 0.3, 3.35), fw) - glassA;
              // fascia band for signs
              if (v > 3.45 && v < 4.1) wallC = vec3(0.16, 0.17, 0.18);
            } else {
              glassA = aaBox(vec2(lx, ly), vec4(0.3, bayW - 0.3, 0.8, 2.5), fw);
              frameA = aaBox(vec2(lx, ly), vec4(0.24, bayW - 0.24, 0.74, 2.56), fw) - glassA;
            }
          } else if (style == 6) {
            float open_ = aaBox(vec2(lx, ly), vec4(0.25, bayW - 0.25, 0.25, uFH - 0.35), fw);
            glassA = 0.0;
            wallC = mix(wallC, vec3(0.05, 0.05, 0.055), open_ * step(0.5, fl));
          } else if (style == 7) {
            // arenas: blank cladding, a glazed band at the base
            if (v < 4.0) glassA = aaBox(vec2(lx, v), vec4(0.1, bayW - 0.1, 0.4, 3.6), fw);
          } else if (bayW > 1.9) {
            float cxm = bayW * 0.5;
            vec4 r;
            if (balc > 0.5 && fl > 0.5) {
              r = vec4(cxm - 0.8, cxm + 0.8, 0.05, 2.45);            // balcony door
            } else if (fl < 0.5) {
              r = vec4(cxm - 0.6, cxm + 0.6, 1.1, 2.6);              // ground floor window
            } else {
              float w = (style == 1 || style == 5) ? 0.62 : 0.55;
              r = vec4(cxm - w, cxm + w, 0.85, 2.45);                // regular window
            }
            float outer = aaBox(vec2(lx, ly), r + vec4(-0.07, 0.07, -0.07, 0.07), fw);
            float inner = aaBox(vec2(lx, ly), r, fw);
            // mullion + transom
            float mull = 1.0 - (1.0 - smoothstep(0.025, 0.025 + fw.x, abs(lx - cxm))) * inner;
            glassA = inner * mull;
            frameA = outer - glassA;
            // window reveal shadow (fake depth)
            wallC *= 1.0 - 0.25 * (aaBox(vec2(lx, ly), r + vec4(-0.2, 0.2, -0.25, 0.1), fw) - outer);
          }
          // stone plinth + slab lines
          if (v < 0.55 && style != 3) wallC = vec3(0.62, 0.60, 0.56) * (0.9 + n1 * 0.2);
        }
        if (aboveTop) wallC *= 0.97;

        // glass: sky reflection handled by PBR; interior tint, curtains, lit rooms at dusk
        vec3 glassC = vec3(0.045, 0.06, 0.07);
        float curtain = step(0.55, roomSeed) * smoothstep(0.35, 0.5, fract(ly / 2.4 + roomSeed));
        glassC = mix(glassC, vec3(0.30, 0.28, 0.25), curtain * 0.25);
        vec3 frameC = style == 5 ? vec3(0.2) : style == 1 ? vec3(0.85) : vec3(0.88, 0.88, 0.87);
        vec3 col = mix(wallC, frameC, clamp(frameA, 0.0, 1.0));
        col = mix(col, glassC, glassA);
        // far away: blend towards the average so the grid doesn't shimmer
        vec3 avg = mix(wallC, glassC, style == 3 ? 0.3 : 0.22);
        col = mix(col, avg, farFade);
        glassA *= 1.0 - farFade;
        diffuseColor.rgb = col;
        float gdGlass = glassA;
        float gdLit = step(0.62, fh1(vec3(bay * 1.7, fl * 3.1, vMask.z * 0.37))) * (style == 4 ? 0.0 : 1.0);
        `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.88, 0.06, gdGlass);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(0.0, 0.55, gdGlass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 warmRoom = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), step(0.8, roomSeed));
        totalEmissiveRadiance += warmRoom * gdLit * gdGlass * uLamp * 1.6;
        // shop fronts glow in the evening
        if (style == 3 && vFac.y < 3.4) totalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * gdGlass * uLamp * 1.2;`);
  };
  mat.customProgramCacheKey = () => 'gd-facade-v4';
  return mat;
}

// ------------------------------------------------------------------------------------------
// Neighbours from OSM: construction shells, the Olympic arenas, private houses.
// ------------------------------------------------------------------------------------------
const ARENA_NAMES = ['ტანვარჯიშის არენა', 'ფრენბურთის არენა'];

export function buildBackdropBuildings(level, scene, colliders, atmo) {
  const group = new THREE.Group();
  group.name = 'backdrop-buildings';
  const walls = { pos: [], nor: [], uv: [], edge: [], mask: [] };
  const roofs = [], pitched = [];
  const sites = [];
  for (const b of level.surroundings.buildings) {
    const pts = b.poly.outer;
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; area += x1 * y2 - x2 * y1; }
    area = Math.abs(area) / 2;
    let style, levels = b.levels, fh = FH, top;
    if (b.kind === 'construction') { style = 6; }
    else if (ARENA_NAMES.includes(b.name) || area > 1800) { style = 7; levels = 1; top = b.height || 14; }
    else if (b.kind === 'grandstand' || b.kind === 'garages' || b.kind === 'service') { style = 6; levels = Math.max(1, levels); }
    else { style = 8; levels = Math.min(levels || 2, 3); }
    const gH = style === 7 ? top : 3.0;
    if (top == null) top = gH + (levels - 1) * fh;
    const parapet = style === 8 ? 0.3 : 0.8;
    const seed = (b.poly.outer[0][0] * 13.7 + b.poly.outer[0][1] * 7.1) % 997;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.05) continue;
      const nx = (by - ay) / len, ny = -(bx - ax) / len;
      const nBays = Math.max(1, Math.round(len / (style === 7 ? 6 : 3.2)));
      const y0 = -0.4, y1 = top + parapet;
      walls.pos.push(ax, y0, -ay, bx, y0, -by, bx, y1, -by, ax, y0, -ay, bx, y1, -by, ax, y1, -ay);
      for (let k = 0; k < 6; k++) {
        walls.nor.push(nx, 0, -ny);
        walls.edge.push(len, nBays, levels, style);
        walls.mask.push(0, 0, seed + i * 3.3, gH);
      }
      walls.uv.push(0, y0, len, y0, len, y1, 0, y0, len, y1, 0, y1);
    }
    if (style === 8 && pts.length <= 6) pitched.push({ pts, top: top + parapet, seed });
    else roofs.push(flatGeometry([b.poly], top + 0.1, 4));
    if (b.kind === 'construction') sites.push({ pts, top, area });
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(walls.pos, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(walls.nor, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(walls.uv, 2));
  wg.setAttribute('aEdge', new THREE.Float32BufferAttribute(walls.edge, 4));
  wg.setAttribute('aMask', new THREE.Float32BufferAttribute(walls.mask, 4));
  fixWindingByNormal(wg);
  const mesh = new THREE.Mesh(wg, getFacadeMaterial(atmo));
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  if (roofs.length) {
    const r = new THREE.Mesh(mergeGeometries(roofs), new THREE.MeshStandardMaterial({ color: 0x8e8c88, roughness: 0.95 }));
    r.receiveShadow = true; group.add(r);
  }
  // hipped tin roofs on the private houses
  const roofCols = [0x8a3b2e, 0x5f6e5a, 0x7b7f84, 0x9a4a32];
  const cone = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1); cone.rotateY(Math.PI / 4); cone.translate(0, 0.5, 0);
  const rm = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3 }), Math.max(1, pitched.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), c = new THREE.Color();
  pitched.forEach((h, i) => {
    let best = 0, ang = 0;
    for (let k = 0; k < h.pts.length; k++) {
      const [ax, ay] = h.pts[k], [bx, by] = h.pts[(k + 1) % h.pts.length];
      const L = Math.hypot(bx - ax, by - ay);
      if (L > best) { best = L; ang = Math.atan2(by - ay, bx - ax); }
    }
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
    for (const [x, y] of h.pts) { const u = x * ca + y * sa, v = -x * sa + y * ca; minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
    const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
    const cx = cu * ca - cv * sa, cy = cu * sa + cv * ca;
    e.set(0, ang, 0); q.setFromEuler(e);
    m4.compose(pv.set(cx, h.top - 0.05, -cy), q, sv.set(maxU - minU + 0.6, 2.2, maxV - minV + 0.6));
    rm.setMatrixAt(i, m4);
    rm.setColorAt(i, c.setHex(roofCols[Math.floor(h.seed) % roofCols.length]).convertSRGBToLinear());
  });
  rm.count = pitched.length;
  rm.castShadow = rm.receiveShadow = true;
  group.add(rm);
  scene.add(group);
  sites.sort((a, b) => b.area - a.area);
  return { group, sites };
}
