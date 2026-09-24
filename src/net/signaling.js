// Talks to the handshake functions in api/ (Vercel Functions, or tools/dev.mjs locally).
// Only used while players connect; once WebRTC is up, nothing goes through the server.

export class SignalError extends Error {
  constructor(message, info = {}) { super(message); Object.assign(this, info); }
}

async function call(path, init) {
  let r;
  try {
    r = await fetch(path, { cache: 'no-store', ...init });
  } catch {
    throw new SignalError('Can\'t reach the game server. Check your connection.', { network: true });
  }
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new SignalError(data.error || `Server error (${r.status})`, { status: r.status, ...data });
  return data;
}

const post = (path, body) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const signaling = {
  join: (password, extra = {}) => post('/api/join', { password, ...extra }),
  send: (room, from, to, kind, sdp) => post('/api/signal', { room, from, to, kind, sdp }),
  async receive(room, to, kind, from) {
    const q = new URLSearchParams({ room, to, kind, from });
    const r = await call(`/api/signal?${q}`);
    return r && r.sdp;
  },
  inbox(room, host, have) {
    const q = new URLSearchParams({ room, host, have: have.join(',') });
    return call(`/api/inbox?${q}`);
  },
  // Cloudflare only (the join answer says bell: true): a socket the room rings whenever someone
  // joins, sends an offer or leaves, so the host looks right away instead of asking every few
  // seconds. It reconnects by itself; bell.open says whether it's up right now.
  bell(room, host, onRing) {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/bell?${new URLSearchParams({ room, host })}`;
    const bell = { open: false, closed: false, close() { this.closed = true; clearInterval(ping); try { ws && ws.close(); } catch { /* gone */ } } };
    let ws = null, tries = 0;
    const ping = setInterval(() => { if (bell.open) try { ws.send('ping'); } catch { /* reconnecting */ } }, 30000);
    const connect = () => {
      if (bell.closed) return;
      ws = new WebSocket(url);
      ws.onopen = () => { tries = 0; bell.open = true; onRing(); };
      ws.onmessage = (e) => { if (e.data === 'ring') onRing(); };
      ws.onclose = () => {
        bell.open = false;
        if (!bell.closed && tries < 8) setTimeout(connect, 1000 * 2 ** tries++);
      };
    };
    connect();
    return bell;
  },
  // also works while the tab closes
  leave(room, id, by) {
    const body = JSON.stringify(by ? { room, id, by } : { room, id });
    if (navigator.sendBeacon && navigator.sendBeacon('/api/leave', body)) return;
    fetch('/api/leave', { method: 'POST', body, keepalive: true }).catch(() => {});
  },
};
