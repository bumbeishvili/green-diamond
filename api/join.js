import { MAX_PLAYERS, STALE_MS, HOST_TIMEOUT_MS, ICE_SERVERS, roomKey, newId, updateRoom, readRoom, sigPath, validId, json, body, fail } from './_lib/room.js';
import { store } from './_lib/store.js';

// POST /api/join {password}  ->  {room, id, slot, role, hostId, players, iceServers}
// Same password = same room. The first player in is the host; up to 4 players; a full room is
// refused with a clear message. {password, hostGone: <hostId>} lets a player whose offer the host
// never answered start the room over (checked against the stored offer, see below).
export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
    const b = await body(request);
    const password = b && b.password;
    if (typeof password !== 'string' || !password.length || password.length > 128) return json({ error: 'Enter a password (1 to 128 characters).' }, 400);
    try {
      const key = roomKey(password);
      if (b.hostGone && validId(b.hostGone) && validId(b.me)) await resetIfHostGone(key, b.hostGone, b.me);
      const id = newId();
      let full = false;
      const room = await updateRoom(key, (r) => {
        const now = Date.now();
        if (!r || !r.members || !r.members.length || now - r.touched > STALE_MS) r = { v: 1, created: now, touched: now, hostId: null, members: [] };
        if (r.members.length >= MAX_PLAYERS) { full = true; return undefined; }
        const used = new Set(r.members.map((m) => m.slot));
        let slot = 0;
        while (used.has(slot)) slot++;
        r.members.push({ id, slot, joined: now });
        if (!r.hostId) r.hostId = id;
        return r;
      });
      if (full) return json({ error: `This room is full (${MAX_PLAYERS} players). Try again later, or use another password.`, full: true }, 409);
      const me = room.members.find((m) => m.id === id);
      return json({
        room: key, id, slot: me.slot, role: room.hostId === id ? 'host' : 'client', hostId: room.hostId,
        players: room.members.map((m) => ({ id: m.id, slot: m.slot })), iceServers: ICE_SERVERS,
      });
    } catch (e) { return fail(e); }
  },
};

// A client posted an offer, and the host never answered it: if that's still the case after
// HOST_TIMEOUT_MS, the host is gone (closed the tab without saying so) and the room starts over.
async function resetIfHostGone(key, hostId, me) {
  const s = store();
  const room = await readRoom(key);
  if (!room || room.hostId !== hostId) return;
  const offer = await s.read(sigPath(key, hostId, 'offer', me));
  if (!offer || Date.now() - offer.data.at < HOST_TIMEOUT_MS) return;
  const answer = await s.read(sigPath(key, me, 'answer', hostId));
  if (answer) return;
  await updateRoom(key, (r) => (r && r.hostId === hostId ? null : undefined));
  await s.remove([sigPath(key, hostId, 'offer', me)]);
}
