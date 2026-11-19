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
    const col = opts.cat === 'fig' ? 'rgb(0,255,0)' : opts.cat === 'car' ? 'rgb(0,0,255)' : 'rgb(22,22,22)';
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
  const shade = (L) => {
    const rC = clamp(base[0] * L + (FOG[0] - base[0] * L) * fogT, 0, 255);
    const gC = clamp(base[1] * L + (FOG[1] - base[1] * L) * fogT, 0, 255);
    const bC = clamp(base[2] * L + (FOG[2] - base[2] * L) * fogT, 0, 255);
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
      const v = 0.96 + hash01((Math.floor(cx / CELL) * 13 + Math.floor(cy / CELL) * 29)) * 0.08;
      const col = base === WATER_C && hash01(Math.floor(cx / 46) * 7 + Math.floor(cy / 46) * 13) > 0.82
        ? [86, 150, 158] : [base[0] * v, base[1] * v, base[2] * v];
      const corners = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]].map(([df, dl]) => [
        F.cam[0] + fh[0] * (fwd + df) + rh[0] * (lat + dl),
        F.cam[1] + fh[1] * (fwd + df) + rh[1] * (lat + dl), 0.12,
      ]);
      addPoly(corners, col, { light: 0.92 });
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
function drawCar3D(car, game) {
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
    // Fallen body: low elongated volumes along the facing, head at the front.
    addBox(o.x, o.y, 1.6, 8.6, 3.0, 1.6, a, o.shirt, opts);
    const hc = P(10.6, 0, 1.7);
    addBox(hc[0], hc[1], hc[2], 1.6, 1.6, 1.6, a, o.skin, opts);
    return;
  }
  // (No ground identity ring in 3D: at chase-cam distance an 11–13-unit ring
  // projects as a huge arc across the foreground. The player is the centred
  // figure in the shirt colour — identity needs no marker here.)
  const pose = o.pose, ph = o.phase || 0;
  const hipZ = 7.2, shoZ = 11.8;
  const lean = pose === 'run' ? 2.6 : pose === 'aim' ? 1.6 : pose === 'walk' ? 0.8 : 0;
  // Legs: thigh (3.7) + shin (3.5), tapered, hips wide enough that the two legs
  // stay separate volumes from behind instead of merging into one slab.
  for (const sideSign of [1, -1]) {
    const hip = P(0, sideSign * 1.9, hipZ);
    let knee, foot;
    if (pose === 'walk' || pose === 'run') {
      const amp = pose === 'run' ? 0.82 : 0.52;
      const sw = Math.sin(ph + (sideSign > 0 ? 0 : Math.PI)) * amp;
      const sw2 = sw - (pose === 'run' ? 0.55 : 0.40);
      knee = P(Math.sin(sw) * 3.7, sideSign * 1.9, hipZ - Math.cos(sw) * 3.7);
      foot = P(Math.sin(sw) * 3.7 + Math.sin(sw2) * 3.5, sideSign * 2.0, Math.max(0.75, hipZ - Math.cos(sw) * 3.7 - Math.cos(sw2) * 3.5));
    } else if (pose === 'aim') {
      if (sideSign > 0) { knee = P(4.0, 2.0, hipZ - 3.5); foot = P(8.4, 2.3, 0.75); }
      else { knee = P(-2.7, -2.0, hipZ - 3.6); foot = P(-6.6, -2.4, 0.75); }
    } else {
      knee = P(0.3, sideSign * 2.0, hipZ - 3.7);
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
  // Neck + ROUNDED head (lathed sphere, not a box) with a hair sphere offset
  // up/back, so the skull reads as a head at thumbnail scale. Crown at ≈ FIG_H.
  const headC = P(lean + 0.3, 0, shoZ + 2.1);
  addTaperedLimb(P(lean, 0, shoZ - 0.4), headC, 2.1, 2.1, 2.1, 2.1, o.skin, sideHint, opts);
  addSphere(headC[0], headC[1], headC[2], 1.62, o.skin, opts);
  addSphere(headC[0] - f[0] * 0.34, headC[1] - f[1] * 0.34, headC[2] + 0.52, 1.68, o.hair, opts);
  // Arms: upper (3.4) + forearm (3.2), tapered; hands in skin tone.
  for (const sideSign of [1, -1]) {
    const sho = P(lean, sideSign * 3.15, shoZ - 0.3);
    let elbow, hand;
    if (pose === 'aim') {
      // Elbows wide and dropped, hands converging forward-down: from behind, the
      // arms silhouette OUTSIDE the torso instead of merging into a shoulder slab.
      elbow = P(lean + 5.2, sideSign * 3.05, shoZ - 1.9);
      hand = P(lean + 11.0, sideSign * 0.9, shoZ - 1.3);
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
      // The pistol: a long dark barrel + grip block, long enough to read at
      // mid-shot range, with a lighter muzzle tip catching the sunset.
      const g1 = P(lean + 18.6, 0.4, shoZ - 1.3);
      addTaperedLimb(hand, g1, 2.1, 1.6, 2.8, 2.3, [22, 24, 30], sideHint, opts);
      const g2 = P(lean + 20.6, 0.4, shoZ - 1.15);
      addTaperedLimb(g1, g2, 1.5, 1.3, 2.1, 1.9, [88, 92, 102], sideHint, opts);
      const grip = P(lean + 12.2, 0.7, shoZ - 3.4);
      addTaperedLimb(hand, grip, 1.8, 1.5, 2.2, 1.9, [22, 24, 30], sideHint, opts);
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
      if (F.screen === 'summary' && crownP.y > 40 && crownP.y < 760 && crownP.x > -280 && crownP.x < 1150) return;
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
  addShadow(t.x, t.y, 4, 4, 0, 15, 0.22);
  addTaperedLimb([t.x, t.y, 0], [t.x, t.y, 13], 3.6, 2.6, 3.6, 2.6, [96, 74, 48], [0, 0, 1]);
  const r = t.r || 13;
  addBlob(t.x, t.y, 15 + r * 0.55, r, rgb(PALETTE.treeDark), {});
  addBlob(t.x - r * 0.4, t.y + r * 0.3, 13 + r * 0.4, r * 0.62, rgb(PALETTE.treeLight), {});
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
  const isDrive = !!p.inCar && !!p.car;
  const anchor = isDrive ? p.car : p;
  const yaw = anchor.angle || 0;
  // Camera: low chase cam behind the hero, smoothed in live play, snapped exactly
  // when the state is frozen (screenshot staging) so captures are deterministic.
  const back = isDrive ? 84 : 64;
  const camH = isDrive ? 30 : 24;
  const fh = [Math.cos(yaw), Math.sin(yaw)];
  const wantX = anchor.x - fh[0] * back, wantY = anchor.y - fh[1] * back;
  let camX = wantX, camY = wantY;
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
  // building footprint, pull it toward the hero until it is in open air. Staged
  // shots are already framed in the open, so this never fires for captures.
  if (pointInBuilding(game.city, camX, camY)) {
    for (const t of [0.3, 0.55, 0.8]) {
      const tx = anchor.x - fh[0] * back * (1 - t), ty = anchor.y - fh[1] * back * (1 - t);
      if (!pointInBuilding(game.city, tx, ty)) { camX = tx; camY = ty; break; }
    }
  }
  const lookX = anchor.x + fh[0] * 40, lookY = anchor.y + fh[1] * 40;
  const lookZ = isDrive ? 9 : 10;
  F = newFrame([camX, camY, camH], [lookX - camX, lookY - camY, lookZ - camH]);
  F.idMode = !!game.idRender;
  F.heroCar = isDrive ? p.car : (game.shotHeroCar || null);
  F.time = game.time || 0;
  F.screen = game.screen || 'play';
  F.softSprites = []; // smoke rendered as soft radial sprites after the painter pass

  // Sky: sunset gradient (plum top → rose → orange-pink horizon) + low western sun.
  if (F.idMode) {
    ctx.fillStyle = 'rgb(0,0,0)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H * 0.78);
    grad.addColorStop(0, `rgb(${SUNSET_TOP[0]},${SUNSET_TOP[1]},${SUNSET_TOP[2]})`);
    grad.addColorStop(0.55, `rgb(${SUNSET_MID[0]},${SUNSET_MID[1]},${SUNSET_MID[2]})`);
    grad.addColorStop(1, `rgb(${SUNSET_HOR[0]},${SUNSET_HOR[1]},${SUNSET_HOR[2]})`);
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
      ctx.fillStyle = `rgb(${SUN[0]},${SUN[1]},${SUN[2]})`;
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
      hair: rgb(ped.hairColor || '#2b2118'), isPlayer: false,
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
      hair: [36, 26, 18], isPlayer: true,
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
    // Sunset wash + warm vignette.
    const sg2 = ctx.createLinearGradient(0, 0, VIEW_W, VIEW_H * 0.4);
    sg2.addColorStop(0, 'rgba(255,116,58,0.13)');
    sg2.addColorStop(0.45, 'rgba(255,92,120,0.05)');
    sg2.addColorStop(1, 'rgba(38,14,54,0.08)');
    ctx.fillStyle = sg2; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.42, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.88);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(30,8,16,0.34)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  F = null;
}
