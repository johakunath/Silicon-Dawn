# Handoff

## State (2026-11-19): M0–M4 complete
- The full game is playable: title → 5-era campaign → Dawn Engine finale → sandbox unlock. Run `npm run dev`, then open http://localhost:5173.
- `npm test` passes 19/19, including the autoplayer finishing the whole campaign on the campaign seed in about 60 sim-minutes. `npm run build` gives static `dist/`.
- Screenshots: `npx tsx scripts/mksaves.ts`, then `npx tsx scripts/shots.ts era1..era5|stress|title`. These run in headless system Edge through the real renderer and save to `screenshots/`.
- Performance: `npx tsx scripts/shots.ts stress` (677 buildings, 405 links) gives an 11.7 ms median and 14.4 ms p95 (85 fps median). `PERFBISECT=1` adds feature toggles and `PROFILE=1` adds per-subsystem JS timings.
- Real-input playtest: `npx tsx scripts/playtest.ts` runs early Era 1 with real clicks and checks for console errors.

## Fixed in the final M4 pass
- The p95 frame spikes in the stress benchmark were warmup (shader compiles) inside the measurement window. The benchmark now warms up first.
- GPU cost was reduced: the shadow map went from 4096 to 3072, and only trees and pines cast prop shadows, not bushes, rocks or deposits.
- Aurora scanline stripes were removed (smoother bands, limited to the top of the screen), and the finale halo is subtler.

## Feedback round 1 (2026-11-20)
See `PLAYTEST.md` → "Feedback round 1" for every item and its fix. New modules: `ui/tutorial.ts`, `ui/codex.ts`, `ui/tips.ts`, `ui/rates.ts`. New sim features: junctions, platforms, `moveBuilding`, `previewAutoLinks`, 100% refunds, storage reserve, per-item consumed and spent counters, per-building `pw` power flow.

### Proposed next (not built yet)
- **AI consumer economy:** cities and industries that buy inference (growing demand curves, price per compute, reputation), so compute has an end use beyond contracts.
- **Blueprints / copy-paste** (Factorio): select an area and stamp it.
- **Alt-mode** recipe icons over buildings (Factorio) and belt tiers placed per link.
- **Snap-to-grid nudge and rotation** of buildings (Satisfactory), once models have a facing.

## Known issues / needs a human
- Balance and pacing are derived from the bot. A human playthrough is needed to confirm the 2–3 h target and event difficulty per mode.
- On some sandbox seeds (for example 777), the autoplayer stalls in era 4. This is the bot's own placement failing, not a game deadlock.
- Right after loading a save while paused, the power gauge reads "0 of 0" until the first sim tick.
- The Claude browser pane throttles rAF while it is hidden, so use the Playwright scripts for screenshots and benchmarks.
