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
// Rear or front view of a car in the given body colour.
function carSprite(color, police, front, disabled) {
  const key = `car|${color}|${police ? 1 : 0}|${front ? 1 : 0}|${disabled ? 1 : 0}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = makeCanvas(132, 74);
  const g = c.getContext('2d');
  const body = disabled ? '#555b66' : color;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath(); g.ellipse(66, 66, 58, 7, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#14161a';
  g.fillRect(4, 44, 17, 24); g.fillRect(111, 44, 17, 24); // wheels
  const grad = g.createLinearGradient(0, 14, 0, 62);
  grad.addColorStop(0, shadeOf(body, 1.18)); grad.addColorStop(0.55, shadeOf(body, 0.95)); grad.addColorStop(1, shadeOf(body, 0.62));
  g.fillStyle = grad;
  g.beginPath(); g.roundRect(9, 20, 114, 42, 9); g.fill();
  g.fillStyle = shadeOf(body, 0.78); // cabin
  g.beginPath(); g.roundRect(29, 5, 74, 24, 8); g.fill();
  g.fillStyle = '#0e1420'; // glass
  g.beginPath(); g.roundRect(35, 9, 62, 16, 6); g.fill();
  g.fillStyle = 'rgba(160,210,255,0.35)';
  g.fillRect(38, 10, 24, 5);
  if (police) {
    g.fillStyle = '#eef1f5'; g.fillRect(9, 30, 114, 15);
    g.fillStyle = '#16233d'; g.font = '900 11px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('POLICE', 66, 42);
    g.fillStyle = '#ff3355'; g.fillRect(42, 0, 24, 7);
    g.fillStyle = '#3388ff'; g.fillRect(66, 0, 24, 7);
  }
  if (front) {
    g.fillStyle = '#fff3b0';
    g.beginPath(); g.arc(26, 42, 7, 0, Math.PI * 2); g.arc(106, 42, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,243,176,0.35)';
    g.beginPath(); g.arc(26, 42, 12, 0, Math.PI * 2); g.arc(106, 42, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#22262e'; g.fillRect(48, 44, 36, 8);
  } else {
    g.fillStyle = '#ff2038'; g.fillRect(13, 36, 27, 7); g.fillRect(92, 36, 27, 7);
    g.fillStyle = 'rgba(255,32,56,0.4)'; g.fillRect(11, 34, 31, 11); g.fillRect(90, 34, 31, 11);
    g.fillStyle = '#dfe3e8'; g.fillRect(54, 46, 24, 10);
    g.fillStyle = '#39404c'; g.fillRect(58, 49, 16, 2);
  }
  if (disabled) { g.fillStyle = 'rgba(20,20,24,0.45)'; g.fillRect(0, 0, 132, 74); }
  spriteCache.set(key, c);
  return c;
}
// Side profile of a car (used when it crosses the view).
function carSideSprite(color, police, disabled) {
  const key = `side|${color}|${police ? 1 : 0}|${disabled ? 1 : 0}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = makeCanvas(176, 58);
  const g = c.getContext('2d');
  const body = disabled ? '#555b66' : color;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath(); g.ellipse(88, 52, 82, 6, 0, 0, Math.PI * 2); g.fill();
  const grad = g.createLinearGradient(0, 12, 0, 46);
  grad.addColorStop(0, shadeOf(body, 1.15)); grad.addColorStop(1, shadeOf(body, 0.6));
  g.fillStyle = grad;
  g.beginPath(); g.roundRect(5, 18, 166, 27, 10); g.fill();
  g.fillStyle = shadeOf(body, 0.8);
  g.beginPath(); g.roundRect(56, 5, 66, 19, 8); g.fill();
  g.fillStyle = '#0e1420';
  g.beginPath(); g.roundRect(62, 8, 54, 13, 5); g.fill();
  if (police) {
    g.fillStyle = '#eef1f5'; g.fillRect(5, 27, 166, 11);
    g.fillStyle = '#ff3355'; g.fillRect(76, 0, 13, 6);
    g.fillStyle = '#3388ff'; g.fillRect(89, 0, 13, 6);
  }
  g.fillStyle = '#fff3b0'; g.fillRect(166, 26, 6, 7);
  g.fillStyle = '#ff2038'; g.fillRect(4, 26, 5, 7);
  g.fillStyle = '#101216';
  g.beginPath(); g.arc(38, 45, 12, 0, Math.PI * 2); g.arc(138, 45, 12, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#8b939e';
  g.beginPath(); g.arc(38, 45, 5, 0, Math.PI * 2); g.arc(138, 45, 5, 0, Math.PI * 2); g.fill();
  if (disabled) { g.fillStyle = 'rgba(20,20,24,0.45)'; g.fillRect(0, 0, 176, 58); }
  spriteCache.set(key, c);
  return c;
}
function pedSprite(shirt) {
  const key = `ped|${shirt}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = makeCanvas(36, 108);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath(); g.ellipse(18, 103, 13, 4, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#23262e'; g.fillRect(9, 58, 7, 42); g.fillRect(20, 58, 7, 42);
  g.fillStyle = shadeOf(shirt, 0.85); g.fillRect(4, 26, 6, 30); g.fillRect(26, 26, 6, 30);
  g.fillStyle = shirt;
  g.beginPath(); g.roundRect(8, 23, 20, 37, 6); g.fill();
  g.fillStyle = '#e8b08a';
  g.beginPath(); g.arc(18, 13, 9, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2b2118'; g.beginPath(); g.arc(18, 9, 9, Math.PI, Math.PI * 2); g.fill();
  spriteCache.set(key, c);
  return c;
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
    const base = rgb(bestB.color);
    const roofC = rgb(bestB.roof);
    const faceMul = bestFace === 0 ? 0.78 : 1.0;
    const shadeMul = sky.amb * faceMul * (0.30 + 0.70 / (1 + bestT * 0.0011));
    const fogT = Math.min(0.6, (bestT / MAX_DIST) * 0.6);
    const winColSeed = Math.floor(u / 21);
    for (let y = topRow; y <= botRow; y++) {
      const z = CAM_H + (HORIZON - y) * bestT / PLANE; // world height at this row
      let r, g, bl;
      if (z > bH - 15 && z < bH - 4) {
        // Sign band near the roofline, in the building's roof colour.
        r = roofC[0] * shadeMul * 1.5; g = roofC[1] * shadeMul * 1.5; bl = roofC[2] * shadeMul * 1.5;
      } else {
        const band = Math.floor(z / 24);
        const inWinCol = (u - winColSeed * 21) > 5 && (u - winColSeed * 21) < 16;
        const inWinRow = (z - band * 24) > 6 && (z - band * 24) < 18;
        if (inWinCol && inWinRow && band >= 0) {
          const lit = hash01(bestB.id * 131 + band * 17 + winColSeed * 7) < sky.lit;
          if (lit) { r = 255 * shadeMul * 1.15; g = 196 * shadeMul * 1.15; bl = 104 * shadeMul; }
          else { r = base[0] * shadeMul * 0.5; g = base[1] * shadeMul * 0.5; bl = base[2] * shadeMul * 0.62; }
        } else {
          const gradMul = 0.82 + 0.18 * clamp(z / bH, 0, 1);
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
      const wWorld = Math.abs(cosR) * 26 + Math.abs(sinR) * 48;
      const wPix = (wWorld * PLANE) / s.p.dist;
      let spr, flip = false;
      if (Math.abs(sinR) > 0.72) { spr = carSideSprite(c.color, c.police, c.disabled); flip = sinR < 0; }
      else spr = carSprite(c.color, c.police, cosR < 0, c.disabled);
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
    } else if (s.kind === 'ped' || s.kind === 'crew') {
      const shirt = s.kind === 'ped' ? s.obj.shirt : '#06d6a0';
      const wPix = (9.5 * PLANE) / s.p.dist;
      if (s.p.sx < -wPix || s.p.sx > COLS + wPix) continue;
      drawBillboard(ctx, pedSprite(shirt), s.p.sx, s.p.row, wPix, s.p.dist, zbuf, false);
      if (s.kind === 'crew' && s.obj.hasBag) {
        ctx.fillStyle = '#06d6a0';
        const bw = Math.max(3, wPix * SCALE * 0.5);
        ctx.fillRect(s.p.sx * SCALE + bw * 0.4, (s.p.row * SCALE) - wPix * SCALE * (108 / 36) * 0.52, bw, bw * 0.8);
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
