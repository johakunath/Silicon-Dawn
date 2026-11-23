# Architecture

```
            ┌─────────────── src/sim (pure, deterministic) ───────────────┐
 input ──►  │ actions.ts ──► GameState ◄── sim.step() @ 10 Hz fixed tick  │
 (game/)    │   place/link/research      power.ts  flow  heat  workloads  │
            │                            events  contracts  objectives    │
            │ data/*.ts  (buildings, items, eras, tech, events, guide)    │
            └───────┬───────────────────────────────┬─────────────────────┘
                    │ reads state                   │ state.signals[] (build, era, ignite…)
            ┌───────▼────────┐               ┌──────▼──────────┐
            │ src/render     │               │ src/ui + audio  │
            │ Three.js layers│               │ DOM HUD, WebAudio│
            └────────────────┘               └─────────────────┘
```

## Simulation (`src/sim`)

- **Determinism.** `step(s)` advances exactly 0.1 s. All randomness comes from `s.rng`, a serialisable `Rng`. Nothing in `sim/` touches the DOM, `Math.random` or wall-clock time, so a save plus N steps always gives the same result (there is a test for this).
- **The world** is generated from a seed (`world.ts`). It has terraced levels chosen by height percentiles, biomes from temperature and moisture noise, clustered deposits with guaranteed starter clusters, and props. The world is never saved; it is regenerated from the seed.
- **A tick runs in five passes** (`sim.ts`):
  1. **Hubs** set a per-building `boost`.
  2. **Wants and generation.** Each building's desired activity (inputs available, output space) determines its power demand. Generators report output from sun, wind and firm sources.
  3. **Local grids.** For each grid component: variable generation first, then firm (gas or fusion), then battery discharge. Surplus charges batteries. Every consumer gets the grid's satisfaction `sat` (a brownout scales everyone).
  4. **Production.** Recipes, extractors (scaled by deposit richness), IT heat (coolant → heat → throttle), workloads (research, training, inference, engine) and switches.
  5. **Flow.** For each source item, demand is split proportionally across its outgoing links. Each link is limited by its capacity and the destination's buffer space. Storage (the Core and Depots) is both a sink (delivery adds to the stockpile) and a source (links out of storage ship stockpiled goods). Link `state` is `idle`, `ok`, `saturated` or `blocked`, and the renderer and overlays show it.
- **Compute is a non-storable flow.** It carries three tags along links: inference quality (Q), training quality (T) and the fiber fraction (F). This is how pod modes and the "fiber trains 2× better" rule work without per-packet entities.
- **Power grids** (`power.ts`) are rebuilt only when something changes (`gridDirty`). Nodes are poles, substations, generators, batteries and the Core, joined by union-find; wires form a spanning forest sorted by distance. A consumer attaches to the nearest node whose radius covers its footprint.
- **Every status explains itself.** `Building.status` and `statusItem` feed `ui/status.ts`, which turns them into a title, a glyph and an explanation.
- **Progression.** Each era has objectives (`data/eras.ts`) with progress functions. When an era's objectives are all done, it is scored (efficiency = pace + PUE, reliability = demand-weighted grid health, footprint = clean energy share), the frontier radius grows, and new content unlocks.
- **Economy** (`economy.ts`, numbers in `data/economy.ts`). `GameState.econ` holds the balance and cumulative income and cost lines. `econTick()` runs at the end of every step (power bought and sold at the Core, fuel, water, upkeep, interest, stipend); `econSecond()` runs once per second (exports above the keep level, emergency grant). Capex is charged in `actions.place()` and refunded in `demolish()`. `unitEcon()` and `liveByType()` feed the ledger and tooltips.
- **Saves** (`save.ts`) use a versioned JSON schema. `migrate()` applies stepwise migrations (v1 → v2 → v3 are implemented and tested), and the loader rebuilds derived state.

## Rendering (`src/render`)

- `scene.ts` sets up the orthographic isometric camera rig, sun, moon and hemisphere lights, PCF soft shadows following the view, and the EffectComposer chain: Render → UnrealBloom → Grade (era tint, saturation, vignette, grain, flash, aurora, event tint) → Output (ACES tone mapping). `setTimeOfDay(tod, era)` drives the light colour and intensity, fog and background, bloom and the glow level.
- `terrain.ts` builds the terraced terrain as a single flat-shaded vertex-coloured mesh with strata cliffs and the diorama slab. Water is a shader plane with waves, shore-distance foam, fresnel and sun or moon glints. Props and deposits are instanced.
- **Overlays** are a 128×128 DataTexture injected into the terrain shader (`onBeforeCompile`). Alpha parity marks emissive tiles. The same texture draws the frontier, build hints (deposits, shoreline, power coverage) and the power and heat overlays.
- `buildings.ts` uses **one InstancedMesh per type and part** (body, glow, spinning part). Glow instance colours encode status and activity, plus the dusk "lights-on" wave and the finale flash wave. Pop-in uses an elastic matrix animation.
- `links.ts` draws instanced belt, pipe and data segments with posts, plus **instanced packets per shape**. Packets spawn from each link's cumulative `total` delta, so visual density equals real flow. Blocked links queue their packets and blink red. The fiber sync pulse is the era 4 wow moment.
- `particles.ts` is a single `THREE.Points` draw for steam, smoke, heat shimmer, sparks, build dust and finale bursts.
- `finale.ts` provides the Dawn Engine light column, halo and expanding flash wave.

## UI and audio

- The ledger (`ui/ledger.ts`, `ui/ledger.css`) renders the credits chip, the ledger modal (`K`) and the money rows in build tooltips; `hud.ts` only hooks it in.
- The DOM HUD (`ui/hud.ts`) has heavy parts throttled to 4 Hz, and the badges follow buildings every frame. Badges are colour-blind safe: an octagon ✕ means severe, a triangle ▲ means a warning, plus a glyph.
- Audio (`audio/audio.ts`) is all procedural: sound effects come from oscillators and noise with envelopes and a convolver reverb. The ambient bed is layered (wind, pad, mains hum, fans, choir, crickets) and its gains follow building count, power, compute, night and era. A sequencer plays an era-specific scale and gets denser with compute.

## Extending

- **New building:** add an entry to `data/buildings.ts` and a model builder in `render/models.ts`. Most behaviour comes from the data fields (`inputs`, `outputs`, `power`, `node`, `battery`, `it`, `workload`, `hub`).
- **New resource:** add it to `ItemId` and `ITEMS` (colour, shape, link kind, packet size).
- **New objective, event or tech:** add data only. Tech effects are additive fields on `TechEffects`.
- Keep the sim pure, and add a Vitest test for any new rule.
