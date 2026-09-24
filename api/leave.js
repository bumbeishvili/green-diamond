import { updateRoom, sigPath, validKey, validId, json, body, fail } from './_lib/room.js';
import { store } from './_lib/store.js';

// POST /api/leave {room, id, by?}
// A player leaving takes their place back. When the host leaves, the room is over and deleted.
// The host may also remove a player who never connected or dropped out (by = hostId). Works with
// navigator.sendBeacon (text/plain body) so closing the tab still frees the place.
export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
    const b = await body(request);
    if (!b || !validKey(b.room) || !validId(b.id) || (b.by && !validId(b.by))) return json({ error: 'Bad request' }, 400);
    try {
      let hostId = null, gone = [];
      await updateRoom(b.room, (r) => {
        if (!r) return undefined;
        hostId = r.hostId;
        if (b.by && b.by !== r.hostId) return undefined;           // only the host removes others
        if (b.id === r.hostId) { gone = r.members.map((m) => m.id); return null; }
        if (!r.members.some((m) => m.id === b.id)) return undefined;
        r.members = r.members.filter((m) => m.id !== b.id);
        gone = [b.id];
        return r;
      });
      // tidy the handshake blobs of whoever left (deletes are free)
      if (hostId && gone.length) {
        const paths = [];
        for (const id of gone) if (id !== hostId) paths.push(sigPath(b.room, hostId, 'offer', id), sigPath(b.room, id, 'answer', hostId));
        await store().remove(paths);
      }
      return json({ ok: true });
    } catch (e) { return fail(e); }
  },
};
