import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Per-era colour grading. */
export const ERA_GRADE: Record<number, { tint: THREE.Color; sat: number; bloom: number; fogDay: string; fogNight: string; nightGlow: number }> = {
  1: { tint: new THREE.Color(1.06, 0.98, 0.88), sat: 1.0, bloom: 0.45, fogDay: '#f0d9b0', fogNight: '#141a33', nightGlow: 1.0 },
  2: { tint: new THREE.Color(1.0, 1.0, 1.02), sat: 1.08, bloom: 0.5, fogDay: '#cfe8ff', fogNight: '#0d1530', nightGlow: 1.15 },
  3: { tint: new THREE.Color(0.97, 1.0, 1.05), sat: 1.05, bloom: 0.6, fogDay: '#c4d8ec', fogNight: '#0a1028', nightGlow: 1.3 },
  4: { tint: new THREE.Color(0.96, 0.98, 1.08), sat: 1.12, bloom: 0.7, fogDay: '#bcd2e8', fogNight: '#120a2c', nightGlow: 1.45 },
  5: { tint: new THREE.Color(1.04, 1.0, 1.08), sat: 1.15, bloom: 0.85, fogDay: '#e8dcff', fogNight: '#140a30', nightGlow: 1.6 },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uSat: { value: 1 },
    uVig: { value: 0.35 },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uAurora: { value: 0 },
    uT: { value: 0 },
    uEvent: { value: new THREE.Vector4(0, 0, 0, 0) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 uTint; uniform float uSat; uniform float uVig; uniform float uTime; uniform float uFlash;
    uniform float uAurora; uniform float uT; uniform vec4 uEvent;
    varying vec2 vUv;
    float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))+uTime)*43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uTint;
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(l), col, uSat);
      // aurora curtains across the top of the screen (era V nights + finale)
      if (uAurora > 0.001) {
        float x = vUv.x;
        float band = 0.5 + 0.5 * sin(x * 7.0 + uT * 0.35 + sin(x * 17.0 + uT * 0.9) * 0.9);
        float band2 = 0.5 + 0.5 * sin(x * 11.0 - uT * 0.25 + 1.7);
        float top = smoothstep(0.62, 1.0, vUv.y);
        float curtain = top * band * (0.7 + 0.3 * sin(vUv.y * 5.0 + x * 3.0 + uT * 0.6));
        col += vec3(0.15, 1.0, 0.55) * curtain * uAurora * 0.35 + vec3(0.65, 0.3, 1.0) * top * band2 * band2 * uAurora * 0.25;
      }
      // event grading: rgb tint & strength (heatwave warm, dust brown, outage flicker)
      col = mix(col, col * uEvent.rgb, uEvent.a);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d*vec2(1.1,1.0)));
      col *= mix(1.0 - uVig, 1.0, v);
      col += (rnd(vUv*vec2(1920.,1080.)) - 0.5) * 0.018;
      col += vec3(1.0,0.95,0.85) * uFlash;
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class SceneRig {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  sun = new THREE.DirectionalLight(0xffffff, 2.2);
  moon = new THREE.DirectionalLight(0x8fa8ff, 0.0);
  hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a4a3a, 0.9);
  target = new THREE.Vector3(64, 1, 64);
  /** half-height of view in world units (lower = zoomed in) */
  view = 13;
  yaw = Math.PI / 4;
  pitch = 0.62;
  night = 0; // 0 day .. 1 night
  glowLevel = 1; // multiplier for emissive materials (set by caller)
  sunDir = new THREE.Vector3();
  sunColor = new THREE.Color();
  private fogDay = new THREE.Color();
  private fogNight = new THREE.Color();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    const a = window.innerWidth / window.innerHeight;
    this.camera = new THREE.OrthographicCamera(-this.view * a, this.view * a, this.view, -this.view, -500, 1000);
    this.scene.background = new THREE.Color('#bfe3ff');
    this.scene.fog = new THREE.Fog('#bfe3ff', 150, 420);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(3072, 3072);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target, this.moon, this.moon.target, this.hemi);
    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.updateCamera();
  }

  updateCamera() {
    const a = window.innerWidth / window.innerHeight;
    const v = this.view;
    this.camera.left = -v * a; this.camera.right = v * a; this.camera.top = v; this.camera.bottom = -v;
    const d = 200;
    const dir = new THREE.Vector3(Math.cos(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.sin(this.yaw) * Math.cos(this.pitch));
    this.camera.position.copy(this.target).addScaledVector(dir, d);
    this.camera.lookAt(this.target);
    this.camera.near = 1; this.camera.far = 600;
    this.camera.updateProjectionMatrix();
    // shadow frustum follows the view
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    const ext = Math.min(90, v * a * 1.25 + 6);
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 400;
    sc.updateProjectionMatrix();
  }

  /** tod 0..1 (0 = midnight, .5 = noon) */
  setTimeOfDay(tod: number, era: number, auroraBoost = 0, bias = 0) {
    const g = ERA_GRADE[era] ?? ERA_GRADE[1];
    const ang = (tod - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang) + bias;
    const day = THREE.MathUtils.smoothstep(elev, -0.12, 0.22);
    this.night = 1 - day;
    // sun path: east → south → west
    this.sunDir.set(Math.cos(ang) * 0.8, Math.max(0.12, elev), 0.45 + Math.sin(ang) * 0.1).normalize();
    const low = 1 - THREE.MathUtils.smoothstep(elev, 0.0, 0.5);
    this.sunColor.setRGB(1, 0.93 - low * 0.35, 0.82 - low * 0.55);
    this.sun.color.copy(this.sunColor);
    this.sun.intensity = 2.6 * day;
    this.sun.position.copy(this.target).addScaledVector(this.sunDir, 150);
    this.sun.target.position.copy(this.target);
    this.moon.position.copy(this.target).add(new THREE.Vector3(-60, 120, -40));
    this.moon.target.position.copy(this.target);
    this.moon.intensity = 0.55 * this.night;
    this.hemi.intensity = 0.35 + 0.65 * day;
    this.hemi.color.setRGB(0.55 + 0.25 * day, 0.62 + 0.25 * day, 0.85 + 0.1 * day);
    this.hemi.groundColor.setRGB(0.2 + 0.15 * day, 0.18 + 0.12 * day, 0.25 + 0.05 * day);
    this.fogDay.set(g.fogDay);
    this.fogNight.set(g.fogNight);
    const fog = this.fogDay.clone().lerp(this.fogNight, this.night);
    if (auroraBoost > 0) fog.lerp(new THREE.Color('#2a1460'), auroraBoost * this.night * 0.5);
    (this.scene.background as THREE.Color).copy(fog);
    (this.scene.fog as THREE.Fog).color.copy(fog);
    this.bloom.strength = g.bloom * (0.45 + this.night * 0.45);
    this.bloom.threshold = 0.86 - this.night * 0.04;
    this.grade.uniforms.uTint.value.copy(g.tint).lerp(new THREE.Color(0.82, 0.9, 1.15), this.night * 0.6);
    this.grade.uniforms.uSat.value = g.sat * (1 - this.night * 0.15);
    this.renderer.toneMappingExposure = 1.0 + this.night * 0.25;
    this.glowLevel = (0.95 + this.night * 0.55) * (0.85 + (g.nightGlow - 1) * 0.5);
  }

  aurora = 0;
  event = new THREE.Vector4(1, 1, 1, 0);
  render(time: number, flash = 0) {
    this.grade.uniforms.uTime.value = time % 10;
    this.grade.uniforms.uT.value = time % 1000;
    this.grade.uniforms.uAurora.value = this.aurora;
    this.grade.uniforms.uEvent.value.copy(this.event);
    this.grade.uniforms.uFlash.value = flash;
    this.composer.render();
  }

  /** world point under a screen pixel, on plane y = h */
  screenToGround(px: number, py: number, h = 1.1): THREE.Vector3 | null {
    const ndc = new THREE.Vector2((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -h);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out) ? out : null;
  }
  raycaster(px: number, py: number) {
    const ndc = new THREE.Vector2((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }
  worldToScreen(v: THREE.Vector3): { x: number; y: number } {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
  }
}
