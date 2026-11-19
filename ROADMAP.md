# Silicon Dawn: Roadmap

A from-scratch rebuild (v1) using Vite, TypeScript and Three.js. The legacy prototype is in `legacy-v0.2/`.

| # | Milestone | Status |
|---|---|---|
| M0 | Art bible and tech spike | ✅ `ART.md`, terraced diorama terrain, water, props, 28 building models, day/night, bloom, grading |
| M1 | Core loop | ✅ Instanced buildings, belts/pipes/cables/fiber with packets, ghost placement with reasons, HUD, audio, Vitest |
| M2 | Eras 1–2 and UI | ✅ Objectives, field guide, 4 overlays with legends, save/load (slots, autosave, JSON export/import, migrations), autoplayer |
| M3 | All eras and systems | ✅ Local grids, cooling, fiber clusters, 17 techs, 5 events, contracts, 3 difficulties, 5 eras |
| M4 | Polish and finale | ✅ Wow moments (dusk light wave, fiber sync, Dawn Engine column, flash wave, aurora), sandbox unlock, perf pass (677 buildings: 85 fps median, p95 14 ms), docs |

## Definition of Done status
| Item | Status |
|---|---|
| Full campaign playable in ~2–3 h, sandbox unlocks | ✅ Playable end to end. The bot finishes in 60 sim-min, and humans are estimated at 2–2.5 h (**needs human timing**) |
| Distinct look and sound per era, a wow moment per era | ✅ Per-era grade, bloom, fog, scale, root and tempo. Wow moments: first nightfall plus the dusk light wave, fab steam and chip packets, halls lighting up at night, fiber cluster sync, Dawn Engine finale |
| Tests and autoplayer pass, no console errors, 60 fps with 500+ buildings | ✅ 19/19 Vitest. The autoplayer completes all 5 eras. 0 console errors in every scenario. 677 buildings run at 85 fps median (RTX 4070, 1080p) |
| Screenshots of every era, docs current | ✅ `screenshots/era1…era5_*`, overlays, stress, finale |
| Fictional finale, teaches without lecturing | ✅ The finale and field guide state the fiction explicitly. Lessons live in short optional entries and in the stall explanations |

## Next (after human playtesting)
- Tune pacing and event severity from real play sessions (see `PLAYTEST.md`).
- Make the autoplayer robust on more sandbox seeds (it stalls in era 4 on seed 777).
- Optional: an on-boarding mid-goal in Era 1, and a prettier halo/column art pass.
