// The wire format for the fast messages (unreliable channel), packed by hand into ArrayBuffers:
//  - inputs, client -> host, every tick (60 Hz), each packet repeating the last few ticks so a
//    lost packet costs nothing
//  - snapshots, host -> client, every other tick (30 Hz): every player and the zombies near you
// Events that must arrive (a kill, a purchase, the end of the match) go as JSON on the reliable
// channel instead.

import { DEFS } from '../game/weapons.js';
import { TYPES } from '../game/zombies.js';

export const TICK_HZ = 60;
export const TICK = 1 / TICK_HZ;
export const TICK_MS = 1000 / TICK_HZ;
export const SNAP_EVERY = 2;            // snapshots at 30 Hz
export const INPUT_REDUNDANCY = 5;      // ticks repeated in each input packet
export const MAX_SNAP_ZOMBIES = 72;

export const MSG = { INPUT: 1, SNAP: 2 };

// keyboard state of one tick
export const BTN = { fwd: 1, back: 2, left: 4, right: 8, jump: 16, crouch: 32, sprint: 64 };
const CODE_BITS = {
  KeyW: BTN.fwd, ArrowUp: BTN.fwd, KeyS: BTN.back, ArrowDown: BTN.back, KeyA: BTN.left, ArrowLeft: BTN.left,
  KeyD: BTN.right, ArrowRight: BTN.right, Space: BTN.jump, KeyC: BTN.crouch, ShiftLeft: BTN.sprint,
};

// What Player.update() reads from an input, replayed from a recorded tick.
export class TickInput {
  constructor() {
    this.bits = 0;
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, wheel: 0 };
  }
  set(bits) { this.bits = bits; return this; }
  down(code) { const b = CODE_BITS[code]; return !!b && b !== BTN.jump && (this.bits & b) !== 0; }
  hit(code) { return code === 'Space' && (this.bits & BTN.jump) !== 0; }
}

export function bitsFrom(input, jump) {
  let b = 0;
  if (input.down('KeyW') || input.down('ArrowUp')) b |= BTN.fwd;
  if (input.down('KeyS') || input.down('ArrowDown')) b |= BTN.back;
  if (input.down('KeyA') || input.down('ArrowLeft')) b |= BTN.left;
  if (input.down('KeyD') || input.down('ArrowRight')) b |= BTN.right;
  if (input.down('KeyC')) b |= BTN.crouch;
  if (input.down('ShiftLeft')) b |= BTN.sprint;
  if (jump) b |= BTN.jump;
  return b;
}

export const WEAPONS = Object.keys(DEFS);
export const ZTYPES = Object.keys(TYPES);
export const ZSTATES = ['chase', 'attack', 'scream', 'dead', 'climb', 'circle', 'dive', 'away'];

const TAU = Math.PI * 2;
const wrap = (a) => ((a % TAU) + TAU) % TAU;
const clamp16 = (v) => Math.max(-32767, Math.min(32767, Math.round(v)));

// ---------------------------------------------------------------- inputs
// [u8 type][u8 n] then n x { u32 seq, u16 bits, f32 yaw, i16 pitch, u8 ads, u8 weapon, u16 stairs }
const CMD_BYTES = 4 + 2 + 4 + 2 + 1 + 1 + 2;

export function encodeInputs(cmds) {
  const buf = new ArrayBuffer(2 + cmds.length * CMD_BYTES), v = new DataView(buf);
  v.setUint8(0, MSG.INPUT); v.setUint8(1, cmds.length);
  let o = 2;
  for (const c of cmds) {
    v.setUint32(o, c.seq); o += 4;
    v.setUint16(o, c.bits); o += 2;
    v.setFloat32(o, c.yaw); o += 4;
    v.setInt16(o, clamp16(c.pitch * 10000)); o += 2;
    v.setUint8(o, Math.round(Math.max(0, Math.min(1, c.ads)) * 255)); o += 1;
    v.setUint8(o, c.weapon); o += 1;
    v.setUint16(o, c.stairs ?? 0xffff); o += 2;
  }
  return buf;
}

export function decodeInputs(buf) {
  const v = new DataView(buf), n = v.getUint8(1), out = [];
  let o = 2;
  for (let i = 0; i < n && o + CMD_BYTES <= buf.byteLength; i++) {
    const seq = v.getUint32(o); o += 4;
    const bits = v.getUint16(o); o += 2;
    const yaw = v.getFloat32(o); o += 4;
    const pitch = v.getInt16(o) / 10000; o += 2;
    const ads = v.getUint8(o) / 255; o += 1;
    const weapon = v.getUint8(o); o += 1;
    const stairs = v.getUint16(o); o += 2;
    out.push({ seq, bits, yaw, pitch, ads, weapon, stairs: stairs === 0xffff ? null : stairs });
  }
  return out;
}

// ---------------------------------------------------------------- snapshots
// header: u8 type, u32 tick, u32 ack, u32 msLeft, u16 wave, u8 flags, u8 nPlayers, u16 nZombies
// player: u8 slot, u8 flags, f32 x y z, i16 vx vy vz (cm/s), u16 yaw, i16 pitch, u8 crouch, u8 ads,
//         u16 health, u16 maxHealth, u8 weapon, u8 teleport, u8 speedMul, u8 respawn (s)
// zombie: u16 nid, u8 type, u8 variant, u8 state, i16 x y z (2 cm), u8 heading, u8 rate, i8 extra,
//         u8 scale, u8 flags
const HEAD_BYTES = 1 + 4 + 4 + 4 + 2 + 1 + 1 + 2;
const PLAYER_BYTES = 1 + 1 + 12 + 6 + 2 + 2 + 1 + 1 + 2 + 2 + 1 + 1 + 1 + 1;
const ZOMBIE_BYTES = 2 + 1 + 1 + 1 + 6 + 1 + 1 + 1 + 1 + 1;
export const PF = { dead: 1, onGround: 2, sprint: 4, inWater: 8, fire: 16, reload: 32, roof: 64 };
export const ZF = { hidden: 1, hit: 2, buff: 4, fuse: 8 };
export const SF = { intermission: 1, over: 2 };

export function encodeSnapshot(s) {
  const zs = s.zombies;
  const buf = new ArrayBuffer(HEAD_BYTES + s.players.length * PLAYER_BYTES + zs.length * ZOMBIE_BYTES), v = new DataView(buf);
  let o = 0;
  v.setUint8(o, MSG.SNAP); o += 1;
  v.setUint32(o, s.tick); o += 4;
  v.setUint32(o, s.ack); o += 4;
  v.setUint32(o, Math.max(0, Math.round(s.msLeft))); o += 4;
  v.setUint16(o, s.wave); o += 2;
  v.setUint8(o, s.flags); o += 1;
  v.setUint8(o, s.players.length); o += 1;
  v.setUint16(o, zs.length); o += 2;
  for (const p of s.players) {
    v.setUint8(o, p.slot); o += 1;
    v.setUint8(o, p.flags); o += 1;
    v.setFloat32(o, p.x); v.setFloat32(o + 4, p.y); v.setFloat32(o + 8, p.z); o += 12;
    v.setInt16(o, clamp16(p.vx * 100)); v.setInt16(o + 2, clamp16(p.vy * 100)); v.setInt16(o + 4, clamp16(p.vz * 100)); o += 6;
    v.setUint16(o, Math.round((wrap(p.yaw) / TAU) * 65535)); o += 2;
    v.setInt16(o, clamp16(p.pitch * 10000)); o += 2;
    v.setUint8(o, Math.round(Math.max(0, Math.min(1, p.crouch)) * 255)); o += 1;
    v.setUint8(o, Math.round(Math.max(0, Math.min(1, p.ads)) * 255)); o += 1;
    v.setUint16(o, Math.round(Math.max(0, p.health) * 100)); o += 2;
    v.setUint16(o, Math.round(p.maxHealth * 100)); o += 2;
    v.setUint8(o, p.weapon); o += 1;
    v.setUint8(o, p.teleport & 255); o += 1;
    v.setUint8(o, Math.round(p.speedMul * 100)); o += 1;
    v.setUint8(o, Math.min(255, Math.ceil(p.respawn || 0))); o += 1;
  }
  for (const z of zs) {
    v.setUint16(o, z.nid); o += 2;
    v.setUint8(o, z.type); o += 1;
    v.setUint8(o, z.variant); o += 1;
    v.setUint8(o, z.state); o += 1;
    v.setInt16(o, clamp16(z.x * 50)); v.setInt16(o + 2, clamp16(z.y * 50)); v.setInt16(o + 4, clamp16(z.z * 50)); o += 6;
    v.setUint8(o, Math.round((wrap(z.heading) / TAU) * 256) & 255); o += 1;
    v.setUint8(o, Math.max(0, Math.min(255, Math.round(z.rate * 64)))); o += 1;
    v.setInt8(o, Math.max(-127, Math.min(127, Math.round(z.extra * 100)))); o += 1;
    v.setUint8(o, Math.max(0, Math.min(255, Math.round(z.scale * 100)))); o += 1;
    v.setUint8(o, z.flags); o += 1;
  }
  return buf;
}

export function decodeSnapshot(buf) {
  const v = new DataView(buf);
  let o = 1;
  const s = { tick: v.getUint32(o), ack: v.getUint32(o + 4), msLeft: v.getUint32(o + 8), wave: v.getUint16(o + 12), flags: v.getUint8(o + 14), players: [], zombies: [] };
  const np = v.getUint8(o + 15), nz = v.getUint16(o + 16);
  o = HEAD_BYTES;
  for (let i = 0; i < np; i++) {
    const p = { slot: v.getUint8(o), flags: v.getUint8(o + 1) };
    o += 2;
    p.x = v.getFloat32(o); p.y = v.getFloat32(o + 4); p.z = v.getFloat32(o + 8); o += 12;
    p.vx = v.getInt16(o) / 100; p.vy = v.getInt16(o + 2) / 100; p.vz = v.getInt16(o + 4) / 100; o += 6;
    p.yaw = (v.getUint16(o) / 65535) * TAU; o += 2;
    p.pitch = v.getInt16(o) / 10000; o += 2;
    p.crouch = v.getUint8(o) / 255; o += 1;
    p.ads = v.getUint8(o) / 255; o += 1;
    p.health = v.getUint16(o) / 100; o += 2;
    p.maxHealth = v.getUint16(o) / 100; o += 2;
    p.weapon = v.getUint8(o); o += 1;
    p.teleport = v.getUint8(o); o += 1;
    p.speedMul = v.getUint8(o) / 100; o += 1;
    p.respawn = v.getUint8(o); o += 1;
    s.players.push(p);
  }
  for (let i = 0; i < nz; i++) {
    const z = { nid: v.getUint16(o), type: v.getUint8(o + 2), variant: v.getUint8(o + 3), state: v.getUint8(o + 4) };
    o += 5;
    z.x = v.getInt16(o) / 50; z.y = v.getInt16(o + 2) / 50; z.z = v.getInt16(o + 4) / 50; o += 6;
    z.heading = (v.getUint8(o) / 256) * TAU; o += 1;
    z.rate = v.getUint8(o) / 64; o += 1;
    z.extra = v.getInt8(o) / 100; o += 1;
    z.scale = v.getUint8(o) / 100; o += 1;
    z.flags = v.getUint8(o); o += 1;
    s.zombies.push(z);
  }
  return s;
}

export const kindOf = (buf) => new DataView(buf).getUint8(0);
