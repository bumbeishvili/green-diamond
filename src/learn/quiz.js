// The English card: a word, a meaning, a sentence with a gap, or a word you hear; four answers
// (keys 1–4 or a tap). Right: a moment of green and the next one (so if you know it, it's quick).
// Wrong: the right answer, what it means in Georgian, a sentence and its sound, until you go on.
// A round ends with its rewards; the game hands them out (money, ammo, health, a gun...).

const TITLES = { meaning: 'What does it mean?', word: 'Which English word?', gap: 'Which word fits?', listen: 'Which word did you hear?' };

export class Quiz {
  constructor(learn) {
    this.learn = learn;
    this.open = false;
    const el = this.el = document.createElement('div');
    el.id = 'quiz';
    el.className = 'hidden';
    el.innerHTML = `<div class="card">
      <div class="top"><b class="title">English</b><span class="dots"></span><span class="streak"></span><button type="button" class="x" title="Close (Esc)">✕</button></div>
      <div class="kind"></div>
      <div class="prompt"></div>
      <div class="opts"></div>
      <div class="fb"></div>
      <div class="bar"><i></i></div>
      <div class="foot"><span class="gain"></span><button type="button" class="next">Continue <small>Space</small></button></div>
    </div>`;
    document.body.appendChild(el);
    this.$ = (s) => el.querySelector(s);
    this.$('.x').onclick = () => this.finish(true);
    this.$('.next').onclick = () => this.go?.();
    // (tap the word to hear it again; a sentence with a gap stays silent: it would give it away)
    this.$('.prompt').onclick = () => { const it = this.cur; if (it) this.learn.say(it.kind === 'listen' ? it.say : it.kind === 'meaning' ? it.q.w : ''); };
    addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (/^Digit[1-4]$/.test(e.code) && this.pick) { e.preventDefault(); e.stopPropagation(); this.pick(+e.code.slice(5) - 1); }
      else if ((e.code === 'Space' || e.code === 'Enter') && this.go) { e.preventDefault(); this.go(); }
      else if (e.code === 'Escape') { e.preventDefault(); this.finish(true); }
    }, true);
  }

  // A round: resolves with {right, total, results: [{band, right, fresh, learned, secs, word}], gained, closed}
  run(items, { title = 'English', onAnswer = null, placement = false, stopIf = null } = {}) {
    if (!items.length) return Promise.resolve({ right: 0, total: 0, results: [], gained: 0, closed: false });
    this.open = true;
    this.el.classList.remove('hidden');
    this.$('.title').textContent = title;
    this.results = []; this.gained = 0;
    this.placement = placement;
    this.stopIf = stopIf;
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.items = items;
      this.k = 0;
      this.show();
      this.onAnswer = onAnswer;
    });
  }

  show() {
    const it = this.cur = this.items[this.k], L = this.learn;
    this.$('.dots').innerHTML = this.items.map((_, i) => `<i class="${i < this.k ? (this.results[i].right ? 'ok' : 'no') : i === this.k ? 'cur' : ''}"></i>`).join('');
    this.$('.streak').textContent = L.s.streak >= 3 ? `🔥 ${L.s.streak}` : '';
    this.$('.kind').textContent = TITLES[it.kind];
    const p = this.$('.prompt');
    p.className = `prompt ${it.kind}`;
    p.innerHTML = it.kind === 'listen' ? '<span class="play">🔊</span>' : esc(it.prompt).replace('_____', '<u>_____</u>')
      + (it.kind === 'meaning' && it.q.e ? ` <span class="emo">${it.q.e}</span>` : '') + (it.kind === 'meaning' ? ' <span class="play small">🔊</span>' : '');
    this.$('.opts').innerHTML = it.options.map((o, i) => `<button type="button" data-i="${i}"><b>${i + 1}</b>${esc(o)}</button>`).join('');
    for (const b of this.el.querySelectorAll('.opts button')) b.onclick = () => this.pick?.(+b.dataset.i);
    this.$('.fb').innerHTML = '';
    this.$('.fb').className = 'fb';
    this.$('.next').classList.add('hidden');
    this.$('.gain').textContent = this.gained ? `+${this.gained}` : '';
    // (you hear the word when it's shown as a word, and it's the question when you listen)
    if (it.kind === 'listen') L.say(it.say);
    else if (it.kind === 'meaning') L.say(it.q.w);
    const bar = this.$('.bar i');
    bar.style.transition = 'none'; bar.style.width = '100%';
    requestAnimationFrame(() => { bar.style.transition = 'width 10s linear'; bar.style.width = '0%'; });
    this.t0 = performance.now();
    this.go = null;
    this.pick = (i) => this.answer(i);
  }

  answer(i) {
    const it = this.cur, L = this.learn;
    this.pick = null;
    const secs = (performance.now() - this.t0) / 1000;
    const right = it.options[i] === it.answer;
    const r = this.placement ? { fresh: true, learned: false, band: it.q.b } : L.answer(it, right, secs);
    const res = { band: it.q.b, right, fresh: r.fresh, learned: r.learned, secs, word: it.q.w };
    this.results.push(res);
    const gain = this.placement ? 0 : this.onAnswer ? this.onAnswer(res) || 0 : 0;
    this.gained += gain;
    this.$('.gain').textContent = this.gained ? `+${this.gained}` : '';
    for (const b of this.el.querySelectorAll('.opts button')) {
      const o = it.options[+b.dataset.i];
      b.disabled = true;
      if (o === it.answer) b.classList.add('ok');
      else if (+b.dataset.i === i) b.classList.add('no');
    }
    const next = () => { this.k++; if (this.k >= this.items.length || (this.stopIf && this.stopIf(this.results))) this.finish(false); else this.show(); };
    if (right) {
      // quick on: a known word shouldn't slow anyone down
      const fb = this.$('.fb');
      fb.className = 'fb ok';
      fb.innerHTML = `✓${gain ? ` <b>+${gain}</b>` : ''}${r.learned ? ' <i>learned!</i>' : ''}`;
      this.go = next;
      clearTimeout(this.autoT);
      this.autoT = setTimeout(() => { if (this.go === next) next(); }, r.learned ? 1100 : 650);
      return;
    }
    // missed: what it is, what it means, how it's used and how it sounds (the learning bit)
    const q = it.q, fb = this.$('.fb');
    fb.className = 'fb no';
    fb.innerHTML = `<div class="w"><b>${esc(q.w)}</b> <span class="play small">🔊</span> <span class="pos">${POS[q.p] || ''}</span>${L.hints !== false ? ` <span class="ka">${esc(q.ka)}</span>` : ''}${q.e ? ` <span class="emo">${q.e}</span>` : ''}</div>`
      + (q.ex ? `<div class="ex">${esc(q.ex).replace(new RegExp(`\\b(${reEsc(q.w)})\\b`, 'i'), '<b>$1</b>')}</div>` : '');
    fb.querySelector('.play').onclick = () => L.say(q.w);
    L.say(q.w);
    this.$('.next').classList.remove('hidden');
    this.go = next;
  }

  finish(closed) {
    clearTimeout(this.autoT);
    this.open = false;
    this.pick = null; this.go = null;
    this.el.classList.add('hidden');
    try { speechSynthesis.cancel(); } catch { /* no voice */ }
    const results = this.results || [];
    const out = { right: results.filter((x) => x.right).length, total: results.length, results, gained: this.gained || 0, closed };
    const res = this.resolve;
    this.resolve = null;
    res?.(out);
  }
}

const POS = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', prep: 'preposition', pron: 'pronoun', conj: 'conjunction', det: 'determiner', num: 'number', int: 'interjection' };
function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
