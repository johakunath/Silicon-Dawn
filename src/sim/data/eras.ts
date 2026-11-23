import type { EraDef } from '../types';
import type { GameState } from '../state';
import { countType } from '../state';

const revMin = (s: GameState) => s.market.revRate * 60;
const bestShare = (s: GameState) => s.market.models.reduce((a, m) => (m.size === 'base' ? a : Math.max(a, m.quality / s.market.frontier)), 0);
const runFrac = (s: GameState) => (s.market.shipped > 0 ? 1 : s.market.run ? Math.min(0.99, s.market.run.progress / s.market.run.target) : 0);

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
      { id: 'e1_stock', text: 'Deliver 320 metal and 200 silicon in total', progress: (s) => (frac(del(s, 'metal'), 320) + frac(del(s, 'silicon'), 200)) / 2, hint: 'Scale up: more extractors, more refiners. Check belts for amber (saturated).' },
    ],
  },
  {
    id: 2, name: 'Silicon', subtitle: 'Era II', radius: 25,
    intro: 'Sand becomes thought. Pump water, fab chips, and light your first racks, then learn how hot compute runs.',
    guide: ['chips', 'compute', 'heat', 'research', 'maintenance'],
    objectives: [
      { id: 'e2_fab', text: 'Build a Water Pump and a Chip Fab', progress: (s) => (has(s, 'pump') + has(s, 'fab')) / 2, hint: 'Pumps must sit on a shore tile next to water.' },
      { id: 'e2_chips', text: 'Deliver 50 chips', progress: (s) => frac(del(s, 'chips'), 50), hint: 'Fabs need silicon, metal AND water. Watch their inputs.' },
      { id: 'e2_racks', text: 'Produce 18 compute/s', progress: (s) => frac(s.stats.computeRate, 18), hint: 'Server Racks turn power into compute. Link them to a Research Lab.' },
      { id: 'e2_cool', text: 'Run 6 racks fully cooled', progress: (s) => frac(s.buildings.filter((b) => b.type === 'rack' && b.activity > 0.95 && b.heat < 1).length, 6), hint: 'Cooling Tower: water in, coolant out by pipe to racks.', guide: 'heat' },
      { id: 'e2_rp', text: 'Earn 120 research', progress: (s) => frac(s.stats.rpTotal, 120), hint: 'Research Labs convert compute into research.' },
      { id: 'e2_tech', text: 'Research 3 technologies', progress: (s) => frac(s.techs.length, 3), hint: 'Open the Tech panel (T).' },
    ],
  },
  {
    id: 3, name: 'Datacenter', subtitle: 'Era III', radius: 35,
    intro: 'The building that never sleeps. Run local grids and closed coolant loops, then open the colony market: train models and sell their answers.',
    guide: ['pue', 'training', 'market', 'models', 'reliability', 'footprint'],
    objectives: [
      { id: 'e3_grid', text: 'Build a Substation and a Grid Battery', progress: (s) => (has(s, 'substation') + has(s, 'gridbat')) / 2, hint: 'Substations cover a radius of 10 and link up to 20 tiles.' },
      { id: 'e3_hall', text: 'Run a Datacenter Hall at full speed', progress: (s) => (working(s, 'hall') > 0 ? 1 : has(s, 'hall') * 0.5), hint: 'A Hall needs 36 power and 1.5 coolant/s.' },
      { id: 'e3_train', text: 'Ship your first model, Dawn-1', progress: runFrac, hint: 'Link compute into a Training Core. Open the Market (B) to pick the run size.', guide: 'training' },
      { id: 'e3_market', text: 'Earn ¢150/min from the colony market', progress: (s) => frac(revMin(s), 150), hint: 'Link compute into an Inference Gateway. Spare capacity lets chat and media in; high uptime keeps enterprise.', guide: 'market' },
      { id: 'e3_pue', text: 'Hold PUE ≤ 1.45 at ≥ 60 compute/s', progress: (s) => (s.stats.computeRate >= 60 ? (pue(s) <= 1.45 ? 1 : 0.6) : frac(s.stats.computeRate, 60) * 0.5), hint: 'Cooling towers beat chillers on PUE (but drink water).', guide: 'pue' },
    ],
  },
  {
    id: 4, name: 'Hyperscale', subtitle: 'Era IV', radius: 50,
    intro: 'Continent-scale compute: rare earths, accelerators, fiber clusters, wind and fusion, and a world that pushes back.',
    guide: ['network', 'automation'],
    objectives: [
      { id: 'e4_accel', text: 'Deliver 30 accelerators', progress: (s) => frac(del(s, 'accel'), 30), hint: 'Rare Earth Mine and Chip supply feed the Accelerator Fab.' },
      { id: 'e4_pods', text: 'Run 6 Accelerator Pods', progress: (s) => frac(working(s, 'pod'), 6), hint: 'Pods need lots of power and 1 coolant/s each.' },
      { id: 'e4_cluster', text: 'Train at 220/s, mostly over fiber', progress: (s) => frac(s.stats.trainRate, 220), hint: 'Research Fiber Optics, then route pods → switch → Training Core.', guide: 'network' },
      { id: 'e4_clean', text: 'Generate 350 clean power at once', progress: (s) => frac(s.stats.cleanGen, 350), hint: 'Wind, solar and fusion count. Gas does not.', guide: 'footprint' },
      { id: 'e4_frontier', text: 'Ship a model at frontier quality (100%)', progress: (s) => frac(bestShare(s), 1), hint: 'Train a Max model, or a Standard one mostly over fiber. Science pays most and only takes frontier models.', guide: 'models' },
    ],
  },
  {
    id: 5, name: 'Dawn', subtitle: 'Era V · Fiction', radius: 63,
    intro: 'The capstone is pure fiction. Build the Dawn Engine and feed it the full weight of your civilisation’s infrastructure.',
    guide: ['fiction'],
    objectives: [
      { id: 'e5_build', text: 'Build the Dawn Engine', progress: (s) => has(s, 'engine'), hint: 'It is 4×4 and costs 400 metal, 200 chips and 40 accelerators.' },
      { id: 'e5_market', text: 'Earn ¢1,200/min from the colony market', progress: (s) => frac(revMin(s), 1200), hint: 'Demand keeps growing. More gateways and a fresh model pay for the Engine.' },
      { id: 'e5_feed', text: 'Charge the Dawn Engine to 100%', progress: (s) => (s.engine.ignited ? 1 : Math.min(0.99, s.engine.progress)), hint: 'Pour compute into it over fiber, plus accelerators by conveyor.' },
    ],
  },
];

export function pue(s: GameState): number {
  const it = s.stats.itPower;
  if (it < 0.5) return 0;
  return s.stats.facilityPower / it;
}

export const ERA_PAR: Record<number, number> = { 1: 18 * 60, 2: 25 * 60, 3: 35 * 60, 4: 30 * 60, 5: 30 * 60 };
