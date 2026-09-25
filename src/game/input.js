// Keyboard + mouse with pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();   // keys pressed since last frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, wheel: 0 };
    this.locked = false;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;   // typing in the menu's fields
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
      // Ctrl is crouch: while you play, Ctrl+R, Ctrl+S, Ctrl+F... are the game's, not the browser's
      // (the few it keeps for itself, like Ctrl+W, it keeps anyway)
      if ((e.ctrlKey || e.metaKey) && this.locked) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    // Trackpads send a stream of small wheel events: accumulate, then allow one step per 300 ms.
    this.wheelAcc = 0; this.wheelT = 0;
    addEventListener('wheel', (e) => {
      if (!this.locked) return;
      if (e.ctrlKey) e.preventDefault();   // (crouched: the wheel switches weapons, it doesn't zoom the page)
      this.wheelAcc += e.deltaY;
      const now = performance.now();
      if (Math.abs(this.wheelAcc) > 60 && now - this.wheelT > 300) {
        this.mouse.wheel += Math.sign(this.wheelAcc);
        this.wheelAcc = 0; this.wheelT = now;
      }
    }, { passive: false });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.mouse.left = this.mouse.right = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    if (this.touch) return;   // (a phone: no pointer to lock; the touch controls do the looking)
    // default (accelerated) movement: feels right on laptop trackpads
    const p = this.canvas.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
  }

  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  endFrame() {
    this.pressed.clear();
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.leftPressed = false;
    this.mouse.wheel = 0;
  }
}
