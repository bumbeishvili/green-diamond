import * as THREE from 'three';

// Weapons, first-person viewmodel, hitscan shooting, knife.
export const DEFS = {
  pistol: { name: 'Makarov PM', slot: 0, dmg: 38, head: 2.4, rpm: 400, auto: false, mag: 8, reserve: 72, reload: 1.5,
    spread: 0.014, adsSpread: 0.004, recoil: 0.035, pellets: 1, range: 70, falloff: 25, sound: 'pistol', tracer: false },
  rifle: { name: 'AK-74', slot: 1, dmg: 44, head: 2.6, rpm: 620, auto: true, mag: 30, reserve: 180, reload: 2.3,
    spread: 0.024, adsSpread: 0.006, recoil: 0.022, pellets: 1, range: 140, falloff: 45, sound: 'rifle', tracer: true, price: 1200 },
  shotgun: { name: 'TOZ-194 Shotgun', slot: 2, dmg: 30, head: 1.6, rpm: 72, auto: false, mag: 7, reserve: 42, reload: 2.8,
    spread: 0.075, adsSpread: 0.05, recoil: 0.09, pellets: 9, range: 38, falloff: 12, sound: 'shotgun', tracer: false, price: 1500 },
  // SVD Dragunov: scoped, one-shot headshots, bullets go through up to 3 zombies
  sniper: { name: 'SVD Dragunov', slot: 3, dmg: 230, head: 3.0, rpm: 75, auto: false, mag: 10, reserve: 40, reload: 2.9,
    spread: 0.05, adsSpread: 0.0006, recoil: 0.075, pellets: 1, range: 260, falloff: 220, sound: 'rifle', tracer: true, price: 2500,
    pierce: 3, zoom: 0.76, scope: true },
};

// Where each gun is sold (buy stations in director.js).
export const WHERE = { rifle: 'at Spar on the podium', shotgun: 'at Nikora on the podium', sniper: 'at the Gate 2 security booth' };

// Viewmodel placement per weapon (camera space). Tuned by rendering the viewmodel on its own.
const VIEW_YAW = { pistol: Math.PI / 2, rifle: Math.PI / 2, shotgun: Math.PI / 2 };
const VIEW = {
  pistol: { pos: [0.13, -0.135, -0.2], ads: [0.0, -0.075, -0.12], rot: [0, 0, 0] },
  rifle: { pos: [0.14, -0.155, -0.33], ads: [0.0, -0.085, -0.2], rot: [0, 0, 0] },
  shotgun: { pos: [0.16, -0.16, -0.42], ads: [0.0, -0.085, -0.3], rot: [0, 0, 0] },
  sniper: { pos: [0.15, -0.16, -0.36], ads: [0.0, -0.075, -0.18], rot: [0, 0, 0] },
};

function proceduralGun(kind) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.45, metalness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.6, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b3d1f, roughness: 0.55 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc89478, roughness: 0.7 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3b4436, roughness: 0.9 });
  const box = (w, h, d, m, x, y, z, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; g.add(b); return b; };
  if (kind === 'pistol') {
    box(0.032, 0.035, 0.17, metal, 0, 0.02, -0.06);
    box(0.03, 0.1, 0.04, dark, 0, -0.04, 0.0, 0.25);
    box(0.012, 0.012, 0.03, dark, 0, 0.042, -0.14);
  } else if (kind === 'rifle') {
    box(0.05, 0.07, 0.34, metal, 0, 0, -0.1);
    box(0.045, 0.05, 0.2, wood, 0, -0.005, -0.33);
    box(0.02, 0.02, 0.28, dark, 0, 0.02, -0.52);
    box(0.035, 0.13, 0.06, dark, 0, -0.1, -0.12, 0.35);
    box(0.04, 0.09, 0.05, wood, 0, -0.07, 0.04, -0.3);
    box(0.045, 0.06, 0.24, wood, 0, -0.02, 0.2);
  } else {
    box(0.035, 0.04, 0.72, metal, 0, 0.02, -0.33);
    box(0.03, 0.03, 0.55, dark, 0, -0.02, -0.3);
    box(0.05, 0.05, 0.18, wood, 0, -0.025, -0.4);
    box(0.05, 0.07, 0.2, metal, 0, 0, 0.02);
    box(0.045, 0.08, 0.28, wood, 0, -0.04, 0.24, -0.15);
  }
  // simple forearms
  const arm = (x, z, rot) => { const a = box(0.07, 0.07, 0.34, sleeve, x, -0.09, z + 0.14); a.rotation.y = rot; box(0.06, 0.05, 0.09, skin, x * 0.6, -0.06, z - 0.05); };
  arm(0.06, 0.05, 0.25);
  if (kind !== 'pistol') arm(-0.05, -0.25, -0.2);
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  g.userData.muzzle = new THREE.Vector3(0, 0.02, kind === 'shotgun' ? -0.7 : kind === 'rifle' ? -0.67 : -0.16);
  return g;
}

// SVD Dragunov built in code: long barrel, skeleton stock, PSO-1 scope, and the shooter's arms.
function proceduralSVD() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x25272a, roughness: 0.4, metalness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.55, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4020, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a1624, roughness: 0.05, metalness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc28f74, roughness: 0.7 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3f4a3a, roughness: 0.9 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const C = (r1, r2, len, seg = 12) => new THREE.CylinderGeometry(r1, r2, len, seg).rotateX(Math.PI / 2);
  add(B(0.045, 0.06, 0.34), metal, 0, 0, -0.02);            // receiver
  add(B(0.05, 0.05, 0.3), wood, 0, -0.005, -0.33);          // handguard
  add(C(0.011, 0.011, 0.42), dark, 0, 0.012, -0.64);        // barrel
  add(C(0.016, 0.016, 0.08), dark, 0, 0.012, -0.88);        // flash hider
  add(B(0.03, 0.13, 0.07), dark, 0, -0.1, -0.06, 0.18);     // magazine
  add(B(0.035, 0.09, 0.045), wood, 0, -0.075, 0.12, -0.35); // grip
  add(B(0.035, 0.035, 0.3), wood, 0, 0.0, 0.3, 0.05);       // stock top
  add(B(0.035, 0.03, 0.32), wood, 0, -0.085, 0.3, -0.12);   // stock bottom
  add(B(0.036, 0.13, 0.04), wood, 0, -0.045, 0.44);         // butt
  add(B(0.03, 0.035, 0.12), wood, 0, 0.035, 0.24);          // cheek rest
  // PSO-1 scope, offset slightly left like the real mount
  add(C(0.021, 0.021, 0.26), dark, -0.012, 0.075, -0.05);
  add(C(0.027, 0.021, 0.06), dark, -0.012, 0.075, -0.2);
  add(C(0.025, 0.021, 0.07), dark, -0.012, 0.075, 0.11);
  add(C(0.024, 0.024, 0.005), glass, -0.012, 0.075, -0.232);
  add(B(0.03, 0.035, 0.08), metal, -0.01, 0.04, -0.04);
  // arms: right hand on the grip, left under the handguard
  add(B(0.075, 0.085, 0.1), skin, 0.0, -0.075, 0.12);
  add(new THREE.CylinderGeometry(0.045, 0.055, 0.42, 10), sleeve, 0.06, -0.15, 0.32, 1.2, 0.3);
  add(B(0.08, 0.06, 0.12), skin, 0.0, -0.045, -0.36);
  add(new THREE.CylinderGeometry(0.045, 0.055, 0.5, 10), sleeve, -0.13, -0.17, -0.15, 1.05, -0.55);
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  g.userData.muzzle = new THREE.Vector3(0, 0.012, -0.93);
  g.userData.sight = new THREE.Vector3(-0.012, 0.075, 0);
  return g;
}

// Sleeves and hands for gun-only models (the Mossberg comes without arms).
function proceduralArms(len) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc28f74, roughness: 0.7 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3f4a3a, roughness: 0.9 });
  const add = (geo, mat, x, y, z, rx, ry) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); g.add(m); return m; };
  // right hand on the grip, forearm running back and down out of view
  add(new THREE.BoxGeometry(0.07, 0.085, 0.1), skin, 0.0, -0.045, len * 0.18, 0, 0);
  add(new THREE.CylinderGeometry(0.045, 0.055, 0.42, 10), sleeve, 0.05, -0.12, len * 0.18 + 0.2, 1.2, 0.3);
  // left hand on the pump
  add(new THREE.BoxGeometry(0.075, 0.07, 0.11), skin, -0.005, -0.04, -len * 0.2, 0, 0);
  add(new THREE.CylinderGeometry(0.045, 0.055, 0.5, 10), sleeve, -0.12, -0.15, -len * 0.2 + 0.2, 1.05, -0.55);
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
    // start with the Makarov and an AK-74; the shotgun and the SVD are bought at the shops
    this.owned = { pistol: { mag: DEFS.pistol.mag, reserve: DEFS.pistol.reserve }, rifle: { mag: DEFS.rifle.mag, reserve: 90 } };
    this.order = ['pistol', 'rifle'];
    this.current = 'pistol';
    this.cool = 0;
    this.reloading = 0;
    this.switching = 0;
    this.kick = 0; this.kickRot = 0;
    this.sway = new THREE.Vector2();
    this.knifeT = 0;
    this.views = {};
    this.flash = this.makeFlash();
    this.shots = 0;
    this.instaKill = 0;
    this.stats = { shots: 0, hits: 0, heads: 0 };
    this.onHit = null;   // (zombie, killed, head) => {}
    this.onShoot = null;
  }

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

  // Build viewmodels from the downloaded first-person arms if present, else procedural guns.
  setup(models) {
    const w = models.weapons || {};
    const make = (kind, file, clips) => {
      const gltf = w[file];
      const root = new THREE.Group();
      let view;
      if (gltf) {
        const s = gltf.scene;
        root.add(s);
        const mixer = new THREE.AnimationMixer(s);
        const find = (re) => gltf.animations.find((a) => re.test(a.name));
        const acts = {};
        for (const [k, re] of Object.entries(clips)) { const c = find(re); if (c) acts[k] = mixer.clipAction(c); }
        if (acts.shoot) { acts.shoot.setLoop(THREE.LoopOnce, 1); }
        if (acts.reload) { acts.reload.setLoop(THREE.LoopOnce, 1); acts.reload.clampWhenFinished = true; }
        if (acts.idle) acts.idle.play();
        s.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
        view = { root, model: s, mixer, acts, gltf: true };
      } else {
        const p = proceduralGun(kind);
        root.add(p);
        view = { root, model: p, gltf: false };
      }
      root.visible = false;
      this.holder.add(root);
      this.views[kind] = view;
    };
    make('pistol', 'fps_arms_pistol', { idle: /idle/i, shoot: /shoot|fire/i, reload: /reload/i });
    make('rifle', 'fps_arms_akm', { idle: /idle/i, shoot: /shoot|fire/i, reload: /reload/i });
    make('shotgun', 'shotgun_mossberg', { idle: /idle/i, shoot: /shoot|fire/i, reload: /reload/i });
    {
      const root = new THREE.Group(), model = proceduralSVD();
      root.add(model); root.visible = false; this.holder.add(root);
      this.views.sniper = { root, model, gltf: false, sight: model.userData.sight, muzzle: model.userData.muzzle };
    }
    this.fitViews();
    this.holder.add(this.flash);
    this.equip('pistol', true);
  }

  // Scale/orient the GLB viewmodels: aim the longest axis (the barrel) down -Z, size to a real gun.
  fitViews() {
    const lengths = { pistol: 0.55, rifle: 1.0, shotgun: 0.98 };  // arms + gun extent in view, metres
    for (const [kind, v] of Object.entries(this.views)) {
      if (!v.gltf) { v.muzzle = v.model.userData.muzzle; v.sight = v.model.userData.sight || v.sight; continue; }
      // the J-Toastie rigs point the barrel down +X: turn them to face -Z (into the screen)
      v.model.rotation.y = (VIEW_YAW[kind] ?? Math.PI / 2);
      v.model.updateMatrixWorld(true);
      if (v.mixer) v.mixer.update(0.01);
      v.model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(v.model, true);
      const size = box.getSize(new THREE.Vector3());
      const s = lengths[kind] / Math.max(size.x, size.y, size.z);
      v.model.scale.multiplyScalar(s);
      v.model.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(v.model, true);
      const c = box2.getCenter(new THREE.Vector3());
      v.model.position.sub(c);
      v.fitCenter = c;
      // find the gun itself (the mesh reaching furthest forward) to line up the sights for ADS
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
      } else {
        v.muzzle = new THREE.Vector3(0, 0.03, -lengths[kind] * 0.5);
      }
    }
  }

  equip(kind, instant = false) {
    if (!this.owned[kind]) return;
    this.adsToggle = false;
    this.current = kind;
    for (const [k, v] of Object.entries(this.views)) v.root.visible = k === kind;
    this.reloading = 0;
    this.switching = instant ? 0 : 0.35;
    this.cool = Math.max(this.cool, instant ? 0 : 0.3);
    this.g.hud?.weapon(this.def, this.ammo);
    this.g.hud?.slots(this.owned, this.current);
  }

  give(kind) {
    const d = DEFS[kind];
    if (!this.owned[kind]) { this.owned[kind] = { mag: d.mag, reserve: d.reserve }; this.order.push(kind); this.order.sort((a, b) => DEFS[a].slot - DEFS[b].slot); }
    else { this.owned[kind].mag = d.mag; this.owned[kind].reserve = d.reserve; }
    this.equip(kind);
  }

  refillAll() { for (const k of Object.keys(this.owned)) { this.owned[k].mag = DEFS[k].mag; this.owned[k].reserve = DEFS[k].reserve; } this.g.hud?.weapon(this.def, this.ammo); }

  get def() { return DEFS[this.current]; }
  get ammo() { return this.owned[this.current]; }

  update(dt, input, canAct) {
    const p = this.g.player;
    const def = this.def, ammo = this.ammo, view = this.views[this.current];
    this.cool -= dt;
    if (this.switching > 0) this.switching -= dt;
    if (this.knifeT > 0) this.knifeT -= dt;

    if (canAct && !p.dead) {
      // switching
      const want = input.hit('Digit1') ? 'pistol' : input.hit('Digit2') ? 'rifle' : input.hit('Digit3') ? 'shotgun' : input.hit('Digit4') ? 'sniper' : null;
      if (want && !this.owned[want]) this.g.hud?.notice(`${DEFS[want].name}: buy it ${WHERE[want]} (${DEFS[want].price} points)`);
      else if (want && want !== this.current) this.equip(want);
      const step = input.hit('KeyQ') ? 1 : input.mouse.wheel ? Math.sign(input.mouse.wheel) : 0;
      if (step && this.order.length > 1) {
        const i = this.order.indexOf(this.current);
        const n = this.order[(i + step + this.order.length) % this.order.length];
        if (n !== this.current) this.equip(n);
      }
      // aim: hold right button, or toggle with E (trackpads)
      if (input.hit('KeyE')) this.adsToggle = !this.adsToggle;
      if (p.sprinting) this.adsToggle = false;
      const aiming = (input.mouse.right || this.adsToggle) && !p.sprinting && this.reloading <= 0;
      p.ads = THREE.MathUtils.damp(p.ads, aiming ? 1 : 0, this.def.scope ? 10 : 14, dt);
      // scoped: hold Shift to steady the reticle (breath), otherwise it drifts
      if (this.def.scope && p.ads > 0.9) {
        this.breath = input.down('ShiftLeft') ? Math.max(0, (this.breath ?? 4) - dt) : Math.min(4, (this.breath ?? 4) + dt * 0.8);
        const steady = input.down('ShiftLeft') && this.breath > 0 ? 0.12 : 1;
        const t = performance.now() / 1000;
        p.yaw += Math.sin(t * 0.9) * 0.00022 * steady; p.pitch += Math.sin(t * 1.3 + 1) * 0.00018 * steady;
      }
      // reload
      if ((input.hit('KeyR') || (ammo.mag === 0 && ammo.reserve > 0 && this.cool <= 0)) && this.reloading <= 0 && ammo.mag < def.mag && ammo.reserve > 0) this.startReload();
      // knife
      if (input.hit('KeyV') && this.knifeT <= 0) this.knife();
      // fire
      const trigger = def.auto ? input.mouse.left : input.mouse.leftPressed;
      if (trigger && this.cool <= 0 && this.switching <= 0 && this.reloading <= 0 && this.knifeT <= 0 && !p.sprinting) {
        if (ammo.mag > 0) this.fire();
        else if (input.mouse.leftPressed) { this.g.audio.play('empty'); this.cool = 0.25; }
      }
    } else {
      p.ads = THREE.MathUtils.damp(p.ads, 0, 10, dt);
    }

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = def.mag - ammo.mag, take = Math.min(need, ammo.reserve);
        ammo.mag += take; ammo.reserve -= take;
        this.g.hud?.weapon(def, ammo);
      }
    }
    this.animateView(dt, input, view);
  }

  startReload() {
    const view = this.views[this.current];
    this.reloading = this.def.reload;
    const a = this.g.audio;
    if (this.current === 'pistol') a.play('reloadPistol', { vol: 0.8 });
    else if (this.current === 'shotgun') { a.play('shellIn', { vol: 0.8 }); setTimeout(() => a.play('shellIn', { vol: 0.8 }), 700); setTimeout(() => a.play('pump', { vol: 0.8 }), this.def.reload * 1000 - 400); }
    else { a.play('reload', { vol: 0.8 }); setTimeout(() => a.play('rack', { vol: 0.8 }), this.def.reload * 1000 - 500); }
    if (view.acts?.reload) { const a = view.acts.reload; a.reset(); a.timeScale = a.getClip().duration / this.def.reload; a.play(); }
  }

  fire() {
    const def = this.def, ammo = this.ammo, g = this.g, p = g.player;
    ammo.mag--;
    this.cool = 60 / def.rpm;
    this.shots++;
    this.stats.shots++;
    g.audio.play(def.sound, { vol: def.scope ? 1 : 0.9, rate: def.scope ? 0.72 : 1 });
    const cam = g.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const moving = p.moving ? (def.scope ? 3 : 1.6) : 1;
    const spread = THREE.MathUtils.lerp(def.spread, def.adsSpread, p.ads) * moving * (p.onGround ? 1 : 2.2) * (1 + Math.min(this.kick * 3, 1.2));
    let anyHit = false, anyKill = false, anyHead = false;
    const muzzleWorld = origin.clone().addScaledVector(fwd, 0.6).addScaledVector(right, 0.12).addScaledVector(up, -0.1);
    for (let k = 0; k < def.pellets; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      let res = this.trace(origin, dir, def.range);
      // piercing rounds carry on through the first zombies they hit
      const exclude = [];
      let o2 = origin.clone(), range = def.range;
      for (let pass = 0; def.pierce && res.zombie && pass < def.pierce - 1; pass++) {
        const zb = res.zombie;
        let dmg = def.dmg * (res.head ? def.head : 1) * Math.pow(0.8, pass);
        if (this.instaKill > 0) dmg = 1e6;
        const killed = g.zombies.damage(zb, dmg, res.point, dir, res.head, this.current);
        anyHit = true; anyKill = anyKill || killed; anyHead = anyHead || res.head;
        this.stats.hits++; if (res.head) this.stats.heads++;
        if (this.onHit) this.onHit(zb, killed, res.head);
        exclude.push(zb);
        range -= res.t; o2 = res.point.clone().addScaledVector(dir, 0.05);
        res = this.trace(o2, dir, range, exclude);
      }
      if (res.zombie) {
        const zb = res.zombie;
        const fall = THREE.MathUtils.clamp(1 - (res.t - def.falloff) / (def.range - def.falloff), 0.35, 1);
        let dmg = def.dmg * fall * (res.head ? def.head : 1);
        if (this.instaKill > 0) dmg = 1e6;
        const killed = g.zombies.damage(zb, dmg, res.point, dir, res.head, this.current);
        anyHit = true; anyKill = anyKill || killed; anyHead = anyHead || res.head;
        this.stats.hits++;
        if (res.head) this.stats.heads++;
        if (this.onHit) this.onHit(zb, killed, res.head);
      } else if (res.point) {
        g.effects.impact(res.point, res.normal, res.surface);
        if (k === 0 || Math.random() < 0.3) g.audio.play(res.surface === 'metal' ? 'metal' : 'concrete', { pos: res.point, vol: 0.5 });
      }
      if (def.tracer && this.shots % 2 === 0 && k === 0) g.effects.tracer(muzzleWorld, res.point || origin.clone().addScaledVector(dir, def.range));
    }
    if (anyHit) { g.hud?.hitmarker(anyKill, anyHead); g.audio.play('hit', { vol: 0.45, jitter: 0 }); }
    if (this.current !== 'shotgun') setTimeout(() => g.audio.play('shell', { vol: 0.25 }), 380 + Math.random() * 200);
    else setTimeout(() => g.audio.play('pump', { vol: 0.7 }), 260);
    g.effects.muzzle(origin.clone().addScaledVector(fwd, 0.8));
    // recoil
    this.kick = Math.min(this.kick + 0.35, 1.2);
    p.kick(def.recoil * (8 + Math.random() * 3) * (1 - p.ads * 0.4), (Math.random() - 0.5) * def.recoil * 5);
    p.pitch += def.recoil * 0.35 * (1 - p.ads * 0.3);
    this.flash.visible = true;
    this.flashT = 0.045;
    this.flash.material.rotation = Math.random() * Math.PI;
    const view = this.views[this.current];
    if (view.acts?.shoot) { const s = view.acts.shoot; s.reset(); s.play(); }
    g.hud?.weapon(def, ammo);
    if (this.onShoot) this.onShoot();
  }

  // Hitscan: zombies vs static world vs ground.
  trace(o, d, range, exclude = null) {
    const g = this.g;
    const zh = g.zombies.raycast(o, d, range, exclude);
    const wh = g.colliders.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range);
    let gt = Infinity;
    if (d.y < -0.001) {
      // march to the heightmap
      let prev = 0;
      for (let t = 0.5; t < range; t += 0.5) {
        const y = o.y + d.y * t, gy = g.hm.atWorld(o.x + d.x * t, o.z + d.z * t);
        if (y <= gy) {
          let lo = prev, hi = t;
          for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (o.y + d.y * m <= g.hm.atWorld(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; }
          gt = hi; break;
        }
        prev = t;
      }
    }
    const wt = wh ? wh.t : Infinity;
    if (zh && zh.t < wt && zh.t < gt) return { zombie: zh.z, t: zh.t, point: zh.point, head: zh.head };
    if (wt < gt && wt < Infinity) {
      const pt = new THREE.Vector3(o.x + d.x * wt, o.y + d.y * wt, o.z + d.z * wt);
      const kind = wh.item.kind;
      return { point: pt, normal: new THREE.Vector3(wh.nx, 0, wh.nz), t: wt, surface: kind === 'car' || kind === 'post' ? 'metal' : 'concrete' };
    }
    if (gt < Infinity) return { point: new THREE.Vector3(o.x + d.x * gt, o.y + d.y * gt, o.z + d.z * gt), normal: new THREE.Vector3(0, 1, 0), t: gt, surface: 'ground' };
    return { t: range };
  }

  knife() {
    const g = this.g, p = g.player;
    this.knifeT = 0.55;
    g.audio.play('knife', { vol: 0.8 });
    const fwd = p.forward(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
    let best = null, bestD = 2.0;
    for (const zb of g.zombies.list) {
      if (zb.state === 'dead') continue;
      const dx = zb.pos.x - p.pos.x, dz = zb.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d < bestD && (dx * fwd.x + dz * fwd.z) / (d || 1) > 0.5) { best = zb; bestD = d; }
    }
    if (best) {
      const point = best.pos.clone(); point.y += 1.3;
      const killed = g.zombies.damage(best, this.instaKill > 0 ? 1e6 : 150, point, fwd, false, 'knife');
      g.hud?.hitmarker(killed, false);
      if (this.onHit) this.onHit(best, killed, false, 'knife');
    }
  }

  animateView(dt, input, view) {
    const p = this.g.player;
    const cfg = VIEW[this.current];
    this.kick = Math.max(0, this.kick - dt * 5);
    // sway from mouse look
    this.sway.x = THREE.MathUtils.damp(this.sway.x, -input.mouse.dx * 0.00035, 8, dt);
    this.sway.y = THREE.MathUtils.damp(this.sway.y, input.mouse.dy * 0.00035, 8, dt);
    const ads = p.ads;
    const bob = p.bob * Math.PI, ba = p.bobAmount * (1 - ads * 0.85);
    const adsPos = view.sight ? new THREE.Vector3(-view.sight.x, -view.sight.y - 0.018, cfg.ads[2]) : new THREE.Vector3(...cfg.ads);
    const base = new THREE.Vector3(...cfg.pos).lerp(adsPos, ads);
    const h = this.holder;
    h.position.copy(base);
    h.position.x += Math.cos(bob) * 0.012 * ba + this.sway.x;
    h.position.y += -Math.abs(Math.sin(bob)) * 0.014 * ba + this.sway.y - (this.switching > 0 ? this.switching * 0.8 : 0);
    h.position.z += this.kick * 0.045;
    let rx = this.kick * 0.09, ry = 0, rz = 0;
    if (p.sprinting) { rx -= 0.35; ry += 0.55; rz += 0.25; h.position.x -= 0.02; h.position.y -= 0.04; }
    if (this.reloading > 0 && !view.acts?.reload) { const k = Math.sin(Math.min(1, 1 - this.reloading / this.def.reload) * Math.PI); rx -= k * 0.6; h.position.y -= k * 0.08; }
    if (this.knifeT > 0) { const k = Math.sin((1 - this.knifeT / 0.55) * Math.PI); ry -= k * 0.9; rz += k * 0.4; h.position.x -= k * 0.12; }
    this.rot = this.rot || new THREE.Euler();
    this.rot.set(rx + cfg.rot[0], ry + cfg.rot[1], rz + cfg.rot[2]);
    h.rotation.copy(this.rot);
    if (view.mixer) view.mixer.update(dt);
    // muzzle flash
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    if (view.muzzle) this.flash.position.copy(view.muzzle);
    this.g.hud?.crosshair(ads, (THREE.MathUtils.lerp(this.def.spread, this.def.adsSpread, ads)) * (p.moving ? 1.6 : 1) * (1 + this.kick * 2));
    // the sniper scope: overlay on, viewmodel off, zoom from the weapon
    const scoped = !!this.def.scope && ads > 0.85;
    this.g.hud?.scope(scoped);
    this.holder.visible = !scoped;
    p.adsZoom = this.def.zoom ?? 0.22;
  }

  // Viewmodel pass, after the world.
  render(renderer, atmo) {
    this.vmCam.aspect = this.g.camera.aspect;
    this.vmCam.updateProjectionMatrix();
    this.vmSun.color.copy(atmo.sun.color);
    this.vmSun.intensity = Math.max(0.6, atmo.sun.intensity * 0.6);
    // light from the sun's direction relative to the camera
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
