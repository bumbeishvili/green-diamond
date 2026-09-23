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

  weapon(def, ammo) {
    this.el.ammoName.textContent = def.name;
    this.el.mag.textContent = ammo.mag;
    this.el.mag.classList.toggle('low', ammo.mag <= Math.ceil(def.mag * 0.25));
    this.el.res.textContent = `/ ${ammo.reserve}`;
  }

  points(n) { this.el.points.textContent = n; }

  // 1-4 weapon slots next to the ammo counter
  slots(owned, current) {
    const el = document.getElementById('slots');
    if (!el) return;
    const names = { pistol: 'Makarov', rifle: 'AK-74', shotgun: 'Shotgun', sniper: 'SVD' };
    el.innerHTML = ['pistol', 'rifle', 'shotgun', 'sniper'].map((k, i) =>
      `<span class="${owned[k] ? 'own' : ''} ${k === current ? 'cur' : ''}"><b>${i + 1}</b>${names[k]}</span>`).join('');
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

  prompt(html) {
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

  health(h, max) {
    const f = Math.max(0, h / max);
    this.el.healthBar.style.width = `${f * 100}%`;
    this.el.health.classList.toggle('low', f < 0.35);
    this.el.lowhp.style.opacity = f < 0.5 ? (0.5 - f) * 1.8 : 0;
  }

  update(dt) {
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
    for (const b of level.buildings) poly(b.poly, b.group === 'podium' ? '#9a9486' : '#d9d6cf');
    for (const b of level.surroundings.buildings) poly(b.poly, '#6d6d6b');
    this.mapCanvas = c;
    this.mapCtx = this.el.map.getContext('2d');
  }

  drawMap(player, zombies, markers = []) {
    const ctx = this.mapCtx, cv = this.el.map;
    const W = cv.width, H = cv.height;
    const big = this.big;
    const scale = big ? W / (2 * this.mapR) * 1.0 : 2.4; // px per metre
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    if (!big) ctx.rotate(player.yaw);
    const px = player.pos.x, py = -player.pos.z;
    const k = scale / this.mapScale;
    if (big) {
      ctx.drawImage(this.mapCanvas, -W / 2, -H / 2, W, H);
    } else {
      ctx.drawImage(this.mapCanvas, -(px + this.mapR) * this.mapScale * k, -(this.mapR - py) * this.mapScale * k, this.mapCanvas.width * k, this.mapCanvas.height * k);
    }
    const toMap = (x, z) => big ? [x * (W / (2 * this.mapR)), z * (W / (2 * this.mapR))] : [(x - px) * scale, (z + py) * scale];
    for (const m of markers) {
      const [mx, mz] = toMap(m.x, m.z);
      ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(mx, mz, big ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#ff3b30';
    for (const z of zombies) {
      if (z.state === 'dead') continue;
      const [zx, zz] = toMap(z.pos.x, z.pos.z);
      ctx.beginPath(); ctx.arc(zx, zz, big ? 3.5 : 2.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // player arrow: on the rotating minimap it always points up (the map turns instead);
    // on the big north-up map it turns with the player's heading
    ctx.save();
    ctx.translate(W / 2, H / 2);
    if (big) {
      const [ax, az] = toMap(player.pos.x, player.pos.z);
      ctx.translate(ax, az);
      ctx.rotate(-player.yaw);
    }
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  setStats(text) { this.el.stats.textContent = text; }
}
