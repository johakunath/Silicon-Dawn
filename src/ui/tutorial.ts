// Interactive step-by-step tutorial: spotlights the exact UI element or map spot, advances on real actions.
import * as THREE from 'three';
import type { Game } from '../game/game';
import { BUILDING } from '../sim/data/buildings';
import { countType, hq } from '../sim/state';
import { baseHeight } from '../render/terrain';
import { DEPOSIT, idx } from '../sim/world';

interface Step {
  text: string;
  /** CSS selector or a function returning a screen rect to spotlight */
  target?: string | ((g: Game) => DOMRect | null);
  done?: (g: Game) => boolean;
  /** step needs a "Next" click instead of an action */
  next?: boolean;
  enter?: (g: Game) => void;
}

function nearestDeposit(g: Game, dep: number): [number, number] | null {
  const s = g.s, w = s.world, h = hq(s);
  let best: [number, number] | null = null, bd = Infinity;
  for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++) {
    const i = idx(w, x, y);
    if (w.deposit[i] !== dep || s.occ[i]) continue;
    const d = Math.hypot(x - h.x, y - h.y);
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}

function worldRect(g: Game, x: number, y: number, r: number): DOMRect {
  const p = g.rig.worldToScreen(new THREE.Vector3(x, baseHeight(g.s.world, Math.floor(x), Math.floor(y), 1), y));
  const px = (r * window.innerHeight) / (2 * g.rig.view);
  return new DOMRect(p.x - px, p.y - px * 0.7, px * 2, px * 1.4);
}

const linked = (g: Game, from: string, to: string) => g.s.links.some((l) => g.s.byId.get(l.from)?.type === from && g.s.byId.get(l.to)?.type === to);

/** fallback so a step can't get stuck when auto-link is off or the building is out of belt range (the next steps teach manual links) */
const placedFor = (g: Game, type: string, secs: number) => g.s.buildings.some((b) => b.type === type && g.s.time - b.built > secs);

export const STEPS: Step[] = [
  { text: '<b>Welcome to Silicon Dawn.</b><br>Time is <b>paused</b> so you can look around. You start with a <b>Command Core</b>, the glowing tower: your stockpile, a small generator and a power node.<br><br>Let’s build a working economy in a few steps.', next: true, target: (g) => { const h = hq(g.s); return worldRect(g, h.x + 1.5, h.y + 1.5, 2.5); }, enter: (g) => { g.paused = true; g.focusCore(); g.hud.refreshSpeed(); } },
  { text: 'Every machine needs <b>power</b>. In the <b>POWER</b> category of the build menu, select the <b>Solar Array</b>. Hover any build item for a detailed tooltip: inputs, outputs per minute and how many you need.', target: '#build .bitem[data-type="solar"]', done: (g) => g.tool.kind === 'build' && g.tool.type === 'solar' || countType(g.s, 'solar') > 0 },
  { text: 'Place it <b>next to the Core</b> (highlighted). The ghost turns <b style="color:#5dff9a">green</b> when the spot is valid, and the tooltip explains why if not. <b>Right-click</b> cancels.', target: (g) => { const h = hq(g.s); return worldRect(g, h.x + 5, h.y + 1.5, 3); }, done: (g) => countType(g.s, 'solar') > 0 },
  { text: 'This is your <b>power gauge</b>: demand <i>of</i> available supply. <b>Hover it</b> for a full breakdown: who produces, who consumes, and how many batteries the night needs.', target: '#pgauge', next: true },
  { text: 'Now start time: press <kbd>Space</kbd> or click <b>1×</b>. You can pause any time.', target: '#speed', done: (g) => !g.paused },
  { text: 'Next, raw materials. Open <b>INDUSTRY</b> and pick the <b>Quartz Extractor</b>.', target: '#build .tabs button[data-tab="prod"]', done: (g) => g.tool.kind === 'build' && g.tool.type === 'quarry' || countType(g.s, 'quarry') > 0 },
  { text: 'Place it squarely on the <b>cyan crystals</b> (they glow while placing). More crystal tiles under it means more output. Is it out of reach of the grid? The ghost turns <b style="color:#ffb347">orange</b>, and you add a <b>Power Pole</b>.', target: (g) => { const p = nearestDeposit(g, DEPOSIT.QUARTZ); return p ? worldRect(g, p[0] + 0.5, p[1] + 0.5, 3) : null; }, enter: (g) => { const p = nearestDeposit(g, DEPOSIT.QUARTZ); if (p) g.focus(p[0], p[1]); }, done: (g) => countType(g.s, 'quarry') > 0 },
  { text: 'Quartz is useless until refined. Pick the <b>Silicon Furnace</b> and place it in the highlighted spot <b>between the extractor and the Core</b> (belts reach 14 tiles). Watch the <b style="color:#6fe9ff">cyan dashed lines</b>: <b>auto-link</b> shows the belts it will build (extractor → furnace → Core) <i>before</i> you click.', target: (g) => { if (!(g.tool.kind === 'build' && g.tool.type === 'furnace')) { const el = document.querySelector('#build .bitem[data-type="furnace"]') as HTMLElement | null; return el && el.offsetParent ? el.getBoundingClientRect() : null; } const q = g.s.buildings.find((b) => b.type === 'quarry'); const h = hq(g.s); return q ? worldRect(g, (q.x + 1 + h.x + 1.5) / 2, (q.y + 1 + h.y + 1.5) / 2, 2.2) : null; }, done: (g) => linked(g, 'quarry', 'furnace') || placedFor(g, 'furnace', 8) },
  { text: 'Belts now carry quartz and silicon. You can see every packet! Next, metal: an <b>Ore Drill</b> on the <b style="color:#ff9a50">rust-coloured ore</b>, then an <b>Ore Smelter</b> nearby.', target: (g) => { const p = nearestDeposit(g, DEPOSIT.ORE); return p ? worldRect(g, p[0] + 0.5, p[1] + 0.5, 3) : null; }, enter: (g) => { const p = nearestDeposit(g, DEPOSIT.ORE); if (p) g.focus(p[0], p[1]); }, done: (g) => linked(g, 'drill', 'smelter') || placedFor(g, 'smelter', 8) },
  { text: '<b>Manual links:</b> press <kbd>L</kbd> (Link tool), click one building, then the other, in either order. To <b>remove</b> a link, hover it with <kbd>X</kbd> until it glows red, then click. Belts, junctions and links are free, and demolishing refunds 100%.', target: '#tools', next: true },
  { text: 'Solar sleeps at night. Build a <b>Battery Bank</b> (POWER) so your base keeps running. Its tooltip tells you how many you need.', target: '#build .tabs button[data-tab="power"]', done: (g) => countType(g.s, 'battery') > 0 },
  { text: '<b>Overlays</b> show hidden systems: <kbd>P</kbd> power coverage and health, <kbd>H</kbd> heat, <kbd>N</kbd> the compute network, <kbd>O</kbd> logistics flow (amber = belt full, red = blocked). Each overlay shows a legend. Try one now.', target: '#ovbtns', done: (g) => g.view.overlay !== 'none' },
  { text: 'Click any building to inspect it: live <b>in/out per minute</b>, problems and fixes. Press <kbd>I</kbd> for <b>statistics</b> and <kbd>J</kbd> for the <b>Codex</b> (short chapters on everything). Your objectives are top right. Good luck!', target: '#side', next: true },
];

export class Tutorial {
  step = -1;
  private spot: HTMLElement;
  private bubble: HTMLElement;
  active = false;

  constructor(private g: Game, root: HTMLElement) {
    this.spot = document.createElement('div');
    this.spot.id = 'tspot';
    this.bubble = document.createElement('div');
    this.bubble.id = 'tbubble';
    this.bubble.className = 'panel';
    root.append(this.spot, this.bubble);
    this.hide();
  }

  start() { this.active = true; this.go(0); }
  stop() {
    this.active = false; this.hide();
    this.g.s.flags.tutorial = false;
    try { localStorage.setItem('sd_tutorial_done', '1'); } catch { /* */ }
  }
  /** hide without marking the tutorial as done (e.g. a save was loaded) */
  cancel() { this.active = false; this.hide(); }
  private hide() { this.spot.style.display = 'none'; this.bubble.style.display = 'none'; }

  private go(i: number) {
    if (i >= STEPS.length) { this.stop(); return; }
    this.step = i;
    const st = STEPS[i];
    st.enter?.(this.g);
    this.bubble.innerHTML = `<div class="tstep">TUTORIAL · ${i + 1}/${STEPS.length}</div><div class="ttext">${st.text}</div><div class="tact">${st.next ? `<button class="primary" data-n>${i === STEPS.length - 1 ? 'FINISH' : 'NEXT'}</button>` : '<span class="dim">↳ do it to continue</span>'}<button data-s>SKIP TUTORIAL</button></div>`;
    (this.bubble.querySelector('[data-n]') as HTMLElement | null)?.addEventListener('click', () => this.go(i + 1));
    (this.bubble.querySelector('[data-s]') as HTMLElement).addEventListener('click', () => this.stop());
    this.bubble.style.display = 'block';
  }

  update() {
    if (!this.active) return;
    if (this.g.hud.modalOpen()) { this.hide(); return; }
    const st = STEPS[this.step];
    if (this.bubble.style.display === 'none') this.bubble.style.display = 'block';
    if (!st) return;
    if (!st.next && st.done?.(this.g)) { this.go(this.step + 1); return; }
    let r: DOMRect | null = null;
    if (typeof st.target === 'string') { const el = document.querySelector(st.target) as HTMLElement | null; r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null; }
    else if (st.target) r = st.target(this.g);
    if (r) {
      const pad = 6;
      this.spot.style.display = 'block';
      Object.assign(this.spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    } else this.spot.style.display = 'none';
    // bubble next to target, kept on screen
    const bw = this.bubble.offsetWidth, bh = this.bubble.offsetHeight;
    let bx = window.innerWidth / 2 - bw / 2, by = window.innerHeight * 0.62;
    if (r) {
      bx = r.right + 24; by = r.top;
      if (bx + bw > window.innerWidth - 12) bx = r.left - bw - 24;
      if (bx < 12) { bx = Math.min(window.innerWidth - bw - 12, Math.max(12, r.left)); by = r.bottom + 20; }
      if (by + bh > window.innerHeight - 12) by = Math.max(80, r.top - bh - 20);
    }
    this.bubble.style.left = `${Math.max(12, bx)}px`;
    this.bubble.style.top = `${Math.max(80, by)}px`;
    void BUILDING;
  }
}
