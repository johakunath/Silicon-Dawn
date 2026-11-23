// Colony economy data: prices, capex and upkeep per building, the power price curve.
// Tune balance here. Units: credits (¢). Power is in power units; energy in power-seconds.
import type { Difficulty, ItemId } from '../types';

export interface BuildingEcon {
  /** credits paid on construction, on top of the material cost */
  capex: number;
  /** credits per minute while the building stands (staff, spares, permits) */
  upkeep: number;
}

/** Credits per building. Materials stay the bill of materials; credits are hardware, labour and permits. */
export const ECON: Record<string, BuildingEcon> = {
  hq: { capex: 0, upkeep: 0 },
  // Era 1
  solar: { capex: 40, upkeep: 0.5 },
  pole: { capex: 5, upkeep: 0 },
  quarry: { capex: 30, upkeep: 1 },
  drill: { capex: 30, upkeep: 1 },
  furnace: { capex: 40, upkeep: 1.5 },
  smelter: { capex: 40, upkeep: 1.5 },
  battery: { capex: 60, upkeep: 0.5 },
  depot: { capex: 30, upkeep: 0.5 },
  junction: { capex: 2, upkeep: 0 },
  // Era 2
  pump: { capex: 30, upkeep: 1 },
  fab: { capex: 300, upkeep: 5 },
  rack: { capex: 60, upkeep: 1 },
  cooler: { capex: 80, upkeep: 1.5 },
  lab: { capex: 150, upkeep: 3 },
  service: { capex: 250, upkeep: 6 },
  // Era 3
  substation: { capex: 120, upkeep: 1 },
  gridbat: { capex: 300, upkeep: 3 },
  gas: { capex: 350, upkeep: 3 },
  chiller: { capex: 250, upkeep: 3 },
  hall: { capex: 900, upkeep: 8 },
  gateway: { capex: 300, upkeep: 4 },
  trainer: { capex: 800, upkeep: 8 },
  // Era 4
  raremine: { capex: 250, upkeep: 6 },
  accfab: { capex: 1200, upkeep: 12 },
  pod: { capex: 600, upkeep: 5 },
  switch: { capex: 60, upkeep: 1 },
  wind: { capex: 200, upkeep: 2 },
  robofab: { capex: 400, upkeep: 8 },
  hub: { capex: 300, upkeep: 5 },
  fusion: { capex: 3000, upkeep: 20 },
  // Era 5
  engine: { capex: 2500, upkeep: 0 },
};

/** Market price per unit. Exportable goods sell at this price; raw quartz and ore only value extractor output in the ledger. */
export const PRICE: Partial<Record<ItemId, number>> = { quartz: 0.5, ore: 0.4, metal: 1.5, silicon: 2, chips: 10, rare: 5, accel: 60, robots: 25 };
/** Items you can export, in ledger order. */
export const EXPORTABLE: ItemId[] = ['metal', 'silicon', 'chips', 'accel'];
/** Exports that are switched on in a new game. Accelerators are held by default (pods and the Dawn Engine need them). */
export const SELL_DEFAULT: Partial<Record<ItemId, boolean>> = { metal: true, silicon: true, chips: true, accel: false };
/** The stockpile always keeps at least this much per era number (era 3 keeps 3×), see keepLevel(). */
export const KEEP_PER_ERA: Partial<Record<ItemId, number>> = { metal: 100, silicon: 60, chips: 40, accel: 10 };
/** Exports sell at most this share of the surplus per second (min 2 units), so the market is not flooded at once. */
export const SELL_SHARE = 0.1;

/** Credits per power-second (energy) at the average time-of-day price. */
export const POWER_PRICE = 0.03;
/** Power you sell back pays this share of the current price (feed-in is cheaper than buying). */
export const FEED_IN = 0.5;
/** Gas turbine fuel, credits per power-second generated. Flat: fuel contracts do not follow the hour. */
export const FUEL_PRICE = 0.02;
/** Credits per unit of water pumped (colony water rights). */
export const WATER_PRICE = 0.04;
/** Water price multiplier during a water restriction. */
export const DROUGHT_WATER_MUL = 3;

/** Time-of-day price curve: [time of day 0..1, price multiplier]. Cheap at noon (solar glut), peak at dusk. */
export const PRICE_CURVE: [number, number][] = [
  [0, 0.8], [0.25, 0.9], [0.33, 1.15], [0.45, 0.5], [0.6, 0.4], [0.7, 0.9], [0.77, 1.9], [0.86, 1.6], [0.95, 0.9], [1, 0.8],
];

/** The Command Core's charter stipend, credits per second. Keeps a broke colony able to build a pole or two. */
export const STIPEND = 0.5;
/** Starting balance per difficulty. */
export const START_CREDITS: Record<Difficulty, number> = { relaxed: 700, standard: 500, race: 400 };
/** Funding round paid when an era starts: investors finance the next build-out. Revenue has to justify it later. */
export const FUNDING: Record<number, number> = { 2: 800, 3: 4500, 4: 6000, 5: 5000 };
export const SANDBOX_CREDITS = 100000;

/** Demolish within this many seconds of building: full credit refund. Later: REFUND_LATE of the credits. Materials always 100%. */
export const REFUND_GRACE = 120;
export const REFUND_LATE = 0.5;

/** Debt interest per minute while the balance is negative. */
export const INTEREST_PER_MIN = 0.03;
/** Emergency grant: when the balance falls below −OVERDRAFT_PER_ERA × era, the council resets it to +GRANT_PER_ERA × era. */
export const OVERDRAFT_PER_ERA = 250;
export const GRANT_PER_ERA = 100;
/** Each emergency grant in an era multiplies that era's efficiency score by this. */
export const GRANT_SCORE_MUL = 0.85;

/** Contract payouts: credits per unit of training, and per compute-second of inference served. */
export const CONTRACT_PAY = { training: 0.25, inference: 0.4 };
