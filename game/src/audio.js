// audio.js — a tiny WebAudio synth for effects. Created lazily on the first user gesture; every call is guarded.
let ctx = null;
let master = null;
function ensure() {
  if (ctx) return ctx;
  try {
    const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
  return ctx;
}
function blip(freqA, freqB, dur, type, vol) {
  const c = ensure();
  if (!c || !master) return;
  try {
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freqA, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqB), t + dur);
    g.gain.setValueAtTime(vol || 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.02);
  } catch (e) {}
}
export const sfx = {
  unlock() { ensure(); },
  shoot() { blip(720, 140, 0.09, 'square', 0.5); },
  crash() { blip(160, 50, 0.22, 'sawtooth', 0.8); },
  pickup() { blip(520, 880, 0.14, 'sine', 0.7); },
  deliver() { blip(440, 660, 0.12, 'sine', 0.6); setTimeout(() => blip(660, 990, 0.16, 'sine', 0.6), 90); },
  jingle() { blip(523, 523, 0.1, 'triangle', 0.6); setTimeout(() => blip(784, 784, 0.14, 'triangle', 0.6), 100); },
  sting() { blip(220, 110, 0.4, 'sawtooth', 0.7); },
  enterCar() { blip(300, 420, 0.1, 'sine', 0.5); },
  fail() { blip(330, 165, 0.3, 'triangle', 0.6); },
};
