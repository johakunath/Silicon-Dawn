# Backlog

Priority order, top first. One work package (WP) is sized for one session. Statuses are `todo`, `doing (branch)` and `done`. Rules for claiming and finishing work are in `CLAUDE.md`. Background and ranking: `docs/RESEARCH.md`.

Size: S ≈ a short session, M ≈ one session, L ≈ one long session or two.
Hotspots: the shared files from `CLAUDE.md` that a WP touches (two WPs that share a hotspot must not run in parallel).

## Current state (2026-11-23)
Version 1.0.0 is live on GitHub Pages: a playable 5-era campaign, sandbox, 19/19 tests, and an autoplayer that completes the campaign. Pacing and balance come from the bot and have not been tuned by a human.

## Overview
| Epic | Goal | Status |
|---|---|---|
| E0 Housekeeping | Docs, branch, repo hygiene, known bugs | partly done |
| E1 Owner playtest | 30–45 min play, answer the checklist | todo (owner, no tokens) |
| E2 Money and unit economics | Credits, capex, opex, ledger, payback | todo |
| E3 Model lifecycle | Train → deploy → serve → obsolete | todo |
| E4 AI market | Demand segments, prices, SLAs, reputation | todo |
| E5 Decision events | Events as choices, industry shocks | todo |
| E6 Hardware generations | Accelerator gens, depreciation, upgrades | todo |
| E7 Power procurement | Grid queue, time-of-day price, PPAs, demand response | todo |
| E8 Scenario regions | 4 maps with one hard rule each | todo |
| E9 Run modifiers and daily seed | 1-of-3 cards per era, seeded daily run | todo |
| E10 Friends score sheet | Shared scores via Google Sheet + Apps Script | todo |
| E11 Blueprints | Select area, copy, stamp | todo |

Dependencies: E3, E4, E6 and E7 need E2. E4 builds on E3. E9 and E10 work best after E8. E5 and E11 are independent.

---

## E0 Housekeeping
| WP | Task | Size | Status |
|---|---|---|---|
| 0.1 | Doc review: CLAUDE.md, BACKLOG, CHANGELOG, RESEARCH, docs/ folder | S | done |
| 0.2 | Deploy workflow on `main` (owner renames branch on GitHub) | S | done (code) |
| 0.3 | Stop screenshot bloat: ignore `screenshots/*.png`, keep ~6 curated shots in `docs/img/` | S | todo |
| 0.4 | Bug: power gauge shows "0 of 0" after loading a paused save (compute stats on load) | S | todo |
| 0.5 | Autoplayer stalls in Era 4 on seed 777 (bot placement of rare-earth and power) | M | todo |
| 0.6 | Split `src/ui/hud.ts` (918 lines) into panels, so UI WPs can run in parallel | M | todo |

## E1 Owner playtest
Play once with `docs/PLAYTEST.md`. Results decide pacing changes and validate the E2 design. No code.

## E2 Money and unit economics (foundation)
Goal: every building has a price, every minute has a cost, and the player can answer "does this pay off?".
| WP | Task | Size | Hotspots | Status |
|---|---|---|---|---|
| 2.1 | Design note in `docs/ECONOMY.md`: currency, capex per building, opex (power by tariff, water, upkeep), income sources, balance targets per era. Owner review. | S | none | todo |
| 2.2 | Sim: `credits`, capex on build (refund rule), opex per tick, income from contracts; save v3 + migration; tests; autoplayer stays green | L | types, state, save | todo |
| 2.3 | UI mockup (SVG, owner picks): credits chip, ledger panel (income vs. costs per minute, payback per building, cost per compute) | S | none | todo |
| 2.4 | UI: build the chosen ledger, tooltips show capex/opex/payback | M | hud | todo |
| 2.5 | Codex chapter "Unit economics" (capex, opex, utilisation, payback, cost per token) | S | none | todo |
| 2.6 | Balance pass with autoplayer: no bankrupt soft-lock, debt/loan rule if needed | M | none | todo |

## E3 Model lifecycle
Goal: training creates a named model with a quality tier; inference serves a deployed model; models age.
| WP | Task | Size | Hotspots | Status |
|---|---|---|---|---|
| 3.1 | Sim: `Model` entity (name, quality from training compute and fiber share, age); Training Core produces models; tests | M | types, state, save | todo |
| 3.2 | Sim: Gateways serve the deployed model; revenue = demand × price × quality; models lose value as the "frontier" rises | M | sim | todo |
| 3.3 | UI mockup, then a Models panel (train next, deploy, retire) | M | hud | todo |
| 3.4 | Era objectives rewritten around models (e.g. "deploy a tier-2 model", "earn X per minute") | S | none | todo |

## E4 AI market
Goal: demand that keeps growing and pays for compute. Replaces most contracts.
| WP | Task | Size | Hotspots | Status |
|---|---|---|---|---|
| 4.1 | Data: segments (chat, code, enterprise, video, science) with demand curve, price, latency and uptime needs | S | none | todo |
| 4.2 | Sim: demand served per segment, price elasticity, reputation from uptime; unmet demand visible; tests | L | sim, state, save | todo |
| 4.3 | UI mockup, then a Market panel (demand vs. served per segment, price trend) | M | hud | todo |
| 4.4 | Optional rival lab that takes unserved demand and drives a price war | M | sim | todo |

## E5 Decision events
| WP | Task | Size | Hotspots | Status |
|---|---|---|---|---|
| 5.1 | Event choices in data (2–3 options with cost and effect); popup UI; tests | M | types, hud | todo |
| 5.2 | New events: HBM shortage, transformer lead time, export controls, model launch demand spike, price war, interruptible-power offer | S | none | todo |
| 5.3 | Forecast warnings earlier so preparation matters; scale severity by difficulty | S | none | todo |

## E6 Hardware generations
| WP | Task | Size | Hotspots | Status |
|---|---|---|---|---|
| 6.1 | Accelerator generations via tech: new pods with better compute per watt; old pods keep running | M | types, save | todo |
| 6.2 | Depreciation in the ledger; "upgrade in place" action with partial refund | M | hud | todo |

## E7 Power procurement
| WP | Task | Size | Hotspots | Status |
|---|---|---|---|---|
| 7.1 | Time-of-day power price; grid import building with a connection wait | M | sim, save | todo |
| 7.2 | PPA contracts (fixed price) and demand response (get paid to curtail) | M | sim | todo |

## E8 Scenario regions
| WP | Task | Size | Hotspots | Status |
|---|---|---|---|---|
| 8.1 | Scenario framework: map params, rule overrides, goals, scenario picker on title screen | M | state, game | todo |
| 8.2 | Desert Solar (no water: chillers only, huge sun) | S | none | todo |
| 8.3 | Nordic Hydro (cheap firm power, cold = free cooling, far fiber) | S | none | todo |
| 8.4 | Grid-Locked Metro (small land, connection queue, high price) | S | none | todo |
| 8.5 | Island (imports by ship, expensive chips) | M | none | todo |

## E9 Run modifiers and daily seed
| WP | Task | Size | Hotspots | Status |
|---|---|---|---|---|
| 9.1 | Card data (subsidy, carbon tax, cheap capital, heat dome...) and pick-1-of-3 at each era start | M | state, hud | todo |
| 9.2 | Daily seed run (same seed and cards for everyone that day) | S | none | todo |

## E10 Friends score sheet
| WP | Task | Size | Hotspots | Status |
|---|---|---|---|---|
| 10.1 | Google Sheet + Apps Script web app; submit score at run end; leaderboard view per scenario. Owner does the website steps. | M | hud | todo |

## E11 Blueprints
| WP | Task | Size | Hotspots | Status |
|---|---|---|---|---|
| 11.1 | Select area, copy buildings and links, stamp with ghost preview and cost | L | game | todo |
| 11.2 | Save named blueprints in localStorage | S | none | todo |
