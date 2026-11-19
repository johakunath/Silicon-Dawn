// Player actions. All validation lives here so UI and autoplayer share rules.
import { BUILDING, BUILDINGS } from './data/buildings';
import { ERAS } from './data/eras';
import { ITEMS, LINKS } from './data/items';
import { TECH } from './data/tech';
import { GameState, addBuildingRaw, diffMul, hq, newBuilding, pushFeed, signal } from './state';
import { linksChanged, recomputeFx } from './sim';
import type { Building, BuildingDef, Cost, ItemId, Link, LinkKind } from './types';
import { DEPOSIT, idx, inBounds, isWaterAdjacent } from './world';

export interface PlaceCheck { ok: boolean; reason?: string; richness?: number; cost: Cost }

export function eraRadius(s: GameState): number {
  return s.mode === 'sandbox' ? 64 : ERAS[s.era - 1].radius;
}

export function isUnlocked(s: GameState, d: BuildingDef): boolean {
  if (d.id === 'hq') return false;
  if (s.mode === 'sandbox') return true;
  return d.era <= s.era && (!d.tech || s.techs.includes(d.tech));
}

export function lockReason(s: GameState, d: BuildingDef): string | null {
  if (d.era > s.era && s.mode !== 'sandbox') return `Unlocks in Era ${d.era}`;
  if (d.tech && !s.techs.includes(d.tech) && s.mode !== 'sandbox') return `Research ${TECH[d.tech].name}`;
  return null;
}

export function costOf(s: GameState, d: BuildingDef): Cost {
  const dm = diffMul(s).cost;
  const shortage = s.events.some((e) => e.id === 'shortage' && e.warn <= 0) ? 1.5 : 1;
  const out: Cost = {};
  for (const [k, v] of Object.entries(d.cost) as [ItemId, number][]) out[k] = Math.ceil(v * dm * (k === 'chips' || k === 'accel' ? shortage : 1));
  return out;
}

export function canAfford(s: GameState, c: Cost): boolean {
  for (const [k, v] of Object.entries(c) as [ItemId, number][]) if ((s.stock[k] ?? 0) < v - 1e-6) return false;
  return true;
}
export function missingCost(s: GameState, c: Cost): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(c) as [ItemId, number][]) {
    const have = s.stock[k] ?? 0;
    if (have < v) parts.push(`${Math.ceil(v - have)} ${ITEMS[k].name.toLowerCase()}`);
  }
  return parts.join(', ');
}
function pay(s: GameState, c: Cost) {
  for (const [k, v] of Object.entries(c) as [ItemId, number][]) s.stock[k] = (s.stock[k] ?? 0) - v;
}

export function checkPlace(s: GameState, type: string, x: number, y: number): PlaceCheck {
  const d = BUILDING[type];
  const cost = costOf(s, d);
  const w = s.world;
  if (!isUnlocked(s, d)) return { ok: false, reason: lockReason(s, d) ?? 'Locked', cost };
  if (d.unique && s.buildings.some((b) => b.type === type)) return { ok: false, reason: 'Only one can be built', cost };
  const h = hq(s);
  const hc = h.x + 1.5, hcY = h.y + 1.5;
  const R = eraRadius(s);
  let lvl = -1, dep = 0, water = 0;
  for (let yy = y; yy < y + d.size; yy++) for (let xx = x; xx < x + d.size; xx++) {
    if (!inBounds(w, xx, yy)) return { ok: false, reason: 'Outside the map', cost };
    if (Math.hypot(xx + 0.5 - hc, yy + 0.5 - hcY) > R) return { ok: false, reason: 'Beyond the frontier (it expands next era)', cost };
    const i = idx(w, xx, yy);
    if (s.occ[i]) return { ok: false, reason: 'Blocked by another building', cost };
    const l = w.level[i];
    if (l === 0) water++;
    if (lvl === -1) lvl = l; else if (l !== lvl) return { ok: false, reason: 'Needs flat ground (one terrace level)', cost };
    if (d.deposit && w.deposit[i] === d.deposit) dep++;
  }
  if (water > 0) return { ok: false, reason: 'Cannot build on water', cost };
  let richness = 1;
  if (d.deposit) {
    if (dep === 0) {
      const name = d.deposit === DEPOSIT.QUARTZ ? 'cyan quartz crystals' : d.deposit === DEPOSIT.ORE ? 'rust-coloured ore' : 'violet rare earth';
      return { ok: false, reason: `Must sit on ${name}`, cost };
    }
    richness = dep / (d.size * d.size);
  }
  if (d.needsWater && !isWaterAdjacent(w, x, y, d.size)) return { ok: false, reason: 'Must be next to water (shoreline)', cost };
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${missingCost(s, cost)}`, cost, richness };
  return { ok: true, cost, richness };
}

export function place(s: GameState, type: string, x: number, y: number, opts: { free?: boolean; autoLink?: boolean } = {}): Building | null {
  const c = checkPlace(s, type, x, y);
  if (!c.ok && !(opts.free && c.reason?.startsWith('Need'))) return null;
  if (!opts.free) pay(s, c.cost);
  const b = newBuilding(s.nextId++, type, x, y, s.time);
  b.richness = c.richness ?? 1;
  addBuildingRaw(s, b);
  signal(s, 'build', x, y, type);
  if (opts.autoLink ?? s.autoLink) autoLink(s, b);
  return b;
}

export function demolish(s: GameState, id: number): boolean {
  const b = s.byId.get(id);
  if (!b || b.type === 'hq') return false;
  const d = BUILDING[b.type];
  // refund: full if built < 15s ago, else half
  const frac = s.time - b.built < 15 ? 1 : 0.5;
  for (const [k, v] of Object.entries(costOf(s, d)) as [ItemId, number][]) s.stock[k] = (s.stock[k] ?? 0) + Math.floor(v * frac);
  for (const l of s.links.filter((l) => l.from === id || l.to === id)) removeLink(s, l.id, true);
  s.buildings.splice(s.buildings.indexOf(b), 1);
  s.byId.delete(id);
  for (let y = b.y; y < b.y + d.size; y++) for (let x = b.x; x < b.x + d.size; x++) s.occ[y * s.world.size + x] = 0;
  s.gridDirty = true;
  signal(s, 'demolish', b.x, b.y, b.type);
  return true;
}

// ───────── links ─────────
export function linkKindFor(s: GameState, item: ItemId): LinkKind {
  const k = ITEMS[item].link;
  if (k === 'cable' && s.techs.includes('fiber')) return 'fiber';
  return k;
}

export function accepts(d: BuildingDef, item: ItemId): boolean {
  return !!(d.storage?.includes(item) || d.inputs?.[item] !== undefined);
}

/** item that can flow from a to b (first match), or null. Storage (Core/Depot) ships stockpiled solids to consumers. */
export function linkItem(a: Building, b: Building, s?: GameState): ItemId | null {
  const da = BUILDING[a.type], db = BUILDING[b.type];
  for (const it of Object.keys(da.outputs ?? {}) as ItemId[]) if (accepts(db, it)) return it;
  if (da.storage && !db.storage) {
    for (const it of Object.keys(db.inputs ?? {}) as ItemId[]) {
      if (!da.storage.includes(it)) continue;
      if (s && s.links.some((l) => l.from === a.id && l.to === b.id && l.item === it)) continue;
      return it;
    }
  }
  return null;
}

export function buildingDist(s: GameState, a: Building, b: Building): number {
  const da = BUILDING[a.type], db = BUILDING[b.type];
  // edge-to-edge distance between footprints (Chebyshev-ish gap), plus a little
  const ax = a.x + da.size / 2, ay = a.y + da.size / 2, bx = b.x + db.size / 2, by = b.y + db.size / 2;
  return Math.max(1, Math.hypot(ax - bx, ay - by) - (da.size + db.size) / 4);
}

export interface LinkCheck { ok: boolean; reason?: string; item?: ItemId; kind?: LinkKind; length?: number; cost?: Cost }

export function linkCost(kind: LinkKind, length: number): Cost {
  const c: Cost = {};
  for (const [k, v] of Object.entries(LINKS[kind].costPerTile) as [ItemId, number][]) c[k] = Math.ceil(v * length);
  return c;
}

export function checkLink(s: GameState, fromId: number, toId: number): LinkCheck {
  const a = s.byId.get(fromId), b = s.byId.get(toId);
  if (!a || !b || a === b) return { ok: false, reason: 'Pick two different buildings' };
  const item = linkItem(a, b, s);
  if (!item) {
    const outs = Object.keys(BUILDING[a.type].outputs ?? {});
    if (BUILDING[a.type].storage) return { ok: false, reason: s.links.some((l) => l.from === a.id && l.to === b.id) ? 'Already linked' : `${BUILDING[b.type].name} needs nothing from the stockpile` };
    if (!outs.length) return { ok: false, reason: `${BUILDING[a.type].name} has no output` };
    return { ok: false, reason: `${BUILDING[b.type].name} does not accept ${outs.map((o) => ITEMS[o as ItemId].name.toLowerCase()).join('/')}` };
  }
  if (s.links.some((l) => l.from === fromId && l.to === toId && l.item === item)) return { ok: false, reason: 'Already linked' };
  const kind = linkKindFor(s, item);
  const length = buildingDist(s, a, b);
  if (length > LINKS[kind].maxLength) return { ok: false, reason: `Too far for ${LINKS[kind].name.toLowerCase()} (max ${LINKS[kind].maxLength})`, item, kind, length };
  const cost = linkCost(kind, length);
  if (!canAfford(s, cost)) return { ok: false, reason: `Need ${missingCost(s, cost)}`, item, kind, length, cost };
  return { ok: true, item, kind, length, cost };
}

export function addLink(s: GameState, fromId: number, toId: number, free = false): Link | null {
  const c = checkLink(s, fromId, toId);
  if (!c.ok && !(free && c.reason?.startsWith('Need'))) return null;
  if (!free && c.cost) pay(s, c.cost);
  const l: Link = { id: s.nextLinkId++, from: fromId, to: toId, item: c.item!, kind: c.kind!, length: c.length!, capacity: LINKS[c.kind!].capacity, moved: 0, rate: 0, state: 'idle', total: 0 };
  s.links.push(l);
  linksChanged(s);
  const a = s.byId.get(fromId)!;
  signal(s, 'link', a.x, a.y, l.kind);
  return l;
}

export function removeLink(s: GameState, id: number, silent = false) {
  const i = s.links.findIndex((l) => l.id === id);
  if (i < 0) return;
  const l = s.links[i];
  if (!silent) {
    for (const [k, v] of Object.entries(linkCost(l.kind, l.length)) as [ItemId, number][]) s.stock[k] = (s.stock[k] ?? 0) + Math.floor(v * 0.5);
    signal(s, 'unlink');
  }
  s.links.splice(i, 1);
  linksChanged(s);
}

/** Upgrade compute cables to fiber after researching fiber (re-pays nothing; free conversion as a reward). */
export function upgradeCablesToFiber(s: GameState) {
  for (const l of s.links) if (l.kind === 'cable') l.kind = 'fiber';
  linksChanged(s);
}

/** Auto-connect a freshly placed building to its nearest sensible partners. */
export function autoLink(s: GameState, b: Building) {
  const d = BUILDING[b.type];
  const dist = (o: Building) => buildingDist(s, b, o);
  // outputs → nearest consumer (prefer non-storage consumers without a feeder of this item)
  for (const item of Object.keys(d.outputs ?? {}) as ItemId[]) {
    const kind = linkKindFor(s, item);
    const max = LINKS[kind].maxLength;
    let best: Building | null = null, bestScore = Infinity;
    for (const o of s.buildings) {
      if (o === b) continue;
      const od = BUILDING[o.type];
      if (!accepts(od, item)) continue;
      const dd = dist(o);
      if (dd > max) continue;
      const fed = s.links.some((l) => l.to === o.id && l.item === item);
      // prefer real consumers that are not yet fed; storage is a fallback
      const score = dd + (od.storage ? 6 : 0) + (fed ? 8 : 0);
      if (score < bestScore) { bestScore = score; best = o; }
    }
    if (best) {
      const c = checkLink(s, b.id, best.id);
      if (c.ok) addLink(s, b.id, best.id);
    }
  }
  // inputs ← nearest producer that has spare output (unlinked or linked only to storage)
  for (const item of Object.keys(d.inputs ?? {}) as ItemId[]) {
    const kind = linkKindFor(s, item);
    const max = LINKS[kind].maxLength;
    const cands: [number, Building][] = [];
    for (const o of s.buildings) {
      if (o === b) continue;
      const od = BUILDING[o.type];
      if (!od.outputs?.[item]) continue;
      const dd = dist(o);
      if (dd > max) continue;
      const outs = s.links.filter((l) => l.from === o.id && l.item === item);
      const onlyStorage = outs.every((l) => !!BUILDING[s.byId.get(l.to)!.type].storage);
      if (outs.length && !onlyStorage && !od.it && !od.passthrough) continue;
      cands.push([dd + (outs.length ? 3 : 0), o]);
    }
    if (!cands.length && ITEMS[item].kind === 'solid') {
      // fall back to the nearest Core/Depot that can ship it from the stockpile
      for (const o of s.buildings) {
        const od = BUILDING[o.type];
        if (!od.storage?.includes(item)) continue;
        const dd = dist(o);
        if (dd <= max) cands.push([dd + 10, o]);
      }
    }
    cands.sort((p, q) => p[0] - q[0]);
    // compute sinks/switches gather from several producers
    const want = item === 'compute' ? 8 : 1;
    let n = 0;
    for (const [, o] of cands) {
      if (n >= want) break;
      // compute producers already feeding something: only steal if they feed nothing compute-y
      const od = BUILDING[o.type];
      if (item === 'compute' && (od.it || od.passthrough) && s.links.some((l) => l.from === o.id)) continue;
      const c = checkLink(s, o.id, b.id);
      if (c.ok) { addLink(s, o.id, b.id); n++; }
    }
  }
}

// ───────── research, contracts, misc ─────────
export function canResearch(s: GameState, id: string): { ok: boolean; reason?: string } {
  const t = TECH[id];
  if (!t) return { ok: false, reason: 'Unknown' };
  if (s.techs.includes(id)) return { ok: false, reason: 'Researched' };
  if (t.era > s.era && s.mode !== 'sandbox') return { ok: false, reason: `Era ${t.era}` };
  for (const r of t.requires ?? []) if (!s.techs.includes(r)) return { ok: false, reason: `Requires ${TECH[r].name}` };
  if (s.rp < t.cost) return { ok: false, reason: `${Math.ceil(t.cost - s.rp)} more research` };
  return { ok: true };
}

export function research(s: GameState, id: string): boolean {
  if (!canResearch(s, id).ok) return false;
  s.rp -= TECH[id].cost;
  s.techs.push(id);
  recomputeFx(s);
  if (id === 'fiber') upgradeCablesToFiber(s);
  pushFeed(s, `⚗ Researched ${TECH[id].name}`, 'good');
  signal(s, 'research', undefined, undefined, id);
  return true;
}

export function acceptContract(s: GameState, id: number): boolean {
  const c = s.contracts.find((c) => c.id === id);
  if (!c || c.state !== 'offered') return false;
  if (s.contracts.some((o) => o.state === 'active' && o.kind === c.kind)) return false;
  c.state = 'active';
  c.t = 0; c.progress = 0;
  signal(s, 'contract_accept');
  return true;
}

export function cycleMode(s: GameState, id: number) {
  const b = s.byId.get(id);
  if (!b || b.type !== 'pod') return;
  b.mode = b.mode === 'balanced' ? 'training' : b.mode === 'training' ? 'inference' : 'balanced';
  signal(s, 'mode', b.x, b.y, b.mode);
}

export function repair(s: GameState, id: number): boolean {
  const b = s.byId.get(id);
  if (!b || b.broken <= 0) return false;
  const cost = { metal: 10 };
  if (!canAfford(s, cost)) return false;
  pay(s, cost);
  b.broken = 0;
  signal(s, 'repair', b.x, b.y);
  return true;
}

export function availableBuildings(s: GameState) {
  return BUILDINGS.filter((d) => d.id !== 'hq');
}
