import { describe, expect, it } from 'vitest';
import { PROFILES, autoProfile, frameDue, resolveProfile, targetFps } from '../src/render/quality';
import { angleDelta, twoFinger } from '../src/game/touch';
import { cancelLabel } from '../src/ui/touchbar';
import { CODE_ALPHABET, autoUploadAllowed, codeFromBytes, decodeSave, encodeSave, normalizeCode, runFromTag, saveSig, summarize, validUrl } from '../src/ui/cloudsave';

describe('quality profiles', () => {
  it('auto picks Performance on touch-first devices and Quality with a mouse', () => {
    expect(autoProfile({ coarse: true, anyFine: true, maxTouchPoints: 10 })).toBe('performance'); // tablet with S Pen
    expect(autoProfile({ coarse: false, anyFine: false, maxTouchPoints: 5 })).toBe('performance');
    expect(autoProfile({ coarse: false, anyFine: true, maxTouchPoints: 10 })).toBe('quality'); // touch laptop with a trackpad
    expect(autoProfile({ coarse: false, anyFine: true, maxTouchPoints: 0 })).toBe('quality');
    expect(resolveProfile('quality', { coarse: true, anyFine: false, maxTouchPoints: 5 })).toBe('quality');
  });

  it('Performance is lighter than Quality on every lever', () => {
    const p = PROFILES.performance, q = PROFILES.quality;
    expect(p.maxDpr).toBeLessThan(q.maxDpr);
    expect(p.msaa).toBeLessThan(q.msaa);
    expect(p.shadowMap).toBeLessThan(q.shadowMap);
    expect(p.bloomScale).toBeLessThan(q.bloomScale);
    expect(p.particleDensity).toBeLessThan(q.particleDensity);
    expect(p.fps).toBeGreaterThan(0);
  });

  it('frame pacing: cap, faster while interacting, slow when idle, nothing while hidden', () => {
    const p = PROFILES.performance, q = PROFILES.quality;
    const st = { hidden: false, active: false, idle: false };
    expect(targetFps(p, null, st)).toBe(30);
    expect(targetFps(p, null, { ...st, active: true })).toBe(60);
    expect(targetFps(p, null, { ...st, idle: true })).toBe(10);
    expect(targetFps(p, 60, { ...st, active: false })).toBe(60); // explicit cap wins
    expect(targetFps(p, 0, { ...st, idle: true })).toBe(10);
    expect(targetFps(q, null, st)).toBe(0);
    expect(targetFps(q, null, { ...st, idle: true })).toBe(0);
    expect(targetFps(q, null, { ...st, hidden: true })).toBe(-1);
  });

  it('frameDue skips refreshes on a 120 Hz screen to hold the cap', () => {
    let last = -1e9, n = 0;
    for (let i = 0; i < 120; i++) { const now = i * (1000 / 120); if (frameDue(now, last, 30)) { last = now; n++; } }
    expect(n).toBeGreaterThanOrEqual(29);
    expect(n).toBeLessThanOrEqual(31);
    expect(frameDue(5, 0, 0)).toBe(true);
    expect(frameDue(5000, 0, -1)).toBe(false);
  });
});

describe('touch gestures', () => {
  it('two-finger geometry', () => {
    const t = twoFinger({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(t.dist).toBe(100);
    expect(t.mx).toBe(50);
    expect(angleDelta(3.1, -3.1)).toBeCloseTo(2 * Math.PI - 6.2, 5); // wraps across ±π
    expect(angleDelta(0, 0.3)).toBeCloseTo(0.3);
  });

  it('the cancel pill mirrors right-click', () => {
    expect(cancelLabel({ kind: 'select' }, null, false)).toBeNull();
    expect(cancelLabel({ kind: 'select' }, 'Solar Array', false)).toContain('DESELECT');
    expect(cancelLabel({ kind: 'demolish' }, null, false)).toContain('Demolish');
    expect(cancelLabel({ kind: 'build', type: 'solar' }, null, false)).toContain('CANCEL');
  });
});

describe('cloud save', () => {
  it('sync codes are 12 unambiguous symbols and survive sloppy typing', () => {
    const c = codeFromBytes(Array.from({ length: 12 }, (_, i) => i * 37));
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(normalizeCode(c.toLowerCase().replace(/-/g, ' '))).toBe(c);
    expect(normalizeCode('ABCD-EFGH-IJKL')).toBeNull(); // I is not in the alphabet
    expect(normalizeCode('short')).toBeNull();
  });

  it('only accepts Apps Script URLs', () => {
    expect(validUrl('https://script.google.com/macros/s/abc/exec')).toBe(true);
    expect(validUrl('http://script.google.com/macros/s/abc/exec')).toBe(false);
    expect(validUrl('https://evil.example/exec')).toBe(false);
  });

  it('gzip round trip keeps the save byte for byte and fits Sheets cells when chunked', async () => {
    const json = JSON.stringify({ version: 2, era: 3, time: 5100, seed: 7, buildings: Array.from({ length: 3000 }, (_, i) => ({ id: i, type: 'rack', x: i % 128, y: (i / 128) | 0, ü: 'ö' })) });
    const { enc, data } = await encodeSave(json);
    expect(enc).toBe('gz64');
    expect(data.length).toBeLessThan(json.length / 4);
    expect(await decodeSave(enc, data)).toBe(json);
    expect(await decodeSave('raw', json)).toBe(json);
  });

  it('save fingerprint ignores only the timestamp', () => {
    const a = JSON.stringify({ era: 1, buildings: [1], savedAt: '2026-11-23T10:00:00.000Z' });
    const b = JSON.stringify({ era: 1, buildings: [1], savedAt: '2026-11-23T11:00:00.000Z' });
    const c = JSON.stringify({ era: 1, buildings: [1, 2], savedAt: '2026-11-23T11:00:00.000Z' });
    expect(saveSig(a)).toBe(saveSig(b));
    expect(saveSig(a)).not.toBe(saveSig(c)); // a build while paused still counts as a change
  });

  it('auto upload never overwrites a further-along or different run', () => {
    const local = { ...summarize(JSON.stringify({ era: 2, time: 1801, seed: 5, mode: 'campaign', difficulty: 'standard' }), 'Desktop'), runId: 'r1' };
    expect(local).toMatchObject({ era: 2, min: 30, time: 1801, seed: 5 });
    const cloud = (meta: object) => ({ found: true, meta: { seed: 5, mode: 'campaign', difficulty: 'standard', runId: 'r1', time: 1200, ...meta } });
    expect(autoUploadAllowed(local, null)).toBe(true);
    expect(autoUploadAllowed(local, { found: false })).toBe(true);
    expect(autoUploadAllowed(local, cloud({}))).toBe(true);
    expect(autoUploadAllowed(local, cloud({ time: 1829 }))).toBe(false); // same minute, but the cloud is ahead
    expect(autoUploadAllowed(local, cloud({ runId: 'r2', time: 1 }))).toBe(false); // another campaign, same seed
    expect(autoUploadAllowed({ ...local, runId: undefined }, cloud({ time: 1 }))).toBe(false); // unknown run
    expect(autoUploadAllowed(local, cloud({ difficulty: 'race' }))).toBe(false);
    expect(autoUploadAllowed(local, cloud({ seed: 9 }))).toBe(false);
  });

  it('only a game loaded from its own tagged autosave keeps its cloud run', () => {
    const auto = JSON.stringify({ era: 1, time: 1900, seed: 5, savedAt: '2026-11-23T10:00:00.000Z' });
    const tag = { runId: 'r1', sig: saveSig(auto) };
    expect(runFromTag(tag, auto)).toBe('r1'); // Continue after a reload
    expect(runFromTag(tag, JSON.stringify({ era: 1, time: 1900, seed: 5, savedAt: 'x', buildings: [1] }))).toBeUndefined(); // another save, same seed
    expect(runFromTag(null, auto)).toBeUndefined();
  });
});
