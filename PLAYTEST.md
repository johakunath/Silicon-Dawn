# Playtest notes

Method: each milestone has three checks. (1) A real-input run in headless Edge (`scripts/playtest.ts`), which clicks the palette, places buildings by screen position, presses hotkeys and reads the tooltips and inspector. (2) The headless autoplayer, which tests pace, deadlocks and sanity. (3) A screenshot review at 1920×1080 (`scripts/shots.ts`). The Claude browser pane was hidden for most of the session (rAF is throttled to about 2 fps), so "playing by hand" was done with the real-input harness instead.

## M1 / M2 (Eras 1–2)

| Finding | Type | Action |
|---|---|---|
| You could soft-lock: spend all your metal, then a needed belt could never be paid for | **Broken** | Links are now free and limited only by length. The Core salvages a scrap trickle when metal is below 25. |
| Auto-link sent raw quartz to the Core, which was useless | Confusing | Storage now accepts only refined goods. An extractor with no refinery says "No output link → link it to a consumer". |
| A refinery fed 50% read as "Starved" | Misleading | "Starved" now needs less than 20% supply. Partial supply shows as reduced activity in the inspector. |
| Brownout badges appeared over every building (badge soup) | Noisy | Mild brownouts are shown once, grid-wide (power bar, red vignette). Only severe ones get a badge. |
| Power overlay was too faint to read | Visual | Alpha raised to 0.58. The overlay also tints the buildings themselves (unpowered = red, power = gold). |
| The heat overlay was invisible when racks were cool | Visual | IT buildings are tinted blue→red by heat, and coolers glow cyan. |
| Many players won't notice that a placement spot is unpowered | Confusing | The ghost tooltip warns "⚡ No grid here", and placement tints the covered tiles. |
| Era 1 and 2 objectives were finished too quickly (bot: 6 and 4 min) | Too easy | Targets raised. The bot now takes about 9 and 8 min, so humans take an estimated 15–20 min each. |
| The first night is the first real "aha" | **Fun** | A one-time toast explains it. Lights switch on in a staggered wave at dusk. |
| HUD resource rates jumped to ±1000/min after pause or speed-up | Bug | Rates are now computed per sim-second. |

## M3 (Eras 3–5)

| Finding | Type | Action |
|---|---|---|
| The Accelerator Fab couldn't get chips (belts max out at 14 tiles, and there was no relay) | **Broken** | Storage is two-way: link Core or Depot → consumer to ship stockpiled goods. Supply Depots became remote logistics hubs. |
| Accelerator Fab water was unreachable near tundra rare-earth sites | Frustrating | It no longer needs water. |
| The top bar overflowed when more resources appeared | Visual | Compacted the logo, chips and gauges. |
| Era 5 rendered black | **Broken** | A zero-length link segment produced a NaN quaternion, which bloom smeared across the screen. Guarded, and water fresnel and the column `pow()` are clamped too. |
| The fiber cluster felt like "just more cables" | Flat | Cluster sync: fiber pulses in unison while training runs. |

## M4 (final pass)

| Finding | Type | Action |
|---|---|---|
| The stress benchmark showed a 94 ms p95 | Perf (measurement) | The spikes were shader-compile warmup inside the window. After warmup, 677 buildings run at a 11.7 ms median and 14.4 ms p95 |
| 677 buildings ran at a ~15 ms median, close to the 60 fps limit | Perf | Shadow map 3072, and only trees and pines cast prop shadows, which gives 85 fps median |
| The aurora drew scanline stripes across the whole screen | Visual | Smoother bands, limited to the top 40% of the frame |
| The finale halo disc looked like a flat plate | Visual | It is smaller and fades out as it expands |
| Real-input Era 1 replay: placement tips, deposit coverage, auto-link | ✓ | No console errors, and the flow works through the actual UI |

## Feedback round 1 (Johannes, first hands-on session)

| Feedback | Action |
|---|---|
| Start with a guided tutorial; start paused | The campaign starts **paused**. An interactive 13-step tutorial spotlights the exact tab, button or map spot and advances on real actions. It covers solar, the power gauge, extractors, furnaces and auto-link, ore, manual links, batteries, inspector, stats and codex. You can skip or restart it. |
| The field guide was too much text | It is now a **Codex** with chapters on the left and short bullets on the right: Getting started, Power, Belts and links, Stockpile, Production ratios, Compute and cooling, Who uses all this AI?, Events, Overlays and stats, Buildings A–Z (auto-generated with live rates) and Real-world notes. |
| Tooltips too minimal, and per-minute rates missing everywhere | Rich tooltips are on every resource (produced, consumed, delivered and spent per minute), on power (producers and consumers by type, batteries, night energy needed), compute, the clock, every build item (in/out per minute, power, **ratios**, battery sizing) and **every button**. |
| How many furnaces per extractor? Batteries per solar? | Ratio lines in build tooltips, a "How many do I need?" section in the inspector, and a Codex chapter. The Battery Bank went from 300 to 600 so ~1 battery per array covers a night. |
| A statistics screen, also from the Core | `I` / STATS shows items per minute, power by source and consumer, compute and building counts. The Core's inspector shows an economy summary and a button. |
| Inspector: "1 in, 1 out" has no units | Live **FLOWS** list every link with its rate per minute (per second for compute) and its state. |
| Power cables hard to see | Thicker instanced cables: dark copper by day, warm glow at night. |
| Show grid connection while placing | The ghost turns **orange** if unpowered, a **yellow dashed line** goes to the node that would power it, and the tooltip states it. |
| Preview links before placing or linking | **Cyan dashed auto-link preview** with the partners named in the tooltip. The link tool shows a live line, green when valid and red when not. |
| Link tool shouldn't require selecting a building first, and should work either order | `L` → click any two buildings in either order. Shift chains. Hovered links glow, and clicking one removes it. |
| Tools shouldn't look like build categories | A separate bottom **toolbar** (Link, Move, Demolish, Auto-link) with its own style and tooltips, next to a Satisfactory-style **hotbar** 1–0. |
| Demolish cursor, hover blink | Red ✕ demolish cursor. Hovered buildings pulse, and demolish targets glow red. |
| Overlay buttons clipped | Minimap layout fixed. |
| Battery bars stayed after demolishing | Instanced glow matrices were not re-uploaded on removal. Fixed. |
| Battery icon | A fill-level battery icon (with a charging bolt) in the top bar. Battery buildings already glow by charge. |
| Top bar jitter | Fixed-width resource chips and gauges with tabular numbers. |
| Stepless rotation | LMB + RMB drag (or Alt + RMB). Q/E snap to 90°. |
| Shorter nights on Relaxed | Relaxed nights are ~70 s (standard ~110 s) of a 240 s day. |
| Anti-aliasing on big screens | MSAA ×4 composer target plus HalfFloat HDR, and a UI auto-scale (×1.2 at 1440p, ×1.5 at 4K). |
| Water stripes finer | A finer, lower-amplitude wave normal and finer foam bands. |
| Finer grid, more detailed buildings | Terrain tiles are drawn as 2×2 sub-tiles with colour variation (rarely, flowers). Round building parts use ~1.6× more segments. |
| Is demolishing punished? | No: **100% refund**, stated in the tooltips. |
| Merge pipes and belts (pump → pump) | New **Junction** (1×1, era 1): merges or splits belts and pipes and relays beyond 14 tiles. |
| Platforms on uneven ground | Buildings can span up to 2 terraces. A concrete **platform** is built for +2 metal per tile-step. |
| Move buildings | **Move** tool (`V`): free, keeps links in range. |
| Satisfactory/Factorio quick wins | Hotbar, pipette (`G`), 100% refunds, foundations (platforms), relocation, hover highlight, production statistics, ratios in tooltips, ghost previews, mergers and splitters (junction). |
| Tech tree not readable as a tree | Graph layout: rows are branches, columns are dependency depth, arrows show prerequisites, ready nodes pulse, and each node shows its era. |
| What consumes all the AI? | Codex chapter "Who uses all this AI?": contracts are society's demand (inference = people using AI, training = clients). A deeper consumer economy is proposed in HANDOFF. |
| Could not link Chip Fab ↔ Ore Smelter | The link tool now accepts either click order (smelter → fab carries metal), and the tooltip explains when a pair can't be linked. |

Bugs found during this pass: the campaign could complete at 99.9% engine charge **before** ignition (fixed). Shipping from storage drained chips needed for construction (storage now keeps a 40-unit reserve). The tooltip panel intercepted clicks (fixed). UI zoom misplaced the screen-space overlays (moved to unscaled layers, with transform-based scaling).

## Needs human playtesting
- **Total campaign length** (target 2–3 h) and the per-era pace, especially the Era 1 waiting phase and the Era 5 charge time.
- **Event difficulty** on Relaxed, Standard and Race: are heatwaves and grid faults scary but fair?
- **Clarity for newcomers:** link tool vs. auto-link, two-way Depots, and pod modes.
- **Feel:** sound mix levels, camera speed and zoom limits on a 27-inch or larger monitor.

## Remaining observations (not fixed yet)

- **Slow:** in Era 1, the stretch between first chain and stockpile goal is a waiting game at 1×. 2× and 4× speed help, and the next objective hint points at "scale up". A later pass could add a mid-goal such as "build a second smelter".
- **Too easy?** Events are survivable even unprepared on Standard. Race difficulty is where they bite. Needs human tuning.
- ~~Pod mode only explained in the tooltip~~. Fixed: one-time first-build tips now cover pods, racks, fabs, halls, depots, gas, switches and the engine.
- The autoplayer finishes the campaign seed in about 60 sim-minutes, but on seed 777 it stalls in Era 4 because its own rare-earth and power placement fails. This is a bot weakness, not a game deadlock (the player can always place a Depot, pole or substation), but it should be improved for sandbox seeds.
- Balance needs real humans. The timings are derived from the bot, and humans are assumed to be about 2× slower, which gives roughly 2–2.5 h for the campaign.
