// chaseview.js — hand-written raycast pseudo-3D CHASE VIEW for driving.
// When the player is in a car, main.js draws this instead of the top-down
// renderer: a rear chase camera behind the player's car renders the SAME
// world state (city building footprints, traffic, police, pedestrians, the
// helicopter and its searchlight, roadblocks and spike strips) as a
// perspective scene. The module only READS world state — the simulation is
// untouched — and every variation (building heights, facade colours, lit
// windows) is a deterministic hash of building identity, never Math.random
// or Date.now, so screenshot staging stays perfectly reproducible.
//
// Technique: classic raycasting at 320x200 internal resolution, upscaled to
// the 1280x800 canvas. The ground is floor-cast per pixel into an
// ImageData buffer (roads, lane dashes, sidewalks, block lawns, plaza,
// park, river), building walls are ray/AABB slab tests per column with a
// per-column z-buffer, and actors are billboards drawn in depth order,
// clipped column-by-column against that z-buffer.
import { VIEW_W, VIEW_H, ROAD_W, RIVER_Y, DAY_PHASES } from './config.js';
import { AVENUES, STREETS, PLAZA, PARK, collideWorld } from './city.js';
import { clamp, angleDiff } from './rng.js';

const COLS = 320, ROWS = 200, SCALE = VIEW_W / COLS; // 4 screen px per column
const FOV = 1.12;                                    // ~64 degrees
const PLANE = (COLS / 2) / Math.tan(FOV / 2);        // projection plane distance
const CAM_H = 62;                                    // camera height, world units
const CAM_BACK = 118;                                // camera distance behind the car
const MAX_DIST = 1500;                               // fog / cull distance
const HELI_ALT = 135;                                // helicopter cruise altitude
const HORIZON = 92;                                  // horizon row (internal px)

// Deterministic 0..1 hash of small integers (render-only variation).
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// --- colour helpers -------------------------------------------------------
const rgbCache = new Map();
function rgb(hex) {
  let c = rgbCache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
  }
  return c;
}
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Per time-of-day look: sky gradient, fog colour, ambient light, how many
// windows are lit, and where the sun (or moon) hangs.
const SKIES = {
  day:   { top: [64, 138, 208], hor: [190, 232, 240], fog: [190, 232, 240], amb: 1.0,  lit: 0.06, sunAz: 0.9,  sunEl: 0.62, sun: [255, 244, 200], glow: 60 },
  dawn:  { top: [104, 72, 150], hor: [255, 166, 122], fog: [238, 150, 122], amb: 0.86, lit: 0.30, sunAz: 0.0,  sunEl: 0.10, sun: [255, 196, 110], glow: 150 },
  dusk:  { top: [92, 44, 138],  hor: [255, 138, 118], fog: [216, 138, 172], amb: 0.80, lit: 0.48, sunAz: Math.PI, sunEl: 0.07, sun: [255, 178, 84], glow: 190 },
  night: { top: [16, 12, 44],   hor: [62, 34, 88],    fog: [40, 26, 66],    amb: 0.46, lit: 0.62, sunAz: 2.2,  sunEl: 0.42, sun: [214, 226, 245], glow: 26 },
};
const GRASS = ['#3d8f4e', '#357f45', '#47975a', '#3a7d4c', '#418a52', '#6f7268', '#7a7d72'].map(rgb);
const ASPHALT = [50, 53, 61], SIDEWALK = [140, 147, 154], DASH = [245, 215, 110];
const EDGE = [196, 201, 206], SAND = [232, 207, 143], WATER = [19, 84, 122];
const PLAZA_C = [141, 133, 120], LAWN = [47, 125, 58], POND = [30, 127, 184];

// Building height: a pure function of building identity + kind, so the
// skyline is stable across frames, runs and screenshots.
const KIND_TALL = { casino: 96, bank: 74, office: 84, data: 62, hotel: 72, flats: 64, museum: 34, club: 24, civic: 30, police: 44 };
function buildingHeight(b) {
  return 96 + hash01(b.id * 7 + 3) * 128 + (KIND_TALL[b.kind] || 26);
}

// --- offscreen frame buffer ----------------------------------------------
let off = null, offCtx = null, img = null, pix = null;
function ensureBuffer() {
  if (off) return;
  off = document.createElement('canvas');
  off.width = COLS; off.height = ROWS;
  offCtx = off.getContext('2d');
  img = offCtx.createImageData(COLS, ROWS);
  pix = img.data;
}
function setPx(i, r, g, b) {
  pix[i] = r; pix[i + 1] = g; pix[i + 2] = b; pix[i + 3] = 255;
}

// --- billboard sprites (drawn once, cached) --------------------------------
const spriteCache = new Map();
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function shadeOf(hex, f) {
  const c = rgb(hex);
  return `rgb(${Math.round(clamp(c[0] * f, 0, 255))},${Math.round(clamp(c[1] * f, 0, 255))},${Math.round(clamp(c[2] * f, 0, 255))})`;
}
// LIGHT RULE — one light direction governs every actor in this module:
// light comes from ahead-left of the camera, so top decks are lightest
// (x1.28), main faces carry the mid gradient (1.14 -> 0.94 -> 0.60) and
// side faces are darkest (x0.58). carSprite, pedSprite, heroSprite and
// heliSprite all follow it, so hero, traffic and air support share one
// sun. Contact shadows are NOT baked into sprites: they are projected
// onto the ground plane by drawGroundShadow inside drawChaseView, so a
// shadow always sits on the road under its actor, in the same
// perspective as everything else.

// Three-quarter view of a car (rear or front face + top deck + one shaded
// side face with its own glass and wheel), so actors read as solid volumes
// from a chase camera instead of flat side-profile cutouts. The billboard
// flip mirrors the side face to whichever side faces the camera.
function carSprite(color, police, front, disabled) {
  const key = `car|${color}|${police ? 1 : 0}|${front ? 1 : 0}|${disabled ? 1 : 0}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = makeCanvas(150, 88);
  const g = c.getContext('2d');
  const body = disabled ? '#555b66' : color;
  // Side face (right, darker) with glass band and a real wheel.
  g.fillStyle = shadeOf(body, 0.58);
  g.beginPath(); g.moveTo(92, 38); g.lineTo(140, 47); g.lineTo(140, 72); g.lineTo(92, 72); g.closePath(); g.fill();
  g.fillStyle = '#0d1320';
  g.beginPath(); g.moveTo(95, 42); g.lineTo(130, 48); g.lineTo(130, 57); g.lineTo(95, 54); g.closePath(); g.fill();
  g.fillStyle = 'rgba(160,210,255,0.30)'; g.fillRect(97, 43, 12, 4);
  g.fillStyle = '#0c0e11'; g.beginPath(); g.arc(127, 71, 10, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#8b939e'; g.beginPath(); g.arc(127, 71, 4, 0, Math.PI * 2); g.fill();
  // Top deck: cabin roof / bonnet sloping up from the face.
  g.fillStyle = shadeOf(body, 1.28);
  g.beginPath(); g.moveTo(10, 32); g.lineTo(28, 13); g.lineTo(108, 13); g.lineTo(92, 32); g.closePath(); g.fill();
  g.fillStyle = '#0e1420';
  g.beginPath(); g.moveTo(34, 16); g.lineTo(58, 16); g.lineTo(48, 29); g.lineTo(24, 29); g.closePath(); g.fill();
  g.fillStyle = 'rgba(160,210,255,0.35)'; g.fillRect(30, 17, 14, 4);
  // Main face (rear or front) with a vertical paint gradient.
  const grad = g.createLinearGradient(0, 30, 0, 76);
  grad.addColorStop(0, shadeOf(body, 1.14)); grad.addColorStop(0.55, shadeOf(body, 0.94)); grad.addColorStop(1, shadeOf(body, 0.6));
  g.fillStyle = grad;
  g.beginPath(); g.roundRect(8, 30, 84, 44, 8); g.fill();
  g.fillStyle = '#0e1420'; g.beginPath(); g.roundRect(22, 34, 56, 13, 5); g.fill(); // face glass
  g.fillStyle = 'rgba(160,210,255,0.32)'; g.fillRect(26, 35, 20, 4);
  g.fillStyle = '#101216'; g.fillRect(8, 60, 15, 18); g.fillRect(79, 60, 13, 18); // face wheels
  if (police) {
    g.fillStyle = '#eef1f5'; g.fillRect(8, 48, 84, 13);
    g.fillStyle = '#16233d'; g.font = '900 10px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('POLICE', 50, 58);
    g.fillStyle = '#ff6b81'; g.fillRect(52, 6, 22, 7);
    g.fillStyle = '#01cdfe'; g.fillRect(74, 6, 22, 7);
  }
  if (front) {
    g.fillStyle = '#fff3b0';
    g.beginPath(); g.arc(22, 52, 6, 0, Math.PI * 2); g.arc(80, 52, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,243,176,0.35)';
    g.beginPath(); g.arc(22, 52, 11, 0, Math.PI * 2); g.arc(80, 52, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#22262e'; g.fillRect(38, 62, 28, 7);
    g.fillStyle = '#fff3b0'; g.fillRect(133, 56, 6, 6); // side-face headlight wrap
  } else {
    g.fillStyle = '#ff2038'; g.fillRect(11, 50, 22, 6); g.fillRect(70, 50, 20, 6);
    g.fillStyle = 'rgba(255,32,56,0.4)'; g.fillRect(9, 48, 26, 10); g.fillRect(68, 48, 24, 10);
    g.fillStyle = '#dfe3e8'; g.fillRect(40, 63, 22, 9);
    g.fillStyle = '#ff2038'; g.fillRect(134, 56, 5, 6); // side-face tail wrap
  }
  if (disabled) { g.fillStyle = 'rgba(20,20,24,0.45)'; g.fillRect(0, 0, 150, 88); }
  spriteCache.set(key, c);
  return c;
}
// Three-quarter pedestrian: front torso lit, side plane shaded, arms and
// striding legs offset so the figure has volume from behind/side angles.
function pedSprite(shirt) {
  const key = `ped|${shirt}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = makeCanvas(44, 110);
  const g = c.getContext('2d');
  g.fillStyle = '#1d2026'; g.fillRect(11, 60, 8, 40); // far leg
  g.fillStyle = '#2b2f38'; g.fillRect(24, 60, 8, 43); // near leg, longer stride
  g.fillStyle = '#111'; g.fillRect(9, 98, 11, 5); g.fillRect(23, 101, 11, 5); // shoes
  g.fillStyle = shadeOf(shirt, 0.62); g.fillRect(31, 27, 7, 32); // side arm
  g.fillStyle = shadeOf(shirt, 0.85); g.fillRect(5, 27, 6, 30);  // front arm
  g.fillStyle = shirt; // front torso plane
  g.beginPath(); g.moveTo(9, 24); g.lineTo(27, 24); g.lineTo(29, 62); g.lineTo(10, 62); g.closePath(); g.fill();
  g.fillStyle = shadeOf(shirt, 0.66); // side torso plane
  g.beginPath(); g.moveTo(27, 24); g.lineTo(34, 27); g.lineTo(35, 60); g.lineTo(29, 62); g.closePath(); g.fill();
  g.fillStyle = '#e8b08a'; g.beginPath(); g.arc(20, 13, 10, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.arc(24, 14, 8, -0.6, 1.4); g.lineTo(24, 14); g.fill(); // head side shade
  g.fillStyle = '#2b2118'; g.beginPath(); g.arc(20, 9, 10, Math.PI, Math.PI * 2); g.fill();
  spriteCache.set(key, c);
  return c;
}
// Street-prop sprites from the city's own prop data (lamp, palm, crate,
// barrier, bench, hydrant) — simple shaded volumes, not flat icons.
function propSprite(kind, lit) {
  const key = `prop|${kind}|${lit ? 1 : 0}`;
  let c = spriteCache.get(key);
  if (c) return c;
  if (kind === 'lamp') {
    c = makeCanvas(26, 132); const g = c.getContext('2d');
    g.fillStyle = '#22262e'; g.fillRect(11, 22, 4, 108); g.fillRect(11, 18, 13, 4);
    if (lit) { const gr = g.createRadialGradient(23, 24, 1, 23, 24, 15); gr.addColorStop(0, 'rgba(255,226,150,0.95)'); gr.addColorStop(1, 'rgba(255,226,150,0)'); g.fillStyle = gr; g.beginPath(); g.arc(23, 24, 15, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = lit ? '#ffe9a8' : '#cfd6dd'; g.beginPath(); g.arc(23, 23, 4, 0, Math.PI * 2); g.fill();
  } else if (kind === 'palm') {
    c = makeCanvas(96, 132); const g = c.getContext('2d');
    g.strokeStyle = '#241a36'; g.lineWidth = 7; g.beginPath(); g.moveTo(40, 130); g.quadraticCurveTo(46, 84, 54, 44); g.stroke();
    g.strokeStyle = '#1c1428'; g.lineWidth = 5;
    for (let i = 0; i < 6; i++) { const a = -0.25 - i * 0.5; g.beginPath(); g.moveTo(54, 42); g.quadraticCurveTo(54 + Math.cos(a) * 26, 42 + Math.sin(a) * 20 - 8, 54 + Math.cos(a) * 44, 42 + Math.sin(a) * 34 + 12); g.stroke(); }
    g.fillStyle = '#241a36'; g.beginPath(); g.arc(50, 46, 5, 0, Math.PI * 2); g.arc(59, 47, 5, 0, Math.PI * 2); g.fill();
  } else if (kind === 'crate') {
    c = makeCanvas(46, 42); const g = c.getContext('2d');
    g.fillStyle = '#8a6b3a'; g.beginPath(); g.moveTo(4, 14); g.lineTo(14, 5); g.lineTo(42, 5); g.lineTo(32, 14); g.closePath(); g.fill(); // top
    g.fillStyle = '#a37f45'; g.fillRect(4, 14, 28, 25);
    g.fillStyle = '#6f552c'; g.beginPath(); g.moveTo(32, 14); g.lineTo(42, 5); g.lineTo(42, 30); g.lineTo(32, 39); g.closePath(); g.fill(); // side
    g.strokeStyle = 'rgba(40,26,8,0.6)'; g.lineWidth = 2; g.strokeRect(6, 16, 24, 21);
  } else if (kind === 'barrier') {
    c = makeCanvas(70, 46); const g = c.getContext('2d');
    g.fillStyle = '#33373f'; g.fillRect(7, 26, 5, 18); g.fillRect(58, 26, 5, 18);
    g.fillStyle = '#eef1f5'; g.fillRect(2, 8, 66, 17);
    g.fillStyle = '#ff9e64'; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(6 + i * 17, 25); g.lineTo(15 + i * 17, 8); g.lineTo(22 + i * 17, 8); g.lineTo(13 + i * 17, 25); g.closePath(); g.fill(); }
    g.fillStyle = '#22262e'; g.fillRect(2, 25, 66, 3);
  } else if (kind === 'bench') {
    c = makeCanvas(62, 40); const g = c.getContext('2d');
    g.fillStyle = '#5d4630'; g.fillRect(4, 6, 54, 5); g.fillRect(4, 14, 54, 5);
    g.fillStyle = '#77572f'; g.fillRect(4, 24, 54, 6);
    g.fillStyle = '#22262e'; g.fillRect(7, 30, 5, 9); g.fillRect(50, 30, 5, 9);
  } else { // hydrant
    c = makeCanvas(24, 34); const g = c.getContext('2d');
    g.fillStyle = '#c1272d'; g.beginPath(); g.roundRect(6, 8, 12, 24, 4); g.fill();
    g.fillStyle = '#e33'; g.beginPath(); g.arc(12, 7, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f4f6f8'; g.fillRect(1, 15, 5, 5); g.fillRect(18, 15, 5, 5);
  }
  spriteCache.set(key, c);
  return c;
}
const PROP_W = { lamp: 8, palm: 36, crate: 17, barrier: 27, bench: 23, hydrant: 8 };
// Render-only kerb-parked cars, derived deterministically from the road
// grid (seeded hashes): they densify the chase frame without touching the
// simulation's car list, speeds or behaviour in any way.
const PARKED_COLORS = ['#e8d5c4', '#d9a08a', '#8fb8c8', '#d8a8b8', '#a8c8a0', '#e6d9a8', '#b8aed8', '#f0e6d8'];
let parkedCache = null;
function parkedCars() {
  if (parkedCache) return parkedCache;
  const out = [];
  const off = ROAD_W / 2 + 13;
  const nearCross = (v, lines) => lines.some((l) => Math.abs(v - l) < 82);
  AVENUES.forEach((a, ai) => {
    for (let i = 0; i < 13; i++) {
      const y = 110 + i * 152;
      if (y > RIVER_Y - 120 || nearCross(y, STREETS.map((s) => s.y))) continue;
      for (let side = -1; side <= 1; side += 2) {
        if (hash01(ai * 977 + i * 131 + (side + 1) * 57) > 0.42) continue;
        out.push({ x: a.x + side * off, y, angle: side > 0 ? Math.PI / 2 : -Math.PI / 2, color: PARKED_COLORS[Math.floor(hash01(ai * 31 + i * 7 + side) * 8) % 8], police: false, disabled: false, parkedRender: true, id: 9000 + out.length });
      }
    }
  });
  STREETS.forEach((s, si) => {
    for (let i = 0; i < 21; i++) {
      const x = 110 + i * 152;
      if (nearCross(x, AVENUES.map((a) => a.x))) continue;
      for (let side = -1; side <= 1; side += 2) {
        if (hash01(5000 + si * 977 + i * 131 + (side + 1) * 57) > 0.42) continue;
        out.push({ x, y: s.y + side * off, angle: side > 0 ? 0 : Math.PI, color: PARKED_COLORS[Math.floor(hash01(si * 43 + i * 11 + side) * 8) % 8], police: false, disabled: false, parkedRender: true, id: 9500 + out.length });
      }
    }
  });
  parkedCache = out;
  return out;
}
// In-world helicopter as a front three-quarter VOLUME, seen from the
// chase camera: a lit top deck, a mid-gradient nose face, one darker
// flank, cockpit glass wrapping the nose corner, and a tail boom that
// recedes with a perspective taper to the fin and tail rotor. Landing
// skids hang on struts under the belly; the main rotor is a wide flat
// translucent disc on the mast. NO baked ground shadow — the shadow is
// projected onto the ground plane by drawGroundShadow in drawChaseView,
// offset away from the sun, while the body flies at HELI_ALT. The flank
// carries a plain blue cheatline (no text label).
function heliSprite() {
  let c = spriteCache.get('heli');
  if (c) return c;
  c = makeCanvas(260, 120);
  const g = c.getContext('2d');
  // Tail boom receding from the fuselage flank with a perspective taper
  // (thick at the root, thin at the fin), plus the tail fin.
  const boom = g.createLinearGradient(0, 46, 0, 66);
  boom.addColorStop(0, '#39414f'); boom.addColorStop(1, '#20242c');
  g.fillStyle = boom;
  g.beginPath(); g.moveTo(140, 48); g.lineTo(243, 56); g.lineTo(243, 62); g.lineTo(140, 68); g.closePath(); g.fill();
  g.fillStyle = '#272c36';
  g.beginPath(); g.moveTo(236, 32); g.lineTo(251, 34); g.lineTo(250, 66); g.lineTo(236, 62); g.closePath(); g.fill();
  // Tail rotor (blurred vertical disc) + red nav light on the fin.
  g.fillStyle = 'rgba(190,205,220,0.45)';
  g.beginPath(); g.ellipse(246, 48, 3.5, 13, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ff3355'; g.beginPath(); g.arc(244, 30, 3.5, 0, Math.PI * 2); g.fill();
  // Far skid (dimmer, offset up) behind the belly.
  g.strokeStyle = 'rgba(16,18,22,0.55)'; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(46, 97); g.lineTo(160, 97); g.stroke();
  g.beginPath(); g.moveTo(62, 82); g.lineTo(56, 97); g.moveTo(138, 82); g.lineTo(144, 97); g.stroke();
  // Flank: the shaded side face (darkest, x0.58 of the deck tone),
  // drawn first so the nose face overlaps its front edge.
  g.fillStyle = '#232833';
  g.beginPath(); g.moveTo(100, 38); g.lineTo(154, 46); g.lineTo(154, 80); g.lineTo(100, 86); g.closePath(); g.fill();
  // Door seam on the flank + the blue cheatline wrapping face and flank.
  g.strokeStyle = 'rgba(210,222,235,0.25)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(112, 44); g.lineTo(112, 80); g.stroke();
  g.fillStyle = 'rgba(238,241,245,0.9)';
  g.beginPath(); g.moveTo(100, 62); g.lineTo(154, 68); g.lineTo(154, 71); g.lineTo(100, 65); g.closePath(); g.fill();
  g.fillStyle = 'rgba(51,136,255,0.85)';
  g.beginPath(); g.moveTo(100, 65); g.lineTo(154, 71); g.lineTo(154, 76); g.lineTo(100, 70); g.closePath(); g.fill();
  // Nose / main face: mid gradient, lit at the top, dark at the belly.
  // The face is deliberately narrower than the flank run behind it, so
  // the body reads as a front three-quarter volume, not a side profile.
  const bodyGrad = g.createLinearGradient(0, 30, 0, 88);
  bodyGrad.addColorStop(0, '#4d5870'); bodyGrad.addColorStop(0.55, '#2e3442'); bodyGrad.addColorStop(1, '#191d26');
  g.fillStyle = bodyGrad;
  g.beginPath(); g.roundRect(22, 32, 82, 54, 22); g.fill();
  // Top deck: the lightest plane (x1.28), sloping from the mast back
  // over the cabin toward the flank.
  g.fillStyle = '#5f6d89';
  g.beginPath(); g.moveTo(34, 36); g.lineTo(52, 24); g.lineTo(118, 24); g.lineTo(134, 38); g.lineTo(106, 41); g.lineTo(52, 40); g.closePath(); g.fill();
  // Engine deck + exhaust on top of the fuselage.
  g.fillStyle = '#22262e'; g.beginPath(); g.roundRect(98, 16, 38, 11, 5); g.fill();
  g.fillStyle = '#12151b'; g.fillRect(132, 19, 9, 5);
  // Cockpit glass wrapping the nose corner: a front pane on the nose
  // face and a second pane turning the corner onto the flank, both with
  // the same sky highlight as the car glass.
  g.fillStyle = '#9fd8ef';
  g.beginPath(); g.roundRect(29, 40, 38, 29, 11); g.fill();
  g.fillStyle = '#7cc3e4';
  g.beginPath(); g.moveTo(71, 41); g.lineTo(96, 44); g.lineTo(96, 68); g.lineTo(71, 69); g.closePath(); g.fill();
  g.fillStyle = 'rgba(230,246,255,0.75)'; g.fillRect(35, 43, 14, 6); g.fillRect(75, 44, 10, 5);
  // Cheatline across the nose face (meets the flank stripe at the corner).
  g.fillStyle = 'rgba(238,241,245,0.9)'; g.fillRect(26, 62, 76, 3);
  g.fillStyle = 'rgba(51,136,255,0.85)'; g.fillRect(26, 65, 76, 5);
  // Searchlight pod slung under the nose, lamp lit.
  g.fillStyle = '#14161a'; g.beginPath(); g.arc(44, 87, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff3b0'; g.beginPath(); g.arc(42, 88, 3.5, 0, Math.PI * 2); g.fill();
  // Near skid + struts, drawn over the belly line.
  g.strokeStyle = '#101216'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(32, 106); g.lineTo(172, 106); g.stroke();
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(56, 84); g.lineTo(48, 106); g.moveTo(140, 84); g.lineTo(150, 106); g.stroke();
  // Rotor mast + translucent rotor-blur disc (a wide flat ellipse).
  g.fillStyle = '#14161a'; g.fillRect(86, 10, 9, 14);
  g.fillStyle = 'rgba(198,214,228,0.20)';
  g.beginPath(); g.ellipse(92, 8, 94, 9, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(220,232,244,0.30)';
  g.beginPath(); g.ellipse(92, 8, 94, 5, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(226,236,246,0.35)'; g.lineWidth = 1.5;
  g.beginPath(); g.ellipse(92, 8, 94, 9, 0, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#2b2f38'; g.beginPath(); g.arc(92, 8, 5, 0, Math.PI * 2); g.fill();
  spriteCache.set('heli', c);
  return c;
}

// Draw one billboard, clipped in 2-column strips against the z-buffer.
function drawBillboard(ctx, spr, cxPix, bottomRow, wPix, dist, zbuf, flip) {
  if (wPix < 2) return;
  const hPix = wPix * (spr.height / spr.width);
  const x0 = cxPix - wPix / 2, yTop = bottomRow - hPix;
  const c0 = Math.max(0, Math.floor(x0)), c1 = Math.min(COLS - 1, Math.ceil(x0 + wPix));
  for (let col = c0; col <= c1; col += 2) {
    if (dist > zbuf[col] + 6) continue;
    let srcX = ((col - x0) / wPix) * spr.width;
    if (flip) srcX = spr.width - srcX - (2 / wPix) * spr.width;
    ctx.drawImage(spr, srcX, 0, Math.max(1, (2 / wPix) * spr.width), spr.height,
      col * SCALE, yTop * SCALE, SCALE * 2, hPix * SCALE);
  }
}

// The player's own car as a high-detail REAR three-quarter sprite, built
// with the SAME construction language and the SAME shading factors as
// carSprite (see the LIGHT RULE above): main rear face with the vertical
// gradient 1.14 -> 0.94 -> 0.60, top deck lighter (x1.28), ONE side face
// darker (x0.58) on the same side carSprite shows unflipped, face glass
// with the same highlight style. Identity details carried over from the
// old screen-space hero: spoiler on struts, full-width glowing tail-light
// bar, badge text, plate 'PLNR·6', twin exhausts and rear wheels (a face
// wheel plus the side face's wheel as a squashed ellipse). The exhaust
// flame flicker and damage smoke are time-varying, so they are drawn in
// screen space by drawHeroCar over this cached body.
function heroSprite(color, name) {
  const key = `hero|${color}|${name}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = makeCanvas(460, 250);
  const g = c.getContext('2d');
  // Side face (right, darkest x0.58) with its glass band and wheel.
  g.fillStyle = shadeOf(color, 0.58);
  g.beginPath(); g.moveTo(316, 96); g.lineTo(440, 118); g.lineTo(440, 206); g.lineTo(316, 226); g.closePath(); g.fill();
  g.fillStyle = '#0d1320';
  g.beginPath(); g.moveTo(326, 106); g.lineTo(408, 120); g.lineTo(408, 144); g.lineTo(326, 130); g.closePath(); g.fill();
  g.fillStyle = 'rgba(160,210,255,0.30)'; g.fillRect(330, 108, 26, 7);
  g.fillStyle = '#ff2038'; g.fillRect(434, 148, 6, 10); // side-face tail wrap
  g.fillStyle = '#0c0e11'; g.beginPath(); g.ellipse(390, 212, 27, 15, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#8b939e'; g.beginPath(); g.ellipse(390, 212, 11, 6, 0, 0, Math.PI * 2); g.fill();
  // Top deck (lightest, x1.28): rear deck + cabin roof sloping up from
  // the rear face, with the rear window set into it.
  g.fillStyle = shadeOf(color, 1.28);
  g.beginPath(); g.moveTo(64, 88); g.lineTo(102, 48); g.lineTo(336, 48); g.lineTo(322, 88); g.closePath(); g.fill();
  g.fillStyle = '#0e1420';
  g.beginPath(); g.moveTo(130, 55); g.lineTo(202, 55); g.lineTo(194, 81); g.lineTo(116, 81); g.closePath(); g.fill();
  g.fillStyle = 'rgba(160,210,255,0.35)'; g.fillRect(124, 57, 34, 7);
  // The deck's light plane continues over the side face as its top
  // edge strip, so the side face hangs from the same lit roof plane
  // instead of butting against the rear face as a separate box.
  g.fillStyle = shadeOf(color, 1.28);
  g.beginPath(); g.moveTo(316, 92); g.lineTo(440, 114); g.lineTo(440, 124); g.lineTo(316, 104); g.closePath(); g.fill();
  // Main rear face with the shared vertical paint gradient.
  const grad = g.createLinearGradient(0, 84, 0, 234);
  grad.addColorStop(0, shadeOf(color, 1.14)); grad.addColorStop(0.55, shadeOf(color, 0.94)); grad.addColorStop(1, shadeOf(color, 0.6));
  g.fillStyle = grad;
  g.beginPath(); g.roundRect(64, 84, 258, 150, 14); g.fill();
  // Face glass band with the same highlight style as carSprite.
  g.fillStyle = '#0e1420'; g.beginPath(); g.roundRect(94, 92, 198, 30, 8); g.fill();
  g.fillStyle = 'rgba(160,210,255,0.32)'; g.fillRect(102, 95, 52, 8);
  // Face wheels at the bottom corners of the rear face.
  g.fillStyle = '#101216'; g.fillRect(64, 192, 32, 44); g.fillRect(290, 192, 32, 44);
  // Spoiler on struts, spanning deck and side face.
  g.fillStyle = '#14161c';
  g.fillRect(118, 40, 11, 34); g.fillRect(292, 40, 11, 34);
  g.beginPath(); g.roundRect(52, 26, 384, 16, 7); g.fill();
  // Full-width tail-light bar, glowing.
  g.fillStyle = 'rgba(255,32,56,0.35)';
  g.beginPath(); g.roundRect(74, 138, 238, 21, 9); g.fill();
  g.fillStyle = '#ff2438';
  g.beginPath(); g.roundRect(78, 142, 230, 11, 5); g.fill();
  g.fillStyle = '#ffd7dc';
  g.beginPath(); g.roundRect(78, 142, 230, 4, 2); g.fill();
  // Badge + plate.
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = '800 16px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText(name, 193, 180);
  g.fillStyle = '#e8ecf1';
  g.beginPath(); g.roundRect(156, 188, 74, 27, 4); g.fill();
  g.fillStyle = '#1c2733'; g.font = '900 17px system-ui, sans-serif';
  g.fillText('PLNR·6', 193, 208);
  // Twin exhausts at the bottom edge of the rear face.
  g.fillStyle = '#22262e';
  g.beginPath(); g.arc(118, 230, 9, 0, Math.PI * 2); g.arc(268, 230, 9, 0, Math.PI * 2); g.fill();
  spriteCache.set(key, c);
  return c;
}

// The player's own car, drawn THROUGH the same projection as every other
// actor: project() fixes its screen centre and its size (a ~45-world-unit
// width at the camera distance lands ~390px wide / ~210px tall on screen,
// ~25% of the frame height as the staging requires). The ground shadow
// comes from the shared ground-plane helper; the sprite itself is drawn
// with a plain drawImage and NO z-clipping — nothing can stand between
// the chase camera and its own car. The projected ground row of the car
// sits below the frame's bottom edge (the camera rides closer than the
// frame's near ground plane), so the sprite's base is anchored at the
// frame bottom exactly where the old screen-space hero sat, keeping the
// whole car — plate, exhausts, spoiler — inside the staged frame.
function drawHeroCar(ctx, world, car, project, drawGroundShadow) {
  const lean = clamp(car.steer || 0, -1, 1) * 26;
  const bounce = Math.sin(world.time * 27) * Math.min(2.2, Math.abs(car.speed) / 130);
  const spr = heroSprite(car.color, car.spec ? car.spec.name : 'GETAWAY');
  const p = project ? project(car.x, car.y, 0) : null;
  let cx, base, wPix;
  if (p) {
    wPix = (45 * PLANE / p.dist) * SCALE;
    cx = p.sx * SCALE + lean;
    base = Math.min(p.row * SCALE, VIEW_H - 6) + bounce;
    // Ground shadow with the helper's exact math (wWorld 48, alpha
    // 0.45), but centred on the anchored base: the helper's projected
    // centre row is the same off-frame row the sprite base is anchored
    // from, so the ellipse is placed where the car's contact patch
    // actually renders.
    const sw = (48 * PLANE / p.dist) * SCALE;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(cx, base - 6, sw / 2, sw * 0.11, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(VIEW_W / 2 + lean, VIEW_H - 14, 232, 24, 0, 0, Math.PI * 2); ctx.fill();
    wPix = 416;
    cx = VIEW_W / 2 + lean;
    base = VIEW_H - 6 + bounce;
  }
  const hPix = wPix * (spr.height / spr.width);
  const x0 = cx - wPix / 2, top = base - hPix;
  ctx.drawImage(spr, x0, top, wPix, hPix);
  // Exhaust flames: deterministic flicker at speed, at the sprite's
  // exhaust positions (canvas 118/460 and 268/460 across, 230/250 down).
  if (Math.abs(car.speed) > 200) {
    const fl = (8 + Math.sin(world.time * 41) * 4) * (wPix / 416);
    const ey = top + (230 / 250) * hPix;
    ctx.fillStyle = 'rgba(255,150,40,0.75)';
    for (const fx of [118, 268]) {
      const ex = x0 + (fx / 460) * wPix;
      ctx.beginPath(); ctx.ellipse(ex, ey + fl * 0.4, Math.max(2, 5 * (wPix / 416)), fl, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Damage smoke curling off the rear deck.
  if (car.health < car.maxHealth * 0.4) {
    ctx.fillStyle = 'rgba(120,124,132,0.4)';
    const s = wPix / 416;
    for (let i = 0; i < 3; i++) {
      const ph = (world.time * 0.9 + i * 0.33) % 1;
      ctx.beginPath(); ctx.arc(cx + (-40 + i * 34) * s + Math.sin(world.time * 3 + i) * 8, top + 20 * s - ph * 66, (10 + ph * 22) * s, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// Deterministic speed streaks: pale motion lines raking the road surface
// (drawn under the hero car) and streaming past the frame edges, so a
// still frame reads as speed rather than a parked diorama. Positions are
// hashes of the streak index plus a time phase — the phase is fixed in
// staged shots, so screenshots stay perfectly reproducible.
function drawSpeedStreaks(ctx, world, layer) {
  ctx.save();
  ctx.lineCap = 'round';
  const phase = (world.time * 620) % 240;
  if (layer === 'road') {
    for (let i = 0; i < 16; i++) {
      const h1 = hash01(i * 91 + 7), h2 = hash01(i * 47 + 3), h3 = hash01(i * 29 + 13);
      let x = VIEW_W / 2 + (h1 - 0.5) * 920;
      if (Math.abs(x - VIEW_W / 2) < 270) x += x < VIEW_W / 2 ? -270 : 270;
      const y = VIEW_H * 0.64 + h2 * 245 + ((phase * (0.4 + h3)) % 56) - 28;
      if (y > VIEW_H - 12) continue;
      const len = 55 + h3 * 130;
      ctx.strokeStyle = `rgba(255,236,205,${0.05 + h2 * 0.06})`;
      ctx.lineWidth = 2.5 + h3 * 1.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y - len * 0.05); ctx.stroke();
    }
  } else {
    for (let i = 0; i < 22; i++) {
      const h1 = hash01(i * 37 + 11), h2 = hash01(i * 53 + 5), h3 = hash01(i * 71 + 19);
      const left = i % 2 === 0;
      const y = 30 + h1 * (VIEW_H - 90);
      const len = 46 + h2 * 140;
      const x0 = left ? -14 + h3 * 48 : VIEW_W + 14 - h3 * 48;
      ctx.strokeStyle = `rgba(255,240,218,${0.05 + h1 * 0.08})`;
      ctx.lineWidth = 2 + h3 * 2;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + (left ? len : -len), y - len * 0.06);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// --- main entry -------------------------------------------------------------
export function drawChaseView(ctx, world) {
  const car = world.player && world.player.car;
  if (!car) return;
  ensureBuffer();
  const phaseName = (world.plan && world.plan.timeOfDay) || 'day';
  const sky = SKIES[phaseName] || SKIES.day;
  const phase = DAY_PHASES[phaseName] || DAY_PHASES.day;
  void phase;

  // Camera: behind and above the car, looking along its heading. The
  // position is pushed out of building footprints (render-only) so a car
  // hugging a wall never puts the camera inside a facade.
  const dirX = Math.cos(car.angle), dirY = Math.sin(car.angle);
  const rightX = -dirY, rightY = dirX;
  let camX = car.x - dirX * CAM_BACK, camY = car.y - dirY * CAM_BACK;
  const fixed = collideWorld(world.city, camX, camY, 26);
  camX = fixed.x; camY = fixed.y;

  const buildings = world.city.buildings;
  const heights = buildings.map(buildingHeight);

  // -- sky rows
  for (let y = 0; y <= HORIZON; y++) {
    const t = y / HORIZON;
    const c = mix(sky.top, sky.hor, t * t * 0.4 + t * 0.6);
    for (let x = 0; x < COLS; x++) setPx((y * COLS + x) * 4, c[0], c[1], c[2]);
  }

  // -- floor casting
  const heli = world.heli;
  const lightOn = heli && heli.active;
  const headlight = phaseName === 'dusk' || phaseName === 'night' || phaseName === 'dawn' ? 0.55 : 0.18;
  for (let y = HORIZON + 1; y < ROWS; y++) {
    const p = y - HORIZON;
    const f = (CAM_H * PLANE) / p; // forward distance at this row
    if (f > MAX_DIST) {
      for (let x = 0; x < COLS; x++) setPx((y * COLS + x) * 4, sky.fog[0], sky.fog[1], sky.fog[2]);
      continue;
    }
    const shadeMul = sky.amb * (0.34 + 0.66 / (1 + f * 0.0011));
    const fogT = Math.min(0.6, (f / MAX_DIST) * 0.6);
    const startX = camX + dirX * f - rightX * (COLS / 2 / PLANE) * f;
    const startY = camY + dirY * f - rightY * (COLS / 2 / PLANE) * f;
    const stepX = rightX * (f / PLANE), stepY = rightY * (f / PLANE);
    let wx = startX, wy = startY;
    for (let x = 0; x < COLS; x++, wx += stepX, wy += stepY) {
      let c;
      if (wy > RIVER_Y + 60) {
        const sparkle = hash01(((wx >> 5) * 31 + (wy >> 5) * 57)) > 0.86 ? 26 : 0;
        c = [WATER[0] + sparkle, WATER[1] + sparkle, WATER[2] + sparkle];
      } else if (wy > RIVER_Y) {
        c = SAND;
      } else {
        let dA = 1e9, dS = 1e9;
        for (let i = 0; i < AVENUES.length; i++) { const d = Math.abs(wx - AVENUES[i].x); if (d < dA) dA = d; }
        for (let i = 0; i < STREETS.length; i++) { const d = Math.abs(wy - STREETS[i].y); if (d < dS) dS = d; }
        if (dA < ROAD_W / 2 || dS < ROAD_W / 2) {
          const v = 0.92 + hash01(((wx >> 6) * 13 + (wy >> 6) * 29)) * 0.16;
          c = [ASPHALT[0] * v, ASPHALT[1] * v, ASPHALT[2] * v];
          if (dA < ROAD_W / 2 && dA <= dS) {
            if (dA > ROAD_W / 2 - 5) c = EDGE;
            else if (dA < 2.4 && ((wy >> 5) & 1) === 0) c = DASH;
          } else if (dS < ROAD_W / 2) {
            if (dS > ROAD_W / 2 - 5) c = EDGE;
            else if (dS < 2.4 && ((wx >> 5) & 1) === 0) c = DASH;
          }
        } else if (dA < ROAD_W / 2 + 16 || dS < ROAD_W / 2 + 16) {
          c = SIDEWALK;
        } else if (wx > PLAZA.x && wx < PLAZA.x + PLAZA.w && wy > PLAZA.y && wy < PLAZA.y + PLAZA.h) {
          c = PLAZA_C;
        } else if (wx > PARK.x && wx < PARK.x + PARK.w && wy > PARK.y && wy < PARK.y + PARK.h) {
          const ex = (wx - (PARK.x + PARK.w * 0.62)) / 42, ey = (wy - (PARK.y + PARK.h * 0.6)) / 24;
          c = ex * ex + ey * ey < 1 ? POND : LAWN;
        } else {
          const tone = GRASS[Math.floor(hash01((Math.floor(wx / 400)) * 3 + 1 + (Math.floor(wy / 400)) * 37) * GRASS.length) % GRASS.length];
          const v = 0.94 + hash01(((wx >> 6) * 7 + (wy >> 6) * 17)) * 0.12;
          c = [tone[0] * v, tone[1] * v, tone[2] * v];
        }
      }
      // Headlight pool ahead of the camera car + helicopter searchlight pool.
      let boost = 0;
      const lat = (x - COLS / 2) * (f / PLANE);
      if (f < 320 && Math.abs(lat) < 78) boost += headlight * (1 - f / 320) * (1 - Math.abs(lat) / 78);
      if (lightOn) {
        const dx = wx - heli.lightX, dy = wy - heli.lightY;
        const d2 = dx * dx + dy * dy;
        if (d2 < 95 * 95) boost += 0.85 * (1 - Math.sqrt(d2) / 95);
      }
      const m = shadeMul * (1 + boost);
      const r = clamp(c[0] * m, 0, 255), g = clamp(c[1] * m, 0, 255), b = clamp(c[2] * m, 0, 255);
      const i = (y * COLS + x) * 4;
      pix[i] = r + (sky.fog[0] - r) * fogT;
      pix[i + 1] = g + (sky.fog[1] - g) * fogT;
      pix[i + 2] = b + (sky.fog[2] - b) * fogT;
      pix[i + 3] = 255;
    }
  }

  // -- walls: one ray per column against the building AABBs
  const zbuf = new Float32Array(COLS).fill(MAX_DIST);
  for (let col = 0; col < COLS; col++) {
    const k = (col - COLS / 2) / PLANE;
    const dx = dirX + rightX * k, dy = dirY + rightY * k;
    let bestT = MAX_DIST, bestB = null, bestFace = 0;
    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      let tminX, tmaxX, tminY, tmaxY;
      if (Math.abs(dx) < 1e-9) { if (camX < b.x || camX > b.x + b.w) continue; tminX = -Infinity; tmaxX = Infinity; }
      else { const t1 = (b.x - camX) / dx, t2 = (b.x + b.w - camX) / dx; tminX = Math.min(t1, t2); tmaxX = Math.max(t1, t2); }
      if (Math.abs(dy) < 1e-9) { if (camY < b.y || camY > b.y + b.h) continue; tminY = -Infinity; tmaxY = Infinity; }
      else { const t1 = (b.y - camY) / dy, t2 = (b.y + b.h - camY) / dy; tminY = Math.min(t1, t2); tmaxY = Math.max(t1, t2); }
      const tmin = Math.max(tminX, tminY), tmax = Math.min(tmaxX, tmaxY);
      if (tmax < Math.max(tmin, 0) || tmin < 0.5 || tmin >= bestT) continue;
      bestT = tmin; bestB = b; bestFace = tminX > tminY ? 0 : 1;
    }
    if (!bestB) continue;
    zbuf[col] = bestT;
    const bH = heights[bestB.id];
    const topRow = Math.max(0, Math.floor(HORIZON - (bH - CAM_H) * PLANE / bestT));
    const botRow = Math.min(ROWS - 1, Math.ceil(HORIZON + CAM_H * PLANE / bestT));
    const hitX = camX + dx * bestT, hitY = camY + dy * bestT;
    const u = bestFace === 0 ? hitY : hitX;
    const base0 = rgb(bestB.color);
    const roofC = rgb(bestB.roof);
    const faceMul = bestFace === 0 ? 0.78 : 1.0;
    const shadeMul = sky.amb * faceMul * (0.30 + 0.70 / (1 + bestT * 0.0011));
    const fogT = Math.min(0.6, (bestT / MAX_DIST) * 0.6);
    // Per-building facade character, all seeded from the building id:
    // channel tint, window rhythm, a possible vertical neon strip, and
    // which shopfront bays glow — so no two frontages read alike.
    const bid = bestB.id;
    const base = [base0[0] * (0.86 + hash01(bid * 311) * 0.28), base0[1] * (0.88 + hash01(bid * 313) * 0.24), base0[2] * (0.86 + hash01(bid * 317) * 0.3)];
    const colW = 17 + Math.floor(hash01(bid * 41 + 5) * 9);
    const rowH = 21 + Math.floor(hash01(bid * 43 + 9) * 6);
    const winOff = hash01(bid * 47) * colW;
    const neonOn = hash01(bid * 53 + 1) < 0.42;
    const neonU = hash01(bid * 59) * 150;
    const neonC = hash01(bid * 61) < 0.5 ? [255, 113, 206] : [1, 205, 254];
    const winColSeed = Math.floor((u + winOff) / colW);
    for (let y = topRow; y <= botRow; y++) {
      const z = CAM_H + (HORIZON - y) * bestT / PLANE; // world height at this row
      let r, g, bl;
      if (z > bH - 3.5) {
        // Parapet cap: a bright roofline lip that separates the skyline.
        r = roofC[0] * shadeMul * 1.95; g = roofC[1] * shadeMul * 1.95; bl = roofC[2] * shadeMul * 1.95;
      } else if (z > bH - 14) {
        // Sign band: dark fascia with lit letter-blocks spelling rhythm.
        const seg = Math.floor((u + winOff) / 9), sf = ((u + winOff) % 9) / 9;
        if (sf < 0.62 && hash01(bid * 71 + seg * 13) < 0.55) { r = 255 * shadeMul * 1.45; g = 214 * shadeMul * 1.45; bl = 130 * shadeMul * 1.2; }
        else { r = roofC[0] * shadeMul * 1.3; g = roofC[1] * shadeMul * 1.3; bl = roofC[2] * shadeMul * 1.3; }
      } else if (neonOn && Math.abs(u - neonU) < 3.4 && z > 30) {
        // Vertical neon blade sign running down the frontage.
        r = neonC[0] * (shadeMul * 1.5 + 0.25); g = neonC[1] * (shadeMul * 1.5 + 0.25); bl = neonC[2] * (shadeMul * 1.5 + 0.25);
      } else if (z < 30) {
        // Ground floor: striped awning over glowing shopfront glass.
        if (z > 24) {
          const awn = Math.floor(u / 10) % 2 === 0 ? 1.45 : 0.85;
          r = roofC[0] * shadeMul * awn; g = roofC[1] * shadeMul * awn; bl = roofC[2] * shadeMul * awn;
        } else if (z < 3.5) {
          r = base[0] * shadeMul * 0.35; g = base[1] * shadeMul * 0.35; bl = base[2] * shadeMul * 0.35;
        } else {
          const bay = Math.floor((u + winOff) / (colW + 12)), bf = ((u + winOff) % (colW + 12)) / (colW + 12);
          if (bf > 0.07 && bf < 0.93) {
            if (hash01(bid * 83 + bay * 19) < 0.8) { const w = 0.85 + hash01(bid * 89 + bay * 3) * 0.4; r = 255 * shadeMul * w; g = 188 * shadeMul * w; bl = 104 * shadeMul * w; }
            else { r = base[0] * shadeMul * 0.42; g = base[1] * shadeMul * 0.5; bl = base[2] * shadeMul * 0.72; }
          } else { r = base[0] * shadeMul * 0.4; g = base[1] * shadeMul * 0.4; bl = base[2] * shadeMul * 0.4; }
        }
      } else {
        const band = Math.floor(z / rowH);
        const rowF = (z - band * rowH) / rowH, colF = ((u + winOff) % colW) / colW;
        const inWin = colF > 0.22 && colF < 0.78 && rowF > 0.24 && rowF < 0.8;
        if (inWin) {
          const wh = hash01(bid * 131 + band * 17 + winColSeed * 7);
          if (wh < sky.lit) {
            // Lit window: warm or cool by hash, some half-blinded.
            if (hash01(bid * 137 + band * 5 + winColSeed) < 0.25 && rowF > 0.55) { r = base[0] * shadeMul * 0.55; g = base[1] * shadeMul * 0.55; bl = base[2] * shadeMul * 0.6; }
            else if (hash01(bid * 139 + band + winColSeed * 3) < 0.3) { r = 168 * shadeMul * 1.2; g = 204 * shadeMul * 1.2; bl = 255 * shadeMul * 1.1; }
            else { r = 255 * shadeMul * 1.15; g = 196 * shadeMul * 1.15; bl = 104 * shadeMul; }
          } else { r = base[0] * shadeMul * 0.5; g = base[1] * shadeMul * 0.5; bl = base[2] * shadeMul * 0.66; }
        } else {
          // Wall: vertical gradient, floor slab lines, pilaster shadows.
          let gradMul = 0.82 + 0.18 * clamp(z / bH, 0, 1);
          if (rowF < 0.07) gradMul *= 0.78;
          if (((u + winOff) % 92) < 5) gradMul *= 0.7;
          r = base[0] * shadeMul * gradMul; g = base[1] * shadeMul * gradMul; bl = base[2] * shadeMul * gradMul;
        }
      }
      const i = (y * COLS + col) * 4;
      pix[i] = clamp(r + (sky.fog[0] - r) * fogT, 0, 255);
      pix[i + 1] = clamp(g + (sky.fog[1] - g) * fogT, 0, 255);
      pix[i + 2] = clamp(bl + (sky.fog[2] - bl) * fogT, 0, 255);
      pix[i + 3] = 255;
    }
  }

  // -- composite the low-res frame, then draw in screen space
  offCtx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, VIEW_W, VIEW_H);

  // Sun / moon disc + glow, when it sits inside the view cone.
  const sunRel = angleDiff(sky.sunAz, car.angle);
  if (Math.abs(sunRel) < 1.05) {
    const sx = VIEW_W / 2 + Math.tan(sunRel) * PLANE * SCALE;
    const sy = (HORIZON - sky.sunEl * 120) * SCALE;
    const glowR = sky.glow * (phaseName === 'day' ? 0.7 : 1.6);
    const grad = ctx.createRadialGradient(sx, sy, 4, sx, sy, glowR);
    grad.addColorStop(0, `rgba(${sky.sun[0]},${sky.sun[1]},${sky.sun[2]},0.85)`);
    grad.addColorStop(0.25, `rgba(${sky.sun[0]},${sky.sun[1]},${sky.sun[2]},0.35)`);
    grad.addColorStop(1, 'rgba(255,160,80,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);
    ctx.fillStyle = `rgb(${sky.sun[0]},${sky.sun[1]},${sky.sun[2]})`;
    ctx.beginPath(); ctx.arc(sx, sy, phaseName === 'night' ? 17 : 30, 0, Math.PI * 2); ctx.fill();
  }

  // Project world points into screen space (internal pixels).
  const project = (x, y, z) => {
    const rx = x - camX, ry = y - camY;
    const fwd = rx * dirX + ry * dirY;
    if (fwd < 8) return null;
    const lat = rx * rightX + ry * rightY;
    return {
      sx: COLS / 2 + (lat / fwd) * PLANE,
      row: HORIZON + ((CAM_H - z) * PLANE) / fwd,
      dist: fwd,
    };
  };

  // Shared ground-plane contact shadow: an ellipse projected onto the
  // ground plane at (x, y, 0) — centre at the projected point, width
  // wWorld * PLANE / dist in screen px, height ~0.22 of the width. It is
  // drawn only when the actor's centre column passes the z-test
  // (dist <= zbuf[centre col] + 6), so the shadow of a building-occluded
  // actor never leaks through the facade.
  const drawGroundShadow = (x, y, wWorld, alpha) => {
    const p = project(x, y, 0);
    if (!p || p.dist > MAX_DIST) return;
    const col = Math.max(0, Math.min(COLS - 1, Math.floor(p.sx)));
    if (p.dist > zbuf[col] + 6) return;
    const w = (wWorld * PLANE / p.dist) * SCALE;
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath(); ctx.ellipse(p.sx * SCALE, p.row * SCALE, w / 2, w * 0.11, 0, 0, Math.PI * 2); ctx.fill();
  };

  // -- helicopter searchlight cone (under the sprites)
  if (lightOn) {
    const hp = project(heli.x, heli.y, HELI_ALT);
    const lp = project(heli.lightX, heli.lightY, 0);
    if (hp && lp) {
      const hx = hp.sx * SCALE, hy = hp.row * SCALE;
      const lx = lp.sx * SCALE, ly = lp.row * SCALE;
      const lr = Math.max(10, (95 * PLANE / lp.dist) * SCALE);
      const grad = ctx.createLinearGradient(hx, hy, lx, ly);
      grad.addColorStop(0, 'rgba(255,244,190,0.16)');
      grad.addColorStop(1, 'rgba(255,244,190,0.05)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(lx - lr, ly);
      ctx.lineTo(lx + lr, ly);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,246,200,0.13)';
      ctx.beginPath(); ctx.ellipse(lx, ly, lr, lr * 0.36, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // -- spike strips on the road surface
  for (const s of world.spikes || []) {
    const p = project(s.x, s.y, 0);
    if (!p || p.dist > MAX_DIST) continue;
    const w = (52 * PLANE / p.dist);
    if (p.sx < -w || p.sx > COLS + w) continue;
    ctx.fillStyle = 'rgba(14,16,20,0.92)';
    ctx.fillRect((p.sx - w / 2) * SCALE, p.row * SCALE - 2, w * SCALE, Math.max(3, SCALE * 1.1));
    ctx.fillStyle = '#e8eef4';
    const n = 8;
    for (let i = 0; i < n; i++) ctx.fillRect((p.sx - w / 2 + (i + 0.5) * (w / n)) * SCALE - 1, p.row * SCALE - 6, 3, 5);
    ctx.fillStyle = '#ff4757';
    for (let i = 0; i < n; i += 2) ctx.fillRect((p.sx - w / 2 + (i + 0.5) * (w / n)) * SCALE - 1, p.row * SCALE + 1, 3, 2);
  }

  // -- billboards, far to near
  const sprites = [];
  for (const other of world.cars) {
    if (other === car) continue;
    const p = project(other.x, other.y, 0);
    if (p && p.dist < MAX_DIST) sprites.push({ kind: 'car', obj: other, p });
  }
  for (const pc of parkedCars()) {
    // Kerb dressing never overlaps a live vehicle: a parked car is
    // skipped while any simulated car is right at its spot, so the two
    // can never be drawn interpenetrating each other.
    if (world.cars.some((c) => Math.abs(c.x - pc.x) < 80 && Math.abs(c.y - pc.y) < 80)) continue;
    const p = project(pc.x, pc.y, 0);
    if (p && p.dist < MAX_DIST) sprites.push({ kind: 'car', obj: pc, p });
  }
  for (const pr of world.city.props) {
    const p = project(pr.x, pr.y, 0);
    if (p && p.dist < 720) sprites.push({ kind: 'prop', obj: pr, p });
  }
  for (const ped of world.peds) {
    if (ped.down > 0) continue;
    const p = project(ped.x, ped.y, 0);
    if (p && p.dist < 620) sprites.push({ kind: 'ped', obj: ped, p });
  }
  for (const m of world.crewMembers) {
    const p = project(m.x, m.y, 0);
    if (p && p.dist < 620) sprites.push({ kind: 'crew', obj: m, p });
  }
  if (lightOn) {
    const p = project(heli.x, heli.y, HELI_ALT);
    if (p) sprites.push({ kind: 'heli', obj: heli, p });
  }
  sprites.sort((a, b) => b.p.dist - a.p.dist);
  for (const s of sprites) {
    if (s.kind === 'car') {
      const c = s.obj;
      const rel = angleDiff(c.angle, car.angle);
      const cosR = Math.cos(rel), sinR = Math.sin(rel);
      const wWorld = Math.abs(cosR) * 30 + Math.abs(sinR) * 46;
      const wPix = (wWorld * PLANE) / s.p.dist;
      // Always the 3/4 volume sprite; flip mirrors its side face.
      const spr = carSprite(c.color, c.police, cosR < 0, c.disabled);
      const flip = sinR < 0;
      if (s.p.sx < -wPix || s.p.sx > COLS + wPix) continue;
      drawGroundShadow(c.x, c.y, wWorld, 0.38);
      drawBillboard(ctx, spr, s.p.sx, s.p.row, wPix, s.p.dist, zbuf, flip);
      // Siren flashers washing the road around a live police car.
      if (c.police && !c.disabled && s.p.dist < 420) {
        const flash = Math.sin(world.time * 11 + c.id) > 0 ? 'rgba(255,107,129,0.20)' : 'rgba(1,205,254,0.20)';
        ctx.fillStyle = flash;
        ctx.beginPath();
        ctx.ellipse(s.p.sx * SCALE, s.p.row * SCALE, wPix * SCALE * 0.75, wPix * SCALE * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (s.kind === 'prop') {
      const pr = s.obj;
      const lit = phaseName === 'dusk' || phaseName === 'night' || phaseName === 'dawn';
      const spr = propSprite(pr.kind, lit && pr.kind === 'lamp');
      const wPix = ((PROP_W[pr.kind] || 12) * PLANE) / s.p.dist;
      if (s.p.sx < -wPix || s.p.sx > COLS + wPix) continue;
      drawBillboard(ctx, spr, s.p.sx, s.p.row, wPix, s.p.dist, zbuf, false);
    } else if (s.kind === 'ped' || s.kind === 'crew') {
      const shirt = s.kind === 'ped' ? s.obj.shirt : '#7deeff';
      const wPix = (9.5 * PLANE) / s.p.dist;
      if (s.p.sx < -wPix || s.p.sx > COLS + wPix) continue;
      drawGroundShadow(s.obj.x, s.obj.y, 11, 0.30);
      drawBillboard(ctx, pedSprite(shirt), s.p.sx, s.p.row, wPix, s.p.dist, zbuf, false);
      if (s.kind === 'crew' && s.obj.hasBag) {
        ctx.fillStyle = '#01cdfe';
        const bw = Math.max(3, wPix * SCALE * 0.5);
        ctx.fillRect(s.p.sx * SCALE + bw * 0.4, (s.p.row * SCALE) - wPix * SCALE * (110 / 44) * 0.55, bw, bw * 0.8);
      }
    } else if (s.kind === 'heli') {
      const wPix = (98 * PLANE) / s.p.dist;
      if (s.p.sx < -wPix || s.p.sx > COLS + wPix) continue;
      // The body flies at HELI_ALT, but its shadow sits on the ground
      // plane, offset in world space AWAY from the sun by ~55 units
      // along the current sky's sun azimuth.
      drawGroundShadow(heli.x - Math.cos(sky.sunAz) * 55, heli.y - Math.sin(sky.sunAz) * 55, 100, 0.28);
      // The heli flies above the rooftops: no z-buffer clipping.
      const spr = heliSprite();
      const hPix = wPix * (spr.height / spr.width);
      ctx.drawImage(spr, (s.p.sx - wPix / 2) * SCALE, (s.p.row - hPix / 2) * SCALE, wPix * SCALE, hPix * SCALE);
    }
  }

  // -- speed streaks on the road, the hero car, edge streaks, vignette
  drawSpeedStreaks(ctx, world, 'road');
  drawHeroCar(ctx, world, car, project, drawGroundShadow);
  drawSpeedStreaks(ctx, world, 'edge');
  if (phaseName === 'dusk' || phaseName === 'night') {
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.44, VIEW_H * 0.36, VIEW_W / 2, VIEW_H * 0.5, VIEW_H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, phaseName === 'night' ? 'rgba(2,4,12,0.42)' : 'rgba(24,6,20,0.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  ctx.restore();
}
