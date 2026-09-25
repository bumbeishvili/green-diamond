// Useful field of view, after the speed-of-processing training in the ACTIVE study: for a moment, a
// car or a truck in the middle and, at the same time, a car further out; then a mask, and two
// questions: what was in the middle, and where the other car was. Taking in more at a glance, and
// sooner (processing speed). Harder levels: a shorter glimpse (and within a round, shorter after two
// right running, longer after a miss), and from level 5 triangles all round to pick the car out of.

import { rand, shuffle, clamp, style } from '../util.js';

// the car and the truck, side on in a 48 x 28 box (the windows cut out)
const ICONS = {
  car: '<path fill-rule="evenodd" d="M2.5 19.5V14.4Q2.5 12.2 4.8 11.9L12.4 10.9L17.1 5.7Q18 4.6 19.6 4.6H30.4Q31.9 4.6 32.9 5.6L38.4 10.9L43.4 11.8Q45.8 12.3 45.8 14.8V19.5H41.4A5.4 5.4 0 0 0 30.6 19.5H17.4A5.4 5.4 0 0 0 6.6 19.5ZM18.9 6.7H24.6V10.7H15.2ZM26.4 6.7H31.4L35.4 10.7H26.4Z"/>'
    + '<circle cx="12" cy="19.5" r="4.2"/><circle cx="36" cy="19.5" r="4.2"/>',
  truck: '<path fill-rule="evenodd" d="M2 19.5V3.5Q2 2.5 3 2.5H27.5Q28.5 2.5 28.5 3.5V14H30.5V7.8Q30.5 6.6 31.7 6.6H38.2Q39.3 6.6 40 7.4L44.3 12.3Q45.9 12.9 45.9 14.6V19.5H42.4A5.4 5.4 0 0 0 31.6 19.5H16.4A5.4 5.4 0 0 0 5.6 19.5ZM32.2 8.3H37.9L41.4 12.3H32.2Z"/>'
    + '<circle cx="11" cy="19.5" r="4.2"/><circle cx="37" cy="19.5" r="4.2"/>',
};
const icon = (k) => `<svg viewBox="0 0 48 28" class="ic">${ICONS[k]}</svg>`;

// the eight ways out from the middle, clockwise from the top; their keys are the number pad's
// (8 up, 9 up and right, ...), and the top row's digits work the same
const WAYS = [0, 1, 2, 3, 4, 5, 6, 7];
const KEYS = ['Digit8', 'Digit9', 'Digit6', 'Digit3', 'Digit2', 'Digit1', 'Digit4', 'Digit7'];
const at = (r, i) => { const a = (i * Math.PI) / 4; return [r * Math.sin(a), -r * Math.cos(a)]; };
const R = 80;   // the car's ring, in a field 200 across
const arrow = (i) => `<svg viewBox="-10 -10 20 20" class="arr"><path d="M0-8L7-1H2.6V8H-2.6V-1H-7Z" transform="rotate(${i * 45})"/></svg>`;

// what flashes up: the one in the middle, the car out on its ring, and `n` triangles (the car's own
// ring filled first, so it has to be picked out from them; then the rings inside and round it)
function glimpse(mid, way, n) {
  const put = (k, [x, y]) => `<g transform="translate(${(x - 16).toFixed(1)} ${(y - 9.3).toFixed(1)}) scale(.667)">${ICONS[k]}</g>`;
  const own = shuffle(WAYS.filter((i) => i !== way)).map((i) => at(R, i));
  const more = shuffle(WAYS.flatMap((i) => [at(48, i), at(63, i + 0.5), at(91, i + 0.5)]));
  const tris = [...own, ...more].slice(0, n).map(([x, y]) => `<path class="tri" d="M${x.toFixed(1)} ${(y - 12).toFixed(1)}l10.4 18h-20.8z"/>`);
  return put(mid, [0, 0]) + put('car', at(R, way)) + tris.join('');
}

// the mask: fresh noise and a scatter of strokes over the whole field, so nothing lingers
function noise(cv) {
  const s = 110, c = cv.getContext('2d');
  cv.width = cv.height = s;
  const img = c.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const v = Math.random() < 0.55 ? 20 + Math.random() * 45 : 80 + Math.random() * 170;
    img.data.set([v, v, v + 12, 255], i * 4);
  }
  c.putImageData(img, 0, 0);
  c.strokeStyle = '#eae6ff'; c.lineWidth = 1.8; c.lineCap = 'round';
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * s, y = Math.random() * s, a = Math.random() * Math.PI, l = 4 + Math.random() * 10;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
}

export default {
  how: 'Eyes on the cross. A car or a truck flashes up in the middle, and a car further out: say what was in the <b>middle</b>, then <b>where</b> the other car was.',

  async run(ctx) {
    style('ufov', `
      #train .d-ufov .ask { font-size: 18px; font-weight: 600; min-height: 24px; text-align: center; }
      #train .d-ufov .ask.dim { color: var(--muted); font-weight: 400; }
      #train .d-ufov .field { position: relative; width: min(340px, 84vw); height: min(340px, 84vw); background: #16191e; border: 1px solid #2c3036; border-radius: 12px; overflow: hidden; }
      #train .d-ufov .field > svg, #train .d-ufov .field canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      #train .d-ufov .field canvas { image-rendering: pixelated; }
      #train .d-ufov .orbit { fill: none; stroke: #232830; stroke-width: 1; stroke-dasharray: 3 4; }
      #train .d-ufov .box { fill: none; stroke: #3a3f47; stroke-width: 1.5; }
      #train .d-ufov .cross { stroke: #b98cff; stroke-width: 2.5; stroke-linecap: round; }
      #train .d-ufov .show { fill: #eae6ff; }
      #train .d-ufov .tri { fill: none; stroke: #eae6ff; stroke-width: 3; stroke-linejoin: round; }
      #train .d-ufov .field .cross, #train .d-ufov .field .show, #train .d-ufov .field canvas { display: none; }
      #train .d-ufov .field.wait .cross, #train .d-ufov .field.flash .show, #train .d-ufov .field.mask canvas { display: block; }
      #train .d-ufov .field.q1 .box { display: none; }
      #train .d-ufov .over, #train .d-ufov .over .answers { position: absolute; inset: 0; }
      #train .d-ufov .over .answers { width: auto; display: block; }
      #train .d-ufov .over .answers.mid { display: flex; align-items: center; justify-content: center; gap: 12px; }
      #train .d-ufov .mid button { position: relative; width: 112px; padding: 14px 6px 8px; }
      #train .d-ufov .mid button span { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 16px; }
      #train .d-ufov .mid button b { position: absolute; left: 8px; top: 5px; }
      #train .d-ufov .ic { width: 66px; height: 38px; fill: #eae6ff; display: block; }
      #train .d-ufov .ring button { position: absolute; width: 56px; height: 56px; min-height: 0; padding: 0; border-radius: 50%; transform: translate(-50%, -50%);
        flex-direction: column-reverse; gap: 0; }
      #train .d-ufov .ring button span { display: block; line-height: 0; }
      #train .d-ufov .arr { width: 24px; height: 24px; fill: #d9ceff; }
      @media (max-height: 520px) {
        #train .d-ufov .ask { font-size: 16px; min-height: 20px; }
        #train .d-ufov .field { width: 256px; height: 256px; }
        #train .d-ufov .mid button { width: 98px; padding: 12px 4px 6px; }
        #train .d-ufov .ic { width: 56px; height: 32px; }
        #train .d-ufov .ring button { width: 48px; height: 48px; } }`);
    ctx.stage.classList.add('d-ufov');
    const lv = ctx.level, n = 8;
    // the glimpse: 300 ms at level 1 down to 60 at 10; then, within the round, shorter after two right
    // running and longer after a miss (between half and twice the level's own)
    const base = 300 * 0.2 ** ((lv - 1) / 9), lo = Math.max(34, base / 2), hi = Math.min(600, base * 2);
    const crowd = lv < 5 ? 0 : Math.round(8 + (lv - 5) * 3.2);   // (8 at level 5, 24 at 10)
    const count = ctx.el('div', 't-score'), ask = ctx.el('div', 'ask'), field = ctx.el('div', 'field');
    field.innerHTML = '<svg viewBox="-100 -100 200 200"><circle class="orbit" r="80"/><rect class="box" x="-22" y="-16" width="44" height="32" rx="5"/>'
      + '<path class="cross" d="M-7 0H7M0-7V7"/><g class="show"></g></svg><canvas></canvas><div class="over"></div>';
    const show = field.querySelector('.show'), cv = field.querySelector('canvas'), over = field.querySelector('.over');
    // each way out once, and as many cars as trucks in the middle
    const ways = shuffle([...WAYS]), mids = shuffle(['car', 'car', 'car', 'car', 'truck', 'truck', 'truck', 'truck']);
    // (a wait counted in frames, so the screen changes on the frame that makes the time)
    const until = async (t0, ms) => { let t = t0; while (t - t0 < ms - 8 && !ctx.aborted) t = await ctx.frame(); return t; };
    let ms = base, run = 0, sum = 0, right = 0;
    for (let k = 0; k < n; k++) {
      ctx.expect(null);
      count.textContent = `${k + 1} / ${n}`;
      ask.textContent = 'Eyes on the cross';
      ask.className = 'ask dim';
      over.innerHTML = '';
      field.className = 'field wait';
      show.innerHTML = glimpse(mids[k], ways[k], crowd);
      noise(cv);
      await ctx.sleep(k ? rand(700, 1100) : 1200);
      if (ctx.aborted) return null;
      // the glimpse: up on one frame, the mask over it on the frame that makes `ms`
      const t0 = await ctx.frame();
      field.className = 'field flash';
      const t1 = await until(t0, ms);
      field.className = 'field mask';
      await until(t1, 250);
      field.className = 'field q1';
      if (ctx.aborted) return null;
      // what was in the middle, then where the other car was
      ask.textContent = 'What was in the middle?';
      ask.className = 'ask';
      const a = await ctx.choose([`${icon('car')}Car`, `${icon('truck')}Truck`], { right: mids[k] === 'car' ? 0 : 1, parent: over, cls: 'mid', hold: 350 });
      if (ctx.aborted) return null;
      ask.textContent = 'Where was the other car?';
      field.className = 'field';
      const p = ctx.choose(WAYS.map(arrow), { right: ways[k], keys: KEYS, parent: over, cls: 'ring', hold: 550 });
      over.querySelectorAll('.ring button').forEach((b, i) => { const [x, y] = at(40, i); b.style.left = `${50 + x}%`; b.style.top = `${50 + y}%`; });
      const b = await p;
      if (ctx.aborted) return null;
      const got = (a.ok ? 0.5 : 0) + (b.ok ? 0.5 : 0);
      sum += got;
      if (got === 1) { right++; if (++run === 2) { run = 0; ms *= 0.85; } } else { run = 0; ms *= 1.25; }
      ms = clamp(ms, lo, hi);
      if (got !== 0.5) ctx.flash(got === 1);
      await ctx.sleep(350);
    }
    return { score: sum / n, right, total: n };
  },
};
