import './style.css';
import { buildAtlas } from './atlas';
import { Renderer } from './gl';
import { Input } from './input';
import { GameAudio } from './audio';
import { Hud } from './hud';
import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = new Hud();

let gfx: Renderer;
try {
  gfx = new Renderer(canvas, buildAtlas());
} catch (err) {
  hud.showOverlay(`<h2>WebGL2 required</h2><p>${(err as Error).message}</p><p>Please use a recent Chrome, Firefox, Safari or Edge.</p>`);
  throw err;
}

const input = new Input(canvas, document.getElementById('touch')!);
const audio = new GameAudio();
const game = new Game(gfx, input, audio, hud);

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  game.dpr = dpr;
  gfx.resize(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr));
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 100));
resize();

// Audio must be unlocked inside a user gesture.
const unlock = () => { audio.init(); };
hud.overlayEl.addEventListener('pointerdown', (e) => { e.preventDefault(); unlock(); game.menuAction(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { if (game.state === 'playing') game.pause(); else if (game.state === 'paused') game.menuAction(); return; }
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  unlock();
});
canvas.addEventListener('pointerdown', unlock);

const muteBtn = document.getElementById('btn-mute')!;
function toggleMute() {
  audio.setMuted(!audio.muted);
  muteBtn.textContent = audio.muted ? '🔇' : '🔊';
  try { localStorage.setItem('digger.muted', audio.muted ? '1' : '0'); } catch { /* ignore */ }
}
muteBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); unlock(); toggleMute(); });
try { if (localStorage.getItem('digger.muted') === '1') { audio.setMuted(true); muteBtn.textContent = '🔇'; } } catch { /* ignore */ }

document.addEventListener('visibilitychange', () => { if (document.hidden) game.pause(); });

let last = performance.now();
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  game.update(dt);
  game.render(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
