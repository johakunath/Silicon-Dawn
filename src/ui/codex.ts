// Codex: short, scannable chapters (bullets, bold keywords) instead of walls of text.
import { BUILDING, BUILDINGS } from '../sim/data/buildings';
import { GUIDE } from '../sim/data/guide';
import type { GameState } from '../sim/state';
import { isUnlocked, lockReason } from '../sim/actions';
import { thumb } from './icons';
import { defTip, nightSeconds } from './tips';
import { FEED_IN, FUNDING, INTEREST_PER_MIN, POWER_PRICE, PRICE } from '../sim/data/economy';
import { capexOf, keepLevel, overdraftFloor, unitEcon } from '../sim/economy';
import { cr } from './ledger';
import { BASE_LATENCY, FRONTIER_GROWTH, MODEL_SIZES, SEGMENTS, SIZE_ORDER } from '../sim/data/market';
import { maxLoad } from '../sim/market';
import { BREAK_AT_FULL, BREAK_TIME, DEPRECIATION_MIN, DR_PEAK, FIXED_MUL, FIXED_TIME, GRID_STEP, GRID_WAIT, RESIDUAL, SERVICE_RESTORE, TIER2_COMPUTE } from '../sim/data/operations';
import { gridUpgradeCost, importCap, wearRate } from '../sim/operations';

export interface Chapter { id: string; icon: string; title: string; html: (s: GameState) => string }

const ul = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

export const CHAPTERS: Chapter[] = [
  {
    id: 'start', icon: '★', title: 'Getting started',
    html: () => `<h2>Your goal</h2>${ul([
      'Grow from <b>one Command Core</b> to a continent-scale compute civilisation, era by era.',
      'Each era has <b>objectives</b> (top right). Finish them all to unlock the next era, new buildings and a bigger frontier.',
      'Buildings cost <b>materials and credits</b> ¢. Watch the credits chip in the top bar, and press <kbd>K</kbd> for the ledger.',
      'The game starts <b>paused</b>. Press <kbd>Space</kbd> or ▶ when you are ready.',
    ])}<h2>Controls</h2>${ul([
      '<kbd>WASD</kbd> or drag with the right mouse button to pan. <kbd>Wheel</kbd> zooms to the cursor.',
      '<kbd>Q</kbd>/<kbd>E</kbd> rotate in 90° steps. Hold <b>left + right</b> mouse buttons (or Alt + RMB) and drag to rotate freely.',
      '<kbd>1</kbd>–<kbd>0</kbd> use the <b>hotbar</b>. Hover a build item and press a number to put it there.',
      '<kbd>L</kbd> link · <kbd>X</kbd> demolish · <kbd>V</kbd> move · <kbd>G</kbd> pipette (build more of what you point at).',
      '<kbd>P H N O U</kbd> overlays · <kbd>I</kbd> statistics · <kbd>K</kbd> ledger · <kbd>B</kbd> market · <kbd>T</kbd> tech · <kbd>J</kbd> codex · <kbd>Z</kbd> jump to the next problem.',
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
      'Links are <b>free</b>. Demolishing refunds all materials, and all credits within 2 minutes (half after that), so experiment freely. Use <kbd>V</kbd> to move a building.',
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
    id: 'economics', icon: '¢', title: 'Unit economics',
    html: (s) => {
      const fab = unitEcon(s, BUILDING.fab), rack = unitEcon(s, BUILDING.rack), pod = unitEcon(s, BUILDING.pod);
      const solar = unitEcon(s, BUILDING.solar), gas = unitEcon(s, BUILDING.gas);
      const pm = (v: number | null) => (v === null ? 'never' : `${Math.max(1, Math.round(v))} min`);
      return `<h2>Two budgets</h2>${ul([
        '<b>Materials</b> come from your belts. <b>Credits</b> pay for hardware, labour and permits.',
        '<b>Capex</b> is what you pay once to build. <b>Opex</b> is what you pay every minute to run: upkeep, power, fuel and water.',
        '<kbd>K</kbd> opens the <b>ledger</b>: income and costs per minute, and payback for every building type.',
      ])}<h2>Where credits come from</h2>${ul([
        `<b>Exports</b>: the stockpile sells metal, silicon and chips above a keep level (now ${keepLevel(s, 'metal')} metal), enough to build anything this era. Prices: metal ${cr(PRICE.metal!)}, chips ${cr(PRICE.chips!)}, accelerators ${cr(PRICE.accel!)}. Switch each item between SELL and HOLD in the ledger.`,
        '<b>The colony market</b> pays for every answer your Gateways serve (<kbd>B</kbd>). It is the main income from Era III on.',
        '<b>Special orders</b> pay a one-off sum for a training job or a burst of inference.',
        `<b>Funding rounds</b>: investors pay when an era starts (${cr(FUNDING[3])} for the Datacenter era). The next build-out is financed up front; revenue has to justify it later.`,
        `<b>Power sold</b>: surplus the batteries cannot take goes to the colony grid at ${Math.round(FEED_IN * 100)}% of the current price.`,
      ])}<h2>Payback and utilisation</h2>${ul([
        '<b>Payback</b> = capex ÷ (value made per minute − running cost per minute).',
        `At full load a Chip Fab costs ${cr(fab.capex)} and pays back in about <b>${pm(fab.payback)}</b>. A Solar Array (${cr(solar.capex)}) takes about ${pm(solar.payback)}.`,
        '<b>Utilisation</b> is everything: a fab that runs at 40% takes 2.5× as long to pay back, and an idle machine still pays upkeep and 15% standby power.',
        `<b>Cost per compute</b>: a Server Rack makes 1,000 compute for about ${cr((rack.opex / rack.compute) * 1000)}, an Accelerator Pod for ${cr((pod.opex / pod.compute) * 1000)}. Cooling power is part of that bill, so a better PUE is cheaper compute.`,
      ])}<h2>Power prices</h2>${ul([
        `The Command Core is your tie to the colony grid. What it supplies is <b>bought</b> at a time-of-day price, on average ${cr(POWER_PRICE * 60)} per power-minute: cheap at noon (everyone’s solar), most expensive at dusk.`,
        `Gas is firm but burns fuel for every unit: ${cr(gas.opex)}/min at full load. Solar and wind cost capex once and run almost free. That is the real capex-versus-opex trade in energy.`,
        'Batteries earn nothing on their own. They pay off by covering the night and the evening peak.',
      ])}<h2>Debt</h2>${ul([
        `Below zero you cannot build, and debt costs ${Math.round(INTEREST_PER_MIN * 100)}% per minute.`,
        `Below ${cr(overdraftFloor(s))} the colony council clears the debt with an emergency grant, and this era’s efficiency score drops. Machines keep running, so you can always recover.`,
        `Demolishing returns all materials. Credits come back in full for 2 minutes, then at half (used hardware). A Datacenter Hall’s ${cr(capexOf(s, 'hall'))} is a real decision.`,
      ])}<h2>In the real world</h2>${ul([
        'Accelerators are the biggest upfront cost of an AI data centre, and electricity is one of the biggest running costs.',
        'Operators judge a site by cost per unit of compute, which depends mostly on how busy the hardware is and on the power price.',
        'Big build-outs are financed before they earn anything. Whether they pay back depends on demand that arrives later.',
      ])}`;
    },
  },
  {
    id: 'market', icon: '◆', title: 'Market & models',
    html: (s) => `<h2>The colony market</h2>${ul([
      'From Era III, the colonies buy AI answers. <b>Inference Gateways</b> sell them with your <b>deployed model</b>. Press <kbd>B</kbd> for the Market panel.',
      'Demand comes in five <b>segments</b>, and it grows every minute:',
    ])}<table class="stab"><tr><th>Segment</th><th>Price/query</th><th>Min. quality</th><th>Latency</th><th>Uptime</th></tr>${SEGMENTS.map((d) => `<tr><td>${d.name}</td><td>${cr(d.price)}</td><td>${Math.round(d.minQuality * 100)}%</td><td>${Number.isFinite(d.maxLatency) ? `≤ ${d.maxLatency} ms (load ≤ ${Math.round(maxLoad(d) * 100)}%)` : 'batch, waits'}</td><td>${Math.round(d.uptime * 100)}%</td></tr>`).join('')}</table>${ul([
      `<b>Latency</b> = ${BASE_LATENCY} ms ÷ (1 − load). A gateway at 50% load answers in ${BASE_LATENCY * 2} ms, at 90% in ${BASE_LATENCY * 10} ms. Serving chat or media caps how full the gateways may run, so <b>spare capacity</b> earns money.`,
      '<b>Reputation</b> follows gateway uptime (power, breakdowns, compute supply). Below a segment’s uptime need, its customers leave.',
      'The panel shows <b>lost revenue</b> and why: model too weak, reputation, latency (no headroom) or capacity (not enough compute).',
    ])}<h2>Models</h2>${ul([
      'A <b>Training Core</b> always runs the next model. Pick its size in the Market panel:',
    ])}<table class="stab"><tr><th>Size</th><th>Training</th><th>Quality at release</th><th>Compute per query</th></tr>${SIZE_ORDER.map((k) => { const z = MODEL_SIZES[k]; return `<tr><td>${z.name}</td><td>${z.train.toLocaleString('en-US')}× era scale</td><td>${Math.round(z.quality * 90)}–${Math.round(z.quality * 110)}%</td><td>${z.cost}</td></tr>`; }).join('')}</table>${ul([
      'Quality is a share of the <b>frontier</b>, the best rival model. Up to 20% more if the training arrived <b>over fiber</b>.',
      `The frontier grows about ${Math.round(FRONTIER_GROWTH[s.difficulty] * 1000) / 10}% per minute, so every model loses value. When it drops below a segment’s minimum, that segment stops buying.`,
      '<b>Bigger is not always better</b>: a Max model wins science, but needs 2.5× the compute per answer, so chat pays almost nothing on it. A Lite model serves cheap volume.',
      '<b>Auto-deploy</b> (on by default) keeps whichever shelf model earns most right now. Switch it off to choose yourself.',
    ])}<h2>In the real world</h2>${ul([
      'Price per answer for a given quality has fallen many times over within a few years, as better and cheaper models ship.',
      'Serving cost grows with model size, which is why labs offer small, medium and large versions of the same model.',
      'Inference providers keep servers below full load for latency-sensitive traffic and backfill with batch jobs.',
    ])}`,
  },
  {
    id: 'operations', icon: '🔧', title: 'Operations',
    html: (s) => `<h2>Wear and breakdowns</h2>${ul([
      `Machines <b>wear</b> as they work: a smelter at full load wears about ${Math.round(wearRate('smelter') * 100)}% per minute, a rack ${Math.round(wearRate('rack') * 100)}%. Hot racks wear twice as fast. Poles, substations and the Core never wear.`,
      `Breakdowns are rare while a machine is fresh and climb steeply with wear: at 100% about one every ${Math.round(1 / BREAK_AT_FULL)} s. A breakdown stops it for ${BREAK_TIME} s and leaves it half worn.`,
      'Select a machine to see its wear and risk. <kbd>R</kbd> repairs a broken one or <b>overhauls</b> a worn one for 10 metal.',
    ])}<h2>Service Centers</h2>${ul([
      `A <b>Service Center</b> (Era II) maintains everything within ${BUILDING.service.service} tiles: wear grows 4× slower and crews work off ${Math.round(SERVICE_RESTORE * 100)}% per minute, so covered machines rarely break. It costs ${cr(capexOf(s, 'service'))} and upkeep every minute.`,
      '<kbd>U</kbd> shows coverage: teal is maintained, amber and red are worn machines outside it.',
      '<b>Robot Hubs</b> (Era IV) are the upgrade: they maintain their radius too, make it 30% faster and fix breakdowns at once.',
    ])}<h2>Power deals</h2>${ul([
      `<b>Grid connection</b>: the Core imports up to ${importCap(s)} power from the colony grid. Each upgrade adds ${GRID_STEP} for ${cr(gridUpgradeCost(s))} (rising) and takes the utility ${Math.round(GRID_WAIT / 60)} minutes. Real data centres wait years in interconnection queues.`,
      `<b>Fixed-price contract</b>: ${Math.round(FIXED_TIME / 60)} minutes of imports at ${Math.round(FIXED_MUL * 100)}% of the average price, whatever the hour. You give up cheap noon power to be safe from the dusk peak.`,
      `<b>Peak curtailment</b>: while the price is ${DR_PEAK}× average or more, the Core imports nothing and the grid pays you for the capacity you free up. It pays well if batteries can carry you through dusk.`,
      'All three live in the ledger (<kbd>K</kbd>).',
    ])}<h2>Hardware generations</h2>${ul([
      `<b>Next-Gen Accelerators</b> (tech): pods built afterwards make ${Math.round((TIER2_COMPUTE - 1) * 100)}% more compute for the same power. Old pods keep working; replacing them is your call, never forced.`,
      `The ledger shows <b>book value</b>: capex written down in a straight line over ${DEPRECIATION_MIN} minutes to ${Math.round(RESIDUAL * 100)}%. It is not cash, but it shows how fast hardware loses value.`,
    ])}<h2>In the real world</h2>${ul([
      'Failure rates of hardware follow a "bathtub": a few early failures, a long quiet middle, then wear-out. Preventive maintenance and spares keep fleets in the quiet middle.',
      'Large sites sign long power contracts and are paid by grid operators to cut load at peaks (demand response).',
      'Accelerators are usually written off over 4 to 6 years, while each new generation does noticeably more work per watt.',
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
      'The <b>colony market</b> is your customer base: colonists chatting, channels making media, engineers writing code, firms running their business, scientists running batch jobs.',
      'Each wants something different: price, model quality, fast answers or uptime. See <b>Market &amp; models</b>.',
      '<b>Special orders</b> are one-off jobs from hospitals, transit and research teams. They pay credits, research and materials.',
      'The Dawn Engine ending is a <b>fictional</b> capstone. The real game is the infrastructure: energy, heat, water, materials, networks and reliability.',
    ])}`,
  },
  {
    id: 'events', icon: '⚠', title: 'Events & special orders',
    html: () => `${ul([
      'From Era II on, <b>events</b> hit with a 20 s warning: dust storms (solar), heatwaves (cooling), grid faults (gas trips, breakdowns), water restrictions, chip shortages.',
      'Redundancy wins: spare batteries, mixed cooling, more than one power source.',
      '<b>Service Centers</b> keep machines from wearing out, and <b>Robot Hubs</b> also repair broken buildings nearby instantly. You can also select a broken building and press <kbd>R</kbd> (10 metal).',
      'Accept special orders in the Market card on the right. Only one training and one inference order can run at a time.',
    ])}`,
  },
  {
    id: 'overlays', icon: '▦', title: 'Overlays & statistics',
    html: () => `${ul([
      '<kbd>P</kbd> <b>Power</b>: coverage areas coloured by grid health. Unpowered buildings turn red.',
      '<kbd>H</kbd> <b>Heat</b>: IT buildings tinted from blue (cool) to red (throttling).',
      '<kbd>N</kbd> <b>Network</b>: only compute links, with saturation states.',
      '<kbd>O</kbd> <b>Flow</b>: belts and pipes coloured by state (amber = full capacity, red = blocked).',
      '<kbd>U</kbd> <b>Service</b>: Service Center and Robot Hub coverage, and worn machines outside it.',
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
