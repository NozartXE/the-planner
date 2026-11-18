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
  day:   { top: [58, 120, 205], hor: [178, 224, 242], fog: [178, 224, 242], amb: 1.0,  lit: 0.06, sunAz: 0.9,  sunEl: 0.62, sun: [255, 244, 200], glow: 60 },
  dawn:  { top: [74, 66, 140],  hor: [242, 166, 90],  fog: [226, 150, 96],  amb: 0.86, lit: 0.30, sunAz: 0.0,  sunEl: 0.10, sun: [255, 196, 110], glow: 150 },
  dusk:  { top: [46, 34, 92],   hor: [255, 140, 90],  fog: [214, 116, 84],  amb: 0.80, lit: 0.48, sunAz: Math.PI, sunEl: 0.07, sun: [255, 178, 84], glow: 190 },
  night: { top: [5, 8, 24],     hor: [26, 40, 74],    fog: [20, 30, 56],    amb: 0.46, lit: 0.62, sunAz: 2.2,  sunEl: 0.42, sun: [214, 226, 245], glow: 26 },
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
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.beginPath(); g.ellipse(74, 80, 70, 7, 0, 0, Math.PI * 2); g.fill();
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
    g.fillStyle = '#ff3355'; g.fillRect(52, 6, 22, 7);
    g.fillStyle = '#3388ff'; g.fillRect(74, 6, 22, 7);
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
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath(); g.ellipse(22, 105, 15, 4, 0, 0, Math.PI * 2); g.fill();
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
    g.strokeStyle = '#7a5c38'; g.lineWidth = 7; g.beginPath(); g.moveTo(40, 130); g.quadraticCurveTo(46, 84, 54, 44); g.stroke();
    g.strokeStyle = '#2e8b47'; g.lineWidth = 5;
    for (let i = 0; i < 6; i++) { const a = -0.25 - i * 0.5; g.beginPath(); g.moveTo(54, 42); g.quadraticCurveTo(54 + Math.cos(a) * 26, 42 + Math.sin(a) * 20 - 8, 54 + Math.cos(a) * 44, 42 + Math.sin(a) * 34 + 12); g.stroke(); }
    g.fillStyle = '#5d8143'; g.beginPath(); g.arc(50, 46, 5, 0, Math.PI * 2); g.arc(59, 47, 5, 0, Math.PI * 2); g.fill();
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
    g.fillStyle = '#ff7b1c'; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(6 + i * 17, 25); g.lineTo(15 + i * 17, 8); g.lineTo(22 + i * 17, 8); g.lineTo(13 + i * 17, 25); g.closePath(); g.fill(); }
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
const PARKED_COLORS = ['#c0c6ce', '#7a4a2b', '#33566e', '#6e3333', '#3f6e46', '#8c8f57', '#4a3f66', '#b8b0a4'];
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
function heliSprite() {
  let c = spriteCache.get('heli');
  if (c) return c;
  c = makeCanvas(210, 76);
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(190,205,220,0.55)'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(2, 8); g.lineTo(180, 8); g.stroke();
  g.fillStyle = '#22262e'; g.fillRect(86, 8, 6, 10);
  g.fillStyle = '#2b2f38'; g.fillRect(118, 30, 78, 8);
  g.fillStyle = '#2b2f38'; g.beginPath(); g.roundRect(24, 16, 92, 36, 17); g.fill();
  g.fillStyle = '#9fd8ef'; g.beginPath(); g.roundRect(30, 22, 32, 22, 9); g.fill();
  g.fillStyle = '#eef1f5'; g.font = '900 13px system-ui, sans-serif'; g.fillText('POLICE', 66, 40);
  g.fillStyle = '#2b2f38'; g.fillRect(192, 14, 8, 30);
  g.fillStyle = '#ff3355'; g.beginPath(); g.arc(196, 12, 4, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#14161a'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(34, 62); g.lineTo(108, 62); g.stroke();
  g.beginPath(); g.moveTo(44, 52); g.lineTo(40, 62); g.moveTo(98, 52); g.lineTo(102, 62); g.stroke();
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

// The player's own car, drawn large at bottom-centre as a detailed rear
// three-quarter chase hero: spoiler, glowing tail bar, exhausts, plate.
function drawHeroCar(ctx, world, car) {
  const W = VIEW_W, H = VIEW_H;
  const lean = clamp(car.steer || 0, -1, 1) * 26;
  const bounce = Math.sin(world.time * 27) * Math.min(2.2, Math.abs(car.speed) / 130);
  const cx = W / 2 + lean, base = H - 6 + bounce;
  const w = 452, top = base - 218;
  ctx.save();
  ctx.translate(cx, 0);
  // Ground shadow + headlight wash on the road ahead (drawn as glow at base).
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(0, base - 8, w * 0.56, 26, 0, 0, Math.PI * 2); ctx.fill();
  // Wheels.
  ctx.fillStyle = '#0c0e11';
  ctx.beginPath(); ctx.roundRect(-w / 2 - 8, base - 74, 44, 72, 10); ctx.fill();
  ctx.beginPath(); ctx.roundRect(w / 2 - 36, base - 74, 44, 72, 10); ctx.fill();
  // Body with a vertical paint gradient.
  const grad = ctx.createLinearGradient(0, top, 0, base);
  grad.addColorStop(0, shadeOf(car.color, 1.22));
  grad.addColorStop(0.5, shadeOf(car.color, 0.98));
  grad.addColorStop(1, shadeOf(car.color, 0.58));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-w / 2, base - 6);
  ctx.lineTo(-w / 2 + 6, top + 74);
  ctx.quadraticCurveTo(-w / 2 + 10, top + 40, -w * 0.31, top + 30);
  ctx.lineTo(w * 0.31, top + 30);
  ctx.quadraticCurveTo(w / 2 - 10, top + 40, w / 2 - 6, top + 74);
  ctx.lineTo(w / 2, base - 6);
  ctx.closePath(); ctx.fill();
  // Cabin + rear glass.
  ctx.fillStyle = shadeOf(car.color, 0.72);
  ctx.beginPath(); ctx.roundRect(-w * 0.30, top + 2, w * 0.60, 52, 16); ctx.fill();
  ctx.fillStyle = '#0d1320';
  ctx.beginPath(); ctx.roundRect(-w * 0.265, top + 9, w * 0.53, 38, 12); ctx.fill();
  ctx.fillStyle = 'rgba(160,210,255,0.30)';
  ctx.beginPath(); ctx.roundRect(-w * 0.24, top + 12, w * 0.20, 12, 6); ctx.fill();
  // Spoiler on struts.
  ctx.fillStyle = '#14161c';
  ctx.fillRect(-w * 0.20, top + 44, 12, 26); ctx.fillRect(w * 0.20 - 12, top + 44, 12, 26);
  ctx.beginPath(); ctx.roundRect(-w * 0.44, top + 30, w * 0.88, 15, 7); ctx.fill();
  // Full-width tail-light bar, glowing.
  ctx.fillStyle = 'rgba(255,32,56,0.35)';
  ctx.beginPath(); ctx.roundRect(-w * 0.435, base - 118, w * 0.87, 21, 9); ctx.fill();
  ctx.fillStyle = '#ff2438';
  ctx.beginPath(); ctx.roundRect(-w * 0.42, base - 113, w * 0.84, 11, 5); ctx.fill();
  ctx.fillStyle = '#ffd7dc';
  ctx.beginPath(); ctx.roundRect(-w * 0.42, base - 113, w * 0.84, 4, 2); ctx.fill();
  // Badge + plate.
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '800 15px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(car.spec ? car.spec.name : 'GETAWAY', 0, base - 84);
  ctx.fillStyle = '#e8ecf1';
  ctx.beginPath(); ctx.roundRect(-37, base - 72, 74, 27, 4); ctx.fill();
  ctx.fillStyle = '#1c2733'; ctx.font = '900 17px system-ui, sans-serif';
  ctx.fillText('PLNR·6', 0, base - 53);
  // Exhausts, with a deterministic flame flicker at speed.
  ctx.fillStyle = '#22262e';
  ctx.beginPath(); ctx.arc(-w * 0.30, base - 22, 10, 0, Math.PI * 2); ctx.arc(w * 0.30, base - 22, 10, 0, Math.PI * 2); ctx.fill();
  if (Math.abs(car.speed) > 200) {
    const fl = 8 + Math.sin(world.time * 41) * 4;
    ctx.fillStyle = 'rgba(255,150,40,0.75)';
    ctx.beginPath(); ctx.ellipse(-w * 0.30, base - 22 + fl * 0.4, 5, fl, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w * 0.30, base - 22 + fl * 0.4, 5, fl, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Damage smoke curling off the rear deck.
  if (car.health < car.maxHealth * 0.4) {
    ctx.fillStyle = 'rgba(120,124,132,0.4)';
    for (let i = 0; i < 3; i++) {
      const ph = (world.time * 0.9 + i * 0.33) % 1;
      ctx.beginPath(); ctx.arc(-40 + i * 34 + Math.sin(world.time * 3 + i) * 8, top + 20 - ph * 66, 10 + ph * 22, 0, Math.PI * 2); ctx.fill();
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
    const neonC = hash01(bid * 61) < 0.5 ? [255, 64, 170] : [64, 220, 255];
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
      drawBillboard(ctx, spr, s.p.sx, s.p.row, wPix, s.p.dist, zbuf, flip);
      // Siren flashers washing the road around a live police car.
      if (c.police && !c.disabled && s.p.dist < 420) {
        const flash = Math.sin(world.time * 11 + c.id) > 0 ? 'rgba(255,51,85,0.20)' : 'rgba(51,136,255,0.20)';
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
      const shirt = s.kind === 'ped' ? s.obj.shirt : '#06d6a0';
      const wPix = (9.5 * PLANE) / s.p.dist;
      if (s.p.sx < -wPix || s.p.sx > COLS + wPix) continue;
      drawBillboard(ctx, pedSprite(shirt), s.p.sx, s.p.row, wPix, s.p.dist, zbuf, false);
      if (s.kind === 'crew' && s.obj.hasBag) {
        ctx.fillStyle = '#06d6a0';
        const bw = Math.max(3, wPix * SCALE * 0.5);
        ctx.fillRect(s.p.sx * SCALE + bw * 0.4, (s.p.row * SCALE) - wPix * SCALE * (110 / 44) * 0.55, bw, bw * 0.8);
      }
    } else if (s.kind === 'heli') {
      const wPix = (98 * PLANE) / s.p.dist;
      if (s.p.sx < -wPix || s.p.sx > COLS + wPix) continue;
      // The heli flies above the rooftops: no z-buffer clipping.
      const spr = heliSprite();
      const hPix = wPix * (spr.height / spr.width);
      ctx.drawImage(spr, (s.p.sx - wPix / 2) * SCALE, (s.p.row - hPix / 2) * SCALE, wPix * SCALE, hPix * SCALE);
      ctx.strokeStyle = 'rgba(200,214,228,0.5)'; ctx.lineWidth = 3;
      const rx = (s.p.sx) * SCALE, ry = (s.p.row - hPix * 0.32) * SCALE;
      const ra = (world.time * 31) % Math.PI;
      ctx.beginPath();
      ctx.moveTo(rx - Math.cos(ra) * wPix * SCALE * 0.42, ry - Math.sin(ra) * 5);
      ctx.lineTo(rx + Math.cos(ra) * wPix * SCALE * 0.42, ry + Math.sin(ra) * 5);
      ctx.stroke();
    }
  }

  // -- the hero car, then a light dusk vignette to seat the frame
  drawHeroCar(ctx, world, car);
  if (phaseName === 'dusk' || phaseName === 'night') {
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.44, VIEW_H * 0.36, VIEW_W / 2, VIEW_H * 0.5, VIEW_H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, phaseName === 'night' ? 'rgba(2,4,12,0.42)' : 'rgba(24,6,20,0.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  ctx.restore();
}
