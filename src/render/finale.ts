import * as THREE from 'three';

/** Dawn Engine finale: a light column into the sky plus an expanding flash wave (buildings layer reads `wave`). */
export class FinaleFX {
  group = new THREE.Group();
  private column: THREE.Mesh;
  private halo: THREE.Mesh;
  private uniforms = { uI: { value: 0 }, uT: { value: 0 } };
  wave = { x: 0, z: 0, r: -1 }; // r < 0 = inactive
  intensity = 0;

  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uI; uniform float uT; varying vec2 vUv;
        void main(){
          float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.3) * uI;
          float stripes = 0.75 + 0.25 * sin(vUv.y * 60.0 - uT * 8.0);
          vec3 c = mix(vec3(1.0, 0.85, 0.55), vec3(0.75, 0.9, 1.0), vUv.y) * 2.2;
          gl_FragColor = vec4(c * stripes, a * 0.85);
        }`,
    });
    const geo = new THREE.CylinderGeometry(1.2, 0.7, 90, 24, 1, true);
    geo.translate(0, 45, 0);
    this.column = new THREE.Mesh(geo, mat);
    this.column.renderOrder = 8;
    this.column.frustumCulled = false;
    const hgeo = new THREE.RingGeometry(0.5, 3.5, 48).rotateX(-Math.PI / 2);
    this.halo = new THREE.Mesh(hgeo, new THREE.MeshBasicMaterial({ color: '#ffe2a0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.group.add(this.column, this.halo);
    this.group.visible = false;
  }

  place(x: number, y: number, z: number) {
    this.group.position.set(x, y, z);
    this.wave.x = x; this.wave.z = z;
  }

  /** finale 0..1 time-normalised since ignition; charge = engine progress (pre-ignition glow) */
  update(now: number, dt: number, finale: number, charge: number) {
    this.uniforms.uT.value = now;
    const pre = charge > 0.6 ? (charge - 0.6) * 0.5 : 0;
    this.intensity = finale > 0 ? Math.min(1, finale * 6) * (0.85 + 0.15 * Math.sin(now * 3)) : pre * (0.6 + 0.4 * Math.sin(now * 6));
    this.group.visible = this.intensity > 0.01;
    this.uniforms.uI.value = this.intensity;
    const s = 1 + Math.sin(now * 2) * 0.05 + finale * 0.8;
    this.column.scale.set(s, 1, s);
    (this.halo.material as THREE.MeshBasicMaterial).opacity = this.intensity * 0.35 * (1 - ((now * 0.6) % 1));
    this.halo.scale.setScalar(0.6 + ((now * 0.6) % 1) * 1.4);
    if (finale > 0) {
      // expanding flash wave across the base: radius grows to ~90 tiles over the first 30% of the finale
      this.wave.r = finale < 0.35 ? (finale / 0.35) * 90 : -1;
    } else this.wave.r = -1;
    void dt;
  }
}
