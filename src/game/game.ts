import * as THREE from 'three';
import { audio } from '../audio/audio';
import { BUILDING } from '../sim/data/buildings';
import { ERAS } from '../sim/data/eras';
import { ITEMS } from '../sim/data/items';
import { addLink, checkLink, checkPlace, cycleMode, demolish, moveBuilding, place, previewAutoLinks, removeLink, repair } from '../sim/actions';
import { coveredAt, rebuildGrids } from '../sim/power';
import { loadFromString, saveToString } from '../sim/save';
import { step } from '../sim/sim';
import { GameState, TICK, createState, dayBias, hq, timeOfDay } from '../sim/state';
import type { Building, Difficulty, Link } from '../sim/types';
import { QualityManager } from '../render/quality';
import { SceneRig } from '../render/scene';
import { baseHeight } from '../render/terrain';
import { Overlay, WorldView } from '../render/world';
import { Hud } from '../ui/hud';
import { badgeFor } from '../ui/status';
import { TouchBar } from '../ui/touchbar';
import { CloudSave } from '../ui/cloudsave';
import { TouchControls } from './touch';

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

const DEMOLISH_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Ccircle cx='16' cy='16' r='12' fill='%23ff4a4a' stroke='%23000' stroke-width='2'/%3E%3Cpath d='M10 10l12 12M22 10L10 22' stroke='%23fff' stroke-width='3.5' stroke-linecap='round'/%3E%3C/svg%3E") 16 16, not-allowed`;

export type Tool = { kind: 'select' } | { kind: 'build'; type: string } | { kind: 'link'; from: number | null } | { kind: 'demolish' } | { kind: 'move'; id: number | null };

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
  quality: QualityManager;
  cloud: CloudSave;
  /** last input was a finger (no hover): tooltips come from long-press instead */
  touchMode = false;
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
  private previewKey = '';
  private previewCache: [number, number][] = [];
  private nearestNodeCovering(x: number, y: number, size: number): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const n of this.s.buildings) {
      const dn = BUILDING[n.type];
      if (!dn.node) continue;
      const nx = n.x + dn.size / 2, ny = n.y + dn.size / 2;
      const dx = Math.max(x - nx, 0, nx - (x + size)), dy = Math.max(y - ny, 0, ny - (y + size));
      const dd = Math.hypot(dx, dy);
      if (dd <= dn.node.radius && dd < bd) { bd = dd; best = n; }
    }
    return best;
  }
  private tipsSeen = new Set<string>();

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.s = createState(20261119);
    this.rig = new SceneRig(canvas);
    this.view = new WorldView(this.rig, this.s);
    this.focusCore(true);
    this.hud = new Hud(this, ui);
    this.quality = new QualityManager(this.rig, () => this.view, () => this.started && !this.paused && !this.hud.blockingModal());
    this.applySettings();
    window.addEventListener('resize', () => this.applySettings());
    // save when the tab is hidden or closed (also covers building while paused, which the timer skips)
    window.addEventListener('pagehide', () => this.autosave());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.autosave(); });
    // ask the browser not to evict local saves under storage pressure (best effort, silently ignored if refused)
    navigator.storage?.persist?.().catch(() => {});
    this.bindInput(canvas);
    new TouchControls(this, canvas);
    new TouchBar(this, ui);
    this.cloud = new CloudSave(this);
    this.setTouchMode(this.quality.profile === 'performance' && matchMedia('(pointer: coarse)').matches);
    (window as any).__sd = this; // debug / screenshot hooks
  }

  applySettings() {
    const st = this.settings;
    audio.setVolume(st.volume); audio.setMuted(st.muted); audio.setMusic(st.music);
    this.view.buildings.reducedMotion = st.reducedMotion;
    this.view.links.reducedMotion = st.reducedMotion;
    this.view.particles.reduced = st.reducedMotion;
    document.documentElement.style.setProperty('--fs', `${18 * st.uiScale}px`);
    // big monitors (1440p/4K): scale the whole UI up so text stays comfortably readable
    // small screens (11-inch tablet = 1280×800 CSS px): shrink so the 1700 px wide layout fits
    const auto = window.innerWidth >= 3400 ? 1.5 : window.innerWidth >= 2400 ? 1.2 : window.innerWidth < 1700 ? Math.max(0.6, window.innerWidth / 1700) : 1;
    const z = st.uiScale * auto;
    const ui = document.getElementById('ui') as HTMLElement;
    ui.style.zoom = '';
    // scale via transform on a shrunken box: layout fits the screen and rects stay accurate
    ui.style.transformOrigin = '0 0';
    ui.style.transform = z !== 1 ? `scale(${z})` : '';
    ui.style.width = `${100 / z}vw`; ui.style.height = `${100 / z}vh`; ui.style.right = 'auto'; ui.style.bottom = 'auto';
    (document.getElementById('ovl') as HTMLElement).style.setProperty('--z', String(st.uiScale * auto));
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(st)); } catch { /* ignore */ }
  }

  // ───────── lifecycle ─────────
  newGame(seed: number, difficulty: Difficulty, mode: 'campaign' | 'sandbox' = 'campaign') {
    this.s = createState(seed, difficulty, mode);
    this.view.setState(this.s);
    this.tool = { kind: 'select' };
    this.focusCore(true);
    this.started = true;
    rebuildGrids(this.s); step(this.s); // compute power & status once so the HUD isn't empty while paused
    this.paused = mode === 'campaign'; // campaign starts paused: look around, plan, then press Space
    this.finale = 0;
    this.hud.onNewState();
    this.hud.refreshSpeed();
    if (mode === 'campaign') {
      this.hud.showEraBanner(1);
      let done = false; try { done = localStorage.getItem('sd_tutorial_done') === '1'; } catch { /* */ }
      const st = this.s;
      if (!done) setTimeout(() => { if (this.s === st && this.started) this.hud.tutorial.start(); }, 2600);
      else this.hud.toast('Paused: press Space when ready. Press J for the Codex.', 'info');
    }
  }

  loadJson(json: string): boolean {
    try {
      const s = loadFromString(json);
      rebuildGrids(s); step(s); // fail here, before the running game is replaced
      this.s = s;
      this.view.setState(s);
      this.view.frontierAnim = 1;
      this.tool = { kind: 'select' };
      this.focusCore(true);
      this.started = true;
      this.paused = false;
      this.finale = s.engine.ignited ? 1 : 0;
      this.hud.tutorial.cancel();
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

  private saveWarned = false;
  autosave() {
    if (!this.started) return;
    try {
      localStorage.setItem(AUTOSAVE_KEY, this.saveJson());
      this.saveWarned = false;
    } catch {
      // storage full or blocked (private mode): tell the player once, so progress isn't silently lost
      if (!this.saveWarned) this.hud.toast('Autosave failed: browser storage is full or blocked. Use Menu → Export to keep a copy.', 'bad');
      this.saveWarned = true;
    }
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
    this.view.placingType = t.kind === 'build' ? t.type : t.kind === 'move' && t.id !== null ? this.s.byId.get(t.id)?.type ?? null : null;
    if (t.kind !== 'build' && !(t.kind === 'move' && t.id !== null)) this.view.setGhost(null);
    this.view.setPreview([]);
    this.view.links.hoverLink = -1;
    this.view.buildings.dangerId = -1;
    const cv = this.rig.renderer.domElement;
    cv.style.cursor = t.kind === 'demolish' ? DEMOLISH_CURSOR : t.kind === 'link' ? 'crosshair' : t.kind === 'move' ? 'move' : t.kind === 'build' ? 'copy' : 'default';
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
      if (e.pointerType !== 'mouse') return; // touch and pen: see touch.ts
      this.setTouchMode(false);
      canvas.focus();
      this.mouse.down = true; this.mouse.button = e.button; this.mouse.dragX = e.clientX; this.mouse.dragY = e.clientY; this.mouse.moved = false;
      this.mouse.lastPaint = '';
      if ((e.buttons & 3) === 3) { this.mouse.rotating = true; return; }
      if (e.button === 0) this.onPrimary(e.clientX, e.clientY, false);
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.pointerType === 'pen' && e.buttons) return; // pen drags pan (touch.ts); pen hover still moves the cursor
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') this.setTouchMode(false);
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
      if (e.pointerType !== 'mouse') return;
      if (e.button === 2 && !this.mouse.moved) this.onSecondary();
      if (e.buttons === 0) { this.mouse.down = false; this.mouse.rotating = false; }
    });
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'touch') return; this.view.hovered = null; this.hud.hideTip(); });
  }

  /** move the camera by a screen-space vector (pixels; +x right, +y down) */
  panScreen(sx: number, sy: number) {
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
      case 'q': this.rotateStep(1); break;
      case 'e': this.rotateStep(-1); break;
      case 'l': this.setTool(this.tool.kind === 'link' ? { kind: 'select' } : { kind: 'link', from: null }); audio.play('click'); break;
      case 'x': this.setTool(this.tool.kind === 'demolish' ? { kind: 'select' } : { kind: 'demolish' }); audio.play('click'); break;
      case 'v': this.setTool(this.tool.kind === 'move' ? { kind: 'select' } : { kind: 'move', id: null }); audio.play('click'); break;
      case 'g': this.pipette(); break; // build more of what's under the cursor
      case 'delete': if (this.view.selected) { this.demolishBuilding(this.view.selected); } break;
      case 'p': this.setOverlay('power'); break;
      case 'h': this.setOverlay('heat'); break;
      case 'n': this.setOverlay('network'); break;
      case 'o': this.setOverlay('logistics'); break;
      case 't': this.hud.openTech(); break;
      case 'i': this.hud.openStats(); break;
      case 'j': case 'f1': this.hud.openGuide(); e.preventDefault(); break;
      case 'c': case 'home': this.focusCore(); break;
      case 'f': if (this.view.selected) { const b = this.view.selected; const d = BUILDING[b.type]; this.focus(b.x + d.size / 2, b.y + d.size / 2); } break;
      case 'z': this.nextProblem(); break;
      case 'm': if (this.view.selected?.type === 'pod') { cycleMode(this.s, this.view.selected.id); this.hud.refreshInspector(true); } break;
      case 'r': if (this.view.selected && this.view.selected.broken > 0) repair(this.s, this.view.selected.id); break;
      case 'f3': this.settings.showFps = !this.settings.showFps; this.applySettings(); e.preventDefault(); break;
      default:
        if (/^[0-9]$/.test(k)) {
          const slot = k === '0' ? 9 : Number(k) - 1;
          if (e.ctrlKey || this.hud.hoveredPaletteType) { this.hud.assignHotbar(slot, e.ctrlKey && this.tool.kind === 'build' ? this.tool.type : this.hud.hoveredPaletteType); e.preventDefault(); }
          else this.hud.useHotbar(slot);
        }
    }
  }

  /** snap-rotate the camera by a quarter turn (+1 = Q, −1 = E) */
  rotateStep(dir: 1 | -1) { this.yawTarget = (Math.round((this.yawTarget - Math.PI / 4) / (Math.PI / 2)) + dir) * (Math.PI / 2) + Math.PI / 4; }
  /** free rotation (touch twist) */
  rotateBy(rad: number) { this.yawTarget += rad; this.rig.yaw = this.yawTarget; this.rig.updateCamera(); }
  /** pan inertia after a drag, in screen pixels per frame */
  fling(vx: number, vy: number) { this.vel.set(vx, vy); }
  /** pipette: build more of the selected or hovered building */
  pipette() { const b = this.view.hovered ?? this.view.selected; if (b && b.type !== 'hq') { this.setTool({ kind: 'build', type: b.type }); audio.play('click'); } }
  setTouchMode(on: boolean) {
    if (on === this.touchMode) return;
    this.touchMode = on;
    document.body.classList.toggle('touch', on);
    if (on) { this.view.hovered = null; this.view.buildings.hoverId = -1; this.hud.hideTip(); }
  }
  /** a finger tap: acts like a left click at that spot and leaves the ghost there */
  tap(px: number, py: number) { this.mouse.x = px; this.mouse.y = py; this.onPrimary(px, py, false); }
  /** move the virtual cursor (ghost and link preview follow it) without clicking */
  pointAt(px: number, py: number) { this.mouse.x = px; this.mouse.y = py; }

  setSpeed(v: number) { this.speed = v; this.paused = false; audio.play('click'); this.hud.refreshSpeed(); }

  nextProblem() {
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

  onPrimary(px: number, py: number, painting: boolean) {
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
    if (t.kind === 'move') {
      if (t.id === null) {
        const b = this.view.buildingAt(px, py);
        if (!b || b.type === 'hq') { if (b) { audio.play('error'); this.hud.toast('The Command Core stays where it is', 'warn'); } return; }
        this.setTool({ kind: 'move', id: b.id });
        audio.play('select');
        return;
      }
      const mb = s.byId.get(t.id);
      const tile = this.view.tileAt(px, py);
      if (!mb || !tile) return;
      const d = BUILDING[mb.type];
      const x = tile[0] - Math.floor((d.size - 1) / 2), y = tile[1] - Math.floor((d.size - 1) / 2);
      if (moveBuilding(s, mb.id, x, y)) { audio.play('place', 2); this.setTool({ kind: 'move', id: null }); }
      else { audio.play('error'); this.hud.toast(checkPlace(s, mb.type, x, y, mb).reason ?? 'Cannot move here', 'warn'); }
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

  onSecondary() {
    if (this.tool.kind !== 'select') { this.setTool({ kind: 'select' }); audio.play('close'); }
    else if (this.view.selected || this.selectedLink) this.select(null);
  }

  // ───────── frame ─────────
  private frameErrors = 0;
  frame = () => {
    // schedule first: one exception in a frame must not freeze the game for good
    requestAnimationFrame(this.frame);
    // quality profile: frame cap, idle slow-down, nothing at all while the tab is hidden
    if (!this.quality.shouldRender(performance.now())) return;
    try {
      this.tickFrame(Math.min(0.1, this.clock.getDelta()));
    } catch (e) {
      if (this.frameErrors++ === 0) {
        console.error(e);
        this.autosave();
        this.hud.toast('Something went wrong. Your game was autosaved; reload the page if it misbehaves.', 'bad');
      }
    }
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
    const ghostType = t.kind === 'build' ? t.type : t.kind === 'move' && t.id !== null ? s.byId.get(t.id)?.type : undefined;
    if (ghostType) {
      const tile = this.view.tileAt(this.mouse.x, this.mouse.y);
      if (!tile) { this.view.setGhost(null); this.view.setPreview([]); this.hud.hideTip(); return; }
      const d = BUILDING[ghostType];
      const x = tile[0] - Math.floor((d.size - 1) / 2), y = tile[1] - Math.floor((d.size - 1) / 2);
      const moving = t.kind === 'move' ? s.byId.get(t.id!) : undefined;
      const c = checkPlace(s, ghostType, x, y, moving);
      const powered = d.power >= 0 || !!d.node || coveredAt(s, x, y, d.size);
      this.view.setGhost(ghostType, x, y, c.ok, c.ok && !powered);
      // live preview: auto-links (cyan) and power hookup (yellow)
      const lines: { a: THREE.Vector3; b: THREE.Vector3; color: string }[] = [];
      const here = this.view.anchor(x, y, d.size);
      if (c.ok && t.kind === 'build' && s.autoLink && this.previewKey !== `${ghostType}${x},${y}`) {
        this.previewKey = `${ghostType}${x},${y}`;
        this.previewCache = previewAutoLinks(s, ghostType, x, y);
      }
      if (c.ok && t.kind === 'build' && s.autoLink) for (const [f, to] of this.previewCache) {
        const o = s.byId.get(f === -1 ? to : f);
        if (!o) continue;
        const od = BUILDING[o.type];
        const there = this.view.anchor(o.x, o.y, od.size);
        lines.push(f === -1 ? { a: here, b: there, color: '#6fe9ff' } : { a: there, b: here, color: '#6fe9ff' });
      }
      if (c.ok && d.power < 0 && !d.node) {
        const node = this.nearestNodeCovering(x, y, d.size);
        if (node) { const nd = BUILDING[node.type]; lines.push({ a: here, b: this.view.anchor(node.x, node.y, nd.size, 1.6), color: '#ffd84a' }); }
      }
      this.view.setPreview(lines);
      this.hud.ghostTip(this.mouse.x, this.mouse.y, ghostType, c, x, y, this.previewCache.length && t.kind === 'build' && s.autoLink ? this.previewCache : undefined);
      return;
    }
    // touch has no hover: tooltips come from long-press (touch.ts), the link preview still follows the last tap
    if (this.touchMode && !(t.kind === 'link' && t.from !== null)) return;
    const b = this.view.buildingAt(this.mouse.x, this.mouse.y);
    if (b !== this.view.hovered) { this.view.hovered = b; if (b) audio.play('hover'); }
    this.view.buildings.hoverId = b?.id ?? -1;
    this.view.buildings.dangerId = t.kind === 'demolish' && b ? b.id : -1;
    // links under the cursor (select / link / demolish)
    let hl: number = -1;
    if (!b) { const g = this.rig.screenToGround(this.mouse.x, this.mouse.y, 1.4); const l = g ? this.view.links.pick(g.x, g.z, 0.5) : null; if (l) hl = l.id; }
    this.view.links.hoverLink = hl;
    this.view.links.hoverDanger = t.kind === 'demolish' || t.kind === 'link';
    if (t.kind === 'link' && t.from !== null) {
      const A = s.byId.get(t.from);
      if (A) {
        const ad = BUILDING[A.type];
        const a = this.view.anchor(A.x, A.y, ad.size);
        let target: THREE.Vector3 | null = null, col = '#ffffff';
        if (b && b.id !== A.id) {
          const bd = BUILDING[b.type];
          target = this.view.anchor(b.x, b.y, bd.size);
          const ok = checkLink(s, A.id, b.id).ok || checkLink(s, b.id, A.id).ok;
          col = ok ? '#5dff9a' : '#ff4a4a';
        } else { const g = this.rig.screenToGround(this.mouse.x, this.mouse.y, a.y); if (g) target = g; }
        this.view.setPreview(target ? [{ a, b: target, color: col }] : []);
      }
      this.hud.linkTip(this.mouse.x, this.mouse.y, t.from, b);
      return;
    }
    if (hl >= 0 && !b) { const l = s.links.find((x) => x.id === hl); if (l) { this.hud.linkHoverTip(this.mouse.x, this.mouse.y, l, t.kind); return; } }
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
          this.previewKey = '';
          const tip = FIRST_TIPS[sg.data as string];
          if (tip && !this.tipsSeen.has(sg.data as string) && this.started) { this.tipsSeen.add(sg.data as string); this.hud.toast(tip, 'info'); }
          const d = BUILDING[sg.data as string]; audio.play(d.size >= 3 ? 'placeBig' : 'place', ['power', 'extract', 'refine', 'compute', 'cooling', 'workload', 'logistics', 'special', 'core'].indexOf(d.cat)); this.hud.refreshPalette(); break; }
        case 'link': audio.play('link'); break;
        case 'unlink': audio.play('unlink'); break;
        case 'demolish': audio.play('demolish'); this.hud.refreshPalette(); break;
        case 'move': this.previewKey = ''; break;
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
