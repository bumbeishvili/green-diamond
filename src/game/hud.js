import { DEFS, CATS, UPGRADES } from './weapons.js';
import { isPvp, teamOf, TEAM_CSS, TEAM_NAMES } from './pvp.js';
import { blockName } from '../world/buildings.js';
import { ICONS, badge, badgeImages } from './mapicons.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, parent = null) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };

const SLOT_CSS = ['#3fa7ff', '#5fd35f', '#ffa23a', '#c77dff'];
// how a kill happened, for the feed
const HOW = { knife: 'knife', grenade: 'grenade', bow: 'bow', car: 'ran over', bike: 'ran over', self: 'blew themselves up', zombie: 'zombies' };

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
    this.buildBigMap(level);
    this.lastPrompt = '';
    this.pendingPrompt = ''; this.pendingPrio = -1;
  }

  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
    if (on) { this.flashKeys(12); this.fitMini?.(); } else if (this.big) this.toggleMap();
  }

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
    if (def.saw) {
      this.el.mag.textContent = `${Math.ceil(ammo.mag)}%`;
      this.el.mag.classList.toggle('low', ammo.mag <= 20);
      this.el.res.textContent = `+ ${Math.round(ammo.reserve)} fuel`;
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
    n.textContent = this.touch ? touchWords(text) : text;
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
    if (this.touch) sub = touchWords(sub);
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
    this.el.prompt.innerHTML = this.touch && html ? touchWords(html) : html || '';
    this.el.prompt.classList.toggle('on', !!html);
  }

  hitmarker(kill, head) {
    this.hitT = kill ? 0.3 : 0.14;
    this.el.hit.classList.toggle('kill', kill || head);
  }

  damage() { this.dmgT = 0.6; }

  // the giant's health across the top (null: hide it)
  boss(frac) {
    const el = this.bossEl || (this.bossEl = document.getElementById('boss'));
    if (!el) return;
    const on = frac != null;
    if (on !== this.bossOn) { this.bossOn = on; el.classList.toggle('on', on); }
    if (!on) return;
    const w = Math.round(Math.max(0, Math.min(1, frac)) * 400) / 4;
    if (w !== this.bossW) { this.bossW = w; el.lastElementChild.firstElementChild.style.width = `${w}%`; }
  }

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

  toggleMap() {
    this.big = !this.big;
    this.bigEl.classList.toggle('hidden', !this.big);
    this.el.map.style.visibility = this.big ? 'hidden' : '';
  }

  // ---- minimap ----
  buildMap(level) {
    const S = (devicePixelRatio || 1) > 1.5 ? 2048 : 1536, R = 190; // canvas px, metres from centre to edge
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
    // (the minimap drawn at the screen's own pixel density: sharp on phones and retina screens)
    this.fitMini = () => {
      const cv = this.el.map, css = cv.getBoundingClientRect().width;
      if (!css) return;
      const n = Math.round(css * Math.min(3, devicePixelRatio || 1));
      if (cv.width !== n) cv.width = cv.height = n;
    };
    addEventListener('resize', this.fitMini);
  }

  drawMap(player, zombies, markers = [], mates = []) {
    if (this.big) this.drawBigMap(player, zombies, markers, mates);
    const ctx = this.mapCtx, cv = this.el.map;
    const W = cv.width, H = cv.height, u = W / 220;   // (sizes as on the 220 px original)
    const scale = 2.4 * u; // px per metre
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    const yaw = player.mapYaw ?? player.yaw;   // (in a car: the way the car points)
    ctx.rotate(yaw);
    const px = player.pos.x, py = -player.pos.z;
    const k = scale / this.mapScale;
    ctx.drawImage(this.mapCanvas, -(px + this.mapR) * this.mapScale * k, -(this.mapR - py) * this.mapScale * k, this.mapCanvas.width * k, this.mapCanvas.height * k);
    const toMap = (x, z) => [(x - px) * scale, (z + py) * scale];
    const bpx = Math.round(11 * u);
    if (this.badgePx !== bpx) { this.badgePx = bpx; this.badges = badgeImages(bpx); }
    for (const m of markers) {
      if (m.bigOnly) continue;
      const [mx, mz] = toMap(m.x, m.z);
      const img = m.icon && this.badges[m.icon];
      if (img && img.complete && img.naturalWidth) {
        // (the badge stays upright while the map turns)
        const s = bpx * (m.station ? 1.08 : 0.92);
        ctx.save(); ctx.translate(mx, mz); ctx.rotate(-yaw); ctx.drawImage(img, -s / 2, -s / 2, s, s); ctx.restore();
        continue;
      }
      const r = 3.5 * u * (m.size || 1);
      ctx.fillStyle = m.color;
      ctx.beginPath(); ctx.arc(mx, mz, r, 0, Math.PI * 2); ctx.fill();
    }
    const zc = { human: '#ff3b30', dog: '#ff9a3a', crow: '#c77dff' };
    for (const z of zombies) {
      if (z.state === 'dead' || z.state === 'climb') continue;
      const [zx, zz] = toMap(z.pos.x, z.pos.z);
      ctx.fillStyle = zc[z.species] || zc.human;
      ctx.beginPath(); ctx.arc(zx, zz, 2.6 * u * (z.species === 'crow' ? 0.8 : z.def && z.def.boss ? 2.4 : z.def && z.def.shove ? 1.4 : 1), 0, Math.PI * 2); ctx.fill();
    }
    // teammates: arrows in their colours
    for (const m of mates) {
      if (m.me) continue;
      const [mx, mz] = toMap(m.pos.x, m.pos.z);
      ctx.save();
      ctx.translate(mx, mz);
      ctx.rotate(-m.yaw);
      ctx.scale(u, u);
      ctx.globalAlpha = m.dead ? 0.45 : 1;
      ctx.fillStyle = SLOT_CSS[m.slot % 4];
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // you: always pointing up (the map turns instead), rings pulsing out from under the arrow
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(u, u);
    const now = performance.now() / 1600;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4;
    for (const off of [0, 0.5]) {
      const k = (now + off) % 1;
      ctx.globalAlpha = 0.8 * (1 - k);
      ctx.beginPath(); ctx.arc(0, 0, 5 + k * 17, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ---- the big map (M): the level drawn in vectors (sharp at any size), north up, with its names ----
  buildBigMap(level) {
    const el = this.bigEl = document.createElement('div');
    el.id = 'bigmap';
    el.className = 'hidden';
    const P = level.play ? level.play.outer : level.buildings.flatMap((b) => b.poly.outer);
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    // (room east for the street and the gates' names, and at the bottom for the legend)
    const x0 = Math.min(...xs) - 14, x1 = Math.max(...xs) + 34, y0 = -Math.max(...ys) - 14, y1 = -Math.min(...ys) + 14;
    const W = x1 - x0, H = y1 - y0;
    // (the map, and its legend beside it)
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.style.setProperty('--ar', (W / H).toFixed(3));
    el.appendChild(wrap);
    const frame = document.createElement('div');
    frame.className = 'frame';
    wrap.appendChild(frame);
    const root = svg('svg', { viewBox: `${x0.toFixed(1)} ${y0.toFixed(1)} ${W.toFixed(1)} ${H.toFixed(1)}`, preserveAspectRatio: 'xMidYMid meet' }, frame);
    const f = (v) => v.toFixed(1);
    const ring = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(-y)}`).join('') + 'Z';
    const polyD = (p) => ring(p.outer) + (p.holes || []).map(ring).join('');
    const line = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(-y)}`).join('');
    const layer = (cls) => svg('g', { class: cls }, root);
    svg('rect', { x: f(x0), y: f(y0), width: f(W), height: f(H), class: 'ground' }, root);
    const streets = layer('streets');
    for (const s of level.surroundings.streets) svg('path', { d: line(s.line), 'stroke-width': s.w }, streets);
    if (level.play) svg('path', { d: polyD(level.play), class: 'play', 'fill-rule': 'evenodd' }, root);
    const ZC = { road: 'road', parking: 'road', pavers: 'pavers', lawn: 'lawn', deck: 'deck', court_pavers: 'pavers', court_lawn: 'lawn', court_deck: 'deck' };
    const zones = layer('zones');
    for (const [k, zs] of Object.entries(level.zones)) for (const z of zs) svg('path', { d: polyD(z), class: ZC[k] || 'road', 'fill-rule': 'evenodd' }, zones);
    const pools = layer('pools');
    for (const p of level.pools) svg('path', { d: polyD(p.poly), 'fill-rule': 'evenodd' }, pools);
    const courts = layer('courts');
    for (const c of level.sport || []) svg('circle', { cx: f(c.x), cy: f(-c.y), r: f(c.w / 2), class: c.kind === 'court_round' ? 'round' : 'pad' }, courts);
    const under = layer('under');
    for (const u of level.underground || []) svg('path', { d: polyD(u.poly) }, under);
    const blds = layer('blds');
    for (const b of level.surroundings.buildings) svg('path', { d: polyD(b.poly), class: 'out', 'fill-rule': 'evenodd' }, blds);
    for (const b of level.buildings) svg('path', { d: polyD(b.poly), class: b.group || 'mid', 'fill-rule': 'evenodd' }, blds);
    // the car parks' ramps: a P
    const icons = layer('icons');
    for (const u of level.underground || []) for (const dr of u.doors) {
      const g = svg('g', { class: 'park', transform: `translate(${f((dr.a[0] + dr.b[0]) / 2)} ${f(-(dr.a[1] + dr.b[1]) / 2)})` }, icons);
      svg('rect', { x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 0.9 }, g);
      svg('text', { y: 1.45 }, g).textContent = 'P';
    }
    const labels = layer('labels');
    // the streets' names along them (the longest stretch of each inside the map; reading left to right)
    const clip = (a, b) => {   // a segment cut to the map (Liang-Barsky, in map coordinates)
      const bx0 = x0 + 4, bx1 = x1 - 4, by0 = -(y1 - 6), by1 = -(y0 + 14);
      let t0 = 0, t1 = 1;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      for (const [q, r] of [[-dx, a[0] - bx0], [dx, bx1 - a[0]], [-dy, a[1] - by0], [dy, by1 - a[1]]]) {
        if (q === 0) { if (r < 0) return null; continue; }
        const t = r / q;
        if (q < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
      }
      return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
    };
    const best = new Map();
    for (const s of level.surroundings.streets) {
      if (!s.name) continue;
      let run = [], len = 0;
      const flush = () => { if (run.length > 1 && len > 45 && len > (best.get(s.name)?.len || 0)) best.set(s.name, { pts: run, len }); run = []; len = 0; };
      for (let i = 1; i < s.line.length; i++) {
        const c = clip(s.line[i - 1], s.line[i]);
        if (!c) { flush(); continue; }
        if (!run.length) run.push(c[0]);
        else if (Math.hypot(run[run.length - 1][0] - c[0][0], run[run.length - 1][1] - c[0][1]) > 0.5) { flush(); run.push(c[0]); }
        run.push(c[1]); len += Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]);
      }
      flush();
    }
    const defs = svg('defs', {}, root);
    for (const kind of Object.keys(ICONS)) { const sym = svg('symbol', { id: `ic-${kind}`, viewBox: '0 0 24 24' }, defs); sym.innerHTML = badge(kind); }
    let si = 0;
    for (const [name, { pts }] of best) {
      const a = pts[0], z = pts[pts.length - 1];
      const run = z[0] - a[0] < 0 || (Math.abs(z[0] - a[0]) < 1 && z[1] < a[1]) ? [...pts].reverse() : pts;
      svg('path', { id: `bm-st-${si}`, d: line(run) }, defs);
      const t = svg('text', { class: 'street', dy: 1.3 }, labels);
      const tp = svg('textPath', { href: `#bm-st-${si}`, startOffset: '50%', 'text-anchor': 'middle' }, t);
      tp.textContent = name;
      si++;
    }
    this.big2Level = { level, labels, x0, x1, y0, y1 };
    // north, and a scale
    const nG = svg('g', { class: 'north', transform: `translate(${f(x1 - 9)} ${f(y0 + 11)})` }, root);
    svg('path', { d: 'M0 -6 L3.2 3 L0 1.2 L-3.2 3 Z' }, nG);
    svg('text', { y: 9.5 }, nG).textContent = 'N';
    const sG = svg('g', { class: 'scale', transform: `translate(${f(x0 + 8)} ${f(y0 + 9)})` }, root);
    svg('path', { d: 'M0 -1.6 V0 H50 V-1.6' }, sG);
    svg('text', { x: 25, y: -3 }, sG).textContent = '50 m';
    // (the parts that move, filled in while it's open: dots under tags under arrows)
    const dyn = svg('g', { class: 'dyn' }, root);
    const dotG = svg('g', {}, dyn), tagG = svg('g', { class: 'tags' }, dyn);
    // where you are: rings pulsing out from under your arrow, one after the other
    const me = svg('g', { class: 'me' }, dyn);
    svg('circle', { r: 3.4, class: 'halo' }, me);
    for (const begin of ['0s', '0.8s']) {
      const ring = svg('circle', { r: 2.5, class: 'ring' }, me);
      svg('animate', { attributeName: 'r', values: '2.5;12', dur: '1.6s', begin, repeatCount: 'indefinite' }, ring);
      svg('animate', { attributeName: 'opacity', values: '0.95;0', dur: '1.6s', begin, repeatCount: 'indefinite' }, ring);
    }
    this.big2 = { g: { dot: dotG, tag: tagG, arrow: svg('g', {}, dyn) }, me, pool: { dot: [], sq: [], tag: [], arrow: [] } };
    const legend = document.createElement('div');
    legend.className = 'legend';
    const item = (swatch, text) => `<span>${swatch}${text}</span>`;
    const ic = (kind) => `<svg class="ic" viewBox="0 0 24 24">${badge(kind)}</svg>`;
    legend.innerHTML = [
      item('<i class="arrow"></i>', 'you'), item('<i style="background:#ff3b30"></i>', 'zombies'), item(ic('giant'), 'a giant'),
      item(ic('shop-gun'), 'shops and weapons'), item(ic('ammo'), 'ammo'), item(ic('health'), 'first aid'), item(ic('cash'), 'lari'),
      item(ic('gun'), 'a gun'), item(ic('word'), 'question crate'), item(ic('powerup'), 'power-up'), item(ic('stairs'), 'stairs'), item('<b>P</b>', 'car park'),
    ].join('') + `<em>${'ontouchstart' in window ? 'tap to close' : 'M to close'}</em>`;
    wrap.appendChild(legend);
    const close = (e) => { e.preventDefault(); e.stopPropagation(); if (this.big) this.toggleMap(); };
    el.addEventListener('click', close);
    el.addEventListener('touchstart', close, { passive: false });
    document.body.appendChild(el);
  }

  // The big map's names: blocks first, then the gates, the shops with what they sell, the other
  // stations; each at the first spot around its place that covers nothing already there.
  placeLabels(stations) {
    const { level, labels, x0, x1, y0, y1 } = this.big2Level, f = (v) => v.toFixed(1);
    const placed = [], yMax = y1 - 1;
    const measure = (lines) => ({ w: Math.max(...lines.map((l) => [...l.text].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 0.66 : 0.56), 0) * l.size)) + 1, h: lines.reduce((a, l) => a + l.size * 1.12, 0) });
    const place = (x, y, lines, cands, force = false) => {
      const { w, h } = measure(lines);
      for (const [dx, dy] of cands) {
        const b = [x + dx - w / 2, y + dy - h / 2, x + dx + w / 2, y + dy + h / 2];
        if (b[0] < x0 + 1 || b[2] > x1 - 1 || b[1] < y0 + 1 || b[3] > yMax) continue;
        if (!force && placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1])) continue;
        placed.push(b);
        let ty = b[1];
        for (const l of lines) { ty += l.size * 1.12; svg('text', { x: f(x + dx), y: f(ty - l.size * 0.22), class: l.cls }, labels).textContent = l.text; }
        return true;
      }
      if (force) return place(x, y, lines, [cands[0]], true);
      return false;
    };
    const around = (r) => [[0, 0], [0, -r], [0, r], [-r * 1.6, 0], [r * 1.6, 0], [0, -2 * r], [0, 2 * r], [-r * 1.6, -r], [r * 1.6, -r], [-r * 1.6, r], [r * 1.6, r], [0, -3 * r], [0, 3 * r]];
    // (never on top of the icon it names; further out if it's crowded there)
    const beside = (r) => [...around(r).slice(1), ...[[0, -4], [0, 4], [-2.6, 0], [2.6, 0], [-2.6, -2], [2.6, -2], [-2.6, 2], [2.6, 2], [0, -5], [0, 5]].map(([a, b]) => [a * r, b * r])];
    // the stations' icons and the car parks' P signs: nothing written over them
    for (const m of stations) placed.push([m.x - 2.7, m.z - 2.7, m.x + 2.7, m.z + 2.7]);
    for (const u of level.underground || []) for (const dr of u.doors) { const x = (dr.a[0] + dr.b[0]) / 2, z = -(dr.a[1] + dr.b[1]) / 2; placed.push([x - 2.8, z - 2.8, x + 2.8, z + 2.8]); }
    // the blocks (a building with two lobbies: a name by each)
    const byB = new Map();
    for (const d of level.doors || []) {
      const n = blockName(d.building, d);
      if (!n) continue;
      if (!byB.has(d.building)) byB.set(d.building, []);
      byB.get(d.building).push({ d, n });
    }
    for (const [id, list] of byB) {
      const b = level.buildings.find((q) => q.id === id);
      if (!b) continue;
      const names = [...new Set(list.map((q) => q.n.letters))];
      const put = (x, y, n) => place(x, -y, [{ text: n.letters, size: 6.4, cls: 'blk' + (n.provisional ? ' prov' : '') }], around(5), true);
      if (names.length === 1) {
        const o = b.poly.outer; let cx = 0, cy = 0; for (const [x, y] of o) { cx += x / o.length; cy += y / o.length; }
        put(cx, cy, list[0].n);
      } else for (const name of names) { const { d, n } = list.find((q) => q.n.letters === name); put(d.x - Math.cos(d.h) * 8, d.y - Math.sin(d.h) * 8, n); }
    }
    for (const g of level.gates || []) place(g.x, -g.y, [{ text: g.name.toUpperCase(), size: 4.4, cls: 'gate' }], [[12, 0], [12, -6], [12, 6], [0, -7], [0, 7]], true);
    // the shops, each with what it sells there
    const NAME = { Diamond: 'ხილ ბოსტანი', 'Ori Nabiji': '2 Nabiji' }, used = new Set();
    for (const p of level.pois || []) {
      const name = NAME[p.name] || p.name;
      const st = stations.find((m) => !used.has(m) && Math.hypot(m.x - p.x, m.z + p.y) < 5);
      if (!name || (p.kind === 'payment_terminal' && !st)) continue;
      if (st) used.add(st);
      const lines = [{ text: p.kind === 'payment_terminal' ? 'TBC' : name, size: 3.7, cls: 'shop' }];
      if (st) lines.push({ text: st.tag, size: 3.1, cls: 'tagl' });
      place(p.x, -p.y, lines, beside(5.5));
    }
    // the stations away from the shops (crates, roofs, the car park, the booths)
    for (const m of stations) if (!used.has(m) && m.tag) place(m.x, m.z, [{ text: m.tag, size: 3.1, cls: 'tagl' }], beside(3.6));
  }

  // the big map's moving parts (pooled SVG elements)
  drawBigMap(player, zombies, markers, mates) {
    if (!this.big2Placed) { this.big2Placed = true; this.placeLabels(markers.filter((m) => m.station)); }
    const { g, pool } = this.big2, used = { dot: 0, sq: 0, tag: 0, arrow: 0, icon: 0 };
    if (!pool.icon) pool.icon = [];
    const get = (kind, tag, parent) => { let e = pool[kind][used[kind]++]; if (!e) { e = svg(tag, {}, parent); pool[kind].push(e); } e.style.display = ''; return e; };
    const f = (v) => v.toFixed(1);
    const dot = (x, z, r, fill, cls = '') => { const e = get('dot', 'circle', g.dot); e.setAttribute('cx', f(x)); e.setAttribute('cy', f(z)); e.setAttribute('r', r); e.setAttribute('fill', fill); e.setAttribute('class', cls); };
    const arrow = (x, z, yaw, fill, size, alpha = 1) => {
      const e = get('arrow', 'path', g.arrow);
      e.setAttribute('d', 'M0 -3.2 L2.3 2.6 L0 1.2 L-2.3 2.6 Z');
      e.setAttribute('transform', `translate(${f(x)} ${f(z)}) rotate(${(-yaw * 180 / Math.PI).toFixed(0)}) scale(${size})`);
      e.setAttribute('fill', fill); e.setAttribute('opacity', alpha);
    };
    for (const m of markers) {
      if (m.icon && ICONS[m.icon]) {
        const e = get('icon', 'use', g.dot), s = m.station ? 5.2 : m.icon === 'stairs' ? 3.4 : 4.2;
        const href = `#ic-${m.icon}`;
        if (e.getAttribute('href') !== href) e.setAttribute('href', href);
        e.setAttribute('x', f(m.x - s / 2)); e.setAttribute('y', f(m.z - s / 2)); e.setAttribute('width', s); e.setAttribute('height', s);
      } else dot(m.x, m.z, m.station ? 1.8 : 1.35 * (m.size || 1), m.color, m.station ? 'st' : 'pk');
    }
    const zc = { human: '#ff3b30', dog: '#ff9a3a', crow: '#c77dff' };
    for (const z of zombies) {
      if (z.state === 'dead' || z.state === 'climb') continue;
      if (z.def && z.def.boss) {
        const e = get('icon', 'use', g.arrow);
        if (e.getAttribute('href') !== '#ic-giant') e.setAttribute('href', '#ic-giant');
        e.setAttribute('x', f(z.pos.x - 3.6)); e.setAttribute('y', f(z.pos.z - 3.6)); e.setAttribute('width', 7.2); e.setAttribute('height', 7.2);
        continue;
      }
      dot(z.pos.x, z.pos.z, 1.15 * (z.species === 'crow' ? 0.8 : z.def && z.def.shove ? 1.4 : 1), zc[z.species] || zc.human, 'z');
    }
    for (const m of mates) if (!m.me) arrow(m.pos.x, m.pos.z, m.yaw, SLOT_CSS[m.slot % 4], 1.3, m.dead ? 0.45 : 1);
    this.big2.me.setAttribute('transform', `translate(${f(player.pos.x)} ${f(player.pos.z)})`);
    arrow(player.pos.x, player.pos.z, player.mapYaw ?? player.yaw, '#ffffff', 1.6);
    for (const kind of Object.keys(pool)) for (let i = used[kind]; i < pool[kind].length; i++) pool[kind][i].style.display = 'none';
  }

  setStats(text) { this.el.stats.textContent = text; }

  // ---- co-op ----
  coop(on) {
    for (const id of ['mclock', 'team', 'key-talk']) document.getElementById(id)?.classList.toggle('hidden', !on);
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
  // PvP or co-op (the rules from the host; null: solo)
  pvpMode(rules) {
    this.rules = rules;
    this.el.hud.classList.toggle('pvp', isPvp(rules));
    this.el.hud.classList.toggle('nozombies', isPvp(rules) && !rules.zombies);
    this.teamKey = '';
  }

  colorOf(slot) { const t = teamOf(this.rules, slot); return t >= 0 ? TEAM_CSS[t] : SLOT_CSS[slot % 4]; }

  teamPanel(states, talking = null) {
    const el = document.getElementById('team');
    if (!el || !states) return;
    if (isPvp(this.rules)) return this.pvpBoard(el, states, talking);
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

  // PvP: everyone by kills (your team's health, never your foes'), the teams' totals on top
  pvpBoard(el, states, talking) {
    const me = states.find((q) => q.me), mySlot = me ? me.slot : 0, teams = this.rules.mode === 'teams';
    const foe = (slot) => slot !== mySlot && (!teams || teamOf(this.rules, slot) !== teamOf(this.rules, mySlot));
    const rows = states.map((q) => {
      const sc = this.teamScores && this.teamScores.get(q.slot);
      return { slot: q.slot, me: q.me, dead: q.dead, foe: foe(q.slot), hp: Math.max(0, Math.round((q.health / (q.maxHealth || 100)) * 100)), respawn: Math.ceil(q.respawn || 0),
        frags: sc ? sc[5] || 0 : 0, deaths: sc ? sc[4] : 0, talk: !!(talking && talking.has(q.slot)) };
    }).sort((a, b) => b.frags - a.frags || a.slot - b.slot);
    const tf = [0, 0];
    if (teams) for (const r of rows) tf[teamOf(this.rules, r.slot)] += r.frags;
    const key = JSON.stringify([rows, tf]);
    if (key === this.teamKey) return;
    this.teamKey = key;
    el.innerHTML = (teams ? `<div class="score"><b style="color:${TEAM_CSS[0]}">${TEAM_NAMES[0]} ${tf[0]}</b><span>·</span><b style="color:${TEAM_CSS[1]}">${tf[1]} ${TEAM_NAMES[1]}</b>${this.rules.kills ? `<em>to ${this.rules.kills}</em>` : ''}</div>`
      : this.rules.kills ? `<div class="score"><em>first to ${this.rules.kills}</em></div>` : '')
      + rows.map((r) => `<div class="mate${r.dead ? ' dead' : ''}${r.me ? ' me' : ''}"><i style="background:${this.colorOf(r.slot)}"></i>`
        + `<b>${esc(this.nameOf(r.slot))}${r.me ? ' (you)' : ''}${r.talk ? ' <span class="talk">🔊</span>' : ''}</b>`
        + (r.dead ? `<span class="down">${r.respawn}s</span>` : r.foe ? '<span class="hp foe"></span>' : `<span class="hp"><em style="width:${r.hp}%"></em></span>`)
        + `<span class="pts">${r.frags}<small>/${r.deaths}</small></span></div>`).join('');
  }

  // PvP: who killed whom, top right, for a few seconds (null: clear it)
  killFeed(k, v, how, me) {
    const el = document.getElementById('killfeed');
    if (!el) return;
    if (k === null) { el.innerHTML = ''; return; }
    const name = (s) => `<b style="color:${this.colorOf(s)}">${esc(s === me ? 'You' : this.nameOf(s))}</b>`;
    const w = HOW[how] || (DEFS[how] ? DEFS[how].short : how);
    const row = document.createElement('div');
    row.className = k === me || v === me ? 'mine' : '';
    row.innerHTML = k >= 0 ? `${name(k)} <span>${esc(w)}</span> ${name(v)}` : `${name(v)} <span>${esc(w)}</span>`;
    el.prepend(row);
    while (el.children.length > 5) el.lastElementChild.remove();
    setTimeout(() => { row.classList.add('old'); setTimeout(() => row.remove(), 600); }, 6000);
  }

  // you're down: a countdown until you're back (why: PvP, who got you)
  down(sec, why = null) {
    const el = document.getElementById('downmsg');
    if (!el) return;
    const on = sec > 0;
    el.classList.toggle('on', on);
    if (on) { const txt = why ? `${why}. Back in ${Math.ceil(sec)} s` : `You're down. Back in ${Math.ceil(sec)} s, next to your team`; if (el.textContent !== txt) el.textContent = txt; }
  }
}

// On a phone the keys are buttons: say so ("Press F" is "tap USE", WASD is the stick...)
function touchWords(t) {
  return String(t)
    .replace(/Press <b>F<\/b> — /g, 'Tap <b>USE</b> — ').replace(/Press F\b/g, 'Tap USE').replace(/press F\b/g, 'tap USE')
    .replace(/WASD drive/g, 'the stick drives').replace(/Space handbrake/g, 'BRAKE').replace(/\bF to get out/g, 'OUT gets out')
    .replace(/\bF get out/g, 'OUT gets out').replace(/the map \(M\)/g, 'the map').replace(/\(M\)/g, '(tap the map)').replace(/\bR to refuel/g, 'RELOAD refuels')
    .replace(/hold T\b/g, 'hold TALK').replace(/\bpress F\b/gi, 'tap USE')
    .replace(/<b>F<\/b> get out/g, '<b>OUT</b> gets out').replace(/<b>F<\/b>/g, '<b>USE</b>');
}

function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
