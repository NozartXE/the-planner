// audio.js — tiny WebAudio synth: every sound is generated, no audio files.
// Sounds are short oscillator/noise envelopes. The module is defensive:
// if WebAudio is unavailable (headless capture) every call is a no-op.

export class AudioSynth {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      return true;
    } catch { return false; }
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }
  tone(freq, dur, type = 'square', vol = 0.2, slideTo = null, delay = 0) {
    if (this.muted || !this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  noise(dur, vol = 0.2, freq = 1200, delay = 0) {
    if (this.muted || !this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let s = 12345; // deterministic LCG noise, no Math.random needed
    for (let i = 0; i < len; i++) { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; data[i] = (s / 0x40000000 - 1) * (1 - i / len); }
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  }
  shot() { this.noise(0.09, 0.35, 900); this.tone(160, 0.07, 'square', 0.18, 60); }
  hit() { this.noise(0.05, 0.2, 2000); }
  pickup() { this.tone(660, 0.08, 'sine', 0.22); this.tone(990, 0.12, 'sine', 0.22, null, 0.07); }
  cash() { this.tone(880, 0.06, 'triangle', 0.2); this.tone(1320, 0.1, 'triangle', 0.18, null, 0.05); }
  alarmTick() { this.tone(1180, 0.06, 'square', 0.1); }
  uiClick() { this.tone(520, 0.05, 'sine', 0.15); }
  uiBack() { this.tone(340, 0.06, 'sine', 0.15); }
  sting(win) {
    if (win) { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.22, null, i * 0.11)); }
    else { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.2, null, i * 0.12)); }
  }
  crash(intensity = 1) { this.noise(0.25, 0.3 * intensity, 300); this.tone(90, 0.2, 'sawtooth', 0.2 * intensity, 40); }
  gadget() { this.tone(440, 0.08, 'sine', 0.2, 880); this.tone(880, 0.1, 'sine', 0.16, 1320, 0.08); }
  // Continuous engine hum tied to speed; call every frame with 0..1 throttle.
  engine(level) {
    if (this.muted || !this.ensure()) return;
    if (!this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineGain = this.ctx.createGain();
      this.engineOsc.type = 'sawtooth';
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start();
    }
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(55 + level * 130, t, 0.08);
    this.engineGain.gain.setTargetAtTime(level > 0.02 ? 0.05 + level * 0.05 : 0, t, 0.1);
  }
  // Wailing siren while police are close; level 0 silences it.
  siren(level) {
    if (this.muted || !this.ensure()) return;
    if (!this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenGain = this.ctx.createGain();
      this.sirenOsc.type = 'triangle';
      this.sirenGain.gain.value = 0;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.7;
      const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 140;
      lfo.connect(lfoGain); lfoGain.connect(this.sirenOsc.frequency);
      this.sirenOsc.frequency.value = 760;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start(); lfo.start();
    }
    this.sirenGain.gain.setTargetAtTime(level * 0.045, this.ctx.currentTime, 0.2);
  }
}
