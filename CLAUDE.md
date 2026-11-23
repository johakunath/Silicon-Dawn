# Silicon Dawn: agent guide

Isometric automation game about AI infrastructure (Vite + TypeScript + Three.js). Owner is not a programmer: make all code, config and git changes yourself, and give the owner only website steps (GitHub, Cloudflare).

## Read order (stop as soon as you have enough)
1. This file.
2. `BACKLOG.md`: pick the top `todo` work package (WP) unless told otherwise.
3. `docs/DESIGN.md` for the system your WP builds.
4. `docs/ARCHITECTURE.md` only if the WP touches sim/render wiring.
5. The code the WP touches. Do not read `legacy-v0.2/`, `docs/archive/` or `screenshots/` unless the WP says so.

## Commands
- `npm test`: Vitest, including the headless autoplayer (must stay green).
- `npm run typecheck`, `npm run build`.
- `npm run autoplay -- 5 [seed]`: headless campaign run.
- Visual checks need the dev server (`npm run dev`), then `npx tsx scripts/shots.ts era1` or `scripts/uicheck.ts`. Do not commit new screenshots (repo is already ~440 MB); keep them in the scratchpad.

## Rules
- `src/sim/` stays pure and deterministic: no DOM, no `Math.random`, no wall-clock. Randomness via `s.rng`. Every new rule gets a Vitest test.
- Content is data-driven (`src/sim/data/*`). Prefer adding data over code branches.
- Changing saved state means bumping `SAVE_VERSION` in `src/sim/save.ts` and adding a migration plus a test.
- Plain, concise prose in docs and UI text. No em dashes.
- Telemetry and score uploads stay opt-in and anonymous (friends will play).

## Design loop (every new element)
1. Draft **2 options**: for UI or visuals, 2 SVG mockups with example values (scratchpad HTML); for gameplay or story, 2 short written variants.
2. Review both against the fun pillars in `docs/DESIGN.md` and the learning goal. Pick one yourself; do not wait for the owner.
3. Log the choice and why in the decision log of `docs/DESIGN.md`. Show the mockups to the owner in chat (inline), then build.

## Multi-agent workflow
- One WP per session/agent. Claim it in `BACKLOG.md` (status `doing`, branch name) in your first commit.
- Hotspot files (one agent at a time): `src/sim/types.ts`, `src/sim/state.ts`, `src/sim/save.ts`, `src/ui/hud.ts`, `src/game/game.ts`. WPs list which they touch; do not run two WPs that share a hotspot in parallel.
- Finish a WP: tests green, set status `done` in `BACKLOG.md`, add a line under `Unreleased` in `CHANGELOG.md`, update `docs/ARCHITECTURE.md` only if structure changed.
- Run tests locally before pushing; CI (GitHub Actions) deploys on push to `main` (or `master` until it is renamed), so do not push to `main` to "check CI".

## Doc map
| File | Purpose |
|---|---|
| `README.md` | Players and setup: run, build, controls |
| `BACKLOG.md` | Epics and work packages, priority order, status |
| `CHANGELOG.md` | Release notes |
| `docs/ARCHITECTURE.md` | Sim/render/UI structure, how to extend |
| `docs/ART.md` | Art bible (palette, silhouettes, era moods) |
| `docs/DESIGN.md` | Game direction v2, systems, decision log |
| `docs/IDEAS.md` | Parked ideas (not planned) |
| `docs/RESEARCH.md` | Market and design research, ranked ideas |
| `docs/PLAYTEST.md` | Open questions for the owner's first play, checklist |
| `docs/archive/` | Original brief and the full 2026-11 playtest log (history only) |
