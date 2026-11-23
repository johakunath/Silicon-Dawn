// Operations data: wear and breakdowns, service coverage, power deals, hardware tiers, depreciation. Tune here.
import type { BuildingCategory } from '../types';

/** Wear per minute at full activity, by category (1 = worn out). Idle machines age at IDLE_WEAR of this. */
export const WEAR_BY_CAT: Partial<Record<BuildingCategory, number>> = {
  extract: 0.05, refine: 0.05, compute: 0.06, cooling: 0.05, workload: 0.03, power: 0.03,
};
/** Per-type overrides (solar has no moving parts; poles, substations, the Core and capstones do not wear). */
export const WEAR_BY_TYPE: Record<string, number> = {
  solar: 0.015, battery: 0.02, gridbat: 0.02, gas: 0.06, wind: 0.04, fusion: 0.04,
  pole: 0, substation: 0, hq: 0, engine: 0, service: 0, hub: 0, depot: 0, junction: 0, switch: 0.02,
};
export const IDLE_WEAR = 0.2;
/** IT buildings running hotter than their throttle point wear this much faster. */
export const HOT_WEAR_MUL = 2;

/** Breakdown chance per second = BREAK_AT_FULL × wear³ (worn out: about one breakdown per 90 s). */
export const BREAK_AT_FULL = 1 / 90;
/** Seconds a breakdown lasts (Self-Healing Grid shortens it). */
export const BREAK_TIME = 30;
/** A field fix after a breakdown leaves the machine half worn; a manual repair (R) restores it fully. */
export const WEAR_AFTER_BREAKDOWN = 0.5;
/** Wear shown as a warning (badge and status) from this level up. */
export const WEAR_WARN = 0.8;

/** Inside service coverage: wear grows at this share and crews restore SERVICE_RESTORE per minute. */
export const SERVICE_WEAR_MUL = 0.25;
export const SERVICE_RESTORE = 0.12;
/** Broken buildings inside coverage are fixed this many times faster. */
export const SERVICE_REPAIR_MUL = 3;

/** Grid connection: each upgrade adds GRID_STEP import power at the Core after GRID_WAIT seconds. */
export const GRID_STEP = 20;
export const GRID_WAIT = 180;
/** Upgrade n (0-based) costs GRID_COST × (n + 1) credits. */
export const GRID_COST = 500;
export const GRID_MAX = 10;
export const GRID_ERA = 2;

/** Fixed-price power contract: imports cost FIXED_MUL × the average price for FIXED_TIME seconds, whatever the hour. */
export const FIXED_MUL = 1.1;
export const FIXED_TIME = 600;
export const FIXED_ERA = 2;

/** Peak curtailment (demand response): while the price multiplier is at least DR_PEAK the Core imports nothing,
 *  and the grid pays DR_PAY × the average price per power of connection per second. */
export const DR_PEAK = 1.4;
export const DR_PAY = 2.5;
export const DR_ERA = 3;

/** Next-generation accelerator pods (tech 'nextgen'): compute per pod × this, same power. Older pods keep working. */
export const TIER2_COMPUTE = 1.35;

/** Ledger depreciation: straight line over DEPRECIATION_MIN minutes down to a RESIDUAL share of capex. */
export const DEPRECIATION_MIN = 60;
export const RESIDUAL = 0.2;
