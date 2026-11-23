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
- Open questions for the design loop: do materials stay (yes, likely, for logistics fun) and how do credits and materials split the cost; ledger layout.

### 2. Market and model lifecycle
- Colony demand segments (for example chat, code, enterprise, science, media) grow over time, each with price, latency and uptime needs.
- Training produces a **model** with a quality tier. Deployed models earn inference revenue. Models lose value as the frontier moves, which drives the next training run.
- Reputation follows uptime. Unserved demand is visible (a lost-revenue number).
- Replaces most of today's contracts; contracts may stay as special orders.

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
