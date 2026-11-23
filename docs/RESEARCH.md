# Research: similar games, the AI infrastructure industry, top 10 ideas

Written 2026-11-23. Game design references come mostly from well-known games (my own knowledge), plus a light web scan. Industry numbers come from 2026 web sources, which disagree with each other, so treat them as ranges, not facts.

## 1. What the game is missing today
The physical side is deep: power, heat, water, logistics, fiber. The **economic side is missing completely**. There is no money. Buildings cost materials, contracts pay materials and research, and nothing has a price. So the game cannot teach the central question of the real industry: *does this compute pay for itself?* That question is the owner's main learning goal, and it is the biggest gap in the game.

Replayability is also thin. There is one fixed campaign on a fixed seed, then a sandbox with no goals. Events are survivable without any preparation, so they cause no tension.

## 2. Similar games and what to borrow
| Game | What it does well | Borrow |
|---|---|---|
| Factorio (+ Space Age) | Planets with unique rules make you re-learn the factory | Scenario maps with one hard constraint each |
| Satisfactory | Big-scale building, blueprints | Blueprints / copy-paste for late game |
| Dyson Sphere Program | Seeds, star-system variety | Seed picker with visible map traits |
| Against the Storm | Roguelite city builder: short runs, pick 1 of 3 boons, biome modifiers | Run modifiers and choices at era transitions |
| Opus Magnum / Zachtronics | Score histograms (cost, time, area) vs. friends | Per-scenario score sheet shared with friends |
| Frostpunk | Hard choices with moral and economic weight | Events as decisions with a trade-off |
| Mini Metro / Islanders | Growing demand that eventually breaks you | Demand curves that keep rising |
| Big Pharma, Production Line | Factory builder + market prices | Product prices, competitors, margins |
| Data center sims on Steam (Datacenter Simulator, COLD AISLE, Cloud Server Simulator) | First-person rack-and-cable management | Little to borrow; they confirm a niche, but none teach the macro economics |

Indie trend 2025–2026: roguelite factory builders (ShapeHero Factory, Rogue Factory, Factory Magnate). Common review complaints are repetition and thin end-game. The lesson is that variety must come from changing rules, not just random maps.

## 3. The real industry (2026), as game mechanics
| Real-world fact (ranges, sources disagree) | Game mechanic |
|---|---|
| Capex roughly $40–50B per GW for an AI campus; most of it is chips | Buildings cost money up front (capex); accelerators dominate cost |
| GPU rental swings from ~$2 to $8+ per GPU-hour; payback 2.5 years at high utilisation vs. 8–10 years on cheap long contracts | Price per compute moves with supply and demand; utilisation decides ROI |
| Power is the binding constraint ("2026 is the year of power"); grid connection waits of years | Grid connection queue; behind-the-meter gas; power as a scarce, priced input |
| Electricity price varies by hour; demand response pays for curtailment | Time-of-day power price; optional curtailment income |
| New accelerator generations every 1–2 years with better perf per watt | Hardware generations; old pods become uneconomic, upgrade decisions |
| Memory (HBM), advanced packaging and transformers are supply bottlenecks | Component shortages as events; extra intermediate items |
| Training is a capex-like investment; inference is the recurring revenue | Train a model, deploy it, serve demand, watch it age |

Sources: [Epoch AI cost breakdown](https://epoch.ai/data-insights/ai-datacenter-cost-breakdown), [Brookings 2026 paper](https://www.brookings.edu/wp-content/uploads/2026/09/4c_Van-Nieuwerburgh.pdf), [Morgan Stanley via Crypto Briefing](https://cryptobriefing.com/morgan-stanley-data-center-costs-49b-gigawatt/), [SemiAnalysis on energy](https://newsletter.semianalysis.com/p/ai-datacenter-energy-dilemma-race), [The Edge Malaysia on GPU payback](https://theedgemalaysia.com/node/816720), [Tom Tunguz on GPU prices](https://tomtunguz.com/tags/b200/), [Datacenter Simulator](https://store.steampowered.com/app/4178810/), [COLD AISLE](https://store.steampowered.com/app/5036820), [ShapeHero Factory](https://automaton-media.com/en/pr/shapehero-factory-lets-you-enjoy-those-fun-early-stages-of-a-factory-builder-over-and-over-with-a-blend-of-tower-defense-and-roguelite-elements/), [Factory Magnate](https://voxodyssey.com/games/factory-magnate/).

## 4. Top 10 ideas, ranked
Ranking weighs fun and depth, the owner's learning goal, replayability, and cost. Ideas 1–3 together form the "AI business loop" and turn the game from a factory into an industry.

| # | Idea | Why | Cost |
|---|---|---|---|
| 1 | **Money and unit economics**: credits, capex per building, opex (power, water, upkeep), a ledger with payback and cost per compute | Teaches the economic side; gives every build a trade-off | L |
| 2 | **Model lifecycle**: training produces a model (quality tier); deploy it to serve inference; models age as the frontier moves | Makes training vs. inference a real business choice; recurring goal | M |
| 3 | **AI market**: demand segments (chat, code, enterprise, video) with growing demand, price, latency and uptime needs, reputation | Answers "who uses all this AI"; endless pressure like Mini Metro | L |
| 4 | **Decision events**: events become choices with trade-offs (interruptible power discount, export controls, price war, HBM shortage) | Tension and agency; teaches industry shocks | M |
| 5 | **Scenario regions**: Desert Solar (no water), Nordic Hydro (cheap power, far fiber), Grid-Locked Metro (connection queue), Island (imports) | Replayability through different rules | M per scenario |
| 6 | **Hardware generations and depreciation** | Teaches why GPUs lose value; upgrade vs. sweat the asset | M |
| 7 | **Power procurement**: grid connection with wait time, PPAs, demand response, time-of-day price | Power is the real 2026 constraint | M |
| 8 | **Run modifiers and daily seed**: pick 1 of 3 cards at each era (subsidy, carbon tax, cheap capital) | Each run plays differently | S–M |
| 9 | **Score sheet with friends**: per-scenario scores (profit, PUE, footprint, time) in a shared Google Sheet via Apps Script | Sharing with friends; light competition | S |
| 10 | **Blueprints / copy-paste** | Removes late-game tedium | M |

Not in the top 10 but worth noting: free-form belt routing (high cost, little learning value), building rotation, alt-mode recipe icons.

## 5. Recommendation
Play the current game for 30–45 minutes first (`docs/PLAYTEST.md` checklist). It costs no tokens, and the economy design depends on how the existing pacing feels. Then build E2 (money) as the foundation, since ideas 2, 3, 6 and 7 all depend on it.
