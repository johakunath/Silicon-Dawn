import type { ActiveEvent, Building, Contract, Difficulty, ItemId, Link, TechEffects } from './types';
import { World, generateWorld } from './world';
import { Rng } from './rng';
import { BUILDING } from './data/buildings';

export const TICK = 0.1; // seconds per sim step
export const DAY_LENGTH = 240; // seconds per full day/night cycle

export interface GridInfo {
  id: number;
  gen: number;
  demand: number;
  sat: number;
  stored: number;
  capacity: number;
  nodes: number[];
  clean: number; // clean generation share
  avail: number; // generation available right now (variable + firm)
}

export interface FeedItem { t: number; text: string; kind: 'info' | 'good' | 'warn' | 'bad' | 'era'; x?: number; y?: number }

export interface EraScore { era: number; time: number; efficiency: number; reliability: number; footprint: number; grade: string }

export interface Stats {
  produced: Partial<Record<ItemId, number>>;
  consumed: Partial<Record<ItemId, number>>;
  spent: Partial<Record<ItemId, number>>;
  delivered: Partial<Record<ItemId, number>>;
  trainTotal: number;
  rpTotal: number;
  servedTotal: number;
  inferenceRate: number; // compute/s served last second (smoothed)
  trainRate: number;
  computeRate: number; // produced compute/s (smoothed)
  computeUsed: number; // delivered to sinks /s (smoothed)
  itPower: number; // smoothed
  facilityPower: number; // smoothed total consumption
  cleanGen: number;
  totalGen: number;
  emissions: number;
  // era accumulators
  eraEnergyIT: number;
  eraEnergyTotal: number;
  eraHealthyTime: number;
  eraPoweredTime: number;
  eraEmissions: number;
  eraGen: number;
  eraCleanGen: number;
  contractsDone: number;
  eraContractsDone: number;
  eventsSurvived: number;
  pueWindow: number[]; // last 60s PUE samples
}

export interface GameState {
  version: number;
  seed: number;
  difficulty: Difficulty;
  mode: 'campaign' | 'sandbox';
  time: number;
  tick: number;
  era: number;
  eraStart: number;
  done: Record<string, boolean>;
  world: World;
  occ: Int32Array;
  buildings: Building[];
  byId: Map<number, Building>;
  nextId: number;
  links: Link[];
  nextLinkId: number;
  stock: Partial<Record<ItemId, number>>;
  rp: number;
  techs: string[];
  fx: TechEffects;
  stats: Stats;
  grids: GridInfo[];
  gridEdges: [number, number][]; // building ids of node pairs (wires)
  gridDirty: boolean;
  rng: Rng;
  events: ActiveEvent[];
  nextEventAt: number;
  contracts: Contract[];
  nextContractAt: number;
  nextContractId: number;
  engine: { progress: number; accel: number; ignited: boolean; igniteTime: number };
  eraScores: EraScore[];
  flags: { campaignDone: boolean; sandboxUnlocked: boolean; tutorial: boolean };
  feed: FeedItem[];
  /** sim-side event hooks for UI/audio (drained by the client each frame) */
  signals: { kind: string; x?: number; y?: number; data?: unknown }[];
  pendingEra: number; // era just unlocked (UI shows banner), 0 none
  autoLink: boolean;
}

export const BASE_FX: TechEffects = {
  solarMul: 1, windMul: 1, conveyorMul: 1, dataMul: 1, extractMul: 1, refineMul: 1, computeMul: 1,
  coolingMul: 1, coolingPowerMul: 1, batteryMul: 1, eventResist: 0, autoRepair: 0, fiber: 0, fusion: 0,
  robots: 0, bufferMul: 1, heatTolerance: 0,
};

export function emptyStats(): Stats {
  return {
    produced: {}, consumed: {}, spent: {}, delivered: {}, trainTotal: 0, rpTotal: 0, servedTotal: 0, inferenceRate: 0, trainRate: 0, computeRate: 0, computeUsed: 0,
    itPower: 0, facilityPower: 0, cleanGen: 0, totalGen: 0, emissions: 0,
    eraEnergyIT: 0, eraEnergyTotal: 0, eraHealthyTime: 0, eraPoweredTime: 0, eraEmissions: 0, eraGen: 0, eraCleanGen: 0,
    contractsDone: 0, eraContractsDone: 0, eventsSurvived: 0, pueWindow: [],
  };
}

export const START_STOCK: Partial<Record<ItemId, number>> = { metal: 70, silicon: 30 };

export function newBuilding(id: number, type: string, x: number, y: number, t: number): Building {
  return {
    id, type, x, y, inBuf: {}, outBuf: {}, activity: 0, status: 'idle', heat: 0, grid: -1, powerSat: 0, charge: 0,
    mode: 'balanced', broken: 0, built: t, produced: 0, richness: 1, rx: 0, rxFiber: 0, rxQ: 0, rxT: 0, outQ: 1, outT: 1, outF: 1, boost: 1, pw: 0,
  };
}

export function createState(seed: number, difficulty: Difficulty = 'standard', mode: 'campaign' | 'sandbox' = 'campaign'): GameState {
  const world = generateWorld(seed);
  const s: GameState = {
    version: 2, seed, difficulty, mode, time: 0, tick: 0, era: mode === 'sandbox' ? 5 : 1, eraStart: 0, done: {},
    world, occ: new Int32Array(world.size * world.size), buildings: [], byId: new Map(), nextId: 1, links: [], nextLinkId: 1,
    stock: { ...START_STOCK }, rp: 0, techs: [], fx: { ...BASE_FX }, stats: emptyStats(), grids: [], gridEdges: [], gridDirty: true,
    rng: new Rng(seed ^ 0x5eed), events: [], nextEventAt: 300, contracts: [], nextContractAt: 60, nextContractId: 1,
    engine: { progress: 0, accel: 0, ignited: false, igniteTime: 0 }, eraScores: [],
    flags: { campaignDone: false, sandboxUnlocked: false, tutorial: true }, feed: [], signals: [], pendingEra: 0, autoLink: true,
  };
  if (mode === 'sandbox') {
    s.stock = { metal: 2000, silicon: 1200, chips: 600, accel: 80 };
    s.rp = 200;
  }
  // HQ at spawn
  const hq = newBuilding(s.nextId++, 'hq', world.cx - 1, world.cy - 1, 0);
  addBuildingRaw(s, hq);
  return s;
}

export function addBuildingRaw(s: GameState, b: Building) {
  const d = BUILDING[b.type];
  s.buildings.push(b);
  s.byId.set(b.id, b);
  for (let y = b.y; y < b.y + d.size; y++) for (let x = b.x; x < b.x + d.size; x++) s.occ[y * s.world.size + x] = b.id;
  s.gridDirty = true;
}

export function center(s: GameState, b: Building): [number, number] {
  const d = BUILDING[b.type];
  return [b.x + d.size / 2, b.y + d.size / 2];
}

export function hq(s: GameState): Building {
  return s.buildings.find((b) => b.type === 'hq')!;
}

export function countType(s: GameState, type: string): number {
  let n = 0;
  for (const b of s.buildings) if (b.type === type) n++;
  return n;
}

export function pushFeed(s: GameState, text: string, kind: FeedItem['kind'] = 'info', x?: number, y?: number) {
  s.feed.push({ t: s.time, text, kind, x, y });
  if (s.feed.length > 60) s.feed.shift();
}

export function signal(s: GameState, kind: string, x?: number, y?: number, data?: unknown) {
  s.signals.push({ kind, x, y, data });
  if (s.signals.length > 200) s.signals.shift();
}

export function diffMul(s: GameState) {
  switch (s.difficulty) {
    case 'relaxed': return { cost: 0.75, events: 0.5, contractTime: 1.5, eventSeverity: 0.6 };
    case 'race': return { cost: 1.1, events: 1.4, contractTime: 0.85, eventSeverity: 1.15 };
    default: return { cost: 1, events: 1, contractTime: 1, eventSeverity: 1 };
  }
}

/** Relaxed difficulty shifts the sun up so nights are much shorter than days. */
export function dayBias(s: { difficulty: Difficulty }): number { return s.difficulty === 'relaxed' ? 0.45 : 0; }

export function sunlight(tod: number, bias = 0): number {
  const elev = Math.sin((tod - 0.25) * Math.PI * 2) + bias;
  const t = Math.min(1, Math.max(0, (elev + 0.2) / 0.55));
  return t * t * (3 - 2 * t);
}

export function timeOfDay(s: GameState): number {
  // start at early morning
  return ((s.time / DAY_LENGTH) + 0.3) % 1;
}

export function windAt(s: GameState): number {
  const t = s.time;
  return 0.55 + 0.3 * Math.sin(t / 37) + 0.15 * Math.sin(t / 11 + 2) + 0.1 * Math.sin(t / 5.3 + 1);
}
