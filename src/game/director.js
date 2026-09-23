import * as THREE from 'three';
import { DEFS } from './weapons.js';
import { pointInPoly } from '../world/geom.js';

// Rules of the survival mode: waves, spawning, points, power-ups and the shops on the podium.

const POWERUPS = {
  maxammo: { label: 'MAX AMMO', color: 0x5fd35f },
  instakill: { label: 'INSTA-KILL', color: 0xff4040 },
  double: { label: 'DOUBLE POINTS', color: 0xffd23f },
  nuke: { label: 'NUKE', color: 0xff8a2a },
};

export class Director {
  constructor(game) {
    this.g = game;
    this.wave = 0;
    this.state = 'intermission';
    this.timer = 6;
    this.toSpawn = 0;
    this.spawnT = 0;
    this.points = 500;
    this.kills = 0;
    this.headshots = 0;
    this.double = 0;
    this.drops = [];
    this.dropGroup = new THREE.Group();
    game.scene.add(this.dropGroup);
    this.buildStations();
    // zombies that wander far out of sight get moved to a closer spawn
    game.zombies.relocate = (zb) => { const sp = this.pickSpawn(); if (sp) { zb.pos.set(sp[1], game.hm.atWorld(sp[1], sp[2]), sp[2]); zb.vel.set(0, 0, 0); } };
  }

  // ---- shops: real brands on the podium, as buy stations ----
  buildStations() {
    const L = this.g.level, byName = (n) => L.pois.find((p) => p.name === n);
    const S = [];
    const add = (poi, item, label, cost) => { if (poi) S.push({ x: poi.x, z: -poi.y, item, label, cost }); };
    add(byName('Spar'), 'rifle', `AK-74 at Spar`, DEFS.rifle.price);
    add(byName('Nikora'), 'shotgun', `TOZ-194 shotgun at Nikora`, DEFS.shotgun.price);
    add(byName('Ori Nabiji'), 'ammo', 'Ammo at 2 Nabiji', 600);
    add(byName('36.6'), 'health', 'Pharmacy 36.6: more health', 2500);
    add(byName('Format Fit'), 'stamina', 'Format Fit: faster legs', 2000);
    add(byName('TBC Bank'), 'double', 'TBC terminal: double points (30 s)', 1200);
    // the security booth by Gate 2 sells the Dragunov (buy on its courtyard side)
    const booth = L.buildings.find((b) => b.group === 'guard' && b.poly.outer.some(([x, y]) => y > 20));
    if (booth) {
      const cx = booth.poly.outer.reduce((a, q) => a + q[0], 0) / booth.poly.outer.length;
      const cy = booth.poly.outer.reduce((a, q) => a + q[1], 0) / booth.poly.outer.length;
      S.push({ x: cx - 3.2, z: -cy, item: 'sniper', label: 'SVD Dragunov at the security booth', cost: DEFS.sniper.price });
    }
    // an ammo crate in the middle courtyard, by the pool house, so you can restock mid-fight
    const poolHouse = L.buildings.find((b) => b.group === 'small' && L.court_mid && pointInPoly(
      b.poly.outer.reduce((a, q) => a + q[0], 0) / b.poly.outer.length, b.poly.outer.reduce((a, q) => a + q[1], 0) / b.poly.outer.length, L.court_mid.outer));
    if (poolHouse) {
      const cx = poolHouse.poly.outer.reduce((a, q) => a + q[0], 0) / poolHouse.poly.outer.length;
      const cy = poolHouse.poly.outer.reduce((a, q) => a + q[1], 0) / poolHouse.poly.outer.length;
      S.push({ x: cx, z: -cy, item: 'ammo', label: 'Ammo crate by the pool house', cost: 750, crate: true });
    }
    // OSM puts shop points inside the buildings: move each station out onto the pavement in front
    for (const st of S) {
      const inside = L.buildings.find((b) => pointInPoly(st.x, -st.z, b.poly.outer));
      if (!inside) continue;
      let best = null;
      const pts = inside.poly.outer;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 1) continue;
        const tx = (bx - ax) / len, ty = (by - ay) / len;
        const t = Math.max(0.8, Math.min(len - 0.8, (st.x - ax) * tx + (-st.z - ay) * ty));
        const px = ax + tx * t, py = ay + ty * t;
        const ox = px + ty * 1.6, oy = py - tx * 1.6;   // 1.6 m outside (CCW ring: outward = (dy, -dx))
        if (L.buildings.some((b) => pointInPoly(ox, oy, b.poly.outer))) continue;
        const d = Math.hypot(st.x - px, -st.z - py);
        if (!best || d < best.d) best = { d, ox, oy };
      }
      if (best) { st.x = best.ox; st.z = -best.oy; }
    }
    this.stations = S;
    // glowing markers in front of the shop doors
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.85 });
    for (const st of S.filter((q) => q.crate)) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.7), new THREE.MeshStandardMaterial({ color: 0x4d5a36, roughness: 0.8 }));
      const y = this.g.hm.atWorld(st.x, st.z);
      crate.position.set(st.x + 1.0, y + 0.3, st.z);
      crate.castShadow = crate.receiveShadow = true;
      this.g.scene.add(crate);
      this.g.colliders.addBox(st.x + 1.0, st.z, 0.55, 0.35, 0, { height: y + 0.6, kind: 'crate' });
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.08, 0.74), new THREE.MeshStandardMaterial({ color: 0xd9b43a, roughness: 0.6 }));
      lid.position.set(st.x + 1.0, y + 0.62, st.z);
      this.g.scene.add(lid);
    }
    this.stationMeshes = S.map((s) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 8, 32), mat);
      m.rotation.x = Math.PI / 2;
      m.position.set(s.x, this.g.hm.atWorld(s.x, s.z) + 0.05, s.z);
      this.g.scene.add(m);
      return m;
    });
  }

  nearestStation() {
    const p = this.g.player.pos;
    let best = null, bd = 2.6;
    for (const s of this.stations) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  tryBuy(s) {
    const g = this.g, w = g.weapons;
    let cost = s.cost;
    if (s.item === 'rifle' || s.item === 'shotgun' || s.item === 'sniper') { if (w.owned[s.item]) cost = Math.round(cost / 2); }
    if (s.item === 'health' && g.player.maxHealth >= 150) return g.hud.banner('Already bought', '');
    if (s.item === 'stamina' && g.player.speedMul > 1) return g.hud.banner('Already bought', '');
    if (this.points < cost) { g.audio.play('empty'); return; }
    this.addPoints(-cost, true);
    g.audio.play('buy');
    if (s.item === 'rifle' || s.item === 'shotgun' || s.item === 'sniper') w.give(s.item);
    else if (s.item === 'ammo') w.refillAll();
    else if (s.item === 'health') { g.player.maxHealth = 150; g.player.health = 150; }
    else if (s.item === 'stamina') g.player.speedMul = 1.18;
    else if (s.item === 'double') this.double = 30;
  }

  addPoints(n, raw = false) {
    const v = raw ? n : n * (this.double > 0 ? 2 : 1);
    this.points += v;
    this.g.hud.points(this.points);
    this.g.hud.feed(v);
  }

  // ---- waves ----
  waveCount(w) { return Math.round(6 + w * 3.2 + w * w * 0.32); }
  maxAlive(w) { return Math.min(8 + w * 2, 26); }
  health(w) { return w <= 9 ? 90 + 55 * w : (90 + 55 * 9) * Math.pow(1.09, w - 9); }

  startWave() {
    this.wave++;
    this.state = 'active';
    this.toSpawn = this.waveCount(this.wave);
    this.spawnT = 1.5;
    this.g.hud.wave(this.wave);
    this.g.hud.banner(`Wave ${this.wave}`, this.wave === 1 ? 'They’re coming through the gates' : '');
    // wave 1: a distant air-raid siren somewhere over Dighomi, quiet and fading; later waves: a soft low boom
    if (this.wave === 1) this.g.audio.play('waveStart', { vol: 0.3, lowpass: 1300, fade: 5, jitter: 0 });
    else this.g.audio.play('waveSoft', { vol: 0.8 });
    this.g.onWave?.(this.wave);
  }

  pickSpawn() {
    const g = this.g, p = g.player.pos;
    const cands = [];
    for (const s of g.level.spawns) {
      const x = s.x, z = -s.y;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < 12 || d > 130) continue;
      const path = g.nav.distanceAt(x, z);
      if (!isFinite(path) || path > 160) continue;
      const seen = d < 60 && g.colliders.clear(p.x, p.y + 1.6, p.z, x, g.hm.atWorld(x, z) + 1.4, z);
      // prefer spawns about 30 m away on foot, out of sight
      const w = (seen ? 0.08 : 1) * (Math.exp(-(((path - 30) / 20) ** 2)) + 0.03);
      cands.push([w, x, z, s.kind]);
    }
    if (!cands.length) return null;
    let tot = cands.reduce((a, c) => a + c[0], 0), r = Math.random() * tot;
    for (const c of cands) { r -= c[0]; if (r <= 0) return c; }
    return cands[cands.length - 1];
  }

  spawnOne() {
    const s = this.pickSpawn();
    if (!s) return false;
    const w = this.wave;
    const runnerP = THREE.MathUtils.clamp((w - 2) * 0.12, 0, 0.75);
    const type = w >= 6 && Math.random() < 0.06 ? 'brute' : Math.random() < runnerP ? 'runner' : 'walker';
    const hp = this.health(w) * (type === 'brute' ? 3 : 1);
    const speed = type === 'runner' ? 3.4 + Math.min(1.0, w * 0.05) : type === 'brute' ? 1.2 : 1.25 + Math.min(0.5, w * 0.05);
    const jitter = () => (Math.random() - 0.5) * 1.5;
    this.g.zombies.spawn(s[1] + jitter(), s[2] + jitter(), { type, hp, speed, damage: 34 + Math.min(26, w * 2) });
    return true;
  }

  onKill(zb, head, weapon) {
    this.kills++;
    if (head) this.headshots++;
    this.addPoints(weapon === 'knife' ? 130 : head ? 100 : 60);
    // power-up drop
    if (Math.random() < 0.035 && this.drops.length < 3) this.drop(zb.pos);
  }

  onHit(zb, killed) { if (!killed) this.addPoints(10); }

  drop(pos) {
    const keys = Object.keys(POWERUPS);
    const kind = keys[Math.floor(Math.random() * keys.length)];
    const def = POWERUPS[kind];
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 1.6, roughness: 0.3 }));
    m.position.set(pos.x, pos.y + 1.0, pos.z);
    this.dropGroup.add(m);
    this.drops.push({ kind, mesh: m, t: 0 });
  }

  update(dt) {
    const g = this.g;
    const w = g.weapons, a = w.ammo;
    if (a && a.mag + a.reserve <= w.def.mag * 1.5 && !this.ammoHinted?.[w.current]) {
      (this.ammoHinted ||= {})[w.current] = true;
      g.hud.notice('Low on ammo: press F at the ammo crate by the pool (750) or at 2 Nabiji on the podium (600)');
    }
    if (a && a.reserve > w.def.mag * 2 && this.ammoHinted) this.ammoHinted[w.current] = false;
    if (this.double > 0) this.double -= dt;
    if (g.weapons.instaKill > 0) g.weapons.instaKill -= dt;
    // drops
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt;
      d.mesh.rotation.y += dt * 2;
      d.mesh.position.y += Math.sin(d.t * 3) * 0.004;
      d.mesh.visible = d.t < 22 || Math.floor(d.t * 6) % 2 === 0;
      const p = g.player.pos;
      if (Math.hypot(d.mesh.position.x - p.x, d.mesh.position.z - p.z) < 1.2) {
        this.collect(d.kind);
        this.dropGroup.remove(d.mesh); this.drops.splice(i, 1);
      } else if (d.t > 28) { this.dropGroup.remove(d.mesh); this.drops.splice(i, 1); }
    }
    // shops prompt
    const s = this.nearestStation();
    if (s && !g.player.dead) {
      const isGun = ['rifle', 'shotgun', 'sniper'].includes(s.item);
      const owned = isGun && g.weapons.owned[s.item];
      const cost = owned ? Math.round(s.cost / 2) : s.cost;
      const what = owned ? `Ammo for the ${DEFS[s.item].name}` : s.label;
      g.hud.prompt(`Press <b>F</b> \u2014 ${what} <b>[${cost}]</b>${this.points < cost ? ' <span style="color:#ff6b6b">not enough points</span>' : ''}`);
      if (g.input.hit('KeyF')) this.tryBuy(s);
    } else g.hud.prompt('');
    for (const m of this.stationMeshes) m.rotation.z += dt;

    if (g.frozen) return;
    if (this.state === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0) this.startWave();
      return;
    }
    // active wave
    this.spawnT -= dt;
    if (this.toSpawn > 0 && this.spawnT <= 0 && g.zombies.alive < this.maxAlive(this.wave)) {
      if (this.spawnOne()) this.toSpawn--;
      this.spawnT = Math.max(0.35, 2.2 - this.wave * 0.14) * (0.6 + Math.random() * 0.8);
    }
    if (this.toSpawn <= 0 && g.zombies.alive === 0) {
      this.state = 'intermission';
      this.timer = 11;
      g.hud.banner(`Wave ${this.wave} survived`, 'The shops on the podium are open — press F to buy');
      g.audio.play('waveEnd', { vol: 0.45 });
      g.onWaveEnd?.(this.wave);
    }
  }

  collect(kind) {
    const g = this.g, def = POWERUPS[kind];
    g.hud.banner(def.label, '');
    g.audio.play('pickup', { vol: 1 });
    if (kind === 'maxammo') g.weapons.refillAll();
    if (kind === 'instakill') g.weapons.instaKill = 30;
    if (kind === 'double') this.double = 30;
    if (kind === 'nuke') { g.zombies.killAll(); this.addPoints(400, true); }
  }

  markers() {
    const m = this.stations.map((s) => ({ x: s.x, z: s.z, color: '#ffd36b' }));
    for (const d of this.drops) m.push({ x: d.mesh.position.x, z: d.mesh.position.z, color: '#7cff7c' });
    return m;
  }
}
