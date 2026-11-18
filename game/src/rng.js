// rng.js — deterministic seeded RNG (mulberry32 family).
// The simulation and screenshot staging must be perfectly reproducible,
// so nothing in the game may call Math.random or Date.now. All randomness
// flows through an Rng instance created from an explicit seed.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.next = mulberry32(this.seed);
  }
  // Float in [0, 1).
  f() { return this.next(); }
  // Float in [min, max).
  range(min, max) { return min + this.next() * (max - min); }
  // Integer in [min, max] inclusive.
  int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }
  // True with probability p.
  chance(p) { return this.next() < p; }
  // Pick one element of a non-empty array.
  pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  // In-place Fisher-Yates shuffle driven by this stream.
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  // Fork an independent stream (used so staging never perturbs gameplay).
  fork(salt) { return new Rng((this.seed ^ Math.imul(salt + 1, 0x9E3779B1)) >>> 0); }
}

// Small deterministic hash of a string, for per-heist seeds.
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
export function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
// Shortest signed angular difference from a to b, in [-PI, PI].
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function turnToward(angle, target, maxTurn) {
  const d = angleDiff(angle, target);
  if (Math.abs(d) <= maxTurn) return target;
  return angle + Math.sign(d) * maxTurn;
}
