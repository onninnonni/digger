// World grid, procedural generation, and tile metadata.
import { T } from './atlas';

export const W = 20;            // columns (including bedrock walls at 0 and W-1)
export const END_ROW = 1275;    // row where China begins
export const H = END_ROW + 40;  // total rows
export const KM_PER_ROW = 10;   // 1275 rows ≈ 12 750 km, roughly Earth's diameter
export const SPAWN_X = W / 2;

export const BAND_NAMES = ['Topsoil', 'Crust', 'Deep crust', 'Mantle', 'Outer core', 'Far side crust', 'China'];
export function band(r: number): number {
  if (r < 70) return 0; if (r < 260) return 1; if (r < 560) return 2; if (r < 950) return 3; if (r < 1120) return 4; if (r < END_ROW) return 5; return 6;
}

/** Dig hardness (seconds at base rate 1). Infinity = indestructible. */
export const HARD: number[] = [];
HARD[T.AIR] = 0; HARD[T.DIRT] = 1; HARD[T.GRASS] = 1; HARD[T.CLAY] = 1.6; HARD[T.ROCK] = 2.6; HARD[T.HARDROCK] = 4.2;
HARD[T.BEDROCK] = Infinity; HARD[T.GOLD] = 2.2; HARD[T.EMERALD] = 2.6; HARD[T.RUBY] = 3; HARD[T.DIAMOND] = 3.6; HARD[T.CRYSTAL] = 3.2;
HARD[T.LAVA] = Infinity; HARD[T.MAGMA] = 3; HARD[T.SAND] = 0.5; HARD[T.BOULDER] = 3.4; HARD[T.GAS] = 0.3; HARD[T.CONCRETE] = 3.8;
HARD[T.RAIL] = 0; HARD[T.TUNNEL] = 0; HARD[T.CRUMBLE] = 0.7; HARD[T.CHINA] = 1;

export const VALUE: number[] = [];
VALUE[T.GOLD] = 50; VALUE[T.EMERALD] = 120; VALUE[T.RUBY] = 250; VALUE[T.DIAMOND] = 400; VALUE[T.CRYSTAL] = 650;

export const GEM_NAME: string[] = [];
GEM_NAME[T.GOLD] = 'Gold'; GEM_NAME[T.EMERALD] = 'Emerald'; GEM_NAME[T.RUBY] = 'Ruby'; GEM_NAME[T.DIAMOND] = 'Diamond'; GEM_NAME[T.CRYSTAL] = 'Core crystal';

export const passable = (t: number) => t === T.AIR || t === T.RAIL || t === T.TUNNEL || t === T.LAVA;
export const solid = (t: number) => !passable(t);
export const diggable = (t: number) => solid(t) && HARD[t] < Infinity;
export const isGem = (t: number) => VALUE[t] !== undefined;
export const falls = (t: number) => t === T.SAND || t === T.BOULDER;
export const crumbly = (t: number) => t === T.DIRT || t === T.GRASS || t === T.CLAY || t === T.SAND || t === T.CHINA;

// ---- noise ----
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}
function fbm(x: number, y: number, seed: number): number {
  return vnoise(x, y, seed) * 0.6 + vnoise(x * 2.1 + 3.7, y * 2.1 + 1.3, seed + 7) * 0.3 + vnoise(x * 4.3 + 9.1, y * 4.3 + 5.5, seed + 13) * 0.1;
}

export class World {
  tiles = new Uint8Array(W * H);
  timer = new Float32Array(W * H);   // crumble countdown / lava flow timer
  energy = new Float32Array(W * H);  // lava energy (1 = fresh pocket)
  tunnels: number[] = [];            // top row of each subway tunnel

  constructor(public seed: number) {
    this.generate();
  }

  get(x: number, y: number): number {
    if (x < 0 || x >= W) return T.BEDROCK;
    if (y < 0) return T.AIR;
    if (y >= H) return T.BEDROCK;
    return this.tiles[y * W + x];
  }
  set(x: number, y: number, t: number) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = y * W + x;
    this.tiles[i] = t; this.timer[i] = 0; this.energy[i] = t === T.LAVA ? 1 : 0;
  }

  private genCell(x: number, r: number): number {
    const s = this.seed;
    if (x === 0 || x === W - 1) return T.BEDROCK;
    if (r < 4) return T.AIR;
    if (r === 4) return T.GRASS;
    if (r >= END_ROW) { if (r < END_ROW + 3) return T.CHINA; if (r >= H - 1) return T.BEDROCK; return T.AIR; }
    const b = band(r);
    const nRock = fbm(x * 0.11, r * 0.11, s + 1), nClay = fbm(x * 0.08, r * 0.06, s + 2);
    const nLava = fbm(x * 0.14, r * 0.14, s + 3), nCave = fbm(x * 0.12, r * 0.12, s + 4), nSand = fbm(x * 0.1, r * 0.1, s + 5);
    const u = hash2(x, r, s + 99);
    switch (b) {
      case 0:
        if (nCave > 0.80 && r > 12) return T.AIR;
        if (nSand > 0.74) return T.SAND;
        if (u < 0.015) return T.GOLD; if (u < 0.019) return T.EMERALD; if (u < 0.026) return T.BOULDER; if (u < 0.029 && r > 25) return T.GAS;
        if (nRock > 0.72) return T.ROCK;
        if (nClay > 0.6) return T.CLAY;
        return T.DIRT;
      case 1:
        if (nLava > 0.80) return T.LAVA;
        if (nCave > 0.79) return T.AIR;
        if (nSand > 0.76) return T.SAND;
        if (u < 0.02) return T.GOLD; if (u < 0.03) return T.EMERALD; if (u < 0.033) return T.RUBY; if (u < 0.045) return T.BOULDER; if (u < 0.052) return T.GAS;
        if (nRock > 0.78) return T.HARDROCK; if (nRock > 0.58) return T.ROCK;
        if (nClay > 0.62) return T.CLAY;
        return T.DIRT;
      case 2:
        if (nLava > 0.74) return T.LAVA;
        if (nCave > 0.80) return T.AIR;
        if (u < 0.015) return T.GOLD; if (u < 0.023) return T.RUBY; if (u < 0.028) return T.DIAMOND; if (u < 0.031) return T.EMERALD; if (u < 0.046) return T.BOULDER; if (u < 0.054) return T.GAS;
        if (nRock > 0.70) return T.HARDROCK; if (nRock > 0.36) return T.ROCK;
        if (nSand > 0.78) return T.SAND;
        return T.DIRT;
      case 3:
        if (nLava > 0.66) return T.LAVA;
        if (nCave > 0.80) return T.AIR;
        if (u < 0.012) return T.CRYSTAL; if (u < 0.02) return T.DIAMOND; if (u < 0.03) return T.RUBY; if (u < 0.04) return T.GOLD; if (u < 0.05) return T.BOULDER; if (u < 0.056) return T.GAS;
        if (nRock > 0.72) return T.HARDROCK; if (nRock > 0.5) return T.ROCK;
        return T.MAGMA;
      case 4:
        if (nLava > 0.64) return T.LAVA;
        if (nCave > 0.82) return T.AIR;
        if (u < 0.018) return T.CRYSTAL; if (u < 0.03) return T.DIAMOND; if (u < 0.036) return T.RUBY; if (u < 0.046) return T.BOULDER;
        if (nRock > 0.78) return T.BEDROCK; if (nRock > 0.45) return T.HARDROCK;
        return T.MAGMA;
      default: {
        const t = (r - 1120) / (END_ROW - 1120);
        if (nLava > 0.72 + 0.2 * t) return T.LAVA;
        if (nCave > 0.80) return T.AIR;
        if (u < 0.02) return T.GOLD; if (u < 0.03) return T.EMERALD; if (u < 0.035) return T.DIAMOND; if (u < 0.048) return T.BOULDER; if (u < 0.055) return T.GAS;
        if (nRock > 0.85 - 0.1 * t) return T.HARDROCK; if (nRock > 0.5 + 0.3 * t) return T.ROCK;
        if (nClay > 0.65) return T.CLAY;
        return T.DIRT;
      }
    }
  }

  private generate() {
    const s = this.seed;
    for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) this.tiles[r * W + x] = this.genCell(x, r);

    // Subway tunnels: two rows of track between two concrete slabs.
    const placeTunnels = (from: number, to: number, salt: number) => {
      let r = from;
      let k = 0;
      while (r < to) {
        this.tunnels.push(r);
        for (let x = 1; x < W - 1; x++) {
          this.tiles[(r - 1) * W + x] = T.CONCRETE;
          this.tiles[r * W + x] = T.TUNNEL;
          this.tiles[(r + 1) * W + x] = T.RAIL;
          this.tiles[(r + 2) * W + x] = T.CONCRETE;
        }
        r += 38 + Math.floor(hash2(k++, salt, s + 77) * 24);
      }
    };
    placeTunnels(28, 440, 1);
    placeTunnels(1138, 1245, 2);

    // Gentle start: a dirt column below the spawn, no lava near the surface.
    for (let r = 5; r < 10; r++) for (let x = SPAWN_X - 1; x <= SPAWN_X + 1; x++) this.tiles[r * W + x] = T.DIRT;
    for (let r = 5; r < 24; r++) for (let x = 1; x < W - 1; x++) { const i = r * W + x; if (this.tiles[i] === T.LAVA || this.tiles[i] === T.GAS) this.tiles[i] = T.DIRT; }

    for (let i = 0; i < this.tiles.length; i++) this.energy[i] = this.tiles[i] === T.LAVA ? 1 : 0;
  }
}
