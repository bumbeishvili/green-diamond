// Mental arithmetic for the bonus questions, six levels: sums; times tables; bigger products and
// division; percentages and fractions of a number; the order of operations and squares; percentage
// changes, negatives and averages. Four answers each: the right one and slips people really make.

const R = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2))).replace('-', '−');

// each: [prompt, answer, how it's worked out, likely slips]
const LEVELS = {
  1: [
    () => { const a = R(14, 79), b = R(12, 69); return [`${a} + ${b}`, a + b, `${a} + ${b} = ${a + b}`, [a + b + 10, a + b - 10, a + b + 1]]; },
    () => { const a = R(41, 98), b = R(12, a - 9); return [`${a} − ${b}`, a - b, `${a} − ${b} = ${a - b}`, [a - b + 10, a - b - 10, a - b + 1]]; },
  ],
  2: [
    () => { const a = R(4, 12), b = R(4, 12); return [`${a} × ${b}`, a * b, `${a} × ${b} = ${a * b}`, [a * b + a, a * b - b, (a + 1) * b]]; },
    () => { const a = R(120, 480), b = R(35, 99); return [`${a} + ${b}`, a + b, `${a} + ${b} = ${a + b}`, [a + b + 10, a + b - 10, a + b + 100]]; },
  ],
  3: [
    () => { const a = R(13, 49), b = R(3, 9); return [`${a} × ${b}`, a * b, `${a} × ${b} = ${Math.floor(a / 10) * 10} × ${b} + ${a % 10} × ${b} = ${a * b}`, [a * b + b, a * b - 10, a * b + 10]]; },
    () => { const b = R(3, 12), q = R(6, 19); return [`${b * q} ÷ ${b}`, q, `${b} × ${q} = ${b * q}, so ${b * q} ÷ ${b} = ${q}`, [q + 1, q - 1, q + 2]]; },
  ],
  4: [
    () => { const p = pick([10, 15, 20, 25, 30, 40, 50, 75]), n = R(2, 16) * 20; const v = (p * n) / 100; return [`${p}% of ${n}`, v, `${n} × ${p} ÷ 100 = ${fmt(v)}`, [v * 2, v / 2, v + 10]]; },
    () => { const d = pick([3, 4, 5, 8]), k = R(1, d - 1), n = d * R(4, 15); const v = (n / d) * k; return [`${k}/${d} of ${n}`, v, `${n} ÷ ${d} = ${n / d}, × ${k} = ${fmt(v)}`, [n / d, v + n / d, v - k]]; },
  ],
  5: [
    () => { const a = R(3, 19), b = R(3, 9), c = R(3, 9); return [`${a} + ${b} × ${c}`, a + b * c, `× before +: ${b} × ${c} = ${b * c}, + ${a} = ${a + b * c}`, [(a + b) * c, a * b + c, a + b * c + 1]]; },
    () => { const a = R(11, 19); return [`${a}²`, a * a, `${a} × ${a} = ${a * a}`, [a * 2, a * a + a, a * a - 10]]; },
    () => { const a = R(20, 60), b = R(3, 9), c = R(2, 6); return [`${a} − ${b} × ${c}`, a - b * c, `× before −: ${b} × ${c} = ${b * c}; ${a} − ${b * c} = ${a - b * c}`, [(a - b) * c, a - b - c, a - b * c + 2]]; },
  ],
  6: [
    () => { const n = R(4, 16) * 20, p = pick([5, 10, 15, 20, 25]); const v = n + (n * p) / 100; return [`${n} + ${p}%`, v, `${p}% of ${n} = ${(n * p) / 100}; ${n} + ${(n * p) / 100} = ${fmt(v)}`, [n + p, v + 10, n * (1 + p / 10)]]; },
    () => { const n = R(4, 12) * 40; const v = n / 8; return [`12.5% of ${n}`, v, `12.5% is an eighth: ${n} ÷ 8 = ${fmt(v)}`, [v * 2, n / 12.5, v + 5]]; },
    () => { const a = R(3, 12), b = R(3, 12); return [`−${a} × ${b}`, -a * b, `minus × plus is minus: −${a * b}`, [a * b, -a * b - a, -(a + b)]]; },
    () => { const x = R(8, 30), d = R(2, 9); const xs = [x - d, x, x + d + (d % 2 ? 0 : 0)]; const avg = (xs[0] + xs[1] + xs[2]) / 3; return [`the average of ${xs.join(', ')}`, avg, `(${xs.join(' + ')}) ÷ 3 = ${fmt(avg)}`, [avg + 1, xs[0] + xs[2], avg * 3]]; },
  ],
};

// A question at a level (1-6): {kind: 'math', prompt, options, answer, explain, q: {w, b}}
export function mathItem(level = 2) {
  const lv = Math.max(1, Math.min(6, Math.round(level)));
  const [prompt, ans, explain, slips] = pick(LEVELS[lv])();
  const right = fmt(ans), seen = new Set([right]), wrong = [];
  for (const v of [...shuffle(slips.slice()), ans + 1, ans - 1, ans + 2, ans + 10, ans - 2]) {
    const s = fmt(v);
    if (wrong.length < 3 && !seen.has(s) && Number.isFinite(v) && (v >= 0 || ans < 0)) { seen.add(s); wrong.push(s); }
  }
  return { kind: 'math', prompt: `${prompt} = ?`, options: shuffle([right, ...wrong]), answer: right, explain, q: { w: prompt, b: lv } };
}
