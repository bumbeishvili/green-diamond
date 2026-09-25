// Memory palace (the method of loci): a walk round Green Diamond itself, past places you know (the
// gates, the shops, the pools, the playgrounds, the blocks), with a thing left at each stop; then what
// was at one of them (two, from a puzzle crate), any of them. Tying things to places along a route is
// the oldest way there is to remember a list (memory), and the things are English words, to learn
// some on the way. Harder levels: more stops, less time at each, harder words.

import { el, esc, shuffle, style, svg } from '../util.js';
import { blockName } from '../../world/buildings.js';

const BLOCKS = ['A', 'F', 'G', 'H', 'G2'];   // (the blocks on the walk: tall or on a corner, easy to place)
const SHOP = { Spar: 'Spar', Nikora: 'Nikora', Assorti: 'Assorti', Diamond: 'the fruit shop', '36.6': 'the pharmacy', 'Format Fit': 'Format Fit', '': 'the corner shop' };

const mid = (o) => [o.reduce((a, p) => a + p[0], 0) / o.length, o.reduce((a, p) => a + p[1], 0) / o.length];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// the places, from the level (x east, y north), each with a short name
function places(L) {
  const out = [];
  const add = (name, x, y) => { if (Number.isFinite(x) && Number.isFinite(y) && !out.some((p) => p.name === name)) out.push({ name, x, y }); };
  for (const g of L.gates || []) add(g.name, g.x, g.y);
  // (OSM's "Diamond" is the fruit shop, ხილ ბოსტანი; its café with no name is the corner shop)
  for (const p of L.pois || []) if ((p.name || '') in SHOP) add(SHOP[p.name || ''], p.x, p.y);
  const pools = (L.pools || []).map((p) => mid(p.poly.outer)).sort((a, b) => b[1] - a[1]);
  if (pools.length === 3) ['the north pool', 'the courtyard pool', 'the pool by the towers'].forEach((name, i) => add(name, ...pools[i]));
  const small = (L.buildings || []).filter((b) => b.group === 'small').map((b) => mid(b.poly.outer));
  if (pools[1] && small.length) {
    const ph = small.reduce((a, b) => (Math.hypot(b[0] - pools[1][0], b[1] - pools[1][1]) < Math.hypot(a[0] - pools[1][0], a[1] - pools[1][1]) ? b : a));
    add('the pool house', ...ph);
  }
  const stadium = (L.sport || []).find((c) => c.kind === 'court_round'), hoops = (L.sport || []).find((c) => c.kind === 'basketball_half');
  if (stadium) add('the stadium', stadium.x, stadium.y);
  if (hoops) add('the basketball court', hoops.x, hoops.y);
  // the big playgrounds: the middle courtyard's west and east ones, and the north courtyard's
  const pg = (L.playgrounds || []).filter((p) => !p.small), inMid = pg.filter((p) => p.y < 50).sort((a, b) => a.x - b.x);
  if (inMid.length > 1) { add('the west playground', inMid[0].x, inMid[0].y); add('the east playground', inMid.at(-1).x, inMid.at(-1).y); }
  const north = pg.filter((p) => p.y >= 50).sort((a, b) => b.x - a.x)[0];
  if (north) add('the north playground', north.x, north.y);
  const nikora = (L.pois || []).find((p) => p.name === 'Nikora');
  if (nikora && L.ramps?.length) {
    const r = L.ramps.map((q) => ({ x: (q.top[0] + q.bottom[0]) / 2, y: (q.top[1] + q.bottom[1]) / 2 })).sort((a, b) => dist(a, nikora) - dist(b, nikora))[0];
    add('the car park ramp by Nikora', r.x, r.y);
  }
  for (const b of L.buildings || []) {
    const bn = blockName(b.id);
    if (bn && BLOCKS.includes(bn.letters)) add(`Block ${bn.letters}`, ...mid(b.poly.outer));
  }
  return out;
}

// n of them, no two so close their marks on the map would touch
function spread(all, n, gap = 28) {
  for (let t = 0; t < 80; t++) {
    const got = [];
    for (const p of shuffle([...all])) if (got.length < n && got.every((q) => dist(p, q) >= gap)) got.push(p);
    if (got.length === n) return got;
  }
  return shuffle([...all]).slice(0, n);
}

// a sensible walk through them: from the one nearest the gate, always to the nearest next, then any two
// legs that cross uncrossed
function walk(ps, from) {
  const left = [...ps], out = [];
  let cur = from;
  while (left.length) {
    const k = left.reduce((bi, p, i) => (dist(cur, p) < dist(cur, left[bi]) ? i : bi), 0);
    cur = left.splice(k, 1)[0];
    out.push(cur);
  }
  for (let again = true, t = 0; again && t < 60; t++) {
    again = false;
    for (let i = 0; i < out.length - 2; i++) {
      for (let j = i + 2; j < out.length; j++) {
        const a = out[i], b = out[i + 1], c = out[j], e = out[j + 1];
        if (dist(a, c) + (e ? dist(b, e) : 0) < dist(a, b) + (e ? dist(c, e) : 0) - 0.01) {
          out.splice(i + 1, j - i, ...out.slice(i + 1, j + 1).reverse());
          again = true;
        }
      }
    }
  }
  return out;
}

// the map: the site, its blocks and pools, the walk and its numbered stops; returns mark(i, how)
function drawMap(parent, L, stops) {
  const o = L.play?.outer || [], f = (v) => v.toFixed(1), pts = (poly) => poly.map(([x, y]) => `${f(x)},${f(-y)}`).join(' ');
  const xs = [...o.map((p) => p[0]), ...stops.map((p) => p.x)], ys = [...o.map((p) => -p[1]), ...stops.map((p) => -p.y)];
  const x0 = Math.min(...xs) - 12, y0 = Math.min(...ys) - 12, w = Math.max(...xs) + 12 - x0, h = Math.max(...ys) + 12 - y0;
  const s = svg('svg', { viewBox: `${f(x0)} ${f(y0)} ${f(w)} ${f(h)}`, class: 'map' }, parent);
  if (o.length) svg('polygon', { points: pts(o), class: 'site' }, s);
  for (const z of [...(L.zones?.lawn || []), ...(L.zones?.court_lawn || [])]) svg('polygon', { points: pts(z.outer), class: 'lawn' }, s);
  for (const p of L.pools || []) svg('polygon', { points: pts(p.poly.outer), class: 'pool' }, s);
  for (const b of L.buildings || []) svg('polygon', { points: pts(b.poly.outer), class: 'bld' }, s);
  svg('polyline', { points: stops.map((p) => `${f(p.x)},${f(-p.y)}`).join(' '), class: 'route' }, s);
  const marks = stops.map((p, i) => {
    const g = svg('g', { class: 'stop', transform: `translate(${f(p.x)} ${f(-p.y)})` }, s);
    svg('circle', { r: 17, class: 'halo' }, g);
    svg('circle', { r: 10 }, g);
    svg('text', { y: 4.2 }, g).textContent = i + 1;
    return g;
  });
  return (i, how = null) => {
    marks.forEach((g, k) => g.classList.toggle('on', k === i));
    if (marks[i]) { s.appendChild(marks[i]); if (how) marks[i].classList.add(how); }   // (the one asked about on top)
  };
}

export default {
  how: 'A walk round Green Diamond, with a thing left at each stop. Remember <b>what was where</b>: then walk it again.',

  async run(ctx) {
    style('route', `
      #train .d-route .walk { display: flex; gap: 20px; align-items: center; justify-content: center; width: 100%; }
      #train .d-route .map { width: 300px; height: 300px; display: block; flex: none; }
      #train .d-route .map .site { fill: #181b20; stroke: #4a505a; stroke-width: 1.4; stroke-linejoin: round; }
      #train .d-route .map .lawn { fill: #1f2b22; }
      #train .d-route .map .bld { fill: #3d424b; }
      #train .d-route .map .pool { fill: #28546c; }
      #train .d-route .map .route { fill: none; stroke: #8f6ae0; stroke-width: 2.6; stroke-dasharray: 6 5; stroke-linejoin: round; stroke-linecap: round; }
      #train .d-route .map .stop circle { fill: #1b1f25; stroke: #b98cff; stroke-width: 2; }
      #train .d-route .map .stop text { fill: #e6ddff; font: 700 12px var(--body); text-anchor: middle; }
      #train .d-route .map .stop .halo { fill: none; stroke: none; }
      #train .d-route .map .stop.on circle:not(.halo) { fill: #ffe066; stroke: #fff; }
      #train .d-route .map .stop.on text { fill: #111418; }
      #train .d-route .map .stop.on .halo { stroke: #ffe066; stroke-width: 3; animation: rtPulse 1s ease-in-out infinite alternate; }
      #train .d-route .map .stop.ok:not(.on) circle:not(.halo) { fill: #1d3a22; stroke: #5fd35f; }
      #train .d-route .map .stop.no:not(.on) circle:not(.halo) { fill: #3a1d1d; stroke: #ff5a4a; }
      @keyframes rtPulse { from { opacity: .25; } to { opacity: .9; } }
      #train .d-route .side { flex: 1; max-width: 340px; min-height: 250px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; }
      #train .d-route .lead { font-size: 19px; line-height: 1.45; }
      #train .d-route .place { font: 700 22px var(--body); color: #d9ceff; }
      #train .d-route .em { font-size: 74px; line-height: 1.05; min-height: 78px; }
      #train .d-route .word { font: 800 32px var(--body); color: #fff; line-height: 1.1; }
      #train .d-route .ka { font-size: 16px; color: var(--muted); }
      #train .d-route .next { margin-top: 6px; background: #1b1f25; border: 1px solid #333840; color: var(--ink); font: 600 16px var(--body); border-radius: 8px; padding: 9px 26px; cursor: pointer; }
      #train .d-route .next:hover { border-color: #b98cff; }
      #train .d-route .next small { color: #8a857c; font-size: 12px; margin-left: 6px; }
      #train .d-route .ask { font-size: 20px; line-height: 1.35; margin-bottom: 4px; }
      #train .d-route .ask b { color: #d9ceff; }
      #train .d-route .answers { grid-template-columns: repeat(2, 1fr); }
      #train .d-route .answers button { font-size: 17px; min-height: 60px; padding: 6px 8px; justify-content: flex-start; }
      #train .d-route .answers .e { font-size: 28px; font-style: normal; line-height: 1; margin-right: 8px; vertical-align: -4px; }
      @media (max-height: 520px) {
        #train .d-route .map { width: 236px; height: 236px; }
        #train .d-route .side { min-height: 200px; gap: 4px; }
        #train .d-route .lead { font-size: 16px; }
        #train .d-route .place { font-size: 18px; }
        #train .d-route .em { font-size: 52px; min-height: 56px; }
        #train .d-route .word { font-size: 26px; }
        #train .d-route .ka { font-size: 14px; }
        #train .d-route .next { padding: 7px 22px; }
        #train .d-route .ask { font-size: 17px; }
        #train .d-route .answers button { min-height: 52px; font-size: 16px; }
        #train .d-route .answers .e { font-size: 24px; } }`);
    ctx.stage.classList.add('d-route');
    const lv = ctx.level, L = ctx.game.level || {};
    const n = Math.round(3 + (lv - 1) * 5 / 9);   // (3 stops at level 1, 8 at 10)
    const show = 3200 - (lv - 1) * 1200 / 9, limit = 11000 - (lv - 1) * 400;
    const words = await ctx.words();
    if (ctx.aborted) return null;
    // the things: nouns with a picture, easy words at the easy levels, no two pictures alike
    const band = lv <= 2 ? 1 : lv <= 4 ? 2 : lv <= 6 ? 3 : lv <= 8 ? 4 : 6;
    const items = [];
    for (const q of shuffle(words.filter((x) => x.p === 'n' && x.e && x.b <= band))) {
      if (items.length < n && !items.some((it) => it.e === q.e || it.w === q.w)) items.push(q);
    }
    const all = places(L), gate = (L.gates || [])[0] || { x: 140, y: -80 };
    const stops = walk(spread(all, Math.min(n, items.length, all.length)), gate);
    const k = stops.length;

    const walkEl = ctx.el('div', 'walk');
    const mark = drawMap(el('div', 'mapbox', walkEl), L, stops);
    const side = el('div', 'side', walkEl);
    // (a pause that Space, Enter, a tap on Next or the test hook ends early)
    const wait = (ms, btn = null) => new Promise((resolve) => {
      let over = false;
      const go = () => { if (over) return; over = true; ctx.key(null); ctx.expect(null); resolve(); };
      ctx.sleep(ms).then(go);
      if (btn) btn.onclick = go;
      ctx.key((code) => { if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter' || code === 'ArrowRight') { go(); return true; } return false; });
      ctx.expect(() => go());
    });
    const next = () => { const b = el('button', 'next', side, `Next${ctx.touch ? '' : ' <small>Space</small>'}`); b.type = 'button'; return b; };

    // the walk, a thing at each stop
    side.innerHTML = `<div class="lead">${k} stops round Green Diamond.<br>Remember what's at each.</div>`;
    await wait(1800, next());
    for (let i = 0; i < k; i++) {
      if (ctx.aborted) return null;
      const it = items[i];
      mark(i);
      side.innerHTML = `<div class="t-hint">Stop ${i + 1} of ${k}</div><div class="place">${esc(stops[i].name)}</div>`
        + `<div class="em">${it.e}</div><div class="word">${esc(it.w)}</div><div class="ka">${esc(it.ka)}</div>`;
      ctx.say(it.w);
      ctx.clock(show / 1000);
      await wait(show, next());
    }
    if (ctx.aborted) return null;
    mark(-1);
    side.innerHTML = '<div class="lead">Now: what was where?</div>';
    ctx.expect(null);
    await ctx.sleep(1100);

    // what was at a stop or two, any of them (the right thing, or three others from this walk)
    const asked = shuffle([...Array(k).keys()]).slice(0, Math.min(ctx.items, k)).sort((a, b) => a - b);
    let right = 0;
    for (const i of asked) {
      if (ctx.aborted) break;
      mark(i);
      side.innerHTML = `<div class="t-hint">Stop ${i + 1} of ${k}</div><div class="ask">What was at <b>${esc(stops[i].name)}</b>?</div>`;
      const opts = shuffle([i, ...shuffle(Array.from({ length: k }, (_, j) => j).filter((j) => j !== i)).slice(0, 3)]);
      ctx.clock(limit / 1000);
      const r = await ctx.choose(opts.map((j) => `<i class="e">${items[j].e}</i>${esc(items[j].w)}`), { right: opts.indexOf(i), cols: 2, limit, hold: 450, parent: side });
      if (ctx.aborted) return null;
      if (r.ok) right++;
      mark(i, r.ok ? 'ok' : 'no');
      ctx.flash(r.ok);
      await ctx.sleep(r.ok ? 200 : 900);
    }
    return { score: asked.length ? right / asked.length : 0, right, total: asked.length };
  },
};
