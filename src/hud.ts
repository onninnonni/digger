// DOM-based HUD: score, depth, level bar, hearts, banners, popups and overlays.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private score = $('hud-score'); private depth = $('hud-depth'); private level = $('hud-level'); private xp = $('hud-xp');
  private hearts = $('hud-hearts'); private band = $('hud-band'); private msg = $('hud-msg'); private combo = $('hud-combo');
  private pop = $('hud-pop'); private fx = $('hud-fx'); private overlay = $('overlay'); private card = $('overlay-card');
  private last: Record<string, string> = {};
  private msgTimer = 0;

  private setText(el: HTMLElement, key: string, v: string) { if (this.last[key] !== v) { this.last[key] = v; el.textContent = v; } }

  update(score: number, depthKm: number, level: number, xpFrac: number, hearts: number, bandName: string, mult: number, maxHearts = 3, fx = '') {
    this.setText(this.score, 's', score.toLocaleString('en-US'));
    this.setText(this.depth, 'd', `${Math.max(0, Math.round(depthKm)).toLocaleString('en-US')} km`);
    this.setText(this.level, 'l', `Lv ${level} · ×${mult.toFixed(1)}`);
    const w = `${Math.round(Math.max(0, Math.min(1, xpFrac)) * 100)}%`;
    if (this.last.xp !== w) { this.last.xp = w; this.xp.style.width = w; }
    this.setText(this.hearts, 'h', '♥'.repeat(Math.max(0, hearts)) + '♡'.repeat(Math.max(0, maxHearts - hearts)));
    this.setText(this.fx, 'fx', fx);
    this.setText(this.band, 'b', bandName);
  }

  message(text: string, kind: 'info' | 'bad' | 'good' = 'info', ms = 1800) {
    this.msg.textContent = text;
    this.msg.className = `show ${kind}`;
    window.clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => { this.msg.className = ''; }, ms);
  }

  setCombo(n: number) {
    const v = n >= 2 ? `COMBO ×${n}` : '';
    if (this.last.c !== v) { this.last.c = v; this.combo.textContent = v; this.combo.classList.toggle('show', n >= 2); }
  }

  popup(sx: number, sy: number, text: string, color: string) {
    const el = document.createElement('div');
    el.className = 'pop'; el.textContent = text; el.style.left = `${sx}px`; el.style.top = `${sy}px`; el.style.color = color;
    this.pop.appendChild(el);
    window.setTimeout(() => el.remove(), 900);
  }

  flash(cls: string) { document.body.classList.remove(cls); void document.body.offsetWidth; document.body.classList.add(cls); }

  showOverlay(html: string) { this.card.innerHTML = html; this.overlay.classList.add('show'); }
  hideOverlay() { this.overlay.classList.remove('show'); }
  get overlayEl() { return this.overlay; }
}
