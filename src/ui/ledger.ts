// Ledger: credits chip, ledger modal, and the money lines in build tooltips.
// Reads the economy from the sim; the only thing it changes is the export switches.
import './ledger.css';
import { BUILDING, BUILDINGS } from '../sim/data/buildings';
import { EXPORTABLE, FEED_IN, POWER_PRICE, PRICE, PRICE_CURVE, REFUND_GRACE, REFUND_LATE, STIPEND } from '../sim/data/economy';
import { ITEMS } from '../sim/data/items';
import { canAfford, costOf } from '../sim/actions';
import { capexOf, costPerKCompute, keepLevel, liveByType, overdraftFloor, powerPrice, setSell, unitEcon, upkeepOf, upkeepPerMin as upkeepNow } from '../sim/economy';
import { COST_LINES, INCOME_LINES, timeOfDay } from '../sim/state';
import type { CostLine, GameState, IncomeLine } from '../sim/state';
import type { BuildingDef, ItemId } from '../sim/types';
import { itemIcon } from './icons';

const fmt = (v: number) => {
  const a = Math.abs(v);
  if (a >= 100000) return (v / 1000).toFixed(0) + 'k';
  if (a >= 10000) return (v / 1000).toFixed(1) + 'k';
  if (a >= 100) return Math.round(v).toLocaleString('en-US');
  if (a >= 10) return v.toFixed(0);
  return v.toFixed(1);
};
const sign = (v: number) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v));
/** credits with the ¢ sign */
export const cr = (v: number) => `${v < 0 ? '−' : ''}¢${fmt(Math.abs(v))}`;

export function coinIcon(size = 18): string {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.5" fill="#ffd84a"/><circle cx="10" cy="10" r="6" fill="none" stroke="#a87a10" stroke-width="1.2"/><path d="M12.3 7.2a3.2 3.2 0 1 0 0 5.6M10 4.8v10.4" stroke="#6b4a00" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;
}

const INCOME_NAME: Record<IncomeLine, string> = {
  market: 'Colony market', contracts: 'Special orders', exports: 'Exports', power_sold: 'Power sold', curtailment: 'Peak curtailment', funding: 'Funding rounds', stipend: 'Core stipend', grants: 'Emergency grants',
};
const COST_NAME: Record<CostLine, string> = {
  fuel: 'Gas fuel', upkeep: 'Upkeep', power_bought: 'Power bought', water: 'Water', interest: 'Debt interest',
};
const COST_HINT: Record<CostLine, string> = {
  fuel: 'Gas turbines burn fuel for every unit they make.',
  upkeep: 'Every building costs staff, spares and permits each minute.',
  power_bought: 'The Command Core draws from the colony grid at the time-of-day price.',
  water: 'Pumps pay for water rights (3× during a water restriction).',
  interest: 'A negative balance costs 3% per minute.',
};

/** Can the player afford this building right now (materials and credits)? */
export function affordable(s: GameState, d: BuildingDef): boolean {
  return canAfford(s, costOf(s, d)) && s.econ.credits >= capexOf(s, d.id);
}

/** Credit cost for the build palette, red when short. */
export function creditCostHtml(s: GameState, type: string): string {
  const c = capexOf(s, type);
  if (c <= 0) return '';
  return ` &nbsp;<span style="color:${s.econ.credits >= c ? '#ffd84a' : '#ff6a6a'}">${coinIcon(13)} ${fmt(c)}</span>`;
}

/** Money rows for a building tooltip (capex, upkeep, running cost, payback). */
export function econRows(s: GameState, d: BuildingDef): string[] {
  if (d.id === 'hq') return [];
  const u = unitEcon(s, d);
  const rows = [`<span>Capex</span><b style="color:#ffd84a">${cr(u.capex)}</b>`, `<span>Running cost</span><b>${cr(u.opex)}/min at full load</b>`];
  if (u.compute > 0) rows.push(`<span>Compute cost</span><b>${cr((u.opex / u.compute) * 1000)} per 1k compute</b>`);
  else if (u.payback !== null) rows.push(`<span>Payback</span><b class="g">${u.payback < 1 ? '<1' : fmt(u.payback)} min at full load</b>`);
  else if (u.value > 0) rows.push(`<span>Payback</span><b class="r">never: costs more than it earns</b>`);
  else rows.push(`<span>Payback</span><b>none on its own (${costCentre(d)})</b>`);
  return rows;
}

function costCentre(d: BuildingDef): string {
  if (d.workload === 'engine') return 'the fictional capstone';
  if (d.battery) return 'stores power for later';
  if (d.node) return 'carries the grid';
  if (d.cat === 'cooling') return 'part of the cost of compute';
  if (d.workload === 'research') return 'pays in research';
  if (d.workload) return 'earns through the colony market';
  if (d.storage || d.junction) return 'logistics';
  if (d.hub) return 'makes others faster';
  return 'supports other buildings';
}

interface Snap { t: number; credits: number; income: Record<IncomeLine, number>; costs: Record<CostLine, number>; exported: Partial<Record<ItemId, number>> }

const WINDOW = 180; // seconds of sim time for the per-minute rates
const HISTORY = 600; // seconds of balance history for the sparkline

export class Ledger {
  private snaps: Snap[] = [];
  /** set once the player has opened the ledger (tutorial step) */
  opened = false;
  private state: GameState | null = null;

  /** Record the economy totals (call a few times per second; keeps one snapshot per sim-second). */
  sample(s: GameState) {
    const last = this.snaps[this.snaps.length - 1];
    if (this.state !== s || (last && s.time < last.t)) { this.snaps = []; this.state = s; }
    if (last && s.time - last.t < 1) return;
    const e = s.econ;
    this.snaps.push({ t: s.time, credits: e.credits, income: { ...e.income }, costs: { ...e.costs }, exported: { ...e.exported } });
    while (this.snaps.length > 2 && this.snaps[0].t < s.time - HISTORY) this.snaps.shift();
  }

  /** Per-minute rates over the last WINDOW seconds, or null while there is too little history. */
  rates(s: GameState) {
    const now = this.snaps[this.snaps.length - 1];
    let old = this.snaps[0];
    for (const sn of this.snaps) if (sn.t >= s.time - WINDOW) { old = sn; break; }
    if (!now || !old || now.t - old.t < 5) return null;
    const k = 60 / (now.t - old.t);
    const income = {} as Record<IncomeLine, number>;
    const costs = {} as Record<CostLine, number>;
    for (const l of INCOME_LINES) income[l] = (now.income[l] - old.income[l]) * k;
    for (const l of COST_LINES) costs[l] = (now.costs[l] - old.costs[l]) * k;
    const exported: Partial<Record<ItemId, number>> = {};
    for (const it of EXPORTABLE) exported[it] = ((now.exported[it] ?? 0) - (old.exported[it] ?? 0)) * k;
    const inc = Object.values(income).reduce((a, b) => a + b, 0);
    const cost = Object.values(costs).reduce((a, b) => a + b, 0);
    return { income, costs, exported, inc, cost, net: inc - cost, span: now.t - old.t };
  }

  chipHtml(s: GameState): string {
    const r = this.rates(s);
    const c = s.econ.credits;
    return `<div class="res clickable credchip${c < 0 ? ' debt' : ''}" data-tipk="credits">${coinIcon(22)}<div><span class="v">${fmt(c)}</span><span class="r">${r ? sign(r.net) : '≈' + sign(STIPEND * 60 - upkeepNow(s))}/min</span></div></div>`;
  }

  tipHtml(s: GameState): string {
    const r = this.rates(s);
    const e = s.econ;
    let h = `<b>Credits</b> ${cr(e.credits)}<br>Buildings cost credits on top of materials, and every minute costs upkeep, power, fuel and water.`;
    if (r) {
      const top = (o: Record<string, number>, names: Record<string, string>) => Object.entries(o).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `<span>${names[k]}</span><b>${fmt(v)}/min</b>`).join('');
      h += `<div class="tt"><span>Income</span><b class="g">${sign(r.inc)}/min</b>${top(r.income, INCOME_NAME)}<span>Costs</span><b class="r">−${fmt(r.cost)}/min</b>${top(r.costs, COST_NAME)}</div>`;
    } else {
      // no history yet (e.g. paused at the start): show what is known without running
      h += `<div class="tt"><span>Core stipend</span><b class="g">+${fmt(STIPEND * 60)}/min</b><span>Upkeep of your buildings</span><b class="r">−${fmt(upkeepNow(s))}/min</b><span>Exports, market, power</span><b>once time runs</b></div>`;
    }
    if (e.credits < 0) h += `<span class="r">In debt: you cannot build, and debt costs 3% per minute. Below ${cr(overdraftFloor(s))} the colony council steps in (this era's score drops).</span><br>`;
    return h + `<span class="dim">Click or press K for the ledger.</span>`;
  }

  /** Ledger modal body. */
  html(s: GameState): string {
    const r = this.rates(s);
    const e = s.econ;
    const cpk = costPerKCompute(s);
    const util = s.stats.computeRate > 0.1 ? Math.min(1, s.stats.computeUsed / s.stats.computeRate) : null;
    const kpi = (label: string, v: string, cls = '', tip = '') => `<div class="lkpi"${tip ? ` data-tip="${tip}"` : ''}><div class="l">${label}</div><div class="v ${cls}">${v}</div></div>`;
    const bars = (rows: [string, number, string][], cls: string) => {
      const max = Math.max(1, ...rows.map((x) => x[1]));
      return rows.map(([name, v, tip]) => `<div class="lrow"${tip ? ` data-tip="${tip}"` : ''}><span>${name}</span><div class="sbar"><i class="${cls}" style="width:${Math.max(0, (v / max) * 100)}%"></i></div><b>${fmt(v)}</b></div>`).join('');
    };
    const incRows: [string, number, string][] = r ? INCOME_LINES.flatMap((l): [string, number, string][] => {
      if (l === 'exports') return EXPORTABLE.filter((it) => (r.exported[it] ?? 0) > 0.05).map((it): [string, number, string] => [`Exports: ${ITEMS[it].name.toLowerCase()}`, r.exported[it]!, '']);
      if (l === 'grants' && r.income[l] <= 0) return [];
      return [[INCOME_NAME[l], r.income[l], '']];
    }) : [];
    const costRows: [string, number, string][] = r ? COST_LINES.map((l): [string, number, string] => [COST_NAME[l], r.costs[l], COST_HINT[l]]) : [];
    const lumpy = r && (r.income.funding > 0 || r.income.grants > 0) ? '<div class="dim" style="font-size:13px">Funding rounds and grants are one-off payments.</div>' : '';

    // per building
    const rows = liveByType(s).map((t) => {
      const d = BUILDING[t.type];
      const net = t.value - t.opex;
      let netCell = '', pay = '';
      if (t.compute > 0) netCell = `<td colspan="2" class="am">${cr((t.opex / t.compute) * 1000)} per 1k compute</td>`;
      else if (t.value > 0) {
        netCell = `<td class="${net >= 0 ? 'g' : 'r'}">${sign(net)}</td>`;
        pay = t.payback !== null ? `<td class="${t.payback <= 15 ? 'g' : 'am'}">${t.payback < 1 ? '<1' : fmt(t.payback)} min</td>` : '<td class="r">never</td>';
        netCell += pay;
      } else if (unitEcon(s, d).value > 0) netCell = `<td colspan="2" class="dim">idle right now</td>`;
      else netCell = `<td colspan="2" class="dim">${costCentre(d)}</td>`;
      return `<tr><td>${d.name}</td><td>${t.count}</td><td>${Math.round(t.util * 100)}%</td><td>${fmt(t.capex)}</td><td>${fmt(t.opex)}</td><td>${t.value > 0 ? fmt(t.value) : '—'}</td>${netCell}</tr>`;
    }).join('');

    // exports
    // only items this era can make (or that are already in stock)
    const era = s.mode === 'sandbox' ? 5 : s.era;
    const exp = EXPORTABLE.filter((it) => (s.stock[it] ?? 0) > 0 || BUILDINGS.some((d) => d.era <= era && d.outputs?.[it])).map((it) => {
      const on = !!e.sell[it];
      const keep = keepLevel(s, it);
      return `<button class="lexp${on ? ' on' : ''}" data-sell="${it}" data-tip="<b>${ITEMS[it].name}</b> sells at ${cr(PRICE[it] ?? 0)} each.<br>${on ? `Selling everything above ${keep} (enough to build anything this era). Click to hold.` : 'Holding all of it. Click to sell the surplus.'}">${itemIcon(it, 16)} ${ITEMS[it].name} ${cr(PRICE[it] ?? 0)} · ${on ? `SELL above ${keep}` : 'HOLD all'} <span class="dim">(${fmt(s.stock[it] ?? 0)})</span></button>`;
    }).join('');
    const idleAccel = !e.sell.accel && (s.stock.accel ?? 0) > keepLevel(s, 'accel') * 2 ? `<div class="am" style="margin-top:6px">You hold ${fmt(s.stock.accel ?? 0)} accelerators worth ${cr((s.stock.accel ?? 0) * (PRICE.accel ?? 0))}. Selling some is an option if cash is short.</div>` : '';

    return `<div class="mcard panel ledger"><h1>LEDGER</h1><div class="lede">Credits pay for construction (capex) and running costs (opex). Rates are per minute over the last ${Math.round(r?.span ?? WINDOW) >= 60 ? Math.round((r?.span ?? WINDOW) / 60) + ' minutes' : 'few seconds'}. Payback = capex ÷ (value − running cost) at today’s utilisation and average power price.</div>
      <div class="lkpis">${kpi('BALANCE', cr(e.credits), e.credits < 0 ? 'r' : '')}${kpi('NET / MIN', r ? sign(r.net) : '…', r && r.net < 0 ? 'r' : 'g')}${kpi('COST / 1K COMPUTE', cpk !== null ? cr(cpk) : '—', '', 'Running cost of compute and cooling buildings per 1,000 compute they produce.')}${kpi('UTILISATION', util !== null ? Math.round(util * 100) + '%' : '—', util !== null && util < 0.7 ? 'am' : '', 'Share of produced compute that reaches a workload. Idle compute still costs power and upkeep.')}<div class="lkpi spark"><div class="l">BALANCE${(() => { const m = Math.round(Math.min(HISTORY, this.snaps.length ? s.time - this.snaps[0].t : 0) / 60); return m >= 1 ? `, LAST ${m} MIN` : ' TREND'; })()}</div>${this.spark()}</div></div>
      <div class="lgrid"><div><h3 class="g">INCOME ${r ? sign(r.inc) + ' / min' : ''}</h3>${r ? bars(incRows, 'g') + lumpy : '<div class="dim">Measuring…</div>'}</div>
      <div><h3 class="r">COSTS ${r ? '−' + fmt(r.cost) + ' / min' : ''}</h3>${r ? bars(costRows, 'r') : '<div class="dim">Measuring…</div>'}</div>
      <div><h3 style="color:#ffe066">POWER PRICE TODAY</h3>${this.priceStrip(s)}<div class="dim" style="font-size:13px">Now ${cr(powerPrice(s) * 60)} per power-minute (average ${cr(POWER_PRICE * 60)}). Surplus sells for ${Math.round(FEED_IN * 100)}% of the price. Batteries let you buy cheap and use it at the peak.</div></div></div>
      <h3 class="lh">PER BUILDING (live, at average power price)</h3>
      <div class="ltab"><table class="stab"><tr><th>Building</th><th>#</th><th>Use</th><th>Capex each</th><th>Opex/min</th><th>Value/min</th><th>Net/min</th><th>Payback</th></tr>${rows || '<tr><td colspan="8" class="dim">Nothing built yet.</td></tr>'}</table></div>
      <h3 class="lh">EXPORTS</h3><div class="lexps">${exp}</div>${idleAccel}
      <div class="kv lfoot"><span class="k">Spent on construction</span><span class="v">${cr(e.capex)}</span><span class="k">Upkeep of all buildings</span><span class="v">${cr(s.buildings.reduce((a, b) => a + upkeepOf(b.type), 0))}/min</span><span class="k">Emergency grants</span><span class="v">${e.grants}</span><span class="k">Demolish refund</span><span class="v">100% of capex for ${REFUND_GRACE / 60} min, then ${Math.round(REFUND_LATE * 100)}%</span></div>
      <div class="mact"><button data-codex>UNIT ECONOMICS (CODEX)</button><button class="primary" data-x>BACK</button></div></div>`;
  }

  /** Handle a pointer event inside the ledger (export switches). Returns true if it changed something. */
  handle(target: HTMLElement, s: GameState): boolean {
    const b = target.closest<HTMLElement>('[data-sell]');
    if (!b) return false;
    const it = b.dataset.sell as ItemId;
    setSell(s, it, !s.econ.sell[it]);
    return true;
  }

  private spark(): string {
    const pts = this.snaps;
    if (pts.length < 3) return '<div class="dim" style="font-size:13px">Measuring…</div>';
    const W = 160, H = 34;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    let lo = Math.min(0, ...pts.map((p) => p.credits)), hi = Math.max(...pts.map((p) => p.credits));
    if (hi - lo < 1) hi = lo + 1;
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
    const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
    const line = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.credits).toFixed(1)}`).join(' ');
    const zero = lo < 0 ? `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#ff6a6a" stroke-dasharray="3 3" stroke-width="1"/>` : '';
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${zero}<polyline points="${line}" fill="none" stroke="#6fe9ff" stroke-width="2"/></svg>`;
  }

  private priceStrip(s: GameState): string {
    const W = 260, H = 70, max = Math.max(...PRICE_CURVE.map((p) => p[1]));
    const y = (v: number) => H - 6 - (v / max) * (H - 14);
    const line = PRICE_CURVE.map(([t, v]) => `${(t * W).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const now = timeOfDay(s) * W;
    const hours = [0, 6, 12, 18].map((h) => `<text x="${(h / 24) * W + 2}" y="${H}" fill="#93a4c4" font-size="10">${String(h).padStart(2, '0')}h</text>`).join('');
    return `<svg width="${W}" height="${H + 4}" viewBox="0 0 ${W} ${H + 4}"><line x1="0" x2="${W}" y1="${y(1)}" y2="${y(1)}" stroke="#93a4c4" stroke-opacity=".35" stroke-dasharray="2 3"/><polyline points="${line}" fill="none" stroke="#ffe066" stroke-width="2"/><line x1="${now}" x2="${now}" y1="0" y2="${H - 6}" stroke="#e8f1ff" stroke-dasharray="3 3"/>${hours}</svg>`;
  }
}
