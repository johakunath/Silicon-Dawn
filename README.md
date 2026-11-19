# Silicon Dawn

An isometric strategy and automation game about building the **physical infrastructure behind AI**. You start with sand, sunlight and a single Command Core, and you finish with a glowing continent of fabs, datacenters, fiber clusters and fusion. The ending is a clearly **fictional** capstone, the Dawn Engine.

Built with **Vite, TypeScript and Three.js** (WebGL). It plays best on a gaming PC with a large monitor.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173. In Claude Code, the `silicon-dawn` entry in `.claude/launch.json` starts the same server.

## Build (static files)

```bash
npm run build
```

The output goes to `dist/`. Serve it from any static host, for example with `npm run preview`.

## Test

```bash
npm test
```

This runs the Vitest suite. It covers world generation, placement, power grids, brownouts, batteries, logistics flow, cooling and heat, research, save/load and migration, two-way storage, and the **headless autoplayer**. The autoplayer plays eras 1–2 on two seeds and the full campaign on the campaign seed. It asserts there is no deadlock, no NaN and no negative resources.

```bash
npm run autoplay -- 5
```

This plays the campaign headlessly and prints era timings, ratings and any problems. The optional arguments are the target era and the seed.

## Screenshots, playtest and benchmark (headless Edge)

The dev server must be running.

```bash
npx tsx scripts/shots.ts era1
```

The scenarios are `title`, `era1` through `era5` and `stress`. Each one plays headlessly through the real renderer and saves day, night, wide and overlay screenshots to `screenshots/`, then benchmarks frame times. `stress` builds 600+ buildings.

```bash
npx tsx scripts/playtest.ts
```

This plays early Era 1 with real mouse clicks and key presses through the actual UI, and logs what a new player would see.

## Controls

| | |
|---|---|
| Pan / zoom / rotate | WASD or drag with the right mouse button / mouse wheel (zooms to the cursor) / Q, E |
| Build | Click a palette item or press 1–9. LMB places, dragging paints small buildings, RMB or Esc cancels |
| Link / demolish | L (source → destination; Shift chains links; clicking a link removes it) / X, or Del on the selection |
| Overlays | P power · H heat · N compute network · O logistics flow |
| Panels | T tech · J field guide · Esc menu (settings, save/load) |
| Navigation | Z next problem · C Core · F focus selection |
| Misc | M pod mode · R repair · Space pause · +/− speed · F3 performance stats |

## Project map

- `src/sim/`: pure, deterministic simulation (fixed 0.1 s tick, seeded RNG, no DOM).
  - `data/`: buildings, items, eras and objectives, tech, events, field guide. All content is data-driven.
  - `sim.ts` (tick), `power.ts` (local grids), `actions.ts` (rules), `save.ts` (versioned schema with migrations), `autoplayer.ts`.
- `src/render/`: the Three.js layers (terrain, water, props, instanced buildings, links and packets, particles, overlays, finale, post-processing).
- `src/ui/`: the DOM HUD, inspector, modals, minimap, status explanations and icons.
- `src/audio/`: procedural WebAudio for sound effects and the layered ambient and music bed.
- `src/game/`: the controller (loop, input, camera, tools, signal → FX and audio wiring).
- `tests/`: the Vitest suite. `scripts/`: the autoplayer CLI, screenshot and benchmark harness, and real-input playtest.
- Docs: `ART.md` (art bible), `ARCHITECTURE.md`, `ROADMAP.md`, `PLAYTEST.md`, `HANDOFF.md`.
- `legacy-v0.2/`: the old Canvas 2D prototype, kept for reference only.
