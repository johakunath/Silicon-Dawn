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
