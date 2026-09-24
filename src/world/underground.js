import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flatGeometry, pointInPoly } from './geom.js';
import { pbr, radialTexture } from './textures.js';
import { addMacroVariation, pbrMaterial } from './materials.js';

// The underground car parks: one parking level under each courtyard (tools/build_level.py lays
// them out), reached by the ramps the zombies come up. The surface above is untouched: walls,
// columns and parked cars down here carry minY/maxY, and the ground-level flow field ignores
// anything below ground. Concrete floor with painted stalls, a column every three stalls, strip
// lights over the aisles, a sprinkler main, green exit signs at every ramp.

const STALL_W = 2.5, STALL_D = 5.0;

function hazardTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#1b1b1b'; x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#e7b91c';
  for (let i = -64; i < 256; i += 32) { x.beginPath(); x.moveTo(i, 64); x.lineTo(i + 16, 64); x.lineTo(i + 80, 0); x.lineTo(i + 64, 0); x.closePath(); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}

// columns: painted plaster, hazard stripes at the bottom, a level mark at eye height
function columnTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#d9d5cc'; x.fillRect(0, 0, 128, 512);
  x.fillStyle = '#1b1b1b'; x.fillRect(0, 452, 128, 60);
  x.fillStyle = '#e7b91c';
  for (let i = -60; i < 128; i += 30) { x.beginPath(); x.moveTo(i, 512); x.lineTo(i + 15, 512); x.lineTo(i + 75, 452); x.lineTo(i + 60, 452); x.closePath(); x.fill(); }
  x.fillStyle = '#2f6db3'; x.fillRect(0, 250, 128, 34);
  x.fillStyle = '#ffffff'; x.font = 'bold 26px Arial'; x.textAlign = 'center'; x.fillText('P -1', 64, 276);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#138a3e'; x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#ffffff'; x.font = 'bold 24px Arial, "Noto Sans Georgian", sans-serif'; x.textAlign = 'center';
  x.fillText('გასასვლელი  EXIT', 128, 30);
  x.font = 'bold 22px Arial'; x.fillText('← →', 128, 56);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A vertical quad from a to b (map coords), y0..y1.
function wallQuad(a, b, y0, y1, uvScale, v0 = 0, v1 = null) {
  const [ax, ay] = a, [bx, by] = b;
  const len = Math.hypot(bx - ax, by - ay);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([ax, y0, -ay, bx, y0, -by, bx, y1, -by, ax, y0, -ay, bx, y1, -by, ax, y1, -ay], 3));
  const u = len / uvScale, vt = v1 ?? (y1 - y0) / uvScale;
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, v0, u, v0, u, vt, 0, v0, u, vt, 0, vt], 2));
  g.computeVertexNormals();
  return g;
}

// A flat strip on the floor from p to q (map coords), width w.
function floorStrip(p, q, w, y) {
  const [px, py] = p, [qx, qy] = q;
  const L = Math.hypot(qx - px, qy - py) || 1, nx = -(qy - py) / L * w / 2, ny = (qx - px) / L * w / 2;
  const g = new THREE.BufferGeometry();
  const A = [px + nx, y, -(py + ny)], B = [qx + nx, y, -(qy + ny)], C = [qx - nx, y, -(qy - ny)], D = [px - nx, y, -(py - ny)];
  g.setAttribute('position', new THREE.Float32BufferAttribute([...A, ...C, ...B, ...A, ...D, ...C], 3));
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) {
    g.setAttribute('position', new THREE.Float32BufferAttribute([...A, ...B, ...C, ...A, ...C, ...D], 3));
    g.computeVertexNormals();
  }
  return g;
}

export class Underground {
  constructor(level) {
    this.list = (level.underground || []).map((u, i) => {
      const pts = u.poly.outer, holes = u.poly.holes || [];
      const box = pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
      const doors = u.doors.map((d) => {
        const [ax, ay] = d.axis, [dax, day] = d.a, [dbx, dby] = d.b;
        return {
          ...d,
          in: { x: d.in[0], z: -d.in[1] }, out: { x: d.out[0], z: -d.out[1] },
          // the last 0.6 m of the ramp (and the lip of the door) count as car-park floor: the
          // heightmap jumps back up to courtyard level right at the door line
          zone: [[dax + ax * 0.5, day + ay * 0.5], [dbx + ax * 0.5, dby + ay * 0.5], [dbx - ax * 0.6, dby - ay * 0.6], [dax - ax * 0.6, day - ay * 0.6]],
        };
      });
      return { ...u, id: i, pts, holes, box, doors };
    });
  }

  // The car park a point (three.js x, z; feet height y) is down in, or null.
  at(x, z, y) {
    const mx = x, my = -z;
    for (const u of this.list) {
      if (y > u.ceiling - 0.25 || y < u.floor - 1.5) continue;
      if (mx < u.box[0] - 1 || mx > u.box[2] + 1 || my < u.box[1] - 1 || my > u.box[3] + 1) continue;
      if (pointInPoly(mx, my, u.pts) && !u.holes.some((h) => pointInPoly(mx, my, h))) return u;
      for (const d of u.doors) if (pointInPoly(mx, my, d.zone)) return u;
    }
    return null;
  }

  nearestDoor(u, x, z) {
    let best = null, bd = Infinity;
    for (const d of u.doors) { const dd = Math.hypot(d.in.x - x, d.in.z - z); if (dd < bd) { bd = dd; best = d; } }
    return best;
  }

  // every point where you walk out of a car park onto its ramp (goals for the flow field)
  get doorIns() { return this.list.flatMap((u) => u.doors.map((d) => d.in)); }

  bounds() {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const u of this.list) { b[0] = Math.min(b[0], u.box[0]); b[1] = Math.min(b[1], u.box[1]); b[2] = Math.max(b[2], u.box[2]); b[3] = Math.max(b[3], u.box[3]); }
    return b;
  }

  // a free spot in an aisle (for pickups)
  randomSpot(taken = []) {
    if (!this.list.length) return null;
    const u = this.list[Math.floor(Math.random() * this.list.length)];
    for (let k = 0; k < 40; k++) {
      const x = u.box[0] + Math.random() * (u.box[2] - u.box[0]), y = u.box[1] + Math.random() * (u.box[3] - u.box[1]);
      if (!pointInPoly(x, y, u.pts) || u.holes.some((h) => pointInPoly(x, y, h))) continue;
      // near a light = in an aisle, clear of the stalls
      if (!u.lights.some(([lx, ly]) => Math.hypot(lx - x, ly - y) < 2)) continue;
      if (taken.some((t) => Math.hypot(t.x - x, t.z + y) < 8)) continue;
      return { x, z: -y, y: u.floor };
    }
    return null;
  }

  async build(scene, colliders) {
    const group = new THREE.Group();
    group.name = 'underground';
    if (!this.list.length) return group;
    const [concrete, plaster] = await Promise.all([pbr('concrete'), pbr('plaster')]);
    const floorMat = addMacroVariation(pbrMaterial(concrete, { color: 0x8f8e8a, normalScale: 0.35, roughMap: false, roughness: 0.62, envMapIntensity: 0.35 }), { freq: 0.18, amount: 0.3 });
    const ceilMat = pbrMaterial(concrete, { color: 0xaaa69e, normalScale: 0.6, roughMap: false, roughness: 0.95, side: THREE.BackSide, envMapIntensity: 0.2 });
    const wallMat = pbrMaterial(plaster, { color: 0xd4d0c6, normalScale: 0.5, roughMap: false, roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: 0.25 });
    const bandMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7, side: THREE.DoubleSide, envMapIntensity: 0.25 });
    const paintMat = new THREE.MeshStandardMaterial({ color: 0xf1efe6, roughness: 0.55, envMapIntensity: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0xe7b91c, roughness: 0.55, envMapIntensity: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const floors = [], ceilings = [], walls = [], bands = [], lines = [], dashes = [];
    const columns = [], lights = [], signs = [];
    for (const g of this.list) {
      floors.push(flatGeometry([g.poly], g.floor + 0.005, 3));
      ceilings.push(flatGeometry([g.poly], g.ceiling, 3));
      // walls round the car park, leaving every ramp door open
      const ring = (pts) => {
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (L < 0.05) continue;
          const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L;
          const off = (px, py) => Math.abs((px - a[0]) * ty - (py - a[1]) * tx);
          // cut out any door lying on this edge
          const cuts = [];
          for (const d of g.doors) {
            const [dax, day] = d.a, [dbx, dby] = d.b;
            if (off(dax, day) < 0.35 && off(dbx, dby) < 0.35) {
              const ta = (dax - a[0]) * tx + (day - a[1]) * ty, tb = (dbx - a[0]) * tx + (dby - a[1]) * ty;
              cuts.push([Math.max(0, Math.min(ta, tb)), Math.min(L, Math.max(ta, tb))]);
            }
          }
          cuts.sort((p, q) => p[0] - q[0]);
          const parts = [];
          let t = 0;
          for (const [c0, c1] of cuts) { if (c0 > t + 0.05) parts.push([t, c0]); t = Math.max(t, c1); }
          if (t < L - 0.05) parts.push([t, L]);
          const P = (tt) => [a[0] + tx * tt, a[1] + ty * tt];
          for (const [t0, t1] of parts.map(([u0, u1]) => [u0, u1])) {
            const p = P(t0), q = P(t1);
            walls.push(wallQuad(p, q, g.floor, g.ceiling, 2.5));
            // hazard band, 1 cm into the hall
            const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, nx = -ty, ny = tx;
            const s = pointInPoly(mx + nx * 0.2, my + ny * 0.2, g.pts) ? 1 : -1;
            const o = 0.012 * s;
            bands.push(wallQuad([p[0] + nx * o, p[1] + ny * o], [q[0] + nx * o, q[1] + ny * o], g.floor, g.floor + 0.32, 1.0, 0, 1));
            colliders.addSegment(p[0], -p[1], q[0], -q[1], { height: g.ceiling, minY: g.floor - 0.6, kind: 'wall' });
          }
        }
      };
      ring(g.pts);
      for (const h of g.holes) ring(h);
      // stall paint: a line either side of each stall
      const [ax, ay] = g.axis;
      for (const st of g.stalls) {
        const hx = Math.cos(st.h), hy = Math.sin(st.h), sx = -hy, sy = hx;
        for (const sd of [-1, 1]) {
          const cx = st.x + sx * sd * STALL_W / 2, cy = st.y + sy * sd * STALL_W / 2;
          lines.push(floorStrip([cx - hx * STALL_D / 2, cy - hy * STALL_D / 2], [cx + hx * STALL_D / 2, cy + hy * STALL_D / 2], 0.1, g.floor + 0.012));
        }
      }
      // yellow arrows' worth of dashes down each aisle (along the lights)
      for (const [x, y] of g.lights) dashes.push(floorStrip([x - ax * 0.9, y - ay * 0.9], [x + ax * 0.9, y + ay * 0.9], 0.12, g.floor + 0.012));
      // columns
      const ang = Math.atan2(ay, ax);
      for (const [x, y] of g.columns) {
        columns.push({ x, y, ang, g });
        colliders.addBox(x, -y, 0.3, 0.3, -ang, { height: g.ceiling, minY: g.floor - 0.6, kind: 'wall' });
      }
      for (const [x, y] of g.lights) lights.push({ x, y, ang, g });
      // exit sign over every ramp door, facing into the car park
      for (const d of g.doors) {
        const mx = (d.a[0] + d.b[0]) / 2 + d.axis[0] * 0.3, my = (d.a[1] + d.b[1]) / 2 + d.axis[1] * 0.3;
        signs.push({ x: mx, y: my, axis: d.axis, g });
      }
      // sprinkler mains along the aisles: one run per line of lights
      g.pipes = [];
      const byAisle = new Map();
      for (const [x, y] of g.lights) {
        const key = Math.round(((x - g.lights[0][0]) * -ay + (y - g.lights[0][1]) * ax) / 4);
        if (!byAisle.has(key)) byAisle.set(key, []);
        byAisle.get(key).push([x, y]);
      }
      for (const run of byAisle.values()) {
        if (run.length < 2) continue;
        run.sort((p, q) => (p[0] * ax + p[1] * ay) - (q[0] * ax + q[1] * ay));
        const [x0, y0] = run[0], [x1, y1] = run[run.length - 1], nx = -ay * 1.4, ny = ax * 1.4;
        g.pipes.push([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny]]);
      }
    }
    const add = (geos, mat, { cast = false, receive = true } = {}) => {
      if (!geos.length) return null;
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.castShadow = cast; m.receiveShadow = receive;
      group.add(m);
      return m;
    };
    add(floors, floorMat);
    add(ceilings, ceilMat, { cast: true });   // the deck overhead: keeps the sun out
    add(walls, wallMat, { cast: true });
    add(bands, bandMat);
    add(lines, paintMat, { receive: true });
    add(dashes, yellowMat, { receive: true });

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    if (columns.length) {
      const H = this.list[0].ceiling - this.list[0].floor;
      const colMat = new THREE.MeshStandardMaterial({ map: columnTexture(), roughness: 0.85, envMapIntensity: 0.25 });
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, H, 0.6), colMat, columns.length);
      columns.forEach((c, i) => {
        e.set(0, c.ang, 0); q.setFromEuler(e);
        m4.compose(p.set(c.x, c.g.floor + H / 2, -c.y), q, s);
        im.setMatrixAt(i, m4);
      });
      im.castShadow = im.receiveShadow = true;
      group.add(im);
    }
    if (lights.length) {
      // strip lights, and the soft pool of light each one throws on the floor
      const tube = new THREE.InstancedMesh(new THREE.BoxGeometry(1.55, 0.06, 0.22), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf2f6ff, emissiveIntensity: 4.5, toneMapped: false }), lights.length);
      const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(1.65, 0.07, 0.32), new THREE.MeshStandardMaterial({ color: 0x9a9da0, roughness: 0.5, metalness: 0.5 }), lights.length);
      const glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 128);
      const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(7, 7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        map: glowTex, color: 0xdfe8ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      }), lights.length);
      const halo = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.2, 3.2).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({
        map: glowTex, color: 0xeef3ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }), lights.length);
      lights.forEach((l, i) => {
        e.set(0, l.ang, 0); q.setFromEuler(e);
        m4.compose(p.set(l.x, l.g.ceiling - 0.075, -l.y), q, s); tube.setMatrixAt(i, m4);
        m4.compose(p.set(l.x, l.g.ceiling - 0.03, -l.y), q, s); housing.setMatrixAt(i, m4);
        m4.compose(p.set(l.x, l.g.floor + 0.02, -l.y), q, s); pool.setMatrixAt(i, m4);
        m4.compose(p.set(l.x, l.g.ceiling - 0.01, -l.y), q, s); halo.setMatrixAt(i, m4);
      });
      pool.renderOrder = 2; halo.renderOrder = 2;
      group.add(tube, housing, pool, halo);
    }
    const pipes = this.list.flatMap((g) => g.pipes.map(([[x0, y0], [x1, y1]]) => {
      const a = new THREE.Vector3(x0, g.ceiling - 0.22, -y0), b = new THREE.Vector3(x1, g.ceiling - 0.22, -y1);
      const len = a.distanceTo(b);
      const geo = new THREE.CylinderGeometry(0.06, 0.06, len, 10).rotateZ(Math.PI / 2);
      geo.rotateY(-Math.atan2(b.z - a.z, b.x - a.x));
      geo.translate((a.x + b.x) / 2, a.y, (a.z + b.z) / 2);
      return geo;
    }));
    add(pipes, new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.45, metalness: 0.3 }));
    if (signs.length) {
      const sm = new THREE.MeshStandardMaterial({ map: signTexture(), emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 });
      sm.emissiveMap = sm.map;
      for (const sg of signs) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), sm);
        m.position.set(sg.x, sg.g.ceiling - 0.3, -sg.y);
        // face into the car park (along the ramp's axis)
        m.rotation.y = Math.atan2(sg.axis[0], -sg.axis[1]);
        group.add(m);
      }
    }
    scene.add(group);
    this.group = group;
    return group;
  }
}
