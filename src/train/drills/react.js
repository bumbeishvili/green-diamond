// Reaction time: wait for the signal, then answer it as fast as you can. Plain speed first, then a
// choice to make as well, and at the top a signal to let go by (holding back is inhibition). Levels
// 1-3: the panel turns green; 4-6: an arrow, its key or its side; 7-10: green arrows to answer and
// red ones to leave alone. Less time to answer as the levels go up.

import { rand, shuffle, speedScore, style } from '../util.js';

const ARROW = '<svg class="arr" viewBox="0 0 120 80"><path d="M6 29H62V8L114 40L62 72V51H6Z"/></svg>';

export default {
  how: 'Wait for the signal, then react as <b>fast</b> as you can. Too soon counts as a miss.',

  async run(ctx) {
    style('react', `
      #train .d-react { gap: 10px; }
      #train .d-react .panel { position: relative; width: 100%; height: 250px; margin-top: 12px; border-radius: 12px; background: #16191e; border: 2px solid #2c3036; cursor: pointer;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
        user-select: none; -webkit-user-select: none; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
      #train .d-react .msg { font-size: 26px; font-weight: 600; color: var(--muted); line-height: 1.1; text-align: center; }
      #train .d-react .sub { font-size: 14px; color: #8a857c; min-height: 17px; }
      #train .d-react .panel.go { background: #5fd35f; border-color: #5fd35f; }
      #train .d-react .panel.go .msg { color: #0b0c0e; font-size: 72px; font-weight: 800; }
      #train .d-react .arr { display: block; width: 190px; height: auto; overflow: visible; }
      #train .d-react .arr path { fill: currentColor; stroke: currentColor; stroke-width: 8; stroke-linejoin: round; }
      #train .d-react .sig.green .msg { color: #5fd35f; }
      #train .d-react .sig.red .msg { color: #ff5a4a; }
      #train .d-react .sig.left .arr { transform: scaleX(-1); }
      #train .d-react .two::before, #train .d-react .two::after { position: absolute; top: 50%; transform: translateY(-50%); font: 300 64px/1 var(--body); color: #33383f; }
      #train .d-react .two::before { content: '‹'; left: 22px; }
      #train .d-react .two::after { content: '›'; right: 22px; }
      #train .d-react .two.res::before, #train .d-react .two.res::after { content: none; }
      #train .d-react .res .msg { font-size: 64px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
      #train .d-react .res .msg small { font-size: .45em; font-weight: 600; color: var(--muted); }
      #train .d-react .res.ok { border-color: #5fd35f; }
      #train .d-react .res.no { border-color: #ff5a4a; }
      #train .d-react .res.no .msg { color: #ff9a8a; font-size: 46px; }
      #train .d-react .avg { min-height: 18px; font-variant-numeric: tabular-nums; }
      @media (max-height: 520px) {
        #train .d-react { gap: 6px; }
        #train .d-react .panel { height: 200px; }
        #train .d-react .panel.go .msg { font-size: 60px; }
        #train .d-react .arr { width: 150px; }
        #train .d-react .res .msg { font-size: 52px; }
        #train .d-react .res.no .msg { font-size: 40px; } }`);
    ctx.stage.classList.add('d-react');
    const lv = ctx.level, mode = lv <= 3 ? 'plain' : lv <= 6 ? 'choice' : 'nogo';
    const n = ctx.items, limit = Math.round(1500 - (lv - 1) * 800 / 9), hold = 900;
    const dirs = shuffle([...'LLLLLRRRRR']);
    const reds = new Set(mode === 'nogo' ? [...Array(n).keys()].filter(() => Math.random() < 0.3) : []);   // (a red one, now and then)
    const count = ctx.el('div', 't-score');
    const panel = ctx.el('div', 'panel');
    const msg = ctx.el('div', 'msg', panel), sub = ctx.el('div', 'sub', panel);
    const avg = ctx.el('div', 'avg t-hint', null, '&nbsp;');
    const wait = mode === 'plain' ? 'Wait for green…' : 'Wait for the arrow…';
    const hint = mode === 'plain' ? (ctx.touch ? 'then tap' : 'then Space, or a click')
      : mode === 'choice' ? (ctx.touch ? 'then tap the side it points to' : 'then its arrow key, ← or →')
        : ctx.touch ? 'green: tap its side · red: hold still' : 'green: its arrow key · red: hold still';
    const base = `panel ${mode === 'plain' ? '' : 'two'}`;
    // a press: a tap or click (which half, when it's arrows), or a key
    let got = null;
    const input = (what) => { const f = got; got = null; if (f) f({ what, at: performance.now() }); };
    const next = async (ms) => { const r = await Promise.race([ctx.sleep(ms).then(() => null), new Promise((res) => { got = res; })]); got = null; return r; };
    panel.onpointerdown = (e) => {
      e.preventDefault();
      const b = panel.getBoundingClientRect();
      input(mode === 'plain' ? 'go' : e.clientX < b.left + b.width / 2 ? 'L' : 'R');
    };
    ctx.key((code) => {
      const what = mode === 'plain' ? (code === 'Space' ? 'go' : null) : code === 'ArrowLeft' ? 'L' : code === 'ArrowRight' ? 'R' : null;
      if (what) input(what);
      return !!what;
    });
    const rts = [];
    let right = 0, rash = 0;   // (rash: the wrong arrow, or any on red)
    for (let k = 0; k < n; k++) {
      if (ctx.aborted) return null;
      const dir = dirs[k], red = reds.has(k);
      count.textContent = `${k + 1} / ${n}`;
      panel.className = base;
      msg.textContent = wait;
      sub.textContent = hint;
      // the wait: a press now is a false start (the test hook's wrong answer, when it's plain green)
      ctx.expect(mode === 'plain' ? (ok) => { if (!ok) input('go'); } : null);
      let r = await next(rand(1200, 3500));
      if (ctx.aborted) return null;
      let ok = false, say = 'Too soon!';
      if (!r) {
        await ctx.frame();   // (the signal goes up with a frame, and the time runs from then)
        if (ctx.aborted) return null;
        if (mode === 'plain') { panel.classList.add('go'); msg.textContent = 'Now!'; }
        else { panel.classList.add('sig', red ? 'red' : 'green', dir === 'L' ? 'left' : 'right'); msg.innerHTML = ARROW; }
        sub.textContent = '';
        const t0 = performance.now();
        ctx.expect((good) => {
          if (mode === 'plain') { if (good) input('go'); }
          else if (red) { if (!good) input(dir); }   // (holding still is the right answer)
          else input(good ? dir : dir === 'L' ? 'R' : 'L');
        });
        r = await next(red ? hold : limit);
        ctx.expect(null);
        if (ctx.aborted) return null;
        if (red) { ok = !r; say = ok ? 'Well held' : 'Not on red!'; }
        else if (!r) say = 'Too slow';
        else if (mode !== 'plain' && r.what !== dir) say = 'Wrong way';
        else { ok = true; rts.push(Math.round(r.at - t0)); }
        if (r && !ok) rash++;
      }
      if (ok) right++; else ctx.flash(false);
      panel.className = `${base} res ${ok ? 'ok' : 'no'}`;
      if (ok && !red) msg.innerHTML = `${rts[rts.length - 1]}<small> ms</small>`;
      else msg.textContent = say;
      sub.textContent = '';
      if (rts.length) avg.textContent = `Average ${Math.round(rts.reduce((a, b) => a + b, 0) / rts.length)} ms`;
      await ctx.sleep(ok ? 800 : 1200);
    }
    ctx.key(null);
    // right answers less rash ones (or guessing an arrow would get half), and how fast: the middle one
    // of the times (full marks by 280 ms, half by 650)
    const s = rts.sort((a, b) => a - b), m = s.length >> 1;
    const mid = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    return { score: speedScore(Math.max(0, right - rash), n, s.length ? [mid / 1000] : [], 0.28, 0.65), right, total: n };
  },
};
