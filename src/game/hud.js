import { DEFS, CATS, UPGRADES } from './weapons.js';

const SLOT_CSS = ['#3fa7ff', '#5fd35f', '#ffa23a', '#c77dff'];

// DOM heads-up display + minimap drawn from the level data.
const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(level) {
    this.el = {
      hud: $('hud'), wave: $('wave'), waveNum: $('wave-num'), points: $('points-num'), feed: $('feed'),
      health: $('health'), healthBar: $('health-bar'), ammoName: $('ammo-name'), mag: $('ammo-mag'), res: $('ammo-res'),
      prompt: $('prompt'), banner: $('banner'), hit: $('hitmarker'), dmg: $('damage'), lowhp: $('lowhp'),
      cross: $('crosshair'), map: $('minimap'), stats: $('stats'),
    };
    this.hitT = 0; this.dmgT = 0;
    this.big = false;
    this.buildMap(level);
    this.lastPrompt = '';
    this.pendingPrompt = ''; this.pendingPrio = -1;
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); if (on) this.flashKeys(12); }

  // Unobtrusive key strip at the bottom: bright for a few seconds, then faded; H toggles it.
  flashKeys(sec = 5) {
    const k = document.getElementById('keys');
    if (!k) return;
    k.classList.add('bright');
    clearTimeout(this.keysT);
    this.keysT = setTimeout(() => k.classList.remove('bright'), sec * 1000);
  }

  toggleKeys() { const k = document.getElementById('keys'); if (k) k.classList.toggle('off'); }

  weapon(def, ammo, level = 0) {
    this.el.ammoName.textContent = level ? `${def.name} ${UPGRADES[level - 1].name}` : def.name;
    this.el.ammoName.classList.toggle('upgraded', level > 0);
    if (def.melee) {
      this.el.mag.textContent = '—';
      this.el.mag.classList.remove('low');
      this.el.res.textContent = '';
      return;
    }
    this.el.mag.textContent = ammo.mag;
    this.el.mag.classList.toggle('low', !def.bow && ammo.mag <= Math.ceil(def.mag * 0.25));
    this.el.res.textContent = def.bow ? `+ ${ammo.reserve} arrows` : `/ ${ammo.reserve}`;
  }

  grenades(n) {
    const el = document.getElementById('nades');
    if (el) el.innerHTML = `<b>G</b> grenades × ${n}`;
    if (el) el.classList.toggle('none', n <= 0);
  }

  points(n) { this.el.points.textContent = n; }

  // weapon categories 1-7 next to the ammo counter (owned guns bright, the one in hand gold)
  slots(owned, current) {
    const el = document.getElementById('slots');
    if (!el) return;
    el.innerHTML = Object.values(CATS).map((kinds, i) => {
      const own = kinds.filter((k) => owned[k]);
      const label = own.length ? own.map((k) => (k === current ? `<u>${DEFS[k].short}</u>` : DEFS[k].short)).join(' · ') : DEFS[kinds[0]].short;
      return `<span class="${own.length ? 'own' : ''} ${kinds.includes(current) ? 'cur' : ''}"><b>${i + 1}</b>${label}</span>`;
    }).join('');
  }

  // short message in the middle of the screen (e.g. where to buy a gun)
  notice(text) {
    const n = document.getElementById('notice');
    if (!n) return;
    n.textContent = text;
    n.classList.add('on');
    clearTimeout(this.noticeT);
    this.noticeT = setTimeout(() => n.classList.remove('on'), 2600);
  }

  feed(amount) {
    const d = document.createElement('div');
    d.className = 'pts' + (amount < 0 ? ' neg' : '');
    d.textContent = (amount > 0 ? '+' : '') + amount;
    this.el.feed.prepend(d);
    setTimeout(() => d.remove(), 1100);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
  }

  wave(n, flash = true) {
    this.el.waveNum.textContent = n > 0 ? n : '';
    if (flash) { this.el.wave.classList.remove('flash'); void this.el.wave.offsetWidth; this.el.wave.classList.add('flash'); }
  }

  banner(title, sub = '') {
    const b = this.el.banner;
    b.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
  }

  // Several systems can offer a prompt in a frame (shop 3 > stairs 2 > vehicle 1); the best one shows.
  prompt(html, prio = 1) {
    if (!html) return;
    if (prio > this.pendingPrio) { this.pendingPrompt = html; this.pendingPrio = prio; }
  }

  showPrompt(html) {
    if (html === this.lastPrompt) return;
    this.lastPrompt = html;
    this.el.prompt.innerHTML = html || '';
    this.el.prompt.classList.toggle('on', !!html);
  }

  hitmarker(kill, head) {
    this.hitT = kill ? 0.3 : 0.14;
    this.el.hit.classList.toggle('kill', kill || head);
  }

  damage() { this.dmgT = 0.6; }

  driving(on) {
    if (on === this.isDriving) return;
    this.isDriving = on;
    this.el.hud.classList.toggle('driving', on);
  }

  scope(on) {
    if (on === this.scoped) return;
    this.scoped = on;
    document.getElementById('scope').classList.toggle('on', on);
    this.el.cross.style.visibility = on ? 'hidden' : '';
  }

  crosshair(ads, spread) {
    const px = 6 + spread * 520;
    const c = this.el.cross;
    c.classList.toggle('ads', ads > 0.6);
    c.children[0].style.transform = `translateY(${-px - 9}px)`;
    c.children[1].style.transform = `translateY(${px}px)`;
    c.children[2].style.transform = `translateX(${-px - 9}px)`;
    c.children[3].style.transform = `translateX(${px}px)`;
  }

  health(h, max, armour = 0) {
    const f = Math.max(0, h / max);
    // armour: a longer bar (more to lose) in steel blue, with a pip per level
    if (this.lastMax !== max || this.lastArmour !== armour) {
      this.lastMax = max; this.lastArmour = armour;
      this.el.health.style.width = `${Math.round(220 * Math.max(1, max / 100) ** 0.85)}px`;
      this.el.health.classList.toggle('armoured', armour > 0);
      this.el.health.dataset.armour = armour ? '◆'.repeat(armour) : '';
    }
    this.el.healthBar.style.width = `${f * 100}%`;
    this.el.health.classList.toggle('low', f < 0.35);
    this.el.lowhp.style.opacity = f < 0.5 ? (0.5 - f) * 1.8 : 0;
  }

  update(dt) {
    this.showPrompt(this.pendingPrompt);
    this.pendingPrompt = ''; this.pendingPrio = -1;
    if (this.hitT > 0) { this.hitT -= dt; this.el.hit.style.opacity = Math.min(1, this.hitT * 8); }
    else this.el.hit.style.opacity = 0;
    if (this.dmgT > 0) { this.dmgT -= dt; this.el.dmg.style.opacity = Math.min(1, this.dmgT * 2); }
    else this.el.dmg.style.opacity = 0;
  }

  toggleMap() { this.big = !this.big; this.el.map.classList.toggle('big', this.big); }

  // ---- minimap ----
  buildMap(level) {
    const S = 1024, R = 190; // canvas px, metres from centre to edge
    this.mapScale = S / (2 * R);
    this.mapR = R;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d');
    const P = (x, y) => [(x + R) * this.mapScale, (R - y) * this.mapScale];
    const poly = (p, fill) => {
      ctx.beginPath();
      p.outer.forEach(([x, y], i) => { const [a, b] = P(x, y); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
      ctx.closePath();
      for (const h of p.holes || []) { h.forEach(([x, y], i) => { const [a, b] = P(x, y); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.closePath(); }
      ctx.fillStyle = fill; ctx.fill('evenodd');
    };
    ctx.fillStyle = '#20251f'; ctx.fillRect(0, 0, S, S);
    for (const s of level.surroundings.streets) {
      ctx.strokeStyle = '#3a3c40'; ctx.lineWidth = s.w * this.mapScale; ctx.lineCap = 'round';
      ctx.beginPath(); s.line.forEach(([x, y], i) => { const [a, b] = P(x, y); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.stroke();
    }
    if (level.play) poly(level.play, '#2b3129');
    const cols = { road: '#4a4d52', parking: '#4a4d52', pavers: '#6b6a64', lawn: '#35512f', deck: '#b8b2a2', court_pavers: '#6b6a64', court_lawn: '#35512f', court_deck: '#b8b2a2' };
    for (const [k, zs] of Object.entries(level.zones)) for (const z of zs) poly(z, cols[k] || '#555');
    for (const p of level.pools) poly(p.poly, '#2d8fbf');
    for (const c of level.sport || []) {
      const [a, b] = P(c.x, c.y);
      ctx.beginPath(); ctx.arc(a, b, (c.w / 2) * this.mapScale, 0, Math.PI * 2);
      ctx.fillStyle = c.kind === 'court_round' ? '#a4473a' : '#d66d8a'; ctx.fill();
      if (c.kind === 'court_round') { ctx.strokeStyle = '#2f5a3a'; ctx.lineWidth = 2; ctx.stroke(); }
    }
    for (const b of level.buildings) poly(b.poly, b.group === 'podium' ? '#9a9486' : '#d9d6cf');
    // the car parks underneath, as dashed outlines
    ctx.save();
    ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(40,44,52,0.75)';
    for (const u of level.underground || []) {
      ctx.beginPath();
      u.poly.outer.forEach(([x, y], i) => { const [a, b] = P(x, y); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
      ctx.closePath(); ctx.stroke();
      for (const d of u.doors) {
        const [a, b] = P((d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2);
        ctx.fillStyle = '#2f6db3'; ctx.fillRect(a - 9, b - 9, 18, 18);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('P', a, b + 1);
      }
    }
    ctx.restore();
    for (const b of level.surroundings.buildings) poly(b.poly, '#6d6d6b');
    this.mapCanvas = c;
    this.mapCtx = this.el.map.getContext('2d');
  }

  drawMap(player, zombies, markers = [], mates = []) {
    const ctx = this.mapCtx, cv = this.el.map;
    const W = cv.width, H = cv.height;
    const big = this.big;
    const scale = big ? W / (2 * this.mapR) * 1.0 : 2.4; // px per metre
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    const yaw = player.mapYaw ?? player.yaw;   // (in a car: the way the car points)
    if (!big) ctx.rotate(yaw);
    const px = player.pos.x, py = -player.pos.z;
    const k = scale / this.mapScale;
    if (big) {
      ctx.drawImage(this.mapCanvas, -W / 2, -H / 2, W, H);
    } else {
      ctx.drawImage(this.mapCanvas, -(px + this.mapR) * this.mapScale * k, -(this.mapR - py) * this.mapScale * k, this.mapCanvas.width * k, this.mapCanvas.height * k);
    }
    const toMap = (x, z) => big ? [x * (W / (2 * this.mapR)), z * (W / (2 * this.mapR))] : [(x - px) * scale, (z + py) * scale];
    for (const m of markers) {
      if (m.bigOnly && !big) continue;
      const [mx, mz] = toMap(m.x, m.z);
      const r = (big ? 5 : 3.5) * (m.size || 1);
      ctx.fillStyle = m.color;
      if (m.shape === 'square') { ctx.fillRect(mx - r * 0.6, mz - r * 0.6, r * 1.2, r * 1.2); continue; }
      ctx.beginPath(); ctx.arc(mx, mz, r, 0, Math.PI * 2); ctx.fill();
    }
    const zc = { human: '#ff3b30', dog: '#ff9a3a', crow: '#c77dff' };
    for (const z of zombies) {
      if (z.state === 'dead' || z.state === 'climb') continue;
      const [zx, zz] = toMap(z.pos.x, z.pos.z);
      ctx.fillStyle = zc[z.species] || zc.human;
      ctx.beginPath(); ctx.arc(zx, zz, (big ? 3.5 : 2.6) * (z.species === 'crow' ? 0.8 : z.def && z.def.shove ? 1.4 : 1), 0, Math.PI * 2); ctx.fill();
    }
    // teammates: arrows in their colours
    for (const m of mates) {
      if (m.me) continue;
      const [mx, mz] = toMap(m.pos.x, m.pos.z);
      ctx.save();
      ctx.translate(mx, mz);
      ctx.rotate(-m.yaw);
      ctx.globalAlpha = m.dead ? 0.45 : 1;
      ctx.fillStyle = SLOT_CSS[m.slot % 4];
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // player arrow: on the rotating minimap it always points up (the map turns instead);
    // on the big north-up map it turns with the player's heading
    ctx.save();
    ctx.translate(W / 2, H / 2);
    if (big) {
      const [ax, az] = toMap(player.pos.x, player.pos.z);
      ctx.translate(ax, az);
      ctx.rotate(-yaw);
    }
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  setStats(text) { this.el.stats.textContent = text; }

  // ---- co-op ----
  coop(on) {
    for (const id of ['mclock', 'team']) document.getElementById(id)?.classList.toggle('hidden', !on);
    if (!on) this.down(0);
  }

  // time left in the match, top centre
  matchClock(ms) {
    const el = document.getElementById('mclock');
    if (!el) return;
    const t = Math.max(0, Math.ceil(ms / 1000)), txt = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (txt !== this.clockTxt) { this.clockTxt = txt; el.textContent = txt; el.classList.toggle('late', t <= 60); }
  }

  team(list) { this.teamNames = new Map(list.map((t) => [t.slot, t.name || `P${t.slot + 1}`])); this.teamKey = ''; }
  scores(s) { this.teamScores = new Map(s.map((q) => [q[0], q])); this.teamKey = ''; }
  nameOf(slot) { return (this.teamNames && this.teamNames.get(slot)) || `P${slot + 1}`; }

  // everyone's health and points, top left under the map (redrawn when something changes)
  teamPanel(states, talking = null) {
    const el = document.getElementById('team');
    if (!el || !states) return;
    const rows = [...states].sort((a, b) => a.slot - b.slot).map((q) => {
      const sc = this.teamScores && this.teamScores.get(q.slot);
      const hp = Math.max(0, Math.round((q.health / (q.maxHealth || 100)) * 100));
      return { slot: q.slot, me: q.me, dead: q.dead, hp, respawn: Math.ceil(q.respawn || 0), pts: sc ? sc[1] : null, kills: sc ? sc[2] : null, talk: !!(talking && talking.has(q.slot)) };
    });
    const key = JSON.stringify(rows);
    if (key === this.teamKey) return;
    this.teamKey = key;
    el.innerHTML = rows.map((r) => `<div class="mate${r.dead ? ' dead' : ''}${r.me ? ' me' : ''}"><i style="background:${SLOT_CSS[r.slot % 4]}"></i>`
      + `<b>${esc(this.nameOf(r.slot))}${r.me ? ' (you)' : ''}${r.talk ? ' <span class="talk">🔊</span>' : ''}</b>`
      + (r.dead ? `<span class="down">down · ${r.respawn}s</span>` : `<span class="hp"><em style="width:${r.hp}%"></em></span>`)
      + `<span class="pts">${r.pts ?? ''}</span></div>`).join('');
  }

  // you're down: a countdown until you're back
  down(sec) {
    const el = document.getElementById('downmsg');
    if (!el) return;
    const on = sec > 0;
    el.classList.toggle('on', on);
    if (on) { const txt = `You're down. Back in ${Math.ceil(sec)} s, next to your team`; if (el.textContent !== txt) el.textContent = txt; }
  }
}

function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
