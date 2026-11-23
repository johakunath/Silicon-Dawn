# Backlog

Priority order, top first. Each epic is one bigger work package (WP), roughly one long session (two if needed). Statuses are `todo`, `doing (branch)` and `done`. How to claim and finish work: `CLAUDE.md`. What we are building and why: `docs/DESIGN.md`. Not planned: `docs/IDEAS.md`.

**Every WP includes:** the design loop (2 options or mockups, pick, log the decision in `docs/DESIGN.md`), tests for new rules, an autoplayer balance check (campaign still completes, no soft-lock), Codex text for new concepts, a `CHANGELOG.md` line.

## Current state (2026-11-23)
Version 1.0.0 is live on GitHub Pages: a playable 5-era campaign, sandbox, Vitest tests, and an autoplayer that completes the campaign. E1 added money (credits, running costs, ledger). E3 added the colony market and the model lifecycle, E4 wear, service and power deals. There is no telemetry yet. The owner will play only once the game feels finished.

## Overview
| # | Epic | Depends on | Status |
|---|---|---|---|
| E1 | Colony economy: money, running costs, ledger | none | done |
| E2 | Tablet and quality profiles: touch controls, graphics profiles, cloud save | none | done |
| E3 | Market and models: demand, model lifecycle, revenue | E1 | done |
| E4 | Operations: wear, Service Center, power deals, light hardware tiers | E1 | done |
| E5 | Decision events and politics | E1 (E3 helps) | todo |
| E6 | Setting pass: sci-fi colony framing, intro, eras, Codex | E3 | todo |
| E7 | Scenarios and run modifiers | E1–E5 | todo |
| E8 | Telemetry and friends score sheet | E1 | todo |
| E9 | Launch readiness: blueprints, tutorial update, housekeeping | E1–E8 | todo |
| — | Owner's first full play, then a fix round, then share with friends | E8, E9 | owner |

E4 and E5 share hotspot files with E3, so run E1 → E3 → E4/E5 one at a time. E8 can run in parallel with E4 or E5 (different files, except one HUD hook).

---

## E1 Colony economy (done)
Goal: every building has a price, every minute has a cost, and the player can see whether it pays off.
- **Design:** two economy models (for example "credits plus materials" vs. "credits replace most materials"), pick one, write balance targets per era in `docs/DESIGN.md`. Two ledger UI mockups (SVG with example values), pick one, show the owner.
- **Sim:** `credits`; capex on build (refund rule); opex per tick (power priced by time of day, water, upkeep); income from current contracts and from selling surplus; loan or emergency grant so there is no bankrupt soft-lock. Bump the save to v3 with a migration and tests.
- **UI:** credits chip in the top bar, ledger panel (income vs. costs per minute, payback per building, cost per compute, utilisation), capex/opex/payback in build tooltips.
- **Codex:** "Unit economics" chapter.
- **Balance:** the autoplayer buys with credits and still finishes the campaign; check per-era pacing.
- Hotspots: types, state, save, hud. Size: L.

## E2 Tablet and quality profiles
Goal: the game plays well on desktop and on a Samsung Galaxy Tab S9 (11-inch, 2560×1600, touch plus S Pen), and one save follows the player across devices.
- **Graphics:** "Performance" and "Quality" profiles in the menu, Auto picks Performance on touch-first devices. Frame cap, resolution cap, MSAA, shadows, bloom size, particles, idle slow-down, nothing rendered in a hidden tab.
- **Touch:** drag pans, pinch zooms, twist rotates, tap places or selects, long-press inspects. Right-edge rail (rotate, zoom, copy, next problem, Core) and a red Cancel pill. UI scales to fit 1280×800 CSS px with finger-sized targets.
- **Cloud save:** Google Sheet plus Apps Script web app (`tools/apps-script/`), personal sync code, gzip, chunked rows, `text/plain` POSTs. Built so E8 can add telemetry and scores as new ops.
- Hotspots: hud, game (small hook lines only). Size: M–L.

## E3 Market and models (done)
Goal: colony demand that keeps growing and pays for compute; training creates models that earn money and then age.
- **Design:** two market models (segments with demand curves vs. a single price curve with tiers), pick one. Two Market and Models panel mockups.
- **Sim:** demand segments (chat, code, enterprise, science, media) with price, latency and uptime needs; reputation from uptime; lost revenue from unserved demand. `Model` entity from Training Core (quality from compute and fiber share), deploy to Gateways, value decays as the frontier rises. Contracts become special orders.
- **UI:** Market panel (demand vs. served per segment, price trend), Models panel (train next, deploy, retire).
- **Objectives:** Eras 3–5 rewritten around models and revenue.
- Hotspots: types, state, save, hud, sim. Size: L.

## E4 Operations (done)
Goal: running infrastructure takes care, without tedium.
- **Design:** two maintenance models (wear meter plus random breakdowns vs. only random breakdowns scaled by heat), pick one. Service Center coverage visual: two options.
- **Sim:** wear and breakdowns; Service Center (Era 2, large radius, repairs and slows wear, upkeep per minute); Robot Hub becomes its upgrade. Power deals: grid import with a connection wait, fixed-price contract, paid curtailment at peak. Light hardware tiers: newer pod tier via research, old ones keep working; depreciation shown in the ledger only.
- **UI:** service coverage overlay, wear in the inspector, a power deals section in the ledger.
- Hotspots: types, state, save, sim, hud. Size: L.

## E5 Decision events and politics
Goal: events become choices that create tension and teach industry shocks.
- **Design:** two event-choice presentations (modal card vs. news ticker with a decision inbox), pick one.
- **Data and sim:** events with 2–3 choices and effects. New events: model-class ban, compute export tariff, colonist protest at a site (permit, buffer zone or relocate), memory shortage, transformer lead time, rival price war, launch demand spike, cheap interruptible power offer. Earlier forecasts; severity by difficulty.
- Hotspots: types, hud, sim. Size: M–L.

## E6 Setting pass
Goal: the sci-fi colony story holds the game together.
- **Design:** two framing drafts (planet name, company, colony voices in news and events), pick one.
- **Content:** title screen text, era intros, objective texts, Codex framing (real economics, fictional world), event and news texts; check the Dawn Engine stays clearly fictional.
- Hotspots: none (data and text). Size: M. Can be merged into E5 if both are small.

## E7 Scenarios and run modifiers
Goal: replayability through different rules, not just different seeds.
- **Design:** two scenario-picker mockups; two card designs.
- **Sim:** scenario framework (map parameters, rule overrides, own goals, own score). Four scenarios: Desert Solar, Polar Hydro, Grid-Locked Basin, Archipelago. Run modifiers: pick 1 of 3 cards per era. Daily seed.
- **Balance:** the autoplayer finishes each scenario on at least one seed.
- Hotspots: state, game, hud. Size: L.

## E8 Telemetry and friends score sheet
Goal: when the owner and friends play online, runs are logged so the game can be improved; friends compare scores.
- **Design:** two options for the data shape (one row per event vs. one row per run with a JSON summary), pick one. Opt-in dialog mockup.
- **Build:** a local run log (export as JSON); batched, anonymous uploads (random player id, no personal data) through the E2 Apps Script (`tools/apps-script/Code.gs`: add `telemetry` and `score` ops and tabs, the owner redeploys a new version); opt-in on first start; a score submit at run end and a leaderboard view.
- **Owner steps (website only):** paste the updated script and deploy a new version (the Sheet and URL from E2 stay). The WP writes exact click-by-click steps.
- Hotspots: hud (one hook). Size: M.

## E9 Launch readiness
- Blueprints: select an area, copy buildings and links, stamp with ghost preview and cost; named blueprints in localStorage.
- Tutorial and first-build tips updated for money, market and service.
- Housekeeping: stop screenshot bloat (ignore `screenshots/*.png`, keep a few curated shots in `docs/img/`); fix the power gauge showing "0 of 0" after loading a paused save; autoplayer stall on seed 777 in Era 4; split `src/ui/hud.ts` into panels if it is still in the way.
- Final balance pass across difficulties and scenarios; performance check with the stress scene.
- Size: L.

## Done
- 2026-11-23: E4 Operations (wear and breakdowns, Service Center and U overlay, grid connection upgrades, fixed-price contract, peak curtailment, Next-Gen Accelerators, book value, save v5). Follow-ups: the Service overlay's amber/red wear tint is hard to see under tall buildings (a badge carries it from 80%); the tutorial does not mention wear yet (E9).
- 2026-11-23: E3 Market and models (five demand segments, latency from load, reputation from uptime, Lite/Standard/Max models aging against a frontier, auto-deploy, special orders, Market & Models panel, save v4). Follow-ups: Era V runs over its new 30-minute par on 2 of 5 seeds (26–48 min) and Era III on 2 of 5 (up to 37 min); the top bar overflow at 1920 px from E1 is still open; tutorial tips for the market belong in E9.
- 2026-11-23: E1 Colony economy (credits, capex and opex, exports, funding rounds, emergency grants, ledger, save v3). Follow-ups for E3: Era IV pacing runs over par on 3 of 5 seeds; the top bar overflows at 1920 px in Era IV and later (pre-existing, slightly worse with the credits chip).
- 2026-11-23: doc review and restructure (CLAUDE.md, BACKLOG, CHANGELOG, docs/), research and top 10 ideas, deploy workflow on `main`.
