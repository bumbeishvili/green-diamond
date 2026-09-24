import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry, pointInPoly } from './geom.js';
import { radialTexture } from './textures.js';

// Everything that stands on the ground: trees, lamps, benches, fences, playgrounds,
// basketball pads, pergolas, parked cars, the entrance portal and the diamond sculpture.
// Almost everything is instanced so the whole complex costs a few dozen draw calls.

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();

class Batch {
  constructor(geometry, material, { shadow = true, receive = true } = {}) {
    this.g = geometry; this.mat = material; this.items = []; this.shadow = shadow; this.receive = receive;
  }
  add(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, color = null, rx = 0, rz = 0) {
    this.items.push([x, y, z, ry, sx, sy, sz, color, rx, rz]);
  }
  build(group) {
    if (!this.items.length) return null;
    const im = new THREE.InstancedMesh(this.g, this.mat, this.items.length);
    this.items.forEach(([x, y, z, ry, sx, sy, sz, color, rx, rz], i) => {
      _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
      _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
      im.setMatrixAt(i, _m);
      if (color != null) im.setColorAt(i, _c.setHex(color).convertSRGBToLinear());
    });
    im.castShadow = this.shadow; im.receiveShadow = this.receive;
    im.computeBoundingSphere();
    group.add(im);
    return im;
  }
}

function canvas(w, h = w) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

function leafTexture(seed, hue = 0.26) {
  const c = canvas(256), ctx = c.getContext('2d'), r = mulberry(seed);
  for (let i = 0; i < 520; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 118;
    const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
    const l = 22 + r() * 30 - (d / 118) * 6;
    ctx.fillStyle = `hsl(${(hue + (r() - 0.5) * 0.05) * 360}, ${45 + r() * 25}%, ${l}%)`;
    ctx.save(); ctx.translate(x, y); ctx.rotate(r() * Math.PI);
    ctx.beginPath(); ctx.ellipse(0, 0, 4 + r() * 5, 2 + r() * 2.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Leaf-card canopy: quads scattered through an ellipsoid with spherical normals.
function canopyGeometry(seed, rx, ry, cards, cardSize) {
  const r = mulberry(seed);
  const parts = [];
  for (let i = 0; i < cards; i++) {
    const g = new THREE.PlaneGeometry(cardSize, cardSize);
    const u = r() * 2 - 1, th = r() * Math.PI * 2, rad = Math.cbrt(r()) * 0.9;
    const px = Math.sqrt(1 - u * u) * Math.cos(th) * rad * rx, pz = Math.sqrt(1 - u * u) * Math.sin(th) * rad * rx, py = u * rad * ry;
    g.rotateX(r() * Math.PI); g.rotateY(r() * Math.PI); g.rotateZ(r() * Math.PI);
    g.translate(px, py, pz);
    // spherical normals -> soft, volumetric lighting
    const pos = g.attributes.position, nor = g.attributes.normal;
    for (let k = 0; k < pos.count; k++) {
      const n = new THREE.Vector3(pos.getX(k) / rx, pos.getY(k) / ry + 0.25, pos.getZ(k) / rx).normalize();
      nor.setXYZ(k, n.x, n.y, n.z);
    }
    parts.push(g);
  }
  return mergeGeometries(parts);
}

function trunkGeometry(h, r0, branches, seed) {
  const r = mulberry(seed);
  const parts = [];
  const t = new THREE.CylinderGeometry(r0 * 0.55, r0, h, 7, 1, true);
  t.translate(0, h / 2, 0);
  parts.push(t);
  for (let i = 0; i < branches; i++) {
    const L = h * (0.35 + r() * 0.25);
    const b = new THREE.CylinderGeometry(r0 * 0.2, r0 * 0.4, L, 5, 1, true);
    b.translate(0, L / 2, 0);
    b.rotateZ(0.5 + r() * 0.5);
    b.rotateY(r() * Math.PI * 2);
    b.translate(0, h * (0.65 + r() * 0.25), 0);
    parts.push(b);
  }
  return mergeGeometries(parts);
}

export function buildProps(level, scene, colliders, hm, atmo, quality, models = {}) {
  const group = new THREE.Group();
  group.name = 'props';
  const H = (x, y) => hm.at(x, y);
  const rnd = mulberry(4242);

  // ---------------- materials ----------------
  const matte = (color, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const tinted = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
  const metalTinted = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.6 });
  const bark = matte(0x5b4a3c, 0.95);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  const boxes = new Batch(box, tinted);
  const metalBoxes = new Batch(box, metalTinted);
  const cyls = new Batch(cyl, tinted);
  const metalCyls = new Batch(cyl, metalTinted);

  // ---------------- trees ----------------
  const leafMats = [0.25, 0.28, 0.22].map((hue, i) => new THREE.MeshStandardMaterial({
    map: leafTexture(11 + i * 7, hue), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85,
  }));
  const cypressMat = new THREE.MeshStandardMaterial({ map: leafTexture(99, 0.3), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, color: 0x9fb89a });
  const treeKinds = {
    mature: { trunkH: 2.6, trunkR: 0.13, canopy: canopyGeometry(1, 2.3, 2.0, 70, 1.5), cy: 3.9 },
    young: { trunkH: 2.0, trunkR: 0.07, canopy: canopyGeometry(2, 1.15, 1.25, 34, 1.0), cy: 2.7 },
    street: { trunkH: 2.3, trunkR: 0.1, canopy: canopyGeometry(3, 1.7, 1.6, 50, 1.25), cy: 3.3 },
  };
  const trunks = {}, canopies = {};
  for (const [k, def] of Object.entries(treeKinds)) {
    trunks[k] = new Batch(trunkGeometry(def.trunkH + 0.6, def.trunkR, k === 'young' ? 2 : 4, k.length), bark);
    canopies[k] = [0, 1, 2].map((i) => new Batch(def.canopy, leafMats[i]));
  }
  const density = quality.drawTrees;
  for (const t of level.trees) {
    if (rnd() > density) continue;
    const def = treeKinds[t.kind] || treeKinds.street;
    const y = H(t.x, t.y);
    const s = t.s;
    trunks[t.kind].add(t.x, y, -t.y, t.r, s, s, s);
    canopies[t.kind][Math.floor(rnd() * 3)].add(t.x, y + def.cy * s, -t.y, t.r, s * (0.9 + rnd() * 0.2), s, s * (0.9 + rnd() * 0.2));
    colliders.addCircle(t.x, -t.y, def.trunkR * s + 0.12, { height: 3, kind: 'tree' });
  }
  // the forest strip west of the complex (cheaper canopies, no collision: outside the fence)
  const forestCanopy = canopyGeometry(5, 2.6, 2.6, 36, 2.1);
  const forestTrunk = new Batch(trunkGeometry(3.4, 0.16, 3, 5), bark);
  const forestLeaves = [0, 1, 2].map((i) => new Batch(forestCanopy, leafMats[i]));
  for (const t of level.surroundings.forest || []) {
    if (rnd() > Math.max(0.5, density)) continue;
    const y = H(t.x, t.y), s = t.s * 1.3;
    forestTrunk.add(t.x, y, -t.y, t.r, s, s, s);
    forestLeaves[Math.floor(rnd() * 3)].add(t.x, y + 4.6 * s, -t.y, t.r, s, s * (0.9 + rnd() * 0.3), s);
  }
  forestTrunk.build(group);
  forestLeaves.forEach((b) => b.build(group));

  // young cypresses along the courtyard fence (as in the developer's photos)
  const cypress = new Batch(canopyGeometry(7, 0.45, 1.2, 16, 0.8), cypressMat);
  for (const f of level.fences) {
    if (f.type !== 'court') continue;
    for (let i = 0; i < f.line.length - 1; i++) {
      const [ax, ay] = f.line[i], [bx, by] = f.line[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      let nx = -(by - ay) / L, ny = (bx - ax) / L;
      const mx = (ax + bx) / 2 + nx * 0.7, my = (ay + by) / 2 + ny * 0.7;
      if (level.court_mid && !pointInPoly(mx, my, level.court_mid.outer)) { nx = -nx; ny = -ny; } // keep them inside
      for (let d = 1.0; d < L - 0.8; d += 2.2) {
        const x = ax + (bx - ax) * d / L + nx * 0.7, y = ay + (by - ay) * d / L + ny * 0.7;
        const sc = 0.8 + rnd() * 0.4;
        cypress.add(x, H(x, y) + 1.1 * sc, -y, rnd() * 6, sc, sc, sc);
      }
    }
  }

  // ---------------- lamps ----------------
  const lampHeads = [];
  for (const l of level.lamps) {
    const y = H(l.x, l.y);
    const street = l.kind === 'street';
    const h = street ? 6.5 : 3.8;
    metalCyls.add(l.x, y + h / 2, -l.y, 0, 0.12, h, 0.12, 0x2b2d30);
    if (street) {
      const ax = Math.cos(l.h), ay = Math.sin(l.h);
      metalBoxes.add(l.x + ax * 0.6, y + h - 0.05, -(l.y + ay * 0.6), Math.atan2(ay, ax), 1.3, 0.08, 0.08, 0x2b2d30);
      lampHeads.push([l.x + ax * 1.2, y + h - 0.15, -(l.y + ay * 1.2), Math.atan2(ay, ax), 0.6, 0.12, 0.28]);
    } else {
      metalBoxes.add(l.x, y + h + 0.1, -l.y, 0, 0.3, 0.3, 0.3, 0x2b2d30);
      lampHeads.push([l.x, y + h - 0.12, -l.y, 0, 0.26, 0.3, 0.26]);
    }
    colliders.addCircle(l.x, -l.y, 0.12, { height: h, kind: 'post' });
  }
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf5f1e6, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.3 });
  const heads = new Batch(box, headMat, { shadow: false });
  for (const h of lampHeads) heads.add(h[0], h[1], h[2], h[3], h[4], h[5], h[6]);
  // light pools on the ground (visible after sunset)
  const poolTex = radialTexture('rgba(255,214,160,0.8)', 'rgba(255,190,120,0)');
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const plane = new THREE.PlaneGeometry(1, 1); plane.rotateX(-Math.PI / 2);
  const pools = new Batch(plane, poolMat, { shadow: false, receive: false });
  for (const h of lampHeads) pools.add(h[0], H(h[0], -h[2]) + 0.05, h[2], 0, 13, 1, 13);

  // ---------------- benches ----------------
  for (const b of level.benches) {
    const y = H(b.x, b.y), ry = b.h;
    const ca = Math.cos(b.h), sa = Math.sin(b.h);
    boxes.add(b.x, y + 0.45, -b.y, ry, 1.8, 0.06, 0.45, 0x8a5a36);
    boxes.add(b.x - ca * 0 + sa * 0.22, y + 0.72, -(b.y - ca * 0.22), ry, 1.8, 0.35, 0.05, 0x8a5a36, -0.18);
    for (const s of [-0.75, 0.75]) metalBoxes.add(b.x + ca * s, y + 0.22, -(b.y + sa * s), ry, 0.06, 0.45, 0.5, 0x222426);
    colliders.addBox(b.x, -b.y, 0.9, 0.3, -ry, { height: 0.8, kind: 'bench' });
  }

  // ---------------- fences ----------------
  buildFences(level, group, colliders, H);

  // ---------------- playgrounds (red rubber, green/yellow frames, slides, swings) ----------------
  const rubber = new THREE.MeshStandardMaterial({ color: 0xb8413a, roughness: 0.95 });
  for (const pg of level.playgrounds) {
    const y = H(pg.x, pg.y);
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(pg.w, pg.d).rotateX(-Math.PI / 2), rubber);
    mat.position.set(pg.x, y + 0.03, -pg.y);
    mat.rotation.y = pg.r;
    mat.receiveShadow = true;
    group.add(mat);
    const ca = Math.cos(pg.r), sa = Math.sin(pg.r);
    const L = (lx, lz) => [pg.x + lx * ca - lz * sa, pg.y + lx * sa + lz * ca]; // local -> map
    // play tower
    const [tx, ty] = L(-pg.w * 0.2, 0);
    for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
      const [px, py] = L(-pg.w * 0.2 + dx, dz);
      cyls.add(px, y + 1.4, -py, 0, 0.12, 2.8, 0.12, 0x2e9d4a);
    }
    boxes.add(tx, y + 1.2, -ty, pg.r, 1.8, 0.1, 1.8, 0xf2c31b);
    boxes.add(tx, y + 2.95, -ty, pg.r, 2.0, 0.14, 2.0, 0xd8322a);
    const [sx, sy] = L(-pg.w * 0.2 + 1.9, 0);
    boxes.add(sx, y + 0.65, -sy, pg.r, 2.6, 0.08, 0.7, 0xf2c31b, 0, 0.5);
    colliders.addBox(tx, -ty, 1.0, 1.0, -pg.r, { height: 3, kind: 'play' });
    // swing frame
    const [wx, wy] = L(pg.w * 0.22, 0);
    for (const s of [-1.3, 1.3]) {
      const [px, py] = L(pg.w * 0.22 + s, 0);
      boxes.add(px, y + 1.2, -py, pg.r, 0.1, 2.4, 0.9, 0x2a7fd0);
    }
    cyls.add(wx, y + 2.4, -wy, pg.r + Math.PI / 2, 0.1, 2.8, 0.1, 0x2a7fd0, 0, Math.PI / 2);
    for (const s of [-0.6, 0.6]) {
      const [px, py] = L(pg.w * 0.22 + s, 0);
      boxes.add(px, y + 1.5, -py, pg.r, 0.02, 1.7, 0.02, 0x999999);
      boxes.add(px, y + 0.6, -py, pg.r, 0.5, 0.05, 0.25, 0x222222);
    }
    colliders.addBox(wx, -wy, 1.5, 0.5, -pg.r, { height: 2.5, kind: 'play' });
    // spring riders
    for (const s of [-1, 1]) {
      const [px, py] = L(0.2 * pg.w * s, pg.d * 0.3);
      cyls.add(px, y + 0.25, -py, 0, 0.12, 0.5, 0.12, 0x444444);
      boxes.add(px, y + 0.62, -py, pg.r, 0.7, 0.35, 0.3, s > 0 ? 0xe9442e : 0x3cae3f);
    }
  }

  // ---------------- basketball pads: pink circle, triple hoop; the fenced "small stadium" ----------------
  const pink = new THREE.MeshStandardMaterial({ color: 0xd66d8a, roughness: 0.9 });
  for (const c of level.sport) {
    if (c.kind === 'court_round') { buildStadium(c, group, metalCyls, metalBoxes, colliders, H, models); continue; }
    const y = H(c.x, c.y);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(c.w / 2, 40).rotateX(-Math.PI / 2), pink);
    pad.position.set(c.x, y + 0.03, -c.y);
    pad.receiveShadow = true;
    group.add(pad);
    metalCyls.add(c.x, y + 1.8, -c.y, 0, 0.22, 3.6, 0.22, 0x2b5ea8);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const ax = Math.cos(a), ay = Math.sin(a);
      metalBoxes.add(c.x + ax * 0.6, y + 3.3, -(c.y + ay * 0.6), a, 1.2, 0.1, 0.1, 0x2b5ea8);
      boxes.add(c.x + ax * 1.25, y + 3.45, -(c.y + ay * 1.25), a, 0.05, 1.0, 1.6, 0xf4f4f4);
      metalCyls.add(c.x + ax * 1.6, y + 3.05, -(c.y + ay * 1.6), 0, 0.46, 0.03, 0.46, 0xe0582a);
    }
    colliders.addCircle(c.x, -c.y, 0.25, { height: 4, kind: 'post' });
  }

  // ---------------- timber pergolas + gazebo ----------------
  const wood = 0x6b4630;
  level.pergolas.forEach((pg, idx) => {
    const y = H(pg.x, pg.y);
    const ca = Math.cos(pg.r), sa = Math.sin(pg.r);
    const L = (lx, lz) => [pg.x + lx * ca - lz * sa, pg.y + lx * sa + lz * ca];
    if ((pg.kind || (idx % 2 ? 'gazebo' : 'pergola')) === 'gazebo') {
      // octagonal gazebo with a green roof (as in the photos)
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const [px, py] = [pg.x + Math.cos(a) * 1.8, pg.y + Math.sin(a) * 1.8];
        boxes.add(px, y + 1.25, -py, a, 0.12, 2.5, 0.12, wood);
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.2, 8), matte(0x3f7d4a, 0.8));
      roof.position.set(pg.x, y + 3.1, -pg.y);
      roof.castShadow = roof.receiveShadow = true;
      group.add(roof);
      boxes.add(pg.x, y + 0.45, -pg.y, 0, 1.4, 0.06, 0.5, 0x8a5a36);
      colliders.addCircle(pg.x, -pg.y, 1.9, { height: 3, kind: 'gazebo', shoot: false });
      return;
    }
    const W = 6, D = 4, Hh = 2.7;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) {
      const [px, py] = L(dx * (W / 2 - 0.1), dz * (D / 2 - 0.1));
      boxes.add(px, y + Hh / 2, -py, pg.r, 0.14, Hh, 0.14, wood);
      colliders.addCircle(px, -py, 0.12, { height: Hh, kind: 'post' });
    }
    for (let k = 0; k <= 14; k++) {
      const [px, py] = L(-W / 2 + (k / 14) * W, 0);
      boxes.add(px, y + Hh + 0.1, -py, pg.r + Math.PI / 2, D + 0.4, 0.16, 0.06, wood);
    }
    for (const dz of [-1, 1]) {
      const [px, py] = L(0, dz * (D / 2 - 0.1));
      boxes.add(px, y + Hh - 0.05, -py, pg.r, W + 0.4, 0.16, 0.12, wood);
    }
  });

  // ---------------- entrance portals, boom barriers, diamond sculpture ----------------
  buildGates(level, group, boxes, metalBoxes, colliders, H);
  buildShopSigns(level, group, H);

  // ---------------- parked cars ----------------
  const carSystem = buildCars(level, group, colliders, H, models);

  if (quality.treeShadows === false) for (const b of [cypress, ...Object.values(canopies).flat()]) b.shadow = false;
  for (const b of [boxes, metalBoxes, cyls, metalCyls, cypress, heads, pools, ...Object.values(trunks), ...Object.values(canopies).flat()]) b.build(group);
  const poolMesh = group.children.find((o) => o.material === poolMat);

  scene.add(group);
  return {
    group, cars: carSystem,
    update(dt, t, camera) {
      if (camera) carSystem.update(camera);
      headMat.emissiveIntensity = atmo.lampLevel * 3.0;
      if (!this.signs) this.signs = group.children.filter((o) => o.userData.sign);
      for (const sg of this.signs) sg.material.emissiveIntensity = 0.15 + atmo.lampLevel * 0.9;
      poolMat.opacity = atmo.lampLevel;
      if (poolMesh) poolMesh.visible = atmo.lampLevel > 0.02;
    },
  };
}

// White vertical-bar railings round the courtyard; green welded mesh on a white plinth round the site.
function buildFences(level, group, colliders, H) {
  const bars = (() => {
    const c = canvas(64, 128), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 64, 128);
    ctx.fillStyle = '#f1f1ef';
    for (let x = 4; x < 64; x += 16) ctx.fillRect(x, 0, 5, 128);
    ctx.fillRect(0, 0, 64, 8); ctx.fillRect(0, 112, 64, 8);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping; return t;
  })();
  const mesh = (() => {
    const c = canvas(128, 128), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = '#3f7a4d'; ctx.lineWidth = 3;
    for (let x = 2; x < 128; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke(); }
    ctx.lineWidth = 2;
    for (let y = 4; y < 128; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke(); }
    ctx.fillStyle = '#35693f'; ctx.fillRect(0, 0, 128, 6); ctx.fillRect(0, 122, 128, 6);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping; return t;
  })();
  const courtMat = new THREE.MeshStandardMaterial({ map: bars, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.3 });
  const meshMat = new THREE.MeshStandardMaterial({ map: mesh, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.2 });
  const plinthMat = new THREE.MeshStandardMaterial({ color: 0xe8e6e1, roughness: 0.85 });
  const parts = { court: [], mesh: [], plinth: [] };
  for (const f of level.fences) {
    const perim = f.type === 'perimeter';
    for (let i = 0; i < f.line.length - 1; i++) {
      const [ax, ay] = f.line[i], [bx, by] = f.line[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 0.05) continue;
      const ya = H(ax, ay), yb = H(bx, by);
      const base = Math.min(ya, yb);
      const plinthH = perim ? 0.45 : 0.0;
      const top = f.height;
      const quad = (y0, y1, uScale) => {
        const g = new THREE.BufferGeometry();
        const P = [ax, base + y0, -ay, bx, base + y0, -by, bx, base + y1, -by, ax, base + y0, -ay, bx, base + y1, -by, ax, base + y1, -ay];
        const u = L / uScale;
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, u, 0, u, 1, 0, 0, u, 1, 0, 1], 2));
        g.computeVertexNormals();
        return g;
      };
      if (perim) {
        parts.mesh.push(quad(plinthH, top, 1.2));
        // plinth: a thin box strip
        const g = new THREE.BoxGeometry(L, plinthH + 0.2, 0.22);
        g.translate(L / 2, (plinthH + 0.2) / 2 - 0.2, 0);
        g.rotateY(Math.atan2(by - ay, bx - ax));
        g.translate(ax, base, -ay);
        parts.plinth.push(g);
      } else {
        parts.court.push(quad(0, top, 0.8));
      }
      colliders.addSegment(ax, -ay, bx, -by, { height: base + top, kind: 'fence', shoot: false });
    }
  }
  if (parts.court.length) { const m = new THREE.Mesh(mergeGeometries(parts.court), courtMat); m.castShadow = true; group.add(m); }
  if (parts.mesh.length) { const m = new THREE.Mesh(mergeGeometries(parts.mesh), meshMat); m.castShadow = true; group.add(m); }
  if (parts.plinth.length) { const m = new THREE.Mesh(mergeGeometries(parts.plinth), plinthMat); m.castShadow = m.receiveShadow = true; group.add(m); }
}

function logoTexture() {
  const c = canvas(512, 256), ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 512, 256);
  // the green diamond mark: blue crystal over a green chevron
  ctx.fillStyle = '#3aa7e0';
  ctx.beginPath(); ctx.moveTo(40, 70); ctx.lineTo(80, 40); ctx.lineTo(150, 40); ctx.lineTo(190, 70); ctx.lineTo(115, 150); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1f78b4';
  ctx.beginPath(); ctx.moveTo(40, 70); ctx.lineTo(190, 70); ctx.lineTo(115, 150); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#4bb04f';
  ctx.beginPath(); ctx.moveTo(60, 150); ctx.lineTo(115, 215); ctx.lineTo(170, 150); ctx.lineTo(170, 125); ctx.lineTo(115, 188); ctx.lineTo(60, 125); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1d1d1b';
  ctx.font = 'bold 64px Impact, "Arial Narrow", sans-serif';
  ctx.fillText('GREEN', 215, 110);
  ctx.fillText('DIAMOND', 215, 180);
  ctx.font = '600 18px Arial, sans-serif';
  ctx.fillText('BY MAQRO CONSTRUCTION', 218, 210);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function buildGates(level, group, boxes, metalBoxes, colliders, H) {
  const logo = new THREE.MeshStandardMaterial({ map: logoTexture(), roughness: 0.6 });
  for (const gate of level.gates) {
    const y = H(gate.x, gate.y);
    // the portal spans the entry road running east-west across the fence line (x ~ 138)
    const gx = gate.x + 6, gy = gate.y;
    // two raked legs + a deep white beam (the angled white frame in the photos)
    for (const s of [-1, 1]) {
      boxes.add(gx, y + 3.4, -(gy + s * 4.6), 0, 0.5, 7.0, 0.5, 0xf2f2f0, 0, s * 0.18);
    }
    boxes.add(gx, y + 7.0, -gy, 0, 2.2, 0.6, 10.6, 0xf2f2f0);
    boxes.add(gx + 1.2, y + 6.6, -gy, 0, 0.1, 1.4, 10.6, 0xdedcd8);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), logo);
    sign.position.set(gx + 1.26, y + 5.4, -(gy - 2.6));
    sign.rotation.y = Math.PI / 2;
    group.add(sign);
    boxes.add(gx + 1.2, y + 5.4, -(gy - 2.6), 0, 0.08, 1.9, 3.7, 0xf2f2f0);
    // boom barrier: red/white striped pole
    const bx = gate.x + 1.5;
    metalBoxes.add(bx, y + 0.55, -(gy - 3.3), 0, 0.35, 1.1, 0.35, 0xd8d8d8);
    for (let k = 0; k < 6; k++) {
      metalBoxes.add(bx, y + 1.0, -(gy - 3.0 + k * 1.0 + 0.5), 0, 0.09, 0.09, 1.0, k % 2 ? 0xffffff : 0xd8262e);
    }
    colliders.addSegment(bx, -(gy - 3.3), bx, -(gy + 3.3), { height: 1.1, kind: 'barrier', shoot: false });
  }
  // the big glass diamond by the main gate (Gate 2)
  const g2 = level.gates.find((g) => g.name === 'Gate 2') || level.gates[0];
  if (g2) {
    const geo = diamondGeometry();
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x69c3e6, metalness: 0.15, roughness: 0.05, transparent: true, opacity: 0.82,
      clearcoat: 1, clearcoatRoughness: 0.05, flatShading: true, envMapIntensity: 2.2 });
    const d = new THREE.Mesh(geo, mat);
    const x = g2.x + 11, yM = g2.y + 9;
    const y = H(x - 3, yM);
    d.position.set(x, y + 3.2, -yM);
    d.scale.setScalar(1.6);
    d.castShadow = true;
    group.add(d);
    boxes.add(x, y + 0.5, -yM, 0.4, 2.6, 1.0, 2.6, 0x8b8f93);
    group.userData.diamond = d;
  }
}

function diamondGeometry() {
  // round brilliant: crown + table + pavilion, faceted
  const n = 12, R = 1.0, t = 0.62, crownH = 0.35, pavH = 0.95;
  const verts = [];
  const top = [], mid = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    top.push([Math.cos(a) * R * t, crownH, Math.sin(a) * R * t]);
    mid.push([Math.cos(a + Math.PI / n) * R, 0, Math.sin(a + Math.PI / n) * R]);
  }
  const apex = [0, -pavH, 0], tc = [0, crownH, 0];
  const tri = (a, b, c) => verts.push(...a, ...b, ...c);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(tc, top[j], top[i]);           // table
    tri(top[i], top[j], mid[i]);       // crown facets
    tri(mid[i], top[j], mid[j]);
    tri(mid[i], mid[j], apex);         // pavilion
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

// Parked cars. With models: one instanced mesh per car model, refilled every few frames with
// only the cars in view (and near ones for shadows); far cars become cheap box proxies.
const CAR_COLORS = [0xe9e9e6, 0xc9ccd0, 0x9aa0a6, 0x2c2e31, 0x1f2f4f, 0x6e1c1c, 0xf2f2f0, 0x5a5f66, 0x3a4a3e, 0xb8a482, 0x8a8f96, 0xe2ddd2];

function carMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.35 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPaint;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = mix(color.rgb, instanceColor.rgb, aPaint);
        #endif`);
  };
  m.customProgramCacheKey = () => 'gd-car-paint';
  return m;
}

function buildCars(level, group, colliders, H, models) {
  const cars = [];
  for (const c of level.cars) {
    const y = c.f ?? H(c.x, c.y); // cars in the underground car parks stand on its floor
    const rec = { x: c.x, z: -c.y, h: c.h, ground: y, v: c.v, color: CAR_COLORS[(c.v * 7) % CAR_COLORS.length], taken: false };
    rec.col = colliders.addBox(c.x, -c.y, 2.2, 0.92, -c.h, { height: y + 1.45, minY: y - 0.4, kind: 'car' });
    cars.push(rec);
  }
  const fleet = (models.cars || []).filter((m) => m.geometry);
  const mat = carMaterial();
  // proxies: a body box + a dark cabin, 24 triangles
  const proxyGeo = (() => {
    const body = new THREE.BoxGeometry(4.4, 0.75, 1.8).translate(0, 0.62, 0);
    const cab = new THREE.BoxGeometry(2.3, 0.55, 1.6).translate(-0.25, 1.28, 0);
    const n1 = body.attributes.position.count, n2 = cab.attributes.position.count;
    body.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n1 * 3).fill(1), 3));
    body.setAttribute('aPaint', new THREE.BufferAttribute(new Float32Array(n1).fill(1), 1));
    cab.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n2 * 3).fill(0.06), 3));
    cab.setAttribute('aPaint', new THREE.BufferAttribute(new Float32Array(n2), 1));
    return mergeGeometries([body, cab]);
  })();
  const meshes = (fleet.length ? fleet.map((f) => f.geometry) : []).map((g) => {
    const im = new THREE.InstancedMesh(g, mat, cars.length);
    im.castShadow = im.receiveShadow = true;
    im.frustumCulled = false; im.count = 0;
    group.add(im);
    return im;
  });
  const proxy = new THREE.InstancedMesh(proxyGeo, mat, cars.length);
  proxy.castShadow = true; proxy.receiveShadow = true;
  proxy.frustumCulled = false; proxy.count = 0;
  group.add(proxy);
  const col = new THREE.Color();
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), 3.2);
  const DETAIL = 95;
  let tick = 0;
  return {
    cars, fleet, mat,
    update(camera) {
      if ((tick++ % 3) !== 0) return;
      pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pm);
      const cx = camera.position.x, cz = camera.position.z, camUnder = camera.position.y < -0.6, camLow = camera.position.y < 4;
      const counts = meshes.map(() => 0);
      let pc = 0;
      for (const c of cars) {
        if (c.taken) continue;
        const dx = c.x - cx, dz = c.z - cz, d = Math.hypot(dx, dz);
        // cars down in the car parks only show from down there (or from the ramps); from down
        // there, only the nearest cars up top can be seen (through the ramp doors)
        if (c.ground < -1 ? !(camUnder || (camLow && d < 30)) : camUnder && d > 45) continue;
        sphere.center.set(c.x, c.ground + 1, c.z);
        const inView = frustum.intersectsSphere(sphere);
        if (!inView && d > 22) continue;
        _e.set(0, c.h, 0); _q.setFromEuler(_e);
        _m.compose(_p.set(c.x, c.ground, c.z), _q, _s.set(1, 1, 1));
        col.setHex(c.color).convertSRGBToLinear();
        if (meshes.length && d < (camUnder ? 32 : DETAIL)) {
          const k = c.v % meshes.length, i = counts[k]++;
          meshes[k].setMatrixAt(i, _m); meshes[k].setColorAt(i, col);
        } else {
          proxy.setMatrixAt(pc, _m); proxy.setColorAt(pc, col); pc++;
        }
      }
      meshes.forEach((m, k) => {
        m.count = counts[k];
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      });
      proxy.count = pc;
      proxy.instanceMatrix.needsUpdate = true;
      if (proxy.instanceColor) proxy.instanceColor.needsUpdate = true;
    },
  };
}

// Shop signs above the podium storefronts, at the real shops' positions (OSM).
const SIGNS = {
  'Spar': { bg: '#ffffff', fg: '#e2001a', text: 'SPAR', tree: true, w: 3.6 },
  'Nikora': { bg: '#d7141a', fg: '#ffffff', text: 'ნიკორა', sub: 'NIKORA', w: 3.8 },
  'Ori Nabiji': { bg: '#0f7a3c', fg: '#ffffff', text: '2 ნაბიჯი', w: 3.8 },
  '36.6': { bg: '#ffffff', fg: '#11813d', text: '36.6', sub: 'აფთიაქი', cross: true, w: 3.2 },
  'Format Fit': { bg: '#111111', fg: '#ff7a1a', text: 'FORMAT FIT', w: 4.2 },
  'Assorti': { bg: '#4a2e1f', fg: '#f3d9b1', text: 'ASSORTI', sub: 'ყავა · CAFE', w: 3.4 },
  'Diamond': { bg: '#f7d6e4', fg: '#b3125a', text: 'DIAMOND', sub: 'beauty', w: 3.2 },
  'TBC Bank': { bg: '#00a0e3', fg: '#ffffff', text: 'TBC', w: 1.4 },
};

function signTexture(def) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = def.bg; ctx.fillRect(0, 0, 512, 128);
  let x = 256;
  if (def.tree) { ctx.fillStyle = '#00843d'; ctx.beginPath(); ctx.moveTo(70, 18); ctx.lineTo(112, 108); ctx.lineTo(28, 108); ctx.closePath(); ctx.fill(); x = 290; }
  if (def.cross) { ctx.fillStyle = '#11813d'; ctx.fillRect(40, 44, 60, 40); ctx.fillRect(50, 34, 40, 60); ctx.fillRect(56, 24, 28, 80); x = 290; }
  ctx.fillStyle = def.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${def.sub ? 60 : 76}px "Arial Black", Arial, "Noto Sans Georgian", sans-serif`;
  ctx.fillText(def.text, x, def.sub ? 52 : 66, 430);
  if (def.sub) { ctx.font = '600 30px Arial, "Noto Sans Georgian", sans-serif'; ctx.fillText(def.sub, x, 100, 430); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildShopSigns(level, group, H) {
  const podiums = level.buildings.filter((b) => b.group === 'podium');
  const placed = [];
  for (const poi of level.pois) {
    const def = SIGNS[poi.name];
    if (!def) continue;
    // nearest podium wall edge
    let best = null;
    for (const b of podiums) {
      const pts = b.poly.outer;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        const L = Math.hypot(bx - ax, by - ay);
        if (L < def.w + 0.4) continue;
        const tx = (bx - ax) / L, ty = (by - ay) / L;
        const t = Math.max(def.w / 2 + 0.2, Math.min(L - def.w / 2 - 0.2, (poi.x - ax) * tx + (poi.y - ay) * ty));
        const d = Math.hypot(poi.x - (ax + tx * t), poi.y - (ay + ty * t));
        if (!best || d < best.d) best = { d, key: `${b.id}:${i}`, ax, ay, tx, ty, L, t, nx: ty, ny: -tx };
      }
    }
    if (best && best.d <= 14) placed.push({ ...best, def, lift: 0 });
  }
  // Signs sharing a wall are packed side by side with a gap (overlapping planes z-fight: Nikora and
  // TBC stand ~2.5 m apart). If a wall is too crowded, the leftover sign goes up a row.
  const walls = new Map();
  for (const s of placed) { if (!walls.has(s.key)) walls.set(s.key, []); walls.get(s.key).push(s); }
  const GAP = 0.35;
  for (const list of walls.values()) {
    list.sort((a, b) => a.t - b.t);
    const lo = (s) => s.def.w / 2 + 0.2, hi = (s) => s.L - s.def.w / 2 - 0.2;
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < list.length; i++) list[i].t = Math.max(list[i].t, list[i - 1].t + (list[i - 1].def.w + list[i].def.w) / 2 + GAP);
      list[list.length - 1].t = Math.min(list[list.length - 1].t, hi(list[list.length - 1]));
      for (let i = list.length - 2; i >= 0; i--) list[i].t = Math.min(list[i].t, list[i + 1].t - (list[i + 1].def.w + list[i].def.w) / 2 - GAP);
      list[0].t = Math.max(list[0].t, lo(list[0]));
    }
    for (let i = 1; i < list.length; i++) {
      if (list[i].t - list[i - 1].t < (list[i - 1].def.w + list[i].def.w) / 2) list[i].lift = list[i - 1].lift + list[i - 1].def.w * 0.25 + 0.2;
    }
  }
  placed.forEach((s, i) => {
    const px = s.ax + s.tx * s.t, py = s.ay + s.ty * s.t;
    const h = s.def.w * 0.25;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(s.def.w, h), new THREE.MeshStandardMaterial({
      map: signTexture(s.def), roughness: 0.5, emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0 }));
    sign.material.emissiveMap = sign.material.map;
    const y = H(px, py) + 3.78 + s.lift;
    const off = 0.14 + (i % 3) * 0.015; // never exactly coplanar with a neighbour
    sign.position.set(px + s.nx * off, y, -(py + s.ny * off));
    sign.rotation.y = Math.atan2(s.nx, -s.ny);
    sign.userData.sign = true;
    group.add(sign);
  });
}

// The "small stadium" at the west end of the middle courtyard (gallery photos): a round court of red
// rubber with white markings, a tall dark-green welded-mesh fence on round posts with a gate north and
// south, and one basketball hoop with a glass backboard on a white pole.
function buildStadium(c, group, metalCyls, metalBoxes, colliders, H, models) {
  const R = c.w / 2, y = H(c.x, c.y);
  const surface = (() => {
    const S = 1024, k = S / (2 * R), cv = canvas(S), ctx = cv.getContext('2d'), r = mulberry(77);
    ctx.fillStyle = '#a4473a'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 16000; i++) {
      ctx.fillStyle = r() < 0.5 ? `rgba(70,22,16,${0.08 + r() * 0.1})` : `rgba(215,130,110,${0.06 + r() * 0.08})`;
      ctx.fillRect(r() * S, r() * S, 2, 2);
    }
    ctx.strokeStyle = 'rgba(244,243,236,0.92)'; ctx.lineWidth = 0.06 * k;
    const X = (m) => S / 2 + m * k, Y = (m) => S / 2 - m * k; // canvas: east right, north up
    ctx.beginPath(); ctx.arc(X(0), Y(0), (R - 0.4) * k, 0, Math.PI * 2); ctx.stroke();            // boundary
    const base = R - 0.9;                                                                          // baseline under the hoop (east)
    ctx.strokeRect(X(base - 5.8), Y(2.45), 5.8 * k, 4.9 * k);                                      // the key
    ctx.beginPath(); ctx.arc(X(base - 5.8), Y(0), 1.8 * k, 0, Math.PI * 2); ctx.stroke();        // free-throw circle
    ctx.beginPath(); ctx.arc(X(base - 1.575), Y(0), 1.25 * k, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke(); // restricted arc
    ctx.beginPath(); ctx.arc(X(-R + 0.4), Y(0), 1.8 * k, -Math.PI / 2, Math.PI / 2); ctx.stroke(); // centre half-circle at the far side
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  })();
  const court = new THREE.Mesh(new THREE.CircleGeometry(R, 72).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: surface, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  court.position.set(c.x, y + 0.04, -c.y);
  court.receiveShadow = true;
  group.add(court);
  const curb = new THREE.Mesh(new THREE.RingGeometry(R, R + 0.3, 72).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xcfcbc3, roughness: 0.9 }));
  curb.position.set(c.x, y + 0.06, -c.y);
  curb.receiveShadow = true;
  group.add(curb);

  // fence: posts every 18 degrees, welded mesh panels, top and bottom rails, gates north and south
  const mesh = (() => {
    const cv = canvas(128), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = '#27513a'; ctx.lineWidth = 2.5;
    for (let x = 4; x < 128; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke(); }
    for (let yy = 4; yy < 128; yy += 16) { ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(128, yy); ctx.stroke(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();
  const meshMat = new THREE.MeshStandardMaterial({ map: mesh, alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3 });
  const N = 20, RF = R + 0.15, TOP = 3.6, green = 0x21412e;
  const gate = (a) => Math.abs(Math.sin(a) + 1) < 0.08 || Math.abs(Math.sin(a) - 1) < 0.08; // panel centred due south / north
  const panels = [];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2 + Math.PI / N, a1 = ((i + 1) / N) * Math.PI * 2 + Math.PI / N;
    const x0 = c.x + Math.cos(a0) * RF, y0 = c.y + Math.sin(a0) * RF, x1 = c.x + Math.cos(a1) * RF, y1 = c.y + Math.sin(a1) * RF;
    metalCyls.add(x0, y + TOP / 2, -y0, 0, 0.1, TOP, 0.1, green);
    const L = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    if (gate((a0 + a1) / 2)) {
      metalBoxes.add(mx, y + TOP - 0.03, -my, ang, L, 0.06, 0.06, green); // lintel over the gate
      continue;
    }
    for (const h of [0.12, 1.3, TOP - 0.03]) metalBoxes.add(mx, y + h, -my, ang, L, 0.05, 0.05, green);
    const g = new THREE.BufferGeometry();
    const P = [x0, y + 0.1, -y0, x1, y + 0.1, -y1, x1, y + TOP, -y1, x0, y + 0.1, -y0, x1, y + TOP, -y1, x0, y + TOP, -y0];
    const u = L / 0.5, v = (TOP - 0.1) / 0.5;
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, u, 0, u, v, 0, 0, u, v, 0, v], 2));
    g.computeVertexNormals();
    panels.push(g);
    colliders.addSegment(x0, -y0, x1, -y1, { height: y + TOP, kind: 'fence', shoot: false });
  }
  const fm = new THREE.Mesh(mergeGeometries(panels), meshMat);
  fm.castShadow = true;
  group.add(fm);

  // the hoop, on the east side, facing the centre
  const hx = c.x + R - 0.45, hy = c.y;
  const hoop = models.props && models.props.hoop;
  if (hoop) {
    const m = hoop.clone(true);
    m.rotation.y = Math.PI / 2; // the backboard faces -Z in the file; turn it to face west (-x)
    m.position.set(0, 0, 0);
    m.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(m);
    m.position.set(hx - b.max.x, y + 0.04 - b.min.y, -hy - (b.min.z + b.max.z) / 2);
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(m);
  } else {
    const white = 0xf2f2ef;
    metalCyls.add(hx, y + 1.75, -hy, 0, 0.16, 3.5, 0.16, white);
    metalBoxes.add(hx - 0.6, y + 3.45, -hy, 0, 1.2, 0.12, 0.12, white);
    metalBoxes.add(hx - 1.2, y + 3.4, -hy, 0, 0.04, 1.05, 1.8, 0xdfe8ea);
    metalCyls.add(hx - 1.6, y + 3.05, -hy, 0, 0.46, 0.03, 0.46, 0xe0582a);
  }
  colliders.addCircle(hx, -hy, 0.18, { height: y + 4, kind: 'post' });
}
