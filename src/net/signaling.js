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
  // also works while the tab closes
  leave(room, id, by) {
    const body = JSON.stringify(by ? { room, id, by } : { room, id });
    if (navigator.sendBeacon && navigator.sendBeacon('/api/leave', body)) return;
    fetch('/api/leave', { method: 'POST', body, keepalive: true }).catch(() => {});
  },
};
