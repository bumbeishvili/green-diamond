// Task switching: a circle or a square, orange or blue, and over it the rule for this one: go by its
// shape, or by its colour; from a puzzle crate, two in a row, the rule changed for the second. Going
// by the rule and not the habit, and changing tack without slowing down, is the exercise
// (flexibility). Harder levels: less time for each, from level 6 the rule shown only for a moment,
// and from level 8 a third rule, its size.

import { rand, pick, shuffle, speedScore, style } from '../util.js';

const ORANGE = '#ff9a2e', BLUE = '#3d8bff';
// each rule's cue: the word and a little picture of it
const CUES = {
  shape: '<svg viewBox="0 0 30 16" class="sh"><circle cx="8" cy="8" r="6"/><rect x="17" y="2" width="12" height="12" rx="1"/></svg>SHAPE',
  colour: `<svg viewBox="0 0 30 16"><circle cx="10" cy="8" r="7" fill="${ORANGE}"/><circle cx="20" cy="8" r="7" fill="${BLUE}"/></svg>COLOUR`,
  size: '<svg viewBox="0 0 30 16" class="sh"><path d="M9 14L21 2M15 2H21V8M9 8V14H15"/></svg>SIZE',
};
// what each button stands for, by shape, by colour and by size: the left one, then the right
const SIDES = [
  ['<i class="ic ci"></i><small>circle</small>', `<i class="ic sw" style="background:${ORANGE}"></i><small>orange</small>`, '<i class="ic tx">A</i><small>small</small>'],
  ['<i class="ic sq"></i><small>square</small>', `<i class="ic sw" style="background:${BLUE}"></i><small>blue</small>`, '<i class="ic tx big">A</i><small>big</small>'],
];

export default {
  how: 'Go by the rule over the card: its <b>shape</b> or its <b>colour</b>. Circle or orange: left. Square or blue: right. The rule keeps changing.',

  async run(ctx) {
    style('switch', `
      #train .d-switch .cue { display: flex; align-items: center; justify-content: center; gap: 10px; height: 34px; font: 800 24px var(--body); letter-spacing: .14em; color: #d9ceff; }
      #train .d-switch .cue svg { width: 32px; height: 18px; }
      #train .d-switch .cue .sh { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      #train .d-switch .cue.gone { visibility: hidden; }
      #train .d-switch .pic { width: 230px; height: 150px; border: 3px solid #2c3036; border-radius: 14px; background: #16191e; display: flex; align-items: center; justify-content: center; }
      #train .d-switch .pic.shape, #train .d-switch .pic.colour, #train .d-switch .pic.size { border-color: #d9ceff; }
      #train .d-switch .pic.colour { border-style: dashed; }
      #train .d-switch .pic.size { border-style: double; border-width: 7px; }
      #train .d-switch .pic i { display: block; }
      #train .d-switch .pic .ci { border-radius: 50%; }
      #train .d-switch .pic .sq { border-radius: 5px; }
      #train .d-switch .pic .md { width: 80px; height: 80px; }
      #train .d-switch .pic .sm { width: 44px; height: 44px; }
      #train .d-switch .pic .lg { width: 112px; height: 112px; }
      #train .d-switch .pic .note { font-size: 14px; line-height: 1.5; text-align: center; padding: 0 8px; }
      #train .d-switch .pic .note b { color: #d9ceff; }
      #train .d-switch .t-row { min-height: 76px; }
      #train .d-switch .answers button { min-height: 76px; gap: 14px; }
      #train .d-switch .answers button > span { display: flex; gap: 18px; align-items: flex-end; }
      #train .d-switch .m { display: flex; flex-direction: column; align-items: center; gap: 5px; }
      #train .d-switch .m small { font-size: 12px; font-weight: 600; color: var(--muted); }
      #train .d-switch .ic { display: block; font-style: normal; }
      #train .d-switch .ic.ci, #train .d-switch .ic.sq { width: 24px; height: 24px; border: 3px solid #eae6ff; border-radius: 50%; }
      #train .d-switch .ic.sq { border-radius: 3px; }
      #train .d-switch .ic.sw { width: 30px; height: 16px; border-radius: 8px; margin: 4px 0; }
      #train .d-switch .ic.tx { font: 800 13px/24px var(--body); color: #eae6ff; }
      #train .d-switch .ic.tx.big { font-size: 26px; }
      @media (max-height: 520px) {
        #train .d-switch .cue { height: 26px; font-size: 20px; }
        #train .d-switch .pic { width: 190px; height: 116px; }
        #train .d-switch .pic .md { width: 62px; height: 62px; }
        #train .d-switch .pic .sm { width: 34px; height: 34px; }
        #train .d-switch .pic .lg { width: 86px; height: 86px; }
        #train .d-switch .t-row, #train .d-switch .answers button { min-height: 62px; } }`);
    ctx.stage.classList.add('d-switch');
    const lv = ctx.level, n = ctx.items;
    const limit = Math.round(3000 - ((lv - 1) * 1900) / 9);   // (3 s for each at level 1, 1.1 s at 10)
    const rules = lv >= 8 ? ['shape', 'colour', 'size'] : ['shape', 'colour'];
    const brief = lv >= 6;                                    // (the rule up only for the first 600 ms)
    const against = (lv - 1) * 0.066;                         // (more cards where another rule says the other side)
    // the rule for each: any to start with, then a change every time (the switch is the point)
    const seq = [pick(rules)];
    for (let i = 1; i < n; i++) seq.push(pick(rules.filter((r) => r !== seq[i - 1])));
    const count = ctx.el('div', 't-score');
    const cue = ctx.el('div', 'cue gone');
    const pic = ctx.el('div', 'pic');
    const shp = ctx.el('i', '', pic);
    const slot = ctx.el('div', 't-row');
    slot.style.width = '100%';
    const labels = SIDES.map((s) => s.slice(0, rules.length).map((m) => `<span class="m">${m}</span>`).join(''));
    if (brief) {
      const note = ctx.el('div', 'note', pic, `${lv >= 8 ? 'New rule: <b>size</b>.<br>Small is left, big is right.<br>' : ''}The rule shows only<br>for a moment.`);
      await ctx.sleep(lv >= 8 ? 2800 : 1800);
      note.remove();
      if (ctx.aborted) return null;
    }
    let right = 0, wrong = 0;
    const secs = [];
    for (let k = 0; k < n && !ctx.aborted; k++) {
      count.textContent = `${k + 1} / ${n}`;
      const rule = seq[k], side = rand(0, 1);
      // the card: `side` by this rule, and the other side by another (on half of them at level 1, most at 10)
      const v = { shape: rand(0, 1), colour: rand(0, 1), size: rand(0, 1), [rule]: side };
      const others = rules.filter((r) => r !== rule);
      if (Math.random() < against && others.every((r) => v[r] === side)) v[pick(others)] = 1 - side;
      cue.innerHTML = CUES[rule];
      cue.className = 'cue';
      pic.className = `pic ${rule}`;
      shp.className = `${v.shape ? 'sq' : 'ci'} ${rules.length < 3 ? 'md' : v.size ? 'lg' : 'sm'}`;
      shp.style.background = v.colour ? BLUE : ORANGE;
      const p = ctx.choose(labels, { right: side, keys: ['KeyF', 'KeyJ'], limit, hold: 150, parent: slot, cols: 2 });
      // (the arrow keys work too)
      const btns = slot.querySelectorAll('button');
      ctx.key((code) => {
        const i = code === 'KeyF' || code === 'ArrowLeft' ? 0 : code === 'KeyJ' || code === 'ArrowRight' ? 1 : -1;
        if (i >= 0) btns[i].click();
        return i >= 0;
      });
      let r = brief ? await Promise.race([p, ctx.sleep(600)]) : await p;
      if (!r) { cue.className = 'cue gone'; pic.className = 'pic'; r = await p; }
      ctx.key(null);
      if (ctx.aborted) return null;
      if (r.ok) { right++; secs.push(r.ms / 1000); } else { if (r.i >= 0) wrong++; ctx.flash(false); }
      cue.className = 'cue gone';
      pic.className = 'pic';
      shp.className = '';
      await ctx.sleep(300);
    }
    // (a wrong answer takes back half a right one, so that guessing doesn't pay)
    return { score: speedScore(Math.max(0, right - wrong / 2), n, secs, 0.8, 2.2), right, total: n };
  },
};
