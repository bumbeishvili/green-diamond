// English practice: the words (data/words.json), what this player knows (kept in the browser), and
// the questions.
//
// Every word has a box (0: new ... 6: long known) and a time it's due. A new word is asked straight
// away as a test: right and quick, and it's known (it won't come back for weeks); wrong or slow, and
// it's taught (its meaning, a sentence, its sound) and comes back in a few minutes, then later that
// session, then the next day and so on. So someone who knows English flies through, and a learner
// gets plenty of practice on exactly the words they don't know.
//
// The placement test finds your band (1: the most basic words ... 6: advanced) in a minute or two:
// everything below it counts as known.

const KEY = 'gd-learn';
const DUE = [0, 3 * 60, 20 * 60, 12 * 3600, 3 * 86400, 10 * 86400, 30 * 86400];   // box -> seconds until asked again
const QUICK = 5;          // s: answered within this on first sight, a word is known
const now = () => Date.now() / 1000;

export const INTENSITY = { off: 0, light: 1, normal: 2, intense: 3 };

export class Learn {
  constructor() {
    this.words = [];
    this.byWord = new Map();
    this.ready = false;
    this.s = { level: 1, placed: false, w: {}, streak: 0, best: 0, answered: 0, right: 0, learned: 0, milestone: 0, days: {} };
    try { Object.assign(this.s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* no storage */ }
    this.canSpeak = typeof speechSynthesis !== 'undefined';
  }

  async load() {
    if (this.ready) return true;
    try {
      const r = await fetch('data/words.json');
      if (!r.ok) return false;
      this.words = (await r.json()).filter((q) => q && q.w && q.ka);
      this.words.forEach((q, i) => { q.i = i; this.byWord.set(q.w, q); });
      this.ready = this.words.length > 0;
    } catch { this.ready = false; }
    return this.ready;
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* no storage */ } }

  // a word's record: [box, due, right, wrong]
  rec(w) { return this.s.w[w] || null; }
  box(w) { const r = this.rec(w); return r ? r[0] : -1; }
  get known() { let n = 0; for (const r of Object.values(this.s.w)) if (r[0] >= 3) n++; return n + this.words.filter((q) => q.b < this.s.level && !this.s.w[q.w]).length; }
  get due() { const t = now(); let n = 0; for (const r of Object.values(this.s.w)) if (r[0] > 0 && r[0] < 6 && r[1] <= t) n++; return n; }

  // ---- what to ask next: what's due first, then the next new words at your level ----
  pick(n) {
    const t = now(), out = [];
    const due = Object.entries(this.s.w).filter(([w, r]) => r[0] >= 0 && r[0] < 6 && r[1] <= t && this.byWord.has(w)).sort((a, b) => a[1][1] - b[1][1]);
    for (const [w] of due) { if (out.length >= Math.ceil(n * 0.6)) break; out.push(this.byWord.get(w)); }
    // new words: your band, in order of usefulness (and a band up once most of it is known)
    this.advance();
    for (const q of this.words) {
      if (out.length >= n) break;
      if (q.b !== this.s.level || this.s.w[q.w] || out.includes(q)) continue;
      out.push(q);
    }
    for (const [w] of due) { if (out.length >= n) break; const q = this.byWord.get(w); if (!out.includes(q)) out.push(q); }
    return out.map((q) => this.item(q));
  }

  advance() {
    while (this.s.level < 6) {
      const band = this.words.filter((q) => q.b === this.s.level);
      if (!band.length) { this.s.level++; continue; }
      const seen = band.filter((q) => this.s.w[q.w] && this.s.w[q.w][0] >= 2).length;
      if (seen / band.length < 0.8) break;
      this.s.level++;
    }
  }

  // ---- a question about a word (what kind depends on how well you know it) ----
  item(q, kind = null) {
    const b = this.box(q.w), hints = this.hints !== false;
    const kinds = b <= 0 ? (hints ? ['meaning'] : ['gap']) : b === 1 ? (hints ? ['word', 'meaning'] : ['gap']) : this.canSpeak ? ['gap', 'listen', hints ? 'word' : 'gap'] : ['gap', hints ? 'word' : 'gap'];
    kind = kind || kinds[Math.floor(Math.random() * kinds.length)];
    if (kind === 'gap' && !this.gapOk(q)) kind = hints ? 'meaning' : 'listen';
    if (kind === 'listen' && !this.canSpeak) kind = hints ? 'word' : 'gap';
    const others = this.distractors(q, 3);
    const it = { q, kind, fresh: b < 0 };
    if (kind === 'meaning') { it.prompt = q.w; it.options = shuffle([q.ka, ...others.map((o) => o.ka)]); it.answer = q.ka; }
    else if (kind === 'word') { it.prompt = q.ka; it.options = shuffle([q.w, ...others.map((o) => o.w)]); it.answer = q.w; }
    else if (kind === 'gap') { it.prompt = this.blank(q); it.options = shuffle([q.w, ...others.map((o) => o.w)]); it.answer = q.w; }
    else { it.prompt = '🔊'; it.say = q.w; it.options = shuffle([q.w, ...others.map((o) => o.w)]); it.answer = q.w; }
    return it;
  }

  gapOk(q) { return !!q.ex && new RegExp(`\\b${esc(q.w)}\\b`, 'i').test(q.ex); }
  blank(q) { return q.ex.replace(new RegExp(`\\b${esc(q.w)}\\b`, 'i'), '_____'); }

  // wrong answers that could be right: the same part of speech, a similar band, not the same meaning
  distractors(q, n) {
    const pool = this.words.filter((o) => o !== q && o.p === q.p && Math.abs(o.b - q.b) <= 1 && o.ka !== q.ka && o.w !== q.w);
    const src = pool.length >= n ? pool : this.words.filter((o) => o !== q && o.ka !== q.ka);
    const out = new Set();
    for (let k = 0; out.size < n && k < 200; k++) out.add(src[Math.floor(Math.random() * src.length)]);
    return [...out];
  }

  // ---- an answer: what it does to the word (and what it's worth) ----
  answer(it, right, secs) {
    const q = it.q, t = now();
    let r = this.s.w[q.w];
    const fresh = !r;
    let learned = false;
    if (!r) r = this.s.w[q.w] = [0, 0, 0, 0];
    if (right) {
      r[2]++;
      // known on sight: straight to the long boxes; otherwise a box up
      r[0] = fresh && secs <= QUICK ? 4 : Math.min(6, r[0] + 1);
      if (!fresh && r[0] === 3) learned = true;   // (it's stuck: taught, then remembered)
      this.s.streak++;
      this.s.best = Math.max(this.s.best, this.s.streak);
      this.s.right++;
    } else {
      r[3]++;
      r[0] = 1;
      this.s.streak = 0;
    }
    r[1] = t + DUE[r[0]] * (right ? 1 : 1);
    if (learned) this.s.learned++;
    // (no test to sit: three quick right answers running on new words at your level move you up one)
    if (fresh && right && secs <= QUICK && q.b >= this.s.level) {
      this.s.climb = (this.s.climb || 0) + 1;
      if (this.s.climb >= 3 && this.s.level < 6) { this.s.level++; this.s.climb = 0; }
    } else if (!right) this.s.climb = 0;
    this.s.answered++;
    const day = new Date().toISOString().slice(0, 10);
    this.s.days[day] = (this.s.days[day] || 0) + 1;
    this.save();
    return { fresh, learned, band: q.b };
  }

  // ---- placement: a word or two per band, up while you're right ----
  placementItems() {
    const out = [];
    for (let band = 1; band <= 6; band++) {
      const pool = this.words.filter((q) => q.b === band);
      for (let k = 0; k < 3 && pool.length; k++) out.push(this.item(pool.splice(Math.floor(Math.random() * pool.length), 1)[0], this.hints !== false ? 'meaning' : 'gap'));
    }
    return out;
  }

  // the result: the first band where you missed two of three is yours; below it, known
  place(results) {
    let level = 1;
    for (let band = 1; band <= 6; band++) {
      const rs = results.filter((x) => x.band === band);
      if (!rs.length) break;
      if (rs.filter((x) => x.right).length >= 2) level = Math.min(6, band + 1); else break;
    }
    this.s.level = Math.max(1, Math.min(6, level));
    this.s.placed = true;
    this.save();
    return this.s.level;
  }

  // (a new band's words, for the progress page)
  stats() {
    return { level: this.s.level, known: this.known, due: this.due, streak: this.s.streak, best: this.s.best, answered: this.s.answered, right: this.s.right, learned: this.s.learned, total: this.words.length, placed: this.s.placed };
  }

  reset() { this.s = { level: 1, placed: false, w: {}, streak: 0, best: 0, answered: 0, right: 0, learned: 0, milestone: 0, days: {} }; this.save(); }

  say(text) {
    if (!this.canSpeak || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 0.9;
      const v = speechSynthesis.getVoices().find((x) => /^en[-_](US|GB)/i.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch { /* no voice */ }
  }
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
