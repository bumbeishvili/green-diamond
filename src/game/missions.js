// Missions: the waves as jobs, each with a goal on the HUD and on the map, and a beam of light over
// wherever it is. None of them can be done just by running: you hold ground, carry things (no
// running, no shooting, both hands), or stand and work at something while they come for you. Die,
// or fail the job, and the mission starts over from its beginning: nobody comes back to carry on.
import * as THREE from 'three';
import { pointInPoly } from '../world/geom.js';

const GOLD = 0xffd23f;
const BREAK_S = 12;          // between missions: the shops are open
const clock = (s) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

// The missions. start: where you begin (a place, metres off it, facing it); setup: the job's state;
// update: 'won', a reason it failed, or nothing yet; goal: the line on the HUD.
const MISSIONS = [
  {
    title: 'Hold the pool house',
    brief: 'Stand your ground by the pool house for 45 seconds. The clock only runs while you’re there.',
    start: { at: 'pool', off: [0, -16] },
    setup(M, s) { s.zone = M.zone(M.at('pool'), 8, 45); s.pressure = { every: 1.5, max: 12 }; },
    update(M, s, dt) { return M.hold(s.zone, dt) ? 'won' : null; },
    goal: (M, s) => `Hold the pool house: ${clock(s.zone.need - s.zone.have)} to go${s.zone.inside ? '' : ' · get back in the ring!'}`,
  },
  {
    title: 'Supply run',
    brief: 'The medical crate is at Spar. Bring it back to the pool house: you can’t run or shoot while you carry it. Put it down (F) to fight.',
    start: { at: 'pool', off: [0, -6] },
    limit: 240,
    setup(M, s) { s.crate = M.crate(M.open(M.at('spar', [1.8, 1.8])), 'the medical crate'); s.to = M.zone(M.at('pool'), 5, 0); s.pressure = { every: 1.4, max: 14 }; },
    update(M, s) { return M.delivered(s.crate, s.to) ? 'won' : null; },
    goal: (M, s) => (s.crate.held ? 'Carry the crate to the pool house' : s.crate.moved ? 'Pick the crate back up (F)' : 'Get the medical crate from Spar'),
  },
  {
    title: 'Lights on',
    brief: 'Night’s come early. Restart the three generators down in the car parks: hold F at each till it runs. Get hit and you start that one again.',
    start: { at: 'pool', off: [0, -6] },
    hour: 21.2, limit: 420,
    setup(M, s) { s.jobs = ['middle', 'north', 'south'].map((name) => M.job(M.at(`park:${name}`), 10, 'the generator')).filter(Boolean); s.pressure = { every: 1.3, max: 16 }; },
    update(M, s, dt) { for (const j of s.jobs) M.work(j, dt); return s.jobs.every((j) => j.done) ? 'won' : null; },
    goal: (M, s) => `Restart the generators: ${s.jobs.filter((j) => j.done).length} of ${s.jobs.length} running`,
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
    goal: (M, s) => (s.giant ? `Bring down the giant: ${Math.round(Math.max(0, s.giant.hp / s.giant.maxHp) * 100)}% left` : 'A giant’s coming…'),
  },
];
export const MISSION_COUNT = MISSIONS.length;

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
    const ok = (x, z) => {
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
  crate(p, name) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd81f26, roughness: 0.6 });
    const m = new THREE.Group();
    m.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.42), mat));
    for (const [w, h, d, z] of [[0.3, 0.09, 0.01, 0.216], [0.09, 0.3, 0.01, 0.216], [0.3, 0.09, 0.01, -0.216], [0.09, 0.3, 0.01, -0.216]]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), red); c.position.z = z; m.add(c);
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
  job(p, need, name) {
    if (!p) return null;
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a6a3a, roughness: 0.7, metalness: 0.2 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.7), mat);
    m.position.set(p.x, p.y + 0.45, p.z);
    m.castShadow = true;
    this.g.scene.add(m);
    this.things.push(m);
    // (solid: once for each place; the colliders are for good)
    const key = `${p.x.toFixed(1)},${p.z.toFixed(1)}`;
    if (!(this.solid ||= new Set()).has(key)) { this.solid.add(key); this.g.colliders.addBox(p.x, p.z, 0.6, 0.35, 0, { height: p.y + 0.9, minY: p.y - 0.2, kind: 'crate' }); }
    return { ...p, need, have: 0, done: false, name, mesh: m, beam: this.beam(p, p.y > -1) };
  }
  work(j, dt) {
    const g = this.g, pl = g.player;
    if (j.done) return;
    const near = !pl.dead && Math.hypot(pl.pos.x - j.x, pl.pos.z - j.z) < 2.3 && Math.abs(pl.pos.y - j.y) < 2;
    if (!near) { if (pl.workingOn === j) pl.working = false; return; }
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
      }
    } else if (pl.workingOn === j) pl.working = false;
    j.hp = pl.health;
    this.progress = j.have / j.need;
    g.hud.prompt(`Hold <b>F</b> — restart ${j.name} <b>${Math.round((j.have / j.need) * 100)}%</b>`, 4);
  }

  // ---- the flow ----

  start(i = 0) { this.on = true; this.begin(Math.max(0, Math.min(MISSIONS.length - 1, i))); }

  clearUp() {
    const g = this.g;
    for (const o of this.things) o.removeFromParent();
    this.things = [];
    g.player.carrying = false; g.player.working = false;
    g.zombies.clear();
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
    if (this.i + 1 >= MISSIONS.length) { this.state = 'done'; g.hud.banner('Missions done', `All ${MISSIONS.length} of them. +${bonus} points`); g.onVictory?.(); return; }
    this.state = 'break'; this.stateT = BREAK_S;
    g.hud.banner('Mission complete', `+${bonus} points. Next: ${MISSIONS[this.i + 1].title}. The shops are open`);
  }

  update(dt) {
    if (!this.on) return;
    const g = this.g, m = this.mission, s = this.s;
    this.t += dt;
    this.progress = 0;
    if (this.state === 'brief') { if ((this.stateT -= dt) <= 0) this.state = 'active'; }
    else if (this.state === 'failed') { if ((this.stateT -= dt) <= 0) this.begin(this.i); return; }
    else if (this.state === 'break') { if ((this.stateT -= dt) <= 0) this.begin(this.i + 1); return; }
    else if (this.state === 'done') return;
    // the job, and the ones coming for you (only once it's on)
    const r = m.update(this, s, dt);
    if (this.state !== 'active') return;
    if (r === 'won') { this.win(); return; }
    if (r) { this.fail(r); return; }
    if (m.limit && this.t > m.limit + 4) { this.fail('Out of time'); return; }
    const pr = s.pressure;
    if (pr) {
      this.spawnT = (this.spawnT ?? 1) - dt;
      if (this.spawnT <= 0 && g.zombies.alive < pr.max) { g.director.spawnOne(); this.spawnT = pr.every * (0.6 + Math.random() * 0.8); }
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

  // on the map: where the job is
  markers() {
    if (!this.on || this.state === 'break' || this.state === 'done') return [];
    const s = this.s || {}, out = [];
    const add = (p) => p && out.push({ x: p.x, z: p.z, color: '#ffd23f', icon: 'goal', station: true });
    if (s.zone) add(s.zone);
    if (s.crate) add(s.crate.held ? s.to : s.crate);
    for (const j of s.jobs || []) if (!j.done) add(j);
    if (s.giant && s.giant.state !== 'dead') add(s.giant.pos);
    return out;
  }
}
