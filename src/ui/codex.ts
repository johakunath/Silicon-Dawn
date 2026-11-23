// Codex: short, scannable chapters (bullets, bold keywords) instead of walls of text.
import { BUILDINGS } from '../sim/data/buildings';
import { GUIDE } from '../sim/data/guide';
import type { GameState } from '../sim/state';
import { isUnlocked, lockReason } from '../sim/actions';
import { thumb } from './icons';
import { defTip, nightSeconds } from './tips';

export interface Chapter { id: string; icon: string; title: string; html: (s: GameState) => string }

const ul = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

export const CHAPTERS: Chapter[] = [
  {
    id: 'start', icon: '★', title: 'Getting started',
    html: () => `<h2>Your goal</h2>${ul([
      'Grow from <b>one Command Core</b> to a continent-scale compute civilisation, era by era.',
      'Each era has <b>objectives</b> (top right). Finish them all to unlock the next era, new buildings and a bigger frontier.',
      'The game starts <b>paused</b>. Press <kbd>Space</kbd> or ▶ when you are ready.',
    ])}<h2>Controls</h2>${ul([
      '<kbd>WASD</kbd> or drag with the right mouse button to pan. <kbd>Wheel</kbd> zooms to the cursor.',
      '<kbd>Q</kbd>/<kbd>E</kbd> rotate in 90° steps. Hold <b>left + right</b> mouse buttons (or Alt + RMB) and drag to rotate freely.',
      '<kbd>1</kbd>–<kbd>0</kbd> use the <b>hotbar</b>. Hover a build item and press a number to put it there.',
      '<kbd>L</kbd> link · <kbd>X</kbd> demolish · <kbd>V</kbd> move · <kbd>G</kbd> pipette (build more of what you point at).',
      '<kbd>P H N O</kbd> overlays · <kbd>I</kbd> statistics · <kbd>T</kbd> tech · <kbd>J</kbd> codex · <kbd>Z</kbd> jump to the next problem.',
    ])}`,
  },
  {
    id: 'power', icon: '⚡', title: 'Power & grids',
    html: (s) => `${ul([
      '<b>Generators</b> (Solar, Wind, Gas, Fusion, the Core) feed a <b>local grid</b>.',
      '<b>Power Poles</b> and <b>Substations</b> carry the grid. Any building inside a node’s radius is connected. The <b>yellow dashed line</b> while placing shows where it plugs in.',
      'If a grid needs more than it gets, <b>every</b> machine on it slows down (brownout).',
      `Solar produces nothing for ~<b>${Math.round(nightSeconds(s))} s</b> each night. <b>Batteries</b> store daytime surplus.`,
      `Rule of thumb: to run one Solar Array’s worth (6 power) through the night you need ≈ <b>${((6 * nightSeconds(s)) / (600 * s.fx.batteryMul)).toFixed(1)} Battery Banks</b>, and the arrays must charge them by day. Hover the power bar to see the exact energy your base needs.`,
      'Gas is firm but dirty (worse footprint rating, trips in grid faults). Wind varies. Fusion is the late-game answer.',
    ])}`,
  },
  {
    id: 'logistics', icon: '➜', title: 'Belts, pipes & links',
    html: () => `${ul([
      '<b>Links</b> move goods between buildings: <b>belts</b> (solids), <b>pipes</b> (water and coolant), <b>data cables / fiber</b> (compute).',
      '<b>Auto-link</b> (toolbar) connects a new building to its nearest partners. The <b>cyan dashed preview</b> shows exactly what it will connect before you click.',
      '<b>Link tool</b> <kbd>L</kbd>: click one building, then the other, in either order. Shift keeps chaining.',
      'Remove a link: hover it (it glows red) with <kbd>X</kbd> or <kbd>L</kbd> and click.',
      'Belts carry 2/s and reach 14 tiles. <b>Junctions</b> merge several belts or pipes into one, split one into many, and relay further.',
      '<b>Amber</b> belt = saturated (add a second belt). <b>Red blinking</b> = blocked (the destination is full).',
      'Links are <b>free</b>, and demolishing refunds <b>100%</b>, so experiment freely. Use <kbd>V</kbd> to move a building.',
    ])}`,
  },
  {
    id: 'stockpile', icon: '▣', title: 'Stockpile & depots',
    html: () => `${ul([
      'Refined goods delivered into the <b>Core</b> or a <b>Supply Depot</b> join your stockpile, which pays for construction.',
      'Storage works <b>both ways</b>: link Core or Depot → Chip Fab to ship stockpiled metal and silicon to it.',
      'Belts out of storage stop at a <b>build reserve</b>: enough of each item to build any one building of this era (40 to 120), so you can always still build.',
      'You can also chain directly, for example <b>Ore Smelter → Chip Fab</b> (metal) or <b>Silicon Furnace → Chip Fab</b> (silicon). Short chains are efficient.',
    ])}`,
  },
  {
    id: 'chains', icon: '⚙', title: 'Production ratios',
    html: () => `<p class="dim">At 100% deposit coverage and full power:</p>${ul([
      '<b>1 Quartz Extractor → 1 Silicon Furnace</b> (36 quartz/min → 27 silicon/min).',
      '<b>1 Ore Drill → 1 Ore Smelter</b> (36 ore/min → 30 metal/min).',
      '<b>1 Chip Fab</b> needs 24 silicon/min (≈1 Furnace), 12 metal/min (≈½ Smelter) and 36 water/min (½ Pump).',
      '<b>1 Cooling Tower</b> (60 coolant/min) cools ≈ <b>6 Server Racks</b> and needs ⅔ of a Pump.',
      '<b>1 Research Lab</b> uses 6 compute/s = <b>2 Server Racks</b>.',
      'Deposit coverage below 100% scales extractor output, so place extractors squarely on the crystals.',
      'Click any building to see its live <b>in/out per minute</b> on every link.',
    ])}`,
  },
  {
    id: 'compute', icon: '◈', title: 'Compute & cooling',
    html: () => `${ul([
      'Racks, Datacenter Halls and Accelerator Pods turn <b>power into compute and heat</b>.',
      'Without enough <b>coolant</b> they overheat and throttle to about half speed (♨ badge).',
      'Cooling Towers use little power but drink water. Chillers need no water but burn power (worse <b>PUE</b>).',
      'Compute is a flow, not a stock: link it to <b>Labs</b> (research), <b>Training Cores</b> or <b>Gateways</b>. Unused compute is wasted.',
      'Fiber (tech) carries 5× more, and fiber-fed training is twice as efficient. Fiber Switches aggregate clusters.',
    ])}`,
  },
  {
    id: 'purpose', icon: '◎', title: 'Who uses all this AI?',
    html: () => `${ul([
      '<b>Contracts</b> are your customers: hospitals, transit, search, translators, climate scientists.',
      '<b>Inference contracts</b> are society using AI. They need steady compute at <b>Gateways</b> with high uptime.',
      '<b>Training contracts</b> build models for clients by a deadline.',
      'Completing contracts pays <b>research and materials</b> back into your economy.',
      'The Dawn Engine ending is a <b>fictional</b> capstone. The real game is the infrastructure: energy, heat, water, materials, networks and reliability.',
    ])}`,
  },
  {
    id: 'events', icon: '⚠', title: 'Events & contracts',
    html: () => `${ul([
      'From Era II on, <b>events</b> hit with a 20 s warning: dust storms (solar), heatwaves (cooling), grid faults (gas trips, breakdowns), water restrictions, chip shortages.',
      'Redundancy wins: spare batteries, mixed cooling, more than one power source.',
      '<b>Robot Hubs</b> repair broken buildings nearby instantly. You can also select a broken building and press <kbd>R</kbd> (10 metal).',
      'Accept contracts in the panel on the right. Only one training and one inference contract can run at a time.',
    ])}`,
  },
  {
    id: 'overlays', icon: '▦', title: 'Overlays & statistics',
    html: () => `${ul([
      '<kbd>P</kbd> <b>Power</b>: coverage areas coloured by grid health. Unpowered buildings turn red.',
      '<kbd>H</kbd> <b>Heat</b>: IT buildings tinted from blue (cool) to red (throttling).',
      '<kbd>N</kbd> <b>Network</b>: only compute links, with saturation states.',
      '<kbd>O</kbd> <b>Flow</b>: belts and pipes coloured by state (amber = full capacity, red = blocked).',
      '<kbd>I</kbd> <b>Statistics</b>: production and consumption per minute of every item, and power by source and consumer. The Core’s panel opens it too.',
    ])}`,
  },
  {
    id: 'buildings', icon: '⌂', title: 'Buildings A–Z',
    html: (s) => BUILDINGS.filter((d) => d.id !== 'hq').map((d) => {
      const un = isUnlocked(s, d) || s.mode === 'sandbox';
      return `<div class="cbuild${un ? '' : ' locked'}"><img src="${thumb(d.id)}"><div>${un ? defTip(s, d) : `<b>${d.name}</b><br><span class="dim">🔒 ${lockReason(s, d)}</span>`}</div></div>`;
    }).join(''),
  },
  {
    id: 'real', icon: '🌍', title: 'Real-world notes',
    html: () => GUIDE.map((g) => `<h3>${g.icon} ${g.title}</h3>${ul(g.body.split(/(?<=\.)\s+/).filter(Boolean).slice(0, 4))}`).join(''),
  },
];
