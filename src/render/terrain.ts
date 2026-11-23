import * as THREE from 'three';
import { BIOME, DEPOSIT, LEVEL_H, PROP, World, idx } from '../sim/world';
import { hashTile } from '../sim/rng';
import { GB } from './geom';

export const WATER_Y = -0.12;
const SEABED_Y = -0.75;
const BASE_Y = -3.2;

const BIOME_COL: Record<number, [string, string]> = {
  [BIOME.WATER]: ['#3c5a5a', '#2f4c52'],
  [BIOME.GRASS]: ['#6fae4f', '#94c45a'],
  [BIOME.FOREST]: ['#4d8f44', '#64a24c'],
  [BIOME.DESERT]: ['#e3c27a', '#d3a65e'],
  [BIOME.TUNDRA]: ['#dfe9ef', '#c4d6e2'],
  [BIOME.ROCK]: ['#8f8273', '#a39484'],
};

/** base height for a footprint: the highest terrace under it (lower tiles get a platform) */
export function baseHeight(w: World, x: number, y: number, size: number): number {
  let m = -9;
  for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) m = Math.max(m, tileHeight(w, xx, yy));
  return m;
}
export function minHeight(w: World, x: number, y: number, size: number): number {
  let m = 99;
  for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) m = Math.min(m, tileHeight(w, xx, yy));
  return m;
}

export function tileHeight(w: World, x: number, y: number): number {
  const l = w.level[idx(w, x, y)];
  return l === 0 ? SEABED_Y : l * LEVEL_H;
}

/** visual micro-relief step per half-tile cell (gameplay heights stay per tile) */
function microStep(w: World, cx: number, cy: number): number {
  const t = idx(w, cx >> 1, cy >> 1);
  const b = w.biome[t], l = w.level[t];
  const amp = l === 0 ? 0.05 : b === BIOME.ROCK || l >= 5 ? 0.13 : b === BIOME.TUNDRA ? 0.08 : b === BIOME.DESERT ? 0.03 : 0.05;
  const q = Math.floor(hashTile(cx, cy, w.seed + 77) * 3); // 0,1,2 → quantised terraces-within-terraces
  return (q / 2) * amp;
}

/** visual ground height at a world point, including micro-relief */
export function groundAt(w: World, px: number, pz: number): number {
  const x = Math.floor(px), z = Math.floor(pz);
  if (x < 0 || z < 0 || x >= w.size || z >= w.size) return 0;
  return tileHeight(w, x, z) + microStep(w, Math.floor(px * 2), Math.floor(pz * 2));
}

/** fine = half-tile cells with micro-relief (visible mesh); coarse = per-tile (cheap shadow caster) */
export function buildTerrain(w: World, fine = true): THREE.Mesh {
  const pos: number[] = [], col: number[] = [];
  const c = new THREE.Color(), c2 = new THREE.Color(), csub = new THREE.Color(), flower = new THREE.Color('#e8e07a');
  const pushQuad = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, color: THREE.Color, color2?: THREE.Color) => {
    const k = color2 ?? color;
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
    col.push(color.r, color.g, color.b, color.r, color.g, color.b, k.r, k.g, k.b, color.r, color.g, color.b, k.r, k.g, k.b, k.r, k.g, k.b);
  };
  const S = w.size, SUB = fine ? 2 : 1, N = S * SUB, CS = 1 / SUB; // cells
  const tileCol: THREE.Color[] = new Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = idx(w, x, y);
    const l = w.level[i], b = w.biome[i];
    const r = hashTile(x, y, w.seed + 1);
    const [ca, cb] = BIOME_COL[b];
    const cc = new THREE.Color(ca).lerp(c2.set(cb), r);
    if (l === 1) {
      let wet = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < S && yy < S && w.level[idx(w, xx, yy)] === 0) wet = true;
      }
      if (wet && b !== BIOME.TUNDRA) cc.set('#e6d39a').lerp(c2.set('#d9c084'), r);
    }
    if (l >= 6) cc.set('#f4f8fb');
    if (l === 0) cc.set('#c9b98a').lerp(c2.set('#7e8f7a'), 0.4 + r * 0.3);
    cc.multiplyScalar(0.92 + hashTile(x >> 2, y >> 2, w.seed + 9) * 0.12);
    tileCol[i] = cc;
  }
  const cellH = new Float32Array(N * N);
  for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) cellH[cy * N + cx] = fine ? tileHeight(w, cx >> 1, cy >> 1) + microStep(w, cx, cy) : tileHeight(w, cx, cy);
  const H = (cx: number, cy: number) => (cx < 0 || cy < 0 || cx >= N || cy >= N ? BASE_Y : cellH[cy * N + cx]);
  for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
    const tx = fine ? cx >> 1 : cx, ty = fine ? cy >> 1 : cy, ti = idx(w, tx, ty);
    const l = w.level[ti], b = w.biome[ti];
    const h = H(cx, cy);
    const j = hashTile(cx, cy, w.seed + 23);
    csub.copy(tileCol[ti]).multiplyScalar(0.93 + j * 0.14 + (h - tileHeight(w, tx, ty)) * 0.9);
    if (l > 0 && j > 0.94 && (b === BIOME.GRASS || b === BIOME.FOREST)) csub.lerp(flower, 0.3);
    const x0 = cx * CS, y0 = cy * CS, x1 = x0 + CS, y1 = y0 + CS;
    pushQuad(x0, h, y0, x0, h, y1, x1, h, y1, x1, h, y0, csub);
    // walls toward lower neighbour cells (micro steps and real cliffs)
    const neigh: [number, number, number, number, number, number][] = [
      [cx + 1, cy, x1, y0, x1, y1], [cx - 1, cy, x0, y1, x0, y0], [cx, cy + 1, x1, y1, x0, y1], [cx, cy - 1, x0, y0, x1, y0],
    ];
    const r = hashTile(tx, ty, w.seed + 1);
    for (const [nx, ny, ax, az, bx, bz] of neigh) {
      const nh = H(nx, ny);
      if (nh >= h - 1e-4) continue;
      const drop = h - nh;
      if (drop < LEVEL_H * 0.5) {
        // micro step: short lip in a slightly darker ground colour
        c.copy(csub).multiplyScalar(0.72);
        pushQuad(ax, h, az, bx, h, bz, bx, nh, bz, ax, nh, az, c);
        continue;
      }
      const steps = Math.max(1, Math.round(drop / LEVEL_H));
      for (let st = 0; st < steps; st++) {
        const t0 = h - (drop * st) / steps, t1 = h - (drop * (st + 1)) / steps;
        const depth = (h - t0) / 3;
        const isBase = t1 < SEABED_Y - 0.01;
        if (isBase) c.set('#4a3a2e').lerp(c2.set('#2a2228'), Math.min(1, (SEABED_Y - t1) / 2.4));
        else if (b === BIOME.DESERT) c.set('#c49a5e').lerp(c2.set('#a87848'), depth + r * 0.2);
        else if (b === BIOME.TUNDRA || l >= 6) c.set('#9fb3c2').lerp(c2.set('#7b8796'), depth);
        else c.set('#7a6450').lerp(c2.set('#5e4b3c'), depth + r * 0.2);
        c.multiplyScalar(0.92 + hashTile(cx, cy * 3 + st, w.seed + 5) * 0.16); // strata speckle per half-tile
        if (st === 0 && !isBase && l > 0 && b !== BIOME.DESERT && b !== BIOME.ROCK) {
          c2.copy(c);
          const lip = new THREE.Color(BIOME_COL[b][0]).multiplyScalar(0.8);
          pushQuad(ax, t0, az, bx, t0, bz, bx, t1, bz, ax, t1, az, lip, c2);
          continue;
        }
        pushQuad(ax, t0, az, bx, t0, bz, bx, t1, bz, ax, t1, az, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  if (!fine) {
    // invisible in the colour pass, only writes the shadow map
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  }
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.add(buildTerrain(w, false));
  return mesh;
}

/** Animated water with shore foam (shore distance texture), fresnel and sun/moon glints. */
export function buildWater(w: World): { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> } {
  const S = w.size;
  const data = new Uint8Array(S * S * 4);
  // distance to land (BFS-ish, capped)
  const dist = new Float32Array(S * S).fill(99);
  const q: number[] = [];
  for (let i = 0; i < S * S; i++) if (w.level[i] > 0) { dist[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % S, y = (i / S) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
      const j = yy * S + xx;
      if (dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; if (dist[j] < 8) q.push(j); }
    }
  }
  for (let i = 0; i < S * S; i++) {
    const d = Math.min(8, dist[i]);
    data[i * 4] = Math.round((1 - d / 8) * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const uniforms = {
    uTime: { value: 0 },
    uShore: { value: tex },
    uSize: { value: S },
    uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uDeep: { value: new THREE.Color('#1d5f8a') },
    uShallow: { value: new THREE.Color('#3fb7c7') },
    uNight: { value: 0 },
    uFogCol: { value: new THREE.Color('#bfe3ff') },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vW;
      void main(){
        vec3 p = position;
        vec4 wp = modelMatrix * vec4(p,1.0);
        wp.y += sin(wp.x*0.9+uTime*1.3)*0.025 + cos(wp.z*1.1+uTime*1.1)*0.025;
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform sampler2D uShore; uniform float uSize;
      uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uDeep; uniform vec3 uShallow; uniform float uNight;
      varying vec3 vW;
      float h(vec2 p){ p *= 2.6; return (sin(p.x*2.1+uTime*1.7)*0.5+sin(p.y*1.7-uTime*1.3)*0.5+sin((p.x+p.y)*3.3+uTime*2.3)*0.25 + sin(p.x*5.7-p.y*4.3+uTime*2.9)*0.15) * 0.45; }
      void main(){
        vec2 uv = vW.xz / uSize;
        float shore = texture2D(uShore, uv).r;
        vec2 e = vec2(0.05,0.0);
        vec2 p = vW.xz;
        vec3 n = normalize(vec3(h(p+e.xy)-h(p-e.xy), 6.0, h(p+e.yx)-h(p-e.yx)));
        vec3 base = mix(uDeep, uShallow, smoothstep(0.1, 0.95, shore));
        vec3 V = normalize(vec3(1.0, 1.15, 1.0));
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(n,H),0.0), 90.0) * 1.6;
        float fres = pow(clamp(1.0 - dot(n,V), 0.0, 1.0), 3.0);
        vec3 col = base * (0.55 + 0.45*max(dot(n,uSunDir),0.0)) + uSunCol*spec + vec3(0.25,0.35,0.45)*fres*0.4;
        // shoreline foam bands
        float band = sin(shore*34.0 - uTime*1.6 + h(p*0.5)*1.2);
        float foam = smoothstep(0.86, 1.0, shore) * 0.9 + smoothstep(0.6,0.95,band)*smoothstep(0.55,0.9,shore)*0.45;
        col = mix(col, vec3(0.95,0.98,1.0) * (1.0 - uNight*0.6), clamp(foam,0.0,1.0));
        col *= mix(1.0, 0.35, uNight);
        float a = mix(0.82, 0.62, shore);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const geo = new THREE.PlaneGeometry(S, S, S, S);
  geo.rotateX(-Math.PI / 2);
  geo.translate(S / 2, WATER_Y, S / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return { mesh, uniforms };
}

export interface PropLayer {
  group: THREE.Group;
  /** hide props on a tile (when building there) */
  clear(x: number, y: number): void;
  restore(x: number, y: number): void;
  depositGlow: THREE.Material[];
}

export function buildProps(w: World): PropLayer {
  const group = new THREE.Group();
  const kinds: Record<number, { geo: THREE.BufferGeometry; mat: THREE.Material }> = {};
  const std = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
  const mk = (f: (b: GB) => void) => { const b = new GB(); f(b); return b.build()!; };
  kinds[PROP.TREE] = { geo: mk((b) => { b.cyl(0.06, 0.08, 0.35, 0, 0, 0, '#6b4a2e', 5); b.cone(0.38, 0.6, 0, 0.3, 0, '#3f8a3a', 7); b.cone(0.28, 0.5, 0, 0.65, 0, '#56a544', 7); }), mat: std };
  kinds[PROP.PINE] = { geo: mk((b) => { b.cyl(0.05, 0.06, 0.25, 0, 0, 0, '#5a4030', 5); b.cone(0.3, 0.55, 0, 0.2, 0, '#2f5e48', 6); b.cone(0.22, 0.45, 0, 0.55, 0, '#3a6e55', 6); b.cone(0.1, 0.2, 0, 0.92, 0, '#f2f6fa', 6); }), mat: std };
  kinds[PROP.ROCK] = { geo: mk((b) => { b.add(new THREE.DodecahedronGeometry(0.25, 0), '#8c8680', GB.mat(0, 0.12, 0, 0.3, 0.5, 0, 1, 0.7, 1)); b.add(new THREE.DodecahedronGeometry(0.14, 0), '#a29b93', GB.mat(0.22, 0.07, 0.1)); }), mat: std };
  kinds[PROP.CACTUS] = { geo: mk((b) => { b.cyl(0.07, 0.08, 0.6, 0, 0, 0, '#5c8f3e', 6); b.cyl(0.04, 0.05, 0.25, 0.12, 0.25, 0, '#5c8f3e', 6); b.cyl(0.04, 0.05, 0.2, -0.11, 0.32, 0, '#6aa048', 6); }), mat: std };
  kinds[PROP.BUSH] = { geo: mk((b) => { b.sphere(0.2, 0, 0.12, 0, '#5d9e44', 6, 4, 0.7); b.sphere(0.14, 0.15, 0.1, 0.08, '#72b552', 6, 4, 0.7); }), mat: std };

  const tileInst = new Map<number, { mesh: THREE.InstancedMesh; i: number; m: THREE.Matrix4 }[]>();
  const counts: Record<number, number> = {};
  for (let i = 0; i < w.size * w.size; i++) if (w.prop[i]) counts[w.prop[i]] = (counts[w.prop[i]] ?? 0) + (w.prop[i] === PROP.TREE ? 2 : 1);
  const meshes: Record<number, THREE.InstancedMesh> = {};
  const used: Record<number, number> = {};
  for (const k of Object.keys(counts)) {
    const kk = +k;
    const im = new THREE.InstancedMesh(kinds[kk].geo, kinds[kk].mat, counts[kk]);
    im.castShadow = kk === PROP.TREE || kk === PROP.PINE; im.userData.tree = im.castShadow; im.receiveShadow = true;
    meshes[kk] = im; used[kk] = 0; group.add(im);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const colTmp = new THREE.Color();
  for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++) {
    const i = idx(w, x, y), p = w.prop[i];
    if (!p) continue;
    const n = p === PROP.TREE ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const r1 = hashTile(x, y, 50 + k), r2 = hashTile(x, y, 60 + k), r3 = hashTile(x, y, 70 + k);
      const sc = 0.75 + r3 * 0.6;
      v.set(x + 0.25 + r1 * 0.5, 0, y + 0.25 + r2 * 0.5);
      v.y = groundAt(w, v.x, v.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r1 * 6.28);
      s.set(sc, sc * (0.85 + r2 * 0.4), sc);
      m.compose(v, q, s);
      const im = meshes[p];
      const id = used[p]++;
      im.setMatrixAt(id, m);
      colTmp.setHSL(0, 0, 0.85 + r3 * 0.3);
      im.setColorAt(id, colTmp);
      const arr = tileInst.get(i) ?? [];
      arr.push({ mesh: im, i: id, m: m.clone() });
      tileInst.set(i, arr);
    }
  }
  // deposits: crystals / boulders
  const crystalGeo = new THREE.OctahedronGeometry(0.16, 0);
  crystalGeo.scale(0.7, 1.9, 0.7);
  const boulderGeo = new THREE.DodecahedronGeometry(0.2, 0);
  const depCounts = [0, 0, 0, 0];
  for (let i = 0; i < w.size * w.size; i++) depCounts[w.deposit[i]]++;
  const depositGlow: THREE.Material[] = [];
  const quartzMat = new THREE.MeshStandardMaterial({ color: '#aef6ff', emissive: '#4fdcff', emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.1, flatShading: true });
  const oreMat = new THREE.MeshStandardMaterial({ color: '#b5653a', emissive: '#ff8a3a', emissiveIntensity: 0.15, roughness: 0.8, flatShading: true });
  const rareMat = new THREE.MeshStandardMaterial({ color: '#c6a6ff', emissive: '#a070ff', emissiveIntensity: 0.7, roughness: 0.25, flatShading: true });
  depositGlow.push(quartzMat, oreMat, rareMat);
  const depMeshes: Record<number, THREE.InstancedMesh> = {
    [DEPOSIT.QUARTZ]: new THREE.InstancedMesh(crystalGeo, quartzMat, depCounts[1] * 3),
    [DEPOSIT.ORE]: new THREE.InstancedMesh(boulderGeo, oreMat, depCounts[2] * 3),
    [DEPOSIT.RARE]: new THREE.InstancedMesh(crystalGeo, rareMat, depCounts[3] * 3),
  };
  const depUsed = [0, 0, 0, 0];
  for (const k of [1, 2, 3]) { depMeshes[k].castShadow = false; group.add(depMeshes[k]); }
  for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++) {
    const i = idx(w, x, y), d = w.deposit[i];
    if (!d) continue;
    for (let k = 0; k < 3; k++) {
      const r1 = hashTile(x, y, 80 + k), r2 = hashTile(x, y, 90 + k), r3 = hashTile(x, y, 99 + k);
      const sc = 0.6 + r3 * 0.8;
      v.set(x + 0.2 + r1 * 0.6, 0, y + 0.2 + r2 * 0.6);
      v.y = groundAt(w, v.x, v.z) + (d === 2 ? 0.08 : 0.12);
      q.setFromEuler(new THREE.Euler((r1 - 0.5) * 0.6, r2 * 6, (r3 - 0.5) * 0.6));
      s.set(sc, sc, sc);
      m.compose(v, q, s);
      const im = depMeshes[d];
      const id = depUsed[d]++;
      im.setMatrixAt(id, m);
      const arr = tileInst.get(i) ?? [];
      arr.push({ mesh: im, i: id, m: m.clone() });
      tileInst.set(i, arr);
    }
  }
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  return {
    group,
    depositGlow,
    clear(x, y) {
      const arr = tileInst.get(idx(w, x, y));
      if (!arr) return;
      for (const e of arr) { e.mesh.setMatrixAt(e.i, zero); e.mesh.instanceMatrix.needsUpdate = true; }
    },
    restore(x, y) {
      const arr = tileInst.get(idx(w, x, y));
      if (!arr) return;
      for (const e of arr) { e.mesh.setMatrixAt(e.i, e.m); e.mesh.instanceMatrix.needsUpdate = true; }
    },
  };
}
