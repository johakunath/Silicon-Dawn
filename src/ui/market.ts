// Market & Models: the modal (B) and the sidebar card that replaces the old contracts list.
// Reads the market from the sim; it changes only the run size, deployment and the auto-deploy switch.
import './market.css';
import { BASE_LATENCY, MODEL_SIZES, SEGMENT, SEGMENTS, SIZE_ORDER } from '../sim/data/market';
import {
  deploy, deployedModel, estimate, maxLoad, minutesUntil, retire, runQuality, setAutoDeploy, setNextSize, share,
} from '../sim/market';
import type { GameState } from '../sim/state';
import type { Contract, LostReason, Model, ModelSizeId } from '../sim/types';
import { cr } from './ledger';

const fmt = (v: number) => (Math.abs(v) >= 10000 ? (v / 1000).toFixed(1) + 'k' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const REASON: Record<LostReason, { label: string; cls: string; tip: string }> = {
  model: { label: 'weak model', cls: 'r', tip: 'Your deployed model is below the quality this segment accepts. Train a bigger model, or train over fiber.' },
  reputation: { label: 'reputation', cls: 'am', tip: 'Gateway uptime is below what these customers expect, so some of them left. Keep gateways powered, supplied and repaired.' },
  latency: { label: 'latency', cls: 'am', tip: 'There is enough capacity, but serving these customers would push the gateways past the load their latency allows. Add spare gateway capacity.' },
  capacity: { label: 'capacity', cls: 'am', tip: 'Not enough compute reaches your gateways. Link more racks, halls or pods (inference mode serves more).' },
};

function latencyText(ms: number): string {
  return Number.isFinite(ms) ? `${Math.round(ms)} ms` : 'queueing';
}

function needs(id: keyof typeof SEGMENT): string {
  const d = SEGMENT[id];
  return `Q${Math.round(d.minQuality * 100)} · ${Number.isFinite(d.maxLatency) ? `≤${d.maxLatency}ms` : 'batch'} · ${Math.round(d.uptime * 100)}%`;
}

function servesList(s: GameState, m: Model): string {
  const q = share(s, m);
  const ok = SEGMENTS.filter((d) => q >= d.minQuality).map((d) => d.name.toLowerCase());
  return ok.length ? `serves ${ok.join(', ')}` : 'too weak for any segment';
}

/** Next segment the model will lose, as a warning line, or ''. */
function agingNote(s: GameState, m: Model): string {
  const q = share(s, m);
  const next = SEGMENTS.filter((d) => q >= d.minQuality).sort((a, b) => b.minQuality - a.minQuality)[0];
  if (!next) return '';
  const min = minutesUntil(s, m, next.minQuality);
  return min < 10 ? `loses ${next.name} in ~${Math.max(1, Math.round(min))} min (needs ${pct(next.minQuality)})` : '';
}

export class MarketPanel {
  /** set once the player has opened the panel */
  opened = false;

  /** Sidebar card: revenue, deployed model, training run, and special orders below. */
  cardHtml(s: GameState): string {
    const m = s.market;
    const d = deployedModel(s);
    let h = `<h3>MARKET <span class="mklink" data-market>B · details</span></h3>`;
    h += `<div class="mkrev"><b class="g">${cr(m.revRate * 60)}/min</b><span class="r" data-tip="Revenue lost to unserved demand, per minute. Open the market (B) to see why.">lost ${cr(m.lostRate * 60)}</span></div>`;
    if (d) h += `<div class="d">${esc(d.name)} · quality ${pct(share(s, d))} · rep ${pct(m.rep)}</div>`;
    if (m.run) {
      const p = m.run.progress / m.run.target;
      h += `<div class="d">Training ${esc(m.run.name)} · ${pct(p)}</div><div class="pb mk"><i style="width:${Math.min(100, p * 100)}%"></i></div>`;
    }
    return h;
  }

  /** One special order (the old contracts) for the sidebar card. */
  orderHtml(s: GameState, c: Contract): string {
    const isT = c.kind === 'training';
    const pr = isT ? c.progress / c.target : c.progress / c.duration;
    let h = `<div class="ct ${c.kind}"><div class="n">${isT ? '△ TRAIN' : '◈ SERVE'} · ${c.title}</div><div class="d">${isT ? `${fmt(c.target)} training in ${Math.round(c.duration / 60)} min` : `${c.target} compute/s at Gateways for ${Math.round(c.duration)} s`} · ${cr(c.reward.credits ?? 0)} + ${c.reward.rp} research</div>`;
    if (c.state === 'offered') h += `<button data-c="${c.id}">ACCEPT (${Math.ceil(c.expires)}s)</button>`;
    else h += `<div class="pb"><i style="width:${Math.min(100, pr * 100)}%"></i></div><div class="d">${isT ? `${fmt(c.progress)} / ${fmt(c.target)} · ${Math.ceil(c.duration - c.t)}s left` : `serving ${fmt(s.stats.inferenceRate)}/s · uptime ${Math.round(c.uptime * 100)}% · ${Math.ceil(c.duration - c.t)}s left`}</div>`;
    return h + `</div>`;
  }

  /** Modal body. */
  html(s: GameState): string {
    const m = s.market;
    if (!m.open) {
      return `<div class="mcard panel market"><h1>MARKET &amp; MODELS</h1><div class="lede">The colony market opens in Era III. Then Inference Gateways sell answers to the colonies, and a Training Core makes the models that answer.</div><div class="mact"><button class="primary" data-x>BACK</button></div></div>`;
    }
    const d = deployedModel(s);
    const kpi = (label: string, v: string, cls = '', tip = '') => `<div class="lkpi"${tip ? ` data-tip="${tip}"` : ''}><div class="l">${label}</div><div class="v ${cls}">${v}</div></div>`;
    const growth = ((m.frontier - 1) * 100).toFixed(0);
    const kpis = kpi('REVENUE', `${cr(m.revRate * 60)}/min`, 'g')
      + kpi('LOST (UNSERVED)', `${cr(m.lostRate * 60)}/min`, m.lostRate > m.revRate ? 'r' : 'am', 'What unserved demand would have paid. The table shows why it went unserved.')
      + kpi('REPUTATION', pct(m.rep), m.rep < 0.85 ? 'am' : '', `Follows gateway uptime (now ${m.uptime >= 0 ? pct(m.uptime) : 'no gateway linked'}). Enterprise customers expect 95%.`)
      + kpi('GATEWAY LOAD · LATENCY', `${pct(m.load)} · ${latencyText(m.latency)}`, m.load > 0.85 ? 'am' : '', `Latency = ${BASE_LATENCY} ms ÷ (1 − load). Capacity now ${fmt(m.capacity)} queries/s with ${d ? esc(d.name) : 'no model'}.`)
      + kpi('FRONTIER', `${m.frontier.toFixed(2)}×`, 'vi', `The best rival model, ${growth}% better than when the market opened. It keeps growing, so every model ages.`);

    const max = Math.max(1, ...SEGMENTS.map((x) => m.seg[x.id].demand));
    const rows = SEGMENTS.map((x) => {
      const L = m.seg[x.id];
      const w = (v: number) => Math.max(0, Math.min(100, (v / max) * 100));
      const why = L.reason && L.lost > 1e-6 ? REASON[L.reason] : null;
      return `<div class="mkrow" data-tip="<b>${x.name}</b>: ${x.desc}<br>Pays ${cr(x.price)} per query at 100% quality (now ${cr(L.price)}). Needs quality ≥ ${pct(x.minQuality)}, ${Number.isFinite(x.maxLatency) ? `latency ≤ ${x.maxLatency} ms (gateway load ≤ ${pct(maxLoad(x))})` : 'no latency limit (batch)'}, reputation ≥ ${pct(x.uptime)}.">
        <span class="sn">${x.name}</span><span class="dim">${needs(x.id)}</span>
        <div class="mkbar"><i class="dem" style="width:${w(L.demand)}%"></i><i class="srv" style="width:${w(L.served)}%"></i></div>
        <span class="dim num">${fmt(L.served)}/${fmt(L.demand)}</span><b class="g num">${fmt(L.revenue * 60)}</b>
        <span class="${why ? why.cls : 'dim'}"${why ? ` data-tip="${why.tip}"` : ''}>${why ? why.label : '–'}</span></div>`;
    }).join('');

    const run = m.run;
    const runHtml = run ? (() => {
      const p = run.progress / run.target;
      const eta = s.stats.trainRate > 0.5 ? Math.max(0, (run.target - run.progress) / s.stats.trainRate) : Infinity;
      const fiber = run.progress > 0 ? run.fiber / run.progress : 0;
      return `<div class="mkrun"><span>Training <b>${esc(run.name)}</b></span><span class="dim">${fmt(run.progress)} / ${fmt(run.target)} · ${Number.isFinite(eta) ? `~${Math.max(1, Math.round(eta / 60))} min` : 'no training compute'}</span></div>
        <div class="pb mk big"><i style="width:${Math.min(100, p * 100)}%"></i></div>
        <div class="dim sm">Ships at about ${pct(runQuality(s) / m.frontier)} of the frontier · ${pct(fiber)} over fiber</div>`;
    })() : '<div class="dim">No run.</div>';
    const sizes = SIZE_ORDER.map((k) => {
      const z = MODEL_SIZES[k];
      const on = m.nextSize === k;
      return `<button class="mksize${on ? ' on' : ''}" data-size="${k}" data-tip="<b>${z.name}</b>: ${fmt(z.train)} training × era scale. Ships at ${pct(z.quality * 0.9)}–${pct(z.quality * 1.1)} of the frontier. ${z.cost} compute per query.">${z.name}${k === 'S' ? ' · fast' : k === 'L' ? ' · slow' : ''}</button>`;
    }).join('');

    const cards = [...m.models].sort((a, b) => (a.id === m.deployed ? -1 : b.id === m.deployed ? 1 : b.born - a.born)).map((x) => {
      const live = x.id === m.deployed;
      const q = share(s, x);
      const est = live ? null : estimate(s, x);
      const note = agingNote(s, x);
      return `<div class="mkcard${live ? ' live' : ''}">
        <div class="mkh"><b>${live ? '● ' : ''}${esc(x.name)}${live ? ' · LIVE' : ''}</b><span class="dim">earned ${cr(x.earned)}</span></div>
        <div class="mkq"><span class="dim">quality</span><div class="qbar"><i style="width:${Math.min(100, (q / 1.5) * 100)}%"></i><em style="left:${(1 / 1.5) * 100}%"></em></div><b>${pct(q)}</b></div>
        <div class="dim sm">${x.cost} compute per query · ${servesList(s, x)}${live ? ` · ${cr(m.revRate * 60)}/min now` : ` · would earn ${cr(est!.revenue * 60)}/min`}</div>
        ${note ? `<div class="am sm">${note}</div>` : ''}
        ${live ? '' : `<div class="mkbtn"><button data-deploy="${x.id}">DEPLOY</button><button data-retire="${x.id}">RETIRE</button></div>`}</div>`;
    }).join('');

    return `<div class="mcard panel ledger market"><h1>MARKET &amp; MODELS</h1>
      <div class="lede">The colonies buy answers. Gateways serve them with your deployed model; the best-paying mix that fits your capacity wins. Interactive customers need spare capacity, firms need uptime, scientists need a frontier model.</div>
      <div class="lkpis">${kpis}</div>
      <div class="mkgrid"><div>
        <h3 class="lh" style="margin-top:0">COLONY DEMAND <span class="dim sm">queries/s</span></h3>
        <div class="mkrow head"><span>segment</span><span>needs</span><span>served / demand</span><span></span><span class="num">¢/min</span><span>lost to</span></div>${rows}
        <div class="dim sm" style="margin-top:6px">Q = model quality vs. the frontier · latency limit · reputation. Lighter bar = demand, solid = served.</div>
        <h3 class="lh">REVENUE AND PRICE · last ${Math.max(1, Math.round((m.history.length * 10) / 60))} min</h3>${this.chart(s)}
      </div><div>
        <h3 class="lh" style="margin-top:0">TRAINING CORE</h3>${runHtml}
        <div class="mksizes"><span class="dim">Next run:</span>${sizes}</div>
        <h3 class="lh">MODELS <label class="mkauto" data-auto><span class="box${m.autoDeploy ? ' on' : ''}">${m.autoDeploy ? '✓' : ''}</span> auto-deploy the best earner</label></h3>
        ${cards}
        <div class="dim sm" style="margin-top:8px">A model is as good as the frontier when it ships, times its size, plus up to 20% for training over fiber. Bigger models need more compute per query, so each gateway serves fewer queries.</div>
      </div></div>
      <div class="mact"><button data-codex>MARKET &amp; MODELS (CODEX)</button><button class="primary" data-x>BACK</button></div></div>`;
  }

  /** Handle a pointer event inside the modal. Returns true if it changed something. */
  handle(target: HTMLElement, s: GameState): boolean {
    const size = target.closest<HTMLElement>('[data-size]');
    if (size) { setNextSize(s, size.dataset.size as ModelSizeId); return true; }
    const dep = target.closest<HTMLElement>('[data-deploy]');
    if (dep) { if (s.market.autoDeploy) setAutoDeploy(s, false); return deploy(s, Number(dep.dataset.deploy)); }
    const ret = target.closest<HTMLElement>('[data-retire]');
    if (ret) return retire(s, Number(ret.dataset.retire));
    if (target.closest('[data-auto]')) { setAutoDeploy(s, !s.market.autoDeploy); return true; }
    return false;
  }

  private chart(s: GameState): string {
    const h = s.market.history;
    if (h.length < 3) return '<div class="dim">Measuring… the chart fills in every 10 seconds.</div>';
    const W = 640, H = 150, pad = 4;
    const t0 = h[0].t, t1 = h[h.length - 1].t;
    const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad);
    const rmax = Math.max(1, ...h.map((p) => p.rev)), pmax = Math.max(0.01, ...h.map((p) => p.price));
    const yr = (v: number) => H - pad - (v / rmax) * (H - 2 * pad - 14);
    const yp = (v: number) => H - pad - (v / pmax) * (H - 2 * pad - 14);
    const rev = h.map((p) => `${x(p.t).toFixed(1)},${yr(p.rev).toFixed(1)}`).join(' ');
    const price = h.filter((p) => p.price > 0).map((p) => `${x(p.t).toFixed(1)},${yp(p.price).toFixed(1)}`).join(' ');
    return `<svg class="mkchart" viewBox="0 0 ${W} ${H + 18}" width="100%"><rect x="0" y="0" width="${W}" height="${H}" fill="rgba(13,20,40,.8)" stroke="rgba(111,233,255,.2)"/>
      <polyline points="${rev}" fill="none" stroke="#5dff9a" stroke-width="2.5"/>${price ? `<polyline points="${price}" fill="none" stroke="#ffb347" stroke-width="2" stroke-dasharray="6 4"/>` : ''}
      <text x="8" y="16" fill="#5dff9a" font-size="13">${cr(rmax)}/min</text>
      <text x="8" y="${H + 15}" fill="#5dff9a" font-size="12">— revenue per minute</text><text x="200" y="${H + 15}" fill="#ffb347" font-size="12">- - average price per query (falls as your model ages)</text></svg>`;
  }
}
