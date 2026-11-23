// Versioned save schema with forward migrations.
import { BUILDING } from './data/buildings';
import { EVENT } from './data/events';
import { TECH } from './data/tech';
import { Rng } from './rng';
import { linksChanged, recomputeFx } from './sim';
import { COST_LINES, GameState, INCOME_LINES, addBuildingRaw, emptyStats, newEcon } from './state';
import type { Econ } from './state';
import { SEGMENT_IDS, emptySegment, newMarket } from './state';
import { MODEL_SIZES } from './data/market';
import type { Market, Model } from './types';
import { EXPORTABLE } from './data/economy';
import type { Building } from './types';
import { generateWorld } from './world';

export const SAVE_VERSION = 4;

export interface SaveV4 {
  version: 4;
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
  econ: Econ;
  market: Market;
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
  // v3 adds the colony economy. Older saves open an account sized to the era they reached,
  // so a late-game save is not stuck at the starting balance.
  2: (d) => {
    const out = { ...d, version: 3 };
    const era = Number.isInteger(d.era) && d.era >= 1 && d.era <= 5 ? d.era : 1;
    out.econ = newEcon(d.difficulty ?? 'standard', d.mode ?? 'campaign', d.mode === 'sandbox' ? undefined : migrationCredits(era));
    return out;
  },
  // v4 adds the colony market. It starts closed; a save in Era III or later opens it on the next second,
  // with the open baseline model deployed and a Dawn-1 run started.
  3: (d) => ({ ...d, version: 4, market: newMarket() }),
};

/** Starting balance for a save migrated from before the economy existed. */
export function migrationCredits(era: number): number {
  return 400 + 2000 * (era - 1);
}

export function migrate(data: any): SaveV4 {
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
  return d as SaveV4;
}

export function serialize(s: GameState): SaveV4 {
  return {
    version: 4, seed: s.seed, difficulty: s.difficulty, mode: s.mode, time: s.time, tick: s.tick, era: s.era, eraStart: s.eraStart,
    done: s.done, buildings: s.buildings, nextId: s.nextId, links: s.links, nextLinkId: s.nextLinkId, stock: s.stock, rp: s.rp, econ: s.econ, market: s.market,
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
export function validateSave(d: SaveV4, worldSize: number) {
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
  d.econ = cleanEcon(d.econ, d, bad);
  d.market = cleanMarket(d.market, bad);
  // normalise: unknown/duplicate techs and events are dropped, free text is escaped
  d.techs = [...new Set((d.techs ?? []).filter((t) => typeof t === 'string' && TECH[t]))];
  d.events = (d.events ?? []).filter((e) => e && EVENT[e.id] && fin(e.t) && fin(e.dur) && fin(e.warn));
  d.contracts = (d.contracts ?? []).filter((c) => c && typeof c === 'object').map((c) => ({ ...c, title: plain(c.title) }));
  d.eraScores = (d.eraScores ?? []).slice(0, 5);
}

/** Check the economy block and fill any missing totals; non-finite numbers mean a damaged save. */
function cleanEcon(e: any, d: SaveV4, bad: (why: string) => never): Econ {
  const base = newEcon(d.difficulty ?? 'standard', d.mode ?? 'campaign');
  if (e === undefined) return base;
  if (!e || typeof e !== 'object' || !fin(e.credits)) bad('credits');
  const num = (v: unknown, def = 0) => { if (v === undefined) return def; if (!fin(v)) bad('ledger'); return v as number; };
  const out: Econ = { ...base, credits: e.credits, capex: num(e.capex), grants: num(e.grants), eraGrants: num(e.eraGrants), minCredits: num(e.minCredits, e.credits) };
  for (const k of INCOME_LINES) out.income[k] = num(e.income?.[k]);
  for (const k of COST_LINES) out.costs[k] = num(e.costs?.[k]);
  // a saved sell map is taken as is (missing = hold); only a save without one gets the defaults
  if (e.sell && typeof e.sell === 'object') out.sell = {};
  for (const k of EXPORTABLE) {
    if (e.exported?.[k] !== undefined) out.exported[k] = num(e.exported[k]);
    if (typeof e.sell?.[k] === 'boolean') out.sell[k] = e.sell[k];
  }
  return out;
}

/** Check the market block: numbers must be finite, ids known; names are escaped. Missing parts get defaults. */
function cleanMarket(m: any, bad: (why: string) => never): Market {
  const out = newMarket();
  if (m === undefined) return out;
  if (!m || typeof m !== 'object') bad('market');
  const num = (v: unknown, def: number) => { if (v === undefined) return def; if (!fin(v)) bad('market'); return v as number; };
  out.open = m.open === true;
  out.openedAt = num(m.openedAt, 0);
  out.frontier = num(m.frontier, 1);
  if (out.frontier <= 0) bad('market');
  out.rep = Math.max(0, Math.min(1, num(m.rep, 0)));
  out.uptime = num(m.uptime, -1);
  out.nextModelId = num(m.nextModelId, 1);
  out.modelNo = num(m.modelNo, 1);
  out.shipped = num(m.shipped, 0);
  out.autoDeploy = m.autoDeploy !== false;
  if (MODEL_SIZES[m.nextSize as keyof typeof MODEL_SIZES]) out.nextSize = m.nextSize;
  out.models = (Array.isArray(m.models) ? m.models : []).filter((x: any) => x && typeof x === 'object').map((x: any): Model => {
    const size = x.size === 'base' || MODEL_SIZES[x.size as keyof typeof MODEL_SIZES] ? x.size : bad('model');
    if (!Number.isInteger(x.id) || !fin(x.quality) || !fin(x.cost) || x.cost <= 0) bad('model');
    return { id: x.id, name: plain(x.name, 40), size, quality: x.quality, cost: x.cost, born: num(x.born, 0), earned: num(x.earned, 0) };
  });
  out.deployed = out.models.some((x) => x.id === m.deployed) ? m.deployed : (out.models[0]?.id ?? 0);
  if (m.run && typeof m.run === 'object') {
    const r = m.run;
    if (!MODEL_SIZES[r.size as keyof typeof MODEL_SIZES]) bad('training run');
    out.run = { name: plain(r.name, 40), size: r.size, target: num(r.target, 1), progress: num(r.progress, 0), fiber: num(r.fiber, 0) };
    if (out.run.target <= 0) bad('training run');
  }
  for (const id of SEGMENT_IDS) {
    const L = m.seg?.[id];
    if (!L || typeof L !== 'object') { out.seg[id] = emptySegment(); continue; }
    const reason = ['model', 'reputation', 'latency', 'capacity'].includes(L.reason) ? L.reason : null;
    out.seg[id] = { demand: num(L.demand, 0), served: num(L.served, 0), revenue: num(L.revenue, 0), lost: num(L.lost, 0), reason, price: num(L.price, 0) };
  }
  out.capacity = num(m.capacity, 0); out.load = num(m.load, 0);
  out.latency = m.latency === null ? Infinity : num(m.latency, 0);
  out.revRate = num(m.revRate, 0); out.lostRate = num(m.lostRate, 0);
  out.history = (Array.isArray(m.history) ? m.history : []).filter((h: any) => h && fin(h.t) && fin(h.rev) && fin(h.price)).slice(-60);
  return out;
}

export function loadFromObject(raw: unknown): GameState {
  const d = migrate(raw);
  const world = generateWorld(d.seed);
  validateSave(d, world.size);
  const s: GameState = {
    version: SAVE_VERSION, seed: d.seed, difficulty: d.difficulty ?? 'standard', mode: d.mode ?? 'campaign', time: d.time, tick: d.tick,
    era: d.era, eraStart: d.eraStart ?? 0, done: d.done ?? {}, world, occ: new Int32Array(world.size * world.size), buildings: [],
    byId: new Map(), nextId: d.nextId, links: (d.links ?? []).map((l) => ({ ...l })), nextLinkId: d.nextLinkId, stock: d.stock ?? {},
    rp: d.rp ?? 0, econ: d.econ, market: d.market, techs: d.techs ?? [], fx: undefined as any, stats: { ...emptyStats(), ...(d.stats ?? {}) }, grids: [], gridEdges: [],
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
