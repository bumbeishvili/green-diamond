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
    for (const ws of this.ctx.getWebSockets()) { try { ws.send('ring'); } catch { /* closing */ } }
  }

  // the doorbell: only the room's current host may hang one here
  async fetch(request) {
    const q = new URL(request.url).searchParams;
    const room = await this.ctx.storage.get(`rooms/${q.get('room')}/room.json`);
    if (!room || room.data.hostId !== q.get('host')) return new Response('Not the host of this room', { status: 403 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage() { /* (only pings, which the runtime answers) */ }
  webSocketClose(ws, code) { try { ws.close(code, 'bye'); } catch { /* already closed */ } }

  async alarm() { await this.ctx.storage.deleteAll(); }
}
