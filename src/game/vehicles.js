import * as THREE from 'three';
import { pointInPoly } from '../world/geom.js';

// Enterable vehicles: every parked car, a few motorbikes and personal drones.
//  F        get in / out (stand next to it)
//  WASD     drive / fly;  Space: handbrake (car, bike) or climb (drone);  C: descend (drone) / chase camera (car, bike)
//  mouse    look around and shoot out through the windows
// Cars and bikes run zombies over; zombies can still reach you through the door.

const SPEC = {
  car: { accel: 7.5, brake: 16, reverse: 5, vmax: 19, wheelbase: 2.7, steer: 0.55, circles: [-1.45, 0, 1.45], radius: 0.95,
    hw: 2.2, hd: 0.92, seat: [0.05, 1.12, -0.38], step: 0.45, exitSide: 1.6, mass: 1 },
  bike: { accel: 9.5, brake: 18, reverse: 2.5, vmax: 23, wheelbase: 1.45, steer: 0.62, circles: [-0.6, 0.6], radius: 0.42,
    hw: 1.0, hd: 0.35, seat: [-0.15, 1.28, 0], step: 0.55, exitSide: 1.0, mass: 0.35 },
  drone: { accel: 10, vmax: 14, vUp: 6.5, radius: 1.35, hw: 1.3, hd: 1.3, seat: [0, 1.2, 0], ceiling: 90, exitSide: 1.8 },
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

export class Vehicles {
  constructor(game) {
    this.g = game;
    this.list = [];      // bikes, drones and any car that has been driven
    this.active = null;
    this.thirdPerson = false;
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
    const v = this.makeRecord(type, mesh, x, z, heading, { seat, wheelR });
    this.park(v);
    this.list.push(v);
    return v;
  }

  makeRecord(type, mesh, x, z, heading, extra = {}) {
    return Object.assign({
      type, spec: SPEC[type], mesh, pos: new THREE.Vector3(x, this.g.hm.atWorld(x, z), z), heading, speed: 0, steer: 0,
      vel: new THREE.Vector3(), fwdSign: 1, col: null, tilt: new THREE.Vector2(), lean: 0,
    }, extra);
  }

  // A parked vehicle is a static obstacle (and something bullets hit).
  park(v) {
    const g = this.g, s = v.spec;
    if (v.col) { v.col.walk = false; v.col.shoot = false; }
    v.col = g.colliders.addBox(v.pos.x, v.pos.z, s.hw, s.hd, -v.heading, { height: v.pos.y + (v.type === 'bike' ? 1.1 : 1.45), minY: v.pos.y - 0.5, kind: v.type === 'drone' ? 'box' : 'car' });
    g.nav.refreshArea(g.colliders, v.pos.x - 3, v.pos.z - 3, v.pos.x + 3, v.pos.z + 3);
    this.place(v);
  }

  unpark(v) {
    if (v.col) { v.col.walk = false; v.col.shoot = false; }
    this.g.nav.refreshArea(this.g.colliders, v.pos.x - 3, v.pos.z - 3, v.pos.x + 3, v.pos.z + 3);
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
    const v = this.makeRecord('car', mesh, c.x, c.z, c.h, { fwdSign });
    this.list.push(v);
    this.g.nav.refreshArea(this.g.colliders, c.x - 3, c.z - 3, c.x + 3, c.z + 3);
    return v;
  }

  enter(target) {
    const g = this.g, p = g.player;
    const v = target.type ? target : this.claimCar(target);
    if (target.type) this.unpark(v);
    this.active = v;
    p.vehicle = v;
    // cars and bikes: look relative to the vehicle; drone: absolute, starting along its nose
    p.yaw = v.type === 'drone' ? v.heading - Math.PI / 2 : 0;
    p.pitch = -0.05;
    p.vel.set(0, 0, 0);
    v.speed = 0; v.vel.set(0, 0, 0);
    this.thirdPerson = false;
    g.weapons.adsToggle = false;
    this.startEngine(v.type);
    g.hud.notice(v.type === 'drone' ? 'Drone: WASD move, Space up, C down, F to get out' : `${v.type === 'bike' ? 'Motorbike' : 'Car'}: WASD drive, Space handbrake, C camera, F to get out`);
  }

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
      const y = Math.max(g.hm.atWorld(x, z), p.roofAt(x, z) <= v.pos.y + 0.6 ? p.roofAt(x, z) : -Infinity);
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
    this.park(v);
    this.stopEngine();
    g.weapons.ignoreItems = null;
  }

  settleDrone(v) {
    const g = this.g;
    const floor = Math.max(g.hm.atWorld(v.pos.x, v.pos.z), this.roofBelow(v.pos.x, v.pos.z, v.pos.y));
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
    if (v.type !== 'drone' && input.hit('KeyC')) this.thirdPerson = !this.thirdPerson;
    if (v.type === 'drone') this.flyDrone(v, dt, input); else this.drive(v, dt, input);
    this.place(v);
    this.runOver(v);
    this.seatPlayer(v, dt);
    g.weapons.ignoreItems = null;
    this.updateEngine(v);
    const kmh = Math.round(Math.abs(v.type === 'drone' ? Math.hypot(v.vel.x, v.vel.z) : v.speed) * 3.6);
    const alt = v.type === 'drone' ? ` · ${Math.max(0, v.pos.y - g.hm.atWorld(v.pos.x, v.pos.z)).toFixed(0)} m up` : '';
    this.hud.textContent = `${kmh} km/h${alt}`;
    this.hud.classList.add('on');
    g.hud.prompt(v.type === 'drone' ? 'Space up · C down · <b>F</b> get out' : `Space handbrake · C camera · <b>F</b> get out`);
  }

  // Bicycle-model driving with three collision circles along the body.
  drive(v, dt, input) {
    const g = this.g, s = v.spec;
    const throttle = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    if (throttle > 0) v.speed += (v.speed < 0 ? s.brake : s.accel) * dt;
    else if (throttle < 0) v.speed -= (v.speed > 0.3 ? s.brake : s.reverse) * dt;
    else v.speed *= Math.exp(-0.45 * dt);
    if (input.down('Space')) v.speed *= Math.exp(-3.2 * dt);
    v.speed = THREE.MathUtils.clamp(v.speed, -s.vmax * 0.35, s.vmax);
    const steerIn = (input.down('KeyA') ? 1 : 0) - (input.down('KeyD') ? 1 : 0);
    const steerMax = s.steer * (1 - 0.55 * Math.min(1, Math.abs(v.speed) / s.vmax));
    v.steer = THREE.MathUtils.damp(v.steer, steerIn * steerMax, 6, dt);
    v.heading += (v.speed / s.wheelbase) * Math.tan(v.steer) * dt * (input.down('Space') && Math.abs(v.speed) > 5 ? 1.5 : 1);
    const cos = Math.cos(v.heading), sin = Math.sin(v.heading);
    const fx = cos * v.fwdSign, fz = -sin * v.fwdSign;
    const nx = v.pos.x + fx * v.speed * dt, nz = v.pos.z + fz * v.speed * dt;
    // curbs and steps: too high blocks like a wall
    const frontY = g.hm.atWorld(nx + fx * s.hw * Math.sign(v.speed || 1), nz + fz * s.hw * Math.sign(v.speed || 1));
    let blocked = frontY - v.pos.y > s.step;
    // collide the body circles with the world
    let pushX = 0, pushZ = 0, hits = 0;
    if (!blocked) {
      for (const off of s.circles) {
        const c = { x: nx + fx * off, z: nz + fz * off };
        const ox = c.x, oz = c.z;
        if (g.colliders.resolve(c, s.radius, v.pos.y + 0.12, v.pos.y + 1.4, 2)) { hits++; pushX += c.x - ox; pushZ += c.z - oz; }
      }
    }
    const impact = Math.abs(v.speed);
    if (blocked || hits) {
      if (impact > 4) { g.audio.play('metal', { pos: v.pos, vol: Math.min(1, impact / 12) }); g.player.shake = Math.min(1, g.player.shake + impact / 14); }
      v.speed *= blocked ? -0.2 : -0.3;
      if (!blocked) { v.pos.x = nx + pushX / hits; v.pos.z = nz + pushZ / hits; }
    } else { v.pos.x = nx; v.pos.z = nz; }
    // ride the ground: pitch and roll from the terrain under the wheels
    const hF = g.hm.atWorld(v.pos.x + fx * s.hw * 0.8, v.pos.z + fz * s.hw * 0.8), hB = g.hm.atWorld(v.pos.x - fx * s.hw * 0.8, v.pos.z - fz * s.hw * 0.8);
    const rx = -fz, rz = fx;
    const hL = g.hm.atWorld(v.pos.x - rx * s.hd, v.pos.z - rz * s.hd), hR = g.hm.atWorld(v.pos.x + rx * s.hd, v.pos.z + rz * s.hd);
    v.pos.y = THREE.MathUtils.damp(v.pos.y, Math.max(hF, hB, (hF + hB) / 2), 14, dt);
    v.tilt.x = THREE.MathUtils.damp(v.tilt.x, Math.atan2(hF - hB, s.hw * 1.6) * v.fwdSign, 10, dt);
    v.tilt.y = THREE.MathUtils.damp(v.tilt.y, Math.atan2(hR - hL, s.hd * 2), 10, dt);
    if (v.type === 'bike') {
      v.lean = THREE.MathUtils.damp(v.lean, -v.steer * Math.min(1, Math.abs(v.speed) / 8) * 0.9, 6, dt);
      if (v.mesh.userData.wheels) for (const w of v.mesh.userData.wheels) w.rotation.z -= (v.speed / (v.wheelR || 0.39)) * dt;
    }
    v.vel.set(fx * v.speed, 0, fz * v.speed);
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
    const ground = g.hm.atWorld(next.x, next.z);
    const floor = Math.max(ground, this.roofBelow(next.x, next.z, v.pos.y));
    if (ny < floor) { ny = floor; v.vel.y = Math.max(0, v.vel.y); }
    ny = Math.min(ny, ground + s.ceiling);
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
        if (v.type === 'bike' && spd > 12) g.player.damage(8, zb.pos.x, zb.pos.z);
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
    const baseYaw = v.type === 'drone' ? 0 : v.heading - Math.PI / 2 + (v.fwdSign < 0 ? Math.PI : 0);
    cam.rotation.order = 'YXZ';
    const sh = p.shake * p.shake, t = performance.now() / 1000;
    if (this.thirdPerson && v.type !== 'drone') {
      const yaw = baseYaw + p.yaw;
      const back = v.type === 'bike' ? 4.5 : 6.5, up = v.type === 'bike' ? 2 : 2.6;
      const tx = v.pos.x + Math.sin(yaw) * back, tz = v.pos.z + Math.cos(yaw) * back;
      const ty = Math.max(g.hm.atWorld(tx, tz) + 0.5, v.pos.y + up - p.pitch * 3);
      cam.position.set(tx, ty, tz);
      cam.rotation.set(p.pitch - 0.18, yaw, 0);
      v.mesh.visible = true;
    } else {
      cam.position.copy(seat);
      cam.rotation.set(p.pitch + p.punch.x + (Math.sin(t * 40) * 0.004 * sh), baseYaw + p.yaw + p.punch.y, v.type === 'bike' ? -v.lean * 0.5 : 0);
      // inside a car we draw a cabin frame instead of the body (the body would block the view)
      v.mesh.visible = v.type !== 'car';
      this.cabin(v);
    }
    if (Math.abs(cam.fov - p.fovBase * (1 - p.ads * (p.adsZoom ?? 0.22))) > 0.01) {
      cam.fov = THREE.MathUtils.lerp(cam.fov, p.fovBase * (1 - p.ads * (p.adsZoom ?? 0.22)), 0.25);
      cam.updateProjectionMatrix();
    }
    if (this.cabinMesh) this.cabinMesh.visible = v.type === 'car' && !this.thirdPerson;
  }

  // Dashboard, steering wheel, pillars, roof edge and bonnet in the car's own frame (x forward,
  // y up, z right, driver on the left), shown in place of the body when driving in first person.
  cabin(v) {
    if (v.type !== 'car') return;
    if (!this.cabinMesh) {
      const g = new THREE.Group();
      const dash = new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.8 });
      const trim = new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.6 });
      const bonnet = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.5 });
      const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; };
      add(new THREE.BoxGeometry(0.4, 0.2, 1.62), dash, 0.72, 0.93, 0);                         // dashboard
      add(new THREE.TorusGeometry(0.19, 0.022, 8, 28), trim, 0.47, 1.0, -0.38, 0, Math.PI / 2, -0.45); // wheel
      add(new THREE.BoxGeometry(0.07, 0.9, 0.07), trim, 0.62, 1.22, -0.8, 0, 0, 0.75);          // A-pillars
      add(new THREE.BoxGeometry(0.07, 0.9, 0.07), trim, 0.62, 1.22, 0.8, 0, 0, 0.75);
      add(new THREE.BoxGeometry(0.1, 0.07, 1.62), trim, 0.3, 1.5, 0);                          // roof header
      add(new THREE.BoxGeometry(0.07, 0.6, 0.07), trim, -0.45, 1.2, -0.84);                     // B-pillars
      add(new THREE.BoxGeometry(0.07, 0.6, 0.07), trim, -0.45, 1.2, 0.84);
      add(new THREE.BoxGeometry(1.4, 0.2, 0.08), dash, 0.1, 0.8, -0.86);                        // door cards
      add(new THREE.BoxGeometry(1.4, 0.2, 0.08), dash, 0.1, 0.8, 0.86);
      add(new THREE.BoxGeometry(1.3, 0.06, 1.62), bonnet, 1.55, 0.88, 0, 0, 0, -0.08);           // bonnet
      g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      g.matrixAutoUpdate = false;
      this.cabinMesh = g;
      this.g.scene.add(g);
    }
    // same transform as the car body (mirrored for models whose nose points -x)
    this.cabinMesh.matrix.copy(v.mesh.matrixWorld);
    if (v.fwdSign < 0) this.cabinMesh.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    this.cabinMesh.matrixWorldNeedsUpdate = true;
  }

  // --- engine sound (synthesised) ---
  startEngine(type) {
    const a = this.g.audio;
    if (!a.ctx) return;
    const c = a.ctx;
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
