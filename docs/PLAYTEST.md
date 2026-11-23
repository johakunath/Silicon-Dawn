# Playtest

Full history of past findings and fixes: `archive/PLAYTEST_LOG_2026-11.md`.

## Owner playtest checklist (30–45 min, no tokens needed)
Play on Standard from a new campaign. Note answers in a GitHub issue or tell the next session.
1. Era 1: did you understand what to do next at every moment? Where did you wait with nothing to do?
2. How long did Era 1 and Era 2 take (in-game clock)?
3. Which tooltip or panel did you look for and not find?
4. Was anything visually confusing (links, overlays, badges)?
5. What did you learn about AI infrastructure? What did you wish the game explained (cost, prices, demand)?
6. Would you play Era 3 next time? Why or why not?

## Open questions (need a human)
- Total campaign length (target 2–3 h; bot estimate 2–2.5 h).
- Event difficulty per mode: events are survivable unprepared on Standard; only Race bites.
- Clarity: link tool vs. auto-link, two-way Depots, pod modes.
- Feel: sound mix, camera speed and zoom limits on a large monitor.
- Era 1 has a waiting stretch between the first chain and the stockpile goal.

## Automated checks
- `npm test` (includes the autoplayer), `npx tsx scripts/playtest.ts` (real clicks, Era 1), `npx tsx scripts/uicheck.ts` (UI review at 2560×1440), `npx tsx scripts/shots.ts stress` (performance).
