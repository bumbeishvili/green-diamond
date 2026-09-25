// Mini sudoku: a small grid where every row, column and box has each number once, some of it filled
// in; which number goes in the square with the question mark (two squares, from a puzzle crate)?
// Logic: what can go where, by ruling out what can't. Harder levels: fewer numbers given, then (from
// level 5) the 6 x 6 grid, and squares that take more working out: at the easy levels one that's
// forced straight away, later one that needs others worked out first.

import { shuffle, style } from '../util.js';

const GIVEN = [11, 9, 8, 7, 24, 22, 20, 18, 16, 14];   // the numbers shown to start with, by level

// a grid n x n in boxes of bh rows by bw columns: its rows, columns and boxes ("houses"), and the
// squares that share one with each square
function shape(n, bh, bw) {
  const houses = Array.from({ length: 3 * n }, () => []);
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n), c = i % n;
    houses[r].push(i); houses[n + c].push(i); houses[2 * n + Math.floor(r / bh) * (n / bw) + Math.floor(c / bw)].push(i);
  }
  const peers = Array.from({ length: n * n }, (_, i) => [...new Set(houses.filter((h) => h.includes(i)).flat())].filter((j) => j !== i));
  return { n, bh, bw, houses, peers };
}

const fits = (g, i, d, S) => !S.peers[i].some((j) => g[j] === d);

// backtracking: the number of solutions, up to `limit` (reaching it leaves g filled in: with the
// numbers tried in a random order, that makes a random full grid)
function solve(g, S, limit, rnd = false) {
  const i = g.indexOf(0);
  if (i < 0) return 1;
  const ds = Array.from({ length: S.n }, (_, k) => k + 1);
  if (rnd) shuffle(ds);
  let found = 0;
  for (const d of ds) {
    if (!fits(g, i, d, S)) continue;
    g[i] = d;
    found += solve(g, S, limit - found, rnd);
    if (found >= limit) return found;
    g[i] = 0;
  }
  return found;
}

// can it be done a square at a time, each one forced (the only number that fits a square, or the
// only square in a house a number fits)?
function easy(g0, S) {
  const g = [...g0];
  for (let moved = true; moved;) {
    moved = false;
    for (let i = 0; i < g.length; i++) {
      if (g[i]) continue;
      const ds = [];
      for (let d = 1; d <= S.n; d++) if (fits(g, i, d, S)) ds.push(d);
      if (!ds.length) return false;
      if (ds.length === 1) { g[i] = ds[0]; moved = true; }
    }
    for (const h of S.houses) for (let d = 1; d <= S.n; d++) {
      if (h.some((i) => g[i] === d)) continue;
      const at = h.filter((i) => !g[i] && fits(g, i, d, S));
      if (at.length === 1) { g[at[0]] = d; moved = true; }
    }
  }
  return !g.includes(0);
}

// a puzzle with `target` numbers given: a random full grid, then squares emptied in a random order
// while it keeps just the one solution (and, when `simple`, stays doable a square at a time)
function make(S, target, simple) {
  let best = null;
  for (let t = 0; t < 20 && !(best && best.left <= target); t++) {
    const sol = new Array(S.n * S.n).fill(0);
    solve(sol, S, 1, true);
    const g = [...sol];
    let left = g.length;
    for (const i of shuffle([...g.keys()])) {
      if (left <= target) break;
      const v = g[i];
      g[i] = 0;
      if (solve([...g], S, 2) === 1 && (!simple || easy(g, S))) left--; else g[i] = v;
    }
    if (!best || left < best.left) best = { sol, g, left };
  }
  return best;
}

// how deep each empty square is: the round of forced moves (the only number that fits a square, the
// only square in a house a number fits) that fills it in, 1 the first; 0 if forced moves never get there
function depths(g0, S) {
  const g = [...g0], at = new Array(g.length).fill(0);
  for (let round = 1, moved = true; moved; round++) {
    moved = false;
    const fill = [];
    for (let i = 0; i < g.length; i++) {
      if (g[i]) continue;
      const ds = [];
      for (let d = 1; d <= S.n; d++) if (fits(g, i, d, S)) ds.push(d);
      if (ds.length === 1) fill.push([i, ds[0]]);
    }
    for (const h of S.houses) for (let d = 1; d <= S.n; d++) {
      if (h.some((i) => g[i] === d)) continue;
      const at1 = h.filter((i) => !g[i] && fits(g, i, d, S));
      if (at1.length === 1) fill.push([at1[0], d]);
    }
    for (const [i, d] of fill) if (!g[i]) { g[i] = d; at[i] = round; moved = true; }
  }
  return at;
}

export default {
  how: 'Every row, column and <b>box</b> has each number once. Which number goes in the square with the <b>?</b>',

  async run(ctx) {
    style('sudoku', `
      #train .d-sudoku .board { --cs: 58px; display: grid; gap: 3px; padding: 3px; background: #5d626c; border-radius: 6px; user-select: none; -webkit-user-select: none; }
      #train .d-sudoku .board.n6 { --cs: 44px; }
      #train .d-sudoku .box { display: grid; gap: 1px; background: #353a44; }
      #train .d-sudoku .sq { width: var(--cs); height: var(--cs); display: flex; align-items: center; justify-content: center; background: #16191e; color: #fff;
        font: 800 calc(var(--cs) * .56) var(--body); }
      #train .d-sudoku .sq.ask { background: #342a5c; box-shadow: inset 0 0 0 2px #b98cff; color: #d9ceff; animation: sdAsk 1s ease-in-out infinite alternate; }
      #train .d-sudoku .sq.ok { background: #1d3a22; color: #7fe07f; animation: none; }
      #train .d-sudoku .sq.no { background: #3a1d1d; color: #ff9a8a; animation: none; }
      @keyframes sdAsk { from { box-shadow: inset 0 0 0 2px #8f6ae0; } to { box-shadow: inset 0 0 0 3px #d9ceff; } }
      #train .d-sudoku .answers { max-width: 420px; }
      @media (max-height: 520px) { #train .d-sudoku .board { --cs: 38px; } #train .d-sudoku .board.n6 { --cs: 26px; } #train .d-sudoku { gap: 8px; } }`);
    ctx.stage.classList.add('d-sudoku');
    const lv = ctx.level, big = lv >= 5;
    const S = big ? shape(6, 2, 3) : shape(4, 2, 2), n = S.n;
    const { sol, g } = make(S, GIVEN[lv - 1], lv <= 7);
    const secs = big ? 50 - (lv - 5) * 2 : 30 - (lv - 1) * 2;
    // the squares to ask about: as deep as the level wants, or the nearest to it there are
    const d = depths(g, S), want = lv <= 3 ? 1 : lv <= 6 ? 2 : 3;
    const gap = (i) => Math.abs((d[i] || 9) - want);
    const asked = shuffle(g.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0)).sort((a, b) => gap(a) - gap(b)).slice(0, ctx.items);

    // the grid, drawn a box at a time (the thick lines between boxes, the thin ones inside)
    const count = ctx.el('div', 't-score');
    const board = ctx.el('div', `board n${n}`);
    board.style.gridTemplateColumns = `repeat(${n / S.bw}, auto)`;
    const sq = [];
    for (let b = 0; b < n; b++) {
      const box = ctx.el('div', 'box', board);
      box.style.gridTemplateColumns = `repeat(${S.bw}, var(--cs))`;
      for (let k = 0; k < n; k++) {
        const r = Math.floor(b / (n / S.bw)) * S.bh + Math.floor(k / S.bw), c = (b % (n / S.bw)) * S.bw + (k % S.bw), i = r * n + c;
        sq[i] = ctx.el('div', 'sq', box, g[i] || '');
      }
    }
    let right = 0;
    for (let q = 0; q < asked.length && !ctx.aborted; q++) {
      const i = asked[q];
      if (asked.length > 1) count.textContent = `${q + 1} / ${asked.length}`;
      sq[i].classList.add('ask');
      sq[i].textContent = '?';
      ctx.clock(secs);
      const r = await ctx.choose(Array.from({ length: n }, (_, k) => String(k + 1)), { right: sol[i] - 1, limit: secs * 1000, hold: 700, cols: n });
      if (ctx.aborted) return null;
      if (r.ok) right++;
      sq[i].classList.remove('ask');
      sq[i].classList.add(r.ok ? 'ok' : 'no');
      sq[i].textContent = sol[i];   // (what it is, either way)
      ctx.flash(r.ok);
      await ctx.sleep(r.ok ? 400 : 1200);
    }
    return { score: asked.length ? right / asked.length : 0, right, total: asked.length };
  },
};
