import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flatGeometry, polyCentroid, pointInPoly, mulberry } from './geom.js';
import { NOISE_GLSL } from './materials.js';
import { shopLayout, buildShopDecor, SignBoard, nameBoard } from './shops.js';

// Green Diamond facades, from the developer's photos:
//  - 'frame'  : 9/11-floor white blocks with thick coloured frames around balcony stacks
//  - 'tower'  : 21-floor warm-grey towers with white balcony frames and a timber pergola crown
//  - 'stripe' : phase-3 blocks, white with full-height coloured balcony stripes
//  - 'twin'   : the two 22-floor stage-2 towers, sage grey with a cream balcony frame grid
//  - 'podium' : the white shop pavilions round the twins (Spar, Nikora, 2 Nabiji, 36.6 ...): one tall
//               storey of arched shopfronts, brand fascias (shops.js); Format Fit's block has two floors
//  - 'small'  : pool house / pavilions
//  - 'booth'  : the glass security booths under the gate portals (the portals are in props.js)
const FH = 3.05;
const STYLE_ID = { frame: 0, tower: 1, stripe: 2, podium: 3, small: 4, twin: 5, booth: 9 };
const PALETTE = [0xd8262e, 0xee7c3a, 0xf3c318, 0x3cae3f, 0x2a7fd0, 0xd0307f, 0x8a4fb3, 0x7f878c, 0x8fd18a, 0x5aa9e6, 0xe98a5a];
const WHITE = 0xf2f0eb;

function styleOf(b) {
  if (b.group === 'mid') return (b.levels >= 20 ? 'tower' : 'frame');
  if (b.group === 'tower') return 'twin';
  if (b.group === 'north') return 'stripe';
  if (b.group === 'podium') return 'podium';
  if (b.group === 'guard') return 'booth';
  return 'small';
}

// Facade bays along a wall (the shader's window grid; the ground-floor terraces follow it too).
function bayCount(style, len) {
  const target = (style === 'tower' || style === 'twin') ? 3.2 : style === 'stripe' ? 3.3 : 3.0;
  return Math.max(1, Math.round(len / target));
}

export function buildingHeight(b) {
  const style = styleOf(b);
  // (a booth's white walls go up to the gate canopy, 4.55 m: see buildGates in props.js)
  const gH = style === 'podium' ? 4.2 : style === 'small' ? 3.2 : style === 'booth' ? 4.25 : 3.3;
  const levels = Math.max(1, b.levels || 1);
  return { gH, top: gH + (levels - 1) * FH, levels, style };
}

export function buildBuildings(level, scene, colliders, atmo) {
  const group = new THREE.Group();
  group.name = 'buildings';

  const walls = { pos: [], nor: [], uv: [], edge: [], mask: [], terr: [] };
  const roofs = [];
  const boxes = [];   // {x,y,z, sx,sy,sz, ry, color}
  const glass = [];   // same layout, glass railings
  const heights = [];
  const stairs = [];   // stairwells: lobby doors on the ground <-> a door on the roof housing
  const lobbyGlass = [];   // glass that lights up after dark (lobby porches, the pool houses' windows)
  const hips = { pos: [], col: [] };   // the pool houses' hipped roofs
  const shops = shopLayout(level, buildingHeight);

  for (const b of level.buildings) {
    const { gH, top, levels, style } = buildingHeight(b);
    const sid = STYLE_ID[style];
    const pts = b.poly.outer;
    const parapet = style === 'small' ? 0.4 : style === 'booth' ? 0.3 : 1.0;
    const rand = mulberry(b.id % 2147483647);
    // the shop pavilions read as one tall storey to the shader (Format Fit's block keeps its two floors)
    const oneStorey = style === 'podium' && !shops.gym(b);
    heights.push({ id: b.id, top: top + parapet, roof: top + 0.15, style, pts });

    // collision: the footprint, full height
    // (the walls stop at street level: the underground car parks run beneath some blocks)
    colliders.addRing(pts.map(([x, y]) => [x, -y]), { height: top + parapet, minY: -0.3, kind: 'building' });

    // the courtyards' small buildings are built whole (pool houses, the service pavilion)
    if (style === 'small') { smallBuilding(b, level, boxes, lobbyGlass, hips); continue; }

    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.05) continue;
      const tx = (bx - ax) / len, ty = (by - ay) / len;
      const nx = ty, ny = -tx; // outward (CCW ring)
      const nBays = bayCount(style, len);
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

      // ground-floor terraces where the wall looks out over lawn (bitmask for the shader: French doors)
      // (their own random numbers: the balcony stacks keep theirs)
      const terr = (style === 'frame' || style === 'stripe')
        ? terraces(level, boxes, colliders, { ax, ay, tx, ty, nx, ny, len, nBays, bayW, balconyBays, rand: mulberry((b.id % 100003) * 31 + i) }) : 0;

      // wall quad
      const y0 = -0.4, y1 = top + parapet;
      const P = (x, y, h) => [x, h, -y];
      const A = P(ax, ay, y0), B = P(bx, by, y0), C = P(bx, by, y1), D = P(ax, ay, y1);
      walls.pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      for (let k = 0; k < 6; k++) {
        walls.nor.push(nx, 0, -ny);
        walls.edge.push(len, nBays, oneStorey ? 1 : levels, sid);
        // (podium walls: x is the wall's row in the shop layout texture)
        walls.mask.push(style === 'podium' ? shops.row(b.id, i) : mask0, mask1, (b.id % 997) + i * 7.31, oneStorey ? top : gH);
        walls.terr.push(terr);
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
          // (the twins' balcony stacks are cream, the older towers' white)
          const band = style === 'twin' ? 0xe6dcc6 : WHITE;
          for (let f = f0; f <= levels - 1; f++) slab(f, band);
          frame(f0, levels - 1, band);
        }
      }
    }

    // roof slab + rooftop housings + timber pergolas
    roofs.push(flatGeometry([b.poly], top + 0.15, 4));
    const [cx, cy] = polyCentroid(pts);
    if (levels >= 5 && pointInPoly(cx, cy, pts)) {
      const hw = style === 'tower' ? 3 : 2.4, hd = hw * 0.8;
      const ry = rand() * 0.2;
      const housing = style === 'tower' ? 0x8f877d : style === 'twin' ? 0x7d8277 : WHITE;
      boxes.push({ x: cx, y: top + 1.6, z: -cy, sx: hw * 2, sy: 3.2, sz: hd * 2, ry, color: housing });
      colliders.addBox(cx, -cy, hw, hd, -ry, { height: top + 3.3, minY: top - 0.5, kind: 'wall' });
      if (style !== 'stripe') pergola(boxes, pts, top + 0.15, rand);
      // stairwell: a door on one side of the roof housing that isn't too close to the roof edge
      const c = Math.cos(ry), sn = Math.sin(ry);
      const sides = [[1, 0, hw], [-1, 0, hw], [0, 1, hd], [0, -1, hd]];
      for (const [ax, az, ext] of sides) {
        const lx = ax, lz = az; // local axes of the housing: +x -> (c, sn) in map coords, +z -> (sn, -c)
        const dx = lx * c + lz * sn, dy = lx * sn - lz * c;
        const px = cx + dx * (ext + 1.3), py = cy + dy * (ext + 1.3);
        const ok = [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].every(([ox, oy]) => pointInPoly(px + ox, py + oy, pts));
        if (!ok) continue;
        const angle = Math.atan2(dy, dx); // three.js rotation.y for a box facing (dx, dy)
        boxes.push({ x: cx + dx * (ext + 0.03), y: top + 1.2, z: -(cy + dy * (ext + 0.03)), sx: 0.08, sy: 2.1, sz: 1.0, ry: angle, color: 0x3a2a20 });
        stairs.push({ id: b.id, levels, top: top + 0.15, roof: { x: px, y: py }, housing: { x: cx, y: cy }, doors: level.doors.filter((d) => d.building === b.id) });
        break;
      }
    }
  }

  // --- facade mesh ---
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(walls.pos, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(walls.nor, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(walls.uv, 2));
  wg.setAttribute('aEdge', new THREE.Float32BufferAttribute(walls.edge, 4));
  wg.setAttribute('aMask', new THREE.Float32BufferAttribute(walls.mask, 4));
  wg.setAttribute('aTerr', new THREE.Float32BufferAttribute(walls.terr, 1));
  fixWindingByNormal(wg);
  const facadeMat = getFacadeMaterial(atmo);
  facadeMat.userData.shopTex = shops.texture;
  const facades = new THREE.Mesh(wg, facadeMat);
  facades.castShadow = facades.receiveShadow = true;
  facades.name = 'facades';
  group.add(facades);

  const roofMat = new THREE.MeshStandardMaterial({ color: 0x9a9894, roughness: 0.95 });
  const roofMesh = new THREE.Mesh(mergeGeometries(roofs), roofMat);
  roofMesh.receiveShadow = true;
  roofMesh.castShadow = true;
  group.add(roofMesh);

  // shop fascias and signs (the fascia bands join the instanced boxes below, the signs a sign board)
  const board = new SignBoard();
  buildShopDecor(shops, boxes, board);

  // --- instanced balconies, frames, housings, fascias ---
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

  // --- lobby entrances (the D1 BLOCK photosphere): a glazed porch in black frames under a black
  // fascia with the block's name, a landing with steel handrails, and beside it a slatted timber
  // screen under a little timber canopy ---
  const doorParts = [];
  const BLACK = 0x17181a, GLASS = 0x2a3840, STEEL = 0xc9cdd1, TIMBER = 0x8a6446;
  for (const d of level.doors) {
    const ang = d.h; // outward normal angle in map coords
    const nx = Math.cos(ang), ny = Math.sin(ang), tx = -ny, ty = nx;
    // (a tower's lobby opening into its podium: nothing to see)
    if (level.buildings.some((o) => o.id !== d.building && pointInPoly(d.x + nx, d.y + ny, o.poly.outer))) continue;
    const ry = Math.atan2(ny, nx);
    const W0 = -0.2;   // the wall, just behind the door point
    const at = (along, out) => [d.x + tx * along + nx * out, d.y + ty * along + ny * out];
    const put = (along, out, h, sx, sy, sz, color) => {
      const [x, y] = at(along, out);
      (color === GLASS ? lobbyGlass : doorParts).push({ x, y: h, z: -y, sx, sy, sz, ry, color });
    };
    // the porch: glass front and sides, black frame, door head, fascia
    const P = W0 + 0.7;
    put(0, P, 1.6, 0.04, 2.8, 4.0, GLASS);
    for (const s of [-1, 1]) put(s * 2.0, W0 + 0.35, 1.6, 0.7, 2.8, 0.04, GLASS);
    for (const a of [-2.0, -1.0, 0, 1.0, 2.0]) put(a, P + 0.03, 1.6, 0.1, 2.8, a === 0 ? 0.05 : 0.08, BLACK);
    put(0, P + 0.03, 0.24, 0.1, 0.08, 4.1, BLACK);
    put(0, P + 0.03, 2.3, 0.1, 0.08, 2.0, BLACK);
    put(0, W0 + 0.43, 3.37, 0.86, 0.76, 4.5, BLACK);
    // the landing and its handrails
    put(0, W0 + 1.1, 0.08, 2.2, 0.16, 5.2, 0xbdbab3);
    for (const s of [-1, 1]) {
      for (const o of [W0 + 0.85, W0 + 2.05]) put(s * 2.45, o, 0.66, 0.05, 1.0, 0.05, STEEL);
      for (const h of [1.12, 0.62]) put(s * 2.45, W0 + 1.45, h, 1.25, 0.04, 0.04, STEEL);
      const [x0, y0] = at(s * 2.45, W0 + 0.8), [x1, y1] = at(s * 2.45, W0 + 2.1);
      colliders.addSegment(x0, -y0, x1, -y1, { height: 1.15, kind: 'fence', shoot: false });
    }
    // (only the porch's side glass is solid: its front is the way in, and the stairs start at the door)
    for (const sd of [-1, 1]) {
      const [x0, y0] = at(sd * 2.0, W0), [x1, y1] = at(sd * 2.0, P);
      colliders.addSegment(x0, -y0, x1, -y1, { height: 3.0, kind: 'wall' });
    }
    // a slatted timber screen with a small timber canopy, to one side
    put(3.6, W0 + 0.03, 1.7, 0.04, 3.0, 1.2, 0x3a2e26);
    for (let k = 0; k < 7; k++) put(3.12 + k * 0.16, W0 + 0.08, 1.7, 0.06, 3.0, 0.08, TIMBER);
    for (let k = 0; k < 6; k++) put(3.0 + k * 0.24, W0 + 0.5, 3.3, 1.0, 0.06, 0.07, TIMBER);
    for (const a of [2.95, 4.25]) put(a, W0 + 0.5, 3.24, 1.0, 0.12, 0.08, TIMBER);
    // the block's name on the fascia
    const name = blockName(d.building, d);
    const [sx, sy] = at(0, W0 + 0.87);
    if (name) board.add('lobby:' + name.en, nameBoard(name.ka, name.en), sx, sy, 3.37, [tx, ty], [nx, ny]);
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
  // the porches' glass: glossy, and the lobbies light up after dark
  const lobbyMat = new THREE.MeshStandardMaterial({ color: GLASS, roughness: 0.08, metalness: 0.6, emissive: 0xffdcaa, emissiveIntensity: 0 });
  const lg = new THREE.InstancedMesh(boxGeo, lobbyMat, Math.max(1, lobbyGlass.length));
  lobbyGlass.forEach((bx, i) => {
    e.set(0, bx.ry, 0); q.setFromEuler(e);
    m4.compose(p.set(bx.x, bx.y, bx.z), q, s.set(bx.sx, bx.sy, bx.sz));
    lg.setMatrixAt(i, m4);
  });
  lg.count = lobbyGlass.length;
  lg.receiveShadow = true;
  group.add(lg);

  if (hips.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(hips.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(hips.col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    m.name = 'pool-house-roofs';
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }

  const signs = board.build(group);

  scene.add(group);
  return {
    group, heights, stairs,
    update() {
      facadeMat.userData.shader && (facadeMat.userData.shader.uniforms.uLamp.value = atmo.lampLevel);
      signs.update(atmo.lampLevel);
      lobbyMat.emissiveIntensity = atmo.lampLevel * 0.55;
    },
  };
}

// What's written over each block's lobby, as on the real signs ("ა ბლოკი   A BLOCK", "დ1 ბლოკი   D1
// BLOCK", "ჰ3 ბლოკი   H3 BLOCK" in photos). The names are the developer's (the block map on
// greendiamond.ge: stage 1 A-H, the twins 'F and 'H, stage 3 A'-H'), written the way the signs and
// residents write them: the twin 'H is H3 on its sign, and the stage-3 G' and H' are G2 and H2 on the
// map labels residents put up.
const BLOCKS = {
  942125702: 'A', 942125706: 'C1', 786826645: 'C2', 942125705: 'D1', 786826644: 'D2',   // No 32 bld 8, 3, 5, 2, 4
  942125704: 'E', 786826646: 'F', 942125708: 'G', 1047016836: 'H',                       // No 32 bld 9, 6, 1, 10
  942125715: 'H3',                                                                        // No 30 H3, the twin by Spar
  1411127641: 'H2', 1308672260: 'G2',                                                     // No 34ვ, 34ე
};
// PROVISIONAL, subject to change: the blocks whose signs nobody has seen yet show the developer's
// name from its block map, written as it writes them, until someone checks the real boards.
const PROVISIONAL = {
  942125703: 'B',                           // No 32 bld 7 (a map label on it says "Block B 2")
  1284053961: "CD1'", 1284053963: "CD2'",   // 34ა, 34ბ
  1284053966: "E1'", 1308672259: "E2'",     // 34გ, 34ზ
  1284053967: "F'",                         // 34დ
  1284053962: ["A'", "B'"],                 // 34: two lobbies, A' the northern one, B' the southern
};
const KA_LETTER = { A: 'ა', B: 'ბ', C: 'ც', D: 'დ', E: 'ე', F: 'ფ', G: 'გ', H: 'ჰ' };
export function blockName(id, door) {
  let letters = BLOCKS[id] || PROVISIONAL[id];
  if (Array.isArray(letters)) letters = door && door.y > 88 ? letters[0] : letters[1];
  if (!letters) return null;
  return { ka: `${letters.replace(/[A-H]/g, (c) => KA_LETTER[c])} ბლოკი`, en: `${letters} BLOCK`, letters, provisional: !BLOCKS[id] };
}

// The ground-floor flats' terraces (the developer's courtyard photos): where a block's paved apron
// looks out over a courtyard lawn (not the narrow grass strips by the car parks, which have none in
// the photosphere), each window bay gets a raised white terrace across the apron with a timber deck,
// a steel railing and a louvred timber screen from the next one, and where there's no balcony stack
// overhead, a slatted timber pergola. Returns the bays' bitmask.
function terraces(level, boxes, colliders, { ax, ay, tx, ty, nx, ny, len, nBays, bayW, balconyBays, rand }) {
  if (bayW < 2.4 || len < 3) return 0;
  const lawns = [...(level.zones.lawn || []), ...(level.zones.court_lawn || [])];
  const inside = (x, y, p) => pointInPoly(x, y, p.outer) && !(p.holes || []).some((h) => pointInPoly(x, y, h));
  const onLawn = (x, y) => lawns.some((p) => inside(x, y, p));
  const blocked = (x, y) => level.buildings.some((b) => pointInPoly(x, y, b.poly.outer))
    || level.ramps.some((r) => pointInPoly(x, y, r.poly.outer))
    || level.doors.some((d) => Math.hypot(d.x - x, d.y - y) < 4.4);
  const at = (u, out) => [ax + tx * u + nx * out, ay + ty * u + ny * out];
  const ry = Math.atan2(ny, nx);
  const g = level.heights.pavers ?? 0.14, SLAB = 0.45;
  const CONCRETE = 0xe6e3dc, DECK = 0xa3805f, STEEL = 0x7d8286, TIMBER = 0x8a6446;
  let mask = 0;
  for (let k = 0; k < Math.min(nBays, 24); k++) {
    const u0 = k * bayW + 0.08, u1 = (k + 1) * bayW - 0.08, w = u1 - u0, um = (u0 + u1) / 2;
    // how deep the apron is here: the terrace runs out to the lawn
    let D = 0;
    while (D < 3.4 && !onLawn(...at(um, D + 0.1))) D += 0.1;
    if (D < 2.3 || D > 3.3) continue;
    D -= 0.05;
    const probes = [[u0 + 0.15, 0.3], [u1 - 0.15, 0.3], [u0 + 0.15, D - 0.2], [u1 - 0.15, D - 0.2], [um, D / 2]];
    if (probes.some(([u, o]) => blocked(...at(u, o)))) continue;
    if (![u0 + 0.2, u1 - 0.2].every((u) => onLawn(...at(u, D + 0.4))) || !onLawn(...at(um, D + 5))) continue;
    const [cx, cy] = at(um, D / 2);
    if (level.trees.some((t) => Math.hypot(t.x - cx, t.y - cy) < Math.max(w, D) / 2 + 0.6)) continue;
    const put = (u, out, h, sx, sy, sz, color) => { const [x, y] = at(u, out); boxes.push({ x, y: g + h, z: -y, sx, sy, sz, ry, color }); };
    put(um, D / 2, SLAB / 2 - 0.1, D, SLAB + 0.2, w, CONCRETE);
    put(um, D / 2 - 0.04, SLAB + 0.012, D - 0.16, 0.025, w - 0.16, DECK);
    for (const u of [u0 + 0.05, um, u1 - 0.05]) put(u, D - 0.06, SLAB + 0.5, 0.045, 1.0, 0.045, STEEL);
    for (const h of [0.3, 0.62, 0.97]) put(um, D - 0.06, SLAB + h, 0.035, h > 0.9 ? 0.05 : 0.03, w, STEEL);
    put(u1 - 0.02, D / 2 - 0.05, SLAB + 1.15, D - 0.16, 2.3, 0.05, TIMBER);
    if (!balconyBays.includes(k) && rand() < 0.7) {
      for (const u of [u0 + 0.12, u1 - 0.12]) put(u, D - 0.14, SLAB + 1.2, 0.1, 2.4, 0.1, TIMBER);
      put(um, D - 0.14, SLAB + 2.42, 0.12, 0.14, w, TIMBER);
      for (let j = 0; j < 7; j++) put(u0 + 0.2 + j * (w - 0.4) / 6, D / 2, SLAB + 2.53, D + 0.1, 0.08, 0.06, TIMBER);
    }
    colliders.addBox(cx, -cy, D / 2, w / 2, -ry, { height: g + SLAB + 1.0, kind: 'wall' });
    mask += 2 ** k;
  }
  return mask;
}

// The courtyards' small buildings. A pool house (photos of both courtyards from the towers and a
// drone): a single room in teal render with white-framed windows under a dark grey-green hipped roof,
// and beside it, under a second hipped roof, a timber veranda open to the pool deck. Anything in the
// 'small' group without a pool nearby is the plain white flat-roofed pavilion by the sand court at the
// west end of the middle courtyard (satellite and drone views: a white box).
function smallBuilding(b, level, boxes, glass, hips) {
  const pts = b.poly.outer;
  // the footprint as a rectangle: its first edge is one axis
  const [p0, p1] = pts;
  const L0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  let ax = (p1[0] - p0[0]) / L0, ay = (p1[1] - p0[1]) / L0, bx = -ay, by = ax;
  const us = pts.map(([x, y]) => (x - p0[0]) * ax + (y - p0[1]) * ay), vs = pts.map(([x, y]) => (x - p0[0]) * bx + (y - p0[1]) * by);
  let u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  if (u1 - u0 < v1 - v0) {   // make u the long axis
    [ax, ay, bx, by] = [bx, by, -ax, -ay];
    [u0, u1, v0, v1] = [v0, v1, -u1, -u0];
  }
  const at = (u, v) => [p0[0] + ax * u + bx * v, p0[1] + ay * u + by * v];
  // boxes: local x along b (across), local z along a (along)
  const put = (u, v, h, su, sv, sh, color) => { const [x, y] = at(u, v); boxes.push({ x, y: h, z: -y, sx: sv, sy: sh, sz: su, ry: Math.atan2(by, bx), color }); };
  const [cx, cy] = at((u0 + u1) / 2, (v0 + v1) / 2);
  const pool = (level.pools || []).find((q) => {
    const n = q.poly.outer.length, px = q.poly.outer.reduce((a, p) => a + p[0], 0) / n, py = q.poly.outer.reduce((a, p) => a + p[1], 0) / n;
    return Math.hypot(px - cx, py - cy) < 30;
  });
  let LEN = u1 - u0, WID = v1 - v0;
  const WHITE = 0xeeede8;
  if (!pool) {
    // the service pavilion: a white rendered box, a flat roof with a coping, a steel door, vents
    const H = 3.0;
    put((u0 + u1) / 2, (v0 + v1) / 2, H / 2, LEN, WID, H, WHITE);
    put((u0 + u1) / 2, (v0 + v1) / 2, H + 0.08, LEN + 0.12, WID + 0.12, 0.16, 0xdcdcd8);
    put((u0 + u1) / 2, v0 - 0.02, 1.05, 1.1, 0.06, 2.1, 0x5b6167);
    for (const u of [u0 + 1.2, u1 - 1.2]) put(u, v0 - 0.02, 2.3, 1.0, 0.05, 0.5, 0x4a4f54);
    return;
  }
  // two halves side by side: the veranda is the half nearest the pool (of the ways of halving it that
  // don't leave a thin strip), the room the other (the middle one: veranda north, by the pool's end)
  const toPool = (x, y) => Math.min(...pool.poly.outer.map((a, i) => {
    const q = pool.poly.outer[(i + 1) % pool.poly.outer.length], dx = q[0] - a[0], dy = q[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
  }));
  const halves = [];
  for (const alongU of [true, false]) {
    const [L, W] = alongU ? [(u1 - u0) / 2, v1 - v0] : [u1 - u0, (v1 - v0) / 2];
    if (Math.min(L, W) < 0.4 * Math.max(L, W)) continue;
    for (const high of [false, true]) {
      const [x, y] = alongU ? at(high ? (3 * u1 + u0) / 4 : (3 * u0 + u1) / 4, (v0 + v1) / 2) : at((u0 + u1) / 2, high ? (3 * v1 + v0) / 4 : (3 * v0 + v1) / 4);
      halves.push({ alongU, high, d: toPool(x, y) });
    }
  }
  const best = halves.sort((p, q) => p.d - q.d)[0];
  if (!best.alongU) {   // turn the frame so that u is the axis it's halved along
    [ax, ay, bx, by] = [bx, by, -ax, -ay];
    [u0, u1, v0, v1] = [v0, v1, -u1, -u0];
  }
  const vHigh = best.high, um = (u0 + u1) / 2;
  const [r0, r1, w0, w1] = vHigh ? [u0, um, um, u1] : [um, u1, u0, um];   // room, veranda (along u)
  const TEAL = 0x3b9aa5, TIMBER = 0x8a6446, H = 3.0, T = 0.22;
  const vm = (v0 + v1) / 2;
  LEN = u1 - u0; WID = v1 - v0;
  // the room: four walls, white-framed windows (they light up at night), a door on the far end
  put((r0 + r1) / 2, v0 + T / 2, H / 2, r1 - r0, T, H, TEAL);
  put((r0 + r1) / 2, v1 - T / 2, H / 2, r1 - r0, T, H, TEAL);
  for (const u of [r0 + T / 2, r1 - T / 2]) put(u, vm, H / 2, T, WID - 2 * T, H, TEAL);
  put((r0 + r1) / 2, vm, H - 0.05, r1 - r0 - 0.1, WID - 0.1, 0.1, 0xd9d6cf);   // (the ceiling)
  const wins = Math.max(1, Math.round((r1 - r0) / 2.2));
  for (const v of [v0, v1]) {
    const out = v === v0 ? -1 : 1;
    for (let k = 0; k < wins; k++) {
      const u = r0 + (k + 0.5) * (r1 - r0) / wins;
      put(u, v + out * 0.02, 1.7, 1.3, 0.04, 1.35, 0xf2f2ef);
      const [gx, gy] = at(u, v + out * 0.045);
      glass.push({ x: gx, y: 1.7, z: -gy, sx: 0.03, sy: 1.15, sz: 1.1, ry: Math.atan2(by, bx), color: 0x2a3840 });
    }
  }
  const doorU = vHigh ? r0 : r1, outU = vHigh ? -1 : 1;
  put(doorU + outU * 0.02, vm, 1.1, 0.04, 1.05, 2.2, 0xf2f2ef);
  put(doorU + outU * 0.045, vm, 1.07, 0.03, 0.9, 2.05, 0x5a3e2c);
  // the veranda: timber posts round the open sides, a beam on top, a slatted rail, two picnic tables
  const posts = [];
  for (let k = 0; k <= 2; k++) for (const v of [v0 + 0.1, v1 - 0.1]) posts.push([w0 + 0.1 + k * (w1 - w0 - 0.2) / 2, v]);
  for (const v of [v0 + 0.1 + WID / 3, v1 - 0.1 - WID / 3]) posts.push([vHigh ? w1 - 0.1 : w0 + 0.1, v]);
  for (const [u, v] of posts) put(u, v, H / 2, 0.14, 0.14, H, TIMBER);
  for (const v of [v0 + 0.1, v1 - 0.1]) put((w0 + w1) / 2, v, H - 0.12, w1 - w0, 0.16, 0.24, TIMBER);
  const farU = vHigh ? w1 - 0.1 : w0 + 0.1;
  put(farU, vm, H - 0.12, 0.16, WID, 0.24, TIMBER);
  for (const v of [v0 + 0.1, v1 - 0.1]) put((w0 + w1) / 2, v, 0.9, w1 - w0, 0.06, 0.08, TIMBER);
  for (const f of [0.33, 0.67]) {
    const u = w0 + (w1 - w0) * f;
    put(u, vm, 0.74, 0.8, 1.6, 0.05, TIMBER);
    for (const s of [-1, 1]) put(u + s * 0.6, vm, 0.44, 0.3, 1.6, 0.05, TIMBER);
  }
  // the roofs: the room's green-grey, the veranda's slate (the north courtyard's veranda roof is pale grey)
  const north = cy > 40;
  hipRoof(hips, at, r0, r1, v0, v1, H, north ? 0x7d9189 : 0x5c6f58);
  hipRoof(hips, at, w0, w1, v0, v1, H - 0.08, north ? 0xc2c6cc : 0x5b6266);
}

// A low hipped roof over [u0,u1] x [v0,v1] (map axes via at(u, v)), eaves at h, 0.35 m overhang.
function hipRoof(out, at, u0, u1, v0, v1, h, color) {
  const o = 0.35;
  u0 -= o; u1 += o; v0 -= o; v1 += o;
  const L = u1 - u0, W = v1 - v0, rise = Math.min(L, W) * 0.09;   // (a shallow pitch, about 10 degrees)
  const c = new THREE.Color(color).convertSRGBToLinear();
  const P = (u, v, y) => { const [x, yy] = at(u, v); return [x, y, -yy]; };
  const tri = (a, b, d, down = false, k = 1) => {
    // wind each face so its normal points up (the soffit's down)
    const ux = b[0] - a[0], uz = b[2] - a[2], vx = d[0] - a[0], vz = d[2] - a[2];
    const up = uz * vx - ux * vz >= 0;
    out.pos.push(...a, ...(up !== down ? [...b, ...d] : [...d, ...b]));
    for (let j = 0; j < 3; j++) out.col.push(c.r * k, c.g * k, c.b * k);
  };
  const A = P(u0, v0, h), B = P(u1, v0, h), C = P(u1, v1, h), D = P(u0, v1, h);
  if (L >= W) {
    const vm = (v0 + v1) / 2, R0 = P(u0 + W / 2, vm, h + rise), R1 = P(u1 - W / 2, vm, h + rise);
    tri(A, B, R1); tri(A, R1, R0); tri(D, C, R1); tri(D, R1, R0); tri(A, D, R0); tri(B, C, R1);
  } else {
    const um = (u0 + u1) / 2, R0 = P(um, v0 + L / 2, h + rise), R1 = P(um, v1 - L / 2, h + rise);
    tri(A, D, R1); tri(A, R1, R0); tri(B, C, R1); tri(B, R1, R0); tri(A, B, R0); tri(D, C, R1);
  }
  // the soffit
  tri(A, D, C, true, 0.7); tri(A, C, B, true, 0.7);
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
    shader.uniforms.uShop = { value: mat.userData.shopTex || emptyShopTex() };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aEdge; attribute vec4 aMask; attribute float aTerr;
        varying vec2 vFac; varying vec4 vEdge; varying vec4 vMask; varying float vViewDist; varying float vTerr;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vFac = uv; vEdge = aEdge; vMask = aMask; vTerr = aTerr;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vViewDist = -mvPosition.z;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vFac; varying vec4 vEdge; varying vec4 vMask; varying float vViewDist; varying float vTerr;
        uniform float uLamp; uniform float uFH;
        uniform highp sampler2D uShop;
        ${NOISE_GLSL}
        float bitAt(float m, float i) { return mod(floor(m / exp2(i)), 2.0); }
        // anti-aliased box: 1 inside [a,b] on x and [c,d] on y
        float aaBox(vec2 p, vec4 r, vec2 fw) {
          vec2 lo = smoothstep(r.xz - fw, r.xz + fw, p);
          vec2 hi = 1.0 - smoothstep(r.yw - fw, r.yw + fw, p);
          return lo.x * lo.y * hi.x * hi.y;
        }
        float fh1(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        // signed distance to a box (centre c, half size hs) with all four corners rounded (radius r)
        float sdRoundBox(vec2 p, vec2 c, vec2 hs, float r) {
          vec2 q = abs(p - c) - hs + r;
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        }
        // signed distance to a box (centre c, half size hs) with its two top corners rounded (radius r)
        float sdRoundTop(vec2 p, vec2 c, vec2 hs, float r) {
          vec2 q = p - c, d = abs(q) - hs;
          if (q.y > hs.y - r && abs(q.x) > hs.x - r) return length(vec2(abs(q.x) - hs.x + r, q.y - hs.y + r)) - r;
          return max(d.x, d.y);
        }
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
        if (style == 5) wallC = vec3(0.175, 0.178, 0.148);        // twins: warm sage grey (the photosphere, the user's photos)
        if (style == 6) wallC = vec3(0.50, 0.49, 0.47);            // raw concrete shell
        if (style == 7) wallC = vec3(0.86, 0.865, 0.86) * (0.95 + 0.05 * step(0.5, fract(vFac.x / 0.9))); // ribbed cladding
        if (style == 10) wallC = vec3(0.30, 0.095, 0.035) * (0.8 + 0.4 * gdNoise(vFac * vec2(0.9, 0.5) + vMask.z));  // weathering steel
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
        vec3 shopFrameC = vec3(0.13, 0.14, 0.15);
        float shopIn = 0.0, shopGlow = 0.0;
        if (style == 3) {
          // Shop pavilions, laid out per half-metre slot in uShop (row 2k: shopfronts, 2k+1: parapet
          // or upper floor): white render, tall arch-headed shopfronts, arched panels in the parapet.
          ivec2 st = ivec2(int(clamp(floor(u / 0.5), 0.0, 127.0)), int(max(vMask.x, 0.0) + 0.5) * 2);
          vec4 so = texelFetch(uShop, st, 0);
          vec4 sp = texelFetch(uShop, st + ivec2(0, 1), 0);
          int of = int(so.b + 0.5), pf = int(sp.b + 0.5);
          bool gym = levels > 1.5;
          float wallTop = top + 1.0;
          float gTop = gym ? gH - 0.55 : top - 1.25;
          wallC = vec3(0.905, 0.9, 0.885) * (0.965 + 0.07 * gdNoise(vec2(u, v) * 6.5 + vMask.z));
          wallC *= mix(0.84, 1.0, smoothstep(0.0, 1.2, v));
          if ((pf & 16) != 0) {
            // Nikora's block: a cream, speckled, travertine-like render (the grain fades out with distance)
            float g1 = mix(gdNoise(vec2(u, v) * 23.0 + vMask.z), 0.5, smoothstep(0.02, 0.07, fw.x));
            float g2 = mix(gdNoise(vec2(u, v) * 61.0), 0.5, smoothstep(0.008, 0.03, fw.x));
            wallC *= vec3(0.975, 0.95, 0.875) * (0.9 + 0.12 * g1 + 0.08 * g2);
          }
          if ((of & 1) != 0) {
            float w = so.g - so.r;
            // the jambs lean in towards the top (the flags' high bits, in decimetres): measure the
            // shape where they stand upright
            float hv = clamp(v / gTop, 0.0, 1.0);
            float x0 = so.r + float((of >> 8) & 63) * 0.1 * hv, x1 = so.g - float((of >> 14) & 63) * 0.1 * hv;
            float uu = so.r + (u - x0) * w / max(x1 - x0, 0.2);
            float sd = sdRoundTop(vec2(uu, v), vec2((so.r + so.g) * 0.5, (gTop + 0.04) * 0.5), vec2(w * 0.5, (gTop - 0.04) * 0.5), gym || (of & 16) != 0 ? 0.02 : min(0.6, w * 0.14));
            shopIn = 1.0 - smoothstep(-fw.x, fw.x, sd);
            // a white reveal, the frame, then glass split by mullions (about 1.1 m) and transoms
            float inF = 1.0 - smoothstep(-fw.x, fw.x, sd + 0.12);
            float inG = 1.0 - smoothstep(-fw.x, fw.x, sd + 0.2);
            float nP = max(1.0, floor((w - 0.4) / 1.1 + 0.5)), pw = (w - 0.4) / nP;
            float mx = abs(fract((u - so.r - 0.2) / pw + 0.5) - 0.5) * pw;
            float t1 = 2.55, t2 = gym ? -9.0 : gTop - 1.75;
            float bars = 1.0 - smoothstep(0.03, 0.03 + fw.x, mx);
            bars = max(bars, 1.0 - smoothstep(0.04, 0.04 + fw.y, abs(v - t1)));
            bars = max(bars, 1.0 - smoothstep(0.035, 0.035 + fw.y, abs(v - t2)));
            float du = abs(u - so.a);
            if (so.a > 0.0 && v < t1 && du < 0.95) {
              // a pair of door leaves: thick jambs, the meeting stiles, push bars
              float jamb = smoothstep(0.83 - fw.x, 0.83, du) * (1.0 - smoothstep(0.93, 0.93 + fw.x, du));
              float split = 1.0 - smoothstep(0.03, 0.03 + fw.x, du);
              float push = (1.0 - smoothstep(0.025, 0.025 + fw.y, abs(v - 1.05))) * step(0.12, du) * step(du, 0.7);
              bars = max(max(jamb, split), push);
            }
            bars *= 1.0 - farFade;
            glassA = inG * (1.0 - bars);
            frameA = inF - glassA;
            // Spar's display windows are framed in red, the street-side shop's in green
            if ((of & 2) != 0) shopFrameC = mix(shopFrameC, vec3(0.6, 0.06, 0.08), clamp(inF - inG, 0.0, 1.0));
            if ((of & 32) != 0) shopFrameC = vec3(0.12, 0.36, 0.2);
            // a dark sign board across the shopfront (as in the user's photo)
            if ((of & 8) != 0 && v > 2.6 && v < 3.55) { frameA = inG; glassA = 0.0; shopFrameC = vec3(0.1, 0.105, 0.11); }
            // the reveal: shaded, darker under the head
            wallC *= 1.0 - (shopIn - inF) * (0.14 + 0.2 * smoothstep(gTop - 0.8, gTop, v));
            shopGlow = inG * (1.0 - 0.8 * bars);
          }
          if (!gym && (pf & 1) != 0) {
            // long rounded-rectangle panels inset in the upper half of the parapet (both photos of the
            // pavilions): a shadow under the top edge, a lit sill
            float y1 = wallTop - 0.34, y0 = y1 - 0.85;
            float sd = sdRoundBox(vec2(u, v), vec2((sp.r + sp.g) * 0.5, (y0 + y1) * 0.5), vec2((sp.g - sp.r) * 0.5, (y1 - y0) * 0.5), 0.36);
            float inP = 1.0 - smoothstep(-fw.x, fw.x, sd);
            float lip = inP * (1.0 - smoothstep(0.0, 0.13, -sd)) * smoothstep(y0 + 0.25, y0 + 0.5, v);
            float sill = inP * (1.0 - smoothstep(0.0, 0.06, v - y0));
            float edge = (1.0 - smoothstep(-fw.x, fw.x, sd - 0.04)) - inP;   // the arris round the recess catches the light
            wallC *= (1.0 - 0.1 * inP) * (1.0 - 0.38 * lip) * (1.0 + 0.1 * sill) * (1.0 + 0.06 * edge);
          }
          if (gym && v > gH + 0.2 && v < top - 0.2 && (pf & 2) != 0) {
            // Format Fit's upper floor on the street side: pale louvres over the glass
            float inW = aaBox(vec2(u, v), vec4(sp.r, sp.g, gH + 0.3, top - 0.3), fw);
            float slat = mix(smoothstep(0.25, 0.55, fract(v / 0.22)), 0.62, farFade);
            wallC = mix(wallC, mix(vec3(0.07, 0.075, 0.08), vec3(0.76, 0.76, 0.74), slat), inW);
          }
          if (gym && v > gH + 0.3 && v < top - 0.25 && (pf & 4) != 0) {
            // Format Fit's upper floor: dark curtain glass in a black grid
            vec4 r = vec4(sp.r, sp.g, gH + 0.4, top - 0.35);
            float inW = aaBox(vec2(u, v), r, fw), inWG = aaBox(vec2(u, v), r + vec4(0.1, -0.1, 0.1, -0.1), fw);
            float nP = max(1.0, floor((sp.g - sp.r) / 1.2 + 0.5)), pw = (sp.g - sp.r) / nP;
            float mx = abs(fract((u - sp.r) / pw + 0.5) - 0.5) * pw;
            float bars = (1.0 - smoothstep(0.03, 0.03 + fw.x, mx)) * (1.0 - farFade);
            glassA = inWG * (1.0 - bars);
            frameA = inW - glassA;
            shopIn = inW;
            shopGlow = inWG * 0.6;
          }
          if ((pf & 8) != 0) {
            // the west wing's parapet (the photosphere): a row of round-topped merlons with gaps between
            float mx = (fract(u / 2.4) - 0.5) * 2.4;
            if (v > wallTop - 0.75 + (abs(mx) < 0.75 ? sqrt(0.5625 - mx * mx) : 0.0)) discard;
          }
        }
        if (style == 9) {
          // security booth: glass all round in dark frames on a grey plinth, a white band on top
          wallC = v < 0.45 ? vec3(0.46, 0.47, 0.48) : vec3(0.9, 0.9, 0.89);
          vec4 r = vec4(0.22, edgeLen - 0.22, 0.5, min(top - 0.4, 2.9));
          float inW = aaBox(vec2(u, v), r, fw), inG = aaBox(vec2(u, v), r + vec4(0.07, -0.07, 0.07, -0.07), fw);
          float nP = max(1.0, floor((edgeLen - 0.44) / 1.05 + 0.5)), pw = (edgeLen - 0.44) / nP;
          float mx = abs(fract((u - 0.22) / pw + 0.5) - 0.5) * pw;
          float bars = max(1.0 - smoothstep(0.03, 0.03 + fw.x, mx), 1.0 - smoothstep(0.03, 0.03 + fw.y, abs(v - 1.25))) * (1.0 - farFade);
          glassA = inG * (1.0 - bars);
          frameA = inW - glassA;
          shopFrameC = vec3(0.12, 0.13, 0.14);
          shopIn = inW; shopGlow = inG * (1.0 - 0.8 * bars);
        }
        if (style == 10 && aboveTop) wallC = vec3(0.78, 0.78, 0.76);   // (the coping)
        if (!aboveTop && style != 4 && style != 3 && style != 9) {
          if (style == 6) {
            float open_ = aaBox(vec2(lx, ly), vec4(0.25, bayW - 0.25, 0.25, uFH - 0.35), fw);
            glassA = 0.0;
            wallC = mix(wallC, vec3(0.05, 0.05, 0.055), open_ * step(0.5, fl));
          } else if (style == 7) {
            // arenas (the gate photospheres): a grey plinth, a row of small windows high up, a big
            // dark door here and there
            if (v < 0.9) wallC = vec3(0.55, 0.555, 0.56);
            float wy = top * 0.62;
            glassA = aaBox(vec2(lx, v), vec4(bayW * 0.5 - 0.7, bayW * 0.5 + 0.7, wy, wy + 1.0), fw);
            if (fh1(vec3(bay, 3.0, vMask.z)) < 0.14) glassA = max(glassA, aaBox(vec2(lx, v), vec4(1.0, bayW - 1.0, 0.0, 4.2), fw));
          } else if (style == 10) {
            // the Ice Palace (the Gate 2 photosphere): weathering-steel cladding behind tall pale fins
            // that lean into V's, a slot of dark glass between each pair, a glazed foot
            float B = 7.0, k = floor(u / B), x = u - k * B, t = clamp(v / top, 0.0, 1.0);
            float fx = mod(k, 2.0) < 0.5 ? B * (0.12 + 0.62 * t) : B * (0.88 - 0.62 * t);
            float fin = (1.0 - smoothstep(0.42, 0.42 + fw.x, abs(x - fx))) * (1.0 - farFade * 0.5);
            float slot = aaBox(vec2(x, v), vec4(B * 0.5 - 0.35, B * 0.5 + 0.35, 1.0, top - 0.9), fw) * step(0.35, fh1(vec3(k, 7.0, vMask.z)));
            glassA = max(slot, aaBox(vec2(u, v), vec4(-1.0, edgeLen + 1.0, 0.35, 2.7), fw) * step(0.6, fh1(vec3(k, 9.0, vMask.z))));
            glassA *= 1.0 - fin;
            wallC = mix(wallC, vec3(0.8, 0.8, 0.78), fin);
          } else if (bayW > 1.9) {
            float cxm = bayW * 0.5;
            vec4 r;
            if (balc > 0.5 && fl > 0.5) {
              r = vec4(cxm - 0.8, cxm + 0.8, 0.05, 2.45);            // balcony door
            } else if (fl < 0.5 && bay < 24.0 && bitAt(vTerr, bay) > 0.5) {
              r = vec4(cxm - 0.75, cxm + 0.75, 0.6, 2.6);            // French doors onto a terrace
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
        float curtain = step(0.55, roomSeed) * smoothstep(0.35, 0.5, fract(ly / 2.4 + roomSeed)) * (style == 3 || style == 9 ? 0.0 : 1.0);
        glassC = mix(glassC, vec3(0.30, 0.28, 0.25), curtain * 0.25);
        // (shops: shelves and goods low down behind the glass)
        if (style == 3) glassC = mix(glassC, vec3(0.15, 0.14, 0.12), 0.4 * (1.0 - smoothstep(0.4, 2.3, v)));
        vec3 frameC = style == 3 || style == 9 ? shopFrameC : style == 5 ? vec3(0.2) : style == 1 ? vec3(0.85) : vec3(0.88, 0.88, 0.87);
        vec3 col = mix(wallC, frameC, clamp(frameA, 0.0, 1.0));
        col = mix(col, glassC, glassA);
        // far away: blend towards the average so the grid doesn't shimmer
        vec3 avg = style == 3 || style == 9 ? mix(wallC, mix(frameC, glassC, 0.85), shopIn) : mix(wallC, glassC, 0.22);
        col = mix(col, avg, farFade);
        glassA *= 1.0 - farFade;
        diffuseColor.rgb = col;
        float gdGlass = glassA;
        float gdLit = step(0.62, fh1(vec3(bay * 1.7, fl * 3.1, vMask.z * 0.37))) * (style == 4 || style == 3 || style == 9 ? 0.0 : 1.0);
        float gdShopGlow = shopGlow;
        `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.88, 0.06, gdGlass);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(0.0, 0.55, gdGlass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 warmRoom = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), step(0.8, roomSeed));
        totalEmissiveRadiance += warmRoom * gdLit * gdGlass * uLamp * 1.6;
        // shop fronts glow in the evening: brightest up under the ceiling lights, goods lower down
        if (style == 3 || style == 9) totalEmissiveRadiance += vec3(1.0, 0.9, 0.74) * gdShopGlow * uLamp * (0.35 + 0.4 * smoothstep(0.6, 3.0, vFac.y));`);
  };
  mat.customProgramCacheKey = () => 'gd-facade-v11';
  return mat;
}

// (a blank layout, if the backdrop buildings ever compile the facade before the complex is built)
let emptyShop = null;
function emptyShopTex() {
  if (!emptyShop) {
    emptyShop = new THREE.DataTexture(new Float32Array([-1, -1, 0, -1, -1, -1, 0, -1]), 1, 2, THREE.RGBAFormat, THREE.FloatType);
    emptyShop.needsUpdate = true;
  }
  return emptyShop;
}

// ------------------------------------------------------------------------------------------
// The smallest rectangle round a footprint (tried along each edge): {c: centre, a: long axis,
// L, W (its sides), rise: a 6-degree gable's height over the short side}.
function boundingRect(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1) continue;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of pts) { const u = x * ux + y * uy, v = -x * uy + y * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uy, u0, u1, v0, v1 };
  }
  let { ux, uy, u0, u1, v0, v1 } = best;
  if (u1 - u0 < v1 - v0) { [ux, uy] = [-uy, ux]; [u0, u1, v0, v1] = [v0, v1, -u1, -u0]; }   // u: the long side
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return { c: [cu * ux - cv * uy, cu * uy + cv * ux], a: [ux, uy], L: u1 - u0, W: v1 - v0, rise: (v1 - v0) / 2 * Math.tan(THREE.MathUtils.degToRad(6)) };
}

// A shallow gable over the rectangle r with its eaves at h: two roof planes in pale grey steel,
// the two gable ends in the walls' white, a little overhang.
function gableRoof(out, r, h) {
  const [ux, uy] = r.a, vx = -uy, vy = ux, L = r.L / 2 + 0.5, W = r.W / 2 + 0.6, ridge = h + r.rise;
  const P = (u, v, y) => [r.c[0] + ux * u + vx * v, y, -(r.c[1] + uy * u + vy * v)];
  const roofC = new THREE.Color(0xc4c7c9).convertSRGBToLinear(), wallC = new THREE.Color(0xd8d8d4).convertSRGBToLinear();
  const tri = (a, b, c, col) => { out.pos.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) out.col.push(col.r, col.g, col.b); };
  const A = P(-L, -W, h), B = P(L, -W, h), C = P(L, W, h), D = P(-L, W, h), R0 = P(-L, 0, ridge), R1 = P(L, 0, ridge);
  tri(A, B, R1, roofC); tri(A, R1, R0, roofC); tri(C, D, R0, roofC); tri(C, R0, R1, roofC);
  const e0 = P(-L + 0.5, -W + 0.6, h), e1 = P(-L + 0.5, W - 0.6, h), e2 = P(-L + 0.5, 0, ridge - 0.05);
  const f0 = P(L - 0.5, -W + 0.6, h), f1 = P(L - 0.5, W - 0.6, h), f2 = P(L - 0.5, 0, ridge - 0.05);
  tri(e0, e1, e2, wallC); tri(f0, f2, f1, wallC);
}

// Neighbours from OSM: construction shells, the Olympic arenas, the Ice Palace, private houses.
// ------------------------------------------------------------------------------------------
const ARENA_NAMES = ['ტანვარჯიშის არენა', 'ფრენბურთის არენა'];
const ICE_PALACE = 'ყინულის სასახლე';

export function buildBackdropBuildings(level, scene, colliders, atmo) {
  const group = new THREE.Group();
  group.name = 'backdrop-buildings';
  const walls = { pos: [], nor: [], uv: [], edge: [], mask: [] };
  const roofs = [], pitched = [];
  const gables = { pos: [], col: [] };
  const sites = [];
  for (const b of level.surroundings.buildings) {
    const pts = b.poly.outer;
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; area += x1 * y2 - x2 * y1; }
    area = Math.abs(area) / 2;
    let style, levels = b.levels, fh = FH, top;
    let gable = null;
    if (b.kind === 'construction') { style = 6; }
    else if (b.name === ICE_PALACE) { style = 10; levels = 1; top = 12.5; }
    else if (ARENA_NAMES.includes(b.name) || area > 1800) {
      style = 7; levels = 1; top = b.height || 14;
      // the Olympic arenas' shallow gables (the gate photospheres): the ridge at the OSM height
      if (ARENA_NAMES.includes(b.name)) { gable = boundingRect(pts); top -= gable.rise; }
    }
    else if (b.kind === 'grandstand' || b.kind === 'garages' || b.kind === 'service') { style = 6; levels = Math.max(1, levels); }
    else { style = 8; levels = Math.min(levels || 2, 3); }
    const gH = style === 7 || style === 10 ? top : 3.0;
    if (top == null) top = gH + (levels - 1) * fh;
    const parapet = style === 8 ? 0.3 : 0.8;
    const seed = (b.poly.outer[0][0] * 13.7 + b.poly.outer[0][1] * 7.1) % 997;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.05) continue;
      const nx = (by - ay) / len, ny = -(bx - ax) / len;
      const nBays = Math.max(1, Math.round(len / (style === 7 || style === 10 ? 6 : 3.2)));
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
    else if (gable) gableRoof(gables, gable, top + parapet);
    else roofs.push(flatGeometry([b.poly], top + 0.1, 4));
    if (b.kind === 'construction') sites.push({ pts, top, area });
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(walls.pos, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(walls.nor, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(walls.uv, 2));
  wg.setAttribute('aEdge', new THREE.Float32BufferAttribute(walls.edge, 4));
  wg.setAttribute('aMask', new THREE.Float32BufferAttribute(walls.mask, 4));
  wg.setAttribute('aTerr', new THREE.Float32BufferAttribute(new Float32Array(walls.pos.length / 3), 1));
  fixWindingByNormal(wg);
  const mesh = new THREE.Mesh(wg, getFacadeMaterial(atmo));
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  if (roofs.length) {
    const r = new THREE.Mesh(mergeGeometries(roofs), new THREE.MeshStandardMaterial({ color: 0x8e8c88, roughness: 0.95 }));
    r.receiveShadow = true; group.add(r);
  }
  if (gables.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(gables.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(gables.col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide }));
    m.castShadow = m.receiveShadow = true;
    group.add(m);
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
