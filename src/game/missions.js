// Missions: the waves as jobs, each with a goal on the HUD and on the map, and a beam of light over
// wherever it is. None of them can be done just by running: you hold ground, carry things (no
// running, no shooting, both hands), or stand and work at something while they come for you. Die,
// or fail the job, and the mission starts over from its beginning: nobody comes back to carry on.
import * as THREE from 'three';
import { pointInPoly } from '../world/geom.js';
import { NavGrid } from './navgrid.js';
import { Avatars } from '../net/avatars.js';
import { DEFS } from './weapons.js';
import { saveProgress, clearProgress } from './progress.js';

const GOLD = 0xffd23f;
const BREAK_S = 12;          // between missions: the shops are open
const clock = (s) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

// The missions. start: where you begin (a place, metres off it, facing it); setup: the job's state;
// update: 'won', a reason it failed, or nothing yet; aim: what to head for now; goal: the line on the HUD.
const MISSIONS = [
  {
    title: 'Hold the pool house',
    brief: 'Stand your ground by the pool house for 45 seconds. The clock only runs while you’re there.',
    start: { at: 'pool', off: [0, -16] },
    setup(M, s) { s.zone = M.zone(M.at('pool'), 8, 45); s.pressure = { every: 1.5, max: 12 }; },
    update(M, s, dt) { return M.hold(s.zone, dt) ? 'won' : null; },
    aim: (M, s) => [s.zone],
    goal: (M, s) => `Hold the pool house: ${clock(s.zone.need - s.zone.have)} to go${s.zone.inside ? '' : ' · get back in the ring!'}`,
  },
  {
    title: 'Supply run',
    brief: 'The medical crate is at Spar. Bring it back to the pool house: you can’t run or shoot while you carry it. Put it down (F) to fight.',
    start: { at: 'pool', off: [0, -6] },
    limit: 240,
    setup(M, s) { s.crate = M.crate(M.open(M.at('spar', [1.8, 1.8])), 'the medical crate'); s.to = M.zone(M.at('pool'), 5, 0); s.pressure = { every: 1.4, max: 14 }; },
    update(M, s) { return M.delivered(s.crate, s.to) ? 'won' : null; },
    aim: (M, s) => [s.crate.held ? s.to : s.crate],
    goal: (M, s) => (s.crate.held ? 'Carry the crate to the pool house' : s.crate.moved ? 'Pick the crate back up (F)' : 'Get the medical crate from Spar'),
  },
  {
    title: 'Lights on',
    brief: 'Night’s come early. Restart the three generators down in the car parks: hold F at each till it runs. Get hit and you start that one again.',
    start: { at: 'pool', off: [0, -6] },
    hour: 21.2, limit: 420,
    setup(M, s) { s.jobs = ['middle', 'north', 'south'].map((name) => M.job(M.at(`park:${name}`), 10, 'the generator')).filter(Boolean); s.pressure = { every: 1.3, max: 16 }; },
    update(M, s, dt) { for (const j of s.jobs) M.work(j, dt); return s.jobs.every((j) => j.done) ? 'won' : null; },
    aim: (M, s) => s.jobs.filter((j) => !j.done),
    goal: (M, s) => `Restart the generators down in the car parks: ${s.jobs.filter((j) => j.done).length} of ${s.jobs.length} running`,
  },
  {
    title: 'The giant',
    brief: 'A giant’s broken in, with a crowd round it. Bring it down within three minutes.',
    start: { at: 'pool', off: [0, -6] },
    limit: 180,
    setup(M, s) { s.pressure = { every: 1.6, max: 12 }; s.giantT = 2; },
    update(M, s, dt) {
      if (s.giantT > 0 && (s.giantT -= dt) <= 0) { M.g.director.spawnPack({ kind: 'giant', n: 1 }); s.giant = M.g.zombies.list.find((z) => z.def.boss && z.state !== 'dead'); }
      if (s.giant && s.giant.state === 'dead') return 'won';
      if (s.giantT <= 0 && !s.giant) s.giant = M.g.zombies.list.find((z) => z.def.boss && z.state !== 'dead');
      return null;
    },
    aim: (M, s) => (s.giant && s.giant.state !== 'dead' ? [s.giant.pos] : []),
    goal: (M, s) => (s.giant ? `Bring down the giant: ${Math.round(Math.max(0, s.giant.hp / s.giant.maxHp) * 100)}% left` : 'A giant’s coming…'),
  },
  {
    title: 'Rooftop rescue',
    brief: 'Nino’s stuck up on a roof. Take the stairs up to her and bring her down to the pool house alive: she keeps up with you walking, not running.',
    start: { at: 'pool', off: [0, -6] },
    limit: 360,
    setup(M, s) {
      const st = M.rescueRoof();
      s.nino = M.survivor({ x: st.roof.x, y: st.top, z: st.roof.z }, 'Nino', st);
      s.to = M.zone(M.at('pool'), 6, 0);
      s.to.beam.m.visible = s.to.beam.r.visible = false;
      s.pressure = { every: 1.4, max: 16 };
    },
    update(M, s, dt) {
      const n = s.nino;
      M.hurt(n, dt);
      if (n.dead) return 'Nino didn’t make it';
      if (!n.following && M.dist(n) < 3 && Math.abs(M.g.player.pos.y - n.y) < 2) { n.following = true; M.g.hud.notice('Nino: “I’m right behind you!”'); }
      if (n.following) M.follow(n, dt);
      s.to.beam.m.visible = s.to.beam.r.visible = n.following;
      return M.inZone(n, s.to) ? 'won' : null;
    },
    aim: (M, s) => [s.nino.following && !s.nino.far ? s.to : s.nino],
    goal: (M, s) => (!s.nino.following ? 'Get up to Nino on the roof (take the stairs)' : s.nino.far ? 'Nino can’t keep up: go back for her' : 'Bring Nino to the pool house'),
  },
  {
    title: 'Fuel for the van',
    brief: 'The van by Gate 1 has no fuel. Four cans are about the complex: carry them to it one at a time. No running, no shooting with a can in your hands.',
    start: { at: 'pool', off: [0, -6] },
    limit: 420,
    setup(M, s) {
      s.van = M.van();
      const vp = { x: s.van.pos.x, y: s.van.pos.y, z: s.van.pos.z };
      s.cans = M.spread(4, vp, 40).map((p) => M.crate(p, 'a fuel can', 'fuel'));
      s.to = M.zone(vp, 4, 0);
      s.pressure = { every: 1.3, max: 16 };
    },
    update(M, s) { return M.carryAll(s.cans, s.to) >= s.cans.length ? 'won' : null; },
    aim: (M, s) => (s.cans.some((c) => c.held) ? [s.to] : s.cans.filter((c) => !c.done)),
    goal: (M, s) => `Fuel for the van: ${s.cans.filter((c) => c.done).length} of ${s.cans.length} cans${s.cans.some((c) => c.held) ? ' · carry it to the van' : ''}`,
  },
  {
    title: 'Escort',
    brief: 'Dr Tamar is walking to the pool house with the medicine. She won’t move while they’re close: keep them off her.',
    start: { at: 'north', off: [3, 3] },
    limit: 360,
    setup(M, s) {
      const from = M.open(M.at('north')), to = M.at('pool');
      s.tamar = M.survivor(from, 'Dr Tamar', null, 320);
      s.route = M.route(to);
      s.to = M.zone(to, 6, 0);
      s.pressure = { every: 1.3, max: 16, near: s.tamar };
    },
    update(M, s, dt) {
      const n = s.tamar;
      M.hurt(n, dt);
      if (n.dead) return 'Dr Tamar didn’t make it';
      M.walk(n, s.route, dt);
      return M.inZone(n, s.to) ? 'won' : null;
    },
    aim: (M, s) => [s.tamar],
    goal: (M, s) => (s.tamar.cower ? 'Keep them off Dr Tamar: she won’t move with them this close' : 'Get Dr Tamar to the pool house'),
    navGoals: (M, s) => (s.tamar && !s.tamar.dead ? [{ x: s.tamar.x, z: s.tamar.z }] : []),
  },
  {
    title: 'Clear the car park',
    brief: 'The big car park is full of them. Go down and finish every one: five minutes.',
    start: { at: 'parkdoor:middle', off: [0, 0] },
    limit: 300,
    setup(M, s) { s.horde = M.horde('middle', 26); },
    update(M, s) { return s.horde.every((z) => z.state === 'dead') ? 'won' : null; },
    aim: (M, s) => s.horde.filter((z) => z.state !== 'dead').map((z) => z.pos),
    goal: (M, s) => `Clear the car park: ${s.horde.filter((z) => z.state !== 'dead').length} left`,
  },
  {
    title: 'Hold the roof',
    brief: 'Up on the highest roof, hold out for 90 seconds. They come up the stairs, and the crows find you.',
    start: { at: 'topdoor', off: [0, 0] },
    limit: 360,
    setup(M, s) { const st = M.topRoof(); s.zone = M.zone({ x: st.roof.x, y: st.top, z: st.roof.z }, 9, 90); s.pressure = { every: 1.2, max: 18, crows: true }; },
    update(M, s, dt) { return M.hold(s.zone, dt) ? 'won' : null; },
    aim: (M, s) => [s.zone],
    goal: (M, s) => (M.g.player.roof ? `Hold the roof: ${clock(s.zone.need - s.zone.have)} to go${s.zone.inside ? '' : ' · back to the stairs!'}` : 'Take the stairs up to the roof'),
  },
  {
    title: 'Escape',
    brief: 'Get the van going (hold F at it), then drive it out through Gate 1. There’s a giant between you and the gate.',
    start: { at: 'pool', off: [0, -6] },
    limit: 420,
    setup(M, s) {
      s.van = M.van();
      s.fix = M.job({ x: s.van.pos.x, y: s.van.pos.y, z: s.van.pos.z }, 12, 'the van', false);
      s.out = M.zone(M.at('outside'), 9, 0);
      s.out.beam.m.visible = s.out.beam.r.visible = false;
      s.pressure = { every: 1.1, max: 20 };
      s.giantT = 3;
    },
    update(M, s, dt) {
      const g = M.g;
      if (s.giantT > 0 && (s.giantT -= dt) <= 0) g.director.spawnPack({ kind: 'giant', n: 1 });
      if (s.van.dmg >= 100) return 'The van’s wrecked';
      M.work(s.fix, dt);
      s.out.beam.m.visible = s.out.beam.r.visible = s.fix.done;
      return s.fix.done && g.player.vehicle === s.van && M.inZone(s.van.pos, s.out) ? 'won' : null;
    },
    aim: (M, s) => [s.fix.done && M.g.player.vehicle === s.van ? s.out : s.fix],
    goal: (M, s) => (!s.fix.done ? 'Get the van going: hold F at it' : M.g.player.vehicle === s.van ? 'Drive out through Gate 1' : 'Get in the van (F)'),
  },
];
export const MISSION_COUNT = MISSIONS.length;
export const missionTitle = (i) => MISSIONS[i]?.title || '';

export class Missions {
  constructor(game) {
    this.g = game;
    this.on = false;
    this.i = 0;
    this.state = 'idle';
    this.things = [];            // beams, crates: what's in the world for this mission
    this.beamGeo = new THREE.CylinderGeometry(0.55, 0.55, 1, 16, 1, true).translate(0, 0.5, 0);
    this.beamMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    this.ringGeo = new THREE.RingGeometry(0.9, 1.15, 40).rotateX(-Math.PI / 2);
  }

  get mission() { return MISSIONS[this.i]; }
  get level() { return this.i + 1; }

  // ---- places, and the things a mission puts in the world ----

  // a named place: {x, y, z} (a shop by its gun, the pool house by its ammo crate, a car park's middle)
  at(name, off = [0, 0]) {
    const g = this.g, st = g.director.stations;
    let p = null;
    if (name === 'pool') p = st.find((s) => s.item === 'ammo' && /pool house/.test(s.label));
    else if (name === 'spar') p = st.find((s) => s.item === 'rifle');
    else if (name === 'north') p = st.find((s) => s.item === 'ammo' && /north-west/.test(s.label));
    else if (name === 'outside') { const gt = g.level.gates.find((q) => q.name === 'Gate 1'); return { x: gt.x + 15 + off[0], y: g.hm.atWorld(gt.x + 15, -gt.y), z: -gt.y + off[1] }; }
    else if (name === 'topdoor') { const ds = this.topRoof().doors, d = ds.find((q) => !q.blocked) || ds[0]; return { x: d.x + off[0], y: g.hm.atWorld(d.x, d.z), z: d.z + off[1] }; }
    else if (name.startsWith('parkdoor:')) {
      const u = g.underground && g.underground.list.find((q) => q.name === name.slice(9)), pool = this.at('pool');
      if (!u) return null;
      const d = u.doors.reduce((a, q) => (Math.hypot(q.out.x - pool.x, q.out.z - pool.z) < Math.hypot(a.out.x - pool.x, a.out.z - pool.z) ? q : a));
      return { x: d.out.x + off[0], y: g.hm.atWorld(d.out.x, d.out.z), z: d.out.z + off[1] };
    }
    else if (name.startsWith('park:')) {
      const u = g.underground && g.underground.list.find((q) => q.name === name.slice(5));
      if (!u || !u.lights.length) return null;
      // (the light nearest the middle that's clear of the crates down there)
      const mx = u.lights.reduce((a, l) => a + l[0], 0) / u.lights.length, my = u.lights.reduce((a, l) => a + l[1], 0) / u.lights.length;
      const free = u.lights.filter(([lx, ly]) => !st.some((q) => q.y != null && q.y < -1 && Math.hypot(q.x - lx, q.z + ly) < 6));
      const [lx, ly] = (free.length ? free : u.lights).reduce((a, l) => (Math.hypot(l[0] - mx, l[1] - my) < Math.hypot(a[0] - mx, a[1] - my) ? l : a));
      return { x: lx + off[0], y: u.floor, z: -ly + off[1] };
    }
    if (!p) return null;
    return { x: p.x + off[0], y: p.y ?? g.hm.atWorld(p.x, p.z), z: p.z + off[1] };
  }

  // Somewhere you can stand and walk away from, as near p as there is: out of every building (a
  // metre and more clear of its walls), on walkable ground, nothing solid there, and a clear way
  // off it for 8 m at least one way. (Where a mission puts you, and what it puts out for you.)
  open(p) {
    const g = this.g, nav = g.nav;
    const inside = (x, z) => g.level.buildings.some((b) => pointInPoly(x, -z, b.poly.outer));
    // (and clear of everything else F does something at: the shops, the cars, the stairwell doors)
    const busy = (x, z) => g.director.stations.some((q) => Math.hypot(q.x - x, q.z - z) < 4.5 && (q.y ?? 0) > -1)
      || g.vehicles.list.some((v) => Math.hypot(v.pos.x - x, v.pos.z - z) < 4.5)
      || (g.stairs?.list || []).some((st) => st.doors.some((d) => Math.hypot(d.x - x, d.z - z) < 4));
    const ok = (x, z) => {
      if (busy(x, z)) return false;
      for (const [dx, dz] of [[0, 0], [1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]]) if (inside(x + dx, z + dz) || !nav.walkable(x + dx, z + dz)) return false;
      const y = g.hm.atWorld(x, z);
      if (y < -0.5 || g.colliders.resolve({ x, z }, 0.6, y + 0.2, y + 1.7, 1)) return false;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; if (nav.lineWalkable(x, z, x + Math.cos(a) * 8, z + Math.sin(a) * 8) && !inside(x + Math.cos(a) * 8, z + Math.sin(a) * 8)) return true; }
      return false;
    };
    for (let k = 0; k < 600; k++) {
      const r = k === 0 ? 0 : 0.8 + Math.sqrt(k) * 1.1, a = k * 2.399;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (ok(x, z)) return { x, z, y: g.hm.atWorld(x, z) };
    }
    return p;
  }

  beam(p, tall = true) {
    const m = new THREE.Mesh(this.beamGeo, this.beamMat);
    m.position.set(p.x, p.y, p.z);
    m.scale.y = tall ? 60 : 2.8;   // (down in a car park: up to the ceiling)
    const r = new THREE.Mesh(this.ringGeo, this.beamMat);
    r.position.set(p.x, p.y + 0.05, p.z);
    this.g.scene.add(m, r);
    this.things.push(m, r);
    return { m, r };
  }

  // a ring to stand in for `need` seconds (the clock runs only while you're in it)
  zone(p, r, need) { const z = { ...p, r, need, have: 0, inside: false, beam: this.beam(p) }; return z; }
  hold(z, dt) {
    const pl = this.g.player;
    z.inside = !pl.dead && Math.hypot(pl.pos.x - z.x, pl.pos.z - z.z) < z.r && Math.abs(pl.pos.y - z.y) < 2.5;
    if (z.inside) z.have += dt;
    this.progress = z.need ? z.have / z.need : 0;
    return z.have >= z.need;
  }

  // something to carry: F to pick it up and to put it down; carried, you can't run or shoot
  crate(p, name, kind = 'medical') {
    const mat = new THREE.MeshStandardMaterial({ color: kind === 'fuel' ? 0xb3261e : 0xf2f0ea, roughness: 0.6, metalness: kind === 'fuel' ? 0.3 : 0 });
    const red = new THREE.MeshStandardMaterial({ color: kind === 'fuel' ? 0x2a2a2a : 0xd81f26, roughness: 0.6 });
    const m = new THREE.Group();
    if (kind === 'fuel') {
      // a jerrycan: the body, the handle on top, the spout
      m.add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.46, 0.18), mat));
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.06), red); h.position.y = 0.26; m.add(h);
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.1, 8), red); sp.position.set(0.13, 0.27, 0); sp.rotation.z = -0.5; m.add(sp);
    } else {
      m.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.42), mat));
      for (const [w, h, d, z] of [[0.3, 0.09, 0.01, 0.216], [0.09, 0.3, 0.01, 0.216], [0.3, 0.09, 0.01, -0.216], [0.09, 0.3, 0.01, -0.216]]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), red); c.position.z = z; m.add(c);
      }
    }
    m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    m.position.set(p.x, p.y + 0.21, p.z);
    this.g.scene.add(m);
    this.things.push(m);
    return { ...p, name, mesh: m, held: false, moved: false, beam: this.beam(p) };
  }
  delivered(c, to) {
    const g = this.g, pl = g.player;
    const near = Math.hypot(pl.pos.x - c.x, pl.pos.z - c.z) < 1.8 && Math.abs(pl.pos.y - c.y) < 2;
    if (c.held) {
      // (carried: in front of you, low)
      const f = pl.forward(this.tmp || (this.tmp = new THREE.Vector3()));
      c.x = pl.pos.x + f.x * 0.75; c.z = pl.pos.z + f.z * 0.75; c.y = pl.pos.y;
      c.mesh.position.set(c.x, pl.pos.y + 1.2, c.z);   // (low in front of you: its top in view)
      c.mesh.rotation.y = pl.yaw;
      if (pl.dead) this.put(c);
      else g.hud.prompt('Press <b>F</b> — put the crate down', 4);
    } else if (near && !pl.dead) g.hud.prompt(`Press <b>F</b> — pick up ${c.name} (you can’t run or shoot carrying it)`, 4);
    if (c.held || near) this.hasF = true;
    if (g.input.hit('KeyF') && (c.held || near) && !pl.dead) { g.input.pressed.delete('KeyF'); if (c.held) this.put(c); else { c.held = true; c.moved = true; pl.carrying = true; g.audio.play('pickup', { vol: 0.8 }); } }
    c.beam.m.position.set(c.x, c.y, c.z); c.beam.r.position.set(c.x, c.y + 0.05, c.z);
    // (to it: the beam over the crate while it's not with you, over where it goes while it is)
    c.beam.m.visible = c.beam.r.visible = !c.held;
    to.beam.m.visible = to.beam.r.visible = c.held;
    return c.held && Math.hypot(c.x - to.x, c.z - to.z) < to.r && Math.abs(c.y - to.y) < 2.5;
  }
  put(c) {
    const pl = this.g.player;
    c.held = false; pl.carrying = false;
    c.y = this.g.groundAt ? this.g.groundAt(c.x, c.z, pl.pos.y + 1) : pl.pos.y;
    c.mesh.position.set(c.x, c.y + 0.21, c.z);
  }

  // a job to stand at: hold F for `need` seconds (let go and it waits; get hit and it's back to nothing)
  job(p, need, name, box = true) {
    if (!p) return null;
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a6a3a, roughness: 0.7, metalness: 0.2 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.7), mat);
    m.position.set(p.x, p.y + 0.45, p.z);
    m.castShadow = true;
    m.visible = box;
    this.g.scene.add(m);
    this.things.push(m);
    // (solid: once for each place; the colliders are for good)
    const key = `${p.x.toFixed(1)},${p.z.toFixed(1)}`;
    if (box && !(this.solid ||= new Set()).has(key)) { this.solid.add(key); this.g.colliders.addBox(p.x, p.z, 0.6, 0.35, 0, { height: p.y + 0.9, minY: p.y - 0.2, kind: 'crate' }); }
    return { ...p, need, have: 0, done: false, name, mesh: m, beam: this.beam(p, p.y > -1) };
  }
  work(j, dt) {
    const g = this.g, pl = g.player;
    if (j.done) return;
    const near = !pl.dead && Math.hypot(pl.pos.x - j.x, pl.pos.z - j.z) < 2.3 && Math.abs(pl.pos.y - j.y) < 2;
    if (!near) { if (pl.workingOn === j) pl.working = false; return; }
    this.hasF = true;
    const holding = g.input.down('KeyF');
    if (holding) {
      if (pl.health < (j.hp ?? pl.health) - 0.5 && j.have > 0) { j.have = 0; g.hud.notice('Hit! Start that one again'); g.audio.play('empty'); }
      j.have += dt;
      pl.working = true; pl.workingOn = j;
      if (j.have >= j.need) {
        j.done = true; pl.working = false;
        j.mesh.material.color.set(0x3f8f3f);
        j.beam.m.visible = j.beam.r.visible = false;
        g.audio.play('buy');
        g.hud.notice(`${j.name[0].toUpperCase()}${j.name.slice(1)} is running`);
        if (j.name === 'the van') for (const o of [j.beam.m, j.beam.r]) o.visible = false;
      }
    } else if (pl.workingOn === j) pl.working = false;
    j.hp = pl.health;
    this.progress = j.have / j.need;
    g.hud.prompt(`Hold <b>F</b> — ${j.name === 'the van' ? 'get the van going' : `restart ${j.name}`} <b>${Math.round((j.have / j.need) * 100)}%</b>`, 4);
  }

  // several things to carry, one at a time, to one place: how many have got there
  carryAll(list, to) {
    const g = this.g, pl = g.player;
    const held = list.find((c) => c.held);
    for (const c of list) {
      if (c.done) continue;
      if (held && c !== held) { c.beam.m.visible = c.beam.r.visible = false; continue; }   // (one in your hands at a time)
      if (this.delivered(c, to)) {
        c.done = true; c.held = false; pl.carrying = false;
        c.mesh.visible = c.beam.m.visible = c.beam.r.visible = false;
        g.audio.play('buy'); g.hud.notice(`${list.filter((q) => q.done).length} of ${list.length}`);
      }
    }
    if (!list.some((c) => c.held)) { to.beam.m.visible = to.beam.r.visible = false; for (const c of list) if (!c.done) c.beam.m.visible = c.beam.r.visible = true; }
    return list.filter((c) => c.done).length;
  }

  // n open spots spread over the complex (one in each quarter, as near its middle as there's room),
  // well away from `from`
  spread(n, from, away) {
    const g = this.g, [x0, y0, x1, y1] = g.pickups.bounds, out = [];
    const anchors = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.5]].map(([qx, qz]) => ({ x: x0 + (x1 - x0) * qx, z: -(y0 + (y1 - y0) * qz) }));
    anchors.sort((a, b) => Math.hypot(b.x - from.x, b.z - from.z) - Math.hypot(a.x - from.x, a.z - from.z));
    for (const a of anchors) {
      if (out.length >= n) break;
      const p = this.open(a);
      if (Math.hypot(p.x - from.x, p.z - from.z) >= away && !out.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 30)) out.push(p);
    }
    return out;
  }

  // the van by Gate 1 (the car parked nearest the gate, inside), back where it was and mended
  van() {
    const g = this.g, vs = g.vehicles;
    if (!this.vanAt) {
      const gt = g.level.gates.find((q) => q.name === 'Gate 1'), gx = gt.x, gz = -gt.y;
      const v = vs.list.filter((q) => q.type === 'car' && q.pos.x < gx - 3).sort((a, b) => Math.hypot(a.pos.x - gx, a.pos.z - gz) - Math.hypot(b.pos.x - gx, b.pos.z - gz))[0];
      this.vanAt = { v, pos: v.pos.clone(), heading: v.heading };
    }
    const { v, pos, heading } = this.vanAt;
    if (g.player.vehicle === v) vs.exit();
    if (v.pieces || v.dentable) vs.rebuild(v);
    Object.assign(v, { dmg: 0, hp: {}, slip: 0, spin: 0, fallen: false, coasting: false, deadNoted: false, dents: [], pieces: null, dentable: null, lastCrash: null, speed: 0 });
    v.lost = new Set();
    vs.unpark(v); v.pos.copy(pos); v.heading = heading; v.moved = true; vs.park(v);
    return v;
  }

  // the roofs: the highest you can climb to, and one for the rescue (nearest the pool house, not that one)
  topRoof() { return [...this.g.stairs.list].sort((a, b) => b.top - a.top)[0]; }
  rescueRoof() {
    const pool = this.at('pool'), top = this.topRoof();
    return this.g.stairs.list.filter((s) => s !== top && s.doors.some((d) => !d.blocked)).sort((a, b) => Math.hypot(a.roof.x - pool.x, a.roof.z - pool.z) - Math.hypot(b.roof.x - pool.x, b.roof.z - pool.z))[0] || top;
  }

  // ---- survivors: someone to keep alive, on their feet (a player's model, their name and health over them)
  survivor(p, name, stair = null, hp = 260) {
    this.npcs ||= new Avatars(this.g);
    const slot = 6 + ((this.npcN = (this.npcN || 0) + 1) % 2);
    const n = { x: p.x, y: p.y, z: p.z, yaw: 0, hp, max: hp, name, slot, stair, roof: stair ? stair : null, dead: false, following: false, cower: false, far: false };
    this.npcList = [...(this.npcList || []), n];
    this.show(n, 0);
    return n;
  }
  show(n, dt) { this.npcs.set({ slot: n.slot, x: n.x, y: n.y, z: n.z, yaw: n.yaw, pitch: 0, crouch: n.cower ? 1 : 0, dead: n.dead, health: Math.max(0, n.hp), maxHealth: n.max, name: n.name }, dt, false); }
  dist(n) { const p = this.g.player.pos; return Math.hypot(p.x - n.x, p.z - n.z); }
  inZone(q, z) { return Math.hypot(q.x - z.x, q.z - z.z) < z.r && Math.abs(q.y - z.y) < 2.5; }

  // the zombies at them hurt them (they go for the living, and a survivor's as good as anyone)
  hurt(n, dt) {
    if (n.dead) return;
    let k = 0;
    for (const z of this.g.zombies.list) if (z.state !== 'dead' && z.species !== 'crow' && Math.abs(z.pos.x - n.x) < 1.5 && Math.abs(z.pos.z - n.z) < 1.5 && Math.abs(z.pos.y - n.y) < 1.6) k++;
    if (!k) return;
    n.hp -= k * (16 + this.level * 2) * dt;
    n.ouchT = (n.ouchT || 0) - dt;
    if (n.ouchT <= 0) { n.ouchT = 0.8; this.g.audio.play('hurt', { pos: { x: n.x, y: n.y + 1.4, z: n.z }, vol: 0.6, rate: 1.25 }); }
    if (n.hp <= 0) { n.dead = true; n.hp = 0; }
  }

  // a step for them, round what's in the way (and not off a roof)
  step(n, mx, mz, len) {
    const g = this.g, q = { x: n.x + mx * len, z: n.z + mz * len };
    g.colliders.resolve(q, 0.3, n.y + 0.25, n.y + 1.6, 2);
    if (n.roof) { const r = g.player.roofObj(q.x, q.z); if (!r || r.stair !== n.roof) return; }
    n.x = q.x; n.z = q.z;
    if (!n.roof) n.y = g.groundAt(n.x, n.z, n.y + 1);
    n.yaw = Math.atan2(-mx, -mz);
  }

  // after you, walking pace (by the way the horde goes, round things); up and down the stairs with
  // you if they're close when you go; too far behind and they wait for you
  follow(n, dt) {
    const g = this.g, pl = g.player, last = this.last || { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z };
    const jumped = Math.hypot(pl.pos.x - last.x, pl.pos.z - last.z) > 6 || Math.abs(pl.pos.y - last.y) > 3;
    if (jumped && Math.hypot(last.x - n.x, last.z - n.z) < 12 && Math.abs(last.y - n.y) < 3) {
      const f = pl.forward(this.tmp || (this.tmp = new THREE.Vector3()));
      n.x = pl.pos.x - f.x * 1.4; n.z = pl.pos.z - f.z * 1.4; n.y = pl.pos.y;
      // (on a roof or not by where she is now: yours isn't worked out again till your next step)
      const ro = n.y > 2 ? g.player.roofObj(n.x, n.z) : null;
      n.roof = ro ? ro.stair : null;
      if (!n.roof) n.y = g.groundAt(n.x, n.z, n.y + 1);
    }
    const dx = pl.pos.x - n.x, dz = pl.pos.z - n.z, d = Math.hypot(dx, dz);
    n.far = d > 30 || Math.abs(pl.pos.y - n.y) > 3;
    if (d < 2.4 || n.far || pl.dead) { if (d > 0.1) n.yaw = Math.atan2(-dx, -dz); return; }
    let mx = dx / d, mz = dz / d;
    const dir = this.dir || (this.dir = { x: 0, z: 0 });
    if (!n.roof && !pl.roof && !pl.vehicle && g.nav.direction(n.x, n.z, dir)) { mx = dir.x; mz = dir.z; }
    this.step(n, mx, mz, 3.3 * dt);
  }

  // a way to somewhere, for someone walking it on their own (made once, then worked out a bit a frame)
  route(to) {
    this.nav2 ||= new NavGrid(this.g.colliders);
    this.nav2.request(to.x, to.z);
    return { grid: this.nav2, to };
  }
  walk(n, r, dt) {
    r.grid.step(20000);
    // (they won't go on with one of them near)
    n.cower = this.g.zombies.list.some((z) => z.state !== 'dead' && z.species !== 'crow' && Math.hypot(z.pos.x - n.x, z.pos.z - n.z) < 7);
    if (n.cower || r.grid.busy) return;
    const dir = this.dir || (this.dir = { x: 0, z: 0 });
    if (r.grid.direction(n.x, n.z, dir)) this.step(n, dir.x, dir.z, 1.9 * dt);
    else { const dx = r.to.x - n.x, dz = r.to.z - n.z, d = Math.hypot(dx, dz); if (d > 0.5) this.step(n, dx / d, dz / d, 1.9 * dt); }
  }

  // a horde waiting in a car park (at its lights, the far end from the ramps first)
  horde(name, count) {
    const g = this.g, d = g.director, u = g.underground && g.underground.list.find((q) => q.name === name);
    if (!u) return [];
    const doors = u.doors.map((q) => q.in);
    const spots = u.lights.map(([x, y]) => ({ x, z: -y })).filter((p) => doors.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 18));
    const out = [];
    for (let k = 0; k < count && spots.length; k++) {
      const p = spots[Math.floor(Math.random() * spots.length)], type = d.pickType(this.level);
      out.push(g.zombies.spawn(p.x + (Math.random() - 0.5) * 3, p.z + (Math.random() - 0.5) * 3, { type, hp: d.health(this.level), speedMul: d.speedMul(type, this.level), damage: d.damage(this.level), y: u.floor }));
    }
    return out;
  }

  // (the vehicles: the van's not for driving till the mission says so: the fuel run, before it's going)
  lockedCar(v) { const s = this.s; return !!(this.on && s && s.van === v && (!s.fix || !s.fix.done)); }

  // (main: the horde goes for these too, as for a player)
  navGoals() { return this.on && this.state === 'active' && this.mission.navGoals ? this.mission.navGoals(this, this.s) : []; }

  // ---- the flow ----

  // (saved: carrying on from a refresh, with what you had going in)
  start(i = 0, saved = null) {
    this.on = true;
    if (saved) this.restore(saved);
    this.begin(Math.max(0, Math.min(MISSIONS.length - 1, i)));
  }

  // what you've got going in to mission i, kept for a refresh
  save(i) {
    const g = this.g, w = g.weapons, p = g.player, d = g.director;
    saveProgress({
      mission: i, points: d.points, kills: d.kills, headshots: d.headshots,
      owned: JSON.parse(JSON.stringify(w.owned)), current: w.current, grenades: w.grenades, levels: { ...w.levels },
      armour: p.armour, speedMul: p.speedMul,
    });
  }
  restore(s) {
    const g = this.g, w = g.weapons, p = g.player, d = g.director;
    const num = (v, or) => (Number.isFinite(v) ? v : or);
    d.points = num(s.points, d.points); d.kills = num(s.kills, d.kills); d.headshots = num(s.headshots, d.headshots);
    const owned = {};
    for (const [k, a] of Object.entries(s.owned || {})) if (DEFS[k] && a) owned[k] = { mag: num(a.mag, DEFS[k].mag), reserve: num(a.reserve, DEFS[k].reserve) };
    if (Object.keys(owned).length) w.owned = owned;
    w.grenades = num(s.grenades, w.grenades);
    w.levels = {};
    for (const [k, l] of Object.entries(s.levels || {})) if (DEFS[k] && Number.isFinite(l)) w.levels[k] = l;
    if (s.armour) p.setArmour(s.armour);
    if (Number.isFinite(s.speedMul)) p.speedMul = s.speedMul;
    w.equip(w.owned[s.current] ? s.current : w.owned.pistol ? 'pistol' : w.order[0], true);
    g.hud.points(d.points); g.hud.slots(w.owned, w.current); g.hud.grenades(w.grenades);
  }

  clearUp() {
    const g = this.g;
    for (const o of this.things) o.removeFromParent();
    this.things = [];
    g.player.carrying = false; g.player.working = false;
    g.zombies.clear();
    this.npcs?.clear(); this.npcList = [];
    this.progress = 0;
  }

  // a mission from its beginning (a new one, or the same again after a failure)
  begin(i) {
    const g = this.g, m = MISSIONS[i];
    this.clearUp();
    this.i = i;
    this.s = {};
    this.t = 0;
    g.director.wave = this.level;   // (how tough they are, and the HUD's 3/10)
    g.hud.finalWave = MISSIONS.length;
    g.hud.wave(this.level);
    // the time of day: the evening going on, mission by mission (or its own)
    g.onWave?.(this.level);
    if (m.hour != null) g.targetHour = m.hour;
    if (g.targetHour != null) { g.hour = g.targetHour; g.atmo.setHour(g.hour); }
    // you: at the start (out in the open), well again
    const p = this.open(this.at(m.start.at, m.start.off) || { x: g.player.pos.x, y: g.player.pos.y, z: g.player.pos.z });
    const to = this.at(m.start.at) || p;
    g.player.spawn(p.x, p.z, Math.atan2(-(to.x - p.x), -(to.z - p.z)));
    g.player.health = g.player.maxHealth;
    m.setup(this, this.s);
    g.pickups.replenish(25);
    this.state = 'brief'; this.stateT = 4;
    g.hud.banner(`Mission ${this.level}: ${m.title}`, m.brief);
    this.save(i);
  }

  // (main: we died) the attempt's over
  died() { if (this.state === 'active' || this.state === 'brief') this.fail('You went down'); }

  fail(why) {
    const g = this.g;
    this.state = 'failed'; this.stateT = 4.5;
    g.player.carrying = false; g.player.working = false;
    g.hud.banner('Mission failed', `${why}. From the top…`);
    g.audio.play('waveEnd', { vol: 0.4, rate: 0.7 });
  }

  win() {
    const g = this.g, bonus = 250 * this.level;
    g.director.addPoints(bonus, true);
    g.player.carrying = false; g.player.working = false;
    for (const o of this.things) o.visible = false;
    g.zombies.killAll();
    g.audio.play('waveEnd', { vol: 0.6 });
    if (this.i + 1 >= MISSIONS.length) { this.state = 'done'; clearProgress(); g.hud.banner('Missions done', `All ${MISSIONS.length} of them. +${bonus} points`); g.onVictory?.(); return; }
    this.save(this.i + 1);   // (refreshed in the break: on to the next one)
    this.state = 'break'; this.stateT = BREAK_S;
    g.hud.banner('Mission complete', `+${bonus} points. Next: ${MISSIONS[this.i + 1].title}. The shops are open`);
  }

  update(dt) {
    if (!this.on) return;
    const g = this.g, m = this.mission, s = this.s;
    this.t += dt;
    this.progress = 0;
    this.hasF = false;
    if (this.state === 'brief') { if ((this.stateT -= dt) <= 0) this.state = 'active'; }
    else if (this.state === 'failed') { if ((this.stateT -= dt) <= 0) this.begin(this.i); return; }
    else if (this.state === 'break') { if ((this.stateT -= dt) <= 0) this.begin(this.i + 1); return; }
    else if (this.state === 'done') return;
    // the job, and the ones coming for you (only once it's on)
    const r = m.update(this, s, dt);
    for (const n of this.npcList || []) this.show(n, dt);
    this.npcs?.update(dt);
    const pp = g.player.pos;
    this.last = { x: pp.x, y: pp.y, z: pp.z };
    if (this.state !== 'active') return;
    if (r === 'won') { this.win(); return; }
    if (r) { this.fail(r); return; }
    if (m.limit && this.t > m.limit + 4) { this.fail('Out of time'); return; }
    const pr = s.pressure;
    if (pr) {
      this.spawnT = (this.spawnT ?? 1) - dt;
      if (this.spawnT <= 0 && g.zombies.alive < pr.max) { g.director.spawnOne(); this.spawnT = pr.every * (0.6 + Math.random() * 0.8); }
      // (up on the roof: the crows find you)
      if (pr.crows && g.player.roof) { this.crowT = (this.crowT ?? 8) - dt; if (this.crowT <= 0) { this.crowT = 12 + Math.random() * 6; g.director.spawnCrows(2 + Math.floor(Math.random() * 2)); } }
      // (from mission 3: a pack of dogs now and then)
      if (this.level >= 3) { this.dogT = (this.dogT ?? 25) - dt; if (this.dogT <= 0) { this.dogT = 30 + Math.random() * 20; g.director.spawnPack({ kind: 'dogs', n: Math.min(5, 2 + Math.floor(this.level / 3)) }); } }
    }
  }

  // the HUD's line: the goal, and the time left if there's a limit
  objective() {
    if (!this.on || !this.mission) return '';
    const m = this.mission;
    if (this.state === 'break') return `Next: ${MISSIONS[this.i + 1]?.title || ''} in ${clock(this.stateT)}`;
    if (this.state === 'failed' || this.state === 'done') return '';
    const left = m.limit ? ` · ${clock(m.limit + 4 - this.t)}` : '';
    return `${m.goal(this, this.s)}${left}`;
  }

  // The marker in your view: the nearest thing to head for; and when that's down in a car park
  // (or up on a roof) and you're not, the way there first: the ramp down, the stairs up.
  waypoint() {
    if (!this.on || this.state !== 'active' || !this.mission.aim) return null;
    const g = this.g, pl = g.player, p = pl.vehicle ? pl.vehicle.pos : pl.pos;
    let t = null, bd = Infinity;
    for (const q of this.mission.aim(this, this.s)) { const d = q ? Math.hypot(q.x - p.x, q.z - p.z) : Infinity; if (d < bd) { bd = d; t = q; } }
    if (!t) return null;
    const ty = t.y ?? g.hm.atWorld(t.x, t.z), U = g.underground;
    const via = (x, z, hint) => ({ x, y: g.hm.atWorld(x, z), z, hint, far: Math.hypot(x - p.x, z - p.z) });
    const uT = U && U.at(t.x, t.z, ty + 0.1), uP = U && !pl.vehicle && U.at(p.x, p.z, p.y + 0.1);
    if (uP && uT !== uP) { const d = U.nearestDoor(uP, p.x, p.z); return via(d.out.x, d.out.z, 'out of the car park'); }
    if (uT && !uP) {
      const cost = (q) => Math.hypot(q.out.x - p.x, q.out.z - p.z) + Math.hypot(q.in.x - t.x, q.in.z - t.z);
      const d = uT.doors.reduce((a, q) => (cost(q) < cost(a) ? q : a));
      return via(d.out.x, d.out.z, 'ramp down');
    }
    // (a roof is several pieces: the same roof is up there at the same height)
    const upT = ty > 2, upP = !!pl.roof && !pl.vehicle;
    const stairAt = (x, z, y, ro) => ro?.stair || (g.stairs?.list || []).filter((q) => Math.abs(q.top - y) < 2)
      .reduce((a, q) => (!a || Math.hypot(q.roof.x - x, q.roof.z - z) < Math.hypot(a.roof.x - x, a.roof.z - z) ? q : a), null);
    if (upP && !(upT && Math.abs(ty - p.y) < 2)) {
      const st = stairAt(p.x, p.z, p.y, pl.roof);
      if (st) return { x: st.roof.x, y: st.top, z: st.roof.z, hint: 'stairs down', far: Math.hypot(st.roof.x - p.x, st.roof.z - p.z) };
    }
    if (upT && !upP) {
      const st = stairAt(t.x, t.z, ty, pl.roofObj(t.x, t.z)), ds = st ? st.doors.filter((d) => !d.blocked) : [];
      const d = ds.reduce((a, q) => (Math.hypot(q.x - p.x, q.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z) ? q : a), ds[0]);
      if (d) return via(d.x, d.z, 'stairs up');
    }
    return { x: t.x, y: ty, z: t.z, hint: '', far: bd };
  }

  // on the map: where the job is, each flag named (and where it is: down in a car park, up on a
  // roof), and the way in to it marked
  markers() {
    if (!this.on || this.state === 'break' || this.state === 'done') return [];
    const s = this.s || {}, out = [], g = this.g;
    const where = (p) => (g.underground?.at(p.x, p.z, (p.y ?? 0) + 0.1) ? ' · car park' : (p.y ?? 0) > 2 ? ' · on the roof' : '');
    const add = (p, label) => p && out.push({ x: p.x, z: p.z, color: '#ffd23f', icon: 'goal', goal: true, label: label + where(p) });
    if (s.zone) add(s.zone, 'Hold here');
    if (s.crate) { if (s.crate.held) add(s.to, 'Pool house'); else add(s.crate, 'Medical crate'); }
    for (const j of s.jobs || []) if (!j.done) add(j, 'Generator');
    if (s.giant && s.giant.state !== 'dead') add(s.giant.pos, 'The giant');
    for (const n of this.npcList || []) if (!n.dead) add(n, n.name);
    for (const c of s.cans || []) if (!c.done && !c.held) add(c, 'Fuel can');
    if ((s.cans || []).some((c) => c.held)) add(s.to, 'The van');
    if (s.nino && s.nino.following) add(s.to, 'Pool house');
    if (s.tamar) add(s.to, 'Pool house');
    if (s.horde) {
      const left = s.horde.filter((z) => z.state !== 'dead'), p = g.player.pos;
      for (const z of left) out.push({ x: z.pos.x, z: z.pos.z, color: '#ffd23f', size: 0.6 });
      // (and a flag on the nearest)
      add(left.reduce((a, z) => (!a || Math.hypot(z.pos.x - p.x, z.pos.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z) ? z.pos : a), null), `${left.length} left`);
    }
    if (s.fix) { if (s.fix.done) add(s.out, 'Gate 1: drive out'); else add(s.fix, 'The van'); }
    // (the way in: the ramp down, the stairs up)
    const w = this.waypoint();
    if (w && w.hint) out.push({ x: w.x, z: w.z, color: '#ffd23f', via: true, label: w.hint });
    return out;
  }

  // for the big map: which mission, its goal now, and the brief (in the break: the next one)
  info() {
    if (!this.on || !this.mission || this.state === 'done') return null;
    const next = this.state === 'break' && MISSIONS[this.i + 1];
    const m = next || this.mission, n = next ? this.level + 1 : this.level;
    return { title: `Mission ${n} of ${MISSIONS.length} · ${m.title}`, goal: this.objective(), brief: m.brief };
  }
}
