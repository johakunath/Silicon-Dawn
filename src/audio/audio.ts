// Procedural WebAudio: SFX + a layered ambient/music bed that grows with the base.

type Sfx = 'click' | 'hover' | 'place' | 'placeBig' | 'link' | 'unlink' | 'demolish' | 'error' | 'objective' | 'era' | 'research'
  | 'warn' | 'contract' | 'fail' | 'break' | 'repair' | 'ignite' | 'open' | 'close' | 'select' | 'mode';

const SCALES: Record<number, number[]> = {
  1: [0, 3, 5, 7, 10], // minor pentatonic, sparse
  2: [0, 2, 4, 7, 9], // major pentatonic, bright
  3: [0, 2, 3, 7, 8], // darker, industrial
  4: [0, 2, 3, 5, 7, 10], // dorian-ish drive
  5: [0, 4, 7, 11, 14], // maj7 shimmer
};
const ROOTS: Record<number, number> = { 1: 45, 2: 48, 3: 43, 4: 46, 5: 50 };
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export interface AmbientParams {
  era: number;
  buildings: number;
  power: number; // total demand
  compute: number; // compute/s
  night: number;
  halls: number;
  training: number; // training rate
  event: boolean;
  finale: number; // 0..1
  speed: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  private revSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private layers: Record<string, { gain: GainNode; nodes: AudioNode[]; filter?: BiquadFilterNode; oscs?: OscillatorNode[] }> = {};
  private seqT = 0;
  private seqStep = 0;
  private lastSfx: Record<string, number> = {};
  volume = 0.7;
  muted = false;
  musicVol = 0.8;
  private era = 1;

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.55 * this.musicVol; this.ambBus.connect(this.master);
    // reverb
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.6;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.reverb.buffer = ir;
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0.35;
    this.revSend.connect(this.reverb).connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.buildAmbient();
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05); }
  setMuted(m: boolean) { this.muted = m; this.setVolume(this.volume); }
  setMusic(v: number) { this.musicVol = v; if (this.ctx) this.ambBus.gain.setTargetAtTime(0.55 * v, this.ctx.currentTime, 0.1); }

  private noise(): AudioBufferSourceNode {
    const n = this.ctx!.createBufferSource();
    n.buffer = this.noiseBuf; n.loop = true;
    return n;
  }

  private buildAmbient() {
    const ctx = this.ctx!;
    const mk = (name: string) => { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.ambBus); this.layers[name] = { gain: g, nodes: [] }; return g; };
    // wind
    {
      const g = mk('wind');
      const n = this.noise();
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.7;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
      const lg = ctx.createGain(); lg.gain.value = 300; lfo.connect(lg).connect(f.frequency);
      n.connect(f).connect(g); n.start(); lfo.start();
      this.layers.wind.filter = f;
    }
    // pad (3 detuned saws through lowpass)
    {
      const g = mk('pad');
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 0.5;
      f.connect(g); f.connect(this.revSend);
      const oscs: OscillatorNode[] = [];
      for (const det of [-7, 0, 7, 12]) {
        const o = ctx.createOscillator(); o.type = det === 12 ? 'sine' : 'sawtooth'; o.detune.value = det;
        const og = ctx.createGain(); og.gain.value = det === 12 ? 0.25 : 0.12;
        o.connect(og).connect(f); o.start(); oscs.push(o);
      }
      this.layers.pad.filter = f; this.layers.pad.oscs = oscs;
    }
    // hum (mains + harmonics)
    {
      const g = mk('hum');
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
      for (const fr of [50, 100, 150]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; const og = ctx.createGain(); og.gain.value = fr === 50 ? 0.5 : 0.18; o.connect(og).connect(f); o.start(); }
      f.connect(g);
    }
    // server fans (filtered noise)
    {
      const g = mk('fans');
      const n = this.noise();
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.4;
      n.connect(f).connect(g); n.start();
    }
    // choir (formant saws) for era 5
    {
      const g = mk('choir');
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 700; f1.Q.value = 6;
      const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 8;
      const oscs: OscillatorNode[] = [];
      for (const det of [-5, 4, 700, 1205]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det; o.connect(f1); o.connect(f2); o.start(); oscs.push(o); }
      f1.connect(g); f2.connect(g); g.connect(this.revSend);
      this.layers.choir.oscs = oscs;
    }
    // crickets at night (era 1-2)
    {
      const g = mk('crickets');
      const o = ctx.createOscillator(); o.frequency.value = 4600;
      const am = ctx.createOscillator(); am.frequency.value = 28;
      const amg = ctx.createGain(); amg.gain.value = 0.5;
      const og = ctx.createGain(); og.gain.value = 0.5;
      am.connect(amg).connect(og.gain);
      const slow = ctx.createOscillator(); slow.frequency.value = 0.6; const sg = ctx.createGain(); sg.gain.value = 0.5; slow.connect(sg).connect(og.gain);
      o.connect(og).connect(g); o.start(); am.start(); slow.start();
    }
  }

  private setL(name: string, v: number, tc = 1.2) {
    const l = this.layers[name];
    if (l && this.ctx) l.gain.gain.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  /** call ~every frame */
  update(dt: number, p: AmbientParams) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (p.era !== this.era) {
      this.era = p.era;
      const root = ROOTS[p.era] ?? 45;
      const pad = this.layers.pad.oscs!;
      const chord = [0, 7, 12, 3 + (p.era === 2 || p.era === 5 ? 1 : 0)];
      pad.forEach((o, i) => o.frequency.setTargetAtTime(mtof(root + chord[i % chord.length] - 12), ctx.currentTime, 2));
      this.layers.choir.oscs!.forEach((o, i) => o.frequency.setTargetAtTime(mtof(root + [0, 7, 12, 16][i]), ctx.currentTime, 2));
    }
    const size = Math.min(1, p.buildings / 120);
    this.setL('wind', (p.era === 1 ? 0.16 : 0.09) * (1 - size * 0.4) + (p.event ? 0.05 : 0));
    this.setL('pad', 0.1 + size * 0.16 + p.finale * 0.15);
    this.setL('hum', Math.min(0.1, p.power / 3000) + (p.power > 10 ? 0.012 : 0));
    this.setL('fans', Math.min(0.06, p.compute / 3000));
    this.setL('choir', p.era >= 5 ? 0.025 + p.finale * 0.1 : 0, 3);
    this.setL('crickets', p.era <= 2 && p.night > 0.6 ? 0.012 * (1 - size) : 0, 2);
    const pf = this.layers.pad.filter!;
    pf.frequency.setTargetAtTime(380 + size * 900 + (1 - p.night) * 300 + p.finale * 1800, ctx.currentTime, 1.5);
    // sequencer: arpeggio grows with compute (era 2+), kick with halls (era 3+)
    const bpm = 76 + p.era * 8;
    const stepDur = 60 / bpm / 2;
    this.seqT += dt;
    while (this.seqT >= stepDur) {
      this.seqT -= stepDur;
      this.seqStep++;
      const scale = SCALES[p.era] ?? SCALES[1];
      const root = ROOTS[p.era] ?? 45;
      const arpVol = p.era >= 2 ? Math.min(0.09, 0.02 + p.compute / 1500) : (this.seqStep % 8 === 0 ? 0.05 : 0);
      if (arpVol > 0 && (p.era >= 2 || Math.random() < 0.5)) {
        const density = p.era === 1 ? 0.25 : Math.min(0.95, 0.3 + p.compute / 400);
        if (Math.random() < density) {
          const n = scale[(this.seqStep * 3 + (this.seqStep >> 3)) % scale.length] + 12 * (1 + ((this.seqStep >> 2) % 2));
          this.pluck(mtof(root + n + 12), arpVol, p.era >= 4 ? 'square' : 'triangle', 0.35);
        }
      }
      if (p.era >= 3 && p.halls > 0 && this.seqStep % 4 === 0) this.kick(Math.min(0.22, 0.08 + p.halls * 0.02));
      if (p.era >= 4 && p.training > 20 && this.seqStep % 2 === 1) this.hat(Math.min(0.05, p.training / 4000));
      if (p.era <= 2 && this.seqStep % 32 === 0 && p.buildings > 3) this.pluck(mtof(root + 24 + scale[this.seqStep % scale.length]), 0.06, 'sine', 1.8);
    }
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private pluck(freq: number, vol: number, type: OscillatorType, dec: number) {
    const ctx = this.ctx!; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq * 6, t); f.frequency.exponentialRampToValueAtTime(freq * 1.2, t + dec);
    const g = ctx.createGain(); this.env(g, t, 0.005, vol, dec);
    o.connect(f).connect(g); g.connect(this.ambBus); g.connect(this.revSend);
    o.start(t); o.stop(t + dec + 0.05);
  }
  private kick(vol: number) {
    const ctx = this.ctx!; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = ctx.createGain(); this.env(g, t, 0.004, vol, 0.28);
    o.connect(g).connect(this.ambBus); o.start(t); o.stop(t + 0.35);
  }
  private hat(vol: number) {
    const ctx = this.ctx!; const t = ctx.currentTime;
    const n = this.noise(); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain(); this.env(g, t, 0.002, vol, 0.05);
    n.connect(f).connect(g).connect(this.ambBus); n.start(t); n.stop(t + 0.08);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slideTo?: number, delay = 0, rev = 0.2) {
    const ctx = this.ctx!; const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); this.env(g, t, 0.006, vol, dur);
    o.connect(g); g.connect(this.sfxBus);
    if (rev > 0) { const r = ctx.createGain(); r.gain.value = rev; g.connect(r).connect(this.revSend); }
    o.start(t); o.stop(t + dur + 0.05);
  }
  private burst(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', delay = 0, q = 1) {
    const ctx = this.ctx!; const t = ctx.currentTime + delay;
    const n = this.noise(); const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); this.env(g, t, 0.004, vol, dur);
    n.connect(f).connect(g).connect(this.sfxBus); n.start(t); n.stop(t + dur + 0.05);
  }

  /** variant: building category influences pitch */
  play(name: Sfx, variant = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.lastSfx[name] ?? 0) < (name === 'hover' ? 45 : 30)) return;
    this.lastSfx[name] = now;
    const v = variant;
    switch (name) {
      case 'click': this.tone(1400, 0.05, 0.12, 'triangle', 900, 0, 0.05); break;
      case 'hover': this.tone(2200, 0.025, 0.03, 'sine', undefined, 0, 0); break;
      case 'select': this.tone(880, 0.07, 0.1, 'triangle', 1320, 0, 0.1); break;
      case 'open': this.tone(520, 0.12, 0.08, 'triangle', 980); break;
      case 'close': this.tone(900, 0.1, 0.06, 'triangle', 480); break;
      case 'place': {
        const base = 160 + v * 40;
        this.tone(base, 0.22, 0.32, 'sine', base * 0.45, 0, 0.15);
        this.burst(0.09, 0.22, 2400, 'bandpass', 0, 0.8);
        this.tone(base * 4, 0.12, 0.06, 'triangle', base * 6, 0.05, 0.3);
        break;
      }
      case 'placeBig':
        this.tone(90, 0.5, 0.45, 'sine', 40, 0, 0.3);
        this.burst(0.35, 0.3, 600, 'lowpass');
        this.tone(440, 0.4, 0.07, 'triangle', 660, 0.12, 0.5);
        break;
      case 'link': this.tone(500, 0.12, 0.1, 'sawtooth', 1600, 0, 0.2); this.tone(2000, 0.05, 0.05, 'sine', undefined, 0.1); break;
      case 'unlink': this.tone(1200, 0.12, 0.08, 'sawtooth', 300); break;
      case 'demolish': this.burst(0.4, 0.4, 900, 'lowpass'); this.tone(120, 0.35, 0.25, 'square', 50); break;
      case 'error': this.tone(180, 0.12, 0.16, 'square', 150); this.tone(140, 0.16, 0.14, 'square', 110, 0.1); break;
      case 'objective': [0, 4, 7, 12].forEach((n, i) => this.tone(mtof(72 + n), 0.5, 0.12, 'triangle', undefined, i * 0.07, 0.5)); break;
      case 'research': [0, 7, 12, 19, 24].forEach((n, i) => this.tone(mtof(79 + n), 0.3, 0.07, 'sine', undefined, i * 0.045, 0.6)); break;
      case 'era': {
        const r = 48 + (v % 5) * 2;
        [0, 7, 12, 16, 19, 24].forEach((n, i) => this.tone(mtof(r + n), 2.2, 0.12, i < 3 ? 'sawtooth' : 'triangle', undefined, i * 0.12, 0.8));
        this.tone(mtof(r - 12), 3, 0.25, 'sine', undefined, 0, 0.5);
        this.burst(1.6, 0.12, 3000, 'bandpass', 0.1, 0.5);
        break;
      }
      case 'warn': for (let i = 0; i < 2; i++) { this.tone(740, 0.18, 0.13, 'square', 740, i * 0.3, 0.1); this.tone(554, 0.18, 0.13, 'square', 554, i * 0.3 + 0.15, 0.1); } break;
      case 'contract': [0, 5, 9].forEach((n, i) => this.tone(mtof(76 + n), 0.3, 0.1, 'triangle', undefined, i * 0.08, 0.4)); break;
      case 'fail': [7, 3, 0].forEach((n, i) => this.tone(mtof(60 + n), 0.35, 0.12, 'sawtooth', undefined, i * 0.12, 0.3)); break;
      case 'break': this.burst(0.25, 0.35, 3000, 'highpass'); this.tone(300, 0.2, 0.15, 'square', 80); break;
      case 'repair': this.tone(660, 0.12, 0.08, 'triangle', 990); this.tone(990, 0.15, 0.07, 'triangle', 1320, 0.08); break;
      case 'mode': this.tone(600 + v * 200, 0.1, 0.1, 'square', 900 + v * 200, 0, 0.1); break;
      case 'ignite': {
        this.tone(55, 6, 0.5, 'sawtooth', 220, 0, 0.6);
        this.tone(110, 6, 0.3, 'sine', 880, 0.5, 0.8);
        this.burst(5, 0.2, 400, 'lowpass', 0, 0.5);
        [0, 4, 7, 11, 14, 19, 24].forEach((n, i) => this.tone(mtof(62 + n), 4, 0.08, 'triangle', undefined, 1 + i * 0.25, 1));
        break;
      }
    }
  }
}

export const audio = new AudioEngine();
