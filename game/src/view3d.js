// view3d.js — TOTAL REBUILD Phase 1: thin orchestrator over the new
// renderer modules. The presentation class moved: render3d.js owns the
// core (ACES tone mapping, PCFSoft shadows, PMREM sky environment,
// grades), materials3d.js the MeshStandardMaterial library,
// vehicles3d.js the shaped cars, figures3d.js the smooth figure. This
// file keeps the EXACT public contract — exports renderView3D and
// projectPoint, same staging interface for shots.js / main.js /
// render.js — and owns what Phase 1 leaves in place: the frame camera,
// the ground grid + road grammar, particles/sprites, and the final
// composite. Phase 2 moved the world dressing (buildings, skyline,
// vegetation, props, coast) into world3d.js and the bloom/vignette
// pass into post3d.js; this orchestrator wires both through the R
// context below. It only READS game state;
// every variation is a deterministic hash (never Math.random / Date.now
// in the render path), so screenshot staging stays byte-identical.
//
// SCALE CONTRACT (unchanged): ~8.6 units per metre; figure silhouette
// 15.45 vs sedan roof 12.6 → ratio 1.226 (figures3d / vehicles3d hold
// the anchors). Buildings render at b.height × 3.2. Cameras match the
// standing framing: chase 84 behind / 30 up, on foot 52 / 30, OTS-right
// aim (48 back / 20 up, +27 lateral) with the proven aim geometry.
// World→Three mapping: three.x = world x, three.y = world z (up),
// three.z = world y; a world yaw θ becomes a Three rotationY of −θ.
import { VIEW_W, VIEW_H, WORLD_SIZE, BLOCK_PITCH, ROAD_W, PALETTE } from './config.js';
import { isOnRoad, roadCenters, pointInBuilding } from './city.js';
import { clamp } from './rng.js';
import * as THREE from '../vendor/three.module.min.js';
import {
  GRADES, SUN_DIR, Batch, box, limb, ball, disc, mat4,
  rgb, lin, linColor, hash01, parseColor, probeWebGL, createCore, idState,
} from './render3d.js';
import { buildMaterials, paintPlateCell } from './materials3d.js';
import { buildWorld } from './world3d.js';
import { buildVehicles, buildHeli } from './vehicles3d.js';
import { buildFigures } from './figures3d.js';

const FOV = 1.05;
const FOCAL = (VIEW_W / 2) / Math.tan(FOV / 2);
const VFOV = (2 * Math.atan((VIEW_H / 2) / FOCAL) * 180) / Math.PI;
const NEAR = 5;
const ASPHALT = [60, 53, 55], SIDEWALK_C = [122, 102, 80], PLOT = [93, 79, 60];
const GRASS_C = [84, 100, 60], SAND_C = rgb(PALETTE.sand), WATER_C = rgb(PALETTE.water);

// ------------------------------------------------------------ WebGL boot
let GL = null;
let GL_DEAD = false;
function buildGL() {
  const core = createCore(VIEW_W, VIEW_H, VFOV);
  const matSet = buildMaterials();
  return { ...core, ...matSet, lastKey: null };
}
function ensureGL() {
  if (GL) return GL;
  if (GL_DEAD) return null;
  if (!probeWebGL()) { GL_DEAD = true; return null; }
  try { GL = buildGL(); } catch (e) { GL_DEAD = true; GL = null; if (typeof console !== 'undefined') console.error('view3d GL build failed', e); }
  return GL;
}

// ------------------------------------------------------------- frame state
let F = null; // { cam, right, gradeName, gradeEmissive, time, screen, heroCar }
let lastCam = null;
export function projectPoint(x, y, z) {
  if (!lastCam) return null;
  const v = new THREE.Vector3(x, z, y);
  const view = v.clone().applyMatrix4(lastCam.matrixWorldInverse);
  if (-view.z < NEAR) return null;
  v.applyMatrix4(lastCam.projectionMatrix);
  if (v.z > 1) return null;
  return { x: (v.x + 1) / 2 * VIEW_W, y: (1 - v.y) / 2 * VIEW_H, dist: -view.z };
}
// Camera framing (standing values): planning = elevated orbit; driving
// = 84 back / 30 up looking 40 ahead; on foot = 52 / 30; aiming = the
// OTS-right rig (48 back / 20 up, +27 gun-side lateral, look 110 ahead /
// −22) whose staged impact qa/measure.mjs verifies.
function frameCamera(game) {
  const p = game.player;
  const isDrive = !!p.inCar && !!p.car;
  const anchor = isDrive ? p.car : p;
  const yaw = anchor.angle || 0;
  if (game.screen === 'planning' && game.planTarget) {
    const t = game.planTarget;
    const ang = typeof game.planOrbitAngle === 'number' ? game.planOrbitAngle : -0.5 + Math.sin((game.time || 0) * 0.07) * 0.75;
    const camX = t.x + Math.cos(ang) * 235, camY = t.y + Math.sin(ang) * 235, camH = 105;
    return { cam: [camX, camY, camH], look: [t.x, t.y, 6], isDrive };
  }
  const aiming = !isDrive && ((game.bullets && game.bullets.length > 0) || (game.lastShotAt && game.nowMs - game.lastShotAt < 700));
  const back = isDrive ? 84 : aiming ? 48 : 52;
  const camH = isDrive ? 30 : aiming ? 20 : 30;
  const fh = [Math.cos(yaw), Math.sin(yaw)];
  const sh = [-fh[1], fh[0]];
  const camLat = aiming ? 27 : 0;
  let camX = anchor.x - fh[0] * back + sh[0] * camLat;
  let camY = anchor.y - fh[1] * back + sh[1] * camLat;
  if (!game.frozen) {
    const prev = game.cam3d;
    if (prev) {
      const k = 0.22;
      camX = prev.x + (camX - prev.x) * k;
      camY = prev.y + (camY - prev.y) * k;
    }
    game.cam3d = { x: camX, y: camY };
  }
  if (pointInBuilding(game.city, camX, camY)) {
    for (const t of [0.3, 0.55, 0.8]) {
      const tx = anchor.x - fh[0] * back * (1 - t), ty = anchor.y - fh[1] * back * (1 - t);
      if (!pointInBuilding(game.city, tx, ty)) { camX = tx; camY = ty; break; }
    }
  }
  const lookLat = aiming ? -22 : 0;
  const lookFwd = aiming ? 110 : 40;
  return {
    cam: [camX, camY, camH],
    look: [anchor.x + fh[0] * lookFwd + sh[0] * lookLat, anchor.y + fh[1] * lookFwd + sh[1] * lookLat, isDrive ? 9 : aiming ? 9 : 8],
    isDrive,
  };
}

// ------------------------------------------------------------ sprite pool
function getSprite(gl, i) {
  while (gl.sprites.length <= i) {
    const mat = new THREE.SpriteMaterial({ map: gl.glowTex, transparent: true, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.frustumCulled = false;
    gl.scene.add(sp);
    gl.sprites.push(sp);
  }
  return gl.sprites[i];
}
let spriteN = 0;
function addGlow(x, y, z, r, colorLin, alpha) {
  if (idState.mode || alpha <= 0.003 || !GL) return;
  const sp = getSprite(GL, spriteN++);
  sp.material.map = GL.glowTex;
  sp.material.blending = THREE.AdditiveBlending;
  sp.material.color.setRGB(colorLin[0], colorLin[1], colorLin[2]);
  sp.material.opacity = alpha;
  sp.material.rotation = 0;
  sp.position.set(x, z, y);
  sp.scale.set(r * 2, r * 2, 1);
  sp.visible = true;
}
function addSmoke(x, y, z, r, alpha, grey = 0.58) {
  if (idState.mode || alpha <= 0.003 || !GL) return;
  const sp = getSprite(GL, spriteN++);
  sp.material.map = GL.smokeTex;
  sp.material.blending = THREE.NormalBlending;
  sp.material.color.setRGB(grey, grey, grey * 1.02);
  sp.material.opacity = alpha;
  sp.material.rotation = 0;
  sp.position.set(x, z, y);
  sp.scale.set(r * 2, r * 2, 1);
  sp.visible = true;
}
function ensurePlate(id) {
  if (!GL || GL.paintedPlates.has(id)) return;
  paintPlateCell(GL.plateC, id);
  GL.paintedPlates.add(id);
  GL.plateTex.needsUpdate = true;
}

// ------------------------------------------------------------------ ground
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
const PLANE_G = new THREE.PlaneGeometry(45.2, 45.2).rotateX(-Math.PI / 2);
const WHITE = [1, 1, 1];
function buildGround(R, game) {
  const { B } = R;
  const camX = F.cam[0], camY = F.cam[1];
  const CELL = 44;
  const i0 = Math.floor((camX - 1280) / CELL), i1 = Math.floor((camX + 1280) / CELL);
  const j0 = Math.floor((camY - 1280) / CELL), j1 = Math.floor((camY + 1280) / CELL);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const cx = i * CELL + CELL / 2, cy = j * CELL + CELL / 2;
      if (cx < -440 || cx > WORLD_SIZE + 480 || cy < -440 || cy > WORLD_SIZE + 440) continue;
      const base = groundKind(game, cx, cy);
      const cellHash = hash01(i * 13 + j * 29);
      const v = 0.93 + cellHash * 0.14;
      const m = mat4(cx, 0.12, cy, 0);
      if (base === ASPHALT) {
        B.asphalt.push(PLANE_G, m, WHITE, [0.5, 0.5], [cellHash < 0.5 ? 0 : 0.5, hash01(i * 41 + j * 17) < 0.5 ? 0 : 0.5]);
      } else if (base === SIDEWALK_C) {
        B.concrete.push(PLANE_G, m, WHITE, [2, 2], [0, 0]);
      } else if (base === SAND_C) {
        B.sandgrass.push(PLANE_G, m, WHITE, [1, 0.5], [0, 0.5]);
      } else if (base === GRASS_C) {
        B.sandgrass.push(PLANE_G, m, WHITE, [1, 0.5], [0, 0]);
      } else if (base === WATER_C) {
        const wHash = hash01(Math.floor(cx / 46) * 7 + Math.floor(cy / 46) * 13);
        const wc = wHash > 0.86 ? [110, 178, 182] : wHash > 0.68 ? [64, 138, 152] : WATER_C;
        B.flat.quad([cx - 23, cy - 23, 0.06], [cx + 23, cy - 23, 0.06], [cx + 23, cy + 23, 0.06], [cx - 23, cy + 23, 0.06], lin(wc));
      } else {
        let site = false;
        if (game.city.sites) for (const st of game.city.sites) if (cx >= st.x && cx <= st.x + st.w && cy >= st.y && cy <= st.y + st.h) site = true;
        if (site) B.concrete.push(PLANE_G, m, WHITE, [2, 2], [0, 0]);
        else B.flat.quad([cx - 23, cy - 23, 0.1], [cx + 23, cy - 23, 0.1], [cx + 23, cy + 23, 0.1], [cx - 23, cy + 23, 0.1], lin([base[0] * v, base[1] * v, base[2] * v]));
      }
    }
  }
  B.flat.quad([WORLD_SIZE + 40, -240, 0.02], [4700, -240, 0.02], [4700, WORLD_SIZE + 240, 0.02], [WORLD_SIZE + 40, WORLD_SIZE + 240, 0.02], lin([46, 116, 132]));
  const centers = roadCenters();
  const inRange = (x, y, r = 1080) => { const dx = x - camX, dy = y - camY; return dx * dx + dy * dy < r * r; };
  const actors = [];
  for (const c of game.traffic) actors.push(c);
  for (const c of game.specials || []) actors.push(c);
  for (const c of game.police.cops) actors.push(c);
  actors.push(game.player);
  if (game.crewMate) actors.push(game.crewMate);
  const actorNear = (x, y, r) => actors.some((a) => { const dx = a.x - x, dy = a.y - y; return dx * dx + dy * dy < r * r; });
  // Road grammar: planted medians, double yellow centre lines, dashed
  // white lane lines, zebra crossings, kerbs.
  const YELLOW = lin([218, 182, 94]), LANEWHITE = lin([226, 223, 215]);
  const MED_SIDE = lin([150, 146, 138]), MED_TOP = lin([86, 104, 62]);
  const BUSH = lin([70, 102, 52]), BUSH_L = lin([96, 128, 66]);
  for (const c of centers) {
    for (const vert of [true, false]) {
      for (let k = 0; k <= 8; k++) {
        const a0 = k * BLOCK_PITCH + ROAD_W + 6, a1 = (k + 1) * BLOCK_PITCH - 6;
        const mid = (a0 + a1) / 2;
        const mx = vert ? c : mid, my = vert ? mid : c;
        if (!inRange(mx, my, 1180)) continue;
        for (const off of [-5.9, 5.9]) {
          if (vert) B.flat.quad([c + off - 0.8, a0, 0.3], [c + off + 0.8, a0, 0.3], [c + off + 0.8, a1, 0.3], [c + off - 0.8, a1, 0.3], YELLOW);
          else B.flat.quad([a0, c + off - 0.8, 0.3], [a1, c + off - 0.8, 0.3], [a1, c + off + 0.8, 0.3], [a0, c + off + 0.8, 0.3], YELLOW);
        }
        for (const off of [-24, 24]) {
          for (let d = a0 + 4; d < a1 - 14; d += 44) {
            if (hash01(c * 3 + d + off) < 0.08) continue;
            if (vert) B.flat.quad([c + off - 0.8, d, 0.3], [c + off + 0.8, d, 0.3], [c + off + 0.8, d + 15, 0.3], [c + off - 0.8, d + 15, 0.3], LANEWHITE);
            else B.flat.quad([d, c + off - 0.8, 0.3], [d + 15, c + off - 0.8, 0.3], [d + 15, c + off + 0.8, 0.3], [d, c + off + 0.8, 0.3], LANEWHITE);
          }
        }
        for (let d = a0 + 22; d < a1 - 10; d += 44) {
          const sx = vert ? c : d, sy = vert ? d : c;
          if (!inRange(sx, sy, 1080) || actorNear(sx, sy, 40)) continue;
          box(B.flat, sx, sy, 0.8, vert ? 4.5 : 20, vert ? 20 : 4.5, 0.8, 0, MED_SIDE);
          B.flat.quad([sx - (vert ? 4.3 : 19.8), sy - (vert ? 19.8 : 4.3), 1.62], [sx + (vert ? 4.3 : 19.8), sy - (vert ? 19.8 : 4.3), 1.62], [sx + (vert ? 4.3 : 19.8), sy + (vert ? 19.8 : 4.3), 1.62], [sx - (vert ? 4.3 : 19.8), sy + (vert ? 19.8 : 4.3), 1.62], MED_TOP);
          const h = hash01(sx * 1.7 + sy * 2.3);
          if (h < 0.62) {
            ball(B.flat, sx, sy, 3.4, 3.1, h < 0.3 ? BUSH : BUSH_L);
            ball(B.flat, sx + (vert ? 0 : 9), sy + (vert ? 9 : 0), 3.0, 2.4, BUSH);
          } else if (h < 0.8 && !(vert && c > WORLD_SIZE - ROAD_W)) {
            // Coast fix (audit N2): the far-edge vertical road is Ocean
            // Drive — its median keeps the low bushes but grows no tree,
            // so no canopy ever stands in the cleared drive band (the
            // (3714, 2690) tree the fix round measured). Every other
            // road's median planting is untouched.
            limb(B.flat, [sx, sy, 1.4], [sx, sy, 8.5], 0.85, 0.6, lin([96, 74, 48]), 5);
            ball(B.flat, sx, sy, 11.5, 5.6, BUSH_L);
            ball(B.flat, sx + 2.5, sy - 2, 9.8, 4.0, BUSH);
          }
        }
      }
    }
  }
  const CURB = lin([172, 168, 160]);
  for (const c of centers) {
    for (const vert of [true, false]) {
      for (let k = 0; k <= 8; k++) {
        const a0 = k * BLOCK_PITCH + ROAD_W + 6, a1 = (k + 1) * BLOCK_PITCH - 6;
        const mid = (a0 + a1) / 2, len = a1 - a0;
        for (const off of [-47.2, 47.2]) {
          const mx = vert ? c + off : mid, my = vert ? mid : c + off;
          if (!inRange(mx, my, 1180)) continue;
          box(B.flat, mx, my, 0.45, vert ? 1.3 : len / 2, vert ? len / 2 : 1.3, 0.45, 0, CURB);
        }
      }
    }
  }
  // Zebra crossings at intersections (standing geometry — the title
  // staging was crop-verified against these exact arms).
  const ZEBRA = [...lin([224, 216, 202]), 0.72];
  for (const cx of centers) for (const cy of centers) {
    if (!inRange(cx, cy)) continue;
    for (let i = 0; i < 5; i++) {
      const sx = cx - 34 + i * 14;
      B.alpha.quad([sx, cy - 74, 0.42], [sx + 7, cy - 74, 0.42], [sx + 7, cy - 52, 0.42], [sx, cy - 52, 0.42], ZEBRA);
      const sy = cy - 34 + i * 14;
      B.alpha.quad([cx + 52, sy, 0.42], [cx + 74, sy, 0.42], [cx + 74, sy + 7, 0.42], [cx + 52, sy + 7, 0.42], ZEBRA);
    }
  }
  // Skid marks left by the sim's fx.
  const SKID = [...lin([10, 10, 12]), 0.42];
  for (const s of game.fx.skids || []) {
    if (!inRange(s.x, s.y)) continue;
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    const L = (lx, ly) => [s.x + lx * c - ly * sn, s.y + lx * sn + ly * c, 0.34];
    B.alpha.quad(L(-s.len / 2, -s.w / 2), L(s.len / 2, -s.w / 2), L(s.len / 2, s.w / 2), L(-s.len / 2, s.w / 2), SKID);
  }
  // Site markings: airport runway + base pads.
  if (game.city.sites) for (const st of game.city.sites) {
    if (!inRange(st.x + st.w / 2, st.y + st.h / 2, 1250)) continue;
    if (st.kind === 'airport') {
      const ry = st.y + st.h / 2;
      B.flat.quad([st.x + 6, ry - 15, 0.3], [st.x + st.w - 6, ry - 15, 0.3], [st.x + st.w - 6, ry + 15, 0.3], [st.x + 6, ry + 15, 0.3], lin([52, 52, 56]));
      for (let dx = 16; dx < st.w - 20; dx += 34) B.flat.quad([st.x + dx, ry - 1.2, 0.36], [st.x + dx + 16, ry - 1.2, 0.36], [st.x + dx + 16, ry + 1.2, 0.36], [st.x + dx, ry + 1.2, 0.36], lin([238, 236, 226]));
      for (const ex of [st.x + 10, st.x + st.w - 22]) for (let b = 0; b < 4; b++) B.flat.quad([ex, ry - 13 + b * 7, 0.36], [ex + 10, ry - 13 + b * 7, 0.36], [ex + 10, ry - 9 + b * 7, 0.36], [ex, ry - 9 + b * 7, 0.36], lin([238, 236, 226]));
      B.concrete.push(new THREE.PlaneGeometry(130, 50).rotateX(-Math.PI / 2), mat4(st.x + 85, 0.28, st.y + 49, 0), WHITE, [6, 3], [0, 0]);
    } else {
      for (const [px, py] of [[70, 70], [200, 70], [70, 220], [200, 220]]) disc(B.flat, st.x + px, st.y + py, 0.3, 30, lin([116, 118, 104]));
      B.flat.quad([st.x + 24, st.y + st.h - 44, 0.3], [st.x + st.w - 24, st.y + st.h - 44, 0.3], [st.x + st.w - 24, st.y + st.h - 36, 0.3], [st.x + 24, st.y + st.h - 36, 0.3], lin([196, 178, 92]));
    }
  }
  // Explosive zones: fire burns orange, gas hangs pale, a flare pools bright.
  for (const z of game.zones || []) {
    if (!inRange(z.x, z.y)) continue;
    if (z.kind === 'fire') {
      disc(B.alpha, z.x, z.y, 0.4, z.r, [...lin([214, 110, 40]), 0.5]);
      disc(B.alpha, z.x, z.y, 0.45, z.r * 0.55, [...lin([246, 178, 60]), 0.65]);
      addGlow(z.x, z.y, 4, z.r * 0.9, lin([255, 150, 60]), 0.30);
    } else if (z.kind === 'gas') disc(B.alpha, z.x, z.y, 0.4, z.r, [...lin([168, 178, 150]), 0.30]);
    else if (z.kind === 'flare') {
      disc(B.alpha, z.x, z.y, 0.4, z.r, [...lin([255, 120, 90]), 0.4]);
      disc(B.alpha, z.x, z.y, 0.46, 7, [...lin([255, 226, 170]), 0.9]);
    }
  }
  for (const pl of game.placed || []) if (inRange(pl.x, pl.y)) box(B.flat, pl.x, pl.y, 1.6, 3.4, 3.4, 1.6, 0, lin([30, 30, 34]));
  for (const pr of game.projectiles || []) if (inRange(pr.x, pr.y)) ball(B.flat, pr.x, pr.y, pr.z || 6, pr.behavior === 'rocket' || pr.behavior === 'cannon' ? 2.6 : 1.9, lin([40, 38, 36]));
  // Mission marker: a small floating diamond over the objective point
  // on a slim beacon column, with a flat diamond outline at its base —
  // the HUD minimap's own grammar, in the world.
  const marker = game.missions.marker();
  if (marker) {
    const mc = marker.color === 'pickup' ? lin([232, 200, 50]) : lin([79, 201, 106]);
    const bob = Math.sin((game.time || 0) * 3.2) * 1.5;
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4, a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
      B.alpha.quad(
        [marker.x + Math.cos(a0) * 1.7, marker.y + Math.sin(a0) * 1.7, 0.6],
        [marker.x + Math.cos(a1) * 1.7, marker.y + Math.sin(a1) * 1.7, 0.6],
        [marker.x + Math.cos(a1) * 1.7, marker.y + Math.sin(a1) * 1.7, 26],
        [marker.x + Math.cos(a0) * 1.7, marker.y + Math.sin(a0) * 1.7, 26], [...mc, 0.28]);
    }
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2, a1 = ((i + 1) / 4) * Math.PI * 2;
      const b0 = a0 + 0.16, b1 = a1 - 0.16;
      B.alpha.quad(
        [marker.x + Math.cos(b0) * 5.6, marker.y + Math.sin(b0) * 5.6, 0.6],
        [marker.x + Math.cos(b1) * 5.6, marker.y + Math.sin(b1) * 5.6, 0.6],
        [marker.x + Math.cos(a1) * 7, marker.y + Math.sin(a1) * 7, 0.6],
        [marker.x + Math.cos(a0) * 7, marker.y + Math.sin(a0) * 7, 0.6], [...mc, 0.8]);
    }
    const dia = new THREE.OctahedronGeometry(3.4);
    B.basic.push(dia, mat4(marker.x, 30 + bob, marker.y, (game.time || 0) * 0.9, 1, 1.25, 1), mc);
    dia.dispose();
  }
}

// --------------------------------------------------------------- particles
function buildParticles(R, game) {
  const { B } = R;
  for (const p of game.fx.particles || []) {
    const dx = p.x - F.cam[0], dy = p.y - F.cam[1];
    if (dx * dx + dy * dy > 700 * 700) continue;
    const ratio = clamp(p.life / (p.maxLife || 1), 0, 1);
    const col = parseColor(p.color, [255, 215, 106]);
    const isSmoke = p.color && p.color.indexOf('120,120,125') !== -1;
    if (isSmoke) {
      const baseR = Math.min(11, p.size * 1.5) * (1.25 - ratio * 0.45) * 0.75;
      addSmoke(p.x, p.y, 8 + (1 - ratio) * 7, baseR, 0.20, 0.45);
      addSmoke(p.x + 2.5, p.y - 1.5, 12 + (1 - ratio) * 8, baseR * 1.35, 0.12, 0.45);
    } else {
      addGlow(p.x, p.y, 10.5, 3.4, lin(col), 0.28);
      addGlow(p.x, p.y, 10.5, 1.7, lin(col), 0.9);
    }
  }
  if (game.bullets && game.bullets.length) {
    for (const b of game.bullets) {
      const mx = b.x - Math.cos(b.angle) * 5, my = b.y - Math.sin(b.angle) * 5;
      box(B.basic, mx, my, 11.5, 8, 0.15, 0.15, b.angle, lin([255, 224, 130]));
      addGlow(b.x, b.y, 11.5, 2.2, lin([255, 240, 190]), 0.55);
    }
  }
}

// ------------------------------------------------------------ main render
function fallback2D(ctx, game) {
  const grade = GRADES[game.timeGrade] || GRADES.golden;
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H * 0.78);
  g.addColorStop(0, `rgb(${grade.top[0]},${grade.top[1]},${grade.top[2]})`);
  g.addColorStop(0.55, `rgb(${grade.mid[0]},${grade.mid[1]},${grade.mid[2]})`);
  g.addColorStop(1, `rgb(${grade.hor[0]},${grade.hor[1]},${grade.hor[2]})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = 'rgb(52,44,40)';
  ctx.fillRect(0, VIEW_H * 0.62, VIEW_W, VIEW_H * 0.38);
}
export function renderView3D(ctx, game) {
  const p = game.player;
  if (!p) return;
  const gl = ensureGL();
  if (!gl) { fallback2D(ctx, game); return; }
  try {
    const cacheKey = game.frozen
      ? [game.shotName || '', game.time || 0, game.screen || '', game.idRender ? 1 : 0, game.wheelOpen ? 1 : 0, game.timeGrade || ''].join('|')
      : null;
    if (cacheKey && gl.lastKey === cacheKey) {
      composite(ctx, gl, GRADES[game.timeGrade] || GRADES.golden, !!game.idRender);
      return;
    }
    renderGL(gl, ctx, game);
    gl.lastKey = cacheKey;
  } catch (err) {
    GL_DEAD = true; GL = null;
    if (typeof console !== 'undefined') console.error('view3d render failed', err);
    fallback2D(ctx, game);
  }
}
function composite(ctx, gl, grade, idMode) {
  ctx.drawImage(gl.glCanvas, 0, 0, VIEW_W, VIEW_H);
  if (idMode) return;
  const wA = grade.wash || 1;
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
function renderGL(gl, ctx, game) {
  const p = game.player;
  const gradeName = game.timeGrade || 'golden';
  const grade = GRADES[gradeName] || GRADES.golden;
  gl.setIDMode(!!game.idRender);
  const fr = frameCamera(game);
  const isDrive = fr.isDrive;
  const anchor = isDrive ? p.car : p;
  F = {
    cam: fr.cam, right: [1, 0], gradeName, gradeEmissive: grade.emissive,
    time: game.time || 0, screen: game.screen || 'play',
    heroCar: isDrive ? p.car : (game.shotHeroCar || null),
  };
  const cam = gl.camera;
  cam.position.set(fr.cam[0], fr.cam[2], fr.cam[1]);
  cam.lookAt(fr.look[0], fr.look[2], fr.look[1]);
  cam.updateMatrixWorld();
  lastCam = cam;
  const el = cam.matrixWorld.elements;
  F.right = [el[0], el[2]];
  gl.applyGrade(gradeName, grade, anchor);
  gl.mats.fwarm.emissiveIntensity = grade.emissive;
  gl.mats.fcool.emissiveIntensity = grade.emissive;
  gl.mats.foffice.emissiveIntensity = grade.emissive;
  gl.mats.glass.emissiveIntensity = grade.emissive * 0.8;
  gl.mats.shop.emissiveIntensity = grade.emissive * 0.75;
  spriteN = 0;
  for (const sp of gl.sprites) sp.visible = false;
  const B = {
    flat: new Batch(), basic: new Batch(), alpha: new Batch(true, true),
    asphalt: new Batch(true), concrete: new Batch(true), sandgrass: new Batch(true),
    roof: new Batch(true), fwarm: new Batch(true), fcool: new Batch(true),
    glass: new Batch(true), shop: new Batch(true), sign: new Batch(true), plate: new Batch(true), bus: new Batch(true), foffice: new Batch(true),
    paint: new Batch(), glasspaint: new Batch(), chrome: new Batch(), tyre: new Batch(),
  };
  const R = { B, game, F, gl, addGlow, addSmoke, ensurePlate, project: projectPoint };
  // Last frame's dynamic meshes retire BEFORE this frame's builds:
  // world3d's coast lays its sea/sand meshes straight into gl.dyn
  // during the build, so the cleanup must not run again afterwards.
  for (const m of gl.dyn) { gl.scene.remove(m); m.geometry.dispose(); }
  gl.dyn = [];
  buildGround(R, game);
  buildWorld(R, game);
  buildVehicles(R, game);
  if (game.stagedHeli) buildHeli(R, game.stagedHeli);
  buildFigures(R, game);
  buildParticles(R, game);
  const M = gl.mats;
  const addMesh = (batch, mat, idMat, cast = true, receive = true) => {
    const mesh = batch.build(idState.mode ? idMat : mat);
    if (!mesh) return;
    mesh.castShadow = cast && !idState.mode;
    mesh.receiveShadow = receive && !idState.mode;
    mesh.frustumCulled = false;
    gl.scene.add(mesh);
    gl.dyn.push(mesh);
  };
  addMesh(B.asphalt, M.asphalt, M.idBlack, false, true);
  addMesh(B.concrete, M.concrete, M.idBlack, false, true);
  addMesh(B.sandgrass, M.sandgrass, M.idBlack, false, true);
  addMesh(B.flat, M.flat, M.idFlat, true, true);
  addMesh(B.paint, M.paint, M.idFlat, true, true);
  addMesh(B.glasspaint, M.glasspaint, M.idFlat, true, true);
  addMesh(B.chrome, M.chrome, M.idFlat, true, true);
  addMesh(B.tyre, M.tyre, M.idFlat, true, true);
  addMesh(B.roof, M.roof, M.idBlack, true, true);
  addMesh(B.fwarm, M.fwarm, M.idBlack, true, true);
  addMesh(B.fcool, M.fcool, M.idBlack, true, true);
  addMesh(B.foffice, M.foffice, M.idBlack, true, true);
  addMesh(B.glass, M.glass, M.idBlack, true, true);
  addMesh(B.shop, M.shop, M.idBlack, true, true);
  addMesh(B.basic, M.basic, M.idFlat, false, false);
  addMesh(B.sign, M.sign, M.idBlack, false, false);
  addMesh(B.plate, M.plate, M.idBlack, false, false);
  addMesh(B.bus, M.bus, M.idBlack, false, false);
  if (!idState.mode) addMesh(B.alpha, M.alpha, M.idBlack, false, false);
  gl.renderer.render(gl.scene, cam);
  composite(ctx, gl, grade, idState.mode);
  F = null;
  idState.cat = null;
}
