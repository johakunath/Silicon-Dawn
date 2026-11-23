# Silicon Dawn

An isometric strategy and automation game about building the **physical infrastructure behind AI**. You start with sand, sunlight and a single Command Core, and you finish with a glowing continent of fabs, datacenters, fiber clusters and fusion. The ending is a clearly **fictional** capstone, the Dawn Engine.

Built with **Vite, TypeScript and Three.js** (WebGL). It plays on a desktop PC and on a tablet (tested in emulation for an 11-inch Galaxy Tab S9 with touch and S Pen).

**Play online:** https://johakunath.github.io/Silicon-Dawn/ (saves stay in your browser's local storage; use Menu → Save/Load → Export JSON to keep a portable copy, or set up the optional cloud save in your own Google Sheet: `tools/apps-script/README.md`).

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

Every push to `main` runs the tests, builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

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

The scenarios are `title`, `era1` through `era5` and `stress`. `GFX=performance` or `GFX=quality` benchmarks one graphics profile, `TABLET=1` emulates the tablet, `SHOTDIR=…` saves screenshots elsewhere, `NOSHOT=1` only benchmarks, `FRAMES=n` sets the benchmark length. Each one plays headlessly through the real renderer and saves day, night, wide and overlay screenshots to `screenshots/`, then benchmarks frame times. `stress` builds 600+ buildings.

```bash
npx tsx scripts/playtest.ts
```

This plays early Era 1 with real mouse clicks and key presses through the actual UI, and logs what a new player would see.

```bash
npx tsx scripts/uicheck.ts
```

`uicheck.ts` reviews the UI at 2560×1440: tutorial, tooltips, codex, stats, tech tree, auto-link and link previews, inspector.

## Controls

| | |
|---|---|
| Camera | WASD or drag with the right mouse button to pan · the wheel zooms to the cursor · Q/E rotate 90° · **LMB + RMB drag** (or Alt + RMB) rotates freely |
| Build | Build menu, or the **hotbar** `1`–`0`. Hover a build item and press a number to assign it to that slot. LMB places, dragging paints small buildings, RMB or Esc cancels |
| Tools (bottom bar) | `L` link (click two buildings in either order, or click a link to remove it) · `V` move · `X` demolish (100% refund) · auto-link toggle · `G` pipette |
| Info | Hover anything for rich tooltips · `I` statistics · `K` ledger · `J` codex · `T` tech tree · `P H N O` overlays · `Z` next problem · `C` Core |
| Misc | `M` pod mode · `R` repair · Space pause · +/− speed · F3 performance stats |

### Touch (tablet) and S Pen

| | |
|---|---|
| Camera | One finger drag pans · pinch zooms · two-finger twist rotates · right-edge buttons: ⟲ ⟳ rotate 90°, ＋ − zoom, ◎ back to the Core |
| Build | Tap a build item, then tap the map to place (the ghost stays where you tapped). The red **Cancel** pill stops building (replaces right-click and Esc) |
| Inspect | Tap selects. **Hold** half a second for the tooltip (replaces hover); in build mode, hold shows the placement check without building. Hold any button or gauge for its tooltip |
| Tools | Link, move, demolish and auto-link in the bottom bar; pause and speed in the top bar; ⧉ copy (pipette) and ⚠ next problem on the right edge |
| S Pen | Hover shows tooltips like a mouse; tap and drag work like a finger |

The hotbar and key hints are hidden on touch. Menu → **Graphics** switches between **Performance** (default on touch screens: lower resolution, 30 fps, keeps the tablet cool) and **Quality** (default with a mouse), and sets a frame rate limit.

A new campaign starts **paused** and opens an interactive tutorial (13 steps, with a spotlight on the exact button or map spot). You can restart it from the Codex.

## Project map

- `src/sim/`: pure, deterministic simulation (fixed 0.1 s tick, seeded RNG, no DOM).
  - `data/`: buildings, items, eras and objectives, tech, events, field guide. All content is data-driven.
  - `sim.ts` (tick), `power.ts` (local grids), `actions.ts` (rules), `save.ts` (versioned schema with migrations), `autoplayer.ts`.
- `src/render/`: the Three.js layers (terrain, water, props, instanced buildings, links and packets, particles, overlays, finale, post-processing).
- `src/ui/`: the DOM HUD, inspector, modals, minimap, status explanations and icons.
- `src/audio/`: procedural WebAudio for sound effects and the layered ambient and music bed.
- `src/game/`: the controller (loop, input, camera, tools, signal → FX and audio wiring).
- `tests/`: the Vitest suite. `scripts/`: the autoplayer CLI, screenshot and benchmark harness, and real-input playtest.
- Docs: `CLAUDE.md` (agent guide and doc map), `BACKLOG.md` (what's next), `CHANGELOG.md` (release notes), `docs/` (architecture, art bible, research, playtest).
- `legacy-v0.2/`: the old Canvas 2D prototype, kept for reference only.
