import * as THREE from 'three';
import { BUILDING } from '../sim/data/buildings';
import { ERAS } from '../sim/data/eras';
import type { GameState } from '../sim/state';
import { hq } from '../sim/state';
import type { Building } from '../sim/types';
import { DEPOSIT, idx, isWaterAdjacent } from '../sim/world';
import { BuildingLayer } from './buildings';
import { LinkLayer } from './links';
import { getModel } from './models';
import { Particles } from './particles';
import { FinaleFX } from './finale';
import { SceneRig } from './scene';
import { baseHeight, buildProps, buildTerrain, buildWater, PropLayer, tileHeight } from './terrain';

export type Overlay = 'none' | 'power' | 'heat' | 'network' | 'logistics' | 'service';

export class WorldView {
  terrain!: THREE.Mesh;
  water!: ReturnType<typeof buildWater>;
  props!: PropLayer;
  buildings: BuildingLayer;
  links: LinkLayer;
  particles = new Particles();
  overlay: Overlay = 'none';
  private ovTex!: THREE.DataTexture;
  private ovData!: Uint8Array;
  private ovUniforms = { uOverlay: { value: null as THREE.Texture | null }, uSize: { value: 128 }, uOvGlow: { value: 0.6 } };
  private ghost: THREE.Group | null = null;
  private ghostType = '';
  private ghostMat = new THREE.MeshBasicMaterial({ color: '#5dff9a', transparent: true, opacity: 0.45, depthWrite: false });
  private footMat = new THREE.MeshBasicMaterial({ color: '#5dff9a', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
  private foot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.footMat);
  private selRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#6fe9ff', transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
  private hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false }));
  private rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.0, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.6, toneMapped: false, depthWrite: false }));
  private emitT = 0;
  private ovDirtyT = 0;
  private lastOvKey = '';
  placingType: string | null = null;
  selected: Building | null = null;
  hovered: Building | null = null;
  frontierAnim = 1; // 0..1 grows on era change
  private frontierFrom = 0;
  private frontierTo = 0;
  shake = 0;
  finale = new FinaleFX();
  finaleT = 0;
  syncLevel = 0;

  private prevMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.85, depthWrite: false });
  private prev = (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 6); g.rotateZ(Math.PI / 2); const m = new THREE.InstancedMesh(g, this.prevMat, 400); m.count = 0; m.frustumCulled = false; m.renderOrder = 7; m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(1200), 3); return m; })();

  /** anchor point above a building (or a ghost footprint) for preview lines */
  anchor(x: number, y: number, size: number, lift = 0.8): THREE.Vector3 {
    return new THREE.Vector3(x + size / 2, baseHeight(this.s.world, x, y, size) + lift, y + size / 2);
  }
  /** dashed glowing preview lines (auto-link preview, link tool, power hookup) */
  setPreview(lines: { a: THREE.Vector3; b: THREE.Vector3; color: string }[]) {
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0), C = new THREE.Color();
    let n = 0;
    const t = performance.now() / 1000;
    for (const l of lines) {
      const len = l.a.distanceTo(l.b);
      const dashes = Math.max(2, Math.floor(len / 0.5));
      for (let k = 0; k < dashes && n < 400; k++) {
        const f0 = (k + ((t * 2) % 1)) / dashes, f1 = Math.min(1, f0 + 0.55 / dashes);
        if (f0 >= 1) continue;
        const p0 = new THREE.Vector3().lerpVectors(l.a, l.b, f0), p1 = new THREE.Vector3().lerpVectors(l.a, l.b, f1);
        p0.y += Math.sin(f0 * Math.PI) * len * 0.12; p1.y += Math.sin(f1 * Math.PI) * len * 0.12;
        const dir = p1.clone().sub(p0); const dl = dir.length();
        if (!(dl > 1e-4)) continue;
        Q.setFromUnitVectors(X, dir.normalize());
        M.compose(p0.add(p1).multiplyScalar(0.5), Q, S.set(dl, 0.06, 0.06));
        this.prev.setMatrixAt(n, M);
        this.prev.setColorAt(n, C.set(l.color).multiplyScalar(1.8));
        n++;
      }
    }
    this.prev.count = n;
    this.prev.instanceMatrix.needsUpdate = true;
    if (this.prev.instanceColor) this.prev.instanceColor.needsUpdate = true;
  }

  constructor(public rig: SceneRig, private s: GameState) {
    this.buildings = new BuildingLayer(s);
    this.links = new LinkLayer(s);
    this.rig.scene.add(this.prev, this.finale.group, this.buildings.group, this.links.group, this.particles.points, this.foot, this.selRing, this.hoverRing, this.rangeRing);
    this.foot.visible = false; this.selRing.visible = false; this.hoverRing.visible = false; this.rangeRing.visible = false;
    this.foot.renderOrder = 3; this.selRing.renderOrder = 4; this.hoverRing.renderOrder = 4; this.rangeRing.renderOrder = 4;
    this.buildWorld();
  }

  private buildWorld() {
    const s = this.s;
    if (this.terrain) { this.rig.scene.remove(this.terrain, this.water.mesh, this.props.group); this.terrain.geometry.dispose(); }
    this.terrain = buildTerrain(s.world);
    const S = s.world.size;
    this.ovData = new Uint8Array(S * S * 4);
    this.ovTex = new THREE.DataTexture(this.ovData, S, S, THREE.RGBAFormat);
    this.ovTex.magFilter = THREE.NearestFilter; this.ovTex.minFilter = THREE.NearestFilter;
    this.ovUniforms.uOverlay.value = this.ovTex;
    this.ovUniforms.uSize.value = S;
    const mat = this.terrain.material as THREE.MeshStandardMaterial;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.ovUniforms);
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = 'uniform sampler2D uOverlay; uniform float uSize; uniform float uOvGlow; varying vec3 vWPos;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n vec4 ov = texture2D(uOverlay, (floor(vWPos.xz - vec2(0.001)) + 0.5) / uSize);\n diffuseColor.rgb = mix(diffuseColor.rgb, ov.rgb, ov.a);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += ov.rgb * ov.a * uOvGlow * mod(floor(ov.a * 255.0 + 0.5), 2.0);');
    };
    this.water = buildWater(s.world);
    this.props = buildProps(s.world);
    this.rig.scene.add(this.terrain, this.water.mesh, this.props.group);
    for (const b of s.buildings) this.clearProps(b);
    this.frontierFrom = this.frontierTo = ERAS[Math.min(4, s.era - 1)].radius;
    this.refreshOverlay(true);
  }

  setState(s: GameState) {
    this.s = s;
    this.buildings.setState(s);
    this.links.setState(s);
    this.selected = null;
    this.buildWorld();
  }

  clearProps(b: Building) {
    const d = BUILDING[b.type];
    for (let y = b.y; y < b.y + d.size; y++) for (let x = b.x; x < b.x + d.size; x++) this.props.clear(x, y);
  }
  restoreProps(b: { x: number; y: number; type: string }) {
    const d = BUILDING[b.type];
    for (let y = b.y; y < b.y + d.size; y++) for (let x = b.x; x < b.x + d.size; x++) this.props.restore(x, y);
  }

  frontierRadius(): number {
    const s = this.s;
    if (s.mode === 'sandbox') return 64;
    const k = Math.min(1, this.frontierAnim);
    const e = 1 - Math.pow(1 - k, 3);
    return this.frontierFrom + (this.frontierTo - this.frontierFrom) * e;
  }
  expandFrontier() {
    this.frontierFrom = this.frontierRadius();
    this.frontierTo = ERAS[Math.min(4, this.s.era - 1)].radius;
    this.frontierAnim = 0;
  }

  /** tile under screen pixel via ray-march against terraced heights */
  tileAt(px: number, py: number): [number, number] | null {
    const ray = this.rig.raycaster(px, py).ray;
    const w = this.s.world;
    // start where ray hits y = 5, march toward y = -1
    const t0 = (5 - ray.origin.y) / ray.direction.y;
    const t1 = (-1 - ray.origin.y) / ray.direction.y;
    const p = new THREE.Vector3();
    for (let t = t0; t <= t1; t += 0.08) {
      p.copy(ray.origin).addScaledVector(ray.direction, t);
      const x = Math.floor(p.x), z = Math.floor(p.z);
      if (x < 0 || z < 0 || x >= w.size || z >= w.size) continue;
      const h = Math.max(tileHeight(w, x, z), -0.12);
      if (p.y <= h) return [x, z];
    }
    return null;
  }

  /** building under cursor: prefer occupancy of hit tile, also check tall models by projecting */
  buildingAt(px: number, py: number): Building | null {
    const t = this.tileAt(px, py);
    const s = this.s;
    if (t) {
      const id = s.occ[idx(s.world, t[0], t[1])];
      if (id) return s.byId.get(id) ?? null;
    }
    // tall silhouettes: test screen-space proximity to each building's upper body
    let best: Building | null = null, bd = 28;
    for (const b of s.buildings) {
      const d = BUILDING[b.type];
      const h = baseHeight(s.world, b.x, b.y, d.size);
      const top = this.rig.worldToScreen(new THREE.Vector3(b.x + d.size / 2, h + getModel(b.type).height * 0.6, b.y + d.size / 2));
      const dd = Math.hypot(top.x - px, top.y - py);
      if (dd < bd) { bd = dd; best = b; }
    }
    return best;
  }

  setGhost(type: string | null, x = 0, y = 0, ok = true, unpowered = false) {
    if (!type) {
      if (this.ghost) this.ghost.visible = false;
      this.foot.visible = false;
      this.rangeRing.visible = false;
      return;
    }
    if (type !== this.ghostType) {
      if (this.ghost) this.rig.scene.remove(this.ghost);
      const m = getModel(type);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(m.body, this.ghostMat));
      if (m.glow) g.add(new THREE.Mesh(m.glow, this.ghostMat));
      if (m.spin) { const sp = new THREE.Mesh(m.spin.geo, this.ghostMat); sp.position.copy(m.spin.pivot); g.add(sp); }
      g.renderOrder = 6;
      this.ghost = g;
      this.ghostType = type;
      this.rig.scene.add(g);
    }
    const d = BUILDING[type];
    const h = baseHeight(this.s.world, x, y, d.size);
    this.ghost!.visible = true;
    this.ghost!.position.set(x + d.size / 2, Math.max(h, 0), y + d.size / 2);
    const col = !ok ? '#ff4a4a' : unpowered ? '#ffb347' : '#5dff9a';
    this.ghostMat.color.set(col);
    this.footMat.color.set(col);
    this.foot.visible = true;
    this.foot.scale.set(d.size, 1, d.size);
    this.foot.position.set(x + d.size / 2, Math.max(h, 0) + 0.03, y + d.size / 2);
    // power range preview
    const r = d.node?.radius ?? d.hub ?? 0;
    if (r > 0) {
      this.rangeRing.visible = true;
      this.rangeRing.scale.set(r, 1, r);
      this.rangeRing.position.set(x + d.size / 2, Math.max(h, 0) + 0.06, y + d.size / 2);
      (this.rangeRing.material as THREE.MeshBasicMaterial).color.set(d.hub ? '#ffe066' : '#ffd84a');
    } else this.rangeRing.visible = false;
  }

  private ring(mesh: THREE.Mesh, b: Building | null, pad = 0.35) {
    if (!b) { mesh.visible = false; return; }
    const d = BUILDING[b.type];
    const h = baseHeight(this.s.world, b.x, b.y, d.size);
    mesh.visible = true;
    const r = d.size * 0.72 + pad;
    mesh.scale.set(r, 1, r);
    mesh.position.set(b.x + d.size / 2, h + 0.06, b.y + d.size / 2);
  }

  /** recompute overlay texture */
  refreshOverlay(force = false) {
    const s = this.s, w = s.world, S = w.size, D = this.ovData;
    const key = this.overlay + '|' + (this.placingType ?? '') + '|' + Math.round(this.frontierRadius() * 4);
    if (!force && key === this.lastOvKey && this.overlay === 'none' && !this.placingType) return;
    this.lastOvKey = key;
    const h = hq(s);
    const hx = h.x + 1.5, hy = h.y + 1.5;
    const R = this.frontierRadius();
    const pd = this.placingType ? BUILDING[this.placingType] : null;
    // coverage map for power overlay / placement of consumers
    let cover: Int16Array | null = null;
    if (this.overlay === 'power' || (pd && (pd.power < 0 || pd.node))) {
      cover = new Int16Array(S * S).fill(-1);
      for (const n of s.buildings) {
        const dn = BUILDING[n.type];
        if (!dn.node) continue;
        const cx = n.x + dn.size / 2, cy = n.y + dn.size / 2, r = dn.node.radius;
        for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if (x < 0 || y < 0 || x >= S || y >= S) continue;
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r + 0.5) cover[y * S + x] = n.grid;
        }
      }
    }
    // service coverage (U overlay, or placing a Service Center / Robot Hub): covered tiles, and worn buildings outside it
    let svc: Uint8Array | null = null;
    if (this.overlay === 'service' || (pd && (pd.service || pd.hub))) {
      svc = new Uint8Array(S * S);
      for (const c of s.buildings) {
        const dc = BUILDING[c.type];
        const r = dc.service ?? (dc.hub && (c.inBuf.robots ?? 0) > 0 ? dc.hub : 0);
        if (!r || c.broken > 0) continue;
        const cx = c.x + dc.size / 2, cy = c.y + dc.size / 2;
        for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if (x < 0 || y < 0 || x >= S || y >= S) continue;
          const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (dd <= r + 0.5) svc[y * S + x] = Math.max(svc[y * S + x], dd > r - 0.6 ? 2 : 1);
        }
      }
      if (this.overlay === 'service') for (const b of s.buildings) {
        if (b.serviced || b.wear < 0.5) continue;
        const db = BUILDING[b.type];
        for (let y = b.y; y < b.y + db.size; y++) for (let x = b.x; x < b.x + db.size; x++) svc[y * S + x] = b.wear >= 0.8 ? 4 : 3;
      }
    }
    const heatMap = this.overlay === 'heat' ? new Float32Array(S * S) : null;
    if (heatMap) for (const b of s.buildings) {
      const d = BUILDING[b.type];
      if (!d.it) continue;
      const cx = b.x + d.size / 2, cy = b.y + d.size / 2, r = d.size + 1.5;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        const f = Math.max(0, 1 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r);
        heatMap[y * S + x] = Math.max(heatMap[y * S + x], b.heat * f * 1.2);
      }
    }
    // alpha parity encodes a glow flag (odd = emissive)
    const A = (a: number, glow: boolean) => {
      let v = Math.max(2, Math.min(254, Math.round(a * 255)));
      if ((v % 2 === 1) !== glow) v += 1;
      return v;
    };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, o = i * 4;
      let r = 0, g = 0, b = 0, a = 0, glow = false;
      const dist = Math.hypot(x + 0.5 - hx, y + 0.5 - hy);
      if (dist > R) { r = 10; g = 14; b = 30; a = 0.42; }
      else if (dist > R - 0.9 && s.mode !== 'sandbox') { r = 110; g = 233; b = 255; a = 0.32; glow = true; }
      if (dist <= R) {
        if (this.overlay === 'power' && cover) {
          const gi = cover[i];
          if (gi >= 0) {
            const sat = s.grids[gi]?.sat ?? 1;
            if (sat > 0.98) { r = 255; g = 220; b = 60; } else if (sat > 0.6) { r = 255; g = 130; b = 20; } else { r = 255; g = 40; b = 40; }
            a = 0.58; glow = true;
          }
        } else if (heatMap) {
          const hv = Math.min(1.5, heatMap[i]);
          if (hv > 0.02) {
            const t = hv / 1.5;
            r = Math.round(60 + 195 * t); g = Math.round(150 * (1 - t) + 40); b = Math.round(255 * (1 - t));
            a = 0.25 + 0.35 * t; glow = hv > 0.9;
          } else { r = 20; g = 40; b = 80; a = 0.15; }
        } else if (this.overlay === 'network' || this.overlay === 'logistics') {
          r = 8; g = 12; b = 28; a = 0.38;
        } else if (this.overlay === 'service' && svc) {
          const v = svc[i];
          if (v === 4) { r = 255; g = 60; b = 60; a = 0.6; glow = true; }
          else if (v === 3) { r = 255; g = 170; b = 50; a = 0.55; glow = true; }
          else if (v === 2) { r = 47; g = 214; b = 192; a = 0.55; glow = true; }
          else if (v === 1) { r = 47; g = 214; b = 192; a = 0.25; }
          else { r = 10; g = 16; b = 30; a = 0.3; }
        }
        if (pd) {
          const dep = w.deposit[i];
          if (pd.deposit && dep === pd.deposit) {
            const c = dep === DEPOSIT.QUARTZ ? [140, 245, 255] : dep === DEPOSIT.ORE ? [255, 150, 70] : [190, 140, 255];
            r = c[0]; g = c[1]; b = c[2]; a = 0.55; glow = true;
          } else if (pd.needsWater && w.level[i] > 0 && isWaterAdjacent(w, x, y, 1)) {
            r = 80; g = 180; b = 255; a = 0.5; glow = true;
          } else if (svc && (pd.service || pd.hub) && svc[i] > 0) {
            r = 47; g = 214; b = 192; a = svc[i] === 2 ? 0.45 : 0.18; glow = svc[i] === 2;
          } else if (cover && (pd.power < 0) && !pd.deposit && !pd.needsWater) {
            if (cover[i] >= 0) { r = 255; g = 216; b = 74; a = 0.18; glow = false; }
          }
        }
      }
      D[o] = r; D[o + 1] = g; D[o + 2] = b; D[o + 3] = a > 0 ? A(a, glow) : 0;
    }
    this.ovTex.needsUpdate = true;
  }

  handleSignal(kind: string, x?: number, y?: number, data?: unknown) {
    const s = this.s;
    if (kind === 'build' && x !== undefined && y !== undefined) {
      const type = data as string;
      const d = BUILDING[type];
      const h = tileHeight(s.world, x, y);
      const b = s.buildings.find((b) => b.x === x && b.y === y);
      if (b) this.clearProps(b);
      this.particles.emit('dust', x + d.size / 2, h + 0.15, y + d.size / 2, 14 + d.size * 8, d.size * 0.8);
      if (d.size >= 3) this.shake = Math.max(this.shake, 0.25 + d.size * 0.05);
      this.lastOvKey = '';
    }
    if (kind === 'demolish' && x !== undefined && y !== undefined) {
      const h = tileHeight(s.world, x, y);
      this.restoreProps({ x, y, type: data as string });
      this.particles.emit('dust', x + 1, h + 0.2, y + 1, 24, 1.4);
      this.lastOvKey = '';
    }
    if (kind === 'move' && x !== undefined && y !== undefined) {
      const info = data as { id: number; type: string };
      this.restoreProps({ x, y, type: info.type });
      const b = s.byId.get(info.id);
      if (b) { this.clearProps(b); this.buildings.refresh(b.id); const d = BUILDING[b.type]; this.particles.emit('dust', b.x + d.size / 2, baseHeight(s.world, b.x, b.y, d.size) + 0.2, b.y + d.size / 2, 20, d.size); }
      this.links.markDirty();
      this.lastOvKey = '';
    }
    if ((kind === 'break' || kind === 'repair') && x !== undefined && y !== undefined) {
      const h = tileHeight(s.world, x, y);
      this.particles.emit(kind === 'break' ? 'spark' : 'burst', x + 1, h + 1, y + 1, 30, 1);
    }
  }

  update(now: number, dt: number) {
    const s = this.s, rig = this.rig;
    if (this.frontierAnim < 1) { this.frontierAnim = Math.min(1, this.frontierAnim + dt / 2.5); this.lastOvKey = ''; }
    this.ovDirtyT -= dt;
    if (this.ovDirtyT <= 0 || this.lastOvKey === '') { this.refreshOverlay(this.overlay !== 'none' || this.lastOvKey === ''); this.ovDirtyT = 0.5; }
    this.ovUniforms.uOvGlow.value = 0.25 + rig.night * 0.9;
    this.water.uniforms.uTime.value = now;
    const moon = rig.night > 0.55;
    this.water.uniforms.uSunDir.value.copy(moon ? new THREE.Vector3(-0.45, 0.8, -0.35).normalize() : rig.sunDir);
    this.water.uniforms.uSunCol.value.copy(moon ? new THREE.Color(0.45, 0.55, 0.85) : rig.sunColor);
    this.water.uniforms.uNight.value = rig.night;
    for (const m of this.props.depositGlow) {
      const mm = m as THREE.MeshStandardMaterial;
      const ore = m === this.props.depositGlow[1];
      mm.emissiveIntensity = (ore ? 0.05 : 0.2) + rig.night * (ore ? 0.12 : 0.55);
    }
    const eng = s.buildings.find((b) => b.type === 'engine');
    if (eng) this.finale.place(eng.x + 2, baseHeight(s.world, eng.x, eng.y, 4) + 6.5, eng.y + 2);
    this.finale.update(now, dt, eng ? this.finaleT : 0, eng ? s.engine.progress : 0);
    if (eng && this.finaleT > 0 && Math.random() < dt * 30) this.particles.emit('burst', eng.x + 2, baseHeight(s.world, eng.x, eng.y, 4) + 6.5, eng.y + 2, 3, 0.6);
    this.buildings.update(now, dt, rig.glowLevel, rig.night, this.finale.wave);
    this.syncLevel += ((s.stats.trainRate > 40 ? Math.min(1, s.stats.trainRate / 200) : 0) - this.syncLevel) * Math.min(1, dt * 2);
    this.links.update(now, dt, rig.glowLevel, rig.night, this.syncLevel);
    // selection/hover rings
    this.ring(this.selRing, this.selected && s.byId.has(this.selected.id) ? this.selected : null);
    this.ring(this.hoverRing, this.hovered && this.hovered !== this.selected && !this.placingType ? this.hovered : null, 0.2);
    (this.selRing.material as THREE.MeshBasicMaterial).opacity = 0.65 + 0.3 * Math.sin(now * 4);
    // emitters
    this.emitT += dt;
    if (this.emitT > 0.12) {
      const step = this.emitT;
      this.emitT = 0;
      const cam = rig.target;
      const viewR = rig.view * 2.2;
      for (const b of s.buildings) {
        if (Math.abs(b.x - cam.x) > viewR || Math.abs(b.y - cam.z) > viewR) continue;
        const m = getModel(b.type);
        if (!m.emitters.length) continue;
        const d = BUILDING[b.type];
        const h = baseHeight(s.world, b.x, b.y, d.size);
        for (const e of m.emitters) {
          const wx = b.x + d.size / 2 + e.x, wy = h + e.y, wz = b.y + d.size / 2 + e.z;
          if (e.kind === 'heat') { if (b.heat > 0.95 && Math.random() < step * 6) this.particles.emit('heat', wx, wy, wz, 1, d.size * 0.5); continue; }
          if (b.activity < 0.3) continue;
          const rate = e.kind === 'steam' ? 5 : e.kind === 'smoke' ? 3 : 4;
          if (Math.random() < step * rate * b.activity) this.particles.emit(e.kind === 'spark' ? 'spark' : e.kind, wx, wy, wz, e.kind === 'spark' ? 2 : 1, 0.15);
        }
      }
    }
    const pxPerUnit = window.innerHeight / (2 * rig.view);
    this.particles.setScale(pxPerUnit, rig.renderer.getPixelRatio());
    this.particles.update(dt, rig.night);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 1.5);
  }
}
