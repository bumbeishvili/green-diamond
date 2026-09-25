import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// The horde. Human zombies come in six kinds (walker, runner, crawler, brute, screamer, bloater),
// plus zombie animals: stray dogs that hunt in packs and crows that dive at your head. Humans and
// dogs follow the flow field (direct chase on line of sight) and take the stairs if you go up on a
// roof. Crows fly, so they reach you anywhere, including in the drone.

const SKIP = { playerOnly: true, barrier: true };
const UP = new THREE.Vector3(0, 1, 0);
const rnd = (a, b) => a + Math.random() * (b - a);

export const TYPES = {
  walker: { hp: 1, speed: [1.2, 1.7], dmg: 1, scale: [0.94, 1.06], models: ['city', 'thin', 'office'] },
  runner: { hp: 0.75, speed: [3.4, 4.3], dmg: 0.9, scale: [0.94, 1.04], models: ['city', 'thin'], move: 'run' },
  crawler: { hp: 0.6, speed: [1.0, 1.3], dmg: 0.7, scale: [0.98, 1.04], models: ['office'], crawl: true },
  brute: { hp: 3.5, speed: [1.35, 1.6], dmg: 1.7, scale: [1.3, 1.4], models: ['city', 'thin'], tint: [0.62, 0.55, 0.5], shove: 7 },
  screamer: { hp: 0.8, speed: [1.7, 2.1], dmg: 0.8, scale: [0.95, 1.0], models: ['office', 'city'], tint: [1.12, 1.18, 1.08], emissive: 0x161c16, scream: true },
  bloater: { hp: 1.5, speed: [0.95, 1.2], dmg: 1, scale: [1.06, 1.12], models: ['hazmat'], emissive: 0x3cff22, emissiveI: 0.3, wide: 1.2, explode: true, walkClip: /waddle/i },
  // animals nip rather than maul: a dog bite is under a fifth of a zombie's, a crow's a tenth
  dog: { species: 'dog', hp: 0.45, speed: [5.3, 6.3], dmg: 0.18, scale: [0.95, 1.1], tint: [0.66, 0.56, 0.52], emissive: 0x2a0000, emissiveI: 0.5 },
  wolf: { species: 'dog', model: 'wolf', hp: 1.1, speed: [5.0, 5.8], dmg: 0.3, scale: [0.95, 1.05], tint: [0.6, 0.55, 0.52], emissive: 0x2a0000, emissiveI: 0.5 },
  crow: { species: 'crow', hp: 0.2, speed: [10, 12.5], dmg: 0.11, scale: [0.9, 1.1] },
  // (new kinds go on the end: their index is what goes over the wire)
  // wave 4 on: crouches, then leaps at you from a few metres off
  leaper: { hp: 0.8, speed: [2.6, 3.2], dmg: 0.9, scale: [0.9, 0.97], models: ['thin'], tint: [1.12, 1.05, 1.15], emissive: 0x2a0000, emissiveI: 0.55, move: 'run', leaper: true },
  // wave 5 on: keeps its distance and spits acid, a glob in an arc and a puddle that burns
  spitter: { hp: 0.9, speed: [1.5, 1.85], dmg: 0.6, scale: [0.95, 1.02], models: ['office', 'thin'], tint: [0.8, 1.05, 0.5], emissive: 0x2a3d00, emissiveI: 0.6, spit: true },
  // wave 6 on: riot police, helmet and shield; from the front the shield takes nearly all of it
  riot: { hp: 2.2, speed: [1.3, 1.55], dmg: 1.2, scale: [1.02, 1.08], models: ['city', 'thin'], tint: [0.4, 0.44, 0.56], riot: true, shove: 3 },
  // every fifth wave: the giant, twice your height; it takes magazines and throws cars about
  giant: { hp: 12, speed: [1.3, 1.45], dmg: 1.6, scale: [1.85, 1.95], models: ['city'], tint: [0.6, 0.45, 0.42], emissive: 0x1e0000, emissiveI: 0.5, shove: 12, boss: true },
};
const MODEL_KEYS = { city: /city/i, thin: /thin/i, office: /office/i, hazmat: /hazmat/i };
const TYPE_KEYS = Object.keys(TYPES);
// states on the wire (crows send their flight state instead of 'chase')
const NET_STATES = ['chase', 'attack', 'scream', 'dead', 'climb', 'circle', 'dive', 'away', 'spit', 'crouch', 'leap'];
const HIST = 32;   // ticks of position history kept for lag compensation
const SPIT_G = 9.8;   // acid globs fall like anything else
// what a riot shield doesn't stop
const BLAST = new Set(['grenade', 'missile', 'explosion', 'bloater', 'fuse', 'vehicle', 'nuke', 'chainsaw'])

// ------------------------------------------------------------------------------------------
// Procedural stand-ins (used when a downloaded model is missing): boxes skinned to a few bones
// ------------------------------------------------------------------------------------------
function skinnedFromParts(parts, boneDefs, material) {
  const names = Object.keys(boneDefs);
  const bones = {};
  for (const name of names) {
    const [parent, x, y, z] = boneDefs[name];
    const b = new THREE.Bone();
    b.name = name;
    if (parent) { const pp = boneDefs[parent]; b.position.set(x - pp[1], y - pp[2], z - pp[3]); bones[parent].add(b); }
    else b.position.set(x, y, z);
    bones[name] = b;
  }
  const pos = [], nor = [], col = [], si = [], sw = [];
  const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const bp = box.attributes.position, bn = box.attributes.normal;
  const c = new THREE.Color();
  for (const pt of parts) {
    const bi = names.indexOf(pt.bone);
    c.setHex(pt.col).multiplyScalar(0.85 + Math.random() * 0.3);
    for (let i = 0; i < bp.count; i++) {
      pos.push(bp.getX(i) * pt.s[0] + pt.c[0], bp.getY(i) * pt.s[1] + pt.c[1], bp.getZ(i) * pt.s[2] + pt.c[2]);
      nor.push(bn.getX(i), bn.getY(i), bn.getZ(i));
      col.push(c.r, c.g, c.b);
      si.push(bi, 0, 0, 0); sw.push(1, 0, 0, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(g, material);
  mesh.add(bones[names[0]]);
  mesh.bind(new THREE.Skeleton(names.map((n) => bones[n])));
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return { mesh, bones };
}

const HUMAN_BONES = {
  hips: [null, 0, 0.95, 0], spine: ['hips', 0, 1.15, 0], chest: ['spine', 0, 1.38, 0], neck: ['chest', 0, 1.55, 0], head: ['neck', 0, 1.62, 0],
  armL: ['chest', 0.21, 1.48, 0], foreL: ['armL', 0.23, 1.2, 0], armR: ['chest', -0.21, 1.48, 0], foreR: ['armR', -0.23, 1.2, 0],
  thighL: ['hips', 0.1, 0.92, 0], shinL: ['thighL', 0.1, 0.5, 0], thighR: ['hips', -0.1, 0.92, 0], shinR: ['thighR', -0.1, 0.5, 0],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// how far a point is from a vehicle's body (its box, turned with it), in metres
function gapToBox(p, v) {
  const s = v.spec, c = Math.cos(v.heading), sn = Math.sin(v.heading);
  const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
  return Math.hypot(Math.max(0, Math.abs(lx) - s.hw), Math.max(0, Math.abs(lz) - s.hd));
}

function proceduralHuman(material) {
  const skin = pick([0x8f9b82, 0x9aa48c, 0x7e8a73, 0xa29d86]), shirt = pick([0x5a6b7a, 0x7a5a4a, 0x4d5c3c, 0x6a3b3b, 0x33455a]);
  const pants = pick([0x2a2f3a, 0x3a3226, 0x4a4a4a]), hair = pick([0x2a2018, 0x4a3a2a, 0x6d6d6d]), shoe = 0x1d1b19;
  const P = (c, s, bone, col) => ({ c, s, bone, col });
  const parts = [
    P([0, 0.95, 0], [0.34, 0.2, 0.2], 'hips', pants), P([0, 1.14, 0], [0.32, 0.24, 0.19], 'spine', shirt), P([0, 1.38, 0], [0.41, 0.3, 0.22], 'chest', shirt),
    P([0, 1.55, 0], [0.1, 0.1, 0.1], 'neck', skin), P([0, 1.72, 0.02], [0.2, 0.25, 0.23], 'head', skin), P([0, 1.85, -0.01], [0.21, 0.05, 0.23], 'head', hair),
    P([0.24, 1.34, 0], [0.1, 0.3, 0.11], 'armL', shirt), P([0.24, 1.07, 0], [0.085, 0.28, 0.09], 'foreL', skin),
    P([-0.24, 1.34, 0], [0.1, 0.3, 0.11], 'armR', shirt), P([-0.24, 1.07, 0], [0.085, 0.28, 0.09], 'foreR', skin),
    P([0.1, 0.71, 0], [0.14, 0.42, 0.15], 'thighL', pants), P([0.1, 0.28, 0], [0.12, 0.42, 0.13], 'shinL', pants), P([0.1, 0.05, 0.05], [0.11, 0.08, 0.25], 'shinL', shoe),
    P([-0.1, 0.71, 0], [0.14, 0.42, 0.15], 'thighR', pants), P([-0.1, 0.28, 0], [0.12, 0.42, 0.13], 'shinR', pants), P([-0.1, 0.05, 0.05], [0.11, 0.08, 0.25], 'shinR', shoe),
  ];
  const { mesh, bones } = skinnedFromParts(parts, HUMAN_BONES, material);
  const root = new THREE.Group();
  root.add(mesh);
  return { root, bones, hb: { head: bones.head, chest: bones.chest, hips: bones.hips }, anim: 'human' };
}

// A mangy stray: body with a bloody flank, head and snout, ears, four legs, a tail.
const DOG_BONES = {
  body: [null, 0, 0.55, 0], head: ['body', 0, 0.68, 0.42], legFL: ['body', 0.1, 0.48, 0.28], legFR: ['body', -0.1, 0.48, 0.28],
  legBL: ['body', 0.1, 0.48, -0.28], legBR: ['body', -0.1, 0.48, -0.28], tail: ['body', 0, 0.62, -0.38],
};
function proceduralDog(material) {
  const fur = pick([0x5b4a3a, 0x3a3230, 0x7a6a55, 0x8a7d6a]), dark = 0x2a211c, blood = 0x5a0a0a;
  const P = (c, s, bone, col) => ({ c, s, bone, col });
  const parts = [
    P([0, 0.56, 0], [0.26, 0.27, 0.74], 'body', fur), P([0.131, 0.58, -0.05], [0.01, 0.14, 0.3], 'body', blood),
    P([0, 0.74, 0.47], [0.2, 0.2, 0.22], 'head', fur), P([0, 0.68, 0.64], [0.11, 0.1, 0.16], 'head', dark),
    P([0.06, 0.87, 0.42], [0.05, 0.1, 0.04], 'head', dark), P([-0.06, 0.87, 0.42], [0.05, 0.1, 0.04], 'head', dark),
    P([0.1, 0.27, 0.28], [0.08, 0.5, 0.08], 'legFL', fur), P([-0.1, 0.27, 0.28], [0.08, 0.5, 0.08], 'legFR', fur),
    P([0.1, 0.27, -0.28], [0.09, 0.5, 0.09], 'legBL', fur), P([-0.1, 0.27, -0.28], [0.09, 0.5, 0.09], 'legBR', fur),
    P([0, 0.64, -0.56], [0.05, 0.05, 0.3], 'tail', fur),
  ];
  const { mesh, bones } = skinnedFromParts(parts, DOG_BONES, material);
  const root = new THREE.Group();
  root.add(mesh);
  return { root, bones, anim: 'dog' };
}

// A crow: body, head, beak, tail and two flapping wings.
let crowMats = null;
function proceduralCrow() {
  crowMats ||= { black: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55, metalness: 0.25 }), beak: new THREE.MeshStandardMaterial({ color: 0x2b2a26, roughness: 0.5 }) };
  const { black, beak } = crowMats;
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8).scale(0.75, 0.7, 1.4), black));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), black); head.position.set(0, 0.07, 0.2); root.add(head);
  const bk = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 6).rotateX(Math.PI / 2), beak); bk.position.set(0, 0.06, 0.32); root.add(bk);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.18), black); tail.position.set(0, 0.02, -0.28); root.add(tail);
  const wing = (side) => {
    const pivot = new THREE.Group(); pivot.position.set(side * 0.08, 0.05, 0);
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.24), black); w.position.set(side * 0.25, 0, 0); pivot.add(w);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.14), black); tip.position.set(side * 0.58, 0, -0.04); pivot.add(tip);
    root.add(pivot);
    return pivot;
  };
  const wings = [wing(1), wing(-1)];
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, wings, anim: 'crow' };
}

function findClip(anims, ...res) {
  for (const re of res) { if (!re) continue; const c = anims.find((a) => re.test(a.name)); if (c) return c; }
  return null;
}

// Special kinds get tinted/glowing copies of the model's materials (shared per kind).
function restyle(inst, key, def, cache) {
  inst.traverse((o) => {
    if (!o.isMesh) return;
    const list = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
      const k = `${key}:${m.uuid}`;
      let c = cache.get(k);
      if (!c) {
        c = m.clone();
        if (def.tint && c.color) c.color.multiply(new THREE.Color(...def.tint));
        if (def.emissive) { c.emissive = new THREE.Color(def.emissive); c.emissiveIntensity = def.emissiveI ?? 1; }
        cache.set(k, c);
      }
      return c;
    });
    o.material = list.length === 1 ? list[0] : list;
  });
}

function fromModel(model, type, def, cache) {
  const root = new THREE.Group();
  const inst = SkeletonUtils.clone(model.scene);
  inst.scale.setScalar(model.scale || 1);
  inst.rotation.y = model.yaw || 0;
  inst.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  if (def.tint || def.emissive) restyle(inst, type, def, cache);
  root.add(inst);
  const mixer = new THREE.AnimationMixer(inst);
  const bones = [];
  inst.traverse((o) => { if (o.isBone) bones.push(o); });
  const bone = (res) => { for (const re of res) { const b = bones.find((x) => re.test(x.name)); if (b) return b; } return null; };
  const hb = {
    head: bone([/(^|[:_\s])head$/i, /head(?!.*(end|top))/i]),
    chest: bone([/spine2$/i, /chest/i, /spine\.00[34]/i, /spine1$/i, /spine/i]),
    hips: bone([/hips/i, /pelvis/i, /^spine$/i]),
  };
  const A = model.animations;
  const clips = def.crawl ? {
    walk: findClip(A, /running_crawl/i, /crawl/i), attack: findClip(A, /bite_ground/i, /attack/i), hit: findClip(A, /hit_reaction/i),
  } : {
    walk: findClip(A, def.walkClip, /(^|\|)walk$/i, /walk|forward|waddle/i),
    run: findClip(A, /(^|\|)run$/i, /gallop$/i, /run|gallop|sprint/i),
    attack: findClip(A, /(^|\|)attack$/i, /attack|fight|bite|headbutt/i),
    death: findClip(A, /(^|\|)death$/i, /death|die|dying|dead/i),
    hit: findClip(A, /hitreact|hit_reaction|react|hurt$|pain/i),
    scream: findClip(A, /scream|howl|roar/i),
    fly: findClip(A, /fly|flap/i),
  };
  const actions = {};
  for (const [k, c] of Object.entries(clips)) if (c) actions[k] = mixer.clipAction(c);
  for (const k of ['death', 'scream', 'hit']) if (actions[k]) { actions[k].setLoop(THREE.LoopOnce, 1); actions[k].clampWhenFinished = true; }
  return { root, mixer, actions, hb: hb.head && hb.chest && hb.hips ? hb : null, anim: 'model' };
}

// Riot police kit: a helmet with a visor, and a clear shield (პოლიცია) carried in front.
let riotKit = null;
function riotGear(obj) {
  if (!riotKit) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(28,34,46,0.5)'; c.fillRect(0, 0, 256, 512);
    c.strokeStyle = 'rgba(8,9,12,0.95)'; c.lineWidth = 16; c.strokeRect(8, 8, 240, 496);
    c.fillStyle = 'rgba(236,240,244,0.95)'; c.fillRect(16, 148, 224, 96);
    c.fillStyle = '#0f1520'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 44px sans-serif'; c.fillText('პოლიცია', 128, 184);
    c.font = 'bold 26px sans-serif'; c.fillText('POLICE', 128, 224);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sg = new THREE.PlaneGeometry(0.62, 1.0, 10, 1);
    const pa = sg.attributes.position;
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i); pa.setZ(i, -x * x * 0.5); }   // (curved round the body)
    sg.computeVertexNormals();
    riotKit = {
      shieldGeo: sg,
      shieldMat: new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.2, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }),
      domeGeo: new THREE.SphereGeometry(0.16, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
      domeMat: new THREE.MeshStandardMaterial({ color: 0x1a212e, roughness: 0.4, metalness: 0.4 }),
      visorGeo: new THREE.CylinderGeometry(0.172, 0.172, 0.15, 18, 1, true, -Math.PI * 0.42, Math.PI * 0.84),
      visorMat: new THREE.MeshStandardMaterial({ color: 0x25364a, transparent: true, opacity: 0.5, roughness: 0.08, metalness: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    };
  }
  const K = riotKit;
  const shield = new THREE.Mesh(K.shieldGeo, K.shieldMat);
  shield.position.set(0.06, 1.0, 0.52);
  shield.rotation.set(-0.08, 0.08, 0);
  shield.castShadow = true;
  obj.root.add(shield);
  const head = (obj.hb && obj.hb.head) || (obj.bones && obj.bones.head);
  if (!head) return;
  // upright and the right size, whatever the head bone's own turn and scale
  const helmet = new THREE.Group();
  const dome = new THREE.Mesh(K.domeGeo, K.domeMat); dome.castShadow = true;
  const visor = new THREE.Mesh(K.visorGeo, K.visorMat); visor.position.y = -0.045;
  helmet.add(dome, visor);
  obj.root.updateMatrixWorld(true);
  const q = head.getWorldQuaternion(new THREE.Quaternion()).invert(), sc = head.getWorldScale(new THREE.Vector3()).x || 1;
  helmet.quaternion.copy(q);
  helmet.scale.setScalar(1 / sc);
  helmet.position.set(0, 0.13, 0.01).applyQuaternion(q).multiplyScalar(1 / sc);
  head.add(helmet);
}

// Acid: a glob in the air, a blotchy puddle on the ground (drawn once).
let acidKit = null;
function acidParts() {
  if (acidKit) return acidKit;
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  for (let k = 0; k < 10; k++) {
    const a = Math.random() * 6.28, d = k ? 16 + Math.random() * 20 : 0, r = k ? 12 + Math.random() * 18 : 36;
    const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
    const gr = c.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(200,255,80,0.95)'); gr.addColorStop(0.55, 'rgba(130,215,35,0.8)'); gr.addColorStop(1, 'rgba(80,160,20,0)');
    c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, 6.29); c.fill();
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  acidKit = {
    globGeo: new THREE.SphereGeometry(0.1, 10, 8),
    globMat: new THREE.MeshBasicMaterial({ color: 0xb8ff40, toneMapped: false }),
    poolGeo: new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    poolMat: new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  };
  return acidKit;
}

// ------------------------------------------------------------------------------------------
export class Zombies {
  constructor(scene, { colliders, hm, nav, effects, audio, player, models }) {
    this.scene = scene;
    this.col = colliders; this.hm = hm; this.nav = nav; this.fx = effects; this.audio = audio; this.player = player;
    this.models = {};
    for (const m of (models && models.zombies) || []) for (const [k, re] of Object.entries(MODEL_KEYS)) if (re.test(m.name)) this.models[k] = m;
    this.animals = (models && models.animals) || {};
    this.list = [];
    this.pools = new Map();
    this.matCache = new Map();
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.onKill = null; this.onPlayerHit = null; this.onScream = null; this.onExplode = null; this.relocate = null;
    this.frozen = false;
    this.stairs = [];          // stairwells [{top, levels, roof:{x,z}, doors:[{x,z}]}] (three.js coords)
    this.targetStair = null;   // the stairwell up to the roof the player is standing on
    this.underground = null;   // the car parks under the courtyards (world/underground.js)
    this.playerLevel = null;   // the car park the player is down in
    this.unav = null;          // flow field on the car-park level (around parked cars and columns)
    this.groundFn = null;      // (x, z, y) -> floor height, car-park aware
    this.tmpA = new THREE.Vector3(); this.tmpB = new THREE.Vector3(); this.tmpC = new THREE.Vector3();
    this.tmpQ = new THREE.Quaternion();
    this.dir = { x: 0, z: 0 };
    // co-op: the players the horde can go for (null: just this.player). Each zombie takes the
    // nearest one. Hits and kills carry the shooter's slot (by).
    this.targets = null;
    this.onFx = null;          // (kind, point, dir) blood etc., for the other players to see
    this.nidSeq = 0;           // network ids
    this.byNid = new Map();
    this.puppets = false;      // client: zombies are drawn from the host's snapshots, no AI here
    this.globs = [];           // spitters' acid in the air
    this.acid = [];            // and the puddles it leaves
    this.globSeq = 0;
    this.onSpit = null; this.onSplat = null;   // (host: tell the others)
  }

  get alive() { let n = 0; for (const z of this.list) if (z.state !== 'dead') n++; return n; }
  count(type) { let n = 0; for (const z of this.list) if (z.state !== 'dead' && z.type === type) n++; return n; }

  build(type, variant = -1) {
    const def = TYPES[type];
    if (def.species === 'dog') {
      const m = this.animals[def.model || 'dog'] || this.animals.dog;
      return { ...(m ? fromModel(m, type, def, this.matCache) : proceduralDog(this.material)), variant: 0 };
    }
    if (def.species === 'crow') return { ...(this.animals.crow ? fromModel(this.animals.crow, type, def, this.matCache) : proceduralCrow()), variant: 0 };
    const keys = def.models.filter((k) => this.models[k]);
    let obj;
    if (!keys.length) obj = { ...proceduralHuman(this.material), variant: 0 };
    else {
      const key = variant >= 0 && keys.includes(def.models[variant]) ? def.models[variant] : pick(keys);
      const model = this.models[key];
      obj = { ...fromModel(model, type, def, this.matCache), model: model.name, variant: def.models.indexOf(key) };
    }
    if (def.riot) riotGear(obj);
    return obj;
  }

  poolKey(type, variant) { return `${type}:${variant}`; }

  spawn(x, z, { type = 'walker', hp = 100, speed = null, speedMul = 1, damage = 40, roof = null, stair = null, y = null } = {}) {
    const def = TYPES[type] || TYPES.walker;
    let zb = null;
    for (const [k, pool] of this.pools) if (k.startsWith(`${type}:`) && pool.length) { zb = pool.pop(); break; }
    zb ||= Object.assign(this.build(type), { type });
    zb.nid = this.nextNid();
    this.byNid.set(zb.nid, zb);
    if (zb.hist) zb.hist.fill(-1);
    const scale = rnd(...def.scale);
    const w = def.wide || 1;
    zb.root.scale.set(scale * w, scale, scale * w);
    const ground = roof ?? this.hm.atWorld(x, z);
    Object.assign(zb, {
      species: def.species || 'human', def, hp: hp * def.hp, maxHp: hp * def.hp,
      speed: (speed ?? rnd(...def.speed)) * speedMul, damage: damage * def.dmg, scale, roof, stair,
      state: 'chase', t: 0, phase: Math.random() * 10, attackT: 0, attackCd: 0, hitT: 0, hitAnim: 0, deadT: 0, buffT: 0,
      screamed: false, exploding: false, fuse: 0, gasT: Math.random(),
      stuckT: 0, forceField: 0, lastPath: Infinity, progT: 0, direct: false, losT: 0, hiddenT: 0, climbT: 0, fling: null, bumpT: 0,
      groanT: 2 + Math.random() * 6, lean: 0.1 + Math.random() * 0.2, tilt: (Math.random() - 0.5) * 0.5, armAsym: (Math.random() - 0.5) * 0.5,
      pos: new THREE.Vector3(x, y ?? ground, z), vel: new THREE.Vector3(), heading: Math.random() * Math.PI * 2,
      dealt: false, small: def.species === 'dog' || def.species === 'crow' || !!def.crawl, fallDir: 1, fallV: 0,
      orbit: Math.random() * Math.PI * 2, diveT: 3.5 + Math.random() * 4, crowState: 'circle', climbUp: 0,
      spitCd: 1.5 + Math.random() * 2, leapCd: 0.3 + Math.random() * 0.6, crouchK: 0, pitch: 0, stepN: 0, leap: 0,
    });
    zb.root.rotation.set(0, zb.heading, 0);
    zb.root.position.copy(zb.pos);
    zb.root.visible = true;
    this.scene.add(zb.root);
    if (zb.anim === 'model') {
      zb.mixer.stopAllAction();
      zb.current = null;
      this.play(zb, zb.species === 'crow' ? 'fly' : this.moveClip(zb));
    }
    this.list.push(zb);
    return zb;
  }

  moveClip(zb) { return zb.def.move === 'run' || zb.species === 'dog' ? 'run' : 'walk'; }

  play(zb, name, fade = 0.2) {
    if (zb.anim !== 'model') return;
    const a = zb.actions[name] || zb.actions.walk || zb.actions.run || zb.actions.fly;
    if (!a || zb.current === a) return;
    // the raven's flight clip is one slow wing-beat: speed it up
    if (name === 'fly' && zb.species === 'crow') a.timeScale = a.getClip().duration > 1.2 ? 2.5 : 1.3;
    a.reset().fadeIn(fade).play();
    if (zb.current) zb.current.fadeOut(fade);
    zb.current = a;
  }

  // Ray vs hit spheres. Returns {z, t, point, head} for the nearest hit.
  // rewind(zb) -> [dx, dy, dz] | null: where it was when the shooter saw it (lag compensation)
  raycast(o, d, maxDist, exclude = null, rewind = null) {
    let best = null;
    for (const zb of this.list) {
      if (zb.state === 'dead' || zb.state === 'climb' || (exclude && exclude.includes(zb))) continue;
      const off = rewind ? rewind(zb) : null;
      const ox = off ? off[0] : 0, oy = off ? off[1] : 0, oz = off ? off[2] : 0;
      const tx = zb.pos.x + ox - o.x, tz = zb.pos.z + oz - o.z;
      const along = tx * d.x + tz * d.z;
      if (along < -2 || along > maxDist + 2) continue;
      let mine = null, headT = Infinity;
      for (let [cx, cy, cz, r, head] of this.spheres(zb)) {
        cx += ox; cy += oy; cz += oz;
        const lx = o.x - cx, ly = o.y - cy, lz = o.z - cz;
        const b = lx * d.x + ly * d.y + lz * d.z, c = lx * lx + ly * ly + lz * lz - r * r, disc = b * b - c;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        if (t < 0 || t > maxDist) continue;
        if (head) headT = Math.min(headT, t);
        if (!mine || t < mine.t) mine = { z: zb, t, head, point: new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t) };
      }
      // head and upper chest overlap: a ray that also clips the head counts as a headshot
      if (mine && !mine.head && headT < mine.t + 0.25 && zb.species === 'human') mine.head = true;
      if (mine && (!best || mine.t < best.t)) best = mine;
    }
    return best;
  }

  // [x, y, z, radius, isHead] in world space
  spheres(zb) {
    const s = zb.scale, p = zb.pos;
    if (zb.species === 'crow') return [[p.x, p.y, p.z, 0.4 * s, false]];
    if (zb.species === 'dog') {
      const fx = Math.sin(zb.heading), fz = Math.cos(zb.heading), up = zb.leap || 0;
      return [
        [p.x - fx * 0.12 * s, p.y + 0.55 * s + up, p.z - fz * 0.12 * s, 0.33 * s, false],
        [p.x + fx * 0.25 * s, p.y + 0.57 * s + up, p.z + fz * 0.25 * s, 0.3 * s, false],
        [p.x + fx * 0.52 * s, p.y + 0.72 * s + up, p.z + fz * 0.52 * s, 0.17 * s, true],
      ];
    }
    if (zb.hb) {
      const h = zb.hb.head.getWorldPosition(this.tmpA), c = zb.hb.chest.getWorldPosition(this.tmpB), hp = zb.hb.hips.getWorldPosition(this.tmpC);
      if (zb.def.crawl) {
        // lying almost flat: head, chest, hips, legs trailing behind
        const bx = hp.x - (c.x - hp.x), bz = hp.z - (c.z - hp.z);
        return [
          [h.x, h.y + 0.04 * s, h.z, 0.15 * s, true],
          [c.x, c.y, c.z, 0.24 * s, false], [hp.x, hp.y, hp.z, 0.23 * s, false],
          [bx, p.y + 0.18 * s, bz, 0.2 * s, false], [hp.x - (c.x - hp.x) * 2, p.y + 0.14 * s, hp.z - (c.z - hp.z) * 2, 0.17 * s, false],
        ];
      }
      // the head bone sits at the base of the skull: the head itself is ~11 cm above it
      const w = zb.def.wide || 1;
      return [
        [h.x, h.y + 0.11 * s, h.z, 0.15 * s, true],
        [hp.x + (c.x - hp.x) * 0.85, hp.y + (c.y - hp.y) * 0.85 - 0.04 * s, hp.z + (c.z - hp.z) * 0.85, 0.21 * s * w, false],
        [(c.x + hp.x) / 2, (c.y + hp.y) / 2, (c.z + hp.z) / 2, 0.25 * s * w, false],
        [hp.x, Math.max(p.y + 0.22, hp.y - 0.25 * s), hp.z, 0.23 * s, false],
        [hp.x, Math.max(p.y + 0.18, hp.y - 0.62 * s), hp.z, 0.2 * s, false],
      ];
    }
    const fx = Math.sin(zb.heading) * zb.lean * 0.4, fz = Math.cos(zb.heading) * zb.lean * 0.4;
    return [
      [p.x + fx * 1.4, p.y + 1.7 * s, p.z + fz * 1.4, 0.16 * s, true], [p.x + fx, p.y + 1.25 * s, p.z + fz, 0.3 * s, false],
      [p.x, p.y + 0.85 * s, p.z, 0.26 * s, false], [p.x, p.y + 0.45 * s, p.z, 0.22 * s, false],
    ];
  }

  damage(zb, amount, point, dir, head, weapon, by = 0) {
    if (zb.state === 'dead') return false;
    // riot police: from the front the shield (and the visor) take it; their legs under it don't, nor
    // does anything while the shield's down for a swing; or get round them, or blow them up
    const low = point && point.y - zb.pos.y < 0.55 * zb.scale;
    if (zb.def.riot && dir && !BLAST.has(weapon) && !low && zb.state !== 'attack') {
      const fx = Math.sin(zb.heading), fz = Math.cos(zb.heading);
      if (-(dir.x * fx + dir.z * fz) / (Math.hypot(dir.x, dir.z) || 1) > 0.5) {
        zb.hp -= amount * 0.2;
        const sp = this.tmpA.set(zb.pos.x + fx * 0.55 * zb.scale, point.y, zb.pos.z + fz * 0.55 * zb.scale);
        this.fx.emit(sp, 8, { color: [1, 0.85, 0.5], speed: 4, spread: 0.9, up: 0.6, life: 0.25, size: 0.04, gravity: 6 });
        this.audio.play('metal', { pos: sp, vol: 0.8 });
        this.onFx?.('spark', sp, dir);
        zb.shieldT = 0.15;
        if (zb.hp <= 0) { this.kill(zb, dir, false, weapon, by); return true; }
        return false;
      }
    }
    zb.hp -= amount;
    const car = weapon === 'vehicle';   // (a car's hit has a sound and a message of its own: vehicles.runOver)
    if (!car) this.onFx?.(zb.species === 'crow' ? 'feathers' : zb.def.explode ? 'bile' : 'blood', point, dir);
    if (zb.species === 'crow') this.fx.emit(point, 10, { color: [0.05, 0.05, 0.06], speed: 2.2, spread: 1.6, up: 1, life: 1.4, size: 0.07, gravity: 1.5 });
    else if (zb.def.explode) this.fx.emit(point, 12, { color: [0.35, 0.75, 0.15], speed: 2.5, spread: 1.2, up: 1, life: 0.8, size: 0.09, dir });
    else this.fx.bloodBurst(point, dir);
    if (!car) this.audio.play('flesh', { pos: point, vol: 0.7 });
    if (zb.hp <= 0) { this.kill(zb, dir, head, weapon, by); return true; }
    zb.hitT = zb.def.shove ? 0.08 : 0.25;
    if (zb.species === 'dog') zb.hitT = 0.15;
    if (zb.anim === 'model' && zb.actions.hit && zb.state === 'chase' && Math.random() < 0.3 && !zb.def.shove) { this.play(zb, 'hit', 0.05); zb.hitAnim = 0.4; }
    return false;
  }

  kill(zb, dir, head, weapon, by = 0) {
    if (zb.state === 'dead') return;
    zb.killedBy = by;
    const wasClimbing = zb.state === 'climb';
    zb.state = 'dead';
    zb.deadT = 0;
    zb.fallDir = Math.random() < 0.65 ? 1 : -1;
    zb.fallV = 0;
    zb.leap = 0;
    const dog = zb.species === 'dog', crow = zb.species === 'crow';
    this.audio.play(crow ? 'caw' : dog ? 'yelp' : 'zdeath', { pos: zb.pos, vol: 0.8, rate: zb.def.shove ? 0.75 : 1 });
    if (zb.anim === 'model') {
      if (zb.def.crawl || !zb.actions.death) { if (zb.current) zb.current.timeScale = 0; }
      else this.play(zb, 'death', 0.1);
    }
    if (!crow && !wasClimbing) {
      const p = zb.pos.clone(); p.y = this.groundOf(zb) + 0.03;
      this.fx.blood.add(p, UP, dog ? 0.8 : 1.2);
    }
    // bloaters burst a moment later (chains through a crowd of them)
    if (zb.def.explode && !wasClimbing) { zb.exploding = true; zb.fuse = weapon === 'fuse' ? 0.7 : 0.15; }
    if (wasClimbing) zb.deadT = 8;
    if (this.onKill && weapon !== 'fuse') this.onKill(zb, head, weapon, by);
  }

  // Hit by a car: the body goes up and along the car's way, tumbling (legs swept on, head back
  // towards the car), comes down, bounces once and slides and rolls to a stop. v: its velocity
  // (m/s), spin: how fast it turns over (rad/s). On a co-op client (client: true) the host's
  // snapshots carry it through the air and only the tumble is worked out here.
  fling(zb, vx, vy, vz, spin, client = false) {
    const h = Math.hypot(vx, vz) || 1;
    zb.fling = { vx, vy, vz, spin, ax: -vz / h, az: vx / h, angle: 0, t: 0, ground: false, bounced: false, client };
  }

  // (a co-op client: the host says one of its zombies was hit by a car)
  netFling(nid, spin, ax, az) {
    const zb = this.byNid.get(nid);
    if (zb) zb.fling = { vx: 0, vy: 0, vz: 0, spin, ax, az, angle: 0, t: 0, ground: false, bounced: false, client: true };
  }

  killAll() { for (const zb of this.list) if (zb.state !== 'dead') this.kill(zb, null, false, 'nuke'); }

  clear() {
    for (const zb of this.list) this.release(zb);
    this.list.length = 0;
    for (const b of this.globs) this.scene.remove(b.mesh);
    for (const a of this.acid) this.scene.remove(a.mesh);
    this.globs.length = 0; this.acid.length = 0;
  }

  release(zb) {
    this.scene.remove(zb.root);
    if (this.byNid.get(zb.nid) === zb) this.byNid.delete(zb.nid);
    const k = this.poolKey(zb.type, zb.variant ?? 0);
    if (!this.pools.has(k)) this.pools.set(k, []);
    this.pools.get(k).push(zb);
  }

  nextNid() {
    for (let i = 0; i < 65536; i++) {
      this.nidSeq = (this.nidSeq + 1) & 0xffff;
      if (this.nidSeq && !this.byNid.has(this.nidSeq)) return this.nidSeq;
    }
    return 0;
  }

  groundOf(zb) { return zb.roof != null ? zb.roof : this.floorAt(zb.pos.x, zb.pos.z, zb.pos.y); }
  floorAt(x, z, y) { return this.groundFn ? this.groundFn(x, z, y + 0.3) : this.hm.atWorld(x, z); }
  levelOf(x, z, y) { return this.underground ? this.underground.at(x, z, y + 0.3) : null; }

  // Blast damage (grenades, bloaters): zombies and the player in range, not through walls.
  explode(x, y, z, radius, dmgZombie, dmgPlayer, source = 'explosion', by = 0) {
    let kills = 0;
    const level = this.levelOf(x, z, y - 0.6);
    for (const zb of this.list) {
      if (zb.state === 'dead' || zb.state === 'climb') continue;
      if (this.levelOf(zb.pos.x, zb.pos.z, zb.pos.y) !== level) continue;
      const cy = zb.species === 'crow' ? zb.pos.y : zb.pos.y + 0.8;
      const d = Math.hypot(zb.pos.x - x, cy - y, zb.pos.z - z);
      if (d > radius || !this.col.clear(x, y + 0.3, z, zb.pos.x, cy + 0.2, zb.pos.z)) continue;
      const dir = new THREE.Vector3(zb.pos.x - x, 0.6, zb.pos.z - z).normalize();
      const point = zb.pos.clone(); point.y = cy;
      const killed = this.damage(zb, dmgZombie * (1 - (d / radius) * 0.7), point, dir, false, source, by);
      if (killed) { kills++; zb.blast = dir; }
      if (this.onBlastHit) this.onBlastHit(zb, killed, by);
    }
    // every player in range (a car keeps the blast off you)
    for (const pl of this.targetList()) {
      if (!(dmgPlayer > 0 && !pl.dead && !(pl.vehicle && pl.vehicle.type === 'car') && this.levelOf(pl.pos.x, pl.pos.z, pl.pos.y) === level)) continue;
      const pd = Math.hypot(pl.pos.x - x, pl.pos.y + 1 - y, pl.pos.z - z);
      if (pd < radius && this.col.clear(x, y + 0.3, z, pl.pos.x, pl.pos.y + 1.2, pl.pos.z)) {
        const amount = dmgPlayer * Math.pow(1 - pd / radius, 0.8);
        // (PvP: a grenade hurts whoever threw it and their foes, not their team)
        const pvp = this.pvp && this.pvp.on && (source === 'grenade' || source === 'missile') ? this.pvp : null;
        if (pvp && (pl.shieldT > 0 || (by !== pl.slot && !pvp.foes(by, pl.slot)))) continue;
        if (pvp) pl.lastHit = { by, how: source, t: pvp.g.time || 0 };
        pl.damage(amount, x, z);
        pl.shake = Math.min(1, pl.shake + 0.9);
        if (this.onPlayerHit) this.onPlayerHit(null, pl, amount, x, z);
      } else if (pd < radius * 4) pl.shake = Math.min(1, pl.shake + 0.5 * (1 - pd / (radius * 4)));
    }
    if (this.onExplode) this.onExplode(x, y, z, radius, source);
    if (this.onBlastVehicles) this.onBlastVehicles(x, y, z, radius, dmgZombie);
    return kills;
  }

  targetList() { return this.targets && this.targets.length ? this.targets : [this.player]; }

  // The nearest living player (re-picked every half second or so).
  pickTarget(zb, targets, dt) {
    if (targets.length === 1) return targets[0];
    zb.retargetT = (zb.retargetT || 0) - dt;
    if (zb.target && !zb.target.dead && zb.retargetT > 0 && targets.includes(zb.target)) return zb.target;
    zb.retargetT = 0.45 + Math.random() * 0.3;
    const mine = this.levelOf(zb.pos.x, zb.pos.z, zb.pos.y);
    let best = null, bd = Infinity;
    for (const t of targets) {
      if (t.dead) continue;
      const d = Math.hypot(t.pos.x - zb.pos.x, t.pos.z - zb.pos.z) + Math.abs(t.pos.y - zb.pos.y) * 2 + (t.zLevel !== mine ? 25 : 0);
      if (d < bd) { bd = d; best = t; }
    }
    zb.target = best || (targets.includes(zb.target) ? zb.target : targets[0]);
    return zb.target;
  }

  update(dt) {
    const targets = this.targetList();
    if (!this.frozen) this.updateAcid(dt);
    // where each player is: down in a car park, up on a roof with stairs
    for (const t of targets) {
      t.zLevel = this.underground ? this.underground.at(t.pos.x, t.pos.z, t.pos.y + 0.1) : null;
      t.zStair = t.roof && t.roof.stair && !t.vehicle ? t.roof.stair : null;
    }
    const nav = this.nav;
    // spatial hash for separation (walkers on the same level only)
    const grid = new Map();
    for (const zb of this.list) {
      if (zb.state === 'dead' || zb.state === 'climb' || zb.species === 'crow') continue;
      const k = (Math.floor(zb.pos.x / 2) + 1000) * 4096 + (Math.floor(zb.pos.z / 2) + 1000);
      let a = grid.get(k);
      if (!a) grid.set(k, a = []);
      a.push(zb);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const zb = this.list[i];
      zb.t += dt;
      if (zb.state === 'dead') {
        zb.deadT += dt;
        if (zb.exploding) {
          zb.fuse -= dt;
          if (zb.fuse <= 0) {
            zb.exploding = false;
            zb.root.visible = false;
            zb.deadT = Math.max(zb.deadT, 7.5);
            this.explode(zb.pos.x, zb.pos.y + 1, zb.pos.z, 4.5, 450, 55, 'bloater');
          }
        }
        this.animateDeath(zb, dt);
        if (zb.deadT > 8) { this.list.splice(i, 1); this.release(zb); }
        continue;
      }
      if (this.frozen) { this.animate(zb, dt, 0); continue; }
      if (zb.species === 'crow') { this.updateCrow(zb, dt, this.pickTarget(zb, targets, dt)); continue; }
      if (zb.state === 'climb') { this.updateClimb(zb, dt); continue; }
      if (zb.buffT > 0) zb.buffT -= dt;
      if (zb.def.explode) this.gas(zb, dt);
      if (zb.spitCd > 0) zb.spitCd -= dt;
      if (zb.leapCd > 0) zb.leapCd -= dt;
      const pl = this.pickTarget(zb, targets, dt), ppos = pl.pos, up = pl.zStair;

      // on a roof the player isn't on: head back to the stairwell door and go down
      const wrongRoof = zb.roof != null && (!up || zb.stair !== up);
      // player up on a roof with stairs: walk to the lobby door and climb
      if (zb.roof == null && up && !pl.vehicle) {
        for (const d of up.doors) {
          if (Math.abs(d.x - zb.pos.x) < 1.6 && Math.abs(d.z - zb.pos.z) < 1.6) { this.startClimb(zb, up, true); break; }
        }
        if (zb.state === 'climb') continue;
      }
      if (wrongRoof && Math.hypot(zb.stair.roof.x - zb.pos.x, zb.stair.roof.z - zb.pos.z) < 1.3) { this.startClimb(zb, zb.stair, false); continue; }

      const dx = ppos.x - zb.pos.x, dz = ppos.z - zb.pos.z;
      const dist = Math.hypot(dx, dz);
      const dy = Math.abs(ppos.y - zb.pos.y);

      // bloater: arms its fuse when it reaches you
      if (zb.def.explode && dist < 1.9 && dy < 1.6 && !pl.dead && !wrongRoof && !(pl.vehicle && pl.vehicle.type === 'car')) {
        this.audio.play('hiss', { pos: zb.pos, vol: 1 });
        this.kill(zb, null, false, 'fuse');
        continue;
      }

      // screamer: stops and screams, speeding up everything nearby and calling more
      if (zb.state === 'scream') {
        zb.attackT += dt;
        zb.heading = lerpAngle(zb.heading, Math.atan2(dx, dz), 1 - Math.exp(-8 * dt));
        if (zb.attackT > 1.7) {
          zb.state = 'chase';
          this.play(zb, this.moveClip(zb));
        }
        this.animate(zb, dt, 0);
        this.place(zb);
        continue;
      }
      // spitter: stands and spits; leaper: crouched to spring, or in the air
      if (zb.state === 'spit') { this.spitting(zb, dt, pl, dx, dz); continue; }
      if (zb.state === 'crouch' || zb.state === 'leap') { this.leaping(zb, dt, pl, dx, dz, dist, targets); continue; }

      // --- attack ---
      const v = pl.vehicle;
      // someone in a car: they go for the car itself (while it's slow enough to get hold of); a
      // fast bike is out of reach
      const inCar = !!v && v.type === 'car';
      const shielded = !!v && !inCar && v.type === 'bike' && Math.abs(v.speed) > 2.5;
      const big = !!zb.def.boss;   // (the giant: a longer reach, a slower, heavier swing)
      const carGap = inCar ? gapToBox(zb.pos, v) : Infinity, carSlow = inCar && Math.abs(v.speed) < (big ? 6 : 3.5);
      const dog = zb.species === 'dog';
      const reach = ((dog ? 1.5 : zb.def.crawl ? 1.2 : 1.3) + (v && v.type === 'bike' ? 0.3 : 0) + (zb.def.shove ? 0.2 : 0)) * (big ? 1.6 : 1);
      const windup = dog ? 0.22 : big ? 0.75 : 0.45, total = dog ? 0.65 : big ? 1.5 : 1.0;
      zb.attackCd -= dt;
      if (zb.state === 'attack') {
        zb.attackT += dt;
        zb.heading = lerpAngle(zb.heading, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
        if (dog) {
          // the leap: forward and up, then down
          const k = Math.min(1, zb.attackT / (windup + 0.15));
          zb.leap = Math.sin(k * Math.PI) * 0.45;
          if (zb.attackT < windup && dist > 0.9) { zb.pos.x += Math.sin(zb.heading) * 4 * dt; zb.pos.z += Math.cos(zb.heading) * 4 * dt; }
        }
        if (!zb.dealt && zb.attackT > windup) {
          zb.dealt = true;
          if (inCar) {
            // a blow on the car; once its windows are gone it reaches the driver too
            if (carGap < (big ? 1.8 : 0.95) && carSlow && !pl.dead && this.onClawCar && this.onClawCar(v, zb)) {
              const hurt = zb.damage * 0.35;
              pl.damage(hurt, zb.pos.x, zb.pos.z);
              if (this.onPlayerHit) this.onPlayerHit(zb, pl, hurt, zb.pos.x, zb.pos.z);
            }
          } else if (dist < reach + 0.45 && dy < 1.5 && !pl.dead && !shielded && !(v && v.type === 'drone')) {
            if (pl.damage(zb.damage, zb.pos.x, zb.pos.z)) {
              if (zb.def.shove && !v) { pl.vel.x += (dx / (dist || 1)) * zb.def.shove; pl.vel.z += (dz / (dist || 1)) * zb.def.shove; pl.shake = Math.min(1, pl.shake + 0.4); }
              if (big && !v) { pl.vel.y += 4; pl.onGround = false; pl.shake = 1; if (pl === this.player) pl.tumble = Math.max(pl.tumble || 0, 0.55); }
              this.audio.play('bite', pl === this.player ? { vol: 0.9, rate: dog ? 1.3 : 1 } : { pos: pl.pos, vol: 0.8, rate: dog ? 1.3 : 1 });
              if (this.onPlayerHit) this.onPlayerHit(zb, pl, zb.damage, zb.pos.x, zb.pos.z);
            }
          }
        }
        if (zb.attackT > total) {
          zb.state = 'chase';
          zb.leap = 0;
          zb.attackCd = dog ? 1.0 + Math.random() * 0.6 : 0.35;
          this.play(zb, this.moveClip(zb));
        }
        this.animate(zb, dt, 0);
        this.place(zb);
        continue;
      }
      const canHit = inCar ? carGap < (big ? 1.5 : 0.75) && carSlow && dy < 2 : !shielded && dist < reach && dy < (big ? 2.5 : 1.5) && !(v && v.type === 'drone' && dy > 0.6);
      if (!wrongRoof && canHit && zb.attackCd <= 0 && !pl.dead) {
        zb.state = 'attack'; zb.attackT = 0; zb.dealt = false;
        this.audio.play(dog ? 'growl' : 'attack', { pos: zb.pos, vol: big ? 1.4 : 0.9, rate: big ? 0.5 : zb.def.shove ? 0.7 : 1 });
        this.play(zb, 'attack', 0.1);
        continue;
      }

      // --- steering ---
      let wx, wz;
      const onRoof = zb.roof != null;
      const zU = onRoof ? null : this.levelOf(zb.pos.x, zb.pos.z, zb.pos.y), pU = pl.zLevel;
      const offNav = onRoof || !!zU;   // the ground-level flow field doesn't cover roofs or the car parks
      zb.losT -= dt;
      if (zb.losT <= 0) {
        zb.losT = 0.2 + Math.random() * 0.1;
        zb.direct = !wrongRoof && zU === pU && dist < 24 && Math.abs(ppos.y - zb.pos.y) < 2.5 && (offNav || nav.lineWalkable(zb.pos.x, zb.pos.z, ppos.x, ppos.z))
          && this.col.clear(zb.pos.x, zb.pos.y + 1.2, zb.pos.z, ppos.x, ppos.y + 1.4, ppos.z);
      }
      const seePlayer = zb.direct && zb.forceField <= 0;
      if (zb.forceField > 0) zb.forceField -= dt;
      if (zb.def.scream && !zb.screamed && seePlayer && dist < 26) {
        zb.screamed = true;
        zb.state = 'scream';
        zb.attackT = 0;
        this.audio.play('scream', { pos: zb.pos, vol: 1.2 });
        this.play(zb, 'scream', 0.1);
        for (const o of this.list) if (o.state !== 'dead' && Math.hypot(o.pos.x - zb.pos.x, o.pos.z - zb.pos.z) < 28) o.buffT = 10;
        if (this.onScream) this.onScream(zb);
        continue;
      }
      // the giant roars when it first sets eyes on you
      if (big && !zb.screamed && seePlayer && dist < 32) {
        zb.screamed = true;
        zb.state = 'scream';
        zb.attackT = 0;
        this.audio.play('roar', { pos: zb.pos, vol: 1.6, ref: 14 });
        this.play(zb, 'scream', 0.1);
        continue;
      }
      // spitter: in range and in sight, it stops to spit
      if (zb.def.spit && !v && seePlayer && zb.spitCd <= 0 && dist > 5 && dist < 19 && !wrongRoof) {
        zb.state = 'spit'; zb.attackT = 0; zb.dealt = false; zb.vel.set(0, 0, 0);
        this.play(zb, zb.actions && zb.actions.scream ? 'scream' : 'attack', 0.15);
        continue;
      }
      // leaper: a few metres off, it crouches to spring
      if (zb.def.leaper && !v && seePlayer && zb.leapCd <= 0 && dist > 3 && dist < 9.5 && Math.abs(ppos.y - zb.pos.y) < 1.2 && !wrongRoof) {
        zb.state = 'crouch'; zb.attackT = 0; zb.vel.set(0, 0, 0);
        this.audio.play('growl', { pos: zb.pos, vol: 0.9, rate: 0.8 });
        continue;
      }
      let door = null;
      const toward = (t) => { const tx = t.x - zb.pos.x, tz = t.z - zb.pos.z, tl = Math.hypot(tx, tz) || 1; wx = tx / tl; wz = tz / tl; };
      if (wrongRoof) toward(zb.stair.roof);
      else if (zU && zU !== pU) {
        // leave the car park: along its flow field to a ramp door, then up the ramp
        const d = this.underground.nearestDoor(zU, zb.pos.x, zb.pos.z);
        // at the doorway (anywhere between just inside and the ramp): carry on up the ramp (not from
        // the other side of the ramp's wall, where a car park runs alongside it)
        if (Math.hypot(d.in.x - zb.pos.x, d.in.z - zb.pos.z) < 3 || (Math.hypot(d.out.x - zb.pos.x, d.out.z - zb.pos.z) < 5.6 && this.col.clear(zb.pos.x, zb.pos.y + 1, zb.pos.z, d.out.x, zb.pos.y + 1, d.out.z))) toward(d.out);
        else if (this.unav && !pU && this.unav.direction(zb.pos.x, zb.pos.z, this.dir)) { wx = this.dir.x; wz = this.dir.z; }
        else toward(d.in);
      } else if (!zU && pU && zb.pos.y < pU.floor + 1.6 && (door = pU.doors.find((q) => Math.hypot(q.out.x - zb.pos.x, q.out.z - zb.pos.z) < 4))) toward(door.in); // at the bottom of the ramp: in
      else if (zU && !seePlayer && dist >= 1.8 && this.unav && this.unav.direction(zb.pos.x, zb.pos.z, this.dir)) { wx = this.dir.x; wz = this.dir.z; }
      else if (seePlayer || dist < 1.8 || onRoof || zU) { wx = dx / (dist || 1); wz = dz / (dist || 1); }
      else if (nav.direction(zb.pos.x, zb.pos.z, this.dir)) { wx = this.dir.x; wz = this.dir.z; }
      else { wx = dx / (dist || 1); wz = dz / (dist || 1); }
      // separation
      let sx = 0, sz = 0;
      const cx = Math.floor(zb.pos.x / 2), cz = Math.floor(zb.pos.z / 2);
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const a = grid.get((cx + ox + 1000) * 4096 + (cz + oz + 1000));
        if (!a) continue;
        for (const o of a) {
          if (o === zb || Math.abs(o.pos.y - zb.pos.y) > 1.5) continue;
          const ex = zb.pos.x - o.pos.x, ez = zb.pos.z - o.pos.z, d2 = ex * ex + ez * ez;
          const minD = zb.small && o.small ? 0.6 : (zb.def.boss || o.def.boss) ? 1.9 : (zb.def.shove || o.def.shove) ? 1.15 : 0.9;
          if (d2 < minD * minD && d2 > 1e-6) { const d = Math.sqrt(d2); sx += (ex / d) * (minD - d); sz += (ez / d) * (minD - d); }
        }
      }
      wx += sx * 1.6; wz += sz * 1.6;
      const wl = Math.hypot(wx, wz) || 1;
      let speed = zb.speed * (zb.buffT > 0 || this.hurry ? 1.35 : 1);
      // far away and out of sight: hurry up (so waves never stall), or get moved closer
      if (!offNav) {
        const pathD = nav.distanceNear(zb.pos.x, zb.pos.z);
        zb.progT += dt;
        if (zb.progT > 3) {
          // (a few metres from as close as it can get: waiting under a player up on a roof, or queueing
          // behind the others, not stuck)
          if (isFinite(pathD) && isFinite(zb.lastPath) && pathD > zb.lastPath - 1.0 && dist > 3) { zb.forceField = 3; zb.stuckT = pathD > 6 ? zb.stuckT + 3 : 0; }
          else zb.stuckT = 0;
          zb.lastPath = pathD; zb.progT = 0;
        }
        if (!seePlayer && pathD > 40 && !dog) speed *= zb.def.move === 'run' ? 1.3 : zb.def.crawl ? 2.6 : 2.1;
        zb.hiddenT = seePlayer ? 0 : zb.hiddenT + dt;
        if (this.relocate && ((zb.hiddenT > 9 && (pathD > 85 || zb.stuckT > 5)) || (this.hurry && zb.hiddenT > 4 && pathD > 40))) { zb.hiddenT = 0; zb.stuckT = 0; this.relocate(zb); }
      }
      if (zb.hitT > 0) { zb.hitT -= dt; speed *= 0.35; }
      if (zb.hitAnim > 0) { zb.hitAnim -= dt; if (zb.hitAnim <= 0) this.play(zb, this.moveClip(zb)); }
      const agility = dog ? 9 : 6;
      zb.vel.x = THREE.MathUtils.damp(zb.vel.x, (wx / wl) * speed, agility, dt);
      zb.vel.z = THREE.MathUtils.damp(zb.vel.z, (wz / wl) * speed, agility, dt);
      const p = { x: zb.pos.x + zb.vel.x * dt, z: zb.pos.z + zb.vel.z * dt };
      // keep an arm's length from the player; crowds shove the player a little
      const ex = p.x - ppos.x, ez = p.z - ppos.z, ed = Math.hypot(ex, ez), arm = big ? 1.3 : 0.75;
      if (!v && ed < arm && Math.abs(ppos.y - zb.pos.y) < 1.5) {
        const push = (arm - ed) / (ed || 1);
        // (co-op: players aren't nudged, a client couldn't predict it; the zombie gives way)
        const k = this.targets ? 1 : 0.8;
        p.x += ex * push * k; p.z += ez * push * k;
        if (!this.targets) { pl.pos.x -= ex * push * 0.2; pl.pos.z -= ez * push * 0.2; }
      }
      const gy = onRoof ? zb.roof : this.floorAt(p.x, p.z, zb.pos.y);
      if (gy - zb.pos.y < 0.75) {
        this.col.resolve(p, dog ? 0.28 : big ? 0.55 : 0.3, zb.pos.y + 0.3, zb.pos.y + (zb.small ? 0.9 : 1.7), 2, SKIP);
        const moved = Math.hypot(p.x - zb.pos.x, p.z - zb.pos.z);
        zb.pos.x = p.x; zb.pos.z = p.z;
        zb.phase += moved * (dog ? 2.4 : zb.def.move === 'run' ? 1.9 : 2.6);
      }
      zb.pos.y = THREE.MathUtils.damp(zb.pos.y, this.groundOf(zb), 12, dt);
      const sp = Math.hypot(zb.vel.x, zb.vel.z);
      if (sp > 0.05) zb.heading = lerpAngle(zb.heading, Math.atan2(zb.vel.x, zb.vel.z), 1 - Math.exp(-(dog ? 10 : 7) * dt));
      if (zb.anim === 'model' && zb.current && zb.state === 'chase' && !(zb.hitAnim > 0)) {
        const ref = (dog ? 5 : zb.def.move === 'run' ? 3.5 : zb.def.crawl ? 1.1 : 1.2) * (big ? zb.scale * 0.8 : 1);
        zb.current.timeScale = THREE.MathUtils.clamp(sp / ref, 0.4, 1.8);
      }
      // groans / growls
      zb.groanT -= dt;
      if (zb.groanT <= 0) {
        zb.groanT = dog ? 2 + Math.random() * 3 : 3 + Math.random() * 7;
        if (dist < 45) this.audio.play(dog ? 'growl' : 'groan', { pos: zb.pos, vol: dog ? 0.5 : big ? 1.1 : 0.6, rate: big ? 0.5 : zb.def.shove ? 0.72 : 0.9 + Math.random() * 0.2 });
      }
      this.animate(zb, dt, sp);
      this.place(zb);
      if (big) this.stomp(zb);
    }
  }

  // ---------------------------------------------------------------- the special kinds
  // Spitter: rears back, and at the top of it spits a glob at where you're going to be.
  spitting(zb, dt, pl, dx, dz) {
    zb.attackT += dt;
    zb.heading = lerpAngle(zb.heading, Math.atan2(dx, dz), 1 - Math.exp(-8 * dt));
    if (!zb.dealt && zb.attackT > 0.6) {
      zb.dealt = true;
      if (!pl.dead && !pl.vehicle) this.spit(zb, pl);
    }
    if (zb.attackT > 1.1) {
      zb.state = 'chase';
      zb.spitCd = 3.2 + Math.random() * 2.3;
      this.play(zb, this.moveClip(zb));
    }
    this.animate(zb, dt, 0);
    this.place(zb);
  }

  spit(zb, pl) {
    const h = zb.hb ? zb.hb.head.getWorldPosition(this.tmpA) : this.tmpA.set(zb.pos.x, zb.pos.y + 1.6 * zb.scale, zb.pos.z);
    const o = new THREE.Vector3(h.x + Math.sin(zb.heading) * 0.25, h.y + 0.08, h.z + Math.cos(zb.heading) * 0.25);
    const d = Math.hypot(pl.pos.x - o.x, pl.pos.z - o.z);
    const T = THREE.MathUtils.clamp(d / 13, 0.5, 1.3);
    // where they'll be, roughly (and never quite dead on)
    const tx = pl.pos.x + (pl.vel ? pl.vel.x : 0) * T * 0.7 + (Math.random() - 0.5) * 0.9;
    const tz = pl.pos.z + (pl.vel ? pl.vel.z : 0) * T * 0.7 + (Math.random() - 0.5) * 0.9;
    const ty = pl.pos.y + 0.7;
    const v = new THREE.Vector3((tx - o.x) / T, (ty - o.y) / T + 0.5 * SPIT_G * T, (tz - o.z) / T);
    const id = this.globSeq = (this.globSeq + 1) & 0xffff;
    this.addGlob(id, o, v, zb.damage * 0.8, false);
    this.onSpit?.(id, o, v);
  }

  addGlob(id, o, v, dmg, visual) {
    const K = acidParts();
    const mesh = new THREE.Mesh(K.globGeo, K.globMat);
    mesh.position.copy(o);
    this.scene.add(mesh);
    this.globs.push({ id, mesh, pos: o.clone(), vel: v.clone(), dmg, visual, t: 0, trail: 0, landed: false });
    this.audio.play('spit', { pos: o, vol: 1 });
  }

  // co-op client: the host's spitter spat (drawn here; the host says where it lands)
  spitFx(id, p, v) { this.addGlob(id, new THREE.Vector3(...p), new THREE.Vector3(...v), 0, true); }
  splatFx(id, p, r) {
    const i = this.globs.findIndex((b) => b.id === id);
    if (i >= 0) { const b = this.globs[i]; this.scene.remove(b.mesh); this.globs.splice(i, 1); if (!b.landed) this.splash(this.tmpB.set(...p)); }
    if (r > 0) this.puddle(p[0], p[1], p[2], r);
  }

  splash(p) {
    this.fx.emit(p, 16, { color: [0.6, 0.95, 0.2], speed: 2.6, spread: 1.4, up: 1.2, life: 0.6, size: 0.08, gravity: 9 });
    this.audio.play('splat', { pos: p, vol: 1 });
  }

  puddle(x, y, z, r) {
    const K = acidParts();
    const mesh = new THREE.Mesh(K.poolGeo, K.poolMat);
    mesh.position.set(x, y + 0.03, z);
    mesh.rotation.y = Math.random() * 6.28;
    mesh.scale.setScalar(0.01);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.acid.push({ mesh, x, y, z, r, t: 0, life: 7, tick: 0.25, dmg: 4 });
    if (this.acid.length > 12) { this.scene.remove(this.acid[0].mesh); this.acid.shift(); }
  }

  // globs in flight (they burst on a player, a wall or the ground) and the puddles burning
  updateAcid(dt) {
    if (!this.globs.length && !this.acid.length) return;
    const real = !this.puppets;
    for (let i = this.globs.length - 1; i >= 0; i--) {
      const b = this.globs[i];
      b.t += dt;
      if (b.landed) { if (b.t > 4) { this.scene.remove(b.mesh); this.globs.splice(i, 1); } continue; }
      const ox = b.pos.x, oy = b.pos.y, oz = b.pos.z;
      b.vel.y -= SPIT_G * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      b.trail -= dt;
      if (b.trail <= 0) { b.trail = 0.025; this.fx.emit(b.pos, 1, { color: [0.6, 0.95, 0.2], speed: 0.25, spread: 1, up: 0, life: 0.45, size: 0.06, gravity: 1.5 }); }
      let hit = null;
      if (real) {
        for (const pl of this.targetList()) {
          if (pl.dead || (pl.vehicle && pl.vehicle.type !== 'bike')) continue;
          if (Math.abs(b.pos.x - pl.pos.x) < 0.45 && Math.abs(b.pos.z - pl.pos.z) < 0.45 && b.pos.y > pl.pos.y - 0.1 && b.pos.y < pl.pos.y + 1.9) { hit = pl; break; }
        }
      }
      const floor = Math.max(this.floorAt(b.pos.x, b.pos.z, oy), this.player.roofAt ? this.player.roofAt(b.pos.x, b.pos.z) : -Infinity);
      const landed = b.pos.y <= floor;
      const wall = !hit && !landed && !this.col.clear(ox, oy, oz, b.pos.x, b.pos.y, b.pos.z);
      if (!hit && !landed && !wall && b.t < 4) continue;
      if (!real) { b.landed = true; b.mesh.visible = false; this.splash(b.pos); continue; }   // (the host's word decides the puddle)
      this.scene.remove(b.mesh);
      this.globs.splice(i, 1);
      let pool = 0, px = b.pos.x, py = floor, pz = b.pos.z;
      if (hit) {
        pool = 0.9; px = hit.pos.x; py = hit.pos.y; pz = hit.pos.z;
        if (hit.damage(b.dmg, ox, oz)) {
          if (hit === this.player) this.audio.play('hiss', { vol: 0.5, rate: 1.5 });
          if (this.onPlayerHit) this.onPlayerHit(null, hit, b.dmg, ox, oz);
        }
      } else if (landed && oy >= floor - 0.3) pool = 1.5;   // (it came down on it, not through a wall)
      this.splash(b.pos);
      if (pool) this.puddle(px, py, pz, pool);
      this.onSplat?.(b.id, [px, pool ? py : b.pos.y, pz], pool);
    }
    for (let i = this.acid.length - 1; i >= 0; i--) {
      const a = this.acid[i];
      a.t += dt;
      if (a.t > a.life) { this.scene.remove(a.mesh); this.acid.splice(i, 1); continue; }
      const k = a.t < 0.25 ? a.t / 0.25 : a.t > a.life - 1.5 ? (a.life - a.t) / 1.5 : 1;
      a.mesh.scale.setScalar(a.r * Math.max(0.01, k));
      if (Math.random() < dt * 5) this.fx.emit(this.tmpC.set(a.x + (Math.random() - 0.5) * a.r, a.y + 0.05, a.z + (Math.random() - 0.5) * a.r), 1, { color: [0.55, 0.9, 0.2], speed: 0.3, spread: 0.5, up: 1, life: 0.7, size: 0.05, gravity: -0.5 });
      if (!real) continue;
      a.tick -= dt;
      if (a.tick > 0) continue;
      a.tick = 0.5;
      // (standing in it burns; a car or a bike keeps your feet out of it)
      for (const pl of this.targetList()) {
        if (pl.dead || pl.vehicle || Math.abs(pl.pos.y - a.y) > 0.7 || Math.hypot(pl.pos.x - a.x, pl.pos.z - a.z) > a.r * 0.85 * k) continue;
        pl.damage(a.dmg, pl.pos.x, pl.pos.z);
        if (pl === this.player) this.audio.play('hiss', { vol: 0.35, rate: 1.7 });
        if (this.onPlayerHit) this.onPlayerHit(null, pl, a.dmg, a.x, a.z);
      }
    }
  }

  // Leaper: crouches, springs at where you'll be, and whoever it lands on goes down.
  leaping(zb, dt, pl, dx, dz, dist, targets) {
    zb.attackT += dt;
    if (zb.state === 'crouch') {
      zb.heading = lerpAngle(zb.heading, Math.atan2(dx, dz), 1 - Math.exp(-12 * dt));
      zb.crouchK = Math.min(1, zb.attackT / 0.3);
      zb.pitch = zb.crouchK * 0.35;
      if (zb.current) zb.current.timeScale = 0.25;
      if (zb.attackT > 0.45) {
        const T = THREE.MathUtils.clamp(0.3 + dist * 0.05, 0.45, 0.8);
        const tx = pl.pos.x + (pl.vel ? pl.vel.x : 0) * T * 0.6 - zb.pos.x, tz = pl.pos.z + (pl.vel ? pl.vel.z : 0) * T * 0.6 - zb.pos.z;
        const tl = Math.hypot(tx, tz) || 1, land = THREE.MathUtils.clamp(tl - 0.4, 0, 10);
        zb.leapV = { x: (tx / tl) * land / T, z: (tz / tl) * land / T, T, h: Math.min(1.2, 0.45 + land * 0.08), t: 0 };
        zb.state = 'leap'; zb.dealt = false;
        zb.heading = Math.atan2(tx, tz);
        this.play(zb, 'attack', 0.08);
        this.audio.play('attack', { pos: zb.pos, vol: 1.1, rate: 1.25 });
      }
      this.animate(zb, dt, 0);
      this.place(zb);
      return;
    }
    // in the air
    const L = zb.leapV;
    L.t += dt;
    const k = Math.min(1, L.t / L.T);
    zb.crouchK = Math.max(0, zb.crouchK - dt * 6);
    zb.pitch = 0.5 * Math.sin(k * Math.PI);
    const p = { x: zb.pos.x + L.x * dt, z: zb.pos.z + L.z * dt };
    this.col.resolve(p, 0.3, zb.pos.y + 0.3 + zb.leap, zb.pos.y + 1.7 + zb.leap, 2, SKIP);
    zb.pos.x = p.x; zb.pos.z = p.z;
    zb.pos.y = THREE.MathUtils.damp(zb.pos.y, this.groundOf(zb), 12, dt);
    zb.vel.set(L.x, 0, L.z);
    zb.leap = Math.sin(k * Math.PI) * L.h;
    // whoever it comes down on: hurt, knocked back (and off their feet, if it's us)
    if (!zb.dealt && k > 0.5) {
      for (const t of targets) {
        if (t.dead || t.vehicle || Math.hypot(t.pos.x - zb.pos.x, t.pos.z - zb.pos.z) > 1.15 || Math.abs(t.pos.y - zb.pos.y) > 1.5) continue;
        zb.dealt = true;
        const hurt = zb.damage * 1.2, ux = L.x / (Math.hypot(L.x, L.z) || 1), uz = L.z / (Math.hypot(L.x, L.z) || 1);
        if (!t.damage(hurt, zb.pos.x, zb.pos.z)) break;
        t.vel.x += ux * 5; t.vel.z += uz * 5;
        t.shake = Math.min(1, t.shake + 0.6);
        if (t === this.player) t.tumble = Math.max(t.tumble || 0, 0.4);
        this.audio.play('bite', t === this.player ? { vol: 1 } : { pos: t.pos, vol: 0.9 });
        if (this.onPlayerHit) this.onPlayerHit(zb, t, hurt, zb.pos.x, zb.pos.z);
        break;
      }
    }
    if (k >= 1) {
      zb.leap = 0; zb.pitch = 0;
      zb.state = 'chase';
      zb.leapCd = 3 + Math.random() * 2.5;
      zb.hitT = 0.45;   // (a stumble on landing: your moment)
      zb.attackCd = 0.4;
      zb.vel.multiplyScalar(0.2);
      this.play(zb, this.moveClip(zb));
      this.audio.play('step', { pos: zb.pos, vol: 0.9, rate: 0.7 });
    }
    this.animate(zb, dt, 0);
    this.place(zb);
  }

  // The giant's footsteps: a thud, and the ground shakes if you're near.
  stomp(zb) {
    const n = Math.floor(zb.phase / Math.PI);
    if (n === zb.stepN) return;
    zb.stepN = n;
    this.audio.play('stomp', { pos: zb.pos, vol: 1.3, ref: 10 });
    const me = this.player, d = Math.hypot(me.pos.x - zb.pos.x, me.pos.z - zb.pos.z);
    if (d < 28 && !me.dead) me.shake = Math.min(1, me.shake + 0.2 * (1 - d / 28));
  }

  // how much the giant has left, 0..1 (null: none about)
  bossHealth() {
    for (const zb of this.list) if (zb.def && zb.def.boss && zb.state !== 'dead') return this.puppets ? zb.bossHp ?? 1 : Math.max(0, zb.hp / zb.maxHp);
    return null;
  }

  // ---------------------------------------------------------------- co-op: host side
  // Where every zombie was over the last half second, so a shot is checked against what the
  // shooter actually saw (lag compensation).
  record(tick) {
    for (const zb of this.list) {
      const h = zb.hist || (zb.hist = new Float32Array(HIST * 4).fill(-1));
      const i = (tick % HIST) * 4;
      h[i] = tick; h[i + 1] = zb.pos.x; h[i + 2] = zb.pos.y + (zb.leap || 0); h[i + 3] = zb.pos.z;
    }
  }

  // [dx, dy, dz] from where it is now to where it was at `tick` (fractional), or null
  rewindOffset(zb, tick) {
    const h = zb.hist;
    if (!h) return null;
    const t0 = Math.floor(tick), f = tick - t0;
    const a = (t0 % HIST) * 4, b = ((t0 + 1) % HIST) * 4;
    if (h[a] !== t0) return null;
    let x = h[a + 1], y = h[a + 2], z = h[a + 3];
    if (f > 0 && h[b] === t0 + 1) { x += (h[b + 1] - x) * f; y += (h[b + 2] - y) * f; z += (h[b + 3] - z) * f; }
    return [x - zb.pos.x, y - zb.pos.y - (zb.leap || 0), z - zb.pos.z];
  }

  // what the other players need to draw one zombie
  netState(zb) {
    const st = zb.state === 'dead' ? 3 : zb.species === 'crow' ? NET_STATES.indexOf(zb.crowState) : Math.max(0, NET_STATES.indexOf(zb.state));
    const hs = Math.hypot(zb.vel.x, zb.vel.z);
    return {
      nid: zb.nid, type: TYPE_KEYS.indexOf(zb.type), variant: zb.variant ?? 0, state: st,
      x: zb.pos.x, y: zb.pos.y, z: zb.pos.z, heading: zb.heading,
      rate: zb.current ? zb.current.timeScale : 1,
      extra: zb.species === 'crow' ? -Math.atan2(zb.vel.y, hs) * 0.7 : zb.def.boss ? Math.max(0, zb.hp / zb.maxHp) : zb.leap || 0,
      scale: zb.scale,
      flags: (!zb.root.visible && zb.state !== 'climb' ? 1 : 0) | (zb.hitAnim > 0 || zb.hitT > 0 ? 2 : 0) | (zb.buffT > 0 ? 4 : 0) | (zb.exploding ? 8 : 0),
    };
  }

  // ---------------------------------------------------------------- co-op: client side
  // The host's zombies arrive in snapshots; here they're puppets: no AI, just drawn where the
  // host had them a moment ago (interpolated), with their animations and sounds.
  netUpdate(list, tick) {
    const now = performance.now();
    for (const s of list) {
      let zb = this.byNid.get(s.nid);
      if (zb && zb.typeIdx !== s.type) { this.dropPuppet(zb); zb = null; }   // the id was reused
      if (!zb) zb = this.makePuppet(s);
      if (!zb) continue;
      zb.seenAt = now;
      const b = zb.buf;
      if (b.length && b[b.length - 1].tick >= tick) continue;
      b.push({ tick, x: s.x, y: s.y, z: s.z, h: s.heading, st: s.state, rate: s.rate, ex: s.extra, fl: s.flags });
      if (b.length > 16) b.shift();
    }
  }

  makePuppet(s) {
    const type = TYPE_KEYS[s.type];
    const def = TYPES[type];
    if (!def) return null;
    const pool = this.pools.get(this.poolKey(type, s.variant));
    const zb = (pool && pool.pop()) || Object.assign(this.build(type, s.variant), { type });
    Object.assign(zb, {
      nid: s.nid, typeIdx: s.type, def, species: def.species || 'human', scale: s.scale || 1, roof: null, stair: null,
      state: '', t: 0, phase: Math.random() * 10, deadT: 0, attackT: 0, hitT: 0, hitAnim: 0, leap: 0, fallDir: 1, fallV: 0,
      small: def.species === 'dog' || def.species === 'crow' || !!def.crawl, crowState: 'circle', exploding: false,
      lean: 0.1 + Math.random() * 0.2, tilt: (Math.random() - 0.5) * 0.5, armAsym: (Math.random() - 0.5) * 0.5,
      pos: new THREE.Vector3(s.x, s.y, s.z), vel: new THREE.Vector3(), heading: s.heading, buf: [], groanT: 2 + Math.random() * 6,
      crouchK: 0, pitch: 0, stepN: 0, bossHp: 1, fling: null,
    });
    const w = def.wide || 1;
    zb.root.scale.set(zb.scale * w, zb.scale, zb.scale * w);
    zb.root.rotation.set(0, zb.heading, 0);
    zb.root.position.copy(zb.pos);
    zb.root.visible = true;
    if (zb.anim === 'model') { zb.mixer.stopAllAction(); zb.current = null; }
    this.scene.add(zb.root);
    this.list.push(zb);
    this.byNid.set(zb.nid, zb);
    return zb;
  }

  dropPuppet(zb) {
    const i = this.list.indexOf(zb);
    if (i >= 0) this.list.splice(i, 1);
    this.release(zb);
  }

  updatePuppets(dt, renderTick, listener) {
    const now = performance.now();
    this.updateAcid(dt);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const zb = this.list[i];
      if (now - zb.seenAt > 1200) { this.list.splice(i, 1); this.release(zb); continue; }
      const b = zb.buf;
      if (!b.length) continue;
      // the two snapshots around renderTick (hold the newest if we run past it)
      let a = b[0], c = b[b.length - 1];
      for (let k = 0; k < b.length; k++) {
        if (b[k].tick <= renderTick) a = b[k];
        if (b[k].tick >= renderTick) { c = b[k]; break; }
      }
      if (a.tick > c.tick) c = a;
      const f = c.tick > a.tick ? THREE.MathUtils.clamp((renderTick - a.tick) / (c.tick - a.tick), 0, 1) : 0;
      const cur = renderTick >= c.tick ? c : a;
      const px = zb.pos.x, py = zb.pos.y, pz = zb.pos.z;
      zb.pos.set(a.x + (c.x - a.x) * f, a.y + (c.y - a.y) * f, a.z + (c.z - a.z) * f);
      zb.heading = lerpAngle(a.h, c.h, f);
      if (dt > 0) zb.vel.set((zb.pos.x - px) / dt, (zb.pos.y - py) / dt, (zb.pos.z - pz) / dt);
      zb.t += dt;
      this.puppetState(zb, NET_STATES[cur.st] || 'chase');
      const fl = cur.fl;
      const ex = a.ex + (c.ex - a.ex) * f;
      zb.leap = (zb.species === 'dog' && zb.state === 'attack') || zb.state === 'leap' ? Math.max(0, ex) : 0;
      if (zb.def.boss) zb.bossHp = cur.ex;
      if (zb.def.leaper) {
        zb.crouchK = zb.state === 'crouch' ? Math.min(1, zb.crouchK + dt / 0.3) : Math.max(0, zb.crouchK - dt * 6);
        zb.pitch = zb.state === 'leap' ? 0.5 * Math.min(1, zb.leap / 0.5) : zb.crouchK * 0.35;
      }
      if (zb.state === 'dead') {
        zb.deadT += dt;
        if (fl & 1) zb.root.visible = false;
        if (zb.species === 'crow') {
          zb.root.position.copy(zb.pos);
          if (zb.vel.y < -0.5) zb.root.rotation.z += dt * 7;
          if (zb.anim === 'model') zb.mixer.update(0);
        } else this.animateDeath(zb, dt);
        continue;
      }
      if (zb.state === 'climb') continue;
      zb.root.visible = !(fl & 1);
      // a flinch when hit
      if (fl & 2) {
        zb.hitT = 0.2;
        if (zb.anim === 'model' && zb.actions.hit && zb.hitAnim <= 0 && zb.state === 'chase' && !zb.def.shove && Math.random() < 0.3) { this.play(zb, 'hit', 0.05); zb.hitAnim = 0.4; }
      }
      if (zb.hitT > 0) zb.hitT -= dt;
      if (zb.hitAnim > 0) { zb.hitAnim -= dt; if (zb.hitAnim <= 0 && zb.state === 'chase') this.play(zb, this.moveClip(zb)); }
      const sp = Math.hypot(zb.vel.x, zb.vel.z);
      if (zb.species === 'crow') {
        zb.crowState = zb.state;
        this.animate(zb, dt, sp);
        zb.root.position.copy(zb.pos);
        zb.root.rotation.set(a.ex + (c.ex - a.ex) * f, zb.heading, 0, 'YXZ');
      } else {
        if (zb.state === 'chase') zb.phase += sp * dt * (zb.species === 'dog' ? 2.4 : zb.def.move === 'run' ? 1.9 : 2.6);
        if (zb.state === 'attack' || zb.state === 'scream') zb.attackT += dt;
        if (zb.anim === 'model' && zb.current && zb.state === 'chase' && !(zb.hitAnim > 0)) zb.current.timeScale = THREE.MathUtils.clamp(cur.rate || 1, 0.3, 2);
        if (zb.state === 'crouch' && zb.current) zb.current.timeScale = 0.25;
        this.animate(zb, dt, sp);
        this.place(zb);
        if (zb.def.boss && zb.state === 'chase') this.stomp(zb);
      }
      // groans and growls, near the listener
      zb.groanT -= dt;
      if (zb.groanT <= 0) {
        const dog = zb.species === 'dog', crow = zb.species === 'crow';
        zb.groanT = crow ? 3 + Math.random() * 6 : dog ? 2 + Math.random() * 3 : 3 + Math.random() * 7;
        if (!listener || Math.hypot(listener.x - zb.pos.x, listener.z - zb.pos.z) < 45) {
          this.audio.play(crow ? 'caw' : dog ? 'growl' : 'groan', { pos: zb.pos, vol: crow ? 0.45 : dog ? 0.5 : zb.def.boss ? 1.1 : 0.6, rate: zb.def.boss ? 0.5 : zb.def.shove ? 0.72 : 0.9 + Math.random() * 0.2 });
        }
      }
    }
  }

  // a new state from the host: start its animation and sound
  puppetState(zb, st) {
    if (st === zb.state) return;
    const prev = zb.state;
    zb.state = st;
    const dog = zb.species === 'dog', crow = zb.species === 'crow';
    if (prev === 'climb') zb.root.visible = true;
    if (st === 'dead') {
      zb.deadT = 0; zb.fallDir = Math.random() < 0.65 ? 1 : -1; zb.fallV = 0; zb.leap = 0;
      if (prev) this.audio.play(crow ? 'caw' : dog ? 'yelp' : 'zdeath', { pos: zb.pos, vol: 0.8, rate: zb.def.shove ? 0.75 : 1 });
      if (zb.anim === 'model') {
        if (zb.def.crawl || !zb.actions.death) { if (zb.current) zb.current.timeScale = 0; }
        else this.play(zb, 'death', 0.1);
      }
      if (!crow && prev && prev !== 'climb') { const p = zb.pos.clone(); p.y = this.floorAt(p.x, p.z, p.y) + 0.03; this.fx.blood.add(p, UP, dog ? 0.8 : 1.2); }
      return;
    }
    if (st === 'climb') { zb.root.visible = false; return; }
    if (st === 'attack') {
      zb.attackT = 0;
      this.play(zb, 'attack', 0.1);
      if (prev) this.audio.play(dog ? 'growl' : 'attack', { pos: zb.pos, vol: zb.def.boss ? 1.4 : 0.9, rate: zb.def.boss ? 0.5 : zb.def.shove ? 0.7 : 1 });
    } else if (st === 'scream') {
      zb.attackT = 0;
      this.play(zb, 'scream', 0.1);
      if (prev) this.audio.play(zb.def.boss ? 'roar' : 'scream', { pos: zb.pos, vol: zb.def.boss ? 1.6 : 1.2 });
    } else if (st === 'spit') {
      zb.attackT = 0;
      this.play(zb, zb.actions && zb.actions.scream ? 'scream' : 'attack', 0.15);
    } else if (st === 'crouch') {
      zb.attackT = 0;
      if (prev) this.audio.play('growl', { pos: zb.pos, vol: 0.9, rate: 0.8 });
    } else if (st === 'leap') {
      this.play(zb, 'attack', 0.08);
      if (prev) this.audio.play('attack', { pos: zb.pos, vol: 1.1, rate: 1.25 });
    } else if (st === 'dive') {
      if (prev) this.audio.play('caw', { pos: zb.pos, vol: 0.7 });
      if (zb.actions && zb.actions.attack) this.play(zb, 'attack', 0.15);
    } else if (crow) this.play(zb, 'fly', 0.2);
    else this.play(zb, this.moveClip(zb));
  }

  // Into the stairwell: gone for a few seconds, then out of the door at the other end.
  startClimb(zb, stair, upward) {
    zb.state = 'climb';
    zb.stair = stair;
    zb.climbUp = upward ? 1 : 0;
    zb.climbT = (1.5 + stair.levels * 0.45) * (zb.species === 'dog' ? 0.5 : zb.def.move === 'run' ? 0.6 : zb.def.crawl ? 1.4 : 1);
    zb.root.visible = false;
  }

  updateClimb(zb, dt) {
    zb.climbT -= dt;
    if (zb.climbT > 0) return;
    const st = zb.stair;
    const a = Math.random() * Math.PI * 2, r = Math.random() * 0.6;
    if (zb.climbUp) {
      zb.roof = st.top;
      zb.pos.set(st.roof.x + Math.cos(a) * r, st.top, st.roof.z + Math.sin(a) * r);
    } else {
      const d = pick(st.doors);
      zb.roof = null;
      zb.pos.set(d.x + Math.cos(a) * r, this.hm.atWorld(d.x, d.z), d.z + Math.sin(a) * r);
    }
    zb.vel.set(0, 0, 0);
    zb.state = 'chase';
    zb.lastPath = Infinity; zb.hiddenT = 0; zb.stuckT = 0;
    zb.root.visible = true;
    this.place(zb);
    this.play(zb, this.moveClip(zb));
  }

  // bloaters leak a green haze
  gas(zb, dt) {
    zb.gasT -= dt;
    if (zb.gasT > 0) return;
    zb.gasT = 0.35 + Math.random() * 0.3;
    this.tmpA.set(zb.pos.x, zb.pos.y + 1.2 * zb.scale, zb.pos.z);
    this.fx.emit(this.tmpA, 2, { color: [0.35, 0.7, 0.18], speed: 0.4, spread: 1, up: 0.8, life: 1.6, size: 0.35, gravity: -0.4 });
  }

  // Crows circle overhead, dive at your head, then climb away and come round again.
  updateCrow(zb, dt, pl = this.player) {
    const hx = pl.pos.x, hy = pl.pos.y + 1.55, hz = pl.pos.z;
    if (zb.crowState === 'circle') {
      zb.orbit += dt * (0.55 + zb.speed * 0.03);
      const r = 8 + Math.sin(zb.t * 0.7 + zb.phase) * 2.5, hgt = hy + 6 + Math.sin(zb.t * 1.3 + zb.phase) * 1.5;
      const tx = hx + Math.cos(zb.orbit) * r - zb.pos.x, ty = hgt - zb.pos.y, tz = hz + Math.sin(zb.orbit) * r - zb.pos.z;
      const tl = Math.hypot(tx, ty, tz) || 1, sp = Math.min(zb.speed, tl * 2);
      zb.vel.x = THREE.MathUtils.damp(zb.vel.x, (tx / tl) * sp, 3, dt);
      zb.vel.y = THREE.MathUtils.damp(zb.vel.y, (ty / tl) * sp, 3, dt);
      zb.vel.z = THREE.MathUtils.damp(zb.vel.z, (tz / tl) * sp, 3, dt);
      zb.diveT -= dt;
      if (zb.diveT <= 0 && !pl.dead && tl < 14 && !pl.zLevel && !(pl.vehicle && pl.vehicle.type === 'car')) { zb.crowState = 'dive'; this.audio.play('caw', { pos: zb.pos, vol: 0.7 }); if (zb.actions && zb.actions.attack) this.play(zb, 'attack', 0.15); }
    } else if (zb.crowState === 'dive') {
      const tx = hx - zb.pos.x, ty = hy - zb.pos.y, tz = hz - zb.pos.z, tl = Math.hypot(tx, ty, tz) || 1;
      const sp = zb.speed * 1.3;
      zb.vel.x = THREE.MathUtils.damp(zb.vel.x, (tx / tl) * sp, 6, dt);
      zb.vel.y = THREE.MathUtils.damp(zb.vel.y, (ty / tl) * sp, 6, dt);
      zb.vel.z = THREE.MathUtils.damp(zb.vel.z, (tz / tl) * sp, 6, dt);
      if (tl < 0.9) {
        const safe = pl.vehicle && (pl.vehicle.type === 'car' || (pl.vehicle.type === 'bike' && Math.abs(pl.vehicle.speed) > 2.5));
        if (!safe) {
          if (pl.damage(zb.damage, zb.pos.x, zb.pos.z)) {
            this.audio.play('bite', pl === this.player ? { vol: 0.6, rate: 1.8 } : { pos: pl.pos, vol: 0.6, rate: 1.8 });
            if (this.onPlayerHit) this.onPlayerHit(zb, pl, zb.damage, zb.pos.x, zb.pos.z);
          }
        }
        zb.crowState = 'away';
        zb.climbT = 1.3;
        this.play(zb, 'fly', 0.2);
      }
      if (zb.t > 60) { zb.crowState = 'away'; this.play(zb, 'fly', 0.2); }
    } else {
      zb.vel.y = THREE.MathUtils.damp(zb.vel.y, 7, 4, dt);
      zb.climbT -= dt;
      if (zb.climbT <= 0) { zb.crowState = 'circle'; zb.diveT = 4.5 + Math.random() * 5; zb.t = 0; }
    }
    zb.pos.addScaledVector(zb.vel, dt);
    const floor = Math.max(this.hm.atWorld(zb.pos.x, zb.pos.z), pl.roofAt ? pl.roofAt(zb.pos.x, zb.pos.z) : -Infinity) + 0.4;
    if (zb.pos.y < floor) { zb.pos.y = floor; zb.vel.y = Math.max(0, zb.vel.y); }
    const hs = Math.hypot(zb.vel.x, zb.vel.z);
    if (hs > 0.1) zb.heading = Math.atan2(zb.vel.x, zb.vel.z);
    this.animate(zb, dt, hs);
    zb.root.position.copy(zb.pos);
    zb.root.rotation.set(-Math.atan2(zb.vel.y, hs) * 0.7, zb.heading, 0, 'YXZ');
    zb.groanT -= dt;
    if (zb.groanT <= 0) { zb.groanT = 3 + Math.random() * 6; this.audio.play('caw', { pos: zb.pos, vol: 0.45 }); }
  }

  place(zb) {
    zb.root.position.set(zb.pos.x, zb.pos.y + (zb.leap || 0), zb.pos.z);
    if (zb.def.leaper) {
      // crouched: squashed and leaning in; in the air: diving at you
      zb.root.rotation.set(zb.pitch || 0, zb.heading, 0, 'YXZ');
      zb.root.scale.y = zb.scale * (1 - 0.18 * (zb.crouchK || 0));
    } else zb.root.rotation.y = zb.heading;
  }

  // Procedural animation for code-built bodies (GLBs use their mixer).
  animate(zb, dt, speed) {
    if (zb.anim === 'model') { zb.mixer.update(dt); return; }
    if (zb.anim === 'crow') {
      const diving = zb.crowState === 'dive';
      const f = diving ? -0.25 + Math.sin(zb.t * 30) * 0.08 : Math.sin(zb.t * 15 + zb.phase) * 0.75;
      zb.wings[0].rotation.z = f; zb.wings[1].rotation.z = -f;
      return;
    }
    const b = zb.bones;
    if (zb.anim === 'dog') {
      const s = Math.sin(zb.phase), c = Math.cos(zb.phase), m = Math.min(1, speed / 1.5);
      b.legFL.rotation.x = s * 0.85 * m; b.legBR.rotation.x = s * 0.85 * m;
      b.legFR.rotation.x = -s * 0.85 * m; b.legBL.rotation.x = -s * 0.85 * m;
      b.body.position.y = 0.55 + Math.abs(c) * 0.05 * m;
      b.body.rotation.x = c * 0.06 * m;
      b.tail.rotation.y = Math.sin(zb.t * 9) * 0.4;
      b.head.rotation.x = zb.state === 'attack' ? -0.5 * Math.sin(Math.min(1, zb.attackT / 0.35) * Math.PI) : 0.15 + Math.sin(zb.t * 3) * 0.08;
      if (zb.hitT > 0) b.body.rotation.z = Math.sin(zb.t * 40) * 0.15;
      else b.body.rotation.z = 0;
      return;
    }
    const runner = zb.def.move === 'run', amp = runner ? 0.85 : 0.5, s = Math.sin(zb.phase), c = Math.cos(zb.phase), moving = Math.min(1, speed / 0.6);
    b.thighL.rotation.x = s * amp * moving; b.thighR.rotation.x = -s * amp * moving;
    b.shinL.rotation.x = Math.max(0, -c) * amp * 1.3 * moving; b.shinR.rotation.x = Math.max(0, c) * amp * 1.3 * moving;
    b.hips.position.y = 0.95 - Math.abs(s) * 0.035 * moving;
    b.spine.rotation.x = zb.lean + (runner ? 0.25 : 0);
    b.head.rotation.z = zb.tilt + Math.sin(zb.t * 1.7) * 0.06;
    if (zb.state === 'attack') {
      const k = Math.min(1, zb.attackT / 0.45);
      b.armL.rotation.x = b.armR.rotation.x = -2.2 + k;
    } else if (zb.state === 'scream') {
      b.armL.rotation.x = b.armR.rotation.x = -0.4;
      b.armL.rotation.z = 0.5; b.armR.rotation.z = -0.5;
      b.head.rotation.x = -0.5;
    } else {
      b.armL.rotation.x = -1.35 + zb.armAsym + s * 0.12; b.armR.rotation.x = -1.3 - zb.armAsym - s * 0.12;
      b.armL.rotation.z = 0.08; b.armR.rotation.z = -0.08; b.head.rotation.x = 0.15;
    }
    if (zb.hitT > 0) b.spine.rotation.x -= zb.hitT * 1.6;
  }

  animateDeath(zb, dt) {
    if (zb.species === 'crow') {
      zb.fallV -= 14 * dt;
      zb.pos.y += zb.fallV * dt;
      const floor = Math.max(this.hm.atWorld(zb.pos.x, zb.pos.z), this.player.roofAt ? this.player.roofAt(zb.pos.x, zb.pos.z) : -Infinity) + 0.08;
      const falling = zb.pos.y > floor;
      if (!falling) { zb.pos.y = floor; zb.fallV = 0; }
      zb.root.position.copy(zb.pos);
      if (falling) zb.root.rotation.z += dt * 7;
      if (zb.anim === 'crow') { zb.wings[0].rotation.z = 0.9; zb.wings[1].rotation.z = -0.9; }
      else zb.mixer.update(0);
      if (zb.deadT > 6) zb.root.visible = false;
      return;
    }
    // thrown by a car: in the air (or rolling to a stop) the pose is worked out as usual, then
    // turned over about the hips
    if (zb.fling) { this.flight(zb, dt); zb.root.rotation.set(0, zb.heading, 0, 'YXZ'); }
    const g = zb.fling ? zb.pos.y : this.groundOf(zb);
    if (zb.anim === 'model') {
      zb.mixer.update(dt);
      if (!zb.actions.death && !zb.def.crawl) zb.root.rotation.x = -Math.min(1, zb.deadT * 2.5) * (Math.PI / 2) * zb.fallDir;
      if (zb.species === 'dog' && !zb.actions.death) { zb.root.rotation.x = 0; zb.root.rotation.z = Math.min(1, zb.deadT * 3) * (Math.PI / 2); }
    } else if (zb.anim === 'dog') {
      zb.root.rotation.set(0, zb.heading, Math.min(1, zb.deadT * 3) * (Math.PI / 2), 'YXZ');
    } else {
      const e = 1 - (1 - Math.min(1, zb.deadT * 2.6)) ** 2;
      zb.root.rotation.set(-e * (Math.PI / 2) * zb.fallDir * 0.98, zb.heading, 0, 'YXZ');
      const b = zb.bones;
      b.armL.rotation.x = -2.6 * e; b.armR.rotation.x = -2.2 * e; b.spine.rotation.x = 0;
    }
    const lift = zb.anim === 'dog' || (zb.species === 'dog') ? 0.16 : zb.anim === 'model' ? 0 : 0.12;
    zb.root.position.x = zb.pos.x; zb.root.position.z = zb.pos.z;
    zb.root.position.y = zb.deadT > 6 ? g + lift - (zb.deadT - 6) * 0.25 : g + lift * Math.min(1, zb.deadT * 2.6);
    if (zb.fling && zb.fling.angle) {
      const f = zb.fling, r = zb.root, q = this.tmpQ.setFromAxisAngle(this.tmpA.set(f.ax, 0, f.az), f.angle);
      const pv = this.tmpB.set(zb.pos.x, g + (zb.species === 'dog' ? 0.35 : 0.9) * zb.scale, zb.pos.z);
      r.position.sub(pv).applyQuaternion(q).add(pv);
      r.quaternion.premultiply(q);
    }
  }

  // a thrown body's way through the air, its bounce and its slide (the host's; a co-op client's
  // comes in the snapshots), and its turning over, rolled to a stop on a whole turn
  flight(zb, dt) {
    const f = zb.fling;
    f.t += dt;
    zb.deadT = Math.min(zb.deadT, 1);   // (lying there starts once it's down)
    if (!f.client) {
      f.vy -= 14 * dt;
      const p = { x: zb.pos.x + f.vx * dt, z: zb.pos.z + f.vz * dt };
      // (into a wall or a car: it stops dead and drops)
      if (this.col.resolve(p, 0.3, zb.pos.y + 0.25, zb.pos.y + 1.5, 1, SKIP)) { f.vx *= -0.15; f.vz *= -0.15; f.spin *= 0.4; }
      zb.pos.x = p.x; zb.pos.z = p.z; zb.pos.y += f.vy * dt;
      const gy = this.floorAt(zb.pos.x, zb.pos.z, zb.pos.y);
      if (zb.pos.y <= gy) {
        zb.pos.y = gy;
        if (f.vy < -3.5 && !f.bounced) {
          f.bounced = true; f.vy *= -0.28; f.vx *= 0.55; f.vz *= 0.55; f.spin *= 0.6;
          this.audio.play('bump', { pos: zb.pos, vol: 0.7, rate: 1.2 });
          this.fx.blood.add(this.tmpC.set(zb.pos.x, gy + 0.03, zb.pos.z), UP, 1.1);
        } else { f.vy = 0; f.ground = true; }
      }
      if (f.ground) { const k = Math.exp(-5 * dt); f.vx *= k; f.vz *= k; }
    } else f.ground = f.t > 0.25 && zb.pos.y <= this.floorAt(zb.pos.x, zb.pos.z, zb.pos.y) + 0.06;
    if (!f.ground) f.angle += f.spin * dt;
    else {
      const whole = Math.round(f.angle / (Math.PI * 2)) * Math.PI * 2;
      f.angle += (whole - f.angle) * (1 - Math.exp(-7 * dt));
      if (Math.abs(whole - f.angle) < 0.03 && Math.hypot(f.vx, f.vz) < 0.4) zb.fling = null;
    }
  }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
