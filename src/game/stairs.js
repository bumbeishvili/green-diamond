import { pointInPoly } from '../world/geom.js';

// Stairwells. Every block with a roof housing has stairs from its lobby doors up to a door in the
// housing on the roof. Stand at a lobby door (or at the roof door) and press F. The zombies use the
// same stairs: if you camp on a roof they come in through the lobby and out of the roof door.
// Coming down you come out where you went in (a trip up from somewhere else: any open door).
export class Stairs {
  constructor(game, raw) {
    this.g = game;
    this.list = raw.filter((s) => s.doors.length).map((s) => {
      const rx = s.roof.x, rz = -s.roof.y, hx = s.housing.x, hz = -s.housing.y;
      return {
        id: s.id, levels: s.levels, top: s.top,
        roof: { x: rx, z: rz },
        face: Math.atan2(-(rx - hx), -(rz - hz)),     // look away from the housing when you arrive
        doors: s.doors.map((d) => ({
          x: d.x + Math.cos(d.h) * 1.5, z: -(d.y + Math.sin(d.h) * 1.5),
          yaw: Math.atan2(-Math.cos(d.h), Math.sin(d.h)), // look out of the lobby
        })),
      };
    });
    // A door whose way out is inside a building (a tower's lobby opening into its podium, say)
    // would shut you in behind walls: move it out to the nearest open ground.
    for (const s of this.list) for (const d of s.doors) this.clearOut(d);
    this.byId = new Map(this.list.map((s) => [s.id, s]));
    this.fade = document.getElementById('fade');
    this.busyT = 0;
    this.pending = null;
  }

  clearOut(d) {
    const g = this.g, blds = g.level.buildings;
    const free = (x, z) => {
      if (blds.some((b) => b.poly && pointInPoly(x, -z, b.poly.outer))) return false;
      if (g.nav && !g.nav.walkable(x, z)) return false;
      const y = g.hm.atWorld(x, z);
      return !g.colliders.resolve({ x, z }, 0.45, y + 0.25, y + 1.8, 1);
    };
    if (free(d.x, d.z)) return;
    for (let r = 0.5; r <= 12; r += 0.5) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, x = d.x + Math.cos(a) * r, z = d.z + Math.sin(a) * r;
        if (!free(x, z)) continue;
        d.yaw = Math.atan2(-(x - d.x), -(z - d.z));   // facing away from where the door was
        d.x = x; d.z = z; d.moved = r;
        return;
      }
    }
    d.blocked = true;   // nowhere to come out: this door is never used
  }

  // The stairwell you're standing at, if any: {s, down, door}
  near() {
    const g = this.g, p = g.player;
    if (p.vehicle || p.dead) return null;
    if (p.roof) {
      const s = p.roof.stair;
      if (s && Math.hypot(s.roof.x - p.pos.x, s.roof.z - p.pos.z) < 1.9) return { s, down: true };
      return null;
    }
    for (const s of this.list) {
      for (const d of s.doors) {
        if (d.blocked || Math.abs(d.x - p.pos.x) > 2 || Math.abs(d.z - p.pos.z) > 2) continue;
        if (Math.hypot(d.x - p.pos.x, d.z - p.pos.z) < 1.9 && Math.abs(p.pos.y - g.hm.atWorld(d.x, d.z)) < 1.2) return { s, down: false, door: d };
      }
    }
    return null;
  }

  update(dt, input, playing) {
    if (this.busyT > 0) {
      this.busyT -= dt;
      if (this.pending && this.busyT < 0.4) this.teleport();
      if (this.busyT <= 0) this.fade?.classList.remove('on');
      return;
    }
    if (!playing) return;
    const n = this.near();
    if (!n || this.g.director.nearestStation()) return;
    this.g.hud.prompt(n.down ? 'Press <b>F</b> — take the stairs down' : `Press <b>F</b> — take the stairs up to the roof (${n.s.levels} floors)`, 2);
    if (input.hit('KeyF')) { input.pressed.delete('KeyF'); this.go(n); }
  }

  go(n) {
    this.pending = n;
    // (going up: remember the door, to come back down through it)
    if (!n.down) this.cameUp = { s: n.s, door: n.s.doors.indexOf(n.door) };
    this.busyT = 0.8;
    this.fade?.classList.add('on');
    const a = this.g.audio;
    for (let i = 0; i < 4; i++) setTimeout(() => a.play('step', { vol: 0.3, rate: 1.1 }), i * 110);
  }

  teleport() {
    const { s, down } = this.pending, g = this.g;
    this.pending = null;
    // going down: out of the door you came up through, else any open one; going up: the roof door
    let door = 0;
    if (down) {
      const open = s.doors.map((d, i) => i).filter((i) => !s.doors[i].blocked);
      door = this.cameUp && this.cameUp.s === s && open.includes(this.cameUp.door) ? this.cameUp.door : open[Math.floor(Math.random() * open.length)] ?? 0;
    }
    const code = this.code(s, down, door);
    // co-op client: the move is part of the next input tick, so the host makes the same one
    if (g.mode === 'client') g.net.queueStairs(code);
    else this.applyCode(g.player, code);
  }

  // one number for a stairs trip: which stairwell, which way, which door
  code(s, down, door) { return (this.list.indexOf(s) << 5) | (down ? 16 : 0) | (door & 15); }

  applyCode(p, code) {
    const g = this.g, s = this.list[code >> 5];
    if (!s) return;
    if (code & 16) {
      const d = s.doors[(code & 15) % s.doors.length];
      p.pos.set(d.x, g.hm.atWorld(d.x, d.z), d.z);
      p.yaw = d.yaw;
    } else {
      p.pos.set(s.roof.x, s.top, s.roof.z);
      p.yaw = s.face;
    }
    p.pitch = 0;
    p.vel.set(0, 0, 0);
    p.viewY = p.pos.y;
    p.onGround = true;
  }

  // lobby doors with stairs, for the big map
  markers() {
    const m = [];
    for (const s of this.list) for (const d of s.doors) m.push({ x: d.x, z: d.z, color: '#e8eef2', shape: 'square', bigOnly: true, icon: 'stairs' });
    return m;
  }
}
