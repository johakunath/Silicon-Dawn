# Silicon Dawn

An isometric browser strategy game about building the physical infrastructure behind increasingly capable AI systems: raw materials, chips, power, cooling, compute, research, automation, and a fictional AGI endgame.

## Run locally

```powershell
python -m http.server 8321
```

Open `http://127.0.0.1:8321/`.

## Test

```powershell
node test/run-tests.js
```

The game has no runtime dependencies and can be deployed as static files.

## Project map

- `index.html` — Canvas renderer, UI, campaign, and browser integration.
- `src/game-core.js` — Pure reusable rules for placement, power, scoring, and save validation.
- `test/run-tests.js` — Dependency-free core regression tests.
- `ROADMAP.md` — Current status and future priorities.
- `ARCHITECTURE.md` — State, simulation, rendering, and extension notes.

## Design principles

1. Every stalled system must explain why it is stalled.
2. Infrastructure relationships should be visible through overlays and metrics.
3. New mechanics should teach real concepts while keeping the campaign fictional and approachable.
4. Add depth incrementally; avoid a framework rewrite while the game remains small.
