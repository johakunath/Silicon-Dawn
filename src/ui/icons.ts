import * as THREE from 'three';
import { BUILDINGS } from '../sim/data/buildings';
import { ITEMS } from '../sim/data/items';
import type { ItemId } from '../sim/types';
import { getModel } from '../render/models';

const thumbs: Record<string, string> = {};

/** Render every building model once into a PNG thumbnail (one small offscreen renderer). */
export function renderThumbnails() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setClearColor(0x000000, 0);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x403a40, 1.2));
  const sun = new THREE.DirectionalLight(0xfff0dd, 2.6);
  sun.position.set(4, 8, 3);
  scene.add(sun);
  const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15, flatShading: true });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  glow.color.setScalar(1.6);
  for (const d of BUILDINGS) {
    const m = getModel(d.id);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(m.body, body));
    if (m.glow) g.add(new THREE.Mesh(m.glow, glow));
    if (m.spin) { const s = new THREE.Mesh(m.spin.geo, body); s.position.copy(m.spin.pivot); g.add(s); }
    scene.add(g);
    const ext = Math.max(d.size * 0.85, m.height * 0.62);
    const cam = new THREE.OrthographicCamera(-ext, ext, ext, -ext, 0.1, 100);
    cam.position.set(10, 9, 10);
    cam.lookAt(0, m.height * 0.38, 0);
    r.render(scene, cam);
    thumbs[d.id] = canvas.toDataURL('image/png');
    scene.remove(g);
  }
  r.dispose();
}

export function thumb(type: string): string {
  return thumbs[type] ?? '';
}

/** Small SVG resource icon in the item's shape & colour (shared visual language with packets). */
export function itemIcon(id: ItemId | 'rp' | 'power', size = 18): string {
  const s = size;
  if (id === 'rp') return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 20 20"><path d="M7 2h6v2h-1v5l5 8H3l5-8V4H7z" fill="#b98cff"/></svg>`;
  if (id === 'power') return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 20 20"><path d="M11 1 3 12h6l-1 7 8-11h-6z" fill="#ffe066"/></svg>`;
  const it = ITEMS[id];
  const c = it.color;
  switch (it.shape) {
    case 'diamond': return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 20 20"><path d="M10 1 17 10 10 19 3 10z" fill="${c}"/></svg>`;
    case 'cube': return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 20 20"><path d="M10 2 17 6v8l-7 4-7-4V6z" fill="${c}"/><path d="M10 10v8M3 6l7 4 7-4" stroke="#0006" fill="none"/></svg>`;
    case 'square': return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" fill="${c}"/><rect x="7" y="7" width="6" height="6" fill="#0005"/></svg>`;
    case 'octa': return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 20 20"><path d="M10 1 18 10 10 19 2 10z" fill="${c}"/><path d="M2 10h16" stroke="#0006"/></svg>`;
    case 'tetra': return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 20 20"><path d="M10 2 18 17H2z" fill="${c}"/></svg>`;
    case 'sphere': return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" fill="${c}"/></svg>`;
    default: return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 20 20"><rect x="1" y="8" width="18" height="4" fill="${c}"/></svg>`;
  }
}
