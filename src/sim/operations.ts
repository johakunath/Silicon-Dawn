// Operations (E4): wear and breakdowns, service coverage, grid connection and power deals, depreciation.
// Pure and deterministic like the rest of src/sim: breakdowns roll on s.rng.
import { BUILDING } from './data/buildings';
import { POWER_PRICE } from './data/economy';
import {
  BREAK_AT_FULL, BREAK_TIME, DEPRECIATION_MIN, DR_ERA, DR_PAY, DR_PEAK, FIXED_ERA, FIXED_MUL, FIXED_TIME, GRID_COST, GRID_ERA,
  GRID_MAX, GRID_STEP, GRID_WAIT, HOT_WEAR_MUL, IDLE_WEAR, RESIDUAL, SERVICE_RESTORE, SERVICE_WEAR_MUL, WEAR_BY_CAT, WEAR_BY_TYPE,
} from './data/operations';
import { capexOf, priceMul, powerPrice } from './economy';
import { GameState, diffMul, pushFeed, signal, timeOfDay } from './state';
import type { Building } from './types';

// ───────── wear ─────────
/** Wear per minute at full activity for a building type (0 = it never wears). */
export function wearRate(type: string): number {
  if (type in WEAR_BY_TYPE) return WEAR_BY_TYPE[type];
  return WEAR_BY_CAT[BUILDING[type].cat] ?? 0;
}

/** Is this building a working maintenance source right now (Service Center, or a Robot Hub with robots)? */
function serviceRadius(b: Building): number {
  const d = BUILDING[b.type];
  if (b.broken > 0 || b.powerSat < 0.5) return 0;
  if (d.service) return d.service;
  if (d.hub && (b.inBuf.robots ?? 0) > 0) return d.hub;
  return 0;
}

/** Mark every building inside a working service radius. */
export function updateCoverage(s: GameState) {
  for (const b of s.buildings) b.serviced = false;
  for (const c of s.buildings) {
    const r = serviceRadius(c);
    if (r <= 0) continue;
    const cd = BUILDING[c.type];
    const cx = c.x + cd.size / 2, cy = c.y + cd.size / 2;
    for (const b of s.buildings) {
      if (b.serviced) continue;
      const d = BUILDING[b.type];
      if (Math.hypot(b.x + d.size / 2 - cx, b.y + d.size / 2 - cy) <= r) b.serviced = true;
    }
  }
}

/** Is tile (x, y) inside working service coverage? (overlay) */
export function serviceAt(s: GameState, x: number, y: number): boolean {
  for (const c of s.buildings) {
    const r = serviceRadius(c);
    if (r <= 0) continue;
    const cd = BUILDING[c.type];
    if (Math.hypot(x + 0.5 - (c.x + cd.size / 2), y + 0.5 - (c.y + cd.size / 2)) <= r) return true;
  }
  return false;
}

/** How hard a building worked last tick, 0..1, for wear. Generators count as busy while they deliver. */
function load(b: Building): number {
  const d = BUILDING[b.type];
  if (d.gen) return b.pw < -1e-6 ? 1 : 0;
  return Math.max(0, Math.min(1, b.activity));
}

/** Breakdown chance per second at this wear. */
export function breakChance(wear: number): number {
  return BREAK_AT_FULL * wear * wear * wear;
}

/** Once per second: coverage, wear, breakdowns. */
export function wearSecond(s: GameState) {
  updateCoverage(s);
  const sev = diffMul(s).eventSeverity;
  for (const b of s.buildings) {
    const rate = wearRate(b.type);
    if (rate <= 0 || b.broken > 0) continue;
    const d = BUILDING[b.type];
    let w = (rate / 60) * Math.max(IDLE_WEAR, load(b));
    if (d.it && b.heat > 1 + s.fx.heatTolerance) w *= HOT_WEAR_MUL;
    if (b.serviced) w = w * SERVICE_WEAR_MUL - SERVICE_RESTORE / 60;
    b.wear = Math.max(0, Math.min(1, b.wear + w));
    // the roll happens every second for every wearing building, so the rng sequence does not depend on wear
    const roll = s.rng.next();
    if (roll < breakChance(b.wear) * sev) {
      b.broken = BREAK_TIME;
      s.ops.breakdowns++;
      signal(s, 'break', b.x, b.y);
      breakNews(s, d.name, b);
    }
  }
}

/** One feed line per breakdown would flood the feed on a big base: the first one says what happened, later ones are summed up every 30 s. */
function breakNews(s: GameState, name: string, b: Building) {
  const o = s.ops;
  if (o.newsAt <= 0 || s.time - o.newsAt >= 30) {
    const more = o.newsPending > 0 ? ` (and ${o.newsPending} more since the last report)` : '';
    pushFeed(s, `✕ ${name} broke down, worn out${more}. Service Centers keep machines in range from wearing out (U shows coverage).`, 'bad', b.x, b.y);
    o.newsAt = s.time; o.newsPending = 0;
  } else o.newsPending++;
}

// ───────── grid connection and power deals ─────────
/** Power the Core can import from the colony grid right now. */
export function importCap(s: GameState): number {
  return BUILDING.hq.power + s.ops.gridLevel * GRID_STEP;
}

export function gridUpgradeCost(s: GameState): number {
  return Math.round(GRID_COST * (s.ops.gridLevel + 1) * diffMul(s).cost);
}

export function canUpgradeGrid(s: GameState): { ok: boolean; reason?: string } {
  if (s.mode !== 'sandbox' && s.era < GRID_ERA) return { ok: false, reason: `Unlocks in Era ${GRID_ERA}` };
  if (s.ops.gridReadyAt > 0) return { ok: false, reason: 'An upgrade is already in the queue' };
  if (s.ops.gridLevel >= GRID_MAX) return { ok: false, reason: 'The connection is at its maximum' };
  if (s.econ.credits < gridUpgradeCost(s)) return { ok: false, reason: 'Not enough credits' };
  return { ok: true };
}

/** Pay for a bigger grid connection; it arrives after the utility's wait. */
export function requestGridUpgrade(s: GameState): boolean {
  if (!canUpgradeGrid(s).ok) return false;
  const c = gridUpgradeCost(s);
  s.econ.credits -= c;
  s.econ.capex += c;
  s.ops.gridReadyAt = s.time + GRID_WAIT;
  pushFeed(s, `Grid connection upgrade ordered: +${GRID_STEP} import power in ${Math.round(GRID_WAIT / 60)} minutes.`, 'info');
  return true;
}

export function fixedActive(s: GameState): boolean {
  return s.ops.fixedUntil > s.time;
}

export function canSignFixed(s: GameState): { ok: boolean; reason?: string } {
  if (s.mode !== 'sandbox' && s.era < FIXED_ERA) return { ok: false, reason: `Unlocks in Era ${FIXED_ERA}` };
  if (fixedActive(s)) return { ok: false, reason: 'A contract is already running' };
  return { ok: true };
}

/** Sign a fixed-price import contract for FIXED_TIME seconds. */
export function signFixed(s: GameState): boolean {
  if (!canSignFixed(s).ok) return false;
  s.ops.fixedUntil = s.time + FIXED_TIME;
  pushFeed(s, `Fixed-price power contract signed for ${Math.round(FIXED_TIME / 60)} minutes.`, 'info');
  return true;
}

export function canEnrolDr(s: GameState): { ok: boolean; reason?: string } {
  if (s.mode !== 'sandbox' && s.era < DR_ERA) return { ok: false, reason: `Unlocks in Era ${DR_ERA}` };
  return { ok: true };
}

export function setDr(s: GameState, on: boolean): boolean {
  if (on && !canEnrolDr(s).ok) return false;
  s.ops.dr = on;
  return true;
}

/** Is curtailment in force this tick (enrolled and the price is at the peak)? */
export function drInForce(s: GameState): boolean {
  return s.ops.dr && priceMul(timeOfDay(s)) >= DR_PEAK;
}

/** Price paid for imported power right now, credits per power-second. */
export function importPrice(s: GameState): number {
  return fixedActive(s) ? POWER_PRICE * FIXED_MUL : powerPrice(s);
}

/** Curtailment payment per second while in force. */
export function drPayPerSec(s: GameState): number {
  return importCap(s) * POWER_PRICE * DR_PAY;
}

/** Once per tick, before the grids: set the curtailment flag. */
export function opsTick(s: GameState) {
  s.ops.drNow = drInForce(s);
}

/** Once per second: finish a queued grid upgrade, end an expired fixed-price contract. */
export function opsSecond(s: GameState) {
  const o = s.ops;
  if (o.gridReadyAt > 0 && s.time >= o.gridReadyAt) {
    o.gridReadyAt = 0;
    o.gridLevel++;
    s.gridDirty = true;
    pushFeed(s, `Grid connection upgraded: the Core can now import ${importCap(s)} power.`, 'good');
    signal(s, 'grid_upgrade');
  }
  if (o.fixedUntil > 0 && s.time >= o.fixedUntil) {
    o.fixedUntil = 0;
    pushFeed(s, 'The fixed-price power contract has ended; imports follow the hourly price again.', 'info');
  }
  wearSecond(s);
}

// ───────── depreciation (ledger only) ─────────
/** Book value of a building: straight line from capex to RESIDUAL × capex over DEPRECIATION_MIN minutes. */
export function bookValue(s: GameState, b: Building): number {
  const c = capexOf(s, b.type);
  const age = Math.max(0, (s.time - b.built) / 60);
  return c * Math.max(RESIDUAL, 1 - (age / DEPRECIATION_MIN) * (1 - RESIDUAL));
}

/** Total book value and depreciation per minute of everything standing. */
export function depreciation(s: GameState): { book: number; perMin: number } {
  let book = 0, perMin = 0;
  for (const b of s.buildings) {
    const c = capexOf(s, b.type);
    if (c <= 0) continue;
    const v = bookValue(s, b);
    book += v;
    if (v > c * RESIDUAL + 1e-9) perMin += (c * (1 - RESIDUAL)) / DEPRECIATION_MIN;
  }
  return { book, perMin };
}
