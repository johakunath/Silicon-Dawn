import type { TechDef } from '../types';

export const TECHS: TechDef[] = [
  // Efficiency
  { id: 'bifacial', name: 'Bifacial Panels', branch: 'efficiency', era: 1, cost: 12, desc: 'Solar output +30%.', effect: { solarMul: 0.3 } },
  { id: 'arc', name: 'Arc Furnace Tuning', branch: 'efficiency', era: 2, cost: 30, requires: ['bifacial'], desc: 'Furnaces, smelters and fabs run 25% faster.', effect: { refineMul: 0.25 } },
  { id: 'containment', name: 'Hot-Aisle Containment', branch: 'efficiency', era: 2, cost: 45, requires: ['arc'], desc: 'Coolant removes 35% more heat, so racks need less of it.', effect: { coolingMul: 0.35 } },
  { id: 'freecool', name: 'Free Cooling', branch: 'efficiency', era: 3, cost: 110, requires: ['containment'], desc: 'Cooling towers and chillers use 40% less power. PUE drops.', effect: { coolingPowerMul: -0.4 } },
  { id: 'lowprec', name: 'Low-Precision Math', branch: 'efficiency', era: 4, cost: 260, requires: ['freecool'], desc: 'All compute output +25%: the same silicon does more useful work.', effect: { computeMul: 0.25 } },
  { id: 'immersion', name: 'Immersion Cooling', branch: 'efficiency', era: 4, cost: 320, requires: ['lowprec'], desc: 'Heat tolerance +40% and coolant effectiveness +30%.', effect: { heatTolerance: 0.4, coolingMul: 0.3 } },
  // Capacity
  { id: 'belts', name: 'Fast Belts', branch: 'capacity', era: 1, cost: 15, desc: 'Conveyor capacity +60%.', effect: { conveyorMul: 0.6 } },
  { id: 'drills', name: 'Deep Drills', branch: 'capacity', era: 2, cost: 35, requires: ['belts'], desc: 'Extractors +35%.', effect: { extractMul: 0.35 } },
  { id: 'buffers', name: 'Staging Buffers', branch: 'capacity', era: 2, cost: 40, requires: ['belts'], desc: 'Building buffers ×2.5, which absorb jitter in supply.', effect: { bufferMul: 1.5 } },
  { id: 'dense', name: 'Dense Racks', branch: 'capacity', era: 3, cost: 120, requires: ['drills'], desc: 'Compute +15% and data cable capacity +50%.', effect: { computeMul: 0.15, dataMul: 0.5 } },
  { id: 'fiber', name: 'Fiber Optics', branch: 'capacity', era: 4, cost: 150, requires: ['dense'], desc: 'New compute links are fiber (5× bandwidth, 30-tile reach) and Fiber Switches unlock. Training over fiber is twice as efficient.', effect: { fiber: 1 } },
  { id: 'express', name: 'Express Belts', branch: 'capacity', era: 4, cost: 200, requires: ['fiber'], desc: 'Conveyor capacity +100%.', effect: { conveyorMul: 1.0 } },
  { id: 'fusion', name: 'Fusion Ignition', branch: 'capacity', era: 4, cost: 420, requires: ['express'], desc: 'Unlocks the (fictional) Fusion Reactor: 200 firm, clean power.', effect: { fusion: 1 } },
  // Reliability
  { id: 'cells', name: 'Deep-Cycle Cells', branch: 'reliability', era: 1, cost: 15, desc: 'Battery capacity +60%.', effect: { batteryMul: 0.6 } },
  { id: 'protect', name: 'Grid Protection', branch: 'reliability', era: 3, cost: 90, requires: ['cells'], desc: 'Events are 35% milder.', effect: { eventResist: 0.35 } },
  { id: 'robots', name: 'Automation', branch: 'reliability', era: 4, cost: 160, requires: ['protect'], desc: 'Unlocks Robot Factories and Robot Hubs: +30% speed and instant repairs nearby.', effect: { robots: 1 } },
  { id: 'selfheal', name: 'Self-Healing Grid', branch: 'reliability', era: 4, cost: 260, requires: ['robots'], desc: 'Broken buildings repair 3× faster everywhere, and events are 25% milder.', effect: { autoRepair: 2, eventResist: 0.25 } },
];

export const TECH: Record<string, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t]));
