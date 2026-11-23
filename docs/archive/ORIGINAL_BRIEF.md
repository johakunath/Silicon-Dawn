> Archived: the original rebuild brief (2026-11-19). History only; current work lives in `BACKLOG.md`.

# Handover: Rebuild "Silicon Dawn" from scratch

You are building a new version of **Silicon Dawn**, a browser strategy and automation game about building the physical infrastructure behind AI. It runs from sand and solar panels up to a clearly fictional AGI ending. The goal is a game that looks **super impressive** and is **genuinely fun to play**. A tech demo is not the goal.

Work autonomously. Make reasonable design decisions yourself and write them down. Stop only for real blockers, such as missing tools or a decision that can't be undone.

---

## 0. Setup (do this first)

1. This folder contains the old v0.2 prototype (`index.html`, `src/`, `test/`, `README.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `screenshots/`, `.claude/launch.json`).
2. Run `git init` and commit everything as-is, with the message "Legacy v0.2 snapshot".
3. Move all the old files except `.claude/` and this file into `legacy-v0.2/`. Commit again.
4. Read `legacy-v0.2/` **only for context**: the theme, its ten-level campaign idea, the field-guide topics, and what the roadmap planned. **Do not reuse its code or structure.** Its weaknesses are exactly what this rebuild fixes: a flat, empty-looking map; tiny buildings that are hard to tell apart; invisible global resource pools; and a spreadsheet feel.
5. Commit after every milestone, and more often if useful. Use clear commit messages.

## 1. Vision

**Fantasy:** You start on an empty planet with one solar panel and end up running a glowing, humming, continent-scale compute civilisation. You can watch every electron, wafer and token flow.

**Fun pillars.** Every feature must serve at least one of these:
1. **Satisfying building:** snap placement, juicy feedback, sound on every action.
2. **Readable bottlenecks:** you can *see* the jam, whether it's a backed-up conveyor, a red-hot rack or a dimming grid. Every stalled building explains why it is stalled.
3. **Scale escalation:** the base grows, the camera pulls back, and each era *looks and sounds* different.
4. **Meaningful choices:** trade-offs between efficiency, throughput and reliability, never one "best" build.
5. **Wow moments:** at least one spectacular moment per era, such as the first datacenter lighting up at night, a cluster training run with visible fiber pulses, or the finale.

**Progression: about 5 eras.** Each era adds a new mechanical layer *and* a visual and audio shift.
1. **Sand:** solar, extraction (silicon, metal), conveyors, basic power.
2. **Silicon:** chip fabs, water, cooling, first server racks, compute.
3. **Datacenter:** local power grids with substations and batteries, cooling loops, inference contracts.
4. **Hyperscale:** fiber networks, training clusters, robots and automation, wind and fusion, events.
5. **Fictional AGI:** the capstone project. A spectacular, clearly fictional finale. It must not imply that a real intelligence threshold exists.

Target length: the full campaign is playable in **about 2–3 hours**. After the campaign, a **sandbox mode** with a seed picker unlocks.

## 2. Audience and visual and audio bar

- **Platform:** a gaming PC with a large monitor (27-inch or bigger). Use **big, readable fonts** and **rich effects**. **Mobile is a non-goal**, so don't spend effort on it.
- **Rendering:** WebGL, using **PixiJS or Three.js** (your choice; justify it in `ART.md`) with an isometric or orthographic camera. Expected features: bloom, real lighting, a day/night cycle, emissive datacenters and city glow at night, steam particles from cooling towers, heat shimmer around overloaded racks, and animated flow along every connection.
- **Art bible first.** Before building content, write `ART.md` with one coherent style: palette, lighting mood, silhouette rules, UI style, and how each era shifts. The suggested direction is a **stylised low-poly diorama with neon infrastructure at night**, but choose what looks best. Every building needs a **distinct silhouette** that reads at a glance at normal zoom. The terrain must look alive (varied biomes, height, water with movement, props), never a flat green carpet.
- **Audio:** procedural WebAudio. A layered ambient bed that grows richer with your infrastructure, distinct sounds per building type and event, and satisfying UI clicks. Add a master volume and a mute control.
- **Game-feel checklist:** ghost placement preview with valid/invalid tint and a reason; build pop-in animation; light screen-shake on big builds; floating number pop-ups; smooth camera with momentum, zoom to cursor, and focus shortcuts; hover tooltips; an informative minimap.
- **Accessibility basics:** a reduced-motion option, keyboard shortcuts, and colour-blind-safe status indicators (shape plus colour, never colour alone).

## 3. Gameplay systems

- **Visible logistics:** resources travel as animated packets along conveyors, cables, pipes and fiber. Use a **graph-based flow simulation** with buffers per building, not thousands of individual item entities. Saturated or disconnected links must be visible as warnings in overlays.
- **Local networks:** power grids built from generators, substations and batteries, where coverage zones matter; cooling loops (pumps, pipes, chillers, heat rejection); fiber and switches that link racks into training clusters.
- **Workloads:** *training* accumulates compute toward model milestones, and *inference* needs sustained free capacity and uptime. Both drive objectives.
- **Tech tree:** branches for efficiency, capacity and reliability. Accelerators can be specialised for training or for inference. Add memory, storage and network upgrades.
- **Tension:** events (heatwave, grid outage, water restriction, chip shortage) and contracts (training deadline, inference uptime, latency). Offer difficulty modes: relaxed, standard, race.
- **Learning layer:** a light in-game field guide that teaches real concepts (power, PUE, chips, training vs. inference, cooling, networking, reliability, automation) in short, optional entries, unlocked as each topic appears.
- **Overlays:** power, cooling/heat, compute/network, and logistics flow, each with a legend.
- **Scoring:** per-era ratings for efficiency, reliability and footprint.
- **Out of scope:** combat and multiplayer.

## 4. Engineering rules

- **Stack:** **Vite + TypeScript**. The build output is static files that can be served from any host.
- **Architecture:**
  - Keep the **simulation** as pure, deterministic, DOM-free modules (fixed timestep, seeded RNG).
  - Keep **rendering** and **UI** as separate layers that read simulation state.
  - Make it **data-driven**: buildings, recipes, eras, events and tech live in data files, not in code branches.
- **Tests:**
  - Use **Vitest** for simulation rules (flow, power, cooling, save migration).
  - Write a **headless autoplayer** script that plays through at least eras 1–2 using a simple strategy. It asserts that the game can be finished, doesn't deadlock, and shows no NaN or negative resources.
- **Save/load:** autosave plus manual save, a JSON export/import, and a **versioned schema with migrations**.
- **Performance:** 60 fps on a gaming PC with 500+ buildings and active flow. Profile it, and use instancing or batching where needed.
- **Dev server:** update `.claude/launch.json` to run the Vite dev server, so you can preview the game in the built-in browser.
- **Docs to keep current:** `README.md` (run, test, build), `ARCHITECTURE.md`, `ROADMAP.md` (status per milestone), `ART.md`, `PLAYTEST.md`, and `HANDOFF.md` (what's done, what's next, known issues, so a later session can resume cleanly).

## 5. Milestones

Each milestone must end with something you can play.

| # | Milestone | Done when |
|---|---|---|
| M0 | Art bible and tech spike | `ART.md` written. One gorgeous lit building on living terrain, with day/night and bloom, renders at 60 fps. Screenshot reviewed. |
| M1 | Core loop | 5 buildings, visible conveyor/cable flow, placement with ghost preview, basic HUD, sound, simulation tests green. |
| M2 | Eras 1–2 and UI | Full era 1–2 content, objectives, field-guide entries, overlays, save/load. The autoplayer finishes eras 1–2. |
| M3 | All eras and systems | Local grids, cooling loops, fiber clusters, tech tree, events, contracts, difficulty modes, all 5 eras. |
| M4 | Polish and finale | Audio layering, wow moments, the AGI finale, balance pass, sandbox mode, performance pass, docs. |

## 6. Self-check loop (required after every milestone)

1. **Run it** in the preview browser. Check the console for errors.
2. **Screenshot critique.** Take screenshots of normal play, a busy base, night, and each overlay. Critique them honestly: *"Would this impress someone on a 27-inch monitor? Do the buildings read at a glance? Is the text big enough? Is anything flat, empty, or muddy?"* Fix the worst issues before moving on.
3. **Fun review.** Play about 10 minutes (by hand through the browser, plus the autoplayer). In `PLAYTEST.md`, note what is boring, confusing, slow, or too easy. Fix the biggest problem.
4. **Tests and performance.** All tests are green, the autoplayer passes, and frame rate is checked with a large base.
5. **Commit** and update `ROADMAP.md` and `HANDOFF.md`.

## 7. Definition of done

- The full campaign can be played start to finish in about 2–3 hours, and the sandbox unlocks afterwards.
- There's a distinct look and sound per era, and at least one wow moment per era.
- All tests and the autoplayer pass. There are no console errors, and the game holds 60 fps with 500+ buildings.
- Screenshots of every era are saved in `screenshots/`. The docs above are current.
- The AGI finale is clearly fictional, and the game teaches real infrastructure trade-offs without lecturing.

**Start with Step 0, then M0.**
