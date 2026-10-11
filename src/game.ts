// Core game: player, hazards (lava, cave-ins, boulders, gas, subway trains), scoring, rendering.
import { T, S } from './atlas';
import { Renderer } from './gl';
import { World, W, H, END_ROW, KM_PER_ROW, SPAWN_X, HARD, VALUE, GEM_NAME, BAND_NAMES, band, passable, solid, diggable, isGem, falls, crumbly, soft } from './world';
import { Input } from './input';
import { GameAudio } from './audio';
import { Hud } from './hud';
import { Online } from './online';

const STEP = 1 / 60;
const P_W = 0.7, P_H = 0.86;
const TRAIN_LEN = 9;
const EPS = 1e-4;
const MAX_HEARTS = 5;
const M_W = 0.8, M_H = 0.8;

type State = 'title' | 'playing' | 'gameover' | 'won' | 'paused';

interface Falling { t: number; x: number; y: number; vy: number; }
interface Train { row: number; active: boolean; x: number; dir: number; cd: number; warned: boolean; speed: number; }
interface Monster { kind: 'mole' | 'beetle'; x: number; y: number; vx: number; vy: number; dir: number; hp: number; digT: number; digKey: number; onGround: boolean; hurtCd: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; g: number; b: number; size: number; grav: number; add: boolean; }

const COLOR: Record<number, [number, number, number]> = {
  [T.DIRT]: [0.41, 0.26, 0.14], [T.GRASS]: [0.3, 0.6, 0.22], [T.CRUMBLE]: [0.41, 0.26, 0.14], [T.BOULDER]: [0.45, 0.45, 0.48],
  [T.CLAY]: [0.65, 0.42, 0.27], [T.ROCK]: [0.44, 0.44, 0.46], [T.HARDROCK]: [0.24, 0.24, 0.3], [T.GOLD]: [1, 0.82, 0.25],
  [T.EMERALD]: [0.12, 0.72, 0.43], [T.RUBY]: [0.88, 0.13, 0.25], [T.DIAMOND]: [0.44, 0.89, 1], [T.CRYSTAL]: [0.65, 0.3, 1],
  [T.MAGMA]: [0.23, 0.11, 0.09], [T.SAND]: [0.84, 0.7, 0.42], [T.GAS]: [0.47, 1, 0.31], [T.CONCRETE]: [0.56, 0.56, 0.53],
  [T.CHINA]: [0.75, 0.16, 0.16], [T.LAVA]: [1, 0.4, 0.05], [T.HEART]: [1, 0.2, 0.35], [T.POTION_SPEED]: [0.7, 0.3, 1], [T.POTION_SHIELD]: [0.25, 0.63, 1], [T.BONES]: [0.95, 0.92, 0.84],
};
const GEM_COLOR: Record<number, string> = { [T.GOLD]: '#ffd23f', [T.EMERALD]: '#5dffb0', [T.RUBY]: '#ff5c7a', [T.DIAMOND]: '#9ff3ff', [T.CRYSTAL]: '#d9a3ff' };

// Ambient light keypoints by row: [row, r, g, b]
const AMB: [number, number, number, number][] = [
  [0, 1, 1, 1], [5, 0.85, 0.8, 0.72], [70, 0.55, 0.5, 0.44], [260, 0.38, 0.37, 0.4], [560, 0.4, 0.27, 0.2],
  [950, 0.38, 0.2, 0.15], [1120, 0.48, 0.44, 0.4], [1270, 0.8, 0.8, 0.8], [END_ROW + 3, 1, 1, 1],
];
function ambient(r: number, out: number[]) {
  if (r <= AMB[0][0]) { out[0] = AMB[0][1]; out[1] = AMB[0][2]; out[2] = AMB[0][3]; return; }
  for (let i = 1; i < AMB.length; i++) {
    if (r <= AMB[i][0]) {
      const a = AMB[i - 1], b = AMB[i], k = (r - a[0]) / (b[0] - a[0]);
      out[0] = a[1] + (b[1] - a[1]) * k; out[1] = a[2] + (b[2] - a[2]) * k; out[2] = a[3] + (b[3] - a[3]) * k; return;
    }
  }
  const l = AMB[AMB.length - 1]; out[0] = l[1]; out[1] = l[2]; out[2] = l[3];
}
const BACK_WALL = [T.DIRT, T.DIRT, T.ROCK, T.MAGMA, T.HARDROCK, T.DIRT, T.AIR];

export class Game {
  world!: World;
  state: State = 'title';
  player = { x: SPAWN_X + 0.5, y: 3.5, vx: 0, vy: 0, facing: 1, onGround: false, invuln: 0, digging: false };
  falling: Falling[] = [];
  trains: Train[] = [];
  monsters: Monster[] = [];
  parts: Particle[] = [];
  god = false; shield = false; speedT = 0; monsterT = 10; flip = 0;
  dig: { x: number; y: number; p: number } | null = null;
  safe = { x: SPAWN_X + 0.5, y: 3.5 };

  time = 0; elapsed = 0; acc = 0;
  score = 0; level = 1; xpBase = 0; xpNext = 500; hearts = 3; maxRow = 0; gems = 0;
  best = 0; bestDepth = 0;
  combo = 0; comboT = 0;
  shake = 0; shakeX = 0; shakeY = 0;
  camX = 0; camY = 0; tilePx = 20; viewW = 20; viewH = 30; dpr = 1;
  safeT = 0; digGrace = 0; lavaRainT = 6; caveInT = 8; digSoundT = 0; menuLock = 0; lastRender = 0;
  private light = new Float32Array(0);
  private corner = new Float32Array(16);
  private amb = [0, 0, 0];
  private lastLavaSfx = 0;

  online: Online | null = null;

  constructor(private gfx: Renderer, private input: Input, private audio: GameAudio, private hud: Hud) {
    try { this.best = +(localStorage.getItem('digger.best') || 0); this.bestDepth = +(localStorage.getItem('digger.bestDepth') || 0); } catch { /* ignore */ }
    this.world = new World(1);
    this.showTitle();
  }

  // ---------------- state ----------------
  newGame() {
    this.world = new World((Math.random() * 1e9) | 0);
    this.player = { x: SPAWN_X + 0.5, y: 3.5, vx: 0, vy: 0, facing: 1, onGround: false, invuln: 0, digging: false };
    this.safe = { x: SPAWN_X + 0.5, y: 3.5 };
    this.falling = []; this.parts = []; this.dig = null; this.monsters = [];
    this.shield = false; this.speedT = 0; this.monsterT = 10; this.flip = 0;
    this.trains = this.world.tunnels.map((row) => ({ row, active: false, x: 0, dir: 1, cd: 2 + Math.random() * 6, warned: false, speed: 22 }));
    this.score = 0; this.level = 1; this.xpBase = 0; this.xpNext = 500; this.hearts = 3; this.maxRow = 0; this.gems = 0;
    this.combo = 0; this.comboT = 0; this.shake = 0; this.elapsed = 0; this.acc = 0;
    this.lavaRainT = 6; this.caveInT = 8; this.camY = -3;
    this.state = 'playing';
    this.audio.theme = 'dig';
    this.hud.hideOverlay();
    this.hud.setCombo(0);
    this.hud.message(this.god ? 'GOD MODE · Dig down! ▼' : 'Dig down! ▼', 'good', 1600);
  }

  /** Called from a user-gesture handler (overlay tap / keydown). */
  menuAction() {
    if (this.time < this.menuLock) return;
    if (this.state === 'title' || this.state === 'gameover' || this.state === 'won') this.newGame();
    else if (this.state === 'paused') { this.state = 'playing'; this.hud.hideOverlay(); this.audio.resume(); }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.suspend();
    this.hud.showOverlay(`<h2>Paused</h2><p>Depth ${this.depthKm().toLocaleString('en-US')} km · Score ${this.score.toLocaleString('en-US')}</p><div class="go">Tap or press a key to resume</div>`);
    this.menuLock = this.time + 0.4;
  }

  private showTitle() {
    this.state = 'title';
    const touch = matchMedia('(pointer: coarse)').matches;
    this.hud.showOverlay(`
      <h1>DIGGER</h1>
      <h2>Dig your way to China</h2>
      <p>12,750 km of dirt, rock, lava, cave-ins and subway trains stand between you and Beijing. Grab gold and gems to level up your drill and dig faster.</p>
      <div class="legend">
        <div>🟨 Gold / 💎 gems = points</div><div>🟧 Lava = don't touch</div>
        <div>🪨 Boulders fall</div><div>🟩 Green gas explodes</div>
        <div>🚇 Trains: wait for them</div><div>❤️ Hearts heal, level-ups too</div>
        <div>🧪 Potions: turbo drill / shield</div><div>🦴 Dinosaur bones = +300</div>
        <div>🐾 Moles & beetles chase you</div><div>🔩 Drill them for points</div>
      </div>
      <p class="keys">${touch
        ? 'Hold anywhere to dig down · drag to move or dig sideways · swipe up to jump · or use the buttons'
        : '<kbd>←</kbd><kbd>→</kbd> move/dig · <kbd>↓</kbd> dig down · <kbd>↑</kbd>/<kbd>Space</kbd> jump or dig up · WASD works too'}</p>
      ${this.best ? `<div class="stats"><div class="stat"><b>${this.best.toLocaleString('en-US')}</b><span>Best score</span></div><div class="stat"><b>${this.bestDepth.toLocaleString('en-US')} km</b><span>Deepest</span></div></div>` : ''}
      <div class="go">${touch ? 'Tap to start digging' : 'Click or press any key to start'}</div>
      <div id="online-slot"></div>`);
    this.renderOnline();
  }

  /** Re-render the leaderboard / sign-in panel inside the current overlay (if any). */
  renderOnline() {
    const slot = document.getElementById('online-slot');
    if (slot && this.online) this.online.render(slot);
  }

  private gameOver(reason: string) {
    this.state = 'gameover';
    this.saveBest();
    this.menuLock = this.time + 1.0;
    this.audio.intensity = 0.1;
    this.hud.showOverlay(`
      <h2>You never made it to China</h2>
      <p>${reason}.</p>
      <div class="stats">
        <div class="stat"><b>${this.score.toLocaleString('en-US')}</b><span>Score</span></div>
        <div class="stat"><b>${this.depthKm().toLocaleString('en-US')} km</b><span>Depth</span></div>
        <div class="stat"><b>${this.gems}</b><span>Gems</span></div>
        <div class="stat"><b>${this.best.toLocaleString('en-US')}</b><span>Best</span></div>
      </div>
      <div class="go">Tap or press any key to try again</div>
      <div id="online-slot"></div>`);
    this.online?.submit({ score: this.score, depthKm: this.depthKm(), level: this.level, won: false });
    this.renderOnline();
  }

  private win() {
    this.state = 'won';
    this.saveBest();
    this.audio.win();
    this.menuLock = this.time + 1.5;
    const m = Math.floor(this.elapsed / 60), s = Math.floor(this.elapsed % 60);
    this.hud.showOverlay(`
      <h1>你好 北京!</h1>
      <h2>You dug through the whole Earth</h2>
      <div class="stats">
        <div class="stat"><b>${this.score.toLocaleString('en-US')}</b><span>Score</span></div>
        <div class="stat"><b>${m}:${s.toString().padStart(2, '0')}</b><span>Time</span></div>
        <div class="stat"><b>${this.gems}</b><span>Gems</span></div>
        <div class="stat"><b>Lv ${this.level}</b><span>Drill</span></div>
      </div>
      <div class="go">Tap or press any key to dig again</div>
      <div id="online-slot"></div>`);
    this.online?.submit({ score: this.score, depthKm: this.depthKm(), level: this.level, won: true });
    this.renderOnline();
  }

  private saveBest() {
    const d = this.depthKm();
    if (this.score > this.best) this.best = this.score;
    if (d > this.bestDepth) this.bestDepth = d;
    try { localStorage.setItem('digger.best', String(this.best)); localStorage.setItem('digger.bestDepth', String(this.bestDepth)); } catch { /* ignore */ }
  }

  depthKm() { return Math.max(0, (this.maxRow - 4) * KM_PER_ROW); }
  digRate() { return 4.2 * (1 + 0.22 * (this.level - 1)) * (this.speedT > 0 ? 2 : 1); }
  moveSpeed() { return Math.min(9.5, 6 * (1 + 0.04 * (this.level - 1))) * (this.speedT > 0 ? 1.25 : 1); }
  private fxText() {
    const fx: string[] = [];
    if (this.god) fx.push('GOD MODE');
    if (this.shield) fx.push('🛡 shield');
    if (this.speedT > 0) fx.push(`⚡ ${Math.ceil(this.speedT)}s`);
    return fx.join('  ·  ');
  }

  // ---------------- update ----------------
  update(dtRaw: number) {
    const dt = Math.min(dtRaw, 0.05);
    this.time += dt;
    this.input.update();
    if (this.input.cheat) {
      this.god = !this.god;
      this.hud.message(this.god ? 'GOD MODE ON · no damage' : 'GOD MODE OFF', this.god ? 'good' : 'bad', 2000);
      this.audio.levelUp();
    }
    if (this.state !== 'playing') {
      if (this.input.anyPress && this.state !== 'paused') this.menuAction();
      else if (this.input.anyPress && this.state === 'paused') this.menuAction();
      this.tickParticles(dt);
      return;
    }
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n++ < 4) { this.tick(STEP); this.acc -= STEP; }
    if (n >= 4) this.acc = 0;
  }

  private tick(dt: number) {
    this.elapsed += dt;
    this.tickPlayer(dt);
    if (this.state !== 'playing') return;
    this.tickTiles(dt);
    this.tickFalling(dt);
    this.tickTrains(dt);
    this.tickMonsters(dt);
    if (this.state !== 'playing') return;
    this.tickEvents(dt);
    if (this.speedT > 0) this.speedT -= dt;
    this.tickParticles(dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.combo = 0; this.hud.setCombo(0); } }
    const row = Math.floor(this.player.y);
    this.audio.intensity = Math.min(1, 0.12 + row / 950 + (this.hearts === 1 ? 0.15 : 0));
    if (row >= END_ROW && this.audio.theme !== 'china') this.audio.theme = 'china';
    const b = band(Math.max(0, row));
    this.hud.update(this.score, this.depthKm(), this.level, (this.score - this.xpBase) / (this.xpNext - this.xpBase), this.hearts, BAND_NAMES[b], this.digRate() / 4.2, MAX_HEARTS, this.fxText());
  }

  private tickPlayer(dt: number) {
    const p = this.player, inp = this.input, w = this.world;
    p.invuln = Math.max(0, p.invuln - dt);
    const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (dx) p.facing = dx;
    const cx = Math.floor(p.x), cy = Math.floor(p.y);

    let target: [number, number] | null = null;
    if (diggable(w.get(cx, cy))) target = [cx, cy]; // buried: dig free
    else if (inp.down) { const ty = Math.floor(p.y + P_H / 2 + 0.15); if (diggable(w.get(cx, ty))) target = [cx, ty]; }
    if (!target && dx) { const tx = Math.floor(p.x + dx * (P_W / 2 + 0.15)); if (diggable(w.get(tx, cy))) target = [tx, cy]; }
    if (!target && inp.up) {
      const ty = Math.floor(p.y - P_H / 2 - 0.15), tt = w.get(cx, ty);
      if (p.onGround && diggable(tt)) target = [cx, ty];
      else if (inp.upPressed && p.onGround && passable(tt)) { p.vy = -10.5; p.onGround = false; this.audio.jump(); }
    }
    p.digging = !!target;
    if (target) {
      const [tx, ty] = target, t = w.get(tx, ty);
      if (!this.dig || this.dig.x !== tx || this.dig.y !== ty) this.dig = { x: tx, y: ty, p: 0 };
      this.dig.p += this.digRate() * (tx === cx && ty === cy ? 2 : 1) * dt;
      this.digSoundT -= dt;
      if (this.digSoundT <= 0) {
        this.digSoundT = 0.11;
        this.audio.dig(HARD[t]);
        const c = COLOR[t] || [0.4, 0.4, 0.4];
        this.burst(tx + 0.5, ty + 0.5, 3, c, 3, 0.12, 0.4);
      }
      this.digGrace = 0.3;
      if (this.dig.p >= HARD[t]) { this.dig = null; this.onDug(tx, ty, t); }
    } else if (this.dig) {
      // keep progress briefly so tapping a key still digs
      this.digGrace -= dt;
      if (this.digGrace <= 0 || !diggable(w.get(this.dig.x, this.dig.y))) this.dig = null;
    }

    // drilling into a monster hurts it
    if (dx || inp.down || inp.up) {
      const ox = dx ? dx * 0.8 : 0, oy = !dx && inp.down ? 0.8 : !dx && inp.up ? -0.8 : 0;
      const bx0 = p.x - P_W / 2 + ox, bx1 = p.x + P_W / 2 + ox, by0 = p.y - P_H / 2 + oy, by1 = p.y + P_H / 2 + oy;
      for (const m of this.monsters) {
        if (m.x + M_W / 2 > bx0 && m.x - M_W / 2 < bx1 && m.y + M_H / 2 > by0 && m.y - M_H / 2 < by1) {
          m.hp -= 3 * (this.speedT > 0 ? 2 : 1) * dt;
          p.digging = true;
          if (Math.random() < 0.3) this.burst(m.x, m.y, 2, [1, 0.8, 0.3], 4, 0.1, 0.3, 10, true);
          if (m.hp <= 0) this.killMonster(m, true);
        }
      }
    }

    p.vx = dx * this.moveSpeed();
    p.vy = Math.min(p.vy + 36 * dt, 24);
    if (p.y > END_ROW + 2.5) p.vy = Math.min(p.vy, 1.6); // float gently out of the ground on the far side
    this.moveX(p.vx * dt);
    this.moveY(p.vy * dt);

    // hazards touching the player
    const x0 = p.x - P_W / 2, x1 = p.x + P_W / 2, y0 = p.y - P_H / 2, y1 = p.y + P_H / 2;
    for (let ty = Math.floor(y0); ty <= Math.floor(y1 - EPS); ty++) for (let tx = Math.floor(x0); tx <= Math.floor(x1 - EPS); tx++) {
      if (w.get(tx, ty) === T.LAVA) { this.hurt('Fell into lava'); return; }
    }

    const row = Math.floor(y1);
    if (row > this.maxRow) { this.addScore(2 * (row - this.maxRow)); this.maxRow = row; }
    if (p.y >= END_ROW + 7) { this.win(); return; }

    // remember a safe spot
    this.safeT -= dt;
    if (this.safeT <= 0 && p.onGround && p.invuln <= 0) {
      this.safeT = 0.35;
      const here = w.get(cx, cy), below = w.get(cx, cy + 1);
      let ok = passable(here) && here !== T.LAVA && here !== T.TUNNEL && here !== T.RAIL && !falls(below) && below !== T.CRUMBLE && below !== T.LAVA && below !== T.GAS;
      if (ok) for (let yy = -2; yy <= 2 && ok; yy++) for (let xx = -2; xx <= 2; xx++) if (w.get(cx + xx, cy + yy) === T.LAVA) { ok = false; break; }
      if (ok) { this.safe.x = p.x; this.safe.y = p.y; }
    }
  }

  private collides(x0: number, y0: number, x1: number, y1: number): boolean {
    for (let ty = Math.floor(y0); ty <= Math.floor(y1 - EPS); ty++) for (let tx = Math.floor(x0); tx <= Math.floor(x1 - EPS); tx++) if (solid(this.world.get(tx, ty))) return true;
    return false;
  }
  private moveX(d: number) {
    const p = this.player, nx = p.x + d;
    if (d === 0) return;
    if (this.collides(nx - P_W / 2, p.y - P_H / 2, nx + P_W / 2, p.y + P_H / 2)) {
      if (!this.collides(p.x - P_W / 2, p.y - P_H / 2, p.x + P_W / 2, p.y + P_H / 2)) p.x = d > 0 ? Math.floor(nx + P_W / 2) - P_W / 2 - EPS : Math.ceil(nx - P_W / 2) + P_W / 2 + EPS;
      p.vx = 0;
    } else p.x = nx;
  }
  private moveY(d: number) {
    const p = this.player, ny = p.y + d;
    p.onGround = false;
    if (this.collides(p.x - P_W / 2, ny - P_H / 2, p.x + P_W / 2, ny + P_H / 2)) {
      if (!this.collides(p.x - P_W / 2, p.y - P_H / 2, p.x + P_W / 2, p.y + P_H / 2)) p.y = d > 0 ? Math.floor(ny + P_H / 2) - P_H / 2 - EPS : Math.ceil(ny - P_H / 2) + P_H / 2 + EPS;
      if (d > 0) p.onGround = true;
      p.vy = 0;
    } else p.y = ny;
  }

  private onDug(x: number, y: number, t: number) {
    const w = this.world;
    w.set(x, y, T.AIR);
    const c = COLOR[t] || [0.4, 0.4, 0.4];
    this.burst(x + 0.5, y + 0.5, 10, c, 5, 0.16, 0.6);
    if (t === T.HEART || t === T.POTION_SPEED || t === T.POTION_SHIELD || t === T.BONES) {
      const s = this.toScreen(x + 0.5, y + 0.2);
      this.audio.gem(t === T.BONES ? 400 : 150);
      this.burst(x + 0.5, y + 0.5, 16, c, 4, 0.14, 0.9, -4, true);
      if (t === T.HEART) { this.hearts = Math.min(MAX_HEARTS, this.hearts + 1); this.hud.popup(s[0], s[1], '+1 ♥', '#ff4d6a'); }
      else if (t === T.POTION_SPEED) { this.speedT = 12; this.hud.popup(s[0], s[1], '⚡ Turbo drill 12s', '#d9a3ff'); }
      else if (t === T.POTION_SHIELD) { this.shield = true; this.hud.popup(s[0], s[1], '🛡 Shield', '#9fd3ff'); }
      else { this.gems++; this.addScore(300); this.hud.popup(s[0], s[1], '🦴 Dinosaur bones +300', '#f2ead6'); }
      return;
    }
    if (isGem(t)) {
      this.combo = Math.min(8, this.combo + 1); this.comboT = 3.5;
      this.hud.setCombo(this.combo);
      const pts = VALUE[t] * Math.max(1, this.combo);
      this.gems++;
      this.addScore(pts);
      this.audio.gem(VALUE[t]);
      const s = this.toScreen(x + 0.5, y + 0.2);
      this.hud.popup(s[0], s[1], `${GEM_NAME[t]} +${pts}`, GEM_COLOR[t]);
      this.burst(x + 0.5, y + 0.5, 14, c, 4, 0.14, 0.9, -4, true);
    }
    if (t === T.GAS) { this.explode(x, y, 2); return; }

    // cave-in: tiles above the fresh hole may crumble
    const base = 0.1 + Math.min(0.34, y / 1600);
    for (let dy = 1; dy <= 3; dy++) {
      const tt = w.get(x, y - dy);
      if (crumbly(tt) && Math.random() < base / dy) { w.set(x, y - dy, T.CRUMBLE); w.timer[(y - dy) * W + x] = 0.5 + Math.random() * 1.4; if (dy === 1) this.audio.crumble(); }
    }
    for (const sx of [x - 1, x + 1]) {
      const tt = w.get(sx, y - 1);
      if (crumbly(tt) && Math.random() < base * 0.3) { w.set(sx, y - 1, T.CRUMBLE); w.timer[(y - 1) * W + sx] = 0.8 + Math.random() * 1.5; }
    }
  }

  private addScore(n: number) {
    this.score += n;
    while (this.score >= this.xpNext) {
      this.level++;
      this.xpBase = this.xpNext;
      this.xpNext += Math.round(500 * Math.pow(1.4, this.level - 1));
      this.hearts = Math.min(MAX_HEARTS, this.hearts + 1);
      this.audio.levelUp();
      this.hud.flash('levelup');
      this.hud.message(`LEVEL ${this.level} · Drill speed ×${(this.digRate() / 4.2).toFixed(1)}`, 'good', 2200);
      this.burst(this.player.x, this.player.y, 30, [1, 0.85, 0.3], 7, 0.14, 1.0, -6, true);
    }
  }

  explode(x: number, y: number, depth: number) {
    const w = this.world;
    this.audio.explosion();
    this.shake = Math.min(2, this.shake + 1.4);
    const chain: [number, number][] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 5) continue;
      const tx = x + dx, ty = y + dy, t = w.get(tx, ty);
      if (t === T.BEDROCK || t === T.CONCRETE || t === T.LAVA || t === T.AIR) continue;
      if (t === T.GAS) chain.push([tx, ty]);
      w.set(tx, ty, T.AIR);
    }
    this.burst(x + 0.5, y + 0.5, 40, [1, 0.6, 0.15], 9, 0.3, 0.7, -2, true);
    this.burst(x + 0.5, y + 0.5, 25, [0.3, 0.3, 0.3], 4, 0.35, 1.4, -3, false);
    for (let dx = -2; dx <= 2; dx++) { const tt = w.get(x + dx, y - 3); if (crumbly(tt)) { w.set(x + dx, y - 3, T.CRUMBLE); w.timer[(y - 3) * W + x + dx] = 0.3 + Math.random(); } }
    const p = this.player, d = Math.hypot(p.x - (x + 0.5), p.y - (y + 0.5));
    if (d < 2.9) { p.vy = -7; this.hurt('Blown up by a gas pocket'); }
    if (depth > 0) for (const [cx, cy] of chain) this.explode(cx, cy, depth - 1);
  }

  private hurt(reason: string) {
    const p = this.player;
    if (this.state !== 'playing' || p.invuln > 0 || this.god) return;
    if (this.shield) {
      this.shield = false; p.invuln = 1.5;
      this.audio.thud(); this.shake = Math.min(2, this.shake + 0.5);
      this.hud.message('Shield absorbed the hit!', 'good', 1500);
      this.burst(p.x, p.y, 24, [0.4, 0.7, 1], 6, 0.16, 0.6, -2, true);
      return;
    }
    this.hearts--;
    this.audio.hurt();
    this.shake = Math.min(2, this.shake + 1.2);
    this.hud.flash('hurt');
    this.combo = 0; this.comboT = 0; this.hud.setCombo(0);
    this.burst(p.x, p.y, 20, [1, 0.2, 0.2], 6, 0.16, 0.7);
    if (this.hearts <= 0) { this.gameOver(reason); return; }
    this.hud.message(`${reason}! −1 ♥`, 'bad', 1800);
    this.respawn();
  }

  private respawn() {
    const p = this.player, w = this.world;
    p.x = this.safe.x; p.y = this.safe.y; p.vx = 0; p.vy = 0; p.invuln = 2.0;
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const t = w.get(cx + dx, cy + dy);
      if (t === T.LAVA) w.set(cx + dx, cy + dy, T.MAGMA);
    }
    for (const [tx, ty] of [[cx, cy], [cx, cy - 1]]) { const t = w.get(tx, ty); if (solid(t) && t !== T.BEDROCK) w.set(tx, ty, T.AIR); }
    this.falling = this.falling.filter((f) => Math.hypot(f.x + 0.5 - p.x, f.y + 0.5 - p.y) > 5);
    this.dig = null;
  }

  private tickTiles(dt: number) {
    const w = this.world, tiles = w.tiles, timer = w.timer, energy = w.energy;
    const py = Math.floor(this.player.y);
    const r0 = Math.max(0, py - 30), r1 = Math.min(H - 2, py + 42);
    for (let r = r1; r >= r0; r--) {
      for (let x = 1; x < W - 1; x++) {
        const i = r * W + x, t = tiles[i];
        if (t === T.CRUMBLE) {
          timer[i] -= dt;
          if (timer[i] <= 0) { w.set(x, r, T.SAND); this.burst(x + 0.5, r + 0.9, 3, COLOR[T.DIRT], 1.5, 0.1, 0.5); }
        } else if (t === T.SAND || t === T.BOULDER) {
          const below = tiles[i + W];
          if (passable(below)) {
            w.set(x, r, T.AIR);
            this.falling.push({ t, x, y: r, vy: 0 });
            if (t === T.BOULDER && Math.abs(r - py) < 14) this.audio.rumble();
          }
        } else if (t === T.LAVA) {
          timer[i] -= dt;
          if (timer[i] > 0) continue;
          timer[i] = 0.14;
          const below = tiles[i + W];
          if (below === T.AIR || below === T.TUNNEL || below === T.RAIL) {
            w.set(x, r, T.AIR);
            this.falling.push({ t: T.LAVA, x, y: r, vy: 2 });
            if (Math.abs(r - py) < 14 && this.time - this.lastLavaSfx > 0.4) { this.lastLavaSfx = this.time; this.audio.lava(); }
            continue;
          }
          if (below === T.GAS) { this.explode(x, r + 1, 2); continue; }
          if (tiles[i - 1] === T.GAS) { this.explode(x - 1, r, 2); continue; }
          if (tiles[i + 1] === T.GAS) { this.explode(x + 1, r, 2); continue; }
          const e = energy[i];
          let spread = false;
          if (e > 0.3) {
            const first = Math.random() < 0.5 ? -1 : 1;
            for (const d of [first, -first]) {
              const j = i + d;
              if (tiles[j] === T.AIR) { w.set(x + d, r, T.LAVA); energy[j] = e - 0.3; timer[j] = 0.14; energy[i] = e - 0.15; spread = true; break; }
            }
          }
          if (!spread && energy[i] < 1) {
            energy[i] -= 0.04;
            if (energy[i] < -1.2) { w.set(x, r, T.MAGMA); this.burst(x + 0.5, r + 0.3, 4, [0.5, 0.5, 0.5], 1.5, 0.2, 0.8, -1.5); }
          }
        }
      }
    }
  }

  private tickFalling(dt: number) {
    const w = this.world, p = this.player;
    const px0 = p.x - P_W / 2, px1 = p.x + P_W / 2, py0 = p.y - P_H / 2, py1 = p.y + P_H / 2;
    for (let k = this.falling.length - 1; k >= 0; k--) {
      const f = this.falling[k];
      f.vy = Math.min(f.vy + 32 * dt, 26);
      const ny = f.y + f.vy * dt;
      let landed = false;
      for (let row = Math.floor(f.y) + 1; row <= Math.floor(ny) + 1; row++) {
        const t = w.get(f.x, row);
        if (t === T.LAVA) {
          if (f.t === T.SAND) { w.set(f.x, row, T.MAGMA); this.burst(f.x + 0.5, row, 8, [0.8, 0.8, 0.8], 2, 0.2, 0.9, -2); }
          else if (f.t === T.BOULDER) { this.burst(f.x + 0.5, row, 10, [1, 0.6, 0.2], 3, 0.15, 0.6, -2, true); }
          else { w.set(f.x, row - 1, T.LAVA); w.energy[(row - 1) * W + f.x] = 0.9; }
          landed = true; break;
        }
        if (!passable(t) || row >= H - 1) {
          const ly = row - 1;
          w.set(f.x, ly, f.t);
          if (f.t === T.LAVA) { w.energy[ly * W + f.x] = 0.9; w.timer[ly * W + f.x] = 0.1; if (Math.abs(ly - p.y) < 12) this.burst(f.x + 0.5, ly + 0.5, 6, [1, 0.5, 0.1], 3, 0.12, 0.5, -2, true); }
          else if (Math.abs(ly - p.y) < 14) { if (f.t === T.BOULDER) { this.audio.thud(); this.shake = Math.min(2, this.shake + 0.4); } this.burst(f.x + 0.5, ly + 0.9, 5, COLOR[f.t], 2.5, 0.12, 0.5); }
          if (w.get(f.x, ly + 1) === T.GAS && f.t === T.BOULDER) this.explode(f.x, ly + 1, 2);
          landed = true; break;
        }
      }
      if (landed) { this.falling.splice(k, 1); continue; }
      f.y = ny;
      for (let mi = this.monsters.length - 1; mi >= 0; mi--) {
        const m = this.monsters[mi];
        if (f.x + 1 > m.x - M_W / 2 && f.x < m.x + M_W / 2 && f.y + 1 > m.y - M_H / 2 && f.y < m.y + M_H / 2) this.killMonster(m, false);
      }
      // hit the player?
      if (f.x + 1 > px0 && f.x < px1 && f.y + 1 > py0 && f.y < py1) {
        this.hurt(f.t === T.BOULDER ? 'Crushed by a boulder' : f.t === T.SAND ? 'Buried in a cave-in' : 'Hit by falling lava');
        if (this.state !== 'playing') return;
      }
    }
  }

  private tickTrains(dt: number) {
    const p = this.player;
    for (const tr of this.trains) {
      const dist = Math.abs(tr.row - p.y);
      if (dist > 70) continue;
      if (!tr.active) {
        tr.cd -= dt;
        if (!tr.warned && tr.cd <= 1.9) { tr.warned = true; tr.dir = Math.random() < 0.5 ? -1 : 1; if (dist < 28) this.audio.horn(); }
        if (tr.cd <= 0) { tr.active = true; tr.x = tr.dir > 0 ? -TRAIN_LEN : W; if (dist < 28) this.audio.trainPass(); }
        continue;
      }
      tr.x += tr.dir * tr.speed * dt;
      if (dist < 14) this.shake = Math.min(0.5, this.shake + dt * 1.5);
      if ((tr.dir > 0 && tr.x > W + 1) || (tr.dir < 0 && tr.x + TRAIN_LEN < -1)) { tr.active = false; tr.warned = false; tr.cd = 3 + Math.random() * 6; continue; }
      const py0 = p.y - P_H / 2, py1 = p.y + P_H / 2, px0 = p.x - P_W / 2, px1 = p.x + P_W / 2;
      if (py1 > tr.row + 0.1 && py0 < tr.row + 1.9 && px1 > tr.x && px0 < tr.x + TRAIN_LEN) this.hurt('Hit by a subway train');
    }
  }

  private tickEvents(dt: number) {
    const w = this.world, p = this.player, py = Math.floor(p.y), b = band(Math.max(0, py));
    this.lavaRainT -= dt;
    if (this.lavaRainT <= 0) {
      this.lavaRainT = b >= 3 && b <= 4 ? 1.8 + Math.random() * 2.6 : b === 2 || b === 5 ? 4 + Math.random() * 5 : 30;
      for (let tries = 0; tries < 10; tries++) {
        const x = 1 + Math.floor(Math.random() * (W - 2)), r = py - 5 - Math.floor(Math.random() * 14);
        if (r > 6 && w.get(x, r) === T.AIR && w.get(x, r + 1) === T.AIR) {
          this.falling.push({ t: T.LAVA, x, y: r, vy: 3 });
          if (this.time - this.lastLavaSfx > 0.3) { this.lastLavaSfx = this.time; this.audio.lava(); }
          break;
        }
      }
    }
    this.caveInT -= dt;
    if (this.caveInT <= 0) {
      this.caveInT = 3.5 + Math.random() * 5;
      for (let tries = 0; tries < 10; tries++) {
        const x = 1 + Math.floor(Math.random() * (W - 2)), r = py - 2 - Math.floor(Math.random() * 12);
        if (r > 5 && w.get(x, r) === T.AIR && crumbly(w.get(x, r - 1))) {
          w.set(x, r - 1, T.CRUMBLE); w.timer[(r - 1) * W + x] = 0.4 + Math.random();
          if (Math.random() < 0.5 && crumbly(w.get(x, r - 2))) { w.set(x, r - 2, T.CRUMBLE); w.timer[(r - 2) * W + x] = 0.6 + Math.random(); }
          this.audio.rumble();
          break;
        }
      }
    }
  }

  // ---------------- monsters ----------------
  private spawnMonster() {
    const w = this.world, p = this.player, py = Math.floor(p.y);
    for (let tries = 0; tries < 24; tries++) {
      const x = 1 + Math.floor(Math.random() * (W - 2)), r = py + (Math.random() < 0.5 ? -1 : 1) * (7 + Math.floor(Math.random() * 12));
      if (r < 10 || r >= END_ROW - 6) continue;
      if (w.get(x, r) !== T.AIR || !solid(w.get(x, r + 1))) continue;
      const kind: Monster['kind'] = band(r) >= 3 ? 'beetle' : 'mole';
      this.monsters.push({ kind, x: x + 0.5, y: r + 0.5, vx: 0, vy: 0, dir: 1, hp: kind === 'beetle' ? 5 : 3, digT: 0, digKey: -1, onGround: false, hurtCd: 0 });
      this.audio.rumble();
      return;
    }
  }

  private killMonster(m: Monster, byPlayer: boolean) {
    const i = this.monsters.indexOf(m);
    if (i < 0) return;
    this.monsters.splice(i, 1);
    this.burst(m.x, m.y, 18, m.kind === 'beetle' ? [0.9, 0.3, 0.1] : [0.45, 0.28, 0.14], 5, 0.14, 0.7);
    this.audio.thud();
    if (byPlayer) {
      const pts = m.kind === 'beetle' ? 250 : 150;
      this.addScore(pts);
      const s = this.toScreen(m.x, m.y - 0.3);
      this.hud.popup(s[0], s[1], `${m.kind === 'beetle' ? 'Beetle' : 'Mole'} drilled +${pts}`, '#ffb347');
    }
  }

  private moveMonster(m: Monster, dx: number, dy: number) {
    if (dx) {
      const nx = m.x + dx;
      if (this.collides(nx - M_W / 2, m.y - M_H / 2, nx + M_W / 2, m.y + M_H / 2)) m.vx = 0; else m.x = nx;
    }
    if (dy) {
      const ny = m.y + dy;
      m.onGround = false;
      if (this.collides(m.x - M_W / 2, ny - M_H / 2, m.x + M_W / 2, ny + M_H / 2)) {
        if (!this.collides(m.x - M_W / 2, m.y - M_H / 2, m.x + M_W / 2, m.y + M_H / 2)) m.y = dy > 0 ? Math.floor(ny + M_H / 2) - M_H / 2 - EPS : Math.ceil(ny - M_H / 2) + M_H / 2 + EPS;
        if (dy > 0) m.onGround = true;
        m.vy = 0;
      } else m.y = ny;
    }
  }

  private tickMonsters(dt: number) {
    const w = this.world, p = this.player, ms = this.monsters;
    for (let k = ms.length - 1; k >= 0; k--) {
      const m = ms[k];
      if (Math.abs(m.y - p.y) > 45) { ms.splice(k, 1); continue; }
      m.hurtCd = Math.max(0, m.hurtCd - dt);
      const speed = m.kind === 'beetle' ? 3.9 : 3.1;
      const dx = p.x - m.x, dy = p.y - m.y;
      const cx = Math.floor(m.x), cy = Math.floor(m.y);
      let want = Math.abs(dx) > 0.35 ? Math.sign(dx) : 0;
      if (m.hurtCd > 0.8) want = -Math.sign(dx) || 1;
      if (want) m.dir = want;
      m.vx = 0;
      let digCell = -1;
      if (want) {
        const nx = Math.floor(m.x + want * (M_W / 2 + 0.15)), t = w.get(nx, cy);
        if (passable(t)) m.vx = want * speed;
        else if (m.onGround && passable(w.get(nx, cy - 1)) && passable(w.get(cx, cy - 1))) m.vy = -9;
        else if (soft(t) || (m.kind === 'beetle' && diggable(t) && HARD[t] <= 3)) digCell = cy * W + nx;
      }
      if (digCell < 0 && m.onGround && Math.abs(dx) < 2.5) {
        if (dy > 2.5) { const t = w.get(cx, cy + 1); if (soft(t) || (m.kind === 'beetle' && diggable(t) && HARD[t] <= 3)) digCell = (cy + 1) * W + cx; }
        else if (dy < -2.5) { const t = w.get(cx, cy - 1); if (soft(t)) digCell = (cy - 1) * W + cx; else if (passable(t)) m.vy = -9; }
      }
      if (digCell >= 0) {
        if (m.digKey !== digCell) { m.digKey = digCell; m.digT = 0; }
        m.digT += dt;
        if (Math.random() < 0.15) this.burst(m.x + m.dir * 0.4, m.y, 2, COLOR[T.DIRT], 2, 0.1, 0.4);
        if (m.digT > (m.kind === 'beetle' ? 0.7 : 1.0)) { w.set(digCell % W, Math.floor(digCell / W), T.AIR); m.digKey = -1; }
      } else m.digKey = -1;
      m.vy = Math.min(m.vy + 36 * dt, 24);
      this.moveMonster(m, m.vx * dt, 0);
      this.moveMonster(m, 0, m.vy * dt);
      if (m.kind === 'mole' && w.get(Math.floor(m.x), Math.floor(m.y)) === T.LAVA) { this.killMonster(m, false); continue; }
      if (m.hurtCd <= 0 && m.x + M_W / 2 > p.x - P_W / 2 && m.x - M_W / 2 < p.x + P_W / 2 && m.y + M_H / 2 > p.y - P_H / 2 && m.y - M_H / 2 < p.y + P_H / 2) {
        m.hurtCd = 1.3;
        this.hurt(m.kind === 'beetle' ? 'Mauled by a magma beetle' : 'Bitten by a mole');
        if (this.state !== 'playing') return;
      }
    }
    this.monsterT -= dt;
    if (this.monsterT <= 0) {
      this.monsterT = 5.5 + Math.random() * 6.5;
      if (Math.floor(p.y) > 30 && ms.length < 4) this.spawnMonster();
    }
  }

  // ---------------- particles ----------------
  private burst(x: number, y: number, n: number, c: [number, number, number], speed: number, size: number, life: number, grav = 18, add = false) {
    if (this.parts.length > 2500) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life: life * (0.5 + Math.random() * 0.5), max: life, r: c[0], g: c[1], b: c[2], size: size * (0.6 + Math.random() * 0.8), grav, add });
    }
  }
  private tickParticles(dt: number) {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }

  // ---------------- render ----------------
  toScreen(wx: number, wy: number): [number, number] {
    return [((wx - this.camX - this.shakeX) * this.tilePx) / this.dpr, ((wy - this.camY - this.shakeY) * this.tilePx) / this.dpr];
  }

  render(now: number) {
    const g = this.gfx, cw = g.width, ch = g.height, p = this.player, w = this.world;
    const dt = Math.min(0.05, (now - this.lastRender) / 1000 || 0.016);
    this.lastRender = now;
    this.tilePx = Math.min(cw / W, ch / 26);
    this.viewW = cw / this.tilePx; this.viewH = ch / this.tilePx;
    this.camX = (W - this.viewW) / 2;
    const flipTarget = p.y > END_ROW - 1 && this.state !== 'title' ? 1 : 0;
    this.flip += (flipTarget - this.flip) * Math.min(1, dt * 2);
    const targetY = p.y - this.viewH * (0.42 + 0.08 * this.flip);
    if (this.state === 'title') this.camY = -3;
    else this.camY += (targetY - this.camY) * Math.min(1, dt * 7);
    this.camY = Math.max(-3, Math.min(H - this.viewH + 1, this.camY));
    this.shakeX = (Math.random() - 0.5) * this.shake * 0.5; this.shakeY = (Math.random() - 0.5) * this.shake * 0.5;
    const camX = this.camX + this.shakeX, camY = this.camY + this.shakeY;

    const mid = camY + this.viewH / 2;
    const sky = mid < 10 ? Math.max(0, Math.min(1, (10 - mid) / 10)) : mid > END_ROW + 1 ? 1 : 0;
    g.begin(0.05 + 0.4 * sky, 0.03 + 0.67 * sky, 0.02 + 0.95 * sky);
    g.setCamera(camX, camY, this.viewW, this.viewH);
    g.setRotation(this.flip * Math.PI);

    // ---- lighting grid (per tile corner) ----
    const c0 = Math.floor(camX) - 1, c1 = Math.ceil(camX + this.viewW) + 1, r0 = Math.floor(camY) - 1, r1 = Math.ceil(camY + this.viewH) + 1;
    const cols = c1 - c0 + 2, rows = r1 - r0 + 2;
    const need = cols * rows * 3;
    if (this.light.length < need) this.light = new Float32Array(need);
    const L = this.light, amb = this.amb;
    for (let r = 0; r < rows; r++) { ambient(r0 + r, amb); for (let c = 0; c < cols; c++) { const k = (r * cols + c) * 3; L[k] = amb[0]; L[k + 1] = amb[1]; L[k + 2] = amb[2]; } }
    const addLight = (x: number, y: number, R: number, pow: number, lr: number, lg: number, lb: number) => {
      const ca = Math.max(0, Math.floor(x - R) - c0), cb = Math.min(cols - 1, Math.ceil(x + R) - c0), ra = Math.max(0, Math.floor(y - R) - r0), rb = Math.min(rows - 1, Math.ceil(y + R) - r0);
      for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) {
        const d = Math.hypot(c + c0 - x, r + r0 - y);
        if (d >= R) continue;
        const k = Math.pow(1 - d / R, pow), i = (r * cols + c) * 3;
        L[i] += lr * k; L[i + 1] += lg * k; L[i + 2] += lb * k;
      }
    };
    if (this.state !== 'title') addLight(p.x, p.y, 6.5 + this.level * 0.25, 1.6, 1, 0.95, 0.8);
    for (let r = r0; r <= r1; r++) for (let c = Math.max(1, c0); c <= Math.min(W - 2, c1); c++) {
      const t = w.get(c, r);
      if (t === T.LAVA) addLight(c + 0.5, r + 0.5, 3.5, 2, 0.75, 0.32, 0.06);
      else if (t === T.GAS) addLight(c + 0.5, r + 0.5, 1.8, 2, 0.08, 0.3, 0.04);
      else if (t === T.CRYSTAL) addLight(c + 0.5, r + 0.5, 2, 2, 0.25, 0.1, 0.4);
    }
    for (const f of this.falling) if (f.t === T.LAVA && f.y > r0 && f.y < r1) addLight(f.x + 0.5, f.y + 0.5, 3.5, 2, 0.75, 0.32, 0.06);
    for (const m of this.monsters) if (m.kind === 'beetle' && m.y > r0 && m.y < r1) addLight(m.x, m.y, 2.5, 2, 0.5, 0.2, 0.05);
    for (const tr of this.trains) if (tr.active && tr.row > r0 - 3 && tr.row < r1 + 3) { const hx = tr.dir > 0 ? tr.x + TRAIN_LEN : tr.x; addLight(hx + tr.dir * 1.5, tr.row + 1, 5, 1.5, 0.9, 0.85, 0.6); }

    // ---- tiles ----
    const cc = this.corner;
    const lavaFrame = Math.floor(this.time * 5);
    for (let r = r0; r <= r1; r++) {
      const b = band(Math.max(0, r));
      for (let c = c0; c <= c1; c++) {
        let t = w.get(c, r);
        let emissive = 0, dim = 1;
        if (t === T.AIR) {
          if (r < 4 || r >= END_ROW + 3) continue;
          t = BACK_WALL[b]; dim = 0.3;
        } else if (t === T.TUNNEL || t === T.RAIL) emissive = 0.5;
        else if (t === T.LAVA) { emissive = 1; if ((lavaFrame + c + r) & 1) t = S.LAVA2; }
        if (r >= H - 1 || r < 0) continue;
        for (let k = 0; k < 4; k++) {
          const cx = c - c0 + (k & 1), cy = r - r0 + (k >> 1), i = (cy * cols + cx) * 3;
          let lr = L[i] * dim, lg = L[i + 1] * dim, lb = L[i + 2] * dim;
          if (emissive) { lr = Math.max(lr, emissive); lg = Math.max(lg, emissive); lb = Math.max(lb, emissive); }
          cc[k * 4] = lr; cc[k * 4 + 1] = lg; cc[k * 4 + 2] = lb; cc[k * 4 + 3] = 1;
        }
        g.quadC(c, r, 1, 1, t, cc);
      }
    }

    // The far side: drawn upside down in world space so it stands upright once the view has flipped.
    if (r1 >= END_ROW + 2) {
      const gy = END_ROW + 3;
      for (let c = 1; c < W - 1; c++) g.quad(c, gy + 1.2, 1, -1.2, S.WALL, 1, 1, 1, 1, true);
      for (let c = 2; c < W - 2; c += 4) g.quad(c, gy + 2.4, 1, -1.2, S.FLAG, 1, 1, 1, 1, true);
      g.quad(SPAWN_X - 2.5, gy + 4.7, 3, -3.5, S.PAGODA, 1, 1, 1, 1, true);
      g.quad(SPAWN_X + 2, gy + 3.6, 2, -2.4, S.PAGODA, 1, 1, 1, 1, true);
    }

    // monsters
    for (const m of this.monsters) {
      if (m.y < r0 - 2 || m.y > r1 + 2) continue;
      const frame = Math.floor(this.time * 8 + m.x) & 1;
      const idx = m.kind === 'mole' ? (frame ? S.MOLE1 : S.MOLE0) : (frame ? S.BEETLE1 : S.BEETLE0);
      ambient(m.y, amb);
      const near = Math.max(0, 1 - Math.hypot(m.x - p.x, m.y - p.y) / 7);
      g.quad(m.x - 0.5, m.y - 0.5, 1, 1, idx, amb[0] + near, amb[1] + near * 0.9, amb[2] + near * 0.8, 1, m.dir < 0);
    }

    // dig progress
    if (this.dig) {
      const frac = Math.min(1, this.dig.p / HARD[w.get(this.dig.x, this.dig.y)]);
      g.rect(this.dig.x, this.dig.y, 1, 1, 0, 0, 0, 0.55 * frac);
      g.rect(this.dig.x, this.dig.y + 1 - 0.12, frac, 0.12, 1, 0.85, 0.3, 0.9);
    }

    // falling blocks
    for (const f of this.falling) {
      if (f.y < r0 - 2 || f.y > r1 + 2) continue;
      if (f.t === T.LAVA) { g.quad(f.x, f.y - 0.8, 1, 1.8, S.DRIP, 1, 1, 1, 1); g.quad(f.x, f.y, 1, 1, T.LAVA, 1, 1, 1, 1); }
      else {
        ambient(f.y, amb);
        g.quad(f.x, f.y, 1, 1, f.t, amb[0] + 0.3, amb[1] + 0.3, amb[2] + 0.3, 1);
      }
    }

    // trains
    for (const tr of this.trains) {
      if (tr.row < r0 - 3 || tr.row > r1 + 3) continue;
      if (tr.active) {
        for (let i = 0; i < TRAIN_LEN; i++) {
          const head = tr.dir > 0 ? i === TRAIN_LEN - 1 : i === 0;
          g.quad(tr.x + i, tr.row + 0.12, 1, 1.8, head ? S.TRAIN_HEAD : S.TRAIN_BODY, 0.95, 0.95, 1, 1, tr.dir < 0, 1, 2);
        }
      } else if (tr.warned) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 18);
        g.rect(tr.dir > 0 ? 1 : W - 1.6, tr.row + 0.2, 0.6, 1.6, 1, 0.2, 0.1, 0.5 + 0.5 * pulse);
      }
    }

    // player
    if (this.state !== 'title') {
      const frame = Math.floor(this.time * (p.digging ? 14 : 9)) & 1;
      const idx = p.digging ? (frame ? S.PLAYER_DIG1 : S.PLAYER_DIG0) : (Math.abs(p.vx) > 0.1 || !p.onGround ? (frame ? S.PLAYER1 : S.PLAYER0) : S.PLAYER0);
      const blink = p.invuln > 0 && Math.floor(this.time * 12) % 2 === 0;
      g.quad(p.x - 0.5, p.y - 0.5, 1, 1, idx, 1, 1, 1, blink ? 0.35 : 1, p.facing < 0);
    }

    if (this.shield && this.state !== 'title') g.quad(p.x - 0.75, p.y - 0.75, 1.5, 1.5, S.RING, 0.5, 0.8, 1, 0.6 + 0.3 * Math.sin(this.time * 6));

    // particles (normal)
    for (const q of this.parts) if (!q.add) g.quad(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size, S.DOT, q.r, q.g, q.b, Math.min(1, q.life / q.max * 2));

    // ---- additive glow pass ----
    g.setAdditive(true);
    for (const q of this.parts) if (q.add) g.quad(q.x - q.size, q.y - q.size, q.size * 2, q.size * 2, S.GLOW, q.r, q.g, q.b, Math.min(1, q.life / q.max * 1.5));
    if (this.state !== 'title') g.quad(p.x - 3, p.y - 3, 6, 6, S.GLOW, 1, 0.9, 0.6, 0.16);
    for (let r = r0; r <= r1; r++) for (let c = Math.max(1, c0); c <= Math.min(W - 2, c1); c++) {
      if (w.get(c, r) === T.LAVA) g.quad(c - 0.8, r - 0.8, 2.6, 2.6, S.GLOW, 1, 0.45, 0.1, 0.2);
    }
    for (const f of this.falling) if (f.t === T.LAVA) g.quad(f.x - 1, f.y - 1, 3, 3, S.GLOW, 1, 0.5, 0.1, 0.5);
    for (const m of this.monsters) if (m.kind === 'beetle') g.quad(m.x - 1, m.y - 1, 2, 2, S.GLOW, 1, 0.45, 0.1, 0.3);
    if (this.speedT > 0 && this.state !== 'title') g.quad(p.x - 1.2, p.y - 1.2, 2.4, 2.4, S.GLOW, 0.7, 0.3, 1, 0.25 + 0.15 * Math.sin(this.time * 12));
    for (const tr of this.trains) {
      if (!tr.active || tr.row < r0 - 3 || tr.row > r1 + 3) continue;
      const hx = tr.dir > 0 ? tr.x + TRAIN_LEN : tr.x;
      g.quad(hx - 3, tr.row - 2, 6, 6, S.GLOW, 1, 0.95, 0.7, 0.55);
      g.quad(hx + (tr.dir > 0 ? 0 : -8), tr.row + 0.4, 8, 1.4, S.GLOW, 1, 0.95, 0.7, 0.35);
    }
    g.setAdditive(false);
    g.flush();
  }
}
