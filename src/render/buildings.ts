import * as THREE from 'three';
import { BUILDING } from '../sim/data/buildings';
import type { GameState } from '../sim/state';
import type { Building } from '../sim/types';
import { getModel } from './models';
import { tileHeight } from './terrain';

interface TypeSlot {
  body: THREE.InstancedMesh;
  glow?: THREE.InstancedMesh;
  spin?: THREE.InstancedMesh;
  ids: number[];
}

const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const MAX_PER_TYPE: Record<string, number> = { solar: 600, pole: 600, rack: 800, wind: 400, battery: 300, pod: 400 };

export class BuildingLayer {
  group = new THREE.Group();
  bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.18, flatShading: true });
  glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private types = new Map<string, TypeSlot>();
  private slot = new Map<number, { type: string; i: number }>();
  private born = new Map<number, number>(); // id → time of pop-in start
  private angle = new Map<number, number>();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private known = new Set<number>();
  private syncSig = -1;
  /** body tint callback (overlays/selection) */
  tint: ((b: Building) => THREE.Color | null) | null = null;
  reducedMotion = false;

  constructor(private s: GameState) {
    this.group.name = 'buildings';
  }

  setState(s: GameState) {
    for (const t of this.types.values()) {
      this.group.remove(t.body); t.body.dispose();
      if (t.glow) { this.group.remove(t.glow); t.glow.dispose(); }
      if (t.spin) { this.group.remove(t.spin); t.spin.dispose(); }
    }
    this.types.clear(); this.slot.clear(); this.known.clear(); this.born.clear(); this.angle.clear();
    this.s = s;
  }

  private ensureType(type: string): TypeSlot {
    let t = this.types.get(type);
    if (t) return t;
    const m = getModel(type);
    const max = MAX_PER_TYPE[type] ?? 250;
    const body = new THREE.InstancedMesh(m.body, this.bodyMat, max);
    body.castShadow = true; body.receiveShadow = true; body.count = 0;
    body.frustumCulled = false;
    body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
    this.group.add(body);
    t = { body, ids: [] };
    if (m.glow) {
      const glow = new THREE.InstancedMesh(m.glow, this.glowMat, max);
      glow.count = 0; glow.frustumCulled = false;
      glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
      this.group.add(glow);
      t.glow = glow;
    }
    if (m.spin) {
      const spin = new THREE.InstancedMesh(m.spin.geo, this.bodyMat, max);
      spin.castShadow = true; spin.count = 0; spin.frustumCulled = false;
      this.group.add(spin);
      t.spin = spin;
    }
    this.types.set(type, t);
    return t;
  }

  private add(b: Building, now: number, animate: boolean) {
    const t = this.ensureType(b.type);
    const i = t.ids.length;
    t.ids.push(b.id);
    t.body.count = t.ids.length;
    if (t.glow) t.glow.count = t.ids.length;
    if (t.spin) t.spin.count = t.ids.length;
    this.slot.set(b.id, { type: b.type, i });
    if (animate && !this.reducedMotion) this.born.set(b.id, now);
    this.writeMatrix(b, t, i, 1);
  }

  private remove(id: number) {
    const sl = this.slot.get(id);
    if (!sl) return;
    const t = this.types.get(sl.type)!;
    const last = t.ids.length - 1;
    if (sl.i !== last) {
      // move last into the hole
      const lastId = t.ids[last];
      t.ids[sl.i] = lastId;
      for (const mesh of [t.body, t.glow, t.spin]) {
        if (!mesh) continue;
        mesh.getMatrixAt(last, this.tmpM);
        mesh.setMatrixAt(sl.i, this.tmpM);
        if (mesh.instanceColor) {
          mesh.getColorAt(last, this.tmpC);
          mesh.setColorAt(sl.i, this.tmpC);
        }
      }
      this.slot.set(lastId, { type: sl.type, i: sl.i });
    }
    t.ids.pop();
    t.body.count = t.ids.length;
    if (t.glow) t.glow.count = t.ids.length;
    if (t.spin) t.spin.count = t.ids.length;
    t.body.instanceMatrix.needsUpdate = true;
    this.slot.delete(id);
    this.born.delete(id);
  }

  private writeMatrix(b: Building, t: TypeSlot, i: number, scale: number) {
    const d = BUILDING[b.type];
    const h = tileHeight(this.s.world, b.x, b.y);
    this.tmpV.set(b.x + d.size / 2, h, b.y + d.size / 2);
    this.tmpQ.identity();
    const sy = scale, sxz = scale < 1 ? 0.6 + 0.4 * scale : scale;
    this.tmpS.set(sxz, sy, sxz);
    this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
    t.body.setMatrixAt(i, this.tmpM);
    t.glow?.setMatrixAt(i, this.tmpM);
    t.body.instanceMatrix.needsUpdate = true;
    if (t.glow) t.glow.instanceMatrix.needsUpdate = true;
  }

  /** sync with sim state & animate. now = seconds (real time) */
  update(now: number, dt: number, glowLevel: number, night = 0, wave: { x: number; z: number; r: number } | null = null) {
    const s = this.s;
    // sync add/remove
    if (s.buildings.length !== this.slot.size || this.syncSig !== s.nextId) {
      const live = new Set<number>();
      for (const b of s.buildings) {
        live.add(b.id);
        if (!this.slot.has(b.id)) this.add(b, now, this.known.size > 0);
      }
      for (const id of [...this.slot.keys()]) if (!live.has(id)) this.remove(id);
      this.known = live;
      this.syncSig = s.nextId;
    }
    this.glowMat.color.setScalar(glowLevel);

    const pulse = 0.5 + 0.5 * Math.sin(now * 6);
    for (const [type, t] of this.types) {
      const m = getModel(type);
      for (let i = 0; i < t.ids.length; i++) {
        const b = s.byId.get(t.ids[i]);
        if (!b) continue;
        // pop-in
        const b0 = this.born.get(b.id);
        if (b0 !== undefined) {
          const k = Math.min(1, (now - b0) / 0.5);
          const e = k === 1 ? 1 : 1 + Math.sin(k * Math.PI * 1.2) * (1 - k) * 0.35 - (1 - k) * (1 - k) * 0.9;
          this.writeMatrix(b, t, i, Math.max(0.02, e));
          if (k >= 1) { this.born.delete(b.id); this.writeMatrix(b, t, i, 1); }
        }
        // glow colour by status
        if (t.glow) {
          let r = 1, g = 1, bl = 1;
          const act = b.activity;
          const d = BUILDING[b.type];
          let lvl = d.gen || d.storage || d.node && !d.inputs && !d.outputs ? 1 : 0.25 + 0.75 * Math.min(1, act);
          switch (b.status) {
            case 'broken': r = 1.6; g = 0.15; bl = 0.1; lvl = 0.3 + pulse * 0.9; break;
            case 'no_power': lvl = 0.06; break;
            case 'low_power': lvl *= 0.55 + 0.25 * pulse; break;
            case 'overheat': r = 1.4; g = 0.45; bl = 0.3; break;
            case 'night': lvl = 0.15; break;
            case 'discharging': r = 1.1; g = 0.9; bl = 0.4; break;
          }
          if (b.type === 'battery' || b.type === 'gridbat') lvl = 0.25 + 0.75 * Math.min(1, b.charge / ((d.battery?.capacity ?? 1) * s.fx.batteryMul));
          if (b.type === 'engine') lvl = 0.6 + 1.6 * s.engine.progress + (s.engine.ignited ? 2 : 0);
          // dusk: lights switch on in a staggered wave across the base (with a short flicker)
          const th = 0.22 + ((b.id * 0.61803) % 1) * 0.42;
          const on = Math.min(1, Math.max(0, (night - th) / 0.06));
          let lights = 0.62 + 0.55 * on;
          if (on > 0 && on < 1 && !this.reducedMotion) lights *= Math.sin(now * 37 + b.id) > 0 ? 1 : 0.55;
          lvl *= lights;
          if (wave && wave.r > 0) {
            const dd = Math.hypot(b.x + d.size / 2 - wave.x, b.y + d.size / 2 - wave.z);
            const band = Math.max(0, 1 - Math.abs(dd - wave.r) / 5);
            if (band > 0) { lvl += band * 4; r += band * 0.3; }
          }
          this.tmpC.setRGB(r * lvl, g * lvl, bl * lvl);
          t.glow.setColorAt(i, this.tmpC);
        }
        // body tint
        const tc = this.tint?.(b);
        if (tc) t.body.setColorAt(i, tc); else t.body.setColorAt(i, this.tmpC.setRGB(1, 1, 1));
        // spin
        if (t.spin && m.spin) {
          const d = BUILDING[b.type];
          let a = this.angle.get(b.id) ?? (b.id * 1.7) % 6.28;
          const speedF = b.status === 'broken' || b.status === 'no_power' ? 0 : d.gen === 'wind' ? Math.max(0.15, b.activity) : Math.min(1, b.activity + 0.05);
          if (!this.reducedMotion) a += dt * m.spin.speed * speedF;
          this.angle.set(b.id, a);
          const h = tileHeight(s.world, b.x, b.y);
          const sc = b0 !== undefined ? Math.min(1, (now - b0) / 0.5) : 1;
          this.tmpV.set(b.x + d.size / 2 + m.spin.pivot.x, h + m.spin.pivot.y * sc, b.y + d.size / 2 + m.spin.pivot.z);
          const axis = m.spin.axis === 'x' ? AX : m.spin.axis === 'y' ? AY : AZ;
          this.tmpQ.setFromAxisAngle(axis, a);
          this.tmpS.setScalar(Math.max(0.02, sc));
          this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
          t.spin.setMatrixAt(i, this.tmpM);
        }
      }
      if (t.glow?.instanceColor) t.glow.instanceColor.needsUpdate = true;
      if (t.body.instanceColor) t.body.instanceColor.needsUpdate = true;
      if (t.spin) t.spin.instanceMatrix.needsUpdate = true;
    }
  }

  modelHeight(type: string) { return getModel(type).height; }
}
