// Touch controls for phones and tablets (landscape).
//
// A stick appears under the left thumb wherever it lands: walk (pushed right out: sprint), or in a
// car throttle, brake and steer. The right half of the screen looks round; so does dragging off the
// fire button while you shoot. Buttons for the rest: aim, jump (the handbrake in a car, climb in the
// drone), crouch, reload, next weapon, grenade, use (only when there's something to use), talk (in
// multiplayer), pause and full screen. Tap the minimap for the big map; tap a prompt to do it.
// Everything is written into the same Input the keyboard and mouse use, so the game can't tell.

const LOOK = 2.6;           // touch pixels -> mouse counts (a thumb's swipe across half the screen: ~130°)
const STICK_R = 54;         // how far the knob travels (px)

const BUTTONS = [
  ['fire', 'FIRE'], ['aim', 'AIM'], ['jump', 'JUMP'], ['crouch', 'DUCK'], ['reload', 'RELOAD'],
  ['swap', 'SWAP'], ['nade', 'NADE'], ['use', 'USE'], ['talk', 'TALK'], ['pause', '❚❚'], ['full', '⛶'],
];

export class Touch {
  constructor(game) {
    this.g = game;
    this.input = game.input;
    this.stick = null;         // {id, x0, y0}
    this.looks = new Map();    // touch id -> last {x, y}
    this.crouchOn = false;
    const el = this.el = document.createElement('div');
    el.id = 'touch';
    el.className = 'hidden';
    el.innerHTML = `<div class="stick"><i></i></div>${BUTTONS.map(([k, t]) => `<button type="button" data-k="${k}">${t}</button>`).join('')}`;
    document.body.appendChild(el);
    this.base = el.querySelector('.stick');
    this.knob = this.base.querySelector('i');
    this.btn = Object.fromEntries([...el.querySelectorAll('button')].map((b) => [b.dataset.k, b]));
    const opts = { passive: false };
    el.addEventListener('touchstart', (e) => this.start(e), opts);
    el.addEventListener('touchmove', (e) => this.move(e), opts);
    el.addEventListener('touchend', (e) => this.end(e), opts);
    el.addEventListener('touchcancel', (e) => this.end(e), opts);
    // (the minimap and the prompt are the HUD's: tapping them is M and F)
    document.getElementById('minimap')?.addEventListener('touchstart', (e) => { e.preventDefault(); this.tap('KeyM'); }, opts);
    document.getElementById('prompt')?.addEventListener('touchstart', (e) => { e.preventDefault(); this.tap('KeyF'); }, opts);
  }

  tap(code) { this.input.pressed.add(code); }
  hold(code, on) { if (on) { this.input.keys.add(code); this.input.pressed.add(code); } else this.input.keys.delete(code); }

  start(e) {
    e.preventDefault();
    const W = innerWidth;
    for (const t of e.changedTouches) {
      const b = t.target.closest && t.target.closest('button');
      if (b) { this.press(b.dataset.k, t); continue; }
      // left side: the stick, where the thumb landed; right side: looking round
      if (t.clientX < W * 0.42 && !this.stick) {
        this.stick = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        this.base.style.left = `${t.clientX}px`; this.base.style.top = `${t.clientY}px`;
        this.base.classList.add('on');
        this.knob.style.transform = 'translate(-50%, -50%)';
      } else this.looks.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
  }

  move(e) {
    e.preventDefault();
    const m = this.input.mouse;
    for (const t of e.changedTouches) {
      if (this.stick && t.identifier === this.stick.id) { this.steer(t.clientX - this.stick.x0, t.clientY - this.stick.y0); continue; }
      const l = this.looks.get(t.identifier);
      if (!l) continue;
      m.dx += (t.clientX - l.x) * LOOK;
      m.dy += (t.clientY - l.y) * LOOK;
      l.x = t.clientX; l.y = t.clientY;
    }
  }

  end(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this.stick && t.identifier === this.stick.id) {
        this.stick = null;
        this.base.classList.remove('on');
        this.steer(0, 0);
      }
      this.looks.delete(t.identifier);
      const k = this.held && this.held.get(t.identifier);
      if (k) { this.release(k); this.held.delete(t.identifier); }
    }
  }

  // the stick: eight ways (and a sprint when it's pushed right out, forwards)
  steer(dx, dy) {
    const d = Math.hypot(dx, dy), k = Math.min(1, d / STICK_R), keys = this.input.keys;
    const ux = d ? dx / d : 0, uy = d ? dy / d : 0;
    this.knob.style.transform = `translate(calc(-50% + ${ux * k * STICK_R}px), calc(-50% + ${uy * k * STICK_R}px))`;
    const on = k > 0.22;
    const set = (code, v) => (v ? keys.add(code) : keys.delete(code));
    set('KeyW', on && uy < -0.38); set('KeyS', on && uy > 0.38);
    set('KeyA', on && ux < -0.38); set('KeyD', on && ux > 0.38);
    set('ShiftLeft', on && k > 0.96 && uy < -0.7 && !this.g.player.vehicle);
  }

  press(k, t) {
    const g = this.g, m = this.input.mouse, v = g.player.vehicle;
    (this.held || (this.held = new Map())).set(t.identifier, k);
    this.btn[k]?.classList.add('down');
    switch (k) {
      // (firing and looking at once: drag off the button)
      case 'fire': m.left = true; m.leftPressed = true; this.looks.set(t.identifier, { x: t.clientX, y: t.clientY }); break;
      case 'aim': this.tap('KeyE'); break;
      case 'jump': this.hold('Space', true); break;
      case 'crouch':
        // on foot a toggle; in the drone, hold to go down
        if (v && v.type === 'drone') this.hold('ControlLeft', true);
        else { this.crouchOn = !this.crouchOn; this.hold('ControlLeft', this.crouchOn); this.btn.crouch.classList.toggle('lit', this.crouchOn); }
        break;
      case 'reload': this.tap('KeyR'); break;
      case 'swap': this.tap('KeyQ'); break;
      case 'nade': this.tap('KeyG'); break;
      case 'use': this.tap('KeyF'); break;
      case 'talk': this.hold('KeyT', true); break;
      case 'pause': g.pause?.(); break;
      case 'full': g.toggleFullscreen?.(); break;
      default: break;
    }
  }

  release(k) {
    const m = this.input.mouse, v = this.g.player.vehicle;
    this.btn[k]?.classList.remove('down');
    if (k === 'fire') m.left = false;
    else if (k === 'jump') this.hold('Space', false);
    else if (k === 'talk') this.hold('KeyT', false);
    else if (k === 'crouch' && v && v.type === 'drone') this.hold('ControlLeft', false);
  }

  // every frame: shown while you play; which buttons make sense right now
  update(playing, promptOn, multiplayer) {
    const el = this.el, p = this.g.player, v = p.vehicle;
    el.classList.toggle('hidden', !playing);
    if (!playing) {
      if (this.stick || this.looks.size || this.input.mouse.left) this.reset();
      return;
    }
    const car = !!v && v.type !== 'drone', drone = !!v && v.type === 'drone';
    el.classList.toggle('driving', car);
    el.classList.toggle('drone', drone);
    el.classList.toggle('prompt', !!promptOn);
    el.classList.toggle('mp', !!multiplayer);
    el.classList.toggle('dead', p.dead);
    this.btn.jump.textContent = car ? 'BRAKE' : drone ? 'UP' : 'JUMP';
    this.btn.crouch.textContent = drone ? 'DOWN' : 'DUCK';
    this.btn.use.textContent = v ? 'OUT' : 'USE';
    if (car && this.crouchOn) { this.crouchOn = false; this.hold('ControlLeft', false); this.btn.crouch.classList.remove('lit'); }
  }

  // let go of everything (a menu opened, you died)
  reset() {
    const keys = this.input.keys;
    for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space', 'KeyT']) keys.delete(c);
    if (!this.crouchOn) keys.delete('ControlLeft');
    this.input.mouse.left = false;
    this.stick = null; this.looks.clear(); this.held?.clear();
    this.base.classList.remove('on');
    for (const b of Object.values(this.btn)) b.classList.remove('down');
  }
}
