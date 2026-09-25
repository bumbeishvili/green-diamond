// Small helpers the puzzles share.

export const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));   // an integer in [a, b]
export const pick = (a) => a[Math.floor(Math.random() * a.length)];
export function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// an element: el('div', 'cls', parent, 'html')
export function el(tag, cls = '', parent = null, html = null) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

// SVG: svg('circle', {cx, cy, r}, parent)
const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// a puzzle's own styles, added to the page the first time it's shown
const styled = new Set();
export function style(id, css) {
  if (styled.has(id)) return;
  styled.add(id);
  el('style', '', document.head, css).dataset.drill = id;
}

// a score from how many were right, with a little off for slowness where speed is the point:
// `secs` the time taken on each, `fast`/`slow` the times that count as full marks / half marks
export function speedScore(right, total, secs = [], fast = 0.6, slow = 1.6) {
  if (!total) return 0;
  const acc = right / total;
  if (!secs.length) return acc;
  const mean = secs.reduce((a, b) => a + b, 0) / secs.length;
  const k = mean <= fast ? 1 : mean >= slow ? 0.5 : 1 - 0.5 * (mean - fast) / (slow - fast);
  return acc * k;
}
