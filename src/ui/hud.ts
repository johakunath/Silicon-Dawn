import * as THREE from 'three';
import { audio } from '../audio/audio';
import type { Game } from '../game/game';
import { AUTOSAVE_KEY } from '../game/game';
import { BUILDING, BUILDINGS } from '../sim/data/buildings';
import { ERAS, pue } from '../sim/data/eras';
import { EVENT } from '../sim/data/events';
import { GUIDE } from '../sim/data/guide';
import { ITEMS, LINKS } from '../sim/data/items';
import { TECHS } from '../sim/data/tech';
import { acceptContract, canAfford, canResearch, checkLink, costOf, cycleMode, isUnlocked, lockReason, research, PlaceCheck, removeLink, repair } from '../sim/actions';
import { ENGINE_TARGET, inputCap, outputCap } from '../sim/sim';
import type { EraScore } from '../sim/state';
import { DAY_LENGTH, hq, sunlight, timeOfDay } from '../sim/state';
import type { Building, BuildingCategory, Cost, ItemId } from '../sim/types';
import { BIOME, idx } from '../sim/world';
import { coveredAt } from '../sim/power';
import { tileHeight } from '../render/terrain';
import { itemIcon, renderThumbnails, thumb } from './icons';
import { badgeFor, explain } from './status';

const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const fmt = (v: number) => (Math.abs(v) >= 10000 ? (v / 1000).toFixed(1) + 'k' : Math.abs(v) >= 100 ? Math.round(v).toString() : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));
const costHtml = (s: Game['s'], c: Cost) => Object.entries(c).map(([k, v]) => `<span style="color:${(s.stock[k as ItemId] ?? 0) >= (v as number) ? '#cfe0ff' : '#ff6a6a'}">${itemIcon(k as ItemId, 13)} ${v}</span>`).join(' &nbsp;') || '<span style="color:#93a4c4">free</span>';

const TABS: { id: string; name: string; cats: BuildingCategory[] }[] = [
  { id: 'power', name: 'POWER', cats: ['power'] },
  { id: 'prod', name: 'INDUSTRY', cats: ['extract', 'refine', 'logistics'] },
  { id: 'compute', name: 'COMPUTE', cats: ['compute', 'cooling', 'workload', 'special'] },
];

const SHOWN_RES: ItemId[] = ['metal', 'silicon', 'chips', 'accel', 'rare', 'robots'];

export class Hud {
  pointerOverUi = false;
  private root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private tab = 'power';
  private slowT = 0;
  private lastStock: Partial<Record<ItemId, number>> = {};
  private rate: Partial<Record<ItemId, number>> = {};
  private seenFeed = 0;
  private mapBase: ImageData | null = null;
  private mapCtx!: CanvasRenderingContext2D;
  private newSeen = new Set<string>();
  private deliverAcc = 0;
  private lastDelivered = 0;
  private openModal: string | null = null;
  private lastSimT = 0;

  constructor(private g: Game, root: HTMLElement) {
    this.root = root;
    renderThumbnails();
    this.build();
    root.addEventListener('pointerover', (e) => { this.pointerOverUi = (e.target as HTMLElement) !== root && !!(e.target as HTMLElement).closest('.panel, .modal, button'); });
    root.addEventListener('pointerout', () => { this.pointerOverUi = false; });
    this.onNewState();
    this.showTitle();
  }

  private build() {
    const r = this.root;
    r.innerHTML = '';
    const add = (id: string, el: HTMLElement) => { el.id = id; r.appendChild(el); this.els[id] = el; return el; };
    add('badges', h('canvas'));
    add('floats', h('div'));
    add('redvig', h('div', 'vignette-red'));
    // top bar
    const top = add('topbar', h('div', 'panel'));
    top.innerHTML = `<div id="logo">SILICON<br>DAWN</div><div id="erachip"></div><div id="res"></div>
      <div class="gauge" id="pgauge"><div class="top"><span>${itemIcon('power', 16)} POWER</span><span id="pval"></span></div><div class="bar"><i id="pbar"></i><b id="pdem"></b></div><div class="top" style="font-size:13px;color:#93a4c4"><span id="pbat"></span><span id="ppue"></span></div></div>
      <div class="gauge" id="cgauge"><div class="top"><span style="color:#6fe9ff">◈ COMPUTE</span><span id="cval"></span></div><div class="bar"><i id="cbar" style="background:#6fe9ff"></i></div><div class="top" style="font-size:13px;color:#93a4c4"><span id="cuse"></span><span id="crp"></span></div></div>
      <div id="clock"></div><div id="speed"></div>
      <button id="btn-tech" title="Tech tree (T)">TECH <kbd>T</kbd></button><button id="btn-guide" title="Field guide (J)">GUIDE <kbd>J</kbd></button><button id="btn-menu" title="Menu (Esc)">☰</button>`;
    this.els.res = top.querySelector('#res')!;
    const sp = top.querySelector('#speed')!;
    for (const [lbl, v] of [['❚❚', 0], ['1×', 1], ['2×', 2], ['4×', 4]] as const) {
      const b = h('button', '', lbl);
      b.dataset.v = String(v);
      b.onclick = () => { if (v === 0) { this.g.paused = !this.g.paused; audio.play('click'); this.refreshSpeed(); } else this.g.setSpeed(v); };
      sp.appendChild(b);
    }
    (top.querySelector('#btn-tech') as HTMLElement).onclick = () => this.openTech();
    (top.querySelector('#btn-guide') as HTMLElement).onclick = () => this.openGuide();
    (top.querySelector('#btn-menu') as HTMLElement).onclick = () => this.openMenu();
    // build palette
    const bp = add('build', h('div', 'panel'));
    bp.innerHTML = `<div class="ptitle">BUILD <span style="float:right;font-size:14px"><kbd>L</kbd> link · <kbd>X</kbd> demolish</span></div><div class="tabs"></div><div class="list"></div>`;
    const tabs = bp.querySelector('.tabs')!;
    for (const t of TABS) { const b = h('button', '', t.name); b.dataset.tab = t.id; b.onclick = () => { this.tab = t.id; audio.play('click'); this.refreshPalette(); }; tabs.appendChild(b); }
    const tools = h('div', 'tabs');
    const lb = h('button', '', '⟿ LINK'); lb.id = 'tool-link'; lb.onclick = () => this.g.setTool(this.g.tool.kind === 'link' ? { kind: 'select' } : { kind: 'link', from: this.g.view.selected?.id ?? null });
    const db = h('button', '', '✕ DEMOLISH'); db.id = 'tool-demo'; db.onclick = () => this.g.setTool(this.g.tool.kind === 'demolish' ? { kind: 'select' } : { kind: 'demolish' });
    const ab = h('button', '', 'AUTO-LINK'); ab.id = 'tool-auto'; ab.title = 'Automatically connect new buildings to nearby partners'; ab.onclick = () => { this.g.s.autoLink = !this.g.s.autoLink; audio.play('click'); this.refreshTool(); };
    tools.append(lb, db, ab);
    bp.insertBefore(tools, bp.querySelector('.list'));
    // side
    const side = add('side', h('div'));
    side.innerHTML = `<div id="eventbar" class="panel"></div><div id="obj" class="panel"></div><div id="contracts" class="panel"></div>`;
    this.els.obj = side.querySelector('#obj')!; this.els.contracts = side.querySelector('#contracts')!; this.els.eventbar = side.querySelector('#eventbar')!;
    // minimap + overlays
    const mw = add('mapwrap', h('div', 'panel'));
    mw.innerHTML = `<canvas id="minimap" width="128" height="128"></canvas><div id="ovbtns"></div>`;
    const mm = mw.querySelector('#minimap') as HTMLCanvasElement;
    this.mapCtx = mm.getContext('2d')!;
    mm.addEventListener('pointerdown', (e) => {
      const rc = mm.getBoundingClientRect();
      const S = this.g.s.world.size;
      this.g.focus(((e.clientX - rc.left) / rc.width) * S, ((e.clientY - rc.top) / rc.height) * S);
      audio.play('click');
    });
    const ovb = mw.querySelector('#ovbtns')!;
    for (const [id, lbl, key] of [['power', '⚡ POWER', 'P'], ['heat', '♨ HEAT', 'H'], ['network', '◈ NET', 'N'], ['logistics', '➜ FLOW', 'O']] as const) {
      const b = h('button', '', `<span>${lbl}</span><kbd>${key}</kbd>`); b.dataset.ov = id; b.onclick = () => this.g.setOverlay(id); ovb.appendChild(b);
    }
    add('legend', h('div', 'panel'));
    add('insp', h('div', 'panel'));
    add('toasts', h('div'));
    add('tip', h('div', 'panel'));
    add('hint', h('div', 'panel'));
    add('fps', h('div'));
    add('banner', h('div'));
    // modals
    for (const id of ['guide', 'tech', 'menu', 'title', 'score', 'finale', 'save']) {
      const m = add(id, h('div', 'modal'));
      m.addEventListener('pointerdown', (e) => { if (e.target === m && id !== 'title' && id !== 'finale') this.closeModals(); });
    }
  }

  onNewState() {
    const s = this.g.s;
    this.lastStock = { ...s.stock };
    this.lastSimT = s.time;
    this.rate = {};
    this.seenFeed = s.feed.length;
    this.mapBase = null;
    this.newSeen = new Set(BUILDINGS.filter((d) => isUnlocked(s, d)).map((d) => d.id));
    this.lastDelivered = Object.values(s.stats.delivered).reduce((a, b) => a + (b ?? 0), 0);
    this.refreshPalette(); this.refreshTool(); this.refreshOverlay(); this.refreshSpeed(); this.refreshInspector(true);
    this.slowT = 99;
  }

  // ───────── palette ─────────
  refreshPalette() {
    const s = this.g.s;
    const bp = this.els.build;
    bp.querySelectorAll<HTMLElement>('.tabs button[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const list = bp.querySelector('.list')!;
    list.innerHTML = '';
    const tab = TABS.find((t) => t.id === this.tab)!;
    const defs = BUILDINGS.filter((d) => d.id !== 'hq' && tab.cats.includes(d.cat));
    defs.sort((a, b) => a.era - b.era);
    let n = 0;
    for (const d of defs) {
      const unlocked = isUnlocked(s, d);
      if (!unlocked && d.era > s.era + 1 && s.mode !== 'sandbox') continue;
      n++;
      const cost = costOf(s, d);
      const el = h('div', 'bitem clickable' + (unlocked ? '' : ' locked') + (unlocked && !canAfford(s, cost) ? ' poor' : ''));
      el.dataset.type = d.id;
      const lr = lockReason(s, d);
      el.innerHTML = `<img src="${thumb(d.id)}" alt=""><div><div class="n">${d.name}</div><div class="s">${lr && !unlocked ? '🔒 ' + lr : d.short}</div><div class="cost">${unlocked ? costHtml(s, cost) : ''}</div></div>${unlocked && n <= 9 ? `<kbd class="hk">${n}</kbd>` : ''}${unlocked && !this.newSeen.has(d.id) ? '<span class="new">NEW</span>' : ''}`;
      el.onclick = () => { if (!unlocked) { audio.play('error'); return; } this.newSeen.add(d.id); this.g.setTool({ kind: 'build', type: d.id }); audio.play('click'); };
      el.onmouseenter = () => audio.play('hover');
      el.title = d.desc;
      if (this.g.tool.kind === 'build' && this.g.tool.type === d.id) el.classList.add('on');
      list.appendChild(el);
    }
    // NEW markers on tabs
    bp.querySelectorAll<HTMLElement>('.tabs button[data-tab]').forEach((b) => {
      const t = TABS.find((t) => t.id === b.dataset.tab)!;
      const hasNew = BUILDINGS.some((d) => t.cats.includes(d.cat) && d.id !== 'hq' && isUnlocked(s, d) && !this.newSeen.has(d.id));
      b.innerHTML = t.name + (hasNew ? ' <span style="color:#ffe066">●</span>' : '');
    });
  }

  hotkey(n: number) {
    const items = [...this.els.build.querySelectorAll<HTMLElement>('.bitem:not(.locked)')];
    const el = items[n - 1];
    if (el) el.click();
  }

  refreshTool() {
    const t = this.g.tool;
    this.els.build.querySelectorAll<HTMLElement>('.bitem').forEach((e) => e.classList.toggle('on', t.kind === 'build' && e.dataset.type === t.type));
    this.root.querySelector('#tool-link')?.classList.toggle('on', t.kind === 'link');
    this.root.querySelector('#tool-demo')?.classList.toggle('on', t.kind === 'demolish');
    this.root.querySelector('#tool-auto')?.classList.toggle('on', this.g.s.autoLink);
    const hint = this.els.hint;
    if (t.kind === 'build') hint.innerHTML = `<b>LMB</b> place · drag to paint · <b>RMB</b>/<b>Esc</b> cancel · new buildings ${this.g.s.autoLink ? '<b>auto-link</b> to neighbours' : 'are <b>not</b> auto-linked'}`;
    else if (t.kind === 'link') hint.innerHTML = t.from === null ? '<b>LINK:</b> click the <b>source</b> building (or click a link to remove it) · <b>Esc</b> cancel' : `<b>LINK:</b> click the <b>destination</b> for ${BUILDING[this.g.s.byId.get(t.from)?.type ?? 'hq'].name} · hold <b>Shift</b> to chain`;
    else if (t.kind === 'demolish') hint.innerHTML = '<b>DEMOLISH:</b> click a building or link · 50% refund (100% within 15 s) · <b>Esc</b> cancel';
    else hint.innerHTML = '<b>WASD</b>/drag RMB pan · <b>wheel</b> zoom · <b>Q/E</b> rotate · <b>Z</b> next problem · <b>C</b> core · <b>Space</b> pause';
  }

  refreshSpeed() {
    this.els.topbar.querySelectorAll<HTMLElement>('#speed button').forEach((b) => {
      const v = Number(b.dataset.v);
      b.classList.toggle('on', v === 0 ? this.g.paused : !this.g.paused && this.g.speed === v);
    });
  }

  refreshOverlay() {
    const ov = this.g.view.overlay;
    this.root.querySelectorAll<HTMLElement>('#ovbtns button').forEach((b) => b.classList.toggle('on', b.dataset.ov === ov));
    const lg = this.els.legend;
    const row = (c: string, t: string) => `<div class="row"><span class="sw" style="background:${c}"></span>${t}</div>`;
    const legends: Record<string, string> = {
      power: `<div class="ptitle">⚡ POWER OVERLAY</div>${row('#ffd84a', 'Covered and fully supplied')}${row('#ff8c28', 'Covered, brownout (60–98%)')}${row('#ff3c3c', 'Covered, severe brownout')}<div class="row">Wires link nodes. ⚡ badges mark buildings with no grid.</div>`,
      heat: `<div class="ptitle">♨ HEAT OVERLAY</div>${row('linear-gradient(90deg,#3c96ff,#ff5028)', 'Rack heat: cool → hot (throttle above 100°)')}<div class="row">Pipes stay visible. Coolant comes from towers and chillers.</div>`,
      network: `<div class="ptitle">◈ COMPUTE NETWORK</div>${row('#6fe9ff', 'Data cable / fiber carrying compute')}${row('#ffb020', 'Saturated link (bandwidth-bound)')}${row('#ff3030', 'Blocked (the destination is full)')}`,
      logistics: `<div class="ptitle">➜ LOGISTICS FLOW</div>${row('#ffb020', 'Saturated (at capacity, so add a parallel belt)')}${row('#ff3030', 'Blocked (the destination is full or stalled)')}${row('#6a7080', 'Idle (nothing to carry)')}<div class="row">Packet shapes: ◆ quartz/silicon · ⬢ ore/metal · ▪ chips · ● fluids</div>`,
    };
    lg.style.display = ov === 'none' ? 'none' : 'block';
    lg.innerHTML = legends[ov] ?? '';
  }

  // ───────── per-frame ─────────
  update(dt: number) {
    const g = this.g, s = g.s;
    this.slowT += dt;
    // feed → toasts
    if (s.feed.length < this.seenFeed) this.seenFeed = 0;
    while (this.seenFeed < s.feed.length) {
      const f = s.feed[this.seenFeed++];
      if (f.kind !== 'era') this.toast(f.text, f.kind === 'info' ? 'info' : f.kind);
    }
    this.updateBadges();
    if (this.slowT < 0.25) return;
    const sdt = this.slowT;
    this.slowT = 0;
    // resource rates per sim-minute (robust to pauses, speed-ups and time jumps)
    const simDt = s.time - this.lastSimT;
    this.lastSimT = s.time;
    if (simDt > 0 && simDt < 30) {
      for (const k of SHOWN_RES) {
        const v = s.stock[k] ?? 0;
        const d = (v - (this.lastStock[k] ?? 0)) / simDt;
        this.rate[k] = (this.rate[k] ?? 0) + (d - (this.rate[k] ?? 0)) * Math.min(1, simDt / 6);
      }
    }
    for (const k of SHOWN_RES) this.lastStock[k] = s.stock[k] ?? 0;
    void sdt;
    const era = ERAS[s.era - 1];
    this.els.topbar.querySelector('#erachip')!.innerHTML = s.mode === 'sandbox' ? 'SANDBOX' : `ERA ${['I', 'II', 'III', 'IV', 'V'][s.era - 1]} · ${era.name.toUpperCase()}`;
    const res = this.els.res;
    const show = SHOWN_RES.filter((k) => k === 'metal' || k === 'silicon' || (s.stock[k] ?? 0) > 0 || (k === 'chips' && s.era >= 2) || (k === 'accel' && s.era >= 4));
    const html = show.map((k) => `<div class="res" title="${ITEMS[k].name}">${itemIcon(k, 22)}<div><span class="v">${fmt(s.stock[k] ?? 0)}</span><span class="r">${(this.rate[k] ?? 0) >= 0 ? '+' : ''}${fmt((this.rate[k] ?? 0) * 60)}/min</span></div></div>`).join('')
      + `<div class="res" title="Research points">${itemIcon('rp', 22)}<div><span class="v">${fmt(s.rp)}</span><span class="r">research</span></div></div>`;
    res.innerHTML = html;
    // power
    const gen = s.grids.reduce((a, x) => a + x.avail, 0), dem = s.grids.reduce((a, x) => a + x.demand, 0);
    const cap = s.grids.reduce((a, x) => a + x.capacity, 0), st = s.grids.reduce((a, x) => a + x.stored, 0);
    const health = dem > 0 ? s.grids.reduce((a, x) => a + x.demand * x.sat, 0) / dem : 1;
    const pv = this.els.topbar.querySelector('#pval') as HTMLElement;
    pv.innerHTML = `${fmt(dem)} <span style="color:#93a4c4;font-size:14px">of</span> ${fmt(gen)}`;
    pv.style.color = health > 0.98 ? '#e8f1ff' : health > 0.6 ? '#ffb347' : '#ff5a5a';
    (this.els.topbar.querySelector('#pbar') as HTMLElement).style.width = `${health < 0.98 ? health * 100 : Math.min(100, (dem / Math.max(0.1, gen)) * 100)}%`;
    (this.els.topbar.querySelector('#pbar') as HTMLElement).style.background = health > 0.98 ? '#ffe066' : health > 0.6 ? '#ffb347' : '#ff5a5a';
    (this.els.topbar.querySelector('#pdem') as HTMLElement).style.display = 'none';
    (this.els.topbar.querySelector('#pbat') as HTMLElement).textContent = cap > 0 ? `🔋 ${Math.round((st / cap) * 100)}% of ${fmt(cap)}` : 'no storage';
    const p = pue(s);
    (this.els.topbar.querySelector('#ppue') as HTMLElement).textContent = p > 0 ? `PUE ${p.toFixed(2)}` : '';
    // compute
    (this.els.topbar.querySelector('#cval') as HTMLElement).textContent = `${fmt(s.stats.computeRate)}/s`;
    const util = s.stats.computeRate > 0.1 ? Math.min(1, s.stats.computeUsed / s.stats.computeRate) : 0;
    (this.els.topbar.querySelector('#cbar') as HTMLElement).style.width = `${util * 100}%`;
    (this.els.topbar.querySelector('#cuse') as HTMLElement).textContent = s.stats.computeRate > 0.1 ? `${Math.round(util * 100)}% utilised` : 'none yet';
    (this.els.topbar.querySelector('#crp') as HTMLElement).textContent = s.stats.trainRate > 0.1 ? `train ${fmt(s.stats.trainRate)}/s` : '';
    (this.els.topbar.querySelector('#cgauge') as HTMLElement).style.display = s.era >= 2 || s.stats.computeRate > 0 ? '' : 'none';
    // clock
    const tod = timeOfDay(s);
    const sun = sunlight(tod);
    const toNight = sun > 0.05;
    this.els.topbar.querySelector('#clock')!.innerHTML = `${toNight ? '☀' : '☾'} ${String(Math.floor(tod * 24)).padStart(2, '0')}:${String(Math.floor((tod * 24 * 60) % 60)).padStart(2, '0')}`;
    void DAY_LENGTH;
    this.updateObjectives();
    this.updateContracts();
    this.updateEvents();
    this.refreshInspector(false);
    this.updateMinimap();
    // palette affordability
    this.els.build.querySelectorAll<HTMLElement>('.bitem').forEach((el) => {
      const d = BUILDING[el.dataset.type!];
      if (!d || !isUnlocked(s, d)) return;
      el.classList.toggle('poor', !canAfford(s, costOf(s, d)));
    });
    // delivery floaters at HQ
    const delivered = Object.values(s.stats.delivered).reduce((a, b) => a + (b ?? 0), 0);
    this.deliverAcc += delivered - this.lastDelivered;
    this.lastDelivered = delivered;
    if (this.deliverAcc >= 5) {
      const hb = hq(s);
      this.floatText(new THREE.Vector3(hb.x + 1.5, tileHeight(s.world, hb.x, hb.y) + 4.4, hb.y + 1.5), `+${Math.floor(this.deliverAcc)}`, '#5dff9a');
      this.deliverAcc = 0;
    }
    const fpsEl = this.els.fps;
    fpsEl.style.display = g.settings.showFps ? 'block' : 'none';
    if (g.settings.showFps) fpsEl.textContent = `${Math.round(g.fps)} fps · ${g.frameMs.toFixed(1)} ms cpu · ${s.buildings.length} buildings · ${s.links.length} links · ${g.rig.renderer.info.render.calls} draws`;
    this.els.redvig.classList.toggle('on', health < 0.6 && dem > 5);
  }

  private updateObjectives() {
    const s = this.g.s;
    const el = this.els.obj;
    if (s.mode === 'sandbox') { el.innerHTML = `<h2><small>SANDBOX</small>Free build</h2><div class="ob"><div class="t">Everything is unlocked. Seed ${s.seed}.</div></div>`; return; }
    const era = ERAS[s.era - 1];
    let firstOpen = true;
    let html = `<h2><small>${era.subtitle.toUpperCase()}</small>${era.name.toUpperCase()}</h2>`;
    for (const o of era.objectives) {
      const done = !!s.done[o.id];
      const pr = done ? 1 : Math.max(0, Math.min(1, o.progress(s)));
      const showHint = !done && firstOpen && o.hint;
      if (!done) firstOpen = false;
      html += `<div class="ob${done ? ' done' : ''}"><div class="t"><span class="ck">${done ? '✓' : ''}</span><span>${o.text}</span></div>${done ? '' : `<div class="pb"><i style="width:${pr * 100}%"></i></div>`}${showHint ? `<div class="h">→ ${o.hint}</div>` : ''}</div>`;
    }
    if (s.era === 5 && s.buildings.some((b) => b.type === 'engine')) html += `<div class="ob"><div class="t" style="color:#ffd27a">Dawn Engine charge: ${(s.engine.progress * 100).toFixed(1)}% · ${fmt(s.engine.accel)} accelerators fed</div></div>`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  private updateContracts() {
    const s = this.g.s;
    const el = this.els.contracts;
    const cs = s.contracts.filter((c) => c.state === 'offered' || c.state === 'active');
    el.style.display = cs.length || s.era >= 3 ? 'block' : 'none';
    if (el.style.display === 'none') return;
    let html = `<h3>CONTRACTS</h3>`;
    if (!cs.length) html += `<div class="ct"><div class="d">No offers right now. New contracts arrive every few minutes.</div></div>`;
    for (const c of cs) {
      const isT = c.kind === 'training';
      const pr = isT ? c.progress / c.target : c.progress / c.duration;
      html += `<div class="ct ${c.kind}"><div class="n">${isT ? '△ TRAIN' : '◈ SERVE'} · ${c.title}</div><div class="d">${isT ? `${fmt(c.target)} training in ${Math.round(c.duration / 60)} min` : `${c.target} compute/s at Gateways, ${Math.round(c.duration)} s at ≥90% uptime`} · reward ${c.reward.rp} research + materials</div>`;
      if (c.state === 'offered') html += `<button data-c="${c.id}">ACCEPT (${Math.ceil(c.expires)}s)</button>`;
      else html += `<div class="pb"><i style="width:${Math.min(100, pr * 100)}%"></i></div><div class="d">${isT ? `${fmt(c.progress)} / ${fmt(c.target)} · ${Math.ceil(c.duration - c.t)}s left` : `serving ${fmt(s.stats.inferenceRate)}/s · uptime ${Math.round(c.uptime * 100)}% · ${Math.ceil(c.duration - c.t)}s left`}</div>`;
      html += `</div>`;
    }
    if (el.innerHTML !== html) {
      el.innerHTML = html;
      el.querySelectorAll<HTMLElement>('button[data-c]').forEach((b) => (b.onclick = () => { if (!acceptContract(s, Number(b.dataset.c))) { audio.play('error'); this.toast('You can only run one contract of each kind at a time', 'warn'); } }));
    }
  }

  private updateEvents() {
    const s = this.g.s;
    const el = this.els.eventbar;
    const e = s.events[0];
    if (!e) { el.style.display = 'none'; return; }
    const d = EVENT[e.id];
    el.style.display = 'block';
    el.classList.toggle('warn', e.warn > 0);
    el.innerHTML = e.warn > 0
      ? `<div class="n">⚠ ${d.name} in ${Math.ceil(e.warn)}s</div><div class="d">${d.warn}</div>`
      : `<div class="n">${d.icon} ${d.name.toUpperCase()}</div><div class="d">${d.desc}</div><div class="pb"><i style="width:${(e.t / e.dur) * 100}%"></i></div>`;
  }

  /** status badges drawn on one 2D canvas (hundreds of DOM nodes with filters were the #1 frame cost) */
  private updateBadges() {
    const g = this.g, s = g.s;
    const cv = this.els.badges as HTMLCanvasElement;
    const W = window.innerWidth, H = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 17px Rajdhani, sans-serif';
    const v = new THREE.Vector3();
    const pulse = Math.sin(g.realTime * 6) * 3;
    let n = 0;
    for (const b of s.buildings) {
      const kind = badgeFor(b);
      if (!kind) continue;
      const d = BUILDING[b.type];
      v.set(b.x + d.size / 2, tileHeight(s.world, b.x, b.y) + g.view.buildings.modelHeight(b.type) + 0.3, b.y + d.size / 2);
      const p = g.rig.worldToScreen(v);
      if (p.x < -30 || p.y < -30 || p.x > W + 30 || p.y > H + 30) continue;
      const x = p.x, y = p.y - 16 + (b.status === 'broken' ? pulse : 0);
      ctx.beginPath();
      if (kind === 'bad') {
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; ctx.lineTo(x + Math.cos(a) * 15, y + Math.sin(a) * 15); }
        ctx.closePath();
        ctx.fillStyle = '#ff5a5a';
      } else {
        ctx.moveTo(x, y - 15); ctx.lineTo(x + 15, y + 12); ctx.lineTo(x - 15, y + 12); ctx.closePath();
        ctx.fillStyle = '#ffb347';
      }
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.stroke(); ctx.fill();
      ctx.fillStyle = kind === 'bad' ? '#ffffff' : '#05070d';
      ctx.fillText(explain(s, b).glyph, x, kind === 'bad' ? y + 1 : y + 3);
      if (++n > 400) break;
    }
  }

  // ───────── inspector ─────────
  refreshInspector(force: boolean) {
    const g = this.g, s = g.s;
    const el = this.els.insp;
    const b = g.view.selected && s.byId.has(g.view.selected.id) ? g.view.selected : null;
    const l = g.selectedLink && s.links.includes(g.selectedLink) ? g.selectedLink : null;
    if (!b && !l) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    if (l) {
      const A = s.byId.get(l.from)!, B = s.byId.get(l.to)!;
      const cap = LINKS[l.kind].capacity * (l.kind === 'conveyor' ? s.fx.conveyorMul : l.kind === 'pipe' ? 1 : s.fx.dataMul);
      el.innerHTML = `<div class="hd"><div><h3>${LINKS[l.kind].name}</h3><div class="role">${BUILDING[A.type].name} → ${BUILDING[B.type].name}</div></div></div>
        <div class="stat ${l.state === 'blocked' ? 'bad' : l.state === 'saturated' ? 'warn' : 'ok'}">${l.state === 'blocked' ? '✕ Blocked: the destination is full or stalled' : l.state === 'saturated' ? '▲ Saturated: at full capacity. Add a parallel link.' : l.state === 'idle' ? '○ Idle: the source has nothing to send' : '✓ Flowing'}</div>
        <div class="kv"><span class="k">Carries</span><span class="v">${itemIcon(l.item, 14)} ${ITEMS[l.item].name}</span><span class="k">Flow</span><span class="v">${l.rate.toFixed(2)} / ${cap.toFixed(1)} per s</span><span class="k">Length</span><span class="v">${l.length.toFixed(1)} tiles</span><span class="k">Moved total</span><span class="v">${fmt(l.total)}</span></div>
        <div class="acts"><button id="i-unlink">✕ REMOVE LINK</button></div>`;
      (el.querySelector('#i-unlink') as HTMLElement).onclick = () => { removeLink(s, l.id); g.select(null); };
      return;
    }
    if (!b) return;
    if (!force && el.dataset.id === String(b.id) && el.dataset.t === String(Math.floor(g.realTime * 4))) return;
    el.dataset.id = String(b.id); el.dataset.t = String(Math.floor(g.realTime * 4));
    const d = BUILDING[b.type];
    const info = explain(s, b);
    let kv = '';
    const add = (k: string, v: string) => (kv += `<span class="k">${k}</span><span class="v">${v}</span>`);
    if (d.power < 0) add('Power use', `${(-d.power).toFixed(0)} ${b.grid >= 0 ? `· grid ${Math.round((s.grids[b.grid]?.sat ?? 0) * 100)}%` : '· <span style="color:#ff5a5a">unpowered</span>'}`);
    if (d.power > 0) add('Generation', `${d.power} nameplate`);
    if (d.battery) add('Charge', `${fmt(b.charge)} / ${fmt(d.battery.capacity * s.fx.batteryMul)}`);
    if (d.node) add('Grid reach', `radius ${d.node.radius} · links ${d.node.reach}`);
    if (d.deposit) add('Deposit coverage', `${Math.round(b.richness * 100)}%`);
    if (d.it) add('Heat', `<span style="color:${b.heat > 1 ? '#ff5a5a' : b.heat > 0.7 ? '#ffb347' : '#5dff9a'}">${Math.round(b.heat * 100)}°</span>`);
    if (d.it || d.workload) add('Activity', `${Math.round(b.activity * 100)}%`);
    if (b.boost > 1) add('Robot boost', '+30%');
    if (d.workload === 'engine') add('Engine charge', `${(s.engine.progress * 100).toFixed(2)}% of ${fmt(ENGINE_TARGET)}`);
    if (d.storage) add('Stockpile', 'all refined goods');
    if (b.type === 'hq') add('Research trickle', '+0.08/s');
    if (b.type === 'pod') add('Mode <kbd>M</kbd>', b.mode === 'training' ? 'Training (+25% compute, worse inference)' : b.mode === 'inference' ? 'Inference (+30% at Gateways, cooler)' : 'Balanced');
    const bufs: string[] = [];
    for (const [it] of Object.entries(d.inputs ?? {}) as [ItemId, number][]) {
      if (it === 'compute') continue;
      const v = b.inBuf[it] ?? 0, c = inputCap(s, d, it);
      bufs.push(`<div class="buf">${itemIcon(it, 14)} in <div class="bb"><i style="width:${Math.min(100, (v / c) * 100)}%;background:${ITEMS[it].color}"></i></div> ${v.toFixed(1)}</div>`);
    }
    for (const [it] of Object.entries(d.outputs ?? {}) as [ItemId, number][]) {
      if (it === 'compute') continue;
      const v = b.outBuf[it] ?? 0, c = outputCap(d, it);
      bufs.push(`<div class="buf">${itemIcon(it, 14)} out <div class="bb"><i style="width:${Math.min(100, (v / c) * 100)}%;background:${ITEMS[it].color}"></i></div> ${v.toFixed(1)}</div>`);
    }
    const ins = s.links.filter((x) => x.to === b.id).length, outs = s.links.filter((x) => x.from === b.id).length;
    add('Links', `${ins} in · ${outs} out`);
    el.innerHTML = `<div class="hd"><img src="${thumb(b.type)}"><div><h3>${d.name}</h3><div class="role">${d.desc}</div></div></div>
      <div class="stat ${info.level === 'info' ? 'warn' : info.level}"><b style="font-size:20px">${info.glyph}</b><div><b>${info.title}</b><br>${info.text}</div></div>
      <div class="kv">${kv}</div>${bufs.join('')}
      <div class="acts">${b.type === 'pod' ? '<button id="i-mode">MODE <kbd>M</kbd></button>' : ''}${b.broken > 0 ? '<button id="i-rep">REPAIR (10 metal) <kbd>R</kbd></button>' : ''}<button id="i-link">⟿ LINK FROM <kbd>L</kbd></button>${b.type !== 'hq' ? '<button id="i-del">✕ DEMOLISH <kbd>Del</kbd></button>' : ''}</div>`;
    const q = (id: string) => el.querySelector(id) as HTMLElement | null;
    q('#i-mode')?.addEventListener('click', () => { cycleMode(s, b.id); this.refreshInspector(true); });
    q('#i-rep')?.addEventListener('click', () => { if (!repair(s, b.id)) audio.play('error'); });
    q('#i-link')?.addEventListener('click', () => g.setTool({ kind: 'link', from: b.id }));
    q('#i-del')?.addEventListener('click', () => g.demolishBuilding(b));
  }

  // ───────── tooltips ─────────
  private tipAt(x: number, y: number, html: string) {
    const t = this.els.tip;
    t.style.display = 'block';
    t.innerHTML = html;
    const w = t.offsetWidth, hh = t.offsetHeight;
    t.style.left = Math.min(window.innerWidth - w - 10, x + 22) + 'px';
    t.style.top = Math.min(window.innerHeight - hh - 10, y + 18) + 'px';
  }
  hideTip() { this.els.tip.style.display = 'none'; }
  ghostTip(x: number, y: number, type: string, c: PlaceCheck, tx: number, ty: number) {
    const s = this.g.s, d = BUILDING[type];
    let extra = '';
    if (d.deposit && c.richness !== undefined && c.ok) extra = `<br>Deposit coverage <b>${Math.round(c.richness * 100)}%</b>, so output is ×${c.richness.toFixed(2)}`;
    if (d.gen === 'wind') extra = `<br>Local wind <b>×${s.world.wind[idx(s.world, tx, ty)].toFixed(2)}</b>`;
    const biome = s.world.biome[idx(s.world, Math.max(0, tx), Math.max(0, ty))];
    if (d.it && biome === BIOME.TUNDRA) extra += '<br>Cold climate: free-air cooling helps';
    if (c.ok && d.power < 0 && !d.node && !coveredAt(s, tx, ty, d.size)) extra += `<br><span class="bad">⚡ No grid here. Add a Power Pole within 4.5 tiles</span>`;
    this.tipAt(x, y, `<b>${d.name}</b><br>${c.ok ? '<span class="good">✓ Valid placement</span>' : `<span class="bad">✕ ${c.reason}</span>`}${extra}<br>${costHtml(s, c.cost)}`);
  }
  linkTip(x: number, y: number, from: number, b: Building | null) {
    const s = this.g.s;
    const A = s.byId.get(from);
    if (!A) return;
    if (!b || b.id === from) { this.tipAt(x, y, `<b>Link from ${BUILDING[A.type].name}</b><br>Click a destination`); return; }
    const c = checkLink(s, from, b.id);
    this.tipAt(x, y, c.ok ? `<b>${LINKS[c.kind!].name} → ${BUILDING[b.type].name}</b><br><span class="good">✓ ${ITEMS[c.item!].name}, ${c.length!.toFixed(1)} tiles, cap ${LINKS[c.kind!].capacity}/s</span>` : `<b>→ ${BUILDING[b.type].name}</b><br><span class="bad">✕ ${c.reason}</span>`);
  }
  buildingTip(x: number, y: number, b: Building) {
    const s = this.g.s;
    const info = explain(s, b);
    this.tipAt(x, y, `<b>${BUILDING[b.type].name}</b><br><span class="${info.level === 'ok' ? 'good' : info.level === 'info' ? '' : 'bad'}">${info.glyph} ${info.title}</span><br><span style="color:#93a4c4;font-size:14px">${info.text}</span>`);
  }

  floatText(pos: THREE.Vector3, text: string, color: string) {
    const p = this.g.rig.worldToScreen(pos);
    const el = h('div', 'float', text);
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; el.style.color = color;
    this.els.floats.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  toast(text: string, kind: 'info' | 'good' | 'warn' | 'bad' = 'info') {
    const t = h('div', 'toast panel ' + kind, text);
    this.els.toasts.appendChild(t);
    while (this.els.toasts.children.length > 4) this.els.toasts.firstChild!.remove();
    setTimeout(() => t.remove(), 6200);
  }

  // ───────── minimap ─────────
  private updateMinimap() {
    const s = this.g.s, w = s.world, S = w.size, ctx = this.mapCtx;
    if (!this.mapBase) {
      const img = ctx.createImageData(S, S);
      const cols: Record<number, [number, number, number]> = { 0: [30, 80, 120], 1: [96, 160, 72], 2: [220, 190, 120], 3: [225, 235, 242], 4: [140, 128, 115], 5: [70, 135, 64] };
      for (let i = 0; i < S * S; i++) {
        const c = cols[w.biome[i]];
        const k = 0.75 + w.level[i] * 0.06;
        let [r, g, b] = c;
        if (w.deposit[i] === 1) [r, g, b] = [140, 240, 255]; else if (w.deposit[i] === 2) [r, g, b] = [210, 120, 60]; else if (w.deposit[i] === 3) [r, g, b] = [180, 130, 255];
        img.data[i * 4] = r * k; img.data[i * 4 + 1] = g * k; img.data[i * 4 + 2] = b * k; img.data[i * 4 + 3] = 255;
      }
      this.mapBase = img;
    }
    ctx.putImageData(this.mapBase, 0, 0);
    const hb = hq(s);
    const R = this.g.view.frontierRadius();
    ctx.fillStyle = 'rgba(5,8,18,0.55)';
    ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.arc(hb.x + 1.5, hb.y + 1.5, R, 0, Math.PI * 2, true); ctx.fill();
    ctx.strokeStyle = 'rgba(111,233,255,0.8)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(hb.x + 1.5, hb.y + 1.5, R, 0, Math.PI * 2); ctx.stroke();
    for (const b of s.buildings) {
      const d = BUILDING[b.type];
      const k = badgeFor(b);
      ctx.fillStyle = k === 'bad' ? '#ff4a4a' : k === 'warn' ? '#ffb347' : b.type === 'hq' ? '#ffffff' : d.cat === 'power' ? '#ffe066' : d.cat === 'compute' || d.cat === 'workload' ? '#6fe9ff' : '#e8f1ff';
      ctx.fillRect(b.x, b.y, d.size, d.size);
    }
    // camera view footprint
    const rig = this.g.rig;
    const corners = [[0, 0], [window.innerWidth, 0], [window.innerWidth, window.innerHeight], [0, window.innerHeight]].map(([x, y]) => rig.screenToGround(x, y, 1.1));
    if (corners.every(Boolean)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
      ctx.beginPath();
      corners.forEach((c, i) => (i ? ctx.lineTo(c!.x, c!.z) : ctx.moveTo(c!.x, c!.z)));
      ctx.closePath(); ctx.stroke();
    }
  }

  // ───────── modals ─────────
  modalOpen() { return this.openModal !== null; }
  blockingModal() { return this.openModal !== null && this.openModal !== 'score'; }
  closeModals() {
    if (this.openModal === 'title') return;
    for (const id of ['guide', 'tech', 'menu', 'score', 'finale', 'save']) this.els[id].classList.remove('show');
    if (this.openModal) audio.play('close');
    this.openModal = null;
  }
  private show(id: string) {
    for (const m of ['guide', 'tech', 'menu', 'title', 'score', 'finale', 'save']) this.els[m].classList.toggle('show', m === id);
    this.openModal = id;
    audio.play('open');
  }

  openGuide() {
    const s = this.g.s;
    const unlocked = new Set<string>();
    for (const e of ERAS.slice(0, s.mode === 'sandbox' ? 5 : s.era)) for (const gid of e.guide) unlocked.add(gid);
    for (const e of ERAS) for (const o of e.objectives) if (o.guide && (s.done[o.id] || e.id <= s.era)) unlocked.add(o.guide);
    const m = this.els.guide;
    m.innerHTML = `<div class="mcard panel"><h1>FIELD GUIDE</h1><div class="lede">Short notes on the real infrastructure behind AI. The campaign is fiction, but these trade-offs are real. New entries unlock as you advance.</div><div class="grid3">${GUIDE.map((e) => `<div class="gentry${unlocked.has(e.id) ? '' : ' locked'}"><h4>${e.icon} ${unlocked.has(e.id) ? e.title : 'Locked'}</h4><p>${e.body}</p></div>`).join('')}</div><div class="mact"><button class="primary" data-x>BACK</button></div></div>`;
    (m.querySelector('[data-x]') as HTMLElement).onclick = () => this.closeModals();
    this.show('guide');
  }

  openTech() {
    const s = this.g.s;
    const m = this.els.tech;
    const render = () => {
      const col = (branch: string, name: string, color: string) => `<div class="col"><h3 style="color:${color}">${name}</h3>${TECHS.filter((t) => t.branch === branch).map((t) => {
        const done = s.techs.includes(t.id);
        const c = canResearch(s, t.id);
        const cls = done ? 'done' : c.ok ? 'avail' : t.era > s.era && s.mode !== 'sandbox' ? 'locked' : '';
        return `<div class="tnode ${cls}" data-t="${t.id}"><div class="n"><span>${t.name}</span><span>${done ? '✓' : `${itemIcon('rp', 16)} ${t.cost}`}</span></div><div class="d">${t.desc}</div><div class="r">${done ? 'Researched' : c.ok ? 'Click to research' : c.reason}</div></div>`;
      }).join('')}</div>`;
      m.innerHTML = `<div class="mcard panel"><h1>TECHNOLOGY</h1><div class="lede">You have <b style="color:#b98cff">${fmt(s.rp)} research</b>. Labs turn compute into research, and the Core adds a small trickle. Each branch trades something different, and none is simply "best".</div><div class="tech">${col('efficiency', 'EFFICIENCY', '#5dff9a')}${col('capacity', 'CAPACITY', '#6fe9ff')}${col('reliability', 'RELIABILITY', '#ffb347')}</div><div class="mact"><button class="primary" data-x>BACK</button></div></div>`;
      (m.querySelector('[data-x]') as HTMLElement).onclick = () => this.closeModals();
      m.querySelectorAll<HTMLElement>('.tnode').forEach((n) => (n.onclick = () => { if (research(s, n.dataset.t!)) render(); else audio.play('error'); }));
    };
    render();
    this.show('tech');
  }

  openMenu() {
    const g = this.g, st = g.settings;
    const m = this.els.menu;
    m.innerHTML = `<div class="mcard panel" style="width:760px"><h1>MENU</h1>
      <div class="setrow"><label>Master volume</label><input type="range" min="0" max="1" step="0.05" value="${st.volume}" id="s-vol"></div>
      <div class="setrow"><label>Music & ambience</label><input type="range" min="0" max="1" step="0.05" value="${st.music}" id="s-mus"></div>
      <div class="setrow"><label>Mute</label><button id="s-mute" class="${st.muted ? 'on' : ''}">${st.muted ? 'MUTED' : 'SOUND ON'}</button></div>
      <div class="setrow"><label>Reduced motion</label><button id="s-rm" class="${st.reducedMotion ? 'on' : ''}">${st.reducedMotion ? 'ON' : 'OFF'}</button></div>
      <div class="setrow"><label>Edge panning</label><button id="s-edge" class="${st.edgePan ? 'on' : ''}">${st.edgePan ? 'ON' : 'OFF'}</button></div>
      <div class="setrow"><label>UI scale</label><input type="range" min="0.8" max="1.4" step="0.05" value="${st.uiScale}" id="s-ui"></div>
      <div class="setrow"><label>Performance stats</label><button id="s-fps" class="${st.showFps ? 'on' : ''}">${st.showFps ? 'SHOWN (F3)' : 'HIDDEN (F3)'}</button></div>
      <div class="mact" style="justify-content:space-between"><div style="display:flex;gap:8px"><button id="m-save">SAVE / LOAD</button><button id="m-title">MAIN MENU</button></div><button class="primary" data-x>RESUME</button></div>
      <div style="margin-top:18px;color:#93a4c4;font-size:15px;line-height:1.6"><b>Keys:</b> WASD pan · wheel zoom · Q/E rotate · 1–9 build · L link · X demolish · Del demolish selected · P/H/N/O overlays · T tech · J guide · Z next problem · C core · F focus · M pod mode · R repair · Space pause · +/− speed · F3 stats</div></div>`;
    const q = (id: string) => m.querySelector(id) as HTMLInputElement;
    q('#s-vol').oninput = () => { st.volume = Number(q('#s-vol').value); g.applySettings(); };
    q('#s-mus').oninput = () => { st.music = Number(q('#s-mus').value); g.applySettings(); };
    q('#s-ui').onchange = () => { st.uiScale = Number(q('#s-ui').value); g.applySettings(); };
    q('#s-mute').onclick = () => { st.muted = !st.muted; g.applySettings(); this.openMenu(); };
    q('#s-rm').onclick = () => { st.reducedMotion = !st.reducedMotion; g.applySettings(); this.openMenu(); };
    q('#s-edge').onclick = () => { st.edgePan = !st.edgePan; g.applySettings(); this.openMenu(); };
    q('#s-fps').onclick = () => { st.showFps = !st.showFps; g.applySettings(); this.openMenu(); };
    q('#m-save').onclick = () => this.openSave();
    q('#m-title').onclick = () => { g.autosave(); this.showTitle(); };
    (m.querySelector('[data-x]') as HTMLElement).onclick = () => this.closeModals();
    this.show('menu');
  }

  openSave() {
    const g = this.g;
    const m = this.els.save;
    const slot = (k: string) => { try { const v = localStorage.getItem(k); if (!v) return null; const d = JSON.parse(v); return d; } catch { return null; } };
    const desc = (d: any) => d ? `Era ${d.era} · ${Math.round(d.time / 60)} min · ${d.buildings.length} buildings · ${new Date(d.savedAt).toLocaleString()}` : 'empty';
    const rows = ['sd_save_1', 'sd_save_2', 'sd_save_3'].map((k, i) => `<div class="setrow"><label>Slot ${i + 1}</label><span style="flex:1;font-size:15px;color:#93a4c4">${desc(slot(k))}</span><button data-save="${k}">SAVE</button><button data-load="${k}" ${slot(k) ? '' : 'disabled'}>LOAD</button></div>`).join('');
    m.innerHTML = `<div class="mcard panel" style="width:900px"><h1>SAVE / LOAD</h1>
      <div class="setrow"><label>Autosave</label><span style="flex:1;font-size:15px;color:#93a4c4">${desc(slot(AUTOSAVE_KEY))}</span><button data-load="${AUTOSAVE_KEY}" ${slot(AUTOSAVE_KEY) ? '' : 'disabled'}>LOAD</button></div>${rows}
      <div class="setrow"><label>Portable file</label><button id="sv-exp">EXPORT JSON</button><button id="sv-imp">IMPORT JSON</button><input type="file" id="sv-file" accept=".json,application/json" style="display:none"></div>
      <div class="mact"><button class="primary" data-x>BACK</button></div></div>`;
    m.querySelectorAll<HTMLElement>('[data-save]').forEach((b) => (b.onclick = () => { try { localStorage.setItem(b.dataset.save!, g.saveJson()); this.toast('Saved', 'good'); audio.play('objective'); this.openSave(); } catch { this.toast('Save failed (storage full?)', 'bad'); } }));
    m.querySelectorAll<HTMLElement>('[data-load]').forEach((b) => (b.onclick = () => { const v = localStorage.getItem(b.dataset.load!); if (v && g.loadJson(v)) this.closeModals(); }));
    (m.querySelector('#sv-exp') as HTMLElement).onclick = () => {
      const blob = new Blob([g.saveJson()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `silicon-dawn-era${g.s.era}-${Math.round(g.s.time / 60)}min.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    const file = m.querySelector('#sv-file') as HTMLInputElement;
    (m.querySelector('#sv-imp') as HTMLElement).onclick = () => file.click();
    file.onchange = async () => { const f = file.files?.[0]; if (f && g.loadJson(await f.text())) this.closeModals(); };
    (m.querySelector('[data-x]') as HTMLElement).onclick = () => this.closeModals();
    this.show('save');
  }

  showTitle() {
    const g = this.g;
    g.started = false;
    const m = this.els.title;
    const auto = localStorage.getItem(AUTOSAVE_KEY);
    let autoDesc = '';
    try { if (auto) { const d = JSON.parse(auto); autoDesc = `Era ${d.era} · ${Math.round(d.time / 60)} min`; } } catch { /* */ }
    const sandbox = localStorage.getItem('sd_sandbox_unlocked') === '1' || new URLSearchParams(location.search).has('sandbox');
    m.innerHTML = `<div class="tcard"><h1>SILICON<br>DAWN</h1><div class="sub">FROM SAND TO SENTIENCE</div>
      ${auto ? `<div class="row"><button class="primary" id="t-cont">CONTINUE · ${autoDesc}</button></div>` : ''}
      <div class="row"><label>Difficulty</label><select id="t-diff"><option value="relaxed">Relaxed: cheaper, gentle events</option><option value="standard" selected>Standard</option><option value="race">Race: pricier, frequent events</option></select></div>
      <div class="row"><button class="${auto ? '' : 'primary'}" id="t-new">NEW CAMPAIGN</button><button id="t-load">LOAD…</button></div>
      <div class="row" style="margin-top:18px"><label>Sandbox seed</label><input type="number" id="t-seed" value="${Math.floor(Math.random() * 1e6)}" style="width:140px"><button id="t-sand" ${sandbox ? '' : 'disabled title="Finish the campaign to unlock"'}>SANDBOX ${sandbox ? '' : '🔒'}</button></div>
      <div class="fine">A strategy game about the physical road to AI: power, chips, cooling, networks and reliability.<br>The finale is <b>pure fiction</b>. No amount of hardware is known to "produce AGI".<br>Best on a large monitor. Click anywhere to enable sound.</div></div>`;
    const q = (id: string) => m.querySelector(id) as HTMLElement;
    q('#t-new').onclick = () => { this.closeTitle(); g.newGame(20261119, (q('#t-diff') as HTMLSelectElement).value as any); };
    q('#t-load').onclick = () => { this.openModal = null; m.classList.remove('show'); this.openSave(); };
    if (auto) q('#t-cont').onclick = () => { if (g.loadJson(auto)) this.closeTitle(); };
    q('#t-sand').onclick = () => { this.closeTitle(); g.newGame(Number((q('#t-seed') as HTMLInputElement).value) || 1, 'standard', 'sandbox'); };
    this.show('title');
  }
  private closeTitle() { this.els.title.classList.remove('show'); this.openModal = null; audio.init(); audio.play('era', 1); }

  showEraBanner(era: number) {
    const e = ERAS[era - 1];
    const b = this.els.banner;
    b.classList.remove('show');
    void b.offsetWidth;
    b.innerHTML = `<div class="k">${e.subtitle.toUpperCase()}</div><div class="n">${e.name.toUpperCase()}</div><div class="d">${e.intro}</div>`;
    b.classList.add('show');
  }

  showScore(sc: EraScore | undefined) {
    if (!sc) return;
    const m = this.els.score;
    const pct = (v: number) => `${Math.round(v * 100)}`;
    m.innerHTML = `<div class="mcard panel" style="width:900px;text-align:center"><h1>ERA ${['I', 'II', 'III', 'IV', 'V'][sc.era - 1]} COMPLETE</h1><div class="lede" style="margin:0 auto">${ERAS[sc.era - 1].name} finished in ${Math.round(sc.time / 60)} minutes.</div>
      <div class="score"><div class="c"><div class="grade">${sc.grade}</div><div class="l">rating</div></div><div class="c"><div class="v" style="color:#5dff9a">${pct(sc.efficiency)}</div><div class="l">efficiency<br><span style="font-size:12px">pace + PUE</span></div></div><div class="c"><div class="v" style="color:#ffb347">${pct(sc.reliability)}</div><div class="l">reliability<br><span style="font-size:12px">grid health</span></div></div><div class="c"><div class="v" style="color:#6fe9ff">${pct(sc.footprint)}</div><div class="l">footprint<br><span style="font-size:12px">clean energy share</span></div></div></div>
      <div class="mact" style="justify-content:center"><button class="primary" data-x>ONWARD</button></div></div>`;
    (m.querySelector('[data-x]') as HTMLElement).onclick = () => this.closeModals();
    setTimeout(() => { if (!this.openModal) this.show('score'); }, 6500);
  }

  showFinale() {
    const s = this.g.s;
    try { localStorage.setItem('sd_sandbox_unlocked', '1'); } catch { /* */ }
    const m = this.els.finale;
    const rows = s.eraScores.map((e) => `<div class="c"><div class="v">${e.grade}</div><div class="l">${ERAS[e.era - 1].name}<br>${Math.round(e.time / 60)} min</div></div>`).join('');
    m.innerHTML = `<div class="mcard panel" style="width:1000px;text-align:center"><h1 style="font-size:64px">THE DAWN ENGINE IGNITES</h1>
      <div class="lede" style="margin:0 auto;font-size:20px;line-height:1.6">From one solar panel to a continent of light. Your civilisation has built the most elaborate machine in its history.<br><br><b>This ending is fiction.</b> Nobody knows of any amount of compute, power or silicon that guarantees general intelligence. What you actually mastered is real: energy that must be generated every second, heat that has to go somewhere, water, materials, networks, and reliability under stress.</div>
      <div class="score" style="grid-template-columns:repeat(${Math.max(1, s.eraScores.length)},1fr)">${rows}</div>
      <div class="lede" style="margin:0 auto">Total time: ${Math.round(s.time / 60)} minutes · ${s.buildings.length} buildings · ${Math.round(s.stats.trainTotal).toLocaleString()} training · ${s.stats.contractsDone} contracts.<br><b style="color:#5dff9a">Sandbox mode is now unlocked</b> on the main menu.</div>
      <div class="mact" style="justify-content:center"><button data-k>KEEP WATCHING</button><button class="primary" data-t>MAIN MENU</button></div></div>`;
    (m.querySelector('[data-k]') as HTMLElement).onclick = () => { m.classList.remove('show'); this.openModal = null; };
    (m.querySelector('[data-t]') as HTMLElement).onclick = () => { m.classList.remove('show'); this.openModal = null; this.showTitle(); };
    setTimeout(() => this.show('finale'), 9000);
  }
}
