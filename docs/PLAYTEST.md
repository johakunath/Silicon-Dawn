# Playtest

Full history of past findings and fixes: `archive/PLAYTEST_LOG_2026-11.md`.

## Owner's first full play (after E1–E9)
Play on Standard from a new campaign, with telemetry on. Note answers in a GitHub issue or tell the next session.
1. Era 1: did you understand what to do next at every moment? Where did you wait with nothing to do?
2. How long did Era 1 and Era 2 take (in-game clock)?
3. Which tooltip or panel did you look for and not find?
4. Was anything visually confusing (links, overlays, badges)?
5. What did you learn about AI infrastructure? What did you wish the game explained (cost, prices, demand)?
6. Would you play Era 3 next time? Why or why not?

## Tablet test (Galaxy Tab S9, after E2)
Thermals and real touch feel cannot be measured in the cloud. Takes 30 minutes. Note answers in a GitHub issue.
1. Open the game on the tablet in landscape, in the browser you use for Ruinenstadt (Firefox there), then repeat the touch steps once in Chrome. Menu → Graphics should say "Auto picked Performance (touch screen)".
2. Charge above 50%, close other apps, screen brightness at about 70%. Note the battery percentage.
3. Play 20 minutes at 1× speed with the game running (not paused). Then feel the back of the tablet near the camera: cool, warm or hot? Note the battery percentage again (drain per 20 min).
4. Repeat 10 minutes with Graphics → Quality. Is it clearly warmer? Does it stutter?
5. Leave the game paused for 5 minutes. It should stay cool (the game draws only 10 frames per second when nothing moves).
6. Touch: one-finger drag pans, pinch zooms, two-finger twist rotates. Does anything feel sluggish, too fast or reversed?
7. Tap a build item, tap the map: does it place where your finger was? Does the red Cancel pill stop building?
8. Hold a finger on a building for half a second: does a tooltip and the inspector appear? Hold on a top-bar gauge: does its tooltip appear?
9. Right-edge buttons (rotate, zoom, copy, problem, Core): easy to hit with the thumb? Any button too small anywhere else?
10. S Pen: hovering shows tooltips, a tap places. Anything odd?
11. Samsung Internet (optional): repeat steps 6–8 once.
12. Cloud save: upload on the desktop, load on the tablet, play 5 minutes, switch apps, load on the desktop. Did the tablet's progress arrive?

## Open questions (need a human)
- Total campaign length (target 2–3 h; bot estimate 2–2.5 h).
- Event difficulty per mode: events are survivable unprepared on Standard; only Race bites.
- Clarity: link tool vs. auto-link, two-way Depots, pod modes.
- Feel: sound mix, camera speed and zoom limits on a large monitor.
- Era 1 has a waiting stretch between the first chain and the stockpile goal.

## Automated checks
- `npm test` (includes the autoplayer), `npx tsx scripts/playtest.ts` (real clicks, Era 1), `npx tsx scripts/uicheck.ts` (UI review at 2560×1440), `npx tsx scripts/shots.ts stress` (performance; `GFX=performance` or `GFX=quality` picks the profile, `TABLET=1` emulates the tablet).

## Performance measurements (E2, 2026-11-23)
Stress scene (`TABLET=1 NOSHOT=1 FRAMES=30 GFX=… npx tsx scripts/shots.ts stress`): 676 buildings, 412 links, tablet emulation 1280×800 CSS px at DPR 2. Measured in a cloud container with **software** WebGL (SwiftShader, no GPU), so only the ratio means something; real GPU numbers need the desktop or the tablet.

| Profile | Render size | MSAA | Shadow map | Median frame | JS per frame |
|---|---|---|---|---|---|
| Quality | 2560×1600 (DPR 2) | 4× (GPU maximum here; 8× on desktop GPUs) | 4096 | 4795 ms | 8.4 ms |
| Performance | 1600×1000 (DPR 1.25) | 2× | 1024 | 2937 ms (−39%) | 8.4 ms |

On the tablet the frame cap adds the bigger saving: the Tab S9 screen runs at 120 Hz, so an uncapped game draws 120 frames per second; Performance draws 30 (60 while you pan or zoom, 10 when paused and still). Together that is roughly 15% of the uncapped Quality GPU load per second. For comparison, the 0.8 release notes report 677 buildings at about 85 fps on the desktop.

