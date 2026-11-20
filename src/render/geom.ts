import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** detail multiplier for round primitives (rounder silhouettes, still low-poly in spirit) */
const D = (n: number) => (n <= 6 ? n : Math.round(n * 1.6));

/** Tiny geometry builder: appends coloured flat-shaded primitives and merges them. */
export class GB {
  private parts: THREE.BufferGeometry[] = [];

  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4): this {
    let geo = g.index ? g.toNonIndexed() : g;
    if (m) geo.applyMatrix4(m);
    const c = new THREE.Color(color);
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') geo.deleteAttribute(k);
    geo.computeVertexNormals();
    this.parts.push(geo);
    return this;
  }

  static mat(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz),
    );
  }

  /** box with base at y */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, ry = 0, rx = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, GB.mat(x, y + h / 2, z, rx, ry, rz));
  }
  cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 8, rx = 0, rz = 0) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, D(seg)), color, GB.mat(x, y + h / 2, z, rx, 0, rz));
  }
  /** cylinder centred at (x,y,z) (not base-anchored) */
  cylC(rt: number, rb: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 8, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, D(seg)), color, GB.mat(x, y, z, rx, ry, rz));
  }
  cone(r: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 6) {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, GB.mat(x, y + h / 2, z));
  }
  sphere(r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, w = 8, h = 6, sy = 1) {
    return this.add(new THREE.SphereGeometry(r, D(w), D(h)), color, GB.mat(x, y, z, 0, 0, 0, 1, sy, 1));
  }
  dome(r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 10) {
    return this.add(new THREE.SphereGeometry(r, D(seg), 7, 0, Math.PI * 2, 0, Math.PI / 2), color, GB.mat(x, y, z));
  }
  torus(r: number, t: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, rx = Math.PI / 2, seg = 16) {
    return this.add(new THREE.TorusGeometry(r, t, 8, D(seg)), color, GB.mat(x, y, z, rx));
  }
  lathe(pts: [number, number][], x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 12) {
    return this.add(new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), D(seg)), color, GB.mat(x, y, z));
  }
  oct(r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, sy = 1.6) {
    return this.add(new THREE.OctahedronGeometry(r), color, GB.mat(x, y, z, 0, 0.4, 0, 1, sy, 1));
  }

  build(): THREE.BufferGeometry | null {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts, false)!;
    g.computeBoundingSphere();
    return g;
  }
}
