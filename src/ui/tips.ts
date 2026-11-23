// Rich tooltip builders: what things do, how much they make, and how many of what you need.
import { BUILDING, BUILDINGS } from '../sim/data/buildings';
import { ITEMS, LINKS } from '../sim/data/items';
import { pue } from '../sim/data/eras';
import { isUnlocked } from '../sim/actions';
import { DAY_LENGTH, GameState, dayBias, sunlight } from '../sim/state';
import type { BuildingDef, ItemId } from '../sim/types';
import { itemIcon } from './icons';
import type { RateTracker } from './rates';
import { econRows } from './ledger';

export const ITEM_INFO: Record<ItemId, string> = {
  quartz: 'Raw crystal from Quartz Extractors. Useless until a Silicon Furnace refines it.',
  ore: 'Raw rock from Ore Drills. An Ore Smelter turns it into metal.',
  silicon: 'Refined silicon. You build with it, and Chip Fabs turn it into chips.',
  metal: 'Structural metal, needed by almost every building. Fabs also consume it.',
  chips: 'Made in Chip Fabs. Racks, labs and every advanced building need them.',
  rare: 'Rare earths from violet deposits. Accelerator Fabs need them.',
  accel: 'AI accelerators: the building blocks of Accelerator Pods and the Dawn Engine.',
  robots: 'Maintenance robots. Robot Hubs use them to speed up and repair nearby buildings.',
  water: 'Pumped from lakes. Fabs, cooling towers and fusion drink it.',
  coolant: 'Chilled fluid that carries heat away from racks, halls and pods.',
  compute: 'Processing throughput from racks, halls and pods. It cannot be stored: if nothing uses it, it is wasted.',
};

const f1 = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toString() : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));
const perMin = (v: number) => `${f1(v * 60)}/min`;

/** seconds of darkness per day (sunlight below 5%) */
export function nightSeconds(s: GameState): number {
  let n = 0;
  for (let i = 0; i < 240; i++) if (sunlight(i / 240, dayBias(s)) < 0.05) n++;
  return (n / 240) * DAY_LENGTH;
}

export function resourceTip(s: GameState, r: RateTracker, k: ItemId | 'rp'): string {
  if (k === 'rp') {
    return `<b>${itemIcon('rp', 16)} Research</b><br>${'Spent in the Tech tree (T). Research Labs turn compute into research, and the Core adds a small trickle.'}<div class="tt"><span>Earning</span><b>${f1(r.rpPerMin())}/min</b><span>Banked</span><b>${f1(s.rp)}</b></div>`;
  }
  const it = ITEMS[k];
  const prod = r.perMin('produced', k), cons = r.perMin('consumed', k), del = r.perMin('delivered', k), spent = r.perMin('spent', k);
  return `<b>${itemIcon(k, 16)} ${it.name}</b><br>${ITEM_INFO[k]}<div class="tt">
    <span>In stockpile</span><b>${f1(s.stock[k] ?? 0)}</b>
    <span>Produced</span><b class="g">+${f1(prod)}/min</b>
    <span>Consumed by machines</span><b class="r">−${f1(cons)}/min</b>
    <span>Delivered to stockpile</span><b>+${f1(del)}/min</b>
    <span>Spent on construction</span><b>−${f1(spent)}/min</b></div>
    <span class="dim">Only goods delivered to the Core or a Depot count as stockpile. Open Statistics (I) for every item.</span>`;
}

export function powerBreakdown(s: GameState) {
  const gen: Record<string, number> = {}, use: Record<string, number> = {};
  let charge = 0, discharge = 0;
  for (const b of s.buildings) {
    const d = BUILDING[b.type];
    if (d.battery) { if (b.pw > 0) charge += b.pw; else discharge -= b.pw; continue; }
    if (b.pw < 0) gen[d.name] = (gen[d.name] ?? 0) - b.pw;
    else if (b.pw > 0) {
      const cat = d.it ? 'Compute (IT)' : d.cat === 'cooling' ? 'Cooling & pumps' : d.cat === 'extract' ? 'Extraction' : d.cat === 'refine' ? 'Refining & fabs' : d.workload ? 'Labs & workloads' : 'Other';
      use[cat] = (use[cat] ?? 0) + b.pw;
    }
  }
  return { gen, use, charge, discharge };
}

export function powerTip(s: GameState): string {
  const { gen, use, charge, discharge } = powerBreakdown(s);
  const totalGen = Object.values(gen).reduce((a, b) => a + b, 0), totalUse = Object.values(use).reduce((a, b) => a + b, 0);
  const cap = s.grids.reduce((a, g) => a + g.capacity, 0), stored = s.grids.reduce((a, g) => a + g.stored, 0);
  const night = nightSeconds(s);
  const rows = (o: Record<string, number>, cls: string) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${k}</span><b class="${cls}">${f1(v)}</b>`).join('');
  const avail = s.grids.reduce((a, g) => a + g.avail, 0);
  return `<b>${itemIcon('power', 16)} Power</b><br>Every machine draws power every second. When demand exceeds supply, its <i>whole local grid</i> slows down (brownout).
    <div class="tt"><span><b>Producing now</b></span><b class="g">${f1(totalGen)}</b>${rows(gen, 'g')}
    <span><b>Consuming now</b></span><b class="r">${f1(totalUse)}</b>${rows(use, 'r')}
    <span>Battery charging / discharging</span><b>${f1(charge)} / ${f1(discharge)}</b>
    <span>Could produce right now</span><b>${f1(avail)}</b>
    <span>Stored</span><b>${f1(stored)} / ${f1(cap)}</b></div>
    <span class="dim">“X of Y” in the bar = demand of available supply. A night lasts ~${Math.round(night)} s: to bridge it you need about <b>${f1(totalUse * night)}</b> stored energy (${Math.ceil((totalUse * night) / (600 * s.fx.batteryMul))} Battery Banks).</span>`;
}

export function computeTip(s: GameState): string {
  const st = s.stats;
  const p = pue(s);
  return `<b style="color:#6fe9ff">◈ Compute</b><br>Racks, halls and pods turn power into compute. It flows over data cables and fiber into Labs (research), Training Cores (training) and Gateways (inference). Compute can't be stored: anything not consumed is wasted.
    <div class="tt"><span>Produced</span><b class="g">${f1(st.computeRate)}/s</b><span>Used by workloads</span><b>${f1(st.computeUsed)}/s</b>
    <span>Training</span><b>${f1(st.trainRate)}/s</b><span>Inference served</span><b>${f1(st.inferenceRate)}/s</b>
    <span>PUE (facility ÷ IT power)</span><b>${p > 0 ? p.toFixed(2) : '—'}</b></div><span class="dim">Lower PUE is better: cooling and pumps are overhead.</span>`;
}

function producersOf(s: GameState, item: ItemId): BuildingDef[] {
  return BUILDINGS.filter((d) => d.outputs?.[item] && d.id !== 'hq' && (isUnlocked(s, d) || d.era <= s.era + 1));
}
function consumersOf(s: GameState, item: ItemId): BuildingDef[] {
  return BUILDINGS.filter((d) => d.inputs?.[item] && (isUnlocked(s, d) || d.era <= s.era + 1));
}

/** Ratio hints for a building type: how many suppliers per consumer etc. */
export function ratioLines(s: GameState, d: BuildingDef): string[] {
  const out: string[] = [];
  for (const [it, need] of Object.entries(d.inputs ?? {}) as [ItemId, number][]) {
    if (it === 'compute') continue;
    for (const p of producersOf(s, it)) {
      const rate = p.outputs![it]!;
      const n = need / rate;
      out.push(`${itemIcon(it, 13)} ${perMin(need)} ${ITEMS[it].name.toLowerCase()} ≈ <b>${n < 1 ? (1 / n).toFixed(1) + ' ' + d.name + ' per ' + p.name : n.toFixed(1) + ' × ' + p.name}</b>${p.deposit ? ' (at 100% deposit coverage)' : ''}`);
    }
  }
  for (const [it, rate] of Object.entries(d.outputs ?? {}) as [ItemId, number][]) {
    if (it === 'compute') { out.push(`${itemIcon('compute', 13)} ${f1(rate)}/s compute feeds ${(rate / 6).toFixed(1)} Research Lab${rate / 6 >= 1.5 ? 's' : ''} (6/s each)`); continue; }
    for (const c of consumersOf(s, it)) {
      const n = rate / c.inputs![it]!;
      out.push(`${itemIcon(it, 13)} ${perMin(rate)} ${ITEMS[it].name.toLowerCase()} feeds <b>${n.toFixed(1)} × ${c.name}</b>`);
    }
  }
  if (d.gen === 'solar') {
    const night = nightSeconds(s);
    out.push(`☾ No output for ~${Math.round(night)} s each night. Every 6 power you want overnight needs ${f1(6 * night)} stored, so ≈ <b>${((6 * night) / (600 * s.fx.batteryMul)).toFixed(1)} Battery Banks per array</b>`);
  }
  if (d.battery) {
    const night = nightSeconds(s);
    const cap = d.battery.capacity * s.fx.batteryMul;
    out.push(`🔋 Holds ${f1(cap)} energy, enough for <b>${f1(cap / night)} power</b> through a ${Math.round(night)} s night (max ${d.battery.rate * s.fx.batteryMul}/s)`);
  }
  return out;
}

export function defTip(s: GameState, d: BuildingDef): string {
  const io: string[] = [];
  for (const [it, r] of Object.entries(d.inputs ?? {}) as [ItemId, number][]) io.push(`<span>In</span><b>${itemIcon(it, 13)} ${it === 'compute' ? f1(r) + '/s' : perMin(r)} ${ITEMS[it].name}</b>`);
  for (const [it, r] of Object.entries(d.outputs ?? {}) as [ItemId, number][]) io.push(`<span>Out</span><b class="g">${itemIcon(it, 13)} ${it === 'compute' ? f1(r) + '/s' : perMin(r)} ${ITEMS[it].name}</b>`);
  if (d.power < 0) io.push(`<span>Power</span><b class="r">−${-d.power}</b>`);
  if (d.power > 0) io.push(`<span>Power</span><b class="g">+${d.power}${d.gen === 'solar' ? ' (daylight)' : d.gen === 'wind' ? ' (varies)' : ''}</b>`);
  if (d.node) io.push(`<span>Grid reach</span><b>radius ${d.node.radius} · links ${d.node.reach}</b>`);
  io.push(...econRows(s, d));
  if (d.deposit) io.push(`<span>Placement</span><b>on ${['', 'quartz', 'ore', 'rare-earth'][d.deposit]} deposit</b>`);
  if (d.needsWater) io.push(`<span>Placement</span><b>next to water</b>`);
  const ratios = ratioLines(s, d);
  const autolink = d.outputs || d.inputs ? `<span class="dim">Auto-link connects it to the nearest partner within belt range (${LINKS.conveyor.maxLength} tiles). You see the dashed preview before you click. Use the Link tool (L) to add or change connections.</span>` : '';
  return `<b>${d.name}</b><br>${d.desc}<div class="tt">${io.join('')}</div>${ratios.length ? `<div class="ratio">${ratios.map((r) => `<div>${r}</div>`).join('')}</div>` : ''}${autolink}<br><span class="dim">Demolish refunds all materials, and all credits within 2 minutes (half after). Move it any time with V.</span>`;
}
