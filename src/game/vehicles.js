import * as THREE from 'three';
import { pointInPoly, polyCentroid } from '../world/geom.js';

// Enterable vehicles: every parked car, a few motorbikes and personal drones.
//  F        get in / out (stand next to it)
//  WASD     drive / fly;  Space: handbrake (car, bike) or climb (drone);  C: descend (drone)
// Cars and bikes are driven from one high chase camera looking down on them, with your guns put
// away: you run the dead down instead. Inside a car nothing can touch you; on a bike only once you
// slow to a crawl. The drone is flown first-person and you can shoot from it.

// accel/brake in m/s², speeds in m/s; steer = most the front wheel turns (rad), steerRate = how fast
// it gets there (rad/s); grip = most sideways acceleration the tyres hold (m/s²): at speed that,
// not the wheel, limits how tight you can turn
const SPEC = {
  car: { accel: 4.2, brake: 10, reverse: 3, vmax: 20, vrev: 5.5, roll: 0.35, drag: 0.012, wheelbase: 2.7, steer: 0.5, steerRate: 1.2, grip: 7,
    circles: [-1.45, 0, 1.45], radius: 0.95, hw: 2.2, hd: 0.92, seat: [0.05, 1.12, -0.38], step: 0.45, exitSide: 1.6, mass: 1 },
  bike: { accel: 5.5, brake: 12, reverse: 1.5, vmax: 24, vrev: 2.5, roll: 0.3, drag: 0.01, wheelbase: 1.45, steer: 0.38, steerRate: 1.7, grip: 8.5,
    circles: [-0.6, 0.6], radius: 0.42, hw: 1.0, hd: 0.35, seat: [-0.15, 1.28, 0], step: 0.55, exitSide: 1.0, mass: 0.35 },
  drone: { accel: 10, vmax: 14, vUp: 6.5, radius: 1.35, hw: 1.3, hd: 1.3, seat: [0, 1.2, 0], ceiling: 90, exitSide: 1.8 },
};

// Which way a model's plate UVs run, read from the front plate's face: seen from in front of the
// car the text must run left to right (towards -Z, the car's left is +Z) and stand upright (with
// glTF UVs, v = 0 is the top of the image). Models differ, so the number is flipped to suit.
function plateFlip(car) {
  const p = new THREE.Vector3(), n = new THREE.Vector3(), pts = [];
  car.updateMatrixWorld(true);
  car.traverse((o) => {
    if (!o.isMesh || ![].concat(o.material).some((m) => /^plate$/i.test(m.name))) return;
    const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    if (!P || !N || !U) return;
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
      n.fromBufferAttribute(N, i).transformDirection(o.matrixWorld);
      if (p.x > 0 && n.x > 0.7) pts.push([p.z, p.y, U.getX(i), U.getY(i)]);
    }
  });
  if (pts.length < 3) return { u: false, v: false };
  const mean = (k) => pts.reduce((a, q) => a + q[k], 0) / pts.length;
  const cov = (a, b) => { const ma = mean(a), mb = mean(b); return pts.reduce((s, q) => s + (q[a] - ma) * (q[b] - mb), 0); };
  return { u: cov(2, 0) > 0, v: cov(3, 1) > 0 };
}

// the detailed cars: what the notice calls them, their plates and how they sound
const HEROES = {
  prius: { name: 'Toyota Prius, 2010', plate: 'QQ-939-QC', sound: 'hybrid' },
  corolla: { name: 'Toyota Corolla, 2023', plate: 'VV-186-RV', sound: 'car' },
  leaf: { name: 'Nissan Leaf security car', plate: 'GD-001-SC', sound: 'ev' },
};

function proceduralBike(color = 0xb3261e) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.2, metalness: 1 });
  const wheel = (x) => {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.085, 10, 24), black);
    w.position.set(x, 0.39, 0);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 12).rotateX(Math.PI / 2), chrome);
    hub.position.copy(w.position);
    g.add(w, hub);
    return w;
  };
  g.userData.wheels = [wheel(0.72), wheel(-0.72)];
  const add = (geo, m, x, y, z, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.z = rz; g.add(o); return o; };
  add(new THREE.BoxGeometry(0.62, 0.24, 0.3), paint, 0.12, 0.86, 0);            // tank
  add(new THREE.BoxGeometry(0.62, 0.1, 0.28), black, -0.32, 0.9, 0);            // seat
  add(new THREE.BoxGeometry(0.5, 0.26, 0.26), black, 0.02, 0.58, 0);            // engine
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.8), chrome, 0.62, 0.72, 0, -0.45); // forks
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.72).rotateX(Math.PI / 2), black, 0.5, 1.12, 0); // handlebar
  add(new THREE.CylinderGeometry(0.07, 0.06, 0.08, 12).rotateZ(Math.PI / 2), chrome, 0.66, 0.98, 0); // headlight
  add(new THREE.BoxGeometry(0.5, 0.05, 0.08), chrome, -0.45, 0.45, 0.14, 0.2);  // exhaust
  add(new THREE.BoxGeometry(0.34, 0.08, 0.22), paint, -0.62, 0.72, 0, 0.25);    // tail
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function proceduralDrone() {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.35, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x3fd07a, roughness: 0.4, emissive: 0x1d6b3d, emissiveIntensity: 0.4 });
  const blade = new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.5, transparent: true, opacity: 0.55 });
  const add = (geo, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; g.add(o); return o; };
  add(new THREE.CapsuleGeometry(0.42, 0.9, 6, 12).rotateZ(Math.PI / 2), shell, 0, 0.72, 0);    // pod
  add(new THREE.BoxGeometry(0.5, 0.08, 0.5), dark, -0.05, 0.98, 0);                            // seat
  add(new THREE.BoxGeometry(0.1, 0.45, 0.46), dark, -0.3, 1.2, 0);                             // backrest
  add(new THREE.BoxGeometry(1.4, 0.04, 0.06), accent, 0, 0.62, 0.43);                          // stripes
  add(new THREE.BoxGeometry(1.4, 0.04, 0.06), accent, 0, 0.62, -0.43);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(1.5, 0.05, 0.06), dark, 0, 0.1, s * 0.45); // skids
  for (const s of [-1, 1]) for (const t of [-0.45, 0.45]) add(new THREE.BoxGeometry(0.05, 0.5, 0.05), dark, t, 0.35, s * 0.45);
  const rotors = [];
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 1.3), dark);
    arm.position.set(x * 0.46, 0.85, z * 0.46);
    arm.rotation.y = Math.atan2(x, z);
    g.add(arm);
    const duct = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 28).rotateX(Math.PI / 2), shell);
    duct.position.set(x * 0.92, 0.88, z * 0.92);
    g.add(duct);
    const rotor = new THREE.Group();
    rotor.position.copy(duct.position);
    for (let k = 0; k < 2; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.012, 0.09), blade); b.rotation.y = k * Math.PI / 2; rotor.add(b); }
    g.add(rotor);
    rotors.push(rotor);
  }
  g.userData.rotors = rotors;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// A rider in a jacket, jeans and a full-face helmet, sitting on the bike (bike frame: +X forward,
// +Y up, metres, origin on the ground between the axles).
function proceduralRider() {
  const g = new THREE.Group();
  const M = (color, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const jacket = M(0x1d2733, 0.75), jeans = M(0x2f3e57, 0.9), boots = M(0x1b1510, 0.8), gloves = M(0x121212, 0.8);
  const helmet = M(0x1b1c1f, 0.28, 0.15), visor = M(0x0b0f14, 0.08, 0.9);
  const up = new THREE.Vector3(0, 1, 0);
  const limb = (a, b, r, mat) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 10), mat);
    m.position.copy(A).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(up, d.normalize());
    g.add(m);
    return m;
  };
  const torso = limb([-0.3, 0.98, 0], [0.0, 1.43, 0], 0.17, jacket);
  torso.scale.set(1, 1, 1.15);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 18, 14), helmet); head.position.set(0.06, 1.63, 0); g.add(head);
  const vis = new THREE.Mesh(new THREE.SphereGeometry(0.148, 18, 10, -0.9, 1.8, 1.05, 0.7), visor); vis.position.copy(head.position); vis.rotation.y = Math.PI / 2; g.add(vis);
  for (const sd of [-1, 1]) {
    const sh = [-0.03, 1.4, 0.19 * sd], el = [0.2, 1.2, 0.3 * sd], ha = [0.44, 1.09, 0.34 * sd];
    limb(sh, el, 0.056, jacket); limb(el, ha, 0.048, jacket);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), gloves); gl.position.set(...ha); g.add(gl);
    const hp = [-0.27, 0.93, 0.13 * sd], kn = [0.1, 0.9, 0.2 * sd], ft = [-0.03, 0.42, 0.21 * sd];
    limb(hp, kn, 0.085, jeans); limb(kn, ft, 0.064, jeans);
    const bt = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.1), boots); bt.position.set(ft[0] + 0.07, ft[1] - 0.03, ft[2]); g.add(bt);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export class Vehicles {
  constructor(game) {
    this.g = game;
    this.list = [];      // bikes, drones and any car that has been driven
    this.active = null;
    this.tmp = new THREE.Vector3();
    this.hud = document.getElementById('vhud');
    this.roofs = game.player.roofs;
  }

  setup(models) {
    const g = this.g;
    // parked car records come from the car lot (props.js)
    this.lot = g.props.cars;
    // bikes and drones on free spots near a few landmarks
    const anchors = {
      bike: [[60, -84], [128, 30], [-40, 60], [-120, 20]],
      drone: [[80, -94], [-10, -85], [30, -12]],
    };
    for (const [type, pts] of Object.entries(anchors)) {
      for (const [ax, ay] of pts) {
        const spot = this.freeSpot(ax, -ay, type === 'drone' ? 2.2 : 1.2);
        if (spot) this.spawnVehicle(type, spot.x, spot.z, this.openHeading(spot.x, spot.z), models);
      }
    }
    this.spawnHeroes(models);
  }

  // The detailed cars, each only if its model is there: the blue 2010 Prius in the first bay inside
  // Gate 1, the grey 2023 Corolla in the bay next to it, and the estate's light-blue Leaf security
  // car by the Gate 1 booth. Clear-coated paint, their own plates, wheels that spin and steer,
  // brake lights and headlights (and the security car's roof beacon).
  spawnHeroes(models) {
    const V = models.vehicles || {}, L = this.g.level;
    this.heroes = {};
    const gate = L.gates.find((q) => q.name === 'Gate 1') || L.gates[0];
    const bays = (x, y) => [...L.stalls].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    const first = bays(gate.x, gate.y)[0];
    if (!first) return;
    if (V.prius) this.spawnHero('prius', V.prius, first.x, -first.y, first.h + Math.PI);
    const next = bays(first.x, first.y).find((b) => b !== first && Math.abs(Math.sin(b.h - first.h)) < 0.2);
    if (V.corolla && next) this.spawnHero('corolla', V.corolla, next.x, -next.y, next.h + Math.PI);
    if (V.leaf) {
      // the security car noses out of the bay nearest the Gate 1 booth
      const booth = L.buildings.find((b) => b.group === 'guard' && polyCentroid(b.poly.outer)[1] < 0);
      const [bx, by] = booth ? polyCentroid(booth.poly.outer) : [gate.x, gate.y];
      const bay = bays(bx, by).find((b) => b !== first && b !== next);
      if (bay) this.spawnHero('leaf', V.leaf, bay.x, -bay.y, bay.h + Math.PI);
    }
  }

  spawnHero(kind, src, x, z, heading) {
    const g = this.g, spec = HEROES[kind];
    // whoever was parked there has gone
    for (const c of this.lot.cars) {
      if (!c.taken && Math.hypot(c.x - x, c.z - z) < 1.5) { c.taken = true; if (c.col) { c.col.walk = false; c.col.shoot = false; } }
    }
    const mesh = new THREE.Group();
    const car = src.clone(true);
    mesh.add(car);
    const lights = { head: [], tail: [], beacon: [] };
    const upgraded = new Map();
    car.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map((m) => {
        if (upgraded.has(m)) return upgraded.get(m);
        let n = m;
        if (/paint/i.test(m.name)) {
          // metallic paint under a clear coat, like the real thing
          n = m.isMeshPhysicalMaterial ? m.clone() : new THREE.MeshPhysicalMaterial({
            name: m.name, color: m.color, map: m.map, normalMap: m.normalMap, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05,
          });
          n.envMapIntensity = 1.25;
        } else if (/glass/i.test(m.name)) {
          n = m.clone(); n.transparent = true; n.opacity = Math.min(m.opacity ?? 1, 0.5); n.roughness = 0.04; n.metalness = 0.1; n.envMapIntensity = 1.6; n.depthWrite = false;
        } else if (/headlight/i.test(m.name)) {
          n = m.clone(); n.emissive = new THREE.Color(0xfff4e0); n.emissiveIntensity = 0; lights.head.push(n);
        } else if (/taillight|brake/i.test(m.name)) {
          n = m.clone(); n.emissive = new THREE.Color(0xff1a0a); n.emissiveIntensity = 0.15; lights.tail.push(n);
        } else if (/beacon/i.test(m.name)) {
          n = m.clone(); n.emissive = new THREE.Color(0xffa010); n.emissiveIntensity = 0.1; lights.beacon.push(n);
        } else if (/^plate$/i.test(m.name) && spec.plate) {
          n = m.clone(); n.map = this.plateTexture(spec.plate, plateFlip(car));
        } else if (/livery/i.test(m.name)) {
          // lettering on the body: cut out, not blended, and pulled forward so it never flickers
          n = m.clone(); n.transparent = false; n.alphaTest = 0.5; n.alphaToCoverage = true;
          n.polygonOffset = true; n.polygonOffsetFactor = -2; n.polygonOffsetUnits = -2;
        }
        upgraded.set(m, n);
        return n;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
      if (o.material.transparent) o.renderOrder = 1;
    });
    const wheels = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'].map((n) => car.getObjectByName(n)).filter(Boolean);
    for (const w of wheels) w.rotation.order = 'YXZ';
    let wheelR = 0.31;
    if (wheels[0]) { const b = new THREE.Box3().setFromObject(wheels[0]); wheelR = Math.max(0.2, (b.max.y - b.min.y) / 2); }
    g.scene.add(mesh);
    const v = this.makeRecord('car', mesh, x, z, heading, {
      hero: kind, wheels, front: wheels.filter((w) => /F[LR]$/.test(w.name)), wheelR, lights,
    });
    this.park(v);
    this.list.push(v);
    this.heroes[kind] = v;
    if (kind === 'prius') this.prius = v;
    return v;
  }

  plateTexture(number, flip = { u: false, v: false }) {
    const t = new THREE.TextureLoader().load(`assets/textures/plates/${number}.png`);
    t.flipY = false;                        // glTF UVs
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(flip.u ? -1 : 1, flip.v ? -1 : 1);
    t.offset.set(flip.u ? 1 : 0, flip.v ? 1 : 0);
    return t;
  }

  // spinning/steering wheels, brake lights and headlights of a detailed car
  animateHero(v, dt, input) {
    if (!v.hero) return;
    v.spin = (v.spin || 0) - (v.speed / v.wheelR) * dt;
    for (const w of v.wheels) w.rotation.z = v.spin;
    for (const w of v.front) w.rotation.y = v.steer;
    const braking = input && ((input.down('KeyS') && v.speed > 0.3) || (input.down('KeyW') && v.speed < -0.3) || input.down('Space'));
    const night = this.g.atmo.lampLevel > 0.4;
    for (const m of v.lights.tail) m.emissiveIntensity = braking ? 4 : this.active === v && night ? 1.2 : 0.15;
    for (const m of v.lights.head) m.emissiveIntensity = this.active === v && night ? 3 : 0;
  }

  // the security car's amber beacon turns while it's driven, and all night long
  flashBeacons(time) {
    const v = this.heroes && this.heroes.leaf;
    if (!v || !v.lights.beacon.length) return;
    const on = this.active === v || this.g.atmo.lampLevel > 0.4;
    const phase = (time * 1.6) % 1;
    const k = on ? (phase < 0.12 || (phase > 0.24 && phase < 0.36) ? 7 : 0.35) : 0.1;
    for (const m of v.lights.beacon) m.emissiveIntensity = k;
  }

  // park facing the longest clear run, so you can ride straight off
  openHeading(x, z) {
    const nav = this.g.nav;
    let best = 0, bestLen = -1;
    const a0 = Math.random() * Math.PI * 2;
    for (let k = 0; k < 16; k++) {
      const h = a0 + (k / 16) * Math.PI * 2, fx = Math.cos(h), fz = -Math.sin(h);
      let len = 0;
      while (len < 20 && nav.lineWalkable(x, z, x + fx * (len + 1), z + fz * (len + 1))) len++;
      if (len > bestLen) { bestLen = len; best = h; }
    }
    return best;
  }

  freeSpot(x, z, r) {
    const g = this.g;
    for (let k = 0; k < 60; k++) {
      const a = k * 2.4, d = k === 0 ? 0 : 1.5 + k * 0.25;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const p = { x: px, z: pz };
      const y = g.hm.atWorld(px, pz);
      if (y < -0.3) continue;
      if (g.player.roofAt(px, pz) > -1e9) continue;
      if (g.colliders.resolve(p, r, y + 0.05, y + 1.5, 1)) continue;
      if (!g.nav.walkable(px, pz)) continue;
      return { x: px, z: pz };
    }
    return null;
  }

  spawnVehicle(type, x, z, heading, models) {
    const g = this.g;
    const extra = models.vehicles || {};
    let mesh;
    let seat = null, wheelR = 0.39;
    if (extra[type]) {
      mesh = extra[type].clone(true);
      const u = mesh.userData;
      u.rotors = (u.rotorNames || []).map((n) => mesh.getObjectByName(n)).filter(Boolean);
      u.wheels = (u.wheelNames || []).map((n) => mesh.getObjectByName(n)).filter(Boolean);
      if (!u.rotors.length) delete u.rotors;
      if (!u.wheels.length) delete u.wheels;
      seat = u.seat || (type === 'bike' ? [-0.25, 1.5, 0] : null);
      wheelR = u.wheelR || wheelR;
    } else mesh = type === 'bike' ? proceduralBike([0xb3261e, 0x1f4fa8, 0x222222, 0xe0a100][this.list.length % 4]) : proceduralDrone();
    g.scene.add(mesh);
    let rider = null;
    if (type === 'bike') {
      const frame = extra.bike ? mesh.children[0] : mesh; // the model's own frame (before our centring)
      rider = extra.rider ? extra.rider.clone(true) : proceduralRider();
      rider.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      rider.visible = false;
      frame.add(rider);
    }
    const v = this.makeRecord(type, mesh, x, z, heading, { seat, wheelR, rider });
    this.park(v);
    this.list.push(v);
    return v;
  }

  makeRecord(type, mesh, x, z, heading, extra = {}) {
    const y = extra.y ?? this.g.hm.atWorld(x, z);
    return Object.assign({
      type, spec: SPEC[type], mesh, pos: new THREE.Vector3(x, y, z), heading, speed: 0, steer: 0,
      vel: new THREE.Vector3(), fwdSign: 1, col: null, tilt: new THREE.Vector2(), lean: 0,
    }, extra);
  }

  // A parked vehicle is a static obstacle (and something bullets hit).
  park(v) {
    const g = this.g, s = v.spec;
    if (v.col) { v.col.walk = false; v.col.shoot = false; }
    v.col = g.colliders.addBox(v.pos.x, v.pos.z, s.hw, s.hd, -v.heading, { height: v.pos.y + (v.type === 'bike' ? 1.1 : 1.45), minY: v.pos.y - 0.5, kind: v.type === 'drone' ? 'box' : 'car' });
    g.nav.refreshArea(g.colliders, v.pos.x - 3, v.pos.z - 3, v.pos.x + 3, v.pos.z + 3); g.unav?.refreshArea(g.colliders, v.pos.x - 3, v.pos.z - 3, v.pos.x + 3, v.pos.z + 3);
    this.place(v);
  }

  unpark(v) {
    if (v.col) { v.col.walk = false; v.col.shoot = false; }
    this.g.nav.refreshArea(this.g.colliders, v.pos.x - 3, v.pos.z - 3, v.pos.x + 3, v.pos.z + 3); this.g.unav?.refreshArea(this.g.colliders, v.pos.x - 3, v.pos.z - 3, v.pos.x + 3, v.pos.z + 3);
  }

  place(v) {
    v.mesh.position.copy(v.pos);
    v.mesh.rotation.set(0, v.heading, 0, 'YXZ');
    if (v.type !== 'drone') { v.mesh.rotation.z = v.tilt.x; v.mesh.rotation.x = v.tilt.y + (v.type === 'bike' ? v.lean : 0); }
    else { v.mesh.rotation.z = v.tilt.x; v.mesh.rotation.x = v.tilt.y; }
  }

  // The closest vehicle (or parked car) the player can get into.
  nearest() {
    const p = this.g.player.pos;
    let best = null, bd = 3.3;
    for (const v of this.list) {
      if (v === this.active) continue;
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      if (d < bd && Math.abs(v.pos.y - p.y) < 2) { bd = d; best = v; }
    }
    for (const c of this.lot.cars) {
      if (c.taken) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < bd && Math.abs(c.ground - p.y) < 2) { bd = d; best = c; }
    }
    return best;
  }

  // turn a parked instanced car into a drivable one
  claimCar(c) {
    const lot = this.lot;
    c.taken = true;
    if (c.col) { c.col.walk = false; c.col.shoot = false; }
    const fleet = lot.fleet;
    let mesh;
    if (fleet && fleet.length) {
      const model = fleet[c.v % fleet.length];
      mesh = new THREE.InstancedMesh(model.geometry, lot.mat, 1);
      mesh.setMatrixAt(0, new THREE.Matrix4());
      mesh.setColorAt(0, new THREE.Color(c.color).convertSRGBToLinear());
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      var fwdSign = model.name === 'car_van' ? -1 : 1;
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.4, 1.8).translate(0, 0.7, 0), new THREE.MeshStandardMaterial({ color: c.color }));
      fwdSign = 1;
    }
    this.g.scene.add(mesh);
    const v = this.makeRecord('car', mesh, c.x, c.z, c.h, { fwdSign, y: c.ground });
    this.list.push(v);
    this.g.nav.refreshArea(this.g.colliders, c.x - 3, c.z - 3, c.x + 3, c.z + 3); this.g.unav?.refreshArea(this.g.colliders, c.x - 3, c.z - 3, c.x + 3, c.z + 3);
    return v;
  }

  enter(target) {
    const g = this.g, p = g.player;
    const v = target.type ? target : this.claimCar(target);
    if (target.type) this.unpark(v);
    this.active = v;
    p.vehicle = v;
    // drone: you look where you fly, starting along its nose; cars and bikes: the chase camera
    p.yaw = v.type === 'drone' ? v.heading - Math.PI / 2 : 0;
    p.pitch = -0.05;
    p.vel.set(0, 0, 0);
    v.speed = 0; v.vel.set(0, 0, 0);
    g.weapons.adsToggle = false;
    this.camYaw = null; this.camPos = null; this.lookAt = null;
    if (v.rider) v.rider.visible = true;
    if (v.type !== 'drone') this.headlights(v, true);
    this.startEngine(v.hero ? HEROES[v.hero].sound : v.type);
    const name = v.hero ? HEROES[v.hero].name : v.type === 'bike' ? 'Motorbike' : 'Car';
    g.hud.notice(v.type === 'drone' ? 'Drone: WASD move, Space up, C down, F to get out' : `${name}: WASD drive, Space handbrake, F to get out`);
  }

  // the flashlight becomes the headlights while you drive (same light, so nothing recompiles)
  headlights(v, on) {
    const g = this.g, L = g.flashlight;
    if (!L) return;
    if (on) {
      const front = v.type === 'bike' ? 0.95 : 2.25 * (v.fwdSign < 0 ? -1 : 1);
      v.mesh.add(L, L.target);
      L.position.set(front, 0.8, 0);
      L.target.position.set(front + 14 * Math.sign(front), 0, 0);
      L.angle = 0.55; L.distance = 45;
    } else {
      g.camera.add(L, L.target);
      L.position.set(0.25, -0.2, 0);
      L.target.position.set(0, -0.6, -8);
      L.angle = 0.42; L.distance = 38;
    }
  }

  get hidesWeapons() { return !!this.active && this.active.type !== 'drone'; }

  exit() {
    const g = this.g, p = g.player, v = this.active;
    if (!v) return;
    const s = v.spec;
    // step out on the driver's side, else the other side, else behind
    const cos = Math.cos(v.heading), sin = Math.sin(v.heading);
    const fwd = { x: cos, z: -sin }, right = { x: sin, z: cos };
    const tries = [[-s.exitSide, 0], [s.exitSide, 0], [0, -(s.hw + 1)], [0, s.hw + 1]];
    let out = null;
    for (const [side, back] of tries) {
      const x = v.pos.x + right.x * side + fwd.x * back, z = v.pos.z + right.z * side + fwd.z * back;
      const probe = { x, z };
      const y = Math.max(g.groundAt(x, z, v.pos.y + 0.6), p.roofAt(x, z) <= v.pos.y + 0.6 ? p.roofAt(x, z) : -Infinity);
      if (!g.colliders.resolve(probe, 0.35, y + 0.3, y + 1.7, 1) && Math.abs(y - v.pos.y) < 1.2 || v.type === 'drone') { out = { x, z, y }; break; }
    }
    if (!out) { g.hud.notice('No room to get out here'); return; }
    this.active = null;
    p.vehicle = null;
    const exitYaw = v.type === 'drone' ? p.yaw : v.heading - Math.PI / 2 + (v.fwdSign < 0 ? Math.PI : 0) + p.yaw;
    p.pos.set(out.x, Math.max(out.y, v.type === 'drone' ? v.pos.y : out.y), out.z);
    p.viewY = p.pos.y;
    p.yaw = exitYaw;
    p.vel.set(0, 0, 0);
    p.onGround = false;
    v.speed = 0; v.vel.set(0, 0, 0);
    if (v.type === 'drone') this.settleDrone(v);
    if (v.rider) v.rider.visible = false;
    if (v.type !== 'drone') this.headlights(v, false);
    if (v.hero) { v.speed = 0; this.animateHero(v, 0, null); }
    this.park(v);
    this.stopEngine();
    g.weapons.ignoreItems = null;
  }

  settleDrone(v) {
    const g = this.g;
    const floor = Math.max(g.groundAt(v.pos.x, v.pos.z, v.pos.y + 0.3), this.roofBelow(v.pos.x, v.pos.z, v.pos.y));
    v.pos.y = floor; v.tilt.set(0, 0);
  }

  roofBelow(x, z, y) {
    const r = this.g.player.roofAt(x, z);
    return y >= r - 0.5 ? r : -Infinity;
  }

  update(dt, input, playing) {
    const g = this.g, p = g.player;
    // spin the parked drones' rotors down, idle bikes still
    for (const v of this.list) {
      if (v.type === 'drone' && v.mesh.userData.rotors) {
        v.rotorSpin = THREE.MathUtils.damp(v.rotorSpin || 0, v === this.active ? 40 : 0, 2, dt);
        v.mesh.userData.rotors.forEach((r, i) => { r.rotation.y += v.rotorSpin * dt * (/bottom/i.test(r.name) || i % 2 ? -1 : 1); });
      }
    }
    this.flashBeacons(this.g.time || 0);
    if (!playing) return;
    if (!this.active) {
      const near = !p.dead && this.nearest();
      if (near && !g.director.nearestStation() && !g.stairs?.near()) {
        const label = near.type === 'bike' ? 'ride the motorbike' : near.type === 'drone' ? 'fly the drone' : 'get in the car';
        g.hud.prompt(`Press <b>F</b> — ${label}`);
        if (input.hit('KeyF')) { this.enter(near); input.pressed.delete('KeyF'); }
      }
      this.hud.classList.remove('on');
      return;
    }
    const v = this.active;
    if (input.hit('KeyF')) { input.pressed.delete('KeyF'); this.exit(); return; }
    if (v.type === 'drone') this.flyDrone(v, dt, input); else this.drive(v, dt, input);
    this.animateHero(v, dt, input);
    this.place(v);
    this.runOver(v);
    this.seatPlayer(v, dt);
    g.weapons.ignoreItems = null;
    this.updateEngine(v);
    const kmh = Math.round(Math.abs(v.type === 'drone' ? Math.hypot(v.vel.x, v.vel.z) : v.speed) * 3.6);
    const alt = v.type === 'drone' ? ` · ${Math.max(0, v.pos.y - g.hm.atWorld(v.pos.x, v.pos.z)).toFixed(0)} m up` : '';
    this.hud.textContent = `${kmh} km/h${alt}`;
    this.hud.classList.add('on');
    g.hud.prompt(v.type === 'drone' ? 'Space up · C down · <b>F</b> get out' : 'Space handbrake · <b>F</b> get out');
  }

  // Bicycle-model driving with collision circles along the body. The wheel turns in at a limited
  // rate, and at speed the tyres' grip (not the wheel) sets how tight you can go; hitting something
  // at an angle slides you along it, head-on stops you.
  drive(v, dt, input) {
    const g = this.g, s = v.spec;
    const throttle = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const handbrake = input.down('Space');
    const v0 = v.speed;
    if (throttle > 0) {
      if (v.speed < -0.3) v.speed = Math.min(0, v.speed + s.brake * dt);
      else v.speed += s.accel * Math.pow(Math.max(0, 1 - v.speed / s.vmax), 0.6) * dt;
    } else if (throttle < 0) {
      if (v.speed > 0.3) v.speed = Math.max(0, v.speed - s.brake * dt);
      else v.speed = Math.max(-s.vrev, v.speed - s.reverse * dt);
    }
    // rolling resistance and air
    const coast = (s.roll + s.drag * v.speed * v.speed) * dt * (throttle ? 0.3 : 1);
    v.speed = Math.abs(v.speed) <= coast ? 0 : v.speed - Math.sign(v.speed) * coast;
    if (handbrake) v.speed *= Math.exp(-2.4 * dt);
    // steering: turn in at a limited rate, back to centre a bit quicker
    const spd = Math.abs(v.speed);
    const steerIn = (input.down('KeyA') ? 1 : 0) - (input.down('KeyD') ? 1 : 0);
    const gripLimit = Math.atan((s.grip * s.wheelbase) / Math.max(1, spd * spd));
    const target = steerIn * Math.min(s.steer, gripLimit);
    const rate = (steerIn === 0 || Math.sign(target) !== Math.sign(v.steer) ? 2.2 : 1) * s.steerRate * dt;
    v.steer += THREE.MathUtils.clamp(target - v.steer, -rate, rate);
    const yawRate = (v.speed / s.wheelbase) * Math.tan(v.steer) * (handbrake && spd > 5 ? 1.25 : 1);
    v.heading += yawRate * dt;
    v.yawRate = yawRate;
    const cos = Math.cos(v.heading), sin = Math.sin(v.heading);
    const fx = cos * v.fwdSign, fz = -sin * v.fwdSign;
    const nx = v.pos.x + fx * v.speed * dt, nz = v.pos.z + fz * v.speed * dt;
    const G = (x, z) => g.groundAt(x, z, v.pos.y + 0.6);
    // curbs and steps: too high blocks like a wall
    const dirS = Math.sign(v.speed || 1);
    const frontY = G(nx + fx * s.hw * dirS, nz + fz * s.hw * dirS);
    const blocked = frontY - v.pos.y > s.step;
    let pushX = 0, pushZ = 0, hits = 0;
    if (!blocked) {
      for (const off of s.circles) {
        const c = { x: nx + fx * off, z: nz + fz * off };
        const ox = c.x, oz = c.z;
        if (g.colliders.resolve(c, s.radius, v.pos.y + 0.12, v.pos.y + 1.4, 2)) { hits++; pushX += c.x - ox; pushZ += c.z - oz; }
      }
    }
    if (blocked) {
      if (spd > 4) this.bump(v, spd);
      v.speed = spd > 6 ? -v.speed * 0.1 : 0;
    } else if (hits) {
      // slide along what we hit: lose the part of the speed going into it
      const px = pushX / hits, pz = pushZ / hits, pl = Math.hypot(px, pz) || 1;
      const into = Math.abs((fx * px + fz * pz) / pl);   // 1 = head-on, 0 = scraping along
      if (spd * into > 3) this.bump(v, spd * into);
      v.speed *= Math.max(0, 1 - into * 1.1);
      if (into > 0.85 && spd > 6) v.speed = -Math.sign(v0) * spd * 0.12;
      v.pos.x = nx + px; v.pos.z = nz + pz;
    } else { v.pos.x = nx; v.pos.z = nz; }
    // ride the ground: pitch and roll from the terrain under the wheels, plus a little body
    // movement from braking/accelerating and cornering
    const hF = G(v.pos.x + fx * s.hw * 0.8, v.pos.z + fz * s.hw * 0.8), hB = G(v.pos.x - fx * s.hw * 0.8, v.pos.z - fz * s.hw * 0.8);
    const rx = -fz, rz = fx;
    const hL = G(v.pos.x - rx * s.hd, v.pos.z - rz * s.hd), hR = G(v.pos.x + rx * s.hd, v.pos.z + rz * s.hd);
    v.pos.y = THREE.MathUtils.damp(v.pos.y, Math.max(hF, hB, (hF + hB) / 2), 14, dt);
    const accel = (v.speed - v0) / Math.max(dt, 1e-3), lateral = v.speed * yawRate;
    const bodyPitch = v.type === 'car' ? THREE.MathUtils.clamp(-accel * 0.006, -0.035, 0.035) : 0;
    const bodyRoll = v.type === 'car' ? THREE.MathUtils.clamp(-lateral * 0.008, -0.05, 0.05) : 0;
    v.tilt.x = THREE.MathUtils.damp(v.tilt.x, Math.atan2(hF - hB, s.hw * 1.6) * v.fwdSign + bodyPitch * v.fwdSign, 8, dt);
    v.tilt.y = THREE.MathUtils.damp(v.tilt.y, Math.atan2(hR - hL, s.hd * 2) + bodyRoll, 6, dt);
    if (v.type === 'bike') {
      // lean into the turn as a real bike must: tan(lean) = v * yaw rate / g
      v.lean = THREE.MathUtils.damp(v.lean, -THREE.MathUtils.clamp(Math.atan(lateral / 9.81), -0.7, 0.7), 7, dt);
      if (v.mesh.userData.wheels) for (const w of v.mesh.userData.wheels) w.rotation.z -= (v.speed / (v.wheelR || 0.39)) * dt;
    }
    v.vel.set(fx * v.speed, 0, fz * v.speed);
  }

  bump(v, speed) {
    const g = this.g;
    g.audio.play('metal', { pos: v.pos, vol: Math.min(1, speed / 12) });
    g.player.shake = Math.min(1, g.player.shake + speed / 16);
  }

  // Personal drone: moves relative to where you look.
  flyDrone(v, dt, input) {
    const g = this.g, s = v.spec, p = g.player;
    const yaw = p.yaw;
    const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const r = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const u = (input.down('Space') ? 1 : 0) - (input.down('KeyC') || input.down('ShiftLeft') ? 1 : 0);
    const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw), rtX = Math.cos(yaw), rtZ = -Math.sin(yaw);
    const ax = (fwdX * f + rtX * r) * s.accel, az = (fwdZ * f + rtZ * r) * s.accel;
    v.vel.x += ax * dt; v.vel.z += az * dt;
    v.vel.y = THREE.MathUtils.damp(v.vel.y, u * s.vUp, 4, dt);
    const damp = Math.exp(-1.6 * dt);
    v.vel.x *= damp; v.vel.z *= damp;
    const hs = Math.hypot(v.vel.x, v.vel.z);
    if (hs > s.vmax) { v.vel.x *= s.vmax / hs; v.vel.z *= s.vmax / hs; }
    const next = { x: v.pos.x + v.vel.x * dt, z: v.pos.z + v.vel.z * dt };
    let ny = v.pos.y + v.vel.y * dt;
    // walls stop you below roof height; above the roofs you're free
    if (g.colliders.resolve(next, s.radius, ny + 0.1, ny + 1.9, 2)) { v.vel.x *= 0.3; v.vel.z *= 0.3; }
    const ground = g.groundAt(next.x, next.z, v.pos.y + 0.3);
    const floor = Math.max(ground, this.roofBelow(next.x, next.z, v.pos.y));
    if (ny < floor) { ny = floor; v.vel.y = Math.max(0, v.vel.y); }
    ny = Math.min(ny, ground + s.ceiling);
    const gar = g.underground.at(next.x, next.z, v.pos.y + 0.3);
    if (gar) { ny = Math.min(ny, gar.ceiling - 1.15); if (v.vel.y > 0 && ny >= gar.ceiling - 1.15) v.vel.y = 0; }
    v.pos.set(next.x, ny, next.z);
    let dh = ((yaw + Math.PI / 2 - v.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    v.heading += dh * (1 - Math.exp(-5 * dt));
    // tilt into the motion
    const lf = (v.vel.x * fwdX + v.vel.z * fwdZ) / s.vmax, lr = (v.vel.x * rtX + v.vel.z * rtZ) / s.vmax;
    v.tilt.set(THREE.MathUtils.damp(v.tilt.x, -lf * 0.25, 5, dt), THREE.MathUtils.damp(v.tilt.y, lr * 0.25, 5, dt));
  }

  // Cars and bikes knock zombies down; slow ones just shove them aside.
  runOver(v) {
    if (v.type === 'drone') return;
    const g = this.g, s = v.spec;
    const c = Math.cos(v.heading), sn = Math.sin(v.heading);
    const spd = Math.abs(v.speed);
    for (const zb of g.zombies.list) {
      if (zb.state === 'dead' || zb.state === 'climb' || zb.species === 'crow') continue;
      const dx = zb.pos.x - v.pos.x, dz = zb.pos.z - v.pos.z;
      if (Math.abs(dx) > 4 || Math.abs(dz) > 4 || Math.abs(zb.pos.y - v.pos.y) > 1.5) continue;
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c;   // into the vehicle's frame (x forward, z right)
      const ex = s.hw + 0.35, ez = s.hd + 0.35;
      if (Math.abs(lx) > ex || Math.abs(lz) > ez) continue;
      if (spd > 3) {
        const dmg = spd * spd * 3.2 * (v.type === 'bike' ? 0.6 : 1);
        const dir = new THREE.Vector3(v.vel.x, 0.3, v.vel.z).normalize();
        const hitPoint = zb.pos.clone(); hitPoint.y += 1;
        const killed = g.zombies.damage(zb, dmg, hitPoint, dir, false, 'vehicle');
        if (g.weapons.onHit) g.weapons.onHit(zb, killed, false);
        g.audio.play('flesh', { pos: zb.pos, vol: 1 });
        v.speed *= v.type === 'bike' ? 0.75 : 0.9;
        if (!killed) { zb.pos.x += v.vel.x * 0.12; zb.pos.z += v.vel.z * 0.12; zb.hitT = 0.8; }
        if (v.type === 'bike' && spd > 12) g.player.damage(5, zb.pos.x, zb.pos.z);
      } else {
        // push out of the body along the shallow axis
        const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
        let ox = 0, oz = 0;
        if (px < pz) ox = Math.sign(lx) * px; else oz = Math.sign(lz) * pz;
        zb.pos.x += ox * c + oz * sn;
        zb.pos.z += -ox * sn + oz * c;
      }
    }
  }

  // Put the player in the seat and the camera where it belongs.
  seatPlayer(v, dt) {
    const g = this.g, p = g.player, s = v.spec, cam = g.camera;
    v.mesh.updateMatrixWorld(true);
    const st = v.seat || s.seat;
    const seat = this.tmp.set(st[0], st[1], st[2]);
    if (v.fwdSign < 0) { seat.x = -seat.x; seat.z = -seat.z; }
    seat.applyMatrix4(v.mesh.matrixWorld);
    p.pos.set(seat.x, seat.y - 1.1, seat.z);
    p.viewY = p.pos.y;
    v.mesh.visible = true;
    if (v.type !== 'drone') {
      p.yaw = 0; p.pitch = 0;   // (you get out facing the way the vehicle points)
      this.topView(v, dt);
      return;
    }
    cam.rotation.order = 'YXZ';
    const sh = p.shake * p.shake, t = performance.now() / 1000;
    cam.position.copy(seat);
    cam.rotation.set(p.pitch + p.punch.x + (Math.sin(t * 40) * 0.004 * sh), p.yaw + p.punch.y, 0);
    const fov = p.fovBase * (1 - p.ads * (p.adsZoom ?? 0.22));
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = THREE.MathUtils.lerp(cam.fov, fov, 0.25); cam.updateProjectionMatrix(); }
  }

  // Cars and bikes: one camera, high behind the vehicle and looking down on it, swinging round
  // with the direction of travel and pulled in by walls (and kept under the car-park ceiling).
  topView(v, dt) {
    const g = this.g, cam = g.camera, bike = v.type === 'bike';
    const heading = v.heading + (v.fwdSign < 0 ? Math.PI : 0);
    if (this.camYaw == null) this.camYaw = heading;
    const d = ((heading - this.camYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.camYaw += d * (1 - Math.exp(-1.7 * dt));
    const spd = Math.abs(v.speed);
    let back = (bike ? 5 : 7) + spd * 0.12, up = (bike ? 8 : 10.5) + spd * 0.22;
    const fx = Math.cos(this.camYaw), fz = -Math.sin(this.camYaw);
    const ahead = 2 + spd * 0.2;
    const gar = g.underground.at(v.pos.x, v.pos.z, v.pos.y + 0.3);
    if (gar) { up = Math.min(up, gar.ceiling - v.pos.y - 0.45); back = Math.min(back, 5.5); }
    const ox = v.pos.x, oy = v.pos.y + 1.4, oz = v.pos.z;
    let cx = ox - fx * back, cy = v.pos.y + up, cz = oz - fz * back;
    // keep a clear line from the vehicle up to the camera
    const dx = cx - ox, dy = cy - oy, dz = cz - oz, len = Math.hypot(dx, dy, dz) || 1;
    const hit = g.colliders.raycast(ox, oy, oz, dx / len, dy / len, dz / len, len, (it) => it.kind === 'building' || it.kind === 'wall');
    if (hit) { const k = Math.max(0.12, (hit.t - 0.4) / len); cx = ox + dx * k; cy = oy + dy * k; cz = oz + dz * k; }
    this.camTarget = (this.camTarget || new THREE.Vector3()).set(cx, cy, cz);
    if (!this.camPos) this.camPos = this.camTarget.clone();
    else this.camPos.lerp(this.camTarget, 1 - Math.exp(-(hit ? 20 : 6) * dt));
    cam.position.copy(this.camPos);
    const sh = g.player.shake;
    if (sh > 0.01) { const t = performance.now() / 1000; cam.position.x += Math.sin(t * 47) * 0.06 * sh; cam.position.y += Math.cos(t * 53) * 0.06 * sh; }
    const look = (this.lookTarget || (this.lookTarget = new THREE.Vector3())).set(ox + fx * ahead, v.pos.y + 0.6, oz + fz * ahead);
    if (!this.lookAt) this.lookAt = look.clone(); else this.lookAt.lerp(look, 1 - Math.exp(-8 * dt));
    cam.up.set(0, 1, 0);
    cam.lookAt(this.lookAt);
    if (Math.abs(cam.fov - 60) > 0.01) { cam.fov = THREE.MathUtils.lerp(cam.fov, 60, 0.2); cam.updateProjectionMatrix(); }
  }

  // --- engine sound (synthesised) ---
  startEngine(type) {
    const a = this.g.audio;
    if (!a.ctx) return;
    const c = a.ctx;
    if (type === 'hybrid' || type === 'ev') {
      const gain = c.createGain(); gain.gain.value = 0;
      const whine = c.createOscillator(); whine.type = 'sine'; whine.frequency.value = 180;
      const wg = c.createGain(); wg.gain.value = 0.25;
      const ice = c.createOscillator(); ice.type = 'sawtooth'; ice.frequency.value = 40;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const ig = c.createGain(); ig.gain.value = 0;
      whine.connect(wg).connect(gain); ice.connect(lp).connect(ig).connect(gain);
      gain.connect(a.master);
      whine.start(); ice.start();
      gain.gain.setTargetAtTime(type === 'ev' ? 0.06 : 0.08, c.currentTime, 0.3);
      this.engine = { gain, oscs: [{ o: whine, m: 1 }, { o: ice, m: 1 }], type, whine, ice, ig };
      return;
    }
    const gain = c.createGain(); gain.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = type === 'drone' ? 1800 : 700;
    const oscs = (type === 'drone' ? [1, 1.013, 0.987, 1.5] : [1, 0.5, 1.01]).map((m) => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 50 * m; o.connect(lp); o.start(); return { o, m };
    });
    lp.connect(gain).connect(a.master);
    gain.gain.setTargetAtTime(type === 'drone' ? 0.07 : 0.09, c.currentTime, 0.3);
    this.engine = { gain, oscs, type };
  }

  updateEngine(v) {
    const e = this.engine;
    if (!e) return;
    const c = this.g.audio.ctx;
    if (e.type === 'hybrid' || e.type === 'ev') {
      // electric whine; the Prius's petrol engine joins in above 40 km/h
      const spd = Math.abs(v.speed);
      e.whine.frequency.setTargetAtTime(160 + spd * 38, c.currentTime, 0.1);
      e.ice.frequency.setTargetAtTime(38 + spd * 3.5, c.currentTime, 0.2);
      e.ig.gain.setTargetAtTime(e.type === 'hybrid' && spd > 11 ? 0.9 : 0, c.currentTime, 0.4);
      return;
    }
    const load = v.type === 'drone' ? 0.6 + Math.hypot(v.vel.x, v.vel.z, v.vel.y) / 12 : Math.abs(v.speed) / v.spec.vmax;
    const base = v.type === 'drone' ? 120 + load * 60 : v.type === 'bike' ? 55 + load * 160 : 38 + load * 90;
    for (const { o, m } of e.oscs) o.frequency.setTargetAtTime(base * m, c.currentTime, 0.08);
  }

  stopEngine() {
    const e = this.engine;
    if (!e) return;
    const c = this.g.audio.ctx;
    e.gain.gain.setTargetAtTime(0, c.currentTime, 0.15);
    setTimeout(() => e.oscs.forEach(({ o }) => o.stop()), 800);
    this.engine = null;
  }
}
