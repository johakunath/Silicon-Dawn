// M0 tech spike: terrain + water + props + lit buildings + day/night + bloom.
import './style.css';
import * as THREE from 'three';
import { SceneRig } from './render/scene';
import { buildProps, buildTerrain, buildWater, tileHeight } from './render/terrain';
import { generateWorld } from './sim/world';
import { getModel } from './render/models';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const rig = new SceneRig(canvas);
const world = generateWorld(20261119);
rig.scene.add(buildTerrain(world));
const water = buildWater(world);
rig.scene.add(water.mesh);
const props = buildProps(world);
rig.scene.add(props.group);
rig.target.set(world.cx + 0.5, 1.1, world.cy + 0.5);

const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15, flatShading: true });
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const place = (type: string, x: number, y: number, size: number) => {
  const m = getModel(type);
  const h = tileHeight(world, x, y);
  const g = new THREE.Group();
  const body = new THREE.Mesh(m.body, bodyMat);
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  if (m.glow) g.add(new THREE.Mesh(m.glow, glowMat));
  if (m.spin) {
    const s = new THREE.Mesh(m.spin.geo, bodyMat);
    s.position.copy(m.spin.pivot);
    s.castShadow = true;
    s.userData.spin = m.spin;
    g.add(s);
  }
  g.position.set(x + size / 2, h, y + size / 2);
  rig.scene.add(g);
  for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) props.clear(xx, yy);
  return g;
};
const cx = world.cx, cy = world.cy;
const demo: [string, number, number, number][] = [
  ['hq', cx - 1, cy - 1, 3], ['hall', cx + 3, cy - 2, 3], ['cooler', cx + 3, cy + 2, 2], ['solar', cx - 4, cy - 1, 2],
  ['solar', cx - 4, cy + 1, 2], ['rack', cx - 1, cy + 3, 1], ['rack', cx, cy + 3, 1], ['rack', cx + 1, cy + 3, 1], ['wind', cx - 3, cy - 4, 2],
  ['fab', cx - 1, cy - 5, 3], ['pole', cx + 2, cy + 3, 1], ['gateway', cx + 6, cy + 1, 2], ['trainer', cx + 6, cy - 3, 3], ['furnace', cx - 7, cy + 1, 2],
  ['quarry', cx - 9, cy + 1, 2], ['smelter', cx + 2, cy + 6, 2], ['drill', cx + 2, cy + 8, 2], ['battery', cx - 4, cy + 3, 2], ['pod', cx - 6, cy - 3, 2],
  ['fusion', cx + 9, cy - 1, 3], ['substation', cx - 7, cy - 6, 2], ['engine', cx - 12, cy - 6, 4],
];
const groups = demo.map(([t, x, y, s]) => place(t, x, y, s));

let tod = 0.42;
const clock = new THREE.Clock();
let frames = 0, fpsT = 0;
const fpsEl = document.createElement('div');
fpsEl.style.cssText = 'position:fixed;top:8px;left:8px;color:#fff;font:16px monospace;z-index:5';
document.body.appendChild(fpsEl);
(window as any).__sd = { setTod: (t: number) => (tod = t), rig };
const keys = new Set<string>();
addEventListener('keydown', (e) => keys.add(e.key));
addEventListener('keyup', (e) => keys.delete(e.key));
addEventListener('wheel', (e) => { rig.view = THREE.MathUtils.clamp(rig.view * (e.deltaY > 0 ? 1.1 : 0.9), 5, 70); });
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  if (!(window as any).__freeze) tod = (tod + dt / 90) % 1;
  const sp = rig.view * 0.04;
  if (keys.has('w')) rig.target.x -= sp, rig.target.z -= sp;
  if (keys.has('s')) rig.target.x += sp, rig.target.z += sp;
  if (keys.has('a')) rig.target.x -= sp, rig.target.z += sp;
  if (keys.has('d')) rig.target.x += sp, rig.target.z -= sp;
  rig.updateCamera();
  rig.setTimeOfDay(tod, 3);
  glowMat.color.setScalar(rig.glowLevel);
  for (const m of props.depositGlow) (m as THREE.MeshStandardMaterial).emissiveIntensity = (m === props.depositGlow[1] ? 0.05 : 0.2) + rig.night * (m === props.depositGlow[1] ? 0.1 : 0.5);
  water.uniforms.uTime.value = t;
  water.uniforms.uSunDir.value.copy(rig.night > 0.6 ? new THREE.Vector3(-0.4, 0.8, -0.3).normalize() : rig.sunDir);
  water.uniforms.uSunCol.value.copy(rig.night > 0.6 ? new THREE.Color(0.5, 0.6, 0.9) : rig.sunColor);
  water.uniforms.uNight.value = rig.night;
  for (const g of groups) for (const c of g.children) if (c.userData.spin) {
    const s = c.userData.spin; c.rotation[s.axis as 'x'] += dt * s.speed;
  }
  rig.render(t);
  frames++; fpsT += dt;
  if (fpsT > 0.5) { fpsEl.textContent = Math.round(frames / fpsT) + ' fps'; frames = 0; fpsT = 0; }
  requestAnimationFrame(frame);
}
frame();
