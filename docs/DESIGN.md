# Game design: version 2 direction

Status: agreed direction (2026-11-23). Details are settled per work package with the design loop in `CLAUDE.md` and recorded in the decision log at the bottom.

## Owner intent
- A game the owner plays **once it feels finished**, as a fresh experience, then polishes and shares with friends. No owner playtests before that: balance comes from the autoplayer, tests and telemetry.
- Learn how AI infrastructure works, **technically and economically**.
- More depth, more fun, more replayability. Avoid tedium.

## Fun pillars (from the original brief, still valid)
1. Satisfying building: snap placement, juicy feedback, sound on every action.
2. Readable bottlenecks: you can see the jam, and every stalled building says why.
3. Scale escalation: the base grows, each era looks and sounds different.
4. Meaningful choices: trade-offs between cost, throughput and reliability, never one best build.
5. Wow moments: at least one per era.
Plus, for v2: **no tedium** (maintenance and upgrades must never become chores) and **teach the economics**.

## Setting
You are the infrastructure company settling a **new planet** to build AI for the colonies. The colonies, their politics and their markets stay **off-map**. You see them through demand, prices, news and events, not as citizens walking around. The sci-fi frame allows invented politics and events, while the **economics and physics stay real** (capex, opex, utilisation, PUE, heat, water, grid limits). The Dawn Engine stays the clearly fictional capstone.

## Core loop (target)
Build infrastructure (capex) → run it (opex: power, water, upkeep, service) → turn compute into **models** (training) and **revenue** (inference sold to colony markets) → reinvest → react to events and politics → hit scenario goals.

## Systems
### 1. Money and unit economics (first)
- One currency (credits). Buildings cost credits plus materials. Running costs per minute: power (priced by time of day), water, upkeep.
- Income: inference revenue, training contracts, selling surplus materials or power.
- Ledger: income vs. costs per minute, payback per building, cost per compute unit, utilisation.
- Safety: no bankrupt soft-lock (a loan or an emergency grant with a penalty).

**Built in E1 (model A, see decision log).** All numbers live in `src/sim/data/economy.ts`.
- Capex: credits on top of the material cost. Demolish refunds all materials, all credits for 2 minutes, then 50%.
- Opex: upkeep per building per minute; power bought through the Command Core (its generator is the colony grid tie) at a time-of-day price (cheap at noon, peak at dusk, average ¢1.8 per power-minute); gas fuel per unit generated; water per unit pumped (3× during a water restriction).
- Income: exports of metal, silicon and chips above a keep level (enough to build any building of the era, at least 100/60/40 × era; accelerators are held by default); surplus power sold at 50% of the price; contract payouts (¢0.25 per training unit, ¢0.4 per inference compute-second); a funding round when an era starts (¢800, 3,500, 6,000, 5,000 for eras II to V); a Core stipend of ¢30/min.
- Debt: a negative balance blocks building and costs 3%/min. Below −¢250 × era an emergency grant resets the balance to +¢100 × era and multiplies that era's efficiency score by 0.85.
- Belts out of storage stop at a build reserve (enough for any one building of the era, 40 to 120), so a busy base can always afford its next building.

**Balance targets (autoplayer, standard).** Full-load payback: Era I extractors and refiners 1–5 min, Chip Fab ~5 min, Accelerator Fab ~8 min, Fusion ~9 min, wind and gas 15–25 min, batteries and cooling never on their own (cost centres). Money should bind at era starts (capex bursts after a funding round), not stall a running base. Measured on 5 seeds (20261119, 4242, 777, 99, 31337) after E1: campaign finishes in 105–138 sim-minutes (total par 138); per era I 7–8, II 9–14, III 13–24, IV 19–72, V 11–75 min. Era IV runs over its 40-minute par on 3 of 5 seeds and is the first place to look in the E3 balance pass.

### 2. Market and model lifecycle
- Colony demand segments (for example chat, code, enterprise, science, media) grow over time, each with price, latency and uptime needs.
- Training produces a **model** with a quality tier. Deployed models earn inference revenue. Models lose value as the frontier moves, which drives the next training run.
- Reputation follows uptime. Unserved demand is visible (a lost-revenue number).
- Replaces most of today's contracts; contracts may stay as special orders.

**Built in E3 (model A, see decision log).** Numbers live in `src/sim/data/market.ts`, rules in `src/sim/market.ts`.
- The market opens with Era III (at once in the sandbox). Demand in queries/s per segment = base × era (1, 2.5, 4) × (1 + growth × minutes open); shared growth 2.5%/min, code and enterprise +0.5, science +1.5.
- Segments: chat (¢0.06/query, quality ≥ 40%, ≤ 120 ms, uptime 70%), media (¢0.09, 55%, ≤ 100 ms, 75%), code (¢0.16, 75%, ≤ 200 ms, 85%), enterprise (¢0.24, 65%, ≤ 300 ms, 95%), science (¢0.45, 105%, batch, 60%). Price per query × clamp(model quality, 0.5, 1.5).
- Serving: capacity = gateway compute ÷ model compute per query. Latency = 30 ms ÷ (1 − load), so each latency limit is a load cap (chat 75%, media 70%, code 85%, enterprise 90%). Every second the scheduler tries every mix of eligible segments and keeps the one that earns most. Unserved demand is "lost" with a reason: weak model, reputation, latency or capacity.
- Reputation follows gateway uptime (time constant 150 s; a brownout counts by its depth, a breakdown or no compute is down). Below a segment's uptime need its demand fades over 15 points to a loyal floor of 30%.
- Models: the Training Core always runs the next model. Sizes Lite / Standard / Max: 2,000 / 5,000 / 15,000 training (× 5 in Era IV, × 10 in Era V), quality 75% / 100% / 125% of the frontier at release, × (0.9 + 0.2 × fiber share), compute per query 0.5 / 1 / 2.5. The frontier grows 1.5%/min (relaxed 1.0, race 2.0). Every colony starts with an open baseline model (70%, 0.5 per query). Auto-deploy (on by default) keeps the shelf model that earns most; the shelf holds 4.
- Contracts became special orders: same rules and pay, one every 220–340 s instead of 110–170 s.
- Objectives: Era III ships Dawn-1 and earns ¢150/min; Era IV ships a model at 100% of the frontier (replaces "2 contracts"); Era V earns ¢1,200/min.

**Balance after E3** (autoplayer, standard, 5 seeds): campaign 78–112 sim-minutes (was 105–138); Era III 21–37, Era IV 10–24 (was 19–72), Era V 26–48 min, no emergency grants. Par moved from Era IV to Era V (40/20 → 30/30); Era III funding ¢3,500 → ¢4,500 because special orders no longer carry the Era III budget. Market revenue reaches about ¢150–300/min in Era III and ¢1,000–2,000/min late; lost demand stays 3–5× revenue, so more gateways always pay. Autoplayer fixes found on the way: generators are now wired to the grid (gas turbines were often unconnected), and Accelerator Fabs get a chips link.

### 3. Operations: maintenance, service and power deals
- Buildings **wear** with use and can break down at random (more likely when hot or worn).
- **Service Center** (Anno fire-station style): covers all buildings in a large radius, repairs them fast and slows wear, costs upkeep per minute. Unlocked early (Era 2). The existing Robot Hub becomes its late-game upgrade.
- Hardware tiers stay light: newer accelerator tiers unlock by research and are better per watt, old ones keep working (no forced replacement). Depreciation shows in the ledger only.
- Power deals: time-of-day price, grid import with a connection wait, fixed-price power contracts, getting paid to cut load at peak.

### 4. Decision events and politics
Events become **choices** with trade-offs, announced ahead so preparation matters. Examples:
- Colony council bans a model class or adds an export tariff on compute.
- Colonists protest a site: pay for a permit, add a buffer zone, or relocate.
- Memory or chip shortage, transformer lead times, a price war with a rival lab, a demand spike from a model launch.
- Utility offers cheap interruptible power.
Severity scales with difficulty.

### 5. Scenarios and run modifiers
- Scenario regions with one hard rule and their own goals: Desert Solar (no water), Polar Hydro (cheap firm power, free cooling, far fiber), Grid-Locked Basin (little land, long grid queue), Archipelago (imports by ship, expensive chips).
- Run modifiers: pick 1 of 3 cards at each era start (subsidy, carbon tax, cheap capital, heat dome). Daily seed with the same cards for everyone.

### 6. Telemetry and friends score sheet
- No telemetry exists today. Planned: an anonymous run log (session start and end, era times, stalls, money curve, events and choices, quits) sent to a Google Sheet through an Apps Script web app, plus a local copy you can export.
- Friends see a score sheet per scenario. Telemetry is **opt-in** on first start, because friends will play too.
- Must be live before the owner's first full play.

## Decision log
| Date | Decision | Why |
|---|---|---|
| 2026-11-23 | Sci-fi colony planet setting, colonies off-map | Freedom for politics and events, no citizen simulation |
| 2026-11-23 | Hardware generations become maintenance and service coverage; no forced GPU swaps | Replacing stacks every few years would be tedious |
| 2026-11-23 | Anno-style citizens parked in `docs/IDEAS.md` | Big pivot, owner undecided |
| 2026-11-23 | Owner does not playtest until the game feels done; telemetry first | Keep the first play fresh |
| 2026-11-23 | E2 graphics settings: two rows in the existing menu (Graphics Auto/Performance/Quality, Frame rate limit) instead of a tabbed settings window | One tap to switch, a status line says what Auto chose; five extra knobs (shadows, bloom, AA, resolution) would not help the owner or friends |
| 2026-11-23 | E2 Performance profile: DPR cap 1.25, 2× MSAA, 1024 px hard-edged shadows, trees cast none, half-size bloom, half the particles, 30 fps (60 while touching or the camera moves), 10 fps when paused and still, no rendering in a hidden tab. Quality: DPR up to 2, 8× MSAA, 4096 px soft shadows, full bloom, no cap | The Tab S9 has a 120 Hz screen, so an uncapped loop rendered 120 frames per second; the frame cap and the pixel count (4× fewer pixels than DPR 2) are the big thermal levers. Bloom and shadows stay on at lower cost because night glow and depth carry the look (pillars 3 and 5) |
| 2026-11-23 | E2 touch bar: a right-edge rail (rotate, zoom, copy, next problem, Core) plus a red Cancel pill above the tools, instead of a second toolbar strip | The right thumb reaches the rail while the left hand holds the tablet; Cancel shows only when a tool or selection is active, where the eye already is. Link, move, demolish, pause and speed already had on-screen buttons. The keyboard-only hotbar is hidden on touch, the build panel is the picker |
| 2026-11-23 | E2 touch gestures: drag pans (no paint-placing), tap places, long-press inspects (tooltip plus selection, or placement check without placing in build mode); twist needs 0.2 rad before it rotates | Predictable on glass: a pan never builds by accident, and pinches do not wobble the view. Demolish refunds 100%, so a wrong tap costs nothing |
| 2026-11-23 | E2 cloud save: a Cloud section inside Save / Load (manual upload and load, auto upload every 5 min and on leaving) instead of a separate sync window with "keep newer" | Sits next to the local slots it mirrors. Auto upload never overwrites a different run or one further along; the player decides those cases. Storage: chunked Sheet rows (40,000 chars) instead of Drive files, so the script needs only one permission; saves are gzipped first |
| 2026-11-23 | E2 learnings from `Ruinenstadt-Berlin` (`docs/tasks/q1-quality-levels.md`, `docs/telemetry/analysis-2026-11-21.md`, `docs/plan-3d.md`, `src/sync.ts`) applied: Performance refreshes the shadow map every 3rd frame while the camera is still; the frame cap is its own setting next to the profile; profiles change only the picture, never the sim; the Apps Script URL gets built into the game (`DEFAULT_CLOUD_URL`) so players only enter a code; the tablet checklist covers Firefox | There the Tab S9 (Firefox, 1195×550 CSS px at DPR 2.14) was CPU-bound: a lower resolution alone gained nothing, cutting per-frame CPU work (shadow passes, extra passes) did. Silicon Dawn draws far fewer objects (instanced), so it keeps the resolution cap too. Not taken: three levels and dynamic resolution (two profiles cover desktop and tablet; revisit after the owner's tablet test). `Ruinenstadt` (2D) was not read |
| 2026-11-23 | E1 economy model A "credits on top of materials" over B "credits replace materials" | A keeps the logistics game (pillars 1, 2) and adds money as a second constraint, which mirrors real capex (bill of materials plus installation). B would make belts pointless for construction. Risk of two currencies is handled by automatic exports above a keep level. |
| 2026-11-23 | Funding round at each era start | Without it the autoplayer needed 2–3× longer per era. It also teaches the real pattern: AI build-outs are financed before they earn. |
| 2026-11-23 | Power is bought and sold only through the Command Core (grid tie) | Own generators have no marginal cost, so a time-of-day price only means something at the tie. Grid import deals and curtailment payments stay in E4. |
| 2026-11-23 | E3 market model A "segments with demand curves" over B "one price curve with quality tiers" | A teaches what B hides: customers want different things (price, quality, latency, uptime), spare capacity buys latency, uptime buys enterprise, and model size is a trade-off between quality and serving cost (pillar 4). B would reduce the market to "more compute, higher tier". The scheduler stays automatic so there is no per-segment micromanagement (no tedium) |
| 2026-11-23 | E3 panel option A "Market & Models modal (B) plus a small sidebar card" over B "everything in a taller sidebar dock" | The segment table, lost-revenue reasons and model shelf need room to teach; a dock would squeeze the objectives on a 1280×800 tablet. The card keeps revenue, the live model, the training run and special orders always visible |
| 2026-11-23 | E3 model lifecycle: quality is a share of a growing frontier, three run sizes, bigger models cost more compute per query, auto-deploy on by default | Aging forces the next training run without a timer; the size choice is the real decision. Auto-deploy keeps the default game free of chores, and players who want control switch it off |
| 2026-11-23 | E3 open baseline model at 70% and a 30% loyal-customer floor | Without them the first gateway earned nothing until Dawn-1 shipped, and one night of brownouts sent reputation and income to zero with no way back (soft-lock risk) |
| 2026-11-23 | Ledger option A "statement modal" over option B "waterfall dock" | A shows payback for every building type (the learning goal), fits next to the Statistics screen, and takes no space from objectives and contracts. The power price strip from B was kept inside A. |
