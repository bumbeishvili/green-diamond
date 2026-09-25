// Brain training in the game: a puzzle for lari between waves, an offer, never a test you have to sit.
//
// After a wave (every third on Light) a small card offers a puzzle: press B, or tap it (alone, the
// game waits for you; with friends it goes on around you, but nothing can hurt you while you're at
// it); leave it and it goes. A puzzle between waves is one question (a sum, a matrix, a square of a
// sudoku...); a puzzle crate's is two. Fourteen kinds, dealt in a shuffled round so they all come up
// before any comes again. Each has a level of its own, 1 to 10: a good round moves it up, a poor one
// down. A question pays up to 300 lari (600 later in the match) by how it went; five good rounds
// running, a gun you haven't got (or a power-up); every fifteen good rounds, the gun in your hands a
// level up.

import { settings, saveSettings, URLFLAGS } from '../config.js';
import { Card } from './card.js';
import { shuffle, esc } from './util.js';
import { DEFS } from '../game/weapons.js';

// every puzzle: its module is drills/<id>.js, loaded the first time it's played
export const DRILLS = [
  { id: 'nback', name: 'Dual n-back', skill: 'Working memory' },
  { id: 'span', name: 'Digit span', skill: 'Working memory' },
  { id: 'ufov', name: 'Useful field of view', skill: 'Processing speed' },
  { id: 'stroop', name: 'Stroop', skill: 'Inhibition' },
  { id: 'switch', name: 'Task switching', skill: 'Flexibility' },
  { id: 'arith', name: 'Mental arithmetic', skill: 'Calculation' },
  { id: 'route', name: 'Memory palace', skill: 'Memory' },
  { id: 'matrix', name: 'Matrix reasoning', skill: 'Reasoning' },
  { id: 'sudoku', name: 'Mini sudoku', skill: 'Logic' },
  { id: 'cross', name: 'Mini crossword', skill: 'Vocabulary' },
  { id: 'rotate', name: 'Mental rotation', skill: 'Spatial' },
  { id: 'search', name: 'Visual search', skill: 'Attention' },
  { id: 'react', name: 'Reaction time', skill: 'Speed' },
  { id: 'chess', name: 'Chess tactics', skill: 'Calculation' },
];
const BY_ID = new Map(DRILLS.map((d) => [d.id, d]));
export const MODES = { off: 0, light: 3, normal: 1 };   // an offer every n waves (0: never)
const OFFER_S = 10;                                                  // how long the offer stays up
const LOOT = ['deagle', 'shotgun', 'm4', 'aug', 'autosniper', 'msr', 'mg', 'bow', 'chainsaw', 'launcher'];
const KEY = 'gd-train';

export class Training {
  constructor(game) {
    this.g = game;
    this.card = new Card(game);
    this.busy = false;
    this.s = { levels: {}, best: {}, plays: {}, rounds: 0, good: 0, streak: 0, milestone: 0, deck: [] };
    try { Object.assign(this.s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* no storage */ }
    // (on from the start, at Light, until you pick something else in Settings; a test run, off unless
    // its URL says, and nothing saved)
    const auto = !!(URLFLAGS.autostart || URLFLAGS.mp);
    if (URLFLAGS.training || auto) this.setMode(URLFLAGS.training || 'off', false);
    else this.setMode(settings.training || settings.english || 'light');
  }

  get on() { return MODES[this.mode] > 0; }
  get open() { return this.card.open || this.busy; }

  setMode(mode, save = true) {
    if (mode === 'intense') mode = 'normal';   // (the old "two at a time": between waves it's one question now)
    this.mode = MODES[mode] != null ? mode : 'off';
    if (save) { settings.training = this.mode; delete settings.english; delete settings.learnHints; delete settings.subjects; saveSettings(); }
    if (!this.on) this.hideOffer();
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* no storage */ } }
  levelOf(id) { return this.s.levels[id] || 1; }

  // the next puzzle: the next in a shuffled round of them all (not the one just played)
  next() {
    const d = this.s.deck.filter((id) => BY_ID.has(id));
    if (!d.length) {
      const fresh = shuffle(DRILLS.map((x) => x.id));
      if (fresh[0] === this.s.last && fresh.length > 1) fresh.push(fresh.shift());
      d.push(...fresh);
    }
    const id = d.shift();
    this.s.deck = d; this.s.last = id;
    this.save();
    return id;
  }

  // ---- the offer between waves: take it or leave it ----
  waveEnd(w) {
    if (!this.on || this.open || w % MODES[this.mode] || this.g.pvp?.on) return;   // (not against other players)
    setTimeout(() => this.offer(), 1400);
  }

  // what a perfect round pays now: 300 lari, more as the waves go on, 600 at most
  worth() {
    const wave = Math.max(1, this.g.director?.wave || 1);
    return Math.min(600, Math.round((300 + 25 * (wave - 1)) / 10) * 10);
  }

  offer() {
    const g = this.g;
    if (!this.on || this.open || g.state !== 'playing' || g.player.dead) return;
    const el = this.offerEl || this.makeOffer();
    el.querySelector('span').innerHTML = `a question for up to <em>+${this.worth()}</em> lari`;
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
    el.innerHTML = `<b>Brain training</b><span></span><kbd>${this.g.touch ? 'tap' : 'B'}</kbd><i></i>`;
    document.body.appendChild(el);
    const take = (e) => { e.preventDefault(); e.stopPropagation(); this.take(); };
    el.addEventListener('click', take);
    el.addEventListener('touchstart', take, { passive: false });
    addEventListener('keydown', (e) => { if (e.code === 'KeyB' && !el.classList.contains('hidden') && this.g.state === 'playing') this.take(); });
    return el;
  }

  hideOffer() { clearTimeout(this.offerT); this.offerEl?.classList.add('hidden'); }
  take() { this.hideOffer(); this.play('Brain training', 1); }

  // a puzzle crate: one puzzle (with the training off, just the cash inside)
  crate() {
    if (!this.on || this.g.pvp?.on) { this.cash(150); this.g.hud.notice('A puzzle crate: 150 lari inside'); return; }
    this.play('Puzzle crate', 1, null, 2);
  }

  // n puzzles of `items` questions each (or one of your choosing, for practice: nothing paid, nothing
  // in the game changes)
  async play(title, n = 1, only = null, items = 1) {
    if (this.open) return;
    const practice = !!only;
    this.busy = true;
    if (!practice) this.enter();
    let gained = 0;
    try {
      for (let k = 0; k < n; k++) {
        const id = only || this.next(), meta = BY_ID.get(id), level = this.levelOf(id);
        const res = await this.card.play(meta, level, { index: k, count: n, items });
        if (!res) break;
        const next = this.record(id, res.score);
        const gain = practice ? 0 : this.pay(res.score, items);
        gained += gain;
        if (!await this.card.result({ score: res.score, gain, level, next, practice, last: k === n - 1 })) break;
      }
    } finally {
      this.card.close();
      this.busy = false;
      if (!practice) this.leave();
    }
    if (gained) this.g.hud.notice(`Brain training: +${gained} lari`);
    // every fifteen good rounds: the gun in your hands, a level up
    const m = Math.floor(this.s.good / 15);
    if (!practice && m > (this.s.milestone || 0)) { this.s.milestone = m; this.save(); this.upgrade(`${m * 15} good rounds`); }
  }

  // (tests; and the game's own clean-up when you go down)
  close() { this.card.close(); }

  // (testing a puzzle: ?drill=<id>&drilllevel=n plays it as soon as the game starts)
  test(id, level = null, items = 2) { if (level) this.s.levels[id] = Math.max(1, Math.min(10, level)); return this.play('Test', 1, id, items); }

  // how a round went: the level up or down, the best, the streak; returns the level for next time
  record(id, score) {
    const s = this.s, lv = this.levelOf(id);
    const next = score >= 0.8 ? Math.min(10, lv + 1) : score < 0.5 ? Math.max(1, lv - 1) : lv;
    s.levels[id] = next;
    s.best[id] = Math.max(s.best[id] || 0, Math.round(score * 100));
    s.plays[id] = (s.plays[id] || 0) + 1;
    s.rounds++;
    if (score >= 0.6) s.good++;
    s.streak = score >= 0.8 ? s.streak + 1 : 0;
    this.save();
    return next;
  }

  // (solo: the world waits; either way you can't shoot while you're at it, and nothing can hurt you)
  enter() {
    const g = this.g;
    g.player.answering = true;
    if (g.mode === 'client') { g.net?.answering?.(true); this.ansT = setInterval(() => g.net?.answering?.(true), 60000); }
    if (g.mode === 'solo' && g.state === 'playing') g.state = 'quiz';
    g.touch?.reset();
    g.input.unlock();
  }

  leave() {
    const g = this.g;
    clearInterval(this.ansT);
    g.player.answering = false;
    if (g.mode === 'client') g.net?.answering?.(false);
    if (g.state === 'quiz') g.state = 'playing';
    if (g.state !== 'playing' || g.touch) return;
    g.input.lock();
    // (a browser that wants a click before it gives the mouse back: "click to play")
    if (!URLFLAGS.nolock && !URLFLAGS.autostart) setTimeout(() => { if (g.state === 'playing' && !g.input.locked && !this.open) document.getElementById('clicktoplay').classList.remove('hidden'); }, 400);
  }

  // ---- what it's worth ----
  // (each question: up to what a question's worth now)
  pay(score, items = 1) {
    const pts = Math.round((this.worth() * score * items) / 10) * 10;
    if (pts > 0) this.cash(pts);
    if (score >= 0.8 && this.s.streak > 0 && this.s.streak % 5 === 0) this.bonus(`${this.s.streak} good rounds running`);
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

  // ---- "My training": every puzzle's level and best, a round of any of them for practice ----
  panel() {
    let el = document.getElementById('trainpanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'trainpanel';
      el.className = 'screen hidden';
      document.body.appendChild(el);
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.a === 'close') el.classList.add('hidden');
        if (b.dataset.a === 'reset' && confirm('Start every puzzle again from level 1?')) {
          Object.assign(this.s, { levels: {}, best: {}, plays: {}, rounds: 0, good: 0, streak: 0, milestone: 0 }); this.save(); this.panel();
        }
        if (b.dataset.play) { el.classList.add('hidden'); await this.play('Practice', 1, b.dataset.play, 2); this.panel(); }
      });
    }
    const s = this.s;
    const tiles = DRILLS.map((d) => {
      const lv = this.levelOf(d.id), best = s.best[d.id];
      return `<button type="button" class="tile" data-play="${d.id}"><b>${esc(d.name)}</b><span class="sk">${esc(d.skill)}</span>`
        + `<span class="lvbar"><i style="width:${lv * 10}%"></i></span><span class="nums">Level ${lv}${best != null ? ` · best ${best}%` : ''}</span></button>`;
    }).join('');
    const every = MODES[this.mode];
    el.innerHTML = `<h2>My training</h2>
      <p class="lnote">${!every ? 'The puzzles between waves are off: switch them on in Settings.' : `On: after ${every === 1 ? 'every wave' : `every ${every} waves`}, a puzzle for lari if you want it (B, or tap the card; nothing can hurt you while you're at it), and puzzle crates round the complex.`} Tap one to practise it.</p>
      <div class="tiles">${tiles}</div>
      <p class="lnote small">${s.rounds} round${s.rounds === 1 ? '' : 's'} played</p>
      <div class="lbtns"><button class="btn ghost" data-a="reset" type="button">Start over</button><button class="btn" data-a="close" type="button">Close</button></div>`;
    el.classList.remove('hidden');
  }
}
