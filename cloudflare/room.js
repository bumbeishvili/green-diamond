import { DurableObject } from 'cloudflare:workers';

// One Durable Object per room (named by the room key). It holds that room's handshake state, the
// same records Vercel keeps in Blob (the room, and each offer and answer), so the functions in api/
// run unchanged on top of it. Everything for one room goes through this one object, one call at a
// time, so the conditional writes can't race.
//
// It is also the host's doorbell: the host keeps a WebSocket open here, and every change to the
// room (someone joins, sends an offer, leaves) rings it, so the host looks at once instead of
// asking every few seconds. The socket hibernates in between, and the runtime answers its
// keep-alive pings itself, so an idle room costs nothing.
//
// And it's the relay, for players who can't connect to each other directly (strict NATs, some
// mobile networks, two continents): each player in the room may hang one relay socket here, and
// the object passes their frames on to the player they're addressed to, saying who sent them.
//   frame: [u8 channel][u8 binary][u8 id length][id][payload] (the id: to, going in; from, coming out)

const TIDY_MS = 24 * 60 * 60 * 1000;   // a day without a write: the room's records go

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async read(path) {
    const v = await this.ctx.storage.get(path);
    return v ? { etag: v.etag, data: v.data } : null;
  }

  // etag null: create only; otherwise replace only if still at that ETag
  async write(path, data, etag = null) {
    const cur = await this.ctx.storage.get(path);
    if (etag ? !cur || cur.etag !== etag : cur) return { ok: false };
    const n = ((await this.ctx.storage.get('#n')) || 0) + 1;
    const e = `"r${n}"`;
    await this.ctx.storage.put({ '#n': n, [path]: { etag: e, data } });
    await this.ctx.storage.setAlarm(Date.now() + TIDY_MS);
    this.ring();
    return { ok: true, etag: e };
  }

  async remove(paths) {
    const list = [].concat(paths);
    if (list.length) await this.ctx.storage.delete(list);
    this.ring();
  }

  ring() {
    for (const ws of this.ctx.getWebSockets('bell')) { try { ws.send('ring'); } catch { /* closing */ } }
  }

  // the doorbell (only the room's current host may hang one here) or a player's relay socket
  async fetch(request) {
    const url = new URL(request.url), q = url.searchParams;
    const room = await this.ctx.storage.get(`rooms/${q.get('room')}/room.json`);
    const [client, server] = Object.values(new WebSocketPair());
    if (url.pathname.endsWith('/relay')) {
      const id = q.get('id');
      if (!room || !room.data.members.some((m) => m.id === id)) return new Response('Not in this room', { status: 403 });
      // one relay socket per player: a new one (a reconnect) replaces the old
      for (const old of this.ctx.getWebSockets(`r:${id}`)) { try { old.close(1000, 'replaced'); } catch { /* gone */ } }
      this.ctx.acceptWebSocket(server, [`r:${id}`]);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!room || room.data.hostId !== q.get('host')) return new Response('Not the host of this room', { status: 403 });
    this.ctx.acceptWebSocket(server, ['bell']);
    return new Response(null, { status: 101, webSocket: client });
  }

  // relay frames: on to the player they're for, with the sender's id in place of the recipient's
  webSocketMessage(ws, msg) {
    if (typeof msg === 'string') return;   // (the doorbell's pings are answered by the runtime)
    const tag = this.ctx.getTags(ws).find((t) => t.startsWith('r:'));
    if (!tag) return;
    const b = new Uint8Array(msg), n = b[2];
    if (b.length < 3 + n) return;
    const to = new TextDecoder().decode(b.subarray(3, 3 + n));
    const out = this.ctx.getWebSockets(`r:${to}`)[0];
    if (!out) return;
    const me = new TextEncoder().encode(tag.slice(2)), body = b.subarray(3 + n);
    const f = new Uint8Array(3 + me.length + body.length);
    f[0] = b[0]; f[1] = b[1]; f[2] = me.length; f.set(me, 3); f.set(body, 3 + me.length);
    try { out.send(f); } catch { /* closing */ }
  }
  webSocketClose(ws, code) { try { ws.close(code, 'bye'); } catch { /* already closed */ } }

  async alarm() { await this.ctx.storage.deleteAll(); }
}
