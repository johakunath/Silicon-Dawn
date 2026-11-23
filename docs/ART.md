# Silicon Dawn: Art Bible

## Engine choice: Three.js

I chose **Three.js** over PixiJS. The art direction is a *lit, low-poly 3D diorama* viewed through an orthographic isometric camera. That needs real directional and sun lighting, shadow maps, physically based materials, instanced 3D meshes and a post-processing chain (bloom, colour grading, vignette). Three.js provides all of these out of the box. PixiJS is a 2D sprite engine, so real lighting, a day/night cycle across 3D silhouettes, and shadows would all have to be faked by hand.

## Style in one line

> A **hand-crafted tabletop diorama** of a living planet that turns, era by era, into a **glowing neon compute civilisation at night**.

- **Geometry:** low-poly with flat shading and chunky, readable forms. There are no textures. Colour comes from vertex colours with per-tile noise jitter, so surfaces never look flat.
- **Terrain:** terraced height levels (a diorama look) with cliff walls in darker earth tones. The world is a floating slab with a visible soil and bedrock edge.
- **Light:** a warm key sun, a cool sky hemisphere fill and soft shadows. At night a cold moon dims the land and **emissive infrastructure takes over**, carried by bloom.

## Palette

| Role | Day | Night |
|---|---|---|
| Grass | `#6fae4f` to `#9cc95a` | desaturated to `#2b4a3a` |
| Desert / sand | `#e3c27a` to `#d6a85c` | `#5a5070` |
| Tundra / snow | `#e8f0f5` with ice-blue shadow `#a9c4d8` | `#5c6b8a` |
| Rock / cliff | `#8a7a6a`, cliff wall `#6b5847` | `#2c2a3a` |
| Water | deep `#1d5f8a`, shallow `#3fa7c7`, foam white | deep `#0a1a33` with moon glints |
| Sky / fog | `#bfe3ff` | `#0b1030` |

**Infrastructure neon (resource colour code).** These colours are constant across the whole game and match the item colour coding:

| Flow | Colour | Packet shape |
|---|---|---|
| Quartz / silicon | ice-cyan `#8ff3ff` | diamond |
| Ore / metal | amber `#ffb347` | cube |
| Chips | electric green `#5dff9a` | flat square |
| Accelerators | magenta `#ff4fd8` | octahedron |
| Rare earth | violet `#b98cff` | tetrahedron |
| Water / coolant | blue `#4fb4ff` / white-cyan `#c8f7ff` | sphere |
| Compute (data) | hot cyan-white `#6fe9ff`, fiber `#ffffff` with cyan core | thin streak |
| Power cables | warm yellow `#ffd84a` arcs | spark |

**Status colours:** OK = green with a ✓ ring, Warning = amber with a ▲ triangle, Stalled = red with an ✕ octagon, Unpowered = a grey ⚡ glyph with a slash. The **shape always carries the meaning** and the colour only reinforces it (colour-blind safe).

## Silhouette rules

Every building must be identifiable **from its outline alone at normal zoom**:

1. Each type has **one hero shape**: a dome, chimney, tilted panel, mast, cube hall, tower or ring.
2. The **height class** follows the role. Extraction is low and wide, refining is medium with chimneys, compute is boxy and tall, and power uses masts or panels.
3. Each building has **one emissive accent** in its resource colour, so you can read what it makes at night.
4. Footprints are 1×1, 2×2 or 3×3. Bigger means later era and more important.
5. Moving parts are animated (turbine blades, rack fans, extractor drills, cooling-tower steam) and signal "working". **Stopped motion means stalled.**

## UI style

- A **dark glass HUD** (`rgba(10,14,30,0.78)` with backdrop blur) with a 1 px cyan hairline border and slightly chamfered corners.
- **Big type for a 27-inch monitor.** Base 18 px, labels 15 px minimum, headers 28–40 px. The display font is **Rajdhani** (techy, condensed, readable) and body text is **Inter**.
- Numbers use tabular figures and animate when they change.
- Each resource has an icon chip in its flow colour, so the HUD, packets and overlays use one visual language.

## Era shifts

| Era | Mood | Light | Audio |
|---|---|---|---|
| 1 · Sand | Dusty dawn, warm amber haze, lonely | Low golden sun, long shadows | Wind, sparse plucks, soft drone |
| 2 · Silicon | Clean morning, cyan accents appear | Bright neutral daylight | Light arpeggio, water trickle, hum |
| 3 · Datacenter | Busy industrial, first real night glow | Cooler light, stronger bloom at night | Pulsing bass, transformer hum |
| 4 · Hyperscale | Electric, dense, fiber light rivers | Teal/magenta night grading | Driving sequencer, wind turbines |
| 5 · AGI (fictional) | Awe, aurora sky, white-gold core | Aurora, high bloom, god-rays | Choir-like pads, rising finale |

The colour grade (fog colour, tint, bloom strength) interpolates per era. The **buildable region expands** each era behind a glowing boundary, and the camera's maximum zoom-out grows with it.

## Wow moments (one per era)

1. **Sand:** the first sunset after your base runs. The panels go dark, the battery glows, and packets keep moving.
2. **Silicon:** the first chip fab powers up with a rising steam plume and green chip packets.
3. **Datacenter:** night falls on your first Datacenter Hall, and its windows light up row by row.
4. **Hyperscale:** "cluster sync": all fiber links pulse in unison as a training run starts.
5. **AGI:** the Dawn Engine ignites. The aurora sky, a light column and the entire grid flash in sequence.
