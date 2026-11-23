// Colony market data: demand segments, model sizes, frontier speed. Tune balance here.
// Units: demand in queries per second, prices in credits per query, compute per query by model size.
import type { Difficulty, MarketSegmentId, ModelSizeId } from '../types';

export type SegmentId = MarketSegmentId;

export interface SegmentDef {
  id: SegmentId;
  name: string;
  /** one line for the market panel and the Codex */
  desc: string;
  /** credits per query at 100% model quality */
  price: number;
  /** lowest model quality (share of the frontier) this segment accepts */
  minQuality: number;
  /** highest latency in ms it accepts; Infinity = batch work that waits */
  maxLatency: number;
  /** reputation (uptime) it expects; below this its demand fades to 30% over 15 points */
  uptime: number;
  /** demand in queries/s when the market opens in Era III */
  demand: number;
  /** extra demand growth per minute on top of the shared growth (science grows faster) */
  growth: number;
}

export const SEGMENTS: SegmentDef[] = [
  { id: 'chat', name: 'Chat', desc: 'Colonists asking questions all day. Huge volume, low price, wants quick answers.', price: 0.06, minQuality: 0.4, maxLatency: 120, uptime: 0.7, demand: 22, growth: 0 },
  { id: 'media', name: 'Media', desc: 'Images, voice and video for colony channels. Needs the fastest replies.', price: 0.09, minQuality: 0.55, maxLatency: 100, uptime: 0.75, demand: 10, growth: 0 },
  { id: 'code', name: 'Code', desc: 'Engineers writing software. Pays well for a capable model.', price: 0.16, minQuality: 0.75, maxLatency: 200, uptime: 0.85, demand: 12, growth: 0.005 },
  { id: 'enterprise', name: 'Enterprise', desc: 'Colony firms running their business on you. Needs high uptime above all.', price: 0.24, minQuality: 0.65, maxLatency: 300, uptime: 0.95, demand: 8, growth: 0.005 },
  { id: 'science', name: 'Science', desc: 'Research batch jobs. Only frontier models will do, but they wait for a free slot.', price: 0.45, minQuality: 1.05, maxLatency: Infinity, uptime: 0.6, demand: 5, growth: 0.015 },
];
export const SEGMENT: Record<SegmentId, SegmentDef> = Object.fromEntries(SEGMENTS.map((s) => [s.id, s])) as Record<SegmentId, SegmentDef>;

/** Base latency in ms of an idle gateway. Queueing: latency = BASE_LATENCY ÷ (1 − load). */
export const BASE_LATENCY = 30;

/** Shared demand growth per minute since the market opened (colonies grow and adopt AI). */
export const DEMAND_GROWTH = 0.025;
/** Demand multiplier per era (new colonies, new uses). Sandbox uses Era V. */
export const DEMAND_ERA: Record<number, number> = { 3: 1, 4: 2.5, 5: 4 };

export type ModelSize = ModelSizeId;
export interface ModelSizeDef {
  id: ModelSize;
  name: string;
  /** suffix on the model name ('' for the standard size) */
  suffix: string;
  /** training units for a run that starts in Era III; later eras multiply by RUN_ERA */
  train: number;
  /** quality at release as a share of the frontier, before the fiber bonus */
  quality: number;
  /** compute per query: bigger models need more compute for every answer */
  cost: number;
}
export const MODEL_SIZES: Record<ModelSize, ModelSizeDef> = {
  S: { id: 'S', name: 'Lite', suffix: ' Lite', train: 2000, quality: 0.75, cost: 0.5 },
  M: { id: 'M', name: 'Standard', suffix: '', train: 5000, quality: 1.0, cost: 1 },
  L: { id: 'L', name: 'Max', suffix: ' Max', train: 15000, quality: 1.25, cost: 2.5 },
};
export const SIZE_ORDER: ModelSize[] = ['S', 'M', 'L'];
/** Training run size multiplier by the era the run starts in (frontier runs keep getting bigger). */
export const RUN_ERA: Record<number, number> = { 3: 1, 4: 5, 5: 10 };
/** Fiber bonus: quality × (FIBER_BASE + FIBER_BONUS × share of training that arrived over fiber). */
export const FIBER_BASE = 0.9;
export const FIBER_BONUS = 0.2;

/** Frontier growth per minute: rival labs keep shipping better models. */
export const FRONTIER_GROWTH: Record<Difficulty, number> = { relaxed: 0.01, standard: 0.015, race: 0.02 };

/** The licensed open-weights model every colony starts with: quality as a share of the frontier, compute per query. */
export const BASELINE = { name: 'Open baseline', quality: 0.7, cost: 0.5 };

/** Price multiplier from model quality: clamp(quality, PRICE_Q_MIN, PRICE_Q_MAX). Better models charge more. */
export const PRICE_Q_MIN = 0.5;
export const PRICE_Q_MAX = 1.5;

/** Reputation starts here when the market opens and follows gateway uptime with this time constant (seconds). */
export const REP_START = 0.8;
export const REP_TAU = 150;
/** Below a segment's uptime need, demand fades linearly over this many points of reputation, down to REP_FLOOR. */
export const REP_FADE = 0.15;
/** Loyal customers: this share of demand stays however low reputation falls, so an outage never kills all income. */
export const REP_FLOOR = 0.3;

/** Models kept on the shelf (oldest idle one is retired when a new model ships). */
export const SHELF_MAX = 4;
