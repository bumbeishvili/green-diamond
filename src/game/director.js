import * as THREE from 'three';
import { DEFS } from './weapons.js';
import { pointInPoly } from '../world/geom.js';

// Rules of the survival mode: waves and what's in them, spawning, points, power-ups and the shops.

const POWERUPS = {
  maxammo: { label: 'MAX AMMO', color: 0x5fd35f },
  instakill: { label: 'INSTA-KILL', color: 0xff4040 },
  double: { label: 'DOUBLE POINTS', color: 0xffd23f },
  nuke: { label: 'NUKE', color: 0xff8a2a },
};
const centroid = (pts) => [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];

export class Director {
  constructor(game) {
    this.g = game;
    this.wave = 0;
    this.state = 'intermission';
    this.timer = 6;
    this.toSpawn = 0;
    this.total = 0;
    this.spawnT = 0;
    this.points = 500;
    this.kills = 0;
    this.headshots = 0;
    this.deaths = 0;
    this.team = new Map();  // co-op: the other players' points and tally, by slot (host)
    this.double = 0;
    this.drops = [];
    this.packs = [];       // dog packs / crow flocks still to come this wave: {at, kind, n}
    this.roofT = 0;        // how long the player has been up on a roof / in the air
    this.crowT = 0;
    this.dropGroup = new THREE.Group();
    game.scene.add(this.dropGroup);
    this.buildStations();
    // zombies that wander far out of sight get moved to a closer spawn
    game.zombies.relocate = (zb) => {
      const sp = this.pickSpawn();
      if (sp) { zb.roof = null; zb.pos.set(sp[1], sp[4] ?? game.hm.atWorld(sp[1], sp[2]), sp[2]); zb.vel.set(0, 0, 0); }
    };
    game.zombies.onScream = (zb) => this.onScream(zb);
  }

  // ---- shops: real brands on the podium, security booths, a crate by the stadium, a rooftop cache ----
  buildStations() {
    const g = this.g, L = g.level, byName = (n) => L.pois.find((p) => p.name === n);
    const S = [];
    const add = (poi, item, label, cost) => { if (poi) S.push({ x: poi.x, z: -poi.y, item, label, cost }); };
    add(byName('Spar'), 'rifle', 'AK-74 at Spar', DEFS.rifle.price);
    add(byName('Assorti'), 'm4', 'M4A1 at Assorti', DEFS.m4.price);
    add(byName('Diamond'), 'deagle', 'Desert Eagle at the Diamond salon', DEFS.deagle.price);
    add(byName('Nikora'), 'shotgun', 'TOZ-194 shotgun at Nikora', DEFS.shotgun.price);
    add(byName('Ori Nabiji'), 'ammo', 'Ammo and grenades at 2 Nabiji', 600);
    add(byName('36.6'), 'health', 'Pharmacy 36.6: more health', 2500);
    add(byName('Format Fit'), 'stamina', 'Format Fit: faster legs', 2000);
    add(byName('TBC Bank'), 'double', 'TBC terminal: double points (30 s)', 1200);
    // the security booths: Gate 2 sells the Dragunov, Gate 1 the M60 (buy on the courtyard side)
    for (const b of L.buildings.filter((q) => q.group === 'guard')) {
      const [cx, cy] = centroid(b.poly.outer);
      const north = cy > 0;
      S.push({ x: cx - 3.2, z: -cy, item: north ? 'sniper' : 'mg', label: north ? 'SVD Dragunov at the Gate 2 security booth' : 'M60 machine gun at the Gate 1 security booth', cost: DEFS[north ? 'sniper' : 'mg'].price });
    }
    // an ammo crate in the middle courtyard, by the pool house, so you can restock mid-fight
    const poolHouse = L.buildings.find((b) => b.group === 'small' && L.court_mid && pointInPoly(...centroid(b.poly.outer), L.court_mid.outer));
    if (poolHouse) {
      const [cx, cy] = centroid(poolHouse.poly.outer);
      S.push({ x: cx, z: -cy, item: 'ammo', label: 'Ammo crate by the pool house', cost: 750, crate: true });
    }
    // the compound bow: a crate at the south gate of the stadium
    const stadium = (L.sport || []).find((c) => c.kind === 'court_round');
    if (stadium) S.push({ x: stadium.x + 1.8, z: -(stadium.y - stadium.w / 2 - 2.2), item: 'bow', label: 'Compound bow in the crate by the stadium', cost: DEFS.bow.price, crate: true, fixed: true });
    // the SCAR 20S: a cache on the highest roof you can climb to
    const top = [...g.stairs.list].sort((a, b) => b.top - a.top)[0];
    if (top) {
      const [hx, hz] = [top.roof.x, top.roof.z];
      const dir = new THREE.Vector2(-Math.sin(top.face), -Math.cos(top.face));
      let spot = null;
      for (const d of [4, 3, 5, 2.5]) {
        for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
          const v = dir.clone().rotateAround(new THREE.Vector2(), turn);
          const x = hx + v.x * d, z = hz + v.y * d;
          const r = g.player.roofObj(x, z);
          if (r && r.stair === top && !g.colliders.resolve({ x, z }, 1.4, top.top + 0.1, top.top + 1.5, 1)) { spot = { x, z }; break; }
        }
        if (spot) break;
      }
      if (spot) S.push({ x: spot.x, z: spot.z, y: top.top, item: 'autosniper', label: 'FN SCAR 20S (rooftop cache)', cost: DEFS.autosniper.price, crate: true, roof: true });
    }
    // OSM puts shop points inside the buildings: move each station out onto the pavement in front
    for (const st of S) {
      if (st.roof || st.fixed) continue;
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
    // two stations must not share a spot (Nikora / TBC / 2 Nabiji are next door to each other)
    for (let i = 0; i < S.length; i++) for (let j = 0; j < i; j++) {
      const a = S[i], b = S[j], d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < 2.4 && !a.roof && !b.roof) { const k = (2.4 - d) / (d || 1); a.x += (a.x - b.x) * k + (d ? 0 : 2.4); a.z += (a.z - b.z) * k; }
    }
    for (const st of S) if (st.y == null) st.y = g.hm.atWorld(st.x, st.z);
    this.stations = S;
    // crates and glowing rings
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.85 });
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x4d5a36, roughness: 0.8 }), lidMat = new THREE.MeshStandardMaterial({ color: 0xd9b43a, roughness: 0.6 });
    for (const st of S.filter((q) => q.crate)) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.7), crateMat);
      crate.position.set(st.x + 1.0, st.y + 0.3, st.z);
      crate.castShadow = crate.receiveShadow = true;
      g.scene.add(crate);
      g.colliders.addBox(st.x + 1.0, st.z, 0.55, 0.35, 0, { height: st.y + 0.6, minY: st.y - 0.3, kind: 'crate' });
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.08, 0.74), lidMat);
      lid.position.set(st.x + 1.0, st.y + 0.62, st.z);
      g.scene.add(lid);
    }
    this.stationMeshes = S.map((s) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 8, 32), mat);
      m.rotation.x = Math.PI / 2;
      m.position.set(s.x, s.y + 0.05, s.z);
      g.scene.add(m);
      return m;
    });
  }

  nearestStation() {
    const p = this.g.player;
    if (p.vehicle) return null;
    let best = null, bd = 2.6;
    for (const s of this.stations) {
      if (Math.abs(s.y - p.pos.y) > 2) continue;
      const d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  isGun(item) { return !!DEFS[item] && !DEFS[item].melee; }

  cost(s) {
    return this.isGun(s.item) && this.g.weapons.owned[s.item] ? Math.round(s.cost / 2) : s.cost;
  }

  tryBuy(s) {
    const g = this.g, w = g.weapons;
    const cost = this.cost(s);
    // co-op: points are kept by the host; it says yes (buyOk) or no
    if (g.mode === 'client') {
      if (this.points < cost) { g.audio.play('empty'); return; }
      g.net.buy(this.stations.indexOf(s), cost, !!(this.isGun(s.item) && w.owned[s.item]));
      return;
    }
    if (s.item === 'health' && g.player.maxHealth >= 150) return g.hud.banner('Already bought', '');
    if (s.item === 'stamina' && g.player.speedMul > 1) return g.hud.banner('Already bought', '');
    if (this.points < cost) { g.audio.play('empty'); return; }
    this.addPoints(-cost, true);
    this.bought(s.item);
    if (s.item === 'double') this.g.net?.teamDouble();
  }

  // what a purchase does for the local player (on a client, once the host said yes)
  bought(item) {
    const g = this.g, w = g.weapons;
    g.audio.play('buy');
    if (this.isGun(item)) w.give(item);
    else if (item === 'ammo') w.refillAll();
    else if (item === 'health') { g.player.maxHealth = 150; g.player.health = 150; }
    else if (item === 'stamina') g.player.speedMul = 1.18;
    else if (item === 'double') this.double = 30;
  }

  // co-op: each player has their own points and tally; the local player's live on the director
  tally(slot) {
    if (slot === (this.g.localSlot ?? 0)) return this;
    let t = this.team.get(slot);
    if (!t) this.team.set(slot, t = { points: 500, kills: 0, headshots: 0, deaths: 0 });
    return t;
  }

  addPoints(n, raw = false, slot = this.g.localSlot ?? 0) {
    const v = raw ? n : n * (this.double > 0 ? 2 : 1);
    const t = this.tally(slot);
    t.points += v;
    if (t === this) { this.g.hud.points(this.points); this.g.hud.feed(v); }
    else this.g.net?.pointsFeed(slot, v);
  }

  // everyone the horde is after (solo: just you)
  get players() { return this.g.players || [this.g.player]; }
  living() { const l = this.players.filter((p) => !p.dead); return l.length ? l : this.players; }
  focus() { const l = this.living(); return l[Math.floor(Math.random() * l.length)]; }
  get teamSize() { return Math.max(1, this.players.length); }

  // ---- waves ----
  // bigger teams face more of them, a little tougher (co-op)
  waveCount(w) { return Math.round((6 + w * 3.2 + w * w * 0.32) * (1 + 0.6 * (this.teamSize - 1))); }
  maxAlive(w) { return Math.round(Math.min(8 + w * 2, 26) * (1 + 0.4 * (this.teamSize - 1))); }
  health(w) { return (w <= 9 ? 90 + 55 * w : (90 + 55 * 9) * Math.pow(1.09, w - 9)) * (1 + 0.1 * (this.teamSize - 1)); }
  damage(w) { return 34 + Math.min(26, w * 2); }

  startWave() {
    this.wave++;
    const w = this.wave;
    this.state = 'active';
    this.toSpawn = this.total = this.waveCount(w);
    this.spawnT = 1.5;
    // stray dog packs from wave 3, crows from wave 4
    this.packs = [];
    if (w >= 3 && (w % 2 === 1 || Math.random() < 0.5)) this.packs.push({ at: 0.25 + Math.random() * 0.3, kind: 'dogs', n: Math.min(6, 2 + Math.floor(w / 3)) });
    if (w >= 7 && Math.random() < 0.6) this.packs.push({ at: 0.6 + Math.random() * 0.25, kind: 'dogs', n: Math.min(6, 2 + Math.floor(w / 4)) });
    if (w >= 4 && Math.random() < 0.7) this.packs.push({ at: 0.35 + Math.random() * 0.4, kind: 'crows', n: Math.min(8, 3 + Math.floor(w / 4)) });
    const g = this.g;
    g.hud.wave(w);
    const note = w === 1 ? 'They’re coming through the gates' : w === 3 ? 'Listen for the dogs' : w === 4 ? 'Watch the sky' : '';
    g.hud.banner(`Wave ${w}`, note);
    // wave 1: a distant air-raid siren somewhere over Dighomi, quiet and fading; later waves: a soft low boom
    if (w === 1) g.audio.play('waveStart', { vol: 0.3, lowpass: 1300, fade: 5, jitter: 0 });
    else g.audio.play('waveSoft', { vol: 0.8 });
    g.pickups?.replenish(25);
    g.onWave?.(w);
    g.net?.wave(w, note);
  }

  pickSpawn() {
    const g = this.g, ps = this.living(), p = this.focus().pos;
    const cands = [];
    for (const s of g.level.spawns) {
      const x = s.x, z = -s.y;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d > 130 || ps.some((q) => Math.hypot(x - q.pos.x, z - q.pos.z) < 12)) continue;
      let path = g.nav.distanceAt(x, z);
      if (s.f != null) {
        // down in a car park: the walk out to its nearest ramp plus the flow field from there
        const u = g.underground.at(x, z, s.f + 0.3), d = u && g.underground.nearestDoor(u, x, z);
        path = d ? g.nav.distanceAt(d.out.x, d.out.z) + Math.hypot(d.in.x - x, d.in.z - z) : Infinity;
      }
      if (!isFinite(path) || path > 160) continue;
      const sy = s.f ?? g.hm.atWorld(x, z);
      const seen = ps.some((q) => Math.hypot(x - q.pos.x, z - q.pos.z) < 60 && g.colliders.clear(q.pos.x, q.pos.y + 1.6, q.pos.z, x, sy + 1.4, z));
      // prefer spawns about 30 m away on foot, out of sight
      const w = (seen ? 0.08 : 1) * (Math.exp(-(((path - 30) / 20) ** 2)) + 0.03);
      cands.push([w, x, z, s.kind, s.f]);
    }
    if (!cands.length) return null;
    const tot = cands.reduce((a, c) => a + c[0], 0);
    let r = Math.random() * tot;
    for (const c of cands) { r -= c[0]; if (r <= 0) return c; }
    return cands[cands.length - 1];
  }

  // What kind of zombie comes next: walkers early, then runners, crawlers, bloaters, screamers, brutes.
  pickType(w) {
    const z = this.g.zombies;
    const table = [
      ['runner', THREE.MathUtils.clamp((w - 2) * 0.1, 0, 0.42)],
      ['crawler', w >= 2 ? 0.08 : 0],
      ['bloater', w >= 3 && z.count('bloater') < 3 ? 0.07 : 0],
      ['screamer', w >= 4 && z.count('screamer') < 1 ? 0.05 : 0],
      ['brute', w >= 5 && z.count('brute') < 2 + Math.floor(w / 8) ? Math.min(0.1, 0.03 + (w - 5) * 0.01) : 0],
    ];
    let r = Math.random();
    for (const [t, p] of table) { if (r < p) return t; r -= p; }
    return 'walker';
  }

  speedMul(type, w) { return type === 'runner' ? 1 + Math.min(0.08, w * 0.01) : 1 + Math.min(0.2, w * 0.02); }

  spawnOne() {
    const g = this.g, w = this.wave, pl = this.focus();
    const type = this.pickType(w);
    const opts = { type, hp: this.health(w), speedMul: this.speedMul(type, w), damage: this.damage(w) };
    // camping on a roof: some come straight out of the roof door (they took the stairs earlier)
    const st = pl.roof && pl.roof.stair;
    if (st && this.roofT > 12 && Math.random() < 0.35) {
      const a = Math.random() * Math.PI * 2;
      g.zombies.spawn(st.roof.x + Math.cos(a) * 0.5, st.roof.z + Math.sin(a) * 0.5, { ...opts, roof: st.top, stair: st });
      return true;
    }
    const s = this.pickSpawn();
    if (!s) return false;
    const jitter = () => (Math.random() - 0.5) * 1.5;
    g.zombies.spawn(s[1] + jitter(), s[2] + jitter(), { ...opts, y: s[4] ?? null });
    return true;
  }

  spawnPack(pack) {
    const g = this.g, w = this.wave;
    if (pack.kind === 'dogs') {
      const s = this.pickSpawn();
      if (!s) return;
      for (let i = 0; i < pack.n; i++) {
        const a = (i / pack.n) * Math.PI * 2;
        const type = i === 0 && w >= 6 ? 'wolf' : 'dog'; // from wave 6 a wolf leads the pack
        g.zombies.spawn(s[1] + Math.cos(a) * 1.2, s[2] + Math.sin(a) * 1.2, { type, hp: this.health(w), speedMul: this.speedMul('dog', w), damage: Math.min(40, this.damage(w)), y: s[4] ?? null });
      }
      g.audio.play('growl', { vol: 0.9, pos: { x: s[1], y: g.hm.atWorld(s[1], s[2]) + 0.6, z: s[2] }, ref: 12 });
      g.hud.notice('Stray dogs: they are fast, keep moving');
    } else this.spawnCrows(pack.n);
  }

  spawnCrows(n) {
    const g = this.g, p = this.focus().pos, w = this.wave;
    const a0 = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + (Math.random() - 0.5) * 0.8, d = 45 + Math.random() * 15;
      g.zombies.spawn(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, { type: 'crow', hp: this.health(w), damage: Math.min(40, this.damage(w)), y: p.y + 22 + Math.random() * 10 });
    }
    g.audio.play('caw', { vol: 0.8 });
  }

  onScream(zb) {
    const g = this.g;
    g.hud.notice('A screamer called the horde');
    g.net?.notice('A screamer called the horde');
    // the scream brings company, if there's room
    for (let i = 0; i < 2; i++) if (g.zombies.alive < this.maxAlive(this.wave) + 4) this.spawnOne();
  }

  onKill(zb, head, weapon, slot = this.g.localSlot ?? 0) {
    const t = this.tally(slot);
    t.kills++;
    if (head) t.headshots++;
    const bonus = zb.type === 'brute' ? 120 : zb.type === 'screamer' || zb.type === 'wolf' ? 60 : zb.species === 'crow' ? 10 : 0;
    this.addPoints((weapon === 'knife' ? 130 : head ? 100 : 60) + bonus, false, slot);
    // power-up drop
    if (zb.species !== 'crow' && Math.random() < 0.035 && this.drops.length < 3) this.drop(zb.pos);
  }

  onHit(zb, killed, head, slot = this.g.localSlot ?? 0) { if (!killed) this.addPoints(10, false, slot); }

  drop(pos) {
    const keys = Object.keys(POWERUPS);
    const kind = keys[Math.floor(Math.random() * keys.length)];
    const def = POWERUPS[kind];
    const id = this.dropSeq = (this.dropSeq || 0) + 1;
    this.addDrop(kind, pos.x, pos.y, pos.z, id);
    this.g.net?.dropFx(id, kind, pos.x, pos.y, pos.z);
  }

  addDrop(kind, x, y, z, id) {
    const def = POWERUPS[kind];
    if (!def) return;
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 1.6, roughness: 0.3 }));
    m.position.set(x, y + 1.0, z);
    this.dropGroup.add(m);
    this.drops.push({ kind, mesh: m, t: 0, id });
  }

  removeDrop(id) {
    const i = this.drops.findIndex((d) => d.id === id);
    if (i >= 0) { this.dropGroup.remove(this.drops[i].mesh); this.drops.splice(i, 1); }
  }

  update(dt) {
    const g = this.g;
    const w = g.weapons, a = w.ammo;
    if (g.mode === 'client') return this.clientUpdate(dt);
    if (a && !w.def.melee && !w.def.bow && a.mag + a.reserve <= w.def.mag * 1.5 && !this.ammoHinted?.[w.current]) {
      (this.ammoHinted ||= {})[w.current] = true;
      g.hud.notice('Low on ammo: grab an ammo can, or press F at the pool-house crate (750) or 2 Nabiji (600)');
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
      const by = this.players.find((q) => !q.dead && Math.hypot(d.mesh.position.x - q.pos.x, d.mesh.position.z - q.pos.z) < 1.2 && Math.abs(d.mesh.position.y - 1 - q.pos.y) < 2);
      if (by) {
        this.collect(d.kind, by.slot ?? g.localSlot ?? 0);
        g.net?.dropGone(d.id, d.kind, by.slot ?? 0);
        this.dropGroup.remove(d.mesh); this.drops.splice(i, 1);
      } else if (d.t > 28) { g.net?.dropGone(d.id, null, -1); this.dropGroup.remove(d.mesh); this.drops.splice(i, 1); }
    }
    if (g.mode !== 'host') this.shops(dt);

    // up on a roof or in the drone for a while: the crows find you
    const high = this.players.some((pl) => !pl.dead && (pl.roof || (pl.vehicle && pl.vehicle.type === 'drone' && pl.pos.y - g.hm.atWorld(pl.pos.x, pl.pos.z) > 6)));
    this.roofT = high ? this.roofT + dt : 0;

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
    const progress = 1 - this.toSpawn / (this.total || 1);
    for (let i = this.packs.length - 1; i >= 0; i--) if (progress >= this.packs[i].at) { this.spawnPack(this.packs[i]); this.packs.splice(i, 1); }
    if (this.roofT > 15 && this.wave >= 2) {
      this.crowT -= dt;
      if (this.crowT <= 0 && g.zombies.count('crow') < 8) { this.crowT = 18; this.spawnCrows(2 + Math.floor(Math.random() * 2)); }
    } else this.crowT = Math.min(this.crowT, 4);
    if (this.toSpawn <= 0 && !this.packs.length && g.zombies.alive === 0) {
      this.state = 'intermission';
      this.timer = 11;
      g.hud.banner(`Wave ${this.wave} survived`, 'The shops are open: press F to buy');
      g.audio.play('waveEnd', { vol: 0.45 });
      g.onWaveEnd?.(this.wave);
      g.net?.waveEnd(this.wave);
    }
  }

  // power-ups work for the whole team
  collect(kind, slot = this.g.localSlot ?? 0) {
    const g = this.g;
    this.powerup(kind);
    if (kind === 'instakill') g.weapons.instaKill = 30;
    if (kind === 'nuke') { g.zombies.killAll(); this.addPoints(400, true, slot); }
  }

  // what everyone sees and gets (a client runs this when the host says a power-up was taken)
  powerup(kind) {
    const g = this.g, def = POWERUPS[kind];
    if (!def) return;
    g.hud.banner(def.label, '');
    g.audio.play('pickup', { vol: 1 });
    if (kind === 'maxammo') g.weapons.refillAll();
    if (kind === 'double') this.double = 30;
  }

  // a client: the shops (the host takes the money) and the power-ups the host dropped
  clientUpdate(dt) {
    const g = this.g;
    if (this.double > 0) this.double -= dt;
    for (const d of this.drops) {
      d.t += dt;
      d.mesh.rotation.y += dt * 2;
      d.mesh.position.y += Math.sin(d.t * 3) * 0.004;
      d.mesh.visible = d.t < 22 || Math.floor(d.t * 6) % 2 === 0;
    }
    this.shops(dt);
  }

  // the shop prompt for the local player (every frame; on a co-op host the waves run on ticks)
  shops(dt) {
    const g = this.g;
    const s = this.nearestStation();
    if (s && !g.player.dead) {
      const owned = this.isGun(s.item) && g.weapons.owned[s.item];
      const cost = this.cost(s);
      const what = owned ? `Ammo for the ${DEFS[s.item].name}` : s.label;
      g.hud.prompt(`Press <b>F</b> — ${what} <b>[${cost}]</b>${this.points < cost ? ' <span style="color:#ff6b6b">not enough points</span>' : ''}`, 3);
      if (g.input.hit('KeyF')) { g.input.pressed.delete('KeyF'); this.tryBuy(s); }
    }
    for (const m of this.stationMeshes) m.rotation.z += dt;
  }

  markers() {
    const m = this.stations.map((s) => ({ x: s.x, z: s.z, color: '#ffb347' }));
    for (const d of this.drops) m.push({ x: d.mesh.position.x, z: d.mesh.position.z, color: '#e0e6ff' });
    return m;
  }
}

