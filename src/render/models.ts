import * as THREE from 'three';
import { GB } from './geom';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Model {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
  spin?: { geo: THREE.BufferGeometry; pivot: THREE.Vector3; axis: 'x' | 'y' | 'z'; speed: number };
  /** a glowing level gauge built on the model (base at y = 0), drawn at baseY and scaled in height by a 0..1 level (battery charge) */
  fill?: { geo: THREE.BufferGeometry; baseY: number };
  height: number;
  emitters: { x: number; y: number; z: number; kind: 'steam' | 'smoke' | 'spark' | 'heat' }[];
}

// palette
const C = {
  concrete: '#c9c4bb', concreteD: '#9d978e', steel: '#7d8796', steelD: '#4f5866', dark: '#262b36', darker: '#171b24',
  white: '#eef1f4', panel: '#1f3a78', panelL: '#3b66c4', rust: '#a35a2e', copper: '#c87a3e', yellow: '#f2c230',
  orange: '#ff8a3a', red: '#d44a3a', blue: '#3f7fb8', glass: '#7fc8e8', green: '#4f9a5a', sand: '#d8c49a', black: '#101218',
};
// glow colours (bright, will bloom)
const G = {
  cyan: '#6fe9ff', ice: '#bff8ff', amber: '#ffb347', green: '#5dff9a', magenta: '#ff4fd8', violet: '#b98cff',
  yellow: '#ffe066', orange: '#ff7a2a', white: '#ffffff', blue: '#4fb4ff', gold: '#ffd27a', red: '#ff3b3b',
};

function foundation(b: GB, s: number, color = C.concreteD, h = 0.12) {
  b.box(s - 0.08, h, s - 0.08, 0, 0, 0, color);
  // kerb trim + hazard corner bollards: reads as a built pad, not a grey slab
  const e = s / 2 - 0.06;
  b.box(s - 0.04, 0.035, 0.05, 0, h - 0.01, e, C.steelD);
  b.box(s - 0.04, 0.035, 0.05, 0, h - 0.01, -e, C.steelD);
  b.box(0.05, 0.035, s - 0.04, e, h - 0.01, 0, C.steelD);
  b.box(0.05, 0.035, s - 0.04, -e, h - 0.01, 0, C.steelD);
  if (s >= 2) for (const [x, z] of [[e, e], [-e, e], [e, -e], [-e, -e]]) { b.cyl(0.035, 0.035, 0.16, x, h, z, C.yellow, 6); b.cyl(0.037, 0.037, 0.03, x, h + 0.08, z, C.black, 6); }
}

// ── detail kit ──
function ladder(b: GB, x: number, y: number, z: number, h: number, ry = 0) {
  const dx = Math.cos(ry) * 0.07, dz = -Math.sin(ry) * 0.07;
  b.box(0.025, h, 0.025, x - dx, y, z - dz, C.steelD, ry);
  b.box(0.025, h, 0.025, x + dx, y, z + dz, C.steelD, ry);
  for (let k = 0.12; k < h; k += 0.12) b.box(0.16, 0.018, 0.018, x, y + k, z, C.steel, ry);
}
function railing(b: GB, w: number, d: number, y: number) {
  for (const z of [-d / 2, d / 2]) { b.box(w, 0.02, 0.02, 0, y + 0.12, z, C.yellow); for (let x = -w / 2; x <= w / 2 + 1e-6; x += w / 4) b.box(0.02, 0.12, 0.02, x, y, z, C.steelD); }
  for (const x of [-w / 2, w / 2]) b.box(0.02, 0.02, d, x, y + 0.12, 0, C.yellow);
}
function vent(b: GB, x: number, y: number, z: number, r = 0.1) {
  b.cyl(r, r, 0.12, x, y, z, C.steel, 10);
  b.cyl(r * 1.25, r * 1.25, 0.025, x, y + 0.12, z, C.steelD, 10);
}
function pipeRun(b: GB, x0: number, z0: number, x1: number, z1: number, y: number, color = C.steel, r = 0.04) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ry = Math.atan2(-(z1 - z0), x1 - x0); // Euler XYZ: Rz(90°) lays the cylinder along X, Ry aims it
  b.add(new THREE.CylinderGeometry(r, r, len, 8), color, GB.mat((x0 + x1) / 2, y, (z0 + z1) / 2, 0, ry, Math.PI / 2));
  b.cylC(r * 1.4, r * 1.4, 0.04, x0, y, z0, C.steelD, 8, 0, ry, Math.PI / 2);
  b.cylC(r * 1.4, r * 1.4, 0.04, x1, y, z1, C.steelD, 8, 0, ry, Math.PI / 2);
}
function windows(g: GB, n: number, w: number, y: number, z: number, color: string, ry = 0) {
  for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) / 2) * (w / n);
    g.box(w / n * 0.6, 0.08, 0.02, Math.cos(ry) * t + Math.sin(ry) * z, y, -Math.sin(ry) * t + Math.cos(ry) * z, color, ry);
  }
}
function cabinet(b: GB, g: GB, x: number, y: number, z: number, ry = 0) {
  b.box(0.18, 0.26, 0.12, x, y, z, C.steelD, ry);
  g.box(0.04, 0.03, 0.01, x + Math.sin(ry) * 0.065, y + 0.2, z + Math.cos(ry) * 0.065, G.green, ry);
}

/** extra detail parts merged into each building's base model */
const EXTRAS: Record<string, (b: GB, g: GB) => void> = {
  hq: (b, g) => {
    windows(g, 8, 1.5, 1.2, 0.74, G.ice); windows(g, 8, 1.5, 1.2, 0.74, G.ice, Math.PI / 2); windows(g, 8, 1.5, 1.2, 0.74, G.ice, Math.PI); windows(g, 8, 1.5, 1.2, 0.74, G.ice, -Math.PI / 2);
    b.add(new THREE.SphereGeometry(0.22, 12, 4, 0, Math.PI * 2, 0, Math.PI / 3), C.white, GB.mat(0.55, 2.75, 0.2, Math.PI * 0.8, 0, 0.5));
    b.box(0.5, 0.06, 0.5, 0, 0.25, 1.25, C.concrete); b.box(0.5, 0.06, 0.32, 0, 0.13, 1.4, C.concrete);
    ladder(b, -0.62, 0.75, 0, 1.6, Math.PI / 2);
  },
  solar: (b, g) => { cabinet(b, g, -0.8, 0.06, 0.88); b.box(1.6, 0.03, 0.06, 0, 0.1, 0, C.steelD); },
  quarry: (b, g) => { ladder(b, -0.6, 0.12, 0.6, 1.4, Math.PI / 4); b.box(0.3, 0.06, 0.9, 0.55, 0.9, 0.0, C.steelD, 0, 0.5); cabinet(b, g, -0.7, 0.12, -0.6); },
  drill: (b, g) => { windows(g, 2, 0.5, 0.6, 0.71, G.ice); pipeRun(b, -0.8, -0.6, 0.6, -0.6, 0.2); cabinet(b, g, 0.75, 0.12, 0.2, Math.PI / 2); },
  furnace: (b, g) => { pipeRun(b, 0.45, -0.45, -0.55, -0.45, 1.6, C.steelD, 0.05); ladder(b, 0.66, 0.12, -0.45, 1.8, Math.PI / 2); windows(g, 3, 1.0, 0.75, 0.73, G.amber); vent(b, -0.5, 1.14, 0.4); },
  smelter: (b, g) => { ladder(b, -0.25, 0.12, 0.92, 1.1); railing(b, 1.0, 1.0, 1.21); cabinet(b, g, 0.75, 0.12, 0.6); },
  battery: (b, g) => { for (const x of [-0.55, 0, 0.55]) b.cyl(0.03, 0.03, 0.12, x + 0.08, 1.12, 0, C.red, 6); pipeRun(b, -0.55, 0.12, 0.55, 0.12, 1.2, C.black, 0.025); cabinet(b, g, 0.75, 0.12, -0.6); },
  depot: (b) => { b.box(0.4, 0.3, 0.3, 0.4, 0.3, -0.45, C.steel); b.box(0.25, 0.25, 0.25, -0.5, 0.3, 0.45, C.yellow); },
  pump: (b) => { pipeRun(b, 0.25, 0.25, 0.45, -0.35, 0.3, C.blue, 0.05); vent(b, -0.1, 0.7, -0.1, 0.08); },
  fab: (b, g) => { for (const x of [-0.9, -0.3, 0.3]) vent(b, x, 1.3, 0.8); windows(g, 6, 2.2, 0.35, 1.26, G.ice); b.box(0.6, 0.5, 0.06, 0.6, 0.12, 1.27, C.steelD); railing(b, 2.2, 1.7, 1.46); ladder(b, 1.06, 0.12, 0.9, 1.0, Math.PI / 2); pipeRun(b, 0.85, -0.7, -0.6, -0.7, 0.9, C.steel, 0.06); },
  rack: (b, g) => { b.box(0.04, 0.3, 0.02, -0.24, 0.6, 0.32, C.steel); b.cyl(0.05, 0.05, 0.3, 0.2, 1.55, 0.2, C.black, 6); g.box(0.06, 0.02, 0.01, -0.2, 1.35, 0.32, G.green); },
  cooler: (b) => { ladder(b, 0.78, 0.12, 0, 2.2, Math.PI / 2); pipeRun(b, -0.9, 0.6, -0.4, 0.4, 0.25, C.blue, 0.06); b.torus(0.62, 0.03, 0, 2.35, 0, C.steelD); },
  lab: (b, g) => { windows(g, 5, 1.4, 0.45, 0.86, G.ice); b.cyl(0.02, 0.02, 0.6, 0.7, 0.82, -0.5, C.steel, 4); g.sphere(0.04, 0.7, 1.44, -0.5, G.red); vent(b, 0.4, 0.82, 0.6); },
  substation: (b) => { for (const x of [-0.45, 0.45]) pipeRun(b, x, -0.4, 0, 0.45, 0.95, C.black, 0.02); },
  gridbat: (b, g) => { for (const z of [-0.45, 0.45]) { cabinet(b, g, -0.75, 0.12, z + 0.2); vent(b, 0.3, 0.82, z, 0.08); } },
  gas: (b) => { ladder(b, 0.82, 0.12, -0.55, 2.2, Math.PI / 2); pipeRun(b, -0.55, -0.55, -0.1, 0.0, 0.5); railing(b, 0.6, 0.6, 0.52); },
  chiller: (b) => { railing(b, 1.8, 1.6, 0.77); pipeRun(b, -0.9, 0.85, 0.9, 0.85, 0.3, C.blue, 0.05); },
  hall: (b, g) => { b.box(0.5, 0.6, 0.04, 0.6, 0.12, 1.22, C.steelD); b.box(0.5, 0.6, 0.04, -0.4, 0.12, 1.22, C.steelD); railing(b, 2.6, 2.4, 1.62); for (const z of [-1.0, 1.0]) pipeRun(b, -1.35, z, 1.35, z, 1.75, C.steel, 0.04); g.box(0.3, 0.02, 0.01, 0.6, 0.65, 1.245, G.green); },
  gateway: (b) => { ladder(b, 0.32, 0.7, 0, 1.6, Math.PI / 2); railing(b, 1.3, 1.3, 0.72); },
  trainer: (b) => { for (const [x, z] of [[-1.0, 0], [1.0, 0], [0, -1.0], [0, 1.0]]) vent(b, x, 0.62, z * 0.95, 0.09); railing(b, 2.0, 2.0, 1.12); },
  raremine: (b, g) => { cabinet(b, g, 0.8, 0.1, 0.5, Math.PI / 2); ladder(b, -0.82, 0.1, 0, 0.9, Math.PI / 2); },
  accfab: (b) => { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; vent(b, Math.cos(a) * 0.8, 1.62, Math.sin(a) * 0.8, 0.07); } pipeRun(b, 1.0, -1.0, 1.0, 0.6, 0.4); },
  pod: (b) => { for (const z of [-0.5, 0, 0.5]) pipeRun(b, -0.78, z, -0.78, z + 0.3, 0.6, C.blue, 0.035); railing(b, 1.6, 1.6, 1.42); },
  wind: (b) => { b.box(0.2, 0.3, 0.05, 0, 0.15, 0.17, C.steelD); ladder(b, 0, 0.4, 0.14, 0.6); },
  robofab: (b, g) => { vent(b, -0.5, 0.95, -0.5); vent(b, 0.2, 0.95, -0.5); windows(g, 3, 1.2, 0.7, 0.36, G.ice); },
  hub: (b) => { for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.box(0.08, 0.02, 0.2, Math.cos(a) * 0.55, 0.19, Math.sin(a) * 0.55, C.yellow, -a); } },
  fusion: (b) => { for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; pipeRun(b, Math.cos(a) * 1.3, Math.sin(a) * 1.3, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.65, C.blue, 0.06); } railing(b, 2.6, 2.6, 0.52); },
  engine: (b) => { for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; vent(b, Math.cos(a) * 1.7, 0.4, Math.sin(a) * 1.7, 0.12); } },
};

type Builder = () => Model;

const builders: Record<string, Builder> = {
  hq() {
    const b = new GB(), g = new GB();
    b.cyl(1.45, 1.5, 0.25, 0, 0, 0, C.concreteD, 8);
    b.cyl(1.15, 1.25, 0.5, 0, 0.25, 0, C.concrete, 8);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.box(0.5, 0.9, 0.5, Math.cos(a) * 1.05, 0.25, Math.sin(a) * 1.05, C.steel, -a);
      g.box(0.52, 0.08, 0.52, Math.cos(a) * 1.05, 0.95, Math.sin(a) * 1.05, G.cyan, -a);
    }
    b.cyl(0.55, 0.75, 1.7, 0, 0.75, 0, C.white, 8);
    b.cyl(0.62, 0.62, 0.18, 0, 2.45, 0, C.steelD, 8);
    b.dome(0.55, 0, 2.63, 0, C.white);
    b.cyl(0.03, 0.05, 1.2, 0, 3.1, 0, C.steel, 4);
    g.torus(0.66, 0.05, 0, 2.2, 0, G.cyan);
    g.torus(0.82, 0.04, 0, 0.78, 0, G.cyan);
    g.sphere(0.08, 0, 4.32, 0, G.white);
    g.box(0.9, 0.12, 0.05, 0, 1.4, 0.72, G.cyan);
    return { body: b.build()!, glow: g.build(), height: 4.6, emitters: [] };
  },
  solar() {
    const b = new GB(), g = new GB();
    foundation(b, 2, C.concreteD, 0.06);
    for (const z of [-0.45, 0.45]) {
      b.box(0.06, 0.45, 0.06, -0.7, 0.05, z, C.steel);
      b.box(0.06, 0.45, 0.06, 0.7, 0.05, z, C.steel);
      b.box(1.8, 0.05, 0.78, 0, 0.42, z, C.panel, 0, -0.45);
      // cell grid
      for (let i = -3; i <= 3; i++) b.box(0.02, 0.06, 0.74, i * 0.25, 0.43, z, C.panelL, 0, -0.45);
    }
    g.box(0.12, 0.06, 0.12, 0.85, 0.08, 0.9, G.yellow);
    return { body: b.build()!, glow: g.build(), height: 1.1, emitters: [] };
  },
  pole() {
    const b = new GB(), g = new GB();
    b.cyl(0.05, 0.08, 2.1, 0, 0, 0, C.steelD, 6);
    b.box(0.7, 0.06, 0.06, 0, 1.85, 0, C.steelD);
    for (const x of [-0.3, 0, 0.3]) b.cyl(0.04, 0.04, 0.12, x, 1.91, 0, C.white, 5);
    g.sphere(0.07, 0, 2.18, 0, G.yellow);
    return { body: b.build()!, glow: g.build(), height: 2.4, emitters: [] };
  },
  quarry() {
    const b = new GB(), g = new GB();
    foundation(b, 2);
    b.box(1.5, 0.3, 1.5, 0, 0.12, 0, C.yellow);
    // A-frame derrick
    for (const [x, z] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) b.box(0.08, 1.9, 0.08, x * 0.7, 0.4, z * 0.7, C.steelD, 0, z * 0.25, -x * 0.25);
    b.box(0.5, 0.3, 0.5, 0, 2.1, 0, C.yellow);
    b.box(0.5, 0.5, 0.5, 0.55, 0.42, 0.55, C.steel);
    g.oct(0.18, 0.55, 1.12, 0.55, G.ice);
    const s = new GB();
    s.cyl(0.08, 0.22, 1.4, 0, -0.7, 0, C.steel, 6);
    for (let i = 0; i < 3; i++) s.box(0.5, 0.05, 0.06, 0, -0.4 - i * 0.3, 0, C.yellow, (i * Math.PI) / 3);
    return { body: b.build()!, glow: g.build(), spin: { geo: s.build()!, pivot: new THREE.Vector3(0, 2.05, 0), axis: 'y', speed: 3 }, height: 2.6, emitters: [{ x: 0, y: 0.6, z: 0, kind: 'spark' }] };
  },
  drill() {
    const b = new GB(), g = new GB();
    foundation(b, 2);
    b.box(1.2, 0.6, 1.0, -0.2, 0.12, 0.2, C.rust);
    b.box(0.6, 0.4, 0.6, -0.2, 0.72, 0.2, C.orange);
    b.box(0.2, 0.2, 1.6, 0.55, 0.9, -0.1, C.steelD, 0, -0.5);
    b.box(0.3, 1.0, 0.3, 0.55, 0.12, 0.55, C.steelD);
    g.box(0.62, 0.06, 0.62, -0.2, 1.13, 0.2, G.amber);
    const s = new GB();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      s.box(0.12, 0.16, 0.2, 0, Math.sin(a) * 0.5 - 0.08, Math.cos(a) * 0.5, C.yellow, 0, a);
    }
    s.cylC(0.5, 0.5, 0.08, 0, 0, 0, C.steelD, 10, 0, 0, Math.PI / 2);
    return { body: b.build()!, glow: g.build(), spin: { geo: s.build()!, pivot: new THREE.Vector3(0.6, 1.2, -0.65), axis: 'x', speed: 1.6 }, height: 2, emitters: [] };
  },
  furnace() {
    const b = new GB(), g = new GB();
    foundation(b, 2);
    b.box(1.5, 0.9, 1.3, -0.1, 0.12, 0.05, C.concrete);
    b.box(1.6, 0.12, 1.4, -0.1, 1.02, 0.05, C.steelD);
    b.cyl(0.16, 0.2, 1.9, 0.45, 0.9, -0.45, C.steel, 8);
    b.cyl(0.13, 0.17, 1.5, -0.55, 0.9, -0.45, C.steel, 8);
    b.cyl(0.18, 0.18, 0.1, 0.45, 2.8, -0.45, C.red, 8);
    g.box(0.6, 0.35, 0.05, -0.1, 0.3, 0.72, G.orange);
    g.box(0.05, 0.25, 0.5, 0.67, 0.4, 0.05, G.ice);
    return { body: b.build()!, glow: g.build(), height: 3, emitters: [{ x: 0.45, y: 2.9, z: -0.45, kind: 'smoke' }, { x: -0.55, y: 2.45, z: -0.45, kind: 'smoke' }] };
  },
  smelter() {
    const b = new GB(), g = new GB();
    foundation(b, 2);
    b.cyl(0.55, 0.7, 1.1, -0.25, 0.12, 0.2, C.rust, 10);
    b.cyl(0.6, 0.6, 0.1, -0.25, 1.2, 0.2, C.steelD, 10);
    b.box(0.7, 0.6, 0.6, 0.5, 0.12, -0.45, C.steel);
    b.cyl(0.14, 0.18, 1.6, 0.6, 0.7, 0.55, C.steelD, 8);
    b.box(0.5, 0.06, 0.12, 0.25, 0.9, 0.2, C.steelD, 0, 0, -0.5);
    g.cyl(0.42, 0.42, 0.04, -0.25, 1.31, 0.2, G.orange, 10);
    g.box(0.08, 0.3, 0.08, 0.45, 0.3, 0.2, G.amber);
    return { body: b.build()!, glow: g.build(), height: 2.4, emitters: [{ x: 0.6, y: 2.35, z: 0.55, kind: 'smoke' }] };
  },
  battery() {
    const b = new GB(), g = new GB();
    foundation(b, 2);
    const f = new GB();
    for (const x of [-0.55, 0, 0.55]) {
      b.cyl(0.22, 0.22, 1.0, x, 0.12, 0, C.white, 10);
      b.cyl(0.12, 0.12, 0.1, x, 1.12, 0, C.steelD, 8);
      // level window on the front of each cell: dark when empty, the glowing fill rises with the charge
      b.box(0.17, 0.82, 0.03, x, 0.21, 0.215, C.darker);
      f.box(0.13, 0.78, 0.02, x, 0, 0.235, G.white);
    }
    b.box(1.7, 0.1, 0.9, 0, 0.12, 0, C.steelD);
    return { body: b.build()!, glow: g.build(), fill: { geo: f.build()!, baseY: 0.23 }, height: 1.6, emitters: [] };
  },
  depot() {
    const b = new GB(), g = new GB();
    foundation(b, 2);
    b.box(1.7, 0.5, 1.7, 0, 0.12, 0, C.yellow);
    b.box(1.5, 0.52, 1.5, 0, 0.13, 0, C.dark);
    b.box(0.5, 0.4, 0.5, -0.35, 0.3, -0.3, C.copper);
    b.box(0.45, 0.35, 0.45, 0.35, 0.3, 0.25, C.concrete);
    for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) b.box(0.08, 1.3, 0.08, x, 0.12, z, C.steelD);
    b.box(1.7, 0.06, 0.1, 0, 1.4, -0.8, C.steelD);
    b.box(1.7, 0.06, 0.1, 0, 1.4, 0.8, C.steelD);
    g.box(1.72, 0.06, 0.04, 0, 0.55, 0.86, G.amber);
    return { body: b.build()!, glow: g.build(), height: 1.7, emitters: [] };
  },
  junction() {
    const b = new GB(), g = new GB();
    b.box(0.82, 0.1, 0.82, 0, 0, 0, C.concreteD);
    b.cyl(0.32, 0.36, 0.42, 0, 0.1, 0, C.steel, 8);
    b.cyl(0.36, 0.36, 0.06, 0, 0.52, 0, C.yellow, 8);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; b.box(0.3, 0.12, 0.14, Math.cos(a) * 0.32, 0.22, Math.sin(a) * 0.32, C.steelD, -a); }
    g.torus(0.3, 0.035, 0, 0.6, 0, G.amber);
    g.sphere(0.07, 0, 0.66, 0, G.white);
    return { body: b.build()!, glow: g.build(), height: 1.0, emitters: [] };
  },
  pump() {
    const b = new GB(), g = new GB();
    foundation(b, 1);
    b.box(0.6, 0.5, 0.6, -0.1, 0.12, -0.1, C.concrete);
    b.box(0.68, 0.08, 0.68, -0.1, 0.62, -0.1, C.steelD);
    b.cyl(0.12, 0.12, 0.9, 0.25, 0.12, 0.25, C.blue, 8);
    b.cyl(0.18, 0.18, 0.2, 0.25, 0.9, 0.25, C.steelD, 8);
    g.torus(0.15, 0.03, 0.25, 0.6, 0.25, G.blue);
    return { body: b.build()!, glow: g.build(), height: 1.3, emitters: [] };
  },
  fab() {
    const b = new GB(), g = new GB();
    foundation(b, 3);
    b.box(2.4, 1.1, 1.9, -0.15, 0.12, 0.3, C.white);
    // sawtooth roof
    for (let i = 0; i < 4; i++) b.box(0.55, 0.35, 1.9, -1.05 + i * 0.6, 1.1, 0.3, C.concrete, 0, 0, 0.5);
    g.box(2.42, 0.1, 0.04, -0.15, 0.55, 1.26, G.green);
    g.box(0.04, 0.1, 1.6, 1.07, 0.55, 0.3, G.green);
    for (const x of [-0.9, -0.3]) b.cyl(0.32, 0.32, 1.3, x, 0.12, -1.0, C.concrete, 10), b.dome(0.32, x, 1.42, -1.0, C.white);
    b.cyl(0.18, 0.24, 2.6, 0.85, 0.12, -0.95, C.steel, 8);
    g.torus(0.21, 0.03, 0.85, 2.3, -0.95, G.green);
    return { body: b.build()!, glow: g.build(), height: 2.9, emitters: [{ x: 0.85, y: 2.75, z: -0.95, kind: 'steam' }] };
  },
  rack() {
    const b = new GB(), g = new GB();
    b.box(0.86, 0.1, 0.86, 0, 0, 0, C.concreteD);
    b.box(0.62, 1.45, 0.62, 0, 0.1, 0, C.darker);
    b.box(0.66, 0.06, 0.66, 0, 1.55, 0, C.steelD);
    for (let i = 0; i < 6; i++) g.box(0.5, 0.06, 0.02, 0, 0.3 + i * 0.2, 0.315, i % 2 ? G.cyan : G.blue);
    for (let i = 0; i < 6; i++) g.box(0.02, 0.06, 0.5, 0.315, 0.3 + i * 0.2, 0, G.cyan);
    const s = new GB();
    for (let i = 0; i < 4; i++) s.box(0.42, 0.02, 0.08, 0, 0, 0, C.steel, (i * Math.PI) / 4);
    return { body: b.build()!, glow: g.build(), spin: { geo: s.build()!, pivot: new THREE.Vector3(0, 1.62, 0), axis: 'y', speed: 9 }, height: 1.9, emitters: [{ x: 0, y: 1.7, z: 0, kind: 'heat' }] };
  },
  cooler() {
    const b = new GB(), g = new GB();
    foundation(b, 2);
    b.lathe([[0.85, 0], [0.7, 0.6], [0.55, 1.3], [0.52, 1.7], [0.6, 2.3], [0.62, 2.35]], 0, 0.12, 0, C.concrete, 14);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.box(0.06, 0.3, 0.06, Math.cos(a) * 0.8, 0.12, Math.sin(a) * 0.8, C.concreteD);
    }
    g.torus(0.82, 0.03, 0, 0.3, 0, G.blue);
    return { body: b.build()!, glow: g.build(), height: 2.6, emitters: [{ x: 0, y: 2.4, z: 0, kind: 'steam' }] };
  },
  lab() {
    const b = new GB(), g = new GB();
    foundation(b, 2);
    b.box(1.6, 0.7, 1.1, 0, 0.12, 0.3, C.white);
    b.cyl(0.55, 0.6, 0.5, -0.3, 0.12, -0.35, C.concrete, 12);
    b.dome(0.55, -0.3, 0.62, -0.35, C.white, 12);
    g.box(0.06, 0.5, 0.2, -0.3, 0.75, 0.05, G.violet);
    b.cyl(0.04, 0.05, 0.6, 0.55, 0.82, 0.4, C.steel, 4);
    b.add(new THREE.SphereGeometry(0.32, 10, 4, 0, Math.PI * 2, 0, Math.PI / 3), C.white, GB.mat(0.55, 1.65, 0.4, Math.PI * 0.85, 0, 0.4));
    g.box(1.62, 0.08, 0.04, 0, 0.5, 0.86, G.violet);
    return { body: b.build()!, glow: g.build(), height: 1.9, emitters: [] };
  },
  substation() {
    const b = new GB(), g = new GB();
    b.box(1.9, 0.08, 1.9, 0, 0, 0, '#8a8f7a');
    for (const [x, z] of [[-0.45, -0.4], [0.45, -0.4], [0, 0.45]]) {
      b.box(0.55, 0.6, 0.45, x, 0.08, z, C.steel);
      for (const dx of [-0.15, 0, 0.15]) b.cyl(0.04, 0.05, 0.35, x + dx, 0.68, z, C.white, 5);
    }
    for (const x of [-0.85, 0.85]) b.box(0.08, 1.8, 0.08, x, 0.08, -0.85, C.steelD), b.box(0.08, 1.8, 0.08, x, 0.08, 0.85, C.steelD);
    b.box(1.8, 0.06, 0.06, 0, 1.8, -0.85, C.steelD);
    b.box(1.8, 0.06, 0.06, 0, 1.8, 0.85, C.steelD);
    g.box(0.1, 0.1, 0.1, -0.85, 1.9, -0.85, G.yellow);
    g.box(0.1, 0.1, 0.1, 0.85, 1.9, 0.85, G.yellow);
    g.box(0.4, 0.04, 0.02, 0, 0.4, 0.68, G.yellow);
    return { body: b.build()!, glow: g.build(), height: 2.2, emitters: [] };
  },
  gridbat() {
    const b = new GB(), g = new GB();
    foundation(b, 2);
    const f = new GB();
    for (const z of [-0.45, 0.45]) {
      b.box(1.75, 0.7, 0.7, 0, 0.12, z, C.white);
      for (let i = -3; i <= 3; i++) b.box(0.03, 0.7, 0.72, i * 0.25, 0.12, z, C.concreteD);
      // level window along each container: the glowing band rises with the charge
      b.box(1.44, 0.52, 0.03, 0, 0.2, z + 0.365, C.darker);
      f.box(1.38, 0.48, 0.02, 0, 0, z + 0.385, G.white);
    }
    b.box(0.3, 0.3, 0.3, 0.7, 0.82, 0.45, C.steel);
    return { body: b.build()!, glow: g.build(), fill: { geo: f.build()!, baseY: 0.22 }, height: 1.4, emitters: [] };
  },
  gas() {
    const b = new GB(), g = new GB();
    foundation(b, 2);
    b.cylC(0.42, 0.42, 1.5, -0.1, 0.62, 0.2, C.steel, 12, 0, 0, Math.PI / 2);
    b.cylC(0.48, 0.48, 0.12, 0.6, 0.62, 0.2, C.steelD, 12, 0, 0, Math.PI / 2);
    b.box(0.6, 0.4, 0.6, -0.55, 0.12, -0.55, C.concrete);
    b.cyl(0.2, 0.26, 2.4, 0.55, 0.12, -0.55, C.concreteD, 8);
    b.cyl(0.21, 0.21, 0.1, 0.55, 2.2, -0.55, C.red, 8);
    g.torus(0.43, 0.04, 0.78, 0.62, 0.2, G.orange, 0, 14);
    return { body: b.build()!, glow: g.build(), height: 2.6, emitters: [{ x: 0.55, y: 2.55, z: -0.55, kind: 'smoke' }] };
  },
  chiller() {
    const b = new GB(), g = new GB();
    foundation(b, 2);
    b.box(1.8, 0.65, 1.6, 0, 0.12, 0, C.concrete);
    for (let i = 0; i < 9; i++) b.box(0.03, 0.55, 1.62, -0.8 + i * 0.2, 0.15, 0, C.concreteD);
    for (const [x, z] of [[-0.45, -0.38], [0.45, -0.38], [-0.45, 0.38], [0.45, 0.38]]) b.cyl(0.33, 0.33, 0.08, x, 0.77, z, C.steelD, 12);
    g.box(1.82, 0.05, 0.04, 0, 0.35, 0.82, G.cyan);
    const s = new GB();
    for (let i = 0; i < 3; i++) s.box(0.56, 0.02, 0.1, 0, 0, 0, C.steel, (i * Math.PI) / 3);
    return { body: b.build()!, glow: g.build(), spin: { geo: s.build()!, pivot: new THREE.Vector3(-0.45, 0.88, -0.38), axis: 'y', speed: 7 }, height: 1.3, emitters: [] };
  },
  hall() {
    const b = new GB(), g = new GB();
    foundation(b, 3);
    b.box(2.6, 1.4, 2.4, 0, 0.12, 0, C.dark);
    b.box(2.7, 0.1, 2.5, 0, 1.52, 0, C.steelD);
    for (let r = 0; r < 4; r++) {
      g.box(2.2, 0.08, 0.03, 0, 0.35 + r * 0.28, 1.215, r % 2 ? G.cyan : G.blue);
      g.box(0.03, 0.08, 2.0, 1.315, 0.35 + r * 0.28, 0, G.cyan);
    }
    for (const [x, z] of [[-0.8, -0.6], [0, -0.6], [0.8, -0.6], [-0.8, 0.5], [0, 0.5], [0.8, 0.5]]) {
      b.box(0.55, 0.3, 0.55, x, 1.62, z, C.concrete);
      b.cyl(0.2, 0.2, 0.04, x, 1.92, z, C.steelD, 10);
    }
    g.box(0.3, 0.3, 0.04, -1.0, 0.12, 1.22, G.white);
    return { body: b.build()!, glow: g.build(), height: 2.4, emitters: [{ x: 0, y: 2.0, z: 0, kind: 'heat' }] };
  },
  gateway() {
    const b = new GB(), g = new GB();
    foundation(b, 2);
    b.box(1.3, 0.6, 1.3, 0, 0.12, 0, C.concrete);
    b.cyl(0.25, 0.35, 1.8, 0, 0.7, 0, C.white, 8);
    for (let i = 0; i < 3; i++) g.torus(0.36 - i * 0.04, 0.035, 0, 1.0 + i * 0.45, 0, G.cyan);
    b.add(new THREE.SphereGeometry(0.6, 12, 4, 0, Math.PI * 2, 0, Math.PI / 3.2), C.white, GB.mat(0, 3.15, 0, Math.PI));
    g.sphere(0.09, 0, 2.6, 0, G.white);
    return { body: b.build()!, glow: g.build(), height: 3.4, emitters: [] };
  },
  trainer() {
    const b = new GB(), g = new GB();
    foundation(b, 3);
    b.box(2.6, 0.5, 2.6, 0, 0.12, 0, C.darker);
    b.box(2.0, 0.5, 2.0, 0, 0.62, 0, C.dark);
    b.box(1.4, 0.5, 1.4, 0, 1.12, 0, C.darker);
    g.box(2.62, 0.05, 2.62, 0, 0.58, 0, G.magenta);
    g.box(2.02, 0.05, 2.02, 0, 1.08, 0, G.cyan);
    g.box(1.42, 0.05, 1.42, 0, 1.58, 0, G.magenta);
    g.box(0.6, 0.6, 0.6, 0, 1.75, 0, G.white, Math.PI / 4);
    for (const [x, z] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) b.cyl(0.06, 0.06, 2.4, x, 0.12, z, C.steelD, 5), g.sphere(0.07, x, 2.55, z, G.magenta);
    return { body: b.build()!, glow: g.build(), height: 2.9, emitters: [] };
  },
  raremine() {
    const b = new GB(), g = new GB();
    foundation(b, 2, '#6b5a6a');
    b.box(1.6, 0.25, 1.6, 0, 0.1, 0, C.steelD);
    b.box(1.1, 0.27, 1.1, 0, 0.1, 0, C.black);
    for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) b.box(0.1, 1.5, 0.1, x * 0.75, 0.3, z * 0.75, C.yellow, 0, z * 0.3, -x * 0.3);
    b.box(0.4, 0.4, 0.4, 0, 1.55, 0, C.steel);
    b.cyl(0.03, 0.03, 1.2, 0, 0.35, 0, C.steelD, 4);
    g.oct(0.16, 0, 0.55, 0, G.violet);
    g.box(1.12, 0.03, 1.12, 0, 0.37, 0, G.violet);
    return { body: b.build()!, glow: g.build(), height: 2.1, emitters: [{ x: 0, y: 0.4, z: 0, kind: 'spark' }] };
  },
  accfab() {
    const b = new GB(), g = new GB();
    foundation(b, 3, C.dark);
    b.cyl(1.3, 1.35, 1.2, 0, 0.12, 0, C.darker, 6);
    b.cyl(1.0, 1.2, 0.3, 0, 1.32, 0, C.dark, 6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      g.box(0.05, 1.1, 0.05, Math.cos(a) * 1.26, 0.17, Math.sin(a) * 1.26, G.magenta);
    }
    b.dome(0.5, 0, 1.62, 0, C.steel, 12);
    g.torus(0.55, 0.04, 0, 1.64, 0, G.magenta);
    b.cyl(0.15, 0.2, 1.8, 1.0, 0.12, -1.0, C.steel, 8);
    return { body: b.build()!, glow: g.build(), height: 2.3, emitters: [{ x: 1.0, y: 1.95, z: -1.0, kind: 'steam' }] };
  },
  pod() {
    const b = new GB(), g = new GB();
    foundation(b, 2, C.dark);
    b.box(1.5, 1.2, 1.5, 0, 0.12, 0, C.darker);
    b.box(1.6, 0.1, 1.6, 0, 1.32, 0, C.steelD);
    for (let i = -2; i <= 2; i++) g.box(0.05, 0.9, 0.02, i * 0.28, 0.28, 0.76, G.magenta);
    for (let i = -2; i <= 2; i++) g.box(0.02, 0.9, 0.05, 0.76, 0.28, i * 0.28, G.magenta);
    b.cyl(0.08, 0.08, 1.0, -0.6, 1.42, -0.6, C.blue, 6);
    b.box(0.6, 0.2, 0.6, 0.25, 1.42, 0.25, C.steel);
    g.box(0.4, 0.04, 0.4, 0.25, 1.63, 0.25, G.white);
    return { body: b.build()!, glow: g.build(), height: 2.0, emitters: [{ x: 0, y: 1.7, z: 0, kind: 'heat' }] };
  },
  switch() {
    const b = new GB(), g = new GB();
    b.box(0.8, 0.1, 0.8, 0, 0, 0, C.concreteD);
    b.box(0.45, 1.6, 0.45, 0, 0.1, 0, C.darker);
    b.cone(0.3, 0.35, 0, 1.7, 0, C.dark, 4);
    for (let i = 0; i < 5; i++) g.box(0.02, 1.2, 0.02, -0.16 + i * 0.08, 0.3, 0.23, G.white);
    g.sphere(0.06, 0, 2.08, 0, G.cyan);
    return { body: b.build()!, glow: g.build(), height: 2.3, emitters: [] };
  },
  wind() {
    const b = new GB(), g = new GB();
    b.cyl(0.5, 0.55, 0.15, 0, 0, 0, C.concreteD, 10);
    b.cyl(0.08, 0.17, 4.0, 0, 0.15, 0, C.white, 10);
    b.box(0.25, 0.25, 0.55, 0, 4.1, 0.05, C.white);
    g.sphere(0.05, 0, 4.4, -0.15, G.red);
    const s = new GB();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      s.add(new THREE.BoxGeometry(0.12, 1.7, 0.03), C.white, GB.mat(Math.sin(a) * 0.85, Math.cos(a) * 0.85, 0, 0, 0, -a));
    }
    s.sphere(0.12, 0, 0, 0, C.white);
    return { body: b.build()!, glow: g.build(), spin: { geo: s.build()!, pivot: new THREE.Vector3(0, 4.22, 0.38), axis: 'z', speed: 1.4 }, height: 5.2, emitters: [] };
  },
  robofab() {
    const b = new GB(), g = new GB();
    foundation(b, 2);
    b.box(1.6, 0.8, 1.2, 0, 0.12, -0.25, C.concrete);
    b.box(1.7, 0.08, 1.3, 0, 0.92, -0.25, C.steelD);
    b.box(0.3, 0.25, 0.3, 0.4, 0.12, 0.65, C.yellow);
    b.box(0.08, 0.6, 0.08, 0.4, 0.37, 0.65, C.yellow, 0, 0.3);
    b.box(0.5, 0.08, 0.08, 0.25, 0.95, 0.65, C.yellow, 0, 0, 0.4);
    g.box(1.2, 0.3, 0.04, 0, 0.35, 0.36, G.yellow);
    return { body: b.build()!, glow: g.build(), height: 1.6, emitters: [{ x: 0.1, y: 1.0, z: 0.65, kind: 'spark' }] };
  },
  service() {
    // maintenance depot: workshop with roll-up doors, a crane arm and a teal beacon that turns
    const b = new GB(), g = new GB();
    foundation(b, 2);
    b.box(1.6, 0.85, 1.1, 0, 0.12, -0.3, C.concrete);
    b.box(1.7, 0.08, 1.2, 0, 0.97, -0.3, C.steelD);
    for (const x of [-0.42, 0.42]) { b.box(0.62, 0.6, 0.04, x, 0.12, 0.26, C.steelD); g.box(0.5, 0.03, 0.01, x, 0.66, 0.285, G.cyan); }
    b.box(0.5, 0.12, 0.5, -0.5, 0.12, 0.62, C.yellow);
    b.box(0.08, 0.9, 0.08, 0.62, 0.12, 0.62, C.yellow);
    b.box(0.08, 0.08, 0.7, 0.62, 1.0, 0.35, C.yellow);
    b.cyl(0.05, 0.05, 0.55, -0.55, 1.05, -0.55, C.steel, 5);
    g.box(1.2, 0.05, 0.02, 0, 0.9, 0.205, G.cyan);
    const s = new GB();
    s.box(0.22, 0.1, 0.1, 0, 0, 0, C.dark);
    s.box(0.08, 0.06, 0.06, 0.12, 0.02, 0, '#2fd6c0');
    return { body: b.build()!, glow: g.build(), spin: { geo: s.build()!, pivot: new THREE.Vector3(-0.55, 1.66, -0.55), axis: 'y', speed: 2.6 }, height: 1.8, emitters: [] };
  },
  hub() {
    const b = new GB(), g = new GB();
    b.cyl(0.95, 0.98, 0.18, 0, 0, 0, C.steelD, 16);
    b.cyl(0.7, 0.7, 0.04, 0, 0.18, 0, C.dark, 16);
    g.torus(0.82, 0.04, 0, 0.21, 0, G.yellow);
    b.cyl(0.06, 0.08, 1.6, 0.7, 0.18, -0.7, C.steel, 5);
    g.sphere(0.08, 0.7, 1.82, -0.7, G.yellow);
    const s = new GB();
    s.box(0.25, 0.08, 0.25, 0, 0, 0, C.yellow);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; s.cylC(0.09, 0.09, 0.02, Math.cos(a) * 0.2, 0.05, Math.sin(a) * 0.2, C.steel, 6); }
    return { body: b.build()!, glow: g.build(), spin: { geo: s.build()!, pivot: new THREE.Vector3(0, 1.1, 0), axis: 'y', speed: 2.2 }, height: 2, emitters: [] };
  },
  fusion() {
    const b = new GB(), g = new GB();
    foundation(b, 3, C.dark);
    b.cyl(1.35, 1.4, 0.4, 0, 0.12, 0, C.concrete, 16);
    b.torus(0.95, 0.32, 0, 0.95, 0, C.steel, Math.PI / 2, 20);
    g.torus(0.95, 0.12, 0, 0.95, 0, G.violet, Math.PI / 2, 24);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.box(0.18, 0.95, 0.4, Math.cos(a) * 0.95, 0.5, Math.sin(a) * 0.95, C.steelD, -a);
    }
    b.dome(0.4, 0, 0.52, 0, C.white, 12);
    g.sphere(0.18, 0, 1.0, 0, G.white);
    return { body: b.build()!, glow: g.build(), height: 2.2, emitters: [{ x: 1.2, y: 0.6, z: 1.2, kind: 'steam' }] };
  },
  engine() {
    const b = new GB(), g = new GB();
    b.cyl(2.0, 2.1, 0.4, 0, 0, 0, C.darker, 8);
    b.cyl(1.5, 1.8, 0.5, 0, 0.4, 0, C.dark, 8);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.box(0.4, 3.6, 0.4, Math.cos(a) * 1.35, 0.9, Math.sin(a) * 1.35, C.dark, -a, Math.sin(a) * 0.12, -Math.cos(a) * 0.12);
      g.box(0.06, 3.2, 0.06, Math.cos(a) * 1.35, 1.0, Math.sin(a) * 1.35, G.gold, -a, Math.sin(a) * 0.12, -Math.cos(a) * 0.12);
    }
    b.cyl(0.25, 0.6, 4.6, 0, 0.9, 0, C.darker, 8);
    g.oct(0.55, 0, 6.3, 0, G.white, 1.8);
    g.torus(1.6, 0.06, 0, 0.92, 0, G.gold);
    const s = new GB();
    s.torus(1.2, 0.07, 0, 0, 0, G.gold, Math.PI / 2 + 0.3, 28);
    s.torus(0.9, 0.06, 0, 0.9, 0, G.gold, Math.PI / 2 - 0.3, 24);
    return { body: b.build()!, glow: g.build(), spin: { geo: s.build()!, pivot: new THREE.Vector3(0, 4.2, 0), axis: 'y', speed: 0.7 }, height: 7.5, emitters: [{ x: 0, y: 6.5, z: 0, kind: 'spark' }] };
  },
};

const cache = new Map<string, Model>();
export function getModel(type: string): Model {
  let m = cache.get(type);
  if (!m) {
    const f = builders[type];
    if (!f) throw new Error('No model for ' + type);
    m = f();
    const ex = EXTRAS[type];
    if (ex) {
      const b = new GB(), g = new GB();
      ex(b, g);
      const eb = b.build(), eg = g.build();
      if (eb) m.body = mergeGeometries([m.body, eb], false)!;
      if (eg) m.glow = m.glow ? mergeGeometries([m.glow, eg], false)! : eg;
    }
    cache.set(type, m);
  }
  return m;
}
