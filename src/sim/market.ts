// Colony market and model lifecycle (E3). Pure and deterministic like the rest of src/sim.
// Demand comes in five segments; Inference Gateways serve it with the deployed model; Training Cores make new models.
import {
  BASE_LATENCY, BASELINE, DEMAND_ERA, DEMAND_GROWTH, FIBER_BASE, FIBER_BONUS, FRONTIER_GROWTH, MODEL_SIZES, PRICE_Q_MAX, PRICE_Q_MIN,
  REP_FADE, REP_FLOOR, REP_START, REP_TAU, RUN_ERA, SEGMENTS, SHELF_MAX,
} from './data/market';
import type { SegmentDef } from './data/market';
import { BUILDING } from './data/buildings';
import { GameState, SEGMENT_IDS, emptySegment, pushFeed, signal } from './state';
import type { LostReason, MarketSegmentId, Model, ModelSizeId, SegmentLive } from './types';

/** The market opens with Era III in the campaign, at once in the sandbox. */
export function marketShouldOpen(s: GameState): boolean {
  return s.mode === 'sandbox' || s.era >= 3;
}

export function openMarket(s: GameState) {
  const m = s.market;
  if (m.open) return;
  m.open = true;
  m.openedAt = s.time;
  m.frontier = 1;
  m.rep = REP_START;
  const base: Model = { id: m.nextModelId++, name: BASELINE.name, size: 'base', quality: BASELINE.quality, cost: BASELINE.cost, born: s.time, earned: 0 };
  m.models.push(base);
  m.deployed = base.id;
  startRun(s);
  pushFeed(s, 'The colony market is open. Gateways now sell inference with your deployed model; a Training Core makes better ones.', 'info');
  signal(s, 'market_open');
}

export function minutesOpen(s: GameState): number {
  return Math.max(0, (s.time - s.market.openedAt) / 60);
}

/** Era used for demand and run sizes (the sandbox plays at Era V scale). */
function marketEra(s: GameState): number {
  return s.mode === 'sandbox' ? 5 : Math.min(5, Math.max(3, s.era));
}

export function runTarget(s: GameState, size: ModelSizeId): number {
  return MODEL_SIZES[size].train * (RUN_ERA[marketEra(s)] ?? 1);
}

function runName(no: number, size: ModelSizeId) {
  return `Dawn-${no}${MODEL_SIZES[size].suffix}`;
}

function startRun(s: GameState) {
  const m = s.market;
  m.run = { name: runName(m.modelNo, m.nextSize), size: m.nextSize, target: runTarget(s, m.nextSize), progress: 0, fiber: 0 };
}

/** Pick the size of the next training run. A run that has not started yet switches size at once. */
export function setNextSize(s: GameState, size: ModelSizeId) {
  const m = s.market;
  if (!MODEL_SIZES[size]) return;
  m.nextSize = size;
  if (m.run && m.run.progress <= 0) { m.run.size = size; m.run.name = runName(m.modelNo, size); m.run.target = runTarget(s, size); }
}

/** Training from this tick goes into the current run; `fiber` is the part that arrived over fiber. */
export function marketTrain(s: GameState, units: number, fiber: number) {
  const m = s.market;
  if (!m.open || !m.run || units <= 0) return;
  m.run.progress += units;
  m.run.fiber += fiber;
  if (m.run.progress >= m.run.target) shipModel(s);
}

/** Quality a run would ship at right now (absolute, frontier units). */
export function runQuality(s: GameState): number {
  const r = s.market.run;
  if (!r) return 0;
  const fiberShare = r.progress > 0 ? Math.min(1, r.fiber / r.progress) : 0;
  return s.market.frontier * MODEL_SIZES[r.size].quality * (FIBER_BASE + FIBER_BONUS * fiberShare);
}

function shipModel(s: GameState) {
  const m = s.market;
  const r = m.run!;
  const model: Model = { id: m.nextModelId++, name: r.name, size: r.size, quality: runQuality(s), cost: MODEL_SIZES[r.size].cost, born: s.time, earned: 0 };
  m.models.push(model);
  m.modelNo++;
  m.shipped++;
  pushFeed(s, `✓ Model shipped: ${model.name} at ${Math.round(share(s, model) * 100)}% of the frontier.`, 'good');
  signal(s, 'model_shipped', undefined, undefined, model.id);
  // trim the shelf: retire the oldest model that is not deployed
  while (m.models.length > SHELF_MAX) {
    const old = m.models.find((x) => x.id !== m.deployed && x.id !== model.id);
    if (!old) break;
    m.models = m.models.filter((x) => x !== old);
  }
  if (m.autoDeploy) autoDeploy(s);
  startRun(s);
}

/** Model quality as a share of the current frontier. */
export function share(s: GameState, model: Model): number {
  return model.quality / Math.max(1e-9, s.market.frontier);
}

export function deployedModel(s: GameState): Model | undefined {
  return s.market.models.find((x) => x.id === s.market.deployed);
}

export function deploy(s: GameState, id: number): boolean {
  const m = s.market;
  if (!m.models.some((x) => x.id === id) || m.deployed === id) return false;
  m.deployed = id;
  const model = deployedModel(s)!;
  pushFeed(s, `Deployed ${model.name} to the gateways.`, 'info');
  signal(s, 'model_deployed', undefined, undefined, id);
  return true;
}

/** Remove a model from the shelf. The deployed model cannot be retired. */
export function retire(s: GameState, id: number): boolean {
  const m = s.market;
  if (id === m.deployed || !m.models.some((x) => x.id === id)) return false;
  m.models = m.models.filter((x) => x.id !== id);
  return true;
}

export function setAutoDeploy(s: GameState, on: boolean) {
  s.market.autoDeploy = on;
  if (on) autoDeploy(s);
}

/** Deploy whichever shelf model would earn the most right now. */
function autoDeploy(s: GameState) {
  const m = s.market;
  // most revenue first; with no revenue at all (no gateway yet), the better model
  let best = deployedModel(s), bestRev = best ? estimate(s, best).revenue : -1;
  for (const x of m.models) {
    const rev = estimate(s, x).revenue;
    if (rev > bestRev + 1e-9 || (Math.abs(rev - bestRev) <= 1e-9 && best && x.quality > best.quality)) { best = x; bestRev = rev; }
  }
  if (best && best.id !== m.deployed) deploy(s, best.id);
}

// ───────── demand and serving ─────────
/** Raw demand of a segment in queries/s: base × era × growth since the market opened. */
export function segmentDemand(s: GameState, d: SegmentDef): number {
  const min = minutesOpen(s);
  return d.demand * (DEMAND_ERA[marketEra(s)] ?? 1) * (1 + (DEMAND_GROWTH + d.growth) * min);
}

/** Share of a segment's demand that stays with you at this reputation. */
export function repFactor(rep: number, d: SegmentDef): number {
  return REP_FLOOR + (1 - REP_FLOOR) * Math.max(0, Math.min(1, (rep - d.uptime + REP_FADE) / REP_FADE));
}

/** Highest gateway load that still meets this segment's latency. */
export function maxLoad(d: SegmentDef): number {
  return Number.isFinite(d.maxLatency) ? Math.max(0, 1 - BASE_LATENCY / d.maxLatency) : 1;
}

export function latencyAt(load: number): number {
  return load >= 0.999 ? Infinity : BASE_LATENCY / (1 - load);
}

export interface Allocation {
  seg: Record<MarketSegmentId, SegmentLive>;
  capacity: number;
  served: number;
  load: number;
  revenue: number;
  lost: number;
}

/**
 * Serve demand with `model` and `supply` compute/s at the gateways. Interactive segments need spare capacity
 * (latency grows with load), so serving them caps the total load. The scheduler tries every mix of segments
 * and keeps the one that earns the most, filling the best-paying segments first.
 */
export function allocate(s: GameState, model: Model | undefined, supply: number, rep: number): Allocation {
  const seg = Object.fromEntries(SEGMENT_IDS.map((id) => [id, emptySegment()])) as Record<MarketSegmentId, SegmentLive>;
  const capacity = model ? supply / model.cost : 0;
  const q = model ? share(s, model) : 0;
  const pm = Math.max(PRICE_Q_MIN, Math.min(PRICE_Q_MAX, q));
  const cand: { d: SegmentDef; want: number; price: number; uMax: number }[] = [];
  for (const d of SEGMENTS) {
    const L = seg[d.id];
    L.demand = segmentDemand(s, d);
    L.price = d.price * pm;
    const ok = !!model && q >= d.minQuality;
    const keep = ok ? L.demand * repFactor(rep, d) : 0;
    if (!ok) { L.lost = L.demand * L.price; L.reason = 'model'; continue; }
    L.lost = (L.demand - keep) * L.price;
    if (L.lost > 1e-9) L.reason = 'reputation';
    if (keep > 1e-9) cand.push({ d, want: keep, price: L.price, uMax: maxLoad(d) });
  }
  cand.sort((a, b) => b.price - a.price);
  let best = { mask: 0, rev: 0, served: 0, fill: [] as number[] };
  if (capacity > 1e-9) {
    for (let mask = 1; mask < 1 << cand.length; mask++) {
      let cap = Infinity;
      for (let i = 0; i < cand.length; i++) if (mask & (1 << i)) cap = Math.min(cap, cand[i].uMax);
      let left = cap * capacity, rev = 0, served = 0;
      const fill: number[] = [];
      for (let i = 0; i < cand.length; i++) {
        if (!(mask & (1 << i))) { fill.push(0); continue; }
        const x = Math.max(0, Math.min(cand[i].want, left));
        left -= x; rev += x * cand[i].price; served += x; fill.push(x);
      }
      if (rev > best.rev + 1e-9 || (Math.abs(rev - best.rev) <= 1e-9 && served > best.served)) best = { mask, rev, served, fill };
    }
  }
  const totalWant = cand.reduce((a, c) => a + c.want, 0);
  for (let i = 0; i < cand.length; i++) {
    const c = cand[i], L = seg[c.d.id];
    const x = best.fill[i] ?? 0;
    L.served = x;
    L.revenue = x * c.price;
    const miss = c.want - x;
    if (miss > 1e-6) {
      L.lost += miss * c.price;
      const why: LostReason = capacity > 1e-9 && totalWant <= capacity ? 'latency' : 'capacity';
      if (L.reason !== 'reputation' || miss * c.price > L.lost / 2) L.reason = why;
    }
  }
  const served = best.served;
  const revenue = best.rev;
  let lost = 0;
  for (const id of SEGMENT_IDS) lost += seg[id].lost;
  return { seg, capacity, served, load: capacity > 1e-9 ? served / capacity : 0, revenue, lost };
}

/** What a model would earn and serve right now with the current gateway supply (UI and auto-deploy). */
export function estimate(s: GameState, model: Model): Allocation {
  return allocate(s, model, s.stats.inferenceRate, s.market.rep);
}

/**
 * Gateway uptime: average over linked gateways of how much of their service runs, 0..1.
 * A breakdown or no compute arriving is down; a brownout counts by its depth (90% power = 90% up). -1 if none is linked.
 */
export function gatewayUptime(s: GameState): number {
  let linked = 0, up = 0;
  for (const b of s.buildings) {
    if (BUILDING[b.type].workload !== 'inference') continue;
    if (!s.links.some((l) => l.to === b.id && l.item === 'compute')) continue;
    linked++;
    if (b.broken > 0 || b.activity <= 0 || b.grid < 0) continue;
    up += Math.max(0, Math.min(1, b.powerSat));
  }
  return linked > 0 ? up / linked : -1;
}

/** Once per second: grow the frontier, follow uptime, sell inference, keep the best model deployed. */
export function marketSecond(s: GameState) {
  const m = s.market;
  if (!m.open) {
    if (marketShouldOpen(s)) openMarket(s);
    else return;
  }
  m.frontier *= 1 + FRONTIER_GROWTH[s.difficulty] / 60;
  m.uptime = gatewayUptime(s);
  if (m.uptime >= 0) m.rep += (m.uptime - m.rep) * (1 - Math.exp(-1 / REP_TAU));
  const model = deployedModel(s);
  const a = allocate(s, model, s.stats.inferenceRate, m.rep);
  m.seg = a.seg;
  m.capacity = a.capacity;
  m.load = a.load;
  m.latency = latencyAt(a.load);
  if (a.revenue > 0) {
    s.econ.credits += a.revenue;
    s.econ.income.market += a.revenue;
    if (model) model.earned += a.revenue;
  }
  const k = 1 - Math.exp(-1 / 20);
  m.revRate += (a.revenue - m.revRate) * k;
  m.lostRate += (a.lost - m.lostRate) * k;
  if (Math.round(s.time) % 10 === 0) {
    const price = a.served > 0 ? a.revenue / a.served : 0;
    m.history.push({ t: Math.round(s.time), rev: m.revRate * 60, price });
    if (m.history.length > 60) m.history.shift();
  }
  // auto-deploy re-checks every 30 s, so an aging model is swapped for a better one on the shelf
  if (m.autoDeploy && Math.round(s.time) % 30 === 0) autoDeploy(s);
}

/** Market revenue per minute (smoothed). */
export function revenuePerMin(s: GameState): number {
  return s.market.revRate * 60;
}

/** Minutes until a model drops below a share of the frontier, or 0 if it already has. */
export function minutesUntil(s: GameState, model: Model, minShare: number): number {
  const q = share(s, model);
  if (q < minShare) return 0;
  const g = FRONTIER_GROWTH[s.difficulty];
  return Math.log(q / minShare) / Math.log(1 + g);
}
