import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

/** Runs tools/apps-script/Code.gs against a tiny in-memory fake of SpreadsheetApp. */
function loadScript() {
  const sheets = new Map<string, string[][]>();
  const fakeSheet = (name: string) => {
    const rows = sheets.get(name)!;
    const range = (r: number, c: number, nr = 1, nc = 1) => ({
      setValues(v: string[][]) { v.forEach((row, i) => { rows[r - 1 + i] ??= []; row.forEach((x, j) => (rows[r - 1 + i][c - 1 + j] = String(x))); }); return this; },
      getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? '')); },
      getValue() { return rows[r - 1]?.[c - 1] ?? ''; },
      setFontWeight() { return this; }, setNumberFormat() { return this; },
    });
    return {
      getRange: (a: number | string, b?: number, c?: number, d?: number) => (typeof a === 'string' ? range(1, 1) : range(a, b!, c, d)),
      getLastRow: () => rows.length,
      deleteRow: (r: number) => { rows.splice(r - 1, 1); },
      setFrozenRows() {},
    };
  };
  const SpreadsheetApp = { getActiveSpreadsheet: () => ({
    getSheetByName: (n: string) => (sheets.has(n) ? fakeSheet(n) : null),
    insertSheet: (n: string) => { sheets.set(n, []); return fakeSheet(n); },
  }) };
  const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t: string) => ({ text: t, setMimeType() { return this; } }) };
  const lock = { held: 0, taken: 0 };
  const LockService = { getScriptLock: () => ({ waitLock() { lock.held++; lock.taken++; }, releaseLock() { lock.held--; } }) };
  const src = fs.readFileSync('tools/apps-script/Code.gs', 'utf8');
  const api = new Function('SpreadsheetApp', 'ContentService', 'LockService', `${src}; return { doPost, doGet, CHUNK };`)(SpreadsheetApp, ContentService, LockService);
  const post = (body: unknown) => JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return { post, sheets, api, lock };
}

describe('Apps Script backend', () => {
  const code = 'K7QP-M2XD-9FRA';

  it('ping, then save and load a save larger than one Sheets cell', () => {
    const { post, sheets, api } = loadScript();
    expect(post({ op: 'ping' })).toMatchObject({ ok: true, version: 2 });
    const data = 'x'.repeat(api.CHUNK * 2 + 123) + '=tail';
    const r = post({ op: 'save', code, enc: 'raw', data, meta: { era: 2, min: 30 } });
    expect(r).toMatchObject({ ok: true, parts: 3 });
    for (const row of sheets.get('saves')!.slice(1)) expect(row[7].length).toBeLessThanOrEqual(50000);
    const l = post({ op: 'load', code });
    expect(l.found).toBe(true);
    expect(l.data).toBe(data);
    expect(l.meta.era).toBe(2);
    expect(post({ op: 'info', code }).data).toBeUndefined();
  });

  it('a new upload replaces the old one, other players are untouched', () => {
    const { post, sheets } = loadScript();
    const other = 'ABCD-EFGH-JKLM';
    post({ op: 'save', code: other, data: 'theirs' });
    post({ op: 'save', code, data: 'a'.repeat(90000) });
    post({ op: 'save', code, data: 'short' });
    expect(post({ op: 'load', code }).data).toBe('short');
    expect(post({ op: 'load', code: other }).data).toBe('theirs');
    expect(sheets.get('saves')!.length).toBe(3); // header + one row each
  });

  it('conditional uploads refuse to replace a save they have not seen', () => {
    const { post } = loadScript();
    expect(post({ op: 'save', code, data: 'first', ifSavedAt: '' }).ok).toBe(true); // empty cloud: allowed
    const seen = post({ op: 'info', code }).savedAt;
    expect(post({ op: 'save', code, data: 'other', ifSavedAt: '' })).toMatchObject({ ok: false, conflict: true });
    expect(post({ op: 'save', code, data: 'stale', ifSavedAt: 'not-the-current-one' })).toMatchObject({ ok: false, conflict: true });
    expect(post({ op: 'load', code }).data).toBe('first');
    expect(post({ op: 'save', code, data: 'next', ifSavedAt: seen }).ok).toBe(true);
    expect(post({ op: 'load', code }).data).toBe('next');
  });

  it('reads take the same lock as writes', () => {
    const { post, lock } = loadScript();
    post({ op: 'save', code, data: 'x' });
    const before = lock.taken;
    post({ op: 'load', code });
    post({ op: 'info', code });
    expect(lock.taken).toBe(before + 2);
    expect(lock.held).toBe(0);
  });

  it('rejects bad codes, unknown ops and empty saves; unknown code is simply not found', () => {
    const { post } = loadScript();
    expect(post({ op: 'save', code: 'nope', data: 'x' }).ok).toBe(false);
    expect(post({ op: 'save', code, data: '' }).ok).toBe(false);
    expect(post({ op: 'drop_tables' }).ok).toBe(false);
    expect(post({ op: 'load', code })).toMatchObject({ ok: true, found: false });
  });

  describe('telemetry and scores (E8)', () => {
    const player = 'k3v9q2m7xa', run = 'r1r1r1r1r1';
    it('telemetry keeps one row per run and updates it in place', () => {
      const { post, sheets } = loadScript();
      expect(post({ op: 'telemetry', player, run, row: { era: 2, minutes: 9, status: 'active' }, summary: { a: 1 } }).ok).toBe(true);
      expect(post({ op: 'telemetry', player, run, row: { era: 3, minutes: 20, status: 'left' }, summary: { a: 2 } }).ok).toBe(true);
      post({ op: 'telemetry', player, run: 'r2r2r2r2r2', row: { era: 1 }, summary: {} });
      const rows = sheets.get('telemetry')!;
      expect(rows.length).toBe(3); // header + two runs
      expect(rows[1][7]).toBe('3');
      expect(rows[1][9]).toBe('left');
      expect(JSON.parse(rows[1][15])).toEqual({ a: 2 });
    });
    it('rejects bad ids and oversized summaries; neutralises formulas in text', () => {
      const { post, sheets } = loadScript();
      expect(post({ op: 'telemetry', player: 'Bob', run, summary: {} })).toMatchObject({ ok: false, error: 'bad player id' });
      expect(post({ op: 'telemetry', player, run, summary: { x: 'y'.repeat(40000) } })).toMatchObject({ ok: false, error: 'summary too large' });
      post({ op: 'score', player, run, name: '=HYPERLINK("x")', difficulty: 'standard', score: 5 });
      expect(sheets.get('scores')![1][3].startsWith('=')).toBe(false);
      // leading whitespace must not hide a formula: trimmed first, then neutralised
      for (const name of [' =1+1', '\t+SUM(A1)', '  @x', ' - =2']) {
        post({ op: 'score', player, run, name, difficulty: 'standard', score: 5 });
        expect(sheets.get('scores')![1][3]).toMatch(/^[^=+\-@\s]/);
      }
      post({ op: 'telemetry', player, run, row: { game: ' =cmd', status: ' +x', grades: '  -A' }, summary: {} });
      for (const c of sheets.get('telemetry')![1].slice(3, 11)) expect(c).not.toMatch(/^\s*[=+\-@]/);
      expect(post({ op: 'score', player, run, name: '   ', score: 5 })).toMatchObject({ ok: false });
    });
    it('scores: one row per run, filtered by difficulty, best first, ties by time, without player ids', () => {
      const { post } = loadScript();
      post({ op: 'score', player, run, name: 'Jo', difficulty: 'standard', minutes: 90, score: 8000 });
      post({ op: 'score', player, run, name: 'Jo2', difficulty: 'standard', minutes: 90, score: 8000 }); // resubmit: same row
      post({ op: 'score', player: 'aaaaaaaaaa', run: 'bbbbbbbbbb', name: 'Mara', difficulty: 'standard', minutes: 80, score: 8000 });
      post({ op: 'score', player: 'cccccccccc', run: 'dddddddddd', name: 'Tim', difficulty: 'standard', minutes: 70, score: 7000 });
      post({ op: 'score', player: 'eeeeeeeeee', run: 'ffffffffff', name: 'Race', difficulty: 'race', minutes: 60, score: 9999 });
      const r = post({ op: 'scores', player, difficulty: 'standard' });
      expect(r.scores.map((x: any) => x.name)).toEqual(['Mara', 'Jo2', 'Tim']);
      expect(r.scores[1].mine).toBe(true);
      expect(r.scores[0].mine).toBe(false);
      expect(JSON.stringify(r)).not.toContain('aaaaaaaaaa');
    });
  });
});
