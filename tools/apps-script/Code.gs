/**
 * Silicon Dawn backend: a Google Sheet plus this Apps Script web app.
 * Setup steps for the owner: tools/apps-script/README.md
 *
 * Protocol: the game sends POST requests with a JSON body as text/plain
 * (no CORS preflight). Every request has { v: 1, op: "...", ... } and gets
 * JSON back: { ok: true, ... } or { ok: false, error: "..." }.
 *
 * Ops today:   ping, save, load, info   (cross-device cloud save)
 * Ops later:   telemetry, score          (epic "Telemetry and friends score sheet")
 *   Add a handler to ROUTES and a tab name to TABS. Nothing else changes.
 *
 * No personal data: players are identified only by a random sync code
 * the game creates (for example K7QP-M2XD-9FRA).
 */

var VERSION = 1;
var TABS = { saves: 'saves' };              // later: telemetry: 'telemetry', scores: 'scores'
var CHUNK = 40000;                          // one Sheets cell holds at most 50,000 characters
var MAX_SAVE = 2000000;                     // 2 MB per save, at most 50 rows
var CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
var SLOT_RE = /^[a-z0-9_-]{1,16}$/;
var SAVE_HEADER = ['code', 'slot', 'part', 'parts', 'savedAt', 'meta', 'enc', 'data'];

var ROUTES = {
  ping: function () { return { ok: true, version: VERSION }; },
  save: opSave,
  load: opLoad,
  info: opInfo,
  // telemetry: opTelemetry,   // later epic
  // score: opScore,           // later epic
};

function doGet() {
  return ContentService.createTextOutput('Silicon Dawn cloud save is running (version ' + VERSION + '). Paste this page address into the game.');
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fn = ROUTES[req.op];
    if (!fn) throw new Error('unknown op');
    out = fn(req);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function checkCode(req) {
  if (!CODE_RE.test(String(req.code || ''))) throw new Error('bad sync code');
  var slot = String(req.slot || 'main');
  if (!SLOT_RE.test(slot)) throw new Error('bad slot');
  return slot;
}

function sheet(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.getRange('A:Z').setNumberFormat('@'); // plain text: no formulas, no number parsing
    sh.setFrozenRows(1);
  }
  return sh;
}

/** rows (1-based sheet row numbers) for one code and slot, sorted by part */
function findRows(sh, code, slot) {
  var n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  var keys = sh.getRange(2, 1, n, 3).getValues();
  var rows = [];
  for (var i = 0; i < keys.length; i++) {
    if (keys[i][0] === code && keys[i][1] === slot) rows.push({ row: i + 2, part: Number(keys[i][2]) });
  }
  rows.sort(function (a, b) { return a.part - b.part; });
  return rows;
}

function opSave(req) {
  var slot = checkCode(req);
  var data = String(req.data || '');
  if (!data) throw new Error('empty save');
  if (data.length > MAX_SAVE) throw new Error('save too large');
  var enc = req.enc === 'gz64' ? 'gz64' : 'raw';
  var meta = JSON.stringify(req.meta || {}).slice(0, 2000);
  var savedAt = new Date().toISOString();
  var parts = [];
  for (var i = 0; i < data.length; i += CHUNK) parts.push(data.slice(i, i + CHUNK));
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet(TABS.saves, SAVE_HEADER);
    var old = findRows(sh, req.code, slot);
    for (var j = old.length - 1; j >= 0; j--) sh.deleteRow(old[j].row);
    var rows = parts.map(function (p, k) { return [req.code, slot, String(k), String(parts.length), savedAt, meta, enc, p]; });
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, rows.length, SAVE_HEADER.length).setNumberFormat('@').setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, savedAt: savedAt, parts: parts.length };
}

function readSave(req, withData) {
  var slot = checkCode(req);
  var sh = sheet(TABS.saves, SAVE_HEADER);
  var rows = findRows(sh, req.code, slot);
  if (!rows.length) return { ok: true, found: false };
  var first = sh.getRange(rows[0].row, 1, 1, SAVE_HEADER.length).getValues()[0];
  var res = { ok: true, found: true, savedAt: first[4], meta: JSON.parse(first[5] || '{}'), enc: first[6] };
  if (withData) {
    if (rows.length !== Number(first[3])) throw new Error('save is incomplete, upload it again');
    var a = rows[0].row, b = rows[rows.length - 1].row;
    var contiguous = b - a + 1 === rows.length; // a save is written as one block, so this is the usual case
    res.data = contiguous
      ? sh.getRange(a, 8, rows.length, 1).getValues().map(function (r) { return r[0]; }).join('')
      : rows.map(function (r) { return sh.getRange(r.row, 8).getValue(); }).join('');
  }
  return res;
}

function opLoad(req) { return readSave(req, true); }
function opInfo(req) { return readSave(req, false); }
