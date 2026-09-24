import join from '../api/join.js';
import signal from '../api/signal.js';
import inbox from '../api/inbox.js';
import leave from '../api/leave.js';
import { setStore, Conflict } from '../api/_lib/store.js';
import { validKey, validId, json } from '../api/_lib/room.js';

export { Room } from './room.js';

// The game on Cloudflare: the static files are served straight from Workers static assets; only
// /api/* runs here. The four handshake functions are the same ones Vercel runs (api/), with the
// room's Durable Object as their store instead of Blob, plus the host's doorbell (/api/bell).
const routes = { '/api/join': join, '/api/signal': signal, '/api/inbox': inbox, '/api/leave': leave };

export default {
  async fetch(request, env) {
    setStore(new RoomStore(env));      // (the same bindings for every request in this isolate)
    const url = new URL(request.url);
    if (url.pathname === '/api/bell') return bell(request, env, url);
    const h = routes[url.pathname];
    if (!h) return env.ASSETS.fetch(request);
    const res = await h.fetch(request);
    if (url.pathname !== '/api/join' || res.status !== 200) return res;
    // tell the players this server has a doorbell
    return json({ ...(await res.json()), bell: true });
  },
};

function bell(request, env, url) {
  if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'WebSocket only' }, 426);
  const room = url.searchParams.get('room'), host = url.searchParams.get('host');
  if (!validKey(room) || !validId(host)) return json({ error: 'Bad request' }, 400);
  return roomObject(env, room).fetch(request);
}

const roomObject = (env, key) => env.ROOMS.get(env.ROOMS.idFromName(key));

// The store api/ expects (see api/_lib/store.js), each path sent to its room's object:
// rooms/<key>/room.json, rooms/<key>/sig/<to>.<kind>.<from>.json
class RoomStore {
  constructor(env) { this.env = env; }
  at(path) { return roomObject(this.env, path.split('/')[1]); }
  read(path) { return this.at(path).read(path); }
  async write(path, data, etag = null) {
    const r = await this.at(path).write(path, data, etag);
    if (!r.ok) throw new Conflict('conflict');
    return r.etag;
  }
  async remove(paths) {
    const byRoom = new Map();
    for (const p of [].concat(paths)) {
      const k = p.split('/')[1];
      if (!byRoom.has(k)) byRoom.set(k, []);
      byRoom.get(k).push(p);
    }
    await Promise.all([...byRoom.values()].map((list) => this.at(list[0]).remove(list)));
  }
}
