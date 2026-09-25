// Mini sudoku: a small grid to fill so every row, column and box has each number once. Logic: what
// can go where, by ruling out what can't. Harder levels: fewer numbers given, then (from level 5)
// the 6 x 6 grid, and a little less time.

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

// the end of a round shown a moment: Space or Enter (or the test hook) goes on at once
function hold(ctx, ms) {
  return new Promise((resolve) => {
    let gone = false;
    const go = () => { if (!gone) { gone = true; ctx.key(null); ctx.expect(null); resolve(); } };
    ctx.key((code) => { if (!/^(Space|Enter|NumpadEnter)$/.test(code)) return false; go(); return true; });
    ctx.expect(go);
    ctx.sleep(ms).then(go);
  });
}

export default {
  how: 'Fill the grid so every row, column and <b>box</b> has each number once. Pick a square, then its number.',

  async run(ctx) {
    style('sudoku', `
      #train .d-sudoku .t-row { gap: 26px; }
      #train .d-sudoku .board { --cs: 64px; display: grid; gap: 3px; padding: 3px; background: #5d626c; border-radius: 6px; user-select: none; -webkit-user-select: none; }
      #train .d-sudoku .board.n6 { --cs: 50px; }
      #train .d-sudoku .box { display: grid; gap: 1px; background: #353a44; }
      #train .d-sudoku .sq { width: var(--cs); height: var(--cs); display: flex; align-items: center; justify-content: center; background: #16191e; color: #b98cff;
        font: 700 calc(var(--cs) * .56) var(--body); cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      #train .d-sudoku .sq.giv { color: #fff; font-weight: 800; }
      #train .d-sudoku .sq.hl { background: #211d30; }
      #train .d-sudoku .sq.sel { background: #342a5c; box-shadow: inset 0 0 0 2px #b98cff; }
      #train .d-sudoku .sq.no { color: #ff5a4a; }
      #train .d-sudoku .sq.no:not(.sel) { background: #2e1a1d; }
      #train .d-sudoku .sq.miss { color: #6d6962; }
      #train .d-sudoku .board.won .sq:not(.giv) { color: #7fe07f; }
      #train .d-sudoku .pad { display: grid; grid-template-columns: repeat(var(--pc), 64px); gap: 8px; }
      #train .d-sudoku .pad button { height: 58px; border-radius: 8px; background: #1b1f25; border: 1px solid #333840; color: var(--ink); font: 700 26px var(--body); cursor: pointer;
        -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      #train .d-sudoku .pad button:hover { border-color: #b98cff; }
      #train .d-sudoku .pad button:active { background: #2a2340; }
      #train .d-sudoku .pad .er { grid-column: 1 / -1; font-size: 16px; font-weight: 600; color: var(--muted); }
      @media (max-height: 520px) {
        #train .d-sudoku .t-row { gap: 20px; }
        #train .d-sudoku .board { --cs: 48px; } #train .d-sudoku .board.n6 { --cs: 34px; }
        #train .d-sudoku .pad { grid-template-columns: repeat(var(--pc), 56px); gap: 6px; } #train .d-sudoku .pad button { height: 46px; font-size: 22px; } }`);
    ctx.stage.classList.add('d-sudoku');
    const lv = ctx.level, big = lv >= 5;
    const S = big ? shape(6, 2, 3) : shape(4, 2, 2), n = S.n;
    const { sol, g } = make(S, GIVEN[lv - 1], lv <= 7);
    const given = g.map((v) => v > 0), cur = [...g];
    const empties = given.filter((x) => !x).length;
    const secs = big ? 150 - (lv - 5) * 4 : 75 - (lv - 1) * 3;
    const boxOf = (i) => Math.floor(Math.floor(i / n) / S.bh) * (n / S.bw) + Math.floor((i % n) / S.bw);

    // the grid, drawn a box at a time (the thick lines between boxes, the thin ones inside)
    const count = ctx.el('div', 't-score');
    const row = ctx.el('div', 't-row');
    const board = ctx.el('div', `board n${n}`, row);
    board.style.gridTemplateColumns = `repeat(${n / S.bw}, auto)`;
    const sq = [];
    for (let b = 0; b < n; b++) {
      const box = ctx.el('div', 'box', board);
      box.style.gridTemplateColumns = `repeat(${S.bw}, var(--cs))`;
      for (let k = 0; k < n; k++) {
        const r = Math.floor(b / (n / S.bw)) * S.bh + Math.floor(k / S.bw), c = (b % (n / S.bw)) * S.bw + (k % S.bw), i = r * n + c;
        const e = sq[i] = ctx.el('div', given[i] ? 'sq giv' : 'sq', box);
        e.onclick = () => { if (!over) { sel = i; draw(); } };
      }
    }
    // the numbers to put in, and erase
    const pad = ctx.el('div', 'pad', row);
    pad.style.setProperty('--pc', big ? 3 : 2);
    for (let d = 1; d <= n; d++) { const b = ctx.el('button', '', pad, d); b.type = 'button'; b.onclick = () => put(d); }
    const er = ctx.el('button', 'er', pad, 'Erase');
    er.type = 'button'; er.onclick = () => put(0);

    let sel = cur.indexOf(0), mistakes = 0, over = false, won;
    const solved = new Promise((r) => { won = r; });
    const draw = () => {
      const r0 = Math.floor(sel / n), c0 = sel % n, b0 = boxOf(sel);
      sq.forEach((e, i) => {
        e.textContent = cur[i] || '';
        e.classList.toggle('sel', i === sel);
        e.classList.toggle('hl', i !== sel && (Math.floor(i / n) === r0 || i % n === c0 || boxOf(i) === b0));
        e.classList.toggle('no', !!cur[i] && cur[i] !== sol[i]);
      });
      count.textContent = mistakes ? `${mistakes} mistake${mistakes === 1 ? '' : 's'}` : '';
    };
    // a number in the square picked (0 clears it); one that doesn't belong there is a mistake
    const put = (d) => {
      if (over || given[sel] || cur[sel] === d) return;
      cur[sel] = d;
      if (d && d !== sol[sel]) mistakes++;
      draw();
      if (cur.every((v, i) => v === sol[i])) won();
    };
    const move = (dr, dc) => {
      const r = Math.max(0, Math.min(n - 1, Math.floor(sel / n) + dr)), c = Math.max(0, Math.min(n - 1, sel % n + dc));
      sel = r * n + c;
      draw();
    };
    draw();
    ctx.key((code) => {
      const m = /^(?:Digit|Numpad)(\d)$/.exec(code);
      if (m) { if (+m[1] <= n) put(+m[1]); return true; }
      if (code === 'Backspace' || code === 'Delete') { put(0); return true; }
      const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[code];
      if (mv) { move(...mv); return true; }
      return code === 'Enter' || code === 'NumpadEnter' || code === 'Space';   // (not a second press of the button last clicked)
    });
    // (tests: a square still to do, its number, or a wrong one, the way a player would)
    ctx.expect((ok) => {
      const todo = cur.map((_, i) => i).filter((i) => !given[i] && cur[i] !== sol[i]);
      if (!todo.length) return;
      sel = ok ? todo[0] : todo.find((i) => !cur[i]) ?? todo[0];
      draw();
      const d = sol[sel] % n + 1;   // (a wrong one: the next number round, or the one after if that's there already)
      put(ok ? sol[sel] : d === cur[sel] ? d % n + 1 : d);
    });

    const clock = ctx.clock(secs);
    await Promise.race([clock.done, solved]);
    over = true;
    ctx.key(null); ctx.expect(null);
    if (ctx.aborted) return null;
    const done = cur.every((v, i) => v === sol[i]);
    const right = cur.filter((v, i) => !given[i] && v === sol[i]).length;
    if (done) board.classList.add('won');
    else sq.forEach((e, i) => { if (cur[i] !== sol[i]) { e.textContent = sol[i]; e.classList.remove('no'); e.classList.add('miss'); } });   // (what it should have been)
    sq.forEach((e) => e.classList.remove('sel', 'hl'));
    ctx.flash(done);
    await hold(ctx, done ? 1300 : 1800);
    // (a wrong number shows red at once, so guessing till it sticks has to cost: each one, a good bit)
    return { score: done ? Math.max(0.25, 1 - 0.15 * mistakes) : 0.6 * right / empties, right, total: empties };
  },
};
