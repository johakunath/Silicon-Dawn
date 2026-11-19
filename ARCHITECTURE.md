# Architecture

## Runtime

`index.html` owns the browser-facing game loop. It uses a deterministic 48×48 map, a mutable state object (`S`), fixed data tables for buildings and levels, a rate-based simulation, and a Canvas 2D renderer.

`src/game-core.js` is a small UMD-style pure module shared by the browser and Node tests. New rules that do not need the DOM or Canvas should go there first.

## Frame sequence

1. Read keyboard/pointer input.
2. Advance `sim(dt)` one or three times according to game speed.
3. Update particles.
4. Render terrain, overlays, buildings, particles, lighting, and selection feedback.
5. Refresh DOM telemetry at a lower frequency.

## Sources of truth

- `BD`: building costs, unlock levels, placement, energy, descriptions, sprite parameters.
- `LEVELS`: campaign names, unlocks, objectives, teaching copy.
- `S`: resources, buildings, progression, workload progress, metrics, and player options.
- `map`: terrain, deposits, and tile occupancy.

## Change safety

- Put deterministic calculations in `src/game-core.js` and add a Node assertion in `test/run-tests.js`.
- Keep display-only effects out of simulation state unless saving them matters.
- When adding a resource, update `RES`, state initialization, HUD rendering, save/load, and relevant tests.
- When adding a building, update `BD`; simulation branches should remain small and explicit.

## Next structural step

When `index.html` exceeds roughly 1,500 lines, extract campaign data, simulation, and renderer into separate classic scripts in that order. This preserves zero-dependency static deployment.
