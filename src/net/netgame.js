import * as THREE from 'three';
import { Player, ARMOUR } from '../game/player.js';
import { DEFS, UPGRADES } from '../game/weapons.js';
import {
  TICK, TICK_MS, SNAP_EVERY, INPUT_REDUNDANCY, MAX_SNAP_ZOMBIES, MSG, PF, SF, VF, WEAPONS,
  TickInput, bitsFrom, encodeInputs, decodeInputs, encodeSnapshot, decodeSnapshot, kindOf,
} from './protocol.js';
import { Avatars } from './avatars.js';
import { URLFLAGS } from '../config.js';

// Co-op multiplayer, host-authoritative, over the WebRTC links of net/session.js.
//
// The host runs the whole game: its own player, the zombies, the waves, the loot, and a copy of
// every client's player moved by that client's inputs. It checks every hit (rewinding the zombies
// to what the shooter saw) and sends each client a snapshot 30 times a second.
// A client moves its own player straight away (prediction), sends its inputs every tick, and
// when a snapshot shows the host disagrees, takes the host's position and replays the inputs the
// host hasn't seen yet (reconciliation, blended in smoothly). Zombies and the other players are
// drawn 100 ms in the past, between two snapshots (interpolation).

export const MATCH_MS = 10 * 60 * 1000;
export const RESPAWN_S = 15;
const INTERP_MS = 100;
const MAX_REWIND_TICKS = 18;       // lag compensation reaches back at most 300 ms
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const r3 = (v) => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
const r4 = (v) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];

// a spot to (re)spawn: next to a teammate if one is standing, else the courtyard by the pool
export function spawnSpot(g, near, i = 0) {
  const base = near ? { x: near.pos.x, z: near.pos.z, y: near.pos.y } : { x: 4, z: 10, y: null };
  for (let k = 0; k < 40; k++) {
    // the first player on the spot itself, the rest in a ring around it
    const a = i * 1.9 + k * 2.39, d = !near && i === 0 && k === 0 ? 0 : 1.7 + ((k + i) % 8) * 0.45;
    const x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d;
    const y = near ? g.groundAt(x, z, base.y + 0.5) : g.hm.atWorld(x, z);
    if (near && Math.abs(y - base.y) > 0.6) continue;
    if (g.colliders.resolve({ x, z }, 0.4, y + 0.3, y + 1.7, 1)) continue;
    if (!near && !g.nav.walkable(x, z)) continue;
    return { x, y, z };
  }
  return { x: base.x, y: near ? base.y : g.hm.atWorld(base.x, base.z), z: base.z };
}

function place(p, s, yaw) {
  p.pos.set(s.x, s.y, s.z);
  p.viewY = s.y;
  p.vel.set(0, 0, 0);
  p.onGround = true;
  if (yaw != null) { p.yaw = yaw; p.pitch = 0; }
}

// ======================================================================== host
// A client's player as the host runs it: a Player of its own, moved by the client's input ticks.
class Remote {
  constructor(g, id, slot, name) {
    this.id = id; this.slot = slot; this.name = name || `P${slot + 1}`;
    const p = this.player = new Player(new THREE.PerspectiveCamera(), g.hm, g.colliders);
    p.underground = g.underground; p.pools = g.player.pools; p.roofs = g.player.roofs;
    p.slot = slot; p.remote = this;
    this.queue = []; this.lastSeq = 0; this.gapT = 0;
    this.teleport = 0; this.weapon = 0; this.input = new TickInput();
    this.respawn = 0; this.wasDead = false;
  }

  push(cmds) {
    for (const c of cmds) {
      if (c.seq <= this.lastSeq || this.queue.some((q) => q.seq === c.seq)) continue;
      let i = this.queue.length;
      while (i > 0 && this.queue[i - 1].seq > c.seq) i--;
      this.queue.splice(i, 0, c);
    }
    if (this.queue.length > 90) this.queue.splice(0, this.queue.length - 90);
  }

  // one host tick: usually one of their ticks, more to catch up if they've queued up
  step(g) {
    let n = this.queue.length > 8 ? 3 : this.queue.length > 4 ? 2 : 1;
    while (n > 0 && this.queue.length) {
      const c = this.queue[0];
      if (this.lastSeq && c.seq !== this.lastSeq + 1 && ++this.gapT < 4) break;   // a lost tick: wait a moment for it
      this.queue.shift();
      this.gapT = 0;
      this.apply(g, c);
      n--;
    }
  }

  apply(g, c) {
    const p = this.player;
    this.lastSeq = c.seq;
    this.weapon = c.weapon;
    if (p.dead) return;
    if (c.stairs != null) g.stairs.applyCode(p, c.stairs);
    p.yaw = c.yaw; p.pitch = c.pitch; p.ads = c.ads;
    p.speedWeapon = DEFS[WEAPONS[c.weapon]]?.move ?? 1;
    p.update(TICK, this.input.set(c.bits), true);
    if (p.vehicle) g.vehicles.driveTick(p.vehicle, TICK, this.input);
  }
}

// a vehicle's state on the wire
const vehState = (v) => ({ x: +v.pos.x.toFixed(3), y: +v.pos.y.toFixed(3), z: +v.pos.z.toFixed(3), h: +v.heading.toFixed(4) });
const vehSnap = (v) => ({
  vid: v.vid, driver: v.driver, x: v.pos.x, y: v.pos.y, z: v.pos.z, heading: v.heading, speed: v.speed, steer: v.steer,
  vx: v.vel.x, vy: v.vel.y, vz: v.vel.z, tx: v.tilt.x, ty: v.tilt.y, lean: v.lean || 0, spin: v.spin || 0,
  flags: (v.fallen ? VF.fallen : 0) | (v.coasting ? VF.coasting : 0),
});

export class Host {
  constructor(game, session) {
    this.g = game; this.s = session;
    this.role = 'host';
    this.avatars = new Avatars(game);
    this.remotes = new Map();       // peer id -> Remote
    this.names = new Map();         // peer id -> name
    this.tick = 0; this.acc = 0;
    this.fx = [];                   // effects for everyone, sent with the next snapshot
    this.match = null;
    this.localRespawn = 0; this.localWasDead = false; this.localTeleport = 0;
    this.scoreT = 0;
    this.ready = new Set();         // clients whose game has loaded (they said hello)
    session.onGame = (id, kind, data) => this.onMessage(id, kind, data);
    session.onPeerOpen = (id) => this.onJoin(id);
    session.onPeerClose = (id) => this.onLeave(id);
    session.sendAll('rel', { t: 'who' });   // anyone already connected: say hello when you're loaded
  }

  get slot() { return this.s.slot ?? 0; }
  get inMatch() { return !!this.match; }

  // ---- lobby -> match ----
  start() {
    const g = this.g;
    if (this.match) g.resetMatch();
    g.localSlot = this.slot;
    this.match = { t0: performance.now(), dur: URLFLAGS.mptime ? URLFLAGS.mptime * 1000 : MATCH_MS, over: false };
    this.tick = 0; this.acc = 0;
    g.players = [g.player];
    // everyone in the courtyard by the pool, facing the gates
    place(g.player, spawnSpot(g, null, this.slot), -Math.PI / 2);
    // those still loading join as soon as they're ready (their hello), next to the team
    for (const id of this.s.peers.keys()) if (this.s.peers.get(id).open && this.ready.has(id)) this.addRemote(id);
    g.beginMatch('host');
    for (const r of this.remotes.values()) this.sendStart(r);
    this.teamChanged();
  }

  addRemote(id) {
    const g = this.g, slot = this.s.slotOfId(id);
    if (slot < 0 || this.remotes.has(id)) return this.remotes.get(id);
    const r = new Remote(g, id, slot, this.names.get(id));
    const living = (g.players || [g.player]).find((p) => !p.dead);
    // at the start everyone lines up by the pool; later arrivals turn up next to the team
    place(r.player, spawnSpot(g, g.mode === 'host' ? living : null, slot), -Math.PI / 2);
    this.remotes.set(id, r);
    g.players = [g.player, ...[...this.remotes.values()].map((q) => q.player)];
    g.zombies.targets = g.players;
    g.director.tally(slot);
    return r;
  }

  sendStart(r) {
    const g = this.g, d = g.director;
    this.s.sendTo(r.id, 'rel', {
      t: 'start', slot: r.slot, elapsed: performance.now() - this.match.t0, dur: this.match.dur,
      wave: d.wave, hour: g.hour, targetHour: g.targetHour ?? null, pos: r3(r.player.pos), yaw: r.player.yaw,
      pickups: g.pickups.list.map((it) => [it.id, it.kind, +it.x.toFixed(2), +it.y.toFixed(2), +it.z.toFixed(2), it.amount]),
      drops: d.drops.map((q) => [q.id, q.kind, q.mesh.position.x, q.mesh.position.y - 1, q.mesh.position.z]),
      team: this.teamList(), tick: this.tick,
      vehicles: g.vehicles.list.filter((v) => v.moved || v.driver != null || v.dmg > 0).map((v) => [v.vid, +v.pos.x.toFixed(3), +v.pos.y.toFixed(3), +v.pos.z.toFixed(3), +v.heading.toFixed(4), v.driver,
        Math.round(v.dmg), [...v.lost], v.dents || [], v.fallen ? v.fallSide : 0]),
    });
  }

  teamList() {
    const list = [{ slot: this.slot, name: this.names.get('host') || `P${this.slot + 1}`, host: true }];
    for (const r of this.remotes.values()) list.push({ slot: r.slot, name: r.name });
    return list.sort((a, b) => a.slot - b.slot);
  }

  teamChanged() {
    const team = this.teamList();
    this.g.hud.team?.(team);
    this.s.sendAll('rel', { t: 'team', team });
  }

  onJoin(id) {
    // a new player in the room: nothing until their game has loaded and they say hello
  }

  // a client is loaded and ready: if we're playing, in they come, next to the others
  onReady(id) {
    this.ready.add(id);
    this.g.netui?.render();
    if (!this.match || this.match.over) { this.teamChanged(); return; }
    const had = this.remotes.has(id);
    const r = this.addRemote(id);
    if (!r) return;
    this.sendStart(r);
    this.teamChanged();
    if (!had) this.g.hud.notice(`${r.name} joined`);
  }

  onLeave(id) {
    this.ready.delete(id);
    this.g.netui?.render();
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    this.avatars.remove(r.slot);
    if (r.player.vehicle) this.forceOut(r.player, r.slot, false);
    const g = this.g;
    g.players = [g.player, ...[...this.remotes.values()].map((q) => q.player)];
    g.zombies.targets = g.players;
    for (const zb of g.zombies.list) if (zb.target === r.player) zb.target = null;
    this.teamChanged();
    g.hud.notice(`${r.name} left`);
  }

  // ---- messages from clients ----
  onMessage(id, kind, data) {
    if (data instanceof ArrayBuffer) {
      if (kindOf(data) === MSG.INPUT) this.remotes.get(id)?.push(decodeInputs(data));
      return;
    }
    const m = data, g = this.g, r = this.remotes.get(id);
    if (m.t === 'hello') {
      this.names.set(id, String(m.name || '').slice(0, 16));
      if (r) r.name = this.names.get(id) || r.name;
      this.onReady(id);
      return;
    }
    if (!r || !this.match || this.match.over) return;
    const p = r.player;
    switch (m.t) {
      case 'shot': {
        if (p.dead || !Array.isArray(m.d)) return;
        // lag compensation: check the shot against the zombies where this player saw them
        const at = Math.max(this.tick - MAX_REWIND_TICKS, Math.min(this.tick, +m.rt || this.tick));
        const rewind = at < this.tick && !this.noRewind ? (zb) => g.zombies.rewindOffset(zb, at) : null;
        const dirs = m.d.slice(0, 12).map(v3).map((d) => d.normalize());
        const res = g.weapons.resolveShot(m.w, v3(m.o), dirs, r.slot, rewind, null, g.weapons.damageMult(m.w, r.slot, !!m.a));
        if (res.hit) this.s.sendTo(id, 'rel', { t: 'hit', k: res.kill, h: res.head });
        this.shotFx(r.slot, m.w, v3(m.o), dirs, id);
        break;
      }
      case 'melee': {
        if (p.dead) return;
        const res = g.weapons.meleeFrom(p, !!m.heavy, r.slot);
        if (res) this.s.sendTo(id, 'rel', { t: 'hit', k: res.killed, h: false });
        this.fx.push(['k', r.slot]);
        break;
      }
      case 'nade':
        if (p.dead) return;
        g.weapons.spawnGrenade(v3(m.p), v3(m.v), { by: r.slot, id: g.weapons.nextProjId(r.slot) });
        break;
      case 'arrow':
        if (p.dead) return;
        g.weapons.spawnArrow(v3(m.p), v3(m.v), { dmg: Math.min(+m.dmg || 0, DEFS.bow.dmg) * g.weapons.damageMult('bow', r.slot, !!m.a), pierce: m.pierce ? 1 : 0, by: r.slot, id: m.id });
        this.arrowFx(m.id, v3(m.p), v3(m.v), r.slot, id);
        break;
      case 'buy': this.buy(r, m); break;
      case 'enter': this.vehicleEnter(r, m.vid); break;
      case 'exit': this.vehicleExit(r); break;
      default: break;
    }
  }

  // ---- vehicles: the host says who sits where ----
  vehicleEnter(r, vid) {
    const vs = this.g.vehicles, p = r.player, v = vs.byVid(+vid);
    const no = (why) => this.s.sendTo(r.id, 'rel', { t: 'vehNo', why });
    if (!v || p.dead || p.vehicle) return no('');
    if (v.driver != null) return no('Someone is already in it');
    if (Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z) > 4) return no('');
    vs.occupy(v, p, r.slot);
    this.say({ t: 'veh', vid: v.vid, s: r.slot, st: vehState(v) });
  }

  vehicleExit(r) {
    const vs = this.g.vehicles, p = r.player, v = p.vehicle;
    if (!v) return;
    const spot = vs.exitSpot(v, p);
    if (!spot) { this.s.sendTo(r.id, 'rel', { t: 'vehNo', why: 'No room to get out here' }); return; }
    vs.release(v, p, spot);
    r.teleport++;
    this.say({ t: 'veh', vid: v.vid, s: -1, st: vehState(v), who: r.slot, out: [+spot.x.toFixed(3), +spot.y.toFixed(3), +spot.z.toFixed(3), +(spot.yaw || 0).toFixed(3)] });
  }

  // a crash, as the host worked it out: everyone dents and loses the same parts
  vehicleCrash(v, e) { this.say({ t: 'crash', vid: v.vid, e }); }

  // thrown off a bike (anyone's, ours included): out they fly, the bike slides on
  riderThrown(v, p, slot, thrown) {
    const r = [...this.remotes.values()].find((q) => q.slot === slot);
    if (r) r.teleport++;
    this.say({ t: 'veh', vid: v.vid, s: -1, st: vehState(v), who: slot, out: [+p.pos.x.toFixed(3), +p.pos.y.toFixed(3), +p.pos.z.toFixed(3), +p.yaw.toFixed(3)],
      thr: [+thrown.x.toFixed(2), +thrown.y.toFixed(2), +thrown.z.toFixed(2)], fall: v.fallSide });
  }

  // a vehicle nobody drives has stopped rolling: this is where it lies
  vehicleStopped(v) { this.say({ t: 'veh', vid: v.vid, s: -1, st: vehState(v), stop: 1, fall: v.fallen ? v.fallSide : 0 }); }

  // (our own getting in and out)
  vehicleTaken(v) { this.say({ t: 'veh', vid: v.vid, s: this.slot, st: vehState(v) }); }
  vehicleLeft(v) { this.say({ t: 'veh', vid: v.vid, s: -1, st: vehState(v), who: this.slot }); }

  // someone went down (or left) at the wheel: the vehicle stops where it is
  forceOut(p, slot, local) {
    const vs = this.g.vehicles, v = p.vehicle;
    if (!v) return;
    const spot = vs.exitSpot(v, p) || { x: v.pos.x, y: v.pos.y, z: v.pos.z };
    if (local) vs.dropControls(v);
    vs.release(v, p, spot);
    this.say({ t: 'veh', vid: v.vid, s: -1, st: vehState(v), who: slot, out: [spot.x, spot.y, spot.z, spot.yaw || 0] });
  }

  // a client buys something: the host keeps everyone's points (and their upgrades) and says yes or no
  buy(r, m) {
    const g = this.g, d = g.director, st = d.stations[m.i], t = d.tally(r.slot), w = g.weapons, p = r.player;
    if (!st) return;
    const no = (why = '') => this.s.sendTo(r.id, 'rel', { t: 'buyNo', why });
    let cost = st.cost;
    if (st.item === 'upgrade') {
      const l = w.level(m.w, r.slot);
      if (!w.canUpgrade(m.w) || l >= UPGRADES.length) return no('Fully upgraded');
      cost = UPGRADES[l].price;
    } else if (st.item === 'armour') {
      if (p.armour >= ARMOUR.length) return no('Best armour already');
      cost = ARMOUR[p.armour].price;
    } else if (d.isGun(st.item) && m.owned) return no('');
    if (st.item === 'stamina' && p.speedMul > 1) return no('Already bought');
    if (t.points < cost || Math.hypot(st.x - p.pos.x, st.z - p.pos.z) > 4) return no();
    t.points -= cost;
    if (st.item === 'upgrade') w.upgrade(m.w, r.slot);
    if (st.item === 'armour') p.setArmour(p.armour + 1);
    if (st.item === 'stamina') p.speedMul = 1.18;
    if (st.item === 'double') this.teamDouble();
    this.s.sendTo(r.id, 'rel', { t: 'buyOk', item: st.item, pts: t.points, w: m.w });
  }

  // ---- the fixed tick ----
  frame(dt) {
    if (!this.match) return;
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK && n < 8) { this.acc -= TICK; this.step(); n++; }
    if (n === 8) this.acc = 0;       // can't keep up: drop the backlog rather than spiral
    for (const r of this.remotes.values()) {
      const p = r.player;
      this.avatars.set({ slot: r.slot, x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch, crouch: p.crouch, dead: p.dead, health: p.health, maxHealth: p.maxHealth, name: r.name, hidden: !!p.vehicle }, dt, !p.vehicle);
    }
    this.avatars.update(dt);
  }

  step() {
    const g = this.g;
    this.tick++;
    for (const r of this.remotes.values()) r.step(g);
    g.worldStep(TICK);
    g.zombies.record(this.tick);
    this.lifeAndDeath(TICK);
    if (this.tick % SNAP_EVERY === 0) this.snapshot();
    this.scoreT -= TICK;
    if (this.scoreT <= 0) { this.scoreT = 1; this.scores(); }
  }

  msLeft() { return this.match ? Math.max(0, this.match.dur - (performance.now() - this.match.t0)) : 0; }

  // players going down, coming back, and the end of the match
  lifeAndDeath(dt) {
    const g = this.g, d = g.director;
    if (this.match.over) return;
    const all = [{ p: g.player, slot: this.slot, local: true }, ...[...this.remotes.values()].map((r) => ({ p: r.player, slot: r.slot, r }))];
    for (const e of all) {
      const was = e.local ? this.localWasDead : e.r.wasDead;
      if (e.p.dead && !was) {
        if (e.p.vehicle) this.forceOut(e.p, e.slot, !!e.local);
        d.tally(e.slot).deaths++;
        if (e.local) this.localRespawn = RESPAWN_S; else e.r.respawn = RESPAWN_S;
        this.say({ t: 'down', s: e.slot });
        g.onTeamDown?.(e.slot);
      }
      if (e.local) this.localWasDead = e.p.dead; else e.r.wasDead = e.p.dead;
      if (!e.p.dead) continue;
      const left = e.local ? (this.localRespawn -= dt) : (e.r.respawn -= dt);
      if (left > 0) continue;
      const near = all.find((q) => !q.p.dead);
      if (!near) continue;
      const spot = spawnSpot(g, near.p, e.slot);
      place(e.p, spot, near.p.yaw);
      e.p.dead = false; e.p.health = e.p.maxHealth;
      if (e.local) { this.localWasDead = false; this.localTeleport++; } else { e.r.wasDead = false; e.r.teleport++; e.r.queue.length = 0; }
      this.say({ t: 'up', s: e.slot });
      g.onTeamUp?.(e.slot);
    }
    if (all.every((e) => e.p.dead)) this.end(false);
    else if (this.msLeft() <= 0) this.end(true);
  }

  end(win) {
    const g = this.g, d = g.director;
    this.match.over = true;
    const stats = this.teamList().map((t) => {
      const q = d.tally(t.slot);
      return { slot: t.slot, name: t.name, kills: q.kills, heads: q.headshots, deaths: q.deaths, points: q.points };
    });
    const msg = { t: 'over', win, wave: d.wave, stats };
    this.s.sendAll('rel', msg);
    g.endMatch(msg);
  }

  // ---- what goes out ----
  playerState(p, slot, teleport, weapon, respawn) {
    return {
      slot, flags: (p.dead ? PF.dead : 0) | (p.onGround ? PF.onGround : 0) | (p.sprinting ? PF.sprint : 0) | (p.inWater ? PF.inWater : 0) | (p.roof ? PF.roof : 0) | (p.vehicle ? PF.vehicle : 0),
      x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: p.vel.x, vy: p.vel.y, vz: p.vel.z, yaw: p.yaw, pitch: p.pitch,
      crouch: p.crouch, ads: p.ads, health: p.health, maxHealth: p.maxHealth, weapon, teleport, speedMul: p.speedMul, respawn,
    };
  }

  snapshot() {
    const g = this.g, d = g.director;
    const players = [this.playerState(g.player, this.slot, this.localTeleport, WEAPONS.indexOf(g.weapons.current), this.localRespawn)];
    for (const r of this.remotes.values()) players.push(this.playerState(r.player, r.slot, r.teleport, r.weapon, r.respawn));
    const all = g.zombies.list.map((zb) => g.zombies.netState(zb));
    const vehicles = g.vehicles.list.filter((v) => v.driver != null || v.coasting).map(vehSnap);
    const flags = (d.state === 'intermission' ? SF.intermission : 0) | (this.match.over ? SF.over : 0);
    for (const r of this.remotes.values()) {
      let zs = all;
      if (all.length > MAX_SNAP_ZOMBIES) {
        const p = r.player.pos;
        zs = [...all].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, MAX_SNAP_ZOMBIES);
      }
      const buf = encodeSnapshot({ tick: this.tick, ack: r.lastSeq, msLeft: this.msLeft(), wave: d.wave, flags, players, zombies: zs, vehicles });
      this.s.sendTo(r.id, 'unrel', buf);
    }
    if (this.fx.length) { this.s.sendAll('unrel', { t: 'fx', l: this.fx }); this.fx = []; }
  }

  scores() {
    const d = this.g.director;
    const s = this.teamList().map((t) => { const q = d.tally(t.slot); return [t.slot, q.points, q.kills, q.headshots, q.deaths]; });
    this.s.sendAll('rel', { t: 'score', s });
    this.g.hud.scores?.(s);
  }

  // effects the clients should see
  blood(kind, p, dir) {
    this.fx.push([kind === 'feathers' ? 'f' : kind === 'bile' ? 'g' : 'b', +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), dir ? +dir.x.toFixed(2) : 0, dir ? +dir.y.toFixed(2) : 0, dir ? +dir.z.toFixed(2) : 0]);
  }

  shotFx(slot, w, o, dirs, except = null) {
    const ev = ['s', slot, WEAPONS.indexOf(w), ...r3(o), ...dirs.slice(0, 9).flatMap(r4)];
    if (except) { for (const [id, p] of this.s.peers) if (id !== except) p.send('unrel', JSON.stringify({ t: 'fx', l: [ev] })); }
    else this.fx.push(ev);
    if (slot !== this.slot) this.avatars.flash(slot);
    if (slot !== this.slot) this.g.audio.play(DEFS[w]?.sound || 'rifle', { pos: o, vol: (DEFS[w]?.vol ?? 0.9) * 0.9, rate: DEFS[w]?.rate ?? 1 });
  }

  arrowFx(id, p, v, slot, except = null) {
    const m = { t: 'arrow', id, p: r3(p), v: r3(v), s: slot };
    for (const [pid, peer] of this.s.peers) if (pid !== except) peer.send('rel', JSON.stringify(m));
  }

  arrowGone(id) { this.s.sendAll('rel', { t: 'arrowGone', id }); }
  nadeFx(id, p, v) { this.s.sendAll('rel', { t: 'nade', id, p: r3(p), v: r3(v) }); }
  boom(x, y, z, r, src) { this.s.sendAll('rel', { t: 'boom', x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), r, src }); }
  hitFeedback(slot, killed, head) { const r = this.bySlot(slot); if (r) this.s.sendTo(r.id, 'rel', { t: 'hit', k: killed, h: head }); }
  pointsFeed(slot, n) { const r = this.bySlot(slot); if (r) this.s.sendTo(r.id, 'rel', { t: 'pts', n }); }
  hurt(p, amount, x, z) { const r = p.remote; if (r) this.s.sendTo(r.id, 'rel', { t: 'hurt', a: +amount.toFixed(1), x: +x.toFixed(2), z: +z.toFixed(2) }); }
  wave(w, note) { this.say({ t: 'wave', w, note }); }
  waveEnd(w) { this.say({ t: 'waveEnd', w }); }
  notice(text) { this.say({ t: 'notice', text }); }
  teamDouble() { this.g.director.double = 30; this.say({ t: 'double' }); }
  pickupAdd(it) { this.say({ t: 'pk+', l: [[it.id, it.kind, +it.x.toFixed(2), +it.y.toFixed(2), +it.z.toFixed(2), it.amount]] }); }
  pickupGone(it, slot) { this.say({ t: 'pk-', id: it.id, s: slot, k: it.kind, a: it.amount }); }
  dropFx(id, kind, x, y, z) { this.say({ t: 'dr+', id, k: kind, p: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)] }); }
  dropGone(id, kind, slot) { this.say({ t: 'dr-', id, k: kind, s: slot }); }
  say(m) { if (this.match) this.s.sendAll('rel', m); }
  bySlot(slot) { for (const r of this.remotes.values()) if (r.slot === slot) return r; return null; }

  // the stats for the host's own HUD (the team panel)
  teamStates() {
    const g = this.g, list = [{ slot: this.slot, health: g.player.health, maxHealth: g.player.maxHealth, dead: g.player.dead, respawn: this.localRespawn, pos: g.player.pos, yaw: g.player.mapYaw, me: true }];
    for (const r of this.remotes.values()) list.push({ slot: r.slot, health: r.player.health, maxHealth: r.player.maxHealth, dead: r.player.dead, respawn: r.respawn, pos: r.player.pos, yaw: r.player.mapYaw, name: r.name });
    return list;
  }

  get localRespawnLeft() { return this.localRespawn; }
  leave() { this.match = null; }
}

// ======================================================================== client
export class Client {
  constructor(game, session) {
    this.g = game; this.s = session;
    this.role = 'client';
    this.avatars = new Avatars(game);
    this.match = null;
    this.seq = 0; this.hist = [];
    this.acc = 0; this.jump = false;
    this.input = new TickInput();
    this.snaps = [];
    this.offset = null;
    this.smooth = new THREE.Vector3();
    this.prevPos = new THREE.Vector3(); this.prevViewY = 0;
    this.renderPos = new THREE.Vector3();
    this.teleport = -1;
    this.team = [];
    this.msLeft = MATCH_MS;
    this.pendingStairs = null;
    this.names = new Map();
    this.vstates = new Map();       // other players' vehicles: vid -> recent states
    session.onGame = (id, kind, data) => this.onMessage(kind, data);
    session.sendTo(session.hostId, 'rel', { t: 'hello', name: game.playerName || '' });
  }

  get inMatch() { return !!this.match; }
  get slot() { return this.s.slot ?? 1; }

  onMessage(kind, data) {
    if (data instanceof ArrayBuffer) {
      if (kindOf(data) === MSG.SNAP && this.match) this.onSnapshot(decodeSnapshot(data));
      return;
    }
    const m = data, g = this.g;
    switch (m.t) {
      case 'start': this.begin(m); break;
      case 'who': this.s.sendTo(this.s.hostId, 'rel', { t: 'hello', name: this.g.playerName || '' }); break;
      case 'team': this.team = m.team; g.hud.team?.(m.team); break;
      case 'fx': if (this.match) this.effects(m.l); break;
      case 'hit': g.hud.hitmarker(m.k, m.h); g.audio.play('hit', { vol: 0.45, jitter: 0 }); g.weapons.stats.hits++; if (m.h) g.weapons.stats.heads++; break;
      case 'pts': g.hud.feed(m.n); break;
      case 'score': this.scores(m.s); break;
      case 'hurt': {
        const p = g.player;
        g.hud.damage(); g.audio.play('hurt', { vol: 0.8 });
        p.shake = Math.min(1, p.shake + 0.35);
        const ang = Math.atan2(m.x - p.pos.x, m.z - p.pos.z);
        p.kick(-1.2, Math.sin(ang - p.yaw) * 1.2);
        break;
      }
      case 'wave': g.clientWave(m.w, m.note); break;
      case 'waveEnd': g.hud.banner(`Wave ${m.w} survived`, 'The shops are open: press F to buy'); g.audio.play('waveEnd', { vol: 0.45 }); break;
      case 'notice': g.hud.notice(m.text); break;
      case 'double': g.director.double = 30; g.hud.banner('DOUBLE POINTS', ''); g.audio.play('pickup', { vol: 1 }); break;
      case 'buyOk': g.director.points = m.pts; g.hud.points(m.pts); g.director.bought(m.item, m); break;
      case 'buyNo': g.audio.play('empty'); if (m.why) g.hud.banner(m.why, ''); break;
      case 'pk+': for (const it of m.l) g.pickups.add(it); break;
      case 'pk-': g.pickups.taken(m.id, m.s === this.slot, m.k, m.a); break;
      case 'dr+': g.director.addDrop(m.k, m.p[0], m.p[1], m.p[2], m.id); break;
      case 'dr-': g.director.removeDrop(m.id); if (m.k) g.director.powerup(m.k); break;
      case 'nade': g.weapons.spawnGrenade(v3(m.p), v3(m.v), { id: m.id, visual: true, fuse: 4 }); break;
      case 'boom': g.clientBoom(m); break;
      case 'arrow': g.weapons.spawnArrow(v3(m.p), v3(m.v), { id: m.id, visual: true, by: m.s }); g.audio.play('bow', { pos: v3(m.p), vol: 0.6 }); break;
      case 'arrowGone': g.weapons.removeArrowById(m.id); break;
      case 'veh': this.onVehicle(m); break;
      case 'crash': { const vs = this.g.vehicles, v = vs.byVid(m.vid); if (v && m.e) vs.applyDamage(v, m.e, v !== vs.active); break; }
      case 'vehNo': g.audio.play('empty'); if (m.why) g.hud.notice(m.why); break;
      case 'down': g.onTeamDown?.(m.s); break;
      case 'up': g.onTeamUp?.(m.s); break;
      case 'over': this.match && (this.match.over = true); g.endMatch(m); break;
      default: break;
    }
  }

  begin(m) {
    const g = this.g;
    if (this.match) g.resetMatch();
    this.match = { over: false };
    g.localSlot = m.slot;
    this.team = m.team || [];
    this.msLeft = m.dur - m.elapsed;
    this.seq = 0; this.hist = []; this.snaps = []; this.offset = null; this.acc = 0; this.teleport = -1;
    this.smooth.set(0, 0, 0);
    const p = g.player;
    place(p, { x: m.pos[0], y: m.pos[1], z: m.pos[2] }, m.yaw);
    this.prevPos.copy(p.pos); this.prevViewY = p.pos.y;
    g.pickups.clear();
    for (const it of m.pickups) g.pickups.add(it);
    for (const d of m.drops) g.director.addDrop(d[1], d[2], d[3], d[4], d[0]);
    g.director.wave = m.wave;
    for (const [vid, x, y, z, h, driver, dmg, lost, dents, fall] of m.vehicles || []) this.vehicleAt(vid, x, y, z, h, driver, { dmg, lost, dents, fall });
    g.beginMatch('client', m);
    g.hud.team?.(this.team);
  }

  // ---- every frame ----
  frame(dt) {
    const g = this.g, p = g.player, input = g.input;
    if (!this.match) return;
    const playing = g.state === 'playing';
    // looking around is per frame; moving is per tick (like on the host)
    if (playing && !p.dead) p.look(input, true);
    if (playing && input.hit('Space')) this.jump = true;
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK && n < 6) {
      this.acc -= TICK; n++;
      const cmd = {
        seq: ++this.seq, bits: playing ? bitsFrom(input, this.jump) : 0, yaw: p.yaw, pitch: p.pitch, ads: p.ads,
        weapon: Math.max(0, WEAPONS.indexOf(g.weapons.current)), stairs: this.pendingStairs,
      };
      this.jump = false; this.pendingStairs = null;
      this.prevPos.copy(p.pos); this.prevViewY = p.viewY ?? p.pos.y;
      this.simulate(cmd);
      this.hist.push({ cmd, x: p.pos.x, y: p.pos.y, z: p.pos.z, veh: this.vehOf(p) });
      if (this.hist.length > 240) this.hist.shift();
      this.s.sendTo(this.s.hostId, 'unrel', encodeInputs(this.hist.slice(-INPUT_REDUNDANCY).map((h) => h.cmd)));
    }
    if (n === 6) this.acc = 0;
    // the camera: between the last two ticks, plus what's left of a correction
    const a = Math.min(1, this.acc / TICK);
    this.smooth.multiplyScalar(Math.exp(-dt * 10));
    this.renderPos.lerpVectors(this.prevPos, p.pos, a).add(this.smooth);
    const viewY = this.prevViewY + ((p.viewY ?? p.pos.y) - this.prevViewY) * a + this.smooth.y;
    // (in a vehicle the vehicle's camera takes over)
    if (!p.vehicle) p.applyCamera({ x: this.renderPos.x, y: viewY, z: this.renderPos.z });
    // zombies and the others, 100 ms in the past
    const rt = this.renderTick();
    g.zombies.updatePuppets(dt, rt, p.pos);
    this.drawOthers(dt, rt);
    this.drawVehicles(dt, rt);
    this.avatars.update(dt);
    if (this.snaps.length) this.msLeft = Math.max(0, this.snaps[this.snaps.length - 1].msLeft - (performance.now() - this.lastSnapAt));
  }

  simulate(cmd) {
    const g = this.g, p = g.player;
    if (p.dead) return;
    if (cmd.stairs != null) g.stairs.applyCode(p, cmd.stairs);
    const yaw = p.yaw, pitch = p.pitch;
    p.yaw = cmd.yaw; p.pitch = cmd.pitch; p.ads = cmd.ads;
    p.speedWeapon = DEFS[WEAPONS[cmd.weapon]]?.move ?? 1;
    p.update(TICK, this.input.set(cmd.bits), true);
    if (p.vehicle) g.vehicles.driveTick(p.vehicle, TICK, this.input);
    p.yaw = yaw; p.pitch = pitch;
  }

  // the state of our vehicle after a tick (to compare with the host's)
  vehOf(p) {
    const v = p.vehicle;
    return v ? { x: v.pos.x, y: v.pos.y, z: v.pos.z, h: v.heading, s: v.speed, st: v.steer } : null;
  }

  // ---- snapshots ----
  onSnapshot(s) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.tick <= last.tick) return;
    const now = performance.now();
    this.lastSnapAt = now;
    const sample = s.tick * TICK_MS - now;
    if (this.offset == null || sample > this.offset + 250 || sample < this.offset - 1000) this.offset = sample;
    else if (sample > this.offset) this.offset += (sample - this.offset) * 0.35;   // arrived early: catch up
    else this.offset += (sample - this.offset) * 0.02;                            // arrived late: drift slowly
    this.snaps.push(s);
    while (this.snaps.length > 45) this.snaps.shift();
    this.snapTimes = this.snapTimes || [];
    this.snapTimes.push(now);
    while (this.snapTimes.length && now - this.snapTimes[0] > 2000) this.snapTimes.shift();
    const me = s.players.find((q) => q.slot === this.slot);
    const myVeh = s.vehicles.find((c) => c.driver === this.slot) || null;
    for (const c of s.vehicles) {
      if (c.driver === this.slot) continue;
      let b = this.vstates.get(c.vid);
      if (!b) this.vstates.set(c.vid, b = []);
      b.push({ tick: s.tick, ...c });
      if (b.length > 12) b.shift();
    }
    if (me) this.reconcile(me, s.ack, myVeh);
    this.g.zombies.netUpdate(s.zombies, s.tick);
    this.g.director.wave = s.wave;
    this.states = s.players;
  }

  get snapRate() { const t = this.snapTimes; return t && t.length > 1 ? (t.length - 1) / ((t[t.length - 1] - t[0]) / 1000) : 0; }

  renderTick() { return (performance.now() + (this.offset ?? 0) - INTERP_MS) / TICK_MS; }

  // the host's word on where we are
  reconcile(me, ack, myVeh = null) {
    const g = this.g, p = g.player;
    p.health = me.health; p.maxHealth = me.maxHealth; p.speedMul = me.speedMul;
    const wasDead = p.dead;
    p.dead = !!(me.flags & PF.dead);
    this.respawn = me.respawn;
    if (!wasDead && p.dead) { g.weapons.adsToggle = false; }
    // respawned or taken somewhere: jump there
    if (me.teleport !== this.teleport) {
      const first = this.teleport < 0;
      this.teleport = me.teleport;
      if (!first || Math.hypot(me.x - p.pos.x, me.z - p.pos.z) > 3) {
        place(p, { x: me.x, y: me.y, z: me.z }, first ? null : me.yaw);
        this.hist = this.hist.filter((h) => h.cmd.seq > ack);
        this.replay();
        this.prevPos.copy(p.pos); this.prevViewY = p.pos.y; this.smooth.set(0, 0, 0);
        return;
      }
    }
    while (this.hist.length && this.hist[0].cmd.seq < ack) this.hist.shift();
    const h = this.hist[0];
    if (!h || h.cmd.seq !== ack) return;
    this.hist.shift();
    // getting in or out: the host and we disagree for a moment about whether we drive; wait
    if (!!h.veh !== !!myVeh || !!p.vehicle !== !!myVeh) return;
    if (myVeh) {
      const v = p.vehicle, e = h.veh;
      let dh = myVeh.heading - e.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const ex = myVeh.x - e.x, ey = myVeh.y - e.y, ez = myVeh.z - e.z;
      if (ex * ex + ey * ey + ez * ez < 0.0004 && Math.abs(dh) < 0.003 && Math.abs(myVeh.speed - e.s) < 0.05) return;
      // take the host's vehicle at that tick and drive the ticks it hasn't seen again
      const before = v.pos.clone();
      v.pos.set(myVeh.x, myVeh.y, myVeh.z);
      v.heading = myVeh.heading; v.speed = myVeh.speed; v.steer = myVeh.steer;
      v.vel.set(myVeh.vx, myVeh.vy, myVeh.vz);
      v.spin = myVeh.spin || 0;
      v.slip = (myVeh.vx * Math.sin(v.heading) + myVeh.vz * Math.cos(v.heading)) * v.fwdSign;   // (sideways, along the car's right)
      v.replaying = true;
      this.replay();
      v.replaying = false;
      const shift = before.sub(v.pos);
      if (shift.lengthSq() > 9) v.smooth.set(0, 0, 0); else v.smooth.add(shift);
      return;
    }
    const dx = me.x - h.x, dy = me.y - h.y, dz = me.z - h.z;
    if (dx * dx + dy * dy + dz * dz < 0.0004) return;
    // we were wrong: take the host's state at that tick and replay the ticks it hasn't seen
    const before = p.pos.clone();
    p.pos.set(me.x, me.y, me.z);
    p.vel.set(me.vx, me.vy, me.vz);
    p.onGround = !!(me.flags & PF.onGround);
    p.crouch = me.crouch;
    this.replay();
    const shift = before.sub(p.pos);
    if (shift.lengthSq() > 4) this.smooth.set(0, 0, 0);            // far out: snap
    else this.smooth.add(shift);                                     // a little: blend it in
    this.prevPos.sub(shift);
  }

  replay() {
    const p = this.g.player;
    p.quiet = true;
    for (const h of this.hist) { this.simulate(h.cmd); h.x = p.pos.x; h.y = p.pos.y; h.z = p.pos.z; h.veh = this.vehOf(p); }
    p.quiet = false;
  }

  // ---- vehicles ----
  enterVehicle(vid) { this.s.sendTo(this.s.hostId, 'rel', { t: 'enter', vid }); }
  exitVehicle() { this.s.sendTo(this.s.hostId, 'rel', { t: 'exit' }); }

  // a vehicle taken (s: the driver's slot) or left (s: -1, parked at st)
  onVehicle(m) {
    const g = this.g, vs = g.vehicles, v = vs.byVid(m.vid);
    if (!v) return;
    if (m.s >= 0) {
      v.pos.set(m.st.x, m.st.y, m.st.z); v.heading = m.st.h;
      if (m.s === this.slot) { vs.occupy(v, g.player, m.s); vs.takeControls(v); }
      else vs.occupy(v, { vehicle: null, vel: new THREE.Vector3(), pos: new THREE.Vector3() }, m.s);
      return;
    }
    // it stopped rolling (a bike that fell): there it lies
    if (m.stop) {
      this.vstates.delete(v.vid);
      v.pos.set(m.st.x, m.st.y, m.st.z); v.heading = m.st.h;
      v.coasting = false; v.fallen = !!m.fall; v.fallSide = m.fall || 1; v.lean = v.fallen ? v.fallSide * 1.45 : 0;
      v.speed = 0; v.slip = 0; v.spin = 0;
      vs.park(v);
      return;
    }
    const mine = v === vs.active;
    // thrown off: the rider flies, the bike goes down and slides (we'll see it in the snapshots)
    if (m.thr) {
      v.fallen = true; v.fallSide = m.fall || 1; v.coasting = true;
      if (mine) {
        const p = g.player;
        vs.dropControls(v);
        vs.release(v, p, { x: m.out[0], y: m.out[1], z: m.out[2], yaw: m.out[3] }, false);
        p.vel.set(m.thr[0], m.thr[1], m.thr[2]); p.onGround = false; p.tumble = 1; p.shake = 1;
        g.hud.notice('Thrown off the bike!');
      } else vs.release(v, v.who || { vel: new THREE.Vector3(), pos: new THREE.Vector3() }, null, false);
      return;
    }
    this.vstates.delete(v.vid);
    v.pos.set(m.st.x, m.st.y, m.st.z); v.heading = m.st.h;
    v.tilt.set(0, 0); v.lean = 0;
    if (mine) {
      vs.dropControls(v);
      vs.release(v, g.player, m.out ? { x: m.out[0], y: m.out[1], z: m.out[2], yaw: m.out[3] } : null);
    } else vs.release(v, v.who || { vel: new THREE.Vector3(), pos: new THREE.Vector3() }, null);
  }

  // (a match already running: where the vehicles are)
  vehicleAt(vid, x, y, z, h, driver, dmg = {}) {
    const vs = this.g.vehicles, v = vs.byVid(vid);
    if (!v) return;
    vs.unpark(v);
    v.pos.set(x, y, z); v.heading = h; v.moved = true;
    if (dmg.fall) { v.fallen = true; v.fallSide = dmg.fall; v.lean = dmg.fall * 1.45; }
    vs.place(v);
    vs.restoreDamage(v, dmg);
    if (driver != null && driver !== this.slot) vs.occupy(v, { vehicle: null, vel: new THREE.Vector3(), pos: new THREE.Vector3() }, driver);
    else vs.park(v);
  }

  // the others' vehicles, between the snapshots around renderTick
  drawVehicles(dt, rt) {
    const vs = this.g.vehicles;
    for (const [vid, b] of this.vstates) {
      const v = vs.byVid(vid);
      if (!v || (v.driver == null && !v.coasting) || v === vs.active || !b.length) continue;
      let a = b[0], c = b[b.length - 1];
      for (let i = 0; i < b.length; i++) { if (b[i].tick <= rt) a = b[i]; if (b[i].tick >= rt) { c = b[i]; break; } }
      if (a.tick > c.tick) c = a;
      const f = c.tick > a.tick ? Math.max(0, Math.min(1, (rt - a.tick) / (c.tick - a.tick))) : 0;
      let dh = c.heading - a.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      v.pos.set(a.x + (c.x - a.x) * f, a.y + (c.y - a.y) * f, a.z + (c.z - a.z) * f);
      v.heading = a.heading + dh * f;
      v.speed = a.speed + (c.speed - a.speed) * f;
      v.steer = a.steer + (c.steer - a.steer) * f;
      v.tilt.set(a.tx + (c.tx - a.tx) * f, a.ty + (c.ty - a.ty) * f);
      v.lean = a.lean + (c.lean - a.lean) * f;
      v.spin = c.spin || 0;
      v.vel.set(a.vx + (c.vx - a.vx) * f, 0, a.vz + (c.vz - a.vz) * f);
      if (c.flags & VF.fallen) v.fallen = true;
      // (their tyres: marks and squeal from how much the snapshot says they slide)
      const fx = Math.cos(v.heading) * v.fwdSign, fz = -Math.sin(v.heading) * v.fwdSign;
      const slip = Math.abs(-fz * v.vel.x + fx * v.vel.z);
      vs.crash.tyres(v, slip + Math.abs(v.spin) * 2.2, v.fallen ? Math.hypot(v.vel.x, v.vel.z) : 0, dt);
      vs.animateHero(v, dt, null);
      if (v.type === 'bike' && v.mesh.userData.wheels) for (const w of v.mesh.userData.wheels) w.rotation.z -= (v.speed / (v.wheelR || 0.39)) * dt;
      vs.place(v);
    }
  }

  // the other players, interpolated between the snapshots around renderTick
  drawOthers(dt, rt) {
    const S = this.snaps;
    if (!S.length) return;
    let a = S[0], b = S[S.length - 1];
    for (let i = 0; i < S.length; i++) {
      if (S[i].tick <= rt) a = S[i];
      if (S[i].tick >= rt) { b = S[i]; break; }
    }
    if (a.tick > b.tick) b = a;
    const f = b.tick > a.tick ? Math.max(0, Math.min(1, (rt - a.tick) / (b.tick - a.tick))) : 0;
    const seen = new Set();
    for (const pb of b.players) {
      if (pb.slot === this.slot) continue;
      const pa = a.players.find((q) => q.slot === pb.slot) || pb;
      let dyaw = pb.yaw - pa.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      seen.add(pb.slot);
      const name = (this.team.find((t) => t.slot === pb.slot) || {}).name;
      this.avatars.set({
        slot: pb.slot, x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f, z: pa.z + (pb.z - pa.z) * f,
        yaw: pa.yaw + dyaw * f, pitch: pa.pitch + (pb.pitch - pa.pitch) * f, crouch: pa.crouch + (pb.crouch - pa.crouch) * f,
        dead: !!(pb.flags & PF.dead), health: pb.health, maxHealth: pb.maxHealth, name, hidden: !!(pb.flags & PF.vehicle),
      }, dt, false);
    }
    for (const slot of [...this.avatars.list.keys()]) if (!seen.has(slot)) this.avatars.remove(slot);
  }

  teamStates() {
    const g = this.g, last = this.states || [];
    // (a teammate at the wheel: their arrow points the way the car does)
    const driving = (slot, yaw) => { const v = g.vehicles.list.find((q) => q.driver === slot && q.type !== 'drone'); return v ? v.heading - Math.PI / 2 + (v.fwdSign < 0 ? Math.PI : 0) : yaw; };
    return last.map((q) => q.slot === this.slot
      ? { slot: q.slot, health: g.player.health, maxHealth: g.player.maxHealth, dead: g.player.dead, respawn: q.respawn, pos: g.player.pos, yaw: g.player.mapYaw, me: true }
      : { slot: q.slot, health: q.health, maxHealth: q.maxHealth, dead: !!(q.flags & PF.dead), respawn: q.respawn, pos: this.avatars.list.get(q.slot)?.pos || new THREE.Vector3(q.x, q.y, q.z), yaw: driving(q.slot, q.yaw), name: (this.team.find((t) => t.slot === q.slot) || {}).name });
  }

  get localRespawnLeft() { return this.respawn || 0; }

  scores(s) {
    const g = this.g;
    const mine = s.find((q) => q[0] === this.slot);
    if (mine) { g.director.points = mine[1]; g.director.kills = mine[2]; g.director.headshots = mine[3]; g.director.deaths = mine[4]; g.hud.points(mine[1]); }
    g.hud.scores?.(s);
  }

  // blood, feathers, bile, the others' shots
  effects(list) {
    const g = this.g;
    for (const e of list) {
      if (e[0] === 's') {
        const [, slot, wi, ox, oy, oz, ...ds] = e;
        if (slot === this.slot) continue;
        const def = DEFS[WEAPONS[wi]] || DEFS.rifle, o = new THREE.Vector3(ox, oy, oz);
        this.avatars.flash(slot);
        g.audio.play(def.sound || 'rifle', { pos: o, vol: (def.vol ?? 0.9) * 0.9, rate: def.rate ?? 1 });
        for (let i = 0; i + 2 < ds.length; i += 3) {
          const d = new THREE.Vector3(ds[i], ds[i + 1], ds[i + 2]);
          g.weapons.worldImpact(o, d, def, i === 0);
          if (i === 0 && def.tracer) g.effects.tracer(o.clone().addScaledVector(d, 0.8), o.clone().addScaledVector(d, Math.min(def.range, 120)));
        }
      } else if (e[0] === 'k') {
        const av = this.avatars.list.get(e[1]);
        if (av) g.audio.play('knife', { pos: av.pos, vol: 0.6 });
      } else {
        const p = new THREE.Vector3(e[1], e[2], e[3]), d = new THREE.Vector3(e[4], e[5], e[6]);
        if (e[0] === 'b') g.effects.bloodBurst(p, d);
        else if (e[0] === 'f') g.effects.emit(p, 10, { color: [0.05, 0.05, 0.06], speed: 2.2, spread: 1.6, up: 1, life: 1.4, size: 0.07, gravity: 1.5 });
        else g.effects.emit(p, 12, { color: [0.35, 0.75, 0.15], speed: 2.5, spread: 1.2, up: 1, life: 0.8, size: 0.09, dir: d });
        g.audio.play('flesh', { pos: p, vol: 0.5 });
      }
    }
  }

  // ---- what we tell the host ----
  shoot(w, o, dirs, aimed) { this.s.sendTo(this.s.hostId, 'rel', { t: 'shot', w, o: r3(o), d: dirs.slice(0, 12).map(r4), rt: +this.renderTick().toFixed(2), a: aimed ? 1 : 0 }); }
  melee(heavy) { this.s.sendTo(this.s.hostId, 'rel', { t: 'melee', heavy }); }
  grenade(p, v) { this.s.sendTo(this.s.hostId, 'rel', { t: 'nade', p: r3(p), v: r3(v) }); }
  arrow(id, p, v, dmg, pierce, aimed) { this.s.sendTo(this.s.hostId, 'rel', { t: 'arrow', id, p: r3(p), v: r3(v), dmg, pierce, a: aimed ? 1 : 0 }); }
  buy(i, cost, owned, w) { this.s.sendTo(this.s.hostId, 'rel', { t: 'buy', i, cost, owned, w }); }
  queueStairs(code) { this.pendingStairs = code; }
  leave() { this.match = null; }
}
