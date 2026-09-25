// Digit span: digits shown one at a time, then typed back, in order or (from level 4, half the time)
// backwards. How many you can hold is working memory; turning them round works it harder.
// Harder levels: longer sequences, shown faster.

import { rand, shuffle, style, esc } from '../util.js';

export default {
  how: 'Digits show one at a time. Then type them back: in the same order, or <b>backwards</b> when it says so.',

  async run(ctx) {
    style('span', `
      #train .d-span .digit { font-size: 110px; font-weight: 800; min-height: 130px; line-height: 130px; color: #fff; font-variant-numeric: tabular-nums; }
      #train .d-span .ask { font-size: 18px; }
      #train .d-span .ask b { color: #ffb347; }
      #train .d-span .typed { display: flex; gap: 6px; min-height: 52px; }
      #train .d-span .typed i { width: 36px; height: 48px; border-radius: 6px; background: #1b1f25; border: 1px solid #333840; display: flex; align-items: center; justify-content: center;
        font: 800 26px var(--body); font-style: normal; }
      #train .d-span .typed i.ok { border-color: #5fd35f; background: #1d3a22; }
      #train .d-span .typed i.no { border-color: #ff5a4a; background: #3a1d1d; }
      #train .d-span .pad { display: grid; grid-template-columns: repeat(5, 58px); gap: 6px; }
      #train .d-span .pad button { height: 48px; border-radius: 8px; background: #1b1f25; border: 1px solid #333840; color: var(--ink); font: 700 20px var(--body); cursor: pointer; }
      #train .d-span .pad button:hover { border-color: #b98cff; }
      @media (max-height: 520px) { #train .d-span .digit { font-size: 80px; min-height: 96px; line-height: 96px; } #train .d-span .pad button { height: 40px; } }`);
    ctx.stage.classList.add('d-span');
    const lv = ctx.level;
    const len = Math.min(11, 3 + Math.ceil(lv * 0.8)), show = lv >= 6 ? 600 : 750;
    // (backwards? from level 4: a single one half the time, of two, one each way)
    const seqs = lv < 4 ? Array(ctx.items).fill(false) : ctx.items > 1 ? shuffle([false, true]) : [Math.random() < 0.5];
    let score = 0, right = 0;
    for (let k = 0; k < seqs.length && !ctx.aborted; k++) {
      const back = seqs[k], n = back ? len - 1 : len;
      const digits = [];
      for (let i = 0; i < n; i++) { let d; do { d = rand(0, 9); } while (d === digits[i - 1]); digits.push(d); }
      // show them
      ctx.stage.innerHTML = '';
      const ask = ctx.el('div', 'ask t-hint', null, `${k + 1} of ${seqs.length}: remember ${n} digits${back ? ', to type <b>backwards</b>' : ''}`);
      const big = ctx.el('div', 'digit');
      await ctx.sleep(900);
      for (const d of digits) {
        if (ctx.aborted) return null;
        big.textContent = d;
        await ctx.sleep(show);
        big.textContent = '';
        await ctx.sleep(220);
      }
      // type them back
      const want = back ? [...digits].reverse() : digits;
      ask.innerHTML = back ? 'Now type them <b>backwards</b>' : 'Now type them in order';
      big.remove();
      const typed = ctx.el('div', 'typed');
      const cells = want.map(() => ctx.el('i', '', typed));
      const pad = ctx.el('div', 'pad');
      const got = await new Promise((resolve) => {
        const have = [];
        const draw = () => cells.forEach((c, i) => { c.textContent = have[i] ?? ''; });
        const put = (d) => { if (have.length < want.length) { have.push(d); draw(); if (have.length === want.length) resolve(have); } };
        const del = () => { have.pop(); draw(); };
        for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) { const b = ctx.el('button', '', pad, d); b.type = 'button'; b.onclick = () => put(d); }
        const bk = ctx.el('button', '', pad, '⌫'); bk.type = 'button'; bk.onclick = del;
        ctx.key((code) => {
          const m = /^(?:Digit|Numpad)(\d)$/.exec(code);
          if (m) { put(+m[1]); return true; }
          if (code === 'Backspace') { del(); return true; }
          return false;
        });
        ctx.expect((ok) => { have.length = 0; for (const d of want) have.push(d); if (!ok) have[0] = (have[0] + 1) % 10; draw(); resolve(have); });
      });
      ctx.key(null); ctx.expect(null);
      if (!got) return null;
      let pos = 0;
      got.forEach((d, i) => { const ok = d === want[i]; if (ok) pos++; cells[i].classList.add(ok ? 'ok' : 'no'); });
      const all = pos === want.length;
      if (all) right++;
      score += all ? 1 : 0.35 * (pos / want.length);   // (a near miss is worth a little)
      ctx.flash(all);
      if (!all) ctx.el('div', 't-hint', null, `It was ${esc(want.join(' '))}`);
      await ctx.sleep(all ? 700 : 1600);
    }
    return { score: score / seqs.length, right, total: seqs.length };
  },
};
