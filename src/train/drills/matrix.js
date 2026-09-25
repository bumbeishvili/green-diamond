// Matrix reasoning (like Raven's): a 3 x 3 grid of pictures that follow rules along each row, the
// last one missing; pick the one that fits. Each picture is shapes with a kind, a number, a fill
// and a size, and each of those either stays the same everywhere, is the same along a row, goes up
// (or down) a step along it, or has all three of its values once in every row. Harder levels: more
// of them changing at once, and more answers to choose from, all a near miss.

import { pick, shuffle, style } from '../util.js';

const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'hexagon'];
const N = { shape: 5, count: 3, fill: 3, size: 3 };
let uid = 0;

// one picture as SVG markup (a 100 x 100 box)
function cellSvg(c) {
  const id = `mx${uid++}`;
  const n = c.count + 1, base = n === 1 ? 30 : n === 2 ? 20 : 17, r = base * [0.55, 0.78, 1][c.size];
  const spots = n === 1 ? [[50, 50]] : n === 2 ? [[28, 50], [72, 50]] : [[50, 28], [28, 68], [72, 68]];
  const fill = c.fill === 0 ? 'none' : c.fill === 1 ? `url(#${id})` : '#eae6ff';
  const shape = SHAPES[c.shape];
  const one = ([x, y]) => {
    const a = `fill="${fill}" stroke="#eae6ff" stroke-width="3" stroke-linejoin="round"`;
    if (shape === 'circle') return `<circle cx="${x}" cy="${y}" r="${r}" ${a}/>`;
    if (shape === 'square') return `<rect x="${x - r * 0.86}" y="${y - r * 0.86}" width="${r * 1.72}" height="${r * 1.72}" ${a}/>`;
    const pts = (k, rot) => Array.from({ length: k }, (_, i) => { const t = rot + (i / k) * Math.PI * 2; return `${(x + Math.cos(t) * r).toFixed(1)},${(y + Math.sin(t) * r).toFixed(1)}`; }).join(' ');
    if (shape === 'triangle') return `<polygon points="${pts(3, -Math.PI / 2)}" ${a}/>`;
    if (shape === 'diamond') return `<polygon points="${pts(4, -Math.PI / 2)}" ${a}/>`;
    return `<polygon points="${pts(6, 0)}" ${a}/>`;
  };
  return `<svg viewBox="0 0 100 100" class="mx"><defs><pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
    + `<rect width="3" height="7" fill="#eae6ff"/></pattern></defs>${spots.map(one).join('')}</svg>`;
}

// a matrix whose rules change `k` of the four things; returns {grid, answer, options}
function make(k, nOpts) {
  const attrs = shuffle(Object.keys(N));
  const changing = attrs.slice(0, k), fixed = attrs.slice(k);
  const rule = {};
  for (const a of changing) rule[a] = pick(a === 'shape' ? ['row', 'dist'] : ['row', 'prog', 'prog', 'dist']);
  const vals = {};
  for (const a of Object.keys(N)) vals[a] = shuffle(Array.from({ length: N[a] }, (_, i) => i)).slice(0, 3);
  const down = Math.random() < 0.35;
  const latin = shuffle([[0, 1, 2], [1, 2, 0], [2, 0, 1]]);
  const grid = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const cell = {};
    for (const a of fixed) cell[a] = vals[a][0];
    for (const a of changing) {
      const how = rule[a];
      cell[a] = how === 'row' ? vals[a][r] : how === 'prog' ? (down ? 2 - c : c) : vals[a][latin[r][c]];
    }
    grid.push(cell);
  }
  const answer = grid[8];
  // near misses: the answer with one thing changed (the changing ones first), then two
  const key = (c) => `${c.shape}${c.count}${c.fill}${c.size}`;
  const seen = new Set([key(answer)]), opts = [answer];
  const tweak = (c, a) => { const d = { ...c }; let v; do { v = Math.floor(Math.random() * N[a]); } while (v === c[a]); d[a] = v; return d; };
  for (let t = 0; t < 200 && opts.length < nOpts; t++) {
    const pool = t < 60 ? changing : Object.keys(N);
    let d = tweak(answer, pick(pool));
    if (t > 120) d = tweak(d, pick(Object.keys(N)));
    // (the other cells of the grid make tempting wrong answers too)
    if (t % 7 === 3) d = { ...grid[pick([5, 7, 4, 2, 6])] };
    if (!seen.has(key(d))) { seen.add(key(d)); opts.push(d); }
  }
  shuffle(opts);
  return { grid, answer: opts.indexOf(answer), options: opts };
}

export default {
  how: 'Each row of pictures follows a rule: the shapes, how many, how they\'re filled, how big. Pick the picture that fits the <b>empty square</b>.',

  async run(ctx) {
    style('matrix', `
      #train .d-matrix .board { display: grid; grid-template-columns: repeat(3, 84px); gap: 5px; background: #2c3036; padding: 5px; border-radius: 8px; }
      #train .d-matrix .board > div { width: 84px; height: 84px; background: #16191e; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
      #train .d-matrix .board .q { color: #b98cff; font: 800 40px var(--body); }
      #train .d-matrix svg.mx { width: 100%; height: 100%; display: block; }
      #train .d-matrix .answers button { padding: 4px; min-height: 0; }
      #train .d-matrix .answers button span { width: 72px; height: 72px; display: block; }
      #train .d-matrix .answers button { position: relative; }
      #train .d-matrix .answers button b { position: absolute; left: 6px; top: 4px; }
      @media (max-height: 520px) { #train .d-matrix .board { grid-template-columns: repeat(3, 58px); } #train .d-matrix .board > div { width: 58px; height: 58px; }
        #train .d-matrix .answers button span { width: 54px; height: 54px; } }`);
    ctx.stage.classList.add('d-matrix');
    const lv = ctx.level;
    const k = lv <= 2 ? 1 : lv <= 5 ? 2 : lv <= 7 ? 3 : 4;
    const nOpts = lv <= 3 ? 4 : 6;
    const each = lv <= 3 ? 30 : lv <= 7 ? 40 : 45;
    const n = ctx.items;
    let right = 0;
    for (let q = 0; q < n && !ctx.aborted; q++) {
      const m = make(k, nOpts);
      ctx.stage.innerHTML = '';
      ctx.el('div', 't-score', null, `${q + 1} / ${n}`);
      const board = ctx.el('div', 'board');
      m.grid.forEach((c, i) => { board.appendChild(document.createElement('div')).innerHTML = i === 8 ? '<span class="q">?</span>' : cellSvg(c); });
      ctx.clock(each);
      const r = await ctx.choose(m.options.map(cellSvg), { right: m.answer, limit: each * 1000, hold: 900, cols: nOpts <= 4 ? 4 : 6 });
      if (r.ok) right++;
      ctx.flash(r.ok);
      if (r.ok) board.lastChild.innerHTML = cellSvg(m.options[m.answer]);
      await ctx.sleep(300);
    }
    return { score: right / n, right, total: n };
  },
};
