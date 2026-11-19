import * as THREE from 'three';

const MAX = 6000;

export type PKind = 'steam' | 'smoke' | 'heat' | 'spark' | 'dust' | 'burst' | 'aurora';

/** GPU point particles: one draw call, CPU-integrated. */
export class Particles {
  points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 4);
  private size = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private kind = new Uint8Array(MAX);
  private n = 0;
  private uniforms = { uScale: { value: 30 }, uPixel: { value: 1 } };
  reduced = false;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale; uniform float uPixel;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * uScale * uPixel; }`,
      fragmentShader: `
        varying vec4 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; float a = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(vC.rgb, vC.a * a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** px per world unit (depends on ortho zoom) */
  setScale(pxPerUnit: number, dpr: number) { this.uniforms.uScale.value = pxPerUnit; this.uniforms.uPixel.value = dpr; }

  emit(kind: PKind, x: number, y: number, z: number, count = 1, spread = 0.1) {
    if (this.reduced && kind !== 'burst') count = Math.ceil(count * 0.3);
    for (let c = 0; c < count; c++) {
      if (this.n >= MAX) return;
      const i = this.n++;
      this.pos[i * 3] = x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
      let vx = (Math.random() - 0.5) * 0.15, vy = 0.6, vz = (Math.random() - 0.5) * 0.15, life = 3, size = 0.4;
      let r = 1, g = 1, b = 1, a = 0.5;
      switch (kind) {
        case 'steam': vy = 0.7 + Math.random() * 0.4; life = 3.5 + Math.random() * 1.5; size = 0.45; a = 0.55; r = g = b = 0.95; break;
        case 'smoke': vy = 0.55 + Math.random() * 0.3; life = 4; size = 0.35; a = 0.45; r = 0.32; g = 0.3; b = 0.3; break;
        case 'heat': vy = 0.9; life = 1.2; size = 0.28; a = 0.35; r = 1.0; g = 0.35; b = 0.12; break;
        case 'spark': vx *= 6; vz *= 6; vy = 1.2 + Math.random(); life = 0.6; size = 0.08; a = 1; r = 1.6; g = 1.2; b = 0.5; break;
        case 'dust': { const ang = Math.random() * 6.28, sp = 1.2 + Math.random() * 1.4; vx = Math.cos(ang) * sp; vz = Math.sin(ang) * sp; vy = 0.25 + Math.random() * 0.4; life = 0.9; size = 0.32; a = 0.6; r = 0.85; g = 0.78; b = 0.62; break; }
        case 'burst': { const ang = Math.random() * 6.28, sp = 2 + Math.random() * 3; vx = Math.cos(ang) * sp; vz = Math.sin(ang) * sp; vy = 1.5 + Math.random() * 3; life = 1.4; size = 0.14; a = 1; r = 1.4; g = 1.3; b = 0.9; break; }
        case 'aurora': vy = 0.25; vx = 0.3; life = 6; size = 1.6; a = 0.18; r = 0.4; g = 1.2; b = 0.8; break;
      }
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.kind[i] = kind === 'steam' ? 0 : kind === 'smoke' ? 1 : kind === 'heat' ? 2 : kind === 'spark' ? 3 : kind === 'dust' ? 4 : kind === 'burst' ? 5 : 6;
      this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    }
  }

  tint(r: number, g: number, b: number) {
    // set colour of the most recently emitted particle batch (burst colours)
    const i = this.n - 1;
    if (i < 0) return;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b;
  }

  update(dt: number, night: number) {
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      if (j !== i) {
        for (let k = 0; k < 3; k++) { this.pos[j * 3 + k] = this.pos[i * 3 + k]; this.vel[j * 3 + k] = this.vel[i * 3 + k]; }
        for (let k = 0; k < 4; k++) this.col[j * 4 + k] = this.col[i * 4 + k];
        this.life[j] = this.life[i]; this.maxLife[j] = this.maxLife[i]; this.size[j] = this.size[i]; this.kind[j] = this.kind[i];
      }
      const t = 1 - this.life[j] / this.maxLife[j];
      const kd = this.kind[j];
      if (kd <= 1) { this.vel[j * 3] += 0.18 * dt; this.size[j] += dt * 0.45; this.vel[j * 3 + 1] *= 1 - dt * 0.25; }
      if (kd === 3 || kd === 5) this.vel[j * 3 + 1] -= 4 * dt;
      if (kd === 4) { this.vel[j * 3] *= 1 - dt * 3; this.vel[j * 3 + 2] *= 1 - dt * 3; this.vel[j * 3 + 1] -= 0.5 * dt; }
      this.pos[j * 3] += this.vel[j * 3] * dt;
      this.pos[j * 3 + 1] += this.vel[j * 3 + 1] * dt;
      this.pos[j * 3 + 2] += this.vel[j * 3 + 2] * dt;
      const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      const base = kd === 0 ? 0.55 * (1 - night * 0.5) : kd === 1 ? 0.45 : kd === 2 ? 0.35 : kd === 6 ? 0.2 : 1;
      this.col[j * 4 + 3] = base * Math.max(0, fade);
      j++;
    }
    this.n = j;
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
  }
}
