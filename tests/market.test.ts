import { describe, expect, it } from 'vitest';
import { createState, TICK } from '../src/sim/state';
import type { GameState } from '../src/sim/state';
import { step } from '../src/sim/sim';
import {
  allocate, deploy, deployedModel, estimate, gatewayUptime, latencyAt, marketSecond, marketTrain, maxLoad, minutesUntil, openMarket,
  repFactor, retire, runTarget, segmentDemand, setAutoDeploy, setNextSize, share,
} from '../src/sim/market';
import {
  BASE_LATENCY, BASELINE, FRONTIER_GROWTH, MODEL_SIZES, REP_FLOOR, REP_START, RUN_ERA, SEGMENT, SHELF_MAX,
} from '../src/sim/data/market';
import { ERAS } from '../src/sim/data/eras';
import { loadFromObject, loadFromString, migrate, saveToString } from '../src/sim/save';
import type { Model } from '../src/sim/types';

const SEED = 20261119;

/** an Era III colony with the market open and nothing built */
function market(): GameState {
  const s = createState(SEED);
  s.era = 3;
  s.econ.sell = {};
  marketSecond(s);
  return s;
}

function model(s: GameState, size: Model['size'], share: number, cost: number): Model {
  const m: Model = { id: s.market.nextModelId++, name: `T-${size}`, size, quality: share * s.market.frontier, cost, born: s.time, earned: 0 };
  s.market.models.push(m);
  return m;
}

describe('market opening', () => {
  it('stays closed before Era III and opens with the baseline model deployed and Dawn-1 training', () => {
    const s = createState(SEED);
    marketSecond(s);
    expect(s.market.open).toBe(false);
    s.era = 3;
    marketSecond(s);
    const m = s.market;
    expect(m.open).toBe(true);
    expect(m.rep).toBeCloseTo(REP_START, 2);
    expect(deployedModel(s)!.name).toBe(BASELINE.name);
    expect(share(s, deployedModel(s)!)).toBeCloseTo(BASELINE.quality, 2);
    expect(m.run!.name).toBe('Dawn-1');
    expect(m.run!.target).toBe(MODEL_SIZES.M.train * RUN_ERA[3]);
  });

  it('opens at once in the sandbox', () => {
    const s = createState(SEED, 'standard', 'sandbox');
    for (let i = 0; i < 10; i++) step(s);
    expect(s.market.open).toBe(true);
  });
});

describe('training runs and models', () => {
  it('a finished run ships a model at frontier × size × fiber bonus and starts the next run', () => {
    const s = market();
    s.market.frontier = 1.4;
    const target = s.market.run!.target;
    marketTrain(s, target / 2, 0);
    marketTrain(s, target / 2, target / 2); // half of it over fiber
    const m = s.market.models.find((x) => x.name === 'Dawn-1')!;
    expect(m).toBeTruthy();
    expect(m.quality).toBeCloseTo(1.4 * MODEL_SIZES.M.quality * (0.9 + 0.2 * 0.5), 5);
    expect(m.cost).toBe(MODEL_SIZES.M.cost);
    expect(s.market.shipped).toBe(1);
    expect(s.market.run!.name).toBe('Dawn-2');
    expect(s.market.run!.progress).toBe(0);
  });

  it('the run size switches at once only before training starts', () => {
    const s = market();
    setNextSize(s, 'L');
    expect(s.market.run!.name).toBe('Dawn-1 Max');
    expect(s.market.run!.target).toBe(runTarget(s, 'L'));
    marketTrain(s, 10, 0);
    setNextSize(s, 'S');
    expect(s.market.run!.size).toBe('L');
    expect(s.market.nextSize).toBe('S');
  });

  it('runs get bigger in later eras', () => {
    const s = market();
    s.era = 4;
    expect(runTarget(s, 'M')).toBe(MODEL_SIZES.M.train * RUN_ERA[4]);
  });

  it('the frontier grows every minute, so a model loses its share', () => {
    const s = market();
    const m = deployedModel(s)!;
    const q0 = share(s, m);
    for (let i = 0; i < 60; i++) marketSecond(s);
    expect(share(s, m)).toBeCloseTo(q0 / (1 + FRONTIER_GROWTH.standard / 60) ** 60, 4);
    expect(minutesUntil(s, m, share(s, m) / (1 + FRONTIER_GROWTH.standard))).toBeCloseTo(1, 3);
  });

  it('deploy, retire and the shelf limit', () => {
    const s = market();
    const base = deployedModel(s)!;
    const a = model(s, 'M', 1, 1);
    expect(retire(s, base.id)).toBe(false); // the deployed model stays
    expect(deploy(s, a.id)).toBe(true);
    expect(retire(s, base.id)).toBe(true);
    expect(s.market.models).toHaveLength(1);
    // shipping more models than the shelf holds retires the oldest idle one, never the deployed one
    setAutoDeploy(s, false);
    for (let i = 0; i < SHELF_MAX + 2; i++) marketTrain(s, s.market.run!.target, 0);
    expect(s.market.models.length).toBe(SHELF_MAX);
    expect(s.market.models.some((x) => x.id === a.id)).toBe(true);
  });

  it('auto-deploy keeps whichever model earns most', () => {
    const s = market();
    s.stats.inferenceRate = 40;
    s.market.rep = 1;
    const weak = deployedModel(s)!;
    marketTrain(s, s.market.run!.target, s.market.run!.target); // Dawn-1 at 110%
    const d1 = s.market.models.find((x) => x.name === 'Dawn-1')!;
    expect(estimate(s, d1).revenue).toBeGreaterThan(estimate(s, weak).revenue);
    expect(s.market.deployed).toBe(d1.id);
    // with auto-deploy off, a new model waits on the shelf
    setAutoDeploy(s, false);
    marketTrain(s, s.market.run!.target, s.market.run!.target);
    expect(s.market.deployed).toBe(d1.id);
  });
});

describe('serving demand', () => {
  it('demand grows with time and era', () => {
    const s = market();
    const d0 = segmentDemand(s, SEGMENT.chat);
    s.time += 600;
    expect(segmentDemand(s, SEGMENT.chat)).toBeGreaterThan(d0);
    const d1 = segmentDemand(s, SEGMENT.chat);
    s.era = 4;
    expect(segmentDemand(s, SEGMENT.chat)).toBeGreaterThan(d1 * 2);
  });

  it('latency grows with load; interactive segments cap how full the gateways may run', () => {
    expect(latencyAt(0)).toBe(BASE_LATENCY);
    expect(latencyAt(0.5)).toBeCloseTo(BASE_LATENCY * 2);
    expect(latencyAt(1)).toBe(Infinity);
    expect(maxLoad(SEGMENT.chat)).toBeCloseTo(1 - BASE_LATENCY / SEGMENT.chat.maxLatency);
    expect(maxLoad(SEGMENT.science)).toBe(1);
  });

  it('a weak model only sells to segments that accept its quality', () => {
    const s = market();
    const m = model(s, 'S', 0.6, 1);
    const a = allocate(s, m, 1000, 1);
    expect(a.seg.chat.served).toBeGreaterThan(0);
    expect(a.seg.code.served).toBe(0);
    expect(a.seg.code.reason).toBe('model');
    expect(a.seg.science.reason).toBe('model');
    expect(a.seg.code.lost).toBeGreaterThan(0);
  });

  it('with little capacity the scheduler drops chat to run the gateways full of better-paying work', () => {
    const s = market();
    const m = model(s, 'L', 1.2, 1);
    const sci = segmentDemand(s, SEGMENT.science);
    // just enough capacity for science alone: serving chat would cap the load and cost science revenue
    const a = allocate(s, m, sci, 1);
    expect(a.seg.science.served).toBeCloseTo(sci, 5);
    expect(a.load).toBeCloseTo(1, 5);
    // with lots of spare capacity everything fits under the strictest latency cap
    const b = allocate(s, m, 10000, 1);
    for (const id of ['chat', 'media', 'code', 'enterprise', 'science'] as const) expect(b.seg[id].served).toBeCloseTo(b.seg[id].demand, 5);
    expect(b.load).toBeLessThanOrEqual(maxLoad(SEGMENT.media) + 1e-9);
  });

  it('unserved demand names its reason: capacity when short, latency when only headroom is missing', () => {
    const s = market();
    const m = model(s, 'M', 1, 1);
    const short = allocate(s, m, 5, 1);
    expect(short.lost).toBeGreaterThan(0);
    expect(Object.values(short.seg).some((x) => x.reason === 'capacity')).toBe(true);
    const total = Object.values(allocate(s, m, 10000, 1).seg).reduce((a, x) => a + (x.reason === 'model' ? 0 : x.demand), 0);
    const tight = allocate(s, m, total * 1.0001, 1);
    expect(Object.values(tight.seg).some((x) => x.reason === 'latency')).toBe(true);
  });

  it('bigger models need more compute per query', () => {
    const s = market();
    const lite = model(s, 'S', 1, MODEL_SIZES.S.cost);
    const max = model(s, 'L', 1, MODEL_SIZES.L.cost);
    expect(allocate(s, lite, 50, 1).capacity).toBeCloseTo(50 / MODEL_SIZES.S.cost);
    expect(allocate(s, max, 50, 1).capacity).toBeCloseTo(50 / MODEL_SIZES.L.cost);
  });

  it('reputation below a segment’s uptime need fades its demand down to the loyal floor', () => {
    const d = SEGMENT.enterprise;
    expect(repFactor(1, d)).toBe(1);
    expect(repFactor(d.uptime, d)).toBe(1);
    expect(repFactor(d.uptime - 0.075, d)).toBeCloseTo(REP_FLOOR + (1 - REP_FLOOR) * 0.5);
    expect(repFactor(0, d)).toBe(REP_FLOOR);
  });

  it('revenue is paid into the ledger and the deployed model’s earnings once a second', () => {
    const s = market();
    s.stats.inferenceRate = 30;
    const c0 = s.econ.credits;
    marketSecond(s);
    const m = deployedModel(s)!;
    expect(s.econ.income.market).toBeGreaterThan(0);
    expect(m.earned).toBeCloseTo(s.econ.income.market, 9);
    expect(s.econ.credits - c0).toBeCloseTo(s.econ.income.market, 6);
    expect(s.market.revRate).toBeGreaterThan(0);
  });
});

describe('uptime and reputation', () => {
  it('no linked gateway leaves reputation alone; a linked but starved gateway is down', () => {
    const s = market();
    expect(gatewayUptime(s)).toBe(-1);
    s.buildings.push({ ...s.buildings[0], id: 999, type: 'gateway', activity: 0, powerSat: 1, broken: 0, grid: 0 });
    s.byId.set(999, s.buildings[s.buildings.length - 1]);
    s.links.push({ id: 1, from: 1, to: 999, item: 'compute', kind: 'cable', length: 3, capacity: 16, moved: 0, rate: 0, state: 'idle', total: 0 });
    expect(gatewayUptime(s)).toBe(0);
    const g = s.byId.get(999)!;
    g.activity = 1; g.powerSat = 0.5; // a brownout counts by its depth
    expect(gatewayUptime(s)).toBeCloseTo(0.5);
    const r0 = s.market.rep;
    marketSecond(s);
    // reputation drifts toward uptime slowly: one bad second does not ruin it
    expect(s.market.rep).toBeLessThan(r0);
    expect(s.market.rep).toBeGreaterThan(r0 - 0.01);
  });
});

describe('objectives', () => {
  it('Era III asks for Dawn-1 and market revenue; Era IV for a frontier model', () => {
    const s = market();
    const e3 = ERAS[2].objectives, e4 = ERAS[3].objectives;
    const train = e3.find((o) => o.id === 'e3_train')!, rev = e3.find((o) => o.id === 'e3_market')!, fr = e4.find((o) => o.id === 'e4_frontier')!;
    expect(train.progress(s)).toBe(0);
    marketTrain(s, s.market.run!.target / 2, 0);
    expect(train.progress(s)).toBeCloseTo(0.5);
    marketTrain(s, s.market.run!.target, 0);
    expect(train.progress(s)).toBe(1);
    s.market.revRate = 75 / 60;
    expect(rev.progress(s)).toBeCloseTo(0.5);
    expect(fr.progress(s)).toBeLessThan(1); // Dawn-1 at 90% without fiber
    model(s, 'L', 1.1, 2.5);
    expect(fr.progress(s)).toBe(1);
  });
});

describe('save v4', () => {
  it('round-trips the market', () => {
    const s = market();
    marketTrain(s, s.market.run!.target, 100);
    s.stats.inferenceRate = 20;
    for (let i = 0; i < 12; i++) marketSecond(s);
    const t = loadFromString(saveToString(s));
    expect(t.market.models.map((m) => m.name)).toEqual(s.market.models.map((m) => m.name));
    expect(t.market.deployed).toBe(s.market.deployed);
    expect(t.market.frontier).toBeCloseTo(s.market.frontier, 9);
    expect(t.market.run).toEqual(s.market.run);
    expect(t.market.history.length).toBe(s.market.history.length);
    expect(t.econ.income.market).toBeCloseTo(s.econ.income.market, 9);
  });

  it('a save is deterministic across save and load', () => {
    const a = createState(SEED);
    a.era = 3;
    for (let i = 0; i < 300; i++) step(a);
    const b = loadFromString(saveToString(a));
    for (let i = 0; i < Math.round(30 / TICK); i++) { step(a); step(b); }
    expect(b.market.frontier).toBe(a.market.frontier);
    expect(b.market.rep).toBe(a.market.rep);
    expect(b.econ.credits).toBe(a.econ.credits);
  });

  it('migrates v3 saves: the market starts closed and opens on the next second in Era III', () => {
    const s = createState(SEED);
    s.era = 3;
    const v3: any = JSON.parse(saveToString(s));
    v3.version = 3;
    delete v3.market;
    delete v3.econ.income.market;
    expect(migrate(v3).version).toBe(5);
    const t = loadFromObject(v3);
    expect(t.market.open).toBe(false);
    expect(t.econ.income.market).toBe(0);
    for (let i = 0; i < 10; i++) step(t);
    expect(t.market.open).toBe(true);
    expect(deployedModel(t)!.name).toBe(BASELINE.name);
  });

  it('rejects a damaged market and escapes model names', () => {
    const s = market();
    const good = JSON.parse(saveToString(s));
    const bad = JSON.parse(saveToString(s));
    bad.market.frontier = 'x';
    expect(() => loadFromObject(bad)).toThrow(/damaged/);
    const bad2 = JSON.parse(saveToString(s));
    bad2.market.models[0].size = 'XXL';
    expect(() => loadFromObject(bad2)).toThrow(/damaged/);
    good.market.models[0].name = '<img src=x onerror=alert(1)>';
    good.market.deployed = 12345; // unknown id falls back to a model on the shelf
    const t = loadFromObject(good);
    expect(t.market.models[0].name).not.toContain('<');
    expect(t.market.models.some((m) => m.id === t.market.deployed)).toBe(true);
  });
});

describe('special orders', () => {
  it('old contracts are now rarer special orders that still pay credits', () => {
    const s = createState(SEED);
    s.era = 3;
    s.nextContractAt = 1;
    for (let i = 0; i < Math.round(2 / TICK); i++) step(s);
    expect(s.contracts.length).toBe(1);
    expect(s.contracts[0].reward.credits).toBeGreaterThan(0);
    expect(s.nextContractAt - s.time).toBeGreaterThan(200);
    expect(openMarket).toBeTypeOf('function');
  });
});
