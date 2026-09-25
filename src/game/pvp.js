import * as THREE from 'three';
import { pointInPoly } from '../world/geom.js';

// Players against players (the host decides everything, like it does for the zombies).
//
// The host picks the rules in the lobby: everyone for themselves, or two teams it arranges; the
// zombies around or not; a time limit and a number of kills to win. Here: who can hurt whom,
// every player's hit spheres (where the shooter saw them: lag compensation), the damage, who gets
// the kill, and where you come back after dying.

export const PVP_DMG = 0.5;           // (the guns are tuned for zombies: half that against a player)
export const PVP_RESPAWN = 4;         // seconds dead before you're back
export const TEAM_NAMES = ['Red', 'Blue'];
export const TEAM_CSS = ['#ff4d4d', '#4da3ff'];
export const TEAM_HEX = [0xe03a3a, 0x2f7fe0];
const SHIELD = 2;                     // just back: untouchable for a moment
const CREDIT_S = 8;                   // a kill counts for whoever hurt you in the last few seconds
const HIST = 32;

export const isPvp = (rules) => !!rules && (rules.mode === 'ffa' || rules.mode === 'teams');
export const teamOf = (rules, slot) => (rules && rules.mode === 'teams' ? (rules.teams && rules.teams[slot] != null ? rules.teams[slot] : slot % 2) : -1);

export class PvP {
  constructor(game) {
    this.g = game;
    this.hist = new Map();            // slot -> position history (host)
    this.tmp = new THREE.Vector3();
  }

  get rules() { return this.g.rules; }
  get on() { return isPvp(this.g.rules); }
  team(slot) { return teamOf(this.g.rules, slot); }
  // (in teams, your team can't hurt you; your own grenade can)
  foes(a, b) { return this.on && a !== b && (this.rules.mode !== 'teams' || this.team(a) !== this.team(b)); }
  players() { return this.g.players || [this.g.player]; }
  bySlot(slot) { return this.players().find((p) => p.slot === slot) || null; }

  // ---- lag compensation: where everyone was, tick by tick (host) ----
  record(tick) {
    if (!this.on) return;
    for (const p of this.players()) {
      let h = this.hist.get(p.slot);
      if (!h) this.hist.set(p.slot, h = new Float32Array(HIST * 5).fill(-1));
      const i = (tick % HIST) * 5;
      h[i] = tick; h[i + 1] = p.pos.x; h[i + 2] = p.pos.y; h[i + 3] = p.pos.z; h[i + 4] = p.crouch || 0;
    }
  }

  // where p was at `tick` (fractional), or where it is
  at(p, tick) {
    const h = tick != null && this.hist.get(p.slot);
    if (h) {
      const t0 = Math.floor(tick), f = tick - t0, a = (t0 % HIST) * 5, b = ((t0 + 1) % HIST) * 5;
      if (h[a] === t0) {
        if (f > 0 && h[b] === t0 + 1) return { x: h[a + 1] + (h[b + 1] - h[a + 1]) * f, y: h[a + 2] + (h[b + 2] - h[a + 2]) * f, z: h[a + 3] + (h[b + 3] - h[a + 3]) * f, c: h[a + 4] + (h[b + 4] - h[a + 4]) * f };
        return { x: h[a + 1], y: h[a + 2], z: h[a + 3], c: h[a + 4] };
      }
    }
    return { x: p.pos.x, y: p.pos.y, z: p.pos.z, c: p.crouch || 0 };
  }

  // head, chest, belly, hips, knees; feet at y (crouched: about two thirds of the height)
  spheres(x, y, z, crouch) {
    const k = 1 - 0.36 * (crouch || 0);
    return [
      [x, y + 1.63 * k, z, 0.13, true], [x, y + 1.34 * k, z, 0.23, false], [x, y + 1.03 * k, z, 0.22, false],
      [x, y + 0.72 * k, z, 0.2, false], [x, y + 0.38 * k, z, 0.17, false],
    ];
  }

  // A ray against the shooter's foes on foot (as the shooter saw them): {p, t, point, head}
  raycast(o, d, range, slot, tick = null) {
    if (!this.on) return null;
    let best = null;
    for (const p of this.players()) {
      if (p.dead || p.vehicle || !this.foes(slot, p.slot)) continue;
      const q = this.at(p, tick);
      const along = (q.x - o.x) * d.x + (q.z - o.z) * d.z;
      if (along < -1 || along > range + 1) continue;
      let mine = null, headT = Infinity;
      for (const [cx, cy, cz, r, head] of this.spheres(q.x, q.y, q.z, q.c)) {
        const lx = o.x - cx, ly = o.y - cy, lz = o.z - cz;
        const b = lx * d.x + ly * d.y + lz * d.z, c = lx * lx + ly * ly + lz * lz - r * r, disc = b * b - c;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        if (t < 0 || t > range) continue;
        if (head) headT = Math.min(headT, t);
        if (!mine || t < mine.t) mine = { p, t, head };
      }
      if (mine && !mine.head && headT < mine.t + 0.2) mine.head = true;
      if (mine && (!best || mine.t < best.t)) best = mine;
    }
    if (best) best.point = new THREE.Vector3(o.x + d.x * best.t, o.y + d.y * best.t, o.z + d.z * best.t);
    return best;
  }

  // A player hurt by another (or by their own grenade): the spawn shield, armour, the kill credit.
  // Returns true if it killed them.
  hurt(victim, amount, by, how, point = null, dir = null) {
    const g = this.g;
    if (!victim || victim.dead || amount <= 0) return false;
    if (by != null && by !== victim.slot && !this.foes(by, victim.slot)) return false;
    if (victim.shieldT > 0) return false;
    if (by != null) victim.lastHit = { by, how, t: g.time || 0 };
    const fx = point && dir ? point.x - dir.x * 3 : victim.pos.x, fz = point && dir ? point.z - dir.z * 3 : victim.pos.z;
    if (!victim.damage(amount, fx, fz)) { if (victim.blocks(fx, fz)) g.zombies.onBlocked?.(victim, fx, fz); return false; }
    if (point) {
      g.effects.bloodBurst(point, dir || this.tmp.set(0, 0, 1));
      g.net?.blood?.('blood', point, dir);
      g.audio.play('flesh', { pos: point, vol: 0.8 });
    }
    g.zombies.onPlayerHit?.(null, victim, amount, fx, fz);
    return victim.dead;
  }

  // who gets the kill (a slot), or -1: the zombies, or yourself
  killer(victim) {
    const h = victim.lastHit, g = this.g;
    if (!h || h.by == null || h.by === victim.slot || (g.time || 0) - h.t > CREDIT_S) return -1;
    return this.foes(h.by, victim.slot) ? h.by : -1;
  }

  // Where to come back: somewhere open and on the ground, as far from your foes as it gets (and not
  // among zombies); in teams, the nearer your team the better.
  spawnSpot(slot) {
    const g = this.g, L = g.level;
    const foes = this.players().filter((p) => !p.dead && this.foes(slot, p.slot));
    const mates = this.players().filter((p) => !p.dead && p.slot !== slot && !this.foes(slot, p.slot));
    let best = null, bs = -Infinity;
    for (let k = 0; k < 60; k++) {
      const s = this.randomGround();
      if (!s) continue;
      const df = foes.length ? Math.min(...foes.map((p) => Math.hypot(p.pos.x - s.x, p.pos.z - s.z))) : 60;
      const dm = mates.length ? Math.min(...mates.map((p) => Math.hypot(p.pos.x - s.x, p.pos.z - s.z))) : 0;
      let zs = 0;
      for (const zb of g.zombies.list) if (zb.state !== 'dead' && Math.hypot(zb.pos.x - s.x, zb.pos.z - s.z) < 10) zs++;
      const score = Math.min(df, 70) - zs * 12 - (mates.length && this.rules.mode === 'teams' ? Math.max(0, dm - 25) * 0.6 : 0);
      if (score > bs) { bs = score; best = s; }
    }
    return best || { x: 4, y: g.hm.atWorld(4, 10), z: 10 };
  }

  randomGround() {
    const g = this.g, poly = g.level.play.outer;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let k = 0; k < 100; k++) {
      const mx = x0 + Math.random() * (x1 - x0), my = y0 + Math.random() * (y1 - y0);
      if (!pointInPoly(mx, my, poly)) continue;
      const x = mx, z = -my;
      if (!g.nav.walkable(x, z) || !g.nav.walkable(x + 1.2, z) || !g.nav.walkable(x - 1.2, z) || !g.nav.walkable(x, z + 1.2) || !g.nav.walkable(x, z - 1.2)) continue;
      if (g.underground.at(x, z, g.hm.atWorld(x, z) + 0.1)) continue;
      const y = g.hm.atWorld(x, z);
      if (g.colliders.resolve({ x, z }, 0.5, y + 0.3, y + 1.7, 1)) continue;
      return { x, y, z };
    }
    return null;
  }

  // the start: in teams, each team together at its own end; everyone for themselves, spread out
  startSpots(slots) {
    const out = new Map(), g = this.g;
    if (this.rules.mode === 'teams') {
      // two bases far apart: the pool courtyard, and the open ground farthest from it
      const a = { x: 4, y: g.hm.atWorld(4, 10), z: 10 };
      let b = null, bd = 0;
      for (let k = 0; k < 80; k++) { const s = this.randomGround(); if (s && Math.hypot(s.x - a.x, s.z - a.z) > bd) { bd = Math.hypot(s.x - a.x, s.z - a.z); b = s; } }
      const bases = [a, b || a];
      const n = [0, 0];
      for (const slot of slots) {
        const t = this.team(slot), base = bases[t], i = n[t]++;
        out.set(slot, this.near(base, i));
      }
      return out;
    }
    const taken = [];
    for (const slot of slots) {
      let best = null, bs = -1;
      for (let k = 0; k < 50; k++) {
        const s = this.randomGround();
        if (!s) continue;
        const d = taken.length ? Math.min(...taken.map((q) => Math.hypot(q.x - s.x, q.z - s.z))) : 100;
        if (d > bs) { bs = d; best = s; }
      }
      const s = best || this.near({ x: 4, y: g.hm.atWorld(4, 10), z: 10 }, taken.length);
      taken.push(s);
      out.set(slot, s);
    }
    return out;
  }

  // a free spot next to `base` (the i-th one around it)
  near(base, i) {
    const g = this.g;
    for (let k = 0; k < 30; k++) {
      const a = i * 1.9 + k * 2.39, d = i === 0 && k === 0 ? 0 : 1.6 + ((k + i) % 6) * 0.5;
      const x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d, y = g.groundAt(x, z, base.y + 0.5);
      if (Math.abs(y - base.y) > 0.6 || g.colliders.resolve({ x, z }, 0.4, y + 0.3, y + 1.7, 1)) continue;
      return { x, y, z };
    }
    return base;
  }

  // facing: towards the middle of things
  faceFrom(s) { return Math.atan2(-(4 - s.x), -(10 - s.z)); }

  // every tick (host): the respawn shield wears off
  tick(dt) { for (const p of this.players()) if (p.shieldT > 0) p.shieldT = Math.max(0, p.shieldT - dt); }

  static get SHIELD() { return SHIELD; }
}
