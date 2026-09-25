import * as THREE from 'three';
import { pointInPoly, polyCentroid } from '../world/geom.js';
import { Crashes } from './crash.js';

// Enterable vehicles: every parked car, a few motorbikes and personal drones.
//  F        get in / out (stand next to it)
//  WASD     drive / fly;  Space: handbrake (car, bike) or climb (drone);  C: descend (drone)
// Cars and bikes are driven from one high chase camera looking down on them, with your guns put
// away: you run the dead down instead. Inside a car nothing can touch you; on a bike only once you
// slow to a crawl. The drone is flown first-person and you can shoot from it.
// Co-op: the host decides who sits where (enter/exit go through it) and drives every vehicle from
// its driver's inputs; a client predicts its own vehicle the same way it predicts walking.

// accel/brake in m/s², speeds in m/s; steer = most the front wheel turns (rad), steerRate = how fast
// it gets there (rad/s); grip = most sideways acceleration the tyres hold (m/s²): at speed that,
// not the wheel, limits how tight you can turn
// Crashes: latGrip = how hard sliding tyres pull the sideways speed down (m/s²); spinFric and
// spinDamp = how the tyres scrub away a spin (rad/s² and 1/s); inertia = the body's turning
// inertia per unit mass (m², ~ (length² + width²) / 12); bounce = restitution against walls (the
// crumple zone eats the rest); wallFric = how much a wall grabs a car sliding along it.
const SPEC = {
  car: { accel: 4.2, brake: 10, reverse: 3, vmax: 20, vrev: 5.5, roll: 0.35, drag: 0.012, wheelbase: 2.7, steer: 0.5, steerRate: 1.2, grip: 7,
    circles: [-1.45, 0, 1.45], radius: 0.95, hw: 2.2, hd: 0.92, seat: [0.05, 1.12, -0.38], step: 0.45, exitSide: 1.6, mass: 1,
    latGrip: 8.5, spinFric: 2.4, spinDamp: 0.8, inertia: 1.9, bounce: 0.28, wallFric: 0.45 },
  bike: { accel: 5.5, brake: 12, reverse: 1.5, vmax: 24, vrev: 2.5, roll: 0.3, drag: 0.01, wheelbase: 1.45, steer: 0.38, steerRate: 1.7, grip: 8.5,
    circles: [-0.6, 0.6], radius: 0.42, hw: 1.0, hd: 0.35, seat: [-0.15, 1.28, 0], step: 0.55, exitSide: 1.0, mass: 0.35,
    latGrip: 7.5, spinFric: 4.5, spinDamp: 1.6, inertia: 0.35, bounce: 0.32, wallFric: 0.5 },
  drone: { accel: 10, vmax: 14, vUp: 6.5, radius: 1.35, hw: 1.3, hd: 1.3, seat: [0, 1.2, 0], ceiling: 90, exitSide: 1.8 },
};
// the Lamborghini: twice the shove, far more top end, sticky tyres and big brakes, low and wide
SPEC.supercar = { ...SPEC.car, accel: 9, brake: 14, vmax: 36, grip: 9.5, latGrip: 11, steerRate: 1.5, hd: 0.98, seat: [0.1, 0.92, -0.4], step: 0.35, spinFric: 3 };

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
  prius: { name: 'Toyota Prius, 2010 (თათიას მანქანა)', plate: 'TATIA', sound: 'hybrid' },
  corolla: { name: 'Toyota Corolla, 2023', plate: 'VV-186-RV', sound: 'car' },
  leaf: { name: 'Nissan Leaf security car (დაცვა)', plate: 'DATSVA', sound: 'ev', livery: 'leaf_datsva' },
  civic: { name: 'Honda Civic, 2018 (ბექას მანქანა)', plate: 'BEKA', sound: 'car' },
  lambo: { name: 'Lamborghini', plate: 'LA-777-MB', sound: 'v10', spec: 'supercar' },
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
    this.active = null;  // the one we're in
    this.nextVid = 0;    // network ids: in spawn order (the same everywhere); lot cars 1000 + index
    this.tmp = new THREE.Vector3();
    this.hud = document.getElementById('vhud');
    this.roofs = game.player.roofs;
    this.crash = new Crashes(game);
    this.kick = new THREE.Vector3();       // the chase camera's jolt after a crash
    this.kickVel = new THREE.Vector3();
  }

  setup(models) {
    const g = this.g;
    this.models = models;
    // parked car records come from the car lot (props.js)
    this.lot = g.props.cars;
    for (const c of this.lot.cars) if (c.col) c.col.lotCar = c;
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
    // (each in a bay of its own: the free one nearest a point, lined up with `like` if given)
    const used = new Set();
    const free = (x, y, like = null) => bays(x, y).find((b) => !used.has(b) && (!like || Math.abs(Math.sin(b.h - like.h)) < 0.2));
    const put = (kind, bay) => { if (!V[kind] || !bay) return; used.add(bay); this.spawnHero(kind, V[kind], bay.x, -bay.y, bay.h + Math.PI); };
    put('prius', first);
    used.add(first);
    // the Corolla and Beka's Civic in the bays along from the Prius
    put('corolla', free(first.x, first.y, first));
    put('civic', free(first.x, first.y, first));
    // the Lamborghini in the bay nearest the start, by the pool
    put('lambo', free(4, -10));
    // the security car noses out of the bay nearest the Gate 1 booth
    const booth = L.buildings.find((b) => b.group === 'guard' && polyCentroid(b.poly.outer)[1] < 0);
    const [bx, by] = booth ? polyCentroid(booth.poly.outer) : [gate.x, gate.y];
    put('leaf', free(bx, by));
  }

  spawnHero(kind, src, x, z, heading) {
    const g = this.g;
    // whoever was parked there has gone
    for (const c of this.lot.cars) {
      if (!c.taken && Math.hypot(c.x - x, c.z - z) < 1.5) { c.taken = true; if (c.col) { c.col.walk = false; c.col.shoot = false; } }
    }
    const h = this.heroMesh(kind, src);
    g.scene.add(h.mesh);
    const v = this.makeRecord('car', h.mesh, x, z, heading, {
      hero: kind, wheels: h.wheels, front: h.front, wheelR: h.wheelR, lights: h.lights, vid: this.nextVid++, paint: h.paint,
      ...(HEROES[kind].spec ? { spec: SPEC[HEROES[kind].spec] } : {}),
    });
    this.park(v);
    this.list.push(v);
    this.heroes[kind] = v;
    if (kind === 'prius') this.prius = v;
    return v;
  }

  // One detailed car, ready to drive: clear-coated paint, glass, lamps that light, its plates,
  // wheels that turn. (Also how a wrecked one is put back together for a new match.)
  heroMesh(kind, src) {
    const spec = HEROES[kind];
    const mesh = new THREE.Group();
    const car = src.clone(true);
    mesh.add(car);
    const lights = { head: [], tail: [], beacon: [] };
    const upgraded = new Map();
    car.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      o.geometry.userData.shared = true;   // (the model's: never disposed with a piece that came off)
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
        } else if (/beaconlight/i.test(m.name)) {
          n = m.clone(); n.emissive = new THREE.Color(0xff5a00); n.emissiveIntensity = 0.1; lights.beacon.push(n);
        } else if (/^plate$/i.test(m.name) && spec.plate) {
          n = m.clone(); n.map = this.plateTexture(spec.plate, plateFlip(car));
        } else if (/livery/i.test(m.name)) {
          // lettering on the body: cut out, not blended, and pulled forward so it never flickers
          n = m.clone(); n.transparent = false; n.alphaTest = 0.5; n.alphaToCoverage = true;
          n.polygonOffset = true; n.polygonOffsetFactor = -2; n.polygonOffsetUnits = -2;
          // (a car with lettering of its own, drawn to the model's decal layout)
          if (spec.livery && m.map) n.map = this.liveryTexture(spec.livery, m.map);
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
    const paint = [...upgraded.values()].find((m) => /paint/i.test(m.name || ''));
    return { mesh, lights, wheels, front: wheels.filter((w) => /F[LR]$/.test(w.name)), wheelR, paint: paint ? paint.color.getHex() : 0x8a8f96 };
  }

  // a car's lettering from a file, laid on the decal UVs like the texture it replaces
  liveryTexture(name, like) {
    const t = new THREE.TextureLoader().load(`assets/textures/liveries/${name}.png`);
    t.flipY = like.flipY; t.wrapS = like.wrapS; t.wrapT = like.wrapT; t.colorSpace = like.colorSpace;
    t.repeat.copy(like.repeat); t.offset.copy(like.offset); t.anisotropy = 8;
    return t;
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
    v.wheelTurn = (v.wheelTurn || 0) - (v.speed / v.wheelR) * dt;   // (how far round the wheels have gone)
    for (const w of v.wheels) w.rotation.z = v.wheelTurn;
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
    const k = on ? (phase < 0.12 || (phase > 0.24 && phase < 0.36) ? 3.2 : 0.3) : 0.1;
    for (const m of v.lights.beacon) m.emissiveIntensity = k;
  }

  // park facing the longest clear run, so you can ride straight off
  openHeading(x, z) {
    const nav = this.g.nav;
    let best = 0, bestLen = -1;
    const a0 = ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1 * Math.PI * 2;   // (the same on every screen)
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
    const v = this.makeRecord(type, mesh, x, z, heading, { seat, wheelR, rider, vid: this.nextVid++, paint: type === 'bike' ? 0x2a2d31 : 0xe9ebee });
    this.park(v);
    this.list.push(v);
    return v;
  }

  makeRecord(type, mesh, x, z, heading, extra = {}) {
    const y = extra.y ?? this.g.hm.atWorld(x, z);
    return Object.assign({
      type, spec: SPEC[type], mesh, pos: new THREE.Vector3(x, y, z), heading, speed: 0, steer: 0,
      vel: new THREE.Vector3(), fwdSign: 1, col: null, tilt: new THREE.Vector2(), lean: 0,
      driver: null, who: null, smooth: new THREE.Vector3(),
      slip: 0, spin: 0,                     // sliding sideways (m/s) and turning on its own (rad/s)
      dmg: 0, lost: new Set(), hp: {},      // damage 0..100 (100: the engine's dead), parts gone, parts' strength left
      fallen: false, coasting: false,       // a bike on its side; rolling on with nobody at the controls
    }, extra);
  }

  // A parked vehicle is a static obstacle (and something bullets hit).
  park(v) {
    const g = this.g, s = v.spec;
    if (v.col) { v.col.walk = false; v.col.shoot = false; }
    v.col = g.colliders.addBox(v.pos.x, v.pos.z, s.hw, s.hd, -v.heading, { height: v.pos.y + (v.type === 'bike' ? 1.1 : 1.45), minY: v.pos.y - 0.5, kind: v.type === 'drone' ? 'box' : 'car' });
    v.col.vehicle = v;   // (so a bullet that hits it knows what it hit)
    g.nav.refreshArea(g.colliders, v.pos.x - 3, v.pos.z - 3, v.pos.x + 3, v.pos.z + 3); g.unav?.refreshArea(g.colliders, v.pos.x - 3, v.pos.z - 3, v.pos.x + 3, v.pos.z + 3);
    this.place(v);
  }

  unpark(v) {
    if (v.col) { v.col.walk = false; v.col.shoot = false; }
    this.g.nav.refreshArea(this.g.colliders, v.pos.x - 3, v.pos.z - 3, v.pos.x + 3, v.pos.z + 3); this.g.unav?.refreshArea(this.g.colliders, v.pos.x - 3, v.pos.z - 3, v.pos.x + 3, v.pos.z + 3);
  }

  place(v) {
    v.mesh.position.copy(v.pos).add(v.smooth);
    v.mesh.rotation.set(0, v.heading, 0, 'YXZ');
    if (v.type !== 'drone') { v.mesh.rotation.z = v.tilt.x; v.mesh.rotation.x = v.tilt.y + (v.type === 'bike' ? v.lean : 0); }
    else { v.mesh.rotation.z = v.tilt.x; v.mesh.rotation.x = v.tilt.y; }
    // zombies clawing at it: it shudders on its springs
    if (v.rock > 0.002) { const t = performance.now() / 1000; v.mesh.rotation.x += v.rock * Math.sin(t * 31); v.mesh.rotation.z += v.rock * 0.5 * Math.sin(t * 23); }
  }

  // The closest vehicle (or parked car) the player can get into.
  nearest() {
    const p = this.g.player.pos;
    let best = null, bd = 3.3;
    for (const v of this.list) {
      if (v === this.active || v.driver != null || v.coasting) continue;
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
    // (a group: a crash may cut bumpers and wheels off into pieces of their own)
    const mesh = new THREE.Group();
    let fwdSign = 1;
    if (fleet && fleet.length) {
      const model = fleet[c.v % fleet.length];
      model.geometry.userData.shared = true;
      const body = new THREE.InstancedMesh(model.geometry, lot.mat, 1);
      body.setMatrixAt(0, new THREE.Matrix4());
      body.setColorAt(0, new THREE.Color(c.color).convertSRGBToLinear());
      body.castShadow = body.receiveShadow = true;
      body.frustumCulled = false;
      mesh.add(body);
      fwdSign = model.name === 'car_van' ? -1 : 1;
    } else {
      mesh.add(new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.4, 1.8).translate(0, 0.7, 0), new THREE.MeshStandardMaterial({ color: c.color })));
    }
    this.g.scene.add(mesh);
    const v = this.makeRecord('car', mesh, c.x, c.z, c.h, { fwdSign, y: c.ground, vid: 1000 + lot.cars.indexOf(c), paint: c.color, lotCar: c });
    this.list.push(v);
    // parked where it stood, with a collider of its own (bullets and zombies still meet it)
    this.park(v);
    return v;
  }

  // a vehicle by network id (a lot car becomes drivable the first time it's asked for)
  byVid(vid) {
    const v = this.list.find((q) => q.vid === vid);
    if (v || vid < 1000) return v || null;
    const c = this.lot.cars[vid - 1000];
    return c ? this.claimCar(c) : null;
  }

  vidOf(target) { return target.type ? target.vid : 1000 + this.lot.cars.indexOf(target); }

  // Someone takes the wheel: the local player, or (on a co-op host) a client's player.
  occupy(target, p, slot) {
    const v = target.type ? target : this.claimCar(target);
    this.unpark(v);
    v.driver = slot; v.who = p; v.moved = true;
    p.vehicle = v;
    // a fallen bike is picked up again
    if (v.fallen) { v.fallen = false; v.lean = 0; }
    v.coasting = false; v.slip = 0; v.spin = 0;
    p.vel.set(0, 0, 0);
    v.speed = 0; v.vel.set(0, 0, 0); v.steer = 0;
    if (v.rider) v.rider.visible = true;
    return v;
  }

  enter(target) {
    const g = this.g;
    const v = this.occupy(target, g.player, g.localSlot ?? 0);
    this.takeControls(v);
    g.net?.vehicleTaken?.(v);
  }

  // our side of getting in: camera, lights, engine
  takeControls(v) {
    const g = this.g, p = g.player;
    this.active = v;
    // drone: you look where you fly, starting along its nose; cars and bikes: the chase camera
    p.yaw = v.type === 'drone' ? v.heading - Math.PI / 2 : 0;
    p.pitch = -0.05;
    g.weapons.adsToggle = false;
    this.camYaw = null; this.camPos = null; this.lookAt = null;
    if (v.type !== 'drone') this.headlights(v, true);
    this.startEngine(v.hero ? HEROES[v.hero].sound : v.type);
    const name = v.hero ? HEROES[v.hero].name : v.type === 'bike' ? 'Motorbike' : 'Car';
    g.hud.notice(v.type === 'drone' ? 'Drone: WASD move, Space up, Ctrl down, F to get out' : `${name}: WASD drive, Space handbrake, F to get out`);
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

  // where the driver can step out: their side, else the other side, else behind (null: no room)
  exitSpot(v, p) {
    const g = this.g, s = v.spec;
    const cos = Math.cos(v.heading), sin = Math.sin(v.heading);
    const fwd = { x: cos, z: -sin }, right = { x: sin, z: cos };
    const tries = [[-s.exitSide, 0], [s.exitSide, 0], [0, -(s.hw + 1)], [0, s.hw + 1]];
    for (const [side, back] of tries) {
      const x = v.pos.x + right.x * side + fwd.x * back, z = v.pos.z + right.z * side + fwd.z * back;
      const probe = { x, z };
      const y = Math.max(g.groundAt(x, z, v.pos.y + 0.6), p.roofAt(x, z) <= v.pos.y + 0.6 ? p.roofAt(x, z) : -Infinity);
      if (!g.colliders.resolve(probe, 0.35, y + 0.3, y + 1.7, 1) && Math.abs(y - v.pos.y) < 1.2 || v.type === 'drone') {
        return { x, z, y: Math.max(y, v.type === 'drone' ? v.pos.y : y), yaw: v.type === 'drone' ? p.yaw : v.heading - Math.PI / 2 + (v.fwdSign < 0 ? Math.PI : 0) + p.yaw };
      }
    }
    return null;
  }

  // The driver gets out at spot; the vehicle parks where it stands.
  release(v, p, spot, park = true) {
    p.vehicle = null;
    v.driver = null; v.who = null;
    if (spot) {
      p.pos.set(spot.x, spot.y, spot.z);
      p.viewY = p.pos.y;
      if (spot.yaw != null) p.yaw = spot.yaw;
    }
    p.vel.set(0, 0, 0);
    p.onGround = false;
    v.speed = 0; v.vel.set(0, 0, 0); v.smooth.set(0, 0, 0);
    if (v.type === 'drone') this.settleDrone(v);
    if (v.rider) v.rider.visible = false;
    if (v.hero) this.animateHero(v, 0, null);
    if (park) this.park(v);
  }

  exit() {
    const g = this.g, p = g.player, v = this.active;
    if (!v) return;
    const spot = this.exitSpot(v, p);
    if (!spot) { g.hud.notice('No room to get out here'); return; }
    this.dropControls(v);
    this.release(v, p, spot);
    g.net?.vehicleLeft?.(v, null);
  }

  // our side of getting out
  dropControls(v) {
    if (this.active !== v) return;
    this.active = null;
    if (v.type !== 'drone') this.headlights(v, false);
    this.stopEngine();
    this.g.weapons.ignoreItems = null;
  }

  // everyone out and parked (a new match)
  clearDrivers() {
    for (const v of this.list) {
      if (v.driver == null) continue;
      if (v === this.active) this.dropControls(v);
      const who = v.who;
      if (who) who.vehicle = null;
      this.release(v, who || { vel: new THREE.Vector3(), pos: new THREE.Vector3() }, null);
    }
  }

  // One tick of driving for whoever's in it (the host for everyone, a client for itself):
  // the physics, the wheels, where the driver sits; the host (or solo) also runs zombies over.
  driveTick(v, dt, input) {
    if (v.type === 'drone') this.flyDrone(v, dt, input); else this.drive(v, dt, input);
    this.animateHero(v, dt, input);
    this.place(v);
    if (this.g.mode !== 'client') this.runOver(v);
    if (v.who) this.seat(v, v.who);
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
        v.rotorSpin = THREE.MathUtils.damp(v.rotorSpin || 0, v === this.active || v.driver != null ? 40 : 0, 2, dt);
        v.mesh.userData.rotors.forEach((r, i) => { r.rotation.y += v.rotorSpin * dt * (/bottom/i.test(r.name) || i % 2 ? -1 : 1); });
      }
    }
    this.flashBeacons(this.g.time || 0);
    this.crash.update(dt);
    this.smoke(dt);
    // bullets that hit vehicles this last moment, applied (where the world is simulated for real)
    const now = g.time || performance.now() / 1000;
    for (const v of this.list) if (v.shots && v.shots.n && now - v.shots.t > 0.15) this.flushShots(v);
    // (the fallen bike sliding on: moved where the world is simulated for real)
    if (g.mode !== 'client') for (const v of this.list) if (v.coasting) this.coastTick(v, dt);
    for (const v of this.list) if (v.rock) { v.rock *= Math.exp(-5 * dt); if (v.rock < 0.002) { v.rock = 0; if (v.driver == null && !v.coasting) this.place(v); } }
    this.kickVel.addScaledVector(this.kick, -90 * dt).multiplyScalar(Math.exp(-9 * dt));
    this.kick.addScaledVector(this.kickVel, dt);
    if (!playing) return;
    const client = g.mode === 'client';
    if (!this.active) {
      const near = !p.dead && this.nearest();
      if (near && !g.director.nearestStation() && !g.stairs?.near()) {
        const label = near.type === 'bike' ? 'ride the motorbike' : near.type === 'drone' ? 'fly the drone' : 'get in the car';
        g.hud.prompt(`Press <b>F</b> — ${label}`);
        if (input.hit('KeyF')) {
          input.pressed.delete('KeyF');
          // (co-op client: the host says who gets it)
          if (client) g.net.enterVehicle(this.vidOf(near)); else this.enter(near);
        }
      }
      this.hud.classList.remove('on');
      return;
    }
    const v = this.active;
    if (input.hit('KeyF')) { input.pressed.delete('KeyF'); if (client) g.net.exitVehicle(); else this.exit(); return; }
    // (a co-op client drives in its input ticks, predicted; here it only looks after the view)
    if (!client) {
      if (v.type === 'drone') this.flyDrone(v, dt, input); else this.drive(v, dt, input);
      this.runOver(v);
    }
    v.smooth.multiplyScalar(Math.exp(-dt * 10));
    this.animateHero(v, dt, input);
    this.place(v);
    this.seatPlayer(v, dt);
    g.weapons.ignoreItems = null;
    this.updateEngine(v);
    const kmh = Math.round(Math.abs(v.type === 'drone' ? Math.hypot(v.vel.x, v.vel.z) : v.speed) * 3.6);
    const alt = v.type === 'drone' ? ` · ${Math.max(0, v.pos.y - g.hm.atWorld(v.pos.x, v.pos.z)).toFixed(0)} m up` : '';
    this.hud.textContent = `${kmh} km/h${alt}`;
    this.hud.classList.add('on');
    g.hud.prompt(v.type === 'drone' ? 'Space up · Ctrl down · <b>F</b> get out' : 'Space handbrake · <b>F</b> get out');
  }

  // Driving. What the tyres hold is a bicycle model: the front wheel sets how the car turns, and at
  // speed their grip (not the wheel) limits how tight. What they can't hold is two more motions:
  // sliding sideways (slip, m/s) and turning on its own (spin, rad/s). A spin keeps the car's
  // momentum going the old way while the body turns, and sliding tyres pull both down with
  // friction until they bite again, so a spin-out slides on, slows and snaps straight - not the
  // steady slowing of a linear fade. Collisions are impulses at the point of contact, with the
  // body's turning inertia: a car hit at a corner spins, glances off a wall at an angle, bounces
  // back a little from one head-on, and scrapes along one it slides into.
  drive(v, dt, input) {
    const g = this.g, s = v.spec, bike = v.type === 'bike';
    const lost = v.lost, gone = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'].map((w) => lost.has(w));
    const wheelsGone = gone.filter(Boolean).length;
    const dead = v.dmg >= 100 || v.fallen;
    const throttle = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const handbrake = input.down('Space');
    const power = dead ? 0 : (1 - v.dmg / 250) * (wheelsGone ? 0.45 : 1);
    const vmax = s.vmax * (wheelsGone ? 0.5 : 1) * (1 - v.dmg / 400);
    const v0 = v.speed;
    if (throttle > 0) {
      if (v.speed < -0.3) v.speed = Math.min(0, v.speed + s.brake * dt);
      else if (power > 0) v.speed += s.accel * power * Math.pow(Math.max(0, 1 - v.speed / vmax), 0.6) * dt;
    } else if (throttle < 0) {
      if (v.speed > 0.3) v.speed = Math.max(0, v.speed - s.brake * dt);
      else if (power > 0) v.speed = Math.max(-s.vrev, v.speed - s.reverse * power * dt);
    }
    // rolling resistance and air (a corner on its rim drags)
    // (a bike on its side is metal and plastic sliding on asphalt: it stops quickly)
    const coast = (s.roll * (1 + wheelsGone * 5) + s.drag * v.speed * v.speed + (v.fallen ? 5.5 : 0)) * dt * (throttle && !dead ? 0.3 : 1);
    v.speed = Math.abs(v.speed) <= coast ? 0 : v.speed - Math.sign(v.speed) * coast;
    if (handbrake) v.speed *= Math.exp(-2.4 * dt);
    // steering: turn in at a limited rate, back to centre a bit quicker
    const spd = Math.abs(v.speed);
    const steerIn = (input.down('KeyA') ? 1 : 0) - (input.down('KeyD') ? 1 : 0);
    const gripLimit = Math.atan((s.grip * s.wheelbase) / Math.max(1, spd * spd));
    const target = steerIn * Math.min(s.steer, gripLimit);
    const rate = (steerIn === 0 || Math.sign(target) !== Math.sign(v.steer) ? 2.2 : 1) * s.steerRate * dt;
    v.steer += THREE.MathUtils.clamp(target - v.steer, -rate, rate);
    // tyres that are sliding hardly steer
    const hold = 1 / (1 + (v.slip * v.slip) / 6 + Math.abs(v.spin) * 0.8);
    let yawSteer = (v.speed / s.wheelbase) * Math.tan(v.steer) * hold;
    // a wheel gone: that corner drags on its rim and pulls the car round
    if (wheelsGone) yawSteer += ((gone[0] ? 1 : 0) + (gone[2] ? 1 : 0) - (gone[1] ? 1 : 0) - (gone[3] ? 1 : 0)) * Math.min(1, spd / 8) * 0.3;
    // handbrake at speed: the rear lets go and the tail comes round
    const drifting = handbrake && spd > 6 && !bike;
    if (drifting) v.spin += (yawSteer * 1.3 - v.spin * 0.3) * 3 * dt;
    // the tyres fight the slide and the spin: friction, so it slows hard and then snaps back
    const grip = s.latGrip * (drifting ? 0.35 : 1) * (wheelsGone ? 0.7 : 1) * (v.fallen ? 0.8 : 1);
    v.slip = Math.abs(v.slip) <= grip * dt ? 0 : v.slip - Math.sign(v.slip) * grip * dt;
    v.spin = Math.abs(v.spin) <= s.spinFric * dt ? 0 : v.spin - Math.sign(v.spin) * s.spinFric * dt;
    v.spin *= Math.exp(-s.spinDamp * dt);
    // the body turns on its own, the car's momentum doesn't: speed turns into slip and back
    if (v.spin) {
      const a = v.spin * dt, c = Math.cos(a), sn = Math.sin(a), sp = v.speed, sl = v.slip;
      v.speed = sp * c - sl * sn;
      v.slip = sl * c + sp * sn;
    }
    v.heading += (yawSteer + v.spin) * dt;
    v.yawRate = yawSteer + v.spin;
    const cos = Math.cos(v.heading), sin = Math.sin(v.heading);
    const fx = cos * v.fwdSign, fz = -sin * v.fwdSign, rx = -fz, rz = fx;
    let vx = fx * v.speed + rx * v.slip, vz = fz * v.speed + rz * v.slip;
    const nx = v.pos.x + vx * dt, nz = v.pos.z + vz * dt;
    const G = (x, z) => g.groundAt(x, z, v.pos.y + 0.6);

    // --- what we hit: each touching collision circle is a contact (point from the centre, normal) ---
    const contacts = [];
    let pushX = 0, pushZ = 0, hits = 0;
    const dirS = Math.sign(v.speed || 1);
    const frontY = G(nx + fx * s.hw * dirS, nz + fz * s.hw * dirS);
    const blocked = frontY - v.pos.y > s.step;   // a kerb or step too high: a wall across the nose (or tail)
    if (blocked) contacts.push({ ox: fx * s.hw * dirS, oz: fz * s.hw * dirS, nx: -fx * dirS, nz: -fz * dirS });
    else {
      for (const off of s.circles) {
        const c = { x: nx + fx * off, z: nz + fz * off };
        const ox = c.x, oz = c.z;
        if (!g.colliders.resolve(c, s.radius, v.pos.y + 0.12, v.pos.y + 1.4, 2)) continue;
        const dx = c.x - ox, dz = c.z - oz, d = Math.hypot(dx, dz) || 1e-6;
        contacts.push({ ox: fx * off - (dx / d) * s.radius, oz: fz * off - (dz / d) * s.radius, nx: dx / d, nz: dz / d });
        pushX += dx; pushZ += dz; hits++;
      }
      // a giant is a wall that walks
      for (const zb of g.zombies.list) {
        if (!zb.def || !zb.def.boss || zb.state === 'dead' || zb.state === 'climb' || Math.abs(zb.pos.y - v.pos.y) > 2) continue;
        const R = 0.34 * zb.scale;
        for (const off of s.circles) {
          const dx = nx + fx * off - zb.pos.x, dz = nz + fz * off - zb.pos.z, d = Math.hypot(dx, dz), min = s.radius + R;
          if (d >= min || d < 1e-4) continue;
          const ux = dx / d, uz = dz / d;
          contacts.push({ ox: fx * off - ux * s.radius, oz: fz * off - uz * s.radius, nx: ux, nz: uz, giant: zb });
          pushX += ux * (min - d); pushZ += uz * (min - d); hits++;
        }
      }
    }
    // --- impulses at the contacts (unit mass; turning inertia s.inertia) ---
    const preSpeed = Math.hypot(vx, vz);
    let omega = yawSteer + v.spin, J = 0, hit = null, scraping = 0;
    for (const ct of contacts) {
      const cvx = vx + omega * ct.oz, cvz = vz - omega * ct.ox;   // the contact point's velocity
      const vn = cvx * ct.nx + cvz * ct.nz;
      const tx = -ct.nz, tz = ct.nx, vt = cvx * tx + cvz * tz;
      scraping = Math.max(scraping, Math.abs(vt));
      if (vn >= -0.05) continue;
      const rn = ct.oz * ct.nx - ct.ox * ct.nz, rt = ct.oz * tx - ct.ox * tz;
      // harder hits bounce less: the crumple zone takes it
      const e = s.bounce * (vn < -8 ? 0.55 : 1);
      const jn = (-(1 + e) * vn) / (1 + (rn * rn) / s.inertia);
      let jt = -vt / (1 + (rt * rt) / s.inertia);
      jt = THREE.MathUtils.clamp(jt, -s.wallFric * jn, s.wallFric * jn);
      const Jx = ct.nx * jn + tx * jt, Jz = ct.nz * jn + tz * jt;
      vx += Jx; vz += Jz;
      omega += (ct.oz * Jx - ct.ox * Jz) / s.inertia;
      if (jn > J) { J = jn; hit = ct; }
    }
    if (contacts.length) {
      v.speed = vx * fx + vz * fz;
      v.slip = vx * rx + vz * rz;
      const newSteer = (v.speed / s.wheelbase) * Math.tan(v.steer) * hold;
      v.spin = THREE.MathUtils.clamp(omega - newSteer, -9, 9);
    }
    if (!blocked) { v.pos.x = nx + (hits ? pushX / hits : 0); v.pos.z = nz + (hits ? pushZ / hits : 0); }
    if (hit && J > 2.2 && !v.replaying) this.crashed(v, hit, J, preSpeed);
    // (ramming a giant hurts it too: where the zombies are real)
    if (hit && hit.giant && J > 3 && !v.replaying && g.mode !== 'client') {
      const zb = hit.giant, by = v.driver ?? g.localSlot ?? 0;
      if (!(zb.rammedT > g.time)) {
        zb.rammedT = (g.time || 0) + 0.4;
        const at = zb.pos.clone(); at.y += 1.2;
        const killed = g.zombies.damage(zb, J * J * 4, at, new THREE.Vector3(-hit.nx, 0.2, -hit.nz).normalize(), false, 'vehicle', by);
        if (g.weapons.onHit) g.weapons.onHit(zb, killed, false, by);
        g.weapons.credit(by, killed, false);
      }
    }

    // ride the ground: pitch and roll from the terrain under the wheels, plus a little body
    // movement from braking/accelerating and cornering, and a corner down where a wheel's gone
    const hF = G(v.pos.x + fx * s.hw * 0.8, v.pos.z + fz * s.hw * 0.8), hB = G(v.pos.x - fx * s.hw * 0.8, v.pos.z - fz * s.hw * 0.8);
    const hL = G(v.pos.x - rx * s.hd, v.pos.z - rz * s.hd), hR = G(v.pos.x + rx * s.hd, v.pos.z + rz * s.hd);
    v.pos.y = THREE.MathUtils.damp(v.pos.y, Math.max(hF, hB, (hF + hB) / 2), 14, dt);
    const accel = (v.speed - v0) / Math.max(dt, 1e-3), lateral = v.speed * yawSteer;
    const bodyPitch = v.type === 'car' ? THREE.MathUtils.clamp(-accel * 0.006, -0.035, 0.035) : 0;
    const bodyRoll = v.type === 'car' ? THREE.MathUtils.clamp(-lateral * 0.008 - v.slip * 0.01, -0.07, 0.07) : 0;
    const droopP = ((gone[2] || gone[3] ? 1 : 0) - (gone[0] || gone[1] ? 1 : 0)) * 0.07;
    const droopR = ((gone[1] || gone[3] ? 1 : 0) - (gone[0] || gone[2] ? 1 : 0)) * 0.09;
    v.tilt.x = THREE.MathUtils.damp(v.tilt.x, Math.atan2(hF - hB, s.hw * 1.6) * v.fwdSign + (bodyPitch + droopP) * v.fwdSign, 8, dt);
    v.tilt.y = THREE.MathUtils.damp(v.tilt.y, Math.atan2(hR - hL, s.hd * 2) + bodyRoll + droopR, 6, dt);
    if (bike) {
      // lean into the turn as a real bike must: tan(lean) = v * yaw rate / g; down on its side if it fell
      const want = v.fallen ? (v.fallSide || 1) * 1.45 : -THREE.MathUtils.clamp(Math.atan(lateral / 9.81), -0.7, 0.7);
      v.lean = THREE.MathUtils.damp(v.lean, want, v.fallen ? 5 : 7, dt);
      if (v.mesh.userData.wheels && !v.fallen) for (const w of v.mesh.userData.wheels) w.rotation.z -= (v.speed / (v.wheelR || 0.39)) * dt;
    }
    v.vel.set(vx, 0, vz);

    // tyre marks and squeal, sparks off the rims and wherever metal meets the road
    if (!v.replaying) {
      const slide = Math.abs(v.slip) + Math.abs(v.spin) * 2.2 + (handbrake && spd > 4 ? spd * 0.35 : 0) + (throttle && Math.sign(throttle) !== Math.sign(v.speed) && spd > 9 ? 2 : 0);
      let grind = hits && scraping > 1.5 ? scraping : 0;
      const hs = Math.hypot(vx, vz);
      if (hits && scraping > 2) this.crash.scrape(new THREE.Vector3(v.pos.x + contacts[0].ox, v.pos.y + 0.45, v.pos.z + contacts[0].oz), new THREE.Vector3(-vx, 0, -vz).normalize(), scraping);
      if ((wheelsGone || v.fallen) && hs > 1.2) {
        grind = Math.max(grind, hs);
        for (let k = 0; k < 4; k++) {
          if (!gone[k] && !(v.fallen && k === 0)) continue;
          const ox = (k < 2 ? 1 : -1) * s.wheelbase * 0.5 * v.fwdSign, oz = (k % 2 ? 1 : -1) * (s.hd - 0.15) * (bike ? 0 : 1);
          this.crash.scrape(new THREE.Vector3(v.pos.x + fx * ox * v.fwdSign + rx * oz, v.pos.y + 0.1, v.pos.z + fz * ox * v.fwdSign + rz * oz), new THREE.Vector3(-vx / hs, 0.2, -vz / hs), hs * 0.6);
          if (v.fallen) break;
        }
      }
      this.crash.tyres(v, slide, grind, dt);
    }
  }

  // A hit hard enough to feel (j: the impulse, m/s): the thump, sparks and bits everywhere; on
  // the host (or alone) also the damage: dents, parts off, the engine, the driver.
  crashed(v, ct, j, before) {
    const g = this.g;
    const now = g.time || performance.now() / 1000;
    const p = new THREE.Vector3(v.pos.x + ct.ox, v.pos.y + (v.type === 'bike' ? 0.6 : 0.55), v.pos.z + ct.oz);
    const n = new THREE.Vector3(ct.nx, 0, ct.nz);
    // the same wall touched every tick of a scrape is one crash, not sixty
    if (v.lastCrash && now - v.lastCrash.t < 0.25 && j < v.lastCrash.j * 1.5) return;
    v.lastCrash = { t: now, j };
    const mine = v === this.active;
    this.crash.impactFx(v, p, n, j, { local: mine });
    if (g.mode === 'client') return;           // (the host decides what breaks, and tells everyone)
    const e = this.damageFrom(v, ct, j);
    this.applyDamage(v, e);
    g.net?.vehicleCrash?.(v, e);
    // the driver: a car's crumple zone and belts take most of it; a bike throws you off
    const who = v.who;
    if (!who) return;
    if (v.type === 'bike' && j > 6.5) this.throwRider(v, j, before);
    else if (j > 9) {
      const hurt = Math.min(60, (j - 9) * 3.5);
      who.damage(hurt, p.x + n.x * 3, p.z + n.z * 3);
      if (who !== g.player) g.net?.hurt?.(who, hurt, p.x, p.z);
    }
  }

  // What one hit does (worked out where the car is simulated for real: alone, or the host).
  // Point and direction in the car's own frame, so every screen puts the dent in the same place.
  // (bullets and blasts: opts.y the height hit, opts.dmg the damage to add, opts.wear what the
  // bumper or wheel nearby loses, opts.dent how deep)
  damageFrom(v, ct, j, opts = {}) {
    const s = v.spec, c = Math.cos(v.heading), sn = Math.sin(v.heading);
    // world -> car frame (model x forward-ish, z to the right)
    const lx = ct.ox * c - ct.oz * sn, lz = ct.ox * sn + ct.oz * c;
    const ly = opts.y ?? 0.6;
    const dnx = -(ct.nx * c - ct.nz * sn), dnz = -(ct.nx * sn + ct.nz * c);   // into the car
    const e = { p: [+lx.toFixed(3), +ly.toFixed(3), +lz.toFixed(3)], d: [+dnx.toFixed(3), +dnz.toFixed(3)], j: +j.toFixed(2), parts: [], dmg: 0 };
    if (opts.kind) e.k = opts.kind;
    if (opts.dent != null) e.dd = +opts.dent.toFixed(3);
    e.dmg = Math.min(100, v.dmg + (opts.dmg ?? Math.max(0, j - 3) * 3.2));
    if (v.type !== 'car') return e;
    if (opts.wear != null) j = opts.wear;
    // bumpers and wheels have so much strength; each hit near one takes some away
    const hp = v.hp, front = lx * v.fwdSign > s.hw - 0.9, rear = lx * v.fwdSign < -(s.hw - 0.9);
    const hitPart = (name, amount, max) => {
      if (v.lost.has(name)) return;
      hp[name] = (hp[name] ?? max) - amount;
      if (hp[name] <= 0) e.parts.push(name);
    };
    const min = opts.wear != null ? 0 : 4;
    if (front && j > min) hitPart('bumperF', j, 11);
    if (rear && j > min) hitPart('bumperR', j, 11);
    // wheels: a hit at a corner
    const wx = s.wheelbase / 2;
    for (const [name, sx, sz] of [['wheelFL', 1, -1], ['wheelFR', 1, 1], ['wheelRL', -1, -1], ['wheelRR', -1, 1]]) {
      const ax = sx * wx * v.fwdSign, az = sz * s.hd * v.fwdSign;
      if (Math.hypot(lx - ax, lz - az) < 1.05 && j > (opts.wear != null ? 0 : 6)) hitPart(name, j * 0.8, 15);
    }
    return e;
  }

  // Everyone applies the same damage: the dent, the parts that come off, the running total.
  applyDamage(v, e, fx = false) {
    const g = this.g;
    if (fx) {
      // (for the other screens: the bang they didn't simulate themselves)
      const c = Math.cos(v.heading), sn = Math.sin(v.heading);
      const wx = e.p[0] * c + e.p[2] * sn, wz = -e.p[0] * sn + e.p[2] * c;
      const n = new THREE.Vector3(-(e.d[0] * c + e.d[1] * sn), 0, -(-e.d[0] * sn + e.d[1] * c));
      const at = new THREE.Vector3(v.pos.x + wx, v.pos.y + e.p[1], v.pos.z + wz);
      if (e.k === 'shot' || e.k === 'claw') this.crash.bulletFx(v, at, n, e.j, e.glass);
      else this.crash.impactFx(v, at, n, e.j, { local: v === this.active, glass: e.glass });
    }
    v.dmg = Math.max(v.dmg, e.dmg || 0);
    if (e.k === 'claw') { v.rock = Math.min(0.09, (v.rock || 0) + 0.035); if (v === this.active) g.player.shake = Math.min(1, g.player.shake + 0.25); }
    const depth = e.dd ?? (e.j > 3.5 ? Math.min(0.3, 0.035 * (e.j - 2)) : 0);
    if (v.type === 'car' && depth > 0.005) {
      this.crash.dent(v, new THREE.Vector3(e.p[0], e.p[1], e.p[2]), new THREE.Vector3(e.d[0], 0, e.d[1]).normalize(), depth, e.k === 'shot' ? 0.35 : null);
      (v.dents || (v.dents = [])).push([e.p[0], e.p[1], e.p[2], e.d[0], e.d[1], e.j, depth]);
      if (v.dents.length > 24) v.dents.shift();
    }
    for (const name of e.parts || []) this.losePart(v, name, e);
    if (e.dmg >= 100 && !v.deadNoted) { v.deadNoted = true; if (v === this.active) g.hud.notice('The engine\'s gone. Get out and find another ride.'); }
  }

  losePart(v, name, e) {
    if (v.lost.has(name)) return;
    v.lost.add(name);
    const c = Math.cos(v.heading), sn = Math.sin(v.heading);
    const out = new THREE.Vector3(-(e.d[0] * c + e.d[1] * sn), 0, -(-e.d[0] * sn + e.d[1] * c)).multiplyScalar(1.5 + e.j * 0.25);
    this.crash.detach(v, name, out);
    if (v.hero && /wheel/.test(name)) {
      const k = { wheelFL: 'Wheel_FL', wheelFR: 'Wheel_FR', wheelRL: 'Wheel_RL', wheelRR: 'Wheel_RR' }[name];
      v.wheels = v.wheels.filter((w) => w.name !== k); v.front = v.front.filter((w) => w.name !== k);
    }
    if (/bumperF/.test(name) && v.lights) for (const m of v.lights.head) m.emissiveIntensity = 0, (m.userData.broken = true);
    if (/bumperR/.test(name) && v.lights) for (const m of v.lights.tail) m.userData.broken = true;
  }

  // Off the bike: the rider flies on the way the bike was going, the bike goes down and slides.
  throwRider(v, j, before) {
    const g = this.g, p = v.who;
    if (!p) return;
    const seat = this.seat(v, p).clone();
    const dir = new THREE.Vector3(Math.cos(v.heading) * v.fwdSign, 0, -Math.sin(v.heading) * v.fwdSign);
    const thrown = dir.multiplyScalar(Math.max(2, before * 0.55)).add(new THREE.Vector3(0, 3.6 + Math.min(3, j * 0.2), 0));
    const hurt = Math.min(45, (j - 5) * 4.5);
    const slot = v.driver;
    if (v === this.active) this.dropControls(v);
    // the bike: on its side, sliding on with what's left of its speed, turning
    v.fallen = true; v.fallSide = Math.random() < 0.5 ? -1 : 1;
    v.driver = null; v.who = null;
    if (v.rider) v.rider.visible = false;
    p.vehicle = null;
    p.pos.set(seat.x, seat.y - 0.9, seat.z);
    p.viewY = p.pos.y;
    p.vel.copy(thrown);
    p.onGround = false;
    p.tumble = 1;
    this.startCoasting(v);
    p.damage(hurt, seat.x - thrown.x, seat.z - thrown.z);
    if (p === g.player) { p.shake = 1; g.hud.notice('Thrown off the bike!'); }
    else g.net?.hurt?.(p, hurt, seat.x - thrown.x, seat.z - thrown.z);
    g.net?.riderThrown?.(v, p, slot, thrown);
  }

  // A vehicle nobody's driving that's still moving (a fallen bike): it slides on until it stops.
  startCoasting(v) {
    v.coasting = true;
    v.speed *= 0.6; v.spin += (Math.random() - 0.5) * 3;
  }

  coastTick(v, dt) {
    const none = { down: () => false };
    this.drive(v, dt, none);
    this.place(v);
    if (Math.abs(v.speed) < 0.15 && Math.abs(v.slip) < 0.15 && Math.abs(v.spin) < 0.1) {
      v.coasting = false; v.speed = 0; v.slip = 0; v.spin = 0;
      this.park(v);
      this.g.net?.vehicleStopped?.(v);
    }
  }

  // Damaged engines smoke: grey, then black; more the worse it is (only those near the camera).
  smoke(dt) {
    const g = this.g, cam = g.camera.position;
    for (const v of this.list) {
      if (v.dmg < 35 || v.type === 'drone') continue;
      if (Math.abs(v.pos.x - cam.x) > 70 || Math.abs(v.pos.z - cam.z) > 70) continue;
      const k = (v.dmg - 35) / 65;
      v.smokeT = (v.smokeT || 0) - dt;
      if (v.smokeT > 0) continue;
      v.smokeT = 0.32 - k * 0.24;
      const f = v.type === 'bike' ? 0.3 : 1.45 * v.fwdSign, c = Math.cos(v.heading), sn = Math.sin(v.heading);
      const p = new THREE.Vector3(v.pos.x + c * f, v.pos.y + (v.type === 'bike' ? 0.7 : 1.0), v.pos.z - sn * f);
      const grey = 0.55 - k * 0.45;
      g.effects.emit(p, 1 + Math.round(k * 2), { color: [grey, grey * 0.97, grey * 0.94], speed: 0.6, spread: 0.5, up: 1.4, life: 2.2 + k * 1.5, size: 0.9 + k * 0.9, gravity: -0.9 });
      if (v.dmg >= 100 && Math.random() < 0.35) g.effects.emit(p, 1, { color: [1, 0.45, 0.1], speed: 0.8, spread: 0.3, up: 1.2, life: 0.35, size: 0.35, gravity: -2 });
    }
  }

  // --- guns and blasts ---

  // A bullet hits a vehicle (where the world is simulated for real: alone, or the host). It does
  // what a crash does, a little at a time: the hits of a burst are added up and applied together
  // (one dent where they landed, strength off the bumper or wheel there, glass, the engine's total).
  bulletHit(target, point, dir, dmg) {
    const v = target.type ? target : this.claimCar(target);
    if (!v || v.type === 'drone') return;
    const b = v.shots || (v.shots = { dmg: 0, n: 0, t: 0, p: new THREE.Vector3(), d: new THREE.Vector3() });
    if (!b.n) b.t = this.g.time || performance.now() / 1000;
    b.dmg += dmg; b.n++;
    b.p.copy(point); b.d.copy(dir);
  }

  flushShots(v) {
    const b = v.shots;
    b.n = 0;
    const ox = b.p.x - v.pos.x, oz = b.p.z - v.pos.z, hl = Math.hypot(b.d.x, b.d.z) || 1;
    const y = b.p.y - v.pos.y;
    // glass: the windows are the top part of a car, above the waist
    const glass = v.type === 'car' && y > 0.95 && y < 1.4;
    const e = this.damageFrom(v, { ox, oz, nx: -b.d.x / hl, nz: -b.d.z / hl }, 2 + b.dmg * 0.02, {
      kind: 'shot', y, dmg: b.dmg * 0.06, wear: b.dmg * 0.02, dent: glass ? 0 : Math.min(0.1, 0.012 + b.dmg * 0.0004),
    });
    if (glass) {
      e.glass = 1;
      // (our own screen: the bullet's sparks are there already, the glass isn't)
      this.crash.chips.emit(b.p, 10, new THREE.Vector3(-b.d.x * 1.5, 0.6, -b.d.z * 1.5), 0xcfeaf5, { size: 0.08, speed: 1.8, glass: true });
      this.g.audio.play('glass', { pos: b.p, vol: 0.5 });
    }
    b.dmg = 0;
    this.applyDamage(v, e, false);
    this.g.net?.vehicleCrash?.(v, e);
  }

  // Where a shot meets a vehicle on the move (driven, or rolling on its own): those have no
  // collider, so they're tested here, each as a box. -> {v, t, point, normal} or null
  raycastMoving(o, d, range, skip = null) {
    let best = null;
    for (const v of this.list) {
      if (v === skip || v.type === 'drone' || (v.driver == null && !v.coasting)) continue;
      const s = v.spec, c = Math.cos(v.heading), sn = Math.sin(v.heading);
      // the ray in the vehicle's frame (x along the model, z across, y up from its feet)
      const rx = o.x - v.pos.x, rz = o.z - v.pos.z;
      const lo = [rx * c - rz * sn, o.y - v.pos.y, rx * sn + rz * c], ld = [d.x * c - d.z * sn, d.y, d.x * sn + d.z * c];
      const lo3 = [-s.hw, 0.1, -s.hd], hi3 = [s.hw, v.type === 'bike' ? 1.2 : 1.45, s.hd];
      // (slabs: where the ray is inside all three pairs of faces at once)
      let t0 = 0, t1 = range, axis = -1;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(ld[k]) < 1e-9) { if (lo[k] < lo3[k] || lo[k] > hi3[k]) { t0 = Infinity; break; } continue; }
        const a = (lo3[k] - lo[k]) / ld[k], b2 = (hi3[k] - lo[k]) / ld[k];
        const near = Math.min(a, b2), far = Math.max(a, b2);
        if (near > t0) { t0 = near; axis = k; }
        t1 = Math.min(t1, far);
        if (t0 > t1) { t0 = Infinity; break; }
      }
      if (!(t0 < Infinity) || axis < 0 || (best && t0 >= best.t)) continue;
      // the face's normal back in the world
      const n = [0, 0, 0]; n[axis] = -Math.sign(ld[axis]);
      const normal = new THREE.Vector3(n[0] * c + n[2] * sn, n[1], -n[0] * sn + n[2] * c);
      best = { v, t: t0, point: new THREE.Vector3(o.x + d.x * t0, o.y + d.y * t0, o.z + d.z * t0), normal };
    }
    return best;
  }

  // A zombie claws at a car with someone in it (where the zombies are real: alone, or the host).
  // Every blow dents it and wears it down a little. From 60% damage the windows are gone and they
  // can reach the driver through them (true back); when it's done for, they drag the driver out.
  clawHit(v, zb) {
    const g = this.g, s = v.spec, c = Math.cos(v.heading), sn = Math.sin(v.heading);
    const dx = zb.pos.x - v.pos.x, dz = zb.pos.z - v.pos.z, d = Math.hypot(dx, dz) || 1;
    // the point on the body nearest the zombie
    const lx = THREE.MathUtils.clamp(dx * c - dz * sn, -s.hw, s.hw), lz = THREE.MathUtils.clamp(dx * sn + dz * c, -s.hd, s.hd);
    const ox = lx * c + lz * sn, oz = -lx * sn + lz * c;
    const was = v.dmg, big = !!zb.def.boss;   // (a giant's fists: big dents, and the car goes flying)
    const e = this.damageFrom(v, { ox, oz, nx: dx / d, nz: dz / d }, big ? 9 : 2.5, {
      kind: 'claw', y: 0.75 + Math.random() * 0.5, dmg: zb.damage * 0.03 * (zb.def.shove ? 2.2 : 1) * (big ? 5 : 1), wear: zb.damage * 0.04 * (big ? 3 : 1),
      dent: big ? 0.09 + Math.random() * 0.06 : 0.02 + Math.random() * 0.025,
    });
    if ((was < 60 && e.dmg >= 60) || (big && Math.random() < 0.5)) e.glass = 1;
    this.applyDamage(v, e, true);
    g.net?.vehicleCrash?.(v, e);
    if (big) {
      const push = 2.5 + Math.random() * 1.5, ux = -dx / d, uz = -dz / d, fx = Math.cos(v.heading) * v.fwdSign, fz = -Math.sin(v.heading) * v.fwdSign;
      // (sideways it slides and the tyres soon stop it; along its length it would roll on: less of that)
      v.speed += (ux * fx + uz * fz) * push * 0.35;
      v.slip += (ux * -fz + uz * fx) * push;
      v.spin += (Math.random() - 0.5) * 2.5;
      if (v === this.active) g.player.shake = 1;
      g.audio.play('crashBig', { pos: v.pos, vol: 1 });
    }
    if (v === this.active && was < 60 && e.dmg >= 60) g.hud.notice('The windows are gone: they can reach you!');
    if (e.dmg >= 100 && v.who) { this.draggedOut(v); return false; }
    return e.dmg >= 60;
  }

  // the car's done for: the zombies pull the driver out
  draggedOut(v) {
    const g = this.g, p = v.who;
    if (!p) return;
    if (g.net && g.net.forceOut) g.net.forceOut(p, v.driver, p === g.player, 'dragged');
    else {
      const spot = this.exitSpot(v, p) || { x: v.pos.x + Math.sin(v.heading) * 2, y: v.pos.y, z: v.pos.z + Math.cos(v.heading) * 2 };
      this.dropControls(v);
      this.release(v, p, spot);
    }
    if (p === g.player) this.draggedFx();
  }

  draggedFx() {
    const p = this.g.player;
    this.g.hud.notice('The zombies dragged you out of the car!');
    p.shake = 1; p.tumble = Math.max(p.tumble, 0.45);
  }

  // A blast (a grenade, a bloater bursting): every car and bike near it is damaged as if hit hard
  // from that side, and shoved (a parked one rolls a little way; a bike goes down).
  blast(x, y, z, radius, power) {
    const g = this.g, reach = radius + 2.5;
    if (g.mode === 'client') return;
    for (const c of this.lot.cars) if (!c.taken && Math.abs(c.x - x) < reach && Math.abs(c.z - z) < reach && Math.hypot(c.x - x, c.z - z) < reach && Math.abs(c.ground - y) < 3) this.claimCar(c);
    for (const v of this.list) {
      if (v.type === 'drone') continue;
      const dx = v.pos.x - x, dz = v.pos.z - z, d = Math.hypot(dx, dz) || 0.01;
      if (d > reach || Math.abs(v.pos.y + 0.6 - y) > 3) continue;
      const k = 1 - d / reach, ux = dx / d, uz = dz / d, s = v.spec;
      // the side facing the blast takes it
      const r = Math.min(d, Math.max(s.hd, s.hw * Math.abs(ux * Math.cos(v.heading) - uz * Math.sin(v.heading))));
      const e = this.damageFrom(v, { ox: -ux * r, oz: -uz * r, nx: ux, nz: uz }, 4 + 20 * k, { kind: 'blast', y: 0.7, dmg: power * 0.09 * k, dent: Math.min(0.28, 0.08 + 0.2 * k) });
      if (k > 0.45 && v.type === 'car') e.glass = 1;
      this.applyDamage(v, e, false);
      g.net?.vehicleCrash?.(v, e);
      this.crash.impactFx(v, new THREE.Vector3(v.pos.x - ux * r, v.pos.y + 0.7, v.pos.z - uz * r), new THREE.Vector3(ux, 0, uz), 4 + 20 * k, { local: v === this.active, glass: !!e.glass });
      // the shove: along the blast, with a twist
      const push = (v.type === 'bike' ? 9 : 5) * k, fx = Math.cos(v.heading) * v.fwdSign, fz = -Math.sin(v.heading) * v.fwdSign;
      v.speed += (ux * fx + uz * fz) * push;
      v.slip += (ux * -fz + uz * fx) * push;
      v.spin += (Math.random() - 0.5) * 3 * k;
      if (v.type === 'bike' && k > 0.35 && !v.fallen) {
        v.fallen = true; v.fallSide = Math.random() < 0.5 ? -1 : 1;
        if (v.who) this.throwRider(v, 8, push);
      }
      if (v.driver == null && !v.coasting && push > 0.6) { this.unpark(v); v.coasting = true; }
    }
  }

  // A late joiner catches up: the damage a vehicle already has (no flying debris, it's history).
  restoreDamage(v, d) {
    if (d.dmg) v.dmg = d.dmg;
    if (v.type !== 'car') return;
    for (const e of d.dents || []) {
      this.crash.dent(v, new THREE.Vector3(e[0], e[1], e[2]), new THREE.Vector3(e[3], 0, e[4]).normalize(), e[6] ?? Math.min(0.3, 0.035 * (e[5] - 2)));
      (v.dents || (v.dents = [])).push(e);
    }
    for (const name of d.lost || []) {
      if (v.lost.has(name)) continue;
      v.lost.add(name);
      this.crash.remove(v, name);
      if (v.hero && /wheel/.test(name)) {
        const k = { wheelFL: 'Wheel_FL', wheelFR: 'Wheel_FR', wheelRL: 'Wheel_RL', wheelRR: 'Wheel_RR' }[name];
        v.wheels = v.wheels.filter((w) => w.name !== k); v.front = v.front.filter((w) => w.name !== k);
      }
    }
  }

  // A new match: every vehicle back as it was (dents out, parts back on, engines fixed).
  repairAll() {
    this.crash.clear();
    for (const v of this.list) {
      if (!v.dmg && !v.lost.size && !v.fallen && !v.pieces) continue;
      if (v.pieces || v.dentable) this.rebuild(v);
      Object.assign(v, { dmg: 0, hp: {}, slip: 0, spin: 0, fallen: false, coasting: false, deadNoted: false, dents: [], pieces: null, dentable: null, lastCrash: null });
      v.lost = new Set();
      v.lean = 0; v.tilt.set(0, 0);
      this.place(v);
    }
  }

  // a fresh body for a car that was cut up and dented
  rebuild(v) {
    const g = this.g, old = v.mesh;
    let fresh;
    if (v.hero) {
      const h = this.heroMesh(v.hero, this.models.vehicles[v.hero]);
      fresh = h.mesh;
      Object.assign(v, { wheels: h.wheels, front: h.front, lights: h.lights });
    } else if (v.lotCar) {
      const lot = this.lot, model = lot.fleet && lot.fleet[v.lotCar.v % lot.fleet.length];
      fresh = new THREE.Group();
      if (model) {
        const body = new THREE.InstancedMesh(model.geometry, lot.mat, 1);
        body.setMatrixAt(0, new THREE.Matrix4());
        body.setColorAt(0, new THREE.Color(v.lotCar.color).convertSRGBToLinear());
        body.castShadow = body.receiveShadow = true;
        body.frustumCulled = false;
        fresh.add(body);
      }
    } else return;
    old.removeFromParent();
    old.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
    g.scene.add(fresh);
    v.mesh = fresh;
  }

  // the chase camera jolts with a crash (a spring back to where it was)
  kickCamera(k) { this.kickVel.add(k.multiplyScalar(9)); }

  bump(v, speed) {
    const g = this.g;
    if (v.replaying) return;
    g.audio.play('metal', { pos: v.pos, vol: Math.min(1, speed / 12) });
    if (!v.who || v.who === g.player) g.player.shake = Math.min(1, g.player.shake + speed / 16);
  }

  // Personal drone: moves relative to where you look.
  flyDrone(v, dt, input) {
    const g = this.g, s = v.spec, p = v.who || g.player;
    const yaw = p.yaw;
    const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const r = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const u = (input.down('Space') ? 1 : 0) - (input.down('ControlLeft') || input.down('ControlRight') || input.down('KeyC') || input.down('ShiftLeft') ? 1 : 0);
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
    if (v.type === 'drone' || this.g.mode === 'client') return;
    const g = this.g, s = v.spec, by = v.driver ?? g.localSlot ?? 0, who = v.who || g.player;
    const c = Math.cos(v.heading), sn = Math.sin(v.heading);
    const spd = Math.abs(v.speed);
    // (PvP: and your foes on foot)
    if (g.pvp && g.pvp.on && spd > 4) {
      for (const q of g.pvp.players()) {
        if (q === who || q.dead || q.vehicle || !g.pvp.foes(by, q.slot) || Math.abs(q.pos.y - v.pos.y) > 1.5 || (q.runT || 0) > g.time) continue;
        const dx = q.pos.x - v.pos.x, dz = q.pos.z - v.pos.z, lx = dx * c - dz * sn, lz = dx * sn + dz * c;
        if (Math.abs(lx) > s.hw + 0.4 || Math.abs(lz) > s.hd + 0.4) continue;
        q.runT = g.time + 0.6;
        const dir = new THREE.Vector3(v.vel.x, 0.3, v.vel.z).normalize(), at = q.pos.clone(); at.y += 1;
        const killed = g.pvp.hurt(q, spd * spd * 1.2 * (v.type === 'bike' ? 0.6 : 1), by, v.type === 'bike' ? 'bike' : 'car', at, dir);
        g.weapons.credit(by, killed, false);
        q.vel.x += v.vel.x * 0.6; q.vel.z += v.vel.z * 0.6; q.vel.y += 3; q.onGround = false;
        v.speed *= 0.85;
      }
    }
    for (const zb of g.zombies.list) {
      if (zb.state === 'dead' || zb.state === 'climb' || zb.species === 'crow' || zb.def.boss) continue;   // (a giant stops the car instead)
      const dx = zb.pos.x - v.pos.x, dz = zb.pos.z - v.pos.z;
      if (Math.abs(dx) > 4 || Math.abs(dz) > 4 || Math.abs(zb.pos.y - v.pos.y) > 1.5) continue;
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c;   // into the vehicle's frame (x forward, z right)
      const ex = s.hw + 0.35, ez = s.hd + 0.35;
      if (Math.abs(lx) > ex || Math.abs(lz) > ez) continue;
      if (spd > 3) {
        const dmg = spd * spd * 3.2 * (v.type === 'bike' ? 0.6 : 1);
        const dir = new THREE.Vector3(v.vel.x, 0.3, v.vel.z).normalize();
        const hitPoint = zb.pos.clone(); hitPoint.y += 1;
        const killed = g.zombies.damage(zb, dmg, hitPoint, dir, false, 'vehicle', by);
        if (g.weapons.onHit) g.weapons.onHit(zb, killed, false, by);
        g.weapons.credit(by, killed, false);
        g.audio.play('flesh', { pos: zb.pos, vol: 1 });
        v.speed *= v.type === 'bike' ? 0.75 : 0.9;
        if (!killed) { zb.pos.x += v.vel.x * 0.12; zb.pos.z += v.vel.z * 0.12; zb.hitT = 0.8; }
        if (v.type === 'bike' && spd > 12) { who.damage(5, zb.pos.x, zb.pos.z); if (who !== g.player) g.net?.hurt?.(who, 5, zb.pos.x, zb.pos.z); }
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

  // The driver sits in the seat (their feet 1.1 m under it).
  seat(v, p) {
    v.mesh.updateMatrixWorld(true);
    const st = v.seat || v.spec.seat;
    const seat = this.tmp.set(st[0], st[1], st[2]);
    if (v.fwdSign < 0) { seat.x = -seat.x; seat.z = -seat.z; }
    seat.applyMatrix4(v.mesh.matrixWorld);
    p.pos.set(seat.x, seat.y - 1.1, seat.z);
    p.viewY = p.pos.y;
    return seat;
  }

  // Put the player in the seat and the camera where it belongs.
  seatPlayer(v, dt) {
    const g = this.g, p = g.player, cam = g.camera;
    const seat = this.seat(v, p);
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
    cam.position.copy(this.camPos).add(this.kick);
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
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = type === 'drone' ? 1800 : type === 'v10' ? 1400 : 700;
    const oscs = (type === 'drone' ? [1, 1.013, 0.987, 1.5] : type === 'v10' ? [1, 2, 0.5, 1.007] : [1, 0.5, 1.01]).map((m) => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 50 * m; o.connect(lp); o.start(); return { o, m };
    });
    lp.connect(gain).connect(a.master);
    gain.gain.setTargetAtTime(type === 'drone' ? 0.07 : type === 'v10' ? 0.12 : 0.09, c.currentTime, 0.3);
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
    const base = v.type === 'drone' ? 120 + load * 60 : v.type === 'bike' ? 55 + load * 160 : e.type === 'v10' ? 62 + load * 190 : 38 + load * 90;
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
