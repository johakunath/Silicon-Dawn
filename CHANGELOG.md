# Release notes

Newest first. Each entry says what a player notices. Technical detail lives in the commit history.

## Unreleased
- Docs: new `CLAUDE.md` (agent guide), `BACKLOG.md` (epics and work packages), this changelog, `docs/RESEARCH.md`. Old `ROADMAP.md` and `HANDOFF.md` folded into these; original brief and full playtest log moved to `docs/archive/`.
- Deploy workflow now runs on the `main` branch (renamed from `master`).

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
