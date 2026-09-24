import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// The other players, as you see them: a survivor model (or a soldier built from boxes if the model
// is missing) in the player's colour, walking, running, crouching, aiming where they aim, a name tag
// with a health bar, a muzzle flash when they fire. Fed with positions every frame (already
// smoothed on clients; damped here on the host).

export const SLOT_COLORS = [0x3fa7ff, 0x5fd35f, 0xffa23a, 0xc77dff];
export const SLOT_CSS = ['#3fa7ff', '#5fd35f', '#ffa23a', '#c77dff'];

function findClip(anims, ...res) {
  for (const re of res) { const c = anims.find((a) => re.test(a.name)); if (c) return c; }
  return null;
}

// A soldier from boxes: legs and arms on pivots so they can walk and hold a rifle.
function proceduralSoldier(color) {
  const M = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const outfit = M(color, 0.75), dark = M(0x23262b), skin = M(0xc79a74, 0.6), vest = M(0x3b4031), gunM = M(0x1b1c1e, 0.45);
  const box = (w, h, d, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.castShadow = true; return o; };
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  const leg = (side) => {
    const thigh = new THREE.Group(); thigh.position.set(side * 0.11, 0, 0); hips.add(thigh);
    const t = box(0.15, 0.46, 0.17, dark); t.position.y = -0.23; thigh.add(t);
    const shin = new THREE.Group(); shin.position.y = -0.46; thigh.add(shin);
    const s = box(0.13, 0.44, 0.15, dark); s.position.y = -0.22; shin.add(s);
    const boot = box(0.14, 0.08, 0.26, M(0x151515)); boot.position.set(0, -0.45, 0.05); shin.add(boot);
    return { thigh, shin };
  };
  const L = leg(1), R = leg(-1);
  const torso = new THREE.Group(); torso.position.y = 0.02; hips.add(torso);
  const chest = box(0.44, 0.56, 0.24, outfit); chest.position.y = 0.3; torso.add(chest);
  const v = box(0.46, 0.4, 0.28, vest); v.position.y = 0.33; torso.add(v);
  const head = new THREE.Group(); head.position.y = 0.66; torso.add(head);
  const h = box(0.2, 0.24, 0.22, skin); h.position.y = 0.1; head.add(h);
  const helmet = box(0.24, 0.1, 0.26, M(0x3b4031)); helmet.position.y = 0.25; head.add(helmet);
  const arm = (side) => {
    const sh = new THREE.Group(); sh.position.set(side * 0.27, 0.52, 0); torso.add(sh);
    const up = box(0.12, 0.34, 0.13, outfit); up.position.y = -0.17; sh.add(up);
    const fore = new THREE.Group(); fore.position.y = -0.34; sh.add(fore);
    const f = box(0.1, 0.3, 0.11, outfit); f.position.y = -0.15; fore.add(f);
    const hand = box(0.09, 0.09, 0.09, skin); hand.position.y = -0.32; fore.add(hand);
    return { sh, fore };
  };
  const AL = arm(1), AR = arm(-1);
  // the rifle, held across the chest
  const gun = new THREE.Group(); gun.position.set(-0.05, 0.36, 0.3); torso.add(gun);
  const body = box(0.07, 0.11, 0.62, gunM); gun.add(body);
  const mag = box(0.05, 0.16, 0.07, gunM); mag.position.set(0, -0.11, 0.06); gun.add(mag);
  const stock = box(0.06, 0.1, 0.2, gunM); stock.position.set(0, -0.02, -0.38); gun.add(stock);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, 0.36); gun.add(muzzle);
  return { root, kind: 'boxes', parts: { hips, torso, head, L, R, AL, AR, gun, muzzle }, outfit };
}

// A rifle for the others to carry: grip at the origin, barrel down +Z, ~85 cm (one merged mesh).
let rifleGeo = null;
function rifle() {
  if (!rifleGeo) {
    const parts = [
      [0.055, 0.075, 0.30, 0, 0.05, 0.10],     // receiver
      [0.045, 0.055, 0.22, 0, 0.055, 0.36],    // handguard
      [0.022, 0.022, 0.20, 0, 0.065, 0.57],    // barrel
      [0.04, 0.10, 0.045, 0, -0.03, 0.0],      // pistol grip
      [0.035, 0.14, 0.06, 0, -0.035, 0.17],    // magazine
      [0.05, 0.085, 0.24, 0, 0.035, -0.17],    // stock
      [0.025, 0.035, 0.06, 0, 0.11, 0.12],     // sight
    ].map(([w, h, d, x, y, z]) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed());
    const pos = [], nor = [];
    for (const g of parts) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); }
    rifleGeo = new THREE.BufferGeometry();
    rifleGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rifleGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  }
  const m = new THREE.Mesh(rifleGeo, new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.5, metalness: 0.3 }));
  m.castShadow = true;
  return m;
}

// A downloaded survivor: tinted outfit, a rifle in the right hand, its clips by name.
function fromModel(model, color, rifleScene) {
  const root = new THREE.Group();
  const inst = SkeletonUtils.clone(model.scene);
  inst.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.frustumCulled = false;
    const mats = [].concat(o.material).map((m) => {
      if (!/outfit/i.test(m.name || '')) return m;
      // the team colour, worked into the outfit's own (muted, so it still reads as clothing)
      const c = m.clone(); c.color = m.color.clone().lerp(new THREE.Color(color), 0.55).multiplyScalar(0.9); return c;
    });
    o.material = mats.length === 1 ? mats[0] : mats;
  });
  root.add(inst);
  const mixer = new THREE.AnimationMixer(inst);
  const A = model.animations || [];
  const clips = {
    idle: findClip(A, /(^|\|)rifle_idle$/i, /(^|\|)idle_?(gun|rifle)$/i, /idle.*(gun|rifle)(?!.*(point|shoot))/i, /(^|\|)idle$/i, /idle/i),
    walk: findClip(A, /(^|\|)rifle_walk$/i, /(^|\|)walk_?(gun|rifle)$/i, /walk.*(gun|rifle)(?!.*shoot)/i, /(^|\|)walk$/i, /walk/i),
    run: findClip(A, /(^|\|)rifle_run$/i, /(^|\|)run_?(gun|rifle)$/i, /run.*(gun|rifle)(?!.*shoot)/i, /(^|\|)run$/i, /run/i),
    back: findClip(A, /(^|\|)rifle_run_back$/i, /(^|\|)run_back$/i),
    left: findClip(A, /(^|\|)rifle_run_left$/i, /(^|\|)run_left$/i),
    right: findClip(A, /(^|\|)rifle_run_right$/i, /(^|\|)run_right$/i),
    sprint: findClip(A, /(^|\|)rifle_sprint$/i, /(^|\|)sprint$/i),
    crouch: findClip(A, /(^|\|)rifle_crouch_walk$/i, /crouch.*walk/i, /crouch/i),
    crouchIdle: findClip(A, /(^|\|)rifle_crouch_idle$/i, /crouch_idle/i),
    death: findClip(A, /(^|\|)death$/i, /death|die|dying/i),
    shoot: findClip(A, /(^|\|)rifle_shoot$/i, /idle.*shoot/i, /shoot|fire/i),
  };
  const actions = {};
  for (const [k, c] of Object.entries(clips)) if (c) actions[k] = mixer.clipAction(c);
  if (actions.death) { actions.death.setLoop(THREE.LoopOnce, 1); actions.death.clampWhenFinished = true; }
  let hand = null, ownGun = null, ownMuzzle = null, socket = null;
  inst.traverse((o) => {
    if (!socket && /^weapon_?r$/i.test(o.name)) socket = o;
    if (!hand && o.isBone && /hand.?r|right.?hand|r.?hand|hand_r/i.test(o.name)) hand = o;
    if (!ownMuzzle && /muzzle/i.test(o.name)) ownMuzzle = o;
    if (!ownGun && o.isMesh && /rifle|gun|weapon|ak|m4/i.test(`${o.name} ${[].concat(o.material)[0]?.name || ''}`)) ownGun = o;
  });
  const muzzle = new THREE.Object3D();
  if (ownMuzzle) ownMuzzle.add(muzzle);
  else if (ownGun) {
    // the model holds its own rifle: the flash goes at the far end of it
    ownGun.geometry.computeBoundingBox();
    const b = ownGun.geometry.boundingBox, sz = b.getSize(new THREE.Vector3());
    const ax = sz.x >= sz.y && sz.x >= sz.z ? 'x' : sz.y >= sz.z ? 'y' : 'z';
    muzzle.position.copy(b.getCenter(new THREE.Vector3()));
    muzzle.position[ax] = b.max[ax];
    ownGun.add(muzzle);
  } else if (socket) {
    // the model's weapon socket in the right hand (origin at the grip, +X to the muzzle, like our
    // gun files): the M4 goes in as it is, at its own scale
    inst.updateMatrixWorld(true);
    const s = new THREE.Vector3(); socket.getWorldScale(s);
    const holder = new THREE.Group();
    holder.scale.setScalar(1 / (s.x || 1));
    let gun;
    if (rifleScene) {
      gun = rifleScene.clone(true);
      gun.scale.setScalar(0.162);
      gun.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    } else { gun = rifle(); gun.rotation.y = Math.PI / 2; }
    holder.add(gun);
    holder.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(gun), inv = holder.matrixWorld.clone().invert();
    b.applyMatrix4(inv);
    muzzle.position.set(b.max.x, (b.min.y + b.max.y) / 2 + 0.02, (b.min.z + b.max.z) / 2);
    holder.add(muzzle);
    socket.add(holder);
  } else if (hand) {
    const gunM = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.45 });
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.6), gunM);
    gun.castShadow = true;
    // bones are scaled with the model: undo that so the rifle is ~60 cm
    const s = new THREE.Vector3(); hand.getWorldScale(s);
    const holder = new THREE.Group(); holder.scale.setScalar(1 / (s.x || 1)); holder.position.set(0, 0.05 / (s.x || 1), 0.1 / (s.x || 1));
    holder.add(gun); gun.position.z = 0.2;
    muzzle.position.set(0, 0.02, 0.52); holder.add(muzzle);
    hand.add(holder);
  } else root.add(muzzle);
  let chest = null, torso = null;
  inst.traverse((o) => { if (o.isBone && /^chest$/i.test(o.name)) chest = o; if (o.isBone && /^torso$/i.test(o.name)) torso = o; });
  return { root, kind: 'model', mixer, actions, parts: { muzzle, chest, torso } };
}

const TAG_W = 384, TAG_H = 80;
function nameTag() {
  const c = document.createElement('canvas'); c.width = TAG_W; c.height = TAG_H;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true }));
  sp.center.set(0.5, 0);   // (it grows upwards from over the head, never down into the body)
  sp.renderOrder = 10;
  return { sp, c, tex, key: '' };
}

let flashTex = null;
function muzzleFlash() {
  if (!flashTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.3, 'rgba(255,190,80,0.9)'); g.addColorStop(1, 'rgba(255,120,20,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    flashTex = new THREE.CanvasTexture(c); flashTex.colorSpace = THREE.SRGBColorSpace;
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(0.45);
  s.visible = false;
  return s;
}

export class Avatars {
  constructor(game) {
    this.g = game;
    this.list = new Map();   // slot -> avatar
  }

  make(slot) {
    const model = this.g.models && this.g.models.players && this.g.models.players.survivor;
    const color = SLOT_COLORS[slot % 4];
    const av = model ? fromModel(model, color, this.g.models.players.rifle) : proceduralSoldier(color);
    av.slot = slot;
    av.pos = new THREE.Vector3(); av.yaw = 0; av.pitch = 0; av.crouch = 0; av.speed = 0; av.phase = 0; av.dead = false; av.deadT = 0;
    av.placed = false; av.current = null; av.flashT = 0; av.name = `P${slot + 1}`;
    // (the tag hangs in the scene, not on the body: it stays up over a car they're driving)
    av.tag = nameTag();
    this.g.scene.add(av.tag.sp);
    av.flash = muzzleFlash();
    this.g.scene.add(av.flash);
    this.g.scene.add(av.root);
    this.list.set(slot, av);
    return av;
  }

  remove(slot) {
    const av = this.list.get(slot);
    if (!av) return;
    this.g.scene.remove(av.root);
    this.g.scene.remove(av.flash);
    this.g.scene.remove(av.tag.sp);
    this.list.delete(slot);
  }

  clear() { for (const s of [...this.list.keys()]) this.remove(s); }

  play(av, name, fade = 0.2) {
    if (av.kind !== 'model') return;
    const a = av.actions[name] || av.actions.idle;
    if (!a || av.current === a) return;
    a.reset().fadeIn(fade).play();
    if (av.current) av.current.fadeOut(fade);
    av.current = a;
  }

  // st: {slot, x, y, z, yaw, pitch, crouch, dead, health, maxHealth, name}; smooth: damp towards it
  set(st, dt, smooth) {
    let av = this.list.get(st.slot);
    if (!av) av = this.make(st.slot);
    const k = smooth && av.placed ? 1 - Math.exp(-14 * dt) : 1;
    const ox = av.pos.x, oz = av.pos.z;
    av.pos.x += (st.x - av.pos.x) * k; av.pos.y += (st.y - av.pos.y) * k; av.pos.z += (st.z - av.pos.z) * k;
    let dy = st.yaw - av.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    av.yaw += dy * k;
    av.pitch += (st.pitch - av.pitch) * k;
    av.crouch += (st.crouch - av.crouch) * Math.min(1, k * 1.5);
    const moved = av.placed ? Math.hypot(av.pos.x - ox, av.pos.z - oz) : 0;
    if (moved > 1e-4) {
      // the way they move, relative to the way they face (for the strafing clips)
      const mx = (av.pos.x - ox) / moved, mz = (av.pos.z - oz) / moved;
      const fwd = mx * -Math.sin(av.yaw) + mz * -Math.cos(av.yaw), right = mx * Math.cos(av.yaw) + mz * -Math.sin(av.yaw);
      const dir = Math.abs(fwd) >= Math.abs(right) * 0.8 ? (fwd >= 0 ? 'fwd' : 'back') : right > 0 ? 'right' : 'left';
      av.dirT = av.moveDir === dir ? 0 : (av.dirT || 0) + dt;
      if (!av.moveDir || av.dirT > 0.12) { av.moveDir = dir; av.dirT = 0; }
    }
    av.placed = true;
    av.speed = dt > 0 ? THREE.MathUtils.damp(av.speed, moved / dt, 10, dt) : av.speed;
    av.phase += moved * 2.2;
    if (st.dead && !av.dead) { av.deadT = 0; this.play(av, 'death', 0.15); }
    if (!st.dead && av.dead) { av.deadT = 0; av.root.rotation.set(0, 0, 0); }
    av.dead = !!st.dead;
    // (in a car or on a drone they're inside it: the bike shows its own rider)
    av.hidden = !!st.hidden;
    av.root.visible = !av.hidden;
    if (st.name) av.name = st.name;
    this.tag(av, st);
  }

  // the name tag: name and a health bar (redrawn only when they change)
  tag(av, st) {
    const hp = Math.max(0, Math.round((st.health / (st.maxHealth || 100)) * 20));
    const key = `${av.name}|${hp}|${st.dead ? 1 : 0}`;
    if (key === av.tag.key) return;
    av.tag.key = key;
    const x = av.tag.c.getContext('2d');
    x.clearRect(0, 0, TAG_W, TAG_H);
    x.font = 'bold 36px -apple-system, Segoe UI, Roboto, sans-serif';
    x.textAlign = 'center';
    x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,0.75)';
    const label = st.dead ? `${av.name} ✝` : av.name;
    x.strokeText(label, TAG_W / 2, 40);
    x.fillStyle = SLOT_CSS[av.slot % 4];
    x.fillText(label, TAG_W / 2, 40);
    if (!st.dead) {
      x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(TAG_W / 2 - 82, 54, 164, 16);
      x.fillStyle = hp > 7 ? '#5fd35f' : hp > 3 ? '#ffc23a' : '#ff4a3a';
      x.fillRect(TAG_W / 2 - 80, 56, (160 * hp) / 20, 12);
    }
    av.tag.tex.needsUpdate = true;
  }

  flash(slot) {
    const av = this.list.get(slot);
    if (av) av.flashT = 0.06;
  }

  update(dt) {
    for (const av of this.list.values()) {
      av.root.position.copy(av.pos);
      av.tag.sp.position.set(av.pos.x, av.pos.y + (av.hidden ? 2.2 : 1.95), av.pos.z);
      // 30 cm tall up close; further off it stops shrinking, so you can still read who's in that car
      const h = Math.max(0.3, this.g.camera.position.distanceTo(av.tag.sp.position) * 0.075);
      av.tag.sp.scale.set(h * TAG_W / TAG_H, h, 1);
      av.root.rotation.y = av.yaw + Math.PI;   // players look down -Z, models face +Z
      if (av.dead) {
        av.deadT += dt;
        if (av.kind === 'model') { av.mixer.update(dt); if (!av.actions.death) av.root.rotation.x = -Math.min(1, av.deadT * 3) * Math.PI / 2; }
        else {
          const e = Math.min(1, av.deadT * 2.5);
          av.root.rotation.set(-e * Math.PI / 2, av.yaw + Math.PI, 0, 'YXZ');
          av.root.position.y = av.pos.y + 0.12 * e;
        }
        av.tag.sp.visible = av.deadT < 3;
        av.flash.visible = false;
        continue;
      }
      av.tag.sp.visible = true;
      const sp = av.speed;
      if (av.kind === 'model') {
        // which way they're going, against where they face: forward, back or sideways
        const side = av.moveDir;
        let clip;
        if (av.crouch > 0.5 && av.actions.crouch) clip = sp > 0.4 ? 'crouch' : av.actions.crouchIdle ? 'crouchIdle' : 'crouch';
        else if (sp < 0.5) clip = 'idle';
        else if (side === 'back' && av.actions.back) clip = 'back';
        else if ((side === 'left' || side === 'right') && av.actions[side]) clip = side;
        else clip = sp > 6 && av.actions.sprint ? 'sprint' : sp > 3.2 ? 'run' : 'walk';
        this.play(av, clip);
        const ref = { walk: 1.7, run: 4.3, sprint: 6.9, back: 4.3, left: 4.3, right: 4.3, crouch: 2.2 }[clip];
        if (av.current && ref) av.current.timeScale = THREE.MathUtils.clamp(sp / ref, 0.45, 1.6);
        else if (av.current) av.current.timeScale = 1;
        av.mixer.update(dt);
        // aiming up or down: the chest (and a little of the torso) turns about the body's side axis
        this.bend(av, av.parts.chest, -av.pitch * 0.7);
        this.bend(av, av.parts.torso, -av.pitch * 0.3);
      } else this.animateBoxes(av, dt, sp);
      // muzzle flash
      if (av.flashT > 0) {
        av.flashT -= dt;
        av.parts.muzzle.getWorldPosition(av.flash.position);
        av.flash.material.rotation = Math.random() * Math.PI;
        av.flash.visible = true;
      } else av.flash.visible = false;
    }
  }

  bend(av, bone, angle) {
    if (!bone || Math.abs(angle) < 1e-3) return;
    av.root.updateMatrixWorld(true);
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(av.root.quaternion);
    const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const r = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    bone.quaternion.premultiply(pq.clone().invert().multiply(r).multiply(pq));
  }

  animateBoxes(av, dt, sp) {
    const P = av.parts, m = Math.min(1, sp / 1.2), run = sp > 5;
    const s = Math.sin(av.phase), c = Math.cos(av.phase), amp = run ? 0.8 : 0.5;
    const cr = av.crouch;
    P.hips.position.y = 0.95 - cr * 0.38 - Math.abs(s) * 0.03 * m;
    P.L.thigh.rotation.x = s * amp * m - cr * 1.2; P.R.thigh.rotation.x = -s * amp * m - cr * 1.2;
    P.L.shin.rotation.x = Math.max(0, -c) * amp * 1.2 * m + cr * 1.9; P.R.shin.rotation.x = Math.max(0, c) * amp * 1.2 * m + cr * 1.9;
    // torso leans into a run; the arms hold the rifle and follow the aim
    P.torso.rotation.x = (run ? 0.18 : 0.04) + cr * 0.25 - av.pitch * 0.35;
    P.head.rotation.x = -av.pitch * 0.5;
    P.AL.sh.rotation.set(-1.25 - av.pitch * 0.6, 0, -0.35); P.AL.fore.rotation.x = -0.7;
    P.AR.sh.rotation.set(-1.05 - av.pitch * 0.6, 0, 0.25); P.AR.fore.rotation.x = -0.35;
    P.gun.rotation.x = -av.pitch * 0.6;
  }
}
