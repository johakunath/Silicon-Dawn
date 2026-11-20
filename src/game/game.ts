import * as THREE from 'three';
import { audio } from '../audio/audio';
import { BUILDING } from '../sim/data/buildings';
import { ERAS } from '../sim/data/eras';
import { ITEMS } from '../sim/data/items';
import { addLink, checkLink, checkPlace, cycleMode, demolish, place, removeLink, repair } from '../sim/actions';
import { loadFromString, saveToString } from '../sim/save';
import { step } from '../sim/sim';
import { GameState, TICK, createState, dayBias, hq, timeOfDay } from '../sim/state';
import type { Building, Difficulty, Link } from '../sim/types';
import { SceneRig } from '../render/scene';
import { baseHeight } from '../render/terrain';
import { Overlay, WorldView } from '../render/world';
import { Hud } from '../ui/hud';
import { badgeFor } from '../ui/status';

const FIRST_TIPS: Record<string, string> = {
  quarry: 'Tip: extractors need a refinery. Place a Silicon Furnace nearby, and belts connect automatically.',
  rack: 'Tip: racks turn power into compute and heat. Link them to a Lab, and pipe in coolant to stop throttling.',
  fab: 'Tip: fabs need silicon, metal and water. You can also link the Core or a Depot → Fab to ship stockpiled goods.',
  hall: 'Tip: a Datacenter Hall needs 1.5 coolant/s. Chillers need no water, and cooling towers are kinder to PUE.',
  pod: 'Tip: select a pod and press M to tune it. Training mode gives +25% compute, Inference mode suits Gateways.',
  depot: 'Tip: Depots work both ways. Belts deliver into them, and links out of them ship stockpiled goods anywhere nearby.',
  gas: 'Tip: gas is firm power, but it hurts your footprint rating and trips during grid faults.',
  switch: 'Tip: route compute → Switch → Training Core over fiber. Fiber-fed training is twice as efficient.',
  engine: 'The Dawn Engine is fiction. Feed it compute over fiber and accelerators from a Depot.',
};

export type Tool = { kind: 'select' } | { kind: 'build'; type: string } | { kind: 'link'; from: number | null } | { kind: 'demolish' };

export interface Settings { volume: number; music: number; muted: boolean; reducedMotion: boolean; edgePan: boolean; showFps: boolean; uiScale: number }

const SETTINGS_KEY = 'sd_settings_v1';
export const AUTOSAVE_KEY = 'sd_autosave';

function loadSettings(): Settings {
  const def: Settings = { volume: 0.7, music: 0.8, muted: false, reducedMotion: false, edgePan: false, showFps: false, uiScale: 1 };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; } catch { return def; }
}

export class Game {
  s: GameState;
  rig: SceneRig;
  view: WorldView;
  hud: Hud;
  speed = 1;
  paused = true; // until title screen dismissed
  tool: Tool = { kind: 'select' };
  settings = loadSettings();
  selectedLink: Link | null = null;
  started = false;
  private acc = 0;
  private clock = new THREE.Clock();
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, down: false, button: -1, dragX: 0, dragY: 0, moved: false, lastPaint: '', rotating: false };
  private vel = new THREE.Vector2();
  private yawTarget = Math.PI / 4;
  private viewTarget = 13;
  private autosaveT = 0;
  private flash = 0;
  private problemIdx = 0;
  realTime = 0;
  fps = 60;
  frameMs = 0;
  private cinematic: { t: number; dur: number; from: number; to: number } | null = null;
  finale = 0; // 0..1 after ignition
  private nightSeen = false;
  private tipsSeen = new Set<string>();

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.s = createState(20261119);
    this.rig = new SceneRig(canvas);
    this.view = new WorldView(this.rig, this.s);
    this.focusCore(true);
    this.hud = new Hud(this, ui);
    this.applySettings();
    this.bindInput(canvas);
    (window as any).__sd = this; // debug / screenshot hooks
  }

  applySettings() {
    const st = this.settings;
    audio.setVolume(st.volume); audio.setMuted(st.muted); audio.setMusic(st.music);
    this.view.buildings.reducedMotion = st.reducedMotion;
    this.view.links.reducedMotion = st.reducedMotion;
    this.view.particles.reduced = st.reducedMotion;
    document.documentElement.style.setProperty('--fs', `${18 * st.uiScale}px`);
    (document.getElementById('ui') as HTMLElement).style.zoom = String(st.uiScale);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(st)); } catch { /* ignore */ }
  }

  // ───────── lifecycle ─────────
  newGame(seed: number, difficulty: Difficulty, mode: 'campaign' | 'sandbox' = 'campaign') {
    this.s = createState(seed, difficulty, mode);
    this.view.setState(this.s);
    this.tool = { kind: 'select' };
    this.focusCore(true);
    this.started = true;
    this.paused = false;
    this.finale = 0;
    this.hud.onNewState();
    this.hud.refreshSpeed();
    if (mode === 'campaign') this.hud.showEraBanner(1);
  }

  loadJson(json: string): boolean {
    try {
      const s = loadFromString(json);
      this.s = s;
      this.view.setState(s);
      this.view.frontierAnim = 1;
      this.tool = { kind: 'select' };
      this.focusCore(true);
      this.started = true;
      this.paused = false;
      this.finale = s.engine.ignited ? 1 : 0;
      this.hud.onNewState();
      this.hud.refreshSpeed();
      this.hud.toast('Game loaded', 'good');
      return true;
    } catch (e) {
      this.hud.toast('Could not load: ' + (e as Error).message, 'bad');
      return false;
    }
  }

  saveJson(): string { return saveToString(this.s); }

  autosave() {
    if (!this.started) return;
    try { localStorage.setItem(AUTOSAVE_KEY, this.saveJson()); } catch { /* quota */ }
  }

  // ───────── camera ─────────
  maxView() { return this.s.mode === 'sandbox' ? 70 : [0, 22, 30, 40, 56, 70][this.s.era]; }
  focusCore(instant = false) {
    const h = hq(this.s);
    this.focus(h.x + 1.5, h.y + 1.5, instant);
  }
  focus(x: number, z: number, instant = false) {
    const t = new THREE.Vector3(x, 1.1, z);
    if (instant) { this.rig.target.copy(t); this.rig.updateCamera(); }
    else this.focusTarget = t;
  }
  private focusTarget: THREE.Vector3 | null = null;

  zoomAt(px: number, py: number, factor: number) {
    const before = this.rig.screenToGround(px, py);
    this.viewTarget = THREE.MathUtils.clamp(this.viewTarget * factor, 5, this.maxView());
    const old = this.rig.view;
    this.rig.view = this.viewTarget;
    this.rig.updateCamera();
    const after = this.rig.screenToGround(px, py);
    if (before && after) this.rig.target.add(before.sub(after).setY(0));
    this.rig.view = old;
    this.rig.updateCamera();
  }

  cinematicPull(to: number) {
    this.cinematic = { t: 0, dur: 3.5, from: this.rig.view, to };
  }

  // ───────── tools ─────────
  setTool(t: Tool) {
    this.tool = t;
    this.view.placingType = t.kind === 'build' ? t.type : null;
    if (t.kind !== 'build') this.view.setGhost(null);
    this.view.refreshOverlay(true);
    this.hud.refreshTool();
  }
  setOverlay(o: Overlay) {
    this.view.overlay = this.view.overlay === o ? 'none' : o;
    const ov = this.view.overlay;
    this.view.links.focusKinds = ov === 'network' ? new Set(['cable', 'fiber']) : ov === 'logistics' ? new Set(['conveyor', 'pipe']) : ov === 'heat' ? new Set(['pipe']) : null;
    this.view.links.showStates = ov === 'logistics' || ov === 'network';
    const c = new THREE.Color();
    const grey = new THREE.Color(0.45, 0.47, 0.55);
    this.view.buildings.tint = ov === 'none' ? null : (b) => {
      const d = BUILDING[b.type];
      if (ov === 'heat') {
        if (!d.it) return d.cat === 'cooling' ? c.setRGB(0.6, 0.85, 1.3) : grey;
        const t = Math.min(1, b.heat / 1.3);
        return c.setRGB(0.5 + t * 1.3, 0.75 - t * 0.45, 1.4 - t * 1.1);
      }
      if (ov === 'power') {
        if (d.power < 0 && b.grid < 0) return c.setRGB(1.6, 0.3, 0.3);
        if (d.power > 0 || d.battery || d.node) return c.setRGB(1.35, 1.2, 0.6);
        return null;
      }
      if (ov === 'network') return d.it || d.workload || d.passthrough ? c.setRGB(0.8, 1.2, 1.4) : grey;
      if (ov === 'logistics') return d.cat === 'extract' || d.cat === 'refine' || d.storage ? null : grey;
      return null;
    };
    this.view.refreshOverlay(true);
    this.hud.refreshOverlay();
    audio.play('click');
  }
  select(b: Building | null) {
    this.view.selected = b;
    this.selectedLink = null;
    this.view.links.highlight = b ? new Set(this.s.links.filter((l) => l.from === b.id || l.to === b.id).map((l) => l.id)) : null;
    if (b) audio.play('select');
    this.hud.refreshInspector(true);
  }

  // ───────── input ─────────
  private bindInput(canvas: HTMLCanvasElement) {
    const unlock = () => { audio.init(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.12 : 1 / 1.12); }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => {
      canvas.focus();
      this.mouse.down = true; this.mouse.button = e.button; this.mouse.dragX = e.clientX; this.mouse.dragY = e.clientY; this.mouse.moved = false;
      this.mouse.lastPaint = '';
      if ((e.buttons & 3) === 3) { this.mouse.rotating = true; return; }
      if (e.button === 0) this.onPrimary(e.clientX, e.clientY, false);
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const dx = e.clientX - this.mouse.x, dy = e.clientY - this.mouse.y;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.mouse.down && ((e.buttons & 3) === 3 || (e.altKey && (e.buttons & 2)))) {
        // LMB+RMB (or Alt+RMB) drag: free, stepless rotation
        this.yawTarget += dx * 0.006;
        this.rig.yaw = this.yawTarget;
        this.mouse.moved = true;
        this.mouse.rotating = true;
      } else if (this.mouse.down && (this.mouse.button === 2 || this.mouse.button === 1)) {
        if (Math.hypot(e.clientX - this.mouse.dragX, e.clientY - this.mouse.dragY) > 4) this.mouse.moved = true;
        this.panScreen(-dx, -dy);
        this.vel.set(-dx, -dy);
      } else if (this.mouse.down && this.mouse.button === 0 && !this.mouse.rotating && this.tool.kind === 'build') {
        // paint-place small buildings
        const d = BUILDING[this.tool.type];
        if (d.size <= 2) this.onPrimary(e.clientX, e.clientY, true);
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button === 2 && !this.mouse.moved) this.onSecondary();
      if (e.buttons === 0) { this.mouse.down = false; this.mouse.rotating = false; }
    });
    canvas.addEventListener('pointerleave', () => { this.view.hovered = null; this.hud.hideTip(); });
  }

  /** move the camera by a screen-space vector (pixels; +x right, +y down) */
  private panScreen(sx: number, sy: number) {
    const k = (this.rig.view * 2) / window.innerHeight;
    const right = new THREE.Vector3(Math.sin(this.rig.yaw), 0, -Math.cos(this.rig.yaw));
    const down = new THREE.Vector3(Math.cos(this.rig.yaw), 0, Math.sin(this.rig.yaw));
    this.rig.target.addScaledVector(right, sx * k).addScaledVector(down, (sy * k) / Math.sin(this.rig.pitch));
    this.clampTarget();
  }
  private clampTarget() {
    const S = this.s.world.size;
    this.rig.target.x = THREE.MathUtils.clamp(this.rig.target.x, 2, S - 2);
    this.rig.target.z = THREE.MathUtils.clamp(this.rig.target.z, 2, S - 2);
  }

  private onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (this.hud.modalOpen()) { if (k === 'escape') this.hud.closeModals(); return; }
    if (!this.started) return;
    switch (k) {
      case 'escape':
        if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
        else if (this.view.selected) this.select(null);
        else this.hud.openMenu();
        break;
      case ' ': this.paused = !this.paused; audio.play('click'); this.hud.refreshSpeed(); e.preventDefault(); break;
      case '+': case '=': this.setSpeed(Math.min(4, this.speed * 2)); break;
      case '-': case '_': this.setSpeed(Math.max(1, this.speed / 2)); break;
      case 'q': this.yawTarget = (Math.round((this.yawTarget - Math.PI / 4) / (Math.PI / 2)) + 1) * (Math.PI / 2) + Math.PI / 4; break;
      case 'e': this.yawTarget = (Math.round((this.yawTarget - Math.PI / 4) / (Math.PI / 2)) - 1) * (Math.PI / 2) + Math.PI / 4; break;
      case 'l': this.setTool({ kind: 'link', from: this.view.selected?.id ?? null }); audio.play('click'); break;
      case 'x': this.setTool({ kind: 'demolish' }); audio.play('click'); break;
      case 'delete': if (this.view.selected) { this.demolishBuilding(this.view.selected); } break;
      case 'p': this.setOverlay('power'); break;
      case 'h': this.setOverlay('heat'); break;
      case 'n': this.setOverlay('network'); break;
      case 'o': this.setOverlay('logistics'); break;
      case 't': this.hud.openTech(); break;
      case 'j': case 'f1': this.hud.openGuide(); e.preventDefault(); break;
      case 'c': case 'home': this.focusCore(); break;
      case 'f': if (this.view.selected) { const b = this.view.selected; const d = BUILDING[b.type]; this.focus(b.x + d.size / 2, b.y + d.size / 2); } break;
      case 'z': this.nextProblem(); break;
      case 'm': if (this.view.selected?.type === 'pod') { cycleMode(this.s, this.view.selected.id); this.hud.refreshInspector(true); } break;
      case 'r': if (this.view.selected && this.view.selected.broken > 0) repair(this.s, this.view.selected.id); break;
      case 'f3': this.settings.showFps = !this.settings.showFps; this.applySettings(); e.preventDefault(); break;
      default:
        if (/^[1-9]$/.test(k)) this.hud.hotkey(Number(k));
    }
  }

  setSpeed(v: number) { this.speed = v; this.paused = false; audio.play('click'); this.hud.refreshSpeed(); }

  private nextProblem() {
    const probs = this.s.buildings.filter((b) => badgeFor(b));
    if (!probs.length) { this.hud.toast('No problems right now ✓', 'good'); return; }
    this.problemIdx = (this.problemIdx + 1) % probs.length;
    const b = probs[this.problemIdx];
    const d = BUILDING[b.type];
    this.focus(b.x + d.size / 2, b.y + d.size / 2);
    this.select(b);
  }

  demolishBuilding(b: Building) {
    if (b.type === 'hq') { audio.play('error'); this.hud.toast('The Command Core cannot be demolished', 'warn'); return; }
    demolish(this.s, b.id);
    if (this.view.selected?.id === b.id) this.select(null);
  }

  private onPrimary(px: number, py: number, painting: boolean) {
    const s = this.s;
    const t = this.tool;
    if (t.kind === 'build') {
      const tile = this.view.tileAt(px, py);
      if (!tile) return;
      const d = BUILDING[t.type];
      const x = tile[0] - Math.floor((d.size - 1) / 2), y = tile[1] - Math.floor((d.size - 1) / 2);
      const key = `${x},${y}`;
      if (painting && key === this.mouse.lastPaint) return;
      this.mouse.lastPaint = key;
      const c = checkPlace(s, t.type, x, y);
      if (!c.ok) { if (!painting) { audio.play('error'); this.hud.toast(c.reason ?? 'Cannot build here', 'warn'); } return; }
      const b = place(s, t.type, x, y);
      if (b) {
        const h = baseHeight(s.world, x, y, d.size);
        const costTxt = Object.entries(c.cost).map(([k, v]) => `−${v} ${ITEMS[k as keyof typeof ITEMS].name.toLowerCase()}`).join('  ');
        if (costTxt) this.hud.floatText(new THREE.Vector3(x + d.size / 2, h + 1.5, y + d.size / 2), costTxt, '#ffb347');
        if (!painting && d.unique) this.setTool({ kind: 'select' });
      }
      return;
    }
    if (t.kind === 'demolish') {
      const b = this.view.buildingAt(px, py);
      if (b) { this.demolishBuilding(b); return; }
      const g = this.rig.screenToGround(px, py, 1.4);
      if (g) { const l = this.view.links.pick(g.x, g.z, 0.6); if (l) removeLink(s, l.id); }
      return;
    }
    if (t.kind === 'link') {
      const b = this.view.buildingAt(px, py);
      if (!b) {
        const g = this.rig.screenToGround(px, py, 1.4);
        const l = g ? this.view.links.pick(g.x, g.z, 0.5) : null;
        if (l) { removeLink(s, l.id); this.hud.toast('Link removed', 'info'); }
        return;
      }
      if (t.from === null) { this.tool = { kind: 'link', from: b.id }; this.select(b); this.hud.refreshTool(); return; }
      if (t.from === b.id) return;
      const c = checkLink(s, t.from, b.id);
      if (!c.ok) {
        // maybe reversed intent
        const r = checkLink(s, b.id, t.from);
        if (r.ok) { addLink(s, b.id, t.from); this.tool = { kind: 'link', from: null }; this.hud.refreshTool(); return; }
        audio.play('error'); this.hud.toast(c.reason ?? 'Cannot link', 'warn'); return;
      }
      addLink(s, t.from, b.id);
      this.tool = { kind: 'link', from: this.keys.has('shift') ? t.from : null };
      this.hud.refreshTool();
      return;
    }
    // select
    const b = this.view.buildingAt(px, py);
    if (b) { this.select(b); return; }
    const g = this.rig.screenToGround(px, py, 1.4);
    const l = g ? this.view.links.pick(g.x, g.z, 0.45) : null;
    if (l) {
      this.select(null);
      this.selectedLink = l;
      this.view.links.highlight = new Set([l.id]);
      this.hud.refreshInspector(true);
      return;
    }
    this.select(null);
  }

  private onSecondary() {
    if (this.tool.kind !== 'select') { this.setTool({ kind: 'select' }); audio.play('close'); }
    else if (this.view.selected || this.selectedLink) this.select(null);
  }

  // ───────── frame ─────────
  frame = () => {
    this.tickFrame(Math.min(0.1, this.clock.getDelta()));
    requestAnimationFrame(this.frame);
  };

  /** one full frame (sim + render + UI); exposed for screenshots/benchmarks */
  tickFrame(rdt: number) {
    this.realTime += rdt;
    const t0 = performance.now();
    this.fps += (1 / Math.max(1e-3, rdt) - this.fps) * 0.05;
    const s = this.s;
    // camera
    const panSp = this.rig.view * 1.25 * rdt;
    const kb = new THREE.Vector2(0, 0);
    if (this.keys.has('w') || this.keys.has('arrowup')) kb.y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) kb.y += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) kb.x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) kb.x += 1;
    if (this.settings.edgePan && this.started) {
      const m = 6;
      if (this.mouse.x < m) kb.x -= 1; if (this.mouse.x > window.innerWidth - m) kb.x += 1;
      if (this.mouse.y < m) kb.y -= 1; if (this.mouse.y > window.innerHeight - m) kb.y += 1;
    }
    if (kb.lengthSq() > 0) {
      const pxPerUnit = window.innerHeight / (2 * this.rig.view);
      this.panScreen(kb.x * panSp * pxPerUnit, kb.y * panSp * pxPerUnit);
    }
    if (!this.mouse.down && this.vel.lengthSq() > 0.01) { this.panScreen(this.vel.x, this.vel.y); this.vel.multiplyScalar(Math.pow(0.0015, rdt)); }
    if (this.focusTarget) {
      this.rig.target.lerp(this.focusTarget, 1 - Math.pow(0.002, rdt));
      if (this.rig.target.distanceTo(this.focusTarget) < 0.05) this.focusTarget = null;
    }
    if (this.cinematic) {
      const c = this.cinematic;
      c.t += rdt;
      const k = Math.min(1, c.t / c.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.viewTarget = c.from + (c.to - c.from) * e;
      this.rig.view = this.viewTarget;
      if (k >= 1) this.cinematic = null;
    } else {
      this.rig.view += (this.viewTarget - this.rig.view) * (1 - Math.pow(0.0005, rdt));
    }
    this.rig.yaw += (this.yawTarget - this.rig.yaw) * (1 - Math.pow(0.001, rdt));
    const shake = this.settings.reducedMotion ? 0 : this.view.shake;
    const tgt = this.rig.target.clone();
    if (shake > 0) this.rig.target.add(new THREE.Vector3((Math.random() - 0.5) * shake * 0.5, 0, (Math.random() - 0.5) * shake * 0.5));
    this.rig.updateCamera();

    // sim
    if (this.started && !this.paused && !this.hud.blockingModal()) {
      this.acc += rdt * this.speed;
      let n = 0;
      while (this.acc >= TICK && n < 60) { step(s); this.acc -= TICK; n++; }
      if (n >= 60) this.acc = 0;
      this.autosaveT += rdt;
      if (this.autosaveT > 45) { this.autosaveT = 0; this.autosave(); }
    }
    this.drainSignals();

    // hover / ghost
    if (this.started && !this.mouse.down) this.updateHover();
    // day/night
    const tod = this.started ? timeOfDay(s) : 0.42 + this.realTime * 0.002;
    this.rig.setTimeOfDay(tod, s.era, s.era >= 5 ? 1 : 0, dayBias(s));
    if (this.finale > 0) this.finale = Math.min(1, this.finale + rdt / 20);
    this.view.finaleT = this.finale;
    // era V aurora: faint every night, blazing after ignition
    this.rig.aurora = s.era >= 5 ? Math.max(this.rig.night * 0.5, this.finale > 0 ? 0.6 + this.finale * 0.6 : 0) : 0;
    // event colour grading
    const ev = s.events.find((e) => e.warn <= 0)?.id;
    const target = ev === 'heatwave' ? [1.16, 0.95, 0.78, 0.55] : ev === 'dust' ? [1.1, 0.92, 0.7, 0.5] : ev === 'drought' ? [1.05, 1.0, 0.85, 0.35] : ev === 'outage' ? [0.85, 0.85, 1.0, Math.random() < 0.04 ? 0.9 : 0.3] : ev === 'shortage' ? [0.95, 1.02, 0.95, 0.2] : [1, 1, 1, 0];
    const e4 = this.rig.event;
    e4.set(e4.x + (target[0] - e4.x) * rdt * 2, e4.y + (target[1] - e4.y) * rdt * 2, e4.z + (target[2] - e4.z) * rdt * 2, ev === 'outage' ? target[3] : e4.w + (target[3] - e4.w) * rdt * 2);
    if (ev === 'dust' && Math.random() < rdt * 25) { const t = this.rig.target; this.view.particles.emit('dust', t.x + (Math.random() - 0.5) * this.rig.view * 3, 1.5 + Math.random() * 2, t.z + (Math.random() - 0.5) * this.rig.view * 3, 2, 3); }
    // first nightfall teaching moment
    if (this.started && this.rig.night > 0.6 && !this.nightSeen && s.era === 1 && s.time > 30) { this.nightSeen = true; this.hud.toast('☾ Night falls. Solar sleeps, and your batteries carry the grid until dawn.', 'warn'); }
    this.view.update(this.realTime, rdt);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - rdt * 0.6);
    this.rig.render(this.realTime, this.flash);
    this.rig.target.copy(tgt);
    this.hud.update(rdt);
    audio.update(rdt, {
      era: s.era, buildings: s.buildings.length, power: s.grids.reduce((a, g) => a + g.demand, 0), compute: s.stats.computeRate,
      night: this.rig.night, halls: s.buildings.filter((b) => b.type === 'hall' || b.type === 'pod').length, training: s.stats.trainRate,
      event: s.events.some((e) => e.warn <= 0), finale: this.finale, speed: this.speed,
    });
    this.frameMs += (performance.now() - t0 - this.frameMs) * 0.05;
  }

  private updateHover() {
    const s = this.s;
    const t = this.tool;
    if (this.hud.pointerOverUi) { this.view.setGhost(null); this.view.hovered = null; return; }
    if (t.kind === 'build') {
      const tile = this.view.tileAt(this.mouse.x, this.mouse.y);
      if (!tile) { this.view.setGhost(null); this.hud.hideTip(); return; }
      const d = BUILDING[t.type];
      const x = tile[0] - Math.floor((d.size - 1) / 2), y = tile[1] - Math.floor((d.size - 1) / 2);
      const c = checkPlace(s, t.type, x, y);
      this.view.setGhost(t.type, x, y, c.ok);
      this.hud.ghostTip(this.mouse.x, this.mouse.y, t.type, c, x, y);
      return;
    }
    const b = this.view.buildingAt(this.mouse.x, this.mouse.y);
    if (b !== this.view.hovered) { this.view.hovered = b; if (b) audio.play('hover'); }
    if (t.kind === 'link' && t.from !== null) { this.hud.linkTip(this.mouse.x, this.mouse.y, t.from, b); return; }
    if (b) this.hud.buildingTip(this.mouse.x, this.mouse.y, b);
    else this.hud.hideTip();
  }

  private drainSignals() {
    const s = this.s;
    if (!s.signals.length) return;
    for (const sg of s.signals) {
      this.view.handleSignal(sg.kind, sg.x, sg.y, sg.data);
      switch (sg.kind) {
        case 'build': {
          const tip = FIRST_TIPS[sg.data as string];
          if (tip && !this.tipsSeen.has(sg.data as string) && this.started) { this.tipsSeen.add(sg.data as string); this.hud.toast(tip, 'info'); }
          const d = BUILDING[sg.data as string]; audio.play(d.size >= 3 ? 'placeBig' : 'place', ['power', 'extract', 'refine', 'compute', 'cooling', 'workload', 'logistics', 'special', 'core'].indexOf(d.cat)); this.hud.refreshPalette(); break; }
        case 'link': audio.play('link'); break;
        case 'unlink': audio.play('unlink'); break;
        case 'demolish': audio.play('demolish'); this.hud.refreshPalette(); break;
        case 'objective': audio.play('objective'); break;
        case 'research': audio.play('research'); this.hud.refreshPalette(); break;
        case 'event_warn': audio.play('warn'); break;
        case 'event_start': audio.play('warn'); break;
        case 'event_end': audio.play('repair'); break;
        case 'contract_offer': audio.play('open'); break;
        case 'contract_done': audio.play('contract'); break;
        case 'contract_fail': audio.play('fail'); break;
        case 'break': audio.play('break'); break;
        case 'repair': audio.play('repair'); break;
        case 'mode': audio.play('mode', ['balanced', 'training', 'inference'].indexOf(sg.data as string)); break;
        case 'era': {
          const era = sg.data as number;
          audio.play('era', era);
          this.view.expandFrontier();
          this.hud.showEraBanner(era);
          this.cinematicPull(Math.min(this.maxView(), Math.max(this.rig.view, [0, 14, 20, 26, 34, 42][era])));
          this.flash = 0.35;
          this.hud.refreshPalette();
          this.hud.showScore(s.eraScores[s.eraScores.length - 1]);
          this.autosave();
          break;
        }
        case 'ignite': {
          audio.play('ignite');
          this.flash = 1.2;
          this.finale = 0.01;
          const e = s.buildings.find((b) => b.type === 'engine');
          if (e) this.focus(e.x + 2, e.y + 2);
          this.cinematicPull(Math.min(this.maxView(), 40));
          break;
        }
        case 'campaign_done': this.hud.showFinale(); this.autosave(); break;
      }
    }
    s.signals.length = 0;
  }

  start() { requestAnimationFrame(this.frame); }
}
