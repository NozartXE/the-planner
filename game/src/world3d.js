// world3d.js — TOTAL REBUILD Phase 2: the world on the new material
// class. This module owns everything that dresses the sim's city data
// for the standard-material pipeline: the buildings (varied PBR facade
// batches — warm / cool / office / glass towers with emissive lit
// interiors riding the grade — plus shop bands, signage, awnings,
// cornices, parapets and rooftop props), the skyline silhouettes, the
// vegetation and street props (palms, trees, lamps, bus stops, boats),
// and the COAST geography the Phase 1 port left as flat ground cells:
// a real beach band and a sea surface east of Ocean Drive, so the
// cleared drive (city.js coast fix, audit N2) reads as waterfront.
//
// Everything is rebuilt per frame from the same seeded city data the
// sim generated; every variation is a deterministic hash of world
// data — no Math.random / Date.now anywhere — so frozen screenshot
// staging stays byte-identical across runs. The sea's normal and
// roughness maps are procedural canvases painted once from a seeded
// LCG height field (no external assets), giving the standard material
// a broken specular sun glitter instead of one uniform sheen.
//
// World→Three mapping (shared with view3d): three.x = world x,
// three.y = world z (up), three.z = world y.
import { WORLD_SIZE, BLOCK_PITCH, ROAD_W, PALETTE } from './config.js';
import { roadCenters } from './city.js';
import { clamp } from './rng.js';
import * as THREE from '../vendor/three.module.min.js';
import {
  box, limb, ball, disc, mat4,
  rgb, lin, hash01, lcg, linColor, makeCanvas2d, idState,
} from './render3d.js';
import { SIGNS } from './materials3d.js';

const BUILD_SCALE = 3.2;
const WHITE = [1, 1, 1];

// ------------------------------------------------------- skyline fillers
// A red radio tower and a bridge silhouette stand in the background at
// fixed world spots (the park at bx3/by3; the water east of the shore).
function buildSkyline(R, game) {
  const { B } = R;
  const camX = R.F.cam[0], camY = R.F.cam[1];
  const tx = 1691, ty = 1691;
  if (Math.hypot(tx - camX, ty - camY) < 1500) {
    const RED = lin([178, 36, 32]), WHT = lin([236, 234, 228]);
    limb(B.flat, [tx, ty, 0], [tx, ty, 235], 15, 2.6, RED, 4);
    for (const [z, r] of [[58, 15], [116, 11.5], [174, 8]]) {
      const g = new THREE.CylinderGeometry(r, r, 15, 4);
      B.flat.push(g, mat4(tx, z, ty, Math.PI / 4), WHT);
      g.dispose();
    }
    for (const [z, len] of [[150, 112], [202, 86]]) {
      box(B.flat, tx, ty, z, len / 2, 3.2, 3.2, 0, RED);
      box(B.flat, tx, ty, z, 3.2, len / 2, 3.2, 0, RED);
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) limb(B.flat, [tx + sx * 13, ty + sy * 13, 0], [tx + sx * 2, ty + sy * 2, 120], 0.9, 0.7, RED, 4);
    limb(B.flat, [tx, ty, 235], [tx, ty, 268], 1.6, 0.5, RED, 5);
    ball(B.flat, tx, ty, 244, 3.4, RED);
    R.addGlow(tx, ty, 246, 11, lin([255, 70, 60]), 0.55);
  }
  const SIL = lin([56, 62, 76]);
  const bx0 = WORLD_SIZE + 30, bx1 = WORLD_SIZE + 720, by = 2250;
  if (Math.hypot((bx0 + bx1) / 2 - camX, by - camY) < 1900) {
    box(B.flat, (bx0 + bx1) / 2, by, 40, (bx1 - bx0) / 2, 23, 3.2, 0, SIL);
    for (const px of [bx0 + 190, bx0 + 500]) {
      box(B.flat, px, by, 46, 6, 8, 46, 0, SIL);
      for (const dx of [-150, -70, 70, 150]) limb(B.flat, [px, by, 88], [px + dx, by, 43], 0.8, 0.8, SIL, 4);
    }
  }
}

// --------------------------------------------------------------- buildings
function buildBuildings(R, game) {
  const { B } = R;
  const camX = R.F.cam[0], camY = R.F.cam[1];
  for (const b of game.city.buildings) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const dx = cx - camX, dy = cy - camY;
    const dist = Math.hypot(dx, dy);
    if (dist > 1180) continue;
    // Standing presentation exception (Phase 10): the Gazette shadow-
    // caster slab renders at H=76 so direct sun reaches the chase hero.
    const isGazetteCaster = Math.abs(b.x - 761.7910715453327) < 0.01 && Math.abs(b.y - 1231.7910715453327) < 0.01;
    const H = isGazetteCaster ? 76 : b.height * BUILD_SCALE;
    const bid = Math.round(b.x * 3 + b.y * 7);
    const roofC = rgb(b.color);
    const wallSun = rgb(b.wallLight || PALETTE.wallLight);
    const wallShade = rgb(b.wallDark || PALETTE.wallDark);
    const wallSouth = wallSun.map((v) => v * 0.88);
    const wallNorth = wallShade.map((v) => Math.min(255, v * 1.12));
    const isGlass = b.height > 46 && hash01(bid * 7.7) < 0.42;
    const vh = hash01(bid * 13.7);
    const variant = isGlass ? 'glass' : vh < 0.34 ? 'fwarm' : vh < 0.67 ? 'fcool' : 'foffice';
    const baseRGB = variant === 'glass' ? [148, 168, 178] : variant === 'fwarm' ? [188, 168, 146] : variant === 'foffice' ? [176, 158, 138] : [172, 164, 152];
    const tintVar = 0.92 + hash01(bid * 41.3) * 0.16;
    const tintOf = (wall) => lin([0, 1, 2].map((i) => clamp(wall[i] / baseRGB[i] * 255, 40, 255))).map((v) => Math.min(1, v * tintVar));
    const FB = variant === 'glass' ? B.glass : variant === 'fwarm' ? B.fwarm : variant === 'foffice' ? B.foffice : B.fcool;
    const walls = [
      { n: [0, 1], tint: tintOf(wallSouth), wid: b.w, fixed: b.y + b.h, mk: (z0, z1) => [[b.x, b.y + b.h, z0], [b.x + b.w, b.y + b.h, z0], [b.x + b.w, b.y + b.h, z1], [b.x, b.y + b.h, z1]] },
      { n: [0, -1], tint: tintOf(wallNorth), wid: b.w, fixed: b.y, mk: (z0, z1) => [[b.x + b.w, b.y, z0], [b.x, b.y, z0], [b.x, b.y, z1], [b.x + b.w, b.y, z1]] },
      { n: [1, 0], tint: tintOf(wallShade), wid: b.h, fixed: b.x + b.w, mk: (z0, z1) => [[b.x + b.w, b.y + b.h, z0], [b.x + b.w, b.y, z0], [b.x + b.w, b.y, z1], [b.x + b.w, b.y + b.h, z1]] },
      { n: [-1, 0], tint: tintOf(wallSun), wid: b.h, fixed: b.x, mk: (z0, z1) => [[b.x, b.y, z0], [b.x, b.y + b.h, z0], [b.x, b.y + b.h, z1], [b.x, b.y, z1]] },
    ];
    const isCyl = isGlass && hash01(bid * 3.1) < 0.45;
    const uOff = hash01(bid * 5.3) * 0.61, vOff = hash01(bid * 9.1) * 0.43;
    if (isCyl) {
      const r = Math.min(b.w, b.h) / 2 * 0.96;
      const g = new THREE.CylinderGeometry(r, r, H, 20, 1, true);
      FB.push(g, mat4(cx, H / 2, cy, 0), tintOf(wallSun), [(2 * Math.PI * r) / 95, H / 95], [uOff, vOff]);
      g.dispose();
      disc(B.roof, cx, cy, H, r, lin(roofC));
      const rim = new THREE.CylinderGeometry(r + 1.6, r + 1.6, 3.2, 20, 1, true);
      B.roof.push(rim, mat4(cx, H + 1.6, cy, 0), lin(roofC.map((v) => v * 0.92)), [6, 0.2], [0, 0]);
      rim.dispose();
    } else {
      const shopBand = dist < 760;
      for (const w of walls) {
        const uRep = Math.max(1, Math.round(w.wid / 95));
        if (shopBand) {
          const uRepS = Math.max(1, Math.round(w.wid / 95));
          const sp = w.mk(0, 17);
          B.shop.quad(sp[0], sp[1], sp[2], sp[3], w.tint, [uOff, 0, uOff + uRepS, 1]);
          const up = w.mk(17, H);
          const vRep = Math.max(1, Math.round((H - 17) / 95));
          FB.quad(up[0], up[1], up[2], up[3], w.tint, [uOff, vOff, uOff + uRep, vOff + vRep]);
        } else {
          const fp = w.mk(0, H);
          const vRep = Math.max(1, Math.round(H / 95));
          FB.quad(fp[0], fp[1], fp[2], fp[3], w.tint, [uOff, vOff, uOff + uRep, vOff + vRep]);
        }
      }
      if (hash01(bid * 17.7) < 0.42 && H > 52) {
        const ACCENTS = [[64, 110, 116], [168, 96, 72], [206, 188, 158], [120, 84, 110]];
        const acc = lin(ACCENTS[Math.floor(hash01(bid * 23.3) * 4) % 4]);
        const bz = H * (0.48 + hash01(bid * 29.7) * 0.14);
        for (const w of walls) {
          const bp = w.mk(bz, bz + 3.2);
          const off = [w.n[0] * 0.35, w.n[1] * 0.35, 0];
          const sh = (p) => [p[0] + off[0], p[1] + off[1], p[2]];
          B.flat.quad(sh(bp[0]), sh(bp[1]), sh(bp[2]), sh(bp[3]), acc);
        }
      }
      if (dist < 760 && H > 40) {
        const corC = lin(rgb(b.wallLight || PALETTE.wallLight).map((v) => Math.min(255, v * 1.12)));
        for (const w of walls) {
          const cp = w.mk(H - 4.5, H - 1.5);
          const off = [w.n[0] * 0.55, w.n[1] * 0.55, 0];
          const sh = (p) => [p[0] + off[0], p[1] + off[1], p[2]];
          B.flat.quad(sh(cp[0]), sh(cp[1]), sh(cp[2]), sh(cp[3]), corC);
        }
        const pz0 = 17, pz1 = H - 4.5;
        if (pz1 - pz0 > 14) {
          const pilC = lin(rgb(b.wallDark || PALETTE.wallDark).map((v) => v * 0.92));
          for (const w of walls) for (const fr of [0.03, 0.5, 0.97]) {
            if (w.n[1] !== 0) box(B.flat, b.x + w.wid * fr, w.fixed + w.n[1] * 0.35, (pz0 + pz1) / 2, 1.1, 0.35, (pz1 - pz0) / 2, 0, pilC);
            else box(B.flat, w.fixed + w.n[0] * 0.35, b.y + w.wid * fr, (pz0 + pz1) / 2, 0.35, 1.1, (pz1 - pz0) / 2, 0, pilC);
          }
        }
      }
      B.roof.quad([b.x, b.y + b.h, H], [b.x + b.w, b.y + b.h, H], [b.x + b.w, b.y, H], [b.x, b.y, H], lin(roofC).map((v) => Math.min(1, v * tintVar)), [0, 0, Math.max(1, Math.round(b.w / 70)), Math.max(1, Math.round(b.h / 70))]);
      box(B.flat, cx, cy, H + 1.6, b.w / 2 + 2.2, b.h / 2 + 2.2, 1.8, 0, lin(roofC.map((v) => v * 0.92)));
      if (b.props) for (const pr of b.props) {
        const px = b.x + pr.dx, py = b.y + pr.dy;
        if (pr.kind === 'tower') box(B.flat, px, py, H + 6, pr.w / 2, pr.h / 2, 6, 0, lin([80, 72, 64]));
        else if (pr.kind === 'vent') box(B.flat, px, py, H + 2.2, pr.w / 2, pr.h / 2, 2.2, 0, lin([96, 98, 104]));
        else box(B.flat, px, py, H + 3, pr.w / 2, pr.h / 2, 3, 0, lin([113, 115, 121]));
      }
      if (b.w > 52 && b.h > 52 && H > 44) {
        const rp = hash01(bid * 53.7);
        if (rp < 0.58) {
          const qx = b.x + b.w * (hash01(bid * 59.3) < 0.5 ? 0.28 : 0.72);
          const qy = b.y + b.h * (hash01(bid * 61.7) < 0.5 ? 0.28 : 0.72);
          if (rp < 0.20) {
            for (const [lx, ly] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) box(B.flat, qx + lx, qy + ly, H + 1.8, 0.7, 0.7, 1.8, 0, lin([80, 72, 64]));
            const tankG = new THREE.CylinderGeometry(4.6, 4.9, 7.5, 10);
            B.flat.push(tankG, mat4(qx, H + 7.3, qy, 0), lin([122, 102, 82]));
            tankG.dispose();
            disc(B.roof, qx, qy, H + 11.3, 5.1, lin(roofC.map((v) => v * 0.85)), 10);
          } else if (rp < 0.40) {
            box(B.flat, qx, qy, H + 2.4, 5.5, 4.2, 2.4, 0, lin([108, 110, 116]));
            box(B.flat, qx + 8.5, qy + 2, H + 1.7, 3.6, 3.0, 1.7, 0, lin([96, 98, 104]));
            box(B.flat, qx + 4, qy + 1, H + 0.9, 2.2, 1.1, 0.9, 0, lin([88, 90, 96]));
          } else {
            limb(B.flat, [qx, qy, H], [qx, qy, H + 13], 0.55, 0.3, lin([52, 54, 60]), 5);
            box(B.flat, qx, qy, H + 10.6, 3.4, 0.4, 0.4, 0, lin([52, 54, 60]));
            box(B.flat, qx, qy, H + 8.2, 2.4, 0.4, 0.4, 0, lin([52, 54, 60]));
          }
        }
      }
      if (b.deco && H > 60) {
        for (const w of walls) {
          const s1 = w.mk(H - 15, H - 10), s2 = w.mk(H - 21, H - 17.5);
          const off = [w.n[0] * 0.35, w.n[1] * 0.35, 0];
          const sh = (p) => [p[0] + off[0], p[1] + off[1], p[2]];
          B.flat.quad(sh(s1[0]), sh(s1[1]), sh(s1[2]), sh(s1[3]), lin([217, 138, 122]));
          B.flat.quad(sh(s2[0]), sh(s2[1]), sh(s2[2]), sh(s2[3]), lin([159, 201, 184]));
        }
      }
      if (b.neon) {
        const nc = rgb(b.neonColor).map((v) => v * 0.85);
        for (const w of walls) {
          const facing = (camX - (w.n[0] ? w.fixed : cx)) * w.n[0] + (camY - (w.n[1] ? w.fixed : cy)) * w.n[1];
          if (facing <= 0) continue;
          const np = w.mk(H - 12, H - 5);
          const off = [w.n[0] * 0.4, w.n[1] * 0.4, 0];
          const sh = (p) => [p[0] + off[0], p[1] + off[1], p[2]];
          B.basic.quad(sh(np[0]), sh(np[1]), sh(np[2]), sh(np[3]), lin(nc));
        }
        R.addGlow(cx, cy, H - 8.5, 13, lin(rgb(b.neonColor)), 0.26);
      }
      let best = null, bestD = 0;
      for (const w of walls) {
        const mid = w.n[0] ? [w.fixed, cy] : [cx, w.fixed];
        const d = (camX - mid[0]) * w.n[0] + (camY - mid[1]) * w.n[1];
        if (d > bestD) { bestD = d; best = w; }
      }
      if (best && dist < 620 && hash01(bid * 43.9) < 0.85) {
        const sIdx = Math.floor(hash01(bid * 97.3) * SIGNS.length) % SIGNS.length;
        const sBg = SIGNS[sIdx].bg.map((v) => v * 0.82);
        const len = Math.min(38, best.wid * 0.62);
        const along = best.n[1] !== 0 ? [1, 0] : [0, 1];
        if (along[0] * R.F.right[0] + along[1] * R.F.right[1] < 0) { along[0] = -along[0]; along[1] = -along[1]; }
        const cenX = best.n[1] !== 0 ? cx : best.fixed + best.n[0] * 3.05;
        const cenY = best.n[1] !== 0 ? best.fixed + best.n[1] * 3.05 : cy;
        if (best.n[1] !== 0) box(B.flat, cx, best.fixed + best.n[1] * 1.8, 14.0, len / 2, 1.1, 2.6, 0, lin(sBg));
        else box(B.flat, best.fixed + best.n[0] * 1.8, cy, 14.0, 1.1, len / 2, 2.6, 0, lin(sBg));
        const a0 = [cenX - along[0] * len / 2, cenY - along[1] * len / 2];
        const a1 = [cenX + along[0] * len / 2, cenY + along[1] * len / 2];
        const v1 = 1 - sIdx / SIGNS.length, v0 = 1 - (sIdx + 1) / SIGNS.length;
        B.sign.quad([a0[0], a0[1], 11.4], [a1[0], a1[1], 11.4], [a1[0], a1[1], 16.6], [a0[0], a0[1], 16.6], WHITE, [0, v0, 1, v1]);
      }
      if (best && dist < 760 && hash01(bid * 31.7) < 0.6) {
        const AWN = [[150, 70, 58], [52, 96, 104], [196, 150, 84]];
        const awnC = lin(AWN[Math.floor(hash01(bid * 37.3) * 3) % 3]);
        const alen = Math.min(56, best.wid * 0.66);
        if (best.n[1] !== 0) box(B.flat, cx, best.fixed + best.n[1] * 2.9, 15.2, alen / 2, 2.9, 0.5, 0, awnC);
        else box(B.flat, best.fixed + best.n[0] * 2.9, cy, 15.2, 2.9, alen / 2, 0.5, 0, awnC);
      }
    }
  }
}

// ------------------------------------------------- vegetation & street props
function buildBusStop(R, x, y, face) {
  const { B } = R;
  const WOOD = lin([122, 94, 66]), IRON = lin([40, 42, 48]);
  const s = [-face[1], face[0]];
  const yaw = Math.atan2(s[1], s[0]);
  const LP = (lat, dep, z) => [x + s[0] * lat + face[0] * dep, y + s[1] * lat + face[1] * dep, z];
  for (const la of [-5.5, 5.5]) for (const de of [1.6, -2.0]) {
    const p = LP(la, de, 0);
    box(B.flat, p[0], p[1], 4.4, 0.5, 0.5, 4.4, yaw, IRON);
  }
  const rc = LP(0, -0.2, 0);
  box(B.flat, rc[0], rc[1], 9.2, 7.6, 2.8, 0.45, yaw, lin([70, 74, 82]));
  B.alpha.quad(LP(-6.8, -2.2, 1.2), LP(6.8, -2.2, 1.2), LP(6.8, -2.2, 8.6), LP(-6.8, -2.2, 8.6), [...lin([180, 200, 210]), 0.32]);
  const bc = LP(0, -0.8, 0);
  box(B.flat, bc[0], bc[1], 2.3, 5.6, 1.5, 0.5, yaw, WOOD);
  for (const la of [-4.2, 4.2]) { const lp2 = LP(la, -0.8, 0); box(B.flat, lp2[0], lp2[1], 1.0, 0.45, 0.45, 1.0, yaw, IRON); }
  const poleBase = LP(7.6, 2.2, 0), poleTop = LP(7.6, 2.2, 11.5);
  limb(B.flat, poleBase, poleTop, 0.35, 0.35, IRON, 5);
  B.bus.quad(LP(7.48, -1.3, 7.3), LP(7.48, 5.7, 7.3), LP(7.48, 5.7, 12.3), LP(7.48, -1.3, 12.3), WHITE, [1, 0, 0, 1]);
  B.bus.quad(LP(7.72, 5.7, 7.3), LP(7.72, -1.3, 7.3), LP(7.72, -1.3, 12.3), LP(7.72, 5.7, 12.3), WHITE, [1, 0, 0, 1]);
}
function buildVegetation(R, game) {
  const { B } = R;
  const camX = R.F.cam[0], camY = R.F.cam[1];
  const inR = (x, y, r) => { const dx = x - camX, dy = y - camY; return dx * dx + dy * dy < r * r; };
  for (const t of game.city.trees || []) {
    if (!inR(t.x, t.y, 760)) continue;
    if (R.F.screen === 'title' || R.F.screen === 'summary') {
      const cp = R.project(t.x, t.y, 15 + (t.r || 13));
      if (cp) {
        if (R.F.screen === 'title' && cp.y > 140 && cp.y < 370 && cp.x > 220 && cp.x < 1060) continue;
        if (R.F.screen === 'summary' && cp.y > 50 && cp.y < 750 && cp.x > 230 && cp.x < 1050) continue;
      }
    }
    const r = t.r || 13;
    limb(B.flat, [t.x, t.y, 0], [t.x, t.y, 13], 1.8, 1.3, lin([96, 74, 48]), 6);
    const cz = 15 + r * 0.55;
    ball(B.flat, t.x, t.y, cz, r * 0.95, lin(rgb(PALETTE.treeDark)));
    ball(B.flat, t.x - r * 0.42, t.y + r * 0.3, cz - r * 0.16, r * 0.62, lin(rgb(PALETTE.treeLight)));
    ball(B.flat, t.x + r * 0.38, t.y - r * 0.26, cz + r * 0.3, r * 0.5, lin(rgb(PALETTE.treeLight).map((v) => v * 0.82)));
    if (inR(t.x, t.y, 520)) {
      ball(B.flat, t.x + r * 0.1, t.y + r * 0.52, cz - r * 0.3, r * 0.48, lin(rgb(PALETTE.treeDark).map((v) => v * 0.9)));
      ball(B.flat, t.x - r * 0.15, t.y - r * 0.5, cz + r * 0.12, r * 0.44, lin(rgb(PALETTE.treeLight).map((v) => v * 0.9)));
    }
  }
  for (const pm of game.city.palms || []) {
    if (!inR(pm.x, pm.y, 760) || inR(pm.x, pm.y, 95)) continue;
    const s = (pm.s || 1) * 0.72;
    const leanX = (pm.lean || 0) * 1.35;
    const H = 30 * s;
    if (R.F.screen === 'title' || R.F.screen === 'summary') {
      const cp = R.project(pm.x + leanX * 2.2, pm.y, H + 2);
      if (cp) {
        if (R.F.screen === 'title' && cp.y > 150 && cp.y < 360 && cp.x > 240 && cp.x < 1040) continue;
        if (R.F.screen === 'summary' && cp.y > 40 && cp.y < 760 && cp.x > -280 && cp.x < 1700) continue;
      }
    }
    let p0 = [pm.x, pm.y, 0];
    for (let i = 0; i < 4; i++) {
      const t1 = (i + 1) / 4;
      const p1 = [pm.x + leanX * t1 * t1 * 2.2, pm.y, H * t1];
      limb(B.flat, p0, p1, (4.6 - i * 0.5) / 2, (4.1 - i * 0.5) / 2, lin(rgb(PALETTE.palmTrunk)), 6);
      p0 = p1;
    }
    const crown = p0;
    ball(B.flat, crown[0], crown[1], crown[2] + 0.8, 2.4, lin([84, 64, 36]));
    const seed = Math.floor(Math.abs(pm.x) * 3 + Math.abs(pm.y) * 7);
    for (let i = 0; i < 9; i++) {
      const la = (i / 9) * Math.PI * 2 + hash01(seed + i) * 0.45;
      const len = (26 + hash01(seed + i * 3) * 6) * s;
      const drop = (13 + hash01(seed + i * 7) * 5) * s;
      const dir = [Math.cos(la), Math.sin(la)], perp = [-dir[1], dir[0]];
      const col = lin(i % 2 ? rgb(PALETTE.palmDark) : rgb(PALETTE.palmLight));
      const spine = [
        [crown[0], crown[1], crown[2] + 0.6, 2.7],
        [crown[0] + dir[0] * len * 0.36, crown[1] + dir[1] * len * 0.36, crown[2] + 4.6 * s, 2.5],
        [crown[0] + dir[0] * len * 0.70, crown[1] + dir[1] * len * 0.70, crown[2] + 2.6 * s, 1.6],
        [crown[0] + dir[0] * len, crown[1] + dir[1] * len, crown[2] + 1 - drop, 0.25],
      ];
      for (let k = 0; k < 3; k++) {
        const A = spine[k], Bp = spine[k + 1];
        B.flat.quad(
          [A[0] + perp[0] * A[3], A[1] + perp[1] * A[3], A[2]],
          [Bp[0] + perp[0] * Bp[3], Bp[1] + perp[1] * Bp[3], Bp[2]],
          [Bp[0] - perp[0] * Bp[3], Bp[1] - perp[1] * Bp[3], Bp[2]],
          [A[0] - perp[0] * A[3], A[1] - perp[1] * A[3], A[2]], col);
      }
    }
  }
  for (const l of game.city.lamps) {
    if (!inR(l.x, l.y, 700) || inR(l.x, l.y, 80)) continue;
    limb(B.flat, [l.x, l.y, 0], [l.x, l.y, 25], 0.8, 0.8, lin([34, 36, 42]), 5);
    box(B.basic, l.x, l.y, 26, 2.4, 2.4, 1.7, 0, lin([238, 198, 138]));
    const em = R.F.gradeEmissive || 0;
    R.addGlow(l.x, l.y, 27, 11, lin([255, 190, 110]), 0.08 + em * 0.26);
    if (em > 0.5) {
      disc(B.alpha, l.x, l.y, 0.52, 12, [...lin([255, 190, 110]), 0.13]);
      disc(B.alpha, l.x, l.y, 0.54, 6, [...lin([255, 205, 130]), 0.16]);
    }
  }
  for (const bt of game.city.boats || []) {
    if (!inR(bt.x, bt.y, 1250)) continue;
    const s = bt.s || 1;
    box(B.flat, bt.x, bt.y, 2.2 * s, 15 * s, 5 * s, 2.2 * s, 0, lin([232, 226, 212]));
    limb(B.flat, [bt.x, bt.y, 3 * s], [bt.x, bt.y, 19 * s], 0.65, 0.65, lin([110, 88, 68]), 5);
    B.flat.quad([bt.x + 1.2 * s, bt.y, 18 * s], [bt.x + 1.2 * s, bt.y, 3.5 * s], [bt.x + 11 * s, bt.y, 3.5 * s], [bt.x + 1.2 * s, bt.y, 18 * s], lin(rgb(bt.sail || '#f2e8d8')));
  }
  const WOOD = lin([122, 94, 66]), IRON = lin([40, 42, 48]);
  if (inR(1330, 1512, 1080)) buildBusStop(R, 1330, 1512, [0, -1]);
  if (inR(800, 1044, 1080)) buildBusStop(R, 800, 1044, [0, -1]);
  if (inR(3650, 2620, 1080)) buildBusStop(R, 3650, 2620, [1, 0]);
  const centers = roadCenters();
  const actorNear = (x, y, r) => {
    const all = [...game.traffic, ...(game.specials || []), ...game.police.cops, game.player];
    return all.some((a) => { const dx = a.x - x, dy = a.y - y; return dx * dx + dy * dy < r * r; });
  };
  for (const c of centers) {
    for (const vert of [true, false]) {
      for (const sideSign of [1, -1]) {
        const off = sideSign * 54;
        for (let k = 0; k < 8; k++) {
          const mid = k * BLOCK_PITCH + ROAD_W + (BLOCK_PITCH - ROAD_W) / 2;
          const bx = vert ? c + off : mid, by = vert ? mid : c + off;
          if (!inR(bx, by, 820) || actorNear(bx, by, 26)) continue;
          const h = hash01(c * 1.3 + k * 7.7 + sideSign * 31 + (vert ? 0 : 500));
          if (h < 0.34) {
            buildBusStop(R, bx, by, vert ? [-Math.sign(off), 0] : [0, -Math.sign(off)]);
          } else if (h < 0.78) {
            box(B.flat, bx, by, 2.3, vert ? 1.6 : 4.6, vert ? 4.6 : 1.6, 0.5, 0, WOOD);
            const rx = vert ? bx + (off > 0 ? 1.5 : -1.5) : bx, ry = vert ? by : by + (off > 0 ? 1.5 : -1.5);
            box(B.flat, rx, ry, 3.8, vert ? 0.45 : 4.6, vert ? 4.6 : 0.45, 0.5, 0, WOOD);
            for (const e of [-3.4, 3.4]) {
              const lx2 = vert ? bx : bx + e, ly2 = vert ? by + e : by;
              box(B.flat, lx2, ly2, 1.0, 0.45, 0.45, 1.0, 0, IRON);
            }
          }
        }
      }
    }
  }
}


// ------------------------------------------------------------- the coast
// Beach band + sea surface east of Ocean Drive. The ground grid paints
// flat colour cells out here; this module lays three real surfaces over
// them on the standard pipeline: a dry-sand band from the promenade
// edge to the waterline, a darker wet-sand strip with a lower roughness
// (it sheens where the surf reaches), and the sea itself — a MeshStan-
// dardMaterial plane whose procedural normal + roughness maps break the
// sun into glitter. A scalloped foam line (hash-varied alpha quads)
// stitches the waterline. All textures are painted ONCE from a seeded
// LCG value-noise field, so every frame and capture agrees exactly.
let coastKit = null;
function buildCoastKit() {
  if (coastKit) return coastKit;
  // Seeded value-noise height field (32×32 lattice, bilinear), shared by
  // the sea normal map and the roughness variation.
  const N = 32;
  const R = lcg(90210);
  const lat = [];
  for (let i = 0; i < N * N; i++) lat.push(R());
  const noise = (u, v) => {
    const x = ((u % 1) + 1) % 1 * N, y = ((v % 1) + 1) % 1 * N;
    const x0 = Math.floor(x) % N, y0 = Math.floor(y) % N, x1 = (x0 + 1) % N, y1 = (y0 + 1) % N;
    const fx = x - Math.floor(x), fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = lat[y0 * N + x0], b = lat[y0 * N + x1], c = lat[y1 * N + x0], d = lat[y1 * N + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const height = (u, v) => noise(u, v) * 0.62 + noise(u * 2.7 + 0.31, v * 2.7 + 0.77) * 0.38;
  // Normal map from the height field's gradient.
  const S = 256;
  const [nCv, nCtx] = makeCanvas2d(S, S);
  const img = nCtx.createImageData(S, S);
  const STR = 2.6;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, e = 1 / S;
    const dx = (height(u + e, v) - height(u - e, v)) * STR;
    const dy = (height(u, v + e) - height(u, v - e)) * STR;
    const inv = 1 / Math.hypot(dx, dy, 1);
    const o = (y * S + x) * 4;
    img.data[o] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
    img.data[o + 1] = Math.round((dy * inv * 0.5 + 0.5) * 255);
    img.data[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
    img.data[o + 3] = 255;
  }
  nCtx.putImageData(img, 0, 0);
  const normalMap = new THREE.CanvasTexture(nCv);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  // Roughness map: calm patches (glitter) against rougher chop.
  const [rCv, rCtx] = makeCanvas2d(S, S);
  const rImg = rCtx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const h = height(x / S * 1.7 + 0.53, y / S * 1.7 + 0.11);
    const val = Math.round(38 + h * 74);
    const o = (y * S + x) * 4;
    rImg.data[o] = val; rImg.data[o + 1] = val; rImg.data[o + 2] = val; rImg.data[o + 3] = 255;
  }
  rCtx.putImageData(rImg, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(rCv);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  // Dry sand: warm base, seeded speckle, faint wind streaks.
  const [sCv, sCtx] = makeCanvas2d(S, S);
  const SR = lcg(4177);
  sCtx.fillStyle = 'rgb(219,192,146)'; sCtx.fillRect(0, 0, S, S);
  for (let i = 0; i < 5200; i++) {
    const px = SR() * S, py = SR() * S;
    sCtx.fillStyle = SR() < 0.5 ? 'rgba(146,116,72,0.20)' : 'rgba(255,248,226,0.16)';
    sCtx.fillRect(px, py, 2, 2);
  }
  for (let i = 0; i < 22; i++) {
    const py = SR() * S;
    sCtx.fillStyle = 'rgba(160,128,80,0.10)';
    sCtx.fillRect(0, py, S, 2 + SR() * 3);
  }
  const sandMap = new THREE.CanvasTexture(sCv);
  sandMap.wrapS = sandMap.wrapT = THREE.RepeatWrapping;
  sandMap.colorSpace = THREE.SRGBColorSpace;
  sandMap.anisotropy = 4;
  const seaMat = new THREE.MeshStandardMaterial({
    color: linColor([56, 118, 138]), roughness: 1.0, roughnessMap, normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55), metalness: 0.05, envMapIntensity: 1.35,
  });
  const sandMat = new THREE.MeshStandardMaterial({ map: sandMap, roughness: 0.96, metalness: 0.0, envMapIntensity: 0.18 });
  const wetMat = new THREE.MeshStandardMaterial({ color: linColor([172, 140, 102]), roughness: 0.48, metalness: 0.0, envMapIntensity: 0.7 });
  coastKit = { seaMat, sandMat, wetMat };
  return coastKit;
}
function buildCoast(R, game) {
  const { B, gl } = R;
  const camX = R.F.cam[0], camY = R.F.cam[1];
  if (camX < WORLD_SIZE - 1560) return; // the shore is out of every frame
  const kit = buildCoastKit();
  const idMode = idState.mode;
  const seaMat = idMode ? gl.mats.idBlack : kit.seaMat;
  const sandMat = idMode ? gl.mats.idBlack : kit.sandMat;
  const wetMat = idMode ? gl.mats.idBlack : kit.wetMat;
  const lay = (mat, x0, x1, z, repX, repY) => {
    const g = new THREE.PlaneGeometry(x1 - x0, WORLD_SIZE + 560);
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set((x0 + x1) / 2, z, WORLD_SIZE / 2);
    mesh.frustumCulled = false;
    if (repX) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repX, uv.getY(i) * repY);
    }
    gl.scene.add(mesh);
    gl.dyn.push(mesh);
  };
  // Dry sand from the promenade edge (x = WORLD_SIZE) to the waterline,
  // the wet strip across the surf reach, then open sea to the horizon
  // the skyline bridge stands in. Heights step 0.30 / 0.45 / 0.60 so the
  // bands overlap without z-fighting the ground cells beneath (≤ 0.12).
  lay(sandMat, WORLD_SIZE - 4, WORLD_SIZE + 88, 0.30, 3, 46);
  lay(wetMat, WORLD_SIZE + 58, WORLD_SIZE + 96, 0.45, 0, 0);
  lay(seaMat, WORLD_SIZE + 78, WORLD_SIZE + 1060, 0.60, 7, 34);
  // Foam stitch at the waterline: scalloped alpha quads, widths and
  // depths from the world hash so the line never repeats mechanically.
  if (!idMode) {
    const FOAM = [...lin([238, 244, 240]), 0.34];
    for (let y = -160; y < WORLD_SIZE + 160; y += 46) {
      const dy = y - camY;
      if (dy * dy > 1250 * 1250) continue;
      const h = hash01(y * 0.731);
      const x0 = WORLD_SIZE + 74 + h * 7, x1 = WORLD_SIZE + 88 + h * 5;
      B.alpha.quad([x0, y, 0.66], [x1, y, 0.66], [x1, y + 30 + h * 12, 0.66], [x0, y + 30 + h * 12, 0.66], FOAM);
    }
  }
}

// ------------------------------------------------------------ world entry
// The orchestrator's one call: skyline silhouettes, the building field,
// vegetation + street props, and the coast — in the standing order.
export function buildWorld(R, game) {
  buildSkyline(R, game);
  buildBuildings(R, game);
  buildVegetation(R, game);
  buildCoast(R, game);
}
