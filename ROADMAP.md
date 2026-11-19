# Silicon Dawn: Roadmap

A from-scratch rebuild (v1) using Vite, TypeScript and Three.js. The legacy prototype is in `legacy-v0.2/`.

| # | Milestone | Status |
|---|---|---|
| M0 | Art bible and tech spike | ✅ `ART.md`, terraced diorama terrain, water, props, 28 building models, day/night, bloom, grading |
| M1 | Core loop | ✅ Instanced buildings, belts/pipes/cables/fiber with packets, ghost placement with reasons, HUD, audio, Vitest |
| M2 | Eras 1–2 and UI | ✅ Objectives, field guide, 4 overlays with legends, save/load (slots, autosave, JSON export/import, migrations), autoplayer |
| M3 | All eras and systems | ✅ Local grids, cooling, fiber clusters, 17 techs, 5 events, contracts, 3 difficulties, 5 eras |
| M4 | Polish and finale | 🟡 Wow moments (dusk light wave, fiber sync, Dawn Engine column, flash wave, aurora), sandbox unlock, perf pass in progress |

Next: re-run the 600-building benchmark (check that the p95 spikes are gone), human balance tuning, and an autoplayer that is robust across sandbox seeds.
