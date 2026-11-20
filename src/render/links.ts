import * as THREE from 'three';
import { BUILDING } from '../sim/data/buildings';
import { ITEMS, LINKS } from '../sim/data/items';
import type { GameState } from '../sim/state';
import type { Link } from '../sim/types';
import { baseHeight, tileHeight } from './terrain';

const MAX_SEG = 4000;
const MAX_PACKETS = 9000;
const MAX_POSTS = 3000;

interface LinkVis {
  id: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  arc: number;
  len: number;
  packets: number[];
  acc: number;
  lastTotal: number;
  kind: Link['kind'];
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const SPINQ = new THREE.Quaternion();
const SHAPES = ['diamond', 'cube', 'square', 'octa', 'tetra', 'sphere', 'streak'] as const;

export class LinkLayer {
  group = new THREE.Group();
  private vis = new Map<number, LinkVis>();
  private belt: THREE.InstancedMesh;
  private beltGlow: THREE.InstancedMesh;
  private pipe: THREE.InstancedMesh;
  private data: THREE.InstancedMesh;
  private posts: THREE.InstancedMesh;
  private packets: Record<string, THREE.InstancedMesh> = {};
  private wires: THREE.InstancedMesh;
  private wireEdges: unknown = null;
  private glowMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  private wireMat = new THREE.MeshBasicMaterial({ color: '#2a2a2a', toneMapped: false });
  private M = new THREE.Matrix4();
  private Q = new THREE.Quaternion();
  private V = new THREE.Vector3();
  private S = new THREE.Vector3();
  private C = new THREE.Color();
  private C2 = new THREE.Color();
  private dirty = true;
  highlight: Set<number> | null = null;
  focusKinds: Set<string> | null = null; // overlay filter
  showStates = false; // logistics overlay
  reducedMotion = false;
  private linkSig = '';

  constructor(private s: GameState) {
    const std = new THREE.MeshStandardMaterial({ color: '#4a4f5c', roughness: 0.55, metalness: 0.4 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.belt = new THREE.InstancedMesh(box, std, MAX_SEG);
    this.belt.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SEG * 3).fill(1), 3);
    this.belt.castShadow = true; this.belt.frustumCulled = false;
    this.beltGlow = new THREE.InstancedMesh(box, this.glowMat, MAX_SEG);
    this.beltGlow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SEG * 3), 3);
    this.beltGlow.frustumCulled = false;
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
    cyl.rotateZ(Math.PI / 2);
    this.pipe = new THREE.InstancedMesh(cyl, new THREE.MeshStandardMaterial({ color: '#7fa6c9', roughness: 0.35, metalness: 0.6 }), MAX_SEG);
    this.pipe.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SEG * 3).fill(1), 3);
    this.pipe.castShadow = true; this.pipe.frustumCulled = false;
    const cyl2 = new THREE.CylinderGeometry(1, 1, 1, 5);
    cyl2.rotateZ(Math.PI / 2);
    this.data = new THREE.InstancedMesh(cyl2, this.glowMat, MAX_SEG);
    this.data.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SEG * 3), 3);
    this.data.frustumCulled = false;
    this.posts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#3a3e48', roughness: 0.7 }), MAX_POSTS);
    this.posts.castShadow = true; this.posts.frustumCulled = false;
    this.group.add(this.belt, this.beltGlow, this.pipe, this.data, this.posts);
    const geos: Record<string, THREE.BufferGeometry> = {
      diamond: new THREE.OctahedronGeometry(0.14).scale(1, 1.4, 1),
      cube: new THREE.BoxGeometry(0.2, 0.2, 0.2),
      square: new THREE.BoxGeometry(0.24, 0.06, 0.24),
      octa: new THREE.OctahedronGeometry(0.16),
      tetra: new THREE.TetrahedronGeometry(0.17),
      sphere: new THREE.SphereGeometry(0.11, 8, 6),
      streak: new THREE.BoxGeometry(0.55, 0.07, 0.07),
    };
    for (const sh of SHAPES) {
      const im = new THREE.InstancedMesh(geos[sh], this.glowMat, MAX_PACKETS);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PACKETS * 3), 3);
      im.count = 0; im.frustumCulled = false;
      this.packets[sh] = im;
      this.group.add(im);
    }
    const wgeo = new THREE.CylinderGeometry(1, 1, 1, 5);
    wgeo.rotateZ(Math.PI / 2);
    this.wires = new THREE.InstancedMesh(wgeo, this.wireMat, 6000);
    this.wires.count = 0;
    this.wires.frustumCulled = false;
    this.group.add(this.wires);
  }

  setState(s: GameState) { this.s = s; this.vis.clear(); this.dirty = true; this.wireEdges = null; }

  private endpoints(l: Link): LinkVis | null {
    const s = this.s;
    const A = s.byId.get(l.from), B = s.byId.get(l.to);
    if (!A || !B) return null;
    const da = BUILDING[A.type], db = BUILDING[B.type];
    const ax = A.x + da.size / 2, az = A.y + da.size / 2, bx = B.x + db.size / 2, bz = B.y + db.size / 2;
    const dx = bx - ax, dz = bz - az;
    const L = Math.hypot(dx, dz) || 1;
    const ux = dx / L, uz = dz / L;
    const off = l.kind === 'conveyor' ? 0.42 : l.kind === 'pipe' ? 0.5 : 0.3;
    const yOff = l.kind === 'conveyor' ? 0.32 : l.kind === 'pipe' ? 0.5 : l.kind === 'cable' ? 0.75 : 0.95;
    // lateral offset so links between the same pair (or both directions) don't overlap
    const lat = ((l.id * 0.37) % 1 - 0.5) * 0.5;
    const a = new THREE.Vector3(ax + ux * da.size * off - uz * lat, baseHeight(s.world, A.x, A.y, da.size) + yOff, az + uz * da.size * off + ux * lat);
    const b = new THREE.Vector3(bx - ux * db.size * off - uz * lat, baseHeight(s.world, B.x, B.y, db.size) + yOff, bz - uz * db.size * off + ux * lat);
    const len = a.distanceTo(b);
    const arc = l.kind === 'cable' || l.kind === 'fiber' ? Math.min(1.6, 0.25 + len * 0.08) : 0;
    return { id: l.id, a, b, arc, len, packets: [], acc: 0, lastTotal: l.total, kind: l.kind };
  }

  private P(v: LinkVis, t: number, out: THREE.Vector3) {
    out.lerpVectors(v.a, v.b, t);
    out.y += Math.sin(t * Math.PI) * v.arc;
    return out;
  }

  private rebuildStatic() {
    const s = this.s;
    let nb = 0, np = 0, nd = 0, npost = 0;
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
    for (const l of s.links) {
      let v = this.vis.get(l.id);
      if (!v) { const e = this.endpoints(l); if (!e) continue; v = e; this.vis.set(l.id, v); }
      const segs = v.arc > 0 ? 6 : 1;
      for (let k = 0; k < segs; k++) {
        this.P(v, k / segs, p0); this.P(v, (k + 1) / segs, p1);
        const mid = p0.clone().add(p1).multiplyScalar(0.5);
        const dir = p1.clone().sub(p0);
        let len = dir.length();
        if (!(len > 1e-4)) { dir.set(1, 0, 0); len = 0.01; } // degenerate (overlapping endpoints) → avoid NaN quaternions
        this.Q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
        if (l.kind === 'conveyor' && nb < MAX_SEG) {
          this.M.compose(mid, this.Q, this.S.set(len, 0.08, 0.34));
          this.belt.setMatrixAt(nb, this.M);
          this.M.compose(this.V.copy(mid).setY(mid.y + 0.045), this.Q, this.S.set(len, 0.02, 0.12));
          this.beltGlow.setMatrixAt(nb, this.M);
          nb++;
        } else if (l.kind === 'pipe' && np < MAX_SEG) {
          this.M.compose(mid, this.Q, this.S.set(len, 0.1, 0.1));
          this.pipe.setMatrixAt(np++, this.M);
        } else if (nd < MAX_SEG) {
          const r = l.kind === 'fiber' ? 0.04 : 0.03;
          this.M.compose(mid, this.Q, this.S.set(len, r, r));
          this.data.setMatrixAt(nd++, this.M);
        }
      }
      // posts
      if (l.kind === 'conveyor' || l.kind === 'pipe') {
        const n = Math.floor(v.len / 2.5);
        for (let k = 1; k <= n && npost < MAX_POSTS; k++) {
          this.P(v, k / (n + 1), p0);
          const gx = Math.floor(p0.x), gz = Math.floor(p0.z);
          const gh = gx >= 0 && gz >= 0 && gx < s.world.size && gz < s.world.size ? Math.max(tileHeight(s.world, gx, gz), -0.1) : 0;
          const hh = Math.max(0.05, p0.y - gh - 0.04);
          this.M.compose(this.V.set(p0.x, gh + hh / 2, p0.z), this.Q.identity(), this.S.set(0.07, hh, 0.07));
          this.posts.setMatrixAt(npost++, this.M);
        }
      }
    }
    this.belt.count = nb; this.beltGlow.count = nb; this.pipe.count = np; this.data.count = nd; this.posts.count = npost;
    for (const m of [this.belt, this.beltGlow, this.pipe, this.data, this.posts]) m.instanceMatrix.needsUpdate = true;
  }

  private rebuildWires() {
    const s = this.s;
    let n = 0;
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), dir = new THREE.Vector3();
    const top = (id: number) => {
      const b = s.byId.get(id)!; const d = BUILDING[b.type];
      const h = baseHeight(s.world, b.x, b.y, d.size);
      const y = b.type === 'pole' ? 2.08 : b.type === 'substation' ? 1.85 : b.type === 'hq' ? 2.3 : 0.9;
      return new THREE.Vector3(b.x + d.size / 2, h + y, b.y + d.size / 2);
    };
    for (const [a, b] of s.gridEdges) {
      if (!s.byId.has(a) || !s.byId.has(b)) continue;
      const A = top(a), B = top(b);
      const L = A.distanceTo(B);
      const sag = Math.min(0.8, L * 0.06);
      const N = 10;
      for (let k = 0; k < N && n < 6000; k++) {
        const t0 = k / N, t1 = (k + 1) / N;
        p0.lerpVectors(A, B, t0); p0.y -= Math.sin(t0 * Math.PI) * sag;
        p1.lerpVectors(A, B, t1); p1.y -= Math.sin(t1 * Math.PI) * sag;
        dir.subVectors(p1, p0);
        const len = dir.length();
        if (!(len > 1e-4)) continue;
        this.Q.setFromUnitVectors(X_AXIS, dir.normalize());
        this.M.compose(p0.clone().add(p1).multiplyScalar(0.5), this.Q, this.S.set(len, 0.045, 0.045));
        this.wires.setMatrixAt(n++, this.M);
      }
    }
    this.wires.count = n;
    this.wires.instanceMatrix.needsUpdate = true;
  }

  /** sync: 0..1 training intensity → fiber links pulse in unison (cluster sync) */
  update(now: number, dt: number, glowLevel: number, night: number, sync = 0) {
    const s = this.s;
    this.glowMat.color.setScalar(glowLevel);
    // dark copper by day, warm glowing lines at night: always readable
    this.wireMat.color.setRGB(0.32 + night * 1.1, 0.24 + night * 0.85, 0.1 + night * 0.25);
    // structural changes?
    const sig = s.links.length + ':' + (s.links.length ? s.links[s.links.length - 1].id + ':' + s.links[0].id : '') + ':' + s.buildings.length;
    if (sig !== this.linkSig) {
      const live = new Set(s.links.map((l) => l.id));
      for (const id of [...this.vis.keys()]) if (!live.has(id)) this.vis.delete(id);
      // endpoints of links whose buildings moved/demolished get recalculated
      for (const l of s.links) { const v = this.vis.get(l.id); if (v && v.kind !== l.kind) this.vis.delete(l.id); }
      this.linkSig = sig;
      this.dirty = true;
    }
    if (this.dirty) { this.rebuildStatic(); this.dirty = false; }
    if (this.wireEdges !== s.gridEdges) { this.rebuildWires(); this.wireEdges = s.gridEdges; }

    // per-link colours (belts & data) + packets
    const counts: Record<string, number> = {};
    for (const sh of SHAPES) counts[sh] = 0;
    let nb = 0, nd = 0;
    const blink = 0.5 + 0.5 * Math.sin(now * 8);
    const p = new THREE.Vector3(), p2 = new THREE.Vector3();
    for (const l of s.links) {
      const v = this.vis.get(l.id);
      if (!v) continue;
      const it = ITEMS[l.item];
      const dim = this.focusKinds && !this.focusKinds.has(l.kind) ? 0.12 : 1;
      const hl = this.highlight ? (this.highlight.has(l.id) ? 1.8 : 0.5) : 1;
      this.C.set(it.color);
      let k = (l.state === 'idle' ? 0.25 : 0.75) * dim * hl;
      if (l.state === 'saturated' && (this.showStates || l.kind === 'conveyor')) this.C.set('#ffb020'), k = (this.showStates ? 1.4 : 0.9) * dim;
      if (l.state === 'blocked') this.C.set('#ff3030'), k = (0.4 + blink * 1.2) * dim;
      if (this.showStates && l.state === 'idle') this.C.set('#6a7080'), k = 0.5;
      this.C.multiplyScalar(k);
      const segs = v.arc > 0 ? 6 : 1;
      if (l.kind === 'conveyor') { for (let q = 0; q < segs; q++) this.beltGlow.setColorAt(nb++, this.C); }
      else if (l.kind === 'cable' || l.kind === 'fiber') {
        const base = l.kind === 'fiber' ? 0.55 : 0.18;
        const c2 = this.C2.copy(this.C).multiplyScalar(base / Math.max(0.01, k) * (l.state === 'blocked' ? k : 1) * dim * hl + (l.kind === 'fiber' ? 0.2 : 0));
        if (l.kind === 'fiber' && l.rate > 0.5) c2.addScalar(0.15 * dim);
        if (l.kind === 'fiber' && sync > 0 && !this.reducedMotion) c2.addScalar(Math.pow(Math.max(0, Math.sin(now * 3.1)), 14) * 2.2 * sync * dim);
        for (let q = 0; q < segs; q++) this.data.setColorAt(nd++, c2);
      }
      // spawn packets from flow delta
      const delta = l.total - v.lastTotal;
      v.lastTotal = l.total;
      if (delta > 0) v.acc += delta / it.packet;
      const maxP = Math.ceil(v.len * (l.kind === 'fiber' ? 1.2 : 2.6)) + 2;
      while (v.acc >= 1) {
        v.acc -= 1;
        if (v.packets.length < maxP) v.packets.push(0);
      }
      if (v.acc > 4) v.acc = 4;
      const speed = LINKS[l.kind].speed / Math.max(0.5, v.len);
      const sh = it.shape;
      const im = this.packets[sh];
      const blocked = l.state === 'blocked';
      // sort-free advance with simple spacing (packets keep order)
      const gap = 0.32 / Math.max(0.5, v.len);
      for (let i = 0; i < v.packets.length; i++) {
        let t = v.packets[i] + (this.reducedMotion ? speed * 0.5 : speed) * dt;
        const limit = i === 0 ? 1 : v.packets[i - 1] - gap;
        if (blocked && t > limit) t = Math.max(v.packets[i], limit);
        v.packets[i] = Math.min(t, i === 0 ? 1 : limit + gap * 0.999);
      }
      while (v.packets.length && v.packets[0] >= 1 && !blocked) v.packets.shift();
      if (blocked && v.packets.length && v.packets[0] > 0.96) v.packets[0] = 0.96;
      this.C.set(it.color).multiplyScalar(1.35 * dim);
      for (const t of v.packets) {
        const n = counts[sh];
        if (n >= MAX_PACKETS) break;
        this.P(v, t, p);
        this.P(v, Math.min(1, t + 0.02), p2);
        const dir = p2.sub(p);
        if (!(dir.lengthSq() > 1e-8)) dir.set(1, 0, 0);
        this.Q.setFromUnitVectors(X_AXIS, dir.normalize());
        if (sh !== 'streak') this.Q.multiply(SPINQ.setFromAxisAngle(Y_AXIS, now * 2 + t * 6));
        p.y += l.kind === 'conveyor' ? 0.14 : 0;
        this.M.compose(p, this.Q, this.S.setScalar(1));
        im.setMatrixAt(n, this.M);
        im.setColorAt(n, this.C);
        counts[sh] = n + 1;
      }
    }
    for (const sh of SHAPES) {
      const im = this.packets[sh];
      im.count = counts[sh];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    if (this.beltGlow.instanceColor) this.beltGlow.instanceColor.needsUpdate = true;
    if (this.data.instanceColor) this.data.instanceColor.needsUpdate = true;
  }

  markDirty() { this.dirty = true; this.vis.clear(); this.linkSig = ''; }

  /** nearest link to a world point (for picking), within radius */
  pick(x: number, z: number, r = 0.5): Link | null {
    let best: Link | null = null, bd = r;
    const p = new THREE.Vector3();
    for (const l of this.s.links) {
      const v = this.vis.get(l.id);
      if (!v) continue;
      for (let k = 0; k <= 10; k++) {
        this.P(v, k / 10, p);
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bd) { bd = d; best = l; }
      }
    }
    return best;
  }
}
