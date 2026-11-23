import type { Game } from './game';

/** Movement (CSS px) before a touch counts as a drag instead of a tap. */
export const TAP_SLOP = 10;
/** Hold time (ms) for a long-press. */
export const LONG_PRESS_MS = 450;
/** Twist (radians) before a two-finger gesture starts rotating, so pinches do not wobble the view. */
export const TWIST_DEADZONE = 0.2;

interface Pt { x: number; y: number; sx: number; sy: number }

export interface TwoFinger { dist: number; angle: number; mx: number; my: number }

export function twoFinger(a: { x: number; y: number }, b: { x: number; y: number }): TwoFinger {
  return { dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), angle: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}

/** smallest signed difference between two angles */
export function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Touch and S Pen input on the game canvas.
 * One finger: tap = click, drag = pan, hold = inspect (tooltip + select, or placement check in build mode).
 * Two fingers: pinch = zoom, twist = rotate, move = pan.
 * Mouse input stays in game.ts.
 */
export class TouchControls {
  private pts = new Map<number, Pt>();
  private mode: 'none' | 'tap' | 'pan' | 'two' | 'done' = 'none';
  private longTimer = 0;
  private prev: TwoFinger | null = null;
  private twist = 0;
  private rotating = false;
  private vel = { x: 0, y: 0 };

  constructor(private g: Game, canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => this.down(e, canvas));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e, false));
    canvas.addEventListener('pointercancel', (e) => this.up(e, true));
    this.bindUiLongPress();
  }

  private down(e: PointerEvent, canvas: HTMLCanvasElement) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    if (e.pointerType === 'touch') this.g.setTouchMode(true);
    else this.g.setTouchUi(true); // S Pen: keep hover tooltips, show the touch rail
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    this.g.hud.hideTip();
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    this.g.fling(0, 0);
    if (this.pts.size === 1) {
      this.mode = 'tap';
      clearTimeout(this.longTimer);
      this.longTimer = window.setTimeout(() => this.longPress(), LONG_PRESS_MS);
    } else if (this.pts.size === 2) {
      clearTimeout(this.longTimer);
      this.mode = 'two';
      const [a, b] = [...this.pts.values()];
      this.prev = twoFinger(a, b);
      this.twist = 0; this.rotating = false;
    }
  }

  private move(e: PointerEvent) {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.mode === 'tap' && Math.hypot(p.x - p.sx, p.y - p.sy) > TAP_SLOP) { this.mode = 'pan'; clearTimeout(this.longTimer); }
    if (this.mode === 'pan' && this.pts.size === 1) {
      this.g.panScreen(-dx, -dy);
      this.vel.x = this.vel.x * 0.5 + -dx * 0.5; this.vel.y = this.vel.y * 0.5 + -dy * 0.5;
    } else if (this.mode === 'two' && this.pts.size >= 2 && this.prev) {
      const [a, b] = [...this.pts.values()];
      const cur = twoFinger(a, b);
      this.g.panScreen(this.prev.mx - cur.mx, this.prev.my - cur.my);
      const f = this.prev.dist / cur.dist;
      if (Math.abs(f - 1) > 0.002) this.g.zoomAt(cur.mx, cur.my, f);
      const da = angleDelta(this.prev.angle, cur.angle);
      if (!this.rotating) { this.twist += da; if (Math.abs(this.twist) > TWIST_DEADZONE) this.rotating = true; }
      else this.g.rotateBy(-da);
      this.prev = cur;
    }
  }

  private up(e: PointerEvent, cancelled: boolean) {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    this.pts.delete(e.pointerId);
    clearTimeout(this.longTimer);
    if (this.pts.size === 0) {
      if (this.mode === 'tap' && !cancelled) this.g.tap(p.x, p.y);
      else if (this.mode === 'pan') this.g.fling(this.vel.x, this.vel.y);
      this.mode = 'none';
      this.vel.x = this.vel.y = 0;
      this.prev = null;
    } else if (this.pts.size === 1) {
      // lifting one of two fingers: keep panning with the other, never treat the rest as a tap
      this.mode = 'pan';
      this.vel.x = this.vel.y = 0;
      this.prev = null;
    }
  }

  /** hold without moving: show what is under the finger */
  private longPress() {
    if (this.mode !== 'tap' || this.pts.size !== 1) return;
    const [p] = [...this.pts.values()];
    this.mode = 'done';
    navigator.vibrate?.(12);
    const g = this.g, t = g.tool;
    g.pointAt(p.x, p.y);
    // build or move: the ghost and its placement check appear under the finger, nothing is placed
    if (t.kind === 'build' || (t.kind === 'move' && t.id !== null)) return;
    const b = g.view.buildingAt(p.x, p.y);
    if (b) {
      if (t.kind === 'select') g.select(b);
      g.hud.buildingTip(p.x, p.y - 80, b);
    }
  }

  /** long-press on any HUD element with a tooltip shows it (there is no hover on touch) */
  private bindUiLongPress() {
    const ui = document.getElementById('ui');
    if (!ui) return;
    let timer = 0;
    let start = { x: 0, y: 0 };
    let shown = false;
    ui.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.g.setTouchMode(true);
      this.g.hud.hideTip();
      shown = false;
      start = { x: e.clientX, y: e.clientY };
      const el = (e.target as HTMLElement).closest('[data-tip],[data-tipk]') as HTMLElement | null;
      clearTimeout(timer);
      if (!el) return;
      timer = window.setTimeout(() => {
        const html = el.dataset.tip ?? this.g.hud.dynTip(el.dataset.tipk!);
        if (html) { shown = true; navigator.vibrate?.(12); this.g.hud.tipAt(start.x, start.y - 120, html); }
      }, LONG_PRESS_MS);
    });
    ui.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch' && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) clearTimeout(timer); });
    ui.addEventListener('pointerup', () => clearTimeout(timer));
    ui.addEventListener('pointercancel', () => clearTimeout(timer));
    // a long-press that showed a tooltip must not also click the button
    ui.addEventListener('click', (e) => { if (shown) { e.stopPropagation(); e.preventDefault(); shown = false; } }, true);
    // no browser context menu on long-press
    window.addEventListener('contextmenu', (e) => { if (this.g.touchMode) e.preventDefault(); });
  }
}
