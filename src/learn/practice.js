// Bonus questions in the game (English or maths): an offer, never a test you have to sit.
//
// After a wave (every third on Light) a small card offers a question or two for lari: press B, or
// tap it (alone, the game waits for you; with friends it goes on around you, but nothing can hurt you
// while you answer); leave it and it goes. Question crates round the complex hold one question. Each
// right answer pays 300 to 600 lari (more as the waves get tougher, more for a word you once missed);
// five right in a row, a gun you haven't got (or a power-up); every 50 new English words, the gun in
// your hands a level up. Wrong: you're shown the answer (a word's Georgian, a sentence and its sound;
// how a sum is worked out). No level test: three quick right answers running move you up a level.

import { settings, saveSettings, URLFLAGS } from '../config.js';
import { Learn, INTENSITY } from './learn.js';
import { Quiz } from './quiz.js';
import { mathItem } from './math.js';
import { DEFS } from '../game/weapons.js';

const BANDS = ['', 'Beginner', 'Elementary', 'Pre-intermediate', 'Intermediate', 'Upper-intermediate', 'Advanced'];
const EVERY = { light: 3, normal: 1, intense: 1 };            // an offer every n waves
const OFFER_S = 10;                                           // how long the offer stays up
const LOOT = ['deagle', 'shotgun', 'm4', 'aug', 'autosniper', 'msr', 'mg', 'bow', 'chainsaw', 'launcher'];

export class Practice {
  constructor(game) {
    this.g = game;
    this.learn = new Learn();
    this.quiz = new Quiz(this.learn);
    // (on from the start, at Light, until you pick something else in Settings; a test run, off unless
    // its URL says, and nothing saved)
    const auto = !!(URLFLAGS.autostart || URLFLAGS.mp);
    if (URLFLAGS.english || auto) this.setMode(URLFLAGS.english || 'off', settings.learnHints !== false, false);
    else this.setMode(settings.english || 'light', settings.learnHints !== false);
    this.subjects = settings.subjects || 'both';
  }

  get on() { return INTENSITY[this.mode] > 0 && (this.learn.ready || this.subjects === 'math'); }

  // English, maths, or both at random
  setSubjects(v) {
    this.subjects = ['both', 'english', 'math'].includes(v) ? v : 'both';
    settings.subjects = this.subjects;
    saveSettings();
  }
  get open() { return this.quiz.open || this.busy; }

  setMode(mode, hints, save = true) {
    this.mode = INTENSITY[mode] != null ? mode : 'off';
    this.learn.hints = hints;
    if (save) {
      settings.english = this.mode; settings.learnHints = hints;
      delete settings.learn;   // (the first version's setting, off unless chosen)
      saveSettings();
    }
    if (INTENSITY[this.mode] > 0) this.learn.load();
    if (!this.on) this.hideOffer();
  }

  // ---- the offer between waves: take it or leave it ----
  waveEnd(w) {
    if (!this.on || this.open || w % EVERY[this.mode] || this.g.pvp?.on) return;   // (not against other players)
    setTimeout(() => this.offer(), 1400);
  }

  // what a right answer pays now: 300 lari, more as the waves go on (and for a word you once missed), 600 at most
  worth(learned = false) {
    const wave = Math.max(1, this.g.director?.wave || 1);
    return Math.min(600, Math.round((300 + 25 * (wave - 1) + (learned ? 100 : 0)) / 10) * 10);
  }

  // n questions: English words and sums, as chosen (a word already asked this time: a sum instead)
  items(n) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const english = this.subjects === 'english' || (this.subjects === 'both' && Math.random() < 0.5);
      const it = english && this.learn.ready ? this.learn.pick(1)[0] : null;
      out.push(it && !out.some((o) => o.q === it.q) ? it : mathItem(this.learn.s.mlevel || 2));
    }
    return out;
  }

  offer() {
    const g = this.g;
    if (!this.on || this.open || g.state !== 'playing' || g.player.dead) return;
    const el = this.offerEl || this.makeOffer();
    this.offerN = this.mode === 'intense' ? 2 : Math.random() < 0.5 ? 2 : 1;
    el.querySelector('span').innerHTML = this.offerN === 2 ? `two questions, <em>+${this.worth()}</em> lari each` : `a question for <em>+${this.worth()}</em> lari`;
    el.querySelector('i').remove();                    // (the time bar, from the start again)
    el.appendChild(document.createElement('i'));
    el.classList.remove('hidden');
    clearTimeout(this.offerT);
    this.offerT = setTimeout(() => this.hideOffer(), OFFER_S * 1000);
  }

  makeOffer() {
    const el = this.offerEl = document.createElement('div');
    el.id = 'eoffer';
    el.className = 'hidden';
    el.style.setProperty('--t', `${OFFER_S}s`);
    el.innerHTML = `<b>Bonus</b><span></span><kbd>${this.g.touch ? 'tap' : 'B'}</kbd><i></i>`;
    document.body.appendChild(el);
    const take = (e) => { e.preventDefault(); e.stopPropagation(); this.take(); };
    el.addEventListener('click', take);
    el.addEventListener('touchstart', take, { passive: false });
    addEventListener('keydown', (e) => { if (e.code === 'KeyB' && !el.classList.contains('hidden') && this.g.state === 'playing') this.take(); });
    return el;
  }

  hideOffer() { clearTimeout(this.offerT); this.offerEl?.classList.add('hidden'); }

  take() { this.hideOffer(); this.ask('Bonus', this.offerN || 1); }

  // a question crate: one question (with the questions off, just the cash inside)
  crate() {
    if (!this.on || this.g.pvp?.on) { this.cash(150); this.g.hud.notice('A question crate: 150 lari inside'); return; }
    this.ask('Question crate', 1);
  }

  // a question or two, and what they pay
  async ask(title, n = 1) {
    if (this.open) return;
    const items = this.items(n);
    if (!items.length) return;
    const level = this.learn.s.level;
    this.enter();
    const res = await this.quiz.run(items, { title, onAnswer: (r) => this.pay(r) });
    this.leave();
    const g = this.g;
    if (res.gained) g.hud.notice(`Bonus: +${res.gained} lari`);
    if (this.learn.s.level > level) g.hud.banner(`English: ${BANDS[this.learn.s.level]}`, 'Harder words from now on');
    // every 50 new words: the gun in your hands, a level up
    const m = Math.floor(this.learn.s.learned / 50);
    if (m > (this.learn.s.milestone || 0)) {
      this.learn.s.milestone = m; this.learn.save();
      this.upgrade(`${m * 50} new words`);
    }
  }

  // (solo: the world waits; either way you can't shoot while you answer, and nothing can hurt you)
  enter() {
    const g = this.g;
    this.busy = true;
    g.player.answering = true;
    if (g.mode === 'client') g.net?.answering?.(true);
    if (g.mode === 'solo' && g.state === 'playing') g.state = 'quiz';
    g.touch?.reset();
    g.input.unlock();
  }

  leave() {
    const g = this.g;
    this.busy = false;
    g.player.answering = false;
    if (g.mode === 'client') g.net?.answering?.(false);
    if (g.state === 'quiz') g.state = 'playing';
    if (g.state !== 'playing' || g.touch) return;
    g.input.lock();
    // (a browser that wants a click before it gives the mouse back: "click to play")
    if (!URLFLAGS.nolock && !URLFLAGS.autostart) setTimeout(() => { if (g.state === 'playing' && !g.input.locked && !this.open) document.getElementById('clicktoplay').classList.remove('hidden'); }, 400);
  }

  // ---- what it's worth ----
  pay(r) {
    if (!r.right) return 0;
    const pts = this.worth(r.learned);
    this.cash(pts);
    const s = this.learn.s.streak;
    if (s > 0 && s % 5 === 0) this.bonus(`${s} right in a row`);
    return pts;
  }

  // money (a co-op client asks the host, which keeps everyone's points)
  cash(n) {
    const g = this.g;
    if (g.mode === 'client') g.net.learnReward({ p: n });
    else g.director.addPoints(n, true);
  }

  // a gun you haven't got; if you have them all, a power-up at your feet
  bonus(why) {
    const g = this.g, w = g.weapons;
    const missing = LOOT.filter((k) => DEFS[k] && !w.owned[k]);
    if (missing.length) {
      const k = missing[Math.floor(Math.random() * missing.length)];
      g.pickups.takeGun(k);
      g.hud.notice(`${why}: you get the ${DEFS[k].name}`);
      return;
    }
    if (g.mode === 'client') g.net.learnReward({ pw: 1 });
    else g.director.drop(g.player.pos);
    g.hud.notice(`${why}: a power-up at your feet`);
  }

  upgrade(why) {
    const g = this.g, w = g.weapons, k = w.current;
    if (!w.canUpgrade(k) || w.level(k) >= 3) { this.cash(1500); g.hud.notice(`${why}: 1500 lari`); return; }
    if (g.mode === 'client') g.net.learnReward({ up: k });
    else g.director.bought('upgrade', { w: k });
    g.hud.notice(`${why}: your ${DEFS[k].short}, a level up`);
  }

  stats() { return { ...this.learn.stats(), band: BANDS[this.learn.s.level] }; }

  // "My English": your level, what you know, what's due; find your level again, or start over
  async panel() {
    await this.learn.load();
    let el = document.getElementById('learnpanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'learnpanel';
      el.className = 'screen hidden';
      document.body.appendChild(el);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.a === 'close') el.classList.add('hidden');
        if (b.dataset.a === 'place') { el.classList.add('hidden'); this.placementFromMenu(); }   // (closed early: your level stays as it was)
        if (b.dataset.a === 'reset' && confirm('Forget everything you have learned here and start over?')) { this.learn.reset(); this.panel(); }
      });
    }
    const s = this.stats(), pct = s.answered ? Math.round((s.right / s.answered) * 100) : 0;
    el.innerHTML = `<h2>My English</h2>
      <div class="lstats">
        <div><b>${s.band}</b><span>your English${s.placed ? '' : ' (from your answers so far)'}</span></div>
        <div><b>${this.learn.s.mlevel || 2} of 6</b><span>your maths level</span></div>
        <div><b>${s.known}</b><span>words known, of ${s.total}</span></div>
        <div><b>${s.learned}</b><span>new words learned</span></div>
        <div><b>${s.due}</b><span>due for review</span></div>
        <div><b>${s.best}</b><span>best streak</span></div>
        <div><b>${pct}%</b><span>right, of ${s.answered} answers</span></div>
      </div>
      <p class="lnote">${this.mode === 'off' ? 'Bonus questions are off: switch them on in Settings.' : `On: after ${EVERY[this.mode] === 1 ? 'every wave' : `every ${EVERY[this.mode]} waves`}, a question or two for 300 to 600 lari each if you want them (B, or tap the card; nothing can hurt you while you answer), and question crates round the complex. Three quick right answers running move you up a level.`}</p>
      <div class="lbtns"><button class="btn" data-a="place" type="button">${s.placed ? 'Find my level again' : 'Find my level'}</button>
      <button class="btn ghost" data-a="reset" type="button">Start over</button><button class="btn ghost" data-a="close" type="button">Close</button></div>`;
    el.classList.remove('hidden');
  }

  // (from the menu: the placement test on its own, nothing to pay out)
  async placementFromMenu() {
    await this.learn.load();
    const items = this.learn.placementItems();
    const res = await this.quiz.run(items, {
      title: 'Your English level', placement: true,
      stopIf: (rs) => { const b = rs[rs.length - 1].band; return rs.filter((x) => x.band === b && !x.right).length >= 2; },
    });
    if (res.closed && res.total < 4) return;
    this.learn.place(res.results);
    this.panel();
  }
}
