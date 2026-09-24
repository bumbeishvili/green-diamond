import { readRoom, sigPath, validKey, validId, json, fail } from './_lib/room.js';
import { store } from './_lib/store.js';

// The host's view while players join: the room's members, and the offers waiting from members it
// isn't connected to yet. The host polls this only while the room has space and someone may join.
//   GET /api/inbox?room=&host=&have=id1,id2   -> {players:[...], offers:[{from, sdp}], gone?}
export default {
  async fetch(request) {
    try {
      const q = new URL(request.url).searchParams;
      const key = q.get('room'), host = q.get('host');
      if (!validKey(key) || !validId(host)) return json({ error: 'Bad request' }, 400);
      const have = new Set((q.get('have') || '').split(',').filter(validId));
      const room = await readRoom(key);
      if (!room || room.hostId !== host) return json({ error: 'This room has ended.', gone: true }, 410);
      const waiting = room.members.filter((m) => m.id !== host && !have.has(m.id));
      const offers = [];
      for (const m of waiting) {
        const r = await store().read(sigPath(key, host, 'offer', m.id));
        if (r) offers.push({ from: m.id, sdp: r.data.sdp });
      }
      return json({ players: room.members.map((m) => ({ id: m.id, slot: m.slot })), offers });
    } catch (e) { return fail(e); }
  },
};
