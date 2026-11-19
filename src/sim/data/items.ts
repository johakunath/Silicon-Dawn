import type { ItemId, LinkKind } from '../types';

export interface ItemDef {
  id: ItemId;
  name: string;
  color: string;
  kind: 'solid' | 'fluid' | 'data';
  shape: 'diamond' | 'cube' | 'square' | 'octa' | 'tetra' | 'sphere' | 'streak';
  /** link kind used when this item flows */
  link: LinkKind;
  /** render: one packet represents this many units */
  packet: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  quartz: { id: 'quartz', name: 'Quartz', color: '#bff8ff', kind: 'solid', shape: 'diamond', link: 'conveyor', packet: 0.5 },
  ore: { id: 'ore', name: 'Ore', color: '#d98a4a', kind: 'solid', shape: 'cube', link: 'conveyor', packet: 0.5 },
  silicon: { id: 'silicon', name: 'Silicon', color: '#8ff3ff', kind: 'solid', shape: 'diamond', link: 'conveyor', packet: 0.5 },
  metal: { id: 'metal', name: 'Metal', color: '#ffb347', kind: 'solid', shape: 'cube', link: 'conveyor', packet: 0.5 },
  chips: { id: 'chips', name: 'Chips', color: '#5dff9a', kind: 'solid', shape: 'square', link: 'conveyor', packet: 0.25 },
  rare: { id: 'rare', name: 'Rare Earth', color: '#b98cff', kind: 'solid', shape: 'tetra', link: 'conveyor', packet: 0.25 },
  accel: { id: 'accel', name: 'Accelerators', color: '#ff4fd8', kind: 'solid', shape: 'octa', link: 'conveyor', packet: 0.1 },
  robots: { id: 'robots', name: 'Robots', color: '#ffe066', kind: 'solid', shape: 'cube', link: 'conveyor', packet: 0.1 },
  water: { id: 'water', name: 'Water', color: '#4fb4ff', kind: 'fluid', shape: 'sphere', link: 'pipe', packet: 0.5 },
  coolant: { id: 'coolant', name: 'Coolant', color: '#c8f7ff', kind: 'fluid', shape: 'sphere', link: 'pipe', packet: 0.5 },
  compute: { id: 'compute', name: 'Compute', color: '#6fe9ff', kind: 'data', shape: 'streak', link: 'cable', packet: 2 },
};

export const ITEM_ORDER: ItemId[] = ['quartz', 'ore', 'silicon', 'metal', 'chips', 'rare', 'accel', 'robots', 'water', 'coolant', 'compute'];

export interface LinkDef {
  kind: LinkKind;
  name: string;
  capacity: number; // items/s base
  speed: number; // tiles/s (visual + latency)
  maxLength: number;
  costPerTile: Partial<Record<ItemId, number>>;
  color: string;
}

export const LINKS: Record<LinkKind, LinkDef> = {
  conveyor: { kind: 'conveyor', name: 'Conveyor', capacity: 2, speed: 2.2, maxLength: 14, costPerTile: {}, color: '#5a5f6e' },
  pipe: { kind: 'pipe', name: 'Pipe', capacity: 4, speed: 3.5, maxLength: 16, costPerTile: {}, color: '#3c6e9e' },
  cable: { kind: 'cable', name: 'Data Cable', capacity: 16, speed: 7, maxLength: 14, costPerTile: {}, color: '#2b3550' },
  fiber: { kind: 'fiber', name: 'Fiber', capacity: 80, speed: 16, maxLength: 30, costPerTile: {}, color: '#1b2240' },
};
