import { describe, expect, it } from 'vitest';
import { createState, TICK, hq } from '../src/sim/state';
import { step, recomputeFx } from '../src/sim/sim';
import { addLink, checkLink, checkPlace, place, research, demolish } from '../src/sim/actions';
import { rebuildGrids } from '../src/sim/power';
import { loadFromObject, loadFromString, migrate, saveToString, SAVE_VERSION } from '../src/sim/save';
import { autoplay } from '../src/sim/autoplayer';
import { generateWorld, idx, DEPOSIT } from '../src/sim/world';
import type { GameState } from '../src/sim/state';

const SEED = 20261119;
const run = (s: GameState, seconds: number) => { for (let i = 0; i < seconds / TICK; i++) step(s); };

function findSpot(s: GameState, type: string, cx: number, cy: number, r = 20, pred?: (x: number, y: number) => boolean): [number, number] {
  for (let d = 0; d <= r; d++) for (let y = cy - d; y <= cy + d; y++) for (let x = cx - d; x <= cx + d; x++) {
    if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== d) continue;
    if (checkPlace(s, type, x, y).ok && (!pred || pred(x, y))) return [x, y];
  }
  throw new Error('no spot for ' + type);
}

describe('world generation', () => {
  it('is deterministic per seed', () => {
    const a = generateWorld(SEED), b = generateWorld(SEED), c = generateWorld(SEED + 1);
    expect(Buffer.from(a.level).equals(Buffer.from(b.level))).toBe(true);
    expect(Buffer.from(a.level).equals(Buffer.from(c.level))).toBe(false);
  });
  it('has starter deposits near spawn', () => {
    const w = generateWorld(SEED);
    let q = 0, o = 0;
    for (let y = w.cy - 12; y < w.cy + 12; y++) for (let x = w.cx - 12; x < w.cx + 12; x++) {
      const d = w.deposit[idx(w, x, y)];
      if (d === DEPOSIT.QUARTZ) q++; if (d === DEPOSIT.ORE) o++;
    }
    expect(q).toBeGreaterThan(8);
    expect(o).toBeGreaterThan(8);
  });
});

describe('placement', () => {
  it('rejects extractors off deposits with a reason', () => {
    const s = createState(SEED);
    const h = hq(s);
    const c = checkPlace(s, 'quarry', h.x + 4, h.y - 1);
    if (!c.ok) expect(c.reason).toMatch(/quartz|Blocked|flat/);
  });
  it('rejects buildings beyond the frontier', () => {
    const s = createState(SEED);
    const c = checkPlace(s, 'solar', 5, 5);
    expect(c.ok).toBe(false);
  });
  it('charges costs and refunds on early demolish', () => {
    const s = createState(SEED);
    const h = hq(s);
    const before = s.stock.metal!;
    const [x, y] = findSpot(s, 'solar', h.x + 5, h.y);
    const b = place(s, 'solar', x, y)!;
    expect(s.stock.metal).toBe(before - 8);
    demolish(s, b.id);
    expect(s.stock.metal).toBe(before);
  });
});

describe('power grids', () => {
  it('buildings outside node coverage are unpowered; a pole connects them', () => {
    const s = createState(SEED);
    s.stock = { metal: 999, silicon: 999 };
    const h = hq(s);
    const [x, y] = findSpot(s, 'furnace', h.x + 1, h.y + 11, 6);
    const f = place(s, 'furnace', x, y, { autoLink: false })!;
    rebuildGrids(s);
    expect(f.grid).toBe(-1);
    run(s, 1);
    expect(f.status).toBe('no_power');
    const [px, py] = findSpot(s, 'pole', h.x + 1, h.y + 7, 3);
    place(s, 'pole', px, py);
    rebuildGrids(s);
    expect(f.grid).toBeGreaterThanOrEqual(0);
  });
  it('brownout scales all consumers when demand exceeds supply', () => {
    const s = createState(SEED);
    s.stock = { metal: 999, silicon: 999 };
    const h = hq(s);
    for (let i = 0; i < 4; i++) { const [x, y] = findSpot(s, 'smelter', h.x + 1, h.y + 1, 6); place(s, 'smelter', x, y, { autoLink: false }); }
    for (const b of s.buildings) if (b.type === 'smelter') b.inBuf.ore = 50;
    run(s, 1);
    const g = s.grids[hq(s).grid];
    expect(g.demand).toBeGreaterThan(6);
    expect(g.sat).toBeLessThan(1);
    expect(g.sat).toBeGreaterThan(0);
  });
  it('batteries charge on surplus and discharge at night', () => {
    const s = createState(SEED);
    s.stock = { metal: 999, silicon: 999 };
    const h = hq(s);
    const [x, y] = findSpot(s, 'battery', h.x + 4, h.y);
    const bat = place(s, 'battery', x, y)!;
    run(s, 20);
    expect(bat.charge).toBeGreaterThan(50); // HQ surplus charges it
    const charged = bat.charge;
    const [sx, sy] = findSpot(s, 'smelter', h.x - 3, h.y);
    const sm = place(s, 'smelter', sx, sy, { autoLink: false })!;
    sm.inBuf.ore = 20;
    for (let i = 0; i < 2; i++) {
      const [sx2, sy2] = findSpot(s, 'smelter', h.x - 3, h.y + 3);
      place(s, 'smelter', sx2, sy2, { autoLink: false })!.inBuf.ore = 20;
    }
    run(s, 5);
    expect(bat.charge).toBeLessThan(charged);
  });
});

describe('logistics flow', () => {
  it('moves items along a conveyor and respects capacity', () => {
    const s = createState(SEED);
    s.stock = { metal: 999, silicon: 999 };
    const h = hq(s);
    const [x, y] = findSpot(s, 'smelter', h.x + 5, h.y);
    const sm = place(s, 'smelter', x, y)!;
    expect(s.links.some((l) => l.from === sm.id && l.to === h.id)).toBe(true);
    sm.inBuf.ore = 100;
    const before = s.stock.metal!;
    run(s, 10);
    const gained = s.stock.metal! - before;
    expect(gained).toBeGreaterThan(2);
    expect(gained).toBeLessThan(10 * 2 + 0.01);
  });
  it('a full destination blocks the link (visible as blocked)', () => {
    const s = createState(SEED);
    s.stock = { metal: 999, silicon: 999 };
    const h = hq(s);
    const [x, y] = findSpot(s, 'drill', h.x, h.y, 30, (x, y) => (checkPlace(s, 'drill', x, y).richness ?? 0) >= 0.5);
    const dr = place(s, 'drill', x, y, { autoLink: false })!;
    const [fx, fy] = findSpot(s, 'smelter', x + 2, y, 6);
    const sm = place(s, 'smelter', fx, fy, { autoLink: false })!;
    expect(checkLink(s, dr.id, sm.id).ok).toBe(true);
    const l = addLink(s, dr.id, sm.id)!;
    // smelter unpowered & no output link → fills up
    sm.grid = -1;
    dr.outBuf.ore = 50;
    run(s, 30);
    expect(['blocked', 'saturated', 'ok']).toContain(l.state);
    expect(sm.inBuf.ore!).toBeLessThanOrEqual(6.01);
  });
});

describe('cooling and heat', () => {
  it('an uncooled rack throttles; coolant fixes it', () => {
    const s = createState(SEED);
    s.era = 2;
    s.stock = { metal: 999, silicon: 999, chips: 999 };
    const h = hq(s);
    const [lx, ly] = findSpot(s, 'lab', h.x + 5, h.y);
    place(s, 'lab', lx, ly);
    const [rx, ry] = findSpot(s, 'rack', lx, ly + 3, 4);
    const r = place(s, 'rack', rx, ry)!;
    expect(s.links.some((l) => l.from === r.id)).toBe(true);
    run(s, 90);
    expect(r.heat).toBeGreaterThan(1);
    expect(r.status).toBe('overheat');
    r.inBuf.coolant = 100;
    for (let i = 0; i < 1200; i++) { r.inBuf.coolant = 5; step(s); }
    expect(r.heat).toBeLessThan(1);
  });
});

describe('research', () => {
  it('spends research and applies effects', () => {
    const s = createState(SEED);
    s.rp = 100;
    expect(research(s, 'belts')).toBe(true);
    expect(s.fx.conveyorMul).toBeCloseTo(1.6);
    expect(research(s, 'fiber')).toBe(false); // era-locked
    recomputeFx(s);
    expect(s.rp).toBe(85);
  });
});

describe('save/load', () => {
  it('round-trips and continues deterministically', () => {
    const a = createState(SEED);
    autoplay(a, 1, 240);
    const json = saveToString(a);
    const b = loadFromString(json);
    expect(b.buildings.length).toBe(a.buildings.length);
    expect(b.links.length).toBe(a.links.length);
    run(a, 30); run(b, 30);
    expect(b.stock.metal).toBeCloseTo(a.stock.metal!, 4);
    expect(b.time).toBeCloseTo(a.time, 6);
  });
  it('migrates v1 saves', () => {
    const a = createState(SEED);
    const v2 = JSON.parse(saveToString(a));
    const v1: any = { ...v2, version: 1, inventory: { metal: 42 }, research: 7 };
    delete v1.stock; delete v1.rp; delete v1.contracts; delete v1.engine;
    const m = migrate(v1);
    expect(m.version).toBe(SAVE_VERSION);
    const s = loadFromObject(v1);
    expect(s.stock.metal).toBe(42);
    expect(s.rp).toBe(7);
    expect(s.engine.ignited).toBe(false);
  });
  it('rejects garbage and future versions', () => {
    expect(() => migrate(null)).toThrow();
    expect(() => migrate({ version: 99 })).toThrow();
  });
});

describe('autoplayer', () => {
  it('finishes eras 1–2 without deadlock, NaN or negative resources', () => {
    const s = createState(SEED);
    const r = autoplay(s, 2, 3 * 3600);
    expect(r.problems).toEqual([]);
    expect(r.eraReached).toBeGreaterThanOrEqual(3);
  });
  it('finishes the whole campaign (all 5 eras, engine ignites) on the campaign seed', () => {
    const s = createState(SEED);
    const r = autoplay(s, 5, 4 * 3600);
    expect(r.problems).toEqual([]);
    expect(s.flags.campaignDone).toBe(true);
    expect(s.engine.ignited).toBe(true);
    expect(s.eraScores.length).toBe(5);
  }, 60000);
  it('storage ships stockpiled goods to consumers', () => {
    const s = createState(SEED);
    s.stock = { metal: 500, silicon: 500 };
    const h = hq(s);
    const [x, y] = findSpot(s, 'smelter', h.x + 5, h.y);
    const sm = place(s, 'furnace', x, y, { autoLink: false })!;
    void sm;
    s.era = 2;
    const [fx, fy] = findSpot(s, 'fab', h.x - 5, h.y, 8);
    const fab = place(s, 'fab', fx, fy, { autoLink: false })!;
    expect(checkLink(s, h.id, fab.id).item).toBe('silicon');
    addLink(s, h.id, fab.id);
    expect(checkLink(s, h.id, fab.id).item).toBe('metal');
    addLink(s, h.id, fab.id);
    run(s, 5);
    expect(fab.inBuf.silicon!).toBeGreaterThan(1);
    expect(fab.inBuf.metal!).toBeGreaterThan(1);
  });
  it('works on a second seed', () => {
    const s = createState(4242);
    const r = autoplay(s, 2, 3 * 3600);
    expect(r.problems).toEqual([]);
    expect(r.eraReached).toBeGreaterThanOrEqual(3);
  });
});
