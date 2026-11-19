// Local power grids: nodes (poles/substations/generators/batteries/HQ) form components;
// consumers attach to a component when covered by a node's radius.
import { BUILDING } from './data/buildings';
import type { GameState, GridInfo } from './state';
import type { Building } from './types';

function footprintDist(b: Building, size: number, px: number, py: number): number {
  const dx = Math.max(b.x - px, 0, px - (b.x + size));
  const dy = Math.max(b.y - py, 0, py - (b.y + size));
  return Math.hypot(dx, dy);
}

export function rebuildGrids(s: GameState) {
  const nodes = s.buildings.filter((b) => BUILDING[b.type].node);
  const parent = new Map<number, number>();
  const find = (a: number): number => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = a;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const n of nodes) parent.set(n.id, n.id);
  const edges: [number, number][] = [];
  // sort pairs by distance so wires form a short spanning forest
  const pairs: [number, Building, Building][] = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i], da = BUILDING[a.type];
    const ax = a.x + da.size / 2, ay = a.y + da.size / 2;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j], db = BUILDING[b.type];
      const bx = b.x + db.size / 2, by = b.y + db.size / 2;
      const d = Math.hypot(ax - bx, ay - by);
      const reach = Math.min(da.node!.reach, db.node!.reach);
      const covered = footprintDist(b, db.size, ax, ay) <= da.node!.radius || footprintDist(a, da.size, bx, by) <= db.node!.radius;
      if (d <= reach || covered) pairs.push([d, a, b]);
    }
  }
  pairs.sort((p, q) => p[0] - q[0]);
  for (const [, a, b] of pairs) {
    const ra = find(a.id), rb = find(b.id);
    if (ra !== rb) { parent.set(ra, rb); edges.push([a.id, b.id]); }
  }
  const compIndex = new Map<number, number>();
  const grids: GridInfo[] = [];
  for (const n of nodes) {
    const r = find(n.id);
    if (!compIndex.has(r)) { compIndex.set(r, grids.length); grids.push({ id: grids.length, gen: 0, demand: 0, sat: 1, stored: 0, capacity: 0, nodes: [], clean: 1 }); }
    const gi = compIndex.get(r)!;
    n.grid = gi;
    grids[gi].nodes.push(n.id);
  }
  // consumers: attach to nearest covering node
  for (const b of s.buildings) {
    const d = BUILDING[b.type];
    if (d.node) continue;
    b.grid = -1;
    let best = Infinity;
    for (const n of nodes) {
      const dn = BUILDING[n.type];
      const nx = n.x + dn.size / 2, ny = n.y + dn.size / 2;
      const dist = footprintDist(b, d.size, nx, ny);
      if (dist <= dn.node!.radius && dist < best) { best = dist; b.grid = n.grid; }
    }
  }
  s.grids = grids;
  s.gridEdges = edges;
  s.gridDirty = false;
}

/** Is tile (x,y) covered by any power node? Used for placement hints. */
export function coveredAt(s: GameState, x: number, y: number, size: number): boolean {
  for (const n of s.buildings) {
    const dn = BUILDING[n.type];
    if (!dn.node) continue;
    const nx = n.x + dn.size / 2, ny = n.y + dn.size / 2;
    const dx = Math.max(x - nx, 0, nx - (x + size));
    const dy = Math.max(y - ny, 0, ny - (y + size));
    if (Math.hypot(dx, dy) <= dn.node.radius) return true;
  }
  return false;
}
