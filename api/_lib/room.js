import { createHash, createHmac, randomBytes } from 'node:crypto';
import { store, Conflict } from './store.js';

// Rooms: one blob per room holding its members, plus one short-lived blob per offer/answer.
//   rooms/<key>/room.json                  {v, created, touched, hostId, members:[{id, slot, joined}]}
//   rooms/<key>/sig/<to>.<kind>.<from>.json {sdp, at}
// The key is a keyed hash of the password; the plaintext password is never stored or logged.

export const MAX_PLAYERS = 4;
export const STALE_MS = 2 * 60 * 60 * 1000;   // a room untouched for 2 hours starts over
export const HOST_TIMEOUT_MS = 15000;         // an offer unanswered this long: the host is gone
export const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function roomKey(password) {
  const secret = process.env.ROOM_SECRET;
  const h = secret ? createHmac('sha256', secret).update(password, 'utf8') : createHash('sha256').update(`green-diamond/rooms/v1/${password}`, 'utf8');
  return h.digest('hex').slice(0, 40);
}

export const newId = () => randomBytes(9).toString('base64url');
export const roomPath = (key) => `rooms/${key}/room.json`;
export const sigPath = (key, to, kind, from) => `rooms/${key}/sig/${to}.${kind}.${from}.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const validKey = (k) => typeof k === 'string' && /^[0-9a-f]{40}$/.test(k);
export const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,24}$/.test(id);

export async function readRoom(key) {
  const r = await store().read(roomPath(key));
  return r ? r.data : null;
}

// Read-modify-write on the room blob, retried when another instance wrote in between.
// fn(room|null) returns the new room, null to delete it, or undefined to leave it alone.
export async function updateRoom(key, fn, tries = 8) {
  const s = store();
  for (let i = 0; i < tries; i++) {
    const cur = await s.read(roomPath(key));
    const next = fn(cur ? structuredClone(cur.data) : null);
    if (next === undefined) return cur ? cur.data : null;
    try {
      if (next === null) { if (cur) await s.remove(roomPath(key)); return null; }
      next.touched = Date.now();
      await s.write(roomPath(key), next, cur ? cur.etag : null);
      return next;
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
      await sleep(25 + Math.random() * 100 * (i + 1));
    }
  }
  throw Object.assign(new Error('The room is busy, try again.'), { status: 503 });
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function body(request) {
  try {
    const t = await request.text();
    return t ? JSON.parse(t) : {};
  } catch { return null; }
}

export function fail(e) {
  console.error(e);
  if (/no blob credentials/i.test(e && e.message)) {
    return json({ error: 'Multiplayer isn\'t set up on this deployment yet: its Vercel project needs a private Blob store connected (Storage, then Blob), then a redeploy.' }, 503);
  }
  return json({ error: e.status ? e.message : 'Server error' }, e.status || 500);
}
