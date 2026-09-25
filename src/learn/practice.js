// English practice in the game: when you're asked, and what it's worth.
//
// Between waves you get a round (solo: the game waits for you; with friends it goes on around you),
// and word crates turn up round the complex. The first time, a quick placement test finds your level.
// Every right answer pays money (more for a word you're learning than for one you knew on sight, and
// more as the waves get tougher); a round tops up your ammo, a good one adds a grenade, a clean one
// some health; a perfect round, or every tenth right answer in a row, a gun you haven't got (or a
// power-up); every 50 new words, the gun in your hands one level up for free.

import { settings, saveSettings, URLFLAGS } from '../config.js';
import { Learn, INTENSITY } from './learn.js';
import { Quiz } from './quiz.js';
import { DEFS, MAX_GRENADES } from '../game/weapons.js';

const BANDS = ['', 'Beginner', 'Elementary', 'Pre-intermediate', 'Intermediate', 'Upper-intermediate', 'Advanced'];
const EVERY = { light: 3, normal: 1, intense: 1 };            // a round every n waves
const ROUND = { light: 4, normal: 5, intense: 8 };            // questions a round (alone)
const LOOT = ['deagle', 'shotgun', 'm4', 'aug', 'autosniper', 'msr', 'mg', 'bow', 'chainsaw', 'launcher'];

export class Practice {
  constructor(game) {
    this.g = game;
    this.learn = new Learn();
    this.quiz = new Quiz(this.learn);
    // (on from the start, at Light, until you pick something else in the menu; a test run, off unless
    // its URL says, and nothing saved)
    const auto = !!(URLFLAGS.autostart || URLFLAGS.mp);
    if (URLFLAGS.english || auto) this.setMode(URLFLAGS.english || 'off', settings.learnHints !== false, false);
    else this.setMode(settings.english || 'light', settings.learnHints !== false);
  }

  get on() { return INTENSITY[this.mode] > 0 && this.learn.ready; }
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
  }

  // ---- when you're asked ----
  // between waves (solo right away; with friends too, but the next wave won't wait)
  waveEnd(w) {
    if (!this.on || this.open || w % EVERY[this.mode] || this.g.pvp?.on) return;   // (not against other players)
    setTimeout(() => { if (this.g.state === 'playing' && !this.g.player.dead) this.round(this.g.mode === 'solo' ? ROUND[this.mode] : 3, 'wave'); }, 1600);
  }

  // a word crate: one to three questions (with English off, just the cash inside)
  crate() {
    if (!this.on || this.g.pvp?.on) { this.cash(150); this.g.hud.notice('A word crate: 150 lari inside'); return; }
    this.round(2 + (Math.random() < 0.35 ? 1 : 0), 'crate');
  }

  async round(n, why) {
    if (this.open) return;
    if (!this.learn.s.placed) return this.placement();
    const items = this.learn.pick(n);
    if (!items.length) return;
    this.enter();
    const res = await this.quiz.run(items, { title: why === 'crate' ? 'Word crate' : 'English', onAnswer: (r) => this.pay(r) });
    this.leave();
    this.roundDone(res, why);
  }

  // the first time: a word or two a band, up while you're right (stops at the first band you miss twice)
  async placement() {
    const items = this.learn.placementItems();
    if (!items.length) return;
    this.enter();
    const res = await this.quiz.run(items, {
      title: 'Your English level', placement: true,
      stopIf: (rs) => { const b = rs[rs.length - 1].band; return rs.filter((x) => x.band === b && !x.right).length >= 2; },
    });
    this.leave();
    if (res.closed && res.total < 4) return;   // (skipped: it'll ask again next time)
    const level = this.learn.place(res.results);
    this.g.hud.banner(`English: ${BANDS[level]}`, 'New words start there; the ones below count as known');
  }

  // (solo: the world waits; either way you can't shoot while you answer)
  enter() {
    const g = this.g;
    this.busy = true;
    if (g.mode === 'solo' && g.state === 'playing') g.state = 'quiz';
    g.touch?.reset();
    g.input.unlock();
  }

  leave() {
    const g = this.g;
    this.busy = false;
    if (g.state === 'quiz') g.state = 'playing';
    if (g.state !== 'playing' || g.touch) return;
    g.input.lock();
    // (a browser that wants a click before it gives the mouse back: "click to play")
    if (!URLFLAGS.nolock && !URLFLAGS.autostart) setTimeout(() => { if (g.state === 'playing' && !g.input.locked && !this.open) document.getElementById('clicktoplay').classList.remove('hidden'); }, 400);
  }

  // ---- what it's worth ----
  // an answer: money (and the quiz shows it)
  pay(r) {
    if (!r.right) return 0;
    const tough = this.g.director ? this.g.director.toughness() : 1;
    let pts = r.fresh ? 10 + 5 * r.band : 20 + 10 * r.band;
    if (r.learned) pts += 40 + 20 * r.band;
    pts = Math.round((pts * tough) / 5) * 5;
    this.cash(pts);
    if (this.learn.s.streak > 0 && this.learn.s.streak % 10 === 0) this.bonus(`${this.learn.s.streak} right in a row`);
    return pts;
  }

  roundDone(res, why) {
    const g = this.g, w = g.weapons, got = [];
    if (!res.total) return;
    if (res.right >= 1) { w.topUp(); got.push('ammo'); }
    if (res.right * 3 >= res.total * 2 && w.grenades < MAX_GRENADES) { w.grenades++; g.hud.grenades(w.grenades); got.push('a grenade'); }
    if (res.right === res.total && res.total >= 3 && g.player.health < g.player.maxHealth - 1) { this.heal(40); got.push('health'); }
    if (res.right === res.total && res.total >= 4) this.bonus('a perfect round');
    // every 50 new words: the gun in your hands, a level up
    const m = Math.floor(this.learn.s.learned / 50);
    if (m > (this.learn.s.milestone || 0)) {
      this.learn.s.milestone = m; this.learn.save();
      this.upgrade(`${m * 50} new words`);
    }
    if (res.gained || got.length) g.hud.banner(`English ${res.right}/${res.total}`, [res.gained ? `+${res.gained} lari` : '', ...got].filter(Boolean).join(' · '));
  }

  // money (a co-op client asks the host, which keeps everyone's points)
  cash(n) {
    const g = this.g;
    if (g.mode === 'client') g.net.learnReward({ p: n });
    else g.director.addPoints(n, true);
  }

  heal(n) {
    const g = this.g, p = g.player;
    if (g.mode === 'client') g.net.learnReward({ h: n });
    else p.health = Math.min(p.maxHealth, p.health + n);
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
        <div><b>${s.placed ? s.band : '—'}</b><span>your level${s.placed ? '' : ' (not tested yet)'}</span></div>
        <div><b>${s.known}</b><span>words known, of ${s.total}</span></div>
        <div><b>${s.learned}</b><span>new words learned</span></div>
        <div><b>${s.due}</b><span>due for review</span></div>
        <div><b>${s.best}</b><span>best streak</span></div>
        <div><b>${pct}%</b><span>right, of ${s.answered} answers</span></div>
      </div>
      <p class="lnote">${this.mode === 'off' ? 'English practice is off: switch it on in Settings (Light, Normal or Intense).' : `Practice is on (${this.mode}): a round after ${EVERY[this.mode] === 1 ? 'every wave' : `every ${EVERY[this.mode]} waves`}, and word crates round the complex.`}</p>
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
