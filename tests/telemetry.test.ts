import { describe, expect, it } from 'vitest';
import { createState } from '../src/sim/state';
import { campaignPar, campaignScore, gradeLine, SCORE_SCALE, SCORE_SLOW_PER_MIN } from '../src/sim/score';
import { cleanName, idFromBytes, summarize, telemetryRow } from '../src/ui/telemetry';
import type { RunLog } from '../src/ui/telemetry';

const log = (): RunLog => ({ run: 'abcdefghij', game: '1.0.0', startedAt: '2026-11-23T00:00:00Z', fromMin: 0, seed: 1, mode: 'campaign', difficulty: 'standard', status: 'active', events: [], samples: [], eraTimes: [] });

describe('campaign score', () => {
  it('is the average era rating × 10,000, minus 20 per minute over par', () => {
    const s = createState(1);
    expect(campaignScore(s)).toBe(0);
    s.eraScores = [
      { era: 1, time: 0, efficiency: 1, reliability: 0.8, footprint: 0.9, grade: 'A' },
      { era: 2, time: 0, efficiency: 0.6, reliability: 0.7, footprint: 0.8, grade: 'B' },
    ];
    s.time = campaignPar() * 60;
    const avg = ((1 + 0.8 + 0.9) / 3 + (0.6 + 0.7 + 0.8) / 3) / 2;
    expect(campaignScore(s)).toBe(Math.round(avg * SCORE_SCALE));
    s.time += 600;
    expect(campaignScore(s)).toBe(Math.round(avg * SCORE_SCALE - 10 * SCORE_SLOW_PER_MIN));
    expect(gradeLine(s)).toBe('A·B');
    s.time = 1e7;
    expect(campaignScore(s)).toBe(0);
  });
});

describe('telemetry helpers', () => {
  it('random ids are 10 lowercase letters or digits', () => {
    const id = idFromBytes([0, 35, 36, 255, 7, 8, 9, 10, 11, 12]);
    expect(id).toMatch(/^[a-z0-9]{10}$/);
  });
  it('names are trimmed, short and without markup or control characters', () => {
    expect(cleanName('  <b>Jo</b>\n ')).toBe('bJo/b');
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
  });
  it('the summary carries game numbers only: no sync code, no name, no save data', () => {
    const s = createState(42);
    const sum = summarize(s, log());
    const row = telemetryRow(s, log(), '1.0.0');
    const text = JSON.stringify({ sum, row });
    expect(text).not.toMatch(/code|name|email|stock|buildings":\[/i);
    expect(row).toMatchObject({ seed: 42, era: 1, status: 'active' });
    expect(sum.score).toBeNull();
    expect(text.length).toBeLessThan(30000);
  });
});

describe('telemetry client privacy', () => {
  async function client(consent: 'yes' | 'no' | null) {
    const store = new Map<string, string>();
    const sent: any[] = [];
    const g = globalThis as any;
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    g.window = { setInterval: () => 0 };
    g.document = { addEventListener() {}, visibilityState: 'visible' };
    g.fetch = async (_url: string, init: any) => { const body = JSON.parse(init.body); sent.push(body); return { json: async () => ({ ok: true, scores: [{ run: 'aaaaaaaaaa', name: 'X', score: 1, minutes: 1, grades: '', at: '' }] }) }; };
    store.set('sd_telemetry_v1', JSON.stringify({ consent, player: 'k3v9q2m7xa', name: '' }));
    const { Telemetry } = await import('../src/ui/telemetry');
    return { t: new Telemetry(() => 'https://script.google.com/macros/s/x/exec', '1.0.0'), sent };
  }
  it('reading the score sheet sends no player id, with or without consent', async () => {
    for (const c of ['no', null, 'yes'] as const) {
      const { t, sent } = await client(c);
      await t.scores('standard');
      expect(sent.at(-1).op).toBe('scores');
      expect(sent.at(-1).player).toBeUndefined();
    }
  });
  it('without consent nothing is uploaded; with consent the run summary goes out', async () => {
    const { t, sent } = await client('no');
    const s = createState(3);
    t.observe(s);
    await t.flush(false);
    expect(sent.length).toBe(0);
    t.setConsent('yes');
    await t.flush(false);
    expect(sent.some((b) => b.op === 'telemetry' && b.player === 'k3v9q2m7xa')).toBe(true);
  });
});
