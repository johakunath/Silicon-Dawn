// Colony economy rules: capex, opex, income, exports, emergency grants, unit economics.
// Pure and deterministic like the rest of src/sim.
import { BUILDING, BUILDINGS } from './data/buildings';
import {
  CONTRACT_PAY, DROUGHT_WATER_MUL, ECON, EXPORTABLE, FEED_IN, FUEL_PRICE, FUNDING, GRANT_PER_ERA, INTEREST_PER_MIN, KEEP_PER_ERA,
  OVERDRAFT_PER_ERA, POWER_PRICE, PRICE, PRICE_CURVE, REFUND_GRACE, REFUND_LATE, SELL_SHARE, STIPEND, WATER_PRICE,
} from './data/economy';
import { GameState, diffMul, pushFeed, signal, timeOfDay } from './state';
import type { Building, BuildingDef, ItemId } from './types';

// ───────── prices ─────────
/** Price multiplier for a time of day (0..1, 0 = midnight). Linear between the curve points. */
export function priceMul(tod: number): number {
  const t = ((tod % 1) + 1) % 1;
  for (let i = 1; i < PRICE_CURVE.length; i++) {
    const [t1, v1] = PRICE_CURVE[i];
    if (t <= t1) {
      const [t0, v0] = PRICE_CURVE[i - 1];
      return v0 + ((v1 - v0) * (t - t0)) / Math.max(1e-9, t1 - t0);
    }
  }
  return PRICE_CURVE[PRICE_CURVE.length - 1][1];
}

/** Grid power price right now, credits per power-second. */
export function powerPrice(s: GameState): number {
  return POWER_PRICE * priceMul(timeOfDay(s));
}

function eventActive(s: GameState, id: string) {
  return s.events.some((e) => e.id === id && e.warn <= 0);
}

export function waterPrice(s: GameState): number {
  return WATER_PRICE * (eventActive(s, 'drought') ? DROUGHT_WATER_MUL : 1);
}

// ───────── capex ─────────
export function capexOf(s: GameState, type: string): number {
  return Math.round((ECON[type]?.capex ?? 0) * diffMul(s).cost);
}

/** Credits refunded when a building is demolished: all of it within the grace period, then a share (used hardware resells cheaper). */
export function refundOf(s: GameState, b: Building): number {
  const c = capexOf(s, b.type);
  return s.time - b.built <= REFUND_GRACE ? c : Math.floor(c * REFUND_LATE);
}

export function upkeepOf(type: string): number {
  return ECON[type]?.upkeep ?? 0;
}

/** Spend credits on construction. Callers check affordability first. */
export function payCapex(s: GameState, amount: number) {
  s.econ.credits -= amount;
  s.econ.capex += amount;
  if (s.econ.credits < s.econ.minCredits) s.econ.minCredits = s.econ.credits;
}

export function refundCapex(s: GameState, amount: number) {
  s.econ.credits += amount;
  s.econ.capex -= amount;
}

// ───────── exports ─────────
/** How much of an item the stockpile keeps before selling: enough to build any building of this era, and at least KEEP_PER_ERA × era. */
export function keepLevel(s: GameState, item: ItemId): number {
  const era = s.mode === 'sandbox' ? 5 : s.era;
  let maxCost = 0;
  for (const d of BUILDINGS) if (d.era <= era) maxCost = Math.max(maxCost, (d.cost[item] ?? 0) * diffMul(s).cost);
  const keep = Math.max((KEEP_PER_ERA[item] ?? 0) * era, maxCost * 1.25);
  return Math.ceil(keep / 10) * 10;
}

export function setSell(s: GameState, item: ItemId, on: boolean) {
  if (!EXPORTABLE.includes(item)) return;
  s.econ.sell[item] = on;
}

function sellSurplus(s: GameState) {
  for (const item of EXPORTABLE) {
    if (!s.econ.sell[item]) continue;
    const surplus = (s.stock[item] ?? 0) - keepLevel(s, item);
    if (surplus <= 1e-6) continue;
    const amount = Math.min(surplus, Math.max(2, surplus * SELL_SHARE));
    const credits = amount * (PRICE[item] ?? 0);
    s.stock[item] = (s.stock[item] ?? 0) - amount;
    s.econ.credits += credits;
    s.econ.income.exports += credits;
    s.econ.exported[item] = (s.econ.exported[item] ?? 0) + credits;
  }
}

// ───────── contracts ─────────
export function contractCredits(kind: 'training' | 'inference', target: number, duration: number): number {
  const v = kind === 'training' ? target * CONTRACT_PAY.training : target * duration * CONTRACT_PAY.inference;
  return Math.round(v / 10) * 10;
}

export function earnContract(s: GameState, credits: number) {
  s.econ.credits += credits;
  s.econ.income.contracts += credits;
}

/** Funding round at the start of an era (campaign only). */
export function fundEra(s: GameState, era: number) {
  const f = s.mode === 'campaign' ? FUNDING[era] ?? 0 : 0;
  if (f <= 0) return;
  s.econ.credits += f;
  s.econ.income.funding += f;
  pushFeed(s, `Funding round: investors put ${f} credits into Era ${era}. Make it pay back.`, 'good');
  signal(s, 'funding', undefined, undefined, f);
}

// ───────── per tick ─────────
export interface PowerFlows {
  /** power drawn from the colony grid at the Core this tick (power units) */
  imported: number;
  /** surplus power sold to the colony grid (power units) */
  exported: number;
  /** gas turbine output (power units) */
  gas: number;
  /** water pumped this tick (units) */
  water: number;
}

export function upkeepPerMin(s: GameState): number {
  let u = 0;
  for (const b of s.buildings) u += upkeepOf(b.type);
  return u;
}

/** Charge running costs and pay running income for one tick. */
export function econTick(s: GameState, dt: number, f: PowerFlows) {
  const e = s.econ;
  const price = powerPrice(s);
  const bought = f.imported * price * dt;
  const sold = f.exported * price * FEED_IN * dt;
  const fuel = f.gas * FUEL_PRICE * dt;
  const water = f.water * waterPrice(s);
  const upkeep = (upkeepPerMin(s) / 60) * dt;
  const interest = e.credits < 0 ? (-e.credits * INTEREST_PER_MIN / 60) * dt : 0;
  const stipend = STIPEND * dt;
  e.costs.power_bought += bought;
  e.costs.fuel += fuel;
  e.costs.water += water;
  e.costs.upkeep += upkeep;
  e.costs.interest += interest;
  e.income.power_sold += sold;
  e.income.stipend += stipend;
  e.credits += sold + stipend - bought - fuel - water - upkeep - interest;
  if (e.credits < e.minCredits) e.minCredits = e.credits;
}

export function overdraftFloor(s: GameState): number {
  return -OVERDRAFT_PER_ERA * s.era;
}

/** Once per second: sell export surplus, and bail out a colony that went too deep into debt. */
export function econSecond(s: GameState) {
  sellSurplus(s);
  const e = s.econ;
  if (e.credits < overdraftFloor(s)) {
    const grant = GRANT_PER_ERA * s.era - e.credits;
    e.credits += grant;
    e.income.grants += grant;
    e.grants++;
    e.eraGrants++;
    pushFeed(s, `Emergency grant: the colony council cleared your debt (+${Math.round(grant)} credits). This era's efficiency score drops.`, 'bad');
    signal(s, 'grant');
  }
}

// ───────── unit economics (ledger and tooltips) ─────────
export interface UnitEcon {
  /** credits on construction */
  capex: number;
  /** running cost per minute at full load: upkeep, power at the average price, fuel, water */
  opex: number;
  /** value of the output per minute at full load (export price, or average power price); 0 if it makes nothing sellable */
  value: number;
  /** minutes until the capex is paid back at full load, or null if it never pays back in credits */
  payback: number | null;
  /** compute per minute at full load (compute buildings) */
  compute: number;
}

/** Nameplate unit economics of a building type at 100% load and the average power price. */
export function unitEcon(s: GameState, d: BuildingDef, load = 1): UnitEcon {
  const capex = capexOf(s, d.id);
  const perMin = 60 * load;
  let opex = upkeepOf(d.id);
  let value = 0;
  if (d.power < 0) opex += -d.power * (0.15 + 0.85 * load) * POWER_PRICE * 60;
  if (d.gen === 'firm' && d.id === 'gas') opex += d.power * FUEL_PRICE * perMin;
  if (d.outputs?.water) opex += d.outputs.water * WATER_PRICE * perMin;
  if (d.power > 0 && d.gen && d.gen !== 'core') {
    const cf = d.gen === 'solar' ? 0.5 : d.gen === 'wind' ? 0.6 : 1; // typical capacity factor
    value += d.power * cf * POWER_PRICE * perMin;
  }
  for (const [it, r] of Object.entries(d.outputs ?? {}) as [ItemId, number][]) value += r * (PRICE[it] ?? 0) * perMin;
  for (const [it, r] of Object.entries(d.inputs ?? {}) as [ItemId, number][]) value -= r * (PRICE[it] ?? 0) * perMin;
  const compute = (d.outputs?.compute ?? 0) * perMin;
  const net = value - opex;
  const payback = value > 0 && net > 0 ? capex / net : null;
  return { capex, opex, value, payback, compute };
}

export interface TypeLive {
  type: string;
  count: number;
  /** average activity 0..1 */
  util: number;
  /** live running cost per minute (all buildings of the type) */
  opex: number;
  /** live output value per minute */
  value: number;
  capex: number;
  payback: number | null;
  /** compute per minute (compute buildings) */
  compute: number;
}

/** Live unit economics per building type, from the current state (average power price). */
export function liveByType(s: GameState): TypeLive[] {
  const by = new Map<string, Building[]>();
  for (const b of s.buildings) {
    if (b.type === 'hq') continue;
    const arr = by.get(b.type);
    if (arr) arr.push(b); else by.set(b.type, [b]);
  }
  const out: TypeLive[] = [];
  for (const [type, bs] of by) {
    const d = BUILDING[type];
    let util = 0, opex = 0, value = 0, compute = 0;
    for (const b of bs) {
      const a = Math.max(0, Math.min(1, b.activity));
      util += a;
      opex += upkeepOf(type);
      if (d.power < 0) opex += Math.max(0, b.pw) * POWER_PRICE * 60;
      if (type === 'gas') opex += d.power * a * FUEL_PRICE * 60;
      if (d.outputs?.water) opex += d.outputs.water * a * WATER_PRICE * 60;
      if (d.power > 0 && d.gen && d.gen !== 'core') value += Math.max(0, -b.pw) * POWER_PRICE * 60;
      for (const [it, r] of Object.entries(d.outputs ?? {}) as [ItemId, number][]) {
        if (it === 'compute') compute += r * a * 60 * s.fx.computeMul;
        else value += r * a * (PRICE[it] ?? 0) * 60;
      }
      for (const [it, r] of Object.entries(d.inputs ?? {}) as [ItemId, number][]) value -= r * a * (PRICE[it] ?? 0) * 60;
    }
    const capex = capexOf(s, type);
    const net = (value - opex) / bs.length;
    out.push({ type, count: bs.length, util: util / bs.length, opex, value, capex, payback: value > 0 && net > 0 ? capex / net : null, compute });
  }
  return out.sort((a, b) => b.opex - a.opex);
}

/** Colony-wide cost of compute: running cost of compute and cooling buildings per 1,000 compute produced. */
export function costPerKCompute(s: GameState): number | null {
  const rows = liveByType(s);
  let opex = 0, compute = 0;
  for (const r of rows) {
    const d = BUILDING[r.type];
    if (d.it || d.cat === 'cooling') opex += r.opex;
    compute += r.compute;
  }
  return compute > 1 ? (opex / compute) * 1000 : null;
}
