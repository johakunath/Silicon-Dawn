# Silicon Dawn: agent guide

Isometric automation game about AI infrastructure (Vite + TypeScript + Three.js). Owner is not a programmer: make all code, config and git changes yourself, and give the owner only website steps (GitHub, Cloudflare).

## Read order (stop as soon as you have enough)
1. This file.
2. `BACKLOG.md`: pick the top `todo` work package (WP) unless told otherwise.
3. `docs/ARCHITECTURE.md` only if the WP touches sim/render wiring.
4. The files listed in the WP. Do not read `legacy-v0.2/`, `docs/archive/` or `screenshots/` unless the WP says so.

## Commands
- `npm test`: Vitest, including the headless autoplayer (must stay green).
- `npm run typecheck`, `npm run build`.
- `npm run autoplay -- 5 [seed]`: headless campaign run.
- Visual checks need the dev server (`npm run dev`), then `npx tsx scripts/shots.ts era1` or `scripts/uicheck.ts`. Do not commit new screenshots (repo is already ~440 MB); keep them in the scratchpad.

## Rules
- `src/sim/` stays pure and deterministic: no DOM, no `Math.random`, no wall-clock. Randomness via `s.rng`. Every new rule gets a Vitest test.
- Content is data-driven (`src/sim/data/*`). Prefer adding data over code branches.
- Changing saved state means bumping `SAVE_VERSION` in `src/sim/save.ts` and adding a migration plus a test.
- New chart, panel or layout whose form is uncertain: show the owner an SVG mockup with example values first, then build.
- Plain, concise prose in docs and UI text. No em dashes.

## Multi-agent workflow
- One WP per session/agent. Claim it in `BACKLOG.md` (status `doing`, branch name) in your first commit.
- Hotspot files (one agent at a time): `src/sim/types.ts`, `src/sim/state.ts`, `src/sim/save.ts`, `src/ui/hud.ts`, `src/game/game.ts`. WPs list which they touch; do not run two WPs that share a hotspot in parallel.
- Finish a WP: tests green, set status `done` in `BACKLOG.md`, add a line under `Unreleased` in `CHANGELOG.md`, update `docs/ARCHITECTURE.md` only if structure changed.
- Run tests locally before pushing; CI (GitHub Actions) deploys on push to `main`, so do not push to `main` to "check CI".

## Doc map
| File | Purpose |
|---|---|
| `README.md` | Players and setup: run, build, controls |
| `BACKLOG.md` | Epics and work packages, priority order, status |
| `CHANGELOG.md` | Release notes |
| `docs/ARCHITECTURE.md` | Sim/render/UI structure, how to extend |
| `docs/ART.md` | Art bible (palette, silhouettes, era moods) |
| `docs/RESEARCH.md` | Market and design research, ranked ideas |
| `docs/PLAYTEST.md` | Open questions for human playtests, checklist |
| `docs/archive/` | Original brief and the full 2026-11 playtest log (history only) |
