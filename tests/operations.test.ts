import { describe, expect, it } from 'vitest';
import { createState, hq, newBuilding, TICK, addBuildingRaw } from '../src/sim/state';
import type { GameState } from '../src/sim/state';
import { recomputeFx, step } from '../src/sim/sim';
import { checkPlace, place, repair } from '../src/sim/actions';
import {
  bookValue, breakChance, canUpgradeGrid, depreciation, drInForce, fixedActive, gridUpgradeCost, importCap, importPrice, opsSecond,
  requestGridUpgrade, setDr, signFixed, updateCoverage, wearRate, wearSecond,
} from '../src/sim/operations';
import {
  BREAK_TIME, DEPRECIATION_MIN, DR_PEAK, FIXED_MUL, FIXED_TIME, GRID_STEP, GRID_WAIT, RESIDUAL, TIER2_COMPUTE, WEAR_AFTER_BREAKDOWN, WEAR_WARN,
} from '../src/sim/data/operations';
import { POWER_PRICE } from '../src/sim/data/economy';
import { BUILDING } from '../src/sim/data/buildings';
import { capexOf, priceMul } from '../src/sim/economy';
import { loadFromObject, loadFromString, migrate, saveToString } from '../src/sim/save';
import { rebuildGrids } from '../src/sim/power';

const SEED = 20261119;
const run = (s: GameState, seconds: number) => { for (let i = 0; i < Math.round(seconds / TICK); i++) step(s); };

function findSpot(s: GameState, type: string, cx: number, cy: number, r = 20): [number, number] {
  for (let d = 0; d <= r; d++) for (let y = cy - d; y <= cy + d; y++) for (let x = cx - d; x <= cx + d; x++) {
    if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== d) continue;
    if (checkPlace(s, type, x, y).ok) return [x, y];
  }
  throw new Error('no spot for ' + type);
}

function colony(era = 3): GameState {
  const s = createState(SEED);
  s.era = era;
  s.stock = { metal: 9999, silicon: 9999, chips: 9999, accel: 999 };
  s.econ.credits = 1e6;
  s.econ.sell = {};
  return s;
}

/** a building dropped in without power or links, for wear rules */
function raw(s: GameState, type: string, dx: number, dy: number) {
  const h = hq(s);
  const b = newBuilding(s.nextId++, type, h.x + dx, h.y + dy, s.time);
  addBuildingRaw(s, b);
  return b;
}

describe('wear and breakdowns', () => {
  it('busy machines wear faster than idle ones; poles and the Core never wear', () => {
    const s = colony();
    const a = raw(s, 'smelter', 8, 0), b = raw(s, 'smelter', 8, 4), p = raw(s, 'pole', 12, 0);
    for (let i = 0; i < 60; i++) { a.activity = 1; b.activity = 0; wearSecond(s); }
    expect(a.wear).toBeCloseTo(wearRate('smelter'), 3);
    expect(b.wear).toBeGreaterThan(0);
    expect(b.wear).toBeLessThan(a.wear / 3);
    expect(p.wear).toBe(0);
    expect(hq(s).wear).toBe(0);
    expect(wearRate('pole')).toBe(0);
  });

  it('breakdown risk is tiny when new and real when worn out', () => {
    expect(breakChance(0.2)).toBeLessThan(breakChance(1) / 100);
    const s = colony();
    const a = raw(s, 'smelter', 8, 0);
    a.wear = 1;
    let t = 0;
    while (a.broken <= 0 && t < 3000) { a.activity = 1; wearSecond(s); t++; }
    expect(a.broken).toBe(BREAK_TIME);
    expect(s.ops.breakdowns).toBe(1);
    expect(s.feed.some((f) => f.text.includes('broke down'))).toBe(true);
  });

  it('a field fix after a breakdown leaves the machine half worn', () => {
    const s = colony();
    const a = raw(s, 'smelter', 8, 0);
    a.wear = 1; a.broken = 0.05;
    step(s);
    expect(a.broken).toBe(0);
    expect(a.wear).toBe(WEAR_AFTER_BREAKDOWN);
  });

  it('a manual overhaul (R) costs metal and removes all wear, but only on a worn or broken machine', () => {
    const s = colony();
    const a = raw(s, 'smelter', 8, 0);
    a.wear = 0.1;
    expect(repair(s, a.id)).toBe(false);
    a.wear = 0.6;
    const m0 = s.stock.metal!;
    expect(repair(s, a.id)).toBe(true);
    expect(a.wear).toBe(0);
    expect(s.stock.metal).toBe(m0 - 10);
  });

  it('a worn machine outside coverage says so in its status', () => {
    const s = colony(1);
    const [x, y] = findSpot(s, 'solar', hq(s).x + 5, hq(s).y);
    const b = place(s, 'solar', x, y)!;
    s.time = 120 - 0.3 * 240; // noon
    b.wear = WEAR_WARN + 0.05;
    step(s);
    expect(b.status).toBe('worn');
  });

  it('hot IT equipment wears twice as fast', () => {
    const s = colony();
    const a = raw(s, 'rack', 8, 0), b = raw(s, 'rack', 10, 0);
    a.activity = b.activity = 1; a.heat = 0.5; b.heat = 1.3;
    wearSecond(s);
    expect(b.wear).toBeCloseTo(a.wear * 2, 9);
  });
});

describe('service coverage', () => {
  it('a powered Service Center maintains everything in range: wear is worked off and repairs go faster', () => {
    const s = colony(2);
    const h = hq(s);
    const [sx, sy] = findSpot(s, 'service', h.x + 4, h.y);
    const c = place(s, 'service', sx, sy)!;
    rebuildGrids(s);
    run(s, 1);
    const near = raw(s, 'smelter', 0, 5), far = raw(s, 'smelter', 40, 0);
    near.wear = far.wear = 0.5;
    near.activity = far.activity = 1;
    c.powerSat = 1;
    for (let i = 0; i < 60; i++) { near.activity = far.activity = 1; wearSecond(s); }
    expect(near.serviced).toBe(true);
    expect(far.serviced).toBe(false);
    expect(near.wear).toBeLessThan(0.5);
    expect(far.wear).toBeGreaterThan(0.5);
    // an unpowered centre does nothing
    c.powerSat = 0;
    updateCoverage(s);
    expect(near.serviced).toBe(false);
  });

  it('a Robot Hub with robots is a Service Center too', () => {
    const s = colony(4);
    const hub = raw(s, 'hub', 6, 0);
    const near = raw(s, 'smelter', 6, 4);
    hub.powerSat = 1;
    updateCoverage(s);
    expect(near.serviced).toBe(false);
    hub.inBuf.robots = 1;
    updateCoverage(s);
    expect(near.serviced).toBe(true);
  });
});

describe('grid connection and power deals', () => {
  it('a grid upgrade costs credits, waits in the queue, then raises what the Core can import', () => {
    const s = colony(3);
    const cap0 = importCap(s);
    const cost = gridUpgradeCost(s);
    const c0 = s.econ.credits;
    expect(requestGridUpgrade(s)).toBe(true);
    expect(s.econ.credits).toBe(c0 - cost);
    expect(canUpgradeGrid(s).ok).toBe(false); // one in the queue at a time
    s.time += GRID_WAIT - 1; opsSecond(s);
    expect(importCap(s)).toBe(cap0);
    s.time += 1; opsSecond(s);
    expect(importCap(s)).toBe(cap0 + GRID_STEP);
    expect(gridUpgradeCost(s)).toBeGreaterThan(cost);
    const e1 = colony(1);
    expect(canUpgradeGrid(e1).ok).toBe(false);
  });

  it('a fixed-price contract flattens the import price for its term', () => {
    const s = colony(3);
    s.time = (0.77 - 0.3) * 240; // dusk peak
    const peak = importPrice(s);
    expect(signFixed(s)).toBe(true);
    expect(importPrice(s)).toBeCloseTo(POWER_PRICE * FIXED_MUL);
    expect(importPrice(s)).toBeLessThan(peak);
    expect(signFixed(s)).toBe(false);
    s.time += FIXED_TIME + 1; opsSecond(s);
    expect(fixedActive(s)).toBe(false);
  });

  it('peak curtailment cuts imports at the dusk peak and pays for it; off-peak nothing changes', () => {
    const s = colony(3);
    // a consumer on the Core's grid with no other generation: only imports can power it
    const h = hq(s);
    const [x, y] = findSpot(s, 'lab', h.x + 3, h.y + 3, 4);
    place(s, 'lab', x, y);
    rebuildGrids(s);
    setDr(s, true);
    s.time = (0.77 - 0.3) * 240 - TICK;
    expect(priceMul(0.77)).toBeGreaterThanOrEqual(DR_PEAK);
    const pay0 = s.econ.income.curtailment;
    step(s);
    expect(drInForce(s)).toBe(true);
    expect(s.grids[h.grid].sat).toBe(0);
    expect(s.econ.income.curtailment).toBeGreaterThan(pay0);
    setDr(s, false);
    step(s);
    expect(s.grids[h.grid].sat).toBeGreaterThan(0);
    setDr(s, true);
    s.time = (0.5 - 0.3) * 240; // noon: not a peak
    step(s);
    expect(drInForce(s)).toBe(false);
    expect(s.grids[h.grid].sat).toBeGreaterThan(0);
    const e1 = colony(2);
    expect(setDr(e1, true)).toBe(false);
  });
});

describe('hardware tiers and depreciation', () => {
  it('pods built after Next-Gen Accelerators are tier 2 and make more compute; older pods stay tier 1', () => {
    const s = colony(4);
    const h = hq(s);
    const [x1, y1] = findSpot(s, 'pod', h.x + 6, h.y);
    const old = place(s, 'pod', x1, y1)!;
    s.techs.push('nextgen'); recomputeFx(s);
    const [x2, y2] = findSpot(s, 'pod', h.x + 10, h.y);
    const nu = place(s, 'pod', x2, y2)!;
    expect(old.tier).toBe(1);
    expect(nu.tier).toBe(2);
    expect(TIER2_COMPUTE).toBeGreaterThan(1);
  });

  it('book value falls in a straight line to a residual share', () => {
    const s = colony(3);
    const b = raw(s, 'hall', 8, 0);
    const c = capexOf(s, 'hall');
    expect(bookValue(s, b)).toBeCloseTo(c);
    s.time = (DEPRECIATION_MIN / 2) * 60;
    expect(bookValue(s, b)).toBeCloseTo(c * (1 - 0.5 * (1 - RESIDUAL)));
    s.time = DEPRECIATION_MIN * 120;
    expect(bookValue(s, b)).toBeCloseTo(c * RESIDUAL);
    expect(depreciation(s).perMin).toBe(0);
  });
});

describe('save v5', () => {
  it('round-trips wear, tiers and power deals', () => {
    const s = colony(4);
    const b = raw(s, 'smelter', 8, 0);
    b.wear = 0.42; b.tier = 2;
    requestGridUpgrade(s); setDr(s, true); signFixed(s);
    const t = loadFromString(saveToString(s));
    const tb = t.byId.get(b.id)!;
    expect(tb.wear).toBeCloseTo(0.42);
    expect(tb.tier).toBe(2);
    expect(t.ops.gridReadyAt).toBe(s.ops.gridReadyAt);
    expect(t.ops.dr).toBe(true);
    expect(t.ops.fixedUntil).toBe(s.ops.fixedUntil);
  });

  it('migrates v4 saves with new, unworn buildings and no deals', () => {
    const s = colony(3);
    raw(s, 'smelter', 8, 0);
    const v4: any = JSON.parse(saveToString(s));
    v4.version = 4;
    delete v4.ops;
    for (const b of v4.buildings) { delete b.wear; delete b.tier; }
    expect(migrate(v4).version).toBe(5);
    const t = loadFromObject(v4);
    expect(t.buildings.every((b) => b.wear === 0 && b.tier === 1)).toBe(true);
    expect(t.ops.gridLevel).toBe(0);
  });

  it('rejects impossible wear or grid levels', () => {
    const s = colony(3);
    const bad: any = JSON.parse(saveToString(s));
    bad.buildings[0].wear = 7;
    expect(() => loadFromObject(bad)).toThrow(/damaged/);
    const bad2: any = JSON.parse(saveToString(s));
    bad2.ops.gridLevel = -3;
    expect(() => loadFromObject(bad2)).toThrow(/damaged/);
  });

  it('the Service Center is data: cost, radius and upkeep', () => {
    expect(BUILDING.service.service).toBeGreaterThan(BUILDING.hub.hub!);
    expect(BUILDING.service.era).toBe(2);
  });
});
