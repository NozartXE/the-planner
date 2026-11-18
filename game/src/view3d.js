// view3d.js — TRUE 3D renderer for THE PLANNER (San Andreas-style rebuild).
// Original projected-polygon renderer, vanilla canvas 2D, no libraries:
// every face is a world-space polygon transformed into camera space
// (third-person camera basis: right / up / forward), clipped against the
// near plane, perspective-divided onto the full 1280x800 canvas, shaded
// from ONE consistent sun direction, fogged toward the sky's fog colour,
// and drawn far-to-near (painter's algorithm). It only READS world
// state — the simulation is untouched — and every variation is a
// deterministic hash, never Math.random / Date.now, so screenshot
// staging stays perfectly reproducible.
//
// PHASE 2 (realism pass, Rect 2026-11-18 20:47–20:49): a render-side
// colour grade desaturates every world colour toward sun-baked earthy
// tones; tall faces shade with a vertical gradient + ground-contact AO;
// buildings, cars and figures cast long dusk shadows from the one sun;
// figures are rebuilt on slimmer human proportions; cars gain tapered
// cabins, sloped hoods, wheel arches, mirrors and door seams; palms are
// broad drooping frond planes; facade windows are inset and framed
// (with guards against embedded and camera-hugging faces); the camera
// sits LOW behind the subject, GTA-style, and near buildings letter
// their real sign word on the fascia.
//
// The world is built from real volumes: buildings are boxes with two
// facades + roof visible at once, cars are procedural box models, and
// people are articulated multi-part figures (head + hair, torso, two
// two-segment arms, two two-segment legs) posed per state — walking
// figures are caught mid-stride, the player aims with both arms.
import { VIEW_W, VIEW_H, ROAD_W, RIVER_Y } from './config.js';
import { AVENUES, STREETS, PLAZA, PARK, collideWorld, insideBuilding } from './city.js';
import { clamp } from './rng.js';

const FOV = 1.10; // ~63 degrees
const FOCAL = (VIEW_W / 2) / Math.tan(FOV / 2);
const NEAR = 6;
const MAX_DIST = 1500;
const HELI_ALT = 135;

// Deterministic 0..1 hash of small integers (render-only variation).
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

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

// Per time-of-day look — PHASE 2 realism grade: natural late-afternoon
// light (warm key, cooler sky fill), grounded haze instead of the flat
// cartoon purple/pink skies of phase 1.
const SKIES = {
  day:   { top: [86, 132, 178], hor: [198, 214, 220], fog: [186, 198, 202], amb: 0.96, lit: 0.06, sunAz: 0.9,  sunEl: 0.62, sun: [255, 240, 205] },
  dawn:  { top: [88, 94, 130],  hor: [233, 166, 118], fog: [208, 162, 134], amb: 0.84, lit: 0.28, sunAz: 0.0,  sunEl: 0.11, sun: [255, 192, 116] },
  dusk:  { top: [72, 84, 128],  hor: [240, 160, 102], fog: [200, 152, 126], amb: 0.78, lit: 0.42, sunAz: Math.PI, sunEl: 0.09, sun: [255, 174, 92] },
  night: { top: [13, 17, 36],   hor: [44, 48, 70],    fog: [35, 37, 56],    amb: 0.46, lit: 0.62, sunAz: 2.2,  sunEl: 0.42, sun: [210, 220, 240] },
};
// Grounded, sun-baked ground tones (dry olive grass, warm concrete) —
// the saturated cartoon greens/blues of phase 1 are gone.
const GRASS = ['#5c7247', '#546b42', '#637652', '#576a4b', '#5f7451', '#6f7268', '#7a7d72'].map(rgb);
const ASPHALT = [52, 52, 57], SIDEWALK = [139, 134, 126], DASH = [226, 196, 118];
const EDGE = [188, 186, 178], SAND = [208, 184, 140], WATER = [36, 84, 108];
const PLAZA_C = [137, 129, 117], LAWN = [74, 102, 60], POND = [52, 102, 128];

// PHASE 2 colour grade (brief A): every world colour is desaturated and
// pulled toward earthy, sun-baked tones BEFORE shading, so the bright
// flat data colours (city.js / heists.js, untouched) never reach the
// screen raw. Emissive faces (light factor >= 1.2: lamps, tail lights,
// neon) skip the grade so signals still read.
const gradeCache = new Map();
function gradeCol(c) {
  const key = (c[0] << 16) | (c[1] << 8) | c[2];
  let g = gradeCache.get(key);
  if (!g) {
    const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const sat = 0.30; // pull 30% toward luminance
    g = [
      clamp((c[0] + (lum - c[0]) * sat) * 1.04, 0, 255),
      clamp((c[1] + (lum - c[1]) * sat) * 0.97, 0, 255),
      clamp((c[2] + (lum - c[2]) * sat) * 0.86, 0, 255),
    ];
    gradeCache.set(key, g);
  }
  return g;
}

const KIND_TALL = { casino: 96, bank: 74, office: 84, data: 62, hotel: 72, flats: 64, museum: 34, club: 24, civic: 30, police: 44 };
function buildingHeight(b) {
  return 96 + hash01(b.id * 7 + 3) * 128 + (KIND_TALL[b.kind] || 26);
}

// Render-only kerb-parked cars, derived deterministically from the road
// grid (seeded hashes): street dressing that never touches the sim.
const PARKED_COLORS = ['#c9b6a2', '#a3866f', '#7e939e', '#a8838e', '#8f9c80', '#c2b28f', '#8f8a99', '#d3c8b4'];
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
        out.push({ x: a.x + side * off, y, angle: side > 0 ? Math.PI / 2 : -Math.PI / 2, color: PARKED_COLORS[Math.floor(hash01(ai * 31 + i * 7 + side) * 8) % 8], police: false, disabled: false, id: 9000 + out.length });
      }
    }
  });
  STREETS.forEach((s, si) => {
    for (let i = 0; i < 21; i++) {
      const x = 110 + i * 152;
      if (nearCross(x, AVENUES.map((a) => a.x))) continue;
      for (let side = -1; side <= 1; side += 2) {
        if (hash01(5000 + si * 977 + i * 131 + (side + 1) * 57) > 0.42) continue;
        out.push({ x, y: s.y + side * off, angle: side > 0 ? 0 : Math.PI, color: PARKED_COLORS[Math.floor(hash01(si * 43 + i * 11 + side) * 8) % 8], police: false, disabled: false, id: 9500 + out.length });
      }
    }
  });
  parkedCache = out;
  return out;
}

// ---------------------------------------------------------------------
// Frame state: camera basis, sun, and the face list for one frame.
// ---------------------------------------------------------------------
let F = null; // {cam, r, u, f, sun, sky, faces}
function newFrame(camPos, fwd) {
  const f = norm3(fwd);
  const r = norm3([-f[1], f[0], 0]); // horizontal right, same convention as the sim views
  const u = cross3(f, r);
  return { cam: camPos, f, r, u, faces: [], signs: [] };
}
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function toCam(p) {
  const dx = p[0] - F.cam[0], dy = p[1] - F.cam[1], dz = p[2] - F.cam[2];
  return [dx * F.r[0] + dy * F.r[1] + dz * F.r[2], dx * F.u[0] + dy * F.u[1] + dz * F.u[2], dx * F.f[0] + dy * F.f[1] + dz * F.f[2]];
}
function projectCam(c) {
  return [VIEW_W / 2 + (c[0] / c[2]) * FOCAL, VIEW_H / 2 - (c[1] / c[2]) * FOCAL];
}
export function projectPoint(x, y, z) {
  const c = toCam([x, y, z]);
  if (c[2] < NEAR) return null;
  const s = projectCam(c);
  return { x: s[0], y: s[1], dist: c[2] };
}

// Push one world-space polygon: near-plane clip, flat shading from the
// sun (or a fixed light factor for emissive faces), distance fog.
function addPoly(pts, base, opts = {}) {
  const camPts = pts.map(toCam);
  const clipped = [];
  for (let i = 0; i < camPts.length; i++) {
    const a = camPts[i], b = camPts[(i + 1) % camPts.length];
    if (a[2] >= NEAR) clipped.push(a);
    if ((a[2] < NEAR) !== (b[2] < NEAR)) {
      const t = (NEAR - a[2]) / (b[2] - a[2]);
      clipped.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
    }
  }
  if (clipped.length < 3) return;
  let depth = 0;
  for (const c of clipped) depth += c[2];
  depth /= clipped.length;
  if (depth > MAX_DIST) return;
  let light = opts.light;
  if (light === undefined) {
    // Face normal from the world polygon (Newell-lite: first edge cross).
    const p0 = pts[0], p1 = pts[1], p2 = pts[2];
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const n = norm3(cross3(e1, e2));
    const d = Math.abs(dot3(n, F.sunDir));
    light = (0.50 + 0.50 * d) * (0.45 + 0.55 * F.sky.amb);
  }
  const fogT = clamp((depth - 200) / 1150, 0, 0.62) * (opts.noFog ? 0 : 1);
  const fog = F.sky.fog;
  const a = opts.alpha === undefined ? 1 : opts.alpha;
  // Render-side realism grade (emissive faces keep their raw signal colour).
  const gBase = (opts.light !== undefined && opts.light >= 1.2) || opts.noGrade ? base : gradeCol(base);
  const shade = (L) => {
    const rC = clamp(gBase[0] * L + (fog[0] - gBase[0] * L) * fogT, 0, 255);
    const gC = clamp(gBase[1] * L + (fog[1] - gBase[1] * L) * fogT, 0, 255);
    const bC = clamp(gBase[2] * L + (fog[2] - gBase[2] * L) * fogT, 0, 255);
    return a >= 1 ? `rgb(${rC | 0},${gC | 0},${bC | 0})` : `rgba(${rC | 0},${gC | 0},${bC | 0},${a})`;
  };
  const face = { pts: clipped.map(projectCam), depth, col: shade(light) };
  // PHASE 2 graduated shading (brief B): tall faces carry a vertical
  // gradient — brighter at the top, a darker ambient-occlusion falloff
  // toward the ground contact — instead of one flat tone per face.
  if (opts.vGrad && a >= 1) {
    face.colTop = shade(Math.min(1.35, light * 1.13));
    face.colBot = shade(light * 0.60);
  }
  F.faces.push(face);
}
function addQuad(p0, p1, p2, p3, base, opts) { addPoly([p0, p1, p2, p3], base, opts); }

// A yaw-rotated box. Local +x is the facing direction, +y the side, +z up.
// opts: { top: rgb override, alpha, light, emissive: fixed light factor }
function addBox(cx, cy, cz, hx, hy, hz, yaw, base, opts = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L = (lx, ly, lz) => [cx + lx * c - ly * s, cy + lx * s + ly * c, cz + lz];
  const top = opts.top || base;
  const faces = [
    { pts: [L(-hx, -hy, hz), L(hx, -hy, hz), L(hx, hy, hz), L(-hx, hy, hz)], col: top },            // roof
    { pts: [L(hx, -hy, -hz), L(hx, hy, -hz), L(hx, hy, hz), L(hx, -hy, hz)], col: base },          // front
    { pts: [L(-hx, hy, -hz), L(-hx, -hy, -hz), L(-hx, -hy, hz), L(-hx, hy, hz)], col: base },      // rear
    { pts: [L(-hx, hy, -hz), L(hx, hy, -hz), L(hx, hy, hz), L(-hx, hy, hz)], col: base },          // side +
    { pts: [L(hx, -hy, -hz), L(-hx, -hy, -hz), L(-hx, -hy, hz), L(hx, -hy, hz)], col: base },      // side -
  ];
  for (const f of faces) {
    // Back-face cull: skip faces pointing away from the camera.
    const fc = [(f.pts[0][0] + f.pts[2][0]) / 2, (f.pts[0][1] + f.pts[2][1]) / 2, (f.pts[0][2] + f.pts[2][2]) / 2];
    const e1 = [f.pts[1][0] - f.pts[0][0], f.pts[1][1] - f.pts[0][1], f.pts[1][2] - f.pts[0][2]];
    const e2 = [f.pts[3][0] - f.pts[0][0], f.pts[3][1] - f.pts[0][1], f.pts[3][2] - f.pts[0][2]];
    const n = cross3(e1, e2);
    const toCamV = [F.cam[0] - fc[0], F.cam[1] - fc[1], F.cam[2] - fc[2]];
    if (dot3(n, toCamV) <= 0 && !opts.alpha) continue;
    addPoly(f.pts, f.col, opts);
  }
}

// A prism between two points (limbs, trunks, booms): square cross-section
// of width w across `sideHint` and depth d across the other axis.
function addLimb(p0, p1, w, d, base, sideHint, opts = {}) {
  const axis = norm3([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
  let side = sideHint || [0, 0, 1];
  const proj = dot3(side, axis);
  side = norm3([side[0] - axis[0] * proj, side[1] - axis[1] * proj, side[2] - axis[2] * proj]);
  const other = cross3(axis, side);
  const sw = w / 2, sd = d / 2;
  const corner = (p, a, b) => [p[0] + side[0] * a + other[0] * b, p[1] + side[1] * a + other[1] * b, p[2] + side[2] * a + other[2] * b];
  const c0 = [corner(p0, -sw, -sd), corner(p0, sw, -sd), corner(p0, sw, sd), corner(p0, -sw, sd)];
  const c1 = [corner(p1, -sw, -sd), corner(p1, sw, -sd), corner(p1, sw, sd), corner(p1, -sw, sd)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    addQuad(c0[i], c0[j], c1[j], c1[i], base, opts);
  }
  addQuad(c1[0], c1[1], c1[2], c1[3], base, opts); // far cap
}

// ONE shadow system for every actor: the footprint polygon on the ground,
// stretched AWAY from the sun, in two alpha layers (soft edge) — never an
// identical ellipse disc. Altitude (helicopter) lengthens the stretch.
// PHASE 2: the stretch is scaled by F.shadowK (long dusk shadows from the
// one low sun) and BUILDINGS cast through the same hull path, so every
// object sits IN the light instead of on top of it.
function shadowHull(corners, stretch) {
  const off = [-F.sunDir[0] * stretch, -F.sunDir[1] * stretch];
  const pts2 = [];
  for (const [px, py] of corners) pts2.push([px, py]);
  for (const [px, py] of corners) pts2.push([px + off[0], py + off[1]]);
  pts2.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts2) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts2.length - 1; i >= 0; i--) {
    const p = pts2[i];
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return { hull: lower.slice(0, -1).concat(upper.slice(0, -1)), off };
}
function addShadow(x, y, hx, hy, yaw, stretch, alpha = 0.30) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const corners = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([lx, ly]) => [x + lx * c - ly * s, y + lx * s + ly * c]);
  const st = stretch * (F.shadowK || 1);
  const { hull, off } = shadowHull(corners, st);
  if (hull.length >= 3) addPoly(hull.map(([px, py]) => [px, py, 0.4]), [8, 8, 12], { alpha: alpha * 0.55, light: 1, noGrade: true });
  const inner = corners.map(([px, py]) => [px + off[0] * 0.4, py + off[1] * 0.4, 0.5]);
  addPoly(inner, [8, 8, 12], { alpha, light: 1, noGrade: true });
}
// A building's real cast shadow: its whole footprint extruded away from
// the sun by a height-driven length (capped), one soft dark polygon.
function addBuildingShadow(b, H) {
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  const len = clamp(H * 0.55 * (F.shadowK || 1), 50, 380);
  const { hull } = shadowHull(corners, len);
  if (hull.length >= 3) addPoly(hull.map(([px, py]) => [px, py, 0.35]), [10, 9, 12], { alpha: 0.30, light: 1, noGrade: true });
  // Ambient-occlusion contact band: a slightly larger dark footprint
  // directly under the walls so the box meets the ground with weight.
  const m = 5;
  addPoly([[b.x - m, b.y - m, 0.45], [b.x + b.w + m, b.y - m, 0.45], [b.x + b.w + m, b.y + b.h + m, 0.45], [b.x - m, b.y + b.h + m, 0.45]], [10, 10, 12], { alpha: 0.22, light: 1, noGrade: true });
}
function addDisc(x, y, z, radius, base, opts = {}) {
  const pts = [];
  const seg = 14;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([x + Math.cos(a) * radius, y + Math.sin(a) * radius, z]);
  }
  addPoly(pts, base, opts);
}

// ---------------------------------------------------------------------
// Ground: projected polygon tiles around the camera, coloured with the
// same surface rules the old views used (roads / sidewalks / plaza /
// park / sand + river / grass blocks), sampled at each tile centre.
// ---------------------------------------------------------------------
function groundColor(wx, wy) {
  if (wy > RIVER_Y + 60) {
    const sparkle = hash01(((wx >> 5) * 31 + (wy >> 5) * 57)) > 0.86 ? 26 : 0;
    return [WATER[0] + sparkle, WATER[1] + sparkle, WATER[2] + sparkle];
  }
  if (wy > RIVER_Y) return SAND;
  let dA = 1e9, dS = 1e9;
  for (let i = 0; i < AVENUES.length; i++) { const d = Math.abs(wx - AVENUES[i].x); if (d < dA) dA = d; }
  for (let i = 0; i < STREETS.length; i++) { const d = Math.abs(wy - STREETS[i].y); if (d < dS) dS = d; }
  if (dA < ROAD_W / 2 || dS < ROAD_W / 2) {
    // Asphalt only at tile scale — lane dashes and edge lines are drawn
    // as separate thin quads in drawGround, never as whole-tile colour
    // (a 40-unit tile of dash yellow reads as a giant slab).
    const v = 0.97 + hash01(((wx >> 6) * 13 + (wy >> 6) * 29)) * 0.06;
    return [ASPHALT[0] * v, ASPHALT[1] * v, ASPHALT[2] * v];
  }
  if (dA < ROAD_W / 2 + 16 || dS < ROAD_W / 2 + 16) return SIDEWALK;
  if (wx > PLAZA.x && wx < PLAZA.x + PLAZA.w && wy > PLAZA.y && wy < PLAZA.y + PLAZA.h) return PLAZA_C;
  if (wx > PARK.x && wx < PARK.x + PARK.w && wy > PARK.y && wy < PARK.y + PARK.h) {
    const ex = (wx - (PARK.x + PARK.w * 0.62)) / 42, ey = (wy - (PARK.y + PARK.h * 0.6)) / 24;
    return ex * ex + ey * ey < 1 ? POND : LAWN;
  }
  const tone = GRASS[Math.floor(hash01((Math.floor(wx / 400)) * 3 + 1 + (Math.floor(wy / 400)) * 37) * GRASS.length) % GRASS.length];
  const v = 0.94 + hash01(((wx >> 6) * 7 + (wy >> 6) * 17)) * 0.12;
  return [tone[0] * v, tone[1] * v, tone[2] * v];
}

function drawGround() {
  const CELL = 40, HALF = CELL / 2;
  const fh = [F.f[0], F.f[1]], rh = [F.r[0], F.r[1]];
  for (let fwd = -140; fwd <= 980; fwd += CELL) {
    for (let lat = -820; lat <= 820; lat += CELL) {
      const cx = F.cam[0] + fh[0] * fwd + rh[0] * lat;
      const cy = F.cam[1] + fh[1] * fwd + rh[1] * lat;
      const col = groundColor(cx, cy);
      const corners = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]].map(([df, dl]) => [
        F.cam[0] + fh[0] * (fwd + df) + rh[0] * (lat + dl),
        F.cam[1] + fh[1] * (fwd + df) + rh[1] * (lat + dl), 0,
      ]);
      addPoly(corners, col, { light: (0.62 + 0.38 * F.sky.amb) });
    }
  }
  // Lane markings as thin ground quads: centre dashes + edge lines.
  const inRange = (x, y) => {
    const dx = x - F.cam[0], dy = y - F.cam[1];
    return dx * dx + dy * dy < 1000 * 1000;
  };
  for (const a of AVENUES) {
    for (let y = 14; y < RIVER_Y; y += 46) {
      if (!inRange(a.x, y)) continue;
      if (hash01(a.x * 3 + y) < 0.18) continue; // worn dashes
      addQuad([a.x - 2, y, 0.3], [a.x + 2, y, 0.3], [a.x + 2, y + 24, 0.3], [a.x - 2, y + 24, 0.3], DASH, { light: 0.95 });
    }
    for (let y = 0; y < RIVER_Y; y += 120) {
      if (!inRange(a.x, y + 60)) continue;
      addQuad([a.x - ROAD_W / 2 + 3.5, y, 0.3], [a.x - ROAD_W / 2 + 6.5, y, 0.3], [a.x - ROAD_W / 2 + 6.5, y + 120, 0.3], [a.x - ROAD_W / 2 + 3.5, y + 120, 0.3], EDGE, { light: 0.8 });
      addQuad([a.x + ROAD_W / 2 - 6.5, y, 0.3], [a.x + ROAD_W / 2 - 3.5, y, 0.3], [a.x + ROAD_W / 2 - 3.5, y + 120, 0.3], [a.x + ROAD_W / 2 - 6.5, y + 120, 0.3], EDGE, { light: 0.8 });
    }
  }
  for (const st of STREETS) {
    for (let x = 14; x < 3200; x += 46) {
      if (!inRange(x, st.y)) continue;
      if (hash01(x + st.y * 3) < 0.18) continue;
      addQuad([x, st.y - 2, 0.3], [x + 24, st.y - 2, 0.3], [x + 24, st.y + 2, 0.3], [x, st.y + 2, 0.3], DASH, { light: 0.95 });
    }
    for (let x = 0; x < 3200; x += 120) {
      if (!inRange(x + 60, st.y)) continue;
      addQuad([x, st.y - ROAD_W / 2 + 3.5, 0.3], [x + 120, st.y - ROAD_W / 2 + 3.5, 0.3], [x + 120, st.y - ROAD_W / 2 + 6.5, 0.3], [x, st.y - ROAD_W / 2 + 6.5, 0.3], EDGE, { light: 0.8 });
      addQuad([x, st.y + ROAD_W / 2 - 6.5, 0.3], [x + 120, st.y + ROAD_W / 2 - 6.5, 0.3], [x + 120, st.y + ROAD_W / 2 - 3.5, 0.3], [x, st.y + ROAD_W / 2 - 3.5, 0.3], EDGE, { light: 0.8 });
    }
  }
}

// ---------------------------------------------------------------------
// Buildings: true volumetric boxes — two facades + roof in frame at
// once, projected window quads (never a pixelated texture), parapet,
// lit sign band near the roof, glowing ground-floor shopfronts.
// ---------------------------------------------------------------------
function drawBuilding(b) {
  const dx = b.x + b.w / 2 - F.cam[0], dy = b.y + b.h / 2 - F.cam[1];
  if (dx * dx + dy * dy > 1180 * 1180) return;
  const H = buildingHeight(b);
  const base = rgb(b.color);
  const roofC = rgb(b.roof);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  addBuildingShadow(b, H); // real cast shadow + AO contact band (brief B)
  addBox(cx, cy, H / 2, b.w / 2, b.h / 2, H / 2, 0, base, { top: roofC, vGrad: true });
  // Parapet: a slightly oversized thin box capping the roofline.
  addBox(cx, cy, H + 2, b.w / 2 + 2.5, b.h / 2 + 2.5, 2.5, 0, roofC, { top: roofC });
  // Roof props (AC boxes), deterministic per building.
  const nProps = 1 + Math.floor(hash01(b.id * 3 + 11) * 3);
  for (let i = 0; i < nProps; i++) {
    const px = b.x + 20 + hash01(b.id * 13 + i * 7) * (b.w - 46);
    const py = b.y + 20 + hash01(b.id * 17 + i * 11) * (b.h - 46);
    addBox(px, py, H + 5, 7, 6, 5, 0, [58, 63, 74], { top: [70, 76, 88] });
  }
  // Facade detail on the faces that look toward the camera.
  const faces = [];
  if (F.cam[1] > b.y + b.h) faces.push({ axis: 'y', fixed: b.y + b.h + 0.7, from: b.x, to: b.x + b.w, out: [0, 1, 0] });
  if (F.cam[1] < b.y) faces.push({ axis: 'y', fixed: b.y - 0.7, from: b.x, to: b.x + b.w, out: [0, -1, 0] });
  if (F.cam[0] > b.x + b.w) faces.push({ axis: 'x', fixed: b.x + b.w + 0.7, from: b.y, to: b.y + b.h, out: [1, 0, 0] });
  if (F.cam[0] < b.x) faces.push({ axis: 'x', fixed: b.x - 0.7, from: b.y, to: b.y + b.h, out: [-1, 0, 0] });
  const bid = b.id;
  const colW = 17 + Math.floor(hash01(bid * 41 + 5) * 9);
  const rowH = 21 + Math.floor(hash01(bid * 43 + 9) * 6);
  const winOff = hash01(bid * 47) * colW;
  const neon = (b.kind === 'club' || b.kind === 'casino') ? [255, 113, 206] : [255, 196, 92];
  const distC = Math.hypot(dx, dy);
  let signDone = false;
  for (const face of faces) {
    // Embedded-face guard: the city lots overlap, so one building's
    // face can sit INSIDE a neighbour's footprint — its windows and
    // shopfronts would painter-sort through the neighbour's wall and
    // read as floating slabs. Detail only faces whose outward strip
    // is open air.
    if (F.city) {
      const midA = (face.from + face.to) / 2;
      const probe = face.axis === 'y'
        ? [midA, face.fixed + face.out[1] * 10]
        : [face.fixed + face.out[0] * 10, midA];
      const host = insideBuilding(F.city, probe[0], probe[1], 0);
      if (host && host.id !== b.id) continue;
    }
    // Canyon-wall guard: a face passing right beside the camera (the
    // chase canyon walls) gets its wall polygon near-plane-clipped
    // away while its window quads — each sorted by its own centroid —
    // survive and explode into giant floating slabs. Faces closer
    // than ~110 units to the camera keep their graduated wall only.
    {
      const perp = face.axis === 'y' ? Math.abs(F.cam[1] - face.fixed) : Math.abs(F.cam[0] - face.fixed);
      const alongCam = face.axis === 'y' ? F.cam[0] : F.cam[1];
      if (perp < 110 && alongCam > face.from - 40 && alongCam < face.to + 40) continue;
    }
    // mk(along, z, off): off nudges the quad along the face normal —
    // frames sit at off -0.22 (recessed against the wall), glass at 0
    // (proud of the frame), so windows read INSET, never floating slabs.
    const mk = (along, z, off = 0) => face.axis === 'y'
      ? [along, face.fixed + face.out[1] * off, z]
      : [face.fixed + face.out[0] * off, along, z];
    // Readable signage for near buildings: the fascia band gets the
    // building's real sign word projected as text in the post-pass
    // (the GTA-texture equivalent), collected once per building. The
    // mission TARGET also gets a street-level sign above its shopfront
    // — tall roofs crop out of a low camera's frame, storefront signs
    // are how real street signage reads.
    if (b.sign && distC < 660 && !signDone) {
      signDone = true;
      const mid = (face.from + face.to) / 2;
      const sp = mk(mid, H - 8.5, 0.4);
      const pr = projectPoint(sp[0], sp[1], sp[2]);
      if (pr && pr.x > -80 && pr.x < VIEW_W + 80 && pr.y > -30 && pr.y < VIEW_H + 30) {
        F.signs.push({ x: pr.x, y: pr.y, dist: pr.dist, text: b.sign, name: b.name, neon: (b.kind === 'club' || b.kind === 'casino') });
      }
      if (b.id === F.targetId) {
        const gp = mk(mid, 31, 0.4);
        const gpr = projectPoint(gp[0], gp[1], gp[2]);
        if (gpr && gpr.x > -40 && gpr.x < VIEW_W + 40 && gpr.y > -20 && gpr.y < VIEW_H + 20) {
          F.signs.push({ x: gpr.x, y: gpr.y, dist: gpr.dist, text: b.name, name: b.name, neon: (b.kind === 'club' || b.kind === 'casino'), ground: true });
        }
      }
    }
    // Sign band near the roof: lit letter-block rhythm on a dark fascia.
    addQuad(mk(face.from + 4, H - 14), mk(face.to - 4, H - 14), mk(face.to - 4, H - 3.5), mk(face.from + 4, H - 3.5), [16, 14, 26], { light: 0.9 });
    const segLen = 11;
    for (let a0 = face.from + 8; a0 < face.to - 10; a0 += segLen) {
      if (hash01(bid * 71 + Math.floor(a0 / segLen) * 13 + (face.axis === 'x' ? 500 : 0)) < 0.55) {
        addQuad(mk(a0, H - 11.5), mk(a0 + segLen * 0.6, H - 11.5), mk(a0 + segLen * 0.6, H - 6), mk(a0, H - 6), neon, { light: 1.25 });
      }
    }
    // Shopfront: FRAMED glass bays at ground level (dark frame + inset
    // glass, warm-dim lit or reflective dark) + a thin awning slab —
    // never one flat slab of colour.
    for (let a0 = face.from + 7; a0 < face.to - 14; a0 += colW + 12) {
      const litBay = hash01(bid * 83 + Math.floor(a0 / (colW + 12)) * 19) < 0.78;
      addQuad(mk(a0, 3.5, -0.22), mk(a0 + colW, 3.5, -0.22), mk(a0 + colW, 20), mk(a0, 20, -0.22), [26, 27, 33], { light: 0.9 });
      addQuad(mk(a0 + 1.6, 5), mk(a0 + colW - 1.6, 5), mk(a0 + colW - 1.6, 18.5), mk(a0 + 1.6, 18.5), litBay ? [226, 168, 108] : [58, 70, 86], { light: litBay ? 0.98 : 0.95 });
      addQuad(mk(a0 + colW / 2 - 0.8, 5), mk(a0 + colW / 2 + 0.8, 5), mk(a0 + colW / 2 + 0.8, 18.5), mk(a0 + colW / 2 - 0.8, 18.5), [26, 27, 33], { light: 0.9 });
    }
    addQuad(mk(face.from + 3, 23), mk(face.to - 3, 23), mk(face.to - 3, 26), mk(face.from + 3, 26), roofC, { light: 0.8 });
    // Windows: INSET, FRAMED quads in a strict regular rhythm (brief E4)
    // — a recessed dark frame slightly larger than the glass, drawn on
    // every facade that faces the camera, full height and width.
    if (distC < 820) {
      const frameC = [44, 45, 52];
      for (let a0 = face.from + 9 + winOff; a0 < face.to - 12; a0 += colW) {
        const colSeed = Math.floor((a0 + winOff) / colW);
        for (let z0 = 34; z0 < H - 20; z0 += rowH) {
          const wh = hash01(bid * 131 + Math.floor(z0 / rowH) * 17 + colSeed * 7 + (face.axis === 'x' ? 900 : 0));
          const litWin = wh < F.sky.lit;
          // Unlit glass is a mid blue-grey SKY REFLECTION, never a black
          // hole — black window slabs were the phase-1/2 facade defect.
          const wc = litWin
            ? (hash01(bid * 139 + Math.floor(z0 / rowH) + colSeed * 3) < 0.3 ? [168, 204, 255] : [255, 196, 104])
            : [94, 110, 130];
          addQuad(mk(a0, z0, -0.22), mk(a0 + colW * 0.58, z0, -0.22), mk(a0 + colW * 0.58, z0 + rowH * 0.58, -0.22), mk(a0, z0 + rowH * 0.58, -0.22), frameC, { light: 0.95 });
          addQuad(mk(a0 + colW * 0.06, z0 + rowH * 0.06), mk(a0 + colW * 0.52, z0 + rowH * 0.06), mk(a0 + colW * 0.52, z0 + rowH * 0.52), mk(a0 + colW * 0.06, z0 + rowH * 0.52), wc, { light: litWin ? 1.15 : 1.02 });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------
// Cars: procedural 3D box models — lower body, glass cabin, wheel boxes
// at the corners, emissive light quads. The hero gets a spoiler on
// struts, a full-width tail bar, a plate and twin exhausts; police get
// the white band and a flashing red/blue light bar.
// ---------------------------------------------------------------------
const GLASS = [13, 19, 32], TYRE = [11, 12, 15], DARK = [18, 20, 26];
function drawCar(car, world, isHero) {
  const dx = car.x - F.cam[0], dy = car.y - F.cam[1];
  if (dx * dx + dy * dy > 1050 * 1050) return;
  const yaw = car.angle;
  const body = car.disabled ? [85, 91, 102] : rgb(car.color);
  const bodyTop = body.map((v) => Math.min(255, v * 1.22));
  addShadow(car.x, car.y, 24, 13, yaw, 30, 0.32);
  // PHASE 2 vehicle detail (brief D): the car is assembled from a lower
  // body, SLOPED hood and trunk faces, a TAPERED cabin (frame, glass,
  // narrower roof), wheel-arch darkening, bumpers, mirrors and door
  // seams — it must read as a vehicle, not a box on wheels.
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L = (lx, ly, lz) => [car.x + lx * c - ly * s, car.y + lx * s + ly * c, lz];
  addBox(car.x, car.y, 8.5, 23, 12, 5.5, yaw, body, { top: bodyTop, vGrad: true });
  // Sloped hood (front, +x) and trunk (rear) top faces.
  addQuad(L(23, -11, 11.5), L(23, 11, 11.5), L(9, 10.4, 14.2), L(9, -10.4, 14.2), bodyTop, {});
  addQuad(L(-9, -10.4, 14.2), L(-9, 10.4, 14.2), L(-23, 11, 11.8), L(-23, -11, 11.8), bodyTop, {});
  // Bumpers front/rear + dark side skirt strip.
  addBox(car.x + c * 23.6, car.y + s * 23.6, 5.2, 1.7, 11.2, 2.4, yaw, [30, 31, 36], {});
  addBox(car.x - c * 23.6, car.y - s * 23.6, 5.2, 1.7, 11.2, 2.4, yaw, [30, 31, 36], {});
  addBox(car.x, car.y, 3.1, 19, 12.18, 1.1, yaw, [24, 25, 30], {});
  // Cabin: body-colour frame, inset glass, narrower roof (the taper),
  // sloped windshield + rear glass.
  const cabOff = [Math.cos(yaw) * 2, Math.sin(yaw) * 2];
  addBox(car.x + cabOff[0], car.y + cabOff[1], 16.6, 10.2, 9.5, 3.4, yaw, body.map((v) => v * 0.82), { top: bodyTop });
  addBox(car.x + cabOff[0], car.y + cabOff[1], 16.8, 9.4, 8.7, 3.0, yaw, GLASS, { top: [22, 30, 46] });
  addBox(car.x + cabOff[0], car.y + cabOff[1], 20.3, 8.4, 8.1, 0.9, yaw, bodyTop, {});
  addQuad(L(11.5, -8.2, 14.4), L(11.5, 8.2, 14.4), L(7.5, 7.6, 19.6), L(7.5, -7.6, 19.6), GLASS, { light: 1.05 });
  addQuad(L(-3.5, -7.6, 19.6), L(-3.5, 7.6, 19.6), L(-7.5, 8.2, 14.4), L(-7.5, -8.2, 14.4), GLASS, { light: 1.05 });
  // Mirrors on the cabin's front corners.
  for (const sy of [1, -1]) {
    const mp = L(10.5, sy * 10.8, 17.6);
    addBox(mp[0], mp[1], mp[2], 1.3, 2.3, 1.7, yaw, [22, 23, 28], {});
  }
  // Door seams: two thin dark verticals per side + a handle tick.
  for (const sy of [1, -1]) {
    for (const lx of [-3, 6.5]) {
      addQuad(L(lx, sy * 12.14, 4.5), L(lx + 0.7, sy * 12.14, 4.5), L(lx + 0.7, sy * 12.14, 13.6), L(lx, sy * 12.14, 13.6), [16, 17, 21], { light: 0.9 });
    }
    addQuad(L(4.6, sy * 12.14, 11.6), L(7.6, sy * 12.14, 11.6), L(7.6, sy * 12.14, 12.6), L(4.6, sy * 12.14, 12.6), [16, 17, 21], { light: 0.9 });
  }
  // Wheel arches (dark, slightly proud of the body) + wheels inside.
  for (const [lx, ly] of [[15, 12.2], [15, -12.2], [-15, 12.2], [-15, -12.2]]) {
    addBox(car.x + lx * c - ly * s, car.y + lx * s + ly * c, 4.4, 5.6, 2.3, 4.4, yaw, [13, 13, 16], {});
    addBox(car.x + lx * c - ly * s, car.y + lx * s + ly * c, 3.6, 4.6, 1.9, 3.6, yaw, TYRE, {});
  }
  // Light quads on the rear / front faces.
  const quadAt = (lx, ly, z, wHalf, hHalf, col, light) => {
    const ox = Math.cos(yaw) * lx - Math.sin(yaw) * ly, oy = Math.sin(yaw) * lx + Math.cos(yaw) * ly;
    const px = car.x + ox, py = car.y + oy;
    const side = [-Math.sin(yaw) * wHalf, Math.cos(yaw) * wHalf];
    const out = [Math.cos(yaw) * Math.sign(lx) * 0.5, Math.sin(yaw) * Math.sign(lx) * 0.5];
    addQuad(
      [px + side[0] + out[0], py + side[1] + out[1], z - hHalf],
      [px - side[0] + out[0], py - side[1] + out[1], z - hHalf],
      [px - side[0] + out[0], py - side[1] + out[1], z + hHalf],
      [px + side[0] + out[0], py + side[1] + out[1], z + hHalf], col, { light });
  };
  if (car.police) {
    addBox(car.x, car.y, 9.5, 9, 12.45, 3.6, yaw, [238, 241, 245], {});
    // Light bar: two emissive halves that swap with the flash phase.
    const flash = Math.sin(world.time * 11 + car.id) > 0;
    const lbOff = [Math.cos(yaw) * 2, Math.sin(yaw) * 2];
    const sideOff = [-Math.sin(yaw) * 4.6, Math.cos(yaw) * 4.6];
    addBox(car.x + lbOff[0] + sideOff[0], car.y + lbOff[1] + sideOff[1], 22.4, 3, 4.4, 1.7, yaw, flash ? [255, 60, 90] : [120, 30, 45], { light: 1.5 });
    addBox(car.x + lbOff[0] - sideOff[0], car.y + lbOff[1] - sideOff[1], 22.4, 3, 4.4, 1.7, yaw, flash ? [40, 90, 160] : [1, 205, 254], { light: 1.5 });
    quadAt(-23.2, 6.5, 10, 3.4, 1.6, [255, 36, 56], 1.4);
    quadAt(-23.2, -6.5, 10, 3.4, 1.6, [255, 36, 56], 1.4);
    quadAt(23.2, 6.5, 10, 3.4, 1.6, [255, 243, 176], 1.3);
    quadAt(23.2, -6.5, 10, 3.4, 1.6, [255, 243, 176], 1.3);
  } else if (isHero) {
    // Spoiler on two struts (wing no wider than the body), glowing
    // full-width tail bar, plate, twin exhausts.
    const wingOff = [Math.cos(yaw) * -20, Math.sin(yaw) * -20];
    addBox(car.x + wingOff[0], car.y + wingOff[1], 24.2, 2.2, 11, 1.2, yaw, DARK, {});
    for (const sy of [7, -7]) {
      const stOff = [Math.cos(yaw) * -20 - Math.sin(yaw) * sy, Math.sin(yaw) * -20 + Math.cos(yaw) * sy];
      addBox(car.x + stOff[0], car.y + stOff[1], 18.6, 1.4, 1.4, 4.6, yaw, DARK, {});
    }
    quadAt(-23.4, 0, 11.5, 10, 1.9, [255, 36, 56], 1.6);   // tail bar
    quadAt(-23.4, 0, 6.2, 4.6, 2.4, [232, 236, 241], 1.1); // plate
    quadAt(23.4, 6.5, 10, 3.4, 1.6, [255, 243, 176], 1.3);
    quadAt(23.4, -6.5, 10, 3.4, 1.6, [255, 243, 176], 1.3);
    for (const sy of [7, -7]) {
      const exOff = [Math.cos(yaw) * -23.8 - Math.sin(yaw) * sy, Math.sin(yaw) * -23.8 + Math.cos(yaw) * sy];
      addBox(car.x + exOff[0], car.y + exOff[1], 3, 1.2, 2, 2, yaw, [34, 38, 46], {});
    }
    if (car.health < car.maxHealth * 0.4) {
      addDisc(car.x - Math.cos(yaw) * 8, car.y - Math.sin(yaw) * 8, 30 + Math.sin(world.time * 3) * 3, 9, [120, 124, 132], { alpha: 0.35, light: 1 });
    }
  } else {
    quadAt(-23.2, 6.5, 10, 3.4, 1.6, [255, 36, 56], 1.35);
    quadAt(-23.2, -6.5, 10, 3.4, 1.6, [255, 36, 56], 1.35);
    quadAt(23.2, 6.5, 10, 3.4, 1.6, [255, 243, 176], 1.25);
    quadAt(23.2, -6.5, 10, 3.4, 1.6, [255, 243, 176], 1.25);
  }
}

// ---------------------------------------------------------------------
// People: ONE shared articulated figure renderer. A figure is built
// from 3D boxes — pelvis, torso, head + hair cap, two arms (upper +
// forearm), two legs (thigh + shin) — posed by state:
//   walk / run: stride phase swings legs and opposite arms (mid-stride)
//   stand:      feet planted, arms hanging with a slight bend
//   aim:        both arms forward along the aim direction, gun in hand,
//               one foot forward (combat stance)
// ---------------------------------------------------------------------
const SKINS = ['#e8b08a', '#c68863', '#8d5a3b', '#f2c79b'].map(rgb);
const HAIRS = ['#2b2118', '#14100c', '#4a3220', '#6e6e6e'].map(rgb);
const PANTS = ['#23262e', '#2e3442', '#3a2f28', '#26332a'].map(rgb);
const PLAYER_OUTFIT = '#ff8c1a'; // vivid orange — deliberately NOT in the pedestrian SHIRTS palette
const CREW_SHIRT = '#19c2e6';
const OFFICER_SHIRT = [32, 54, 92], OFFICER_PANTS = [22, 38, 63];

function drawFigure(o) {
  const dx = o.x - F.cam[0], dy = o.y - F.cam[1];
  if (dx * dx + dy * dy > 800 * 800) return;
  const a = o.angle;
  const f = [Math.cos(a), Math.sin(a)], s = [-Math.sin(a), Math.cos(a)];
  const P = (fu, sv, z) => [o.x + f[0] * fu + s[0] * sv, o.y + f[1] * fu + s[1] * sv, z];
  const shirt = o.shirt, pants = o.pants;
  const skin = SKINS[o.seed % SKINS.length], hair = HAIRS[(o.seed >> 2) % HAIRS.length];
  addShadow(o.x, o.y, 8, 8, a, 17, 0.28);
  if (o.ring) { // the player's identity marker: a true ring band, outfit colour
    const seg = 14;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      addQuad(
        [o.x + Math.cos(a0) * 13.5, o.y + Math.sin(a0) * 13.5, 0.7],
        [o.x + Math.cos(a1) * 13.5, o.y + Math.sin(a1) * 13.5, 0.7],
        [o.x + Math.cos(a1) * 18, o.y + Math.sin(a1) * 18, 0.7],
        [o.x + Math.cos(a0) * 18, o.y + Math.sin(a0) * 18, 0.7], o.ring, { alpha: 0.75, light: 1 });
    }
    addDisc(o.x, o.y, 0.6, 18, o.ring, { alpha: 0.13, light: 1 });
  }
  const pose = o.pose, ph = o.phase || 0;
  const crouch = pose === 'aim' ? 2 : 0;
  const lean = pose === 'run' ? 4.5 : pose === 'aim' ? 2.5 : pose === 'walk' ? 1.2 : 0;
  // PHASE 2 proportions (brief C): longer legs, slimmer torso, smaller
  // head — total height ~42 world units with a ~6.6-unit head, separated
  // shoe/hand tones and a shaped hair mass, so figures stop reading as
  // block mannequins. Shoulders sit narrower than the old build; hips
  // narrower than shoulders.
  const hipZ = 19.5 - crouch, shoZ = 33 - crouch;
  // Legs: thigh + shin per side (segments 9.5 + 9.5).
  for (const sideSign of [1, -1]) {
    const hip = P(0, sideSign * 2.7, hipZ);
    let knee, foot;
    if (pose === 'walk' || pose === 'run') {
      const amp = pose === 'run' ? 0.85 : 0.52;
      const sw = Math.sin(ph + (sideSign > 0 ? 0 : Math.PI)) * amp;
      const sw2 = sw - (pose === 'run' ? 0.55 : 0.38);
      knee = P(Math.sin(sw) * 9.5, sideSign * 2.7, hipZ - Math.cos(sw) * 9.5);
      foot = P(Math.sin(sw) * 9.5 + Math.sin(sw2) * 9.5, sideSign * 2.7, Math.max(1.2, hipZ - Math.cos(sw) * 9.5 - Math.cos(sw2) * 9.5));
    } else if (pose === 'aim') {
      if (sideSign > 0) { knee = P(5.5, 3, hipZ - 9); foot = P(11, 3.4, 1.2); }
      else { knee = P(-3.5, -3, hipZ - 9.5); foot = P(-8.5, -3.6, 1.2); }
    } else {
      knee = P(0.4, sideSign * 2.9, hipZ - 9.5);
      foot = P(0.8, sideSign * 3.6, 1.2);
    }
    addLimb(hip, knee, 3.5, 3.5, pants, [0, 0, 1]);
    addLimb(knee, foot, 2.9, 2.9, pants, [0, 0, 1]);
    // Shoe: its own dark tone, longer than wide, toe forward.
    addBox(foot[0] + f[0] * 1.9, foot[1] + f[1] * 1.9, 1.1, 3.4, 1.9, 1.1, a, [26, 22, 19], {});
  }
  // Pelvis (narrow) + torso (slimmer, shallower than phase 1).
  addBox(o.x, o.y, hipZ - 1.5, 3.9, 4.7, 2.4, a, pants, {});
  const hipC = P(0, 0, hipZ + 1), shoC = P(lean, 0, shoZ);
  addLimb(hipC, shoC, 7.4, 4.6, shirt, [s[0], s[1], 0]);
  // Head: smaller relative to the body; hair is a shaped mass (top +
  // back fall), not a flat box cap. Officers keep the uniform cap.
  const headC = P(lean + 0.4, 0, shoZ + 5.4);
  addBox(headC[0], headC[1], headC[2], 2.9, 3.05, 3.3, a, skin, {});
  if (o.cap) {
    addBox(headC[0], headC[1], headC[2] + 3.5, 3.2, 3.3, 1.2, a, o.cap, {});
    const brim = P(lean + 4.6, 0, shoZ + 8.6);
    addBox(brim[0], brim[1], brim[2], 2.8, 3.4, 0.6, a, o.cap, {});
  } else {
    addBox(headC[0], headC[1], headC[2] + 2.9, 3.05, 3.2, 1.5, a, hair, {});
    const back = P(lean - 1.1, 0, shoZ + 6.4);
    addBox(back[0], back[1], back[2], 2.2, 3.2, 2.4, a, hair, {});
  }
  // Arms: slimmer segments, shoulder line at ±4.9, hands in skin tone.
  for (const sideSign of [1, -1]) {
    const sho = P(lean, sideSign * 4.9, shoZ - 0.5);
    let elbow, hand;
    if (pose === 'aim') {
      elbow = P(lean + 7, sideSign * 3.9, shoZ - 1.5);
      hand = P(lean + 14.5, sideSign * 1.4, shoZ - 0.5);
    } else if (pose === 'walk' || pose === 'run') {
      const amp = pose === 'run' ? 0.8 : 0.45;
      const sw = Math.sin(ph + (sideSign > 0 ? Math.PI : 0)) * amp; // opposite to the same-side leg
      elbow = P(lean + Math.sin(sw) * 7.5, sideSign * 5.2, shoZ - 0.5 - Math.cos(sw) * 7.5);
      const sw2 = sw * 0.7 - 0.35;
      hand = P(lean + Math.sin(sw) * 7.5 + Math.sin(sw2) * 7, sideSign * 5.2, shoZ - 0.5 - Math.cos(sw) * 7.5 - Math.cos(sw2) * 7);
    } else {
      elbow = P(lean + 1, sideSign * 5.2, shoZ - 8);
      hand = P(lean + 2.2, sideSign * 5, shoZ - 15);
    }
    addLimb(sho, elbow, 2.9, 2.9, shirt, [0, 0, 1]);
    addLimb(elbow, hand, 2.4, 2.4, skin, [0, 0, 1]);
    addBox(hand[0], hand[1], hand[2], 1.7, 1.7, 1.7, a, skin, {}); // hand
    if (pose === 'aim' && sideSign > 0) { // pistol in the lead hand
      const g0 = hand, g1 = P(lean + 20, 1, shoZ - 0.5);
      addLimb(g0, g1, 2.2, 3.2, [24, 26, 32], [0, 0, 1]);
    }
  }
  if (o.bag) { // crew loot bag on the back, cyan like the old views
    const bc = P(-6, 2.2, 23 - crouch);
    addBox(bc[0], bc[1], bc[2], 3.8, 5.2, 6.2, a, [1, 205, 254], { top: [255, 214, 10] });
  }
}

// ---------------------------------------------------------------------
// Helicopter: tapered 3D body, tail boom, fin, translucent rotor disc,
// skids, searchlight cone + ground pool, sun-offset ground shadow.
// ---------------------------------------------------------------------
function drawHeli(world) {
  const h = world.heli;
  if (!h || !h.active) return;
  const dx = h.x - F.cam[0], dy = h.y - F.cam[1];
  if (dx * dx + dy * dy > 1250 * 1250) return;
  const a = h.lightAngle || 0;
  const f = [Math.cos(a), Math.sin(a)], s = [-Math.sin(a), Math.cos(a)];
  const P = (fu, sv, z) => [h.x + f[0] * fu + s[0] * sv, h.y + f[1] * fu + s[1] * sv, z];
  addShadow(h.x, h.y, 46, 15, a, 60 + HELI_ALT * 0.35, 0.20);
  const body = [43, 50, 66], darkB = [30, 35, 46];
  addBox(h.x, h.y, HELI_ALT, 26, 10, 9, a, body, { top: [95, 108, 130] });
  // Tapered nose: a smaller box stepped forward + glass front.
  const nose = P(29, 0, HELI_ALT - 1);
  addBox(nose[0], nose[1], nose[2], 9, 8, 7, a, darkB, {});
  const glassP = P(37.5, 0, HELI_ALT + 1);
  addBox(glassP[0], glassP[1], glassP[2], 1.6, 6.4, 4.6, a, [159, 216, 239], { light: 1.1 });
  // Tail boom (tapered run via two limbs of shrinking width) + fin.
  addLimb(P(-24, 0, HELI_ALT + 1), P(-52, 0, HELI_ALT + 3), 6, 6, darkB, [0, 0, 1]);
  addLimb(P(-52, 0, HELI_ALT + 3), P(-72, 0, HELI_ALT + 5), 3.4, 3.4, darkB, [0, 0, 1]);
  const fin = P(-72, 0, HELI_ALT + 9);
  addBox(fin[0], fin[1], fin[2], 2, 1.6, 8, a, body, {});
  // Rotor: translucent projected disc + hub; tail rotor disc.
  addDisc(h.x, h.y, HELI_ALT + 12.5, 54, [198, 214, 228], { alpha: 0.16, light: 1 });
  addDisc(h.x, h.y, HELI_ALT + 12.8, 54, [220, 232, 244], { alpha: 0.10, light: 1 });
  const hub = P(0, 0, HELI_ALT + 11);
  addBox(hub[0], hub[1], hub[2], 3, 3, 2.4, a, DARK, {});
  const tr = P(-72, 2.5, HELI_ALT + 5);
  addPoly([tr, [tr[0], tr[1], tr[2] + 9], [tr[0], tr[1], tr[2] - 9]], [190, 205, 220], { alpha: 0.3, light: 1 });
  // Skids on struts.
  for (const sideSign of [1, -1]) {
    addLimb(P(-18, sideSign * 10, HELI_ALT - 15), P(20, sideSign * 10, HELI_ALT - 15), 1.8, 1.8, DARK, [0, 0, 1]);
    addLimb(P(-10, sideSign * 8, HELI_ALT - 9), P(-13, sideSign * 10, HELI_ALT - 15), 1.4, 1.4, DARK, [0, 0, 1]);
    addLimb(P(12, sideSign * 8, HELI_ALT - 9), P(15, sideSign * 10, HELI_ALT - 15), 1.4, 1.4, DARK, [0, 0, 1]);
  }
  // Searchlight cone + pool (kept subtle: the pool sits near the chase
  // camera, so a wide bright disc would wash out the whole foreground).
  if (h.lightX !== undefined) {
    const apex = [h.x, h.y, HELI_ALT - 10];
    const seg = 8, R = 40;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      addPoly([apex,
        [h.lightX + Math.cos(a0) * R, h.lightY + Math.sin(a0) * R, 0.6],
        [h.lightX + Math.cos(a1) * R, h.lightY + Math.sin(a1) * R, 0.6],
      ], [255, 244, 190], { alpha: 0.045, light: 1 });
    }
    addDisc(h.lightX, h.lightY, 0.7, 42, [255, 246, 200], { alpha: 0.13, light: 1 });
    addDisc(h.lightX, h.lightY, 0.8, 22, [255, 246, 200], { alpha: 0.17, light: 1 });
  }
}

// ---------------------------------------------------------------------
// Props: palms (stacked leaning trunk segments + drooping triangle
// fronds, two lean variants), lamps, crates, barriers, benches, hydrants.
// ---------------------------------------------------------------------
function drawProp(pr) {
  const dx = pr.x - F.cam[0], dy = pr.y - F.cam[1];
  if (dx * dx + dy * dy > 640 * 640) return;
  // A prop right at the camera projects as a frame-filling box (near-
  // plane stretch) — skip the closest dressing, it would be cropped
  // out of the frame anyway.
  if (dx * dx + dy * dy < 130 * 130) return;
  const seed = Math.floor(Math.abs(pr.x) * 3 + Math.abs(pr.y) * 7);
  if (pr.kind === 'palm') {
    // PHASE 2 palm rebuild (brief E3): fronds are BROAD drooping planes
    // joined at the crown — wide at the base, widest at the mid-bend,
    // falling to the tip — in two lean variants. No more spike/glitch
    // lines: every frond is a 6-point bent plane with real width.
    const variant = hash01(seed) < 0.5 ? 0.55 : 1.5; // two lean variants
    const leanA = hash01(seed + 5) * Math.PI * 2;
    const ld = [Math.cos(leanA), Math.sin(leanA)];
    let px = pr.x, py = pr.y, pz = 0;
    for (let i = 0; i < 5; i++) {
      const nx = px + ld[0] * 2.1 * variant, ny = py + ld[1] * 2.1 * variant, nz = pz + 11;
      addLimb([px, py, pz + 1], [nx, ny, nz], 5.6 - i * 0.55, 5.6 - i * 0.55, [96, 74, 48], [0, 0, 1]);
      px = nx; py = ny; pz = nz;
    }
    addBox(px, py, pz + 1, 3.6, 3.6, 3, 0, [80, 60, 34], {}); // crown
    // Coconut cluster tucked under the crown.
    for (let i = 0; i < 3; i++) {
      const ca = (i / 3) * Math.PI * 2 + hash01(seed + 21) * 2;
      addBox(px + Math.cos(ca) * 3.4, py + Math.sin(ca) * 3.4, pz - 1.5, 2.2, 2.2, 2.2, 0, [104, 84, 44], {});
    }
    const crownCamZ = toCam([px, py, pz])[2];
    const frond = (la, len, drop, wBase, wMid, col) => {
      const dir = [Math.cos(la), Math.sin(la)];
      const perp = [-dir[1], dir[0]];
      const tip = [px + dir[0] * len, py + dir[1] * len, pz + 2 - drop];
      // A frond pointing straight at the camera projects as a long
      // floating plank — skip fronds aimed at the lens.
      if (toCam(tip)[2] < crownCamZ * 0.45) return;
      const mid = [px + dir[0] * len * 0.52, py + dir[1] * len * 0.52, pz + 5];
      addPoly([
        [px + perp[0] * wBase, py + perp[1] * wBase, pz + 1],
        [mid[0] + perp[0] * wMid, mid[1] + perp[1] * wMid, mid[2]],
        tip,
        [mid[0] - perp[0] * wMid, mid[1] - perp[1] * wMid, mid[2]],
        [px - perp[0] * wBase, py - perp[1] * wBase, pz + 1],
      ], col, {});
    };
    for (let i = 0; i < 8; i++) {
      const la = (i / 8) * Math.PI * 2 + hash01(seed + i) * 0.45;
      frond(la, 34 + hash01(seed + i * 3) * 7, 13 + hash01(seed + i * 7) * 5, 4.4, 6.6, i % 2 ? [52, 84, 40] : [44, 74, 36]);
    }
    // Two dead hanging fronds, narrower and browner, below the crown.
    for (let i = 0; i < 2; i++) {
      const la = hash01(seed + 31 + i * 9) * Math.PI * 2;
      frond(la, 24, 24, 2.2, 2.8, [110, 88, 50]);
    }
    addShadow(pr.x, pr.y, 4, 4, 0, 22, 0.22);
  } else if (pr.kind === 'lamp') {
    addLimb([pr.x, pr.y, 0], [pr.x, pr.y, 38], 1.7, 1.7, [30, 33, 40], [0, 0, 1]);
    const lit = F.sky.lit > 0.2;
    addBox(pr.x, pr.y, 39.5, 3, 3, 2, 0, lit ? [255, 233, 168] : [207, 214, 221], { light: lit ? 1.5 : 0.9 });
    addShadow(pr.x, pr.y, 3, 3, 0, 14, 0.2);
  } else if (pr.kind === 'crate') {
    addBox(pr.x, pr.y, 7, 8.5, 8.5, 7, hash01(seed) * 0.6, [138, 107, 58], { top: [163, 127, 69] });
    addShadow(pr.x, pr.y, 9, 9, 0, 13, 0.26);
  } else if (pr.kind === 'barrier') {
    addBox(pr.x, pr.y, 6, 14, 2.6, 6, 0, [238, 241, 245], {});
    addBox(pr.x, pr.y, 6, 14, 2.8, 2.2, 0, [255, 158, 100], { light: 1 });
    addShadow(pr.x, pr.y, 14, 3, 0, 12, 0.24);
  } else if (pr.kind === 'bench') {
    addBox(pr.x, pr.y, 5, 12, 3.4, 1.4, 0, [119, 87, 47], {});
    addBox(pr.x, pr.y - 3, 10, 12, 1.2, 5, 0, [93, 70, 48], {});
  } else { // hydrant
    addBox(pr.x, pr.y, 5.5, 3.6, 3.6, 5.5, 0, [193, 39, 45], {});
    addBox(pr.x, pr.y, 12, 2.6, 2.6, 1.6, 0, [227, 51, 51], {});
  }
}

// ---------------------------------------------------------------------
// Main entry. mode: 'drive' (camera behind the player's car) or 'foot'
// (camera behind the player on foot, facing the aim direction).
// ---------------------------------------------------------------------
export function drawView3D(ctx, world, mode) {
  const p = world.player;
  if (!p) return;
  const phaseName = (world.plan && world.plan.timeOfDay) || 'day';
  const sky = SKIES[phaseName] || SKIES.day;
  const isDrive = mode ? mode === 'drive' : !!p.car;
  const anchor = isDrive && p.car ? p.car : p;
  const yaw = isDrive && p.car ? p.car.angle : (p.aimAngle || p.angle || 0);
  // PHASE 2 camera (Rect's GTA reference): LOW third-person, pulled
  // back — the subject anchors in the lower third of the frame, the
  // street and skyline open up above it, and the helicopter (altitude
  // 135) fits whole inside the vertical field of view.
  const back = isDrive ? 158 : 128;
  const camH = isDrive ? 64 : 46;
  const targetZ = isDrive ? 10 : 20;
  const fh = [Math.cos(yaw), Math.sin(yaw)];
  let camX = anchor.x - fh[0] * back, camY = anchor.y - fh[1] * back;
  const fixed = collideWorld(world.city, camX, camY, 26);
  camX = fixed.x; camY = fixed.y;
  const pitch = isDrive ? 0.10 : 0.17;
  void targetZ;
  F = newFrame([camX, camY, camH], [fh[0] * Math.cos(pitch), fh[1] * Math.cos(pitch), -Math.sin(pitch)]);
  F.sky = sky;
  F.sunDir = norm3([Math.cos(sky.sunAz) * Math.cos(sky.sunEl), Math.sin(sky.sunAz) * Math.cos(sky.sunEl), Math.sin(sky.sunEl)]);
  // Long-shadow factor from the sun's elevation: low dusk sun throws
  // shadows several times the object's size; midday sun keeps them short.
  F.shadowK = clamp(0.55 / Math.max(0.09, Math.tan(sky.sunEl)), 0.8, 3.4);

  // Sky: gradient + soft-glow sun disc (never a bare flat disc).
  const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H * 0.72);
  grad.addColorStop(0, `rgb(${sky.top[0]},${sky.top[1]},${sky.top[2]})`);
  grad.addColorStop(1, `rgb(${sky.hor[0]},${sky.hor[1]},${sky.hor[2]})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const sunCam = toCam([camX + F.sunDir[0] * 1000, camY + F.sunDir[1] * 1000, camH + F.sunDir[2] * 1000]);
  if (sunCam[2] > 10) {
    const sp = projectCam(sunCam);
    const glowR = phaseName === 'day' ? 150 : 330;
    const sg = ctx.createRadialGradient(sp[0], sp[1], 4, sp[0], sp[1], glowR);
    sg.addColorStop(0, `rgba(${sky.sun[0]},${sky.sun[1]},${sky.sun[2]},0.9)`);
    sg.addColorStop(0.22, `rgba(${sky.sun[0]},${sky.sun[1]},${sky.sun[2]},0.38)`);
    sg.addColorStop(1, 'rgba(255,160,80,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sp[0] - glowR, sp[1] - glowR, glowR * 2, glowR * 2);
    ctx.fillStyle = `rgb(${sky.sun[0]},${sky.sun[1]},${sky.sun[2]})`;
    ctx.beginPath(); ctx.arc(sp[0], sp[1], phaseName === 'night' ? 17 : 30, 0, Math.PI * 2); ctx.fill();
  }
  if (phaseName === 'night') {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 70; i++) {
      const sx = hash01(i * 31 + 7) * VIEW_W, sy = hash01(i * 47 + 3) * VIEW_H * 0.4;
      ctx.fillRect(sx, sy, 2, 2);
    }
  }

  F.targetId = world.mission && world.mission.building ? world.mission.building.id : -1;
  F.city = world.city;
  // World faces.
  drawGround();
  for (const b of world.city.buildings) drawBuilding(b);
  for (const pr of world.city.props) drawProp(pr);
  for (const s of world.spikes || []) {
    addBox(s.x, s.y, 1.2, 26, 5, 1.2, 0, [16, 18, 22], {});
  }
  const heroCar = p.car || null;
  for (const car of world.cars) drawCar(car, world, car === heroCar);
  for (const pc of parkedCars()) {
    if (world.cars.some((c) => Math.abs(c.x - pc.x) < 80 && Math.abs(c.y - pc.y) < 80)) continue;
    // On foot, a kerb car right at the camera would fill the frame as a
    // cropped blocker — skip the closest dressing in foot mode.
    if (!isDrive && Math.hypot(pc.x - camX, pc.y - camY) < 150) continue;
    drawCar(pc, world, false);
  }
  // Pedestrians (mid-stride from their own walkPhase), crew, player.
  for (const ped of world.peds) {
    if (ped.down > 0) continue;
    drawFigure({
      x: ped.x, y: ped.y, angle: ped.angle, phase: ped.walkPhase,
      pose: ped.state === 'flee' ? 'run' : 'walk',
      shirt: rgb(ped.shirt), pants: PANTS[ped.id % PANTS.length], seed: ped.id + 3,
    });
  }
  for (const m of world.crewMembers) {
    if (m.down > 0) continue;
    drawFigure({
      x: m.x, y: m.y, angle: m.angle, phase: m.walkPhase,
      pose: m.mode === 'wait' ? 'stand' : 'walk',
      shirt: rgb(CREW_SHIRT), pants: PANTS[1], seed: 40 + Math.floor(m.x) % 7, bag: m.hasBag,
    });
  }
  // Police officers on foot beside stopped / parked / roadblock cars
  // (render-only: fixed offset from the car, the sim is not touched).
  for (const car of world.cars) {
    if (!car.police || car.disabled) continue;
    const stopped = Math.abs(car.speed || 0) < 6 || car.parked || car.roadblock;
    if (!stopped) continue;
    const dx = car.x - F.cam[0], dy = car.y - F.cam[1];
    if (dx * dx + dy * dy > 620 * 620) continue;
    const side = [-Math.sin(car.angle), Math.cos(car.angle)];
    const ox = car.x + side[0] * 21 - Math.cos(car.angle) * 4;
    const oy = car.y + side[1] * 21 - Math.sin(car.angle) * 4;
    drawFigure({
      x: ox, y: oy, angle: Math.atan2(side[1], side[0]), phase: 0, pose: 'stand',
      shirt: OFFICER_SHIRT, pants: OFFICER_PANTS, seed: car.id + 11, cap: OFFICER_PANTS,
    });
  }
  if (!p.car) {
    drawFigure({
      x: p.x, y: p.y, angle: p.aimAngle || p.angle, phase: p.walkPhase,
      pose: world.mission ? 'aim' : 'walk',
      shirt: rgb(PLAYER_OUTFIT), pants: [28, 39, 51], seed: 1, ring: rgb(PLAYER_OUTFIT),
    });
  }
  // Painter's algorithm: far to near, full-resolution polygons.
  const paintFaces = () => {
    F.faces.sort((a, b) => b.depth - a.depth);
    ctx.save();
    for (const f of F.faces) {
      if (f.pts.length < 3) continue;
      if (f.colTop) {
        let mn = 1e9, mx = -1e9;
        for (const pt of f.pts) { if (pt[1] < mn) mn = pt[1]; if (pt[1] > mx) mx = pt[1]; }
        const gr = ctx.createLinearGradient(0, mn, 0, Math.max(mn + 1, mx));
        gr.addColorStop(0, f.colTop); gr.addColorStop(1, f.colBot);
        ctx.fillStyle = gr;
      } else ctx.fillStyle = f.col;
      ctx.beginPath();
      ctx.moveTo(f.pts[0][0], f.pts[0][1]);
      for (let i = 1; i < f.pts.length; i++) ctx.lineTo(f.pts[i][0], f.pts[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    F.faces = [];
  };
  paintFaces();
  // Signage post-pass: near buildings get their real sign word lettered
  // on the fascia (projected position collected in drawBuilding), sized
  // by distance, on a dark band — the texture-sign equivalent.
  if (F.signs.length) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const s of F.signs) {
      const size = clamp(5600 / s.dist, 10, 27);
      ctx.font = `800 ${size}px system-ui, sans-serif`;
      const tw = ctx.measureText(s.text).width + size * 0.9;
      ctx.fillStyle = 'rgba(12,12,18,0.88)';
      ctx.fillRect(s.x - tw / 2, s.y - size * 0.72, tw, size * 1.44);
      ctx.fillStyle = s.neon ? '#e88bb8' : '#f0c98a';
      ctx.fillText(s.text, s.x, s.y + 1);
    }
    ctx.restore();
  }
  // The helicopter flies above the rooftops: it is painted after the
  // world (its own faces sorted among themselves), so a building never
  // swallows it — same staging guarantee the old billboard view had.
  drawHeli(world);
  paintFaces();

  // Combat tracer in foot mode, while the shot is fresh.
  if (!isDrive && world.lastShotT < 0.4) {
    const a = p.aimAngle || p.angle;
    const h0 = projectPoint(p.x + Math.cos(a) * 16, p.y + Math.sin(a) * 16, 28);
    const h1 = projectPoint(p.x + Math.cos(a) * 230, p.y + Math.sin(a) * 230, 27);
    if (h0 && h1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,224,130,0.85)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(h0.x, h0.y); ctx.lineTo(h1.x, h1.y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,240,190,0.9)';
      ctx.beginPath(); ctx.arc(h0.x, h0.y, 7, 0, Math.PI * 2); ctx.fill();
      // HIT feedback at the impact end: a short spark star so the shot
      // visibly lands on the target in the still frame.
      ctx.strokeStyle = 'rgba(255,196,80,0.95)'; ctx.lineWidth = 2.5;
      for (let i = 0; i < 6; i++) {
        const sa = (i / 6) * Math.PI * 2 + 0.4;
        ctx.beginPath();
        ctx.moveTo(h1.x + Math.cos(sa) * 4, h1.y + Math.sin(sa) * 4);
        ctx.lineTo(h1.x + Math.cos(sa) * 15, h1.y + Math.sin(sa) * 15);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,220,140,0.95)';
      ctx.beginPath(); ctx.arc(h1.x, h1.y, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  // Dusk / night vignette.
  if (phaseName === 'dusk' || phaseName === 'night') {
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.44, VIEW_H * 0.36, VIEW_W / 2, VIEW_H * 0.5, VIEW_H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, phaseName === 'night' ? 'rgba(2,4,12,0.42)' : 'rgba(24,6,20,0.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  F = null;
}
