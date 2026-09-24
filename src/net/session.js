import { signaling } from './signaling.js';
import { Peer } from './peer.js';
import { NetSim } from './netsim.js';
import { Relay } from './relay.js';
import { URLFLAGS } from '../config.js';

// A match of up to 4 players joined by a shared password, in a star: the first one in hosts and
// the others connect to the host only. The server is only used for the handshake.
//
// Milestone 1: connect, keep the roster, and measure every link (ping, packet loss, tick rate)
// with a 30 Hz heartbeat standing in for the game's snapshots and inputs.

export const TICK_HZ = 30;
export const MAX_PLAYERS = 4;
const ANSWER_WAIT = 16000;      // a client's offer unanswered this long: the host is gone (server: 15 s)
const GHOST_MS = 30000;         // a member who never sent an offer is dropped after this
const RELAY_AFTER = 4000;       // (Cloudflare) no direct link this long after the host answered: use the relay
const IDLE_CLOSE_MS = 30 * 60 * 1000;   // a host alone in a background tab this long closes the room

export const MESSAGES = {
  unreachable: 'Can\'t connect from this network. A direct (peer-to-peer) connection to the host is blocked here, usually by a strict firewall or NAT. Try another network; a phone hotspot often works.',
  hostLeft: 'The host left, so the match is over.',
  lost: 'The connection to the host was lost.',
  ended: 'This room has ended.',
  unreachableRelay: 'Couldn\'t connect to the host, not even through the relay. Check your connection and try again.',
  idle: 'Room closed: nobody joined in the 30 minutes the game was in the background. Create a new one when you\'re ready.',
};

// Timers from a worker keep running at full speed in a background tab, where the page's own
// timers are slowed to once a second (or once a minute after a while).
export const ticker = (() => {
  let w = null, n = 0;
  const waiting = new Map();
  try {
    w = new Worker(URL.createObjectURL(new Blob([
      'const t={};onmessage=(e)=>{const[id,ms,rep]=e.data;if(ms<0){clearTimeout(t[id]);clearInterval(t[id]);delete t[id];return;}t[id]=(rep?setInterval:setTimeout)(()=>postMessage(id),ms);}',
    ], { type: 'text/javascript' })));
    w.onmessage = (e) => { const f = waiting.get(e.data); if (f) { if (!f.rep) waiting.delete(e.data); f.fn(); } };
  } catch { w = null; }
  return {
    after(ms, fn) { if (!w) return setTimeout(fn, ms); const id = ++n; waiting.set(id, { fn }); w.postMessage([id, ms, false]); return id; },
    every(ms, fn) { if (!w) return setInterval(fn, ms); const id = ++n; waiting.set(id, { fn, rep: true }); w.postMessage([id, ms, true]); return id; },
    stop(id) { if (!w) { clearTimeout(id); clearInterval(id); return; } waiting.delete(id); w.postMessage([id, -1]); },
  };
})();
const sleep = (ms) => new Promise((r) => ticker.after(ms, r));

// Arrival of a numbered stream (the heartbeat) over the last three seconds: loss from the gaps in
// the numbers, rate from the arrivals.
const WINDOW = 3000;
class Meter {
  constructor() { this.seen = []; }
  add(seq) {
    this.seen.push([seq, performance.now()]);
    this.trim();
  }
  trim() { const t = performance.now(); while (this.seen.length && t - this.seen[0][1] > WINDOW) this.seen.shift(); }
  get loss() {
    this.trim();
    const s = this.seen;
    if (s.length < 8) return 0;
    let lo = Infinity, hi = -Infinity;
    for (const [q] of s) { if (q < lo) lo = q; if (q > hi) hi = q; }
    return Math.max(0, 1 - s.length / (hi - lo + 1));
  }
  get hz() {
    this.trim();
    const s = this.seen;
    return s.length < 2 ? 0 : (s.length - 1) / ((s[s.length - 1][1] - s[0][1]) / 1000);
  }
}

export class Session {
  constructor({ onchange = () => {} } = {}) {
    this.sim = new NetSim();
    this.onchange = onchange;
    // the game plugs in here: messages it understands, and players arriving / leaving
    this.onGame = null;          // (peerId, kind, data) data: ArrayBuffer or parsed JSON
    this.onPeerOpen = null;      // (peerId)
    this.onPeerClose = null;     // (peerId, reason)
    this.onEnded = null;         // (message) the session is over (host left, lost, ...)
    this.reset();
    addEventListener('pagehide', () => this.leave());
  }

  reset() {
    if (this.relay) this.closeRelay();
    this.state = 'idle';         // idle | joining | connecting | connected | ended
    this.role = null;            // 'host' | 'client'
    this.room = this.id = this.hostId = this.password = null;
    this.slot = null;
    this.peers = new Map();      // host: one per client; client: the host
    this.roster = [];            // [{id, slot}] players in the match, as the host has it
    this.table = {};             // id -> {ping, loss, hz} measured by the host (clients get copies)
    this.message = '';
    this.seen = new Map();       // host: member id -> first seen without an offer
    this.members = [];           // host: the room's members on the server, with their slots
    this.hostLeft = false;
    this.gen = (this.gen || 0) + 1;
  }

  changed() { this.onchange(this); }

  get me() { return this.roster.find((p) => p.id === this.id); }

  async join(password) {
    if (this.state !== 'idle' && this.state !== 'ended') return;
    this.stopTimers();
    this.reset();
    this.password = password;
    this.state = 'joining';
    this.message = 'Finding the room…';
    this.changed();
    const gen = this.gen;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await signaling.join(password);
        if (this.gen === gen) this.enter(r);
        return;
      } catch (e) {
        if (this.gen !== gen) return;
        // someone may be leaving right now: their place frees up a moment after they're gone
        if (e.full && attempt < 2) {
          this.message = 'The room is full. Checking again in a moment…';
          this.changed();
          await sleep(1500);
          if (this.gen !== gen) return;
          continue;
        }
        this.fail(e.message);
        return;
      }
    }
  }

  enter(r) {
    Object.assign(this, { room: r.room, id: r.id, slot: r.slot, role: r.role, hostId: r.hostId, ice: r.iceServers });
    this.bellOk = !!r.bell;
    this.relayOk = !!r.relay;   // (Cloudflare: the room's server can carry the game when a direct link can't be made)
    this.roster = [{ id: r.id, slot: r.slot }];
    this.startTimers();
    if (this.role === 'host' && this.relayOk) this.openRelay();
    if (this.role === 'host') {
      this.state = 'connected';
      this.message = 'You\'re hosting. Send your friends the link (or the password).';
      this.changed();
      this.hostLoop(this.gen);
    } else {
      this.state = 'connecting';
      this.message = 'Connecting to the host…';
      this.changed();
      this.connectToHost(this.gen);
    }
  }

  fail(message) {
    this.stopTimers();
    this.closeRelay();
    for (const p of this.peers.values()) { p.onclose = null; p.close(); }
    this.peers.clear();
    if (this.room && this.id) signaling.leave(this.room, this.id);
    this.state = 'ended';
    this.message = message;
    this.room = null;
    this.changed();
    this.onEnded?.(message);
  }

  leave() {
    if (!this.room || !this.id) return;
    this.gen++;                  // background loops of this session stop here
    // tell the others first (reliable channel), then free the place on the server
    this.broadcast('rel', { t: this.role === 'host' ? 'end' : 'bye' });
    signaling.leave(this.room, this.id);
    for (const p of this.peers.values()) { p.onclose = null; setTimeout(() => p.close(), 50); }
    this.peers.clear();
    this.stopTimers();
    // (the relay last, once the goodbye has gone out through it)
    const relay = this.relay;
    this.relay = null;
    clearTimeout(this.relayTimer); clearTimeout(this.relayGiveUp); this.viaRelayStarted = false;
    if (relay) setTimeout(() => relay.close(), 150);
    this.room = null;
    this.state = 'idle';
    this.message = '';
    this.roster = [];
    this.changed();
  }

  // ---- host ----

  // look for new players while there's room; back off when nobody comes. With a doorbell
  // (Cloudflare) look when it rings, and otherwise only once a minute, in case a ring went missing.
  async hostLoop(gen) {
    let wait = 1200, alone = 0, rung = false, wake = null;
    const bell = this.bellOk ? signaling.bell(this.room, this.id, () => { rung = true; if (wake) wake(); }) : null;
    try {
      while (this.gen === gen && this.role === 'host' && this.room) {
        // every look is a Blob read on Vercel (the free plan has 10,000 a month): a room forgotten in
        // a background tab with nobody in it closes after half an hour instead of polling all night
        if (!this.peers.size && typeof document !== 'undefined' && document.hidden) {
          if (!alone) alone = performance.now();
          else if (performance.now() - alone > IDLE_CLOSE_MS) { this.fail(MESSAGES.idle); return; }
        } else alone = 0;
        rung = false;
        let quiet = false;
        if (this.peers.size < MAX_PLAYERS - 1) {
          try {
            const box = await signaling.inbox(this.room, this.id, [...this.peers.keys()]);
            if (this.gen !== gen) return;
            this.members = box.players;
            for (const o of box.offers) this.acceptClient(o.from, o.sdp);
            const waitingFor = this.dropGhosts(box.players, box.offers);
            quiet = !box.offers.length && !waitingFor;
            wait = quiet ? Math.min(wait * 1.25, 5000) : 1200;
          } catch (e) {
            if (e.gone) { this.fail(MESSAGES.ended); return; }
            wait = 5000;
          }
        } else wait = 2000;
        if (!rung) await Promise.race([sleep(quiet && bell && bell.open ? 60000 : wait), new Promise((r) => { wake = r; })]);
        wake = null;
      }
    } finally {
      if (bell) bell.close();
    }
  }

  // members who joined but never sent an offer (closed the tab mid-join) give their place back
  dropGhosts(members, offers) {
    const now = performance.now();
    let waiting = 0;
    for (const m of members) {
      if (m.id === this.id || this.peers.has(m.id) || offers.some((o) => o.from === m.id)) { this.seen.delete(m.id); continue; }
      if (!this.seen.has(m.id)) this.seen.set(m.id, now);
      if (now - this.seen.get(m.id) > GHOST_MS) { signaling.leave(this.room, m.id, this.id); this.seen.delete(m.id); } else waiting++;
    }
    return waiting;
  }

  async acceptClient(from, sdp) {
    if (this.peers.has(from)) return;
    const p = this.link(from);
    try {
      const answer = await p.answer(sdp);
      await signaling.send(this.room, this.id, from, 'answer', answer);
    } catch {
      p.close('unreachable');
    }
  }

  // ---- client ----

  async connectToHost(gen) {
    // (?relay: straight to the relay, no direct attempt)
    if (this.relayOk && URLFLAGS.relay) { this.viaRelay(null, gen); return; }
    const p = this.link(this.hostId);
    try {
      const offer = await p.offer();
      await signaling.send(this.room, this.id, this.hostId, 'offer', offer);
      const t0 = performance.now();
      let answer = null;
      while (!answer && !p.closed && this.gen === gen && performance.now() - t0 < ANSWER_WAIT) {
        await sleep(900);
        answer = await signaling.receive(this.room, this.id, 'answer', this.hostId).catch((e) => { if (e.gone) throw e; return null; });
      }
      if (this.gen !== gen || p.closed) return;
      if (!answer) { this.hostGone(p); return; }
      await p.accept(answer);
      this.message = 'Connecting to the host…';
      this.changed();
      if (this.relayOk) this.relayTimer = setTimeout(() => { if (this.gen === gen && !p.open) this.viaRelay(p, gen); }, RELAY_AFTER);
    } catch (e) {
      if (this.gen === gen) this.fail(e.gone ? MESSAGES.ended : e.message || MESSAGES.unreachable);
    }
  }

  // ---- the relay (Cloudflare) ----

  openRelay() {
    if (this.relay) return this.relay;
    this.relay = new Relay(this.room, this.id);
    if (this.role === 'host') this.relay.onhello = (from) => this.relayClient(from);
    return this.relay;
  }

  closeRelay() {
    clearTimeout(this.relayTimer); clearTimeout(this.relayGiveUp);
    if (this.relay) { this.relay.close(); this.relay = null; }
    this.viaRelayStarted = false;
  }

  // client: the direct link to the host can't be made; talk through the room's server instead
  viaRelay(p, gen = this.gen) {
    if (this.viaRelayStarted || this.gen !== gen) return;
    this.viaRelayStarted = true;
    clearTimeout(this.relayTimer);
    if (p && !p.closed) { p.onclose = null; p.close(); }
    this.peers.delete(this.hostId);
    this.message = 'No direct connection from here: connecting through the relay…';
    this.changed();
    const relay = this.openRelay();
    const l = this.link(this.hostId, relay.link(this.hostId, this.sim.lane()));
    // (knock until the host's relay socket answers: it may still be connecting)
    relay.ready.then(() => {
      if (this.gen !== gen || l.closed) return;
      l.hello();
      const knock = setInterval(() => { if (l.open || l.closed || this.gen !== gen) clearInterval(knock); else l.hello(); }, 2000);
    });
    this.relayGiveUp = setTimeout(() => { if (this.gen === gen && !l.open) this.fail(MESSAGES.unreachableRelay); }, 12000);
  }

  // host: a client that couldn't reach us directly knocks on the relay; take it that way
  relayClient(from) {
    if (!this.relay) return;
    const old = this.peers.get(from);
    if (old && old.relayed && old.open) { this.relay.send(from, 'ctl', 'ok'); return; }
    if (old) { old.onclose = null; old.close(); this.peers.delete(from); }
    const l = this.link(from, this.relay.link(from, this.sim.lane()));
    l.accept();
  }

  // the host never answered: it closed its tab without saying so. Start the room over (the server
  // checks our unanswered offer first); whoever gets there first becomes the new host.
  async hostGone(p) {
    p.onclose = null;
    p.close();
    this.peers.delete(p.id);
    this.message = 'The host isn\'t answering. Starting the room again…';
    this.changed();
    const old = { room: this.room, id: this.id, hostId: this.hostId };
    try {
      const r = await signaling.join(this.password, { hostGone: old.hostId, me: old.id });
      if (r.hostId === old.hostId) signaling.leave(old.room, old.id);   // host is alive after all
      this.stopTimers();
      const password = this.password;
      this.reset();
      this.password = password;
      this.enter(r);
    } catch (e) {
      this.fail(e.message);
    }
  }

  // ---- links ----

  link(id, made = null) {
    const p = made || new Peer(id, this.ice, this.sim.lane());
    p.meter = new Meter();
    p.rtt = 0;
    p.pings = new Map();
    p.remote = null;              // what the other side measures of us (client reports)
    this.peers.set(id, p);
    p.onopen = () => {
      if (this.role === 'host') {
        const m = this.members.find((q) => q.id === id);
        this.roster.push({ id, slot: m ? m.slot : this.slotOf() });
        this.roster.sort((a, b) => a.slot - b.slot);
        this.sendRoster();
      } else {
        this.state = 'connected';
        this.message = 'Connected.';
      }
      this.changed();
      this.onPeerOpen?.(id);
    };
    p.onclose = (reason) => this.dropped(p, reason);
    p.onmessage = (kind, data) => this.receive(p, kind, data);
    return p;
  }

  slotOf() {
    // the server's slot is normally known from the inbox; failing that, the first free one
    const used = new Set(this.roster.map((q) => q.slot));
    let s = 0;
    while (used.has(s)) s++;
    return s;
  }

  dropped(p, reason) {
    this.peers.delete(p.id);
    if (p.open) this.onPeerClose?.(p.id, reason);
    if (this.role === 'host') {
      signaling.leave(this.room, p.id, this.id);            // give the place back
      this.roster = this.roster.filter((q) => q.id !== p.id);
      delete this.table[p.id];
      this.sendRoster();
      this.changed();
      return;
    }
    // (the direct link couldn't be made: the relay, if this server has one)
    if (reason === 'unreachable' && this.relayOk && !p.relayed && !this.viaRelayStarted) { this.viaRelay(null); return; }
    // a client without its host has no match
    this.fail(reason === 'unreachable' ? (p.relayed ? MESSAGES.unreachableRelay : MESSAGES.unreachable) : this.hostLeft ? MESSAGES.hostLeft : reason === 'lost' ? MESSAGES.lost : MESSAGES.hostLeft);
  }

  sendRoster() {
    this.broadcast('rel', { t: 'roster', players: this.roster, host: this.id, tick: TICK_HZ });
  }

  broadcast(kind, msg) {
    const s = JSON.stringify(msg);
    for (const p of this.peers.values()) p.send(kind, s);
  }

  receive(p, kind, data) {
    if (typeof data !== 'string') { this.onGame?.(p.id, kind, data); return; }
    let m;
    try { m = JSON.parse(data); } catch { return; }
    switch (m.t) {
      case 'hb': p.meter.add(m.s); break;
      case 'ping': p.send('unrel', JSON.stringify({ t: 'pong', n: m.n })); break;
      case 'pong': {
        const t0 = p.pings.get(m.n);
        if (t0 === undefined) break;
        p.pings.delete(m.n);
        const rtt = performance.now() - t0;
        p.rtt = p.rtt ? p.rtt * 0.7 + rtt * 0.3 : rtt;
        break;
      }
      // client -> host: how the host's stream arrives here
      case 'report': p.remote = { loss: +m.loss || 0, hz: +m.hz || 0 }; break;
      // host -> clients
      case 'roster':
        if (this.role !== 'client') break;
        this.roster = m.players;
        this.me && (this.slot = this.me.slot);
        this.changed();
        break;
      case 'table': if (this.role === 'client') { this.table = m.table; this.changed(); } break;
      case 'end': this.hostLeft = true; this.fail(MESSAGES.hostLeft); break;
      case 'bye': if (this.role === 'host') p.close('left'); break;
      default: this.onGame?.(p.id, kind, m); break;
    }
  }

  // to one player (host: any client; client: the host). Objects go as JSON.
  sendTo(id, kind, data) {
    const p = this.peers.get(id);
    if (!p) return false;
    return p.send(kind, typeof data === 'string' || data instanceof ArrayBuffer ? data : JSON.stringify(data));
  }

  sendAll(kind, data) {
    const d = typeof data === 'string' || data instanceof ArrayBuffer ? data : JSON.stringify(data);
    for (const p of this.peers.values()) p.send(kind, d);
  }

  slotOfId(id) {
    const r = this.roster.find((q) => q.id === id);
    return r ? r.slot : -1;
  }

  get connected() { return this.state === 'connected'; }

  // ---- heartbeat, pings, stats ----

  startTimers() {
    let seq = 0, n = 0;
    this.timers = [
      ticker.every(1000 / TICK_HZ, () => {
        if (!this.peers.size) return;
        const n2 = seq++, s = JSON.stringify({ t: 'hb', s: n2 });
        for (const p of this.peers.values()) if (!p.relayed || n2 % 3 === 0) p.send('unrel', s);
      }),
      ticker.every(1000, () => {
        const now = performance.now();
        for (const p of this.peers.values()) {
          if (!p.open) continue;
          p.pings.set(++n, now);
          for (const k of p.pings.keys()) if (k < n - 10) p.pings.delete(k);
          p.send('unrel', JSON.stringify({ t: 'ping', n }));
        }
        if (this.role === 'host') {
          const table = { [this.id]: { ping: 0, loss: 0, hz: TICK_HZ } };
          for (const p of this.peers.values()) {
            if (!p.open) continue;
            // loss: both directions of the link, averaged
            table[p.id] = { ping: Math.round(p.rtt), loss: (p.meter.loss + (p.remote ? p.remote.loss : p.meter.loss)) / 2, hz: p.remote ? p.remote.hz : 0, up: p.meter.hz, relay: !!p.relayed };
          }
          this.table = table;
          this.broadcast('rel', { t: 'table', table });
        } else {
          const h = this.peers.get(this.hostId);
          if (h && h.open) h.send('rel', JSON.stringify({ t: 'report', loss: h.meter.loss, hz: h.meter.hz }));
        }
        this.changed();
      }),
    ];
  }

  stopTimers() {
    for (const t of this.timers || []) ticker.stop(t);
    this.timers = [];
  }

  // what the overlay shows for this browser's own link
  get local() {
    if (this.role === 'client') {
      const h = this.peers.get(this.hostId);
      return h && h.open ? { ping: Math.round(h.rtt), loss: h.meter.loss, hz: h.meter.hz, relay: !!h.relayed } : null;
    }
    return this.role === 'host' ? { ping: 0, loss: 0, hz: TICK_HZ } : null;
  }
}
