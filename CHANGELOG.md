# Release notes

Newest first. Each entry says what a player notices. Technical detail lives in the commit history.

## Unreleased
- Telemetry (opt-in): before your first game the game asks whether to share anonymous run summaries (era times, money, stalls, breakdowns) with a random player id. Change it any time in the Menu; the last 5 run logs stay on your device and export as JSON.
- Friends score sheet: the final screen shows your campaign score and lets you submit it under a name you type; Menu → Score sheet shows the top 20 per difficulty. Needs the updated cloud script (version 2).
- Batteries show their charge as a glowing level on the cells (green, amber, red; pulsing while charging) instead of a floating gauge.
- Ledger: the per-building table is compact, grouped by role with subtotals, sortable, with bars, use dots, a coloured net column, a 3-minute trend line and payback pills. Gateways now show their share of market revenue.
- Fix: a broken battery no longer keeps charging and discharging.
- Operations: machines wear as they work (hot racks faster) and break down more and more often near the end of their life. Select one to see its wear and breakdown risk; `R` overhauls it for 10 metal.
- New Service Center (Era II): maintains everything within 11 tiles so covered machines stay fresh, for an upkeep every minute. Robot Hubs now service their radius too. New Service overlay (`U`) shows coverage and worn machines outside it.
- Power deals in the ledger: a bigger grid connection for the Core (arrives after a 3-minute wait), a fixed-price power contract, and paid peak curtailment at dusk.
- New tech Next-Gen Accelerators: pods built afterwards make 35% more compute for the same power; older pods keep working. The ledger shows hardware book value and depreciation.
- New Codex chapter "Operations". Saves move to version 5.
- Colony market (Era III on): five customer segments (chat, media, code, enterprise, science) with their own price, model quality, latency and uptime needs, and demand that keeps growing. Inference Gateways sell answers with your deployed model; spare capacity keeps latency low, uptime builds reputation, and the panel shows lost revenue and why.
- Models: the Training Core always trains your next model (Lite, Standard or Max). Models age as rival labs push the frontier, bigger models answer better but cost more compute per answer, and auto-deploy keeps the best earner live. Every colony starts with an open baseline model.
- Market & Models panel (`B`, or the Market card on the right): revenue, lost demand, reputation, gateway load and latency, the frontier, a revenue chart, the training run, the model shelf with deploy and retire.
- Contracts are now rarer special orders. Era III to V objectives are about shipping models and market revenue. New Codex chapter "Market & models".
- Balance: the campaign runs about 80 to 110 minutes on the test seeds (was 105 to 140); Era IV is much shorter, par moves from Era IV to Era V; the Era III funding round is ¢4,500.
- Saves move to version 4; older saves open the market on their first second in Era III or later.
- Colony economy: buildings cost credits as well as materials, and every minute costs upkeep, power bought through the Core (cheap at noon, expensive at dusk), gas fuel and water. Credits come from exports of surplus metal, silicon and chips, contracts, power sold, a funding round at each new era and a small Core stipend. Deep debt triggers an emergency grant that lowers the era score, so you can never get stuck broke.
- Ledger (`K`, or click the credits chip): income and costs per minute, balance trend, power price over the day, cost per 1,000 compute, utilisation, payback for every building type, and SELL/HOLD switches for exports.
- Build tooltips show capex, running cost and payback (or cost per compute). New Codex chapter "Unit economics".
- Tutorial: two new steps explain credits, selling and the ledger (15 steps now).
- Demolishing refunds all credits for 2 minutes, then half (materials are still refunded in full).
- Belts out of the stockpile now stop at a build reserve sized to the era, so a busy base can always afford its next building.
- Saves move to version 3; older saves open with a balance sized to the era they reached.
- Backlog: new epic E2 Tablet and quality profiles; later epics renumbered.
- Tablet support: touch controls (drag, pinch, twist, tap, hold to inspect), a right-edge button rail and a red Cancel pill, finger-sized buttons, UI that fits an 11-inch screen.
- Graphics profiles in the menu: Performance (cool tablet: lower resolution, 30 fps, slow redraw when paused, nothing in a hidden tab) and Quality (8× anti-aliasing, sharper shadows); Auto picks one per device. Frame rate limit setting.
- Optional cloud save in your own Google Sheet: one save on desktop and tablet with a private sync code, auto upload that never overwrites a further-along game.
- Docs: new `CLAUDE.md` (agent guide), `BACKLOG.md` (epics and work packages), this changelog, `docs/RESEARCH.md`. Old `ROADMAP.md` and `HANDOFF.md` folded into these; original brief and full playtest log moved to `docs/archive/`.
- Docs: `docs/DESIGN.md` (v2 direction: colony economy, market, operations, events, scenarios, telemetry) and `docs/IDEAS.md` (parked ideas).
- Deploy workflow runs on `main` (and on `master` until the rename).

## 1.0.0 (2026-11-21): first public build
Play at https://johakunath.github.io/Silicon-Dawn/
- Broken buildings repair themselves over time (Self-Healing Grid makes it 3× faster).
- Saves: autosave when the tab is hidden or closed, a warning when browser storage is full, damaged save files are rejected safely.
- Fixes: inspector buttons no longer swallow clicks, Title → Load → Back works, tutorial steps can no longer get stuck, clear message when WebGL 2 is missing.
- Automatic deploy to GitHub Pages.

## 0.9 (2026-11-20): feedback rounds 1 and 2
- Interactive 13-step tutorial; campaign starts paused.
- Codex replaces the long field guide: short chapters, Buildings A–Z with live rates, "Who uses all this AI?".
- Rich tooltips everywhere with per-minute rates and ratios ("how many furnaces per extractor"), statistics screen (`I`), live link flows in the inspector.
- New tools: Link in either click order, Move (`V`), pipette (`G`), hotbar `1`–`0`, Junction (merge/split belts and pipes), platforms on uneven ground, 100% refunds.
- Previews: power hookup line while placing, auto-link preview, link tool validity.
- Visuals: finer half-tile terrain, detail pass on all building models, glowing cables, battery fill gauges, MSAA and UI scaling for 1440p/4K, tech tree as a graph.

## 0.8 (2026-11-19): milestones M0 to M4, full rebuild
- Rebuilt from scratch in Three.js: lit low-poly diorama, day/night, bloom, per-era colour grade.
- Five eras (Sand, Silicon, Datacenter, Hyperscale, Dawn) with objectives, 17 techs, 5 events, contracts, 3 difficulty modes, sandbox after the finale.
- Visible logistics: packets on belts, pipes, cables and fiber; local power grids, cooling loops, fiber clusters.
- Wow moments: dusk light wave, fab steam, halls lighting up, fiber cluster sync, Dawn Engine finale.
- Procedural audio, overlays, save slots with export/import, headless autoplayer, 677 buildings at ~85 fps.

## 0.2 (legacy)
Canvas 2D prototype, kept in `legacy-v0.2/` for reference.
