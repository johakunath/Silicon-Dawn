import { describe, expect, it } from 'vitest';
import { createState, hq, TICK } from '../src/sim/state';
import type { GameState } from '../src/sim/state';
import { checkObjectives, scoreEra, step, storageReserve } from '../src/sim/sim';
import { checkPlace, demolish, place } from '../src/sim/actions';
import { capexOf, keepLevel, liveByType, overdraftFloor, powerPrice, priceMul, unitEcon } from '../src/sim/economy';
import { BUILDING } from '../src/sim/data/buildings';
import { ERAS } from '../src/sim/data/eras';
import { FUNDING, GRANT_PER_ERA, PRICE, REFUND_GRACE, START_CREDITS } from '../src/sim/data/economy';
import { loadFromObject, loadFromString, migrate, migrationCredits, saveToString } from '../src/sim/save';
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

/** a fresh colony with plenty of materials and no exports, so credits only move by the rule under test */
function colony(): GameState {
  const s = createState(SEED);
  s.stock = { metal: 999, silicon: 999 };
  s.econ.sell = {};
  return s;
}

describe('capex and refunds', () => {
  it('building costs credits on top of materials', () => {
    const s = colony();
    const h = hq(s);
    const c0 = s.econ.credits;
    expect(c0).toBe(START_CREDITS.standard);
    const [x, y] = findSpot(s, 'solar', h.x + 5, h.y);
    place(s, 'solar', x, y);
    expect(s.econ.credits).toBe(c0 - capexOf(s, 'solar'));
    expect(s.econ.capex).toBe(capexOf(s, 'solar'));
  });
  it('blocks construction without enough credits and says so', () => {
    const s = colony();
    const h = hq(s);
    s.econ.credits = 10;
    const [x, y] = findSpot(s, 'pole', h.x + 5, h.y);
    expect(checkPlace(s, 'pole', x, y).ok).toBe(true); // 5 credits
    const c = checkPlace(s, 'solar', x, y);
    expect(c.ok).toBe(false);
    expect(c.reason).toMatch(/30 more credits/);
    expect(place(s, 'solar', x, y)).toBeNull();
  });
  it('refunds all credits right after building, half after the grace period; materials always 100%', () => {
    const s = colony();
    const h = hq(s);
    const c0 = s.econ.credits, m0 = s.stock.metal!;
    const [x, y] = findSpot(s, 'smelter', h.x + 5, h.y);
    const a = place(s, 'smelter', x, y, { autoLink: false })!;
    demolish(s, a.id);
    expect(s.econ.credits).toBe(c0);
    expect(s.stock.metal).toBe(m0);
    const b = place(s, 'smelter', x, y, { autoLink: false })!;
    b.built = s.time - REFUND_GRACE - 1;
    demolish(s, b.id);
    expect(s.econ.credits).toBe(c0 - capexOf(s, 'smelter') / 2);
    expect(s.stock.metal).toBe(m0);
  });
  it('difficulty scales capex', () => {
    expect(capexOf(createState(SEED, 'relaxed'), 'fab')).toBeLessThan(capexOf(createState(SEED, 'race'), 'fab'));
  });
});

describe('running costs and income', () => {
  it('the Core pays a stipend so an idle colony is never stuck at zero', () => {
    const s = colony();
    s.econ.credits = 0;
    run(s, 60);
    expect(s.econ.credits).toBeGreaterThan(25);
    expect(s.econ.income.stipend).toBeCloseTo(30, 0);
  });
  it('charges upkeep per minute for every building', () => {
    const s = colony();
    const h = hq(s);
    const [x, y] = findSpot(s, 'smelter', h.x + 5, h.y);
    place(s, 'smelter', x, y, { autoLink: false });
    run(s, 60);
    expect(s.econ.costs.upkeep).toBeCloseTo(1.5, 1);
  });
  it('power is cheap at noon and peaks at dusk; the daily average is about the base price', () => {
    expect(priceMul(0.77)).toBeGreaterThan(priceMul(0.5) * 2);
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += priceMul(i / 1000);
    expect(sum / 1000).toBeGreaterThan(0.8);
    expect(sum / 1000).toBeLessThan(1.2);
  });
  it('power drawn through the Core is bought at the time-of-day price', () => {
    const s = colony();
    const h = hq(s);
    const [x, y] = findSpot(s, 'furnace', h.x + 4, h.y);
    const f = place(s, 'furnace', x, y, { autoLink: false })!;
    f.inBuf.quartz = 50;
    rebuildGrids(s);
    s.time = 0.45 * 240; // ~night: tod 0.75, near the evening peak
    const p = powerPrice(s);
    run(s, 10);
    expect(s.econ.costs.power_bought).toBeGreaterThan(0);
    // about 3 power for 10 s at roughly the peak price
    expect(s.econ.costs.power_bought).toBeGreaterThan(3 * 10 * p * 0.5);
  });
  it('spilled solar surplus is sold to the colony grid', () => {
    const s = colony();
    const h = hq(s);
    s.econ.credits = 5000;
    for (let i = 0; i < 3; i++) { const [x, y] = findSpot(s, 'solar', h.x + 4, h.y + 1); place(s, 'solar', x, y); }
    s.time = 0.2 * 240; // tod 0.5, noon
    run(s, 10);
    expect(s.econ.income.power_sold).toBeGreaterThan(0);
  });
  it('gas turbines burn fuel when they run', () => {
    const s = colony();
    s.era = 3;
    const h = hq(s);
    s.econ.credits = 5000;
    const [gx, gy] = findSpot(s, 'gas', h.x - 4, h.y);
    place(s, 'gas', gx, gy);
    for (let i = 0; i < 4; i++) { const [x, y] = findSpot(s, 'furnace', h.x + 4, h.y + 2); const f = place(s, 'furnace', x, y, { autoLink: false })!; f.inBuf.quartz = 50; }
    rebuildGrids(s);
    s.time = 0.45 * 240; // night
    run(s, 10);
    expect(s.econ.costs.fuel).toBeGreaterThan(0);
  });
});

describe('exports', () => {
  it('sell stock above the keep level, and holding stops it', () => {
    const s = createState(SEED);
    s.stock = { metal: 1000 };
    const keep = keepLevel(s, 'metal');
    const c0 = s.econ.credits;
    run(s, 60);
    expect(s.stock.metal!).toBeLessThan(1000);
    expect(s.stock.metal!).toBeGreaterThanOrEqual(keep - 1e-6);
    expect(s.econ.income.exports).toBeCloseTo((1000 - s.stock.metal!) * PRICE.metal!, 3);
    expect(s.econ.credits).toBeGreaterThan(c0);
    const t = createState(SEED);
    t.stock = { metal: 1000 };
    t.econ.sell.metal = false;
    run(t, 60);
    expect(t.stock.metal).toBe(1000);
  });
  it('the keep level covers any building of the era, so selling never blocks construction', () => {
    const s = createState(SEED);
    expect(keepLevel(s, 'metal')).toBe(100);
    s.era = 5;
    expect(keepLevel(s, 'metal')).toBeGreaterThanOrEqual(BUILDING.engine.cost.metal!);
    expect(keepLevel(s, 'chips')).toBeGreaterThanOrEqual(BUILDING.engine.cost.chips!);
  });
  it('belts out of storage stop at a build reserve sized to the era', () => {
    const s = createState(SEED);
    expect(storageReserve(s, 'silicon')).toBe(40);
    s.era = 4;
    expect(storageReserve(s, 'silicon')).toBe(BUILDING.accfab.cost.silicon);
    expect(storageReserve(s, 'metal')).toBe(120); // capped
  });
});

describe('contracts, funding and emergency grants', () => {
  it('completed contracts pay credits', () => {
    const s = colony();
    s.era = 3;
    s.contracts.push({ id: 99, kind: 'training', title: 'Test', target: 100, duration: 300, t: 0, progress: 100, uptime: 1, reward: { rp: 1, items: {}, credits: 250 }, state: 'active', expires: 90 });
    const c0 = s.econ.credits;
    run(s, 1);
    expect(s.econ.income.contracts).toBe(250);
    expect(s.econ.credits).toBeGreaterThan(c0 + 240);
  });
  it('new contracts carry a credit reward', () => {
    const s = colony();
    s.era = 3;
    s.nextContractAt = 0;
    run(s, 1.1);
    expect(s.contracts.length).toBeGreaterThan(0);
    expect(s.contracts[0].reward.credits).toBeGreaterThan(0);
  });
  it('a new era pays a funding round', () => {
    const s = colony();
    for (const o of ERAS[0].objectives) s.done[o.id] = true;
    const c0 = s.econ.credits;
    checkObjectives(s);
    expect(s.era).toBe(2);
    expect(s.econ.credits).toBe(c0 + FUNDING[2]);
    expect(s.econ.income.funding).toBe(FUNDING[2]);
  });
  it('debt costs interest, and too much debt triggers an emergency grant', () => {
    const s = colony();
    s.econ.credits = -100;
    run(s, 10);
    expect(s.econ.costs.interest).toBeGreaterThan(0);
    s.econ.credits = overdraftFloor(s) - 50;
    run(s, 1);
    expect(s.econ.grants).toBe(1);
    expect(s.econ.credits).toBeGreaterThan(GRANT_PER_ERA * s.era - 5);
    expect(s.feed.some((f) => f.text.startsWith('Emergency grant'))).toBe(true);
  });
  it('an emergency grant lowers the era efficiency score', () => {
    const a = colony(), b = colony();
    b.econ.eraGrants = 1;
    scoreEra(a); scoreEra(b);
    expect(b.eraScores[0].efficiency).toBeLessThan(a.eraScores[0].efficiency);
    expect(b.econ.eraGrants).toBe(0);
  });
});

describe('unit economics', () => {
  it('a chip fab pays back, a battery never does on its own, racks report compute', () => {
    const s = createState(SEED);
    const fab = unitEcon(s, BUILDING.fab);
    expect(fab.payback).not.toBeNull();
    expect(fab.payback!).toBeGreaterThan(1);
    expect(unitEcon(s, BUILDING.battery).payback).toBeNull();
    expect(unitEcon(s, BUILDING.rack).compute).toBe(180);
  });
  it('live economics per type follow the real buildings', () => {
    const s = colony();
    const h = hq(s);
    const [x, y] = findSpot(s, 'smelter', h.x + 5, h.y);
    const sm = place(s, 'smelter', x, y)!;
    sm.inBuf.ore = 100;
    run(s, 5);
    const row = liveByType(s).find((r) => r.type === 'smelter')!;
    expect(row.count).toBe(1);
    expect(row.util).toBeGreaterThan(0.5);
    expect(row.value).toBeGreaterThan(0);
  });
});

describe('save v3', () => {
  it('round-trips the economy', () => {
    const s = colony();
    s.econ.credits = 1234.5;
    s.econ.sell.metal = true;
    const t = loadFromString(saveToString(s));
    expect(t.econ.credits).toBe(1234.5);
    expect(t.econ.sell.metal).toBe(true);
    run(s, 20); run(t, 20);
    expect(t.econ.credits).toBeCloseTo(s.econ.credits, 6);
  });
  it('migrates v2 saves with an account sized to the era', () => {
    const v3 = JSON.parse(saveToString(createState(SEED)));
    const v2: any = { ...v3, version: 2, era: 3 };
    delete v2.econ;
    expect(migrate(v2).version).toBe(3);
    const s = loadFromObject(v2);
    expect(s.econ.credits).toBe(migrationCredits(3));
    expect(s.econ.sell.metal).toBe(true);
  });
  it('rejects a damaged ledger', () => {
    const good = JSON.parse(saveToString(createState(SEED)));
    expect(() => loadFromObject({ ...good, econ: { credits: 'lots' } })).toThrow(/credits/);
    expect(() => loadFromObject({ ...good, econ: { ...good.econ, costs: { upkeep: 'x' } } })).toThrow(/ledger/);
  });
});
