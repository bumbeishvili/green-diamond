import { stationIcon } from './mapicons.js';
import * as THREE from 'three';
import { DEFS, UPGRADES } from './weapons.js';
import { ARMOUR } from './player.js';
import { pointInPoly } from '../world/geom.js';

// Rules of the survival mode: waves and what's in them, spawning, points, power-ups and the shops.

const POWERUPS = {
  maxammo: { label: 'MAX AMMO', color: 0x5fd35f },
  instakill: { label: 'INSTA-KILL', color: 0xff4040 },
  double: { label: 'DOUBLE POINTS', color: 0xffd23f },
  nuke: { label: 'NUKE', color: 0xff8a2a },
};
// what each kind pays on top of the kill (the harder ones, the more)
const KILL_BONUS = { brute: 120, screamer: 60, wolf: 60, spitter: 60, leaper: 50, riot: 90, giant: 600 };
// the last wave: clear it and Green Diamond is yours (alone and in co-op; PvP plays to its clock)
export const FINAL_WAVE = 10;
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
    this.frags = 0;         // PvP: players killed
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
    // (OSM calls it Diamond; the shop there is the fruit and vegetable shop by Gate 1)
    add(byName('Diamond'), 'deagle', 'Desert Eagle at ხილ ბოსტანი, the fruit shop', DEFS.deagle.price);
    add(byName('Nikora'), 'shotgun', 'TOZ-194 shotgun at Nikora', DEFS.shotgun.price);
    // (the gunsmith's bench and the armour are shops of their own; ammo: the crates below, and each gun
    // shop fills up the gun it sold you)
    add(byName('Ori Nabiji'), 'upgrade', 'Gunsmith\'s bench behind 2 Nabiji', 0);
    add(byName('36.6'), 'armour', 'Pharmacy 36.6: body armour', 0);
    add(byName('Format Fit'), 'stamina', 'Format Fit: faster legs', 2000);
    add(byName('TBC Bank'), 'double', 'TBC terminal: double points (30 s)', 1200);
    // the security booths: Gate 2 sells the Dragunov, Gate 1 the M60 (buy on the courtyard side)
    for (const b of L.buildings.filter((q) => q.group === 'guard')) {
      const [cx, cy] = centroid(b.poly.outer);
      const north = cy > 0;
      S.push({ x: cx - 3.2, z: -cy, item: north ? 'sniper' : 'mg', label: north ? 'SVD Dragunov at the Gate 2 security booth' : 'M60 machine gun at the Gate 1 security booth', cost: DEFS[north ? 'sniper' : 'mg'].price });
    }
    // the Steyr AUG at the corner shop (the one OSM doesn't name)
    add(L.pois.find((p) => !p.name), 'aug', 'Steyr AUG at the corner shop', DEFS.aug.price);
    // an ammo crate in the middle courtyard, by the pool house, so you can restock mid-fight
    const poolHouse = L.buildings.find((b) => b.group === 'small' && L.court_mid && pointInPoly(...centroid(b.poly.outer), L.court_mid.outer));
    if (poolHouse) {
      const [cx, cy] = centroid(poolHouse.poly.outer);
      S.push({ x: cx, z: -cy, item: 'ammo', label: 'Ammo crate by the pool house: every gun full, and grenades', cost: 750, crate: true });
    }
    // the compound bow: a crate at the south gate of the stadium
    const stadium = (L.sport || []).find((c) => c.kind === 'court_round');
    if (stadium) S.push({ x: stadium.x + 1.8, z: -(stadium.y - stadium.w / 2 - 2.2), item: 'bow', label: 'Compound bow in the crate by the stadium', cost: DEFS.bow.price, crate: true, fixed: true });
    // the chainsaw: the groundskeeper's crate at the other end of the stadium
    if (stadium) S.push({ x: stadium.x - 1.8, z: -(stadium.y + stadium.w / 2 + 2.2), item: 'chainsaw', label: 'Chainsaw in the groundskeeper\'s crate by the stadium', cost: DEFS.chainsaw.price, crate: true, fixed: true });
    // the mini-missile launcher: a crate down in the car park (the same light on every screen)
    const park = g.underground && g.underground.list[0];
    if (park && park.lights.length) {
      const [lx, ly] = park.lights[Math.floor(park.lights.length / 2)];
      S.push({ x: lx, z: -ly, y: park.floor, item: 'launcher', label: 'RPG-7 mini-missile launcher in the crate down in the car park', cost: DEFS.launcher.price, crate: true, fixed: true });
    }
    // the laser rifle: a crate in the car park under the pool court, between Spar and Nikora
    const south = g.underground && g.underground.list.find((u) => u.name === 'south');
    if (south && south.lights.length) {
      const [lx, ly] = south.lights[Math.floor(south.lights.length * 0.7)];
      S.push({ x: lx, z: -ly, y: south.floor, item: 'laser', label: 'Helios laser rifle in the crate down in the south car park', cost: DEFS.laser.price, crate: true, fixed: true });
    }
    // more ammo crates round the complex: at both gate booths, by the round courts east and
    // north-west, and down in each car park (nearest the middle, away from its other crate).
    // (Every player's list must match, index for index, whatever their settings: the trees, fewer
    // on low quality, don't count, and a crate goes in even where there's no better spot.)
    const NOTREES = { tree: true };
    const clear = (x, z, y) => {   // (a spot near x, z with room for the crate beside it, clear of the rest)
      for (const d of [0, 1.5, 3, 4.5, 6]) for (let k = 0; k < (d ? 8 : 1); k++) {
        const a = k * Math.PI / 4, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, py = y ?? g.hm.atWorld(px, pz);
        if (y == null && L.buildings.some((b) => pointInPoly(px, -pz, b.poly.outer) || pointInPoly(px + 1, -pz, b.poly.outer))) continue;
        if (S.some((q) => Math.hypot(q.x - px, q.z - pz) < 3.2 && Math.abs((q.y ?? py) - py) < 2)) continue;
        if (g.colliders.resolve({ x: px, z: pz }, 1.1, py + 0.1, py + 1.5, 1, NOTREES) || g.colliders.resolve({ x: px + 1, z: pz }, 0.8, py + 0.1, py + 1.5, 1, NOTREES)) continue;
        return { x: px, z: pz };
      }
      return { x, z };
    };
    const ammo = (x, z, where, y = null) => {
      const p = clear(x, z, y);
      S.push({ x: p.x, z: p.z, y: y ?? undefined, item: 'ammo', label: `Ammo crate ${where}: every gun full, and grenades`, cost: 750, crate: true, fixed: true });
    };
    for (const b of L.buildings.filter((q) => q.group === 'guard')) {
      const [cx, cy] = centroid(b.poly.outer);
      ammo(cx - 5.5, -cy, cy > 0 ? 'at the Gate 2 booth' : 'at the Gate 1 booth');
    }
    for (const c of (L.sport || []).filter((q) => q.kind === 'court_round' && q !== stadium)) ammo(c.x + c.w / 2 + 2.5, -c.y, `by the round court (${-c.y < 0 ? 'north' : 'south'}${c.x < 0 ? '-west' : '-east'})`);
    for (const u of g.underground?.list || []) {
      if (!u.lights.length) continue;
      const mx = u.lights.reduce((a, l) => a + l[0], 0) / u.lights.length, my = u.lights.reduce((a, l) => a + l[1], 0) / u.lights.length;
      const mine = S.filter((q) => q.y != null && q.y < -1 && u.lights.some(([lx, ly]) => Math.hypot(lx - q.x, -ly - q.z) < 10));
      const score = ([lx, ly]) => Math.min(30, ...mine.map((q) => Math.hypot(lx - q.x, -ly - q.z))) - Math.hypot(lx - mx, ly - my) * 0.5;
      const [lx, ly] = u.lights.reduce((a, l) => (score(l) > score(a) ? l : a));
      ammo(lx, -ly, `down in the ${u.name === 'middle' ? 'big' : u.name} car park`, u.floor);
    }
    // the SCAR 20S: a cache on the highest roof you can climb to; the MSR on the next highest
    const roofs = [...g.stairs.list].sort((a, b) => b.top - a.top);
    const top = roofs[0];
    const cache = (st, item, label) => {
      const dir = new THREE.Vector2(-Math.sin(st.face), -Math.cos(st.face));
      for (const d of [4, 3, 5, 2.5]) {
        for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
          const v = dir.clone().rotateAround(new THREE.Vector2(), turn), x = st.roof.x + v.x * d, z = st.roof.z + v.y * d;
          const r = g.player.roofObj(x, z);
          if (r && r.stair === st && !g.colliders.resolve({ x, z }, 1.4, st.top + 0.1, st.top + 1.5, 1)) return S.push({ x, z, y: st.top, item, label, cost: DEFS[item].price, crate: true, roof: true });
        }
      }
      return 0;
    };
    if (roofs[1]) cache(roofs[1], 'msr', 'Remington MSR (rooftop cache)');
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

  // what it costs you now (null: nothing to buy here right now)
  cost(s) {
    const w = this.g.weapons, p = this.g.player;
    if (s.item === 'upgrade') { const l = w.level(w.current); return w.canUpgrade(w.current) && l < UPGRADES.length ? UPGRADES[l].price : null; }
    if (s.item === 'armour') return p.armour < ARMOUR.length ? ARMOUR[p.armour].price : null;
    if (this.isGun(s.item) && w.owned[s.item]) return this.full(s.item) ? null : this.refillCost(s.item);   // (you have it: the shop fills it up)
    if (s.item === 'stamina' && p.speedMul > 1) return null;
    return s.cost;
  }

  // what the shop offers you, in words
  offer(s) {
    const w = this.g.weapons, p = this.g.player, def = DEFS[w.current];
    if (s.item === 'upgrade') {
      if (!w.canUpgrade(w.current)) return 'Gunsmith: take out a gun to upgrade it';
      const l = w.level(w.current);
      if (l >= UPGRADES.length) return `Gunsmith: the ${def.short} is fully upgraded (${UPGRADES[l - 1].name})`;
      const more = Math.round((UPGRADES[l].dmg / (l ? UPGRADES[l - 1].dmg : 1) - 1) * 100);
      return `Gunsmith: ${def.short} to ${UPGRADES[l].name} (+${more}% damage, more ammo)`;
    }
    if (s.item === 'armour') {
      if (p.armour >= ARMOUR.length) return `Pharmacy 36.6: you have the best armour (${ARMOUR[ARMOUR.length - 1].name})`;
      const a = ARMOUR[p.armour];
      return `Pharmacy 36.6: body armour ${a.name}: ${a.max} health, ${Math.round((1 - a.take) * 100)}% less damage`;
    }
    if (this.isGun(s.item) && w.owned[s.item]) {
      const d = DEFS[s.item], what = d.saw ? 'fuel' : d.bow ? 'arrows' : d.launcher ? 'missiles' : 'ammo';
      if (d.laser) return `You have the ${d.short}: its battery charges by itself`;
      if (this.full(s.item)) return `You have the ${d.short}, full of ${what}`;
      return `${what[0].toUpperCase()}${what.slice(1)} for your ${d.short}: filled up`;
    }
    if (s.item === 'stamina' && p.speedMul > 1) return 'Format Fit: already done';
    return s.label;
  }

  // a gun you have, bought again where you got it: filled up (its ammo, arrows, missiles or fuel),
  // for less than the ammo crates charge for everything
  refillCost(item) {
    const d = DEFS[item];
    return !d || d.melee || d.laser ? null : Math.min(600, Math.max(150, Math.round(d.price * 0.2 / 50) * 50));
  }
  full(item) {
    const w = this.g.weapons, a = w.owned[item], d = DEFS[item];
    return !a || d.laser || (a.mag >= d.mag && a.reserve >= w.reserveCap(item));
  }

  tryBuy(s) {
    const g = this.g, w = g.weapons;
    const cost = this.cost(s);
    if (cost == null) return;
    if (this.points < cost) { g.audio.play('empty'); return; }
    // co-op: points are kept by the host; it says yes (buyOk) or no
    if (g.mode === 'client') { g.net.buy(this.stations.indexOf(s), cost, !!(this.isGun(s.item) && w.owned[s.item]), w.current); return; }
    this.addPoints(-cost, true);
    this.bought(s.item, { w: w.current, refill: this.isGun(s.item) && !!w.owned[s.item] });
    if (s.item === 'double') this.g.net?.teamDouble();
  }

  // what a purchase does for the local player (on a client, once the host said yes)
  bought(item, m = {}) {
    const g = this.g, w = g.weapons;
    g.audio.play('buy');
    if (this.isGun(item)) { if (m.refill) w.refill(item); else w.give(item); }
    else if (item === 'ammo') w.refillAll();
    else if (item === 'upgrade') {
      const k = m.w || w.current;
      w.upgrade(k);
      g.hud.banner(`${DEFS[k].short} ${UPGRADES[w.level(k) - 1].name}`, `${Math.round(UPGRADES[w.level(k) - 1].dmg * 100 - 100)}% more damage, more ammo`);
    } else if (item === 'armour') {
      g.player.setArmour(g.player.armour + 1);
      const a = ARMOUR[g.player.armour - 1];
      g.hud.banner(`Body armour ${a.name}`, `${a.max} health, ${Math.round((1 - a.take) * 100)}% less damage from every hit`);
    }
    else if (item === 'stamina') g.player.speedMul = 1.18;
    else if (item === 'double') this.double = 30;
  }

  // co-op: each player has their own points and tally; the local player's live on the director
  tally(slot) {
    if (slot === (this.g.localSlot ?? 0)) return this;
    let t = this.team.get(slot);
    if (!t) this.team.set(slot, t = { points: 500, kills: 0, headshots: 0, deaths: 0, frags: 0 });
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
  get finalWave() { return this.g.pvp && this.g.pvp.on ? 0 : FINAL_WAVE; }

  // ---- waves ----
  // bigger teams face more of them, a little tougher (co-op)
  // A match on the clock (PvP) paces them to get about ten waves into fifteen minutes: smaller
  // waves, sent in faster, a shorter break between them. In PvP the zombies are just about, not
  // the point: fewer of them. (Co-op has no clock: waves as alone, grown for the team.)
  get quick() { return this.g.mode === 'host' && !!this.g.rules?.timed; }
  get crowd() { return this.g.pvp && this.g.pvp.on ? 0.5 : 1; }
  waveCount(w) {
    if (this.quick) return Math.max(4, Math.round((5 + w * 2.2 + w * w * 0.12) * (1 + 0.45 * (this.teamSize - 1)) * this.crowd));
    return Math.round((6 + w * 3.2 + w * w * 0.32) * (1 + 0.6 * (this.teamSize - 1)));
  }
  maxAlive(w) {
    const phone = this.g.quality && this.g.quality.phone ? 0.75 : 1;   // (a phone running the horde: fewer at once)
    if (this.quick) return Math.round(Math.min(10 + w * 2.5, 30) * (1 + 0.4 * (this.teamSize - 1)) * (this.crowd < 1 ? 0.6 : 1) * phone);
    return Math.round(Math.min(8 + w * 2, 28) * (1 + 0.4 * (this.teamSize - 1)) * phone);
  }
  spawnGap(w) { return this.quick ? Math.max(0.3, 1.4 - w * 0.1) : Math.max(0.35, 2.2 - w * 0.14); }
  // a zombie's health: 150 at wave 1, the same step up every wave to 1000 at the last (wave 10);
  // past it (a PvP match runs on) 9% more a wave. A bigger team's are a little tougher.
  health(w) {
    const h = w <= FINAL_WAVE ? 150 + (1000 - 150) * (w - 1) / (FINAL_WAVE - 1) : 1000 * Math.pow(1.09, w - FINAL_WAVE);
    return h * (1 + 0.1 * (this.teamSize - 1));
  }
  damage(w) { return 34 + Math.min(26, w * 2); }

  startWave() {
    this.wave++;
    const w = this.wave, last = w === this.finalWave;
    this.state = 'active';
    // Every wave harder than the one before, for sure (nothing left to chance): the dogs every wave
    // from 3 (a wolf leads them from 6, a second pack from 7), the crows every wave from 4; and every
    // fifth wave a giant (two from wave 15, three from 25) in place of twelve of the others, so the
    // wave after it is harder still.
    this.packs = [];
    if (w >= 3) this.packs.push({ at: 0.25 + Math.random() * 0.3, kind: 'dogs', n: Math.min(6, 2 + Math.floor(w / 3)) });
    if (w >= 7) this.packs.push({ at: 0.6 + Math.random() * 0.25, kind: 'dogs', n: Math.min(6, 2 + Math.floor(w / 4)) });
    if (w >= 4) this.packs.push({ at: 0.35 + Math.random() * 0.4, kind: 'crows', n: Math.min(8, 3 + Math.floor(w / 4)) });
    const giants = w % 5 === 0 ? 1 + Math.floor((w - 5) / 10) : 0;
    if (giants) this.packs.push({ at: 0.15 + Math.random() * 0.15, kind: 'giant', n: giants });
    this.toSpawn = this.total = Math.max(4, this.waveCount(w) - 12 * giants);
    this.spawnT = 1.5;
    const g = this.g;
    g.hud.finalWave = this.finalWave;
    g.hud.wave(w);
    const note = last ? 'The last one: hold out through it and Green Diamond is yours'
      : w === 1 ? 'They’re coming through the gates' : w === 3 ? 'Listen for the dogs'
        : w === 4 ? 'Watch the sky, and the leapers: they pounce' : w === 5 ? 'Spitters: keep moving, stay out of the acid'
          : w === 6 ? 'Riot police: the shield stops bullets. Shoot their legs, or get round them' : '';
    g.hud.banner(last ? 'Final wave' : `Wave ${w}`, note);
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
      // prefer spawns about 30 m away on foot (a match on the clock: nearer), out of sight
      const want = this.quick ? 22 : 30;
      const w = (seen ? 0.08 : 1) * (Math.exp(-(((path - want) / 20) ** 2)) + 0.03);
      cands.push([w, x, z, s.kind, s.f]);
    }
    if (!cands.length) return null;
    const tot = cands.reduce((a, c) => a + c[0], 0);
    let r = Math.random() * tot;
    for (const c of cands) { r -= c[0]; if (r <= 0) return c; }
    return cands[cands.length - 1];
  }

  // What kind of zombie comes next: walkers early, then runners, crawlers, bloaters, screamers,
  // leapers, brutes, spitters and riot police.
  pickType(w) {
    const z = this.g.zombies;
    const table = [
      ['runner', THREE.MathUtils.clamp((w - 2) * 0.1, 0, 0.36)],
      ['crawler', w >= 2 ? 0.08 : 0],
      ['bloater', w >= 3 && z.count('bloater') < 3 ? 0.07 : 0],
      ['screamer', w >= 4 && z.count('screamer') < 1 ? 0.05 : 0],
      ['brute', w >= 5 && z.count('brute') < 2 + Math.floor(w / 8) ? Math.min(0.1, 0.03 + (w - 5) * 0.01) : 0],
      ['leaper', w >= 4 && z.count('leaper') < 2 + Math.floor(w / 6) ? Math.min(0.09, 0.05 + (w - 4) * 0.008) : 0],
      ['spitter', w >= 5 && z.count('spitter') < 2 + Math.floor(w / 8) ? Math.min(0.08, 0.045 + (w - 5) * 0.006) : 0],
      ['riot', w >= 6 && z.count('riot') < 2 + Math.floor(w / 6) ? Math.min(0.08, 0.04 + (w - 6) * 0.008) : 0],
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
    if (pack.kind === 'giant') {
      // (at ground level: it wouldn't fit in the car parks)
      for (let i = 0; i < pack.n; i++) {
        let s = null;
        for (let k = 0; k < 12 && (!s || s[4] != null); k++) s = this.pickSpawn();
        if (!s || s[4] != null) continue;
        g.zombies.spawn(s[1], s[2], { type: 'giant', hp: this.health(w), damage: this.damage(w) });
      }
      g.hud.banner(pack.n > 1 ? 'Giants' : 'A giant', 'It throws cars about: keep your distance');
      g.net?.banner?.(pack.n > 1 ? 'Giants' : 'A giant', 'It throws cars about: keep your distance');
      g.audio.play('roar', { vol: 1.2 });
      return;
    }
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

  // How much harder they are now than on wave 1 (their health), eased: kills pay that much more.
  toughness() { return Math.pow(this.health(Math.max(1, this.wave)) / this.health(1), 0.6); }

  onKill(zb, head, weapon, slot = this.g.localSlot ?? 0) {
    const t = this.tally(slot);
    t.kills++;
    if (head) t.headshots++;
    const bonus = KILL_BONUS[zb.type] ?? (zb.species === 'crow' ? 10 : 0);
    // (wave 1: 60 a kill, 100 a headshot; wave 10: about 2.4 times that; wave 20: about 4 times)
    const pay = ((weapon === 'knife' ? 130 : head ? 100 : 60) + bonus) * this.toughness();
    this.addPoints(Math.round(pay / 5) * 5, false, slot);
    // power-up drop (a giant always leaves one, and a gun)
    if (zb.def.boss) {
      const g = this.g;
      g.hud.banner('Giant down', '');
      g.net?.banner?.('Giant down', '');
      this.drop(zb.pos);
      g.pickups?.spawn('gun', { x: zb.pos.x + 1.2, y: zb.pos.y, z: zb.pos.z });
    } else if (zb.species !== 'crow' && Math.random() < 0.035 && this.drops.length < 3) this.drop(zb.pos);
  }

  onHit(zb, killed, head, slot = this.g.localSlot ?? 0) { if (!killed) this.addPoints(Math.round(10 * Math.sqrt(this.toughness())), false, slot); }

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
    if (this.state === 'won') return;
    if (a && !w.def.melee && !w.def.bow && a.mag + a.reserve <= w.def.mag * 1.5 && !this.ammoHinted?.[w.current]) {
      (this.ammoHinted ||= {})[w.current] = true;
      g.hud.notice('Low on ammo: grab an ammo can, press F at an ammo crate (on the map), or refill where you bought the gun');
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
      this.spawnT = this.spawnGap(this.wave) * (0.6 + Math.random() * 0.8);
    }
    const progress = 1 - this.toSpawn / (this.total || 1);
    for (let i = this.packs.length - 1; i >= 0; i--) if (progress >= this.packs[i].at) { this.spawnPack(this.packs[i]); this.packs.splice(i, 1); }
    if (this.roofT > 15 && this.wave >= 2) {
      this.crowT -= dt;
      if (this.crowT <= 0 && g.zombies.count('crow') < 8) { this.crowT = 18; this.spawnCrows(2 + Math.floor(Math.random() * 2)); }
    } else this.crowT = Math.min(this.crowT, 4);
    // the last few: they hurry (and the ones lost far away are brought nearer sooner)
    g.zombies.hurry = this.toSpawn <= 0 && !this.packs.length && g.zombies.alive <= 4;
    if (this.toSpawn <= 0 && !this.packs.length && g.zombies.alive === 0) {
      // the last one cleared: won (co-op: the host ends the match for everyone)
      if (this.finalWave && this.wave >= this.finalWave) { this.state = 'won'; g.audio.play('waveEnd', { vol: 0.6 }); g.onVictory?.(); return; }
      this.state = 'intermission';
      this.timer = this.quick ? 7 : 11;
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
      const cost = this.cost(s), what = this.offer(s);
      if (cost == null) g.hud.prompt(what, 3);
      else {
        g.hud.prompt(`Press <b>F</b> — ${what} <b>[${cost}]</b>${this.points < cost ? ' <span style="color:#ff6b6b">not enough points</span>' : ''}`, 3);
        if (g.input.hit('KeyF') && g.state === 'playing' && !g.training?.open) { g.input.pressed.delete('KeyF'); this.tryBuy(s); }
      }
    }
    for (const m of this.stationMeshes) m.rotation.z += dt;
  }

  markers() {
    const TAG = { upgrade: 'Upgrade', armour: 'Armour', stamina: 'Speed', double: '2× points', ammo: 'Ammo' };
    const m = this.stations.map((s) => ({ x: s.x, z: s.z, color: '#ffb347', station: true, icon: stationIcon(s.item), tag: (TAG[s.item] || DEFS[s.item]?.short || '') + (s.roof ? ' (roof)' : s.y < -1 ? ' (car park)' : '') }));
    for (const d of this.drops) m.push({ x: d.mesh.position.x, z: d.mesh.position.z, color: '#e0e6ff', icon: 'powerup' });
    return m;
  }
}

