import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Weapons, first-person viewmodels, hitscan shooting, the compound bow (real arrows), F-1 hand
// grenades and the knife.
//
// Realism notes, per gun:
//  - recoil: every shot kicks the view up (vertical) and drifts it sideways (horizontal walk with a bias),
//    and the spread "blooms" while you keep firing, recovering when you stop
//  - chamber: a tactical reload keeps the round in the chamber (magazine + 1) on closed-bolt guns
//  - the pump shotgun loads one shell at a time and can be interrupted by firing
//  - rifle-calibre rounds punch through car bodies and through zombies; .50 AE goes through one
//  - arrows are projectiles: they drop with gravity, pierce at full draw, stick in walls (walk over to pick up)
//  - heavy guns slow you down; the knife speeds you up
export const DEFS = {
  pistol: { name: 'Makarov PM', short: 'Makarov', slot: 0, dmg: 38, head: 2.4, rpm: 420, auto: false, mag: 8, reserve: 72, reload: 1.55, reloadEmpty: 1.9,
    spread: 0.012, adsSpread: 0.0035, bloom: 0.006, bloomMax: 0.03, recover: 0.09, kickUp: 0.045, kickSide: 0.012, drift: 0,
    pellets: 1, range: 70, falloff: 25, sound: 'pistol', tracer: false, chamber: true, move: 1.0, flash: 0.14, brass: true },
  // IMI Desert Eagle Mark XIX in .50 AE: 7 rounds, a hand cannon that kicks like one
  deagle: { name: 'Desert Eagle .50 AE', short: 'Deagle', slot: 1, dmg: 96, head: 2.5, rpm: 190, auto: false, mag: 7, reserve: 42, reload: 1.7, reloadEmpty: 2.1,
    spread: 0.016, adsSpread: 0.0028, bloom: 0.022, bloomMax: 0.055, recover: 0.07, kickUp: 0.13, kickSide: 0.03, drift: 0,
    pellets: 1, range: 90, falloff: 35, sound: 'pistol', rate: 0.68, vol: 1, tracer: false, chamber: true, move: 0.98, pen: 1, flash: 0.3, brass: true, price: 900 },
  rifle: { name: 'AK-74', short: 'AK-74', slot: 2, dmg: 44, head: 2.6, rpm: 650, auto: true, mag: 30, reserve: 180, reload: 2.3, reloadEmpty: 2.9,
    spread: 0.02, adsSpread: 0.004, bloom: 0.0035, bloomMax: 0.05, recover: 0.12, kickUp: 0.024, kickSide: 0.011, drift: 0.4,
    pellets: 1, range: 150, falloff: 50, sound: 'rifle', tracer: true, chamber: true, move: 0.95, pen: 1, penCars: true, flash: 0.2, brass: true, price: 1200 },
  // Colt M4A1 carbine, 5.56 NATO, EOTech holographic sight: faster and flatter than the AK
  m4: { name: 'M4A1 Carbine', short: 'M4A1', slot: 3, dmg: 36, head: 2.6, rpm: 800, auto: true, mag: 30, reserve: 210, reload: 2.1, reloadEmpty: 2.6,
    spread: 0.017, adsSpread: 0.0028, bloom: 0.0028, bloomMax: 0.04, recover: 0.14, kickUp: 0.017, kickSide: 0.008, drift: 0.15,
    pellets: 1, range: 160, falloff: 60, sound: 'rifle', rate: 1.14, vol: 0.85, tracer: true, chamber: true, move: 0.97, pen: 1, penCars: true, flash: 0.16, brass: true,
    zoom: 0.3, price: 1600 },
  shotgun: { name: 'TOZ-194 Shotgun', short: 'TOZ', slot: 4, dmg: 30, head: 1.6, rpm: 70, auto: false, mag: 7, reserve: 42, shellTime: 0.48, reloadStart: 0.35,
    spread: 0.07, adsSpread: 0.05, bloom: 0, bloomMax: 0, recover: 0.2, kickUp: 0.11, kickSide: 0.03, drift: 0,
    pellets: 9, range: 38, falloff: 12, sound: 'shotgun', tracer: false, chamber: false, move: 0.95, pump: true, flash: 0.26, price: 1500 },
  sniper: { name: 'SVD Dragunov', short: 'SVD', slot: 5, dmg: 230, head: 3.0, rpm: 75, auto: false, mag: 10, reserve: 40, reload: 2.9, reloadEmpty: 3.4,
    spread: 0.05, adsSpread: 0.0006, bloom: 0.02, bloomMax: 0.05, recover: 0.08, kickUp: 0.09, kickSide: 0.02, drift: 0,
    pellets: 1, range: 280, falloff: 240, sound: 'rifle', rate: 0.72, vol: 1, tracer: true, chamber: true, move: 0.92, pen: 3, penCars: true, flash: 0.22, brass: true,
    zoom: 0.76, scope: true, price: 2500 },
  // FN SCAR 20S: 7.62 NATO semi-auto precision rifle, 20-round box; hold the trigger to fire as fast as it cycles
  autosniper: { name: 'FN SCAR 20S', short: 'SCAR 20S', slot: 6, dmg: 150, head: 3.0, rpm: 300, auto: true, mag: 20, reserve: 80, reload: 2.6, reloadEmpty: 3.1,
    spread: 0.045, adsSpread: 0.0012, bloom: 0.012, bloomMax: 0.04, recover: 0.1, kickUp: 0.05, kickSide: 0.015, drift: 0.1,
    pellets: 1, range: 260, falloff: 200, sound: 'rifle', rate: 0.8, vol: 1, tracer: true, chamber: true, move: 0.9, pen: 2, penCars: true, flash: 0.22, brass: true,
    zoom: 0.68, scope: true, price: 3500 },
  // M60: belt-fed 7.62 NATO general-purpose machine gun. 100-round belt, heavy, slow cyclic rate, climbs hard.
  mg: { name: 'M60 Machine Gun', short: 'M60', slot: 7, dmg: 52, head: 2.4, rpm: 550, auto: true, mag: 100, reserve: 200, reload: 5.2, reloadEmpty: 5.6,
    spread: 0.034, adsSpread: 0.012, bloom: 0.003, bloomMax: 0.06, recover: 0.1, kickUp: 0.03, kickSide: 0.02, drift: -0.35,
    pellets: 1, range: 180, falloff: 70, sound: 'rifle', rate: 0.82, vol: 1, tracer: true, tracerEvery: 3, chamber: false, move: 0.8, pen: 2, penCars: true,
    flash: 0.3, brass: true, price: 4000 },
  // Compound bow, ~70 lb draw: hold the trigger to draw, let go to loose. Silent, arrows can be picked up again.
  bow: { name: 'Compound bow', short: 'Bow', slot: 8, bow: true, dmg: 330, head: 2.5, mag: 1, reserve: 24, drawTime: 0.7, speedMin: 30, speedMax: 88,
    spread: 0.002, adsSpread: 0.001, move: 1.0, zoom: 0.25, price: 1400 },
  knife: { name: 'Combat knife', short: 'Knife', slot: 9, melee: true, dmg: 125, heavy: 320, move: 1.1, auto: false, mag: 0, reserve: 0 },
};

// Number keys select a category; pressing it again cycles inside it.
export const CATS = {
  Digit1: ['pistol', 'deagle'], Digit2: ['rifle', 'm4'], Digit3: ['shotgun'], Digit4: ['sniper', 'autosniper'],
  Digit5: ['mg'], Digit6: ['bow'], Digit7: ['knife'],
};

// Where each gun is sold (buy stations in director.js).
export const WHERE = {
  deagle: 'at the Diamond salon on the podium', rifle: 'at Spar on the podium', m4: 'at Assorti on the podium', shotgun: 'at Nikora on the podium',
  sniper: 'at the Gate 2 security booth', autosniper: 'in the cache on the twin tower roof (take the stairs)', mg: 'at the Gate 1 security booth',
  bow: 'at the crate by the basketball court',
};

export const MAX_GRENADES = 4;
const THROW_TIME = 0.6;
const FWD = new THREE.Vector3(0, 0, -1);
const NADE_SKIP = { playerOnly: true };

// Viewmodel placement per weapon (camera space). Tuned by rendering the viewmodel on its own.
const VIEW_YAW = { pistol: Math.PI / 2, rifle: Math.PI / 2, shotgun: Math.PI / 2 };
const VIEW = {
  pistol: { pos: [0.13, -0.135, -0.2], ads: [0.0, -0.075, -0.12], rot: [0, 0, 0] },
  deagle: { pos: [0.13, -0.14, -0.22], ads: [0.0, -0.08, -0.14], rot: [0, 0, 0] },
  rifle: { pos: [0.14, -0.155, -0.33], ads: [0.0, -0.085, -0.2], rot: [0, 0, 0] },
  m4: { pos: [0.14, -0.16, -0.3], ads: [0.0, -0.09, -0.16], rot: [0, 0, 0] },
  shotgun: { pos: [0.16, -0.16, -0.42], ads: [0.0, -0.085, -0.3], rot: [0, 0, 0] },
  sniper: { pos: [0.15, -0.16, -0.36], ads: [0.0, -0.075, -0.18], rot: [0, 0, 0] },
  autosniper: { pos: [0.15, -0.165, -0.34], ads: [0.0, -0.08, -0.18], rot: [0, 0, 0] },
  mg: { pos: [0.22, -0.215, -0.44], ads: [0.0, -0.11, -0.26], rot: [0, 0, 0] },
  bow: { pos: [-0.03, -0.05, 0.03], ads: [0.0, 0.0, 0.0], rot: [0.02, 0.05, 0.26] },
  knife: { pos: [0.17, -0.15, -0.3], ads: [0.17, -0.15, -0.3], rot: [0.3, 0.35, 0.15] },
};

const RIG_VIEW = { pos: [0, 0, 0], ads: [0, 0, 0], rot: [0, 0, 0] }; // rigs are authored in camera space
const M = (color, rough = 0.5, metal = 0.0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const CYL = (r1, r2, len, seg = 12) => new THREE.CylinderGeometry(r1, r2, len, seg).rotateX(Math.PI / 2);

// A pair of forearms + gloved hands in camera space, for the code-built and gun-only weapons.
let armMats = null;
function arms(g, right, left) {
  armMats ||= { glove: M(0x2b2c29, 0.85, 0.05), cuff: M(0x1d1e1c, 0.9), sleeve: M(0x3f4a3a, 0.9) };
  const { glove, cuff, sleeve } = armMats;
  const add = (geo, mat, p, r) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.rotation.set(...r); g.add(m); };
  if (right) {
    add(new RoundedBoxGeometry(0.066, 0.082, 0.095, 3, 0.022), glove, right, [0.15, 0, 0]);
    add(new RoundedBoxGeometry(0.02, 0.026, 0.06, 2, 0.009), glove, [right[0] - 0.036, right[1] + 0.028, right[2] - 0.03], [0.2, 0, 0.3]); // thumb
    add(new THREE.CylinderGeometry(0.041, 0.045, 0.06, 12), cuff, [right[0] + 0.02, right[1] - 0.03, right[2] + 0.07], [1.2, 0.3, 0]);
    add(new THREE.CylinderGeometry(0.045, 0.055, 0.42, 12), sleeve, [right[0] + 0.06, right[1] - 0.075, right[2] + 0.23], [1.2, 0.3, 0]);
  }
  if (left) {
    add(new RoundedBoxGeometry(0.075, 0.058, 0.11, 3, 0.02), glove, left, [0, 0, 0]);
    add(new THREE.CylinderGeometry(0.041, 0.045, 0.06, 12), cuff, [left[0] - 0.05, left[1] - 0.04, left[2] + 0.07], [1.05, -0.55, 0]);
    add(new THREE.CylinderGeometry(0.045, 0.055, 0.5, 12), sleeve, [left[0] - 0.13, left[1] - 0.12, left[2] + 0.23], [1.05, -0.55, 0]);
  }
}

// Hands on a long gun: a glove on the pistol grip and one wrapped under the forend, forearms
// running down and back out of the view (so they read as arms, not as blobs pointing at you).
function longArms(g, right, left) {
  armMats ||= { glove: M(0x2b2c29, 0.85, 0.05), cuff: M(0x1d1e1c, 0.9), sleeve: M(0x3f4a3a, 0.9) };
  const { glove, cuff, sleeve } = armMats;
  const V = (p, d) => new THREE.Vector3(p[0] + d[0], p[1] + d[1], p[2] + d[2]);
  const limb = (mat, a, b, rWrist, rElbow) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rElbow, rWrist, a.distanceTo(b), 12), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(m);
  };
  const box = (geo, mat, p, r) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.rotation.set(...r); g.add(m); };
  if (right) {
    box(new RoundedBoxGeometry(0.066, 0.082, 0.095, 3, 0.022), glove, right, [0.15, 0, 0]);
    box(new RoundedBoxGeometry(0.02, 0.026, 0.06, 2, 0.009), glove, [right[0] - 0.036, right[1] + 0.028, right[2] - 0.03], [0.2, 0, 0.3]); // thumb
    limb(cuff, V(right, [0.005, -0.03, 0.045]), V(right, [0.02, -0.075, 0.1]), 0.036, 0.042);
    limb(sleeve, V(right, [0.015, -0.06, 0.085]), V(right, [0.11, -0.34, 0.37]), 0.043, 0.056);
  }
  if (left) {
    // palm under the forend, fingers up its far side, thumb along the near side
    box(new RoundedBoxGeometry(0.07, 0.04, 0.115, 3, 0.016), glove, [left[0], left[1], left[2]], [0, 0, 0]);
    box(new RoundedBoxGeometry(0.018, 0.05, 0.1, 2, 0.008), glove, [left[0] + 0.038, left[1] + 0.03, left[2]], [0, 0, 0.12]);
    box(new RoundedBoxGeometry(0.018, 0.035, 0.07, 2, 0.008), glove, [left[0] - 0.037, left[1] + 0.022, left[2] + 0.012], [0, 0, -0.12]);
    limb(cuff, V(left, [-0.01, -0.025, 0.055]), V(left, [-0.03, -0.07, 0.11]), 0.036, 0.042);
    limb(sleeve, V(left, [-0.02, -0.055, 0.09]), V(left, [-0.17, -0.34, 0.38]), 0.043, 0.056);
  }
}

function builder(g) {
  return (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
}

function proceduralGun(kind) {
  const g = new THREE.Group();
  const metal = M(0x2a2c2f, 0.45, 0.8), dark = M(0x151617, 0.6, 0.5), wood = M(0x6b3d1f, 0.55);
  const box = (w, h, d, m, x, y, z, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; g.add(b); return b; };
  if (kind === 'pistol') {
    box(0.032, 0.035, 0.17, metal, 0, 0.02, -0.06);
    box(0.03, 0.1, 0.04, dark, 0, -0.04, 0.0, 0.25);
    arms(g, [0, -0.06, 0.02], null);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.16);
  } else if (kind === 'rifle') {
    box(0.05, 0.07, 0.34, metal, 0, 0, -0.1);
    box(0.045, 0.05, 0.2, wood, 0, -0.005, -0.33);
    box(0.02, 0.02, 0.28, dark, 0, 0.02, -0.52);
    box(0.035, 0.13, 0.06, dark, 0, -0.1, -0.12, 0.35);
    box(0.045, 0.06, 0.24, wood, 0, -0.02, 0.2);
    arms(g, [0, -0.07, 0.04], [0, -0.045, -0.33]);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.67);
  } else {
    box(0.035, 0.04, 0.72, metal, 0, 0.02, -0.33);
    box(0.05, 0.05, 0.18, wood, 0, -0.025, -0.4);
    box(0.05, 0.07, 0.2, metal, 0, 0, 0.02);
    box(0.045, 0.08, 0.28, wood, 0, -0.04, 0.24, -0.15);
    arms(g, [0, -0.07, 0.1], [0, -0.05, -0.4]);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.7);
  }
  return g;
}

// Desert Eagle: long slab-sided stainless slide with the top rib, two-hand grip.
function proceduralDeagle() {
  const g = new THREE.Group(), add = builder(g);
  const steel = M(0xa7adb3, 0.28, 0.95), dark = M(0x1a1a1b, 0.55, 0.5), grip = M(0x121213, 0.85, 0.05);
  add(BOX(0.036, 0.044, 0.27), steel, 0, 0.03, -0.09);            // slide
  add(BOX(0.014, 0.01, 0.23), steel, 0, 0.056, -0.1);             // top rib
  add(BOX(0.028, 0.012, 0.03), steel, 0, 0.028, -0.235);          // muzzle face
  add(BOX(0.033, 0.028, 0.19), steel, 0, -0.003, -0.075);         // frame
  add(BOX(0.008, 0.03, 0.055), steel, 0, -0.03, -0.06);           // trigger guard
  add(BOX(0.036, 0.115, 0.052), grip, 0, -0.075, 0.012, 0.22);    // grip
  add(BOX(0.012, 0.016, 0.012), dark, 0, 0.042, 0.048);           // hammer
  add(BOX(0.006, 0.012, 0.006), dark, 0, 0.066, -0.2);            // front sight
  add(BOX(0.022, 0.01, 0.006), dark, 0, 0.064, 0.025);            // rear sight
  add(BOX(0.038, 0.004, 0.18), dark, 0, 0.012, -0.1);             // slide/frame line
  arms(g, [0, -0.07, 0.03], [0.012, -0.095, 0.02]);
  g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.24);
  g.userData.sight = new THREE.Vector3(0, 0.066, 0);
  return g;
}

// M4A1: flat-top upper, quad rail, A-frame front sight, curved STANAG magazine, collapsible stock and
// an EOTech holographic sight with a red ring-and-dot reticle.
function proceduralM4() {
  const g = new THREE.Group(), add = builder(g);
  const black = M(0x1d1e20, 0.5, 0.55), dark = M(0x111213, 0.6, 0.45), poly = M(0x222325, 0.78, 0.08);
  const glass = new THREE.MeshStandardMaterial({ color: 0x2a3c44, roughness: 0.05, metalness: 0.5, transparent: true, opacity: 0.22, depthWrite: false });
  const red = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
  add(BOX(0.046, 0.05, 0.3), black, 0, 0.01, -0.05);              // upper receiver
  add(BOX(0.04, 0.042, 0.2), black, 0, -0.035, -0.02);            // lower receiver
  add(BOX(0.024, 0.012, 0.3), dark, 0, 0.041, -0.05);             // top rail
  add(BOX(0.052, 0.052, 0.3), dark, 0, 0.004, -0.35);             // quad rail handguard
  for (let i = 0; i < 9; i++) add(BOX(0.056, 0.006, 0.012), black, 0, 0.032, -0.22 - i * 0.03); // rail teeth
  add(CYL(0.009, 0.009, 0.2), dark, 0, 0.01, -0.58);              // barrel
  add(CYL(0.012, 0.012, 0.05), dark, 0, 0.01, -0.7);              // flash hider
  add(BOX(0.012, 0.06, 0.02), black, 0, 0.042, -0.51);            // front sight post
  add(BOX(0.029, 0.13, 0.062), poly, 0, -0.11, -0.1, -0.16);      // magazine
  add(BOX(0.03, 0.09, 0.042), poly, 0, -0.078, 0.065, 0.36);      // pistol grip
  add(CYL(0.015, 0.015, 0.2), black, 0, 0.008, 0.18);             // buffer tube
  add(BOX(0.04, 0.085, 0.13), poly, 0, -0.018, 0.3);              // stock
  add(BOX(0.03, 0.01, 0.022), black, 0, 0.04, 0.095);             // charging handle
  add(BOX(0.012, 0.018, 0.03), black, 0.026, 0.0, 0.04);          // forward assist
  // EOTech
  const ry = 0.087, rz = -0.1;
  add(BOX(0.042, 0.018, 0.11), black, 0, 0.056, -0.06);           // base
  add(BOX(0.003, 0.046, 0.09), black, 0.024, ry, -0.065);         // hood sides
  add(BOX(0.003, 0.046, 0.09), black, -0.024, ry, -0.065);
  add(BOX(0.05, 0.003, 0.09), black, 0, ry + 0.024, -0.065);      // hood top
  add(BOX(0.042, 0.042, 0.002), glass, 0, ry, rz);                // window
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0055, 0.0008, 6, 28), red); ring.position.set(0, ry, rz - 0.002); g.add(ring);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 10), red); dot.position.set(0, ry, rz - 0.002); g.add(dot);
  arms(g, [0, -0.077, 0.07], [0, -0.035, -0.36]);
  g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.73);
  g.userData.sight = new THREE.Vector3(0, ry - 0.018, 0);
  return g;
}

// FN SCAR 20S: flat dark earth receiver, long free-floated barrel, 20-round box, adjustable stock, big scope.
function proceduralSCAR() {
  const g = new THREE.Group(), add = builder(g);
  const tan = M(0x9c8660, 0.62, 0.12), black = M(0x161718, 0.5, 0.55), glass = M(0x0a1624, 0.05, 0.9);
  add(BOX(0.052, 0.062, 0.42), tan, 0, 0, -0.1);                  // upper receiver
  add(BOX(0.024, 0.012, 0.52), black, 0, 0.037, -0.13);           // top rail
  add(BOX(0.044, 0.045, 0.2), tan, 0, -0.048, -0.02);             // lower
  add(CYL(0.011, 0.011, 0.36), black, 0, 0.004, -0.5);            // barrel
  add(CYL(0.016, 0.016, 0.06), black, 0, 0.004, -0.7);            // muzzle brake
  add(BOX(0.032, 0.11, 0.07), black, 0, -0.115, -0.08);           // 20-rd magazine
  add(BOX(0.032, 0.09, 0.042), black, 0, -0.082, 0.07, 0.3);      // grip
  add(BOX(0.046, 0.09, 0.21), tan, 0, -0.012, 0.28);              // stock
  add(BOX(0.032, 0.022, 0.11), tan, 0, 0.044, 0.26);              // cheek riser
  add(BOX(0.048, 0.1, 0.02), black, 0, -0.012, 0.39);             // butt pad
  add(CYL(0.018, 0.018, 0.3), black, 0, 0.085, -0.1);             // scope tube
  add(CYL(0.027, 0.019, 0.07), black, 0, 0.085, -0.28);           // objective bell
  add(CYL(0.021, 0.021, 0.07), black, 0, 0.085, 0.07);            // eyepiece
  add(CYL(0.026, 0.026, 0.004), glass, 0, 0.085, -0.316);         // lens
  add(BOX(0.018, 0.02, 0.02), black, 0, 0.11, -0.09);             // turrets
  add(BOX(0.02, 0.018, 0.02), black, 0.024, 0.085, -0.09);
  add(BOX(0.04, 0.03, 0.02), black, 0, 0.06, -0.19);              // rings
  add(BOX(0.04, 0.03, 0.02), black, 0, 0.06, 0.0);
  arms(g, [0, -0.08, 0.07], [0, -0.03, -0.36]);
  g.userData.muzzle = new THREE.Vector3(0, 0.004, -0.74);
  g.userData.sight = new THREE.Vector3(0, 0.085, 0);
  return g;
}

// SVD Dragunov: long barrel, skeleton stock, PSO-1 scope.
function proceduralSVD() {
  const g = new THREE.Group();
  const metal = M(0x25272a, 0.4, 0.8), dark = M(0x141516, 0.55, 0.5), wood = M(0x7a4020, 0.5), glass = M(0x0a1624, 0.05, 0.9);
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m; };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const C = (r1, r2, len) => new THREE.CylinderGeometry(r1, r2, len, 12).rotateX(Math.PI / 2);
  add(B(0.045, 0.06, 0.34), metal, 0, 0, -0.02);
  add(B(0.05, 0.05, 0.3), wood, 0, -0.005, -0.33);
  add(C(0.011, 0.011, 0.42), dark, 0, 0.012, -0.64);
  add(C(0.016, 0.016, 0.08), dark, 0, 0.012, -0.88);
  add(B(0.03, 0.13, 0.07), dark, 0, -0.1, -0.06, 0.18);
  add(B(0.035, 0.09, 0.045), wood, 0, -0.075, 0.12, -0.35);
  add(B(0.035, 0.035, 0.3), wood, 0, 0.0, 0.3, 0.05);
  add(B(0.035, 0.03, 0.32), wood, 0, -0.085, 0.3, -0.12);
  add(B(0.036, 0.13, 0.04), wood, 0, -0.045, 0.44);
  add(B(0.03, 0.035, 0.12), wood, 0, 0.035, 0.24);
  add(C(0.021, 0.021, 0.26), dark, -0.012, 0.075, -0.05);
  add(C(0.027, 0.021, 0.06), dark, -0.012, 0.075, -0.2);
  add(C(0.025, 0.021, 0.07), dark, -0.012, 0.075, 0.11);
  add(C(0.024, 0.024, 0.005), glass, -0.012, 0.075, -0.232);
  add(B(0.03, 0.035, 0.08), metal, -0.01, 0.04, -0.04);
  arms(g, [0, -0.075, 0.12], [0, -0.045, -0.36]);
  g.userData.muzzle = new THREE.Vector3(0, 0.012, -0.93);
  g.userData.sight = new THREE.Vector3(-0.012, 0.075, 0);
  return g;
}

// Stand-in machine gun (PKM-like) if the M60 model is missing: long barrel, carry handle, box on the left.
function proceduralPKM() {
  const g = new THREE.Group();
  const metal = M(0x232527, 0.42, 0.85), dark = M(0x121314, 0.6, 0.5), wood = M(0x5a3319, 0.55), olive = M(0x3c4430, 0.8, 0.2), brass = M(0xc9a13b, 0.35, 0.9);
  const add = (geo, mat, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); g.add(m); return m; };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const C = (r, len) => new THREE.CylinderGeometry(r, r, len, 12).rotateX(Math.PI / 2);
  add(B(0.06, 0.075, 0.42), metal, 0, 0, -0.05);            // receiver
  add(B(0.066, 0.02, 0.2), metal, 0, 0.047, -0.05);         // feed cover
  add(C(0.014, 0.62), dark, 0, 0.01, -0.58);                // barrel
  add(C(0.022, 0.1), dark, 0, 0.01, -0.93);                 // flash hider
  add(B(0.012, 0.05, 0.012), dark, 0, 0.045, -0.82);        // front sight
  add(B(0.02, 0.07, 0.02), dark, 0, 0.055, -0.4);           // carry handle post
  add(B(0.02, 0.012, 0.14), dark, 0, 0.09, -0.4);           // carry handle
  add(B(0.03, 0.03, 0.06), dark, 0, -0.03, -0.62);          // gas block
  add(B(0.035, 0.1, 0.045), wood, 0, -0.085, 0.1, -0.35);   // pistol grip
  add(B(0.04, 0.05, 0.3), wood, 0, -0.01, 0.34, 0.06);      // stock
  add(B(0.042, 0.13, 0.05), wood, 0, -0.04, 0.5);           // butt plate
  add(B(0.1, 0.13, 0.13), olive, -0.075, -0.1, -0.1);       // 100-round box on the left
  for (let i = 0; i < 6; i++) add(B(0.012, 0.012, 0.03), brass, -0.03 + i * 0.008, -0.03 + i * 0.012, -0.1, 0, -0.6); // belt
  add(B(0.012, 0.04, 0.01), dark, -0.03, -0.045, -0.75, 0.9); // bipod legs folded
  add(B(0.012, 0.04, 0.01), dark, 0.03, -0.045, -0.75, 0.9);
  arms(g, [0, -0.085, 0.1], [0, -0.06, -0.42]);
  g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.99);
  g.userData.sight = new THREE.Vector3(0, 0.07, 0);
  return g;
}

// Combat knife in the right hand.
function proceduralKnife() {
  const g = new THREE.Group();
  const steel = M(0xb8bcc0, 0.22, 1.0), grip = M(0x1c1d1e, 0.7, 0.1), guard = M(0x3a3b3c, 0.4, 0.8);
  const blade = new THREE.Shape();
  blade.moveTo(0, 0); blade.lineTo(0.2, 0.004); blade.quadraticCurveTo(0.23, 0.01, 0.2, 0.03); blade.lineTo(0, 0.032); blade.lineTo(0, 0);
  const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.004, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 });
  bg.rotateY(Math.PI / 2); bg.translate(0, -0.016, 0);
  const b = new THREE.Mesh(bg, steel); b.position.set(0, 0, -0.1); g.add(b);
  const h = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.12, 10).rotateX(Math.PI / 2), grip); h.position.set(0, 0, 0.0); g.add(h);
  const gd = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.012), guard); gd.position.set(0, 0, -0.065); g.add(gd);
  arms(g, [0, -0.02, 0.02], null);
  g.userData.muzzle = new THREE.Vector3(0, 0, -0.3);
  return g;
}

// Carbon arrow: broadhead at the origin pointing -z, shaft and fletching behind it (+z). ~0.8 m.
function arrowGeometry() {
  const colored = (geo, hex) => {
    const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return geo.index ? geo.toNonIndexed() : geo;
  };
  const parts = [];
  parts.push(colored(new THREE.ConeGeometry(0.01, 0.05, 3).rotateX(-Math.PI / 2).translate(0, 0, 0.025), 0xb7bcc2));
  parts.push(colored(new THREE.CylinderGeometry(0.0045, 0.0045, 0.72, 6).rotateX(Math.PI / 2).translate(0, 0, 0.41), 0x18191b));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const v = new THREE.BoxGeometry(0.0015, 0.024, 0.085).translate(0, 0.016, 0.7).rotateZ(a);
    parts.push(colored(v, i === 0 ? 0xff5a1f : 0xf2f2ea));
  }
  parts.push(colored(new THREE.CylinderGeometry(0.0055, 0.0055, 0.02, 6).rotateX(Math.PI / 2).translate(0, 0, 0.78), 0xff5a1f));
  return mergeGeometries(parts);
}

// F-1 "limonka" fragmentation grenade: segmented olive body, UZRGM fuse, lever and pin ring.
function grenadeMesh() {
  const g = new THREE.Group();
  const olive = M(0x4a5630, 0.75, 0.25), steel = M(0x8c9196, 0.35, 0.9);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8).scale(1, 1.3, 1), olive);
  g.add(body);
  for (let i = 0; i < 3; i++) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.0285, 0.003, 4, 14), olive); band.rotation.x = Math.PI / 2; band.position.y = (i - 1) * 0.018; g.add(band); }
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.026, 8), steel); fuse.position.y = 0.045; g.add(fuse);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.055, 0.012), steel); lever.position.set(0.017, 0.028, 0); lever.rotation.z = 0.22; g.add(lever);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0016, 5, 14), steel); ring.position.set(-0.016, 0.052, 0); g.add(ring);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// A thin cylinder stretched between two points (bow strings).
const Y_UP = new THREE.Vector3(0, 1, 0);
function stretch(mesh, a, b) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(Y_UP, d.divideScalar(len || 1));
  mesh.scale.set(1, len, 1);
}

// Compound bow, held upright in the left hand (gloved), arrow nocked, string drawn by the right hand.
// Holder space: the grip sits low and left, the pin sight just right of the riser at eye level.
function proceduralBow(arrowGeo, arrowMat) {
  const g = new THREE.Group(), add = builder(g);
  const riser = M(0x1c1d20, 0.42, 0.65), limb = M(0x3b3f30, 0.6, 0.15), cam = M(0x9aa0a6, 0.3, 0.95), cord = M(0x101010, 0.85, 0.0);
  const glove = M(0x2b2c2a, 0.85), sleeve = M(0x3f4a3a, 0.9), fiber = new THREE.MeshBasicMaterial({ color: 0x9cff3a, toneMapped: false });
  const R = new THREE.Vector3(-0.06, -0.13, -0.56);     // grip centre
  const restY = R.y + 0.1;
  add(BOX(0.026, 0.56, 0.034), riser, R.x, R.y + 0.08, R.z - 0.01);
  add(BOX(0.03, 0.11, 0.046), M(0x111111, 0.9), R.x, R.y, R.z + 0.012);                 // grip
  add(BOX(0.024, 0.1, 0.03), riser, R.x, R.y + 0.37, R.z - 0.03, -0.35);                 // riser tips flare forward
  add(BOX(0.024, 0.1, 0.03), riser, R.x, R.y - 0.2, R.z - 0.03, 0.35);
  const top = new THREE.Vector3(R.x, R.y + 0.5, R.z + 0.07), bot = new THREE.Vector3(R.x, R.y - 0.33, R.z + 0.07);
  for (const sd of [-1, 1]) {                                                              // split limbs
    add(BOX(0.011, 0.19, 0.016), limb, R.x + sd * 0.011, R.y + 0.43, R.z + 0.02, 0.5);
    add(BOX(0.011, 0.19, 0.016), limb, R.x + sd * 0.011, R.y - 0.26, R.z + 0.02, -0.5);
  }
  const wheel = new THREE.CylinderGeometry(0.034, 0.034, 0.012, 18).rotateZ(Math.PI / 2);
  add(wheel, cam, top.x, top.y, top.z); add(wheel, cam, bot.x, bot.y, bot.z);
  add(CYL(0.008, 0.008, 0.26), riser, R.x, R.y - 0.07, R.z - 0.15);                     // stabiliser
  add(CYL(0.018, 0.018, 0.05), riser, R.x, R.y - 0.07, R.z - 0.29);
  add(BOX(0.006, 0.012, 0.02), riser, R.x + 0.012, restY - 0.007, R.z);                 // arrow rest
  // pin sight: a ring with three fibre-optic pins, just right of the riser
  const sightC = new THREE.Vector3(R.x + 0.05, restY + 0.06, R.z - 0.03);
  add(BOX(0.05, 0.008, 0.012), riser, R.x + 0.025, sightC.y, sightC.z);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0026, 6, 24), riser); ring.position.copy(sightC); g.add(ring);
  for (let i = 0; i < 3; i++) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.0012, 0.002), riser); pin.position.set(sightC.x - 0.008, sightC.y + 0.008 - i * 0.008, sightC.z); g.add(pin);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 6, 4), i === 0 ? fiber : new THREE.MeshBasicMaterial({ color: i === 1 ? 0xffe23a : 0xff3a2a, toneMapped: false }));
    tip.position.set(sightC.x - 0.001, sightC.y + 0.008 - i * 0.008, sightC.z); g.add(tip);
  }
  // strings (updated every frame) and the cables
  const cyl = new THREE.CylinderGeometry(0.0012, 0.0012, 1, 4);
  const s1 = new THREE.Mesh(cyl, cord), s2 = new THREE.Mesh(cyl, cord), cable = new THREE.Mesh(cyl, cord);
  g.add(s1, s2, cable);
  stretch(cable, new THREE.Vector3(top.x + 0.01, top.y - 0.03, top.z + 0.02), new THREE.Vector3(bot.x + 0.01, bot.y + 0.03, bot.z + 0.02));
  const arrow = new THREE.Mesh(arrowGeo, arrowMat);
  g.add(arrow);
  // gloved left hand round the grip, forearm back towards the lower left of the view
  add(BOX(0.05, 0.095, 0.064), glove, R.x + 0.004, R.y - 0.003, R.z + 0.03);
  add(BOX(0.02, 0.03, 0.05), glove, R.x + 0.028, R.y + 0.03, R.z + 0.035, 0, 0, -0.4);   // thumb
  add(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 10), sleeve, R.x - 0.06, R.y - 0.12, R.z + 0.24, 1.15, 0.55, 0);
  const hand = new THREE.Group();
  hand.add(new THREE.Mesh(BOX(0.045, 0.07, 0.065), glove));
  const hf = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.42, 10), sleeve); hf.position.set(0.1, -0.05, 0.16); hf.rotation.set(1.2, 0.9, 0); hand.add(hf);
  g.add(hand);
  g.userData.bow = {
    top: top.clone().add(new THREE.Vector3(0, -0.03, 0.03)), bot: bot.clone().add(new THREE.Vector3(0, 0.03, 0.03)),
    rest: new THREE.Vector3(R.x + 0.006, restY, R.z),
    nockRest: new THREE.Vector3(R.x + 0.004, restY - 0.004, R.z + 0.2), nockFull: new THREE.Vector3(-0.03, -0.045, 0.04),
    strings: [s1, s2], arrow, hand,
  };
  g.userData.muzzle = new THREE.Vector3(R.x, restY, R.z - 0.3);
  g.userData.sight = new THREE.Vector3(sightC.x - 0.002, sightC.y - 0.018, 0);
  return g;
}

export class Weapons {
  constructor(game) {
    this.g = game;
    this.vmScene = new THREE.Scene();
    this.vmCam = new THREE.PerspectiveCamera(56, innerWidth / innerHeight, 0.01, 10);
    this.vmHemi = new THREE.HemisphereLight(0xdfe7f2, 0x6a5a48, 0.9);
    this.vmSun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.vmScene.add(this.vmHemi, this.vmSun, this.vmSun.target);
    this.holder = new THREE.Group();
    this.vmScene.add(this.holder);
    // start with the Makarov, an AK-74, the knife and two grenades; the rest is bought at the shops
    this.owned = {
      pistol: { mag: DEFS.pistol.mag, reserve: DEFS.pistol.reserve },
      rifle: { mag: DEFS.rifle.mag, reserve: 90 },
      knife: { mag: 0, reserve: 0 },
    };
    this.grenades = 2;
    this.current = 'pistol';
    this.cool = 0;
    this.reloading = 0;
    this.shellLoading = false;
    this.switching = 0;
    this.kick = 0;
    this.bloomNow = 0;
    this.sprayDrift = 0;
    this.burst = 0;
    this.sway = new THREE.Vector2();
    this.knifeT = 0; this.knifeDur = 0.5; this.knifeHeavy = false;
    this.throwT = 0; this.thrown = true;
    this.drawT = 0; this.nockT = 0; this.fullT = 0;
    this.views = {};
    this.flash = this.makeFlash();
    this.shots = 0;
    this.instaKill = 0;
    this.stats = { shots: 0, hits: 0, heads: 0 };
    this.onHit = null;
    this.onShoot = null;
    this.ignoreItems = null; // collider items bullets pass through (the car you're sitting in)
    this.arrows = [];
    this.nades = [];
    this.projSeq = 0;          // ids for arrows and grenades (co-op: the same id on every screen)
    this.arrowGeo = arrowGeometry();
    this.arrowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 });
    this.nadeTemplate = grenadeMesh();
    this.tmpDir = new THREE.Vector3();
  }

  get order() { return Object.keys(DEFS).filter((k) => this.owned[k]).sort((a, b) => DEFS[a].slot - DEFS[b].slot); }

  makeFlash() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.25, 'rgba(255,200,90,0.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    s.scale.setScalar(0.18);
    s.visible = false;
    return s;
  }

  // Viewmodels: downloaded first-person rigs where we have them, otherwise built in code.
  setup(models) {
    const w = models.weapons || {};
    const fromGLTF = (kind, file, clips) => {
      const gltf = w[file];
      if (!gltf) return false;
      const root = new THREE.Group(), s = gltf.scene;
      root.add(s);
      const mixer = new THREE.AnimationMixer(s);
      const acts = {};
      for (const [k, re] of Object.entries(clips)) { const c = gltf.animations.find((a) => re.test(a.name)); if (c) acts[k] = mixer.clipAction(c); }
      if (acts.shoot) acts.shoot.setLoop(THREE.LoopOnce, 1);
      if (acts.reload) { acts.reload.setLoop(THREE.LoopOnce, 1); acts.reload.clampWhenFinished = true; }
      if (acts.idle) acts.idle.play();
      let skinned = false;
      s.traverse((o) => {
        if (o.isMesh) {
          o.frustumCulled = false; o.castShadow = false;
          // (some exports mark the whole gun as alpha-blended: it draws see-through; cut out instead)
          for (const m of [].concat(o.material)) if (m.transparent && !/glass|lens/i.test(m.name || '')) { m.transparent = false; m.alphaTest = 0.5; m.depthWrite = true; }
        }
        if (o.isSkinnedMesh) skinned = true;
      });
      root.visible = false;
      this.holder.add(root);
      // rig: first-person arms authored for a camera at the origin looking down -Z (use as is)
      // bare: a gun on its own, origin at the grip, muzzle +X (we add hands)
      const rig = /_fps$/.test(file);
      this.views[kind] = { root, model: s, mixer, acts, gltf: true, rig, bare: !rig && !/arms/i.test(file), fov: rig ? 70 : null };
      return true;
    };
    const fromCode = (kind, model) => {
      const root = new THREE.Group();
      root.add(model); root.visible = false; this.holder.add(root);
      this.views[kind] = { root, model, gltf: false, sight: model.userData.sight, muzzle: model.userData.muzzle };
    };
    const clips = { idle: /idle/i, shoot: /shoot|fire/i, reload: /reload/i };
    if (!fromGLTF('pistol', 'fps_arms_pistol', clips)) fromCode('pistol', proceduralGun('pistol'));
    if (!fromGLTF('deagle', 'deagle', clips)) fromCode('deagle', proceduralDeagle());
    if (!fromGLTF('rifle', 'fps_arms_akm', clips)) fromCode('rifle', proceduralGun('rifle'));
    if (!fromGLTF('m4', 'm4', clips)) fromCode('m4', proceduralM4());
    if (!fromGLTF('shotgun', 'shotgun_mossberg', clips)) fromCode('shotgun', proceduralGun('shotgun'));
    fromCode('sniper', proceduralSVD());
    if (!fromGLTF('autosniper', 'autosniper', clips)) fromCode('autosniper', proceduralSCAR());
    if (!fromGLTF('mg', 'mg', clips)) fromCode('mg', proceduralPKM());
    if (!(w.bow && this.setupBowModel(w.bow))) fromCode('bow', proceduralBow(this.arrowGeo, this.arrowMat));
    if (!fromGLTF('knife', 'knife_fps', { idle: /idle/i, slash: /slash/i, stab: /stab/i, draw: /draw/i })
      && !fromGLTF('knife', 'knife', { idle: /idle/i })) fromCode('knife', proceduralKnife());
    for (const a of ['slash', 'stab', 'draw']) { const act = this.views.knife.acts?.[a]; if (act) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = false; } }
    // the thrown grenade: the downloaded frag if we have it (a real one is ~11 cm tall)
    if (w.grenade) {
      const m = w.grenade.scene.clone(true);
      const b = new THREE.Box3().setFromObject(m), k = 0.115 / Math.max(0.01, b.max.y - b.min.y);
      m.scale.setScalar(k);
      m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const holder = new THREE.Group(); holder.add(m);
      this.nadeTemplate = holder;
    }
    this.fitViews();
    this.holder.add(this.flash);
    this.equip('pistol', true);
  }

  // The authored compound bow: skinned string driven by its Draw clip, arrow on the nock point.
  // Arrow direction +X in the file; the grip sits at the origin.
  setupBowModel(gltf) {
    const s = gltf.scene, draw = gltf.animations.find((a) => /^draw$/i.test(a.name));
    const nock = s.getObjectByName('ArrowNockPoint');
    if (!draw || !nock) return false;
    const R = new THREE.Vector3(-0.06, -0.12, -0.56);
    const root = new THREE.Group();
    s.rotation.y = Math.PI / 2;
    s.position.copy(R);
    root.add(s);
    s.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
    const mixer = new THREE.AnimationMixer(s);
    const act = mixer.clipAction(draw);
    act.play(); act.paused = true; act.time = 0;
    mixer.update(0);
    root.updateMatrixWorld(true);
    // the green sight pin is the aiming point
    let pin = null;
    s.traverse((o) => { if (!pin && o.isMesh && /sightpin_green/i.test([].concat(o.material)[0].name || '')) pin = o; });
    const sight = new THREE.Vector3();
    if (pin) { new THREE.Box3().setFromObject(pin).getCenter(sight); root.worldToLocal(sight); } else sight.set(R.x + 0.04, R.y + 0.16, 0);
    const arrow = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    root.add(arrow);
    // gloved bow hand round the grip, drawing hand on the nock
    const hands = new THREE.Group();
    arms(hands, null, [0, 0, 0]);
    hands.position.set(R.x + 0.005, R.y - 0.01, R.z + 0.03);
    hands.rotation.set(0, 0, Math.PI / 2);
    root.add(hands);
    const hand = new THREE.Group();
    arms(hand, [0, 0, 0], null);
    root.add(hand);
    root.visible = false;
    this.holder.add(root);
    this.views.bow = {
      // aim along the arrow: its rest (just right of the riser) comes to the middle of the view
      root, model: s, mixer, acts: {}, gltf: true, sight: new THREE.Vector3(R.x + 0.016, R.y + 0.062, 0), muzzle: new THREE.Vector3(R.x, R.y + 0.1, R.z - 0.3),
      bowRig: { act, nock, arrow, hand, rest: new THREE.Vector3(R.x, R.y + 0.08, R.z) },
    };
    return true;
  }

  // Scale/orient the GLB viewmodels: barrel down -Z, sized like the real thing.
  fitViews() {
    const lengths = { pistol: 0.55, deagle: 0.27, rifle: 1.0, m4: 0.84, shotgun: 0.98, autosniper: 1.05, mg: 1.15, knife: 0.4 };
    for (const [kind, v] of Object.entries(this.views)) {
      if (!v.gltf) { v.muzzle = v.model.userData.muzzle; v.sight = v.model.userData.sight || v.sight; continue; }
      if (v.bowRig) continue;
      if (v.rig) { v.muzzle = new THREE.Vector3(0.1, -0.1, -0.5); continue; }
      if (v.bare) { this.fitBare(kind, v, lengths[kind]); continue; }
      v.model.rotation.y = (VIEW_YAW[kind] ?? Math.PI / 2);
      v.model.updateMatrixWorld(true);
      if (v.mixer) v.mixer.update(0.01);
      v.model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(v.model, true);
      const size = box.getSize(new THREE.Vector3());
      v.model.scale.multiplyScalar(lengths[kind] / Math.max(size.x, size.y, size.z));
      v.model.updateMatrixWorld(true);
      const c = new THREE.Box3().setFromObject(v.model, true).getCenter(new THREE.Vector3());
      v.model.position.sub(c);
      v.model.updateMatrixWorld(true);
      let gunBox = null, bestZ = Infinity;
      v.model.traverse((o) => {
        if (!o.isMesh) return;
        const b = new THREE.Box3().setFromObject(o, true);
        if (b.min.z < bestZ) { bestZ = b.min.z; gunBox = b; }
      });
      if (gunBox) {
        const gc = gunBox.getCenter(new THREE.Vector3());
        v.sight = new THREE.Vector3(gc.x, gunBox.max.y, gc.z);
        v.muzzle = new THREE.Vector3(gc.x, gc.y + 0.02, gunBox.min.z);
      } else v.muzzle = new THREE.Vector3(0, 0.03, -lengths[kind] * 0.5);
    }
  }

  // A gun on its own (origin at the pistol grip, muzzle +X, up +Y): turn the muzzle down -Z, scale
  // it to the real length, keep the grip at the holder origin like the code-built guns, add hands.
  fitBare(kind, v, length) {
    const m = v.model;
    m.rotation.y = Math.PI / 2;
    m.position.set(0, 0, 0);
    m.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(m, true);
    const size = box.getSize(new THREE.Vector3());
    m.scale.multiplyScalar(length / Math.max(size.x, size.y, size.z));
    m.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(m, true);
    const pistol = length < 0.4;
    // Long guns don't always have their origin at the grip (the Mossberg's is 16 cm above it): find
    // the pistol grip, from the trigger if the file names one, else from the shape (the lowest part
    // of the back half), and bring it to the hand.
    let forendY = null;
    if (!pistol) {
      v.root.updateMatrixWorld(true);
      const pts = [];
      m.traverse((o) => {
        if (!o.isMesh) return;
        const pos = o.geometry.attributes.position, p = new THREE.Vector3();
        const step = Math.max(1, Math.floor(pos.count / 4000));
        for (let i = 0; i < pos.count; i += step) { p.fromBufferAttribute(pos, i); if (o.isSkinnedMesh) o.applyBoneTransform(i, p); pts.push(v.root.worldToLocal(p.applyMatrix4(o.matrixWorld))); }
      });
      const trig = m.getObjectByName('Trigger');
      let grip;
      if (trig) {
        const t = v.root.worldToLocal(trig.getWorldPosition(new THREE.Vector3()));
        grip = new THREE.Vector3(t.x, t.y - 0.035, t.z + 0.045);
      } else {
        // the grip hangs lowest in the back 45% of the gun, on its centre line (a belt box or a
        // magazine hanging off the side doesn't count)
        const xs = pts.map((q) => q.x).sort((p0, p1) => p0 - p1), cx = xs[Math.floor(xs.length / 2)] || 0;
        const z0 = box.max.z - length * 0.45;
        let low = null;
        for (const q of pts) if (Math.abs(q.x - cx) < 0.015 && q.z > z0 && q.z < box.max.z - length * 0.08 && (!low || q.y < low.y)) low = q;
        grip = low ? new THREE.Vector3(cx, low.y + 0.075, low.z - 0.01) : new THREE.Vector3(0, 0, 0);
      }
      m.position.sub(grip);
      m.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(m, true);
      // where the left hand holds the forend: the underside of the gun there
      const fz = -length * 0.36;
      let under = Infinity;
      for (const q of pts) { const z = q.z - grip.z; if (Math.abs(z - fz) < 0.04 && Math.abs(q.x - grip.x) < 0.05) under = Math.min(under, q.y - grip.y); }
      if (isFinite(under)) forendY = under;
    }
    v.muzzle = new THREE.Vector3(0, (box.max.y + box.min.y) / 2 + (pistol ? 0.03 : 0.02), box.min.z);
    // aim over the top of the gun just in front of the grip
    let top = -Infinity;
    m.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position, p = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 3) {
        p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (p.z < 0.05 && p.z > -0.25 * length && Math.abs(p.x) < 0.03) top = Math.max(top, p.y);
      }
    });
    v.sight = new THREE.Vector3(0, isFinite(top) ? top : box.max.y, 0);
    // named parts: a muzzle attach point for the flash, a slide that cycles when it fires
    const attach = m.getObjectByName('Attach_Muzzle');
    if (attach) v.muzzle = v.root.worldToLocal(attach.getWorldPosition(new THREE.Vector3()));
    const slide = m.getObjectByName('Slide');
    if (slide) { v.slide = slide; v.slideX = slide.position.x; }
    if (pistol) arms(v.root, [0, -0.06, 0.02], [0.012, -0.085, 0.025]);
    else longArms(v.root, [0, -0.07, 0.04], [0, forendY != null ? forendY - 0.012 : -0.045, -length * 0.36]);
  }

  equip(kind, instant = false) {
    if (!this.owned[kind]) return;
    this.adsToggle = false;
    this.current = kind;
    for (const [k, v] of Object.entries(this.views)) v.root.visible = k === kind;
    this.reloading = 0; this.shellLoading = false;
    this.drawT = 0; this.fullT = 0;
    this.switching = instant ? 0 : (kind === 'mg' ? 0.6 : kind === 'knife' ? 0.2 : 0.35);
    this.cool = this.switching; // the last gun's cycle time doesn't carry over
    this.bloomNow = 0; this.burst = 0;
    this.g.hud?.weapon(this.def, this.ammo);
    this.g.hud?.slots(this.owned, this.current);
    const v = this.views[kind];
    if (v && v.rig && !instant) this.rigPlay(v, 'draw', 0.3);
  }

  give(kind) {
    const d = DEFS[kind];
    if (!this.owned[kind]) this.owned[kind] = { mag: d.mag, reserve: d.reserve };
    else { this.owned[kind].mag = d.mag; this.owned[kind].reserve = d.reserve; }
    this.equip(kind);
  }

  refillAll() {
    for (const k of Object.keys(this.owned)) { if (DEFS[k].melee) continue; this.owned[k].mag = DEFS[k].mag; this.owned[k].reserve = DEFS[k].reserve; }
    this.grenades = MAX_GRENADES;
    this.g.hud?.weapon(this.def, this.ammo);
    this.g.hud?.grenades(this.grenades);
  }

  // An ammo box: a couple of magazines for every gun you carry, arrows and a grenade.
  topUp() {
    let any = false;
    for (const k of Object.keys(this.owned)) {
      const d = DEFS[k], a = this.owned[k];
      if (d.melee) continue;
      const add = d.bow ? 6 : d.pump ? 14 : Math.max(d.mag * 2, 20);
      const cap = d.reserve;
      if (a.reserve < cap) { a.reserve = Math.min(cap, a.reserve + add); any = true; }
    }
    if (this.grenades < MAX_GRENADES) { this.grenades++; any = true; }
    this.g.hud?.weapon(this.def, this.ammo);
    this.g.hud?.grenades(this.grenades);
    return any;
  }

  get def() { return DEFS[this.current]; }
  get ammo() { return this.owned[this.current]; }

  update(dt, input, canAct) {
    const p = this.g.player;
    const def = this.def, ammo = this.ammo, view = this.views[this.current];
    this.cool -= dt;
    if (this.switching > 0) this.switching -= dt;
    if (this.knifeT > 0) {
      this.knifeT -= dt;
      if (!this.knifeHit && this.knifeT < this.knifeDur * 0.55) { this.knifeHit = true; this.knifeStrike(this.knifeHeavy); }
    }
    if (this.throwT > 0) {
      this.throwT -= dt;
      if (!this.thrown && this.throwT < THROW_TIME - 0.24) { this.thrown = true; this.releaseGrenade(); }
    }
    if (this.rigT > 0) {
      this.rigT -= dt;
      if (this.rigT <= 0 && this.rigAct) {
        const idle = view.acts && view.acts.idle;
        this.rigAct.fadeOut(0.15);
        if (idle) idle.reset().fadeIn(0.15).play();
        this.rigAct = null;
      }
    }
    // recoil recovery and bloom decay
    this.bloomNow = Math.max(0, this.bloomNow - (def.recover || 0.1) * dt);
    if (!input.mouse.left) { this.burst = Math.max(0, this.burst - dt * 6); this.sprayDrift *= Math.exp(-dt * 4); }
    p.speedWeapon = def.move ?? 1;

    if (canAct && !p.dead) {
      // number keys pick a category (again: next gun in it), Q / wheel cycle everything you own
      for (const [code, kinds] of Object.entries(CATS)) {
        if (!input.hit(code)) continue;
        const own = kinds.filter((k) => this.owned[k]);
        const missing = kinds.find((k) => !this.owned[k]);
        const i = own.indexOf(this.current);
        const next = own.length ? (i < 0 ? own[0] : own[(i + 1) % own.length]) : null;
        if (next && next !== this.current) this.equip(next);
        else if (missing) this.g.hud?.notice(`${DEFS[missing].name}: buy it ${WHERE[missing]} (${DEFS[missing].price} points)`);
      }
      const order = this.order;
      const step = input.hit('KeyQ') ? 1 : input.mouse.wheel ? Math.sign(input.mouse.wheel) : 0;
      if (step && order.length > 1) this.equip(order[(order.indexOf(this.current) + step + order.length) % order.length]);
      if (input.hit('KeyG')) this.throwGrenade();

      if (def.melee) {
        p.ads = THREE.MathUtils.damp(p.ads, 0, 12, dt);
        if (this.knifeT <= 0 && this.switching <= 0 && this.throwT <= 0) {
          if (input.mouse.leftPressed) this.swing(false);
          else if (input.mouse.right && !this.rightHeld) this.swing(true);
        }
        this.rightHeld = input.mouse.right;
      } else if (def.bow) {
        this.updateBow(dt, input, ammo);
      } else {
        if (input.hit('KeyE')) this.adsToggle = !this.adsToggle;
        if (p.sprinting) this.adsToggle = false;
        const aiming = (input.mouse.right || this.adsToggle) && !p.sprinting && (this.reloading <= 0 || this.shellLoading) && this.throwT <= 0;
        p.ads = THREE.MathUtils.damp(p.ads, aiming ? 1 : 0, def.scope ? 10 : def.move < 0.9 ? 8 : 14, dt);
        if (def.scope && p.ads > 0.9) {
          this.breath = input.down('ShiftLeft') ? Math.max(0, (this.breath ?? 4) - dt) : Math.min(4, (this.breath ?? 4) + dt * 0.8);
          const steady = input.down('ShiftLeft') && this.breath > 0 ? 0.12 : 1;
          const t = performance.now() / 1000;
          p.yaw += Math.sin(t * 0.9) * 0.00022 * steady; p.pitch += Math.sin(t * 1.3 + 1) * 0.00018 * steady;
        }
        // reload (R, or automatically when the magazine runs dry)
        const canReload = ammo.mag < def.mag + (def.chamber && ammo.mag > 0 ? 1 : 0) && ammo.reserve > 0;
        if ((input.hit('KeyR') || (ammo.mag === 0 && this.cool <= 0)) && this.reloading <= 0 && canReload && this.throwT <= 0) this.startReload();
        if (input.hit('KeyV') && this.knifeT <= 0 && this.throwT <= 0) this.swing(false, true);
        const trigger = def.auto ? input.mouse.left : input.mouse.leftPressed;
        // the pump shotgun can fire mid-reload (stops loading)
        if (trigger && this.shellLoading && ammo.mag > 0) { this.reloading = 0; this.shellLoading = false; this.cool = 0.15; }
        if (trigger && this.cool <= 0 && this.switching <= 0 && this.reloading <= 0 && this.knifeT <= 0 && this.throwT <= 0 && !p.sprinting) {
          if (ammo.mag > 0) this.fire();
          else if (input.mouse.leftPressed) { this.g.audio.play('empty'); this.cool = 0.25; }
        }
      }
    } else {
      p.ads = THREE.MathUtils.damp(p.ads, 0, 10, dt);
      this.drawT = 0; this.fullT = 0;
    }

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.shellLoading) {
        // shell-by-shell: each tick of shellTime loads one
        if (this.reloading <= 0) {
          if (ammo.mag < def.mag && ammo.reserve > 0) {
            ammo.mag++; ammo.reserve--;
            this.g.audio.play('shellIn', { vol: 0.75 });
            this.g.hud?.weapon(def, ammo);
            if (ammo.mag < def.mag && ammo.reserve > 0) this.reloading = def.shellTime;
            else { this.shellLoading = false; this.g.audio.play('pump', { vol: 0.8 }); this.cool = 0.35; }
          } else this.shellLoading = false;
        }
      } else if (this.reloading <= 0) {
        // magazine swap: keep the chambered round on a tactical reload
        const cap = def.mag + (def.chamber && this.reloadWasTactical ? 1 : 0);
        const take = Math.min(cap - ammo.mag, ammo.reserve);
        ammo.mag += take; ammo.reserve -= take;
        this.g.hud?.weapon(def, ammo);
      }
    }
    this.updateGrenades(dt);
    this.updateArrows(dt);
    this.animateView(dt, input, view);
  }

  // ---------------- bow ----------------
  updateBow(dt, input, ammo) {
    const p = this.g.player, def = this.def;
    if (input.hit('KeyE')) this.adsToggle = !this.adsToggle;
    if (input.hit('KeyV') && this.knifeT <= 0 && this.drawT <= 0 && this.throwT <= 0) this.swing(false, true);
    if (ammo.mag === 0 && ammo.reserve > 0 && this.nockT <= 0) this.nockT = 0.55;
    if (this.nockT > 0) {
      this.nockT -= dt;
      if (this.nockT <= 0 && ammo.mag === 0 && ammo.reserve > 0) { ammo.mag = 1; ammo.reserve--; this.g.hud?.weapon(def, ammo); }
    }
    const nocked = ammo.mag > 0;
    const canDraw = nocked && this.switching <= 0 && this.knifeT <= 0 && this.throwT <= 0 && !p.sprinting;
    if (input.mouse.left && canDraw) {
      if (this.drawT === 0) this.g.audio.play('bowDraw', { vol: 0.55 });
      this.drawT = Math.min(def.drawTime, this.drawT + dt);
      if (this.drawT >= def.drawTime) this.fullT += dt;
    } else if (this.drawT > 0) {
      if (nocked && !p.sprinting && this.drawT > 0.12) this.shootArrow(this.drawT / def.drawTime);
      this.drawT = 0; this.fullT = 0;
    } else if (input.mouse.leftPressed && !nocked && ammo.reserve === 0) this.g.audio.play('empty');
    if (p.sprinting) this.adsToggle = false;
    const aiming = (this.drawT > 0.1 || input.mouse.right || this.adsToggle) && !p.sprinting;
    p.ads = THREE.MathUtils.damp(p.ads, aiming ? 1 : 0, 9, dt);
    // holding at full draw gets shaky after a few seconds
    if (this.fullT > 3) {
      const t = performance.now() / 1000, s = Math.min(1, (this.fullT - 3) / 3);
      p.yaw += Math.sin(t * 7) * 0.0007 * s; p.pitch += Math.cos(t * 9) * 0.0006 * s;
    }
  }

  shootArrow(k) {
    const g = this.g, p = g.player, def = this.def, ammo = this.ammo;
    ammo.mag = 0;
    this.shots++; this.stats.shots++;
    const cam = g.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const spread = THREE.MathUtils.lerp(0.035, THREE.MathUtils.lerp(def.spread, def.adsSpread, p.ads), k) * (p.moving ? 2 : 1) * (p.onGround || p.vehicle ? 1 : 2);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    const speed = THREE.MathUtils.lerp(def.speedMin, def.speedMax, k);
    const pos = origin.clone().addScaledVector(up, -0.03);
    const vel = dir.clone().multiplyScalar(speed), dmg = def.dmg * (0.2 + 0.8 * k * k), pierce = k > 0.85 ? 1 : 0;
    const slot = g.localSlot ?? 0, id = this.nextProjId(slot);
    // co-op: on a client the host flies the real arrow; this one is for show (and to pick up again)
    this.spawnArrow(pos, vel, { dmg, pierce, by: slot, id, mine: true, visual: g.mode === 'client' });
    if (g.mode === 'client') g.net.arrow(id, pos, vel, dmg, pierce);
    else if (g.mode === 'host') g.net.arrowFx(id, pos, vel, slot);
    g.audio.play('bow', { vol: 0.9 });
    p.kick(0.25, (Math.random() - 0.5) * 0.2);
    this.kick = 0.3;
    this.nockT = 0.55;
    g.hud?.weapon(def, ammo);
    if (this.onShoot) this.onShoot();
  }

  nextProjId(slot) { this.projSeq = (this.projSeq + 1) & 0xffffff; return slot * 0x1000000 + this.projSeq; }

  // an arrow in flight: real (it hits zombies, credited to `by`) or visual (walls only)
  spawnArrow(pos, vel, { dmg = 0, pierce = 0, by = 0, id = 0, mine = false, visual = false } = {}) {
    const mesh = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(FWD, this.tmpDir.copy(vel).normalize());
    this.g.scene.add(mesh);
    this.arrows.push({ pos: pos.clone(), vel: vel.clone(), mesh, t: 0, stuck: false, dmg, pierce, hit: [], by, id, mine, visual });
    // keep the world tidy: the oldest stuck arrows go first
    if (this.arrows.length > 40) { const i = this.arrows.findIndex((q) => q.stuck); if (i >= 0) this.removeArrow(i); }
  }

  removeArrow(i) {
    const a = this.arrows[i];
    this.g.scene.remove(a.mesh);
    this.arrows.splice(i, 1);
  }

  removeArrowById(id) {
    const i = this.arrows.findIndex((a) => a.id === id && !a.stuck);
    if (i >= 0) this.removeArrow(i);
  }

  updateArrows(dt) {
    const g = this.g, p = g.player;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.t += dt;
      if (a.stuck) {
        // walk over a stuck arrow to take it back
        if (a.mine && this.owned.bow && !p.vehicle && Math.abs(a.pos.x - p.pos.x) < 1.1 && Math.abs(a.pos.z - p.pos.z) < 1.1 && a.pos.y - p.pos.y < 2.2 && a.pos.y - p.pos.y > -0.8
          && this.owned.bow.reserve < DEFS.bow.reserve + 6) {
          this.owned.bow.reserve++;
          g.audio.play('pickup', { vol: 0.25, rate: 1.6 });
          this.removeArrow(i);
          if (this.current === 'bow') g.hud?.weapon(this.def, this.ammo);
          continue;
        }
        if (a.t > 45) this.removeArrow(i);
        continue;
      }
      a.vel.y -= 9.8 * dt;
      const dir = this.tmpDir.copy(a.vel).normalize();
      let remaining = a.vel.length() * dt, removed = false;
      for (let guard = 0; remaining > 0 && guard < 4; guard++) {
        const res = this.trace(a.pos, dir, remaining, a.hit, null, null, a.visual);
        if (res.zombie) {
          const zb = res.zombie;
          const dmg = this.instaKill > 0 ? 1e6 : a.dmg * (res.head ? DEFS.bow.head : 1);
          const killed = g.zombies.damage(zb, dmg, res.point, dir, res.head, 'bow', a.by);
          this.credit(a.by, killed, res.head);
          if (this.onHit) this.onHit(zb, killed, res.head, a.by);
          if (killed && a.pierce > 0) {
            a.pierce--; a.hit.push(zb); a.vel.multiplyScalar(0.7);
            remaining -= res.t; a.pos.copy(res.point).addScaledVector(dir, 0.05);
            continue;
          }
          if (g.mode === 'host') g.net.arrowGone(a.id);
          this.removeArrow(i); removed = true;
          break;
        }
        if (res.point) {
          // it sticks: walls, trees, cars, the ground
          a.stuck = true; a.t = 0;
          a.pos.copy(res.point).addScaledVector(dir, 0.07);
          g.audio.play('arrowHit', { pos: res.point, vol: 0.7 });
          g.effects.emit(res.point, 4, { color: [0.55, 0.52, 0.48], speed: 1.2, spread: 1, up: 0.8, life: 0.4, size: 0.04, dir: res.normal });
          break;
        }
        a.pos.addScaledVector(dir, remaining);
        remaining = 0;
      }
      if (removed) continue;
      a.mesh.position.copy(a.pos);
      if (!a.stuck) a.mesh.quaternion.setFromUnitVectors(FWD, dir);
      if (!a.stuck && (a.t > 8 || a.pos.y < -50)) this.removeArrow(i);
    }
  }

  // ---------------- grenades ----------------
  throwGrenade() {
    const g = this.g;
    if (this.throwT > 0 || this.knifeT > 0) return;
    if (this.grenades <= 0) { g.hud?.notice('No grenades left: ammo boxes and the ammo shops restock them'); g.audio.play('empty'); return; }
    this.grenades--;
    this.throwT = THROW_TIME;
    this.thrown = false;
    this.reloading = 0; this.shellLoading = false; this.drawT = 0; this.fullT = 0;
    g.audio.play('pin', { vol: 0.7 });
    g.hud?.grenades(this.grenades);
  }

  releaseGrenade() {
    const g = this.g, p = g.player, cam = g.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const pos = origin.clone().addScaledVector(fwd, 0.35).addScaledVector(right, 0.1);
    const vel = fwd.clone().multiplyScalar(15.5);
    vel.y += 3.4;
    const pv = p.vehicle ? p.vehicle.vel : p.vel;
    vel.x += pv.x; vel.z += pv.z;
    g.audio.play('throw', { vol: 0.5 });
    // co-op: the host throws the real one (everyone, you included, sees the host's)
    if (g.mode === 'client') { g.net.grenade(pos, vel); return; }
    this.spawnGrenade(pos, vel, { by: g.localSlot ?? 0, id: this.nextProjId(g.localSlot ?? 0) });
  }

  spawnGrenade(pos, vel, { by = 0, id = 0, visual = false, fuse = 3.2 } = {}) {
    const mesh = this.nadeTemplate.clone();
    mesh.position.copy(pos);
    this.g.scene.add(mesh);
    this.nades.push({ pos: pos.clone(), vel: vel.clone(), fuse, mesh, spin: new THREE.Vector2(6 + Math.random() * 8, 4 + Math.random() * 6), rest: false, by, id, visual });
    if (this.g.mode === 'host' && !visual) this.g.net.nadeFx(id, pos, vel);
  }

  removeGrenadeById(id) {
    const i = this.nades.findIndex((n) => n.id === id);
    if (i >= 0) { this.g.scene.remove(this.nades[i].mesh); this.nades.splice(i, 1); }
  }

  floorAt(x, z, y) {
    const pl = this.g.player, gy = this.g.groundAt(x, z, y);
    const r = pl.roofAt(x, z);
    return y >= r - 0.4 ? Math.max(gy, r) : gy;
  }

  updateGrenades(dt) {
    const g = this.g;
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.fuse -= dt;
      if (n.fuse <= 0) {
        g.scene.remove(n.mesh);
        this.nades.splice(i, 1);
        // a visual copy just disappears: the host's blast arrives as an event
        if (!n.visual) g.zombies.explode(n.pos.x, n.pos.y + 0.3, n.pos.z, 7, 700, 85, 'grenade', n.by);
        continue;
      }
      const steps = Math.min(12, Math.ceil((n.vel.length() * dt) / 0.07) || 1), h = dt / steps;
      for (let s = 0; s < steps; s++) {
        n.vel.y -= 12 * h;
        const q = { x: n.pos.x + n.vel.x * h, z: n.pos.z + n.vel.z * h };
        const ny = n.pos.y + n.vel.y * h;
        const ox = q.x, oz = q.z;
        if (g.colliders.resolve(q, 0.06, ny - 0.04, ny + 0.04, 1, NADE_SKIP)) {
          // bounce off walls, cars and trees
          const nx = q.x - ox, nz = q.z - oz, nl = Math.hypot(nx, nz) || 1;
          const vn = (n.vel.x * nx + n.vel.z * nz) / nl;
          if (vn < 0) {
            n.vel.x -= (1.45 * vn * nx) / nl; n.vel.z -= (1.45 * vn * nz) / nl;
            n.vel.x *= 0.75; n.vel.z *= 0.75;
            if (-vn > 2) g.audio.play('clink', { pos: n.pos, vol: Math.min(0.7, -vn / 10) });
          }
        }
        n.pos.set(q.x, ny, q.z);
        const gar = g.underground.at(n.pos.x, n.pos.z, n.pos.y - 0.3);
        if (gar && n.pos.y > gar.ceiling - 0.06) { n.pos.y = gar.ceiling - 0.06; if (n.vel.y > 0) n.vel.y = -n.vel.y * 0.3; }
        const floor = this.floorAt(n.pos.x, n.pos.z, n.pos.y) + 0.035;
        if (n.pos.y < floor) {
          n.pos.y = floor;
          if (n.vel.y < 0) {
            if (n.vel.y < -2.5) g.audio.play('clink', { pos: n.pos, vol: Math.min(0.8, -n.vel.y / 10) });
            // grass and paving soak most of it up: a short hop, then it rolls a little
            n.vel.y = -n.vel.y * 0.22;
            n.vel.x *= 0.42; n.vel.z *= 0.42;
            if (n.vel.y < 0.9) { n.vel.y = 0; n.rest = true; }
          }
        }
      }
      if (n.rest) { const f = Math.exp(-5 * dt); n.vel.x *= f; n.vel.z *= f; }
      n.mesh.position.copy(n.pos);
      if (!n.rest || Math.hypot(n.vel.x, n.vel.z) > 0.3) { n.mesh.rotation.x += n.spin.x * dt; n.mesh.rotation.z += n.spin.y * dt; }
    }
  }

  // ---------------- guns ----------------
  startReload() {
    const def = this.def, ammo = this.ammo, view = this.views[this.current];
    const a = this.g.audio;
    if (def.pump) {
      this.shellLoading = true;
      this.reloading = def.reloadStart + def.shellTime;
      return;
    }
    this.reloadWasTactical = ammo.mag > 0;
    this.reloading = ammo.mag > 0 ? def.reload : (def.reloadEmpty || def.reload);
    if (this.current === 'pistol' || this.current === 'deagle') a.play('reloadPistol', { vol: 0.8, rate: this.current === 'deagle' ? 0.85 : 1 });
    else {
      a.play('reload', { vol: 0.8 });
      if (!this.reloadWasTactical || this.current === 'mg') setTimeout(() => a.play('rack', { vol: 0.8 }), this.reloading * 1000 - 500);
    }
    if (view.acts?.reload) { const act = view.acts.reload; act.reset(); act.timeScale = act.getClip().duration / this.reloading; act.play(); }
  }

  fire() {
    const def = this.def, ammo = this.ammo, g = this.g, p = g.player;
    ammo.mag--;
    this.cool = 60 / def.rpm;
    this.shots++;
    this.stats.shots++;
    this.burst++;
    g.audio.play(def.sound, { vol: def.vol ?? 0.9, rate: def.rate ?? 1 });
    const cam = g.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const moving = p.moving ? (def.scope ? 3 : 1.6) : 1;
    const base = THREE.MathUtils.lerp(def.spread, def.adsSpread, p.ads);
    const spread = (base + this.bloomNow * (1 - p.ads * 0.6)) * moving * (p.onGround || p.vehicle ? 1 : 2.2) * (p.vehicle && Math.abs(p.vehicle.speed || 0) > 3 ? 1.6 : 1);
    this.bloomNow = Math.min(def.bloomMax, this.bloomNow + def.bloom);
    const muzzleWorld = origin.clone().addScaledVector(fwd, 0.6).addScaledVector(right, 0.12).addScaledVector(up, -0.1);
    const dirs = [];
    for (let k = 0; k < def.pellets; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      dirs.push(fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize());
    }
    if (g.mode === 'client') {
      // co-op: the host decides what the bullets hit (it'll send the hit marker); the walls you
      // hit you see straight away
      for (const [k, dir] of dirs.entries()) this.worldImpact(origin, dir, def, k === 0);
      g.net.shoot(this.current, origin, dirs);
    } else {
      const r = this.resolveShot(this.current, origin, dirs, g.localSlot ?? 0, null, this.ignoreItems);
      if (r.hit) { g.hud?.hitmarker(r.kill, r.head); g.audio.play('hit', { vol: 0.45, jitter: 0 }); }
      if (g.mode === 'host') g.net.shotFx(g.localSlot ?? 0, this.current, origin, dirs);
    }
    if (def.tracer && this.shots % (def.tracerEvery || 2) === 0) g.effects.tracer(muzzleWorld, origin.clone().addScaledVector(dirs[0], Math.min(def.range, 120)));
    // brass flies out to the right
    if (def.brass) {
      g.effects.emit(origin.clone().addScaledVector(fwd, 0.35).addScaledVector(right, 0.14).addScaledVector(up, -0.08), 1,
        { color: [0.85, 0.62, 0.2], speed: 2.4, spread: 0.3, up: 0.8, life: 0.9, size: 0.025, gravity: 9.8, dir: right.clone().multiplyScalar(1.2).addScaledVector(up, 0.8) });
      setTimeout(() => g.audio.play('shell', { vol: 0.22 }), 420 + Math.random() * 200);
    }
    if (def.pump) setTimeout(() => g.audio.play('pump', { vol: 0.7 }), 260);
    g.effects.muzzle(origin.clone().addScaledVector(fwd, 0.8));
    // recoil: vertical climb + a sideways walk (biased per gun), softer when aiming or crouched
    const steady = (1 - p.ads * 0.35) * (p.crouch > 0.5 ? 0.75 : 1);
    this.sprayDrift = THREE.MathUtils.clamp(this.sprayDrift + (Math.random() - 0.5 + (def.drift || 0) * 0.5) * def.kickSide, -def.kickSide * 3, def.kickSide * 3);
    p.pitch += def.kickUp * (0.8 + Math.random() * 0.4) * steady * (this.burst > 5 ? 0.8 : 1);
    p.yaw += this.sprayDrift * steady;
    p.kick(def.kickUp * 6 * steady, (Math.random() - 0.5) * def.kickSide * 8);
    this.kick = Math.min(this.kick + (this.current === 'mg' ? 0.25 : this.current === 'deagle' ? 0.7 : 0.35), 1.2);
    this.flash.visible = true;
    this.flashT = 0.04 + (this.current === 'mg' ? 0.01 : 0);
    this.flash.scale.setScalar(def.flash || 0.18);
    this.flash.material.rotation = Math.random() * Math.PI;
    const view = this.views[this.current];
    if (view.acts?.shoot) { const s = view.acts.shoot; s.reset(); s.play(); }
    if (view.slide) view.slideT = 0.09;
    g.hud?.weapon(def, ammo);
    if (this.onShoot) this.onShoot();
  }

  // Where a shot's pellets go, and the damage: a bullet can pass through zombies (pen) and car
  // bodies (penCars), losing damage each time. Runs wherever the zombies are real (solo, the
  // host), for the host's own shots and every client's; rewind puts the zombies back where the
  // shooter saw them.
  resolveShot(key, origin, dirs, slot = 0, rewind = null, ignore = null) {
    const def = DEFS[key], g = this.g;
    const out = { hit: false, kill: false, head: false };
    if (!def || def.melee || def.bow) return out;
    for (const [k, dir] of dirs.entries()) {
      const exclude = [], skip = new Set(ignore || []);
      let o = origin.clone(), range = def.range, mult = 1, travelled = 0;
      for (let pass = 0; pass < 6; pass++) {
        const res = this.trace(o, dir, range, exclude, skip, rewind);
        if (res.zombie) {
          const zb = res.zombie;
          const dist = travelled + res.t;
          const fall = THREE.MathUtils.clamp(1 - (dist - def.falloff) / (def.range - def.falloff), 0.35, 1);
          let dmg = def.dmg * fall * mult * (res.head ? def.head : 1);
          if (this.instaKill > 0) dmg = 1e6;
          const killed = g.zombies.damage(zb, dmg, res.point, dir, res.head, key, slot);
          out.hit = true; out.kill = out.kill || killed; out.head = out.head || res.head;
          if (slot === (g.localSlot ?? 0)) { this.stats.hits++; if (res.head) this.stats.heads++; }
          if (this.onHit) this.onHit(zb, killed, res.head, slot);
          if (!def.pen || exclude.length >= def.pen) break;
          exclude.push(zb); mult *= 0.7;
        } else if (res.point) {
          g.effects.impact(res.point, res.normal, res.surface);
          if (k === 0 || Math.random() < 0.3) g.audio.play(res.surface === 'metal' ? 'metal' : 'concrete', { pos: res.point, vol: 0.5 });
          if (def.penCars && res.item && res.item.kind === 'car' && mult > 0.4) { skip.add(res.item); mult *= 0.6; }
          else break;
        } else break;
        travelled += res.t; range -= res.t;
        o = res.point.clone().addScaledVector(dir, 0.05);
      }
    }
    return out;
  }

  // the dust (and the sound) where a bullet meets the world, zombies aside
  worldImpact(origin, dir, def, loud = true) {
    const res = this.trace(origin, dir, def.range, null, new Set(this.ignoreItems || []), null, true);
    if (!res.point) return;
    this.g.effects.impact(res.point, res.normal, res.surface);
    if (loud || Math.random() < 0.3) this.g.audio.play(res.surface === 'metal' ? 'metal' : 'concrete', { pos: res.point, vol: 0.5 });
  }

  // hit marker + stats for whoever landed the hit (on the host: tell a client)
  credit(slot, killed, head) {
    const g = this.g;
    if (slot === (g.localSlot ?? 0)) {
      this.stats.hits++; if (head) this.stats.heads++;
      g.hud?.hitmarker(killed, head);
      g.audio.play('hit', { vol: 0.45, jitter: 0 });
    } else if (g.mode === 'host') g.net.hitFeedback(slot, killed, head);
  }

  // Hitscan: zombies vs static world vs ground.
  trace(o, d, range, exclude = null, skip = null, rewind = null, noZombies = false) {
    const g = this.g;
    const zh = noZombies ? null : g.zombies.raycast(o, d, range, exclude, rewind);
    const wh = g.colliders.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range, skip && skip.size ? (it) => !skip.has(it) : null);
    let gt = Infinity, ceiling = false;
    // the ground (or the car-park floor, if the shot starts down there)
    const inGar = g.underground.at(o.x, o.z, o.y - 1.5);
    const floor = (x, z, y) => (inGar ? inGar.floor : g.groundAt(x, z, y));
    if (d.y < -0.001) {
      let prev = 0;
      const stepT = Math.min(0.5, range);
      for (let t = stepT; t <= range + 1e-6; t += stepT) {
        const y = o.y + d.y * t, gy = floor(o.x + d.x * t, o.z + d.z * t, y);
        if (y <= gy) {
          let lo = prev, hi = t;
          for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (o.y + d.y * m <= floor(o.x + d.x * m, o.z + d.z * m, o.y + d.y * m)) hi = m; else lo = m; }
          gt = hi; break;
        }
        prev = t;
      }
    } else if (inGar && d.y > 0.001) {
      // the car-park ceiling
      const t = (inGar.ceiling - o.y) / d.y;
      if (t > 0 && t < range) { gt = t; ceiling = true; }
    }
    // flat roofs are floors too
    const rt = this.roofHit(o, d, range);
    if (rt < gt) gt = rt;
    const wt = wh ? wh.t : Infinity;
    if (zh && zh.t < wt && zh.t < gt) return { zombie: zh.z, t: zh.t, point: zh.point, head: zh.head };
    if (wt < gt && wt < Infinity) {
      const pt = new THREE.Vector3(o.x + d.x * wt, o.y + d.y * wt, o.z + d.z * wt);
      const kind = wh.item.kind;
      return { point: pt, normal: new THREE.Vector3(wh.nx, 0, wh.nz), t: wt, item: wh.item, surface: kind === 'car' || kind === 'post' ? 'metal' : 'concrete' };
    }
    if (gt < Infinity) return { point: new THREE.Vector3(o.x + d.x * gt, o.y + d.y * gt, o.z + d.z * gt), normal: new THREE.Vector3(0, ceiling ? -1 : 1, 0), t: gt, surface: ceiling ? 'concrete' : 'ground' };
    return { t: range };
  }

  // Where a downward ray meets a roof slab (only the roof under its end point is checked).
  roofHit(o, d, range) {
    if (d.y >= -0.001) return Infinity;
    const pl = this.g.player;
    const ex = o.x + d.x * range, ez = o.z + d.z * range;
    const top = pl.roofAt(ex, ez);
    if (top === -Infinity || o.y < top) return Infinity;
    const t = (top - o.y) / d.y;
    if (t < 0 || t > range) return Infinity;
    return pl.roofAt(o.x + d.x * t, o.z + d.z * t) === top ? t : Infinity;
  }

  // Knife: a quick slash (click / V with any gun) or a heavy stab (right-click with the knife out).
  swing(heavy, quick = false) {
    this.knifeHeavy = heavy;
    this.knifeDur = heavy ? 0.85 : quick ? 0.5 : 0.42;
    this.knifeT = this.knifeDur;
    this.knifeHit = false;
    this.quickKnife = quick;
    this.g.audio.play('knife', { vol: 0.8, rate: heavy ? 0.8 : 1 });
    const v = this.views[this.current];
    if (v.rig && !quick) this.rigPlay(v, heavy ? 'stab' : 'slash', this.knifeDur);
  }

  // one-shot clip on a first-person rig, then back to idle
  rigPlay(v, name, dur) {
    const act = v.acts && v.acts[name];
    if (!act) return false;
    if (v.acts.idle) v.acts.idle.fadeOut(0.06);
    if (this.rigAct && this.rigAct !== act) this.rigAct.fadeOut(0.06);
    act.reset();
    act.timeScale = dur ? act.getClip().duration / dur : 1;
    act.setEffectiveWeight(1).fadeIn(0.06).play();
    this.rigAct = act;
    this.rigT = dur || act.getClip().duration;
    return true;
  }

  knifeStrike(heavy) {
    const g = this.g;
    if (g.mode === 'client') { g.net.melee(heavy); return; }
    const r = this.meleeFrom(g.player, heavy, g.localSlot ?? 0);
    if (r) { g.hud?.hitmarker(r.killed, false); g.audio.play('hit', { vol: 0.45, jitter: 0 }); }
  }

  // the knife of any player (pos + yaw): the nearest zombie in front, in reach
  meleeFrom(p, heavy, slot = 0) {
    const g = this.g;
    const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const eye = p.pos.y + 1.5;
    let best = null, bestD = heavy ? 2.1 : 1.9;
    for (const zb of g.zombies.list) {
      if (zb.state === 'dead' || zb.state === 'climb') continue;
      const dx = zb.pos.x - p.pos.x, dz = zb.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      const dy = zb.species === 'crow' ? zb.pos.y - eye : zb.pos.y - p.pos.y;
      if (Math.abs(dy) > 1.6) continue;
      if (d < bestD && (dx * fwd.x + dz * fwd.z) / (d || 1) > 0.45) { best = zb; bestD = d; }
    }
    if (!best) return null;
    const point = best.pos.clone();
    point.y += best.species === 'crow' ? 0 : best.small ? 0.4 : 1.3;
    const dmg = this.instaKill > 0 ? 1e6 : heavy ? DEFS.knife.heavy : DEFS.knife.dmg;
    const killed = g.zombies.damage(best, dmg, point, fwd, false, 'knife', slot);
    if (this.onHit) this.onHit(best, killed, false, slot);
    return { killed };
  }

  animateView(dt, input, view) {
    const p = this.g.player;
    const def = this.def, cfg = view.rig ? RIG_VIEW : VIEW[this.current];
    this.kick = Math.max(0, this.kick - dt * 5);
    this.sway.x = THREE.MathUtils.damp(this.sway.x, -input.mouse.dx * 0.00035 * (def.move < 0.9 ? 1.6 : 1), 8, dt);
    this.sway.y = THREE.MathUtils.damp(this.sway.y, input.mouse.dy * 0.00035 * (def.move < 0.9 ? 1.6 : 1), 8, dt);
    const ads = p.ads;
    const bob = p.bob * Math.PI, ba = p.bobAmount * (1 - ads * 0.85) * (def.move < 0.9 ? 1.4 : 1);
    const adsPos = view.sight ? new THREE.Vector3(-view.sight.x, -view.sight.y - 0.018, cfg.ads[2]) : new THREE.Vector3(...cfg.ads);
    const base = new THREE.Vector3(...cfg.pos).lerp(adsPos, ads);
    const h = this.holder;
    h.position.copy(base);
    h.position.x += Math.cos(bob) * 0.012 * ba + this.sway.x;
    h.position.y += -Math.abs(Math.sin(bob)) * 0.014 * ba + this.sway.y - (this.switching > 0 ? this.switching * 0.8 : 0);
    h.position.z += this.kick * 0.045;
    let rx = this.kick * 0.09, ry = 0, rz = 0;
    if (p.sprinting) { rx -= 0.35; ry += 0.55; rz += 0.25; h.position.x -= 0.02; h.position.y -= 0.04; }
    if (this.reloading > 0 && !view.acts?.reload) {
      const total = this.shellLoading ? 1 : (this.reloadWasTactical ? def.reload : (def.reloadEmpty || def.reload));
      const k = this.shellLoading ? 0.6 : Math.sin(Math.min(1, 1 - this.reloading / total) * Math.PI);
      rx -= k * 0.6; rz += this.shellLoading ? 0.35 : 0; h.position.y -= k * 0.08;
    }
    if (this.knifeT > 0 && !(def.melee && view.rig && view.acts?.slash)) {
      const f = 1 - this.knifeT / this.knifeDur, k = Math.sin(f * Math.PI);
      if (def.melee) {
        if (this.knifeHeavy) { h.position.z -= k * 0.22; rx += k * 0.5; }          // stab forward
        else { ry -= (f - 0.5) * 2.2; rz += k * 0.6; h.position.x -= k * 0.1; }  // slash across
      } else { ry -= k * 0.9; rz += k * 0.4; h.position.x -= k * 0.12; }        // quick knife with a gun out
    }
    if (this.throwT > 0) {
      // the gun dips out of the way while the other hand throws
      const f = 1 - this.throwT / THROW_TIME, k = Math.sin(Math.min(1, f * 1.4) * Math.PI);
      h.position.y -= k * 0.22; rx -= k * 0.5; rz -= k * 0.3;
    }
    if (def.bow) this.poseBow(view, ads);
    this.rot = this.rot || new THREE.Euler();
    this.rot.set(rx + cfg.rot[0] * (1 - ads), ry + cfg.rot[1], rz + cfg.rot[2] * (1 - ads));
    h.rotation.copy(this.rot);
    if (view.mixer) view.mixer.update(dt);
    if (view.slide) {
      // the slide flies back and returns (locks back on an empty magazine)
      view.slideT = Math.max(0, (view.slideT || 0) - dt);
      const back = this.ammo.mag === 0 ? 1 : Math.sin(Math.min(1, view.slideT / 0.09) * Math.PI);
      view.slide.position.x = view.slideX - back * 0.045 / Math.max(1e-4, view.model.scale.x);
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    if (view.muzzle) this.flash.position.copy(view.muzzle);
    const spreadNow = def.melee ? 0.01 : def.bow ? THREE.MathUtils.lerp(0.035, def.spread, this.drawT / def.drawTime) : (THREE.MathUtils.lerp(def.spread, def.adsSpread, ads) + this.bloomNow) * (p.moving ? 1.6 : 1);
    this.g.hud?.crosshair(def.bow ? 0 : ads, spreadNow); // the bow keeps a small aiming mark
    const scoped = !!def.scope && ads > 0.85;
    this.g.hud?.scope(scoped);
    this.holder.visible = !scoped;
    p.adsZoom = def.zoom ?? 0.22;
  }

  // string, arrow and right hand follow the draw
  poseBow(view, ads) {
    if (view.bowRig) return this.poseBowModel(view);
    const b = view.model.userData.bow;
    if (!b) return;
    const k = THREE.MathUtils.smoothstep(this.drawT / this.def.drawTime, 0, 1);
    const nock = b.nockRest.clone().lerp(b.nockFull, k);
    stretch(b.strings[0], b.top, nock);
    stretch(b.strings[1], b.bot, nock);
    const nocked = this.ammo.mag > 0;
    b.arrow.visible = nocked;
    if (nocked) {
      const dir = b.rest.clone().sub(nock).normalize();
      const len = b.rest.distanceTo(b.nockFull) + 0.06;
      b.arrow.scale.setScalar(len / 0.79);
      b.arrow.position.copy(nock).addScaledVector(dir, len);
      b.arrow.quaternion.setFromUnitVectors(FWD, dir);
    }
    // nocking a new arrow: the hand comes back from the quiver
    const reach = this.nockT > 0 ? Math.sin((this.nockT / 0.55) * Math.PI) : 0;
    b.hand.position.copy(nock).add(new THREE.Vector3(0.01 + reach * 0.1, -0.02 - reach * 0.12, 0.035 + reach * 0.05));
    b.hand.visible = this.drawT > 0.02 || this.nockT > 0; // the drawing hand only shows while it works the string
    view.root.visible = true;
  }

  poseBowModel(view) {
    const r = view.bowRig, k = THREE.MathUtils.smoothstep(this.drawT / this.def.drawTime, 0, 1);
    r.act.time = k * r.act.getClip().duration * 0.999;
    view.mixer.update(0);
    view.root.updateMatrixWorld(true);
    const nock = view.root.worldToLocal(r.nock.getWorldPosition(this.tmpDir.set(0, 0, 0)).clone());
    const nocked = this.ammo.mag > 0;
    r.arrow.visible = nocked;
    if (nocked) {
      const dir = new THREE.Vector3(0, 0, -1);
      const len = 0.8;
      r.arrow.scale.setScalar(len / 0.79);
      r.arrow.position.copy(nock).addScaledVector(dir, len);
      r.arrow.quaternion.setFromUnitVectors(FWD, dir);
    }
    const reach = this.nockT > 0 ? Math.sin((this.nockT / 0.55) * Math.PI) : 0;
    r.hand.position.copy(nock).add(new THREE.Vector3(0.012 + reach * 0.1, -0.03 - reach * 0.12, 0.05 + reach * 0.05));
    r.hand.rotation.set(0.2, 0, -0.5);
    r.hand.visible = this.drawT > 0.02 || this.nockT > 0;
  }

  // Viewmodel pass, after the world.
  render(renderer, atmo) {
    this.vmCam.aspect = this.g.camera.aspect;
    this.vmCam.fov = this.views[this.current]?.fov || 56;
    this.vmCam.updateProjectionMatrix();
    this.vmSun.color.copy(atmo.sun.color);
    this.vmSun.intensity = Math.max(0.6, atmo.sun.intensity * 0.6);
    const inv = this.g.camera.quaternion.clone().invert();
    this.vmSun.position.copy(atmo.sunDir).applyQuaternion(inv).multiplyScalar(5);
    this.vmHemi.intensity = 0.5 + atmo.hemi.intensity;
    this.vmScene.environment = this.g.scene.environment;
    this.vmScene.environmentIntensity = this.g.scene.environmentIntensity;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.vmScene, this.vmCam);
    renderer.autoClear = true;
  }
}
