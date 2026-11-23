// Headless autoplayer: a simple scripted strategy that plays the campaign through the real action API.
import { BUILDING } from './data/buildings';
import { TECHS } from './data/tech';
import { acceptContract, removeLink, addLink, checkLink, checkPlace, costOf, canAfford, place, research, canResearch } from './actions';
import { coveredAt, rebuildGrids } from './power';
import { step } from './sim';
import { keepLevel } from './economy';
import { canUpgradeGrid, gridUpgradeCost, requestGridUpgrade } from './operations';
import { GameState, TICK, countType, hq } from './state';
import type { Building, ItemId } from './types';
import { DEPOSIT, idx } from './world';

export interface AutoplayReport {
  eraReached: number;
  time: number;
  eraTimes: number[];
  buildings: number;
  problems: string[];
  log: string[];
  /** balance at each era change, lowest balance and emergency grants (pacing check) */
  credits: number[];
  minCredits: number;
  grants: number;
}

function spiral(cx: number, cy: number, maxR: number, f: (x: number, y: number) => boolean): [number, number] | null {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (f(cx + dx, cy + dy)) return [cx + dx, cy + dy];
    }
  }
  return null;
}

function nearestDeposit(s: GameState, dep: number, cx: number, cy: number): [number, number] | null {
  const w = s.world;
  return spiral(cx, cy, 60, (x, y) => x >= 0 && y >= 0 && x < w.size && y < w.size && w.deposit[idx(w, x, y)] === dep && s.occ[idx(w, x, y)] === 0);
}

export class AutoPlayer {
  log: string[] = [];
  problems: string[] = [];
  constructor(public s: GameState) {}

  private ctr(): [number, number] { const h = hq(this.s); return [h.x + 1, h.y + 1]; }

  /** place type near (cx,cy); ensure it is powered by adding poles if needed */
  build(type: string, cx: number, cy: number, maxR = 14, filter?: (x: number, y: number) => boolean): Building | null {
    const s = this.s;
    if (!canAfford(s, costOf(s, BUILDING[type]))) return null;
    const d = BUILDING[type];
    const spot = spiral(Math.round(cx - d.size / 2), Math.round(cy - d.size / 2), maxR, (x, y) => {
      if (!checkPlace(s, type, x, y).ok) return false;
      if (filter && !filter(x, y)) return false;
      // keep a 1-tile gap around big things so roads of belts remain readable
      return true;
    });
    if (!spot) return null;
    const b = place(s, type, spot[0], spot[1]);
    if (!b) return null;
    this.log.push(`[${Math.round(s.time)}s] built ${type} at ${spot}`);
    if (d.power !== 0 && d.gen !== 'core') this.powerUp(b);
    return b;
  }

  powerUp(b: Building) {
    const s = this.s;
    const d = BUILDING[b.type];
    const main = () => { rebuildGrids(s); return hq(s).grid; };
    for (let tries = 0; tries < 6; tries++) {
      rebuildGrids(s);
      if (coveredAt(s, b.x, b.y, d.size) && b.grid === main()) return;
      // find nearest node already on the main grid
      const mg = main();
      const nodes = s.buildings.filter((n) => BUILDING[n.type].node && n.grid === mg && n !== b);
      let best: Building | null = null, bd = Infinity;
      for (const n of nodes) { const dd = Math.hypot(n.x - b.x, n.y - b.y); if (dd < bd) { bd = dd; best = n; } }
      if (!best) return;
      // step a pole from the node toward the building
      const nd = BUILDING[best.type];
      const nx = best.x + nd.size / 2, ny = best.y + nd.size / 2;
      const tx = b.x + d.size / 2, ty = b.y + d.size / 2;
      const len = Math.hypot(tx - nx, ty - ny);
      const reach = Math.min(nd.node!.reach, 9) - 1;
      if (len < 2) return;
      const t = Math.min(1, reach / len);
      const px = Math.round(nx + (tx - nx) * t), py = Math.round(ny + (ty - ny) * t);
      const spot = spiral(px, py, 3, (x, y) => checkPlace(s, 'pole', x, y).ok && Math.hypot(x + 0.5 - nx, y + 0.5 - ny) <= Math.min(nd.node!.reach, 9));
      if (!spot) return;
      place(s, 'pole', spot[0], spot[1]);
      s.gridDirty = true;
      rebuildGrids(s);
    }
  }

  near(type: string): Building | undefined { return this.s.buildings.find((b) => b.type === type); }

  /** one decision pass */
  think() {
    const s = this.s;
    const [cx, cy] = this.ctr();
    const n = (t: string) => countType(s, t);
    rebuildGrids(s);
    const demand = s.buildings.reduce((a, b) => a + Math.max(0, -BUILDING[b.type].power) * (BUILDING[b.type].it || BUILDING[b.type].workload ? 1 : 0.8), 0);
    const gen = s.buildings.reduce((a, b) => a + (BUILDING[b.type].gen === 'solar' ? 6 * s.fx.solarMul : 0), 0) + 6 + n('gas') * 30 + n('wind') * 9 + n('fusion') * 200;
    for (const b of s.buildings) if (b.grid < 0 && BUILDING[b.type].power !== 0 && s.tick % 100 < 20) this.powerUp(b);
    // repair pass: any building missing a fluid/compute input link gets one if a producer is in range
    if (s.tick % 100 < 20) for (const b of s.buildings) {
      const d = BUILDING[b.type];
      for (const it of Object.keys(d.inputs ?? {}) as ItemId[]) {
        if (s.links.some((l) => l.to === b.id && l.item === it)) continue;
        if (it === 'coolant' || it === 'water') this.feedFrom(b, it);
      }
    }
    // exports: chip fabs and accelerator fabs eat silicon from the stockpile, so stop selling it from Era III.
    // Metal and chips keep selling: the keep level already covers the Dawn Engine's bill of materials.
    // A big silicon pile is idle capital, so sell it down again.
    if (s.era >= 3) s.econ.sell.silicon = (s.stock.silicon ?? 0) > 3 * keepLevel(s, 'silicon');
    // accelerators are worth a lot, but pods and the Dawn Engine need a bank: sell them only when cash runs short
    if (s.era === 4) s.econ.sell.accel = s.econ.credits < 1500 && (s.stock.accel ?? 0) > 80;
    if (s.era >= 5) s.econ.sell.accel = false;
    // research cheapest available tech
    const avail = TECHS.filter((t) => canResearch(s, t.id).ok).sort((a, b) => a.cost - b.cost);
    if (avail.length) research(s, avail[0].id);

    if (s.era >= 5 && n('engine') < 1) {
      // save chips for the engine: pause stockpile → consumer chip shipments
      if ((s.stock.accel ?? 0) >= 44 && (s.stock.chips ?? 0) < 240) for (const l of [...s.links]) if (l.item === 'chips' && BUILDING[s.byId.get(l.from)!.type].storage) removeLink(s, l.id, true);
      this.build('engine', cx - 14, cy + 12, 26);
      if (n('engine') < 1) return;
    }
    // ── power baseline ──
    if (gen < demand * 1.5 + 4) {
      if (s.era >= 4 && s.techs.includes('fusion') && n('fusion') < 2) this.build('fusion', cx + 8, cy - 8, 30);
      else if (s.era >= 4 && n('wind') < 14) this.build('wind', cx - 10, cy - 10, 30);
      else if (s.era >= 3 && n('gas') < (s.era >= 4 ? 12 : 4)) this.build('gas', cx + 6, cy + 10, 26);
      else this.build('solar', cx, cy, 16);
    }
    if (n('battery') < Math.min(6, 1 + Math.floor(n('solar') / 2))) this.build('battery', cx - 3, cy + 4, 14);

    // ── maintenance: a Service Center wherever machines wear out without one ──
    if (s.era >= 2 && n('service') < 2 * s.era - 2) {
      const worn = s.buildings.filter((b) => !b.serviced && b.wear > 0.35 && b.type !== 'service').sort((a, b) => b.wear - a.wear)[0];
      if (worn) this.build('service', worn.x + 1, worn.y + 1, 8);
    }
    // ── a bigger grid connection when cash allows (cheap night power for the base) ──
    if (s.era >= 3 && canUpgradeGrid(s).ok && s.econ.credits > 4 * gridUpgradeCost(s) && s.ops.gridLevel < s.era) requestGridUpgrade(s);
    // ── era 1 chains ──
    const chain = (dep: number, ext: string, ref: string, count: number) => {
      if (n(ref) >= count && n(ext) >= count) return;
      // pick deposit near HQ
      const p = nearestDeposit(s, dep, cx, cy);
      if (!p) return;
      if (n(ext) <= n(ref)) {
        const e = this.build(ext, p[0] + 0.5, p[1] + 0.5, 4, (x, y) => checkPlace(s, ext, x, y).richness! >= 0.5);
        if (!e) return;
      } else {
        // refinery between last extractor and HQ
        const exts = s.buildings.filter((b) => b.type === ext && !s.links.some((l) => l.from === b.id));
        const e = exts[0] ?? s.buildings.filter((b) => b.type === ext).pop();
        if (!e) return;
        const mx = (e.x + cx) / 2, my = (e.y + cy) / 2;
        const r = this.build(ref, mx, my, 8);
        if (r && !s.links.some((l) => l.to === r.id)) { const c = checkLink(s, e.id, r.id); if (c.ok) addLink(s, e.id, r.id); }
      }
    };
    chain(DEPOSIT.QUARTZ, 'quarry', 'furnace', s.era >= 4 ? 6 : s.era >= 2 ? 4 : 2);
    chain(DEPOSIT.ORE, 'drill', 'smelter', s.era >= 2 ? 5 : 3);
    if (s.era === 1 && n('depot') < 1 && (s.stock.metal ?? 0) > 60) this.build('depot', cx + 6, cy + 2, 10);

    // ── era 2: chips, racks, lab, cooling ──
    if (s.era >= 2) {
      if (n('pump') < 2) this.build('pump', cx + 9, cy - 6, 20);
      if (n('fab') < (s.era >= 4 ? 5 : s.era >= 3 ? 2 : 1) && n('pump') > 0) {
        const f = this.build('fab', cx + 6, cy - 4, 18);
        if (f) { this.feedFrom(f, 'water'); }
      }
      if (n('lab') < 1 && n('fab') > 0) this.build('lab', cx - 6, cy - 6, 12);
      if (n('cooler') < Math.ceil(n('rack') / 6) && n('pump') > 0) {
        const c = this.build('cooler', cx - 4, cy - 9, 14);
        if (c) this.feedFrom(c, 'water');
      }
      if (n('lab') > 0 && n('rack') < (s.era >= 3 ? 10 : 6)) {
        const lab = this.near('lab')!;
        const r = this.build('rack', lab.x + 1, lab.y - 2, 6);
        if (r) this.feedFrom(r, 'coolant');
      }
    }
    // ── era 3: grid + hall + workloads ──
    if (s.era >= 3) {
      // the market pays from Era III: one hall trains Dawn-1, one hall feeds a gateway, then the rest
      s.market.nextSize = s.era >= 4 && s.techs.includes('fiber') ? 'L' : 'M';
      if (n('substation') < 1) this.build('substation', cx - 10, cy, 14);
      // the open baseline model earns from the first gateway at once; the trainer comes next
      const gwWant = s.era >= 5 ? 4 : s.era >= 4 ? 3 : 2;
      if (n('gateway') < gwWant && (n('gateway') === 0 || n('trainer') > 0) && s.buildings.filter((b) => b.type === 'gateway').every((g) => s.links.some((l) => l.to === g.id))) {
        this.build('gateway', cx - 12 - 4 * n('gateway'), cy - 10, 18);
      }
      for (const g of s.buildings.filter((b) => b.type === 'gateway')) {
        if (s.links.some((l) => l.to === g.id)) continue;
        // a pod in inference mode serves more per watt once accelerators flow; a hall before that
        const pod = s.era >= 4 && (s.stock.accel ?? 0) >= 4;
        const r = this.build(pod ? 'pod' : 'hall', g.x + 3, g.y + 3, 8);
        if (r) { if (pod) r.mode = 'inference'; this.feedFrom(r, 'coolant'); this.sendTo(r, g); }
        break;
      }
      if (n('trainer') < 1 && n('gateway') > 0) this.build('trainer', cx + 12, cy + 8, 20);
      if (s.market.shipped === 0 && n('trainer') > 0 && !s.links.some((l) => l.to === this.near('trainer')!.id)) {
        const t = this.near('trainer')!;
        const h = this.build('hall', t.x - 2, t.y + 5, 10);
        if (h) { this.feedFrom(h, 'coolant'); this.sendTo(h, t); }
      }
      if (n('gridbat') < 2) this.build('gridbat', cx - 8, cy + 6, 16);
      if (n('chiller') < n('hall') + n('pod')) this.build('chiller', cx + 10, cy + 6, 22);
      if (n('hall') < 4 && n('trainer') > 0 && n('gateway') > 0) {
        const t = this.near('trainer')!;
        const h = this.build('hall', t.x - 2, t.y + 5, 10);
        if (h) { this.feedFrom(h, 'coolant'); this.sendTo(h, t); }
      }
      for (const c of s.contracts) if (c.state === 'offered') acceptContract(s, c.id);
    }
    // ── era 4 ──
    if (s.era >= 4) {
      const rp = nearestDeposit(s, DEPOSIT.RARE, cx, cy);
      if (n('raremine') < 2 && rp) this.build('raremine', rp[0] + 0.5, rp[1] + 0.5, 4, (x, y) => checkPlace(s, 'raremine', x, y).richness! >= 0.5);
      const rm = this.near('raremine');
      if (rm) {
        if (!s.buildings.some((b) => b.type === 'depot' && Math.hypot(b.x - rm.x, b.y - rm.y) < 9)) this.build('depot', rm.x + 2, rm.y + 3, 6);
        if (n('accfab') < 2) {
          const a = this.build('accfab', rm.x + 1, rm.y - 3, 8);
          if (a) { for (const m of s.buildings.filter((b) => b.type === 'raremine')) this.sendTo(m, a); }
        }
      }
      // accelerator fabs need chips: link the nearest chip fab (the stockpile keeps its chips for construction)
      for (const af of s.buildings.filter((b) => b.type === 'accfab')) this.feedFrom(af, 'chips');
      if (n('switch') < 2 && s.techs.includes('fiber')) {
        const t = this.near('trainer');
        if (t) { const sw = this.build('switch', t.x - 2, t.y - 2, 6); if (sw) this.sendTo(sw, t); }
      }
      if (n('pod') < 10 && (s.stock.accel ?? 0) >= 4) {
        const sws = s.buildings.filter((b) => b.type === 'switch');
        const sw = sws[n('pod') % Math.max(1, sws.length)] ?? this.near('trainer');
        if (sw) { const p = this.build('pod', sw.x + 2, sw.y + 2, 12); if (p) { p.mode = 'training'; this.feedFrom(p, 'coolant'); this.sendTo(p, sw); } }
      }
      if (s.techs.includes('robots') && n('robofab') < 1) this.build('robofab', cx + 4, cy - 10, 16);
    }
    if (s.era >= 5) {
      if (n('engine') < 1) this.build('engine', cx - 14, cy + 12, 26);
      const e = this.near('engine');
      if (e) {
        if (!s.links.some((l) => l.to === e.id && l.item === 'accel')) {
          let dp = s.buildings.find((b) => b.type === 'depot' && Math.hypot(b.x - e.x, b.y - e.y) < 10);
          if (!dp) dp = this.build('depot', e.x + 5, e.y + 1, 6) ?? undefined;
          if (dp) { const c = checkLink(s, dp.id, e.id); if (c.ok) addLink(s, dp.id, e.id); }
        }
        if (n('pod') < 16 && (s.stock.accel ?? 0) >= 4) { const p = this.build('pod', e.x + 3, e.y - 2, 12); if (p) { this.feedFrom(p, 'coolant'); this.sendTo(p, e); } }
        // compute that serves the market stays on its gateway
        const servesMarket = (b: Building) => s.links.some((l) => l.from === b.id && BUILDING[s.byId.get(l.to)!.type].workload === 'inference');
        const halls = s.buildings.filter((b) => (b.type === 'hall' || b.type === 'pod') && !servesMarket(b) && !s.links.some((l) => l.from === b.id && l.to === e.id));
        for (const h of halls.slice(0, 2)) { const c = checkLink(s, h.id, e.id); if (c.ok) addLink(s, h.id, e.id); }
      }
    }
  }

  /** link nearest producer of item into b */
  feedFrom(b: Building, item: ItemId) {
    const s = this.s;
    if (s.links.some((l) => l.to === b.id && l.item === item)) return;
    const prods = s.buildings.filter((o) => BUILDING[o.type].outputs?.[item] !== undefined || (item === 'chips' && BUILDING[o.type].storage?.includes(item))).sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y));
    for (const p of prods) { const c = checkLink(s, p.id, b.id); if (c.ok) { addLink(s, p.id, b.id); return; } }
    // build a supplier nearby
    const sup = item === 'coolant' ? (s.era >= 3 ? 'chiller' : 'cooler') : item === 'water' ? 'pump' : null;
    if (sup) {
      const n = this.build(sup, b.x, b.y, 12);
      if (n) { if (sup === 'cooler') this.feedFrom(n, 'water'); const c = checkLink(s, n.id, b.id); if (c.ok) addLink(s, n.id, b.id); }
    }
  }
  sendTo(a: Building, b: Building) {
    const s = this.s;
    if (s.links.some((l) => l.from === a.id && l.to === b.id)) return;
    const c = checkLink(s, a.id, b.id);
    if (c.ok) addLink(s, a.id, b.id);
  }

  checkSanity(): string | null {
    const s = this.s;
    for (const [k, v] of Object.entries(s.stock)) if (!Number.isFinite(v) || v! < -1e-6) return `stock ${k}=${v}`;
    if (!Number.isFinite(s.rp) || s.rp < -1e-6) return `rp=${s.rp}`;
    if (!Number.isFinite(s.econ.credits)) return `credits=${s.econ.credits}`;
    for (const b of s.buildings) {
      for (const [k, v] of Object.entries(b.inBuf)) if (!Number.isFinite(v) || v! < -1e-6) return `${b.type}#${b.id} in ${k}=${v}`;
      for (const [k, v] of Object.entries(b.outBuf)) if (!Number.isFinite(v) || v! < -1e-6) return `${b.type}#${b.id} out ${k}=${v}`;
      if (!Number.isFinite(b.heat) || !Number.isFinite(b.charge)) return `${b.type} heat/charge NaN`;
    }
    for (const g of s.grids) if (!Number.isFinite(g.sat)) return 'grid sat NaN';
    return null;
  }
}

/** Run the campaign headlessly until `targetEra` is completed or time runs out. */
export function autoplay(s: GameState, targetEra: number, maxSeconds: number): AutoplayReport {
  const ap = new AutoPlayer(s);
  const eraTimes: number[] = [];
  const credits: number[] = [];
  let lastEra = s.era;
  let lastProgressT = 0, lastDelivered = 0;
  const steps = Math.round(maxSeconds / TICK);
  for (let i = 0; i < steps; i++) {
    if (i % 20 === 0) ap.think();
    step(s);
    if (s.era !== lastEra) { eraTimes.push(Math.round(s.time)); credits.push(Math.round(s.econ.credits)); lastEra = s.era; ap.log.push(`== era ${s.era} at ${Math.round(s.time)}s`); }
    if (i % 100 === 0) {
      const bad = ap.checkSanity();
      if (bad) { ap.problems.push(`t=${Math.round(s.time)} ${bad}`); break; }
      const delivered = Object.values(s.stats.delivered).reduce((a, b) => a + (b ?? 0), 0) + s.stats.trainTotal + s.stats.rpTotal;
      if (delivered > lastDelivered + 0.01) { lastDelivered = delivered; lastProgressT = s.time; }
      if (s.time - lastProgressT > 600) { ap.problems.push(`deadlock: no progress for 600s at era ${s.era}`); break; }
    }
    if (s.era > targetEra || (targetEra >= 5 && s.flags.campaignDone)) break;
  }
  return { eraReached: s.era, time: s.time, eraTimes, buildings: s.buildings.length, problems: ap.problems, log: ap.log, credits, minCredits: Math.round(s.econ.minCredits), grants: s.econ.grants };
}
