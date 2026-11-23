# Backlog

Priority order, top first. Each epic is one bigger work package (WP), roughly one long session (two if needed). Statuses are `todo`, `doing (branch)` and `done`. How to claim and finish work: `CLAUDE.md`. What we are building and why: `docs/DESIGN.md`. Not planned: `docs/IDEAS.md`.

**Every WP includes:** the design loop (2 options or mockups, pick, log the decision in `docs/DESIGN.md`), tests for new rules, an autoplayer balance check (campaign still completes, no soft-lock), Codex text for new concepts, a `CHANGELOG.md` line.

## Current state (2026-11-23)
Version 1.0.0 is live on GitHub Pages: a playable 5-era campaign, sandbox, 25 Vitest tests, and an autoplayer that completes the campaign. There is no money, no market and no telemetry yet. The owner will play only once the game feels finished.

## Overview
| # | Epic | Depends on | Status |
|---|---|---|---|
| E1 | Colony economy: money, running costs, ledger | none | todo |
| E2 | Market and models: demand, model lifecycle, revenue | E1 | todo |
| E3 | Operations: wear, Service Center, power deals, light hardware tiers | E1 | todo |
| E4 | Decision events and politics | E1 (E2 helps) | todo |
| E5 | Setting pass: sci-fi colony framing, intro, eras, Codex | E2 | todo |
| E6 | Scenarios and run modifiers | E1–E4 | todo |
| E7 | Telemetry and friends score sheet | E1 | todo |
| E8 | Launch readiness: blueprints, tutorial update, housekeeping | E1–E7 | todo |
| — | Owner's first full play, then a fix round, then share with friends | E7, E8 | owner |

E3 and E4 share hotspot files with E2, so run E1 → E2 → E3/E4 one at a time. E7 can run in parallel with E3 or E4 (different files, except one HUD hook).

---

## E1 Colony economy (start here)
Goal: every building has a price, every minute has a cost, and the player can see whether it pays off.
- **Design:** two economy models (for example "credits plus materials" vs. "credits replace most materials"), pick one, write balance targets per era in `docs/DESIGN.md`. Two ledger UI mockups (SVG with example values), pick one, show the owner.
- **Sim:** `credits`; capex on build (refund rule); opex per tick (power priced by time of day, water, upkeep); income from current contracts and from selling surplus; loan or emergency grant so there is no bankrupt soft-lock. Bump the save to v3 with a migration and tests.
- **UI:** credits chip in the top bar, ledger panel (income vs. costs per minute, payback per building, cost per compute, utilisation), capex/opex/payback in build tooltips.
- **Codex:** "Unit economics" chapter.
- **Balance:** the autoplayer buys with credits and still finishes the campaign; check per-era pacing.
- Hotspots: types, state, save, hud. Size: L.

## E2 Market and models
Goal: colony demand that keeps growing and pays for compute; training creates models that earn money and then age.
- **Design:** two market models (segments with demand curves vs. a single price curve with tiers), pick one. Two Market and Models panel mockups.
- **Sim:** demand segments (chat, code, enterprise, science, media) with price, latency and uptime needs; reputation from uptime; lost revenue from unserved demand. `Model` entity from Training Core (quality from compute and fiber share), deploy to Gateways, value decays as the frontier rises. Contracts become special orders.
- **UI:** Market panel (demand vs. served per segment, price trend), Models panel (train next, deploy, retire).
- **Objectives:** Eras 3–5 rewritten around models and revenue.
- Hotspots: types, state, save, hud, sim. Size: L.

## E3 Operations
Goal: running infrastructure takes care, without tedium.
- **Design:** two maintenance models (wear meter plus random breakdowns vs. only random breakdowns scaled by heat), pick one. Service Center coverage visual: two options.
- **Sim:** wear and breakdowns; Service Center (Era 2, large radius, repairs and slows wear, upkeep per minute); Robot Hub becomes its upgrade. Power deals: grid import with a connection wait, fixed-price contract, paid curtailment at peak. Light hardware tiers: newer pod tier via research, old ones keep working; depreciation shown in the ledger only.
- **UI:** service coverage overlay, wear in the inspector, a power deals section in the ledger.
- Hotspots: types, state, save, sim, hud. Size: L.

## E4 Decision events and politics
Goal: events become choices that create tension and teach industry shocks.
- **Design:** two event-choice presentations (modal card vs. news ticker with a decision inbox), pick one.
- **Data and sim:** events with 2–3 choices and effects. New events: model-class ban, compute export tariff, colonist protest at a site (permit, buffer zone or relocate), memory shortage, transformer lead time, rival price war, launch demand spike, cheap interruptible power offer. Earlier forecasts; severity by difficulty.
- Hotspots: types, hud, sim. Size: M–L.

## E5 Setting pass
Goal: the sci-fi colony story holds the game together.
- **Design:** two framing drafts (planet name, company, colony voices in news and events), pick one.
- **Content:** title screen text, era intros, objective texts, Codex framing (real economics, fictional world), event and news texts; check the Dawn Engine stays clearly fictional.
- Hotspots: none (data and text). Size: M. Can be merged into E4 if both are small.

## E6 Scenarios and run modifiers
Goal: replayability through different rules, not just different seeds.
- **Design:** two scenario-picker mockups; two card designs.
- **Sim:** scenario framework (map parameters, rule overrides, own goals, own score). Four scenarios: Desert Solar, Polar Hydro, Grid-Locked Basin, Archipelago. Run modifiers: pick 1 of 3 cards per era. Daily seed.
- **Balance:** the autoplayer finishes each scenario on at least one seed.
- Hotspots: state, game, hud. Size: L.

## E7 Telemetry and friends score sheet
Goal: when the owner and friends play online, runs are logged so the game can be improved; friends compare scores.
- **Design:** two options for the data shape (one row per event vs. one row per run with a JSON summary), pick one. Opt-in dialog mockup.
- **Build:** a local run log (export as JSON); Google Sheet plus an Apps Script web app (script stored in `tools/apps-script/`); batched, anonymous uploads (random player id, no personal data); opt-in on first start; a score submit at run end and a leaderboard view.
- **Owner steps (website only):** create the Sheet, paste the script, deploy it as a web app, paste the URL into a GitHub secret or config. The WP writes exact click-by-click steps.
- Hotspots: hud (one hook). Size: M.

## E8 Launch readiness
- Blueprints: select an area, copy buildings and links, stamp with ghost preview and cost; named blueprints in localStorage.
- Tutorial and first-build tips updated for money, market and service.
- Housekeeping: stop screenshot bloat (ignore `screenshots/*.png`, keep a few curated shots in `docs/img/`); fix the power gauge showing "0 of 0" after loading a paused save; autoplayer stall on seed 777 in Era 4; split `src/ui/hud.ts` into panels if it is still in the way.
- Final balance pass across difficulties and scenarios; performance check with the stress scene.
- Size: L.

## Done
- 2026-11-23: doc review and restructure (CLAUDE.md, BACKLOG, CHANGELOG, docs/), research and top 10 ideas, deploy workflow on `main`.
