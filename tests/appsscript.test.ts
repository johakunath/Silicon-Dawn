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
  const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  const src = fs.readFileSync('tools/apps-script/Code.gs', 'utf8');
  const api = new Function('SpreadsheetApp', 'ContentService', 'LockService', `${src}; return { doPost, doGet, CHUNK };`)(SpreadsheetApp, ContentService, LockService);
  const post = (body: unknown) => JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return { post, sheets, api };
}

describe('Apps Script backend', () => {
  const code = 'K7QP-M2XD-9FRA';

  it('ping, then save and load a save larger than one Sheets cell', () => {
    const { post, sheets, api } = loadScript();
    expect(post({ op: 'ping' })).toMatchObject({ ok: true, version: 1 });
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

  it('rejects bad codes, unknown ops and empty saves; unknown code is simply not found', () => {
    const { post } = loadScript();
    expect(post({ op: 'save', code: 'nope', data: 'x' }).ok).toBe(false);
    expect(post({ op: 'save', code, data: '' }).ok).toBe(false);
    expect(post({ op: 'drop_tables' }).ok).toBe(false);
    expect(post({ op: 'load', code })).toMatchObject({ ok: true, found: false });
  });
});
