// view3d.js — TRUE 3D chase-cam renderer for AMBER COAST (golden-hour coastal city).
// Original projected-polygon renderer, vanilla canvas 2D, no libraries: every face is a
// world-space polygon transformed into camera space (third-person basis: right / up /
// forward), clipped against the near plane, perspective-divided onto the full 1280x800
// canvas, flat-shaded from ONE low western sun, fogged toward the sunset horizon colour,
// and drawn far-to-near (painter's algorithm). It only READS game state — the simulation
// is untouched — and every variation is a deterministic hash, never Math.random /
// Date.now, so screenshot staging stays perfectly reproducible.
//
// SCALE CONTRACT (the rebuild-3d failure this build must not repeat): the world is
// ~8.6 units per metre (car length 38 ≈ 4.4 m). A standing figure is 15.4 units tall
// (1.79 m) with tapered, articulated limbs — slightly taller than a car's 12.3-unit
// roofline, but a small fraction of a car's mass and screen area, and never drawn with
// box primitives. Buildings render at b.height × 3.2 (58–205 units, 2–8 floors).
// The camera is a LOW chase cam: 84 units behind / 30 up driving, 72 behind / 26 up on
// foot, looking ahead of the hero, so the horizon sits ~⅓ from the frame top and the
// hero is LARGE in the lower centre with the street receding ahead.
import { VIEW_W, VIEW_H, WORLD_SIZE, BLOCK_PITCH, ROAD_W, PALETTE } from './config.js';
import { isOnRoad, roadCenters, pointInBuilding } from './city.js';
import { clamp } from './rng.js';

const FOV = 1.05; // ~60 degrees
const FOCAL = (VIEW_W / 2) / Math.tan(FOV / 2);
const NEAR = 5;
const MAX_DIST = 1450;
const FIG_H = 15.4;         // total standing figure height, world units
const CAR_ROOF = 12.3;      // sedan/coupe cabin roof height
const BUILD_SCALE = 3.2;    // building render height = data height × this
const SUNSET_TOP = [86, 62, 102];    // dusty plum
const SUNSET_MID = [199, 108, 112];  // rose
const SUNSET_HOR = [255, 178, 112];  // orange-pink horizon
const FOG = [226, 152, 118];
const SUN = [255, 196, 116];
// Time-of-day grades — the plan's time choice made visible. GOLDEN is the
// game's established sunset; DUSK is the same sun an hour later: deeper
// plum sky, redder horizon, heavier fog and a dimmer light scale on every
// shaded face. renderView3D selects one per frame from game.timeGrade.
const GRADES = {
  golden: { top: SUNSET_TOP, mid: SUNSET_MID, hor: SUNSET_HOR, fog: FOG, sun: SUN, light: 1.0, wash: 1.0 },
  dusk: { top: [38, 26, 64], mid: [120, 52, 92], hor: [214, 102, 84], fog: [150, 88, 96], sun: [240, 150, 90], light: 0.78, wash: 1.6 },
};
// Sun low in the WEST (world -x), slightly north: shadows stretch EAST.
const SUN_DIR = (() => { const v = [-0.90, -0.24, 0.34]; const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
const SHADOW_K = Math.hypot(SUN_DIR[0], SUN_DIR[1]) / SUN_DIR[2]; // ≈2.86: shadow length per unit height

function hash01(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
const rgbCache = new Map();
function rgb(hex) {
  let c = rgbCache.get(hex);
  if (!c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    c = m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : [200, 200, 200];
    rgbCache.set(hex, c);
  }
  return c;
}
function parseColor(str, fallback) {
  if (!str) return fallback;
  if (str[0] === '#') return rgb(str);
  const m = /(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(str);
  return m ? [+m[1], +m[2], +m[3]] : fallback;
}
const ASPHALT = [60, 53, 55], SIDEWALK_C = [122, 102, 80], PLOT = [99, 81, 62];
const GRASS_C = [84, 100, 60], SAND_C = rgb(PALETTE.sand), WATER_C = rgb(PALETTE.water);
const GLASS = [16, 23, 34], TYRE = [12, 12, 15];

// ---------------------------------------------------------------- frame state
let F = null; // {cam, r, u, f, faces, idMode, heroCar, time}
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function newFrame(camPos, fwd) {
  const f = norm3(fwd);
  const r = norm3([-f[1], f[0], 0]);
  const u = cross3(f, r);
  return { cam: camPos, f, r, u, faces: [], idMode: false, heroCar: null, time: 0 };
}
function toCam(p) {
  const dx = p[0] - F.cam[0], dy = p[1] - F.cam[1], dz = p[2] - F.cam[2];
  return [dx * F.r[0] + dy * F.r[1] + dz * F.r[2], dx * F.u[0] + dy * F.u[1] + dz * F.u[2], dx * F.f[0] + dy * F.f[1] + dz * F.f[2]];
}
function projectCam(c) { return [VIEW_W / 2 + (c[0] / c[2]) * FOCAL, VIEW_H / 2 - (c[1] / c[2]) * FOCAL]; }
export function projectPoint(x, y, z) {
  if (!F) return null;
  const c = toCam([x, y, z]);
  if (c[2] < NEAR) return null;
  const s = projectCam(c);
  return { x: s[0], y: s[1], dist: c[2] };
}

// Push one world-space polygon: near-plane clip, sun shading, distance fog, painter list.
// opts: {light, alpha, vGrad, cat ('fig'|'car'), double (light both sides), noFog}
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
  if (F.idMode) {
    const col = opts.cat === 'fig' ? 'rgb(0,255,0)' : opts.cat === 'car' ? 'rgb(0,0,255)' : opts.cat === 'tank' ? 'rgb(255,0,0)' : opts.cat === 'plane' ? 'rgb(255,0,255)' : 'rgb(22,22,22)';
    F.faces.push({ pts: clipped.map(projectCam), depth, col });
    return;
  }
  let light = opts.light;
  if (light === undefined) {
    const p0 = pts[0], p1 = pts[1], p2 = pts[2];
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const n = norm3(cross3(e1, e2));
    let d = dot3(n, SUN_DIR);
    if (opts.double) d = Math.abs(d);
    light = Math.abs(n[2]) > 0.55 ? 0.94 : 0.60 + 0.40 * Math.max(0, d);
  }
  const fogT = opts.noFog ? 0 : clamp((depth - 240) / 1150, 0, 0.60);
  const a = opts.alpha === undefined ? 1 : opts.alpha;
  const fogC = F.fog || FOG;
  const lScale = F.lightScale || 1;
  const shade = (L0) => {
    const L = L0 * lScale;
    let rC = base[0] * L + (fogC[0] - base[0] * L) * fogT;
    let gC = base[1] * L + (fogC[1] - base[1] * L) * fogT;
    let bC = base[2] * L + (fogC[2] - base[2] * L) * fogT;
    // Texture-pass colour grade (Rect 2026-11-19): deeper saturation and a
    // touch more contrast so surfaces separate at thumbnail scale — kept
    // mild (x1.13 / x1.05) so the sunset palette never turns neon.
    const avg = (rC + gC + bC) / 3;
    rC = clamp((avg + (rC - avg) * 1.13 - 128) * 1.05 + 128, 0, 255);
    gC = clamp((avg + (gC - avg) * 1.13 - 128) * 1.05 + 128, 0, 255);
    bC = clamp((avg + (bC - avg) * 1.13 - 128) * 1.05 + 128, 0, 255);
    return a >= 1 ? `rgb(${rC | 0},${gC | 0},${bC | 0})` : `rgba(${rC | 0},${gC | 0},${bC | 0},${a})`;
  };
  const face = { pts: clipped.map(projectCam), depth, col: shade(light) };
  if (opts.vGrad && a >= 1) { face.colTop = shade(Math.min(1.3, light * 1.13)); face.colBot = shade(light * 0.58); }
  F.faces.push(face);
}
function addQuad(p0, p1, p2, p3, base, opts) { addPoly([p0, p1, p2, p3], base, opts); }
function addDisc(x, y, z, radius, base, opts = {}) {
  const pts = [], seg = 12;
  for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push([x + Math.cos(a) * radius, y + Math.sin(a) * radius, z]); }
  addPoly(pts, base, opts);
}

// Yaw-rotated box. Local +x facing, +y side, +z up. cols: array (all faces) or
// {top, front(+x), back(-x), sideP(+y), sideM(-y)}.
function addBox(cx, cy, cz, hx, hy, hz, yaw, cols, opts = {}) {
  const one = Array.isArray(cols);
  const colFor = (k) => (one ? cols : (cols[k] || cols.top));
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L = (lx, ly, lz) => [cx + lx * c - ly * s, cy + lx * s + ly * c, cz + lz];
  const faces = [
    { pts: [L(-hx, -hy, hz), L(hx, -hy, hz), L(hx, hy, hz), L(-hx, hy, hz)], col: colFor('top') },
    { pts: [L(hx, -hy, -hz), L(hx, hy, -hz), L(hx, hy, hz), L(hx, -hy, hz)], col: colFor('front') },
    { pts: [L(-hx, hy, -hz), L(-hx, -hy, -hz), L(-hx, -hy, hz), L(-hx, hy, hz)], col: colFor('back') },
    { pts: [L(-hx, hy, -hz), L(hx, hy, -hz), L(hx, hy, hz), L(-hx, hy, hz)], col: colFor('sideP') },
    { pts: [L(hx, -hy, -hz), L(-hx, -hy, -hz), L(-hx, -hy, hz), L(hx, -hy, hz)], col: colFor('sideM') },
  ];
  for (const f of faces) {
    const fc = [(f.pts[0][0] + f.pts[2][0]) / 2, (f.pts[0][1] + f.pts[2][1]) / 2, (f.pts[0][2] + f.pts[2][2]) / 2];
    const e1 = [f.pts[1][0] - f.pts[0][0], f.pts[1][1] - f.pts[0][1], f.pts[1][2] - f.pts[0][2]];
    const e2 = [f.pts[3][0] - f.pts[0][0], f.pts[3][1] - f.pts[0][1], f.pts[3][2] - f.pts[0][2]];
    const n = cross3(e1, e2);
    const toCamV = [F.cam[0] - fc[0], F.cam[1] - fc[1], F.cam[2] - fc[2]];
    if (dot3(n, toCamV) <= 0 && !opts.alpha) continue;
    addPoly(f.pts, f.col, opts);
  }
}

// Tapered prism between two points: cross-section shrinks from (w0,d0) to (w1,d1).
// This is what keeps limbs from reading as boxes: thighs narrow to knees, shins to
// ankles, trunks to crowns.
function addTaperedLimb(p0, p1, w0, w1, d0, d1, base, sideHint, opts = {}) {
  const axis = norm3([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
  let side = sideHint || [0, 0, 1];
  const proj = dot3(side, axis);
  side = norm3([side[0] - axis[0] * proj, side[1] - axis[1] * proj, side[2] - axis[2] * proj]);
  if (!isFinite(side[0])) side = [1, 0, 0];
  const other = cross3(axis, side);
  const corner = (p, w, d, a, b) => [p[0] + side[0] * (a * w / 2) + other[0] * (b * d / 2), p[1] + side[1] * (a * w / 2) + other[1] * (b * d / 2), p[2] + side[2] * (a * w / 2) + other[2] * (b * d / 2)];
  const c0 = [corner(p0, w0, d0, -1, -1), corner(p0, w0, d0, 1, -1), corner(p0, w0, d0, 1, 1), corner(p0, w0, d0, -1, 1)];
  const c1 = [corner(p1, w1, d1, -1, -1), corner(p1, w1, d1, 1, -1), corner(p1, w1, d1, 1, 1), corner(p1, w1, d1, -1, 1)];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; addQuad(c0[i], c0[j], c1[j], c1[i], base, opts); }
  addQuad(c1[0], c1[1], c1[2], c1[3], base, opts);
}
function addLimb(p0, p1, w, d, base, sideHint, opts) { addTaperedLimb(p0, p1, w, w, d, d, base, sideHint, opts); }

// Low-poly sphere (lathe of 4 rings × 8 segments) for heads — a box or an
// octahedron reads as a slab or a pyramid at thumbnail scale; a lathed sphere
// reads as a skull from every angle.
function addSphere(cx, cy, cz, r, base, opts = {}) {
  const rings = [{ z: -0.78, rr: 0.62 }, { z: -0.35, rr: 0.92 }, { z: 0.15, rr: 1.0 }, { z: 0.62, rr: 0.8 }];
  const seg = 8;
  const pt = (ring, i) => { const a = (i / seg) * Math.PI * 2; return [cx + Math.cos(a) * r * ring.rr, cy + Math.sin(a) * r * ring.rr, cz + r * ring.z]; };
  const top = [cx, cy, cz + r], bot = [cx, cy, cz - r];
  const topRing = rings[rings.length - 1], botRing = rings[0];
  for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; addPoly([top, pt(topRing, j), pt(topRing, i)], base, opts); }
  for (let k = 0; k < rings.length - 1; k++) {
    const r0 = rings[k], r1 = rings[k + 1];
    for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; addQuad(pt(r0, i), pt(r0, j), pt(r1, j), pt(r1, i), base, opts); }
  }
  for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; addPoly([bot, pt(botRing, i), pt(botRing, j)], base, opts); }
}
// Low-poly rounded blob (octahedron) for tree canopies — volume without boxes.
function addBlob(cx, cy, cz, r, base, opts = {}) {
  const v = [[cx + r, cy, cz], [cx - r, cy, cz], [cx, cy + r, cz], [cx, cy - r, cz], [cx, cy, cz + r * 0.82], [cx, cy, cz - r * 0.82]];
  const tris = [[4, 0, 2], [4, 2, 1], [4, 1, 3], [4, 3, 0], [5, 2, 0], [5, 1, 2], [5, 3, 1], [5, 0, 3]];
  for (const t of tris) addPoly([v[t[0]], v[t[1]], v[t[2]]], base, opts);
}

// ------------------------------------------------------------- shadow system
// ONE system: footprint hull stretched AWAY from the sun (east), two alpha layers.
function shadowHull(corners, stretch) {
  const off = [-SUN_DIR[0] * stretch, -SUN_DIR[1] * stretch];
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
function addShadow(x, y, hx, hy, yaw, height, alpha = 0.30) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const corners = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([lx, ly]) => [x + lx * c - ly * s, y + lx * s + ly * c]);
  const { hull, off } = shadowHull(corners, height * SHADOW_K);
  if (hull.length >= 3) addPoly(hull.map(([px, py]) => [px, py, 0.4]), [10, 8, 12], { alpha: alpha * 0.55, light: 1 });
  const inner = corners.map(([px, py]) => [px + off[0] * 0.38, py + off[1] * 0.38, 0.5]);
  addPoly(inner, [10, 8, 12], { alpha, light: 1 });
}
function addBuildingShadow(b, H) {
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  const len = clamp(H * SHADOW_K, 60, 430);
  const { hull } = shadowHull(corners, len);
  if (hull.length >= 3) addPoly(hull.map(([px, py]) => [px, py, 0.35]), [12, 9, 13], { alpha: 0.30, light: 1 });
  const m = 6; // AO contact band so the volume meets the ground with weight
  addPoly([[b.x - m, b.y - m, 0.45], [b.x + b.w + m, b.y - m, 0.45], [b.x + b.w + m, b.y + b.h + m, 0.45], [b.x - m, b.y + b.h + m, 0.45]], [12, 10, 13], { alpha: 0.22, light: 1 });
}

// ------------------------------------------------------------------- ground
function groundKind(game, x, y) {
  if (game.city.sites) for (const st of game.city.sites) if (x >= st.x && x <= st.x + st.w && y >= st.y && y <= st.y + st.h) return st.kind === 'airport' ? [106, 104, 100] : [98, 100, 88];
  if (x > WORLD_SIZE + 72) return WATER_C;
  if (x >= WORLD_SIZE) return x > WORLD_SIZE + 56 ? [196, 164, 116] : SAND_C;
  if (isOnRoad(x, y)) return ASPHALT;
  for (const p of game.city.parks) if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return GRASS_C;
  if ((x > WORLD_SIZE - ROAD_W - 17 && x < WORLD_SIZE - ROAD_W) || (y > WORLD_SIZE - ROAD_W - 17 && y < WORLD_SIZE - ROAD_W)) return SIDEWALK_C;
  const mx = ((x % BLOCK_PITCH) + BLOCK_PITCH) % BLOCK_PITCH;
  const my = ((y % BLOCK_PITCH) + BLOCK_PITCH) % BLOCK_PITCH;
  if ((mx >= ROAD_W && mx < ROAD_W + 16) || (mx > BLOCK_PITCH - 16) || (my >= ROAD_W && my < ROAD_W + 16) || (my > BLOCK_PITCH - 16)) return SIDEWALK_C;
  const v = 0.92 + hash01(Math.floor(x / BLOCK_PITCH) * 31 + Math.floor(y / BLOCK_PITCH) * 57) * 0.16;
  return [PLOT[0] * v, PLOT[1] * v, PLOT[2] * v];
}
function drawGround(game) {
  const CELL = 44, HALF = CELL / 2;
  const fh = [F.f[0], F.f[1]], rh = [F.r[0], F.r[1]];
  for (let fwd = -160; fwd <= 1180; fwd += CELL) {
    for (let lat = -840; lat <= 840; lat += CELL) {
      const cx = F.cam[0] + fh[0] * fwd + rh[0] * lat;
      const cy = F.cam[1] + fh[1] * fwd + rh[1] * lat;
      if (cx < -420 || cx > WORLD_SIZE + 460 || cy < -420 || cy > WORLD_SIZE + 420) continue;
      const base = groundKind(game, cx, cy);
      const cellHash = hash01((Math.floor(cx / CELL) * 13 + Math.floor(cy / CELL) * 29));
      const v = 0.90 + cellHash * 0.20;
      const wHash = hash01(Math.floor(cx / 46) * 7 + Math.floor(cy / 46) * 13);
      const col = base === WATER_C && wHash > 0.86 ? [110, 178, 182] : base === WATER_C && wHash > 0.68 ? [64, 138, 152] : [base[0] * v, base[1] * v, base[2] * v];
      const corners = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]].map(([df, dl]) => [
        F.cam[0] + fh[0] * (fwd + df) + rh[0] * (lat + dl),
        F.cam[1] + fh[1] * (fwd + df) + rh[1] * (lat + dl), 0.12,
      ]);
      addPoly(corners, col, { light: 0.92 });
      // Texture pass: asphalt grain speckle, sand speckle, grass mottling —
      // small deterministic inset quads so no large surface reads as one
      // flat tone, visible even at 320px because the value steps are bold.
      if (base === ASPHALT && cellHash > 0.28 && cellHash <= 0.70) {
        const gi = 12, gc = [[-HALF + gi, -HALF + gi], [0, -HALF + gi], [HALF - gi - 9, 0], [-HALF + gi, 2]].map(([df, dl]) => [
          F.cam[0] + fh[0] * (fwd + df) + rh[0] * (lat + dl), F.cam[1] + fh[1] * (fwd + df) + rh[1] * (lat + dl), 0.18,
        ]);
        addPoly(gc, cellHash > 0.5 ? [96, 88, 84] : [30, 28, 30], { light: 0.92, alpha: 0.22 });
      }
      if (base === SAND_C && cellHash > 0.45) {
        const sc = [[-HALF + 9, -HALF + 9], [HALF - 18, HALF - 18], [HALF - 18, -HALF + 9], [-HALF + 9, HALF - 18]].map(([df, dl]) => [
          F.cam[0] + fh[0] * (fwd + df) + rh[0] * (lat + dl), F.cam[1] + fh[1] * (fwd + df) + rh[1] * (lat + dl), 0.18,
        ]);
        addPoly(sc, [168, 138, 96], { light: 0.95, alpha: 0.35 });
      }
      if (base === GRASS_C) {
        const gv = 0.82 + cellHash * 0.36;
        const gc2 = [[-HALF + 6, -HALF + 6], [HALF - 6, -HALF + 6], [HALF - 6, HALF - 6], [-HALF + 6, HALF - 6]].map(([df, dl]) => [
          F.cam[0] + fh[0] * (fwd + df) + rh[0] * (lat + dl), F.cam[1] + fh[1] * (fwd + df) + rh[1] * (lat + dl), 0.16,
        ]);
        addPoly(gc2, [GRASS_C[0] * gv, GRASS_C[1] * gv, GRASS_C[2] * gv], { light: 0.92, alpha: 0.5 });
      }
      // Asphalt repair patches on road cells: tonal rectangles inset from
      // the cell edge, deterministic per cell — real streets are patchwork,
      // and the patchwork keeps the road plane from reading as one flat
      // empty surface in the foreground of the action cameras.
      if (base === ASPHALT && cellHash > 0.70) {
        const inset = 7, dark = cellHash > 0.86;
        const pc = [[-HALF + inset, -HALF + inset], [HALF - inset, -HALF + inset], [HALF - inset, HALF - inset], [-HALF + inset, HALF - inset]].map(([df, dl]) => [
          F.cam[0] + fh[0] * (fwd + df) + rh[0] * (lat + dl),
          F.cam[1] + fh[1] * (fwd + df) + rh[1] * (lat + dl), 0.2,
        ]);
        addPoly(pc, dark ? [34, 31, 33] : [88, 79, 74], { light: 0.92, alpha: dark ? 0.30 : 0.20 });
      }
    }
  }
  // Centre dashes as thin ground quads.
  const centers = roadCenters();
  const inRange = (x, y) => { const dx = x - F.cam[0], dy = y - F.cam[1]; return dx * dx + dy * dy < 1050 * 1050; };
  {
    for (const c of centers) {
      for (let y = 8; y < WORLD_SIZE; y += 44) {
        if (!inRange(c, y)) continue;
        if (isOnRoad(c, y) && isOnRoad(c + 30, y)) { /* crossing: skip pattern via hash below */ }
        if (hash01(c * 3 + y) < 0.10) continue;
        addQuad([c - 1.2, y, 0.3], [c + 1.2, y, 0.3], [c + 1.2, y + 21, 0.3], [c - 1.2, y + 21, 0.3], [203, 185, 138], { light: 0.95 });
      }
      for (let x = 8; x < WORLD_SIZE; x += 44) {
        if (!inRange(x, c)) continue;
        if (hash01(x + c * 3) < 0.10) continue;
        addQuad([x, c - 1.2, 0.3], [x + 21, c - 1.2, 0.3], [x + 21, c + 1.2, 0.3], [x, c + 1.2, 0.3], [203, 185, 138], { light: 0.95 });
      }
    }
  }
  // Crosswalk zebras at intersections: pale stripes across both roads just
  // north/east of each centre — street furniture that also breaks the road
  // plane's flatness where the action cameras sit (intersections).
  for (const cx of centers) {
    for (const cy of centers) {
      if (!inRange(cx, cy)) continue;
      for (let i = 0; i < 5; i++) {
        const sx = cx - 34 + i * 14;
        addQuad([sx, cy - 74, 0.42], [sx + 7, cy - 74, 0.42], [sx + 7, cy - 52, 0.42], [sx, cy - 52, 0.42], [216, 207, 192], { light: 0.9, alpha: 0.55 });
        const sy = cy - 34 + i * 14;
        addQuad([cx + 52, sy, 0.42], [cx + 74, sy, 0.42], [cx + 74, sy + 7, 0.42], [cx + 52, sy + 7, 0.42], [216, 207, 192], { light: 0.9, alpha: 0.55 });
      }
    }
  }
  // Skid marks left by the sim's fx.
  for (const s of game.fx.skids || []) {
    if (!inRange(s.x, s.y)) continue;
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    const L = (lx, ly) => [s.x + lx * c - ly * sn, s.y + lx * sn + ly * c, 0.34];
    addQuad(L(-s.len / 2, -s.w / 2), L(s.len / 2, -s.w / 2), L(s.len / 2, s.w / 2), L(-s.len / 2, s.w / 2), [10, 10, 12], { alpha: 0.42, light: 1 });
  }
  // Sunset gloss: elongated warm streaks on asphalt, stretched away from the sun
  // (east), anchored at lamps that stand on or beside a road.
  for (const l of game.city.lamps) {
    if (!inRange(l.x, l.y)) continue;
    if (!isOnRoad(l.x + 26, l.y + 8)) continue;
    addQuad([l.x + 4, l.y - 3.4, 0.32], [l.x + 52, l.y + 1.5, 0.32], [l.x + 52, l.y + 5.5, 0.32], [l.x + 4, l.y + 0.6, 0.32], [255, 176, 102], { alpha: 0.10, light: 1 });
  }
  // Site markings: the airport runway (dark strip, centreline dashes,
  // threshold bars) and the base's concrete pads, on our own geography.
  if (game.city.sites) for (const st of game.city.sites) {
    if (!inRange(st.x + st.w / 2, st.y + st.h / 2)) continue;
    if (st.kind === 'airport') {
      const ry = st.y + st.h / 2;
      addQuad([st.x + 6, ry - 15, 0.3], [st.x + st.w - 6, ry - 15, 0.3], [st.x + st.w - 6, ry + 15, 0.3], [st.x + 6, ry + 15, 0.3], [52, 52, 56], { light: 0.95 });
      for (let dx = 16; dx < st.w - 20; dx += 34) addQuad([st.x + dx, ry - 1.2, 0.36], [st.x + dx + 16, ry - 1.2, 0.36], [st.x + dx + 16, ry + 1.2, 0.36], [st.x + dx, ry + 1.2, 0.36], [238, 236, 226], { light: 1.0 });
      for (const ex of [st.x + 10, st.x + st.w - 22]) for (let b = 0; b < 4; b++) addQuad([ex, ry - 13 + b * 7, 0.36], [ex + 10, ry - 13 + b * 7, 0.36], [ex + 10, ry - 9 + b * 7, 0.36], [ex, ry - 9 + b * 7, 0.36], [238, 236, 226], { light: 1.0 });
      addQuad([st.x + 20, st.y + 24, 0.28], [st.x + 150, st.y + 24, 0.28], [st.x + 150, st.y + 74, 0.28], [st.x + 20, st.y + 74, 0.28], [122, 120, 114], { light: 0.95 });
    } else {
      for (const [px, py] of [[70, 70], [200, 70], [70, 220], [200, 220]]) addDisc(st.x + px, st.y + py, 0.3, 30, [116, 118, 104], { light: 0.95 });
      addQuad([st.x + 24, st.y + st.h - 44, 0.3], [st.x + st.w - 24, st.y + st.h - 44, 0.3], [st.x + st.w - 24, st.y + st.h - 36, 0.3], [st.x + 24, st.y + st.h - 36, 0.3], [196, 178, 92], { light: 1.0 });
    }
  }
  // Explosive zones on the ground: fire patches burn orange, gas hangs
  // pale, a lit flare throws a bright pool.
  for (const z of game.zones || []) {
    if (!inRange(z.x, z.y)) continue;
    if (z.kind === 'fire') { addDisc(z.x, z.y, 0.4, z.r, [214, 110, 40], { alpha: 0.5, light: 1.2 }); addDisc(z.x, z.y, 0.45, z.r * 0.55, [246, 178, 60], { alpha: 0.65, light: 1.35 }); }
    else if (z.kind === 'gas') addDisc(z.x, z.y, 0.4, z.r, [168, 178, 150], { alpha: 0.30, light: 1.0 });
    else if (z.kind === 'flare') { addDisc(z.x, z.y, 0.4, z.r, [255, 120, 90], { alpha: 0.4, light: 1.4 }); addDisc(z.x, z.y, 0.46, 7, [255, 226, 170], { alpha: 0.9, light: 1.5 }); }
  }
  for (const pl of game.placed || []) { if (inRange(pl.x, pl.y)) addBox(pl.x, pl.y, 1.6, 3.4, 3.4, 1.6, 0, [30, 30, 34], {}); }
  for (const pr of game.projectiles || []) { if (inRange(pr.x, pr.y)) addSphere(pr.x, pr.y, pr.z || 6, pr.behavior === 'rocket' || pr.behavior === 'cannon' ? 2.6 : 1.9, [40, 38, 36], {}); }
  // Mission marker: ground ring + a soft light pillar so the objective reads in 3D.
  const marker = game.missions.marker();
  if (marker) {
    const mc = marker.color === 'pickup' ? [232, 200, 50] : [79, 201, 106];
    const pulse = 30 + Math.sin(F.time * 3.2) * 6;
    const seg = 16;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      addQuad(
        [marker.x + Math.cos(a0) * (pulse - 4), marker.y + Math.sin(a0) * (pulse - 4), 0.6],
        [marker.x + Math.cos(a1) * (pulse - 4), marker.y + Math.sin(a1) * (pulse - 4), 0.6],
        [marker.x + Math.cos(a1) * pulse, marker.y + Math.sin(a1) * pulse, 0.6],
        [marker.x + Math.cos(a0) * pulse, marker.y + Math.sin(a0) * pulse, 0.6], mc, { alpha: 0.8, light: 1.15 });
    }
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
      addQuad(
        [marker.x + Math.cos(a0) * pulse, marker.y + Math.sin(a0) * pulse, 0.6],
        [marker.x + Math.cos(a1) * pulse, marker.y + Math.sin(a1) * pulse, 0.6],
        [marker.x + Math.cos(a1) * pulse, marker.y + Math.sin(a1) * pulse, 44],
        [marker.x + Math.cos(a0) * pulse, marker.y + Math.sin(a0) * pulse, 44], mc, { alpha: 0.13, light: 1.1, double: true });
    }
  }
}

// ---------------------------------------------------------------- buildings
function drawBuilding(game, b) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = cx - F.cam[0], dy = cy - F.cam[1];
  if (dx * dx + dy * dy > 1180 * 1180) return;
  const H = b.height * BUILD_SCALE;
  const roofC = rgb(b.color);
  const wallSun = rgb(b.wallLight || PALETTE.wallLight);   // west face catches the sun
  const wallShade = rgb(b.wallDark || PALETTE.wallDark);   // east face in shade
  const wallSouth = wallSun.map((v) => v * 0.88);
  const wallNorth = wallShade.map((v) => Math.min(255, v * 1.12));
  addBuildingShadow(b, H);
  addBox(cx, cy, H / 2, b.w / 2, b.h / 2, H / 2, 0,
    { top: roofC, front: wallShade, back: wallSun, sideP: wallSouth, sideM: wallNorth }, { vGrad: true });
  // Parapet cap.
  addBox(cx, cy, H + 1.6, b.w / 2 + 2.2, b.h / 2 + 2.2, 1.8, 0, roofC.map((v) => v * 0.92), {});
  // Rooftop props stored at generation.
  if (b.props) {
    for (const pr of b.props) {
      const px = b.x + pr.dx, py = b.y + pr.dy;
      if (pr.kind === 'tower') addBox(px, py, H + 6, pr.w / 2, pr.h / 2, 6, 0, [70, 62, 54], { top: [88, 78, 68] });
      else if (pr.kind === 'vent') addBox(px, py, H + 2.2, pr.w / 2, pr.h / 2, 2.2, 0, [96, 98, 104], {});
      else addBox(px, py, H + 3, pr.w / 2, pr.h / 2, 3, 0, [104, 106, 112], { top: [122, 124, 130] });
    }
  }
  // Facade detail on the faces that look toward the camera.
  const faces = [];
  if (F.cam[1] > b.y + b.h) faces.push({ axis: 'y', fixed: b.y + b.h + 0.6, from: b.x, to: b.x + b.w, out: [0, 1] });
  if (F.cam[1] < b.y) faces.push({ axis: 'y', fixed: b.y - 0.6, from: b.x, to: b.x + b.w, out: [0, -1] });
  if (F.cam[0] > b.x + b.w) faces.push({ axis: 'x', fixed: b.x + b.w + 0.6, from: b.y, to: b.y + b.h, out: [1, 0] });
  if (F.cam[0] < b.x) faces.push({ axis: 'x', fixed: b.x - 0.6, from: b.y, to: b.y + b.h, out: [-1, 0] });
  const distC = Math.hypot(dx, dy);
  const winCol = parseColor(b.windowColor, [255, 214, 140]);
  const wth = typeof b.windowThreshold === 'number' ? b.windowThreshold : 0.55;
  const bid = Math.round(b.x * 3 + b.y * 7);
  for (const face of faces) {
    // Canyon guard: a face hugging the camera keeps its graduated wall only —
    // its window quads would near-plane-clip into floating slabs.
    const perp = face.axis === 'y' ? Math.abs(F.cam[1] - face.fixed) : Math.abs(F.cam[0] - face.fixed);
    const alongCam = face.axis === 'y' ? F.cam[0] : F.cam[1];
    if (perp < 95 && alongCam > face.from - 40 && alongCam < face.to + 40) continue;
    const mk = (along, z, off = 0) => face.axis === 'y'
      ? [along, face.fixed + face.out[1] * off, z]
      : [face.fixed + face.out[0] * off, along, z];
    // Art-deco beachfront stripe under the parapet.
    if (b.deco && H > 60) {
      addQuad(mk(face.from + 4, H - 15), mk(face.to - 4, H - 15), mk(face.to - 4, H - 10), mk(face.from + 4, H - 10), [217, 138, 122], { light: 1.05 });
      addQuad(mk(face.from + 4, H - 21), mk(face.to - 4, H - 21), mk(face.to - 4, H - 17.5), mk(face.from + 4, H - 17.5), [159, 201, 184], { light: 1.0 });
    }
    if (b.neon) {
      // Dimmed under 1.0 light: at 1.35 the pastel neon colours clamped to
      // pure-white rectangles — the "blank sign" defect in a second costume.
      addQuad(mk(face.from + 5, H - 12), mk(face.to - 5, H - 12), mk(face.to - 5, H - 5), mk(face.from + 5, H - 5), rgb(b.neonColor).map((v) => v * 0.85), { light: 1.02 });
    }
    // Shopfront: dressed bays at ground level — warm timber frame (never a
    // black slab), mullioned glass, and a named sign plate above each bay:
    // a coloured plate with dark letter-ticks, flavour inside the world.
    if (distC < 760) {
      const SIGN_COLS = [[196, 84, 74], [62, 118, 128], [206, 150, 62], [104, 138, 96], [150, 92, 128], [72, 96, 150]];
      for (let a0 = face.from + 8; a0 < face.to - 16; a0 += 30) {
        const bayIdx = Math.floor(a0 / 30);
        const litBay = hash01(bid * 83 + bayIdx * 19 + (face.axis === 'x' ? 400 : 0)) < 0.8;
        addQuad(mk(a0, 1.6, -0.2), mk(a0 + 21, 1.6, -0.2), mk(a0 + 21, 11), mk(a0, 11, -0.2), [88, 66, 50], { light: 0.95 });
        addQuad(mk(a0 + 1.6, 3), mk(a0 + 19.4, 3), mk(a0 + 19.4, 9.8), mk(a0 + 1.6, 9.8), litBay ? [216, 158, 100] : [96, 116, 134], { light: litBay ? 0.98 : 0.95 });
        // Mullions: two vertical bars break the glass into dressed panes.
        for (const mx of [a0 + 7.4, a0 + 13.2]) addQuad(mk(mx, 3, -0.35), mk(mx + 1.1, 3, -0.35), mk(mx + 1.1, 9.8, -0.35), mk(mx, 9.8, -0.35), [70, 54, 42], { light: 0.95 });
        // Sign plate + letter ticks (deterministic per bay).
        const signC = SIGN_COLS[Math.abs(bid + bayIdx * 3 + (face.axis === 'x' ? 2 : 0)) % SIGN_COLS.length];
        addQuad(mk(a0 + 0.8, 11.6, -0.3), mk(a0 + 20.2, 11.6, -0.3), mk(a0 + 20.2, 15.6, -0.3), mk(a0 + 0.8, 15.6, -0.3), signC, { light: 1.02 });
        const ticks = 4 + Math.floor(hash01(bid * 31 + bayIdx * 57) * 4);
        for (let ti = 0; ti < ticks; ti++) {
          const tx = a0 + 2.6 + ti * 2.3;
          if (tx > a0 + 18.4) break;
          addQuad(mk(tx, 12.7, -0.45), mk(tx + 1.3, 12.7, -0.45), mk(tx + 1.3, 14.6, -0.45), mk(tx, 14.6, -0.45), [38, 30, 26], { light: 1.0 });
        }
      }
    }
    // Trim bands: a lighter horizontal band every ~50 units breaks the
    // facade into storeys even where windows are sparse (texture pass).
    if (distC < 860) for (let bz = 42; bz < H - 12; bz += 50) {
      addQuad(mk(face.from + 3, bz, -0.25), mk(face.to - 3, bz, -0.25), mk(face.to - 3, bz + 2.6, -0.25), mk(face.from + 3, bz + 2.6, -0.25), wallSun.map((v) => Math.min(255, v * 1.22)), { light: 1.0 });
    }
    // Windows: framed, inset quads in a strict rhythm; rows every ~24 units.
    if (distC < 860) {
      const frameC = [43, 44, 51];
      const colW = 19, rowH = 25;
      const winOff = hash01(bid * 47) * colW;
      for (let a0 = face.from + 10 + winOff; a0 < face.to - 13; a0 += colW) {
        const colSeed = Math.floor((a0 + winOff) / colW);
        for (let z0 = 17; z0 < H - 18; z0 += rowH) {
          const wh = hash01(bid * 131 + Math.floor(z0 / rowH) * 17 + colSeed * 7 + (face.axis === 'x' ? 900 : 0));
          const litWin = wh > wth;
          // Lit windows are capped warm — never a pure-white quad: the colour
          // is pre-dimmed and the light multiplier stays under 1, so even the
          // brightest pane keeps its amber tint at grazing angles.
          const wc = litWin ? winCol.map((v) => v * 0.82) : [92, 108, 128];
          addQuad(mk(a0, z0, -0.2), mk(a0 + colW * 0.6, z0, -0.2), mk(a0 + colW * 0.6, z0 + rowH * 0.56, -0.2), mk(a0, z0 + rowH * 0.56, -0.2), frameC, { light: 0.95 });
          addQuad(mk(a0 + colW * 0.07, z0 + rowH * 0.07), mk(a0 + colW * 0.53, z0 + rowH * 0.07), mk(a0 + colW * 0.53, z0 + rowH * 0.49), mk(a0 + colW * 0.07, z0 + rowH * 0.49), wc, { light: litWin ? 0.96 : 1.0 });
        }
      }
    }
  }
}

// --------------------------------------------------------------------- cars
function drawTank3D(car) {
  const opts = { cat: 'tank' };
  const yaw = car.angle, L = car.len, W = car.wid;
  const camo = [92, 100, 74], camoD = [70, 78, 56], dark = [34, 36, 32];
  addShadow(car.x, car.y, L / 2, W / 2, yaw, 12, 0.34);
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const LP = (lx, ly, lz) => [car.x + lx * c - ly * sn, car.y + lx * sn + ly * c, lz];
  // Tracks: two long dark runs with road wheels.
  for (const sy of [1, -1]) {
    addBox(car.x - sn * sy * (W / 2 - 3.6), car.y + c * sy * (W / 2 - 3.6), 3.6, L / 2, 3.6, 3.6, yaw, dark, opts);
    for (const wx of [-L * 0.32, -L * 0.11, L * 0.11, L * 0.32]) { const wp = LP(wx, sy * (W / 2 - 0.4), 3.4); addBox(wp[0], wp[1], wp[2], 2.6, 0.8, 2.6, yaw, [58, 60, 54], opts); }
  }
  // Hull with a sloped glacis, camo two-tone.
  addBox(car.x, car.y, 7.6, L / 2 - 2, W / 2 - 6.5, 3.9, yaw, { top: camo, front: camoD, back: camoD, sideP: camo, sideM: camo }, { vGrad: true, ...opts });
  addQuad(LP(L / 2 - 2, -W / 2 + 7, 4.2), LP(L / 2 - 2, W / 2 - 7, 4.2), LP(L * 0.18, W / 2 - 7.5, 11.4), LP(L * 0.18, -W / 2 + 7.5, 11.4), camoD, opts);
  addBox(car.x, car.y, 11.2, L * 0.30, W / 2 - 6.0, 0.9, yaw, camoD, opts);
  // Turret (traverses on car.turret) + barrel + muzzle brake + hatch.
  const t = car.turret || yaw, tc = Math.cos(t), ts = Math.sin(t);
  const tX = car.x - c * 2, tY = car.y - sn * 2;
  addBox(tX, tY, 14.6, 11, 9.5, 3.4, t, { top: camo, front: camoD, back: camoD, sideP: camo, sideM: camo }, opts);
  addBox(tX + tc * 3, tY + ts * 3, 18.4, 4.6, 4.6, 1.2, t, camoD, opts);
  const b0 = [tX + tc * 10, tY + ts * 10, 15.2], b1 = [tX + tc * 34, tY + ts * 34, 15.6];
  addTaperedLimb(b0, b1, 3.4, 2.4, 3.4, 2.4, dark, [0, 0, 1], opts);
  addBox(b1[0], b1[1], b1[2], 3.4, 3.4, 2.0, t, dark, opts);
  addLimb([tX - tc * 6, tY - ts * 6, 18], [tX - tc * 7.5, tY - ts * 7.5, 27], 0.7, 0.7, dark, [0, 0, 1], opts);
}
function drawPlane3D(car) {
  const opts = { cat: 'plane' };
  const yaw = car.angle, alt = car.alt || 0, zb = alt;
  const body = rgb(car.color), bodyTop = body.map((v) => Math.min(255, v * 1.18));
  addShadow(car.x, car.y, 30, 26, yaw, 8, Math.max(0.08, 0.30 - alt * 0.0016));
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const LP = (lx, ly, lz) => [car.x + lx * c - ly * sn, car.y + lx * sn + ly * c, (lz || 0) + zb];
  // Fuselage: tapered nose-to-tail volume riding on two floats.
  addTaperedLimb(LP(-30, 0, 9), LP(28, 0, 10), 11, 8.5, 11, 8.5, body, [0, 0, 1], opts);
  addBox(LP(6, 0, 14.5)[0], LP(6, 0, 14.5)[1], 14.5 + zb, 9, 6.4, 3.4, yaw, { top: bodyTop, front: [24, 33, 48], back: [24, 33, 48], sideP: [24, 33, 48], sideM: [24, 33, 48] }, opts);
  for (const sy of [1, -1]) addBox(LP(2, sy * 8.5, 3.4)[0], LP(2, sy * 8.5, 3.4)[1], 3.4 + zb, 17, 2.2, 2.6, yaw, [52, 56, 62], opts);
  // Main wing + tailplane + fin.
  addQuad(LP(10, -31, 11.5), LP(2, -31, 11.5), LP(0, 31, 11.5), LP(8, 31, 11.5), bodyTop, opts);
  addQuad(LP(-26, -13, 12), LP(-31, -13, 12), LP(-31, 13, 12), LP(-26, 13, 12), bodyTop, opts);
  addQuad(LP(-30, 0, 12), LP(-25, 0, 12), LP(-26.5, 0, 22), LP(-29.5, 0, 22), body, opts);
  // Propeller disc at the nose (vertical, facing forward).
  const nose = LP(31, 0, 10);
  const seg = 10, propPts = [];
  for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; propPts.push([nose[0], nose[1] + Math.cos(a) * 8.6, nose[2] + Math.sin(a) * 8.6]); }
  addPoly(propPts, [30, 30, 34], { alpha: 0.4, double: true, ...opts });
}
function drawCar3D(car, game) {
  if (car.kind === 'tank') { const dx0 = car.x - F.cam[0], dy0 = car.y - F.cam[1]; if (dx0 * dx0 + dy0 * dy0 <= 1080 * 1080) drawTank3D(car); return; }
  if (car.kind === 'plane') { const dx0 = car.x - F.cam[0], dy0 = car.y - F.cam[1]; if (dx0 * dx0 + dy0 * dy0 <= 1250 * 1250) drawPlane3D(car); return; }
  const dx = car.x - F.cam[0], dy = car.y - F.cam[1];
  if (dx * dx + dy * dy > 1080 * 1080) return;
  // Near-plane guard: a car at or behind the lens near-plane clips into huge
  // frame-filling polygons (the red artifact that intruded over the HUD in
  // the first 3D chase capture). Cars there are behind the viewer anyway.
  if (toCam([car.x, car.y, 6])[2] < 16) return;
  const isHero = car === F.heroCar;
  const cat = isHero ? 'car' : undefined;
  const opts = cat ? { cat } : {};
  const yaw = car.angle;
  const L = car.len || 38, W = car.wid || 19;
  const body = car.dead ? [44, 44, 48] : rgb(car.color);
  const bodyTop = body.map((v) => Math.min(255, v * 1.2));
  const isVan = car.kind === 'van';
  const bodyTopZ = isVan ? 10.2 : 8.2;
  const roofZ = isVan ? 11.6 : CAR_ROOF;
  addShadow(car.x, car.y, L / 2, W / 2, yaw, 9, 0.32);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const LP = (lx, ly, lz) => [car.x + lx * c - ly * s, car.y + lx * s + ly * c, lz];
  // Lower body + sloped hood / trunk.
  addBox(car.x, car.y, bodyTopZ / 2 + 0.9, L / 2, W / 2, bodyTopZ / 2 - 0.9, yaw, { top: bodyTop, front: body, back: body, sideP: body, sideM: body }, { vGrad: true, ...opts });
  addQuad(LP(L / 2, -W / 2 + 1, bodyTopZ - 1.2), LP(L / 2, W / 2 - 1, bodyTopZ - 1.2), LP(L * 0.24, W / 2 - 1.6, bodyTopZ + 0.4), LP(L * 0.24, -W / 2 + 1.6, bodyTopZ + 0.4), bodyTop, opts);
  addQuad(LP(-L * 0.24, -W / 2 + 1.6, bodyTopZ + 0.4), LP(-L * 0.24, W / 2 - 1.6, bodyTopZ + 0.4), LP(-L / 2, W / 2 - 1, bodyTopZ - 0.9), LP(-L / 2, -W / 2 + 1, bodyTopZ - 0.9), bodyTop, opts);
  // Paint highlight streak: a sun-caught gloss line along both flanks —
  // the texture pass's vehicle-paint shading (subtle, never neon).
  for (const sy of [1, -1]) addQuad(LP(-L * 0.42, sy * (W / 2 + 0.16), bodyTopZ - 1.0), LP(L * 0.40, sy * (W / 2 + 0.16), bodyTopZ - 1.0), LP(L * 0.40, sy * (W / 2 + 0.16), bodyTopZ - 2.6), LP(-L * 0.42, sy * (W / 2 + 0.16), bodyTopZ - 2.6), bodyTop, { light: 1.28, alpha: 0.5, ...opts });
  // Bumpers + side skirt.
  addBox(car.x + c * (L / 2 + 0.8), car.y + s * (L / 2 + 0.8), 3.6, 1.6, W / 2 - 0.6, 2.2, yaw, [30, 31, 36], opts);
  addBox(car.x - c * (L / 2 + 0.8), car.y - s * (L / 2 + 0.8), 3.6, 1.6, W / 2 - 0.6, 2.2, yaw, [30, 31, 36], opts);
  // Cabin: frame + inset glass + narrower roof (the taper), sloped windshield.
  const cabLen = isVan ? L * 0.52 : L * 0.46, cabWid = W - 3.4;
  const cabOff = isVan ? -L * 0.08 : L * 0.03;
  const cabX = car.x + c * cabOff, cabY = car.y + s * cabOff;
  const cabCZ = (bodyTopZ + roofZ) / 2, cabHZ = (roofZ - bodyTopZ) / 2;
  addBox(cabX, cabY, cabCZ, cabLen / 2, cabWid / 2, cabHZ, yaw, body.map((v) => v * 0.85), opts);
  addBox(cabX, cabY, cabCZ, cabLen / 2 - 1.1, cabWid / 2 - 1.0, cabHZ - 0.5, yaw, { top: [24, 33, 48], front: GLASS, back: GLASS, sideP: GLASS, sideM: GLASS }, opts);
  addBox(cabX, cabY, roofZ - 0.4, cabLen / 2 - 2.2, cabWid / 2 - 1.9, 0.55, yaw, bodyTop, opts);
  // Door seams + mirrors.
  for (const sy of [1, -1]) {
    for (const lx of [-L * 0.08, L * 0.16]) {
      addQuad(LP(lx, sy * (W / 2 + 0.14), 2.6), LP(lx + 0.8, sy * (W / 2 + 0.14), 2.6), LP(lx + 0.8, sy * (W / 2 + 0.14), bodyTopZ - 0.6), LP(lx, sy * (W / 2 + 0.14), bodyTopZ - 0.6), [16, 17, 21], { light: 0.9, ...opts });
    }
    const mp = LP(L * 0.26, sy * (W / 2 + 1.1), bodyTopZ + 1.6);
    addBox(mp[0], mp[1], mp[2], 1.2, 2.0, 1.5, yaw, [22, 23, 28], opts);
  }
  // Wheels: dark blocks in arches + lighter hubs.
  for (const [lx, ly] of [[L / 2 - 7.5, W / 2 - 0.7], [L / 2 - 7.5, -W / 2 + 0.7], [-L / 2 + 7.5, W / 2 - 0.7], [-L / 2 + 7.5, -W / 2 + 0.7]]) {
    const wx = car.x + lx * c - ly * s, wy = car.y + lx * s + ly * c;
    addBox(wx, wy, 3.3, 3.1, 1.7, 3.1, yaw, TYRE, opts);
    addBox(wx, wy + (ly > 0 ? 0.95 : -0.95), 3.3, 1.7, 0.5, 1.7, yaw, [86, 88, 94], opts);
  }
  // Lights.
  const quadAt = (lx, ly, z, wHalf, hHalf, col, light) => {
    const px = car.x + Math.cos(yaw) * lx - Math.sin(yaw) * ly, py = car.y + Math.sin(yaw) * lx + Math.cos(yaw) * ly;
    const side = [-Math.sin(yaw) * wHalf, Math.cos(yaw) * wHalf];
    const out = [Math.cos(yaw) * Math.sign(lx) * 0.55, Math.sin(yaw) * Math.sign(lx) * 0.55];
    addQuad([px + side[0] + out[0], py + side[1] + out[1], z - hHalf], [px - side[0] + out[0], py - side[1] + out[1], z - hHalf],
      [px - side[0] + out[0], py - side[1] + out[1], z + hHalf], [px + side[0] + out[0], py + side[1] + out[1], z + hHalf], col, { light, ...opts });
  };
  quadAt(-L / 2 - 0.4, W / 2 - 3.4, 5.6, 2.9, 1.4, [255, 52, 60], 1.45);
  quadAt(-L / 2 - 0.4, -W / 2 + 3.4, 5.6, 2.9, 1.4, [255, 52, 60], 1.45);
  quadAt(L / 2 + 0.4, W / 2 - 3.4, 5.8, 2.9, 1.4, [255, 243, 190], 1.35);
  quadAt(L / 2 + 0.4, -W / 2 + 3.4, 5.8, 2.9, 1.4, [255, 243, 190], 1.35);
  // Headlight pool on the asphalt ahead (kept small and faint: a big flat disc
  // reads as a manhole cover, not as light).
  if (!car.dead) {
    const hx = car.x + c * (L / 2 + 20), hy = car.y + s * (L / 2 + 20);
    if (isOnRoad(hx, hy)) addDisc(hx, hy, 0.36, 10, [255, 240, 200], { alpha: 0.05, light: 1 });
  }
  if (car.isCop) {
    // White band + flashing light bar (phase from the frozen game clock: deterministic).
    addBox(car.x, car.y, 5.4, L * 0.30, W / 2 + 0.22, 3.4, yaw, [236, 239, 243], opts);
    const flash = Math.sin(F.time * 10 + (car.sirenPhase || 0)) > 0;
    const lbX = car.x + c * cabOff, lbY = car.y + s * cabOff;
    const sideOff = [-s * 4.4, c * 4.4];
    if (!car.dead) {
      addBox(lbX + sideOff[0], lbY + sideOff[1], roofZ + 0.9, 2.8, 4.2, 1.5, yaw, flash ? [255, 60, 90] : [130, 34, 48], { light: 1.55, ...opts });
      addBox(lbX - sideOff[0], lbY - sideOff[1], roofZ + 0.9, 2.8, 4.2, 1.5, yaw, flash ? [44, 96, 168] : [30, 205, 254], { light: 1.55, ...opts });
    }
  }
  if (isHero && !isVan) {
    // Hero distinction: low spoiler on struts + full-width tail bar.
    const wingOff = [c * -L * 0.44, s * -L * 0.44];
    addBox(car.x + wingOff[0], car.y + wingOff[1], roofZ - 0.6, 2.0, W / 2 - 0.8, 1.0, yaw, [24, 25, 30], opts);
    for (const sy of [6.4, -6.4]) {
      const stOff = [c * -L * 0.44 - s * sy, s * -L * 0.44 + c * sy];
      addBox(car.x + stOff[0], car.y + stOff[1], roofZ - 3.4, 1.3, 1.3, 2.4, yaw, [24, 25, 30], opts);
    }
    quadAt(-L / 2 - 0.5, 0, 7.6, W / 2 - 1.6, 1.5, [255, 40, 56], 1.6);
  }
  // Damage smoke: collected as SOFT SPRITES (radial-gradient discs drawn
  // after the painter pass) — polygon puffs read as grey blobs/render errors.
  if (!car.dead && car.hp < car.maxHp * 0.35) {
    const hx = car.x + c * L * 0.26, hy = car.y + s * L * 0.26;
    const grey = [148, 146, 150];
    F.softSprites.push({ x: hx, y: hy, z: 14.5, r: 7.5, a: 0.34, col: grey });
    F.softSprites.push({ x: hx + 3, y: hy - 2, z: 19, r: 10.5, a: 0.24, col: grey });
    F.softSprites.push({ x: hx + 5, y: hy - 3, z: 24, r: 13.5, a: 0.15, col: grey });
  }
}

// ------------------------------------------------------------------ figures
// ONE articulated figure renderer: tapered thigh/shin and upper/fore arms, torso,
// head with a shaped hair mass. Poses: walk / run (mid-stride from walkPhase),
// stand, aim (both arms levelled along the facing, combat stance).
function drawFigure3D(o) {
  const dx = o.x - F.cam[0], dy = o.y - F.cam[1];
  if (dx * dx + dy * dy > 820 * 820) return;
  const cat = o.isPlayer ? 'fig' : undefined;
  const opts = cat ? { cat } : {};
  const a = o.angle;
  const f = [Math.cos(a), Math.sin(a)], s = [-Math.sin(a), Math.cos(a)];
  const P = (fu, sv, z) => [o.x + f[0] * fu + s[0] * sv, o.y + f[1] * fu + s[1] * sv, z];
  const sideHint = [s[0], s[1], 0];
  addShadow(o.x, o.y, 6.5, 6.5, a, 13, 0.28);
  if (o.dead) {
    // Fallen body: low elongated volumes along the facing, head at the front —
    // a flatter angular slab + hair slab, consistent with the slab-built head.
    addBox(o.x, o.y, 1.6, 8.6, 3.0, 1.6, a, o.shirt, opts);
    const hc = P(10.6, 0, 1.5);
    addBox(hc[0], hc[1], hc[2], 1.9, 1.9, 0.85, a, o.skin, opts);
    const hr = P(10.1, 0, 2.15);
    addBox(hr[0], hr[1], hr[2], 1.6, 1.95, 0.35, a, o.hair, opts);
    return;
  }
  // (No ground identity ring in 3D: at chase-cam distance an 11–13-unit ring
  // projects as a huge arc across the foreground. The player is the centred
  // figure in the shirt colour — identity needs no marker here.)
  const pose = o.pose, ph = o.phase || 0;
  // Polygon War proportions (ported as original code): the bigger angular
  // head is compensated by a slightly shorter body — hip 6.8 (thigh 3.5 +
  // shin 3.3), shoulders 11.2, crown still exactly FIG_H 15.4.
  const hipZ = 6.8, shoZ = 11.2;
  const lean = pose === 'run' ? 2.6 : pose === 'aim' ? 1.6 : pose === 'walk' ? 0.8 : 0;
  // Legs: thigh (3.5) + shin (3.3), tapered, hips wide enough that the two legs
  // stay separate volumes from behind instead of merging into one slab.
  for (const sideSign of [1, -1]) {
    const hip = P(0, sideSign * 1.9, hipZ);
    let knee, foot;
    if (pose === 'walk' || pose === 'run') {
      const amp = pose === 'run' ? 0.82 : 0.52;
      const sw = Math.sin(ph + (sideSign > 0 ? 0 : Math.PI)) * amp;
      const sw2 = sw - (pose === 'run' ? 0.55 : 0.40);
      knee = P(Math.sin(sw) * 3.5, sideSign * 1.9, hipZ - Math.cos(sw) * 3.5);
      foot = P(Math.sin(sw) * 3.5 + Math.sin(sw2) * 3.3, sideSign * 2.0, Math.max(0.75, hipZ - Math.cos(sw) * 3.5 - Math.cos(sw2) * 3.3));
    } else if (pose === 'aim') {
      if (sideSign > 0) { knee = P(4.0, 2.0, hipZ - 3.3); foot = P(8.4, 2.3, 0.75); }
      else { knee = P(-2.7, -2.0, hipZ - 3.4); foot = P(-6.6, -2.4, 0.75); }
    } else {
      knee = P(0.3, sideSign * 2.0, hipZ - 3.5);
      foot = P(0.9, sideSign * 2.15, 0.75);
    }
    addTaperedLimb(hip, knee, 2.4, 1.9, 2.4, 1.9, o.pants, sideHint, opts);
    addTaperedLimb(knee, foot, 1.9, 1.4, 1.9, 1.4, o.pants, sideHint, opts);
    addBox(foot[0] + f[0] * 0.9, foot[1] + f[1] * 0.9, 0.72, 1.95, 1.1, 0.72, a, [26, 22, 19], opts); // shoe
  }
  // Pelvis + tapered torso.
  addBox(o.x, o.y, hipZ - 0.7, 2.3, 2.8, 1.7, a, o.pants, opts);
  const hipC = P(0, 0, hipZ + 0.5), shoC = P(lean, 0, shoZ);
  addTaperedLimb(hipC, shoC, 4.6, 5.6, 3.0, 3.3, o.shirt, sideHint, opts);
  // Modular tactical gear (player + crew only; peds are unarmed civilians):
  // olive vest slabs front + back NARROWER (4.4) than the 5.6 torso, so the
  // shirt colour still frames both sides, three khaki mag pouches on the
  // front slab, olive-dark shoulder straps, darkened-shirt shoulder pads.
  if (o.gear) {
    const OLIVE = [86, 93, 63], OLIVE_D = [57, 64, 45], KHAKI = [139, 138, 103];
    const midZ = (hipZ + shoZ) / 2, midLean = lean * 0.55, vestHZ = (shoZ - hipZ) * 0.42;
    const vf = P(midLean + 1.72, 0, midZ), vb = P(midLean - 1.72, 0, midZ);
    addBox(vf[0], vf[1], vf[2], 0.30, 2.2, vestHZ, a, OLIVE, opts);
    addBox(vb[0], vb[1], vb[2], 0.30, 2.2, vestHZ, a, OLIVE, opts);
    for (const px of [-1.35, 0, 1.35]) {
      const pp = P(midLean + 2.12, px, hipZ + 1.55);
      addBox(pp[0], pp[1], pp[2], 0.34, 0.52, 0.72, a, KHAKI, opts);
    }
    for (const sx of [1, -1]) {
      const st = P(lean * 0.85, sx * 1.45, shoZ - 0.25);
      addBox(st[0], st[1], st[2], 1.75, 0.45, 0.30, a, OLIVE_D, opts);
      const pd = P(lean, sx * 3.15, shoZ - 0.05);
      addBox(pd[0], pd[1], pd[2], 1.55, 1.0, 0.5, a, o.shirt.map((v) => v * 0.62), opts);
    }
    // Slung long gun on the back when not aiming: a slim dark vertical box
    // behind the torso, spanning hipZ+0.5 → shoZ+0.8.
    if (pose === 'stand' || pose === 'walk' || pose === 'run') {
      const sg = P(-2.4, 0, (hipZ + 0.5 + shoZ + 0.8) / 2);
      addBox(sg[0], sg[1], sg[2], 0.45, 0.55, (shoZ + 0.8 - hipZ - 0.5) / 2, a, [37, 39, 45], opts);
    }
  }
  // Neck + ANGULAR SLAB HEAD (Polygon War read — no spheres): stacked
  // tapered slabs, narrow jaw → wide cranium (≈4.5, 80% of the 5.6 torso)
  // → crown, with flat hair slabs (top cap + back + sides) and a hair-colour
  // brow ridge on the front face. The assembly spans shoZ → FIG_H (15.4):
  // silhouette is the goal — big angular head, hard edges, flat tones.
  addTaperedLimb(P(lean, 0, shoZ - 0.4), P(lean + 0.2, 0, shoZ + 0.55), 2.0, 2.0, 2.0, 2.0, o.skin, sideHint, opts); // neck stub
  addTaperedLimb(P(lean + 0.25, 0, shoZ + 0.35), P(lean + 0.3, 0, shoZ + 1.7), 2.9, 3.5, 2.7, 3.1, o.skin, sideHint, opts); // jaw slab
  addTaperedLimb(P(lean + 0.3, 0, shoZ + 1.7), P(lean + 0.3, 0, shoZ + 3.2), 3.5, 4.5, 3.1, 3.4, o.skin, sideHint, opts); // cranium slab
  addTaperedLimb(P(lean + 0.3, 0, shoZ + 3.2), P(lean + 0.3, 0, FIG_H - 0.25), 4.5, 4.0, 3.4, 3.0, o.skin, sideHint, opts); // crown slab
  {
    const ht = P(lean + 0.3, 0, FIG_H - 0.25);
    addBox(ht[0], ht[1], ht[2], 1.72, 2.15, 0.25, a, o.hair, opts); // hair top cap (top at FIG_H)
    const hb = P(lean + 0.3 - 1.62, 0, shoZ + 2.75);
    addBox(hb[0], hb[1], hb[2], 0.32, 2.05, 1.30, a, o.hair, opts); // hair back slab
    for (const sx of [1, -1]) {
      const hs = P(lean + 0.3, sx * 2.18, shoZ + 2.85);
      addBox(hs[0], hs[1], hs[2], 1.50, 0.28, 1.12, a, o.hair, opts); // hair side slabs
    }
    const br = P(lean + 0.3 + 1.78, 0, shoZ + 2.65);
    addBox(br[0], br[1], br[2], 0.20, 1.85, 0.30, a, o.hair, opts); // brow ridge
  }
  // Arms: upper (3.4) + forearm (3.2), tapered; hands in skin tone.
  for (const sideSign of [1, -1]) {
    const sho = P(lean, sideSign * 3.15, shoZ - 0.3);
    let elbow, hand;
    if (pose === 'aim') {
      // Two-handed long-gun aim: elbows dropped and wide, the gun-side hand
      // back at the grip, the support hand forward under the handguard —
      // from behind, the arms silhouette OUTSIDE the torso instead of
      // merging into a shoulder slab.
      if (sideSign > 0) { elbow = P(lean + 1.0, 3.6, shoZ - 2.2); hand = P(lean + 4.2, 1.1, shoZ - 1.2); }
      else { elbow = P(lean + 5.2, -3.05, shoZ - 1.9); hand = P(lean + 10.5, 0.5, shoZ - 0.6); }
    } else if (pose === 'walk' || pose === 'run') {
      const amp = pose === 'run' ? 0.78 : 0.44;
      const sw = Math.sin(ph + (sideSign > 0 ? Math.PI : 0)) * amp;
      elbow = P(lean + Math.sin(sw) * 3.4, sideSign * 3.4, shoZ - 0.3 - Math.cos(sw) * 3.4);
      const sw2 = sw * 0.7 - 0.32;
      hand = P(lean + Math.sin(sw) * 3.4 + Math.sin(sw2) * 3.2, sideSign * 3.4, shoZ - 0.3 - Math.cos(sw) * 3.4 - Math.cos(sw2) * 3.2);
    } else {
      elbow = P(lean + 0.6, sideSign * 3.4, shoZ - 3.6);
      hand = P(lean + 1.4, sideSign * 3.3, shoZ - 6.7);
    }
    addTaperedLimb(sho, elbow, 2.2, 1.75, 2.2, 1.75, o.shirt, sideHint, opts);
    addTaperedLimb(elbow, hand, 1.75, 1.35, 1.75, 1.35, o.skin, sideHint, opts);
    addBox(hand[0], hand[1], hand[2], 0.85, 0.85, 0.85, a, o.skin, opts);
    if (pose === 'aim' && sideSign > 0) {
      // The TWO-HANDED LONG GUN at shoulder height (Polygon War gun greys):
      // stock block against the shoulder, receiver running forward along
      // the facing at z ≈ shoZ + 0.2 (sight line near the cheek), barrel
      // extension to ≈ +20 forward, magazine angled down below the receiver.
      const GUN = [37, 39, 45], GUN_TIP = [52, 55, 63];
      const stock = P(lean + 0.9, 0.95, shoZ + 0.05);
      addBox(stock[0], stock[1], stock[2], 1.6, 0.55, 0.95, a, GUN, opts);
      const r0 = P(lean + 2.4, 0.8, shoZ + 0.2), r1 = P(lean + 11.0, 0.6, shoZ + 0.2);
      addTaperedLimb(r0, r1, 1.5, 1.25, 1.9, 1.6, GUN, [0, 0, 1], opts); // receiver + handguard
      const b1 = P(lean + 18.4, 0.55, shoZ + 0.25);
      addTaperedLimb(r1, b1, 0.75, 0.65, 0.95, 0.85, GUN, [0, 0, 1], opts); // barrel
      const b2 = P(lean + 20.4, 0.55, shoZ + 0.3);
      addTaperedLimb(b1, b2, 0.95, 0.85, 1.15, 1.05, GUN_TIP, [0, 0, 1], opts); // muzzle tip
      const m0 = P(lean + 6.4, 0.7, shoZ - 0.1), m1 = P(lean + 7.4, 0.7, shoZ - 2.3);
      addTaperedLimb(m0, m1, 1.05, 0.9, 1.45, 1.3, GUN, sideHint, opts); // magazine, angled down
      const s1 = P(lean + 5.4, 0.65, shoZ + 1.15);
      addBox(s1[0], s1[1], s1[2], 0.9, 0.4, 0.45, a, GUN_TIP, opts); // rear sight block
    }
  }
}

// -------------------------------------------------------------------- props
function drawPalm(pm) {
  const dx = pm.x - F.cam[0], dy = pm.y - F.cam[1];
  if (dx * dx + dy * dy > 760 * 760) return;
  if (dx * dx + dy * dy < 95 * 95) return; // a trunk at the lens fills the frame
  const s = (pm.s || 1) * 0.72; // rescaled: canopy now spans ≈ one storey, not two
  const leanX = (pm.lean || 0) * 1.35;
  const H = 30 * s;
  // Fronds stay out of the words and panels: on the title screen a crown that
  // projects into the wordmark band is culled, and on the summary screen any
  // crown over the results panel is culled.
  if (F.screen === 'title' || F.screen === 'summary') {
    const crownP = projectPoint(pm.x + leanX * 2.2, pm.y, H + 2);
    if (crownP) {
      if (F.screen === 'title' && crownP.y > 150 && crownP.y < 360 && crownP.x > 240 && crownP.x < 1040) return;
      // Summary bound extends well past the frame's right edge: the palm
      // whose fronds entered the results frame's top-right corner has its
      // crown projecting at x≈1,530 (off-frame), and its ~26-unit fronds
      // still reach into the picture — cull by crown out to 1,700.
      if (F.screen === 'summary' && crownP.y > 40 && crownP.y < 760 && crownP.x > -280 && crownP.x < 1700) return;
    }
  }
  addShadow(pm.x, pm.y, 3.5, 3.5, 0, 16, 0.22);
  // Curved trunk: four stacked tapered segments leaning with the palm.
  let p0 = [pm.x, pm.y, 0];
  for (let i = 0; i < 4; i++) {
    const t0 = i / 4, t1 = (i + 1) / 4;
    const p1 = [pm.x + leanX * t1 * t1 * 2.2, pm.y, H * t1];
    void t0;
    addTaperedLimb(p0, p1, 4.6 - i * 0.5, 4.1 - i * 0.5, 4.6 - i * 0.5, 4.1 - i * 0.5, rgb(PALETTE.palmTrunk), [0, 0, 1]);
    p0 = p1;
  }
  const crown = p0;
  addBox(crown[0], crown[1], crown[2] + 0.8, 2.9, 2.9, 2.4, 0, [84, 64, 36], {});
  // Fronds: BROAD drooping bent planes joined at the crown (never spike lines):
  // wide at the base, widest at the mid-bend, falling to the tip.
  const seed = Math.floor(Math.abs(pm.x) * 3 + Math.abs(pm.y) * 7);
  const crownCamZ = toCam([crown[0], crown[1], crown[2]])[2];
  for (let i = 0; i < 8; i++) {
    const la = (i / 8) * Math.PI * 2 + hash01(seed + i) * 0.45;
    const len = (26 + hash01(seed + i * 3) * 6) * s;
    const drop = (13 + hash01(seed + i * 7) * 5) * s;
    const dir = [Math.cos(la), Math.sin(la)], perp = [-dir[1], dir[0]];
    const tip = [crown[0] + dir[0] * len, crown[1] + dir[1] * len, crown[2] + 1 - drop];
    if (toCam(tip)[2] < crownCamZ * 0.42) continue; // frond aimed at the lens reads as a plank
    const mid = [crown[0] + dir[0] * len * 0.52, crown[1] + dir[1] * len * 0.52, crown[2] + 4.4 * s];
    const col = i % 2 ? rgb(PALETTE.palmDark) : rgb(PALETTE.palmLight);
    addPoly([
      [crown[0] + perp[0] * 2.6, crown[1] + perp[1] * 2.6, crown[2] + 0.6],
      [mid[0] + perp[0] * 3.4, mid[1] + perp[1] * 3.4, mid[2]],
      tip,
      [mid[0] - perp[0] * 3.4, mid[1] - perp[1] * 3.4, mid[2]],
      [crown[0] - perp[0] * 2.6, crown[1] - perp[1] * 2.6, crown[2] + 0.6],
    ], col, { double: true });
    // Centre rib: a narrow darker plane along the frond's spine, so the leaf
    // reads as a folded frond with dimension instead of a flat paper triangle.
    const rib = col.map((v) => v * 0.62);
    addPoly([
      [crown[0] + perp[0] * 0.9, crown[1] + perp[1] * 0.9, crown[2] + 0.9],
      [mid[0] + perp[0] * 1.1, mid[1] + perp[1] * 1.1, mid[2] + 0.5],
      tip,
      [mid[0] - perp[0] * 1.1, mid[1] - perp[1] * 1.1, mid[2] + 0.5],
      [crown[0] - perp[0] * 0.9, crown[1] - perp[1] * 0.9, crown[2] + 0.9],
    ], rib, { double: true });
  }
}
function drawTree(t) {
  const dx = t.x - F.cam[0], dy = t.y - F.cam[1];
  if (dx * dx + dy * dy > 760 * 760) return;
  const r = t.r || 13;
  // Foliage stays clear of the wordmark and the results panel, as palms do:
  // a crown projecting into either zone is culled on those screens.
  if (F.screen === 'title' || F.screen === 'summary') {
    const crownP = projectPoint(t.x, t.y, 15 + r);
    if (crownP) {
      if (F.screen === 'title' && crownP.y > 140 && crownP.y < 370 && crownP.x > 220 && crownP.x < 1060) return;
      if (F.screen === 'summary' && crownP.y > 50 && crownP.y < 750 && crownP.x > 230 && crownP.x < 1050) return;
    }
  }
  addShadow(t.x, t.y, 4, 4, 0, 15, 0.22);
  addTaperedLimb([t.x, t.y, 0], [t.x, t.y, 13], 3.6, 2.6, 3.6, 2.6, [96, 74, 48], [0, 0, 1]);
  // Rounded canopy: three overlapping lathed spheres read as foliage mass
  // from every angle — the old octahedron blobs read as cut diamonds.
  const cz = 15 + r * 0.55;
  addSphere(t.x, t.y, cz, r * 0.95, rgb(PALETTE.treeDark), {});
  addSphere(t.x - r * 0.42, t.y + r * 0.3, cz - r * 0.16, r * 0.62, rgb(PALETTE.treeLight), {});
  addSphere(t.x + r * 0.38, t.y - r * 0.26, cz + r * 0.3, r * 0.5, rgb(PALETTE.treeLight).map((v) => v * 0.82), {});
}
function drawLamp(l) {
  const dx = l.x - F.cam[0], dy = l.y - F.cam[1];
  if (dx * dx + dy * dy > 700 * 700) return;
  if (dx * dx + dy * dy < 80 * 80) return;
  addLimb([l.x, l.y, 0], [l.x, l.y, 25], 1.6, 1.6, [34, 36, 42], [0, 0, 1]);
  // Warm but capped: at light 1.5 the head clamped to a floating white
  // rectangle — the same pure-white defect as the old window quads.
  addBox(l.x, l.y, 26, 2.4, 2.4, 1.7, 0, [238, 198, 138], { light: 1.12 });
  addDisc(l.x, l.y, 0.37, 12, [255, 180, 96], { alpha: 0.05, light: 1 });
}
function drawBoat(bt) {
  const dx = bt.x - F.cam[0], dy = bt.y - F.cam[1];
  if (dx * dx + dy * dy > 1250 * 1250) return;
  const s = bt.s || 1;
  addBox(bt.x, bt.y, 2.2 * s, 15 * s, 5 * s, 2.2 * s, 0, [232, 226, 212], {});
  addLimb([bt.x, bt.y, 3 * s], [bt.x, bt.y, 19 * s], 1.3, 1.3, [110, 88, 68], [0, 0, 1]);
  addPoly([[bt.x + 1.2 * s, bt.y, 18 * s], [bt.x + 1.2 * s, bt.y, 3.5 * s], [bt.x + 11 * s, bt.y, 3.5 * s]], rgb(bt.sail || '#f2e8d8'), { double: true, light: 1.02 });
}

// ---------------------------------------------------------------- particles
function drawParticles(game) {
  // ALL particles render as soft radial sprites after the painter pass —
  // polygon blobs (octahedron diamonds) read as rendering errors, worst at
  // close range where a 2-unit blob projects tens of pixels wide. Smoke
  // rises and expands; sparks/muzzle stay small, bright and short.
  for (const p of game.fx.particles || []) {
    const dx = p.x - F.cam[0], dy = p.y - F.cam[1];
    if (dx * dx + dy * dy > 700 * 700) continue;
    const ratio = clamp(p.life / (p.maxLife || 1), 0, 1);
    const col = parseColor(p.color, [255, 215, 106]);
    const isSmoke = p.color && p.color.indexOf('120,120,125') !== -1;
    if (isSmoke) {
      const baseR = Math.min(11, p.size * 1.5) * (1.25 - ratio * 0.45);
      F.softSprites.push({ x: p.x, y: p.y, z: 8 + (1 - ratio) * 7, r: baseR, a: 0.30, col: [148, 146, 150] });
      F.softSprites.push({ x: p.x + 2.5, y: p.y - 1.5, z: 12 + (1 - ratio) * 8, r: baseR * 1.35, a: 0.19, col: [148, 146, 150] });
    } else {
      F.softSprites.push({ x: p.x, y: p.y, z: 10.5, r: Math.min(1.7, p.size * 0.34), a: 0.88, col });
    }
  }
}

// --------------------------------------------------------------------- main
export function renderView3D(ctx, game) {
  const p = game.player;
  if (!p) return;
  const grade = GRADES[game.timeGrade] || GRADES.golden;
  const isDrive = !!p.inCar && !!p.car;
  const anchor = isDrive ? p.car : p;
  const yaw = anchor.angle || 0;
  // Planning camera: while the board is up the world stays live behind it —
  // a slow orbit of the job's target block, the street the plan is about.
  // Staged captures pin planOrbitAngle, so the frame is deterministic.
  const planning = game.screen === 'planning' && game.planTarget;
  let camX, camY, camH;
  if (planning) {
    const t = game.planTarget;
    // Live: a slow swing along the target's street canyon, never a full
    // rotation into the blocks behind. Staged: the pinned angle.
    const ang = typeof game.planOrbitAngle === 'number' ? game.planOrbitAngle : -0.5 + Math.sin((game.time || 0) * 0.07) * 0.75;
    camX = t.x + Math.cos(ang) * 235; camY = t.y + Math.sin(ang) * 235; camH = 105;
    F = newFrame([camX, camY, camH], [t.x - camX, t.y - camY, 6 - camH]);
  } else {
    // Camera: low chase cam behind the hero, smoothed in live play, snapped
    // exactly when frozen (screenshot staging) so captures are deterministic.
    // On foot the cam sits closer and higher than the original build
    // (52 back / 30 up, looking down at z 8 vs 72 / 26 / 10): a steeper
    // pitch and a larger player shrink the vacant band between the lens
    // and the player. (Measured: pitch beyond this stops helping — the
    // foreground is road-toned at any pitch; texture, not angle, is what
    // breaks it up, hence the crosswalks and asphalt patchwork below.)
    // GTA over-the-shoulder aim camera: while the aim predicate holds on
    // foot (bullets in flight or a shot inside the last 700 ms), the cam
    // closes to ≈30 back / ≈21 up and shifts laterally to the player's
    // gun side (+side, solved by projection: the player then lands in the
    // lower-LEFT of frame, big in the foreground) while the look target
    // swings to the opposite side, so the aim line runs up-frame through
    // the HUD reticle at (0.536·W, 0.5·H). Solved with a throwaway
    // projection solver against the renderer's own math, then verified
    // on the staged mission frame's ID render: player bbox centre
    // (394, 603) — x inside the 0.30–0.34·W band, y in the lower third
    // (the figure's feet crop at the frame bottom in true OTS style, so
    // the clipped bbox centre sits below the 0.66·H mark) — aim-line
    // distance to the reticle 9.4 px (bound ≈14), and the target sedan,
    // the tank, both roadblock cops and Dex all fully inside the frame.
    const aiming = !isDrive && ((game.bullets && game.bullets.length > 0) || (game.lastShotAt && game.nowMs - game.lastShotAt < 700));
    const back = isDrive ? 84 : aiming ? 30 : 52;
    camH = isDrive ? 30 : aiming ? 21 : 30;
    const fh = [Math.cos(yaw), Math.sin(yaw)];
    const sh = [-fh[1], fh[0]]; // screen-right side vector of the facing
    const camLat = aiming ? 24 : 0;
    const wantX = anchor.x - fh[0] * back + sh[0] * camLat, wantY = anchor.y - fh[1] * back + sh[1] * camLat;
    camX = wantX; camY = wantY;
    if (!game.frozen) {
      const prev = game.cam3d;
      if (prev) {
        const k = 0.22;
        camX = prev.x + (wantX - prev.x) * k;
        camY = prev.y + (wantY - prev.y) * k;
      }
      game.cam3d = { x: camX, y: camY };
    }
    // Camera collision safety (live play): if the chase point lands inside a
    // building footprint, pull it toward the hero until it is in open air.
    // Staged shots are already framed in the open, so this never fires there.
    if (pointInBuilding(game.city, camX, camY)) {
      for (const t of [0.3, 0.55, 0.8]) {
        const tx = anchor.x - fh[0] * back * (1 - t), ty = anchor.y - fh[1] * back * (1 - t);
        if (!pointInBuilding(game.city, tx, ty)) { camX = tx; camY = ty; break; }
      }
    }
    const lookLat = aiming ? -11 : 0;
    const lookFwd = aiming ? 55 : 40;
    const lookX = anchor.x + fh[0] * lookFwd + sh[0] * lookLat, lookY = anchor.y + fh[1] * lookFwd + sh[1] * lookLat;
    const lookZ = isDrive ? 9 : aiming ? 9 : 8;
    F = newFrame([camX, camY, camH], [lookX - camX, lookY - camY, lookZ - camH]);
  }
  F.idMode = !!game.idRender;
  F.heroCar = isDrive ? p.car : (game.shotHeroCar || null);
  F.time = game.time || 0;
  F.screen = game.screen || 'play';
  F.fog = grade.fog;
  F.lightScale = grade.light;
  F.wash = grade.wash;
  F.softSprites = []; // smoke rendered as soft radial sprites after the painter pass

  // Sky: sunset gradient (plum top → rose → orange-pink horizon) + low western sun.
  if (F.idMode) {
    ctx.fillStyle = 'rgb(0,0,0)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H * 0.78);
    grad.addColorStop(0, `rgb(${grade.top[0]},${grade.top[1]},${grade.top[2]})`);
    grad.addColorStop(0.55, `rgb(${grade.mid[0]},${grade.mid[1]},${grade.mid[2]})`);
    grad.addColorStop(1, `rgb(${grade.hor[0]},${grade.hor[1]},${grade.hor[2]})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const sunPt = projectPoint(camX + SUN_DIR[0] * 1200, camY + SUN_DIR[1] * 1200, camH + SUN_DIR[2] * 1200);
    if (sunPt) {
      const R = 330;
      const sg = ctx.createRadialGradient(sunPt.x, sunPt.y, 4, sunPt.x, sunPt.y, R);
      sg.addColorStop(0, 'rgba(255,205,130,0.85)');
      sg.addColorStop(0.25, 'rgba(255,170,95,0.34)');
      sg.addColorStop(1, 'rgba(255,150,80,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sunPt.x - R, sunPt.y - R, R * 2, R * 2);
      ctx.fillStyle = `rgb(${grade.sun[0]},${grade.sun[1]},${grade.sun[2]})`;
      ctx.beginPath(); ctx.arc(sunPt.x, sunPt.y, 26, 0, Math.PI * 2); ctx.fill();
    }
  }

  // World faces.
  drawGround(game);
  for (const b of game.city.buildings) drawBuilding(game, b);
  for (const t of game.city.trees || []) drawTree(t);
  for (const pm of game.city.palms || []) drawPalm(pm);
  for (const l of game.city.lamps) drawLamp(l);
  for (const bt of game.city.boats || []) drawBoat(bt);
  const allCars = [];
  for (const car of game.traffic) allCars.push(car);
  for (const car of game.specials || []) allCars.push(car);
  for (const cop of game.police.cops) allCars.push(cop);
  if (game.markedCarRef && !allCars.includes(game.markedCarRef)) allCars.push(game.markedCarRef);
  for (const car of allCars) {
    if (game.debugHideHeroCar && car === F.heroCar) continue;
    drawCar3D(car, game);
  }
  // Pedestrians: fleeing reads as a run, everyone else walks their phase.
  for (const ped of game.peds) {
    const fleeing = ped.fleeUntil && game.nowMs < ped.fleeUntil;
    drawFigure3D({
      x: ped.x, y: ped.y, angle: ped.angle, phase: ped.walkPhase || 0,
      pose: ped.dead ? 'stand' : fleeing ? 'run' : 'walk', dead: !!ped.dead,
      shirt: rgb(ped.shirt), skin: rgb(ped.skin || '#d9b48f'), pants: rgb(ped.pants || '#2e3440'),
      hair: rgb(ped.hairColor || '#2b2118'), isPlayer: false, gear: false,
    });
  }
  // The plan's crew mate on foot: the first picked crew member, in their own
  // colour, working the job beside the player (the grab is a two-hander).
  if (game.crewMate && !game.player.inCar) {
    const cm = game.crewMate;
    drawFigure3D({
      x: cm.x, y: cm.y, angle: cm.angle, phase: cm.walkPhase || 0,
      pose: cm.pose || 'walk', dead: false,
      shirt: rgb(cm.color || '#e8c832'), skin: rgb('#d9b48f'), pants: [40, 38, 44],
      hair: [30, 22, 16], isPlayer: false, gear: true,
    });
  }
  // Player on foot (in a car the car itself is the hero, drawn above).
  if (!isDrive && !game.debugHidePlayer) {
    const aiming = (game.bullets && game.bullets.length > 0) || (game.lastShotAt && game.nowMs - game.lastShotAt < 700);
    const moving = Math.abs(p.vx || 0) + Math.abs(p.vy || 0) > 4;
    drawFigure3D({
      x: p.x, y: p.y, angle: p.angle, phase: p.walkPhase || 0,
      pose: aiming ? 'aim' : moving ? 'walk' : 'stand', dead: false,
      shirt: rgb(PALETTE.playerShirt), skin: rgb(PALETTE.playerSkin), pants: [46, 52, 64],
      hair: [36, 26, 18], isPlayer: true, gear: true,
    });
  }
  drawParticles(game);

  // Painter's algorithm: far to near.
  F.faces.sort((a, b) => b.depth - a.depth);
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
  F.faces = [];

  if (!F.idMode) {
    // Soft smoke sprites: radial gradients projected over the painted world,
    // far puffs first. No hard polygon edge anywhere, so smoke reads as smoke.
    const sprites = (F.softSprites || []).slice();
    for (const sp of sprites) sp.proj = projectPoint(sp.x, sp.y, sp.z);
    sprites.filter((sp) => sp.proj).sort((a, b) => b.proj.dist - a.proj.dist);
    for (const sp of sprites) {
      if (!sp.proj) continue;
      const R = Math.max(4, (sp.r / sp.proj.dist) * FOCAL);
      const c = sp.col || [148, 146, 150];
      const g = ctx.createRadialGradient(sp.proj.x, sp.proj.y, R * 0.1, sp.proj.x, sp.proj.y, R);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${sp.a})`);
      g.addColorStop(0.55, `rgba(${c[0]},${c[1]},${c[2]},${sp.a * 0.55})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(sp.proj.x - R, sp.proj.y - R, R * 2, R * 2);
    }
    // Bullet tracers + muzzle glow, projected over the painted world.
    if (game.bullets && game.bullets.length) {
      ctx.save();
      for (const b of game.bullets) {
        const h0 = projectPoint(b.x - Math.cos(b.angle) * 13, b.y - Math.sin(b.angle) * 13, 11.5);
        const h1 = projectPoint(b.x + Math.cos(b.angle) * 3, b.y + Math.sin(b.angle) * 3, 11.5);
        if (!h0 || !h1) continue;
        ctx.strokeStyle = 'rgba(255,224,130,0.9)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(h0.x, h0.y); ctx.lineTo(h1.x, h1.y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,240,190,0.95)';
        ctx.beginPath(); ctx.arc(h1.x, h1.y, 3.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    // Sunset wash + warm vignette (heavier at dusk, per the frame's grade).
    const wA = F.wash || 1;
    const sg2 = ctx.createLinearGradient(0, 0, VIEW_W, VIEW_H * 0.4);
    sg2.addColorStop(0, `rgba(255,116,58,${0.13 * wA})`);
    sg2.addColorStop(0.45, `rgba(255,92,120,${0.05 * wA})`);
    sg2.addColorStop(1, `rgba(38,14,54,${0.08 * wA})`);
    ctx.fillStyle = sg2; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.42, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.88);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(30,8,16,0.34)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  F = null;
}
