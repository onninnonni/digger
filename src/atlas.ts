// Procedurally generated texture atlas: every tile and sprite is drawn with Canvas2D
// at startup, so the game ships with zero image assets.

export const TILE_PX = 32;
export const ATLAS_PX = 512;
export const ATLAS_COLS = ATLAS_PX / TILE_PX;

export enum T {
  AIR = 0, DIRT, GRASS, CLAY, ROCK, HARDROCK, BEDROCK,
  GOLD, EMERALD, RUBY, DIAMOND, CRYSTAL,
  LAVA, MAGMA, SAND, BOULDER, GAS, CONCRETE, RAIL, TUNNEL, CRUMBLE, CHINA,
}

export enum S {
  WHITE = 31,
  PLAYER0 = 32, PLAYER1 = 33, PLAYER_DIG0 = 34, PLAYER_DIG1 = 35,
  TRAIN_HEAD = 36, TRAIN_BODY = 37, // each spans 2 cells vertically (36/52, 37/53)
  GLOW = 38, DOT = 39, LAVA2 = 40, FLAG = 41, DRIP = 42, PAGODA = 43,
}

function mulberry(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

export function buildAtlas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS_PX;
  const ctx = cv.getContext('2d')!;
  const rnd = mulberry(1337);
  const cell = (i: number): [number, number] => [(i % ATLAS_COLS) * TILE_PX, Math.floor(i / ATLAS_COLS) * TILE_PX];

  function noiseTile(i: number, base: [number, number, number], amp: number, streak = 0) {
    const [ox, oy] = cell(i);
    const img = ctx.createImageData(TILE_PX, TILE_PX);
    const d = img.data;
    for (let y = 0; y < TILE_PX; y++) {
      const rowN = streak ? (rnd() - 0.5) * 2 * streak : 0;
      for (let x = 0; x < TILE_PX; x++) {
        const n = (rnd() - 0.5) * 2 * amp + rowN;
        const k = (y * TILE_PX + x) * 4;
        d[k] = clamp255(base[0] + n); d[k + 1] = clamp255(base[1] + n * 0.9); d[k + 2] = clamp255(base[2] + n * 0.8); d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, ox, oy);
  }

  function at(i: number, fn: () => void) {
    const [ox, oy] = cell(i);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.beginPath(); ctx.rect(0, 0, TILE_PX, TILE_PX); ctx.clip();
    fn();
    ctx.restore();
  }

  function pebbles(n: number, color: string, rmin: number, rmax: number) {
    ctx.fillStyle = color;
    for (let k = 0; k < n; k++) {
      const r = rmin + rnd() * (rmax - rmin);
      ctx.beginPath(); ctx.ellipse(rnd() * 32, rnd() * 32, r * 1.3, r, rnd() * 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  function cracks(n: number, color: string, w = 1) {
    ctx.strokeStyle = color; ctx.lineWidth = w;
    for (let k = 0; k < n; k++) {
      ctx.beginPath();
      let x = rnd() * 32, y = rnd() * 32;
      ctx.moveTo(x, y);
      for (let s = 0; s < 4; s++) { x += (rnd() - 0.5) * 12; y += (rnd() - 0.5) * 12; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }

  function crystals(n: number, color: string, hi: string, size: number) {
    for (let k = 0; k < n; k++) {
      const cx = 5 + rnd() * 22, cy = 5 + rnd() * 22, s = size * (0.7 + rnd() * 0.6), a = rnd() * Math.PI;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.6, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.6, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = hi;
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.6, 0); ctx.lineTo(0, -s * 0.1); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // ---- ground tiles ----
  noiseTile(T.DIRT, [104, 66, 36], 14);
  at(T.DIRT, () => { pebbles(6, 'rgba(60,35,18,0.6)', 1, 2.2); pebbles(3, 'rgba(150,105,60,0.5)', 1, 1.6); });

  noiseTile(T.GRASS, [104, 66, 36], 14);
  at(T.GRASS, () => {
    ctx.fillStyle = '#4caa3a'; ctx.fillRect(0, 0, 32, 7);
    ctx.fillStyle = '#6fd14e'; for (let x = 0; x < 32; x += 3) ctx.fillRect(x, 0, 2, 2 + (rnd() * 4 | 0));
    ctx.fillStyle = '#2f7a28'; for (let x = 1; x < 32; x += 4) ctx.fillRect(x, 5, 2, 3);
  });

  noiseTile(T.CLAY, [166, 108, 70], 10, 12);
  at(T.CLAY, () => { ctx.fillStyle = 'rgba(120,70,40,0.35)'; for (let y = 3; y < 32; y += 9) ctx.fillRect(0, y + (rnd() * 3 | 0), 32, 2); });

  noiseTile(T.ROCK, [112, 112, 118], 12);
  at(T.ROCK, () => { pebbles(4, 'rgba(160,160,170,0.5)', 2, 4); cracks(3, 'rgba(40,40,48,0.7)'); });

  noiseTile(T.HARDROCK, [62, 62, 76], 10);
  at(T.HARDROCK, () => { pebbles(5, 'rgba(100,100,125,0.45)', 2, 4); cracks(4, 'rgba(20,20,30,0.8)', 1.5); cracks(2, 'rgba(140,140,170,0.35)'); });

  noiseTile(T.BEDROCK, [26, 26, 34], 6);
  at(T.BEDROCK, () => { cracks(5, 'rgba(0,0,0,0.6)', 2); pebbles(3, 'rgba(50,50,65,0.5)', 2, 5); });

  const gemBase = (i: number, c: [number, number, number]) => noiseTile(i, c, 11);
  gemBase(T.GOLD, [112, 112, 118]);
  at(T.GOLD, () => { pebbles(5, '#c99a1a', 2, 4); pebbles(6, '#ffd23f', 1.4, 3); pebbles(3, '#fff1a8', 0.6, 1.2); cracks(2, 'rgba(40,40,48,0.6)'); });
  gemBase(T.EMERALD, [112, 112, 118]);
  at(T.EMERALD, () => { crystals(4, '#1fb86e', '#8bffc8', 6); cracks(2, 'rgba(40,40,48,0.6)'); });
  gemBase(T.RUBY, [96, 90, 100]);
  at(T.RUBY, () => { crystals(4, '#e0203f', '#ff9db0', 6); cracks(2, 'rgba(40,40,48,0.6)'); });
  gemBase(T.DIAMOND, [80, 84, 100]);
  at(T.DIAMOND, () => { crystals(4, '#6fe3ff', '#ffffff', 6.5); cracks(2, 'rgba(30,30,48,0.6)'); });
  gemBase(T.CRYSTAL, [58, 28, 24]);
  at(T.CRYSTAL, () => { crystals(5, '#a64dff', '#ecc8ff', 7); cracks(2, 'rgba(255,120,40,0.4)'); });

  noiseTile(T.LAVA, [255, 96, 10], 18);
  at(T.LAVA, () => { pebbles(6, '#ffd000', 3, 6); pebbles(4, '#ff2e00', 2, 4); pebbles(3, '#fff3a0', 1, 2); });
  noiseTile(S.LAVA2, [255, 110, 20], 18);
  at(S.LAVA2, () => { pebbles(5, '#ffd000', 3, 7); pebbles(5, '#ff2e00', 2, 4); pebbles(2, '#fff3a0', 1, 2.5); });

  noiseTile(T.MAGMA, [58, 28, 24], 10);
  at(T.MAGMA, () => { cracks(4, 'rgba(255,110,30,0.55)', 1.2); cracks(3, 'rgba(20,8,6,0.8)', 1.5); pebbles(3, 'rgba(90,45,35,0.6)', 2, 4); });

  noiseTile(T.SAND, [214, 178, 106], 16);
  at(T.SAND, () => { pebbles(10, 'rgba(255,240,190,0.5)', 0.5, 1.2); pebbles(6, 'rgba(150,110,50,0.4)', 0.5, 1.2); });

  noiseTile(T.BOULDER, [104, 66, 36], 14);
  at(T.BOULDER, () => {
    const g = ctx.createRadialGradient(12, 11, 2, 16, 16, 15);
    g.addColorStop(0, '#9c9ca4'); g.addColorStop(0.7, '#5e5e66'); g.addColorStop(1, '#35353c');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(16, 16.5, 14.5, 13.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,28,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
    cracks(2, 'rgba(30,30,38,0.6)');
  });

  noiseTile(T.GAS, [92, 60, 34], 10);
  at(T.GAS, () => {
    ctx.fillStyle = 'rgba(120,255,80,0.35)'; ctx.fillRect(0, 0, 32, 32);
    for (let k = 0; k < 8; k++) {
      const r = 1.5 + rnd() * 3.5, x = rnd() * 32, y = rnd() * 32;
      ctx.fillStyle = 'rgba(170,255,120,0.55)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, Math.PI * 2); ctx.fill();
    }
  });

  noiseTile(T.CONCRETE, [142, 142, 134], 7);
  at(T.CONCRETE, () => {
    ctx.strokeStyle = 'rgba(60,60,58,0.8)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(1, 1, 30, 30);
    ctx.fillStyle = 'rgba(200,200,190,0.35)'; ctx.fillRect(3, 3, 26, 2);
    ctx.fillStyle = 'rgba(255,200,40,0.9)'; ctx.fillRect(2, 14, 28, 4);
    ctx.fillStyle = 'rgba(20,20,20,0.9)'; for (let x = 2; x < 30; x += 8) ctx.fillRect(x, 14, 4, 4);
  });

  at(T.TUNNEL, () => {
    ctx.fillStyle = '#17171c'; ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#2a2a33'; for (let x = 0; x < 32; x += 8) ctx.fillRect(x, 0, 7, 32);
    ctx.fillStyle = '#3c3c48'; ctx.fillRect(0, 2, 32, 3); ctx.fillRect(0, 8, 32, 2);
    ctx.fillStyle = '#ffe9a0'; ctx.fillRect(13, 5, 6, 2);
  });
  at(T.RAIL, () => {
    ctx.fillStyle = '#17171c'; ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#2a2a33'; for (let x = 0; x < 32; x += 8) ctx.fillRect(x, 0, 7, 32);
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(0, 24, 32, 8);
    ctx.fillStyle = '#5a4630'; for (let x = 1; x < 32; x += 7) ctx.fillRect(x, 22, 4, 10);
    ctx.fillStyle = '#9a9aa6'; ctx.fillRect(0, 21, 32, 2); ctx.fillRect(0, 27, 32, 2);
    ctx.fillStyle = '#d0d0dc'; ctx.fillRect(0, 21, 32, 1); ctx.fillRect(0, 27, 32, 1);
  });

  noiseTile(T.CRUMBLE, [104, 66, 36], 14);
  at(T.CRUMBLE, () => { cracks(6, 'rgba(10,5,2,0.85)', 1.6); pebbles(4, 'rgba(60,35,18,0.6)', 1, 2); });

  noiseTile(T.CHINA, [190, 40, 40], 10);
  at(T.CHINA, () => {
    ctx.fillStyle = '#ffd23f';
    const star = (cx: number, cy: number, r: number) => {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
    };
    star(10, 11, 7); star(22, 5, 2.5); star(25, 11, 2.5); star(24, 18, 2.5); star(20, 23, 2.5);
  });

  // ---- white + glow + dot ----
  at(S.WHITE, () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 32, 32); });
  at(S.GLOW, () => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
  });
  at(S.DOT, () => { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(16, 16, 13, 0, Math.PI * 2); ctx.fill(); });
  at(S.DRIP, () => {
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, 'rgba(255,200,40,0)'); g.addColorStop(0.5, 'rgba(255,120,20,0.9)'); g.addColorStop(1, 'rgba(255,60,0,1)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(20, 0); ctx.lineTo(22, 28); ctx.arc(16, 28, 6, 0, Math.PI); ctx.lineTo(10, 28); ctx.closePath(); ctx.fill();
  });

  // ---- player ----
  function player(i: number, frame: number, dig: boolean) {
    at(i, () => {
      const legOff = frame ? 3 : 0;
      ctx.fillStyle = '#2b2b33';
      ctx.fillRect(10, 24 + (frame ? 0 : 1), 5, 7 - (frame ? 0 : 1));
      ctx.fillRect(17, 24 + (frame ? 1 : 0), 5, 7 - (frame ? 1 : 0));
      ctx.fillStyle = '#1a1a20'; ctx.fillRect(9, 29 + (frame ? 0 : 1), 7, 2); ctx.fillRect(17, 29 + (frame ? 1 : 0), 7, 2);
      ctx.fillStyle = '#f08a1e'; ctx.fillRect(9, 14, 14, 11);
      ctx.fillStyle = '#c96a10'; ctx.fillRect(9, 14, 14, 2); ctx.fillRect(13, 16, 2, 9); ctx.fillRect(18, 16, 2, 9);
      ctx.fillStyle = '#f2c9a0'; ctx.fillRect(10, 6, 12, 9);
      ctx.fillStyle = '#222'; ctx.fillRect(17, 9, 2, 2); ctx.fillRect(13, 9, 2, 2);
      ctx.fillStyle = '#7a4a28'; ctx.fillRect(14, 13, 6, 1);
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.ellipse(16, 7, 8, 5, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(7, 6, 18, 2);
      ctx.fillStyle = '#fff8d0'; ctx.fillRect(18, 3, 4, 3);
      ctx.fillStyle = '#f2c9a0'; ctx.fillRect(22, 16 + legOff, 4, 4);
      ctx.fillStyle = '#8c8c96';
      const dx = dig ? 2 : 0;
      ctx.beginPath(); ctx.moveTo(23 + dx, 15 + legOff); ctx.lineTo(32, 18 + legOff); ctx.lineTo(23 + dx, 21 + legOff); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c8c8d2'; ctx.fillRect(23 + dx, 17 + legOff, 7, 1);
      ctx.fillStyle = '#44444c'; ctx.fillRect(21 + dx, 15 + legOff, 3, 6);
    });
  }
  player(S.PLAYER0, 0, false); player(S.PLAYER1, 1, false); player(S.PLAYER_DIG0, 0, true); player(S.PLAYER_DIG1, 1, true);

  // ---- train (2 cells tall) ----
  function trainPart(i: number, head: boolean) {
    const [ox, oy] = cell(i);
    ctx.save(); ctx.translate(ox, oy); ctx.beginPath(); ctx.rect(0, 0, 32, 64); ctx.clip();
    ctx.fillStyle = '#1b2a4a'; ctx.fillRect(0, 6, 32, 50);
    ctx.fillStyle = '#2d4a80'; ctx.fillRect(0, 6, 32, 8);
    ctx.fillStyle = '#e8b400'; ctx.fillRect(0, 36, 32, 5);
    ctx.fillStyle = '#9ad8ff'; if (head) { ctx.fillRect(14, 16, 16, 16); } else { ctx.fillRect(3, 16, 10, 16); ctx.fillRect(19, 16, 10, 16); }
    ctx.fillStyle = '#d7eeff'; if (head) ctx.fillRect(14, 16, 16, 3); else { ctx.fillRect(3, 16, 10, 3); ctx.fillRect(19, 16, 10, 3); }
    if (head) { ctx.fillStyle = '#ffe9a0'; ctx.fillRect(26, 44, 5, 5); ctx.fillStyle = '#fff'; ctx.fillRect(27, 45, 3, 3); ctx.fillStyle = '#e03030'; ctx.fillRect(28, 30, 4, 3); }
    ctx.fillStyle = '#111'; ctx.fillRect(2, 56, 10, 6); ctx.fillRect(20, 56, 10, 6);
    ctx.fillStyle = '#555'; ctx.fillRect(4, 58, 6, 2); ctx.fillRect(22, 58, 6, 2);
    ctx.restore();
  }
  trainPart(S.TRAIN_HEAD, true); trainPart(S.TRAIN_BODY, false);

  at(S.FLAG, () => {
    ctx.fillStyle = '#ccc'; ctx.fillRect(4, 2, 2, 30);
    ctx.fillStyle = '#de2910'; ctx.fillRect(6, 3, 22, 14);
    ctx.fillStyle = '#ffde00';
    ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 1.6 : 4; ctx.lineTo(11 + Math.cos(a) * rr, 10 + Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
    for (const [x, y] of [[17, 5], [19, 8], [19, 12], [17, 15]]) ctx.fillRect(x, y, 2, 2);
  });
  at(S.PAGODA, () => {
    ctx.fillStyle = '#7a1e1e';
    ctx.fillRect(11, 20, 10, 12); ctx.fillRect(9, 10, 14, 10);
    ctx.fillStyle = '#c8281e';
    for (const [y, w] of [[8, 16], [18, 13], [30, 10]]) { ctx.beginPath(); ctx.moveTo(16 - w, y + 2); ctx.lineTo(16, y - 4); ctx.lineTo(16 + w, y + 2); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = '#ffd23f'; ctx.fillRect(14, 24, 4, 8); ctx.fillRect(15, 2, 2, 4);
  });

  return cv;
}
