// Versioned save schema with forward migrations.
import { BUILDING } from './data/buildings';
import { EVENT } from './data/events';
import { TECH } from './data/tech';
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

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const escMap: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const plain = (v: unknown, max = 80) => String(v ?? '').slice(0, max).replace(/[&<>"']/g, (c) => escMap[c]);

/**
 * Reject saves that would load into a broken or unsafe state (hand-edited, truncated or crafted files).
 * Throws with a player-readable reason; also normalises a few fields in place (dedupe, unknown ids).
 */
export function validateSave(d: SaveV2, worldSize: number) {
  const bad = (why: string): never => { throw new Error(`Save file is damaged (${why})`); };
  if (!d || typeof d !== 'object' || Array.isArray(d)) bad('not an object');
  if (!fin(d.seed)) bad('seed');
  if (!fin(d.time) || d.time < 0 || !fin(d.tick) || d.tick < 0) bad('time');
  if (!Number.isInteger(d.era) || d.era < 1 || d.era > 5) bad('era');
  if (!fin(d.nextId) || !fin(d.nextLinkId)) bad('ids');
  if (!Array.isArray(d.buildings) || !Array.isArray(d.links ?? [])) bad('lists');
  const ids = new Set<number>();
  let hqs = 0;
  for (const b of d.buildings) {
    const def = b && BUILDING[b.type];
    if (!def) bad('unknown building');
    if (!Number.isInteger(b.id) || ids.has(b.id)) bad('building id');
    if (!Number.isInteger(b.x) || !Number.isInteger(b.y) || b.x < 0 || b.y < 0 || b.x + def.size > worldSize || b.y + def.size > worldSize) bad('building position');
    if (!b.inBuf || typeof b.inBuf !== 'object' || !b.outBuf || typeof b.outBuf !== 'object') bad('building buffers');
    for (const v of [...Object.values(b.inBuf), ...Object.values(b.outBuf)]) if (!fin(v)) bad('building buffers');
    ids.add(b.id);
    if (b.type === 'hq') hqs++;
  }
  if (hqs !== 1) bad('Command Core');
  for (const l of d.links ?? []) if (!l || !fin(l.from) || !fin(l.to) || l.from === l.to) bad('link');
  for (const v of Object.values(d.stock ?? {})) if (!fin(v)) bad('stock');
  if (d.rp !== undefined && !fin(d.rp)) bad('research');
  // normalise: unknown/duplicate techs and events are dropped, free text is escaped
  d.techs = [...new Set((d.techs ?? []).filter((t) => typeof t === 'string' && TECH[t]))];
  d.events = (d.events ?? []).filter((e) => e && EVENT[e.id] && fin(e.t) && fin(e.dur) && fin(e.warn));
  d.contracts = (d.contracts ?? []).filter((c) => c && typeof c === 'object').map((c) => ({ ...c, title: plain(c.title) }));
  d.eraScores = (d.eraScores ?? []).slice(0, 5);
}

export function loadFromObject(raw: unknown): GameState {
  const d = migrate(raw);
  const world = generateWorld(d.seed);
  validateSave(d, world.size);
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
  for (const b of d.buildings) {
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
