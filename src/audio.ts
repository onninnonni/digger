// Procedural music + sound effects using the Web Audio API. No audio files.

type Osc = OscillatorType;

export class GameAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private leadDelay!: DelayNode;
  private noiseBuf!: AudioBuffer;
  muted = false;
  /** 0..1, drives tempo, density and brightness of the music. */
  intensity = 0;
  theme: 'dig' | 'china' | 'none' = 'dig';

  private step = 0;
  private nextTime = 0;
  private timer = 0;
  private melody: number[] = [];
  private melodyBar = -1;
  private seed = 1;

  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 1; this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.55; this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.leadDelay = ctx.createDelay(1); this.leadDelay.delayTime.value = 0.28;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const fbFilter = ctx.createBiquadFilter(); fbFilter.type = 'lowpass'; fbFilter.frequency.value = 2200;
    this.leadDelay.connect(fbFilter); fbFilter.connect(fb); fb.connect(this.leadDelay);
    const wet = ctx.createGain(); wet.gain.value = 0.35; this.leadDelay.connect(wet); wet.connect(this.musicBus);

    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 30);
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  // ---------- helpers ----------
  private tone(type: Osc, freq: number, t: number, dur: number, gain: number, opts: { attack?: number; release?: number; filter?: number; detune?: number; dest?: AudioNode; q?: number; slideTo?: number } = {}) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.005, rel = opts.release ?? dur * 0.5;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + a);
    g.gain.setValueAtTime(gain, t + Math.max(a, dur - rel)); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    let node: AudioNode = o;
    if (opts.filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.filter; f.Q.value = opts.q ?? 0.8; o.connect(f); node = f; }
    node.connect(g); g.connect(opts.dest ?? this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private noise(t: number, dur: number, gain: number, opts: { type?: BiquadFilterType; freq?: number; q?: number; dest?: AudioNode; attack?: number; slideTo?: number } = {}) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = opts.type ?? 'lowpass'; f.frequency.setValueAtTime(opts.freq ?? 1000, t); f.Q.value = opts.q ?? 0.7;
    if (opts.slideTo) f.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + (opts.attack ?? 0.005)); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f); f.connect(g); g.connect(opts.dest ?? this.sfxBus);
    src.start(t); src.stop(t + dur + 0.05);
  }

  private midi(m: number) { return 440 * Math.pow(2, (m - 69) / 12); }

  private rand() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }

  // ---------- music ----------
  private schedule() {
    const ctx = this.ctx!;
    if (ctx.state !== 'running') return;
    const tempo = this.theme === 'china' ? 108 : 136 + 40 * this.intensity;
    const stepDur = 60 / tempo / 4;
    while (this.nextTime < ctx.currentTime + 0.16) {
      if (this.theme !== 'none') this.playStep(this.step, this.nextTime, stepDur);
      this.step++;
      this.nextTime += stepDur;
    }
  }

  private playStep(s: number, t: number, sd: number) {
    const bar = Math.floor(s / 16), pos = s % 16;
    const I = this.intensity;
    const china = this.theme === 'china';
    const prog = china ? [48, 53, 55, 48] : [45, 41, 48, 43];
    const root = prog[Math.floor(bar / 2) % 4];
    const scale = china ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
    const mb = this.musicBus;

    // drums
    const kickPat = I > 0.55 ? [0, 6, 8, 14] : I > 0.2 ? [0, 8, 10] : [0, 8];
    if (!china && kickPat.includes(pos)) this.tone('sine', 150, t, 0.16, 0.9, { slideTo: 42, dest: mb, attack: 0.002, release: 0.1 });
    if (china && (pos === 0 || pos === 8)) this.tone('sine', 110, t, 0.5, 0.5, { slideTo: 70, dest: mb, attack: 0.004, release: 0.4 });
    if (!china && (pos === 4 || pos === 12 || (I > 0.4 && pos === 15))) this.noise(t, pos === 15 ? 0.08 : 0.16, pos === 15 ? 0.18 : 0.5, { type: 'bandpass', freq: 1800, q: 0.9, dest: mb });
    const hatEvery = I > 0.6 ? 1 : 2;
    if (pos % hatEvery === 0) this.noise(t, pos % 4 === 2 ? 0.07 : 0.035, (china ? 0.08 : 0.14) * (pos % 2 ? 0.6 : 1), { type: 'highpass', freq: 7000, dest: mb });

    // bass
    if (!china && pos % 2 === 0) {
      const pat = [0, 0, 12, 0, 7, 0, 12, 10];
      const n = root + pat[(pos / 2) | 0];
      this.tone('square', this.midi(n), t, sd * 1.8, 0.22, { filter: 420 + I * 900, dest: mb, attack: 0.004, release: sd * 0.6 });
    }
    if (china && pos % 4 === 0) this.tone('triangle', this.midi(root - 12), t, sd * 3.5, 0.3, { filter: 500, dest: mb, attack: 0.01, release: sd });

    // pad
    if (pos === 0 && bar % 2 === 0) {
      const dur = sd * 32;
      for (const [iv, det] of [[12, -6], [19, 6], [24, 0]] as const) {
        this.tone(china ? 'triangle' : 'sawtooth', this.midi(root + iv), t, dur, china ? 0.05 : 0.035 + I * 0.02, { filter: 500 + I * 500, detune: det, dest: mb, attack: 0.3, release: 0.8 });
      }
    }

    // lead melody (regenerated each bar from a seeded random walk)
    if (this.melodyBar !== bar) {
      this.melodyBar = bar;
      this.seed = (bar * 7919 + 17) >>> 0;
      const density = china ? 0.35 : 0.3 + I * 0.45;
      let idx = 2 + Math.floor(this.rand() * 4);
      this.melody = [];
      for (let i = 0; i < 16; i++) {
        const strong = i % 4 === 0;
        if (this.rand() < density * (strong ? 1.4 : 0.9)) {
          idx += Math.floor(this.rand() * 5) - 2;
          idx = Math.max(0, Math.min(9, idx));
          this.melody.push(idx);
        } else this.melody.push(-1);
      }
      if (bar % 4 === 3 && !china) this.melody[14] = -1;
    }
    const m = this.melody[pos];
    if (m >= 0) {
      const note = root + 24 + scale[m % 5] + 12 * Math.floor(m / 5);
      if (china) this.tone('triangle', this.midi(note), t, sd * 3, 0.14, { filter: 3000, dest: this.leadDelay, attack: 0.01, release: sd * 2 });
      else this.tone('square', this.midi(note), t, sd * 1.4, 0.075, { filter: 1200 + I * 2600, q: 2, dest: this.leadDelay, attack: 0.004, release: sd * 0.7 });
    }
  }

  // ---------- sfx ----------
  private now() { return this.ctx ? this.ctx.currentTime : 0; }
  private ok() { return !!this.ctx && this.ctx.state === 'running'; }

  dig(hardness: number) {
    if (!this.ok()) return;
    const t = this.now();
    this.noise(t, 0.07, 0.35, { freq: 500 + 400 / Math.max(0.5, hardness), slideTo: 120 });
    if (hardness > 2.5) this.tone('square', 90 + Math.random() * 30, t, 0.05, 0.12, { filter: 400 });
  }
  gem(value: number) {
    if (!this.ok()) return;
    const t = this.now();
    const base = value > 300 ? 880 : value > 100 ? 740 : 620;
    for (let i = 0; i < 3; i++) this.tone('sine', base * Math.pow(1.26, i), t + i * 0.055, 0.22, 0.25, { attack: 0.003 });
    this.tone('triangle', base * 2, t + 0.17, 0.4, 0.12, { attack: 0.01 });
  }
  jump() { if (!this.ok()) return; this.tone('square', 300, this.now(), 0.12, 0.12, { slideTo: 600, filter: 1500 }); }
  hurt() {
    if (!this.ok()) return; const t = this.now();
    this.tone('sawtooth', 320, t, 0.35, 0.35, { slideTo: 60, filter: 1200 });
    this.noise(t, 0.3, 0.35, { freq: 900, slideTo: 100 });
  }
  explosion() {
    if (!this.ok()) return; const t = this.now();
    this.noise(t, 0.9, 1.0, { freq: 1600, slideTo: 60, attack: 0.01 });
    this.tone('sine', 110, t, 0.6, 0.8, { slideTo: 30, attack: 0.005 });
  }
  lava() { if (!this.ok()) return; this.noise(this.now(), 0.5, 0.25, { freq: 2200, slideTo: 300, attack: 0.02 }); }
  rumble() { if (!this.ok()) return; this.noise(this.now(), 0.7, 0.4, { freq: 180, slideTo: 60, attack: 0.05 }); }
  horn() {
    if (!this.ok()) return; const t = this.now();
    for (const f of [220, 277, 330]) this.tone('sawtooth', f, t, 0.8, 0.14, { filter: 1800, attack: 0.03, release: 0.3 });
    for (const f of [220, 277, 330]) this.tone('sawtooth', f * 1.004, t + 1.0, 0.5, 0.12, { filter: 1800, attack: 0.03, release: 0.2 });
  }
  trainPass() { if (!this.ok()) return; this.noise(this.now(), 1.6, 0.5, { freq: 400, slideTo: 150, attack: 0.3 }); }
  levelUp() {
    if (!this.ok()) return; const t = this.now();
    [0, 4, 7, 12, 16].forEach((iv, i) => this.tone('square', this.midi(69 + iv), t + i * 0.08, 0.3, 0.16, { filter: 2500, attack: 0.005 }));
    this.tone('sawtooth', this.midi(57), t, 0.7, 0.15, { filter: 900, attack: 0.02 });
  }
  win() {
    if (!this.ok()) return; const t = this.now();
    [0, 4, 7, 12, 7, 12, 16, 19].forEach((iv, i) => this.tone('triangle', this.midi(72 + iv), t + i * 0.14, 0.5, 0.25, { attack: 0.01 }));
  }
  crumble() { if (!this.ok()) return; this.noise(this.now(), 0.25, 0.2, { freq: 700, slideTo: 150 }); }
  thud() { if (!this.ok()) return; const t = this.now(); this.noise(t, 0.18, 0.5, { freq: 300, slideTo: 80 }); this.tone('sine', 80, t, 0.2, 0.5, { slideTo: 35 }); }
}
