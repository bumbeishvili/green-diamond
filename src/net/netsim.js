// Debug network conditions for testing on a good connection: extra round-trip time, jitter and
// loss on the unreliable channel. Half the delay is added to what this browser sends and half to
// what it receives, so "lag 100" adds 100 ms to this player's ping. Reliable messages are delayed
// but never lost or reordered, like the real reliable channel.
//
// From the URL: ?lag=100&jitter=20&loss=5 (ms, ms, %), or live from the network overlay.

export class NetSim {
  constructor() {
    const q = new URLSearchParams(location.search);
    this.lag = clamp(+q.get('lag') || 0, 0, 400);
    this.jitter = clamp(+q.get('jitter') || 0, 0, 100);
    this.loss = clamp(+q.get('loss') || 0, 0, 30) / 100;
  }

  get on() { return this.lag > 0 || this.jitter > 0 || this.loss > 0; }

  // one per link, so the reliable ordering is kept per peer
  lane() {
    const sim = this;
    const at = { out: 0, in: 0 };
    const pass = (dir, kind, data, deliver) => {
      if (!sim.on) { deliver(data); return; }
      if (kind === 'unrel' && Math.random() < sim.loss) return;
      let d = Math.max(0, sim.lag / 2 + (Math.random() * 2 - 1) * sim.jitter / 2);
      if (kind === 'rel') {
        const t = Math.max(performance.now() + d, at[dir]);
        at[dir] = t;
        d = t - performance.now();
      }
      setTimeout(() => deliver(data), d);
    };
    return {
      send: (kind, data, deliver) => pass('out', kind, data, deliver),
      receive: (kind, data, deliver) => pass('in', kind, data, deliver),
    };
  }
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
