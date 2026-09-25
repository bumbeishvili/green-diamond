// Visual search: a crowd of shapes, one of them the target; find it and tap it. Nothing makes it
// pop out, so attention has to go round them (selective attention, and how fast it moves). Levels
// 1-4: a T among Ls, all turned any way; 5-10: a bar of one colour and angle among bars that share
// one of the two with it, so neither the colour nor the angle alone gives it away. Harder levels:
// more of them, and less time for each.

import { rand, pick, shuffle, clamp, speedScore, style } from '../util.js';

const SIZES = [10, 14, 18, 24, 30, 36, 42, 48, 56, 64];
const COLS = { red: '#ff5a4a', blue: '#4aa3ff' };
const INK = '#e6e1ff';
// the shapes, in a 100 x 100 box round 0,0
const SHAPE = {
  T: '<rect x="-42" y="-42" width="84" height="24" rx="3"/><rect x="-12" y="-42" width="24" height="84" rx="3"/>',
  L: '<rect x="-42" y="-42" width="24" height="84" rx="3"/><rect x="-42" y="18" width="84" height="24" rx="3"/>',
  bar: '<rect x="-13" y="-45" width="26" height="90" rx="9"/>',
};
const draw = (it) => `<g transform="rotate(${it.rot})" fill="${it.fill}">${SHAPE[it.shape]}</g>`;

// n places on a jittered grid over w x h (less a margin), some cells left empty so it doesn't look
// like one; each {x, y} with its cell (the whole cell is what a tap hits), and the size to draw them
function layout(n, W, H, m = 6) {
  const w = W - 2 * m, h = H - 2 * m;
  let cols, rows, cw, ch;
  for (const extra of [1.3, 1.15, 1]) {
    const cells = Math.ceil(n * extra);
    cols = Math.max(2, Math.round(Math.sqrt(cells * w / h)));
    rows = Math.ceil(cells / cols);
    cw = w / cols; ch = h / rows;
    if (Math.min(cw, ch) >= 38) break;
  }
  const size = clamp(Math.min(cw, ch) * 0.72, 28, 46);
  const jx = Math.max(0, cw - size) * 0.45, jy = Math.max(0, ch - size) * 0.45;
  const all = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) all.push([c, r]);
  const at = shuffle(all).slice(0, n).map(([c, r]) => ({
    x: m + (c + 0.5) * cw + (Math.random() * 2 - 1) * jx, y: m + (r + 0.5) * ch + (Math.random() * 2 - 1) * jy, cell: [m + c * cw, m + r * ch, cw, ch],
  }));
  return { size, at };
}

export default {
  how: 'Find the one shown at the top among all the others, and <b>tap it</b> (or click it). As fast as you can.',

  async run(ctx) {
    style('search', `
      #train .d-search { gap: 10px; }
      #train .d-search .ask { display: flex; align-items: center; gap: 8px; font-size: 16px; color: var(--ink); min-height: 30px; }
      #train .d-search .ask small { color: var(--muted); font-size: 14px; }
      #train .d-search svg.cue { width: 28px; height: 28px; }
      #train .d-search .wrap { box-sizing: content-box; background: #16191e; border: 1px solid #2c3036; border-radius: 10px; touch-action: manipulation;
        user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
      #train .d-search .field { display: block; }
      #train .d-search .field [data-i] { cursor: pointer; }
      #train .d-search .field .hit { fill: transparent; }
      #train .d-search .field.show [data-i] { opacity: .28; transition: opacity .15s; }
      #train .d-search .field.show [data-i].t, #train .d-search .field.show [data-i].x { opacity: 1; }
      #train .d-search .ring { fill: none; stroke-width: 3; }
      #train .d-search .ring.ok { stroke: #5fd35f; }
      #train .d-search .ring.no { stroke: #ff5a4a; }
      @media (max-height: 520px) {
        #train .d-search { gap: 6px; }
        #train .d-search .ask { font-size: 15px; min-height: 24px; }
        #train .d-search svg.cue { width: 22px; height: 22px; } }`);
    ctx.stage.classList.add('d-search');
    const lv = ctx.level, num = SIZES[lv - 1], n = 10, limit = 8 - (lv - 1) * 4 / 9;
    // the target, and the kinds of distractor: Ls; or bars that share its colour or its angle
    const conj = lv >= 5;
    const tc = pick(['red', 'blue']), tr = pick([0, 90]);
    const other = { red: 'blue', blue: 'red' }[tc];
    const target = conj ? { shape: 'bar', fill: COLS[tc], rot: tr } : { shape: 'T', fill: INK, rot: 0 };
    const count = ctx.el('div', 't-score');
    const ask = ctx.el('div', 'ask');
    if (conj) ask.innerHTML = `Find the <svg class="cue" viewBox="-50 -50 100 100">${draw(target)}</svg><small>${tc}, ${tr ? 'lying flat' : 'standing up'}</small>`;
    else ask.innerHTML = `Find the <svg class="cue" viewBox="-50 -50 100 100">${draw(target)}</svg><small>turned any way</small>`;
    const box = ctx.el('div', 'wrap');
    // a pick: a tap or click on an item (anywhere in its cell)
    let got = null, field = null;
    const take = (i) => { const f = got; got = null; if (f) f({ i, at: performance.now() }); };
    const next = async (ms) => { const r = await Promise.race([ctx.sleep(ms).then(() => null), new Promise((res) => { got = res; })]); got = null; return r; };
    box.onpointerdown = (e) => {
      const g = e.target.closest && e.target.closest('[data-i]');
      if (!g) return;
      e.preventDefault();
      take(+g.dataset.i);
    };
    const secs = [];
    let right = 0;
    for (let k = 0; k < n; k++) {
      if (ctx.aborted) return null;
      count.textContent = `${k + 1} / ${n}`;
      // a fresh field, the target one of it (item 0) and the rest split between the two kinds
      const small = matchMedia('(max-height: 520px)').matches;
      const W = Math.round(Math.min(small ? 660 : 620, ctx.stage.clientWidth - 18)), H = small ? 196 : 262;
      box.style.width = `${W}px`; box.style.height = `${H}px`;
      const { size, at } = layout(num, W, H);
      const items = at.map((p, i) => {
        if (i === 0) return { ...target, p };
        if (!conj) return { shape: 'L', fill: INK, rot: pick([0, 90, 180, 270]), p };
        return i % 2 ? { shape: 'bar', fill: COLS[tc], rot: 90 - tr, p } : { shape: 'bar', fill: COLS[other], rot: tr, p };
      });
      if (!conj) items[0].rot = pick([0, 90, 180, 270]);
      const sc = (size / 100).toFixed(3);
      box.innerHTML = `<svg class="field" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${items.map((it, i) => `<g data-i="${i}">`
        + `<rect class="hit" x="${it.p.cell[0].toFixed(1)}" y="${it.p.cell[1].toFixed(1)}" width="${it.p.cell[2].toFixed(1)}" height="${it.p.cell[3].toFixed(1)}"/>`
        + `<g transform="translate(${it.p.x.toFixed(1)} ${it.p.y.toFixed(1)}) scale(${sc})">${draw(it)}</g></g>`).join('')}</svg>`;
      field = box.firstChild;
      await ctx.frame();
      if (ctx.aborted) return null;
      const t0 = performance.now();
      ctx.clock(limit);
      ctx.expect((ok) => take(ok ? 0 : rand(1, num - 1)));
      const r = await next(limit * 1000);
      ctx.expect(null);
      if (ctx.aborted) return null;
      // how it went: a ring round the target (green), and round a wrong pick (red), the rest dimmed
      const ring = (i, cls) => {
        const it = items[i];
        field.querySelector(`[data-i="${i}"]`).classList.add(cls === 'ok' ? 't' : 'x');
        field.insertAdjacentHTML('beforeend', `<circle class="ring ${cls}" cx="${it.p.x.toFixed(1)}" cy="${it.p.y.toFixed(1)}" r="${(size * 0.72).toFixed(1)}"/>`);
      };
      const ok = !!r && r.i === 0;
      if (ok) { right++; secs.push((r.at - t0) / 1000); } else field.classList.add('show');
      ring(0, 'ok');
      if (r && !ok) ring(r.i, 'no');
      ctx.flash(ok);
      await ctx.sleep(ok ? 450 : 900);
      if (ctx.aborted) return null;
      box.innerHTML = '';
      await ctx.sleep(250);
    }
    return { score: speedScore(right, n, secs, 1.0, 3.5), right, total: n };
  },
};
