import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flatGeometry, sideGeometry, ribbonGeometry, fixWinding } from './geom.js';
import { pbr } from './textures.js';
import { addMacroVariation, pbrMaterial } from './materials.js';

// Ground surfaces of the complex: roads, parking, pavers, lawns, pool decks, curbs,
// pools, the ramps down to the underground car parks, retaining walls, plus the land around the complex.
export async function buildGround(level, scene, colliders) {
  const group = new THREE.Group();
  group.name = 'ground';
  const [asphalt, pavers, grass, deck, concrete, soil, poolTiles] = await Promise.all(
    ['asphalt', 'pavers', 'grass', 'deck', 'concrete', 'soil', 'pool_tiles'].map(pbr));

  const mats = {
    asphalt: addMacroVariation(pbrMaterial(asphalt, { color: 0xb4b4b8, normalScale: 0.7, roughMap: false, roughness: 0.9 }), { freq: 0.05, amount: 0.12 }),
    parking: addMacroVariation(pbrMaterial(asphalt, { color: 0xc2c2c6, normalScale: 0.7, roughMap: false, roughness: 0.9 }), { freq: 0.07, amount: 0.14 }),
    pavers: addMacroVariation(pbrMaterial(pavers, { color: 0xfff4e4, normalScale: 1.0, roughMap: false, roughness: 0.86 }), { freq: 0.09, amount: 0.12 }),
    lawn: addMacroVariation(pbrMaterial(grass, { color: 0xd8ffb0, normalScale: 0.8, roughMap: false, roughness: 1.0 }),
      { freq: 0.12, amount: 0.2, tint: 0xe8d890, tintAmount: 0.3, tintFreq: 0.03 }),
    deck: pbrMaterial(deck, { color: 0xf4efe4, normalScale: 0.5 }),
    curb: pbrMaterial(concrete, { color: 0xd8d4cc, normalScale: 0.6, roughMap: false, roughness: 0.9 }),
    soil: addMacroVariation(pbrMaterial(soil, { color: 0xd2c3ad, roughMap: false, roughness: 1.0 }), { freq: 0.04, amount: 0.2 }),
    wild: addMacroVariation(pbrMaterial(grass, { color: 0xd8dcb0, normalScale: 0.8, roughMap: false, roughness: 1.0 }),
      { freq: 0.03, amount: 0.25, tint: 0xc9b27a, tintAmount: 0.7, tintFreq: 0.02 }),
    pool: pbrMaterial(poolTiles, { color: 0xffffff, normalScale: 0.4 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xe9e7df, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    wall: pbrMaterial(concrete, { color: 0xcfcac1, normalScale: 0.8, side: THREE.DoubleSide, roughMap: false, roughness: 0.92 }),
  };
  const uv = { asphalt: 5, parking: 5, pavers: 2.2, lawn: 3, deck: 2.4, curb: 1.2, soil: 6, wild: 6, pool: 1.6, wall: 2.5 };

  const zoneMat = { road: 'asphalt', parking: 'parking', pavers: 'pavers', lawn: 'lawn', deck: 'deck',
    court_pavers: 'pavers', court_lawn: 'lawn', court_deck: 'deck' };
  const surfaces = {};
  const curbs = [];
  for (const [zone, polys] of Object.entries(level.zones)) {
    const h = level.heights[zone] ?? 0;
    const matKey = zoneMat[zone];
    (surfaces[matKey] ||= []).push(flatGeometry(polys, h, uv[matKey]));
    if (h > 0.01) curbs.push(sideGeometry(polys, -0.05, h, uv.curb));
  }
  for (const [key, geoms] of Object.entries(surfaces)) {
    const mesh = new THREE.Mesh(mergeGeometries(geoms), mats[key]);
    mesh.receiveShadow = true;
    mesh.name = 'ground-' + key;
    group.add(mesh);
  }
  const curbMesh = new THREE.Mesh(mergeGeometries(curbs), mats.curb);
  curbMesh.receiveShadow = true;
  group.add(curbMesh);

  // Parking stall paint: two side lines per stall.
  const lines = [];
  for (const s of level.stalls) {
    const ca = Math.cos(s.h), sa = Math.sin(s.h);   // stall axis (depth direction)
    const tx = -sa, ty = ca;                          // across the stall
    for (const side of [-1, 1]) {
      const ox = s.x + tx * side * 1.275, oy = s.y + ty * side * 1.275;
      const a = [ox - ca * 2.4, oy - sa * 2.4], b = [ox + ca * 2.4, oy + sa * 2.4];
      lines.push(ribbonGeometry([a, b], 0.11, 0.012, 1));
    }
  }
  if (lines.length) {
    const paint = new THREE.Mesh(mergeGeometries(lines), mats.paint);
    paint.receiveShadow = true;
    group.add(paint);
  }

  // Pools: tiled basin + animated water.
  const waterNormals = await new Promise((res) => new THREE.TextureLoader().load(
    'assets/textures/water/waternormals.jpg', res, undefined, () => res(null)));
  if (waterNormals) { waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping; }
  const water = new THREE.MeshPhysicalMaterial({
    color: 0x2a9bc4, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.6,
    normalMap: waterNormals, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2,
    clearcoat: 1.0, clearcoatRoughness: 0.05,
  });
  const pools = [];
  for (const pool of level.pools) {
    const wallsG = sideGeometry([pool.poly], pool.floor, pool.rim, uv.pool);
    flipFaces(wallsG);
    const floorG = flatGeometry([pool.poly], pool.floor, uv.pool);
    const basin = new THREE.Mesh(mergeGeometries([wallsG, floorG]), mats.pool);
    basin.receiveShadow = true;
    group.add(basin);
    const w = new THREE.Mesh(flatGeometry([pool.poly], pool.rim - 0.13, 3), water);
    w.renderOrder = 2;
    group.add(w);
    pools.push(w);
    // the pool edge keeps zombies out (they path around); the player can hop in and out
    colliders.addRing(pool.poly.outer.map(([x, y]) => [x, -y]), { height: pool.rim + 0.2, minY: -2.5, kind: 'pool' });
  }
  // steps down into each pool
  const stepGeoms = [];
  for (const st of level.pool_steps || []) {
    stepGeoms.push(flatGeometry([st.poly], st.h, uv.pool));
    stepGeoms.push(sideGeometry([st.poly], st.floor, st.h, uv.pool));
  }
  if (stepGeoms.length) {
    const steps = new THREE.Mesh(mergeGeometries(stepGeoms), mats.deck);
    steps.receiveShadow = true;
    group.add(steps);
  }
  // chrome handrails either side of each pool's steps, so the way out is easy to spot
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe8ecef, metalness: 1, roughness: 0.18 });
  const rails = [];
  for (const pool of level.pools) {
    const top = (level.pool_steps || []).find((st) => st.floor === pool.floor && Math.abs(st.h - (pool.rim - 0.3)) < 0.02
      && st.poly.outer.some(([x, y]) => pool.poly.outer.some(([px, py]) => Math.hypot(px - x, py - y) < 40)));
    if (!top) continue;
    let cx = 0, cy = 0;
    for (const [x, y] of pool.poly.outer) { cx += x; cy += y; }
    cx /= pool.poly.outer.length; cy /= pool.poly.outer.length;
    // the two corners of the top step that lie on the pool edge (furthest from the pool centre)
    const corners = [...top.poly.outer].sort((a, b) => Math.hypot(b[0] - cx, b[1] - cy) - Math.hypot(a[0] - cx, a[1] - cy)).slice(0, 2);
    for (const [x, y] of corners) {
      const dx = cx - x, dy = cy - y, L = Math.hypot(dx, dy) || 1, ix = dx / L, iy = dy / L;
      const pts = [
        new THREE.Vector3(x - ix * 0.25, pool.rim, -(y - iy * 0.25)),
        new THREE.Vector3(x - ix * 0.25, pool.rim + 0.85, -(y - iy * 0.25)),
        new THREE.Vector3(x + ix * 0.3, pool.rim + 0.95, -(y + iy * 0.3)),
        new THREE.Vector3(x + ix * 0.75, pool.rim + 0.45, -(y + iy * 0.75)),
        new THREE.Vector3(x + ix * 0.85, pool.rim - 0.6, -(y + iy * 0.85)),
      ];
      rails.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.025, 8, false));
    }
  }
  if (rails.length) group.add(new THREE.Mesh(mergeGeometries(rails), chrome));

  // Ramps down to the underground car parks.
  const rampGeoms = [], rampWalls = [], doors = [];
  for (const r of level.ramps) {
    const [tx, ty] = r.top, [bx, by] = r.bottom;
    const L = Math.hypot(bx - tx, by - ty), ax = (bx - tx) / L, ay = (by - ty) / L;
    const nx = -ay * r.width / 2, ny = ax * r.width / 2;
    const P = (x, y, h) => [x, h, -y];
    const A = P(tx + nx, ty + ny, 0), B = P(tx - nx, ty - ny, 0);
    const C = P(bx - nx, by - ny, -r.depth), D = P(bx + nx, by + ny, -r.depth);
    rampGeoms.push(quad(A, B, C, D, r.width / uv.asphalt, L / uv.asphalt));
    // side walls: thickness 0.25, top at +0.95, bottom following the ramp
    for (const s of [1, -1]) {
      const ex = tx + nx * s * 1.04, ey = ty + ny * s * 1.04, fx = bx + nx * s * 1.04, fy = by + ny * s * 1.04;
      rampWalls.push(wallStrip([ex, ey], [fx, fy], [0, -r.depth], 0.95, 0.25));
      colliders.addSegment(ex, -ey, fx, -fy, { height: 0.95, minY: -r.depth - 1, kind: 'wall' });
    }
    // at the bottom: the open way into the underground car park under a lintel (or a shut
    // roll-up door if the ramp has no car park behind it)
    const park = (level.underground || []).find((u) => u.doors.some((d) => Math.hypot((d.a[0] + d.b[0]) / 2 - bx, (d.a[1] + d.b[1]) / 2 - by) < 1.5));
    if (park) {
      rampWalls.push(wallStrip([bx + nx * 1.1, by + ny * 1.1], [bx - nx * 1.1, by - ny * 1.1], [park.ceiling, park.ceiling], 0.95, 0.4));
      colliders.addSegment(bx + nx, -(by + ny), bx - nx, -(by - ny), { height: 0.95, minY: park.ceiling, kind: 'wall' });
      continue;
    }
    const back = wallStrip([bx + nx * 1.1, by + ny * 1.1], [bx - nx * 1.1, by - ny * 1.1], [-r.depth, -r.depth], 0.95, 0.4);
    rampWalls.push(back);
    colliders.addSegment(bx + nx, -(by + ny), bx - nx, -(by - ny), { height: 3, minY: -r.depth - 1, kind: 'wall' });
    doors.push({ x: bx - ax * 0.05, y: by - ay * 0.05, fx: -ax, fy: -ay, w: r.width - 0.8, bottom: -r.depth });
  }
  const rampMesh = new THREE.Mesh(mergeGeometries(rampGeoms), mats.asphalt);
  rampMesh.receiveShadow = true;
  group.add(rampMesh);
  const wallMesh = new THREE.Mesh(mergeGeometries(rampWalls), mats.wall);
  wallMesh.castShadow = wallMesh.receiveShadow = true;
  group.add(wallMesh);
  // roll-up garage doors
  const doorTex = shutterTexture();
  const doorMat = new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.55, metalness: 0.6, color: 0xb9bcc0 });
  for (const d of doors) {
    const g = new THREE.PlaneGeometry(d.w, 2.5);
    const m = new THREE.Mesh(g, doorMat);
    m.position.set(d.x, d.bottom + 1.25, -d.y);
    m.rotation.y = Math.atan2(d.fx, -d.fy); // face up the ramp
    m.receiveShadow = true;
    group.add(m);
  }

  // Remaining retaining walls from OSM (not along ramps).
  for (const w of level.walls) {
    for (let i = 0; i < w.length - 1; i++) {
      group.add(new THREE.Mesh(wallStrip(w[i], w[i + 1], [0, 0], 0.9, 0.3), mats.wall));
      colliders.addSegment(w[i][0], -w[i][1], w[i + 1][0], -w[i + 1][1], { height: 0.9, kind: 'wall' });
    }
  }

  // Land around the complex: big base plane + streets + construction dirt.
  // near field: a grass disc; the real terrain (surroundings.js) takes over beyond ~500 m
  // (with holes where the ramps and pools go down, or you'd see grass over them from above)
  const disc = new THREE.Shape();
  disc.absarc(0, 0, 560, 0, Math.PI * 2, false);
  for (const hole of [...level.ramps.map((r) => r.poly), ...level.pools.map((p) => p.poly)]) {
    disc.holes.push(new THREE.Path(hole.outer.map(([x, y]) => new THREE.Vector2(x, y))));
  }
  const base = new THREE.Mesh(new THREE.ShapeGeometry(disc, 48), mats.wild);
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.03;
  const bp = base.geometry.attributes.position, bu = base.geometry.attributes.uv;
  for (let i = 0; i < bu.count; i++) bu.setXY(i, bp.getX(i) / uv.wild, bp.getY(i) / uv.wild);
  base.receiveShadow = true;
  group.add(base);

  const dirt = [];
  for (const g of level.surroundings.green) if (g.kind === 'construction') dirt.push(flatGeometry(g.polys, -0.02, uv.soil));
  if (dirt.length) {
    const d = new THREE.Mesh(mergeGeometries(dirt), mats.soil);
    d.receiveShadow = true;
    group.add(d);
  }
  const roadsOut = { asphalt: [], gravel: [] };
  for (const s of level.surroundings.streets) {
    roadsOut[s.surface].push(ribbonGeometry(s.line, s.w, s.surface === 'asphalt' ? 0.022 : 0.008, uv.asphalt));
  }
  if (roadsOut.asphalt.length) {
    const m = new THREE.Mesh(mergeGeometries(roadsOut.asphalt), mats.asphalt);
    m.receiveShadow = true;
    group.add(m);
  }
  if (roadsOut.gravel.length) {
    const m = new THREE.Mesh(mergeGeometries(roadsOut.gravel), mats.soil);
    m.receiveShadow = true;
    group.add(m);
  }

  scene.add(group);
  return {
    group, mats,
    update(dt, t) {
      if (waterNormals) waterNormals.offset.set((t * 0.013) % 1, (t * 0.009) % 1);
    },
  };
}

function quad(A, B, C, D, uMax, vMax) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...A, ...B, ...C, ...A, ...C, ...D], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, uMax, 0, uMax, vMax, 0, 0, uMax, vMax, 0, vMax], 2));
  g.computeVertexNormals();
  // make it face up
  if (g.attributes.normal.getY(0) < 0) {
    g.setAttribute('position', new THREE.Float32BufferAttribute([...A, ...C, ...B, ...A, ...D, ...C], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, uMax, vMax, uMax, 0, 0, 0, 0, vMax, uMax, vMax], 2));
    g.computeVertexNormals();
  }
  return g;
}

// A wall box between two map points whose bottom follows [h0, h1] and top is at `top`.
function wallStrip(a, b, [h0, h1], top, thick) {
  const [ax, ay] = a, [bx, by] = b;
  const L = Math.hypot(bx - ax, by - ay);
  const nx = -(by - ay) / L * thick / 2, ny = (bx - ax) / L * thick / 2;
  const P = (x, y, h) => [x, h, -y];
  const c = [
    P(ax + nx, ay + ny, h0), P(bx + nx, by + ny, h1), P(bx + nx, by + ny, top), P(ax + nx, ay + ny, top),
    P(ax - nx, ay - ny, h0), P(bx - nx, by - ny, h1), P(bx - nx, by - ny, top), P(ax - nx, ay - ny, top),
  ];
  const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [3, 2, 6, 7], [4, 0, 3, 7], [1, 5, 6, 2]];
  const pos = [], uv = [];
  for (const [i, j, k, l] of faces) {
    pos.push(...c[i], ...c[j], ...c[k], ...c[i], ...c[k], ...c[l]);
    const w = Math.hypot(c[j][0] - c[i][0], c[j][2] - c[i][2]) / 2.5, h = Math.abs(c[l][1] - c[i][1]) / 2.5 || 0.1;
    uv.push(0, 0, w, 0, w, h, 0, 0, w, h, 0, h);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function flipFaces(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  fixWinding(g);
  return g;
}

function shutterTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9a9ea3';
  ctx.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 8) {
    ctx.fillStyle = '#6d7176';
    ctx.fillRect(0, y, 128, 2);
    ctx.fillStyle = '#b8bcc0';
    ctx.fillRect(0, y + 2, 128, 1);
  }
  // grime towards the bottom
  const g = ctx.createLinearGradient(0, 150, 0, 256);
  g.addColorStop(0, 'rgba(40,35,30,0)');
  g.addColorStop(1, 'rgba(40,35,30,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
