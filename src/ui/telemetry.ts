// Opt-in anonymous telemetry, the local run log, and the friends score sheet.
// Nothing leaves the device without consent ('yes'). Players are a random id; a score carries only the name they type.
// Uploads go to the owner's Apps Script web app (tools/apps-script/Code.gs, ops telemetry, score, scores).
import type { GameState } from '../sim/state';
import { BUILDING } from '../sim/data/buildings';
import { badgeFor } from './status';
import { campaignScore, gradeLine } from '../sim/score';

const PREFS_KEY = 'sd_telemetry_v1';
const LOG_KEY = 'sd_runlog_v1';
const SCORES_KEY = 'sd_scores_submitted_v1';
const KEEP_LOGS = 5;
const UPLOAD_EVERY_MS = 2 * 60 * 1000;
const MAX_EVENTS = 300;
const SAMPLE_EVERY = 60; // sim seconds

export type Consent = 'yes' | 'no' | null;
export interface TelemetryPrefs { consent: Consent; player: string; name: string }
export interface RunEvent { t: number; k: string; d?: string | number }
export interface RunSample { t: number; era: number; credits: number; rev: number; compute: number; buildings: number; problems: number }
export interface RunLog {
  run: string;
  game: string;
  startedAt: string;
  /** sim minutes at the start of this session (a loaded save starts later than 0) */
  fromMin: number;
  seed: number; mode: string; difficulty: string;
  status: 'active' | 'finished' | 'left';
  events: RunEvent[];
  samples: RunSample[];
  /** sim seconds when each era started (era 2..5) */
  eraTimes: number[];
}
export interface ScoreRow { run: string; mine: boolean; at: string; name: string; seed: number; minutes: number; grades: string; score: number }

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** 10 random lowercase letters and digits. */
export function idFromBytes(bytes: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += ID_ALPHABET[bytes[i] % 36];
  return s;
}
export function randomId(): string {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return idFromBytes(b);
}

/** Name for the score sheet: printable, trimmed, at most 16 characters. */
export function cleanName(v: string): string {
  return v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
}

/** One row of the telemetry tab: the headline numbers of a run (the sheet keeps the full summary as JSON). */
export function telemetryRow(s: GameState, log: RunLog, game: string) {
  return {
    game, mode: s.mode, difficulty: s.difficulty, seed: s.seed, era: s.era, minutes: Math.round(s.time / 60), status: log.status,
    grades: gradeLine(s), credits: Math.round(s.econ.credits), grants: s.econ.grants, breakdowns: s.ops.breakdowns, models: s.market.shipped,
  };
}

/** The run summary sent with consent: counters, era times, the money curve, notable events. No personal data. */
export function summarize(s: GameState, log: RunLog) {
  return {
    v: 1, run: log.run, fromMin: log.fromMin, status: log.status, eraTimes: log.eraTimes,
    scores: s.eraScores.map((e) => ({ era: e.era, grade: e.grade, min: Math.round(e.time / 60), eff: +e.efficiency.toFixed(2), rel: +e.reliability.toFixed(2), fp: +e.footprint.toFixed(2) })),
    econ: { credits: Math.round(s.econ.credits), min: Math.round(s.econ.minCredits), grants: s.econ.grants, income: Object.fromEntries(Object.entries(s.econ.income).map(([k, v]) => [k, Math.round(v)])), costs: Object.fromEntries(Object.entries(s.econ.costs).map(([k, v]) => [k, Math.round(v)])) },
    market: { shipped: s.market.shipped, rep: +s.market.rep.toFixed(2), frontier: +s.market.frontier.toFixed(2) },
    ops: { breakdowns: s.ops.breakdowns, gridLevel: s.ops.gridLevel, dr: s.ops.dr },
    techs: s.techs, buildings: s.buildings.length, done: Object.keys(s.done).length,
    samples: log.samples.slice(-120), events: log.events.slice(-MAX_EVENTS),
    score: s.flags.campaignDone ? campaignScore(s) : null,
  };
}

/** Counters watched between frames: a change becomes a run-log event. */
interface Seen { era: number; breakdowns: number; grants: number; shipped: number; done: boolean; events: string; objectives: number; sampleAt: number }

export class Telemetry {
  prefs: TelemetryPrefs;
  log: RunLog | null = null;
  lastError = '';
  private state: GameState | null = null;
  private seen: Seen | null = null;
  private lastUpload = 0;
  private dirty = false;

  constructor(private url: () => string, private game: string) {
    this.prefs = (() => {
      const def: TelemetryPrefs = { consent: null, player: '', name: '' };
      try { return { ...def, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }; } catch { return def; }
    })();
    if (!/^[a-z0-9]{10}$/.test(this.prefs.player)) { this.prefs.player = randomId(); this.savePrefs(); }
    window.setInterval(() => { if (Date.now() - this.lastUpload > UPLOAD_EVERY_MS && this.dirty) void this.flush(false); }, 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden' || !this.log) return;
      if (this.log.status === 'active') this.log.status = 'left';
      this.persist();
      void this.flush(true);
    });
  }

  savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch { /* ignore */ } }
  setConsent(c: 'yes' | 'no') { this.prefs.consent = c; this.savePrefs(); if (c === 'yes') { this.dirty = true; void this.flush(false); } }
  sharing() { return this.prefs.consent === 'yes' && /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(this.url().trim()); }

  /** Call every frame (or a few times a second) with the live state. */
  observe(s: GameState) {
    if (s !== this.state) this.begin(s);
    const log = this.log!, seen = this.seen!;
    if (log.status === 'left') log.status = 'active'; // back from another tab
    const ev = (k: string, d?: string | number) => { log.events.push({ t: Math.round(s.time), k, d }); if (log.events.length > MAX_EVENTS) log.events.shift(); this.dirty = true; };
    if (s.era !== seen.era) { if (s.era > seen.era) { log.eraTimes.push(Math.round(s.time)); ev('era', s.era); } seen.era = s.era; void this.flush(false); }
    if (s.ops.breakdowns > seen.breakdowns) { ev('breakdowns', s.ops.breakdowns - seen.breakdowns); seen.breakdowns = s.ops.breakdowns; }
    if (s.econ.grants > seen.grants) { ev('grant', s.era); seen.grants = s.econ.grants; }
    if (s.market.shipped > seen.shipped) { ev('model', s.market.shipped); seen.shipped = s.market.shipped; }
    const objectives = Object.keys(s.done).length;
    if (objectives > seen.objectives) { for (const k of Object.keys(s.done).slice(seen.objectives)) ev('objective', k); seen.objectives = objectives; }
    const events = s.events.filter((e) => e.warn <= 0).map((e) => e.id).join(',');
    if (events !== seen.events) { if (events) ev('event', events); seen.events = events; }
    if (s.flags.campaignDone && !seen.done) { seen.done = true; log.status = 'finished'; ev('finish', Math.round(s.time / 60)); void this.flush(false); }
    if (s.time >= seen.sampleAt) {
      seen.sampleAt = s.time + SAMPLE_EVERY;
      const problems = problemCount(s);
      log.samples.push({ t: Math.round(s.time), era: s.era, credits: Math.round(s.econ.credits), rev: Math.round(s.market.revRate * 60), compute: Math.round(s.stats.computeRate), buildings: s.buildings.length, problems });
      if (log.samples.length > 240) log.samples.shift();
      this.dirty = true;
      this.persist();
    }
  }

  private begin(s: GameState) {
    this.state = s;
    this.log = { run: randomId(), game: this.game, startedAt: new Date().toISOString(), fromMin: Math.round(s.time / 60), seed: s.seed, mode: s.mode, difficulty: s.difficulty, status: 'active', events: [], samples: [], eraTimes: [] };
    this.seen = { era: s.era, breakdowns: s.ops.breakdowns, grants: s.econ.grants, shipped: s.market.shipped, done: s.flags.campaignDone, events: '', objectives: Object.keys(s.done).length, sampleAt: s.time };
    this.dirty = true;
  }

  /** Keep the last few run logs on this device (always, consent or not: nothing leaves). */
  private persist() {
    if (!this.log) return;
    try {
      const all: RunLog[] = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]');
      const i = all.findIndex((l) => l.run === this.log!.run);
      if (i >= 0) all[i] = this.log; else all.push(this.log);
      while (all.length > KEEP_LOGS) all.shift();
      localStorage.setItem(LOG_KEY, JSON.stringify(all));
    } catch { /* storage full or blocked */ }
  }

  /** The local run logs as a JSON file download. */
  exportLogs() {
    this.persist();
    let data = '[]';
    try { data = localStorage.getItem(LOG_KEY) ?? '[]'; } catch { /* ignore */ }
    const blob = new Blob([JSON.stringify({ player: this.prefs.player, logs: JSON.parse(data) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `silicon-dawn-runlog-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /** `withPlayer`: attach the random player id. Only telemetry (with consent) and a score the player submits do. */
  private async post(body: Record<string, unknown>, keepalive = false, withPlayer = true): Promise<any> {
    const url = this.url().trim();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ v: 1, ...(withPlayer ? { player: this.prefs.player } : {}), ...body }), redirect: 'follow', signal: ctl.signal, keepalive });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? 'request failed');
      this.lastError = '';
      return j;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Upload the current run summary (only with consent and a script URL). Errors are kept quietly: play goes on. */
  async flush(keepalive: boolean) {
    if (!this.sharing() || !this.log || !this.state) return;
    this.lastUpload = Date.now();
    this.dirty = false;
    const s = this.state, log = this.log;
    let summary = summarize(s, log);
    // keepalive bodies are capped at 64 KB by browsers: drop the long lists first
    if (keepalive && JSON.stringify(summary).length > 50000) summary = { ...summary, samples: summary.samples.slice(-20), events: summary.events.slice(-40) };
    try { await this.post({ op: 'telemetry', run: log.run, row: telemetryRow(s, log, this.game), summary }, keepalive); }
    catch (e) { this.lastError = String((e as Error).message ?? e); this.dirty = true; }
  }

  /** Can this device talk to the score sheet at all? (needs the script URL; scores do not need telemetry consent) */
  scoresReady() { return /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(this.url().trim()); }

  async submitScore(s: GameState, name: string): Promise<void> {
    const n = cleanName(name);
    if (!n) throw new Error('type a name first');
    this.prefs.name = n; this.savePrefs();
    if (!this.log) this.begin(s);
    this.rememberScore(this.log!.run);
    await this.post({ op: 'score', run: this.log!.run, name: n, mode: s.mode, difficulty: s.difficulty, seed: s.seed, minutes: Math.round(s.time / 60), grades: gradeLine(s), score: campaignScore(s) });
  }

  /** Read the score sheet. Sends no player id: "mine" is marked here from the runs this device submitted. */
  async scores(difficulty: string, mode = 'campaign'): Promise<ScoreRow[]> {
    const r = await this.post({ op: 'scores', mode, difficulty, limit: 20 }, false, false);
    const mine = this.submittedRuns();
    return ((r.scores ?? []) as ScoreRow[]).map((x) => ({ ...x, mine: mine.includes(String(x.run)) }));
  }

  private submittedRuns(): string[] {
    try { const v = JSON.parse(localStorage.getItem(SCORES_KEY) ?? '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
  }
  private rememberScore(run: string) {
    const all = this.submittedRuns().filter((r) => r !== run);
    all.push(run);
    try { localStorage.setItem(SCORES_KEY, JSON.stringify(all.slice(-50))); } catch { /* ignore */ }
  }
}

/** Buildings shown as a problem badge right now (exported for tests and the run log). */
export function problemCount(s: GameState): number {
  let n = 0;
  for (const b of s.buildings) if (BUILDING[b.type] && badgeFor(b)) n++;
  return n;
}
