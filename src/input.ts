// Keyboard, on-screen d-pad and "anywhere" touch joystick, merged into one input state.

export class Input {
  left = false; right = false; up = false; down = false;
  /** True for exactly one update() after `up` goes from false to true. */
  upPressed = false;
  /** Any key / tap this frame (used by menus). */
  anyPress = false;
  touchUsed = false;
  /** Set for one frame when the Cmd/Ctrl + J, P combo is entered. */
  cheat = false;
  private cheatArm = 0;
  private pendingCheat = false;

  private keys = new Set<string>();
  private pad = { left: false, right: false, up: false, down: false };
  private joy = { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0, t0: 0 };
  private prevUp = false;
  private pendingAny = false;

  constructor(canvas: HTMLCanvasElement, padRoot: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.code === 'KeyJ' || e.code === 'KeyP')) {
        e.preventDefault();
        const now = performance.now();
        if (e.code === 'KeyJ') this.cheatArm = now;
        else if (now - this.cheatArm < 2000) { this.pendingCheat = true; this.cheatArm = 0; }
        return;
      }
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pendingAny = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.resetPad(); });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.pendingAny = true;
      if (e.pointerType !== 'mouse') this.touchUsed = true;
      if (this.joy.active) return;
      this.joy.active = true; this.joy.id = e.pointerId; this.joy.ox = e.clientX; this.joy.oy = e.clientY; this.joy.dx = 0; this.joy.dy = 0; this.joy.t0 = performance.now();
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.joy.active || e.pointerId !== this.joy.id) return;
      this.joy.dx = e.clientX - this.joy.ox; this.joy.dy = e.clientY - this.joy.oy;
      // Let the origin follow the finger so direction changes stay responsive.
      const len = Math.hypot(this.joy.dx, this.joy.dy), max = 40;
      if (len > max) { const k = (len - max) / len; this.joy.ox += this.joy.dx * k; this.joy.oy += this.joy.dy * k; this.joy.dx -= this.joy.dx * k; this.joy.dy -= this.joy.dy * k; }
    });
    const end = (e: PointerEvent) => { if (e.pointerId === this.joy.id) { this.joy.active = false; this.joy.id = -1; } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    padRoot.querySelectorAll<HTMLElement>('[data-dir]').forEach((el) => {
      const dir = el.dataset.dir as keyof Input['pad'];
      const on = (e: Event) => { e.preventDefault(); this.pad[dir] = true; this.touchUsed = true; this.pendingAny = true; };
      const off = (e: Event) => { e.preventDefault(); this.pad[dir] = false; };
      el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); on(e); });
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  private resetPad() { this.pad.left = this.pad.right = this.pad.up = this.pad.down = false; this.joy.active = false; }

  update() {
    const k = this.keys;
    let left = k.has('ArrowLeft') || k.has('KeyA') || this.pad.left;
    let right = k.has('ArrowRight') || k.has('KeyD') || this.pad.right;
    let up = k.has('ArrowUp') || k.has('KeyW') || k.has('Space') || this.pad.up;
    let down = k.has('ArrowDown') || k.has('KeyS') || this.pad.down;

    if (this.joy.active) {
      const { dx, dy } = this.joy;
      const dead = 14;
      if (Math.abs(dx) > dead || Math.abs(dy) > dead) {
        if (Math.abs(dx) > Math.abs(dy) * 0.9) { if (dx < 0) left = true; else right = true; if (dy > dead * 1.6) down = true; }
        else if (dy > 0) down = true; else up = true;
      } else if (performance.now() - this.joy.t0 > 110) {
        down = true; // hold still = dig down
      }
    }

    this.left = left; this.right = right; this.up = up; this.down = down;
    this.upPressed = up && !this.prevUp;
    this.prevUp = up;
    this.anyPress = this.pendingAny;
    this.pendingAny = false;
    this.cheat = this.pendingCheat;
    this.pendingCheat = false;
  }
}
