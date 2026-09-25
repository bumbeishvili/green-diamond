// Stroop: a colour's name printed in a colour; pick the colour of the ink, not the word. Reading
// comes by itself, and holding it back is the exercise (inhibition). Harder levels: more of the
// words mismatched, less time for each, and a fifth colour.

import { rand, speedScore, style } from '../util.js';

const COLS = [['RED', '#ff5048'], ['BLUE', '#4aa3ff'], ['GREEN', '#3fd07a'], ['YELLOW', '#ffd23f'], ['PURPLE', '#c08cff']];

export default {
  how: 'A colour\'s name, printed in a colour. Pick the colour of the <b>ink</b>, not the word. Quick, but right.',

  async run(ctx) {
    style('stroop', `
      #train .d-stroop .t-big { font-size: 72px; min-height: 90px; font-family: var(--body); }
      #train .d-stroop .answers button { min-height: 64px; }
      #train .d-stroop .sw { display: block; width: 38px; height: 38px; border-radius: 50%; border: 2px solid rgba(255,255,255,.25); }
      @media (max-height: 520px) { #train .d-stroop .t-big { font-size: 54px; min-height: 66px; } }`);
    const lv = ctx.level, cols = COLS.slice(0, lv >= 7 ? 5 : 4);
    const n = lv <= 3 ? 16 : 20, mismatch = Math.min(0.85, 0.5 + lv * 0.04), limit = Math.round(3000 - (lv - 1) * 200);
    ctx.stage.classList.add('d-stroop');
    const count = ctx.el('div', 't-score');
    const word = ctx.el('div', 't-big');
    const slot = ctx.el('div', 't-row');
    slot.style.width = '100%';
    let right = 0;
    const secs = [];
    for (let k = 0; k < n && !ctx.aborted; k++) {
      count.textContent = `${k + 1} / ${n}`;
      const ink = rand(0, cols.length - 1);
      let w = ink;
      if (Math.random() < mismatch) do { w = rand(0, cols.length - 1); } while (w === ink);
      word.textContent = cols[w][0];
      word.style.color = cols[ink][1];
      const r = await ctx.choose(cols.map(([name, hex]) => `<i class="sw" style="background:${hex}" title="${name}"></i>`), { right: ink, limit, hold: 140, parent: slot, cols: cols.length });
      if (r.ok) { right++; secs.push(r.ms / 1000); } else ctx.flash(false);
      word.textContent = '';
      await ctx.sleep(120);
    }
    return { score: speedScore(right, n, secs, 0.75, 1.8), right, total: n };
  },
};
