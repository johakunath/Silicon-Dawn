// Deterministic fixed-timestep simulation. Pure: no DOM, no Math.random.
import { BUILDING } from './data/buildings';
import { ERAS, ERA_PAR, pue } from './data/eras';
import { EVENT, EVENTS } from './data/events';
import { TECH } from './data/tech';
import { rebuildGrids } from './power';
import {
  BASE_FX, GameState, TICK, diffMul, pushFeed, signal, sunlight, timeOfDay, windAt,
} from './state';
import type { Building, BuildingDef, Contract, ItemId, Link } from './types';
import { LINKS } from './data/items';

export const ENGINE_TARGET = 160000;

// ───────── helpers ─────────
export function inputCap(s: GameState, d: BuildingDef, item: ItemId): number {
  const r = d.inputs?.[item] ?? 0;
  if (item === 'compute') return r * TICK;
  return Math.max(2, r * 10) * s.fx.bufferMul;
}
export function outputCap(d: BuildingDef, item: ItemId): number {
  const r = d.outputs?.[item] ?? 0;
  if (item === 'compute') return r * TICK * 3;
  return Math.max(2, r * 10);
}

export function linkCapacity(s: GameState, l: Link): number {
  const base = LINKS[l.kind].capacity;
  if (l.kind === 'conveyor') return base * s.fx.conveyorMul;
  if (l.kind === 'cable' || l.kind === 'fiber') return base * s.fx.dataMul;
  return base;
}

export function recomputeFx(s: GameState) {
  const fx = { ...BASE_FX };
  for (const id of s.techs) {
    const t = TECH[id];
    if (!t) continue;
    for (const [k, v] of Object.entries(t.effect)) (fx as any)[k] += v as number;
  }
  s.fx = fx;
}

export function eventSeverity(s: GameState): number {
  return diffMul(s).eventSeverity * (1 - Math.min(0.8, s.fx.eventResist));
}
function activeEvent(s: GameState, id: string) {
  return s.events.some((e) => e.id === id && e.warn <= 0);
}

interface Mods { solar: number; cooling: number; pump: number; firmOff: boolean; chips: number }
function mods(s: GameState): Mods {
  const sev = eventSeverity(s);
  return {
    solar: activeEvent(s, 'dust') ? 1 - 0.6 * sev : 1,
    cooling: activeEvent(s, 'heatwave') ? 1 - 0.4 * sev : 1,
    pump: activeEvent(s, 'drought') ? 1 - 0.6 * sev : 1,
    firmOff: activeEvent(s, 'outage') && sev > 0.25,
    chips: activeEvent(s, 'shortage') ? 1 - 0.5 * sev : 1,
  };
}

/** outgoing links per building, rebuilt lazily */
let linkIndexFor: Link[] | null = null;
let linkIndexVersion = -1;
let outIndex = new Map<number, Link[]>();
export function linksChanged(s: GameState) {
  (s as any)._linkVer = ((s as any)._linkVer ?? 0) + 1;
}
function outLinks(s: GameState): Map<number, Link[]> {
  const v = (s as any)._linkVer ?? 0;
  if (linkIndexFor !== s.links || linkIndexVersion !== v) {
    outIndex = new Map();
    for (const l of s.links) {
      const arr = outIndex.get(l.from);
      if (arr) arr.push(l); else outIndex.set(l.from, [l]);
    }
    linkIndexFor = s.links;
    linkIndexVersion = v;
  }
  return outIndex;
}

const isCooling = (t: string) => t === 'cooler' || t === 'chiller' || t === 'pump';

// scratch arrays
let want = new Float32Array(0);

export function step(s: GameState) {
  const dt = TICK;
  if (s.gridDirty) rebuildGrids(s);
  s.time += dt;
  s.tick++;
  const m = mods(s);
  const tod = timeOfDay(s);
  const sun = sunlight(tod);
  const wind = windAt(s);
  const B = s.buildings;
  if (want.length < B.length) want = new Float32Array(B.length * 2);

  // ── hubs → boost ──
  for (const b of B) b.boost = 1;
  for (const h of B) {
    const d = BUILDING[h.type];
    if (!d.hub || h.broken > 0 || (h.inBuf.robots ?? 0) <= 0 || h.powerSat < 0.5) continue;
    const cx = h.x + d.size / 2, cy = h.y + d.size / 2;
    for (const b of B) {
      if (b === h) continue;
      const bd = BUILDING[b.type];
      if (Math.hypot(b.x + bd.size / 2 - cx, b.y + bd.size / 2 - cy) <= d.hub) {
        b.boost = 1.3;
        if (b.broken > 0) { b.broken = 0; signal(s, 'repair', b.x, b.y); }
      }
    }
  }

  // ── pass A: wants & generation ──
  const G = s.grids;
  for (const g of G) { g.gen = 0; g.demand = 0; g.stored = 0; g.capacity = 0; }
  const varGen = new Float32Array(G.length), firmCap = new Float32Array(G.length), gasCap = new Float32Array(G.length), cleanGen = new Float32Array(G.length);
  for (let i = 0; i < B.length; i++) {
    const b = B[i], d = BUILDING[b.type];
    let w = 0;
    if (b.broken > 0) { want[i] = 0; continue; }
    if (d.workload) {
      w = (b.inBuf.compute ?? 0) > 0 ? 1 : 0.15;
      if (d.workload === 'engine' && s.engine.ignited) w = 0.3;
    } else if (d.it) {
      w = (outLinks(s).get(b.id)?.length ?? 0) > 0 ? 1 : 0.25;
    } else if (d.passthrough) {
      w = (b.inBuf.compute ?? 0) > 0 ? 1 : 0.1;
    } else if (d.inputs || d.outputs) {
      w = 1;
      if (d.inputs) for (const [it, r] of Object.entries(d.inputs) as [ItemId, number][]) {
        if (d.gen) continue;
        w = Math.min(w, Math.min(1, (b.inBuf[it] ?? 0) / (r * dt)));
      }
      if (d.outputs) for (const it of Object.keys(d.outputs) as ItemId[]) if ((b.outBuf[it] ?? 0) >= outputCap(d, it) - 1e-6) w = 0;
      if (d.hub) w = 1;
    }
    want[i] = w;
    if (b.grid < 0) continue;
    const g = G[b.grid];
    if (d.power < 0) {
      let p = -d.power * (0.15 + 0.85 * w);
      if (isCooling(b.type) && b.type !== 'pump') p *= s.fx.coolingPowerMul;
      g.demand += p;
    } else if (d.power > 0) {
      let out = 0;
      switch (d.gen) {
        case 'solar': out = d.power * sun * s.fx.solarMul * m.solar; varGen[b.grid] += out; cleanGen[b.grid] += out; break;
        case 'wind': {
          const local = s.world.wind[b.y * s.world.size + b.x];
          out = d.power * Math.min(1.6, wind * local) * s.fx.windMul;
          varGen[b.grid] += out; cleanGen[b.grid] += out; break;
        }
        case 'core': out = m.firmOff ? 0 : d.power; varGen[b.grid] += out; break;
        case 'firm':
          if (b.type === 'gas') { if (!m.firmOff) { firmCap[b.grid] += d.power; gasCap[b.grid] += d.power; } }
          else { // fusion needs water
            const need = (d.inputs?.water ?? 0) * dt;
            const have = Math.min(need, b.inBuf.water ?? 0);
            b.inBuf.water = (b.inBuf.water ?? 0) - have;
            const f = need > 0 ? have / need : 1;
            out = d.power * f;
            firmCap[b.grid] += out;
          }
          break;
      }
      b.activity = d.gen === 'firm' ? b.activity : out / d.power;
    }
    if (d.battery) {
      b.status = b.charge > 1 ? 'ok' : 'idle'; b.activity = 0;
      g.stored += b.charge;
      g.capacity += d.battery.capacity * s.fx.batteryMul;
    }
  }

  // ── grid balance ──
  let healthNum = 0, healthDen = 0, totalGen = 0, totalClean = 0, gasUsed = 0;
  for (const g of G) {
    const D = g.demand;
    const V = varGen[g.id];
    let supplied = 0, firmUsed = 0, discharge = 0, charge = 0;
    if (V >= D) {
      supplied = D;
      charge = V - D;
    } else {
      const deficit = D - V;
      firmUsed = Math.min(firmCap[g.id], deficit);
      const rem = deficit - firmUsed;
      // batteries cover remaining
      let canDis = 0;
      for (const id of g.nodes) {
        const b = s.byId.get(id)!; const d = BUILDING[b.type];
        if (d.battery) canDis += Math.min(b.charge / dt, d.battery.rate * s.fx.batteryMul);
      }
      discharge = Math.min(rem, canDis);
      supplied = V + firmUsed + discharge;
    }
    g.sat = D > 0 ? Math.min(1, supplied / D) : 1;
    let batRate = 0;
    for (const id of g.nodes) { const nb = s.byId.get(id)!; const nd = BUILDING[nb.type]; if (nd.battery && nb.charge > 1) batRate += nd.battery.rate * s.fx.batteryMul; }
    g.avail = V + firmCap[g.id] + batRate;
    // apply battery flows proportionally
    if (charge > 0 || discharge > 0) {
      for (const id of g.nodes) {
        const b = s.byId.get(id)!; const d = BUILDING[b.type];
        if (!d.battery) continue;
        const cap = d.battery.capacity * s.fx.batteryMul, rate = d.battery.rate * s.fx.batteryMul;
        if (charge > 0) {
          const c = Math.min(rate, charge, (cap - b.charge) / dt);
          if (c > 0) { b.charge += c * dt; charge -= c; b.status = 'charging'; b.activity = c / rate; }
        } else if (discharge > 0) {
          const c = Math.min(rate, discharge, b.charge / dt);
          if (c > 0) { b.charge -= c * dt; discharge -= c; b.status = 'discharging'; b.activity = c / rate; }
        }
      }
    }
    const gasShare = firmCap[g.id] > 0 ? gasCap[g.id] / firmCap[g.id] : 0;
    gasUsed += firmUsed * gasShare;
    g.gen = Math.min(V, D) + firmUsed;
    const clean = Math.min(cleanGen[g.id], g.gen) + firmUsed * (1 - gasShare);
    g.clean = g.gen > 0 ? clean / g.gen : 1;
    totalGen += g.gen; totalClean += clean;
    healthNum += D * g.sat; healthDen += D;
  }
  // gas turbine activity
  for (const b of B) if (b.type === 'gas' && b.grid >= 0) { const g = G[b.grid]; b.activity = firmCap[b.grid] > 0 ? Math.min(1, (g.gen - Math.min(varGen[b.grid], g.demand)) / firmCap[b.grid]) : 0; }

  // ── pass B: production ──
  let computeProduced = 0, itPower = 0, facPower = 0, trainEff = 0, served = 0;
  const shortage = m.chips;
  for (let i = 0; i < B.length; i++) {
    const b = B[i], d = BUILDING[b.type];
    if (b.broken > 0) {
      b.broken = Math.max(0, b.broken - dt * s.fx.autoRepair);
      b.activity = 0; b.status = 'broken';
      if (b.broken === 0) signal(s, 'repair', b.x, b.y);
      continue;
    }
    const sat = d.power < 0 ? (b.grid >= 0 ? G[b.grid].sat : 0) : 1;
    b.powerSat = sat;
    if (d.power < 0) {
      let p = -d.power * (0.15 + 0.85 * want[i]) * sat;
      if (isCooling(b.type) && b.type !== 'pump') p *= s.fx.coolingPowerMul;
      if (d.it) itPower += p; else if (d.cat === 'cooling' || d.passthrough || d.workload) facPower += p;
    }
    if (d.gen || d.battery || (d.node && !d.inputs && !d.outputs)) {
      if (b.type === 'hq') {
        const r = 0.08 * dt; s.rp += r; s.stats.rpTotal += r;
        // salvage safety net: the Core scavenges scrap so the player can never soft-lock
        if ((s.stock.metal ?? 0) < 25) s.stock.metal = (s.stock.metal ?? 0) + 0.2 * dt;
        if ((s.stock.silicon ?? 0) < 10) s.stock.silicon = (s.stock.silicon ?? 0) + 0.08 * dt;
      }
      if (d.gen === 'solar') b.status = sun < 0.05 ? 'night' : m.solar < 1 ? 'low_power' : 'ok';
      else if (d.gen === 'wind') b.status = b.activity < 0.25 ? 'calm' : 'ok';
      else if (b.type === 'fusion') { b.status = b.activity < 0.5 ? 'no_input' : 'ok'; b.statusItem = 'water'; }
      else if (d.gen === 'firm' || d.gen === 'core') b.status = m.firmOff ? 'broken' : 'ok';
      else if (!d.battery) b.status = 'ok';
      continue;
    }
    if (d.storage) {
      b.status = 'ok'; b.activity = 0;
      continue;
    }
    if (sat <= 0.001 && d.power < 0) {
      b.activity = 0;
      b.status = b.grid < 0 ? 'no_power' : 'low_power';
      if (d.it) b.heat = Math.max(0, b.heat - dt * 0.05);
      if (d.outputs?.compute) b.outBuf.compute = 0;
      continue;
    }
    const k = sat * b.boost * dt;
    const outs = Object.entries(d.outputs ?? {}) as [ItemId, number][];
    const ins = Object.entries(d.inputs ?? {}) as [ItemId, number][];
    let status: Building['status'] = sat < 0.98 ? 'low_power' : 'ok';
    let statusItem: ItemId | undefined;

    if (d.workload) {
      const A = b.inBuf.compute ?? 0;
      const fiberFrac = A > 0 ? Math.min(1, b.rxFiber / A) : 0;
      const eff = A * sat;
      b.activity = Math.min(1, A / ((d.inputs!.compute ?? 1) * dt));
      switch (d.workload) {
        case 'research': {
          const rp = eff / 6;
          s.rp += rp; s.stats.rpTotal += rp;
          break;
        }
        case 'inference': served += b.rxQ * sat; break;
        case 'training': {
          const t = (b.rxT * sat) * (0.5 + 0.5 * fiberFrac);
          trainEff += t;
          break;
        }
        case 'engine': {
          if (!s.engine.ignited) {
            const needA = (d.inputs!.accel ?? 0) * dt;
            const haveA = Math.min(needA, b.inBuf.accel ?? 0);
            b.inBuf.accel = (b.inBuf.accel ?? 0) - haveA;
            s.engine.accel += haveA;
            const af = needA > 0 ? 0.25 + 0.75 * (haveA / needA) : 1;
            s.engine.progress = Math.min(1, s.engine.progress + (eff * (0.4 + 0.6 * fiberFrac) * af) / ENGINE_TARGET);
            if (s.engine.progress >= 1) {
              s.engine.ignited = true; s.engine.igniteTime = s.time;
              signal(s, 'ignite', b.x, b.y);
            }
            if (haveA < needA * 0.5) { status = 'no_input'; statusItem = 'accel'; }
          }
          break;
        }
      }
      if (A <= 0) { status = 'no_input'; statusItem = 'compute'; }
      b.inBuf.compute = 0; b.rxFiber = 0; b.rxQ = 0; b.rxT = 0;
      b.status = status; b.statusItem = statusItem;
      continue;
    }

    if (d.passthrough) {
      const A = Math.min(b.inBuf.compute ?? 0, d.passthrough * dt) * sat;
      b.outBuf.compute = A;
      const raw = b.inBuf.compute ?? 0;
      b.outQ = raw > 0 ? b.rxQ / raw : 1; b.outT = raw > 0 ? b.rxT / raw : 1; b.outF = raw > 0 ? b.rxFiber / raw : 0;
      b.inBuf.compute = 0; b.rxQ = 0; b.rxT = 0; b.rxFiber = 0;
      b.activity = A / (d.passthrough * dt);
      b.status = A > 0 ? status : 'no_input'; b.statusItem = 'compute';
      if (!(outLinks(s).get(b.id)?.length)) b.status = 'no_output_link';
      continue;
    }

    if (d.it) {
      // coolant & heat
      const need = (d.inputs?.coolant ?? 0) * k / s.fx.coolingMul;
      const got = Math.min(need, b.inBuf.coolant ?? 0);
      b.inBuf.coolant = (b.inBuf.coolant ?? 0) - got;
      let coolFrac = need > 0 ? got / need : 1;
      coolFrac *= m.cooling;
      const heatMul = b.mode === 'inference' ? 0.75 : b.mode === 'training' ? 1.15 : 1;
      const target = sat * want[i] * ((1 - coolFrac) * 1.5 + 0.3) * heatMul;
      b.heat += (target - b.heat) * dt * 0.18;
      const tol = s.fx.heatTolerance;
      const throttle = b.heat > 1 + tol ? Math.max(0.45, 1 - (b.heat - 1 - tol) * 1.0) : 1;
      const modeMul = b.mode === 'training' ? 1.25 : 1;
      const c = d.outputs!.compute! * k * throttle * s.fx.computeMul * modeMul;
      b.outBuf.compute = c;
      b.outQ = b.mode === 'training' ? 0.6 : b.mode === 'inference' ? 1.3 : 1;
      b.outT = b.mode === 'training' ? 1.3 : b.mode === 'inference' ? 0.8 : 1;
      b.outF = 1;
      computeProduced += c;
      b.produced += c;
      b.activity = sat * throttle * (want[i] > 0.5 ? 1 : 0.3);
      if (throttle < 0.999) status = 'overheat';
      if (!(outLinks(s).get(b.id)?.length)) status = 'no_output_link';
      b.status = status;
      continue;
    }

    // generic recipe / extractor
    let r = 1;
    let mul = 1;
    if (d.cat === 'extract') mul *= s.fx.extractMul * b.richness;
    if (d.cat === 'refine') mul *= s.fx.refineMul;
    if (b.type === 'pump') mul *= m.pump;
    if (b.type === 'fab' || b.type === 'accfab') mul *= shortage;
    const kk = k * mul;
    for (const [it, rate] of ins) {
      const need = rate * kk;
      if (need <= 0) continue;
      const have = b.inBuf[it] ?? 0;
      const f = Math.min(1, have / need);
      if (f < r) { r = f; if (f < 0.999) { statusItem = it; } }
    }
    if (r < 0.2 && statusItem) status = 'no_input';
    else if (r < 0.999) statusItem = statusItem; // input-limited but running: shown in inspector via activity
    let full = false;
    for (const [it, rate] of outs) {
      const space = outputCap(d, it) - (b.outBuf[it] ?? 0);
      const f = Math.max(0, Math.min(1, space / (rate * kk)));
      if (f < r) { r = f; full = true; }
    }
    if (full) status = (outLinks(s).get(b.id)?.length ?? 0) === 0 ? 'no_output_link' : 'output_full';
    if (d.hub) {
      const need = (d.inputs?.robots ?? 0) * kk;
      const have = b.inBuf.robots ?? 0;
      b.inBuf.robots = Math.max(0, have - need);
      b.activity = have > 0 ? sat : 0;
      b.status = have > 0 ? status : 'no_input';
      b.statusItem = 'robots';
      // keep a token so hub stays active next tick
      if (have > 0 && b.inBuf.robots === 0) b.inBuf.robots = 1e-6;
      continue;
    }
    if (r > 0) {
      for (const [it, rate] of ins) b.inBuf[it] = Math.max(0, (b.inBuf[it] ?? 0) - rate * kk * r);
      for (const [it, rate] of outs) {
        const a = rate * kk * r;
        b.outBuf[it] = (b.outBuf[it] ?? 0) + a;
        s.stats.produced[it] = (s.stats.produced[it] ?? 0) + a;
        b.produced += a;
      }
    }
    b.activity = r * sat;
    b.status = status;
    b.statusItem = statusItem;
  }

  // ── pass C: link flow ──
  const OI = outLinks(s);
  let computeDelivered = 0;
  for (const l of s.links) l.moved = 0;
  for (const src of B) {
    const ls = OI.get(src.id);
    if (!ls || src.broken > 0) continue;
    const sd = BUILDING[src.type];
    // group by item
    for (const item of Object.keys(src.outBuf) as ItemId[]) {
      let avail = src.outBuf[item] ?? 0;
      if (avail <= 1e-9) { for (const l of ls) if (l.item === item) l.state = 'idle'; continue; }
      let D = 0;
      const dem: number[] = [];
      for (const l of ls) {
        if (l.item !== item) { dem.push(0); continue; }
        const dst = s.byId.get(l.to);
        let space = 0;
        if (dst && dst.broken <= 0) {
          const dd = BUILDING[dst.type];
          if (dd.storage?.includes(item)) space = Infinity;
          else if (dd.inputs?.[item] !== undefined || dd.passthrough) space = Math.max(0, inputCap(s, dd, item) - (dst.inBuf[item] ?? 0));
          if (item === 'compute' && dd.passthrough) space = Math.max(0, dd.passthrough * TICK - (dst.inBuf.compute ?? 0));
        }
        const cap = linkCapacity(s, l) * TICK;
        const dmd = Math.min(cap, space);
        dem.push(dmd);
        D += dmd;
      }
      const scale = D > avail ? avail / D : 1;
      ls.forEach((l, j) => {
        if (l.item !== item) return;
        const mv = dem[j] * scale;
        const cap = linkCapacity(s, l) * TICK;
        if (mv <= 1e-9) { l.state = dem[j] <= 1e-9 ? 'blocked' : 'idle'; return; }
        const dst = s.byId.get(l.to)!;
        const dd = BUILDING[dst.type];
        if (dd.storage?.includes(item)) {
          s.stock[item] = (s.stock[item] ?? 0) + mv;
          s.stats.delivered[item] = (s.stats.delivered[item] ?? 0) + mv;
        } else {
          dst.inBuf[item] = (dst.inBuf[item] ?? 0) + mv;
          if (item === 'compute') {
            dst.rxQ += mv * src.outQ;
            dst.rxT += mv * src.outT;
            dst.rxFiber += mv * src.outF * (l.kind === 'fiber' ? 1 : 0);
            if (dd.workload) computeDelivered += mv;
          }
        }
        l.moved = mv;
        l.total += mv;
        avail -= mv;
        l.state = mv >= cap * 0.97 ? 'saturated' : 'ok';
      });
      src.outBuf[item] = Math.max(0, avail);
      if (item === 'compute') src.outBuf.compute = 0; // compute can't be stored
      void sd;
    }
  }
  // storage → consumer shipments from the stockpile
  for (const src of B) {
    const sd = BUILDING[src.type];
    if (!sd.storage) continue;
    const ls = OI.get(src.id);
    if (!ls) continue;
    for (const l of ls) {
      const dst = s.byId.get(l.to);
      if (!dst || dst.broken > 0) { l.state = 'blocked'; continue; }
      const dd = BUILDING[dst.type];
      const have = s.stock[l.item] ?? 0;
      const space = Math.max(0, inputCap(s, dd, l.item) - (dst.inBuf[l.item] ?? 0));
      const cap = linkCapacity(s, l) * TICK;
      // keep a small reserve so the stockpile is never fully drained by belts
      const mv = Math.max(0, Math.min(cap, space, have - 5));
      if (mv <= 1e-9) { l.state = space <= 1e-9 ? 'blocked' : 'idle'; continue; }
      s.stock[l.item] = have - mv;
      dst.inBuf[l.item] = (dst.inBuf[l.item] ?? 0) + mv;
      l.moved = mv; l.total += mv;
      l.state = mv >= cap * 0.97 ? 'saturated' : 'ok';
    }
  }
  const a = dt / 1.5;
  for (const l of s.links) l.rate += (l.moved / dt - l.rate) * a;

  // ── stats ──
  const st = s.stats;
  st.computeRate += (computeProduced / dt - st.computeRate) * a;
  st.computeUsed += (computeDelivered / dt - st.computeUsed) * a;
  st.trainRate += (trainEff / dt - st.trainRate) * a;
  st.inferenceRate += (served / dt - st.inferenceRate) * a;
  st.trainTotal += trainEff;
  st.servedTotal += served;
  st.itPower += (itPower - st.itPower) * a;
  st.facilityPower += (itPower + facPower - st.facilityPower) * a;
  st.totalGen += (totalGen - st.totalGen) * a;
  st.cleanGen += (totalClean - st.cleanGen) * a;
  st.emissions += gasUsed * dt;
  st.eraEmissions += gasUsed * dt;
  st.eraEnergyIT += itPower * dt;
  st.eraEnergyTotal += (itPower + facPower) * dt;
  st.eraGen += totalGen * dt;
  st.eraCleanGen += totalClean * dt;
  if (healthDen > 0) { st.eraHealthyTime += (healthNum / healthDen) * dt; st.eraPoweredTime += dt; }
  if (s.tick % 10 === 0 && st.itPower > 1) {
    st.pueWindow.push(st.facilityPower / st.itPower);
    if (st.pueWindow.length > 60) st.pueWindow.shift();
  }

  // ── trainer contracts get training ──
  for (const c of s.contracts) if (c.state === 'active' && c.kind === 'training') c.progress += trainEff;

  if (s.tick % 10 === 0) {
    tickEvents(s, 1);
    tickContracts(s, 1);
    checkObjectives(s);
  }
}

// ───────── events ─────────
function tickEvents(s: GameState, dt: number) {
  for (const e of s.events) {
    if (e.warn > 0) {
      e.warn -= dt;
      if (e.warn <= 0) {
        const def = EVENT[e.id];
        pushFeed(s, `${def.icon} ${def.name}: ${def.desc}`, 'bad');
        signal(s, 'event_start', undefined, undefined, e.id);
        if (e.id === 'outage') {
          const cands = s.buildings.filter((b) => b.type !== 'hq' && BUILDING[b.type].power !== 0);
          const n = Math.min(cands.length, Math.round((2 + s.rng.int(0, 2)) * eventSeverity(s)));
          for (let i = 0; i < n; i++) {
            const b = cands[s.rng.int(0, cands.length - 1)];
            b.broken = 30;
            signal(s, 'break', b.x, b.y);
          }
        }
      }
    } else {
      e.t -= dt;
    }
  }
  const ended = s.events.filter((e) => e.warn <= 0 && e.t <= 0);
  for (const e of ended) {
    s.stats.eventsSurvived++;
    pushFeed(s, `${EVENT[e.id].name} has passed.`, 'good');
    signal(s, 'event_end', undefined, undefined, e.id);
  }
  s.events = s.events.filter((e) => !(e.warn <= 0 && e.t <= 0));
  if (s.mode === 'sandbox' && !s.flags.tutorial) return;
  const dm = diffMul(s);
  if (s.era >= 2 && s.time >= s.nextEventAt && s.events.length === 0) {
    const pool = EVENTS.filter((e) => e.era <= s.era && (e.id !== 'dust' || s.era <= 3));
    const e = s.rng.pick(pool);
    s.events.push({ id: e.id, t: e.duration, dur: e.duration, warn: 20 });
    pushFeed(s, `⚠ Forecast: ${e.warn}`, 'warn');
    signal(s, 'event_warn', undefined, undefined, e.id);
    const base = s.era >= 4 ? 190 : s.era >= 3 ? 230 : 300;
    s.nextEventAt = s.time + (base + s.rng.range(0, 120)) / dm.events;
  }
}

// ───────── contracts ─────────
function tickContracts(s: GameState, dt: number) {
  for (const c of s.contracts) {
    if (c.state === 'offered') {
      c.expires -= dt;
      if (c.expires <= 0) c.state = 'failed';
    } else if (c.state === 'active') {
      c.t += dt;
      if (c.kind === 'inference') {
        if (s.stats.inferenceRate >= c.target * 0.98) c.progress += dt;
        c.uptime = c.t > 0 ? c.progress / c.t : 1;
        if (c.t >= c.duration) finishContract(s, c, c.progress / c.duration >= 0.9);
      } else {
        if (c.progress >= c.target) finishContract(s, c, true);
        else if (c.t >= c.duration) finishContract(s, c, false);
      }
    }
  }
  s.contracts = s.contracts.filter((c) => c.state === 'offered' || c.state === 'active' || (c.state === 'done' && s.time - c.t < 0));
  if (s.era >= 3 && s.time >= s.nextContractAt && s.contracts.length < 3) {
    const dm = diffMul(s);
    const kind: Contract['kind'] = s.rng.next() < 0.5 ? 'training' : 'inference';
    const scale = s.era >= 5 ? 6 : s.era >= 4 ? 3 : 1;
    const id = s.nextContractId++;
    const c: Contract = kind === 'training'
      ? { id, kind, title: s.rng.pick(['Climate model fine-tune', 'Protein folding sweep', 'Translation model', 'Code assistant pretrain', 'Weather nowcasting']), target: Math.round((1500 + s.rng.range(0, 1500)) * scale / 100) * 100, duration: Math.round(300 * dm.contractTime), t: 0, progress: 0, uptime: 1, reward: { rp: 40 * s.era, items: { metal: 60 * s.era, chips: 10 * s.era } }, state: 'offered', expires: 90 }
      : { id, kind, title: s.rng.pick(['City transit assistant', 'Hospital triage helper', 'Search answers', 'Game NPC dialogue', 'Customer support bot']), target: Math.round((10 + s.rng.range(0, 15)) * scale), duration: Math.round(120 * dm.contractTime), t: 0, progress: 0, uptime: 1, reward: { rp: 35 * s.era, items: { metal: 50 * s.era, silicon: 40 * s.era } }, state: 'offered', expires: 90 };
    s.contracts.push(c);
    signal(s, 'contract_offer');
    pushFeed(s, `New contract offered: ${c.title}`, 'info');
    s.nextContractAt = s.time + 110 + s.rng.range(0, 60);
  }
}

function finishContract(s: GameState, c: Contract, ok: boolean) {
  c.state = ok ? 'done' : 'failed';
  if (ok) {
    s.rp += c.reward.rp;
    for (const [k, v] of Object.entries(c.reward.items) as [ItemId, number][]) s.stock[k] = (s.stock[k] ?? 0) + v;
    s.stats.contractsDone++;
    s.stats.eraContractsDone++;
    pushFeed(s, `✓ Contract complete: ${c.title} (+${c.reward.rp} research)`, 'good');
    signal(s, 'contract_done');
  } else {
    pushFeed(s, `✕ Contract failed: ${c.title}`, 'bad');
    signal(s, 'contract_fail');
  }
}

// ───────── objectives & eras ─────────
export function checkObjectives(s: GameState) {
  if (s.mode === 'sandbox') return;
  const era = ERAS[s.era - 1];
  if (!era) return;
  let all = true;
  for (const o of era.objectives) {
    if (s.done[o.id]) continue;
    if (o.progress(s) >= 0.999) {
      s.done[o.id] = true;
      pushFeed(s, `✓ ${o.text}`, 'good');
      signal(s, 'objective', undefined, undefined, o.id);
    } else all = false;
  }
  if (all) {
    scoreEra(s);
    if (s.era < 5) {
      s.era++;
      s.eraStart = s.time;
      s.pendingEra = s.era;
      s.stats.eraContractsDone = 0;
      pushFeed(s, `ERA ${ERAS[s.era - 1].subtitle.split(' ')[1]}: ${ERAS[s.era - 1].name.toUpperCase()}`, 'era');
      signal(s, 'era', undefined, undefined, s.era);
      if (s.era === 3) s.nextContractAt = s.time + 40;
    } else if (!s.flags.campaignDone) {
      s.flags.campaignDone = true;
      s.flags.sandboxUnlocked = true;
      signal(s, 'campaign_done');
    }
  }
}

export function scoreEra(s: GameState) {
  const st = s.stats;
  const time = s.time - s.eraStart;
  const par = ERA_PAR[s.era] ?? 1200;
  const timeScore = Math.min(1, par / Math.max(1, time));
  const pueAvg = st.eraEnergyIT > 1 ? st.eraEnergyTotal / st.eraEnergyIT : 0;
  const pueScore = pueAvg > 0 ? Math.min(1, Math.max(0, (2.0 - pueAvg) / 0.85)) : timeScore;
  const efficiency = s.era <= 1 ? timeScore : 0.5 * timeScore + 0.5 * pueScore;
  const reliability = st.eraPoweredTime > 0 ? st.eraHealthyTime / st.eraPoweredTime : 1;
  const footprint = st.eraGen > 0 ? 0.25 + 0.75 * (st.eraCleanGen / st.eraGen) : 1;
  const avg = (efficiency + reliability + footprint) / 3;
  const grade = avg >= 0.9 ? 'S' : avg >= 0.78 ? 'A' : avg >= 0.62 ? 'B' : 'C';
  s.eraScores.push({ era: s.era, time, efficiency, reliability, footprint, grade });
  st.eraEnergyIT = 0; st.eraEnergyTotal = 0; st.eraHealthyTime = 0; st.eraPoweredTime = 0; st.eraEmissions = 0; st.eraGen = 0; st.eraCleanGen = 0;
}

export function currentPue(s: GameState) { return pue(s); }
