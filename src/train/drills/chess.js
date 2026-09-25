// Chess tactics: real positions from real games (the Lichess puzzle database) where one side can force
// checkmate. The other side's move is shown first; then find the mate. Seeing the move that ends it,
// and the replies to it, is calculation. Harder levels: higher rated puzzles, then mates in two.

import { Chess } from '../../../vendor/chess.js/chess.js';
import { el, pick, style, svg } from '../util.js';

const FILES = 'abcdefgh';
const NAME = { w: 'White', b: 'Black' };
const recent = [];   // (the puzzles played lately, not to come round again soon)
const uci = (s) => ({ from: s.slice(0, 2), to: s.slice(2, 4), promotion: s[4] });
const src = (color, type) => `assets/chess/${color}${type}.svg`;

// One puzzle: resolves {ok, slow}, or null if the card was closed.
async function puzzle(ctx, pz, secs, count) {
  const chess = new Chess(pz.f), line = pz.m.split(' ');
  const me = chess.turn() === 'w' ? 'b' : 'w', flip = me === 'b';
  ctx.stage.innerHTML = '';
  ctx.el('div', 't-score', null, count);
  const game = ctx.el('div', 'game');
  const board = el('div', 'board', game), side = el('div', 'side', game);
  const who = el('div', 'who', side), msg = el('div', 'msg', side);
  const kb = ctx.touch ? null : el('div', 'kb', side, 'Keys: type the squares, like e2 e4');
  el('div', 'credit', side, 'Puzzles: Lichess (CC0)');

  // the board, the player's side at the bottom; squares by name
  const at = (s) => { const f = s.charCodeAt(0) - 97, r = +s[1] - 1; return flip ? [7 - f, r] : [f, 7 - r]; };
  const sqAt = (c, r) => (flip ? FILES[7 - c] + (r + 1) : FILES[c] + (8 - r));
  const cells = new Map();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const s = sqAt(c, r), d = el('div', `sq ${(s.charCodeAt(0) - 97 + +s[1] - 1) % 2 ? 'l' : 'd'}`, board);
      if (c === 0) el('span', 'cr', d, s[1]);
      if (r === 7) el('span', 'cf', d, s[0]);
      cells.set(s, d);
    }
  }
  const layer = el('div', 'pcs', board), over = svg('svg', { viewBox: '0 0 8 8', class: 'arrows' }, board);
  let pcs = new Map();
  const put = (img, s) => { const [c, r] = at(s); img.style.transform = `translate(${c * 100}%, ${r * 100}%)`; };
  const draw = () => {
    layer.innerHTML = '';
    pcs = new Map();
    for (const row of chess.board()) {
      for (const p of row) {
        if (!p) continue;
        const img = el('img', '', layer);
        img.src = src(p.color, p.type); img.alt = ''; img.draggable = false;
        put(img, p.square);
        pcs.set(p.square, img);
      }
    }
  };
  const mark = (cls, list = []) => { for (const d of cells.values()) d.classList.toggle(cls, false); for (const s of list) cells.get(s)?.classList.add(cls); };
  const check = () => mark('chk', chess.inCheck() ? chess.findPiece({ type: 'k', color: chess.turn() }) : []);
  const arrow = (m) => {
    over.innerHTML = '';
    if (!m) return;
    const [c0, r0] = at(m.from), [c1, r1] = at(m.to), dx = c1 - c0, dy = r1 - r0, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const x1 = c1 + 0.5, y1 = r1 + 0.5, hx = x1 - ux * 0.45, hy = y1 - uy * 0.45;
    svg('line', { x1: c0 + 0.5 + ux * 0.2, y1: r0 + 0.5 + uy * 0.2, x2: hx, y2: hy }, over);
    svg('polygon', { points: `${x1},${y1} ${hx - uy * 0.3},${hy + ux * 0.3} ${hx + uy * 0.3},${hy - ux * 0.3}` }, over);
  };
  const say = (who0, html, cls = '') => {
    if (who0 != null) { who.innerHTML = who0; }
    msg.innerHTML = html; msg.className = `msg ${cls}`;
  };
  const turnLine = (color, left) => `<img src="${src(color, 'k')}" alt="">`
    + (left ? `<span>${NAME[color]} to move: <em>mate in ${left}</em></span>` : `<span class="wait">${NAME[color]} to move</span>`);

  // a move played and shown: the piece slides (and whatever it takes goes), the squares light up
  const play = async (m) => {
    const mv = chess.move(typeof m === 'string' ? uci(m) : m);
    const img = pcs.get(mv.from), capSq = mv.isEnPassant() ? mv.to[0] + mv.from[1] : mv.to, victim = pcs.get(capSq);
    pcs.delete(mv.from);
    if (victim) pcs.delete(capSq);
    if (img) { img.classList.remove('drag'); put(img, mv.to); pcs.set(mv.to, img); }
    if (mv.isKingsideCastle() || mv.isQueensideCastle()) {
      const r = mv.from[1], [a, b] = mv.isKingsideCastle() ? [`h${r}`, `f${r}`] : [`a${r}`, `d${r}`], rook = pcs.get(a);
      if (rook) { pcs.delete(a); pcs.set(b, rook); put(rook, b); }
    }
    mark('last', [mv.from, mv.to]);
    check();
    victim?.classList.add('gone');
    await ctx.sleep(240);
    victim?.remove();
    if (mv.promotion && img) img.src = src(mv.color, mv.promotion);
    return mv;
  };

  // picking a piece up and putting it down: a click or tap on it then on where it goes, a drag, or
  // its square typed then where it goes; all end in tryMove
  let sel = null, targets = [], drag = null, wanted = null, goal = null, typed = '';
  const select = (s) => {
    sel = s; targets = s ? chess.moves({ square: s, verbose: true }) : [];
    mark('sel', s ? [s] : []);
    mark('to', targets.map((m) => m.to));
    mark('cap', targets.filter((m) => m.captured).map((m) => m.to));
  };
  const mine = (s) => { const p = s && chess.get(s); return !!p && p.color === me; };
  const tryMove = (from, to) => {
    if (!wanted || !from || !to || !targets.length || sel !== from) return false;
    const m = targets.find((q) => q.to === to);
    if (!m) return false;
    // (a pawn that gets to the end: what the solution makes it, or a queen)
    const promotion = m.promotion ? (goal && goal.slice(0, 4) === from + to && goal[4]) || 'q' : undefined;
    const done = wanted;
    wanted = null;
    select(null);
    done({ from, to, promotion });
    return true;
  };
  const tap = (s) => {
    if (!wanted || !s) return;
    if (sel && sel !== s && tryMove(sel, s)) return;
    select(mine(s) && s !== sel ? s : null);
  };
  const sqOf = (e) => {
    const b = board.getBoundingClientRect(), c = Math.floor((e.clientX - b.left) / b.width * 8), r = Math.floor((e.clientY - b.top) / b.height * 8);
    return c >= 0 && c < 8 && r >= 0 && r < 8 ? sqAt(c, r) : null;
  };
  board.onpointerdown = (e) => {
    if (!wanted || e.button > 0) return;
    e.preventDefault();
    const s = sqOf(e);
    if (sel && s !== sel && targets.some((m) => m.to === s)) { tryMove(sel, s); return; }
    if (!mine(s)) { select(null); return; }
    const was = sel === s;
    select(s);
    drag = { from: s, img: pcs.get(s), x: e.clientX, y: e.clientY, moved: false, was };
    try { board.setPointerCapture(e.pointerId); } catch { /* (a synthetic event) */ }
  };
  board.onpointermove = (e) => {
    if (!drag || !drag.img || (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6)) return;
    drag.moved = true;
    const b = board.getBoundingClientRect(), q = b.width / 8;
    drag.img.classList.add('drag');
    drag.img.style.transform = `translate(${e.clientX - b.left - q / 2}px, ${e.clientY - b.top - q / 2}px)`;
  };
  board.onpointerup = (e) => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.moved) { if (d.was) select(null); return; }   // (a second click on a piece puts it down)
    if (tryMove(d.from, sqOf(e))) return;
    d.img?.classList.remove('drag');
    if (d.img) put(d.img, d.from);   // (back where it was)
  };
  board.onpointercancel = () => { if (drag?.img) { drag.img.classList.remove('drag'); put(drag.img, drag.from); } drag = null; };
  const showTyped = () => { if (kb) kb.innerHTML = typed ? `Keys: <b>${typed}_</b>` : 'Keys: type the squares, like e2 e4'; };
  ctx.key((code) => {
    let m = /^Key([A-H])$/.exec(code);
    if (m) { typed = m[1].toLowerCase(); showTyped(); return true; }
    m = /^(?:Digit|Numpad)([1-8])$/.exec(code);
    if (m && typed) { const s = typed + m[1]; typed = ''; showTyped(); tap(s); return true; }
    if (code === 'Backspace' || code === 'Delete') { typed = ''; showTyped(); select(null); return true; }
    return false;
  });

  // (the test hook: a wrong move is a legal one that isn't the answer and doesn't mate)
  const miss = (want) => {
    const all = chess.moves({ verbose: true }).filter((m) => m.lan !== want && (!m.promotion || m.promotion === 'q'));
    const quiet = all.filter((m) => { chess.move(m); const mate = chess.isCheckmate(); chess.undo(); return !mate; });
    return pick(quiet.length ? quiet : all);
  };
  const yours = (want, clock) => new Promise((resolve) => {
    goal = want;
    wanted = resolve;
    ctx.expect((good) => { const m = good ? uci(want) : miss(want); if (m) { select(null); tap(m.from); tap(m.to); } });
    clock.done.then(() => { if (wanted === resolve) { wanted = null; select(null); resolve(null); } });
  });
  // the answer, when it wasn't found: an arrow and its squares, for a moment
  const show = async (want, why) => {
    const m = chess.move(uci(want)), san = m.san;
    chess.undo();
    arrow(m);
    mark('good', [m.from, m.to]);
    say(null, `${why} It was <b>${san}</b>`, 'no');
    await ctx.sleep(1700);
  };

  // the position; the other side's move; then yours
  draw();
  say(turnLine(chess.turn(), 0), '');
  await ctx.sleep(650);
  if (ctx.aborted) return null;
  await play(line[0]);
  const steps = line.length === 4 ? [1, 3] : [1];
  const clock = ctx.clock(secs), t0 = performance.now();
  let ok = false;
  for (let i = 0; i < steps.length && !ctx.aborted; i++) {
    const want = line[steps[i]];
    say(turnLine(me, steps.length - i), i ? 'Now finish it.' : 'Find the mate.');
    const mv = await yours(want, clock);
    ctx.expect(null);
    if (ctx.aborted) return null;
    if (!mv) { await show(want, 'Time\'s up.'); break; }
    const done = await play(mv);
    if (chess.isCheckmate()) { ok = true; break; }
    if (i < steps.length - 1 && done.lan === want) {
      // (the right first move of two: their reply, then the mate)
      say(turnLine(chess.turn(), 0), 'Good move.', 'ok');
      await ctx.sleep(550);
      if (ctx.aborted) return null;
      await play(line[steps[i] + 1]);
      continue;
    }
    // a wrong move: in red, taken back, and the right one shown
    ctx.flash(false);
    mark('bad', [done.from, done.to]);
    say(null, 'Not mate.', 'no');
    await ctx.sleep(700);
    if (ctx.aborted) return null;
    chess.undo();
    draw();
    mark('bad');
    mark('last');
    check();
    await show(want, 'Not mate.');
    break;
  }
  ctx.key(null);
  if (ctx.aborted) return null;
  if (ok) {
    ctx.flash(true);
    say(null, 'Checkmate!', 'ok');
    await ctx.sleep(1100);
  }
  return { ok, slow: performance.now() - t0 > secs * 500 };
}

export default {
  how: 'A position from a real game. Watch the other side\'s move, then find the <b>checkmate</b>: click or tap a piece, then where it goes (or drag it).',

  async run(ctx) {
    style('chess', `
      #train .d-chess .game { display: flex; gap: 24px; align-items: center; justify-content: center; width: 100%; }
      #train .d-chess .board { position: relative; width: 312px; height: 312px; flex: none; display: grid; grid-template: repeat(8, 1fr) / repeat(8, 1fr);
        border-radius: 4px; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; cursor: pointer;
        box-shadow: 0 0 0 1px #2c3036, 0 8px 26px rgba(0,0,0,.4); }
      #train .d-chess .sq { position: relative; }
      #train .d-chess .sq.l { background: #d9d2c5; }
      #train .d-chess .sq.d { background: #8b7a63; }
      #train .d-chess .sq::before { content: ''; position: absolute; inset: 0; }
      #train .d-chess .sq.last::before { background: rgba(255, 214, 80, .42); }
      #train .d-chess .sq.sel::before { background: rgba(185, 140, 255, .62); }
      #train .d-chess .sq.good::before { background: rgba(95, 211, 95, .55); }
      #train .d-chess .sq.bad::before { background: rgba(255, 90, 74, .65); }
      #train .d-chess .sq.chk::before { background: radial-gradient(circle, rgba(255, 40, 30, .95) 0%, rgba(255, 40, 30, .55) 38%, rgba(255, 40, 30, 0) 72%); }
      #train .d-chess .sq.to::after { content: ''; position: absolute; left: 35%; top: 35%; width: 30%; height: 30%; border-radius: 50%; background: rgba(34, 24, 52, .42); z-index: 3; }
      #train .d-chess .sq.to.cap::after { left: 3%; top: 3%; width: 94%; height: 94%; background: none; box-sizing: border-box; border: 4px solid rgba(34, 24, 52, .45); }
      #train .d-chess .cr, #train .d-chess .cf { position: absolute; font: 700 10px var(--body); line-height: 1; z-index: 1; pointer-events: none; }
      #train .d-chess .cr { left: 2px; top: 2px; }
      #train .d-chess .cf { right: 2px; bottom: 2px; }
      #train .d-chess .sq.l span { color: #8b7a63; }
      #train .d-chess .sq.d span { color: #e6e0d4; }
      #train .d-chess .pcs { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
      #train .d-chess .pcs img { position: absolute; left: 0; top: 0; width: 12.5%; height: 12.5%; transition: transform .22s ease-out, opacity .2s; }
      #train .d-chess .pcs img.drag { transition: none; z-index: 5; filter: drop-shadow(0 5px 6px rgba(0,0,0,.45)); }
      #train .d-chess .pcs img.gone { opacity: 0; }
      #train .d-chess .arrows { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 4; pointer-events: none; }
      #train .d-chess .arrows line { stroke: #4fcf4f; stroke-width: .17; stroke-linecap: round; opacity: .92; }
      #train .d-chess .arrows polygon { fill: #4fcf4f; opacity: .92; }
      #train .d-chess .side { width: 236px; display: flex; flex-direction: column; gap: 12px; }
      #train .d-chess .who { display: flex; align-items: center; gap: 10px; font: 700 19px var(--body); line-height: 1.3; min-height: 36px; }
      #train .d-chess .who img { width: 34px; height: 34px; flex: none; background: #d9d2c5; border-radius: 7px; padding: 2px; }
      #train .d-chess .who em { font-style: normal; color: #d9ceff; white-space: nowrap; }
      #train .d-chess .who .wait { color: var(--muted); font-weight: 600; }
      #train .d-chess .msg { font-size: 16px; min-height: 44px; line-height: 1.4; }
      #train .d-chess .msg.ok { color: #7fe07f; font-weight: 700; }
      #train .d-chess .msg.no { color: #ff9a8a; }
      #train .d-chess .msg b { color: #fff; }
      #train .d-chess .kb { font-size: 12px; color: var(--muted); }
      #train .d-chess .kb b { color: #ffe066; font-size: 14px; }
      #train .d-chess .credit { font-size: 11px; color: #7d786f; }
      @media (max-height: 520px) {
        #train .d-chess .game { gap: 18px; }
        #train .d-chess .board { width: 236px; height: 236px; }
        #train .d-chess .cr, #train .d-chess .cf { font-size: 8px; }
        #train .d-chess .sq.to.cap::after { border-width: 3px; }
        #train .d-chess .side { width: 210px; gap: 8px; }
        #train .d-chess .who { font-size: 16px; gap: 8px; }
        #train .d-chess .who img { width: 28px; height: 28px; }
        #train .d-chess .msg { font-size: 15px; min-height: 40px; } }`);
    ctx.stage.classList.add('d-chess');
    const lv = ctx.level, two = lv > 5, n = ctx.items, secs = two ? 90 : 45;
    // (the pieces fetched before the first board, so it doesn't come up empty)
    const imgs = [...'wb'].flatMap((c) => [...'kqrbnp'].map((t) => { const i = new Image(); i.src = src(c, t); return i.decode().catch(() => null); }));
    const [data] = await Promise.all([ctx.data('chess'), Promise.race([Promise.all(imgs), ctx.sleep(2500)])]);
    if (ctx.aborted) return null;
    const list = data.levels[lv - 1] || data.levels[0];
    let score = 0, right = 0;
    for (let k = 0; k < n && !ctx.aborted; k++) {
      const fresh = list.filter((p) => !recent.includes(p.id)), pz = pick(fresh.length ? fresh : list);
      recent.push(pz.id);
      if (recent.length > 20) recent.shift();
      const r = await puzzle(ctx, pz, secs, n > 1 ? `${k + 1} / ${n}` : '');
      if (!r) return null;
      if (r.ok) { right++; score += r.slow ? 0.9 : 1; }
    }
    return { score: score / n, right, total: n };
  },
};
