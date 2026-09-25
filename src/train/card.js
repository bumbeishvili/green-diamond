// The brain-training card, over the game: one puzzle at a time. Its name, what it trains and its
// level; how to play, and Start; the puzzle itself (each a module of its own under drills/, fetched
// the first time it's wanted); then the score and what it paid.
//
// A puzzle is { how: 'one or two lines of how to play', run(ctx) -> {score 0..1, right, total} } and
// does everything through its context:
//   ctx.stage            where it draws (empty to start with); ctx.el(tag, cls, parent, html) makes things in it
//   ctx.level            1..10, how hard (the puzzle decides what that means)
//   ctx.touch            a phone or tablet: bigger targets, no keys shown
//   ctx.game             the game (its level data, for a puzzle set in Green Diamond itself)
//   ctx.aborted          true once the card is closed: stop at the next await and return
//   ctx.sleep(ms)        a pause (over at once if the card is closed); ctx.frame(): the next animation frame
//   ctx.clock(secs)      the round's time limit, shown as the bar: {left(), over(), done: Promise}
//   ctx.key(fn)          fn(code, e) gets every key while the puzzle runs (return true if it was used)
//   ctx.choose(labels, {right, keys, cols, limit, hold, parent, cls}) -> {i, ok, ms}: answer buttons,
//                        with keys 1..n (or `keys`), marked right and wrong; i = -1 when `limit` ms ran out
//   ctx.flash(ok)        a green or red flash round the stage
//   ctx.tone(hz, ms, vol), ctx.say(text)
//   ctx.words()          the English words [{w, ka, p, b, ex, e, t}] (data/words.json)
//   ctx.data(name)       data/<name>.json
//   ctx.expect(fn)       for tests: fn(true) gives a right answer to what's asked now, fn(false) a wrong one
//                        (ctx.choose does this itself)

import { el } from './util.js';

const mods = new Map();
export function loadDrill(id) {
  if (!mods.has(id)) mods.set(id, import(`./drills/${id}.js`).then((m) => m.default).catch((e) => { mods.delete(id); throw e; }));
  return mods.get(id);
}

const cache = new Map();
function fetchJson(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }).catch((e) => { cache.delete(url); throw e; }));
  return cache.get(url);
}

export class Card {
  constructor(game) {
    this.g = game;
    this.open = false;
    this.phase = null;          // 'load' | 'intro' | 'run' | 'result'
    this.waiters = new Set();   // pauses to end early when the card is closed
    const root = this.el = el('div', 'hidden', document.body);
    root.id = 'train';
    root.innerHTML = `<div class="card">
      <div class="top"><b class="title"></b><span class="skill"></span><span class="lvl"></span><span class="dots"></span><button type="button" class="x" title="Close (Esc)">✕</button></div>
      <div class="bar"><i></i></div>
      <div class="stage"></div>
    </div>`;
    this.$ = (s) => root.querySelector(s);
    this.stage = this.$('.stage');
    this.$('.x').onclick = () => this.close();
    // while it's up, the keys are the card's (Esc closes it; the game hears nothing)
    addEventListener('keydown', (e) => {
      if (!this.open) return;
      e.stopPropagation();
      if (e.code === 'Escape') { e.preventDefault(); this.close(); return; }
      if (e.repeat) { e.preventDefault(); return; }
      if (this.keyFn && this.keyFn(e.code, e)) e.preventDefault();
    }, true);
  }

  // ---- a round ----

  // Shows `meta` ({id, name, skill}) at `level`: how to play, then the puzzle. Resolves with its
  // result, or null if the card was closed (or the puzzle wouldn't load).
  async play(meta, level, { index = 0, count = 1 } = {}) {
    this.show();
    this.closedP = this.closedP || new Promise((r) => { this.onClosed = r; });
    this.$('.title').textContent = meta.name;
    this.$('.skill').textContent = meta.skill;
    this.$('.lvl').textContent = `Level ${level}`;
    this.$('.dots').innerHTML = count > 1 ? Array.from({ length: count }, (_, i) => `<i class="${i < index ? 'ok' : i === index ? 'cur' : ''}"></i>`).join('') : '';
    this.clearStage();
    this.phase = 'load';
    el('div', 't-load', this.stage, 'Loading…');
    let drill;
    try { drill = await loadDrill(meta.id); } catch (e) {
      console.error(e);
      this.stage.innerHTML = '<div class="t-load">This puzzle didn\'t load. Check the connection and try again.</div>';
      await this.pause(1800);
      return null;
    }
    if (!this.open) return null;
    // how to play; Start (Space, Enter or a tap)
    this.clearStage();
    this.phase = 'intro';
    const intro = el('div', 't-intro', this.stage);
    el('p', 'how', intro, drill.how);
    const start = el('button', 'btn', intro, `Start${this.g.touch ? '' : ' <small>Space</small>'}`);
    start.type = 'button';
    const go = await new Promise((resolve) => {
      start.onclick = () => resolve(true);
      this.keyFn = (code) => { if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') { resolve(true); return true; } return false; };
      this.expectFn = () => resolve(true);
      this.closedP.then(() => resolve(false));
    });
    this.keyFn = null; this.expectFn = null;
    if (!go || !this.open) return null;
    this.clearStage();
    this.phase = 'run';
    const ctx = this.context(level);
    let res = null;
    try { res = await Promise.race([drill.run(ctx), this.closedP.then(() => null)]); } catch (e) { console.error(e); res = null; }
    this.keyFn = null; this.expectFn = null;
    this.stopClock();
    if (!this.open || !res) return null;
    return { ...res, score: Math.max(0, Math.min(1, +res.score || 0)) };
  }

  // The end of a round: the score, what it paid, the level; Continue (Space, a tap), or on its own
  // after a few seconds. Resolves false if the card was closed instead.
  async result({ score, gain = 0, level, next, practice = false, last = true }) {
    this.clearStage();
    this.phase = 'result';
    const pct = Math.round(score * 100);
    const box = el('div', 't-res', this.stage);
    el('div', `big ${score >= 0.8 ? 'ok' : score < 0.5 ? 'no' : ''}`, box, `${pct}%`);
    el('div', 'what', box, score >= 0.95 ? 'Perfect' : score >= 0.8 ? 'Very good' : score >= 0.5 ? 'Good' : 'Keep at it');
    if (!practice) el('div', 'gain', box, gain ? `+${gain} lari` : 'No lari this time');
    el('div', 'lv', box, next > level ? `Level up: ${next}` : next < level ? `Easier next time: level ${next}` : `Level ${level}`);
    const b = el('button', 'btn', box, `${last ? 'Back to the game' : 'Next puzzle'}${this.g.touch ? '' : ' <small>Space</small>'}`);
    b.type = 'button';
    return new Promise((resolve) => {
      const done = (v) => { clearTimeout(t); this.keyFn = null; this.expectFn = null; resolve(v && this.open); };
      const t = setTimeout(() => done(true), last ? 3500 : 5000);
      b.onclick = () => done(true);
      this.keyFn = (code) => { if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') { done(true); return true; } return false; };
      this.expectFn = () => done(true);
      this.closedP.then(() => done(false));
    });
  }

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    this.el.classList.toggle('touch', !!this.g.touch);
  }

  // closed early (✕, Esc) or done with
  close() {
    if (!this.open) return;
    this.open = false;
    this.phase = null;
    this.keyFn = null; this.expectFn = null;
    this.stopClock();
    for (const w of this.waiters) w();
    this.waiters.clear();
    this.el.classList.add('hidden');
    this.clearStage();
    try { speechSynthesis.cancel(); } catch { /* no voice */ }
    const f = this.onClosed;
    this.closedP = null; this.onClosed = null;
    f?.();
  }

  clearStage() { this.stage.innerHTML = ''; this.stage.className = 'stage'; this.answersEl = null; }

  // tests: answer what's asked now (right or wrong), press Start, or Continue
  auto(right = true) { const f = this.expectFn; if (f) { f(right); return true; } return false; }

  // ---- what a puzzle gets ----

  context(level) {
    const card = this, g = this.g, stage = this.stage;
    return {
      stage, level, touch: !!g.touch, game: g,
      get aborted() { return !card.open; },
      el: (tag, cls = '', parent = null, html = null) => el(tag, cls, parent || stage, html),
      sleep: (ms) => card.pause(ms),
      frame: () => new Promise((r) => requestAnimationFrame(r)),
      clock: (secs) => card.startClock(secs),
      key: (fn) => { card.keyFn = fn; },
      expect: (fn) => { card.expectFn = fn; },
      choose: (labels, opts) => card.choose(labels, opts),
      flash: (ok) => { stage.classList.remove('f-ok', 'f-no'); void stage.offsetWidth; stage.classList.add(ok ? 'f-ok' : 'f-no'); },
      tone: (hz, ms, vol) => card.tone(hz, ms, vol),
      say: (text) => card.say(text),
      words: () => fetchJson('data/words.json').then((ws) => ws.filter((q) => q && q.w && q.ka)),
      data: (name) => fetchJson(`data/${name}.json`),
    };
  }

  pause(ms) {
    if (!this.open) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(t); this.waiters.delete(done); resolve(); };
      const t = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  // the round's time limit, as the bar running down
  startClock(secs) {
    this.stopClock();
    const bar = this.$('.bar i'), t0 = performance.now(), ms = secs * 1000;
    bar.style.transition = 'none'; bar.style.width = '100%';
    void bar.offsetWidth;
    bar.style.transition = `width ${secs}s linear`; bar.style.width = '0%';
    let end;
    const done = new Promise((r) => { end = r; });
    const t = setTimeout(() => end(), ms);
    this.clockStop = () => { clearTimeout(t); end(); };
    this.closedP?.then(() => end());
    return { left: () => Math.max(0, (ms - (performance.now() - t0)) / 1000), over: () => performance.now() - t0 >= ms, done };
  }

  stopClock() {
    const bar = this.$('.bar i');
    bar.style.transition = 'none'; bar.style.width = '0%';
    this.clockStop?.(); this.clockStop = null;
  }

  // answer buttons: resolves {i, ok, ms} when one is picked (i = -1 if `limit` ms run out first);
  // the right one goes green, a wrong pick red, for `hold` ms before it resolves
  choose(labels, { right = null, keys = null, cols = null, limit = 0, hold = 320, parent = null, cls = '' } = {}) {
    this.answersEl?.remove();   // (one set of answers at a time: the last one goes)
    const box = this.answersEl = el('div', `answers ${cls}`, parent || this.stage);
    if (cols) box.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    const codes = keys || labels.map((_, i) => `Digit${i + 1}`);
    const names = { KeyF: 'F', KeyJ: 'J', KeyD: 'D', KeyK: 'K', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space' };
    const btns = labels.map((label, i) => {
      const b = el('button', '', box, `${!this.g.touch && codes[i] ? `<b>${names[codes[i]] || codes[i].replace(/^(Digit|Key)/, '')}</b>` : ''}<span>${label}</span>`);
      b.type = 'button';
      return b;
    });
    const t0 = performance.now();
    return new Promise((resolve) => {
      let over = false, timer = null;
      const finish = async (i) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        if (this.keyFn === onKey) this.keyFn = null;
        if (this.expectFn === onExpect) this.expectFn = null;
        const ms = performance.now() - t0, ok = right != null && i === right;
        for (const b of btns) b.disabled = true;
        if (right != null) {
          if (btns[right]) btns[right].classList.add('ok');
          if (i >= 0 && i !== right) btns[i].classList.add('no');
        }
        if (hold > 0 && this.open) await this.pause(hold);
        resolve({ i, ok, ms });
      };
      btns.forEach((b, i) => { b.onclick = () => finish(i); });
      const onKey = (code) => {
        let i = codes.indexOf(code);
        if (i < 0 && /^Numpad\d$/.test(code)) i = codes.indexOf(`Digit${code.slice(6)}`);
        if (i < 0) return false;
        finish(i);
        return true;
      };
      const onExpect = (ok) => finish(ok ? right ?? 0 : right === 0 ? 1 : 0);
      this.keyFn = onKey;
      this.expectFn = onExpect;
      if (limit > 0) timer = setTimeout(() => finish(-1), limit);
      this.closedP?.then(() => finish(-1));
    });
  }

  // a short beep (the game's sound, or its own if the game's isn't up yet)
  tone(hz, ms = 200, vol = 0.25) {
    try {
      const a = this.g.audio;
      const c = a && a.ctx ? a.ctx : (this.ac = this.ac || new (window.AudioContext || window.webkitAudioContext)());
      if (c.state !== 'running') c.resume();
      const o = c.createOscillator(), gn = c.createGain(), t = c.currentTime;
      o.type = 'triangle'; o.frequency.value = hz;
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      o.connect(gn).connect(a && a.ctx && a.master ? a.master : c.destination);
      o.start(t); o.stop(t + ms / 1000 + 0.05);
    } catch { /* no sound */ }
  }

  say(text) {
    try {
      if (typeof speechSynthesis === 'undefined' || !text) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 0.9;
      const v = speechSynthesis.getVoices().find((x) => /^en[-_](US|GB)/i.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch { /* no voice */ }
  }
}
