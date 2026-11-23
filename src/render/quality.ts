import * as THREE from 'three';
import type { SceneRig } from './scene';
import type { WorldView } from './world';

/**
 * Graphics quality profiles and frame pacing.
 * Quality: everything on, for a desktop GPU. Performance: keeps a tablet cool
 * (lower resolution, 2× MSAA, small hard shadows, half-res bloom, fewer particles,
 * a frame cap and a slow idle rate when nothing moves).
 */
export type Profile = 'performance' | 'quality';
export type ProfileChoice = 'auto' | Profile;

export interface ProfileSpec {
  label: string;
  /** cap on devicePixelRatio */
  maxDpr: number;
  /** MSAA samples in the composer target (clamped to the GPU maximum) */
  msaa: number;
  shadows: boolean;
  shadowMap: number;
  softShadows: boolean;
  /** bloom resolution relative to CSS pixels */
  bloomScale: number;
  /** share of particles emitted */
  particleDensity: number;
  /** trees cast shadows */
  propShadows: boolean;
  /** default frame cap while the game runs (0 = no cap) */
  fps: number;
  /** cap while the player touches, drags or the camera moves (0 = same as fps) */
  activeFps: number;
  /** cap when paused or in a menu and nothing moves (0 = no idle slow-down) */
  idleFps: number;
}

export const PROFILES: Record<Profile, ProfileSpec> = {
  quality: { label: 'Quality', maxDpr: 2, msaa: 8, shadows: true, shadowMap: 4096, softShadows: true, bloomScale: 1, particleDensity: 1, propShadows: true, fps: 0, activeFps: 0, idleFps: 0 },
  performance: { label: 'Performance', maxDpr: 1.25, msaa: 2, shadows: true, shadowMap: 1024, softShadows: false, bloomScale: 0.5, particleDensity: 0.5, propShadows: false, fps: 30, activeFps: 60, idleFps: 10 },
};

export interface GfxSettings {
  profile: ProfileChoice;
  /** null = profile default; 0 = no limit */
  fpsCap: number | null;
}

const KEY = 'sd_gfx_v1';

export function loadGfx(): GfxSettings {
  const def: GfxSettings = { profile: 'auto', fpsCap: null };
  try { return { ...def, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return def; }
}
export function saveGfx(g: GfxSettings) { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* ignore */ } }

export interface PointerEnv { coarse: boolean; anyFine: boolean; maxTouchPoints: number }

/** Auto choice: a touch-first device (coarse primary pointer, or touch without any mouse) gets Performance. */
export function autoProfile(env: PointerEnv): Profile {
  return env.coarse || (env.maxTouchPoints > 0 && !env.anyFine) ? 'performance' : 'quality';
}

export function resolveProfile(choice: ProfileChoice, env: PointerEnv): Profile {
  return choice === 'auto' ? autoProfile(env) : choice;
}

export function pointerEnv(): PointerEnv {
  const mm = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  return { coarse: mm('(pointer: coarse)'), anyFine: mm('(any-pointer: fine)'), maxTouchPoints: typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0 };
}

export interface PaceState { hidden: boolean; active: boolean; idle: boolean }

/**
 * Target frame rate for the current moment (0 = every display refresh, -1 = do not render).
 * An explicit cap from the settings always wins over the profile's active and idle rates,
 * except that idle may still slow down below it.
 */
export function targetFps(spec: ProfileSpec, fpsCap: number | null, st: PaceState): number {
  if (st.hidden) return -1;
  let fps = fpsCap ?? (st.active && spec.activeFps ? spec.activeFps : spec.fps);
  if (st.idle && spec.idleFps && !st.active) fps = fps === 0 ? spec.idleFps : Math.min(fps, spec.idleFps);
  return fps;
}

/** true when a frame at `now` should render, given the last rendered frame time. 1.5 ms slack absorbs rAF jitter. */
export function frameDue(now: number, last: number, fps: number): boolean {
  if (fps < 0) return false;
  if (fps === 0) return true;
  return now - last >= 1000 / fps - 1.5;
}

/** Applies a profile to the renderer and decides which animation frames render. */
export class QualityManager {
  gfx = loadGfx();
  profile: Profile = 'quality';
  spec: ProfileSpec = PROFILES.quality;
  private lastFrame = -1e9;
  private lastInput = -1e9;
  private camSig = '';
  private propsGroup: THREE.Object3D | null = null;

  constructor(private rig: SceneRig, private view: () => WorldView, private simRunning: () => boolean) {
    const poke = () => { this.lastInput = performance.now(); };
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) window.addEventListener(ev, poke, { passive: true, capture: true });
    window.addEventListener('resize', () => this.apply());
    this.apply();
  }

  setChoice(choice: ProfileChoice) { this.gfx.profile = choice; this.gfx.fpsCap = null; saveGfx(this.gfx); this.apply(); }
  setFpsCap(cap: number | null) { this.gfx.fpsCap = cap; saveGfx(this.gfx); }
  effectiveFps(): number { return this.gfx.fpsCap ?? this.spec.fps; }

  apply() {
    this.profile = resolveProfile(this.gfx.profile, pointerEnv());
    const p = this.spec = PROFILES[this.profile];
    const rig = this.rig, r = rig.renderer;
    const dpr = Math.min(window.devicePixelRatio || 1, p.maxDpr);
    r.setPixelRatio(dpr);
    rig.composer.setPixelRatio(dpr);
    const samples = Math.min(p.msaa, r.capabilities.maxSamples ?? 4);
    for (const rt of [rig.composer.renderTarget1, rig.composer.renderTarget2]) {
      if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
    }
    const type = p.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const recompile = r.shadowMap.enabled !== p.shadows || r.shadowMap.type !== type;
    r.shadowMap.enabled = p.shadows;
    r.shadowMap.type = type;
    rig.sun.castShadow = p.shadows;
    if (rig.sun.shadow.mapSize.x !== p.shadowMap) {
      rig.sun.shadow.mapSize.set(p.shadowMap, p.shadowMap);
      rig.sun.shadow.map?.dispose();
      (rig.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    r.shadowMap.needsUpdate = true;
    if (recompile) rig.scene.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true; });
    rig.bloomScale = p.bloomScale;
    rig.resize();
    this.view().particles.density = p.particleDensity;
    this.propsGroup = null; // re-apply prop shadows on the next frame
  }

  /** called once per animation frame; false = skip this frame entirely */
  shouldRender(now: number): boolean {
    const v = this.view();
    if (v.props && v.props.group !== this.propsGroup) {
      this.propsGroup = v.props.group;
      this.propsGroup.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh && o.userData.tree) o.castShadow = this.spec.propShadows; });
    }
    const t = this.rig.target;
    const sig = `${t.x.toFixed(3)},${t.z.toFixed(3)},${this.rig.view.toFixed(3)},${this.rig.yaw.toFixed(4)}`;
    if (sig !== this.camSig) { this.camSig = sig; this.lastInput = Math.max(this.lastInput, now - 600); }
    const active = now - this.lastInput < 1000;
    const idle = !this.simRunning() && now - this.lastInput > 2000;
    const fps = targetFps(this.spec, this.gfx.fpsCap, { hidden: typeof document !== 'undefined' && document.hidden, active, idle });
    if (!frameDue(now, this.lastFrame, fps)) return false;
    this.lastFrame = now;
    return true;
  }
}
