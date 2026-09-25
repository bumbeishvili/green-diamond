import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry, pointInPoly, polyCentroid } from './geom.js';
import { radialTexture } from './textures.js';
import { shopLayout, SignBoard } from './shops.js';
import { buildingHeight } from './buildings.js';

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

// Distance from a point to a segment (map coordinates).
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
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
    // (new planting on stakes: a thin stem and a few leaves)
    sapling: { trunkH: 2.3, trunkR: 0.045, canopy: canopyGeometry(4, 0.75, 1.0, 11, 0.75), cy: 2.7 },
    young: { trunkH: 2.0, trunkR: 0.07, canopy: canopyGeometry(2, 1.15, 1.25, 34, 1.0), cy: 2.7 },
    street: { trunkH: 2.3, trunkR: 0.1, canopy: canopyGeometry(3, 1.7, 1.6, 50, 1.25), cy: 3.3 },
  };
  const trunks = {}, canopies = {};
  for (const [k, def] of Object.entries(treeKinds)) {
    trunks[k] = new Batch(trunkGeometry(def.trunkH + 0.6, def.trunkR, k === 'young' ? 2 : 4, k.length), bark);
    canopies[k] = [0, 1, 2].map((i) => new Batch(def.canopy, leafMats[i]));
  }
  // the round courts, the playgrounds and the gazebos' bases are kept clear of trees, benches and lamps
  const padD = (pg) => pg.round || Math.min(pg.w, pg.d);
  const clearings = [
    ...level.sport.filter((c) => c.kind === 'court_round').map((c) => [c.x, c.y, c.w / 2 + 0.8]),
    ...level.playgrounds.map((pg) => [pg.x, pg.y, padD(pg) / 2 + 0.5]),
    ...level.pergolas.filter((pg) => pg.base).map((pg) => [pg.x, pg.y, 4.2]),
  ];
  const cleared = (x, y) => clearings.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r);
  const density = quality.drawTrees;
  for (const t of level.trees) {
    if (rnd() > density) continue;
    const def = treeKinds[t.kind] || treeKinds.street;
    const y = H(t.x, t.y);
    const s = t.s;
    const v = Math.floor(rnd() * 3), sx = s * (0.9 + rnd() * 0.2), sz = s * (0.9 + rnd() * 0.2);
    if (cleared(t.x, t.y)) continue;
    trunks[t.kind].add(t.x, y, -t.y, t.r, s, s, s);
    canopies[t.kind][v].add(t.x, y + def.cy * s, -t.y, t.r, sx, s, sz);
    if (t.staked) {
      // a sapling tied to two stakes (the new planting across Bob Walsh Street)
      for (const sd of [-1, 1]) {
        const ox = Math.cos(t.r) * 0.28 * sd, oy = Math.sin(t.r) * 0.28 * sd;
        boxes.add(t.x + ox, y + 0.8, -(t.y + oy), t.r, 0.05, 1.6, 0.05, 0xa98a62);
      }
      boxes.add(t.x, y + 1.35, -t.y, t.r, 0.6, 0.04, 0.04, 0xa98a62);
    }
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
    if (cleared(l.x, l.y)) continue;
    const y = H(l.x, l.y);
    const street = l.kind === 'street' || l.kind === 'double';
    const h = l.kind === 'double' ? 9 : street ? 6.5 : 3.8;
    // (the street lamps out along Bob Walsh Street are galvanised grey, the complex's dark)
    const outside = level.play && !pointInPoly(l.x, l.y, level.play.outer), pole = outside ? 0xb9bcbf : 0x2b2d30;
    (outside ? cyls : metalCyls).add(l.x, y + h / 2, -l.y, 0, l.kind === 'double' ? 0.16 : 0.12, h, l.kind === 'double' ? 0.16 : 0.12, pole);
    if (street) {
      // (a double lamp: two arms, one over each carriageway)
      for (const sd of l.kind === 'double' ? [1, -1] : [1]) {
        const ax = Math.cos(l.h) * sd, ay = Math.sin(l.h) * sd;
        (outside ? boxes : metalBoxes).add(l.x + ax * 0.6, y + h - 0.05, -(l.y + ay * 0.6), Math.atan2(ay, ax), 1.3, 0.08, 0.08, pole);
        lampHeads.push([l.x + ax * 1.2, y + h - 0.15, -(l.y + ay * 1.2), Math.atan2(ay, ax), 0.6, 0.12, 0.28]);
      }
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
    if (cleared(b.x, b.y)) continue;
    const y = H(b.x, b.y), ry = b.h;
    const ca = Math.cos(b.h), sa = Math.sin(b.h);
    boxes.add(b.x, y + 0.45, -b.y, ry, 1.8, 0.06, 0.45, 0x8a5a36);
    boxes.add(b.x - ca * 0 + sa * 0.22, y + 0.72, -(b.y - ca * 0.22), ry, 1.8, 0.35, 0.05, 0x8a5a36, -0.18);
    for (const s of [-0.75, 0.75]) metalBoxes.add(b.x + ca * s, y + 0.22, -(b.y + sa * s), ry, 0.06, 0.45, 0.5, 0x222426);
    colliders.addBox(b.x, -b.y, 0.9, 0.3, -ry, { height: 0.8, kind: 'bench' });
  }

  // ---------------- fences ----------------
  buildFences(level, group, colliders, H);

  // ---------------- playgrounds: round pads with a light curb (the drone photos): dark rubber with
  // the climbing tower, slide and swings; small light ones with toddlers' toys ----------------
  const rubber = new THREE.MeshStandardMaterial({ map: rubberTexture(), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pads = [];
  for (const pg of level.playgrounds) {
    const y = H(pg.x, pg.y), D = padD(pg);
    const ca = Math.cos(pg.r), sa = Math.sin(pg.r);
    const L = (lx, lz) => [pg.x + lx * ca - lz * sa, pg.y + lx * sa + lz * ca]; // local -> map
    // (the curb: a low pale disc under the pad)
    cyls.add(pg.x, y + 0.02, -pg.y, 0, D + 0.5, 0.06, D + 0.5, 0xd9d5cc);
    if (pg.small) {
      // light rubber, spring riders and a see-saw
      cyls.add(pg.x, y + 0.04, -pg.y, 0, D, 0.05, D, 0xcfc6b4);
      for (const [lx, lz, col] of [[-1.6, 1.2, 0xe9442e], [1.5, 1.4, 0x3cae3f], [0.2, -1.8, 0x2a7fd0], [-1.9, -0.9, 0xf2c31b]]) {
        const [px, py] = L(lx, lz);
        cyls.add(px, y + 0.25, -py, 0, 0.1, 0.5, 0.1, 0x555555);
        boxes.add(px, y + 0.62, -py, pg.r + lx, 0.65, 0.32, 0.28, col);
      }
      const [qx, qy] = L(1.2, -0.6);
      boxes.add(qx, y + 0.3, -qy, pg.r, 0.2, 0.5, 0.2, 0xf2c31b);
      boxes.add(qx, y + 0.5, -qy, pg.r, 2.6, 0.08, 0.25, 0xd8322a, 0, 0.12);
      continue;
    }
    pads.push(new THREE.CircleGeometry(D / 2, 48).rotateX(-Math.PI / 2).rotateY(pg.r).translate(pg.x, y + 0.065, -pg.y));
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
  if (pads.length) {
    const m = new THREE.Mesh(mergeGeometries(pads), rubber);
    m.receiveShadow = true;
    group.add(m);
  }

  // ---------------- courts: round pads and the fenced round courts, each with a triple hoop ----------------
  // (painted steel: the fences and hoops use the matte batches)
  const hoops = {
    cyls, boxes,
    boards: new Batch(box, new THREE.MeshStandardMaterial({ color: 0xdde8ec, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false }), { shadow: false }),
    rims: new Batch(new THREE.TorusGeometry(0.225, 0.013, 6, 24).rotateX(Math.PI / 2), metalTinted),
    nets: new Batch(new THREE.CylinderGeometry(0.225, 0.15, 0.42, 12, 1, true).translate(0, -0.21, 0), new THREE.MeshStandardMaterial({ map: netTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }), { shadow: false }),
  };
  const pink = new THREE.MeshStandardMaterial({ color: 0xd66d8a, roughness: 0.9 });
  for (const c of level.sport) {
    if (c.kind === 'court_round') { buildStadium(c, group, hoops, colliders, H); continue; }
    const y = H(c.x, c.y);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(c.w / 2, 40).rotateX(-Math.PI / 2), pink);
    pad.position.set(c.x, y + 0.03, -c.y);
    pad.receiveShadow = true;
    group.add(pad);
    tripleHoop(c.x, c.y, y, 0, hoops, colliders);
  }
  const boardMesh = hoops.boards.build(group);
  if (boardMesh) boardMesh.renderOrder = 1;
  for (const b of [hoops.rims, hoops.nets]) b.build(group);

  // ---------------- timber pergolas + gazebo ----------------
  const wood = 0x6b4630;
  level.pergolas.forEach((pg, idx) => {
    const y = H(pg.x, pg.y);
    const ca = Math.cos(pg.r), sa = Math.sin(pg.r);
    const L = (lx, lz) => [pg.x + lx * ca - lz * sa, pg.y + lx * sa + lz * ca];
    if (pg.kind === 'cabana') {
      // the pool court's timber cabanas (a photo from the towers): four posts, a slatted roof, a lounger
      const W = 2.6, D = 2.4, Hh = 2.4, timber = 0x8a6446;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const [px, py] = L(dx * (W / 2 - 0.06), dz * (D / 2 - 0.06));
        boxes.add(px, y + Hh / 2, -py, pg.r, 0.1, Hh, 0.1, timber);
        colliders.addCircle(px, -py, 0.08, { height: y + Hh, kind: 'post' });
      }
      for (const dz of [-1, 1]) {
        const [px, py] = L(0, dz * (D / 2 - 0.06));
        boxes.add(px, y + Hh - 0.06, -py, pg.r, W + 0.1, 0.12, 0.08, timber);
      }
      for (let k = 0; k <= 8; k++) {
        const [px, py] = L(-W / 2 + (k / 8) * W, 0);
        boxes.add(px, y + Hh + 0.04, -py, pg.r + Math.PI / 2, D + 0.1, 0.05, 0.08, timber);
      }
      const [lx, ly] = L(0.15, 0), [bx, by] = L(-0.85, 0);
      boxes.add(lx, y + 0.32, -ly, pg.r, 1.5, 0.1, 0.66, 0xf0f0ee);
      boxes.add(bx, y + 0.52, -by, pg.r, 0.5, 0.08, 0.66, 0xf0f0ee, 0, 0.7);
      for (const dz of [-0.28, 0.28]) { const [fx, fy] = L(0.15, dz); boxes.add(fx, y + 0.14, -fy, pg.r, 1.4, 0.28, 0.05, 0xd8d8d6); }
      return;
    }
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
      // on a round pale paved base in the lawn (the gallery's aerial photo)
      if (pg.base) cyls.add(pg.x, y + 0.03, -pg.y, 0, 5.8, 0.12, 5.8, 0xe4e1da);
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

  const shrubs = new Batch(canopyGeometry(9, 0.5, 0.42, 16, 0.6), leafMats[1]);

  // ---------------- a hedge along the pool court's terrace, where the retaining wall edges it ----------------
  for (const t of level.zones.terrace || []) {
    const pts = t.outer;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 8) continue;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const walled = level.walls.some((w) => w.some(([wx, wy], k) => k < w.length - 1 && segDist(mx, my, wx, wy, w[k + 1][0], w[k + 1][1]) < 1.0));
      if (!walled) continue;
      const tx = (bx - ax) / len, ty = (by - ay) / len;
      // (inwards: the terrace is on the left of its anticlockwise ring... or the right of a clockwise one)
      let nx = -ty, ny = tx;
      if (!pointInPoly(mx + nx * 0.8, my + ny * 0.8, pts)) { nx = -nx; ny = -ny; }
      for (let d = 0.6; d < len - 0.5; d += 1.1) {
        const x = ax + tx * d + nx * 0.5, y = ay + ty * d + ny * 0.5;
        shrubs.add(x, H(x, y) + 0.45, -y, rnd() * 6, 0.9 + rnd() * 0.2, 0.9, 0.9 + rnd() * 0.2);
      }
    }
  }

  // ---------------- in front of the shops: square planters, café tables, Nikora's fridges ----------------
  const shopProps = shopLayout(level, buildingHeight).props;
  const at = ({ w, u }, out) => [w.ax + w.tx * u + w.nx * out, w.ay + w.ty * u + w.ny * out];
  for (const q of shopProps.planters) {
    const [x, y] = at(q, 1.1), gy = H(x, y), ry = Math.atan2(q.w.ny, q.w.nx);
    boxes.add(x, gy + 0.45, -y, ry, 0.9, 0.9, 0.9, 0xc4c1ba);
    shrubs.add(x, gy + 1.2, -y, rnd() * 6, 1, 1, 1);
    colliders.addBox(x, -y, 0.45, 0.45, -ry, { height: 0.9, kind: 'bench' });
  }
  for (const q of shopProps.cafe) {
    // a black bistro table with a white chair either side
    const [x, y] = at(q, 2.4), gy = H(x, y), ry = Math.atan2(q.w.ny, q.w.nx);
    metalCyls.add(x, gy + 0.37, -y, 0, 0.06, 0.74, 0.06, 0x1d1e20);
    metalCyls.add(x, gy + 0.75, -y, 0, 0.7, 0.03, 0.7, 0x1d1e20);
    for (const s of [-1, 1]) {
      const cx = x + q.w.tx * s * 0.62, cy = y + q.w.ty * s * 0.62;
      boxes.add(cx, gy + 0.45, -cy, ry, 0.42, 0.05, 0.42, 0xf0f0ee);
      boxes.add(cx + q.w.tx * s * 0.2, gy + 0.68, -(cy + q.w.ty * s * 0.2), ry, 0.42, 0.44, 0.04, 0xf0f0ee);
      for (const [lx, lz] of [[-0.18, -0.18], [-0.18, 0.18], [0.18, -0.18], [0.18, 0.18]]) {
        metalBoxes.add(cx + q.w.nx * lx + q.w.tx * lz, gy + 0.22, -(cy + q.w.ny * lx + q.w.ty * lz), ry, 0.03, 0.44, 0.03, 0xdadad8);
      }
    }
    colliders.addCircle(x, -y, 0.4, { height: 0.8, kind: 'bench' });
  }
  for (const q of shopProps.fridges) {
    const [x, y] = at(q, 0.45), gy = H(x, y), ry = Math.atan2(q.w.ny, q.w.nx);
    boxes.add(x, gy + 1.0, -y, ry, 0.8, 2.0, 0.85, 0xf2f2f0);
    colliders.addBox(x, -y, 0.4, 0.43, -ry, { height: 2.0, kind: 'crate' });
  }
  for (const q of shopProps.awnings) {
    // a striped canvas awning under a café's sign, sloping out over its glass
    const [u0, u1] = q.u, n = Math.max(2, Math.round((u1 - u0) / 0.4)), ry = Math.atan2(q.w.ny, q.w.nx);
    for (let k = 0; k < n; k++) {
      const [x, y] = at({ w: q.w, u: u0 + (k + 0.5) * (u1 - u0) / n }, 0.45), gy = H(x, y);
      boxes.add(x, gy + 2.82, -y, ry, 0.95, 0.03, (u1 - u0) / n, k % 2 ? 0xf2f2ee : 0x8a8d90, 0, -0.32);
    }
  }
  const domes = new Batch(new THREE.SphereGeometry(0.62, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), matte(0x2c2724, 0.9));
  for (const q of shopProps.ovens) {
    // a wood-fired pizza oven on a steel stand, out on a restaurant's terrace (the user's photo)
    const [x, y] = at(q, 1.3), gy = H(x, y), ry = Math.atan2(q.w.ny, q.w.nx);
    domes.add(x, gy + 1.02, -y, 0, 1, 0.95, 1);
    boxes.add(x, gy + 0.98, -y, ry, 1.35, 0.1, 1.35, 0x2a2a2a);
    for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      metalBoxes.add(x + (q.w.nx * a + q.w.tx * b) * 0.58, gy + 0.47, -(y + (q.w.ny * a + q.w.ty * b) * 0.58), ry, 0.05, 0.94, 0.05, 0x222222);
    }
    metalCyls.add(x, gy + 1.85, -y, 0, 0.14, 0.55, 0.14, 0x3a3a3a);
    colliders.addCircle(x, -y, 0.72, { height: gy + 1.7, kind: 'crate' });
  }
  domes.build(group);
  shrubs.build(group);

  // ---------------- entrance portals, boom barriers, diamond sculpture ----------------
  const gateSigns = buildGates(level, group, boxes, metalBoxes, colliders, H);

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
      gateSigns.update(atmo.lampLevel);
      poolMat.opacity = atmo.lampLevel;
      if (poolMesh) poolMesh.visible = atmo.lampLevel > 0.02;
    },
  };
}

// Playground rubber: dark purple with a sweep of red-brown across one side, fine speckle.
function rubberTexture() {
  const c = canvas(512), ctx = c.getContext('2d'), r = mulberry(5);
  ctx.fillStyle = '#4a3d53'; ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#7e3a31';
  ctx.beginPath(); ctx.moveTo(0, 330); ctx.bezierCurveTo(170, 250, 340, 420, 512, 300); ctx.lineTo(512, 512); ctx.lineTo(0, 512); ctx.closePath(); ctx.fill();
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = r() < 0.5 ? `rgba(0,0,0,${0.1 + r() * 0.12})` : `rgba(255,255,255,${0.04 + r() * 0.06})`;
    ctx.fillRect(r() * 512, r() * 512, 2, 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// White vertical-bar railings round the courtyard; green welded mesh on a white plinth round the site,
// except along the dirt road at the back (the user's photo from the road), where the site stands on a
// grey concrete retaining wall with drain pipes through it and a hose slung along it, the mesh on top.
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
  const wallMat = new THREE.MeshStandardMaterial({ map: concreteWallTexture(), roughness: 0.95 });
  const parts = { court: [], mesh: [], plinth: [], wall: [], pipes: [], hose: [] };
  for (const f of level.fences) {
    const perim = f.type === 'perimeter';
    for (let i = 0; i < f.line.length - 1; i++) {
      const [ax, ay] = f.line[i], [bx, by] = f.line[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 0.05) continue;
      const ya = H(ax, ay), yb = H(bx, by);
      const base = Math.min(ya, yb);
      // (the back of the site: the run along the far side of the podiums, looking out over the dirt road)
      const retaining = perim && Math.max(ay, by) < -120 && Math.abs(by - ay) < 0.2 * L;
      const plinthH = retaining ? 1.3 : perim ? 0.45 : 0.0;
      const top = retaining ? 2.5 : f.height;
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
        // plinth: a thin box strip (the retaining wall: a thicker one, its texture in metres)
        const g = new THREE.BoxGeometry(L, plinthH + 0.2, retaining ? 0.3 : 0.22);
        if (retaining) {
          const uv = g.attributes.uv, nor = g.attributes.normal;
          for (let k = 0; k < uv.count; k++) if (Math.abs(nor.getX(k)) < 0.5) uv.setX(k, uv.getX(k) * L / 3);
        }
        g.translate(L / 2, (plinthH + 0.2) / 2 - 0.2, 0);
        g.rotateY(Math.atan2(by - ay, bx - ax));
        g.translate(ax, base, -ay);
        (retaining ? parts.wall : parts.plinth).push(g);
        if (retaining) {
          // the outer face: the side away from the site, to the south
          let nx = (by - ay) / L, ny = -(bx - ax) / L;
          if (ny > 0) { nx = -nx; ny = -ny; }
          const tx = (bx - ax) / L, ty = (by - ay) / L, r = mulberry(Math.round(ax * 7 + ay * 13) >>> 0);
          const face = (d, out) => [ax + tx * d + nx * out, ay + ty * d + ny * out];
          // drain pipes down the face, with an elbow into the wall
          for (let d = 4 + r() * 4; d < L - 1; d += 9 + r() * 6) {
            const [px, py] = face(d, 0.24);
            parts.pipes.push(new THREE.CylinderGeometry(0.06, 0.06, 1.05, 8).translate(px, base + 0.85, -py));
            const [ex, ey] = face(d, 0.19);
            parts.pipes.push(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 8).rotateX(Math.PI / 2).rotateY(Math.atan2(ny, nx) - Math.PI / 2).translate(ex, base + 1.34, -ey));
          }
          // a black hose slung from hooks along the top, sagging in between
          const pts = [];
          for (let d = 0.5; d <= L - 0.5; d += 0.5) {
            const span = 6.5, t = (d % span) / span;
            const [hx, hy] = face(d, 0.18);
            pts.push(new THREE.Vector3(hx, base + 1.2 - Math.sin(Math.PI * t) * (0.5 + 0.2 * Math.sin(d * 0.37)), -hy));
          }
          if (pts.length > 3) parts.hose.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.022, 5, false));
        }
      } else {
        parts.court.push(quad(0, top, 0.8));
      }
      colliders.addSegment(ax, -ay, bx, -by, { height: base + top, kind: 'fence', shoot: false });
    }
  }
  if (parts.court.length) { const m = new THREE.Mesh(mergeGeometries(parts.court), courtMat); m.castShadow = true; group.add(m); }
  if (parts.mesh.length) { const m = new THREE.Mesh(mergeGeometries(parts.mesh), meshMat); m.castShadow = true; group.add(m); }
  if (parts.plinth.length) { const m = new THREE.Mesh(mergeGeometries(parts.plinth), plinthMat); m.castShadow = m.receiveShadow = true; group.add(m); }
  if (parts.wall.length) { const m = new THREE.Mesh(mergeGeometries(parts.wall), wallMat); m.castShadow = m.receiveShadow = true; group.add(m); }
  if (parts.pipes.length) { const m = new THREE.Mesh(mergeGeometries(parts.pipes), new THREE.MeshStandardMaterial({ color: 0xc9cacb, roughness: 0.6 })); m.castShadow = true; group.add(m); }
  if (parts.hose.length) { const m = new THREE.Mesh(mergeGeometries(parts.hose), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 })); group.add(m); }
}

// Weathered grey concrete for the retaining wall: formwork joints, rain streaks, dirt at the foot.
function concreteWallTexture() {
  const c = canvas(512, 256), ctx = c.getContext('2d'), r = mulberry(21);
  ctx.fillStyle = '#a6a59f'; ctx.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = r() < 0.5 ? `rgba(60,60,55,${0.05 + r() * 0.08})` : `rgba(230,230,225,${0.04 + r() * 0.06})`;
    ctx.fillRect(r() * 512, r() * 256, 2 + r() * 3, 2);
  }
  ctx.fillStyle = 'rgba(70,70,65,0.25)';
  for (const y of [70, 150]) ctx.fillRect(0, y, 512, 2);
  for (let i = 0; i < 18; i++) {
    const x = r() * 512, w = 3 + r() * 14, g = ctx.createLinearGradient(0, 20, 0, 180 + r() * 60);
    g.addColorStop(0, 'rgba(60,60,55,0.25)'); g.addColorStop(1, 'rgba(60,60,55,0)');
    ctx.fillStyle = g; ctx.fillRect(x, 20, w, 220);
  }
  const g = ctx.createLinearGradient(0, 190, 0, 256);
  g.addColorStop(0, 'rgba(90,80,65,0)'); g.addColorStop(1, 'rgba(90,80,65,0.45)');
  ctx.fillStyle = g; ctx.fillRect(0, 190, 512, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
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

// The gates on Bob Walsh Street (the user's photospheres at both, 2023 and 2025): a white portal
// over the road - a raked leg on the south side, a slatted roof between two deep beams with
// "GATE 1" on the street face - landing on the canopy over the glass security booth north of the
// road, where a raked white wall carries the Green Diamond logo to the street. Orange barrier posts;
// Gate 1 has the glass diamond hung on its leg.
function buildGates(level, group, boxes, metalBoxes, colliders, H) {
  const logo = new THREE.MeshStandardMaterial({ map: logoTexture(), roughness: 0.6 });
  const board = new SignBoard();   // the lettering and the banner: one mesh
  const WHITE = 0xf1f1ee, STEEL = 0xa7acb1;
  const put = (mesh, x, h, y, q) => { mesh.position.set(x, h, -y); if (q) mesh.quaternion.copy(q); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); };
  const qY = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
  const qZ = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
  for (const gate of level.gates) {
    const booth = level.buildings.find((b) => b.group === 'guard' && Math.abs(polyCentroid(b.poly.outer)[1] - gate.y) < 14);
    if (!booth) continue;
    const xs = booth.poly.outer.map((p) => p[0]), ys = booth.poly.outer.map((p) => p[1]);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
    const cx = (bx0 + bx1) / 2, bcy = (by0 + by1) / 2;
    const y = H(cx, gate.y);
    const ySouth = gate.y - 4.3, yNorth = by1 + 1.1;   // the leg's foot; the far end of the roof
    const TOP = 6.95, BEAM = 0.55, lean = 0.26;          // top of the beams, their depth, the leg's rake
    // the leg south of the road, raked in over it
    const legH = TOP + 0.1, legY = ySouth + Math.sin(lean) * legH / 2;
    boxes.add(cx, y + Math.cos(lean) * legH / 2, -legY, 0, 3.4, legH, 0.6, WHITE, -lean);
    colliders.addBox(cx, -ySouth, 1.7, 0.4, 0, { height: y + 3, kind: 'wall' });
    // two deep beams across the road, slats between them, "GATE n" on the street side
    const yS = ySouth + Math.sin(lean) * legH, span = yNorth - yS;
    for (const s of [-1, 1]) boxes.add(cx + s * 1.45, y + TOP - BEAM / 2, -(yS + span / 2), 0, 0.45, BEAM, span, WHITE);
    for (let k = 1; k * 1.1 < span - 0.3; k++) boxes.add(cx, y + TOP - 0.16, -(yS + k * 1.1), 0, 2.5, 0.28, 0.13, WHITE);
    board.add('gate:' + gate.name, lettering(gate.name.toUpperCase(), 2.4, 0.46), cx + 1.45 + 0.235, gate.y, y + TOP - BEAM / 2, [0, 1], [1, 0]);
    // the canopy over the booth, its raked end up to the beams, grey steel props on the street side
    boxes.add(cx + 0.55, y + 4.78, -bcy, 0, bx1 - bx0 + 2.9, 0.44, by1 - by0 + 1.4, WHITE);
    const endH = TOP - 5.0;
    boxes.add(cx, y + 5.0 + endH / 2, -(by1 + 0.05 + Math.tan(0.5) * endH / 2), 0, 3.4, endH / Math.cos(0.5), 0.5, WHITE, -0.5);
    for (const yy of [by0 - 0.35, by1 + 0.35]) {
      metalBoxes.add(bx1 + 1.7, y + 2.3, -yy, 0, 0.16, 4.7, 0.16, STEEL, 0, -0.16);
      colliders.addCircle(bx1 + 1.5, -yy, 0.15, { height: y + 4.5, kind: 'post' });
    }
    // the raked logo panel hung under the canopy's street end, the booth's glass below it
    const wallH = 2.0, wallLean = 0.13, wx = bx1 + 0.95, w0 = 2.56;
    const qWall = qZ(-wallLean);
    const wallC = new THREE.Vector3(0, wallH / 2, 0).applyQuaternion(qWall);
    boxes.add(wx + wallC.x, y + w0 + wallC.y, -bcy, 0, 0.4, wallH, 4.4, WHITE, 0, -wallLean);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), logo);
    const sp = new THREE.Vector3(0.215, wallH * 0.5, 0).applyQuaternion(qWall);
    put(sign, wx + sp.x, y + w0 + sp.y, bcy, qWall.clone().multiply(qY(Math.PI / 2)));
    // "SECURITY" over the booth's window, on its street face
    board.add('security', lettering('SECURITY', 1.5, 0.34, '#26292c', '#f2f2f2'), bx1 + 0.02, bcy, y + 2.3, [0, 1], [1, 0]);
    // orange barrier posts either side of the road, the striped arm across it
    const bx = gate.x + 1.6;
    for (const s of [-1, 1]) {
      metalBoxes.add(bx, y + 0.55, -(gate.y + s * 3.3), 0, 0.34, 1.1, 0.34, 0xe8641c);
      colliders.addCircle(bx, -(gate.y + s * 3.3), 0.2, { height: y + 1.1, kind: 'post' });
    }
    for (let k = 0; k < 6; k++) {
      metalBoxes.add(bx, y + 1.0, -(gate.y - 3.0 + k * 1.0 + 0.5), 0, 0.08, 0.08, 1.0, k % 2 ? 0xffffff : 0xd8262e);
    }
    colliders.addSegment(bx, -(gate.y - 3.3), bx, -(gate.y + 3.3), { height: 1.1, kind: 'barrier', shoot: false });
    // Gate 1: the big blue faceted diamond on a blue steel stand, just inside the foot of the leg
    // (the photospheres, and photos from inside the gate)
    if (gate.name === 'Gate 1') {
      const mat = new THREE.MeshPhysicalMaterial({ color: 0x3f9fd8, metalness: 0.2, roughness: 0.12,
        clearcoat: 1, clearcoatRoughness: 0.05, flatShading: true, envMapIntensity: 1.8 });
      const d = new THREE.Mesh(diamondGeometry(), mat);
      d.scale.set(0.95, 1.37, 0.95);
      const dx = cx - 2.65, dy = ySouth + 0.9, hG = 2.5;   // the girdle at 2.5 m
      d.position.set(dx, y + hG, -dy);
      d.castShadow = true;
      group.add(d);
      group.userData.diamond = d;
      // the stand: three raked legs up to a ring under the girdle, braced low down
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.3, ca = Math.cos(a), sa = Math.sin(a);
        metalBoxes.add(dx + ca * 0.6, y + (hG - 0.35) / 2, -(dy + sa * 0.6), -a, 0.06, hG - 0.3, 0.06, 0x1f6fb5, 0, 0.12);
        const b = a + Math.PI / 3, cb = Math.cos(b), sb = Math.sin(b);
        metalBoxes.add(dx + cb * 0.36, y + 0.7, -(dy + sb * 0.36), b + Math.PI / 2, 1.1, 0.05, 0.05, 0x1f6fb5);
        metalBoxes.add(dx + cb * 0.42, y + hG - 0.4, -(dy + sb * 0.42), b + Math.PI / 2, 0.9, 0.05, 0.05, 0x1f6fb5);
      }
      colliders.addCircle(dx, -dy, 0.7, { height: y + 3.2, kind: 'post' });
    }
    // Gate 2: the sales office's long banner on the fence north of the booth (the 2025 photosphere)
    if (gate.name === 'Gate 2') {
      const fence = level.fences.find((f) => f.type === 'perimeter' && f.line.some(([fx, fy]) => Math.hypot(fx - bx1, fy - by1) < 4));
      const seg = fence && fence.line.slice(0, -1).map((a, i) => [a, fence.line[i + 1]]).find(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 30);
      if (seg) {
        const [[ax, ay], [ex, ey]] = seg, L = Math.hypot(ex - ax, ey - ay), tx = (ex - ax) / L, ty = (ey - ay) / L;
        const len = 24, mx = ax + tx * (1 + len / 2) + ty * 0.1, my = ay + ty * (1 + len / 2) - tx * 0.1;
        board.add('sales', salesBanner(len, 2.3), mx, my, H(mx, my) + 1.45, [tx, ty], [ty, -tx]);   // facing the street
      }
    }
  }
  return board.build(group);
}

// The sales banner (sign-board painter): a sketch of the towers on the left, green chevrons and
// SALES on the right. Drawn in a 2048 x 196 frame, scaled to the cell.
function salesBanner(w, h) {
  return {
    w, h, ppm: 64,
    paint(ctx, pw, ph, lit) {
      if (lit) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, pw, ph); return; }
      ctx.scale(pw / 2048, ph / 196);
      ctx.fillStyle = '#f4f5f2'; ctx.fillRect(0, 0, 2048, 196);
      const r = mulberry(31);
      for (let i = 0; i < 26; i++) {
        const bw = 30 + r() * 40, bh = 60 + r() * 120, x = 40 + i * 30 + r() * 20;
        ctx.fillStyle = `rgba(90, 96, 100, ${0.25 + r() * 0.35})`; ctx.fillRect(x, 196 - bh, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        for (let yy = 196 - bh + 6; yy < 190; yy += 9) ctx.fillRect(x + 4, yy, bw - 8, 3);
      }
      const g = ctx.createLinearGradient(900, 0, 2048, 0);
      g.addColorStop(0, '#cfe7b7'); g.addColorStop(1, '#8cc56a');
      ctx.fillStyle = g; ctx.fillRect(900, 0, 1148, 196);
      ctx.fillStyle = '#5fae43';
      for (let k = 0; k < 4; k++) {
        const x = 1350 + k * 150;
        ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x + 70, 98); ctx.lineTo(x, 176); ctx.lineTo(x + 50, 176); ctx.lineTo(x + 120, 98); ctx.lineTo(x + 50, 20); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 84px "Helvetica Neue", Arial, "Noto Sans Georgian", sans-serif';
      ctx.textBaseline = 'middle'; ctx.fillText('გაყიდვები', 960, 70);
      ctx.font = 'bold 60px "Helvetica Neue", Arial, sans-serif'; ctx.fillText('SALES', 1000, 150);
    },
  };
}

// Lettering on a clear background (or on a panel), for the gate beams and the booths.
function lettering(text, w, h, bg = null, fg = '#2a2d31') {
  return {
    w, h,
    paint(ctx, pw, ph, lit) {
      if (lit) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, pw, ph); return; }
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, pw, ph); } else ctx.clearRect(0, 0, pw, ph);
      ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(ph * 0.73)}px Impact, "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(text, pw / 2, ph * 0.54, pw * 0.94);
    },
  };
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

// The round courts in the courtyards (the developer's drone and ground-level photos): terracotta
// concrete with no markings, a green chain-link fence on round posts with a gate north and south,
// and in the middle the triple hoop.
function buildStadium(c, group, hoops, colliders, H) {
  const R = c.w / 2, y = H(c.x, c.y);
  const surface = (() => {
    const S = 512, k = S / (2 * R), cv = canvas(S), ctx = cv.getContext('2d'), r = mulberry(77);
    ctx.fillStyle = '#c47f68'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      const x = r() * S, yy = r() * S, rad = 20 + r() * 70, dark = r() < 0.5;
      ctx.save(); ctx.translate(x, yy); ctx.scale(rad, rad);
      g.addColorStop(0, dark ? 'rgba(90,40,34,0.16)' : 'rgba(225,170,160,0.14)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    for (let i = 0; i < 6000; i++) {
      ctx.fillStyle = r() < 0.5 ? `rgba(70,30,26,${0.06 + r() * 0.08})` : `rgba(230,190,180,${0.05 + r() * 0.06})`;
      ctx.fillRect(r() * S, r() * S, 2, 2);
    }
    // the concrete's saw-cut joints
    ctx.strokeStyle = 'rgba(80,45,40,0.35)'; ctx.lineWidth = 1.5;
    for (const [x0, y0, x1, y1] of [[0.5, 0, 0.5, 1], [0, 0.5, 1, 0.5], [0.12, 0.12, 0.88, 0.88]]) {
      ctx.beginPath(); ctx.moveTo(x0 * S, y0 * S); ctx.lineTo(x1 * S, y1 * S); ctx.stroke();
    }
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

  // fence: posts every 18 degrees, chain-link panels, top and bottom rails, gates north and south
  const mesh = (() => {
    const cv = canvas(128), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = '#5ea653'; ctx.lineWidth = 2.2;
    for (let k = -128; k < 256; k += 32) {
      ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + 128, 128); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(k + 128, 0); ctx.lineTo(k, 128); ctx.stroke();
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();
  const meshMat = new THREE.MeshStandardMaterial({ map: mesh, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.7, metalness: 0.05 });
  const { cyls, boxes } = hoops;
  const N = 20, RF = R + 0.15, TOP = 2.6, green = 0x58a04c;
  const gate = (a) => Math.abs(Math.sin(a) + 1) < 0.08 || Math.abs(Math.sin(a) - 1) < 0.08; // panel centred due south / north
  const panels = [];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2 + Math.PI / N, a1 = ((i + 1) / N) * Math.PI * 2 + Math.PI / N;
    const x0 = c.x + Math.cos(a0) * RF, y0 = c.y + Math.sin(a0) * RF, x1 = c.x + Math.cos(a1) * RF, y1 = c.y + Math.sin(a1) * RF;
    cyls.add(x0, y + TOP / 2 + 0.05, -y0, 0, 0.08, TOP + 0.1, 0.08, green);
    const L = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    if (gate((a0 + a1) / 2)) continue;
    for (const h of [0.1, TOP]) boxes.add(mx, y + h, -my, ang, L, 0.045, 0.045, green);
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
  tripleHoop(c.x, c.y, y, Math.PI / 6, hoops, colliders);
}

// The courts' triple hoop (the ground and drone photos): a white post that splits into three arms
// at 120 degrees, each holding a glass backboard in a white frame (facing out) with an orange rim.
function tripleHoop(x, y, g, turn, hoops, colliders) {
  const { cyls, boxes, boards, rims, nets } = hoops;
  const WHITE = 0xf1f1ee, ORANGE = 0xe0582a, D = 1.05;   // D: from the post to the backboards
  const at = (a, d, h) => [x + Math.cos(a) * d, g + h, -(y + Math.sin(a) * d)];
  cyls.add(x, g + 1.2, -y, 0, 0.2, 2.4, 0.2, WHITE);
  for (let k = 0; k < 3; k++) {
    const a = turn + (k / 3) * Math.PI * 2;
    // the arm: up and out from the top of the post to the back of the board
    const th = Math.atan2(D - 0.1, 0.9);
    cyls.add(...at(a, (D - 0.1) / 2, 2.35 + 0.45), a, 0.13, Math.hypot(D - 0.1, 0.9), 0.13, WHITE, 0, -th);
    boxes.add(...at(a, D / 2, 2.95), a, D, 0.06, 0.06, WHITE);
    // the backboard: glass in a white frame
    boards.add(...at(a, D, 3.42), a, 0.03, 1.02, 1.77);
    for (const [dh, sy, sz] of [[0.51, 0.05, 1.8], [-0.51, 0.05, 1.8]]) boxes.add(...at(a, D + 0.01, 3.42 + dh), a, 0.05, sy, sz, WHITE);
    for (const s of [-1, 1]) {
      const [bx, bh, bz] = at(a, D + 0.01, 3.42);
      boxes.add(bx - Math.sin(a) * s * 0.88, bh, bz - Math.cos(a) * s * 0.88, a, 0.05, 1.07, 0.05, WHITE);
    }
    // the rim on its bracket, and the net
    boxes.add(...at(a, D + 0.1, 3.02), a, 0.2, 0.05, 0.2, ORANGE);
    rims.add(...at(a, D + 0.38, 3.05), 0, 1, 1, 1, ORANGE);
    nets.add(...at(a, D + 0.38, 3.04), 0, 1, 1, 1, 0xf4f4f2);
  }
  colliders.addCircle(x, -y, 0.2, { height: g + 4, kind: 'post' });
}

// A basketball net: white cord in diamonds, a red band at the top.
function netTexture() {
  const c = canvas(64), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = '#f4f4f2'; ctx.lineWidth = 2;
  for (let k = -64; k < 128; k += 16) {
    ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + 64, 64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(k + 64, 0); ctx.lineTo(k, 64); ctx.stroke();
  }
  ctx.fillStyle = '#d8322a'; ctx.fillRect(0, 0, 64, 5);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1);
  return t;
}
