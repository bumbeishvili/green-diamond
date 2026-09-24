// Stairwells. Every block with a roof housing has stairs from its lobby doors up to a door in the
// housing on the roof. Stand at a lobby door (or at the roof door) and press F. The zombies use the
// same stairs: if you camp on a roof they come in through the lobby and out of the roof door.
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
    this.byId = new Map(this.list.map((s) => [s.id, s]));
    this.fade = document.getElementById('fade');
    this.busyT = 0;
    this.pending = null;
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
        if (Math.abs(d.x - p.pos.x) > 2 || Math.abs(d.z - p.pos.z) > 2) continue;
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
    this.busyT = 0.8;
    this.fade?.classList.add('on');
    const a = this.g.audio;
    for (let i = 0; i < 4; i++) setTimeout(() => a.play('step', { vol: 0.3, rate: 1.1 }), i * 110);
  }

  teleport() {
    const { s, down } = this.pending, g = this.g;
    this.pending = null;
    // come out of a random lobby door (going down), or the roof door
    const code = this.code(s, down, Math.floor(Math.random() * s.doors.length));
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
    for (const s of this.list) for (const d of s.doors) m.push({ x: d.x, z: d.z, color: '#e8eef2', shape: 'square', bigOnly: true });
    return m;
  }
}
