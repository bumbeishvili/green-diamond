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
  dog: { species: 'dog', hp: 0.45, speed: [5.3, 6.3], dmg: 0.5, scale: [0.95, 1.1], tint: [0.66, 0.56, 0.52], emissive: 0x2a0000, emissiveI: 0.5 },
  wolf: { species: 'dog', model: 'wolf', hp: 1.1, speed: [5.0, 5.8], dmg: 0.8, scale: [0.95, 1.05], tint: [0.6, 0.55, 0.52], emissive: 0x2a0000, emissiveI: 0.5 },
  crow: { species: 'crow', hp: 0.2, speed: [10, 12.5], dmg: 0.3, scale: [0.9, 1.1] },
};
const MODEL_KEYS = { city: /city/i, thin: /thin/i, office: /office/i, hazmat: /hazmat/i };

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
    this.tmpA = new THREE.Vector3(); this.tmpB = new THREE.Vector3(); this.tmpC = new THREE.Vector3();
    this.dir = { x: 0, z: 0 };
  }

  get alive() { let n = 0; for (const z of this.list) if (z.state !== 'dead') n++; return n; }
  count(type) { let n = 0; for (const z of this.list) if (z.state !== 'dead' && z.type === type) n++; return n; }

  build(type) {
    const def = TYPES[type];
    if (def.species === 'dog') {
      const m = this.animals[def.model || 'dog'] || this.animals.dog;
      return m ? fromModel(m, type, def, this.matCache) : proceduralDog(this.material);
    }
    if (def.species === 'crow') return this.animals.crow ? fromModel(this.animals.crow, type, def, this.matCache) : proceduralCrow();
    const keys = def.models.filter((k) => this.models[k]);
    if (!keys.length) return proceduralHuman(this.material);
    const model = this.models[pick(keys)];
    return { ...fromModel(model, type, def, this.matCache), model: model.name };
  }

  spawn(x, z, { type = 'walker', hp = 100, speed = null, speedMul = 1, damage = 40, roof = null, stair = null, y = null } = {}) {
    const def = TYPES[type] || TYPES.walker;
    const pool = this.pools.get(type);
    const zb = (pool && pool.pop()) || Object.assign(this.build(type), { type });
    const scale = rnd(...def.scale);
    const w = def.wide || 1;
    zb.root.scale.set(scale * w, scale, scale * w);
    const ground = roof ?? this.hm.atWorld(x, z);
    Object.assign(zb, {
      species: def.species || 'human', def, hp: hp * def.hp, maxHp: hp * def.hp,
      speed: (speed ?? rnd(...def.speed)) * speedMul, damage: damage * def.dmg, scale, roof, stair,
      state: 'chase', t: 0, phase: Math.random() * 10, attackT: 0, attackCd: 0, hitT: 0, hitAnim: 0, deadT: 0, buffT: 0,
      screamed: false, exploding: false, fuse: 0, gasT: Math.random(),
      stuckT: 0, forceField: 0, lastPath: Infinity, progT: 0, direct: false, losT: 0, hiddenT: 0, climbT: 0,
      groanT: 2 + Math.random() * 6, lean: 0.1 + Math.random() * 0.2, tilt: (Math.random() - 0.5) * 0.5, armAsym: (Math.random() - 0.5) * 0.5,
      pos: new THREE.Vector3(x, y ?? ground, z), vel: new THREE.Vector3(), heading: Math.random() * Math.PI * 2,
      dealt: false, small: def.species === 'dog' || def.species === 'crow' || !!def.crawl, fallDir: 1, fallV: 0,
      orbit: Math.random() * Math.PI * 2, diveT: 2.5 + Math.random() * 3, crowState: 'circle', climbUp: 0,
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
  raycast(o, d, maxDist, exclude = null) {
    let best = null;
    for (const zb of this.list) {
      if (zb.state === 'dead' || zb.state === 'climb' || (exclude && exclude.includes(zb))) continue;
      const tx = zb.pos.x - o.x, tz = zb.pos.z - o.z;
      const along = tx * d.x + tz * d.z;
      if (along < -2 || along > maxDist + 2) continue;
      let mine = null, headT = Infinity;
      for (const [cx, cy, cz, r, head] of this.spheres(zb)) {
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

  damage(zb, amount, point, dir, head, weapon) {
    if (zb.state === 'dead') return false;
    zb.hp -= amount;
    if (zb.species === 'crow') this.fx.emit(point, 10, { color: [0.05, 0.05, 0.06], speed: 2.2, spread: 1.6, up: 1, life: 1.4, size: 0.07, gravity: 1.5 });
    else if (zb.def.explode) this.fx.emit(point, 12, { color: [0.35, 0.75, 0.15], speed: 2.5, spread: 1.2, up: 1, life: 0.8, size: 0.09, dir });
    else this.fx.bloodBurst(point, dir);
    this.audio.play('flesh', { pos: point, vol: 0.7 });
    if (zb.hp <= 0) { this.kill(zb, dir, head, weapon); return true; }
    zb.hitT = zb.def.shove ? 0.08 : 0.25;
    if (zb.species === 'dog') zb.hitT = 0.15;
    if (zb.anim === 'model' && zb.actions.hit && zb.state === 'chase' && Math.random() < 0.3 && !zb.def.shove) { this.play(zb, 'hit', 0.05); zb.hitAnim = 0.4; }
    return false;
  }

  kill(zb, dir, head, weapon) {
    if (zb.state === 'dead') return;
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
    if (this.onKill && weapon !== 'fuse') this.onKill(zb, head, weapon);
  }

  killAll() { for (const zb of this.list) if (zb.state !== 'dead') this.kill(zb, null, false, 'nuke'); }

  clear() {
    for (const zb of this.list) this.release(zb);
    this.list.length = 0;
  }

  release(zb) {
    this.scene.remove(zb.root);
    if (!this.pools.has(zb.type)) this.pools.set(zb.type, []);
    this.pools.get(zb.type).push(zb);
  }

  groundOf(zb) { return zb.roof != null ? zb.roof : this.hm.atWorld(zb.pos.x, zb.pos.z); }

  // Blast damage (grenades, bloaters): zombies and the player in range, not through walls.
  explode(x, y, z, radius, dmgZombie, dmgPlayer, source = 'explosion') {
    const pl = this.player;
    let kills = 0;
    for (const zb of this.list) {
      if (zb.state === 'dead' || zb.state === 'climb') continue;
      const cy = zb.species === 'crow' ? zb.pos.y : zb.pos.y + 0.8;
      const d = Math.hypot(zb.pos.x - x, cy - y, zb.pos.z - z);
      if (d > radius || !this.col.clear(x, y + 0.3, z, zb.pos.x, cy + 0.2, zb.pos.z)) continue;
      const dir = new THREE.Vector3(zb.pos.x - x, 0.6, zb.pos.z - z).normalize();
      const point = zb.pos.clone(); point.y = cy;
      const killed = this.damage(zb, dmgZombie * (1 - (d / radius) * 0.7), point, dir, false, source);
      if (killed) { kills++; zb.blast = dir; }
      if (this.onBlastHit) this.onBlastHit(zb, killed);
    }
    if (dmgPlayer > 0 && !pl.dead) {
      const pd = Math.hypot(pl.pos.x - x, pl.pos.y + 1 - y, pl.pos.z - z);
      if (pd < radius && this.col.clear(x, y + 0.3, z, pl.pos.x, pl.pos.y + 1.2, pl.pos.z)) {
        pl.damage(dmgPlayer * Math.pow(1 - pd / radius, 0.8), x, z);
        pl.shake = Math.min(1, pl.shake + 0.9);
        if (this.onPlayerHit) this.onPlayerHit(null);
      } else if (pd < radius * 4) pl.shake = Math.min(1, pl.shake + 0.5 * (1 - pd / (radius * 4)));
    }
    if (this.onExplode) this.onExplode(x, y, z, radius, source);
    return kills;
  }

  update(dt) {
    const pl = this.player;
    const ppos = pl.pos;
    const nav = this.nav;
    const up = this.targetStair;
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
      if (zb.species === 'crow') { this.updateCrow(zb, dt); continue; }
      if (zb.state === 'climb') { this.updateClimb(zb, dt); continue; }
      if (zb.buffT > 0) zb.buffT -= dt;
      if (zb.def.explode) this.gas(zb, dt);

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
      if (zb.def.explode && dist < 1.9 && dy < 1.6 && !pl.dead && !wrongRoof) {
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

      // --- attack ---
      const v = pl.vehicle;
      const inCar = v && v.type === 'car';
      const dog = zb.species === 'dog';
      const reach = (dog ? 1.5 : zb.def.crawl ? 1.2 : 1.3) + (inCar ? 1.0 : v && v.type === 'bike' ? 0.3 : 0) + (zb.def.shove ? 0.2 : 0);
      const windup = dog ? 0.22 : 0.45, total = dog ? 0.65 : 1.0;
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
          if (dist < reach + 0.45 && dy < 1.5 && !pl.dead && !(v && v.type === 'drone')) {
            pl.damage(zb.damage * (inCar ? 0.6 : 1), zb.pos.x, zb.pos.z);
            if (zb.def.shove && !v) { pl.vel.x += (dx / (dist || 1)) * zb.def.shove; pl.vel.z += (dz / (dist || 1)) * zb.def.shove; pl.shake = Math.min(1, pl.shake + 0.4); }
            this.audio.play('bite', { vol: 0.9, rate: dog ? 1.3 : 1 });
            if (this.onPlayerHit) this.onPlayerHit(zb);
          }
        }
        if (zb.attackT > total) {
          zb.state = 'chase';
          zb.leap = 0;
          zb.attackCd = dog ? 0.25 : 0.35;
          this.play(zb, this.moveClip(zb));
        }
        this.animate(zb, dt, 0);
        this.place(zb);
        continue;
      }
      if (!wrongRoof && dist < reach && dy < 1.5 && zb.attackCd <= 0 && !pl.dead && !(v && v.type === 'drone' && dy > 0.6)) {
        zb.state = 'attack'; zb.attackT = 0; zb.dealt = false;
        this.audio.play(dog ? 'growl' : 'attack', { pos: zb.pos, vol: 0.9, rate: zb.def.shove ? 0.7 : 1 });
        this.play(zb, 'attack', 0.1);
        continue;
      }

      // --- steering ---
      let wx, wz;
      const onRoof = zb.roof != null;
      zb.losT -= dt;
      if (zb.losT <= 0) {
        zb.losT = 0.2 + Math.random() * 0.1;
        zb.direct = !wrongRoof && dist < 24 && Math.abs(ppos.y - zb.pos.y) < 2.5 && (onRoof || nav.lineWalkable(zb.pos.x, zb.pos.z, ppos.x, ppos.z))
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
      if (wrongRoof) {
        const tx = zb.stair.roof.x - zb.pos.x, tz = zb.stair.roof.z - zb.pos.z, tl = Math.hypot(tx, tz) || 1;
        wx = tx / tl; wz = tz / tl;
      } else if (seePlayer || dist < 1.8 || onRoof) { wx = dx / (dist || 1); wz = dz / (dist || 1); }
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
          const minD = zb.small && o.small ? 0.6 : (zb.def.shove || o.def.shove) ? 1.15 : 0.9;
          if (d2 < minD * minD && d2 > 1e-6) { const d = Math.sqrt(d2); sx += (ex / d) * (minD - d); sz += (ez / d) * (minD - d); }
        }
      }
      wx += sx * 1.6; wz += sz * 1.6;
      const wl = Math.hypot(wx, wz) || 1;
      let speed = zb.speed * (zb.buffT > 0 ? 1.35 : 1);
      // far away and out of sight: hurry up (so waves never stall), or get moved closer
      if (!onRoof) {
        const pathD = nav.distanceAt(zb.pos.x, zb.pos.z);
        zb.progT += dt;
        if (zb.progT > 3) {
          if (isFinite(pathD) && isFinite(zb.lastPath) && pathD > zb.lastPath - 1.0 && dist > 3) { zb.forceField = 3; zb.stuckT += 3; }
          else zb.stuckT = 0;
          zb.lastPath = pathD; zb.progT = 0;
        }
        if (!seePlayer && pathD > 40 && !dog) speed *= zb.def.move === 'run' ? 1.3 : zb.def.crawl ? 2.6 : 2.1;
        zb.hiddenT = seePlayer ? 0 : zb.hiddenT + dt;
        if (this.relocate && zb.hiddenT > 9 && (pathD > 85 || zb.stuckT > 5)) { zb.hiddenT = 0; zb.stuckT = 0; this.relocate(zb); }
      }
      if (zb.hitT > 0) { zb.hitT -= dt; speed *= 0.35; }
      if (zb.hitAnim > 0) { zb.hitAnim -= dt; if (zb.hitAnim <= 0) this.play(zb, this.moveClip(zb)); }
      const agility = dog ? 9 : 6;
      zb.vel.x = THREE.MathUtils.damp(zb.vel.x, (wx / wl) * speed, agility, dt);
      zb.vel.z = THREE.MathUtils.damp(zb.vel.z, (wz / wl) * speed, agility, dt);
      const p = { x: zb.pos.x + zb.vel.x * dt, z: zb.pos.z + zb.vel.z * dt };
      // keep an arm's length from the player; crowds shove the player a little
      const ex = p.x - ppos.x, ez = p.z - ppos.z, ed = Math.hypot(ex, ez);
      if (!v && ed < 0.75 && Math.abs(ppos.y - zb.pos.y) < 1.5) {
        const push = (0.75 - ed) / (ed || 1);
        p.x += ex * push * 0.8; p.z += ez * push * 0.8;
        pl.pos.x -= ex * push * 0.2; pl.pos.z -= ez * push * 0.2;
      }
      const gy = onRoof ? zb.roof : this.hm.atWorld(p.x, p.z);
      if (gy - zb.pos.y < 0.75) {
        this.col.resolve(p, dog ? 0.28 : 0.3, zb.pos.y + 0.3, zb.pos.y + (zb.small ? 0.9 : 1.7), 2, SKIP);
        const moved = Math.hypot(p.x - zb.pos.x, p.z - zb.pos.z);
        zb.pos.x = p.x; zb.pos.z = p.z;
        zb.phase += moved * (dog ? 2.4 : zb.def.move === 'run' ? 1.9 : 2.6);
      }
      zb.pos.y = THREE.MathUtils.damp(zb.pos.y, this.groundOf(zb), 12, dt);
      const sp = Math.hypot(zb.vel.x, zb.vel.z);
      if (sp > 0.05) zb.heading = lerpAngle(zb.heading, Math.atan2(zb.vel.x, zb.vel.z), 1 - Math.exp(-(dog ? 10 : 7) * dt));
      if (zb.anim === 'model' && zb.current && zb.state === 'chase' && !(zb.hitAnim > 0)) {
        const ref = dog ? 5 : zb.def.move === 'run' ? 3.5 : zb.def.crawl ? 1.1 : 1.2;
        zb.current.timeScale = THREE.MathUtils.clamp(sp / ref, 0.4, 1.8);
      }
      // groans / growls
      zb.groanT -= dt;
      if (zb.groanT <= 0) {
        zb.groanT = dog ? 2 + Math.random() * 3 : 3 + Math.random() * 7;
        if (dist < 45) this.audio.play(dog ? 'growl' : 'groan', { pos: zb.pos, vol: dog ? 0.5 : 0.6, rate: zb.def.shove ? 0.72 : 0.9 + Math.random() * 0.2 });
      }
      this.animate(zb, dt, sp);
      this.place(zb);
    }
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
  updateCrow(zb, dt) {
    const pl = this.player;
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
      if (zb.diveT <= 0 && !pl.dead && tl < 14) { zb.crowState = 'dive'; this.audio.play('caw', { pos: zb.pos, vol: 0.7 }); if (zb.actions && zb.actions.attack) this.play(zb, 'attack', 0.15); }
    } else if (zb.crowState === 'dive') {
      const tx = hx - zb.pos.x, ty = hy - zb.pos.y, tz = hz - zb.pos.z, tl = Math.hypot(tx, ty, tz) || 1;
      const sp = zb.speed * 1.3;
      zb.vel.x = THREE.MathUtils.damp(zb.vel.x, (tx / tl) * sp, 6, dt);
      zb.vel.y = THREE.MathUtils.damp(zb.vel.y, (ty / tl) * sp, 6, dt);
      zb.vel.z = THREE.MathUtils.damp(zb.vel.z, (tz / tl) * sp, 6, dt);
      if (tl < 0.9) {
        const inCar = pl.vehicle && pl.vehicle.type === 'car';
        pl.damage(zb.damage * (inCar ? 0.4 : 1), zb.pos.x, zb.pos.z);
        this.audio.play('bite', { vol: 0.6, rate: 1.8 });
        if (this.onPlayerHit) this.onPlayerHit(zb);
        zb.crowState = 'away';
        zb.climbT = 1.3;
        this.play(zb, 'fly', 0.2);
      }
      if (zb.t > 60) { zb.crowState = 'away'; this.play(zb, 'fly', 0.2); }
    } else {
      zb.vel.y = THREE.MathUtils.damp(zb.vel.y, 7, 4, dt);
      zb.climbT -= dt;
      if (zb.climbT <= 0) { zb.crowState = 'circle'; zb.diveT = 2.5 + Math.random() * 4; zb.t = 0; }
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
    zb.root.rotation.y = zb.heading;
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
    const g = this.groundOf(zb);
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
  }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
