// The way round a network that won't let two players connect directly (strict NATs, some mobile
// networks, two countries far apart): everything goes through the room's server on Cloudflare
// instead, over one WebSocket per player. Only used when the direct link can't be made.
//
// Frames: [u8 channel: 0 unrel, 1 rel, 2 control][u8 1: binary, 0: text][u8 id length][id][payload]
// We send with the other player's id; the server swaps in ours before passing it on.

const CH = { unrel: 0, rel: 1, ctl: 2 };
const NAME = ['unrel', 'rel', 'ctl'];
const enc = new TextEncoder(), dec = new TextDecoder();

export class Relay {
  constructor(room, id) {
    this.url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/relay?${new URLSearchParams({ room, id })}`;
    this.links = new Map();      // other player's id -> RelayLink
    this.onhello = null;         // (id) a client asks to talk through here (the host listens for this)
    this.ws = null;
    this.open = false;
    this.closed = false;
    this.queue = [];             // reliable frames sent before the socket is up
    this.tries = 0;
    this.ready = new Promise((r) => { this.markReady = r; });
    this.connect();
  }

  connect() {
    if (this.closed) return;
    const ws = this.ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.open = true; this.tries = 0;
      for (const f of this.queue.splice(0)) ws.send(f);
      this.markReady();
    };
    ws.onmessage = (e) => this.receive(e.data);
    ws.onclose = () => {
      this.open = false;
      if (this.closed) return;
      // a blip: try again a few times; the links stay (a moment's snapshots are lost, that's all)
      if (this.tries++ < 4) setTimeout(() => this.connect(), 500 * this.tries);
      else for (const l of [...this.links.values()]) l.close('lost');
    };
    clearInterval(this.pingT);
    this.pingT = setInterval(() => { if (this.open) try { ws.send('ping'); } catch { /* reconnecting */ } }, 25000);
  }

  frame(to, ch, data) {
    const bin = data instanceof ArrayBuffer, body = bin ? new Uint8Array(data) : enc.encode(data), idb = enc.encode(to);
    const f = new Uint8Array(3 + idb.length + body.length);
    f[0] = ch; f[1] = bin ? 1 : 0; f[2] = idb.length; f.set(idb, 3); f.set(body, 3 + idb.length);
    return f;
  }

  send(to, kind, data) {
    const f = this.frame(to, CH[kind], data);
    if (this.open) { try { this.ws.send(f); } catch { /* closing */ } } else if (kind !== 'unrel') this.queue.push(f);
  }

  receive(buf) {
    if (typeof buf === 'string') return;   // (the keep-alive's pong)
    const b = new Uint8Array(buf), n = b[2], from = dec.decode(b.subarray(3, 3 + n)), body = b.subarray(3 + n);
    const ch = NAME[b[0]];
    const data = b[1] ? body.slice().buffer : dec.decode(body);
    if (ch === 'ctl') {
      if (data === 'hello') { this.onhello?.(from); return; }
      const l = this.links.get(from);
      if (data === 'ok' && l && !l.open) { l.open = true; l.onopen?.(); }
      if (data === 'bye' && l) l.close('left');
      return;
    }
    const l = this.links.get(from);
    if (l && !l.closed) l.lane.receive(ch, data, (d) => { if (!l.closed) l.onmessage?.(ch, d); });
  }

  link(id, lane) {
    const l = new RelayLink(this, id, lane);
    this.links.set(id, l);
    return l;
  }

  close() {
    this.closed = true;
    clearInterval(this.pingT);
    try { this.ws && this.ws.close(); } catch { /* gone */ }
  }
}

// One player's link through the relay: the same face as a direct Peer (send, open, onopen,
// onmessage, onclose), so the session and the game can't tell the difference - except that
// they send a little less often over it (it's someone else's server, and it counts messages).
export class RelayLink {
  constructor(relay, id, lane) {
    this.relay = relay; this.id = id; this.lane = lane;
    this.relayed = true;
    this.open = false; this.closed = false;
    this.onopen = null; this.onclose = null; this.onmessage = null;
  }

  // client: ask the host to talk through the relay (it answers 'ok')
  hello() { this.relay.send(this.id, 'ctl', 'hello'); }
  // host: agree
  accept() { this.relay.send(this.id, 'ctl', 'ok'); this.open = true; this.onopen?.(); }

  send(kind, data) {
    if (!this.open || this.closed) return false;
    this.lane.send(kind, data, (d) => this.relay.send(this.id, kind, d));
    return true;
  }

  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;
    if (reason === 'closed' || reason === 'left') this.relay.send(this.id, 'ctl', 'bye');
    this.relay.links.delete(this.id);
    this.onclose?.(reason);
  }
}
