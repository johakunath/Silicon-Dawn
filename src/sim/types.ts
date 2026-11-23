// Core simulation types. Pure data, no DOM.

export type ItemId =
  | 'quartz' | 'ore' | 'silicon' | 'metal' | 'chips' | 'rare' | 'accel' | 'robots'
  | 'water' | 'coolant' | 'compute';

export type LinkKind = 'conveyor' | 'pipe' | 'cable' | 'fiber';

export type Biome = 0 | 1 | 2 | 3 | 4 | 5; // see BIOME enum in world.ts
export type Deposit = 0 | 1 | 2 | 3; // none, quartz, ore, rare

export type Cost = Partial<Record<ItemId, number>>;

export type BuildingCategory = 'core' | 'power' | 'extract' | 'refine' | 'logistics' | 'compute' | 'cooling' | 'workload' | 'special';

export interface BuildingDef {
  id: string;
  name: string;
  short: string; // 1-line role
  desc: string;
  era: number; // 1..5
  tech?: string; // tech required in addition to era
  cat: BuildingCategory;
  size: number; // footprint NxN
  cost: Cost;
  hotkey?: string;
  /** Negative = consumes power at full load; positive = generator nameplate. */
  power: number;
  /** generator profile */
  gen?: 'solar' | 'wind' | 'firm' | 'core';
  /** power node: coverage radius & wire reach */
  node?: { radius: number; reach: number };
  battery?: { capacity: number; rate: number };
  /** continuous recipe per second at 100% */
  inputs?: Partial<Record<ItemId, number>>;
  outputs?: Partial<Record<ItemId, number>>;
  /** extractor needs deposit under footprint */
  deposit?: Deposit;
  /** must be adjacent to water */
  needsWater?: boolean;
  /** storage drop point (HQ / depot) accepting these items */
  storage?: ItemId[];
  /** passes compute through (switch) with bandwidth/s */
  passthrough?: number;
  /** heat model: IT load that needs cooling via coolant input */
  it?: boolean;
  /** workload sink */
  workload?: 'research' | 'training' | 'inference' | 'engine';
  /** automation hub radius */
  hub?: number;
  /** maintenance coverage radius (Service Center; Robot Hubs also service their hub radius) */
  service?: number;
  emissions?: number; // footprint score penalty / s at full output
  unique?: boolean;
  /** belt/pipe junction: merges and splits any solid or fluid */
  junction?: boolean;
}

export interface Building {
  id: number;
  type: string;
  x: number;
  y: number;
  inBuf: Partial<Record<ItemId, number>>;
  outBuf: Partial<Record<ItemId, number>>;
  /** 0..1 how hard it worked last tick */
  activity: number;
  status: Status;
  statusItem?: ItemId;
  heat: number; // 0..1.5 (1 = throttle threshold)
  grid: number; // power component id, -1 = none
  powerSat: number; // satisfaction 0..1 last tick
  charge: number; // batteries
  mode: 'balanced' | 'training' | 'inference';
  broken: number; // seconds remaining broken (events)
  built: number; // sim time when built
  /** cumulative produced (for stats) */
  produced: number;
  /** extractor deposit fraction under footprint */
  richness: number;
  /** received compute this tick (workload sinks) */
  rx: number;
  rxFiber: number;
  /** compute quality tags: inference (Q) and training (T) multipliers carried along links */
  rxQ: number;
  rxT: number;
  outQ: number;
  outT: number;
  outF: number;
  /** extra per-type state */
  boost: number; // hub boost multiplier last tick
  /** power flow last tick: + draw, − generation */
  pw: number;
  /** 0..1 wear; breakdowns get likely near 1 */
  wear: number;
  /** hardware generation (pods built after Next-Gen Accelerators are 2) */
  tier: number;
  /** inside service coverage last second (derived, not saved meaningfully) */
  serviced: boolean;
}

export type Status =
  | 'ok' | 'idle' | 'no_power' | 'low_power' | 'no_input' | 'output_full'
  | 'overheat' | 'broken' | 'worn' | 'no_output_link' | 'charging' | 'discharging' | 'night' | 'calm';

export interface Link {
  id: number;
  from: number;
  to: number;
  item: ItemId;
  kind: LinkKind;
  length: number;
  capacity: number; // items/s
  /** moved this tick */
  moved: number;
  /** smoothed rate items/s */
  rate: number;
  state: 'idle' | 'ok' | 'saturated' | 'blocked';
  /** cumulative moved (render uses deltas to spawn packets) */
  total: number;
}

export interface Objective {
  id: string;
  text: string;
  /** progress 0..1 */
  progress: (s: import('./state').GameState) => number;
  hint?: string;
  guide?: string;
}

export interface EraDef {
  id: number;
  name: string;
  subtitle: string;
  intro: string;
  radius: number; // buildable radius around HQ
  objectives: Objective[];
  guide: string[]; // guide entry ids unlocked on start
}

export interface TechDef {
  id: string;
  name: string;
  branch: 'efficiency' | 'capacity' | 'reliability';
  era: number;
  cost: number; // research points
  requires?: string[];
  desc: string;
  effect: Partial<TechEffects>;
}

export interface TechEffects {
  solarMul: number;
  windMul: number;
  conveyorMul: number;
  dataMul: number;
  extractMul: number;
  refineMul: number;
  computeMul: number;
  coolingMul: number;
  coolingPowerMul: number;
  batteryMul: number;
  eventResist: number;
  autoRepair: number;
  fiber: number;
  fusion: number;
  robots: number;
  bufferMul: number;
  heatTolerance: number;
  /** 1 = pods built from now on are the next generation */
  podTier: number;
}

export interface EventDef {
  id: string;
  name: string;
  desc: string;
  era: number;
  duration: number;
  warn: string;
  icon: string;
}

export interface ActiveEvent {
  id: string;
  t: number; // remaining seconds
  dur: number;
  warn: number; // seconds of warning remaining before start (>0 = pending)
  x?: number; y?: number; // targeted location
}

export interface Contract {
  id: number;
  kind: 'training' | 'inference';
  title: string;
  target: number; // training: compute units; inference: compute/s
  duration: number; // inference: seconds to hold; training: deadline seconds
  t: number; // elapsed
  progress: number; // training: accumulated; inference: seconds held
  uptime: number; // inference 0..1 running
  reward: { rp: number; items: Cost; credits?: number };
  state: 'offered' | 'active' | 'done' | 'failed';
  expires: number; // offer expiry seconds
}

export type Difficulty = 'relaxed' | 'standard' | 'race';

// ───────── colony market (E3) ─────────
export type ModelSizeId = 'S' | 'M' | 'L';
export type MarketSegmentId = 'chat' | 'media' | 'code' | 'enterprise' | 'science';

/** A trained model on the shelf. Quality is absolute (frontier units); divide by the current frontier for the share. */
export interface Model {
  id: number;
  name: string;
  /** 'base' = the licensed open-weights model every colony starts with */
  size: ModelSizeId | 'base';
  quality: number;
  /** compute per query */
  cost: number;
  /** sim time it shipped */
  born: number;
  /** credits earned while deployed */
  earned: number;
}

export interface TrainingRun {
  name: string;
  size: ModelSizeId;
  target: number;
  progress: number;
  /** training units that arrived over fiber (quality bonus) */
  fiber: number;
}

/** Why demand went unserved: model too weak, reputation too low, no spare capacity for its latency, or not enough capacity. */
export type LostReason = 'model' | 'reputation' | 'latency' | 'capacity';

export interface SegmentLive {
  /** demand before reputation, queries/s */
  demand: number;
  served: number;
  /** credits per second earned and lost */
  revenue: number;
  lost: number;
  reason: LostReason | null;
  /** credits per query at the deployed model's quality */
  price: number;
}

export interface Market {
  open: boolean;
  openedAt: number;
  /** quality of the best rival model, grows every minute; 1 when the market opens */
  frontier: number;
  /** 0..1, follows gateway uptime */
  rep: number;
  /** last measured gateway uptime, -1 when no gateway is linked */
  uptime: number;
  models: Model[];
  /** deployed model id, 0 = none */
  deployed: number;
  nextModelId: number;
  /** Dawn-N counter */
  modelNo: number;
  shipped: number;
  run: TrainingRun | null;
  nextSize: ModelSizeId;
  autoDeploy: boolean;
  seg: Record<MarketSegmentId, SegmentLive>;
  /** gateway capacity in queries/s with the deployed model, share of it in use, latency ms */
  capacity: number;
  load: number;
  latency: number;
  /** smoothed credits per second earned and lost */
  revRate: number;
  lostRate: number;
  /** samples every 10 s: revenue ¢/min and the average price per query */
  history: { t: number; rev: number; price: number }[];
}
