import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flatGeometry, ribbonGeometry, mulberry } from './geom.js';

// Far backdrop: real terrain (AWS terrain tiles) draped with Sentinel-2 imagery, the
// Tbilisi skyline (OSM high-rises within 5 km), tower cranes over the construction sites,
// and across Bob Walsh Street the Olympic sports fields, the sandy lot where the lorries park
// opposite Gate 1, the lawns and road signs opposite Gate 2 (the gate photospheres, the satellite).
const HALF = 18000, SITE_ELEV = 419;

async function loadTerrain() {
  const img = new Image();
  img.src = 'data/terrain.png';
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  const N = img.width, h = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) h[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 10 - 100 - SITE_ELEV;
  const sample = (x, y) => {
    const fx = (x + HALF) / (2 * HALF) * (N - 1), fy = (HALF - y) / (2 * HALF) * (N - 1);
    const ix = Math.max(0, Math.min(N - 2, Math.floor(fx))), iy = Math.max(0, Math.min(N - 2, Math.floor(fy)));
    const tx = fx - ix, ty = fy - iy;
    return (h[iy * N + ix] * (1 - tx) + h[iy * N + ix + 1] * tx) * (1 - ty) + (h[(iy + 1) * N + ix] * (1 - tx) + h[(iy + 1) * N + ix + 1] * tx) * ty;
  };
  return sample;
}

// Height of the far terrain relative to the complex, flattened near the site.
function flatten(r) { return THREE.MathUtils.smoothstep(r, 520, 1600); }

export async function buildSurroundings(level, scene, atmo, backdropSites) {
  const group = new THREE.Group();
  group.name = 'surroundings';
  const sample = await loadTerrain();
  const terrainH = (x, y) => {
    const r = Math.hypot(x, y);
    return sample(x, y) * flatten(r) - 0.25 * (1 - flatten(r));
  };

  // ---------- terrain: polar grid, denser near the centre ----------
  const tex = await new Promise((res) => new THREE.TextureLoader().load('data/terrain.jpg', res, undefined, () => res(null)));
  if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; }
  const NR = 90, NA = 160, R0 = 500, R1 = HALF * 0.97;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= NR; i++) {
    const r = R0 * Math.pow(R1 / R0, i / NR);
    for (let j = 0; j <= NA; j++) {
      const a = (j / NA) * Math.PI * 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      pos.push(x, terrainH(x, y), -y);
      uv.push((x + HALF) / (2 * HALF), (y + HALF) / (2 * HALF));
    }
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) {
    const a = i * (NA + 1) + j, b = a + 1, c = a + NA + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  // make sure the triangles face up
  if (tg.attributes.normal.getY(0) < 0) { idx.reverse(); tg.setIndex(idx); tg.computeVertexNormals(); }
  const tmat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
  tmat.color.setScalar(1.35);
  const terrain = new THREE.Mesh(tg, tmat);
  terrain.receiveShadow = true;
  terrain.name = 'terrain';
  group.add(terrain);

  // ---------- the skyline: high-rises of Dighomi, Saburtalo, Vake ... ----------
  let towers = [];
  try { towers = (await (await fetch('data/skyline.json')).json()).towers; } catch (e) { towers = []; }
  const cols = [0xd9cbb0, 0xe6e3dc, 0xb3b5b7, 0xc6ab8d, 0xd8b6a4, 0xcfd3d6, 0x9c9fa3];
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const skyMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  skyMat.onBeforeCompile = (shader) => {
    shader.uniforms.uLamp = { value: 0 };
    skyMat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 sWPos; varying vec3 sWNor;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        sWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        sWNor = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 sWPos; varying vec3 sWNor; uniform float uLamp;
        float sh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float hor = abs(sWNor.x) > abs(sWNor.z) ? sWPos.z : sWPos.x;
        vec2 cell = vec2(hor / 3.2, sWPos.y / 3.1);
        vec2 f = fract(cell);
        float isWall = step(0.5, abs(sWNor.y)) ; // roofs
        float win = (1.0 - isWall) * step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.85);
        float far = smoothstep(200.0, 1400.0, length(sWPos.xz - cameraPosition.xz));
        vec3 glassC = vec3(0.12, 0.14, 0.16);
        diffuseColor.rgb = mix(diffuseColor.rgb, glassC, win * mix(1.0, 0.35, far));
        float lit = step(0.7, sh(vec3(floor(cell), floor(sWPos.x * 0.01 + sWPos.z * 0.013))));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * win * lit * uLamp * 1.4;`);
  };
  skyMat.customProgramCacheKey = () => 'gd-skyline-v1';
  const sky = new THREE.InstancedMesh(box, skyMat, Math.max(1, towers.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  towers.forEach(([x, y, w, d, ang, lv], i) => {
    const h = lv * 3.1 + 1.5;
    e.set(0, ang, 0); q.setFromEuler(e);
    // (neighbours that share a wall would flicker where their faces coincide: none quite the same size)
    const k = 1 + (((i * 7919) % 9) - 4) * 0.006;
    m4.compose(p.set(x, terrainH(x, y) - 1, -y), q, s.set(w * k, h, d * (2 - k)));
    sky.setMatrixAt(i, m4);
    sky.setColorAt(i, c.setHex(cols[(i * 7919) % cols.length]).convertSRGBToLinear());
  });
  sky.count = towers.length;
  sky.castShadow = true; sky.receiveShadow = true;
  sky.computeBoundingSphere();
  group.add(sky);

  // ---------- tower cranes over the three biggest construction sites ----------
  const lattice = (() => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.strokeStyle = '#e8b21c'; ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 58, 58);
    ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(64, 64); ctx.moveTo(64, 0); ctx.lineTo(0, 64); ctx.stroke();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })();
  const latticeMat = new THREE.MeshStandardMaterial({ map: lattice, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
  const solidYellow = new THREE.MeshStandardMaterial({ color: 0xe8b21c, roughness: 0.5, metalness: 0.3 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9894, roughness: 0.9 });
  const rnd = mulberry(77);
  for (const site of (backdropSites || []).slice(0, 3)) {
    let cx = 0, cy = 0;
    for (const [x, y] of site.pts) { cx += x; cy += y; }
    cx /= site.pts.length; cy /= site.pts.length;
    const mastH = site.top + 18 + rnd() * 10, jibL = 48, cjL = 14, yaw = rnd() * Math.PI * 2;
    const crane = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.BoxGeometry(2, mastH, 2), latticeMat);
    setBoxUV(mast.geometry, 2, mastH, 2, 2);
    mast.position.y = mastH / 2;
    const jib = new THREE.Mesh(new THREE.BoxGeometry(jibL + cjL, 1.6, 1.4), latticeMat);
    setBoxUV(jib.geometry, jibL + cjL, 1.6, 1.4, 1.6);
    jib.position.set((jibL - cjL) / 2, mastH + 0.8, 0);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), solidYellow);
    cab.position.set(1.8, mastH - 1.5, 0);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.2, 6, 4), latticeMat);
    top.position.set(0, mastH + 4, 0);
    const blocks = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 2.2), concrete);
    blocks.position.set(-cjL + 3, mastH - 0.6, 0);
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.06, 20, 0.06), concrete);
    cable.position.set(jibL * 0.6, mastH - 10, 0);
    crane.add(mast, jib, cab, top, blocks, cable);
    crane.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    crane.position.set(cx, terrainH(cx, cy), -cy);
    crane.rotation.y = yaw;
    group.add(crane);
  }

  // ---------- Olympic fields across Bob Walsh Street ----------
  const turf = (() => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#3f8a3a'; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#4a9a44'; ctx.fillRect(0, 0, 64, 32);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })();
  const turfMat = new THREE.MeshStandardMaterial({ map: turf, roughness: 0.95 });
  // (these lie centimetres over the ground and under the streets: each drawn a fixed step behind
  // what's on top of it, or far off they flicker through each other; the whole stack is in ground.js)
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 });
  const back = (steps) => ({ polygonOffset: true, polygonOffsetFactor: steps / 3, polygonOffsetUnits: steps });
  // (the lots are pale concrete with white bays; the ground between the venues mostly grass - satellite)
  const lotMat = new THREE.MeshStandardMaterial({ map: lotTexture(), roughness: 0.95, ...back(8) });
  const sportsMat = new THREE.MeshStandardMaterial({ map: lawnTexture(), color: 0xc9d1b4, roughness: 1, ...back(10) });
  const sandMat = new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 1, ...back(8) });
  const lawnMat = new THREE.MeshStandardMaterial({ map: lawnTexture(), roughness: 1, ...back(6) });
  const fieldG = { turf: [], line: [], lot: [], sports: [], dirt: [], lawn: [] };
  const poles = [];
  for (const f of level.surroundings.features) {
    if (f.kind.startsWith('pitch')) {
      fieldG.turf.push(flatGeometry(f.polys, 0.035, 12));
      for (const pl of f.polys) {
        const o = pl.outer;
        fieldG.line.push(ribbonGeometry([...o, o[0]], 0.14, 0.05, 1));
        for (const k of [0, Math.floor(o.length / 2)]) poles.push(o[k]);
      }
    } else if (f.kind === 'parking') fieldG.lot.push(flatGeometry(f.polys, 0.012, 10));
    else if (f.kind === 'sports') fieldG.sports.push(flatGeometry(f.polys, 0.004, 5));
    else if (f.kind === 'dirt') fieldG.dirt.push(flatGeometry(f.polys, 0.01, 9));
    else if (f.kind === 'lawn') fieldG.lawn.push(flatGeometry(f.polys, 0.016, 4));
  }
  const addMerged = (list, mat) => { if (list.length) { const m = new THREE.Mesh(mergeGeometries(list), mat); m.receiveShadow = true; group.add(m); } };
  addMerged(fieldG.sports, sportsMat);
  addMerged(fieldG.lot, lotMat);
  addMerged(fieldG.dirt, sandMat);
  addMerged(fieldG.lawn, lawnMat);
  addMerged(fieldG.turf, turfMat);
  addMerged(fieldG.line, lineMat);
  // floodlight masts
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8f959b, roughness: 0.5, metalness: 0.6 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 0 });
  for (const [x, y] of poles) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 18, 8), poleMat);
    pole.position.set(x, 9, -y);
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 0.4), lampMat);
    head.position.set(x, 18.3, -y);
    pole.castShadow = true;
    group.add(pole, head);
  }

  buildTrucks(level.surroundings.trucks || [], group);
  buildSigns(level.surroundings.signs || [], group);

  scene.add(group);
  return {
    group, terrainH,
    update() {
      if (skyMat.userData.shader) skyMat.userData.shader.uniforms.uLamp.value = atmo.lampLevel;
      lampMat.emissiveIntensity = atmo.lampLevel * 2.5;
    },
  };
}

// Sand and dust with a few old tyre ruts (the lot opposite Gate 1).
function sandTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const ctx = cv.getContext('2d'), r = mulberry(19);
  ctx.fillStyle = '#b8935f'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const x = r() * 256, y = r() * 256, rad = 10 + r() * 40, g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const c = r() < 0.5 ? '160,140,110' : '222,208,180';
    g.addColorStop(0, `rgba(${c},0.35)`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = r() < 0.5 ? `rgba(110,95,70,${0.15 + r() * 0.2})` : `rgba(240,230,210,${0.15 + r() * 0.2})`;
    ctx.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

// A car park: pale concrete, bays marked in white every 2.5 m (10 m to a tile: two rows of bays and
// an aisle).
function lotTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const ctx = cv.getContext('2d'), r = mulberry(29);
  ctx.fillStyle = '#b7b6b1'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = r() < 0.5 ? `rgba(90,90,85,${0.08 + r() * 0.1})` : `rgba(235,235,230,${0.08 + r() * 0.1})`;
    ctx.fillRect(r() * 256, r() * 256, 2, 2);
  }
  ctx.fillStyle = 'rgba(245,245,240,0.85)';
  for (let k = 0; k < 4; k++) { ctx.fillRect(k * 64, 0, 3, 128); ctx.fillRect(k * 64, 160, 3, 96); }
  ctx.fillRect(0, 126, 256, 3);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

// A fresh roadside lawn.
function lawnTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d'), r = mulberry(23);
  ctx.fillStyle = '#6f9a45'; ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = r() < 0.5 ? `rgba(60,90,35,${0.2 + r() * 0.3})` : `rgba(150,180,90,${0.15 + r() * 0.25})`;
    ctx.fillRect(r() * 128, r() * 128, 1, 2 + r() * 2);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

// Lorries parked on the lot: a tractor unit (cab, bumper, fuel tank) and a curtain-side trailer on
// six wheels, one instanced box and one instanced wheel mesh for all of them. Headings in map
// radians; the cab is at the front.
function buildTrucks(list, group) {
  if (!list.length) return;
  const boxes = [], wheels = [];
  for (const t of list) {
    const c = Math.cos(t.h), s = Math.sin(t.h);
    const at = (along, across, y, sx, sy, sz, color) => {   // along: forward from the truck's centre
      boxes.push({ x: t.x + c * along - s * across, y, z: -(t.y + s * along + c * across), ry: t.h, sx, sy, sz, color });
    };
    at(-1.6, 0, 2.45, 13.4, 2.8, 2.5, t.trailer);          // the trailer body
    at(-1.6, 0, 0.95, 13.2, 0.25, 2.2, 0x2a2b2d);          // its chassis
    // (nothing flush with anything else: faces that share a plane flicker through each other)
    at(-8.33, 0, 2.45, 0.06, 2.7, 2.4, 0x9a9da0);          // the rear doors, on the back
    at(6.5, 0, 2.05, 2.3, 2.3, 2.45, t.cab);               // the cab
    at(7.68, 0, 2.35, 0.06, 0.95, 2.1, 0x1c2328);          // the windscreen, standing proud of it
    at(6.5, 0, 3.5, 2.0, 0.55, 2.2, t.cab);                // the roof fairing
    at(7.7, 0, 0.75, 0.12, 0.5, 2.4, 0x3a3c3f);            // the bumper
    at(5.2, 0, 0.8, 4.0, 0.3, 2.0, 0x2a2b2d);              // the tractor's frame
    at(5.6, 1.2, 0.8, 1.2, 0.55, 0.5, 0xb8bcc0);           // the fuel tank
    for (const along of [7.0, 4.6, 3.3, -5.4, -6.5, -7.6]) for (const across of [-1.05, 1.05]) {
      wheels.push({ x: t.x + c * along - s * across, z: -(t.y + s * along + c * across), ry: t.h });
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 }), boxes.length);
  boxes.forEach((b, i) => {
    e.set(0, b.ry, 0); q.setFromEuler(e);
    m4.compose(p.set(b.x, b.y, b.z), q, sc.set(b.sx, b.sy, b.sz));
    bm.setMatrixAt(i, m4);
    bm.setColorAt(i, col.setHex(b.color));   // (the colours are the photos': set as they are)
  });
  bm.castShadow = bm.receiveShadow = true;
  group.add(bm);
  // a trailer with lettering down its sides (the TEXTAR one across from Gate 1)
  for (const t of list) {
    if (!t.label) continue;
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 192;
    const x = cv.getContext('2d');
    x.fillStyle = '#' + t.trailer.toString(16).padStart(6, '0'); x.fillRect(0, 0, 1024, 192);
    x.fillStyle = '#141414'; x.textBaseline = 'middle';
    x.font = 'italic 900 118px "Arial Black", Arial, sans-serif'; x.fillText(t.label, 150, 82);
    x.font = 'italic 600 30px Arial, sans-serif'; x.fillText('So sicher bremst nur das Original', 330, 160);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const holder = new THREE.Group();
    holder.position.set(t.x, 0, -t.y); holder.rotation.y = t.h;
    for (const side of [1, -1]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(13.2, 2.48), mat);
      pl.position.set(-1.6, 2.45, side * 1.27);
      if (side < 0) pl.rotation.y = Math.PI;
      holder.add(pl);
    }
    group.add(holder);
  }
  const wg = new THREE.CylinderGeometry(0.52, 0.52, 0.4, 14).rotateX(Math.PI / 2);
  const wm = new THREE.InstancedMesh(wg, new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.85 }), wheels.length);
  wheels.forEach((w, i) => {
    e.set(0, w.ry, 0); q.setFromEuler(e);
    m4.compose(p.set(w.x, 0.52, w.z), q, sc.set(1, 1, 1));
    wm.setMatrixAt(i, m4);
  });
  wm.castShadow = true;
  group.add(wm);
}

// Road signs on grey posts: blue pedestrian-crossing squares, a P, a blue go-straight disc.
function buildSigns(list, group) {
  if (!list.length) return;
  const kinds = ['crossing', 'parking', 'ahead'];
  const cv = document.createElement('canvas'); cv.width = 384; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 384, 128);
  // crossing: blue square, white triangle, a walking figure
  ctx.fillStyle = '#1f5fbf'; ctx.fillRect(4, 4, 120, 120);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(64, 18); ctx.lineTo(114, 108); ctx.lineTo(14, 108); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#111111'; ctx.beginPath(); ctx.arc(66, 46, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(60, 55, 10, 26); ctx.fillRect(52, 80, 7, 20); ctx.fillRect(70, 80, 7, 20);
  ctx.fillStyle = '#111111'; for (let k = 0; k < 4; k++) ctx.fillRect(28 + k * 18, 100, 10, 5);
  // parking: blue square, white P
  ctx.fillStyle = '#1f5fbf'; ctx.fillRect(132, 4, 120, 120);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 96px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('P', 192, 70);
  // ahead only: blue disc, white arrow
  ctx.clearRect(260, 0, 124, 128);
  ctx.fillStyle = '#1f5fbf'; ctx.beginPath(); ctx.arc(322, 64, 58, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(315, 48, 14, 50);
  ctx.beginPath(); ctx.moveTo(322, 20); ctx.lineTo(346, 52); ctx.lineTo(298, 52); ctx.closePath(); ctx.fill();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const pos = [], uv = [], nor = [];
  const posts = [];
  for (const sg of list) {
    const k = Math.max(0, kinds.indexOf(sg.kind));
    // (facing the street: west, towards Bob Walsh Street and the gates)
    const x = sg.x - 0.06, y = sg.y, h0 = 2.0, h1 = 2.7, w = 0.35;
    const P = (dy, h) => [x, h, -(y + dy)];
    const c = [P(w, h0), P(-w, h0), P(-w, h1), P(w, h1)];
    pos.push(...c[0], ...c[1], ...c[2], ...c[0], ...c[2], ...c[3]);
    const u0 = k / 3 + 0.01, u1 = (k + 1) / 3 - 0.01;
    uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
    for (let j = 0; j < 6; j++) nor.push(-1, 0, 0);
    posts.push([sg.x, sg.y]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5 })));
  const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 2.8, 8).translate(0, 1.4, 0), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.6 }), posts.length);
  const m4 = new THREE.Matrix4();
  posts.forEach(([x, y], i) => pm.setMatrixAt(i, m4.makeTranslation(x, 0, -y)));
  pm.castShadow = true;
  group.add(pm);
}

function setBoxUV(g, sx, sy, sz, tile) {
  // world-scaled UVs so the lattice pattern keeps its size
  const n = g.attributes.normal, uv = g.attributes.uv, pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (ax > 0.5) uv.setXY(i, z / tile, y / tile);
    else if (ay > 0.5) uv.setXY(i, x / tile, z / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
}
