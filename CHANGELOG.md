# Release notes

Newest first. Each entry says what a player notices. Technical detail lives in the commit history.

## Unreleased
- Colony economy: buildings cost credits as well as materials, and every minute costs upkeep, power bought through the Core (cheap at noon, expensive at dusk), gas fuel and water. Credits come from exports of surplus metal, silicon and chips, contracts, power sold, a funding round at each new era and a small Core stipend. Deep debt triggers an emergency grant that lowers the era score, so you can never get stuck broke.
- Ledger (`K`, or click the credits chip): income and costs per minute, balance trend, power price over the day, cost per 1,000 compute, utilisation, payback for every building type, and SELL/HOLD switches for exports.
- Build tooltips show capex, running cost and payback (or cost per compute). New Codex chapter "Unit economics".
- Demolishing refunds all credits for 2 minutes, then half (materials are still refunded in full).
- Belts out of the stockpile now stop at a build reserve sized to the era, so a busy base can always afford its next building.
- Saves move to version 3; older saves open with a balance sized to the era they reached.
- Backlog: new epic E2 Tablet and quality profiles; later epics renumbered.
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
