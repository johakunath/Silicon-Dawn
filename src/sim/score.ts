// Campaign score for the friends score sheet. Pure: derived from the era ratings and the campaign time.
import { ERA_PAR } from './data/eras';
import type { GameState } from './state';

/** Points per full rating (1.0 average across eras). */
export const SCORE_SCALE = 10000;
/** Points lost per minute over the summed era par. */
export const SCORE_SLOW_PER_MIN = 20;

export function campaignPar(): number {
  return Object.values(ERA_PAR).reduce((a, b) => a + b, 0) / 60;
}

/** Era grades as "A·S·A·A·B". */
export function gradeLine(s: GameState): string {
  return s.eraScores.map((e) => e.grade).join('·');
}

/** Score = average era rating × 10,000, minus 20 per minute over the campaign par. Never below 0. */
export function campaignScore(s: GameState): number {
  if (!s.eraScores.length) return 0;
  const avg = s.eraScores.reduce((a, e) => a + (e.efficiency + e.reliability + e.footprint) / 3, 0) / s.eraScores.length;
  const minutes = s.time / 60;
  return Math.max(0, Math.round(avg * SCORE_SCALE - SCORE_SLOW_PER_MIN * Math.max(0, minutes - campaignPar())));
}
