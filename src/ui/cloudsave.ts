import type { Game } from '../game/game';

/**
 * Cross-device cloud save through the owner's Google Sheet + Apps Script web app
 * (script and setup steps: tools/apps-script/). The save is an opaque string from
 * Game.saveJson(); this module never looks inside except for a small summary (era, minutes, seed).
 * Offline play is unaffected: local saves work exactly as before, the cloud is an extra copy.
 */

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
const KEY = 'sd_cloud_v1';
const AUTO_EVERY_MS = 5 * 60 * 1000;
const KEEPALIVE_LIMIT = 60000; // browsers cap keepalive request bodies at 64 KB

export interface CloudConfig { url: string; code: string; auto: boolean }
/** time = exact simulated seconds (guard); min = rounded, display only; runId = random id of one campaign across devices */
export interface CloudMeta { era: number; min: number; time: number; seed: number; mode: string; difficulty: string; device: string; runId?: string }
const RUN_KEY = 'sd_cloud_autosave_run_v1';
/** which cloud run the autosave in local storage belongs to (sig = fingerprint of that exact autosave) */
export interface AutosaveTag { runId: string; sig: string }
export interface CloudInfo { found: boolean; savedAt?: string; meta?: Partial<CloudMeta> }

/** 12 random symbols as XXXX-XXXX-XXXX (60 bits). */
export function codeFromBytes(bytes: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += CODE_ALPHABET[bytes[i] & 31];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export function newCode(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return codeFromBytes(b);
}

/** Accepts typed input like "k7qp m2xd 9fra" and returns the canonical code, or null. */
export function normalizeCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 12) return null;
  for (const ch of raw) if (!CODE_ALPHABET.includes(ch)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function validUrl(url: string): boolean {
  return /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(url.trim());
}

/** Small summary from a save string, shown before loading. Never throws. */
export function summarize(json: string, device: string): CloudMeta {
  try {
    const d = JSON.parse(json);
    const time = Number(d.time) || 0;
    return { era: Number(d.era) | 0, min: Math.round(time / 60), time, seed: Number(d.seed) || 0, mode: String(d.mode ?? 'campaign'), difficulty: String(d.difficulty ?? 'standard'), device };
  } catch { return { era: 0, min: 0, time: 0, seed: 0, mode: '?', difficulty: '?', device }; }
}

/**
 * Auto upload must never clobber another campaign or a further-along state of the same one:
 * only an empty cloud, or the same run (same run id; seed, mode and difficulty as a cross-check)
 * whose exact simulated time is not ahead of ours. Everything else needs a manual, confirmed upload.
 */
export function autoUploadAllowed(local: CloudMeta, cloud: CloudInfo | null): boolean {
  if (!cloud || !cloud.found || !cloud.meta) return true;
  const m = cloud.meta;
  if (!m.runId || m.runId !== local.runId) return false;
  if (m.seed !== local.seed || m.mode !== local.mode || m.difficulty !== local.difficulty) return false;
  return typeof m.time === 'number' && m.time <= local.time;
}

/**
 * Which cloud run a loaded game continues. Only a game loaded from the very autosave this device wrote
 * while that game was bound to a run keeps the run (Continue after a reload). New games, local slots and
 * imports start unbound: their first upload needs a manual, confirmed replace if the cloud holds a game.
 */
export function runFromTag(tag: AutosaveTag | null, loadedJson: string): string | undefined {
  return tag && tag.sig === saveSig(loadedJson) ? tag.runId : undefined;
}

export function newRunId(): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Content fingerprint of a save, ignoring the save timestamp: changes on any build, link or tick, also while paused. */
export function saveSig(json: string): string {
  return json.replace(/"savedAt":"[^"]*"/, '');
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** gzip + base64 when the browser supports it (saves are mostly repetitive JSON, roughly 10× smaller). */
export async function encodeSave(json: string): Promise<{ enc: 'gz64' | 'raw'; data: string }> {
  if (typeof CompressionStream === 'undefined') return { enc: 'raw', data: json };
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  return { enc: 'gz64', data: b64(new Uint8Array(await new Response(stream).arrayBuffer())) };
}

export async function decodeSave(enc: string, data: string): Promise<string> {
  if (enc !== 'gz64') return data;
  const stream = new Blob([unb64(data) as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export class CloudSave {
  cfg: CloudConfig = (() => {
    const def: CloudConfig = { url: '', code: '', auto: true };
    try { return { ...def, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return def; }
  })();
  busy = false;
  last: CloudInfo | null = null;
  lastError = '';
  private lastAuto = Date.now();
  private lastSig = '';

  constructor(private g: Game) {
    // auto upload: every 5 minutes of play, and when the tab is hidden (app switch on a tablet)
    window.setInterval(() => { if (Date.now() - this.lastAuto > AUTO_EVERY_MS) void this.autoUpload(false); }, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void this.autoUpload(true); });
  }

  ready() { return validUrl(this.cfg.url) && !!normalizeCode(this.cfg.code); }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.cfg)); } catch { /* ignore */ } }
  device() { return document.body.classList.contains('touch') ? 'Tablet' : 'Desktop'; }

  private async call(body: Record<string, unknown>, keepalive = false): Promise<any> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    try {
      // text/plain keeps this a "simple" request: no CORS preflight, which Apps Script cannot answer
      const res = await fetch(this.cfg.url.trim(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ v: 1, code: this.cfg.code, slot: 'main', ...body }), redirect: 'follow', signal: ctl.signal, keepalive });
      if (!res.ok) throw new Error(`server answered ${res.status}`);
      const out = await res.json();
      if (!out.ok) throw new Error(out.error ?? 'server error');
      return out;
    } catch (e) {
      const msg = (e as Error).name === 'AbortError' ? 'no answer (offline?)' : (e as Error).message;
      throw new Error(msg.includes('Failed to fetch') ? 'cannot reach the script (offline, or the web app is not shared with "Anyone")' : msg);
    } finally { clearTimeout(timer); }
  }

  async ping() { return this.call({ op: 'ping' }); }

  async info(): Promise<CloudInfo> {
    const r = await this.call({ op: 'info' });
    this.last = { found: !!r.found, savedAt: r.savedAt, meta: r.meta };
    return this.last;
  }

  /** ifSavedAt: replace only if the cloud still holds this save ('' = only if empty); omit to overwrite */
  /** json: the exact snapshot that passed a guard (auto upload); default = the game right now */
  /** state + runId: the game the snapshot came from and the run it belongs to (default: this game's run, or a new one) */
  async upload(keepalive = false, ifSavedAt?: string, json = this.g.saveJson(), state: object = this.g.s, runId?: string): Promise<CloudInfo> {
    const meta: CloudMeta = { ...summarize(json, this.device()) };
    meta.runId = runId ?? this.runFor(state, meta) ?? newRunId();
    const { enc, data } = await encodeSave(json);
    if (keepalive && data.length > KEEPALIVE_LIMIT) throw new Error('too large for a background upload');
    const r = await this.call({ op: 'save', enc, data, meta, ...(ifSavedAt !== undefined ? { ifSavedAt } : {}) }, keepalive);
    this.last = { found: true, savedAt: r.savedAt, meta };
    this.lastAuto = Date.now();
    this.lastSig = saveSig(json);
    this.bind(state, meta);
    return this.last;
  }

  private runs = new WeakMap<object, string>();
  /** the cloud run a game state belongs to, if known */
  runFor(state: object, _local?: CloudMeta): string | undefined { return this.runs.get(state); }
  /** this game state is (now) that cloud run */
  bind(state: object, meta: Partial<CloudMeta>) { if (meta.runId) this.runs.set(state, meta.runId); }
  /** hook from Game.autosave: tag the autosave with the run of the game it holds (or clear the tag) */
  onAutosaved(state: object, json: string) {
    const r = this.runs.get(state);
    try {
      if (r) localStorage.setItem(RUN_KEY, JSON.stringify({ runId: r, sig: saveSig(json) } satisfies AutosaveTag));
      else localStorage.removeItem(RUN_KEY);
    } catch { /* */ }
  }
  /** hook from Game.loadJson: a game loaded from our own tagged autosave keeps its run */
  onLoaded(state: object, json: string) {
    let tag: AutosaveTag | null = null;
    try { tag = JSON.parse(localStorage.getItem(RUN_KEY) ?? 'null'); } catch { /* */ }
    const r = runFromTag(tag, json);
    if (r) this.runs.set(state, r);
  }

  /** the cloud save as a JSON string (does not load it) */
  async download(): Promise<{ json: string; info: CloudInfo }> {
    const r = await this.call({ op: 'load' });
    if (!r.found) throw new Error('no cloud save for this sync code yet');
    const json = await decodeSave(r.enc, r.data);
    this.last = { found: true, savedAt: r.savedAt, meta: r.meta };
    return { json, info: this.last };
  }

  private async autoUpload(leaving: boolean) {
    if (!this.cfg.auto || !this.ready() || this.busy || !this.g.started) return;
    const json = this.g.saveJson(), state = this.g.s;
    if (saveSig(json) === this.lastSig) return; // nothing changed since the last upload
    this.busy = true;
    try {
      const local = summarize(json, this.device());
      local.runId = this.runFor(state, local);
      // when leaving there is no time for a check round-trip; rely on the last known cloud state
      if (leaving && !this.last) return;
      const cloud = leaving ? this.last : await this.info();
      if (!autoUploadAllowed(local, cloud)) { this.lastAuto = Date.now(); return; }
      // the server re-checks atomically that the cloud still holds what we saw (another device may have uploaded since)
      // upload the same snapshot the guard checked: the player may load or start another game while info() is pending
      await this.upload(leaving, cloud?.found ? cloud.savedAt ?? '' : '', json, state, local.runId ?? newRunId());
      this.lastError = '';
    } catch (e) {
      this.lastError = (e as Error).message;
      this.lastAuto = Date.now();
    } finally { this.busy = false; }
  }
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function describeCloud(i: CloudInfo | null): string {
  if (!i) return 'not checked yet';
  if (!i.found) return 'empty: nothing uploaded with this sync code';
  const m = i.meta ?? {};
  const when = i.savedAt ? new Date(i.savedAt).toLocaleString() : '?';
  return `Era ${Number(m.era) | 0} · ${Number(m.min) | 0} min · ${m.mode === 'sandbox' ? 'sandbox · ' : ''}${when}${m.device ? ' · ' + esc(String(m.device)) : ''}`;
}

/** Cloud section for the Save / Load window. */
export function cloudRows(c: CloudSave, setup: boolean): string {
  const st = 'flex:1;font-size:15px;color:#93a4c4';
  if (!c.ready() || setup) {
    return `<div class="setrow" style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px"><label>☁ Cloud save</label><span style="${st}">Play on desktop and tablet with one save. Needs your own Google Sheet: steps in <b>tools/apps-script/README.md</b>.</span></div>
      <div class="setrow"><label>Script URL</label><input id="cl-url" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(c.cfg.url)}" style="flex:1;font-size:15px;padding:8px"></div>
      <div class="setrow"><label>Sync code</label><input id="cl-code" value="${esc(c.cfg.code || newCode())}" style="width:230px;font:600 20px monospace;padding:6px;letter-spacing:.08em"><span style="${st}">Use the same code on every device. Keep it private: it is the key to your save.</span></div>
      <div class="setrow"><label></label><button id="cl-connect" class="primary">CONNECT</button>${c.ready() ? '<button id="cl-cancel">BACK</button>' : ''}<span id="cl-msg" style="${st}"></span></div>`;
  }
  return `<div class="setrow" style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px"><label>☁ Cloud</label><span id="cl-info" style="${st}">${c.busy ? 'working…' : describeCloud(c.last)}</span></div>
    <div class="setrow"><label></label><button id="cl-up">UPLOAD NOW</button><button id="cl-down">LOAD FROM CLOUD</button></div>
    <div class="setrow"><label>Sync code</label><span style="font:600 20px monospace;letter-spacing:.08em;color:#6fe9ff">${esc(c.cfg.code)}</span><button id="cl-setup">CHANGE</button></div>
    <div class="setrow"><label>Auto upload</label><button id="cl-auto" class="${c.cfg.auto ? 'on' : ''}">${c.cfg.auto ? 'ON' : 'OFF'}</button><span style="${st}">Every 5 minutes and when you leave the game. Never overwrites a further-along run from another device.${c.lastError ? ` <span style="color:#ff5a5a">Last error: ${esc(c.lastError)}</span>` : ''}</span></div>`;
}

export function bindCloud(root: HTMLElement, g: Game, c: CloudSave, reopen: (setup?: boolean) => void, toast: (t: string, k: 'info' | 'good' | 'warn' | 'bad') => void, close: () => void) {
  const q = (id: string) => root.querySelector(id) as HTMLInputElement | null;
  const info = q('#cl-info');
  const run = async (label: string, fn: () => Promise<void>) => {
    if (c.busy) return;
    c.busy = true;
    if (info) info.textContent = label;
    try { await fn(); c.lastError = ''; } catch (e) { c.lastError = (e as Error).message; toast('Cloud: ' + c.lastError, 'bad'); } finally { c.busy = false; }
  };
  q('#cl-connect')?.addEventListener('click', () => {
    const url = q('#cl-url')!.value.trim(), code = normalizeCode(q('#cl-code')!.value);
    const msg = q('#cl-msg')!;
    if (!validUrl(url)) { msg.textContent = 'The URL must start with https://script.google.com/'; return; }
    if (!code) { msg.textContent = 'A sync code has 12 letters and digits, like K7QP-M2XD-9FRA.'; return; }
    c.cfg.url = url; c.cfg.code = code; c.last = null;
    msg.textContent = 'Connecting…';
    void (async () => {
      try { await c.ping(); c.save(); await c.info(); toast('Cloud save connected', 'good'); reopen(false); }
      catch (e) { msg.textContent = 'Could not connect: ' + (e as Error).message; }
    })();
  });
  q('#cl-cancel')?.addEventListener('click', () => reopen(false));
  q('#cl-setup')?.addEventListener('click', () => reopen(true));
  q('#cl-auto')?.addEventListener('click', () => { c.cfg.auto = !c.cfg.auto; c.save(); reopen(false); });
  q('#cl-up')?.addEventListener('click', () => void run('Uploading…', async () => {
    if (!g.started) throw new Error('start or load a game first');
    const cloud = await c.info();
    const json = g.saveJson(), state = g.s;
    const local = summarize(json, c.device());
    local.runId = c.runFor(state, local);
    const same = autoUploadAllowed(local, cloud);
    if (!same && !confirm(`The cloud holds a different or further-along game (${describeCloud(cloud).replace(/&#\d+;/g, '')}). Replace it with this one?`)) return;
    // replacing a different campaign starts a new run id, so the other device's game is never treated as a continuation
    await c.upload(false, undefined, json, state, same ? local.runId ?? newRunId() : newRunId());
    toast('Uploaded to the cloud', 'good');
  }).then(() => reopen(false)));
  q('#cl-down')?.addEventListener('click', () => {
    let loaded = false;
    void run('Downloading…', async () => {
      const { json, info: ci } = await c.download();
      if (g.started && !confirm(`Load the cloud game (${describeCloud(ci).replace(/&#\d+;/g, '')})? Your current game is autosaved first.`)) return;
      g.autosave();
      if (g.loadJson(json)) { loaded = true; c.bind(g.s, { ...summarize(json, c.device()), runId: ci.meta?.runId }); close(); }
    }).then(() => { if (!loaded) reopen(false); });
  });
  // refresh the status line once per opening
  if (info && c.ready() && !c.busy && c.last === null) void run('Checking…', async () => { await c.info(); }).then(() => { if (info.isConnected) info.textContent = describeCloud(c.last); });
}
