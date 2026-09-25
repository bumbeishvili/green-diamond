// Mini crossword: an English word to fill in from its Georgian clue (and a sentence it fits, with the
// word left out); from a puzzle crate, two that cross. Vocabulary: the English for a Georgian word,
// spelt right. Harder levels: rarer words.

import { rand, shuffle, style, esc } from '../util.js';

const POS = new Set(['n', 'v', 'adj', 'adv', 'num']);   // (words that mean something alone: not "the", "of")
const BANDS = [[1, 2], [1, 2], [2, 3], [2, 3], [3, 4], [3, 4], [4, 5], [4, 5], [5, 6], [5, 6]];   // by level
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const key = (x, y) => `${x},${y}`;

// can `w` go at x, y (dir 0 across, 1 down)? How many words it crosses there, or -1: a clash, or a
// letter next to one already there (in a crossword letters only touch where words cross)
function fit(cells, w, x, y, dir) {
  const dx = 1 - dir, dy = dir;
  if (cells.has(key(x - dx, y - dy)) || cells.has(key(x + dx * w.length, y + dy * w.length))) return -1;
  let cross = 0;
  for (let k = 0; k < w.length; k++) {
    const cx = x + dx * k, cy = y + dy * k, c = cells.get(key(cx, cy));
    if (c) {
      if (c.ch !== w[k] || c.w[dir]) return -1;
      cross++;
    } else if (cells.has(key(cx + dy, cy + dx)) || cells.has(key(cx - dy, cy - dx))) return -1;
  }
  return cross;
}

// one go at a crossword of n words: the first across, then each one crossing what's there at a
// letter they share, the way that crosses most and keeps it within cap x cap (longer words a little
// preferred, one of three letters at most); null if it gets stuck
function build(pool, n, cap) {
  const cells = new Map(), words = [];
  const add = (q, x, y, dir) => {
    const d = { q, w: q.w, x, y, dir, cells: [] };
    words.push(d);
    for (let k = 0; k < q.w.length; k++) {
      const cx = x + (1 - dir) * k, cy = y + dir * k, K = key(cx, cy);
      if (!cells.has(K)) cells.set(K, { x: cx, y: cy, ch: q.w[k], w: [null, null], v: '', lock: false });
      cells.get(K).w[dir] = d;
      d.cells.push(cells.get(K));
    }
  };
  const box = () => {
    const xs = [...cells.values()].map((c) => c.x), ys = [...cells.values()].map((c) => c.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const order = shuffle([...pool]);
  add(order.find((q) => q.w.length >= 5), 0, 0, 0);
  while (words.length < n) {
    const [x0, y0, x1, y1] = box(), short = words.some((d) => d.w.length === 3);
    let best = null, seen = 0;
    for (const q of shuffle(order)) {
      if ((short && q.w.length === 3) || words.some((d) => d.q.ka === q.ka || d.w.includes(q.w) || q.w.includes(d.w))) continue;
      let mine = null;
      for (const d of words) for (let i = 0; i < d.w.length; i++) for (let j = 0; j < q.w.length; j++) {
        if (d.w[i] !== q.w[j]) continue;
        const dir = 1 - d.dir, x = d.x + (1 - d.dir) * i - (1 - dir) * j, y = d.y + d.dir * i - dir * j;   // (crossing d's i-th letter)
        const cross = fit(cells, q.w, x, y, dir);
        if (cross < 1) continue;
        const W = Math.max(x1, x + (1 - dir) * (q.w.length - 1)) - Math.min(x0, x) + 1;
        const H = Math.max(y1, y + dir * (q.w.length - 1)) - Math.min(y0, y) + 1;
        if (W > 9 || H > 9) continue;
        const s = cross * 8 - Math.max(0, W - cap, H - cap) * 6 - W * H * 0.1 + q.w.length * 0.5 + Math.random() * 3;
        if (!mine || s > mine.s) mine = { q, x, y, dir, s };
      }
      if (mine && (!best || mine.s > best.s)) best = mine;
      if (mine && ++seen >= 40) break;
    }
    if (!best) return null;
    add(best.q, best.x, best.y, best.dir);
  }
  const [x0, y0, x1, y1] = box(), W = x1 - x0 + 1, H = y1 - y0 + 1;
  const crossings = [...cells.values()].filter((c) => c.w[0] && c.w[1]).length, letters = words.reduce((a, d) => a + d.w.length, 0);
  return { cells, words, x0, y0, W, H, rank: Math.max(0, W - cap, H - cap) * 10 + W * H * 0.05 - crossings * 2 - letters * 0.3 };
}

// the example sentence with the word left out ('' if it isn't there as it is)
function blank(q) {
  const s = (q.ex || '').replace(new RegExp(`\\b${q.w}\\b`, 'gi'), '_'.repeat(q.w.length));
  return s !== q.ex ? s : '';
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
  how: 'Fill in the <b>English</b> words: each clue is the word in Georgian, and a sentence it fits. Pick a clue or a square and type.',

  async run(ctx) {
    style('cross', `
      #train .d-cross .xw { display: grid; grid-template-columns: auto auto; grid-template-areas: "grid clues"; gap: 14px 26px; align-items: center; justify-content: center; width: 100%; }
      #train.touch .d-cross .xw { grid-template-areas: "grid clues" "kb kb"; }
      #train .d-cross .grid { grid-area: grid; --cs: min(40px, calc(330px / var(--n))); display: grid; grid-template-columns: repeat(var(--w), var(--cs)); grid-auto-rows: var(--cs);
        gap: 1px; padding: 2px; user-select: none; -webkit-user-select: none; justify-self: center; }
      #train .d-cross .c { position: relative; display: flex; align-items: center; justify-content: center; background: #e9e7ef; box-shadow: 0 0 0 1px #07080a;
        cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      #train .d-cross .c b { font: 800 calc(var(--cs) * .55) var(--body); text-transform: uppercase; color: #15171b; line-height: 1; }
      #train .d-cross .c i { position: absolute; left: 2px; top: 1px; font: 700 max(8px, calc(var(--cs) * .26)) var(--body); font-style: normal; line-height: 1; color: #4b4e57; }
      #train .d-cross .c.ok { background: #c4ecc1; } #train .d-cross .c.ok b { color: #17621f; }
      #train .d-cross .c.no b { color: #d62a1c; }
      #train .d-cross .c.in { background: #d9ccff; }
      #train .d-cross .c.at { background: #b595ff; box-shadow: 0 0 0 2px #7b55d6; z-index: 1; }
      #train .d-cross .c.rev b { color: #9a6f00; }
      #train .d-cross .clues { grid-area: clues; width: 300px; display: flex; flex-direction: column; gap: 2px; text-align: left; }
      #train .d-cross .clues h4 { margin: 4px 0 1px 9px; font: 700 11px var(--body); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
      #train .d-cross .cl { display: grid; grid-template-columns: 18px 1fr; column-gap: 6px; padding: 4px 8px 5px 6px; border-left: 3px solid transparent; border-radius: 6px; cursor: pointer;
        -webkit-tap-highlight-color: transparent; }
      #train .d-cross .cl .nm { font: 800 13px var(--body); color: #b98cff; padding-top: 3px; }
      #train .d-cross .cl .ka { font-size: 17px; line-height: 1.3; }
      #train .d-cross .ka small { color: var(--muted); font-size: 12px; margin-left: 6px; }
      #train .d-cross .cl .ex { grid-column: 2; font-size: 12.5px; line-height: 1.35; color: var(--muted); }
      #train .d-cross .cl.on { background: #221d33; border-left-color: #b98cff; }
      #train .d-cross .cl.ok .ka { color: #7fe07f; }
      #train .d-cross .cbar { grid-area: bar; display: none; align-items: center; gap: 6px; min-height: 58px; }
      #train .d-cross .cbar button, #train .d-cross .kb button { background: #1b1f25; border: 1px solid #333840; border-radius: 7px; color: var(--ink); cursor: pointer;
        -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      #train .d-cross .cbar button { flex: none; width: 38px; height: 50px; font: 700 22px var(--body); }
      #train .d-cross .cbar .mid { flex: 1; min-width: 0; text-align: left; }
      #train .d-cross .cbar .hd { font-size: 11px; color: #b98cff; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
      #train .d-cross .cbar .ka { font-size: 17px; line-height: 1.25; }
      #train .d-cross .cbar .ex { font-size: 12px; line-height: 1.3; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #train .d-cross .kb { grid-area: kb; display: flex; flex-direction: column; gap: 5px; width: 100%; max-width: 480px; justify-self: center; }
      #train .d-cross .kb div { display: flex; gap: 4px; justify-content: center; }
      #train .d-cross .kb button { flex: 0 1 44px; min-width: 0; height: 44px; padding: 0; font: 700 18px var(--body); text-transform: uppercase; }
      #train .d-cross .kb button:active { background: #2c2446; border-color: #b98cff; }
      #train .d-cross .kb .bk { flex-basis: 66px; font-size: 20px; }
      @media (max-width: 560px) { #train .d-cross .xw, #train.touch .d-cross .xw { grid-template-columns: auto; grid-template-areas: "grid" "clues" "kb"; } }
      @media (max-height: 520px) {
        #train .d-cross .grid { --cs: min(31px, calc(218px / var(--n))); }
        #train .d-cross .clues { width: 280px; gap: 0; }
        #train .d-cross .cl { padding: 2px 6px; } #train .d-cross .cl .ka { font-size: 15px; }
        #train .d-cross .cl .ex { display: none; } #train .d-cross .cl.on .ex { display: block; }
        #train.touch .d-cross .xw { grid-template-columns: auto minmax(0, 1fr); grid-template-areas: "grid bar" "grid kb"; gap: 8px 14px; }
        #train.touch .d-cross .clues { display: none; }
        #train.touch .d-cross .cbar { display: flex; }
        #train .d-cross .kb { gap: 5px; } #train .d-cross .kb button { height: 40px; font-size: 17px; } }`);
    ctx.stage.classList.add('d-cross');
    const lv = ctx.level, [b0, b1] = BANDS[lv - 1], n = ctx.items;
    const secs = n > 1 ? 70 : 40;
    const all = await ctx.words();
    if (ctx.aborted) return null;
    const pool = all.filter((q) => /^[a-z]{3,7}$/.test(q.w) && POS.has(q.p) && !(q.t === 'grammar' && q.p === 'v') && q.b >= b0 && q.b <= b1);
    // a dozen goes, the tidiest kept
    let xw = null;
    for (let t = 0; t < 40 && !(xw && t >= 12); t++) {
      const g = build(pool, n, n === 4 ? 6 : 7);
      if (g && (!xw || g.rank < xw.rank)) xw = g;
    }
    if (!xw) return { score: 0, right: 0, total: 0 };
    const { W, H } = xw, cells = new Map();
    for (const c of xw.cells.values()) { c.x -= xw.x0; c.y -= xw.y0; cells.set(key(c.x, c.y), c); }
    for (const d of xw.words) { d.x -= xw.x0; d.y -= xw.y0; d.ex = blank(d.q); d.ok = false; }
    // numbered the usual way, along the rows; the clues across, then down
    let num = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ds = xw.words.filter((d) => d.x === x && d.y === y);
      if (ds.length) { num++; for (const d of ds) d.num = num; }
    }
    const words = [0, 1].flatMap((dir) => xw.words.filter((d) => d.dir === dir).sort((a, b) => a.num - b.num));

    const wrap = ctx.el('div', 'xw');
    const grid = ctx.el('div', 'grid', wrap);
    grid.style.setProperty('--w', W);
    grid.style.setProperty('--n', Math.max(W, H));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = cells.get(key(x, y)), e = ctx.el('div', c ? 'c' : '', grid);
      if (!c) continue;
      const d = words.find((w) => w.x === x && w.y === y);
      e.innerHTML = `${d ? `<i>${d.num}</i>` : ''}<b></b>`;
      c.el = e; c.b = e.lastChild;
      e.onclick = () => tap(c);
    }
    const list = ctx.el('div', 'clues', wrap);
    const kaHtml = (d) => `${esc(d.q.ka)}${d.q.e ? ` ${esc(d.q.e)}` : ''}<small>(${d.w.length})</small>`;
    for (const dir of [0, 1]) {
      ctx.el('h4', '', list, dir ? 'Down' : 'Across');
      for (const d of words.filter((w) => w.dir === dir)) {
        d.li = ctx.el('div', 'cl', list, `<span class="nm">${d.num}</span><span class="ka">${kaHtml(d)}</span>${d.ex ? `<span class="ex">${esc(d.ex)}</span>` : ''}`);
        d.li.onclick = () => pick(d);
      }
    }
    // (phones: the one clue, with the words before and after it a tap away)
    const bar = ctx.el('div', 'cbar', wrap);
    const prev = ctx.el('button', '', bar, '‹'), mid = ctx.el('div', 'mid', bar), next = ctx.el('button', '', bar, '›');
    prev.type = next.type = 'button';
    prev.onclick = () => step(-1);
    next.onclick = () => step(1);
    if (ctx.touch) {
      const kb = ctx.el('div', 'kb', wrap);
      ROWS.forEach((r, k) => {
        const row = ctx.el('div', '', kb);
        for (const ch of r) { const b = ctx.el('button', '', row, ch); b.type = 'button'; b.onclick = () => type(ch); }
        if (k === 2) { const b = ctx.el('button', 'bk', row, '⌫'); b.type = 'button'; b.onclick = () => back(); }
      });
    }

    let cur = words[0], pos = 0, over = false, done;
    const finished = new Promise((r) => { done = r; });
    const draw = () => {
      const at = cur.cells[pos];
      for (const c of cells.values()) {
        c.b.textContent = c.v;
        const bad = !c.lock && c.w.some((d) => d && d.cells.every((e) => e.v) && d.cells.some((e) => e.v !== e.ch));
        c.el.className = `c${c.lock ? ' ok' : ''}${bad ? ' no' : ''}${cur.cells.includes(c) ? ' in' : ''}${c === at ? ' at' : ''}`;
      }
      for (const d of words) d.li.className = `cl${d === cur ? ' on' : ''}${d.ok ? ' ok' : ''}`;
      mid.innerHTML = `<div class="hd">${cur.num} ${cur.dir ? 'down' : 'across'}</div><div class="ka">${kaHtml(cur)}</div>${cur.ex ? `<div class="ex">${esc(cur.ex)}</div>` : ''}`;
    };
    // a word picked (at square c, or its first empty one)
    const pick = (d, c = null) => {
      if (over || !d) return;
      cur = d;
      const i = c ? d.cells.indexOf(c) : d.cells.findIndex((e) => !e.lock && !e.v);
      pos = i >= 0 ? i : Math.max(0, d.cells.findIndex((e) => !e.lock));
      draw();
    };
    // the next (k = 1) or last (-1) word still to do
    const step = (k) => {
      for (let i = 1; i <= words.length; i++) {
        const d = words[(words.indexOf(cur) + k * i + words.length * i) % words.length];
        if (!d.ok || i === words.length) { pick(d); return; }
      }
    };
    // a tap on a square: its word the way you're going (the same square again: the other way)
    const tap = (c) => {
      const way = cur.cells[pos] === c ? 1 - cur.dir : cur.dir;
      pick(c.w[way] || c.w[1 - way], c);
    };
    const type = (ch) => {
      if (over) return;
      const free = cur.cells.map((c, i) => (c.lock ? -1 : i)).filter((i) => i >= 0);
      const i = free.find((k) => k >= pos) ?? free[free.length - 1];
      if (i == null) return;
      const c = cur.cells[i];
      c.v = ch;
      pos = free.find((k) => k > i) ?? i;
      // a word done right goes green (and stays); then on to the next still to do
      for (const d of c.w) {
        if (!d || d.ok || !d.cells.every((e) => e.v === e.ch)) continue;
        d.ok = true;
        for (const e of d.cells) e.lock = true;
        ctx.say(d.w);
      }
      if (words.every((d) => d.ok)) { draw(); done(); return; }
      if (cur.ok) { const k = words.indexOf(cur); pick([...words.slice(k + 1), ...words.slice(0, k)].find((d) => !d.ok)); } else draw();
    };
    const back = () => {
      if (over) return;
      const c = cur.cells[pos];
      if (c.v && !c.lock) c.v = '';
      else {
        let k = pos - 1;
        while (k >= 0 && cur.cells[k].lock) k--;
        if (k >= 0) { pos = k; cur.cells[k].v = ''; }
      }
      draw();
    };
    // arrows: to the next square that way (across the word's way, first to the word going that way)
    const arrow = (dx, dy) => {
      const c = cur.cells[pos], dir = dy ? 1 : 0;
      if (cur.dir !== dir && c.w[dir]) { pick(c.w[dir], c); return; }
      for (let x = c.x + dx, y = c.y + dy; x >= 0 && y >= 0 && x < W && y < H; x += dx, y += dy) {
        const e = cells.get(key(x, y));
        if (e) { pick(e.w[dir] || e.w[1 - dir], e); return; }
      }
    };
    pick(words[0]);
    ctx.key((code, e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      // (the letter typed; failing that, the key's place on a QWERTY keyboard, as with a Georgian layout)
      const ch = /^[a-z]$/i.test(e.key || '') ? e.key.toLowerCase() : /^Key[A-Z]$/.test(code) ? code[3].toLowerCase() : null;
      if (ch) { type(ch); return true; }
      if (code === 'Backspace') { back(); return true; }
      if (code === 'Delete') { const c = cur.cells[pos]; if (!c.lock) c.v = ''; draw(); return true; }
      const mv = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[code];
      if (mv) { arrow(...mv); return true; }
      if (code === 'Tab' || code === 'Enter' || code === 'NumpadEnter') { step(e.shiftKey ? -1 : 1); return true; }
      if (code === 'Space') { const c = cur.cells[pos]; if (c.w[1 - cur.dir]) pick(c.w[1 - cur.dir], c); return true; }
      return false;
    });
    // (tests: the next word still to do, typed in right, or wrong)
    ctx.expect((ok) => {
      const d = words.find((w) => !w.ok);
      if (!d) return;
      pick(d);
      pos = Math.max(0, d.cells.findIndex((c) => !c.lock));
      for (const c of d.cells) if (!c.lock) type(ok ? c.ch : String.fromCharCode(97 + (c.ch.charCodeAt(0) - 97 + rand(1, 25)) % 26));
    });

    const clock = ctx.clock(secs);
    await Promise.race([clock.done, finished]);
    const left = clock.left();
    over = true;
    ctx.key(null); ctx.expect(null);
    if (ctx.aborted) return null;
    const right = words.filter((d) => d.ok).length, full = right === words.length;
    // the words missed, filled in (to learn from)
    for (const c of cells.values()) { c.b.textContent = c.ch; c.el.className = `c${c.lock ? ' ok' : ' rev'}`; }
    for (const d of words) d.li.className = `cl${d.ok ? ' ok' : ''}`;
    ctx.flash(full);
    await hold(ctx, full ? 1300 : 2600);
    // all of them: 0.9, up to 1 for time to spare; otherwise the share right
    return { score: full ? 0.9 + 0.1 * Math.min(1, left / (0.4 * secs)) : right / words.length, right, total: words.length };
  },
};
