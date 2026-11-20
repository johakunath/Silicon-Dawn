import type { GameState } from '../sim/state';
import type { ItemId } from '../sim/types';
import { ITEM_ORDER } from '../sim/data/items';

type Snap = { t: number; produced: Record<string, number>; consumed: Record<string, number>; delivered: Record<string, number>; spent: Record<string, number>; rp: number; train: number };

/** Samples cumulative sim counters and reports per-minute rates over a sliding window (sim time). */
export class RateTracker {
  private snaps: Snap[] = [];
  window = 60;

  reset() { this.snaps = []; }

  sample(s: GameState) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.time < last.t) this.snaps = [];
    if (last && s.time - last.t < 2) return;
    const st = s.stats;
    this.snaps.push({ t: s.time, produced: { ...st.produced } as Record<string, number>, consumed: { ...st.consumed } as Record<string, number>, delivered: { ...st.delivered } as Record<string, number>, spent: { ...st.spent } as Record<string, number>, rp: st.rpTotal, train: st.trainTotal });
    while (this.snaps.length > 2 && s.time - this.snaps[0].t > this.window) this.snaps.shift();
  }

  private span(): [Snap, Snap] | null {
    if (this.snaps.length < 2) return null;
    return [this.snaps[0], this.snaps[this.snaps.length - 1]];
  }

  /** per-minute rate of a counter */
  perMin(kind: 'produced' | 'consumed' | 'delivered' | 'spent', item: ItemId): number {
    const sp = this.span();
    if (!sp) return 0;
    const [a, b] = sp;
    const dt = b.t - a.t;
    if (dt <= 0) return 0;
    return (((b[kind][item] ?? 0) - (a[kind][item] ?? 0)) / dt) * 60;
  }
  rpPerMin(): number { const sp = this.span(); if (!sp) return 0; const dt = sp[1].t - sp[0].t; return dt > 0 ? ((sp[1].rp - sp[0].rp) / dt) * 60 : 0; }

  items(): ItemId[] { return ITEM_ORDER; }
}
