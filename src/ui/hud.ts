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
import type { Link } from '../sim/types';
import { ENGINE_TARGET, inputCap, outputCap } from '../sim/sim';
import type { EraScore } from '../sim/state';
import { DAY_LENGTH, dayBias, hq, sunlight, timeOfDay } from '../sim/state';
import type { Building, BuildingCategory, Cost, ItemId } from '../sim/types';
import { BIOME, idx } from '../sim/world';
import { coveredAt } from '../sim/power';
import { baseHeight } from '../render/terrain';
import { itemIcon, renderThumbnails, thumb } from './icons';
import { RateTracker } from './rates';
import { computeTip, defTip, powerBreakdown, powerTip, ratioLines, resourceTip } from './tips';
import { CHAPTERS } from './codex';
import { Tutorial } from './tutorial';
import { TECH } from '../sim/data/tech';
import { badgeFor, explain } from './status';
import { Ledger, affordable, creditCostHtml } from './ledger';

const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const fmt = (v: number) => (Math.abs(v) >= 10000 ? (v / 1000).toFixed(1) + 'k' : Math.abs(v) >= 100 ? Math.round(v).toString() : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));
const costHtml = (s: Game['s'], c: Cost) => Object.entries(c).map(([k, v]) => `<span style="color:${(s.stock[k as ItemId] ?? 0) >= (v as number) ? '#cfe0ff' : '#ff6a6a'}">${itemIcon(k as ItemId, 13)} ${v}</span>`).join(' &nbsp;') || '<span style="color:#93a4c4">free</span>';

const TABS: { id: string; name: string; cats: BuildingCategory[] }[] = [
  { id: 'power', name: 'POWER', cats: ['power'] },
  { id: 'prod', name: 'INDUSTRY', cats: ['extract', 'refine', 'logistics'] },
  { id: 'compute', name: 'COMPUTE', cats: ['compute', 'cooling', 'workload', 'special'] },
];

function batteryIcon(frac: number, mode: 'c' | 'd' | '') {
  const w = Math.round(Math.max(0, Math.min(1, frac)) * 16);
  const col = frac > 0.5 ? '#5dff9a' : frac > 0.2 ? '#ffb347' : '#ff5a5a';
  return `<svg width="26" height="13" viewBox="0 0 26 13" style="vertical-align:-2px"><rect x="1" y="1" width="21" height="11" rx="2" fill="none" stroke="#93a4c4" stroke-width="1.5"/><rect x="22.5" y="4" width="2.5" height="5" fill="#93a4c4"/><rect x="3" y="3" width="${w}" height="7" fill="${col}"/>${mode === 'c' ? '<path d="M11 2 8 7h3l-1 4 4-5h-3l1-4z" fill="#fff"/>' : ''}</svg>`;
}

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
  rates = new RateTracker();
  ledger = new Ledger();
  tutorial!: Tutorial;
  hoveredPaletteType: string | null = null;
  private codexCh = 'start';
  hotbar: (string | null)[] = (() => { try { const v = JSON.parse(localStorage.getItem('sd_hotbar') ?? 'null'); if (Array.isArray(v) && v.length === 10) return v; } catch { /* */ } return ['solar', 'pole', 'quarry', 'furnace', 'drill', 'smelter', 'battery', 'depot', 'junction', null]; })();
  currentTab() { return this.tab; }

  constructor(private g: Game, root: HTMLElement) {
    this.root = root;
    renderThumbnails();
    this.build();
    root.addEventListener('pointerover', (e) => { this.pointerOverUi = (e.target as HTMLElement) !== root && !!(e.target as HTMLElement).closest('.panel, .modal, button'); });
    root.addEventListener('pointerout', () => { this.pointerOverUi = false; });
    // generic rich tooltips: any element with data-tip (static html) or data-tipk (dynamic key)
    root.addEventListener('pointermove', (e) => {
      const el = (e.target as HTMLElement).closest('[data-tip],[data-tipk]') as HTMLElement | null;
      if (!el) { if (this.uiTip) { this.uiTip = false; this.hideTip(); } return; }
      const html = el.dataset.tip ?? this.dynTip(el.dataset.tipk!);
      if (html) { this.uiTip = true; this.tipAt(e.clientX, e.clientY, html); }
    });
    root.addEventListener('pointerleave', () => { this.uiTip = false; this.hideTip(); });
    this.tutorial = new Tutorial(g, document.getElementById('ovl')!);
    this.onNewState();
    this.showTitle();
  }
  private uiTip = false;

  private dynTip(k: string): string {
    const s = this.g.s;
    if (k === 'power') return powerTip(s);
    if (k === 'compute') return computeTip(s);
    if (k === 'credits') return this.ledger.tipHtml(s);
    if (k.startsWith('res:')) return resourceTip(s, this.rates, k.slice(4) as ItemId | 'rp');
    if (k.startsWith('def:')) return defTip(s, BUILDING[k.slice(4)]);
    if (k.startsWith('hot:')) { const t = this.hotbar[Number(k.slice(4))]; return t ? defTip(s, BUILDING[t]) + '<br><span class="dim">Hover a build item and press a number key to change this slot.</span>' : '<b>Empty hotbar slot</b><br>Hover a build item in the menu and press this number to assign it.'; }
    if (k.startsWith('tech:')) { const t = TECH[k.slice(5)]; const c = canResearch(s, t.id); return `<b>${t.name}</b> · ${t.cost} research<br>${t.desc}<br><span class="dim">${s.techs.includes(t.id) ? 'Researched ✓' : c.ok ? 'Click to research' : c.reason}${t.requires?.length ? ' · needs ' + t.requires.map((r) => TECH[r].name).join(', ') : ''}</span>`; }
    if (k === 'clock') return `<b>Day & night</b><br>A full day lasts 4 minutes. Solar is dark for about ${Math.round(this.g.s.difficulty === 'relaxed' ? 70 : 110)} s each night${this.g.s.difficulty === 'relaxed' ? ' (shorter on Relaxed)' : ''}.`;
    return '';
  }

  private build() {
    const r = this.root;
    r.innerHTML = '';
    const add = (id: string, el: HTMLElement) => { el.id = id; r.appendChild(el); this.els[id] = el; return el; };
    // screen-space layer (not affected by UI zoom): badges, floating numbers, tooltip, tutorial
    const ovl = document.getElementById('ovl')!;
    ovl.innerHTML = '';
    const addO = (id: string, el: HTMLElement) => { el.id = id; ovl.appendChild(el); this.els[id] = el; return el; };
    const under = document.getElementById('under')!;
    under.innerHTML = '';
    const addU = (id: string, el: HTMLElement) => { el.id = id; under.appendChild(el); this.els[id] = el; return el; };
    addU('badges', h('canvas'));
    addU('floats', h('div'));
    add('redvig', h('div', 'vignette-red'));
    // top bar
    const top = add('topbar', h('div', 'panel'));
    top.innerHTML = `<div id="logo">SILICON<br>DAWN</div><div id="erachip"></div><div id="res"></div>
      <div class="gauge" id="pgauge" data-tipk="power"><div class="top"><span>${itemIcon('power', 16)} POWER</span><span id="pval"></span></div><div class="bar"><i id="pbar"></i><b id="pdem"></b></div><div class="top" style="font-size:13px;color:#93a4c4"><span id="pbat" class="batt"></span><span id="ppue"></span></div></div>
      <div class="gauge" id="cgauge" data-tipk="compute"><div class="top"><span style="color:#6fe9ff">◈ COMPUTE</span><span id="cval"></span></div><div class="bar"><i id="cbar" style="background:#6fe9ff"></i></div><div class="top" style="font-size:13px;color:#93a4c4"><span id="cuse"></span><span id="crp"></span></div></div>
      <div id="clock" data-tipk="clock"></div><div id="speed"></div>
      <button id="btn-stats" data-tip="<b>Statistics</b> (I)<br>Production and consumption per minute for every item, and power by source and consumer.">STATS <kbd>I</kbd></button><button id="btn-tech" data-tip="<b>Technology</b> (T)<br>Spend research on upgrades. Branches: efficiency, capacity, reliability.">TECH <kbd>T</kbd></button><button id="btn-guide" data-tip="<b>Codex</b> (J)<br>Short chapters on controls, power, logistics, ratios and every building.">CODEX <kbd>J</kbd></button><button id="btn-menu" data-tip="<b>Menu</b> (Esc)<br>Settings, save & load, restart the tutorial.">☰</button>`;
    this.els.res = top.querySelector('#res')!;
    // pointerdown, not click: the chip is re-rendered a few times per second, which can split a click
    this.els.res.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('.credchip')) this.openLedger(); });
    const sp = top.querySelector('#speed')!;
    for (const [lbl, v] of [['❚❚', 0], ['1×', 1], ['2×', 2], ['4×', 4]] as const) {
      const b = h('button', '', lbl);
      b.dataset.tip = v === 0 ? '<b>Pause</b> (Space)<br>You can still build while paused.' : `<b>${v}× speed</b> (+/−)`;
      b.dataset.v = String(v);
      b.onclick = () => { if (v === 0) { this.g.paused = !this.g.paused; audio.play('click'); this.refreshSpeed(); } else this.g.setSpeed(v); };
      sp.appendChild(b);
    }
    (top.querySelector('#btn-tech') as HTMLElement).onclick = () => this.openTech();
    (top.querySelector('#btn-stats') as HTMLElement).onclick = () => this.openStats();
    (top.querySelector('#btn-guide') as HTMLElement).onclick = () => this.openGuide();
    (top.querySelector('#btn-menu') as HTMLElement).onclick = () => this.openMenu();
    // build palette
    const bp = add('build', h('div', 'panel'));
    bp.innerHTML = `<div class="ptitle">BUILD</div><div class="tabs"></div><div class="list"></div>`;
    const tabs = bp.querySelector('.tabs')!;
    for (const t of TABS) { const b = h('button', '', t.name); b.dataset.tab = t.id; b.onclick = () => { this.tab = t.id; audio.play('click'); this.refreshPalette(); }; tabs.appendChild(b); }
    for (const b of tabs.querySelectorAll<HTMLElement>('button')) b.dataset.tip = { power: '<b>Power</b><br>Generators, poles, substations, batteries.', prod: '<b>Industry</b><br>Extractors, refineries, fabs, depots, junctions.', compute: '<b>Compute</b><br>Racks, cooling, labs, workloads, special buildings.' }[b.dataset.tab!] ?? '';
    // bottom toolbar: hotbar (1–0) + tools, styled differently from build categories
    const bar = add('bottombar', h('div'));
    bar.innerHTML = `<div id="hotbar" class="panel"></div><div id="tools" class="panel"></div>`;
    const tools = bar.querySelector('#tools')!;
    const tool = (id: string, icon: string, label: string, key: string, tip: string, fn: () => void) => { const b = h('button', 'toolbtn', `<span class="ti">${icon}</span><span>${label}</span><kbd>${key}</kbd>`); b.id = id; b.dataset.tip = tip; b.onclick = fn; tools.appendChild(b); };
    tool('tool-link', '⟿', 'LINK', 'L', '<b>Link tool</b> (L)<br>Click a building, then another, in either order, to connect them with a belt, pipe or data cable. The dashed preview turns green when the link is valid.<br>Click an existing link (it glows) to remove it. Shift keeps linking from the same building.', () => this.g.setTool(this.g.tool.kind === 'link' ? { kind: 'select' } : { kind: 'link', from: null }));
    tool('tool-move', '✥', 'MOVE', 'V', '<b>Move</b> (V)<br>Pick up a building and put it somewhere else, free. Links stay if still in range.', () => this.g.setTool(this.g.tool.kind === 'move' ? { kind: 'select' } : { kind: 'move', id: null }));
    tool('tool-demo', '✕', 'DEMOLISH', 'X', '<b>Demolish</b> (X)<br>Click a building or a link to remove it. Refunds <b>100%</b>: rearranging is never punished.', () => this.g.setTool(this.g.tool.kind === 'demolish' ? { kind: 'select' } : { kind: 'demolish' }));
    tool('tool-auto', '⚡', 'AUTO-LINK', '', '<b>Auto-link</b> (toggle)<br>When ON, new buildings connect to their nearest partners automatically. Cyan dashed lines preview the links before you place. Turn OFF to wire everything yourself.', () => { this.g.s.autoLink = !this.g.s.autoLink; audio.play('click'); this.refreshTool(); });
    this.renderHotbar();
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
    addO('tip', h('div', 'panel'));
    add('hint', h('div', 'panel'));
    add('fps', h('div'));
    add('banner', h('div'));
    // modals
    for (const id of ['guide', 'tech', 'menu', 'title', 'score', 'finale', 'save', 'stats', 'ledger']) {
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
    this.rates.reset();
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
      const el = h('div', 'bitem clickable' + (unlocked ? '' : ' locked') + (unlocked && !affordable(s, d) ? ' poor' : ''));
      el.dataset.type = d.id;
      const lr = lockReason(s, d);
      const slot = this.hotbar.indexOf(d.id);
      el.innerHTML = `<img src="${thumb(d.id)}" alt=""><div><div class="n">${d.name}</div><div class="s">${lr && !unlocked ? '🔒 ' + lr : d.short}</div><div class="cost">${unlocked ? costHtml(s, cost) + creditCostHtml(s, d.id) : ''}</div></div>${slot >= 0 ? `<kbd class="hk">${(slot + 1) % 10}</kbd>` : ''}${unlocked && !this.newSeen.has(d.id) ? '<span class="new">NEW</span>' : ''}`;
      el.dataset.tipk = 'def:' + d.id;
      el.onmouseleave = () => { this.hoveredPaletteType = null; };
      el.onclick = () => { if (!unlocked) { audio.play('error'); return; } this.newSeen.add(d.id); this.g.setTool({ kind: 'build', type: d.id }); audio.play('click'); };
      el.onmouseenter = () => { audio.play('hover'); this.hoveredPaletteType = unlocked ? d.id : null; };
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

  hotkey(n: number) { this.useHotbar(n - 1); }

  useHotbar(slot: number) {
    const t = this.hotbar[slot];
    if (!t) { audio.play('error'); this.toast('Empty slot: hover a build item and press this number to assign it', 'info'); return; }
    const d = BUILDING[t];
    if (!isUnlocked(this.g.s, d)) { audio.play('error'); this.toast(`${d.name}: ${lockReason(this.g.s, d)}`, 'warn'); return; }
    this.newSeen.add(t);
    this.g.setTool(this.g.tool.kind === 'build' && this.g.tool.type === t ? { kind: 'select' } : { kind: 'build', type: t });
    audio.play('click');
  }
  assignHotbar(slot: number, type: string | null) {
    if (!type) return;
    const prev = this.hotbar.indexOf(type);
    if (prev >= 0) this.hotbar[prev] = null;
    this.hotbar[slot] = type;
    try { localStorage.setItem('sd_hotbar', JSON.stringify(this.hotbar)); } catch { /* */ }
    audio.play('select');
    this.toast(`${BUILDING[type].name} → slot ${(slot + 1) % 10}`, 'good');
    this.renderHotbar(); this.refreshPalette();
  }
  renderHotbar() {
    const hb = this.root.querySelector('#hotbar') as HTMLElement | null;
    if (!hb) return;
    const s = this.g.s;
    hb.innerHTML = this.hotbar.map((t, i) => {
      const un = t ? isUnlocked(s, BUILDING[t]) : false;
      const on = this.g.tool.kind === 'build' && this.g.tool.type === t;
      return `<div class="hslot clickable${on ? ' on' : ''}${t && !un ? ' locked' : ''}" data-slot="${i}" data-tipk="hot:${i}">${t ? `<img src="${thumb(t)}">` : ''}<kbd>${(i + 1) % 10}</kbd></div>`;
    }).join('');
    hb.querySelectorAll<HTMLElement>('.hslot').forEach((el) => (el.onclick = () => this.useHotbar(Number(el.dataset.slot))));
  }

  refreshTool() {
    const t = this.g.tool;
    this.els.build.querySelectorAll<HTMLElement>('.bitem').forEach((e) => e.classList.toggle('on', t.kind === 'build' && e.dataset.type === t.type));
    this.root.querySelector('#tool-link')?.classList.toggle('on', t.kind === 'link');
    this.root.querySelector('#tool-demo')?.classList.toggle('on', t.kind === 'demolish');
    this.root.querySelector('#tool-move')?.classList.toggle('on', t.kind === 'move');
    this.renderHotbar();
    this.root.querySelector('#tool-auto')?.classList.toggle('on', this.g.s.autoLink);
    const hint = this.els.hint;
    if (t.kind === 'build') hint.innerHTML = `<b>LMB</b> place · drag to paint · <b>RMB</b>/<b>Esc</b> cancel · ${this.g.s.autoLink ? '<b style="color:#6fe9ff">cyan dashes</b> = links it will make' : 'auto-link <b>OFF</b>'} · <b style="color:#ffd84a">yellow</b> = power hookup`;
    else if (t.kind === 'link') hint.innerHTML = t.from === null ? '<b>LINK:</b> click a building (source or target, either order) · click a glowing link to remove it · <b>Esc</b> cancel' : `<b>LINK:</b> now click the other building for ${BUILDING[this.g.s.byId.get(t.from)?.type ?? 'hq'].name} · <b>Shift</b> to chain · <b>RMB</b> cancel`;
    else if (t.kind === 'demolish') hint.innerHTML = '<b>DEMOLISH:</b> click a building or a link (it glows red) · <b>full refund</b> (credits: half after 2 min) · <b>Esc</b> cancel';
    else if (t.kind === 'move') hint.innerHTML = t.id === null ? '<b>MOVE:</b> click the building to pick up · <b>Esc</b> cancel' : '<b>MOVE:</b> click the new spot · links in range are kept · <b>RMB</b> cancel';
    else hint.innerHTML = '<b>WASD</b>/RMB-drag pan · <b>wheel</b> zoom · <b>Q/E</b> or <b>L+R drag</b> rotate · <b>G</b> pipette · <b>Z</b> next problem · <b>Space</b> pause';
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
    this.tutorial.update();
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
    this.rates.sample(s);
    this.ledger.sample(s);
    const era = ERAS[s.era - 1];
    this.els.topbar.querySelector('#erachip')!.innerHTML = s.mode === 'sandbox' ? 'SANDBOX' : `ERA ${['I', 'II', 'III', 'IV', 'V'][s.era - 1]} · ${era.name.toUpperCase()}`;
    const res = this.els.res;
    const show = SHOWN_RES.filter((k) => k === 'metal' || k === 'silicon' || (s.stock[k] ?? 0) > 0 || (k === 'chips' && s.era >= 2) || (k === 'accel' && s.era >= 4));
    const html = this.ledger.chipHtml(s) + show.map((k) => `<div class="res" data-tipk="res:${k}">${itemIcon(k, 22)}<div><span class="v">${fmt(s.stock[k] ?? 0)}</span><span class="r">${(this.rate[k] ?? 0) >= 0 ? '+' : ''}${fmt((this.rate[k] ?? 0) * 60)}/min</span></div></div>`).join('')
      + `<div class="res" data-tipk="res:rp">${itemIcon('rp', 22)}<div><span class="v">${fmt(s.rp)}</span><span class="r">+${fmt(this.rates.rpPerMin())}/min</span></div></div>`;
    if (res.innerHTML !== html) res.innerHTML = html;
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
    const frac = cap > 0 ? st / cap : 0;
    const charging = s.buildings.some((b) => b.status === 'charging'), dis = s.buildings.some((b) => b.status === 'discharging');
    (this.els.topbar.querySelector('#pbat') as HTMLElement).innerHTML = cap > 0 ? `${batteryIcon(frac, charging ? 'c' : dis ? 'd' : '')} ${Math.round(frac * 100)}% of ${fmt(cap)}` : `${batteryIcon(0, '')} no storage`;
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
    const sun = sunlight(tod, dayBias(s));
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
      el.classList.toggle('poor', !affordable(s, d));
    });
    // delivery floaters at HQ
    const delivered = Object.values(s.stats.delivered).reduce((a, b) => a + (b ?? 0), 0);
    this.deliverAcc += delivered - this.lastDelivered;
    this.lastDelivered = delivered;
    if (this.deliverAcc >= 5) {
      const hb = hq(s);
      this.floatText(new THREE.Vector3(hb.x + 1.5, baseHeight(s.world, hb.x, hb.y, 3) + 4.4, hb.y + 1.5), `+${Math.floor(this.deliverAcc)}`, '#5dff9a');
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
    if (el.innerHTML !== html) el.innerHTML = html;
    // delegated pointerdown: the list re-renders every second (countdowns), which would swallow a normal click
    el.onpointerdown = (e) => {
      const btn = e.button === 0 ? (e.target as HTMLElement).closest<HTMLElement>('button[data-c]') : null;
      if (!btn) return;
      if (!acceptContract(s, Number(btn.dataset.c))) { audio.play('error'); this.toast('You can only run one contract of each kind at a time', 'warn'); }
    };
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
    // battery fill gauges above battery buildings (when zoomed in enough to read them)
    if (g.rig.view < 26) for (const b of s.buildings) {
      const d = BUILDING[b.type];
      if (!d.battery) continue;
      v.set(b.x + d.size / 2, baseHeight(s.world, b.x, b.y, d.size) + g.view.buildings.modelHeight(b.type) + 0.25, b.y + d.size / 2);
      const p = g.rig.worldToScreen(v);
      if (p.x < -30 || p.y < -30 || p.x > W + 30 || p.y > H + 30) continue;
      const f = Math.max(0, Math.min(1, b.charge / (d.battery.capacity * s.fx.batteryMul)));
      const x = p.x - 16, y = p.y - 8;
      ctx.fillStyle = 'rgba(5,8,18,0.75)'; ctx.fillRect(x - 2, y - 2, 38, 18);
      ctx.strokeStyle = '#c9d6ee'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, 30, 14); ctx.fillStyle = '#c9d6ee'; ctx.fillRect(x + 30, y + 4, 3, 6);
      ctx.fillStyle = f > 0.5 ? '#5dff9a' : f > 0.2 ? '#ffb347' : '#ff5a5a'; ctx.fillRect(x + 2, y + 2, 26 * f, 10);
      if (b.status === 'charging') { ctx.fillStyle = '#fff'; ctx.font = '700 12px Rajdhani, sans-serif'; ctx.fillText('⚡', x + 15, y + 7); ctx.font = '700 17px Rajdhani, sans-serif'; }
    }
    for (const b of s.buildings) {
      const kind = badgeFor(b);
      if (!kind) continue;
      const d = BUILDING[b.type];
      v.set(b.x + d.size / 2, baseHeight(s.world, b.x, b.y, d.size) + g.view.buildings.modelHeight(b.type) + 0.3, b.y + d.size / 2);
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
      const live = `<div class="stat ${l.state === 'blocked' ? 'bad' : l.state === 'saturated' ? 'warn' : 'ok'}">${l.state === 'blocked' ? '✕ Blocked: the destination is full or stalled' : l.state === 'saturated' ? '▲ Saturated: at full capacity. Add a parallel link.' : l.state === 'idle' ? '○ Idle: the source has nothing to send' : '✓ Flowing'}</div>
        <div class="kv"><span class="k">Carries</span><span class="v">${itemIcon(l.item, 14)} ${ITEMS[l.item].name}</span><span class="k">Flow</span><span class="v">${l.rate.toFixed(2)} / ${cap.toFixed(1)} per s</span><span class="k">Length</span><span class="v">${l.length.toFixed(1)} tiles</span><span class="k">Moved total</span><span class="v">${fmt(l.total)}</span></div>`;
      // rebuild the shell (and its buttons) only when the selection changes: rebuilding on every refresh swallowed clicks
      const key = `L${l.id}`;
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        el.innerHTML = `<div class="hd"><div><h3>${LINKS[l.kind].name}</h3><div class="role">${BUILDING[A.type].name} → ${BUILDING[B.type].name}</div></div></div>
        <div data-live></div><div class="acts"><button id="i-unlink">✕ REMOVE LINK</button></div>`;
        (el.querySelector('#i-unlink') as HTMLElement).onclick = () => { removeLink(s, l.id); g.select(null); };
      }
      this.patch(el.querySelector('[data-live]'), live);
      return;
    }
    if (!b) return;
    if (!force && el.dataset.key === `B${b.id}` && el.dataset.t === String(Math.floor(g.realTime * 4))) return;
    el.dataset.t = String(Math.floor(g.realTime * 4));
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
    const flowRow = (l: Link, dir: 'in' | 'out') => {
      const o = s.byId.get(dir === 'in' ? l.from : l.to);
      const per = l.item === 'compute' ? `${l.rate.toFixed(1)}/s` : `${(l.rate * 60).toFixed(1)}/min`;
      const st = l.state === 'blocked' ? '<span style="color:#ff5a5a">blocked</span>' : l.state === 'saturated' ? '<span style="color:#ffb347">full</span>' : l.state === 'idle' ? '<span style="color:#93a4c4">idle</span>' : '';
      return `<div class="flow">${dir === 'in' ? '⇢' : '⇠'} ${itemIcon(l.item, 13)} <b>${per}</b> ${dir === 'in' ? 'from' : 'to'} ${o ? BUILDING[o.type].name : '?'} ${st}</div>`;
    };
    const inL = s.links.filter((x) => x.to === b.id), outL = s.links.filter((x) => x.from === b.id);
    const flows = inL.map((l) => flowRow(l, 'in')).concat(outL.map((l) => flowRow(l, 'out'))).join('') || '<div class="flow dim">No links yet. Use the Link tool (L).</div>';
    const ratios = ratioLines(s, d);
    const live = `<div class="stat ${info.level === 'info' ? 'warn' : info.level}"><b style="font-size:20px">${info.glyph}</b><div><b>${info.title}</b><br>${info.text}</div></div>
      <div class="kv">${kv}</div>${bufs.join('')}
      <div class="ptitle" style="margin-top:10px;font-size:15px">FLOWS (live)</div>${flows}`;
    const ratioHtml = ratios.length ? `<details class="ratio"><summary>How many do I need?</summary>${ratios.map((r) => `<div>${r}</div>`).join('')}</details>` : '';
    // Static shell (header, ratio <details>, action buttons) is rebuilt only when the selection or its button set
    // changes; live values are patched in place. Rebuilding everything at 4 Hz swallowed clicks and closed <details>.
    const key = `B${b.id}|${b.broken > 0}|${ratioHtml.length}`;
    if (force || el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = `<div class="hd"><img src="${thumb(b.type)}"><div><h3>${d.name}</h3><div class="role">${d.desc}</div></div></div>
      <div data-live></div>${ratioHtml}<div data-core></div>
      <div class="acts">${b.type === 'hq' ? '<button id="i-stats" data-tip="Full production & power statistics (I)">📊 STATISTICS <kbd>I</kbd></button>' : ''}${b.type === 'pod' ? '<button id="i-mode" data-tip="Cycle Balanced → Training → Inference">MODE <kbd>M</kbd></button>' : ''}${b.broken > 0 ? '<button id="i-rep">REPAIR (10 metal) <kbd>R</kbd></button>' : ''}<button id="i-link" data-tip="Start a link from this building, then click the other building">⟿ CONNECT <kbd>L</kbd></button>${b.type !== 'hq' ? '<button id="i-move" data-tip="Pick it up and place it elsewhere (free)">✥ MOVE <kbd>V</kbd></button><button id="i-del" data-tip="Remove it. Refunds 100%.">✕ DEMOLISH <kbd>Del</kbd></button>' : ''}</div>`;
      const q = (id: string) => el.querySelector(id) as HTMLElement | null;
      q('#i-mode')?.addEventListener('click', () => { cycleMode(s, b.id); this.refreshInspector(true); });
      q('#i-rep')?.addEventListener('click', () => { if (!repair(s, b.id)) audio.play('error'); });
      q('#i-link')?.addEventListener('click', () => g.setTool({ kind: 'link', from: b.id }));
      q('#i-move')?.addEventListener('click', () => g.setTool({ kind: 'move', id: b.id }));
      q('#i-stats')?.addEventListener('click', () => this.openStats());
      q('#i-del')?.addEventListener('click', () => g.demolishBuilding(b));
    }
    this.patch(el.querySelector('[data-live]'), live);
    this.patch(el.querySelector('[data-core]'), b.type === 'hq' ? this.coreSummary() : '');
  }

  /** replace an element's HTML only when it actually changed (keeps hover/focus state and avoids layout churn) */
  private patch(el: Element | null, html: string) {
    if (el && el.innerHTML !== html) el.innerHTML = html;
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
  ghostTip(x: number, y: number, type: string, c: PlaceCheck, tx: number, ty: number, links?: [number, number][]) {
    const s = this.g.s, d = BUILDING[type];
    const extra: string[] = [];
    if (d.deposit && c.richness !== undefined && c.ok) extra.push(`Deposit coverage <b>${Math.round(c.richness * 100)}%</b> → output ×${c.richness.toFixed(2)}`);
    if (d.gen === 'wind') extra.push(`Local wind <b>×${s.world.wind[idx(s.world, tx, ty)].toFixed(2)}</b>`);
    const biome = s.world.biome[idx(s.world, Math.max(0, tx), Math.max(0, ty))];
    if (d.it && biome === BIOME.TUNDRA) extra.push('Cold climate: free-air cooling helps');
    if (c.platform) extra.push(`🧱 Platform levels ${c.platform} tile-step${c.platform > 1 ? 's' : ''} (+${c.platform * 2} metal)`);
    if (c.ok && d.power < 0 && !d.node) extra.push(coveredAt(s, tx, ty, d.size) ? '<span class="good">⚡ Connects to the grid (yellow line)</span>' : '<span class="bad">⚡ No grid here: add a Power Pole within 4.5 tiles</span>');
    if (links?.length) extra.push(`<span style="color:#6fe9ff">⟿ Auto-links: ${links.map(([f, t]) => { const o = s.byId.get(f === -1 ? t : f); return o ? (f === -1 ? '→ ' : '← ') + BUILDING[o.type].name : ''; }).join(', ')}</span>`);
    else if (c.ok && (d.inputs || d.outputs) && s.autoLink) extra.push('<span class="dim">No partner in range to auto-link yet</span>');
    this.tipAt(x, y, `<b>${d.name}</b><br>${c.ok ? '<span class="good">✓ Valid placement</span>' : `<span class="bad">✕ ${c.reason}</span>`}${extra.map((e) => '<br>' + e).join('')}<br>${costHtml(s, c.cost)}`);
  }
  linkHoverTip(x: number, y: number, l: Link, tool: string) {
    const s = this.g.s;
    const A = s.byId.get(l.from), B = s.byId.get(l.to);
    const per = l.item === 'compute' ? `${l.rate.toFixed(1)}/s` : `${(l.rate * 60).toFixed(1)}/min`;
    this.tipAt(x, y, `<b>${LINKS[l.kind].name}</b>: ${itemIcon(l.item, 13)} ${ITEMS[l.item].name} · <b>${per}</b><br>${A ? BUILDING[A.type].name : '?'} → ${B ? BUILDING[B.type].name : '?'} · ${l.state}<br><span class="${tool === 'select' ? 'dim' : 'bad'}">${tool === 'select' ? 'Click to inspect' : 'Click to remove this link'}</span>`);
  }
  linkTip(x: number, y: number, from: number, b: Building | null) {
    const s = this.g.s;
    const A = s.byId.get(from);
    if (!A) return;
    if (!b || b.id === from) { this.tipAt(x, y, `<b>Link: ${BUILDING[A.type].name}</b><br>Now click the other building (either direction works)`); return; }
    let c = checkLink(s, from, b.id);
    if (!c.ok) { const r = checkLink(s, b.id, from); if (r.ok) c = r; }
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
    for (const id of ['guide', 'tech', 'menu', 'score', 'finale', 'save', 'stats', 'ledger']) this.els[id].classList.remove('show');
    const was = this.openModal;
    if (was) audio.play('close');
    this.openModal = null;
    // a modal opened from the title screen (e.g. LOAD…) must return there, not to a dead, unstarted game
    if (was && !this.g.started) this.showTitle();
  }
  private show(id: string) {
    for (const m of ['guide', 'tech', 'menu', 'title', 'score', 'finale', 'save', 'stats', 'ledger']) this.els[m].classList.toggle('show', m === id);
    this.openModal = id;
    audio.play('open');
  }

  openGuide(ch?: string) {
    const s = this.g.s;
    if (ch) this.codexCh = ch;
    const m = this.els.guide;
    const cur = CHAPTERS.find((c) => c.id === this.codexCh) ?? CHAPTERS[0];
    m.innerHTML = `<div class="mcard panel codex"><div class="cnav"><h1>CODEX</h1>${CHAPTERS.map((c) => `<button class="${c.id === cur.id ? 'on' : ''}" data-ch="${c.id}"><span>${c.icon}</span> ${c.title}</button>`).join('')}<div style="flex:1"></div><button data-tut>↻ RESTART TUTORIAL</button></div>
      <div class="cbody"><h1 style="font-size:34px">${cur.icon} ${cur.title}</h1>${cur.html(s)}<div class="mact"><button class="primary" data-x>BACK</button></div></div></div>`;
    m.querySelectorAll<HTMLElement>('[data-ch]').forEach((b) => (b.onclick = () => { audio.play('click'); this.openGuide(b.dataset.ch); }));
    (m.querySelector('[data-x]') as HTMLElement).onclick = () => this.closeModals();
    (m.querySelector('[data-tut]') as HTMLElement).onclick = () => { this.closeModals(); this.tutorial.start(); };
    if (this.openModal !== 'guide') this.show('guide');
  }

  coreSummary(): string {
    const s = this.g.s;
    const top = (['metal', 'silicon', 'chips', 'accel'] as ItemId[]).filter((k) => (s.stock[k] ?? 0) > 0 || this.rates.perMin('produced', k) > 0);
    return `<div class="ptitle" style="margin-top:10px;font-size:15px">ECONOMY (per min)</div><div class="kv">${top.map((k) => `<span class="k">${itemIcon(k, 13)} ${ITEMS[k].name}</span><span class="v"><span style="color:#5dff9a">+${fmt(this.rates.perMin('delivered', k))}</span> / <span style="color:#ff8a8a">−${fmt(this.rates.perMin('spent', k) + this.rates.perMin('consumed', k))}</span></span>`).join('')}</div>`;
  }

  openLedger() {
    const m = this.els.ledger;
    // re-rendered every second, so buttons are handled by delegation and the scroll position is kept
    const render = () => {
      const top = m.querySelector('.ledger')?.scrollTop ?? 0;
      m.innerHTML = this.ledger.html(this.g.s);
      const card = m.querySelector('.ledger');
      if (card) card.scrollTop = top;
    };
    m.onpointerdown = (e) => {
      const t = e.target as HTMLElement;
      if (this.ledger.handle(t, this.g.s)) { audio.play('click'); render(); }
      else if (t.closest('[data-x]')) this.closeModals();
      else if (t.closest('[data-codex]')) this.openGuide('economics');
    };
    render();
    const timer = window.setInterval(() => { if (this.openModal !== 'ledger') { clearInterval(timer); return; } render(); }, 1000);
    this.hideTip();
    this.show('ledger');
  }

  openStats() {
    const s = this.g.s;
    const m = this.els.stats;
    const render = () => {
      const r = this.rates;
      const rows = (r.items() as ItemId[]).filter((k) => (s.stock[k] ?? 0) > 0 || (s.stats.produced[k] ?? 0) > 0).map((k) => {
        const p = r.perMin('produced', k), c = r.perMin('consumed', k), d = r.perMin('delivered', k), sp = r.perMin('spent', k);
        const net = p - c - (k === 'compute' ? 0 : 0);
        const isC = k === 'compute';
        const u = (v: number) => isC ? `${fmt(v / 60)}/s` : `${fmt(v)}`;
        return `<tr><td>${itemIcon(k, 16)} ${ITEMS[k].name}</td><td>${isC ? '—' : fmt(s.stock[k] ?? 0)}</td><td class="g">+${u(p)}</td><td class="r">−${u(c)}</td><td>${isC ? '—' : '+' + fmt(d)}</td><td>${isC ? '—' : '−' + fmt(sp)}</td><td class="${net >= 0 ? 'g' : 'r'}">${net >= 0 ? '+' : ''}${u(net)}</td></tr>`;
      }).join('');
      const pb = powerBreakdown(s);
      const pr = (o: Record<string, number>, cls: string) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${k}</td><td class="${cls}">${fmt(v)}</td><td><div class="sbar"><i class="${cls}" style="width:${Math.min(100, (v / Math.max(1, ...Object.values(o))) * 100)}%"></i></div></td></tr>`).join('');
      const gen = Object.values(pb.gen).reduce((a, b) => a + b, 0), use = Object.values(pb.use).reduce((a, b) => a + b, 0);
      m.innerHTML = `<div class="mcard panel" style="width:min(1280px,94vw)"><h1>STATISTICS</h1><div class="lede">Live rates over the last sim-minute. <b>Produced</b> = made by machines. <b>Consumed</b> = eaten by machines. <b>Delivered</b> = arrived in the stockpile. <b>Spent</b> = construction.</div>
        <div class="sgrid"><div><h3>ITEMS (per minute)</h3><table class="stab"><tr><th>Item</th><th>Stock</th><th>Produced</th><th>Consumed</th><th>Delivered</th><th>Spent</th><th>Net</th></tr>${rows}</table>
        <h3 style="margin-top:16px">RESEARCH</h3><div class="kv"><span class="k">Earning</span><span class="v">+${fmt(r.rpPerMin())}/min</span><span class="k">Banked</span><span class="v">${fmt(s.rp)}</span></div></div>
        <div><h3>POWER NOW</h3><table class="stab"><tr><th>Producer</th><th colspan="2">${fmt(gen)}</th></tr>${pr(pb.gen, 'g')}<tr><th>Consumer</th><th colspan="2">${fmt(use)}</th></tr>${pr(pb.use, 'r')}<tr><td>Batteries charging / discharging</td><td colspan="2">${fmt(pb.charge)} / ${fmt(pb.discharge)}</td></tr></table>
        <h3 style="margin-top:16px">COMPUTE</h3><div class="kv"><span class="k">Produced</span><span class="v">${fmt(s.stats.computeRate)}/s</span><span class="k">Used</span><span class="v">${fmt(s.stats.computeUsed)}/s</span><span class="k">Training</span><span class="v">${fmt(s.stats.trainRate)}/s</span><span class="k">Inference</span><span class="v">${fmt(s.stats.inferenceRate)}/s</span><span class="k">PUE</span><span class="v">${pue(s) > 0 ? pue(s).toFixed(2) : '—'}</span></div>
        <h3 style="margin-top:16px">BUILDINGS</h3><div class="kv">${Object.entries(s.buildings.reduce((a, b) => { a[BUILDING[b.type].name] = (a[BUILDING[b.type].name] ?? 0) + 1; return a; }, {} as Record<string, number>)).map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join('')}</div></div></div>
        <div class="mact"><button data-c>OPEN RATIOS (CODEX)</button><button class="primary" data-x>BACK</button></div></div>`;
      (m.querySelector('[data-x]') as HTMLElement).onclick = () => { clearInterval(timer); this.closeModals(); };
      (m.querySelector('[data-c]') as HTMLElement).onclick = () => { clearInterval(timer); this.openGuide('chains'); };
    };
    render();
    const timer = window.setInterval(() => { if (this.openModal !== 'stats') { clearInterval(timer); return; } render(); }, 1000);
    this.show('stats');
  }

  openTech() {
    const s = this.g.s;
    const m = this.els.tech;
    const render = () => {
      const branches: [string, string, string][] = [['efficiency', 'EFFICIENCY', '#5dff9a'], ['capacity', 'CAPACITY', '#6fe9ff'], ['reliability', 'RELIABILITY', '#ffb347']];
      const CW = 222, RH = 118, X0 = 150, Y0 = 50;
      const pos: Record<string, { x: number; y: number }> = {};
      // layout: column = era, row = branch; stack multiple techs in the same cell
      // column = dependency depth (so every chain reads left → right), row = branch; siblings stack
      const depth: Record<string, number> = {};
      const dep = (id: string): number => { if (depth[id] !== undefined) return depth[id]; const t = TECH[id]; return (depth[id] = t.requires?.length ? 1 + Math.max(...t.requires.map(dep)) : 0); };
      const cellCount: Record<string, number> = {};
      let maxCol = 0, rowsUsed = [1, 1, 1];
      for (const t of TECHS) {
        const row = branches.findIndex((b) => b[0] === t.branch);
        const col = dep(t.id); maxCol = Math.max(maxCol, col);
        const key = `${row}:${col}`;
        const k = cellCount[key] ?? 0; cellCount[key] = k + 1;
        rowsUsed[row] = Math.max(rowsUsed[row], k + 1);
        pos[t.id] = { x: X0 + col * (CW - 30), y: k * 66, row } as any;
      }
      const rowY = [Y0, Y0 + rowsUsed[0] * 66 + 50, 0];
      rowY[2] = rowY[1] + rowsUsed[1] * 66 + 50;
      for (const t of TECHS) { const p = pos[t.id] as any; p.y += rowY[p.row]; }
      const W = X0 + (maxCol + 1) * (CW - 30) + 20, H = rowY[2] + rowsUsed[2] * 66 + 20;
      const lines = TECHS.flatMap((t) => (t.requires ?? []).map((r) => { const a = pos[r], b = pos[t.id]; const done = s.techs.includes(r); return `<path d="M${a.x + 172} ${a.y + 26} C ${a.x + 200} ${a.y + 26}, ${b.x - 30} ${b.y + 26}, ${b.x} ${b.y + 26}" stroke="${done ? '#5dff9a' : '#4a5a7a'}" stroke-width="${done ? 3 : 2}" fill="none" marker-end="url(#arr)"/>`; })).join('');
      const nodes = TECHS.map((t) => {
        const done = s.techs.includes(t.id);
        const c = canResearch(s, t.id);
        const col = branches.find((b) => b[0] === t.branch)![2];
        const cls = done ? 'done' : c.ok ? 'avail' : t.era > s.era && s.mode !== 'sandbox' ? 'locked' : '';
        return `<div class="tnode2 ${cls}" data-t="${t.id}" data-tipk="tech:${t.id}" style="left:${pos[t.id].x}px;top:${pos[t.id].y}px;border-color:${done ? '#5dff9a' : c.ok ? col : ''}"><div class="n">${t.name}</div><div class="c">${done ? '✓ researched' : `${itemIcon('rp', 13)} ${t.cost}`} · Era ${['I', 'II', 'III', 'IV', 'V'][t.era - 1]}${t.era > s.era && s.mode !== 'sandbox' ? ' 🔒' : ''}</div></div>`;
      }).join('');
      const eraHdr = '';
      const rowHdr = branches.map(([, name, col], i) => `<div class="trow" style="top:${rowY[i] + 12}px;color:${col}">${name}</div>`).join('');
      m.innerHTML = `<div class="mcard panel" style="width:min(1320px,96vw)"><h1>TECHNOLOGY</h1><div class="lede">You have <b style="color:#b98cff">${fmt(s.rp)} research</b> (+${fmt(this.rates.rpPerMin())}/min). Arrows show prerequisites. Glowing nodes are ready to research: click one. Each branch trades something different.</div>
        <div class="ttree" style="width:${W}px;height:${H}px"><svg width="${W}" height="${H}"><defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 8 4 0 8z" fill="#7a8aaa"/></marker></defs>${lines}</svg>${eraHdr}${rowHdr}${nodes}</div>
        <div class="mact"><button class="primary" data-x>BACK</button></div></div>`;
      (m.querySelector('[data-x]') as HTMLElement).onclick = () => this.closeModals();
      m.querySelectorAll<HTMLElement>('.tnode2').forEach((n) => (n.onclick = () => { if (research(s, n.dataset.t!)) { this.hideTip(); render(); } else audio.play('error'); }));
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
    const desc = (d: any) => d ? `Era ${Number(d.era) | 0} · ${Math.round(Number(d.time) / 60) || 0} min · ${Array.isArray(d.buildings) ? d.buildings.length : 0} buildings · ${new Date(String(d.savedAt)).toLocaleString()}` : 'empty';
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
    try { if (auto) { const d = JSON.parse(auto); autoDesc = `Era ${Number(d.era) | 0} · ${Math.round(Number(d.time) / 60) || 0} min`; } } catch { /* */ }
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
    setTimeout(() => { if (this.g.started && this.g.s === s) this.show('finale'); }, 9000);
  }
}
