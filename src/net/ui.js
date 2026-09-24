import { Session, MAX_PLAYERS } from './session.js';
import { URLFLAGS } from '../config.js';
import { TICK_HZ } from './protocol.js';

// "Play with friends" in the menu, and the network overlay: role, tick rate, and every player's
// ping and packet loss, with the debug sliders for simulated lag, jitter and loss. F8 shows/hides it.

const $ = (id) => document.getElementById(id);

export class NetUI {
  constructor(game) {
    this.game = game;
    this.session = new Session({ onchange: () => this.render() });
    this.hidden = false;
    this.pass = $('mp-pass');
    this.nameEl = $('mp-name');
    this.status = $('mp-status');
    this.overlay = $('net');
    try { this.nameEl.value = URLFLAGS.name || localStorage.getItem('gd-name') || ''; } catch { /* no storage */ }
    game.playerName = this.nameEl.value.trim();
    this.nameEl.addEventListener('input', () => {
      game.playerName = this.nameEl.value.trim();
      try { localStorage.setItem('gd-name', game.playerName); } catch { /* no storage */ }
    });
    $('mp-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const pw = this.pass.value;
      if (!pw) { this.pass.focus(); return; }
      this.session.join(pw);
    });
    $('mp-leave').addEventListener('click', () => this.session.leave());
    $('mp-start').addEventListener('click', () => { if (game.ready && game.net && game.net.role === 'host') game.net.start(); });
    if (URLFLAGS.mp) { this.pass.value = URLFLAGS.mp; setTimeout(() => this.session.join(URLFLAGS.mp), 50); }
    addEventListener('keydown', (e) => { if (e.code === 'F8') { this.hidden = !this.hidden; this.render(); } });

    const sim = this.session.sim;
    this.overlay.innerHTML = `
      <div class="net-head"><b data-f="role"></b><span data-f="tick"></span><span data-f="ping"></span><span data-f="loss"></span></div>
      <table><thead><tr><th></th><th></th><th class="n">ping</th><th class="n">loss</th></tr></thead><tbody></tbody></table>
      <details class="net-sim"><summary>Simulate a bad network <i data-f="sim"></i></summary>
        <label>Lag <input data-sim="lag" type="range" min="0" max="200" step="10" value="${sim.lag}"><span data-f="lag"></span></label>
        <label>Jitter <input data-sim="jitter" type="range" min="0" max="50" step="5" value="${sim.jitter}"><span data-f="jitter"></span></label>
        <label>Loss <input data-sim="loss" type="range" min="0" max="10" step="1" value="${Math.round(sim.loss * 100)}"><span data-f="lossPct"></span></label>
      </details>
      <div class="net-foot">F8 hides this</div>`;
    this.f = Object.fromEntries([...this.overlay.querySelectorAll('[data-f]')].map((e) => [e.dataset.f, e]));
    this.tbody = this.overlay.querySelector('tbody');
    this.overlay.addEventListener('input', (e) => {
      const k = e.target.dataset.sim;
      if (!k) return;
      sim[k] = k === 'loss' ? +e.target.value / 100 : +e.target.value;
      this.render();
    });
    this.render();
  }

  render() {
    const s = this.session, active = s.state !== 'idle' && s.state !== 'ended', g = this.game;
    g.attachSession?.(s);
    $('mp-join').classList.toggle('hidden', active);
    $('mp-leave').classList.toggle('hidden', !active);
    this.pass.disabled = active;
    this.nameEl.disabled = active;
    // in a room, the match replaces solo play: the host starts it, the others wait for that
    const inRoom = s.state === 'connected';
    const host = inRoom && s.role === 'host';
    $('play').classList.toggle('hidden', inRoom);
    $('mp-start').classList.toggle('hidden', !host || !!(g.net && g.net.inMatch));
    const ready = g.net && g.net.ready ? g.net.ready.size + 1 : s.roster.length, loading = Math.max(0, s.roster.length - ready);
    $('mp-start').textContent = `Start match (${ready} player${ready === 1 ? '' : 's'}${loading ? `, ${loading} still loading` : ''})`;
    this.status.textContent = inRoom && s.role === 'client' && !(g.net && g.net.inMatch) ? 'Connected. Waiting for the host to start the match…' : s.message;
    this.status.className = s.state === 'ended' ? 'err' : s.state === 'connected' ? 'ok' : '';
    this.overlay.classList.toggle('hidden', this.hidden || !active);
    if (!active || this.hidden) return;

    const loc = s.local, f = this.f, sim = s.sim, net = g.net;
    f.role.textContent = s.role === 'host' ? 'HOST' : 'CLIENT';
    // in a match: the host's 60 Hz tick, and the snapshot rate as it arrives here
    const snaps = net && net.inMatch && net.role === 'client' ? net.snapRate : 0;
    f.tick.textContent = s.state !== 'connected' ? s.state
      : net && net.inMatch ? (net.role === 'host' ? `tick ${TICK_HZ} Hz · snap 30 Hz` : `snap ${Math.round(snaps)} Hz`)
        : `tick ${loc ? Math.round(loc.hz) : 30} Hz`;
    f.ping.textContent = `ping ${loc && s.role === 'client' ? `${loc.ping} ms` : '—'}`;
    f.loss.textContent = `loss ${loc && s.role === 'client' ? `${(loc.loss * 100).toFixed(1)}%` : '—'}`;
    f.sim.textContent = sim.on ? `on: +${sim.lag} ms ±${sim.jitter}, ${Math.round(sim.loss * 100)}% loss` : '';
    for (const inp of this.overlay.querySelectorAll('[data-sim]')) {
      if (document.activeElement !== inp) inp.value = inp.dataset.sim === 'loss' ? Math.round(sim.loss * 100) : sim[inp.dataset.sim];
    }
    f.lag.textContent = `${sim.lag} ms`;
    f.jitter.textContent = `±${sim.jitter} ms`;
    f.lossPct.textContent = `${Math.round(sim.loss * 100)}%`;

    const hostId = s.role === 'host' ? s.id : s.hostId;
    const players = s.roster.length ? s.roster : [{ id: s.id, slot: s.slot ?? 0 }];
    let joining = s.role === 'host' ? [...s.peers.values()].filter((p) => !p.open).length : 0;
    const rows = [];
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const p = players.find((q) => q.slot === slot);
      if (!p) {
        rows.push(`<tr class="empty"><td>P${slot + 1}</td><td colspan="3">${joining-- > 0 ? 'joining…' : 'open'}</td></tr>`);
        continue;
      }
      const t = s.table[p.id] || {};
      const isHost = p.id === hostId;
      const tags = [isHost ? 'host' : '', p.id === s.id ? 'you' : ''].filter(Boolean).join(' · ');
      const ping = isHost ? '—' : t.ping != null ? `${t.ping} ms` : '…';
      const loss = isHost ? '—' : t.loss != null ? `${(t.loss * 100).toFixed(1)}%` : '…';
      rows.push(`<tr class="${p.id === s.id ? 'me' : ''}"><td>P${slot + 1}</td><td>${tags}</td><td class="n">${ping}</td><td class="n">${loss}</td></tr>`);
    }
    this.tbody.innerHTML = rows.join('');
  }
}
