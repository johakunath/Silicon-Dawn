import type { EraDef } from '../types';
import type { GameState } from '../state';
import { countType } from '../state';

const del = (s: GameState, k: keyof GameState['stats']['delivered']) => s.stats.delivered[k] ?? 0;
const frac = (v: number, t: number) => Math.min(1, Math.max(0, v / t));
const has = (s: GameState, t: string) => (countType(s, t) > 0 ? 1 : 0);
const working = (s: GameState, t: string) => s.buildings.filter((b) => b.type === t && b.activity > 0.5).length;
const batteryCharge = (s: GameState) => s.buildings.reduce((a, b) => a + (b.type === 'battery' || b.type === 'gridbat' ? b.charge : 0), 0);

export const ERAS: EraDef[] = [
  {
    id: 1, name: 'Sand', subtitle: 'Era I', radius: 17,
    intro: 'A quiet, empty world with sun, sand and stone. Power a foothold, dig, smelt, and feed the Core.',
    guide: ['power', 'logistics'],
    objectives: [
      { id: 'e1_solar', text: 'Build a Solar Array', progress: (s) => has(s, 'solar'), hint: 'Press 1, or pick Solar Array in the build bar.' },
      { id: 'e1_quartz', text: 'Deliver 20 silicon to the Core', progress: (s) => frac(del(s, 'silicon'), 20), hint: 'Quartz Extractor on cyan crystals, then Silicon Furnace. Belts connect automatically.' },
      { id: 'e1_metal', text: 'Deliver 40 metal to the Core', progress: (s) => frac(del(s, 'metal'), 40), hint: 'Ore Drill on rust-coloured ore, then Ore Smelter.' },
      { id: 'e1_battery', text: 'Store 150 energy in batteries', progress: (s) => frac(batteryCharge(s), 150), hint: 'Battery Banks charge from surplus solar. You need them at night.', guide: 'storage' },
      { id: 'e1_stock', text: 'Deliver 200 metal and 120 silicon in total', progress: (s) => (frac(del(s, 'metal'), 200) + frac(del(s, 'silicon'), 120)) / 2, hint: 'Scale up: more extractors, more refiners. Check belts for amber (saturated).' },
    ],
  },
  {
    id: 2, name: 'Silicon', subtitle: 'Era II', radius: 25,
    intro: 'Sand becomes thought. Pump water, fab chips, and light your first racks, then learn how hot compute runs.',
    guide: ['chips', 'compute', 'heat', 'research'],
    objectives: [
      { id: 'e2_fab', text: 'Build a Water Pump and a Chip Fab', progress: (s) => (has(s, 'pump') + has(s, 'fab')) / 2, hint: 'Pumps must sit on a shore tile next to water.' },
      { id: 'e2_chips', text: 'Deliver 30 chips', progress: (s) => frac(del(s, 'chips'), 30), hint: 'Fabs need silicon, metal AND water. Watch their inputs.' },
      { id: 'e2_racks', text: 'Produce 12 compute/s', progress: (s) => frac(s.stats.computeRate, 12), hint: 'Server Racks turn power into compute. Link them to a Research Lab.' },
      { id: 'e2_cool', text: 'Run 4 racks fully cooled', progress: (s) => frac(s.buildings.filter((b) => b.type === 'rack' && b.activity > 0.95 && b.heat < 1).length, 4), hint: 'Cooling Tower: water in, coolant out by pipe to racks.', guide: 'heat' },
      { id: 'e2_rp', text: 'Earn 60 research', progress: (s) => frac(s.stats.rpTotal, 60), hint: 'Research Labs convert compute into research.' },
      { id: 'e2_tech', text: 'Research 3 technologies', progress: (s) => frac(s.techs.length, 3), hint: 'Open the Tech panel (T).' },
    ],
  },
  {
    id: 3, name: 'Datacenter', subtitle: 'Era III', radius: 35,
    intro: 'The building that never sleeps. Run local grids with substations and storage, closed coolant loops, and the first real workloads.',
    guide: ['pue', 'training', 'reliability', 'footprint'],
    objectives: [
      { id: 'e3_grid', text: 'Build a Substation and a Grid Battery', progress: (s) => (has(s, 'substation') + has(s, 'gridbat')) / 2, hint: 'Substations cover a radius of 10 and link up to 20 tiles.' },
      { id: 'e3_hall', text: 'Run a Datacenter Hall at full speed', progress: (s) => (working(s, 'hall') > 0 ? 1 : has(s, 'hall') * 0.5), hint: 'A Hall needs 36 power and 1.5 coolant/s.' },
      { id: 'e3_train', text: 'Train model "Dawn-1" (3,000 training)', progress: (s) => frac(s.stats.trainTotal, 3000), hint: 'Link compute into a Training Core.', guide: 'training' },
      { id: 'e3_contract', text: 'Complete a contract', progress: (s) => frac(s.stats.contractsDone, 1), hint: 'Accept a contract on the right. Inference needs Gateways.' },
      { id: 'e3_pue', text: 'Hold PUE ≤ 1.45 at ≥ 60 compute/s', progress: (s) => (s.stats.computeRate >= 60 ? (pue(s) <= 1.45 ? 1 : 0.6) : frac(s.stats.computeRate, 60) * 0.5), hint: 'Cooling towers beat chillers on PUE (but drink water).', guide: 'pue' },
    ],
  },
  {
    id: 4, name: 'Hyperscale', subtitle: 'Era IV', radius: 50,
    intro: 'Continent-scale compute: rare earths, accelerators, fiber clusters, wind and fusion, and a world that pushes back.',
    guide: ['network', 'automation'],
    objectives: [
      { id: 'e4_accel', text: 'Deliver 12 accelerators', progress: (s) => frac(del(s, 'accel'), 12), hint: 'Rare Earth Mine and Chip supply feed the Accelerator Fab.' },
      { id: 'e4_pods', text: 'Run 4 Accelerator Pods', progress: (s) => frac(working(s, 'pod'), 4), hint: 'Pods need lots of power and 1 coolant/s each.' },
      { id: 'e4_cluster', text: 'Train at 150/s, mostly over fiber', progress: (s) => frac(s.stats.trainRate, 150), hint: 'Research Fiber Optics, then route pods → switch → Training Core.', guide: 'network' },
      { id: 'e4_clean', text: 'Generate 300 clean power at once', progress: (s) => frac(s.stats.cleanGen, 300), hint: 'Wind, solar and fusion count. Gas does not.', guide: 'footprint' },
      { id: 'e4_contracts', text: 'Complete 2 contracts this era', progress: (s) => frac(s.stats.eraContractsDone, 2) },
    ],
  },
  {
    id: 5, name: 'Dawn', subtitle: 'Era V · Fiction', radius: 63,
    intro: 'The capstone is pure fiction. Build the Dawn Engine and feed it the full weight of your civilisation’s infrastructure.',
    guide: ['fiction'],
    objectives: [
      { id: 'e5_build', text: 'Build the Dawn Engine', progress: (s) => has(s, 'engine'), hint: 'It is 4×4 and costs 400 metal, 200 chips and 40 accelerators.' },
      { id: 'e5_feed', text: 'Charge the Dawn Engine to 100%', progress: (s) => s.engine.progress, hint: 'Pour compute into it over fiber, plus accelerators by conveyor.' },
    ],
  },
];

export function pue(s: GameState): number {
  const it = s.stats.itPower;
  if (it < 0.5) return 0;
  return s.stats.facilityPower / it;
}

export const ERA_PAR: Record<number, number> = { 1: 18 * 60, 2: 25 * 60, 3: 35 * 60, 4: 40 * 60, 5: 20 * 60 };
