// Versioned save schema with forward migrations.
import { BUILDING } from './data/buildings';
import { Rng } from './rng';
import { linksChanged, recomputeFx } from './sim';
import { GameState, addBuildingRaw, emptyStats } from './state';
import type { Building } from './types';
import { generateWorld } from './world';

export const SAVE_VERSION = 2;

export interface SaveV2 {
  version: 2;
  seed: number;
  difficulty: GameState['difficulty'];
  mode: GameState['mode'];
  time: number;
  tick: number;
  era: number;
  eraStart: number;
  done: Record<string, boolean>;
  buildings: Building[];
  nextId: number;
  links: GameState['links'];
  nextLinkId: number;
  stock: GameState['stock'];
  rp: number;
  techs: string[];
  stats: GameState['stats'];
  rng: number;
  events: GameState['events'];
  nextEventAt: number;
  contracts: GameState['contracts'];
  nextContractAt: number;
  nextContractId: number;
  engine: GameState['engine'];
  eraScores: GameState['eraScores'];
  flags: GameState['flags'];
  autoLink: boolean;
  savedAt: string;
}

/**
 * Migrations: each takes a save of version N and returns version N+1.
 * v1 (pre-release dev format) used `inventory` instead of `stock`, `research` instead of `rp`,
 * and had no contracts/engine.
 */
const MIGRATIONS: Record<number, (d: any) => any> = {
  1: (d) => {
    const out = { ...d, version: 2 };
    out.stock = d.inventory ?? {};
    out.rp = d.research ?? 0;
    delete out.inventory; delete out.research;
    out.contracts = d.contracts ?? [];
    out.nextContractAt = d.nextContractAt ?? 60;
    out.nextContractId = d.nextContractId ?? 1;
    out.engine = d.engine ?? { progress: 0, accel: 0, ignited: false, igniteTime: 0 };
    out.eraScores = d.eraScores ?? [];
    out.flags = d.flags ?? { campaignDone: false, sandboxUnlocked: false, tutorial: true };
    out.autoLink = d.autoLink ?? true;
    return out;
  },
};

export function migrate(data: any): SaveV2 {
  if (!data || typeof data !== 'object') throw new Error('Not a save file');
  let v = data.version ?? 1;
  let d = data;
  if (v > SAVE_VERSION) throw new Error(`Save is from a newer version (${v})`);
  while (v < SAVE_VERSION) {
    const f = MIGRATIONS[v];
    if (!f) throw new Error(`No migration from v${v}`);
    d = f(d);
    v = d.version;
  }
  return d as SaveV2;
}

export function serialize(s: GameState): SaveV2 {
  return {
    version: 2, seed: s.seed, difficulty: s.difficulty, mode: s.mode, time: s.time, tick: s.tick, era: s.era, eraStart: s.eraStart,
    done: s.done, buildings: s.buildings, nextId: s.nextId, links: s.links, nextLinkId: s.nextLinkId, stock: s.stock, rp: s.rp,
    techs: s.techs, stats: s.stats, rng: s.rng.s, events: s.events, nextEventAt: s.nextEventAt, contracts: s.contracts,
    nextContractAt: s.nextContractAt, nextContractId: s.nextContractId, engine: s.engine, eraScores: s.eraScores, flags: s.flags,
    autoLink: s.autoLink, savedAt: new Date().toISOString(),
  };
}

export function saveToString(s: GameState): string {
  return JSON.stringify(serialize(s));
}

export function loadFromObject(raw: unknown): GameState {
  const d = migrate(raw);
  const world = generateWorld(d.seed);
  const s: GameState = {
    version: SAVE_VERSION, seed: d.seed, difficulty: d.difficulty ?? 'standard', mode: d.mode ?? 'campaign', time: d.time, tick: d.tick,
    era: d.era, eraStart: d.eraStart ?? 0, done: d.done ?? {}, world, occ: new Int32Array(world.size * world.size), buildings: [],
    byId: new Map(), nextId: d.nextId, links: (d.links ?? []).map((l) => ({ ...l })), nextLinkId: d.nextLinkId, stock: d.stock ?? {},
    rp: d.rp ?? 0, techs: d.techs ?? [], fx: undefined as any, stats: { ...emptyStats(), ...(d.stats ?? {}) }, grids: [], gridEdges: [],
    gridDirty: true, rng: new Rng(1), events: d.events ?? [], nextEventAt: d.nextEventAt ?? 300, contracts: d.contracts ?? [],
    nextContractAt: d.nextContractAt ?? 60, nextContractId: d.nextContractId ?? 1,
    engine: d.engine ?? { progress: 0, accel: 0, ignited: false, igniteTime: 0 }, eraScores: d.eraScores ?? [],
    flags: d.flags ?? { campaignDone: false, sandboxUnlocked: false, tutorial: true }, feed: [], signals: [], pendingEra: 0,
    autoLink: d.autoLink ?? true,
  };
  s.rng.s = d.rng >>> 0 || 1;
  for (const b of d.buildings ?? []) {
    if (!BUILDING[b.type]) continue;
    addBuildingRaw(s, { ...({ rxQ: 0, rxT: 0, outQ: 1, outT: 1, outF: 1, pw: 0 } as Partial<Building>), ...b } as Building);
  }
  s.links = s.links.filter((l) => s.byId.has(l.from) && s.byId.has(l.to));
  recomputeFx(s);
  linksChanged(s);
  return s;
}

export function loadFromString(json: string): GameState {
  return loadFromObject(JSON.parse(json));
}
