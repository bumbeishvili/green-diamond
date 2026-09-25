// Mental arithmetic: a sum to work out in your head, and four answers to pick from before the bar runs
// out. Sums and times tables first; then bigger products and division, percentages and fractions of a
// number, the order of operations and squares, percentage changes, negatives and averages
// (calculation). Harder levels: harder kinds of sum, and less time for each. A slip shows how it's done.

import { mathItem } from '../math.js';
import { rand, shuffle, speedScore, style, esc } from '../util.js';

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2))).replace('-', '−');

// a kind of our own for each of the generator's levels, mixed in with its kinds: [the sum (a ? where
// the answer goes), the answer, how it's worked out, slips people really make]
const MORE = {
  1: () => { const a = rand(13, 58), b = rand(12, 39); return [`? + ${b} = ${a + b}`, a, `${a + b} − ${b} = ${a}`, [a + 10, a - 10, a + 2 * b]]; },
  2: () => { const a = rand(3, 9), b = rand(4, 12); return [`${a} × ? = ${a * b}`, b, `${a} × ${b} = ${a * b}`, [b + 1, b - 1, b + 2]]; },
  3: () => {
    const a = rand(3, 9) * 100 + rand(0, 9), b = rand(2, 8) * 10 + rand(1, 9), up = Math.ceil(b / 10) * 10;
    return [`${a} − ${b} = ?`, a - b, `${a} − ${up} + ${up - b} = ${a - b}`, [a - b + 10, a - b - 10, a - up - (up - b)]];
  },
  4: () => { const a = rand(12, 48); return [`${a} × 25 = ?`, a * 25, `× 25 is × 100 ÷ 4: ${a * 100} ÷ 4 = ${a * 25}`, [a * 25 + 25, a * 25 - 25, a * 25 + 100]]; },
  5: () => { const a = rand(12, 98); return [`${a} × 11 = ?`, a * 11, `${a} × 10 + ${a} = ${a * 10} + ${a} = ${a * 11}`, [a * 11 + 10, a * 11 - 10, a * 11 - 100]]; },
  6: () => { const t = rand(3, 9), a = t * 10 + 5; return [`${a}² = ?`, a * a, `${t} × ${t + 1} = ${t * (t + 1)}, then 25: ${a * a}`, [t * t * 100 + 25, (t + 1) * (t + 1) * 100 + 25, a * a + 50]]; },
};

// a problem for the drill's level: the generator's level for it (from 7, now and then the one below
// as well, for variety), and now and then a kind of our own
function problem(lv) {
  let m = [1, 1, 2, 2, 3, 3, 4, 5, 5, 6][lv - 1];
  if (lv >= 7 && Math.random() < 0.3) m--;
  if (Math.random() >= 0.3) return mathItem(m);
  const [prompt, ans, explain, slips] = MORE[m]();
  const right = fmt(ans), seen = new Set([right]), wrong = [];
  for (const v of [...shuffle(slips), ans + 1, ans - 1, ans + 2, ans + 10, ans - 2]) {
    const s = fmt(v);
    if (wrong.length < 3 && v >= 0 && !seen.has(s)) { seen.add(s); wrong.push(s); }
  }
  return { prompt, options: shuffle([right, ...wrong]), answer: right, explain };
}

export default {
  how: 'Work each sum out in your head and pick the answer <b>before the bar runs out</b>. Quick, but right.',

  async run(ctx) {
    style('arith', `
      #train .d-arith .sum { height: 74px; display: flex; align-items: center; justify-content: center; font-size: 50px; letter-spacing: .02em; font-variant-numeric: tabular-nums; }
      #train .d-arith .sum.long { font-size: 34px; }
      #train .d-arith .sum em { font-style: normal; color: #b98cff; }
      #train .d-arith .sum em.ok { color: #5fd35f; }
      #train .d-arith .sum em.no { color: #ffe066; }
      #train .d-arith .why { min-height: 24px; font-size: 18px; color: #ffe066; text-align: center; }
      #train .d-arith .answers button { min-height: 64px; font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
      @media (max-height: 520px) {
        #train .d-arith .sum { height: 56px; font-size: 40px; }
        #train .d-arith .sum.long { font-size: 28px; }
        #train .d-arith .why { font-size: 16px; min-height: 21px; }
        #train .d-arith .answers button { min-height: 54px; font-size: 21px; } }`);
    ctx.stage.classList.add('d-arith');
    const lv = ctx.level, n = ctx.items, each = 14 - ((lv - 1) * 7) / 9;   // (14 s for each at level 1, 7 at 10)
    const count = ctx.el('div', 't-score');
    const sum = ctx.el('div', 't-big sum');
    const why = ctx.el('div', 'why');
    const slot = ctx.el('div', 't-row');
    slot.style.width = '100%';
    let right = 0;
    const secs = [], seen = new Set();
    for (let k = 0; k < n && !ctx.aborted; k++) {
      let it = problem(lv);
      for (let t = 0; t < 20 && seen.has(it.prompt); t++) it = problem(lv);
      seen.add(it.prompt);
      count.textContent = `${k + 1} / ${n}`;
      const put = (html) => { sum.innerHTML = `<span>${esc(it.prompt).replace('?', html)}</span>`; };
      put('<em>?</em>');
      sum.classList.toggle('long', it.prompt.length > 16);
      why.textContent = '';
      ctx.clock(each);
      const r = await ctx.choose(it.options.map(esc), { right: it.options.indexOf(it.answer), limit: each * 1000, hold: 300, cols: 4 });
      if (ctx.aborted) return null;
      put(`<em class="${r.ok ? 'ok' : 'no'}">${esc(it.answer)}</em>`);
      ctx.flash(r.ok);
      if (r.ok) { right++; secs.push(r.ms / 1000); } else why.textContent = r.i < 0 ? `Out of time. ${it.explain}` : it.explain;
      await ctx.sleep(r.ok ? 450 : 1400);
    }
    return { score: speedScore(right, n, secs, 2.5, 7), right, total: n };
  },
};
