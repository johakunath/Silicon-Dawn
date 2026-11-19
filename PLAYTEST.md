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

## Remaining observations (not fixed yet)

- **Slow:** in Era 1, the stretch between first chain and stockpile goal is a waiting game at 1×. 2× and 4× speed help, and the next objective hint points at "scale up". A later pass could add a mid-goal such as "build a second smelter".
- **Too easy?** Events are survivable even unprepared on Standard. Race difficulty is where they bite. Needs human tuning.
- **Confusing:** the pod mode (Training/Inference) is only explained in its tooltip and inspector. Consider a one-time hint when the first pod is placed.
- The autoplayer finishes the campaign seed in about 60 sim-minutes, but on seed 777 it stalls in Era 4 because its own rare-earth and power placement fails. This is a bot weakness, not a game deadlock (the player can always place a Depot, pole or substation), but it should be improved for sandbox seeds.
- Balance needs real humans. The timings are derived from the bot, and humans are assumed to be about 2× slower, which gives roughly 2–2.5 h for the campaign.
