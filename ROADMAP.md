# SILICON DAWN — Roadmap

*From sand to sentience. Isometric strategy about the physical road from zero AI to a fictional AGI capstone.*

**Status: v0.2 — Infrastructure Literacy**  
Zero runtime dependencies, static-host deployable, responsive desktop/mobile UI, ten-level persistent campaign.

---

## What v0.2 contains

| System | State |
|---|---|
| Isometric renderer | Procedural tiles and buildings, painter ordering, zoom/pan, culling, day/night grading, shadows, bloom, particles, construction pop-in and selection rings |
| Biomes and deposits | Grass, desert, tundra, mesa and water; silicon, metal and rare-earth clusters; biome bonuses |
| Production economy | Energy, Si, Fe, RE, water, chips, compute, research and robots with rate-based production chains |
| Infrastructure depth | Grid batteries store surplus energy; network fabric boosts adjacent compute; cooling adjacency and tundra bonuses |
| Workloads | Training accumulates useful compute; inference requires sustained free capacity and grid health |
| Operations UI | Grid health, power headroom, free/total compute, utilization, approximate PUE, battery reserve and contextual bottleneck diagnosis |
| Overlays | World, deposits, power, cooling and compute; extractor selection centers and highlights every valid resource tile |
| Campaign | Ten levels with staged onboarding, persistent lessons, workload objectives, debriefs and a clearly fictional AGI finale |
| Learning layer | Ten-entry AI Infrastructure Field Guide covering power, chips, compute, training/inference, cooling/PUE, networks, storage, reliability and automation |
| Persistence | Local autosave every 30 seconds, manual save/load, portable JSON export/import |
| Presentation | Categorized build palette, minimap, synth sound feedback, accessible button labels, keyboard controls and reduced-motion support |
| Mobile | Compact operations panel, horizontally scrollable resource/build controls, no page overflow at 390 px |
| Project health | Shared pure rules module, dependency-free Node tests, README and architecture guide |

Run regression tests with:

```powershell
node test/run-tests.js
```

---

## v0.3 — Connected infrastructure

The next major step is to replace selected global abstractions with readable topology. Prefer graph simulation with visual flow tokens over thousands of item entities.

- [ ] Substations and power coverage zones; batteries attach to local grids
- [ ] Cooling loops with pipe segments, flow capacity, chillers and heat rejection
- [ ] Fiber links and switch capacity for multi-building training clusters
- [ ] Local building input/output buffers
- [ ] Flow-graph material logistics with visually animated packets
- [ ] Overlay legends and warnings for disconnected or saturated links

## v0.4 — Scenario campaign

- [ ] Handcrafted scenario seeds instead of one persistent map
- [ ] Desert solar-and-water scenario
- [ ] Tundra cooling-and-distance scenario
- [ ] Grid outage, heatwave, water restriction and chip-shortage events
- [ ] Training deadline, inference latency and uptime contracts
- [ ] Per-scenario efficiency, reliability and footprint ratings
- [ ] Relaxed, standard and race difficulty modes

## v0.5 — Technology and operational choices

- [ ] Research tree with efficiency, capacity and reliability branches
- [ ] Training-optimized versus inference-optimized accelerators
- [ ] Memory, storage and networking upgrades
- [ ] Redundancy, backup capacity and failure recovery mechanics
- [ ] Carbon intensity, water use and cost as optional advanced metrics
- [ ] Model scheduler that assigns workloads to available clusters

## v0.6 — Presentation and world life

- [ ] Hand-tuned sprite atlas while retaining procedural fallbacks
- [ ] Construction vehicles, maintenance drones and visible material traffic
- [ ] Layered ambient audio that grows with grid and compute scale
- [ ] Distinct biome ambience and event sounds
- [ ] Camera momentum, focus shortcuts and richer minimap interaction
- [ ] Post-campaign sandbox and living automated-city epilogue

---

## Known limitations

- Raw materials and most power remain global pools; v0.3 introduces local networks.
- One persistent procedural map serves all ten levels.
- PUE is an educational approximation based on facility versus IT power, not a full thermodynamic model.
- Numbers need broad human playtesting and a formal balance pass.
- Save format v2 is intentionally simple; later schema changes will need migrations.
- `index.html` still owns most browser-facing systems. Extract campaign, simulation and renderer when it grows beyond the current manageable static-build scope.

## Tech notes for future sessions

- `src/game-core.js` contains pure rules shared by browser and Node tests.
- `BD` remains the source of truth for buildings; `LEVELS` remains the campaign source of truth.
- The map seed is `20260705`; saves record the seed and placed buildings.
- Multi-tile buildings will require depth sorting by footprint rather than the current one-tile painter order.
- Keep the AGI finale explicitly fictional. Teach constraints and trade-offs without implying a real threshold for intelligence.
