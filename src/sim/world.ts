// Procedural terrain: terraced height levels, biomes, deposits, props. Deterministic per seed.
import { fbm, hashTile, valueNoise } from './rng';

export const BIOME = { WATER: 0, GRASS: 1, DESERT: 2, TUNDRA: 3, ROCK: 4, FOREST: 5 } as const;
export const DEPOSIT = { NONE: 0, QUARTZ: 1, ORE: 2, RARE: 3 } as const;
export const PROP = { NONE: 0, TREE: 1, PINE: 2, ROCK: 3, CACTUS: 4, BUSH: 5 } as const;

export const MAP_SIZE = 128;
export const LEVEL_H = 0.55; // world units per terrace level

export interface World {
  seed: number;
  size: number;
  level: Uint8Array; // 0 = water, 1.. land terraces
  biome: Uint8Array;
  deposit: Uint8Array;
  prop: Uint8Array;
  wind: Float32Array; // local wind factor 0.6..1.6
  cx: number;
  cy: number; // spawn center (HQ top-left = cx-1, cy-1)
}

export function idx(w: World, x: number, y: number) {
  return y * w.size + x;
}
export function inBounds(w: World, x: number, y: number) {
  return x >= 0 && y >= 0 && x < w.size && y < w.size;
}

export function generateWorld(seed: number, size = MAP_SIZE): World {
  const n = size * size;
  const w: World = {
    seed, size,
    level: new Uint8Array(n), biome: new Uint8Array(n), deposit: new Uint8Array(n), prop: new Uint8Array(n),
    wind: new Float32Array(n), cx: size >> 1, cy: size >> 1,
  };
  const c = size / 2;
  const temp = new Float32Array(n), moist = new Float32Array(n), hgt = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (x - c) / c, dy = (y - c) / c;
      const d = Math.sqrt(dx * dx + dy * dy);
      let h = fbm(x / 34, y / 34, seed, 5);
      h += 0.35 * (fbm(x / 11, y / 11, seed + 9, 3) - 0.5);
      // continent falloff with a coastline
      h = h * 1.25 - Math.pow(Math.max(0, d - 0.25), 1.6) * 1.05 + 0.08;
      // spawn plateau: keep the centre gently raised & flat
      const sd = Math.hypot(x - c, y - c);
      if (sd < 14) h = h * (sd / 14) + 0.56 * (1 - sd / 14);
      hgt[i] = h;
      // north (low y) is cold, south hot; noise perturbs it
      temp[i] = 1 - y / size + (fbm(x / 26, y / 26, seed + 33, 3) - 0.5) * 0.55;
      moist[i] = fbm(x / 22, y / 22, seed + 77, 4);
    }
  }
  // lakes: carve a few inland basins, ensure a lake near spawn
  const lakeSeeds: [number, number, number][] = [[c + 10, c - 7, 4.2]];
  for (let k = 0; k < 6; k++) {
    const a = hashTile(k, 3, seed) * Math.PI * 2, r = 18 + hashTile(k, 5, seed) * 30;
    lakeSeeds.push([c + Math.cos(a) * r, c + Math.sin(a) * r, 3 + hashTile(k, 9, seed) * 4]);
  }
  for (const [lx, ly, lr] of lakeSeeds) {
    for (let y = Math.floor(ly - lr - 3); y <= ly + lr + 3; y++) {
      for (let x = Math.floor(lx - lr - 3); x <= lx + lr + 3; x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const dd = Math.hypot(x - lx, y - ly) + (valueNoise(x / 3, y / 3, seed + 5) - 0.5) * 2.5;
        if (dd < lr) hgt[y * size + x] = Math.min(hgt[y * size + x], 0.2);
      }
    }
  }
  // terrace levels by land-height percentiles → predictable, mostly low land with rarer peaks
  const land: number[] = [];
  for (let i = 0; i < n; i++) if (hgt[i] > 0.3) land.push(hgt[i]);
  land.sort((a, b) => a - b);
  const q = (p: number) => land[Math.min(land.length - 1, Math.floor(land.length * p))] ?? 1;
  const th = [q(0.34), q(0.64), q(0.81), q(0.91), q(0.965)];
  for (let i = 0; i < n; i++) {
    const h = hgt[i];
    let lvl = 0;
    if (h > 0.3) { lvl = 1; for (const t of th) if (h > t) lvl++; }
    w.level[i] = lvl;
    const x = i % size, y = (i / size) | 0;
    let b: number = BIOME.GRASS;
    if (lvl === 0) b = BIOME.WATER;
    else if (lvl >= 5) b = BIOME.ROCK;
    else if (temp[i] < 0.3) b = BIOME.TUNDRA;
    else if (temp[i] > 0.66 && moist[i] < 0.55) b = BIOME.DESERT;
    else if (moist[i] > 0.56) b = BIOME.FOREST;
    w.biome[i] = b;
    w.wind[i] = 0.7 + lvl * 0.12 + (b === BIOME.TUNDRA ? 0.25 : 0) + valueNoise(x / 9, y / 9, seed + 41) * 0.2;
  }
  // flatten spawn 9x9 area to level 2 grass
  for (let y = w.cy - 5; y <= w.cy + 5; y++) for (let x = w.cx - 5; x <= w.cx + 5; x++) {
    const i = y * size + x;
    w.level[i] = 2; w.biome[i] = BIOME.GRASS;
  }
  // deposits: clustered blobs, biome-biased
  const placeCluster = (kind: number, x0: number, y0: number, r: number) => {
    for (let y = Math.floor(y0 - r); y <= y0 + r; y++) for (let x = Math.floor(x0 - r); x <= x0 + r; x++) {
      if (!inBounds(w, x, y)) continue;
      const i = y * size + x;
      if (w.level[i] === 0) continue;
      const dd = Math.hypot(x - x0, y - y0) + (hashTile(x, y, seed + kind) - 0.5) * 1.6;
      if (dd < r) w.deposit[i] = kind;
    }
  };
  // guaranteed starter deposits near spawn
  placeCluster(DEPOSIT.QUARTZ, c - 8, c + 2, 2.6);
  placeCluster(DEPOSIT.ORE, c + 3, c + 8, 2.6);
  placeCluster(DEPOSIT.QUARTZ, c + 7, c + 3, 1.8);
  placeCluster(DEPOSIT.ORE, c - 4, c - 9, 2.2);
  for (let k = 0; k < 75; k++) {
    const x = Math.floor(hashTile(k, 11, seed) * size), y = Math.floor(hashTile(k, 13, seed) * size);
    const i = y * size + x;
    if (w.level[i] === 0) continue;
    const dist = Math.hypot(x - c, y - c);
    if (dist < 9) continue;
    const b = w.biome[i];
    const roll = hashTile(k, 17, seed);
    let kind: number = roll < 0.5 ? DEPOSIT.QUARTZ : DEPOSIT.ORE;
    if (b === BIOME.DESERT && roll < 0.75) kind = DEPOSIT.QUARTZ;
    if ((b === BIOME.ROCK || w.level[i] >= 4) && roll < 0.6) kind = DEPOSIT.ORE;
    if ((b === BIOME.TUNDRA || b === BIOME.ROCK) && dist > 22 && roll > 0.55) kind = DEPOSIT.RARE;
    if (dist > 34 && roll > 0.88) kind = DEPOSIT.RARE;
    placeCluster(kind, x, y, 1.3 + hashTile(k, 19, seed) * 1.5);
  }
  // guarantee rare earth within reach for era 4
  placeCluster(DEPOSIT.RARE, c - 22, c - 20, 2.5);
  placeCluster(DEPOSIT.RARE, c + 26, c - 16, 2.2);
  // props (decorative; cleared automatically when building)
  for (let i = 0; i < n; i++) {
    if (w.level[i] === 0 || w.deposit[i]) continue;
    const x = i % size, y = (i / size) | 0;
    if (Math.abs(x - w.cx) <= 6 && Math.abs(y - w.cy) <= 6) continue;
    const r = hashTile(x, y, seed + 300);
    const b = w.biome[i];
    if (b === BIOME.FOREST && r < 0.42) w.prop[i] = PROP.TREE;
    else if (b === BIOME.GRASS && r < 0.07) w.prop[i] = r < 0.04 ? PROP.TREE : PROP.BUSH;
    else if (b === BIOME.TUNDRA && r < 0.18) w.prop[i] = PROP.PINE;
    else if (b === BIOME.DESERT && r < 0.05) w.prop[i] = r < 0.025 ? PROP.CACTUS : PROP.ROCK;
    else if (b === BIOME.ROCK && r < 0.12) w.prop[i] = PROP.ROCK;
  }
  return w;
}

export function isWaterAdjacent(w: World, x: number, y: number, s: number): boolean {
  for (let yy = y - 1; yy <= y + s; yy++) for (let xx = x - 1; xx <= x + s; xx++) {
    if (!inBounds(w, xx, yy)) continue;
    if (xx >= x && xx < x + s && yy >= y && yy < y + s) continue;
    if (w.level[idx(w, xx, yy)] === 0) return true;
  }
  return false;
}
