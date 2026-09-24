import { readRoom, sigPath, validKey, validId, json, body, fail } from './_lib/room.js';
import { store, Conflict } from './_lib/store.js';

// WebRTC handshake messages. Offers go client -> host, answers host -> client, each as one blob
// with the complete SDP (ICE gathered first, no trickle: one write per side keeps the storage
// operations down). Only members of the room may post.
//   POST /api/signal {room, from, to, kind: 'offer'|'answer', sdp}
//   GET  /api/signal?room=&to=&kind=&from=      -> {sdp} or 204 (not there yet)
export default {
  async fetch(request) {
    try {
      if (request.method === 'POST') return await post(request);
      if (request.method === 'GET') return await read(request);
      return json({ error: 'GET or POST' }, 405);
    } catch (e) { return fail(e); }
  },
};

async function post(request) {
  const b = await body(request);
  if (!b || !validKey(b.room) || !validId(b.from) || !validId(b.to) || !['offer', 'answer'].includes(b.kind) || typeof b.sdp !== 'string' || b.sdp.length > 20000) {
    return json({ error: 'Bad signal' }, 400);
  }
  const room = await readRoom(b.room);
  const ids = new Set((room && room.members || []).map((m) => m.id));
  if (!ids.has(b.from) || !ids.has(b.to)) return json({ error: 'Not in this room (it may have ended).', gone: true }, 410);
  // offers only go to the host, answers only come from it
  if ((b.kind === 'offer') !== (b.to === room.hostId) || (b.kind === 'answer') !== (b.from === room.hostId)) return json({ error: 'Wrong direction' }, 400);
  try {
    await store().write(sigPath(b.room, b.to, b.kind, b.from), { sdp: b.sdp, at: Date.now() });
  } catch (e) {
    if (!(e instanceof Conflict)) throw e;
    return json({ error: 'Already sent' }, 409);
  }
  return json({ ok: true });
}

async function read(request) {
  const q = new URL(request.url).searchParams;
  const room = q.get('room'), to = q.get('to'), from = q.get('from'), kind = q.get('kind');
  if (!validKey(room) || !validId(to) || !validId(from) || !['offer', 'answer'].includes(kind)) return json({ error: 'Bad request' }, 400);
  const r = await store().read(sigPath(room, to, kind, from));
  if (!r) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  return json({ sdp: r.data.sdp });
}
