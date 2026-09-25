// Dual n-back: every couple of seconds a square lights up on a 3 x 3 grid and a note plays. Somewhere
// in the stream the square (or the note) is the one from n steps back: press Position (or Sound) when
// it comes. One such match a round (two from a puzzle crate), and every step until then held against
// the one n back, both streams at once: working memory at full stretch. Harder levels: further back
// (n from 1 to 4), and less time for each step.

import { rand, shuffle, style } from '../util.js';

// eight notes far enough apart to tell by ear (C major without its semitones, C4 to E5)
const NOTES = [262, 294, 330, 392, 440, 523, 587, 659];
const SQUARES = [0, 1, 2, 3, 5, 6, 7, 8];   // (the middle of the grid is the cross)

// `len` steps of 0..7, the same as the one n back exactly at the steps in `at`; the others never the
// one just before either (runs of one square read as a match when they aren't)
function stream(len, n, at) {
  const hit = Array(len).fill(false);
  for (const i of at) hit[i] = true;
  const s = [];
  for (let i = 0; i < len; i++) {
    let v = hit[i] ? s[i - n] : rand(0, 7);
    while (!hit[i] && (v === s[i - n] || v === s[i - 1])) v = rand(0, 7);
    s.push(v);
  }
  return { s, hit };
}

export default {
  how: 'A square lights up and a note plays, again and again. When the square is where it was <b>n steps back</b>, press <b>Position</b>; when the note is the one from n back, <b>Sound</b>.',

  async run(ctx) {
    style('nback', `
      #train .d-nback { gap: 12px; }
      #train .d-nback .ask { font-size: 16px; }
      #train .d-nback .ask b { color: #d9ceff; }
      #train .d-nback .play { display: grid; grid-template-columns: 200px 200px; grid-template-areas: "grid grid" "pos snd"; gap: 16px 14px; justify-content: center; }
      #train .d-nback .grid { grid-area: grid; justify-self: center; display: grid; grid-template-columns: repeat(3, 62px); grid-auto-rows: 62px; gap: 7px; }
      #train .d-nback .grid i { border-radius: 8px; background: #1b1f25; border: 1px solid #2c3036; transition: background .1s, box-shadow .1s; }
      #train .d-nback .grid i.lit { background: #b98cff; border-color: #d9ceff; box-shadow: 0 0 22px rgba(185,140,255,.5); transition: none; }
      #train .d-nback .grid i.mid { background: none; border: 0; display: flex; align-items: center; justify-content: center; color: #4a4f58; font: 300 28px var(--body); font-style: normal; }
      #train .d-nback .play button { height: 60px; border-radius: 10px; background: #1b1f25; border: 1px solid #333840; color: var(--ink); font: 700 19px var(--body); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 10px; user-select: none; -webkit-user-select: none; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
      #train .d-nback .play button b { color: #8a857c; font-size: 12px; font-weight: 700; }
      #train .d-nback .play button:hover:not(.wait) { border-color: #8f6ae0; }
      #train .d-nback .play .pos { grid-area: pos; }
      #train .d-nback .play .snd { grid-area: snd; }
      #train .d-nback .play button.wait { opacity: .35; cursor: default; }
      #train .d-nback .play button.on { background: #2a2340; border-color: #b98cff; color: #fff; }
      #train .d-nback .play button.ok { background: #1d3a22; border-color: #5fd35f; }
      #train .d-nback .play button.no { background: #3a1d1d; border-color: #ff5a4a; }
      #train .d-nback .play button.miss { border: 1px dashed #5fd35f; color: #a8e6a8; }
      @media (max-height: 520px) {
        #train .d-nback { gap: 8px; }
        #train .d-nback .play { width: 100%; grid-template-columns: 1fr auto 1fr; grid-template-areas: "pos grid snd"; gap: 16px; }
        #train .d-nback .grid { grid-template-columns: repeat(3, 54px); grid-auto-rows: 54px; gap: 6px; }
        #train .d-nback .play button { height: auto; font-size: 20px; } }`);
    ctx.stage.classList.add('d-nback');
    const lv = ctx.level, n = lv <= 2 ? 1 : lv <= 6 ? 2 : lv <= 9 ? 3 : 4;
    const k = ctx.items, len = n + 4 + k + rand(0, 2), step = Math.round(2800 - (lv - 1) * 90), show = 500, fb = 350;
    // the match (or two): at steps well into the stream, each in the squares or the notes
    const when = shuffle(Array.from({ length: len - n - 2 }, (_, i) => i + n + 2)).slice(0, k), which = when.map(() => rand(0, 1));
    const st = [0, 1].map((j) => stream(len, n, when.filter((_, i) => which[i] === j)));
    const count = ctx.el('div', 't-score');
    ctx.el('div', 'ask t-hint', null, `<b>n = ${n}</b>: ${k > 1 ? 'two matches are' : 'a match is'} coming, with ${n === 1 ? 'the one before' : `the one ${n} back`}`);
    const play = ctx.el('div', 'play');
    const grid = ctx.el('div', 'grid', play);
    const cells = Array.from({ length: 9 }, (_, i) => ctx.el('i', i === 4 ? 'mid' : '', grid, i === 4 ? '+' : null));
    const btns = [['pos', 'Position', 'F'], ['snd', 'Sound', 'J']].map(([cls, label, key]) => {
      const b = ctx.el('button', `${cls} wait`, play, `${ctx.touch ? '' : `<b>${key}</b>`}<span>${label}</span>`);
      b.type = 'button';
      return b;
    });
    const pressed = [false, false], hits = [0, 0], fas = [0, 0];
    let live = false;
    const press = (j) => { if (!live || pressed[j]) return; pressed[j] = true; btns[j].classList.add('on'); };
    btns.forEach((b, j) => { b.onpointerdown = (e) => { e.preventDefault(); press(j); }; });
    ctx.key((code) => {
      const j = code === 'KeyF' || code === 'KeyA' ? 0 : code === 'KeyJ' || code === 'KeyL' ? 1 : -1;
      if (j >= 0) press(j);
      return j >= 0;
    });
    await ctx.sleep(800);
    for (let i = 0; i < len; i++) {
      if (ctx.aborted) return null;
      const on = i >= n, sq = cells[SQUARES[st[0].s[i]]];
      count.textContent = `${i + 1} / ${len}`;
      pressed.fill(false);
      for (const b of btns) { b.classList.remove('on', 'ok', 'no', 'miss'); b.classList.toggle('wait', !on); }
      live = on;   // (nothing n back to match for the first n)
      sq.classList.add('lit');
      ctx.tone(NOTES[st[1].s[i]], 400, 0.3);
      // (the test hook: the buttons this step wants, or just the others; once a step)
      let acted = false;
      ctx.expect(on ? (ok) => { if (acted) return; acted = true; st.forEach((x, j) => { if (x.hit[i] === !!ok) press(j); }); } : null);
      await ctx.sleep(show);
      if (ctx.aborted) return null;
      sq.classList.remove('lit');
      await ctx.sleep(step - show - fb);
      if (ctx.aborted) return null;
      live = false;
      ctx.expect(null);
      // how the step went, on each button: green a right press, red a wrong one, dashed a match missed
      if (on) st.forEach((x, j) => {
        if (pressed[j]) { if (x.hit[i]) hits[j]++; else fas[j]++; btns[j].classList.add(x.hit[i] ? 'ok' : 'no'); }
        else if (x.hit[i]) btns[j].classList.add('miss');
      });
      await ctx.sleep(fb);
    }
    ctx.key(null);
    await ctx.sleep(450);
    // the matches caught, less half a one for each press where there wasn't one
    const caught = hits[0] + hits[1], rash = fas[0] + fas[1];
    return { score: Math.max(0, caught - rash / 2) / k, right: caught, total: k };
  },
};
