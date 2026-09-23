import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// The horde. Each zombie is one skinned mesh: either a downloaded animated GLB (if present in
// assets/models/zombies) or a procedural 15-bone body animated in code. Movement follows the
// flow field, with direct chase on line of sight, separation, and static collision.

const SKIP = { playerOnly: true, barrier: true };
const UP = new THREE.Vector3(0, 1, 0);

const SKINS = [0x8f9b82, 0x9aa48c, 0x7e8a73, 0xa29d86, 0x8b8f80];
const SHIRTS = [0x5a6b7a, 0x7a5a4a, 0x4d5c3c, 0x8a8a7a, 0xb0aa9a, 0x6a3b3b, 0x33455a, 0x7d6e52];
const PANTS = [0x2a2f3a, 0x3a3226, 0x4a4a4a, 0x2e3b2e, 0x514536];
const HAIR = [0x2a2018, 0x4a3a2a, 0x6d6d6d, 0x1a1a1a, 0x8a6a3a];

// ------------------------------------------------------------------------------------------
// Procedural zombie body
// ------------------------------------------------------------------------------------------
const BONES = {
  hips: [null, 0, 0.95, 0], spine: ['hips', 0, 1.15, 0], chest: ['spine', 0, 1.38, 0], neck: ['chest', 0, 1.55, 0], head: ['neck', 0, 1.62, 0],
  armL: ['chest', 0.21, 1.48, 0], foreL: ['armL', 0.23, 1.2, 0], armR: ['chest', -0.21, 1.48, 0], foreR: ['armR', -0.23, 1.2, 0],
  thighL: ['hips', 0.1, 0.92, 0], shinL: ['thighL', 0.1, 0.5, 0], thighR: ['hips', -0.1, 0.92, 0], shinR: ['thighR', -0.1, 0.5, 0],
};
const BONE_NAMES = Object.keys(BONES);

function proceduralGeometry(seed) {
  const r = (() => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const skin = new THREE.Color(SKINS[Math.floor(r() * SKINS.length)]);
  const shirt = new THREE.Color(SHIRTS[Math.floor(r() * SHIRTS.length)]);
  const pants = new THREE.Color(PANTS[Math.floor(r() * PANTS.length)]);
  const hair = new THREE.Color(HAIR[Math.floor(r() * HAIR.length)]);
  const shoe = new THREE.Color(0x1d1b19), blood = new THREE.Color(0x4a0606);
  const P = (cx, cy, cz, sx, sy, sz, bone, col, bloody = 0) => ({ c: [cx, cy, cz], s: [sx, sy, sz], bone, col, bloody });
  const parts = [
    P(0, 0.95, 0, 0.34, 0.2, 0.2, 'hips', pants),
    P(0, 1.14, 0, 0.32, 0.24, 0.19, 'spine', shirt, 0.35),
    P(0, 1.38, 0, 0.41, 0.3, 0.22, 'chest', shirt, 0.5),
    P(0, 1.55, 0, 0.1, 0.1, 0.1, 'neck', skin, 0.4),
    P(0, 1.72, 0.02, 0.2, 0.25, 0.23, 'head', skin, 0.25),
    P(0, 1.85, -0.01, 0.21, 0.05, 0.23, 'head', hair),
    P(0, 1.66, 0.125, 0.12, 0.03, 0.02, 'head', new THREE.Color(0x1a0a0a)),     // mouth
    P(0.05, 1.76, 0.12, 0.04, 0.03, 0.01, 'head', new THREE.Color(0xe8e0a0)),  // eyes
    P(-0.05, 1.76, 0.12, 0.04, 0.03, 0.01, 'head', new THREE.Color(0xe8e0a0)),
    P(0.24, 1.34, 0, 0.1, 0.3, 0.11, 'armL', shirt), P(0.24, 1.07, 0, 0.085, 0.28, 0.09, 'foreL', skin, 0.3), P(0.24, 0.9, 0.01, 0.08, 0.1, 0.05, 'foreL', skin),
    P(-0.24, 1.34, 0, 0.1, 0.3, 0.11, 'armR', shirt), P(-0.24, 1.07, 0, 0.085, 0.28, 0.09, 'foreR', skin, 0.3), P(-0.24, 0.9, 0.01, 0.08, 0.1, 0.05, 'foreR', skin),
    P(0.1, 0.71, 0, 0.14, 0.42, 0.15, 'thighL', pants, 0.15), P(0.1, 0.28, 0, 0.12, 0.42, 0.13, 'shinL', pants), P(0.1, 0.05, 0.05, 0.11, 0.08, 0.25, 'shinL', shoe),
    P(-0.1, 0.71, 0, 0.14, 0.42, 0.15, 'thighR', pants, 0.15), P(-0.1, 0.28, 0, 0.12, 0.42, 0.13, 'shinR', pants), P(-0.1, 0.05, 0.05, 0.11, 0.08, 0.25, 'shinR', shoe),
  ];
  const pos = [], nor = [], col = [], si = [], sw = [];
  const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const bp = box.attributes.position, bn = box.attributes.normal;
  for (const part of parts) {
    const bi = BONE_NAMES.indexOf(part.bone);
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i) * part.s[0] + part.c[0], y = bp.getY(i) * part.s[1] + part.c[1], z = bp.getZ(i) * part.s[2] + part.c[2];
      pos.push(x, y, z);
      nor.push(bn.getX(i), bn.getY(i), bn.getZ(i));
      const c = part.col.clone();
      if (part.bloody && r() < part.bloody) c.lerp(blood, 0.5 + r() * 0.4);
      c.multiplyScalar(0.85 + r() * 0.3);
      col.push(c.r, c.g, c.b);
      si.push(bi, 0, 0, 0);
      sw.push(1, 0, 0, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

function makeProcedural(seed, material) {
  const bones = {};
  for (const name of BONE_NAMES) {
    const [parent, x, y, z] = BONES[name];
    const b = new THREE.Bone();
    b.name = name;
    if (parent) {
      const pp = BONES[parent];
      b.position.set(x - pp[1], y - pp[2], z - pp[3]);
      bones[parent].add(b);
    } else {
      b.position.set(x, y, z);
    }
    bones[name] = b;
  }
  const mesh = new THREE.SkinnedMesh(proceduralGeometry(seed), material);
  mesh.add(bones.hips);
  mesh.bind(new THREE.Skeleton(BONE_NAMES.map((n) => bones[n])));
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const root = new THREE.Group();
  root.add(mesh);
  return { root, bones, mesh, hb: { head: bones.head, chest: bones.chest, hips: bones.hips } };
}

// ------------------------------------------------------------------------------------------
// GLB zombies (optional)
// ------------------------------------------------------------------------------------------
function findClip(anims, re) { return anims.find((a) => re.test(a.name)); }

function makeFromModel(model) {
  const root = new THREE.Group();
  const inst = SkeletonUtils.clone(model.scene);
  inst.scale.setScalar(model.scale || 1);
  inst.rotation.y = model.yaw || 0;
  inst.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  root.add(inst);
  const mixer = new THREE.AnimationMixer(inst);
  // bones that carry the hit spheres
  const bones = [];
  inst.traverse((o) => { if (o.isBone) bones.push(o); });
  const pick = (res) => { for (const re of res) { const b = bones.find((x) => re.test(x.name)); if (b) return b; } return null; };
  const hb = {
    head: pick([/(^|[:_\s])head$/i, /head(?!.*(end|top))/i]),
    chest: pick([/spine2$/i, /chest/i, /spine\.00[34]/i, /spine1$/i, /spine/i]),
    hips: pick([/hips/i, /pelvis/i, /^spine$/i]),
  };
  const A = model.animations;
  const clips = {
    walk: findClip(A, /walk$|walk\b|^walk|forward|waddle|shamble/i) || findClip(A, /walk/i),
    run: findClip(A, /(^|\|)run$|run$|sprint/i) || findClip(A, /walk2|fast/i),
    attack: findClip(A, /attack|fight|punch|headbutt/i),
    death: findClip(A, /death|die|dying|dead/i),
    hit: findClip(A, /react|hurt|pain|flinch/i),
    idle: findClip(A, /idle/i),
  };
  clips.run = clips.run || clips.walk;
  const actions = {};
  for (const [k, clip] of Object.entries(clips)) if (clip) actions[k] = mixer.clipAction(clip);
  if (actions.death) { actions.death.setLoop(THREE.LoopOnce, 1); actions.death.clampWhenFinished = true; }
  if (actions.attack) actions.attack.setLoop(THREE.LoopRepeat, Infinity);
  return { root, mixer, actions, hb: hb.head && hb.chest && hb.hips ? hb : null };
}

// ------------------------------------------------------------------------------------------
export class Zombies {
  constructor(scene, { colliders, hm, nav, effects, audio, player, models }) {
    this.scene = scene;
    this.col = colliders; this.hm = hm; this.nav = nav; this.fx = effects; this.audio = audio; this.player = player;
    this.models = (models && models.zombies) || [];
    this.list = [];
    this.pool = [];
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.onKill = null;
    this.onPlayerHit = null;
    this.frozen = false;
    this.tmp = new THREE.Vector3();
    this.tmpA = new THREE.Vector3(); this.tmpB = new THREE.Vector3(); this.tmpC = new THREE.Vector3();
    this.dir = { x: 0, z: 0 };
    this.seed = 1;
  }

  get alive() { let n = 0; for (const z of this.list) if (z.state !== 'dead') n++; return n; }

  spawn(x, z, { type = 'walker', hp = 100, speed = 1.2, damage = 40 } = {}) {
    let zb = this.pool.pop();
    if (!zb) {
      zb = {};
      if (this.models.length) {
        const m = this.models[this.seed % this.models.length];
        Object.assign(zb, makeFromModel(m), { kind: 'model' });
      } else {
        Object.assign(zb, makeProcedural(this.seed * 7919, this.material), { kind: 'proc' });
      }
      this.seed++;
    }
    const scale = type === 'brute' ? 1.18 : 0.94 + Math.random() * 0.12;
    zb.root.scale.setScalar(scale);
    zb.root.rotation.set(0, Math.random() * Math.PI * 2, 0);
    Object.assign(zb, {
      type, hp, maxHp: hp, speed: speed * (0.9 + Math.random() * 0.2), damage, scale,
      state: 'chase', t: 0, phase: Math.random() * 10, attackT: 0, attackCd: 0, hitT: 0, deadT: 0,
      stuckT: 0, lastProgress: 0, forceField: 0, lastPath: Infinity, progT: 0, direct: false, losT: 0, groanT: 2 + Math.random() * 6, lean: 0.1 + Math.random() * 0.2,
      tilt: (Math.random() - 0.5) * 0.5, armAsym: (Math.random() - 0.5) * 0.5, limp: Math.random() < 0.3 ? 0.4 : 0,
      pos: new THREE.Vector3(x, this.hm.atWorld(x, z), z), vel: new THREE.Vector3(), heading: zb.root.rotation.y,
      dealt: false, fall: 0, fallDir: 1,
    });
    zb.root.position.copy(zb.pos);
    zb.root.visible = true;
    this.scene.add(zb.root);
    if (zb.kind === 'model') {
      zb.mixer.stopAllAction();
      this.playAction(zb, type === 'runner' ? 'run' : 'walk');
    }
    this.list.push(zb);
    return zb;
  }

  playAction(zb, name, fade = 0.2) {
    if (zb.kind !== 'model') return;
    const a = zb.actions[name] || zb.actions.walk;
    if (!a || zb.current === a) return;
    a.reset().fadeIn(fade).play();
    if (zb.current) zb.current.fadeOut(fade);
    zb.current = a;
  }

  // Ray vs zombie hit spheres. Returns {z, t, point, head} for the nearest hit.
  raycast(o, d, maxDist, exclude = null) {
    let best = null;
    for (const zb of this.list) {
      if (zb.state === 'dead' || (exclude && exclude.includes(zb))) continue;
      const s = zb.scale;
      const bx = zb.pos.x, by = zb.pos.y, bz = zb.pos.z;
      // quick reject: distance from ray to the zombie's axis
      const tx = bx - o.x, tz = bz - o.z;
      const along = tx * d.x + tz * d.z;
      if (along < -1 || along > maxDist + 1) continue;
      let spheres;
      if (zb.hb) {
        const h = zb.hb.head.getWorldPosition(this.tmpA), c = zb.hb.chest.getWorldPosition(this.tmpB), hp = zb.hb.hips.getWorldPosition(this.tmpC);
        // the head bone sits at the base of the skull: the head itself is ~11 cm above it
        spheres = [
          [h.x, h.y + 0.11 * s, h.z, 0.15 * s, true],
          [hp.x + (c.x - hp.x) * 0.85, hp.y + (c.y - hp.y) * 0.85 - 0.04 * s, hp.z + (c.z - hp.z) * 0.85, 0.21 * s, false],
          [(c.x + hp.x) / 2, (c.y + hp.y) / 2, (c.z + hp.z) / 2, 0.25 * s, false],
          [hp.x, hp.y - 0.25 * s, hp.z, 0.23 * s, false],
          [hp.x, hp.y - 0.62 * s, hp.z, 0.2 * s, false],
        ];
      } else {
        const lean = zb.lean * 0.4;
        const fx = Math.sin(zb.heading) * lean, fz = Math.cos(zb.heading) * lean;
        spheres = [
          [bx + fx * 1.4, by + 1.7 * s, bz + fz * 1.4, 0.16 * s, true],
          [bx + fx, by + 1.25 * s, bz + fz, 0.3 * s, false],
          [bx, by + 0.85 * s, bz, 0.26 * s, false],
          [bx, by + 0.45 * s, bz, 0.22 * s, false],
        ];
      }
      let mine = null, headT = Infinity;
      for (const [cx, cy, cz, r, head] of spheres) {
        const lx = o.x - cx, ly = o.y - cy, lz = o.z - cz;
        const b = lx * d.x + ly * d.y + lz * d.z;
        const c = lx * lx + ly * ly + lz * lz - r * r;
        const disc = b * b - c;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        if (t < 0 || t > maxDist) continue;
        if (head) headT = t;
        if (!mine || t < mine.t) mine = { z: zb, t, head, point: new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t) };
      }
      // head and upper chest overlap: a ray that also clips the head counts as a headshot
      if (mine && !mine.head && headT < mine.t + 0.25) mine.head = true;
      if (mine && (!best || mine.t < best.t)) best = mine;
    }
    return best;
  }

  damage(zb, amount, point, dir, head, weapon) {
    if (zb.state === 'dead') return false;
    zb.hp -= amount;
    this.fx.bloodBurst(point, dir);
    this.audio.play('flesh', { pos: point, vol: 0.7 });
    if (zb.hp <= 0) {
      this.kill(zb, dir, head, weapon);
      return true;
    }
    zb.hitT = 0.25;
    if (zb.kind === 'model' && zb.actions.hit && Math.random() < 0.3) { this.playAction(zb, 'hit', 0.05); zb.hitAnim = 0.4; }
    return false;
  }

  kill(zb, dir, head, weapon) {
    zb.state = 'dead';
    zb.deadT = 0;
    zb.fallDir = Math.random() < 0.65 ? 1 : -1;
    zb.fallYaw = Math.atan2(dir ? dir.x : 0, dir ? dir.z : 1);
    this.audio.play('zdeath', { pos: zb.pos, vol: 0.8 });
    if (zb.kind === 'model') this.playAction(zb, 'death', 0.1);
    // blood pool under the body
    const p = zb.pos.clone(); p.y = this.hm.atWorld(p.x, p.z) + 0.03;
    this.fx.blood.add(p, UP, 1.2);
    if (this.onKill) this.onKill(zb, head, weapon);
  }

  killAll() { for (const zb of this.list) if (zb.state !== 'dead') this.kill(zb, null, false, 'nuke'); }

  clear() {
    for (const zb of this.list) { this.scene.remove(zb.root); this.pool.push(zb); }
    this.list.length = 0;
  }

  update(dt, t) {
    const pl = this.player;
    const ppos = pl.pos;
    const nav = this.nav;
    // spatial hash for separation
    const cellOf = (x, z) => ((Math.floor(x / 2) + 1000) * 4096 + (Math.floor(z / 2) + 1000));
    const grid = new Map();
    for (const zb of this.list) {
      if (zb.state === 'dead') continue;
      const k = cellOf(zb.pos.x, zb.pos.z);
      let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(zb);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const zb = this.list[i];
      zb.t += dt;
      if (zb.state === 'dead') {
        zb.deadT += dt;
        this.animateDeath(zb, dt);
        if (zb.deadT > 8) { this.scene.remove(zb.root); this.list.splice(i, 1); this.pool.push(zb); }
        continue;
      }
      if (this.frozen) { this.animate(zb, dt, 0); continue; }
      const dx = ppos.x - zb.pos.x, dz = ppos.z - zb.pos.z;
      const dist = Math.hypot(dx, dz);
      const dy = Math.abs(ppos.y - zb.pos.y);

      // --- attack ---
      zb.attackCd -= dt;
      if (zb.state === 'attack') {
        zb.attackT += dt;
        const face = Math.atan2(dx, dz);
        zb.heading = lerpAngle(zb.heading, face, 1 - Math.exp(-10 * dt));
        if (!zb.dealt && zb.attackT > 0.45) {
          zb.dealt = true;
          if (dist < 1.75 && dy < 1.4 && !pl.dead) {
            pl.damage(zb.damage, zb.pos.x, zb.pos.z);
            this.audio.play('bite', { vol: 0.9 });
            if (this.onPlayerHit) this.onPlayerHit(zb);
          }
        }
        if (zb.attackT > 1.0) { zb.state = 'chase'; zb.attackCd = 0.35; this.playAction(zb, zb.type === 'runner' ? 'run' : 'walk'); }
        this.animate(zb, dt, 0);
        this.place(zb);
        continue;
      }
      if (dist < 1.3 && dy < 1.4 && zb.attackCd <= 0 && !pl.dead) {
        zb.state = 'attack'; zb.attackT = 0; zb.dealt = false;
        this.audio.play('attack', { pos: zb.pos, vol: 0.9 });
        this.playAction(zb, 'attack', 0.1);
        continue;
      }

      // --- steering ---
      let wx = 0, wz = 0;
      // charge straight only when the straight line is actually walkable (fences don't block sight)
      zb.losT = (zb.losT || 0) - dt;
      if (zb.losT <= 0) {
        zb.losT = 0.2 + Math.random() * 0.1;
        zb.direct = dist < 24 && nav.lineWalkable(zb.pos.x, zb.pos.z, ppos.x, ppos.z)
          && this.col.clear(zb.pos.x, zb.pos.y + 1.5, zb.pos.z, ppos.x, ppos.y + 1.5, ppos.z);
      }
      const seePlayer = zb.direct && zb.forceField <= 0;
      if (zb.forceField > 0) zb.forceField -= dt;
      if (seePlayer || dist < 1.8) { wx = dx / dist; wz = dz / dist; }
      else if (nav.direction(zb.pos.x, zb.pos.z, this.dir)) { wx = this.dir.x; wz = this.dir.z; }
      else { wx = dx / (dist || 1); wz = dz / (dist || 1); }
      // separation
      let sx = 0, sz = 0;
      const cx = Math.floor(zb.pos.x / 2), cz = Math.floor(zb.pos.z / 2);
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const a = grid.get((cx + ox + 1000) * 4096 + (cz + oz + 1000));
        if (!a) continue;
        for (const o of a) {
          if (o === zb) continue;
          const ex = zb.pos.x - o.pos.x, ez = zb.pos.z - o.pos.z, d2 = ex * ex + ez * ez;
          if (d2 < 0.8 && d2 > 1e-6) { const d = Math.sqrt(d2); sx += ex / d * (0.9 - d); sz += ez / d * (0.9 - d); }
        }
      }
      wx += sx * 1.6; wz += sz * 1.6;
      const wl = Math.hypot(wx, wz) || 1;
      let speed = zb.speed;
      // far away and out of sight: hurry up (so waves never stall), or get moved closer
      const pathD = nav.distanceAt(zb.pos.x, zb.pos.z);
      zb.progT = (zb.progT || 0) + dt;
      if (zb.progT > 3) {
        if (isFinite(pathD) && isFinite(zb.lastPath) && pathD > zb.lastPath - 1.0 && dist > 3) { zb.forceField = 3; zb.stuckT += 3; }
        else zb.stuckT = 0;
        zb.lastPath = pathD; zb.progT = 0;
      }
      if (!seePlayer && pathD > 40) speed *= zb.type === 'runner' ? 1.3 : 2.1;
      zb.hiddenT = seePlayer ? 0 : (zb.hiddenT || 0) + dt;
      if (this.relocate && zb.hiddenT > 9 && (pathD > 85 || zb.stuckT > 5)) { zb.hiddenT = 0; zb.stuckT = 0; this.relocate(zb); }
      if (zb.hitT > 0) { zb.hitT -= dt; speed *= 0.35; }
      if (zb.hitAnim > 0) { zb.hitAnim -= dt; if (zb.hitAnim <= 0) this.playAction(zb, zb.type === 'runner' ? 'run' : 'walk'); }
      zb.vel.x = THREE.MathUtils.damp(zb.vel.x, (wx / wl) * speed, 6, dt);
      zb.vel.z = THREE.MathUtils.damp(zb.vel.z, (wz / wl) * speed, 6, dt);
      const p = { x: zb.pos.x + zb.vel.x * dt, z: zb.pos.z + zb.vel.z * dt };
      // keep an arm's length from the player; crowds shove the player a little
      const ex = p.x - ppos.x, ez = p.z - ppos.z, ed = Math.hypot(ex, ez);
      if (ed < 0.75 && Math.abs(ppos.y - zb.pos.y) < 1.5) {
        const push = (0.75 - ed) / (ed || 1);
        p.x += ex * push * 0.8; p.z += ez * push * 0.8;
        pl.shove = (pl.shove || 0) + 1;
        pl.pos.x -= ex * push * 0.2; pl.pos.z -= ez * push * 0.2;
      }
      const gy = this.hm.atWorld(p.x, p.z);
      if (gy - zb.pos.y < 0.75) {
        this.col.resolve(p, 0.3, zb.pos.y + 0.3, zb.pos.y + 1.7, 2, SKIP);
        const moved = Math.hypot(p.x - zb.pos.x, p.z - zb.pos.z);
        zb.pos.x = p.x; zb.pos.z = p.z;
        zb.phase += moved * (zb.type === 'runner' ? 1.9 : 2.6);
      }
      zb.pos.y = THREE.MathUtils.damp(zb.pos.y, this.hm.atWorld(zb.pos.x, zb.pos.z), 12, dt);
      const sp = Math.hypot(zb.vel.x, zb.vel.z);
      if (sp > 0.05) zb.heading = lerpAngle(zb.heading, Math.atan2(zb.vel.x, zb.vel.z), 1 - Math.exp(-7 * dt));
      if (zb.kind === 'model' && zb.current) zb.current.timeScale = THREE.MathUtils.clamp(sp / (zb.type === 'runner' ? 3.5 : 1.2), 0.4, 1.6);

      // groans
      zb.groanT -= dt;
      if (zb.groanT <= 0) {
        zb.groanT = 3 + Math.random() * 7;
        if (dist < 45) this.audio.play('groan', { pos: zb.pos, vol: 0.6, rate: zb.type === 'runner' ? 1.2 : 0.9 + Math.random() * 0.2 });
      }
      this.animate(zb, dt, sp);
      this.place(zb);
    }
  }

  place(zb) {
    zb.root.position.copy(zb.pos);
    zb.root.rotation.y = zb.heading;
  }

  // Procedural animation (only for the code-built bodies; GLBs use their mixer).
  animate(zb, dt, speed) {
    if (zb.kind === 'model') { zb.mixer.update(dt); return; }
    const b = zb.bones, ph = zb.phase, runner = zb.type === 'runner';
    const amp = runner ? 0.85 : 0.5, s = Math.sin(ph), c = Math.cos(ph);
    const moving = Math.min(1, speed / 0.6);
    b.thighL.rotation.x = s * amp * moving;
    b.thighR.rotation.x = -s * amp * moving * (1 - zb.limp);
    b.shinL.rotation.x = Math.max(0, -c) * amp * 1.3 * moving;
    b.shinR.rotation.x = Math.max(0, c) * amp * 1.3 * moving;
    b.hips.position.y = 0.95 - Math.abs(s) * 0.035 * moving - (runner ? 0.04 : 0);
    b.hips.rotation.y = s * 0.12 * moving;
    b.spine.rotation.x = zb.lean + (runner ? 0.25 : 0);
    b.chest.rotation.y = -s * 0.1 * moving;
    b.head.rotation.z = zb.tilt + Math.sin(zb.t * 1.7) * 0.06;
    b.head.rotation.x = 0.15 + Math.sin(zb.t * 1.3) * 0.05;
    if (zb.state === 'attack') {
      const k = Math.min(1, zb.attackT / 0.45), swing = k < 1 ? -2.2 + k * 1.0 : -1.2 + Math.min(1, (zb.attackT - 0.45) * 3) * 0.5;
      b.armL.rotation.x = swing; b.armR.rotation.x = swing + 0.15;
      b.spine.rotation.x = zb.lean + 0.35 * Math.sin(Math.min(1, zb.attackT / 0.6) * Math.PI);
    } else if (runner) {
      b.armL.rotation.x = -0.9 + c * 0.9 * moving; b.armR.rotation.x = -0.9 - c * 0.9 * moving;
      b.foreL.rotation.x = -0.9; b.foreR.rotation.x = -0.9;
    } else {
      b.armL.rotation.x = -1.35 + zb.armAsym + s * 0.12; b.armR.rotation.x = -1.3 - zb.armAsym - s * 0.12;
      b.foreL.rotation.x = -0.25; b.foreR.rotation.x = -0.15;
      b.armL.rotation.z = 0.08; b.armR.rotation.z = -0.08;
    }
    if (zb.hitT > 0) b.spine.rotation.x -= zb.hitT * 1.6;
  }

  animateDeath(zb, dt) {
    if (zb.kind === 'model') {
      zb.mixer.update(dt);
      if (!zb.actions.death) zb.root.rotation.x = -Math.min(1, zb.deadT * 2.5) * Math.PI / 2 * zb.fallDir;
    } else {
      const k = Math.min(1, zb.deadT * 2.6);
      const e = 1 - (1 - k) * (1 - k);
      zb.root.rotation.set(-e * Math.PI / 2 * zb.fallDir * 0.98, zb.heading, 0, 'YXZ');
      const b = zb.bones;
      b.armL.rotation.x = -2.6 * e; b.armR.rotation.x = -2.2 * e;
      b.thighL.rotation.x = 0.3 * e; b.thighR.rotation.x = -0.2 * e;
      b.spine.rotation.x = 0; b.head.rotation.x = 0.4 * e;
    }
    // sink into the ground after a while
    if (zb.deadT > 6) zb.root.position.y = zb.pos.y + 0.12 - (zb.deadT - 6) * 0.25;
    else zb.root.position.y = zb.pos.y + 0.12 * Math.min(1, zb.deadT * 2.6);
  }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
