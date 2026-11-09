// Lightweight synthesized audio with Web Audio. Fails silently.
type Settings = { audio: boolean; sfx: number; music: number };

class Audio {
  ctx: AudioContext | null = null;
  sfxGain: GainNode | null = null;
  musicGain: GainNode | null = null;
  settings: Settings = { audio: true, sfx: 0.7, music: 0.4 };
  musicNodes: { stop: () => void } | null = null;
  wantMusic = false;
  lastSmall = 0;

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.sfxGain = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();
        this.sfxGain.connect(this.ctx.destination);
        this.musicGain.connect(this.ctx.destination);
        this.apply();
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      if (this.wantMusic && !this.musicNodes) this.startMusic();
    } catch { /* audio unavailable */ }
  }

  set(s: Settings) { this.settings = s; this.apply(); }
  apply() {
    if (!this.ctx || !this.sfxGain || !this.musicGain) return;
    const on = this.settings.audio ? 1 : 0;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(on * this.settings.sfx * 0.5, t, 0.02);
    this.musicGain.gain.setTargetAtTime(on * this.settings.music * 0.18, t, 0.3);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
    const c = this.ctx; if (!c || !this.sfxGain || !this.settings.audio) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.05);
  }
  private noise(dur: number, vol: number, from: number, to: number) {
    const c = this.ctx; if (!c || !this.sfxGain || !this.settings.audio) return;
    const t = c.currentTime;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain); src.start(t);
  }

  click() { this.tone(660, 0.07, "triangle", 0.25, 880); }
  absorbSmall() {
    const now = performance.now(); if (now - this.lastSmall < 45) return; this.lastSmall = now;
    const f = 520 + Math.random() * 380; this.tone(f, 0.09, "sine", 0.18, f * 1.8);
  }
  absorbPlanet() { this.noise(0.6, 0.35, 1800, 120); this.tone(180, 0.5, "sine", 0.35, 60); this.tone(420, 0.25, "triangle", 0.12, 900, 0.05); }
  absorbStar() { this.noise(1.0, 0.4, 3000, 100); [261, 329, 392, 523].forEach((f, i) => this.tone(f, 0.9, "sine", 0.14, undefined, i * 0.04)); this.tone(90, 0.9, "sawtooth", 0.08, 40); }
  milestone() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.18, undefined, i * 0.07)); }
  complete() { [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.6, "sine", 0.2, undefined, i * 0.11)); }
  gem() { this.tone(1200, 0.12, "sine", 0.18, 1800); this.tone(1800, 0.12, "sine", 0.1, 2400, 0.06); }
  purchase() { this.tone(440, 0.12, "square", 0.08, 660); this.tone(880, 0.25, "triangle", 0.18, 1320, 0.08); }
  error() { this.tone(200, 0.15, "square", 0.08, 140); }
  strikeCharge() { this.tone(140, 0.55, "sawtooth", 0.12, 620); this.tone(70, 0.55, "sine", 0.2, 180); }
  strikeHit() { this.noise(0.8, 0.45, 2400, 80); this.tone(220, 0.7, "sine", 0.4, 45); this.tone(660, 0.3, "triangle", 0.16, 1200, 0.03); }
  strikeMiss() { this.tone(420, 0.35, "triangle", 0.14, 130); }

  music(on: boolean) { this.wantMusic = on; if (on) this.startMusic(); else this.stopMusic(); }
  private startMusic() {
    const c = this.ctx; if (!c || !this.musicGain || this.musicNodes) return;
    const filter = c.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 600; filter.connect(this.musicGain);
    const lfo = c.createOscillator(); const lfoG = c.createGain(); lfo.frequency.value = 0.05; lfoG.gain.value = 300; lfo.connect(lfoG); lfoG.connect(filter.frequency); lfo.start();
    const oscs = [55, 82.4, 110, 164.8].map((f, i) => {
      const o = c.createOscillator(); o.type = i % 2 ? "triangle" : "sawtooth"; o.frequency.value = f; o.detune.value = (i - 1.5) * 6;
      const g = c.createGain(); g.gain.value = 0.25; o.connect(g); g.connect(filter); o.start(); return o;
    });
    this.musicNodes = { stop: () => { [...oscs, lfo].forEach((o) => { try { o.stop(); } catch { /* */ } }); filter.disconnect(); } };
  }
  private stopMusic() { this.musicNodes?.stop(); this.musicNodes = null; }
}

export const sfx = new Audio();
