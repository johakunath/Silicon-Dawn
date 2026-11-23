import type { BuildingDef, ItemId } from '../types';

// raw quartz/ore must be refined first, so storage only takes refined goods
const SOLIDS: ItemId[] = ['silicon', 'metal', 'chips', 'rare', 'accel', 'robots'];

export const BUILDINGS: BuildingDef[] = [
  // ───────── Era 1 · Sand ─────────
  {
    id: 'hq', name: 'Command Core', short: 'Your base. Stores delivered materials.', era: 1, cat: 'core', size: 3,
    desc: 'The heart of the colony. Refined goods delivered by belt join your stockpile, and links out of it ship stockpiled goods to consumers. It has a small built-in generator and a power node.',
    cost: {}, power: 6, gen: 'core', node: { radius: 6, reach: 10 }, storage: SOLIDS, unique: true,
  },
  {
    id: 'solar', name: 'Solar Array', short: '+6 power in daylight', era: 1, cat: 'power', size: 2, hotkey: '1',
    desc: 'Cheap, clean daytime power. Output follows the sun, so it gives nothing at night. Pair it with batteries.',
    cost: { metal: 8, silicon: 4 }, power: 6, gen: 'solar', node: { radius: 2.5, reach: 4 },
  },
  {
    id: 'pole', name: 'Power Pole', short: 'Extends the grid', era: 1, cat: 'power', size: 1, hotkey: '2',
    desc: 'Connects nearby buildings to the grid (radius 4.5) and links to other poles up to 9 tiles away.',
    cost: { metal: 3 }, power: 0, node: { radius: 4.5, reach: 9 },
  },
  {
    id: 'quarry', name: 'Quartz Extractor', short: 'Mines quartz from crystal deposits', era: 1, cat: 'extract', size: 2, hotkey: '3',
    desc: 'Place it over cyan crystal deposits. More deposit tiles under the footprint means faster output.',
    cost: { metal: 10 }, power: -2, outputs: { quartz: 0.6 }, deposit: 1,
  },
  {
    id: 'drill', name: 'Ore Drill', short: 'Drills metal ore', era: 1, cat: 'extract', size: 2, hotkey: '4',
    desc: 'Place it over rust-coloured ore outcrops. It feeds smelters.',
    cost: { metal: 10, silicon: 2 }, power: -2, outputs: { ore: 0.6 }, deposit: 2,
  },
  {
    id: 'furnace', name: 'Silicon Furnace', short: 'Quartz → silicon', era: 1, cat: 'refine', size: 2, hotkey: '5',
    desc: 'Reduces quartz to metallurgical silicon in an arc furnace. It draws a lot of power for its size.',
    cost: { metal: 14 }, power: -3, inputs: { quartz: 0.6 }, outputs: { silicon: 0.45 },
  },
  {
    id: 'smelter', name: 'Ore Smelter', short: 'Ore → metal', era: 1, cat: 'refine', size: 2, hotkey: '6',
    desc: 'Smelts ore into structural metal, which almost every building needs.',
    cost: { metal: 10, silicon: 4 }, power: -3, inputs: { ore: 0.6 }, outputs: { metal: 0.5 },
  },
  {
    id: 'battery', name: 'Battery Bank', short: 'Stores surplus power', era: 1, cat: 'power', size: 2, hotkey: '7',
    desc: 'Charges from surplus generation and discharges when demand exceeds supply, for example at night.',
    cost: { metal: 14, silicon: 8 }, power: 0, battery: { capacity: 600, rate: 12 }, node: { radius: 2.5, reach: 4 },
  },
  {
    id: 'depot', name: 'Supply Depot', short: 'Drop-off & pickup for the stockpile', era: 1, cat: 'logistics', size: 2, hotkey: '8',
    desc: 'An outpost of your stockpile. Belts can deliver refined goods into it, and you can link it out to any building that needs stockpiled materials (belts out of it stop at a build reserve, so construction always has material).',
    cost: { metal: 16 }, power: 0, storage: SOLIDS,
  },

  {
    id: 'junction', name: 'Junction', short: 'Merge & split belts or pipes', era: 1, cat: 'logistics', size: 1,
    desc: 'A small hub that merges several belts (or pipes) into one and splits one into many. For example, chain three water pumps into one pipe, or relay a belt beyond its 14-tile range.',
    cost: { metal: 2 }, power: 0, junction: true,
  },

  // ───────── Era 2 · Silicon ─────────
  {
    id: 'pump', name: 'Water Pump', short: 'Pumps water (place on a shore)', era: 2, cat: 'cooling', size: 1,
    desc: 'Draws water from an adjacent lake or sea. Fabs and cooling towers need it.',
    cost: { metal: 10 }, power: -1, outputs: { water: 1.2 }, needsWater: true,
  },
  {
    id: 'fab', name: 'Chip Fab', short: 'Silicon + metal + water → chips', era: 2, cat: 'refine', size: 3,
    desc: 'A cleanroom that patterns silicon wafers into chips. It needs ultrapure water and steady power.',
    cost: { metal: 50, silicon: 30 }, power: -8, inputs: { silicon: 0.4, metal: 0.2, water: 0.6 }, outputs: { chips: 0.25 },
  },
  {
    id: 'rack', name: 'Server Rack', short: '+3 compute; runs hot', era: 2, cat: 'compute', size: 1,
    desc: 'Turns power into compute and heat. Without coolant it throttles to about half speed.',
    cost: { metal: 8, chips: 4 }, power: -3, inputs: { coolant: 0.15 }, outputs: { compute: 3 }, it: true,
  },
  {
    id: 'cooler', name: 'Cooling Tower', short: 'Water → coolant (evaporative)', era: 2, cat: 'cooling', size: 2,
    desc: 'Evaporative cooling is very power-efficient but consumes a lot of water. It vents steam.',
    cost: { metal: 22, silicon: 8 }, power: -2, inputs: { water: 0.8 }, outputs: { coolant: 1.0 },
  },
  {
    id: 'lab', name: 'Research Lab', short: 'Compute → research', era: 2, cat: 'workload', size: 2,
    desc: 'Runs experiments on compute delivered by data cable. It produces research points for the tech tree.',
    cost: { metal: 24, silicon: 16, chips: 6 }, power: -4, inputs: { compute: 6 }, workload: 'research',
  },

  // ───────── Era 3 · Datacenter ─────────
  {
    id: 'substation', name: 'Substation', short: 'Large-area grid node', era: 3, cat: 'power', size: 2,
    desc: 'High-voltage node with a radius of 10 that links to other substations up to 20 tiles away.',
    cost: { metal: 30, chips: 4 }, power: 0, node: { radius: 10, reach: 20 },
  },
  {
    id: 'gridbat', name: 'Grid Battery', short: 'Big storage for local grids', era: 3, cat: 'power', size: 2,
    desc: 'Utility-scale storage. It rides through outages and smooths solar.',
    cost: { metal: 40, silicon: 30, chips: 10 }, power: 0, battery: { capacity: 3000, rate: 60 }, node: { radius: 3, reach: 5 },
  },
  {
    id: 'gas', name: 'Gas Turbine', short: '+30 firm power, emits CO₂', era: 3, cat: 'power', size: 2,
    desc: 'Reliable day and night, but it worsens your footprint rating. It goes offline during grid outages.',
    cost: { metal: 50 }, power: 30, gen: 'firm', node: { radius: 3, reach: 5 }, emissions: 1,
  },
  {
    id: 'chiller', name: 'Chiller', short: 'Power → coolant (no water)', era: 3, cat: 'cooling', size: 2,
    desc: 'Mechanical refrigeration. It needs no water but costs about 4× the power of a cooling tower, which worsens PUE.',
    cost: { metal: 36, chips: 8 }, power: -8, outputs: { coolant: 2.0 },
  },
  {
    id: 'hall', name: 'Datacenter Hall', short: '+30 compute; needs coolant', era: 3, cat: 'compute', size: 3,
    desc: 'A dense hall of racks that produces lots of compute and lots of heat. It needs a coolant loop.',
    cost: { metal: 90, silicon: 50, chips: 36 }, power: -36, inputs: { coolant: 1.5 }, outputs: { compute: 30 }, it: true,
  },
  {
    id: 'gateway', name: 'Inference Gateway', short: 'Sells answers to the colony market', era: 3, cat: 'workload', size: 2,
    desc: 'Answers colony requests with your deployed model and earns market revenue. Each takes up to 60 compute/s. Uptime builds reputation; spare capacity keeps latency low.',
    cost: { metal: 30, chips: 12 }, power: -4, inputs: { compute: 60 }, workload: 'inference',
  },
  {
    id: 'trainer', name: 'Training Core', short: 'Trains your next model', era: 3, cat: 'workload', size: 3,
    desc: 'Runs the next model\'s training across all compute linked to it (pick the size with B). Compute over fiber trains about twice as fast and ships a better model.',
    cost: { metal: 60, chips: 30 }, power: -10, inputs: { compute: 240 }, workload: 'training',
  },

  // ───────── Era 4 · Hyperscale ─────────
  {
    id: 'raremine', name: 'Rare Earth Mine', short: 'Mines rare earths', era: 4, cat: 'extract', size: 2,
    desc: 'Place it over violet deposits, which are usually found in tundra and mountains.',
    cost: { metal: 40, chips: 8 }, power: -4, outputs: { rare: 0.4 }, deposit: 3,
  },
  {
    id: 'accfab', name: 'Accelerator Fab', short: 'Chips + rare earth → accelerators', era: 4, cat: 'refine', size: 3,
    desc: 'Advanced packaging. It stacks chips, high-bandwidth memory and rare-earth magnets into AI accelerators.',
    cost: { metal: 120, silicon: 60, chips: 60 }, power: -20, inputs: { chips: 0.3, rare: 0.2 }, outputs: { accel: 0.12 },
  },
  {
    id: 'pod', name: 'Accelerator Pod', short: '+40 compute; mode-tunable', era: 4, cat: 'compute', size: 2,
    desc: 'Liquid-cooled accelerators. Press M to tune the pod: Training mode gives +25% to Training Cores, Inference mode gives +25% to Gateways.',
    cost: { metal: 30, chips: 16, accel: 4 }, power: -24, inputs: { coolant: 1.0 }, outputs: { compute: 40 }, it: true,
  },
  {
    id: 'switch', name: 'Fiber Switch', short: 'Aggregates compute links', era: 4, tech: 'fiber', cat: 'logistics', size: 1,
    desc: 'Merges many compute links into a fat fiber uplink with a bandwidth of 240/s. It is the backbone of training clusters.',
    cost: { metal: 6, chips: 6 }, power: -1, inputs: { compute: 240 }, outputs: { compute: 240 }, passthrough: 240,
  },
  {
    id: 'wind', name: 'Wind Turbine', short: '+14 power, varies with wind', era: 4, cat: 'power', size: 2,
    desc: 'Works day and night but fluctuates. It is stronger on high ground and in the tundra.',
    cost: { metal: 30, silicon: 10 }, power: 14, gen: 'wind', node: { radius: 2.5, reach: 4 },
  },
  {
    id: 'robofab', name: 'Robot Factory', short: 'Chips + metal → robots', era: 4, tech: 'robots', cat: 'refine', size: 2,
    desc: 'Builds maintenance robots. Deliver them to Robot Hubs.',
    cost: { metal: 50, chips: 20 }, power: -6, inputs: { chips: 0.1, metal: 0.3 }, outputs: { robots: 0.08 },
  },
  {
    id: 'hub', name: 'Robot Hub', short: '+30% speed & auto-repair nearby', era: 4, tech: 'robots', cat: 'special', size: 2,
    desc: 'Robots service everything within 8 tiles. Buildings run 30% faster and recover from breakdowns at once.',
    cost: { metal: 40, chips: 10 }, power: -3, inputs: { robots: 0.02 }, hub: 8,
  },
  {
    id: 'fusion', name: 'Fusion Reactor', short: '+200 firm power', era: 4, tech: 'fusion', cat: 'power', size: 3,
    desc: 'A fictional compact stellarator. It needs cooling water and gives enormous clean, firm output.',
    cost: { metal: 300, chips: 120, accel: 20 }, power: 200, gen: 'firm', inputs: { water: 1.0 }, node: { radius: 4, reach: 8 },
  },

  // ───────── Era 5 · Fictional AGI ─────────
  {
    id: 'engine', name: 'Dawn Engine', short: 'The fictional capstone', era: 5, cat: 'special', size: 4,
    desc: 'A purely fictional megaproject. It drinks compute over fiber and accelerators by conveyor until it ignites. The real lessons are the power, cooling and network constraints along the way.',
    cost: { metal: 400, chips: 200, accel: 40 }, power: -120, inputs: { compute: 600, accel: 0.25 }, workload: 'engine', unique: true,
  },
];

export const BUILDING: Record<string, BuildingDef> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

export function def(type: string): BuildingDef {
  const d = BUILDING[type];
  if (!d) throw new Error('Unknown building ' + type);
  return d;
}
