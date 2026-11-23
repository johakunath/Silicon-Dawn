/**
 * Silicon Dawn backend: a Google Sheet plus this Apps Script web app.
 * Setup steps for the owner: tools/apps-script/README.md
 *
 * Protocol: the game sends POST requests with a JSON body as text/plain
 * (no CORS preflight). Every request has { v: 1, op: "...", ... } and gets
 * JSON back: { ok: true, ... } or { ok: false, error: "..." }.
 *
 * Ops:  ping, save, load, info       cross-device cloud save (by sync code)
 *       telemetry                    opt-in anonymous run summary, one row per run, updated in place
 *       score, scores                friends score sheet: submit a finished campaign, read the top list
 *
 * No personal data: saves are found only by a random sync code, telemetry and scores by a random
 * player id (for example k3v9q2m7xa). A score carries the name the player typed, nothing else.
 */

var VERSION = 2;
var TABS = { saves: 'saves', telemetry: 'telemetry', scores: 'scores' };
var CHUNK = 40000;                          // one Sheets cell holds at most 50,000 characters
var MAX_SAVE = 2000000;                     // 2 MB per save, at most 50 rows
var CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
var SLOT_RE = /^[a-z0-9_-]{1,16}$/;
var SAVE_HEADER = ['code', 'slot', 'part', 'parts', 'savedAt', 'meta', 'enc', 'data'];
var ID_RE = /^[a-z0-9]{10}$/;               // random player id and run id from the game
var TELE_HEADER = ['player', 'run', 'updatedAt', 'game', 'mode', 'difficulty', 'seed', 'era', 'minutes', 'status', 'grades', 'credits', 'grants', 'breakdowns', 'models', 'summary'];
var SCORE_HEADER = ['player', 'run', 'at', 'name', 'mode', 'difficulty', 'seed', 'minutes', 'grades', 'score'];
var MAX_SUMMARY = 30000;
var MODES = { campaign: 1, sandbox: 1 };
var DIFFS = { relaxed: 1, standard: 1, race: 1 };

var ROUTES = {
  ping: function () { return { ok: true, version: VERSION }; },
  save: opSave,
  load: opLoad,
  info: opInfo,
  telemetry: opTelemetry,
  score: opScore,
  scores: opScores,
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
    // conditional upload (auto uploads): only replace the save the client last saw, so a
    // device with stale knowledge can never overwrite newer progress from another device
    if (req.ifSavedAt !== undefined && req.ifSavedAt !== null) {
      var current = old.length ? String(sh.getRange(old[0].row, 5).getValue()) : '';
      if (current !== String(req.ifSavedAt)) return { ok: false, conflict: true, error: 'the cloud save changed on another device' };
    }
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
  // same lock as opSave: row positions must not shift between lookup and read
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return readSaveLocked(req, slot, withData);
  } finally {
    lock.releaseLock();
  }
}

function readSaveLocked(req, slot, withData) {
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

// ───────── telemetry and scores ─────────
function checkIds(req) {
  if (!ID_RE.test(String(req.player || ''))) throw new Error('bad player id');
  if (!ID_RE.test(String(req.run || ''))) throw new Error('bad run id');
}
function num(v, lo, hi) { var n = Number(v); if (!isFinite(n)) return lo; return Math.max(lo, Math.min(hi, n)); }
function word(v, set, def) { v = String(v || ''); return set[v] ? v : def; }
/** plain text for a cell: trimmed first, then no leading = + - @ (so " =1+1" cannot become a formula), short */
function text(v, max) {
  var s = String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim();
  s = s.replace(/^[=+\-@\s]+/, '');
  return s.slice(0, max).trim();
}

/** the row (1-based) for this player and run, or 0 */
function findRun(sh, player, run) {
  var n = sh.getLastRow() - 1;
  if (n <= 0) return 0;
  var keys = sh.getRange(2, 1, n, 2).getValues();
  for (var i = 0; i < keys.length; i++) if (keys[i][0] === player && keys[i][1] === run) return i + 2;
  return 0;
}

/** Upsert one row per run: the latest summary replaces the previous one. */
function opTelemetry(req) {
  checkIds(req);
  var r = req.row || {};
  var summary = JSON.stringify(req.summary || {});
  if (summary.length > MAX_SUMMARY) throw new Error('summary too large');
  var row = [req.player, req.run, new Date().toISOString(), text(r.game, 20), word(r.mode, MODES, 'campaign'), word(r.difficulty, DIFFS, 'standard'),
    String(num(r.seed, 0, 4294967295)), String(num(r.era, 0, 5)), String(num(r.minutes, 0, 100000)), text(r.status, 12), text(r.grades, 20),
    String(Math.round(num(r.credits, -1e9, 1e9))), String(num(r.grants, 0, 1000)), String(num(r.breakdowns, 0, 1e7)), String(num(r.models, 0, 10000)), summary];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet(TABS.telemetry, TELE_HEADER);
    var at = findRun(sh, req.player, req.run) || sh.getLastRow() + 1;
    sh.getRange(at, 1, 1, TELE_HEADER.length).setNumberFormat('@').setValues([row]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/** Submit a finished campaign. One row per run: a resubmit updates the name. */
function opScore(req) {
  checkIds(req);
  var name = text(req.name, 16);
  if (!name) throw new Error('name missing');
  var row = [req.player, req.run, new Date().toISOString(), name, word(req.mode, MODES, 'campaign'), word(req.difficulty, DIFFS, 'standard'),
    String(num(req.seed, 0, 4294967295)), String(Math.round(num(req.minutes, 0, 100000))), text(req.grades, 20), String(Math.round(num(req.score, 0, 1e6)))];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet(TABS.scores, SCORE_HEADER);
    var at = findRun(sh, req.player, req.run) || sh.getLastRow() + 1;
    sh.getRange(at, 1, 1, SCORE_HEADER.length).setNumberFormat('@').setValues([row]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/** Top scores for one mode and difficulty, best first (ties: faster first). Player ids are not sent back. */
function opScores(req) {
  var mode = word(req.mode, MODES, 'campaign'), diff = word(req.difficulty, DIFFS, 'standard');
  var limit = req.limit === undefined ? 20 : num(req.limit, 1, 50);
  var sh = sheet(TABS.scores, SCORE_HEADER);
  var n = sh.getLastRow() - 1;
  var list = [];
  if (n > 0) {
    var rows = sh.getRange(2, 1, n, SCORE_HEADER.length).getValues();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r[4] !== mode || r[5] !== diff) continue;
      list.push({ run: r[1], mine: req.player && r[0] === req.player, at: r[2], name: r[3], seed: Number(r[6]), minutes: Number(r[7]), grades: r[8], score: Number(r[9]) });
    }
  }
  list.sort(function (a, b) { return b.score - a.score || a.minutes - b.minutes; });
  return { ok: true, scores: list.slice(0, limit) };
}
