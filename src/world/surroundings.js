import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flatGeometry, ribbonGeometry, mulberry } from './geom.js';

// Far backdrop: real terrain (AWS terrain tiles) draped with Sentinel-2 imagery, the
// Tbilisi skyline (OSM high-rises within 5 km), tower cranes over the construction sites,
// and the Olympic sports fields across Bob Walsh Street.
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
  // (these lie centimetres over the ground and the streets: each drawn a fixed step behind what's
  // on top of it, or far off they flicker through each other)
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 });
  const lotMat = new THREE.MeshStandardMaterial({ color: 0x5c5d60, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 1 });
  const sportsMat = new THREE.MeshStandardMaterial({ color: 0xa9a8a2, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
  const fieldG = { turf: [], line: [], lot: [], sports: [] };
  const poles = [];
  for (const f of level.surroundings.features) {
    if (f.kind.startsWith('pitch')) {
      fieldG.turf.push(flatGeometry(f.polys, 0.035, 12));
      for (const pl of f.polys) {
        const o = pl.outer;
        fieldG.line.push(ribbonGeometry([...o, o[0]], 0.14, 0.05, 1));
        for (const k of [0, Math.floor(o.length / 2)]) poles.push(o[k]);
      }
    } else if (f.kind === 'parking') fieldG.lot.push(flatGeometry(f.polys, 0.012, 5));
    else if (f.kind === 'sports') fieldG.sports.push(flatGeometry(f.polys, 0.004, 5));
  }
  const addMerged = (list, mat) => { if (list.length) { const m = new THREE.Mesh(mergeGeometries(list), mat); m.receiveShadow = true; group.add(m); } };
  addMerged(fieldG.sports, sportsMat);
  addMerged(fieldG.lot, lotMat);
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

  scene.add(group);
  return {
    group, terrainH,
    update() {
      if (skyMat.userData.shader) skyMat.userData.shader.uniforms.uLamp.value = atmo.lampLevel;
      lampMat.emissiveIntensity = atmo.lampLevel * 2.5;
    },
  };
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
