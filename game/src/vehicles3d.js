// vehicles3d.js — TOTAL REBUILD Phase 1: the vehicle builders.
// The stacked-box car is gone. Bodies are EXTRUDED SIDE PROFILES — a
// shaped silhouette (sloped nose, deck, bumper faces) swept across the
// car's width with a bevelled edge, smooth-lit by the standard pipeline —
// and the glasshouse is a SEPARATE glossy shell extruded from its own
// cabin profile, sitting in a painted frame. Wheels have real depth:
// tyre, shoulder ring, recessed rim barrel, five spokes, hub and cap,
// spinning with travel and steering with the car's steer value.
//
// Class contract (the scale anchors never move): every sedan-class roof
// tops out at CAR_ROOF 12.6 with the standing thin roof cap above the
// glasshouse, the van at 11.6; lengths/widths derive from the sim's own
// car.len / car.wid. Visual kinds key off the sim's EXISTING kind ids —
// sedan / hatch / coupe / van / armored civilians, and for the police
// interceptor three deterministic per-unit variants (interceptor / SUV /
// PIT) chosen by id hash. Damage states carry over from the old build:
// crumple below 70% hp, engine smoke below 40%, burning at/below 22%.
import * as THREE from '../vendor/three.module.min.js';
import { UNIT_BOX, box, limb, ball, disc, mat4, rgb, lin, hash01, idState } from './render3d.js';
import { plateUV } from './materials3d.js';

export const CAR_ROOF = 12.6;
const TYRE = [12, 12, 15];
const TYRE_G = new THREE.CylinderGeometry(2.9, 2.9, 3.8, 18).rotateX(Math.PI / 2);
const HUB_G = new THREE.CylinderGeometry(1.8, 1.8, 4.0, 12).rotateX(Math.PI / 2);
const CAP_G = new THREE.CylinderGeometry(0.75, 0.75, 4.15, 8).rotateX(Math.PI / 2);
const RIM_G = new THREE.CylinderGeometry(2.02, 2.02, 0.5, 18).rotateX(Math.PI / 2);
const SHOULDER_G = new THREE.TorusGeometry(2.45, 0.42, 8, 20);
const SPOKE_G = new THREE.BoxGeometry(0.55, 1.7, 0.34);

// Extrude a side profile (points are [forward, up] in car-local units)
// across the car's width with a rounded bevel. The bevel expands the
// silhouette by ~bevel in the profile plane, so profiles are drawn that
// much inside their true outline.
function extrudeProfile(pts, width, bevel) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const depth = Math.max(1, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 2,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}
// Body profiles per class: [x fraction of L, up] — base sits at 1.8,
// the top line at bodyTop (drawn 0.55 under, the bevel rounds it up).
function bodyProfile(kind, L, top) {
  const b = 1.8, t = top - 0.55;
  switch (kind) {
    case 'coupe': return [[-0.50, b], [-0.50, 0.62 * 10.2 / 10.2 * 6.2], [-0.46, t - 0.7], [-0.20, t], [0.10, t], [0.34, t - 0.9], [0.47, 5.4], [0.50, 3.6], [0.50, b]].map(([f, z]) => [f * L, z]);
    case 'hatch': return [[-0.50, b], [-0.50, 6.0], [-0.47, t - 0.3], [-0.30, t], [0.08, t], [0.30, t - 0.8], [0.46, 5.6], [0.50, 3.6], [0.50, b]].map(([f, z]) => [f * L, z]);
    case 'van': return [[-0.50, b], [-0.50, t - 0.4], [-0.30, t], [0.28, t], [0.44, t - 1.6], [0.50, 4.4], [0.50, b]].map(([f, z]) => [f * L, z]);
    case 'armored': return [[-0.50, b], [-0.50, 6.6], [-0.44, t - 0.4], [-0.24, t], [0.14, t], [0.34, t - 0.6], [0.48, 5.8], [0.50, 3.8], [0.50, b]].map(([f, z]) => [f * L, z]);
    case 'suv': return [[-0.50, b], [-0.50, 7.0], [-0.45, t - 0.3], [-0.26, t], [0.16, t], [0.36, t - 0.7], [0.48, 6.0], [0.50, 3.8], [0.50, b]].map(([f, z]) => [f * L, z]);
    default: return [[-0.50, b], [-0.50, 6.4], [-0.45, t - 0.8], [-0.24, t], [0.10, t], [0.32, t - 0.9], [0.47, 5.6], [0.50, 3.5], [0.50, b]].map(([f, z]) => [f * L, z]); // sedan / interceptor
  }
}
// Cabin (glasshouse) profiles: base buried 0.4 into the body top, top
// drawn 0.5 under the class roof so bevel + cap land on the anchor.
function cabinProfile(kind, L, base, top) {
  const t = top - 0.5;
  switch (kind) {
    case 'coupe': return [[-0.30, base], [-0.26, t - 1.2], [-0.10, t], [0.10, t], [0.20, base]];
    case 'hatch': return [[-0.42, base], [-0.38, t - 0.7], [-0.20, t], [0.12, t], [0.22, base]];
    case 'van': return [[-0.30, base], [-0.28, t - 0.5], [-0.10, t], [0.24, t], [0.34, base]];
    case 'suv': return [[-0.34, base], [-0.31, t - 0.6], [-0.16, t], [0.14, t], [0.24, base]];
    case 'armored': return [[-0.26, base], [-0.23, t - 0.6], [-0.08, t], [0.14, t], [0.22, base]];
    default: return [[-0.28, base], [-0.24, t - 0.9], [-0.10, t], [0.13, t], [0.23, base]];
  }
}

export function buildTank(R, car) {
  const { B } = R;
  idState.cat = 'tank';
  const yaw = car.angle, L = car.len, W = car.wid;
  const camo = lin([92, 100, 74]), camoD = lin([70, 78, 56]), dark = lin([34, 36, 32]);
  disc(B.alpha, car.x, car.y, 0.25, L * 0.62, [...lin([8, 8, 10]), 0.30]);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const LP = (lx, ly, lz) => [car.x + lx * c - ly * s, car.y + lx * s + ly * c, lz];
  for (const sy of [1, -1]) {
    const tp = LP(0, sy * (W / 2 - 3.6), 0);
    box(B.flat, tp[0], tp[1], 3.6, L / 2, 3.6, 3.6, yaw, dark);
    for (const wx of [-L * 0.32, -L * 0.11, L * 0.11, L * 0.32]) { const wp = LP(wx, sy * (W / 2 - 0.4), 3.4); box(B.flat, wp[0], wp[1], wp[2], 2.6, 0.8, 2.6, yaw, lin([58, 60, 54])); }
  }
  box(B.flat, car.x, car.y, 7.6, L / 2 - 2, W / 2 - 6.5, 3.9, yaw, camo);
  const g0 = LP(L / 2 - 2, -W / 2 + 7, 4.2), g1 = LP(L / 2 - 2, W / 2 - 7, 4.2), g2 = LP(L * 0.18, W / 2 - 7.5, 11.4), g3 = LP(L * 0.18, -W / 2 + 7.5, 11.4);
  B.flat.quad(g0, g1, g2, g3, camoD);
  box(B.flat, car.x, car.y, 11.2, L * 0.30, W / 2 - 6.0, 0.9, yaw, camoD);
  const t = car.turret || yaw, tc = Math.cos(t), ts = Math.sin(t);
  const tX = car.x - c * 2, tY = car.y - s * 2;
  box(B.flat, tX, tY, 14.6, 11, 9.5, 3.4, t, camo);
  box(B.flat, tX + tc * 3, tY + ts * 3, 18.4, 4.6, 4.6, 1.2, t, camoD);
  limb(B.flat, [tX + tc * 10, tY + ts * 10, 15.2], [tX + tc * 34, tY + ts * 34, 15.6], 1.7, 1.2, dark, 6);
  const bp = [tX + tc * 34, tY + ts * 34, 15.6];
  box(B.flat, bp[0], bp[1], bp[2], 3.4, 3.4, 2.0, t, dark);
  limb(B.flat, [tX - tc * 6, tY - ts * 6, 18], [tX - tc * 7.5, tY - ts * 7.5, 27], 0.35, 0.35, dark, 4);
  idState.cat = null;
}
export function buildPlane(R, car) {
  const { B } = R;
  idState.cat = 'plane';
  const yaw = car.angle, alt = car.alt || 0;
  const body = lin(rgb(car.color)), bodyTop = lin(rgb(car.color).map((v) => Math.min(255, v * 1.18)));
  disc(B.alpha, car.x, car.y, 0.25, 30, [...lin([8, 8, 10]), Math.max(0.08, 0.30 - alt * 0.0016)]);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const LP = (lx, ly, lz) => [car.x + lx * c - ly * s, car.y + lx * s + ly * c, (lz || 0) + alt];
  limb(B.flat, LP(-30, 0, 9), LP(28, 0, 10), 5.5, 4.25, body, 9);
  const cp = LP(6, 0, 14.5);
  box(B.flat, cp[0], cp[1], cp[2], 9, 6.4, 3.4, yaw, lin([24, 33, 48]));
  for (const sy of [1, -1]) { const fp = LP(2, sy * 8.5, 3.4); box(B.flat, fp[0], fp[1], fp[2], 17, 2.2, 2.6, yaw, lin([52, 56, 62])); }
  B.flat.quad(LP(10, -31, 11.5), LP(2, -31, 11.5), LP(0, 31, 11.5), LP(8, 31, 11.5), bodyTop);
  B.flat.quad(LP(-26, -13, 12), LP(-31, -13, 12), LP(-31, 13, 12), LP(-26, 13, 12), bodyTop);
  B.flat.quad(LP(-30, 0, 12), LP(-25, 0, 12), LP(-26.5, 0, 22), LP(-29.5, 0, 22), body);
  const nose = LP(31, 0, 10);
  const prop = new THREE.CircleGeometry(8.6, 12);
  B.alpha.push(prop, mat4(nose[0], nose[2], nose[1], Math.PI / 2 - yaw), [...lin([30, 30, 34]), 0.4]);
  prop.dispose();
  idState.cat = null;
}

export function buildCar(R, car) {
  const { B, game, F } = R;
  const dx = car.x - F.cam[0], dy = car.y - F.cam[1];
  if (dx * dx + dy * dy > 1080 * 1080) return;
  if (car.kind === 'tank') { buildTank(R, car); return; }
  if (car.kind === 'plane') { buildPlane(R, car); return; }
  const isHero = car === F.heroCar;
  idState.cat = isHero ? 'car' : null;
  const yaw = car.angle;
  const L = car.len || 38;
  // Render-local width: the sim's 19 u reads squat beside the figures;
  // non-van bodies draw at 17.5 u while car.wid stays sim data.
  const isVan = car.kind === 'van';
  // Police visual variant: deterministic per unit — interceptor sedan,
  // pursuit SUV, or PIT build — all on the sim's one 'interceptor' kind.
  const copVariant = car.isCop ? ['interceptor', 'suv', 'pit'][Math.floor(hash01((car.id || 1) * 5.31) * 3) % 3] : null;
  const variant = isVan ? 'van'
    : car.isCop ? (copVariant === 'suv' ? 'suv' : 'interceptor')
    : car.kind === 'sedan' || car.kind === 'coupe' || car.kind === 'hatch' || car.kind === 'armored' ? car.kind
    : ['sedan', 'coupe', 'hatch'][Math.floor(hash01((car.id || 1) * 3.13) * 3) % 3];
  const W = isVan ? (car.wid || 21) : variant === 'suv' ? 18.6 : 17.5;
  const body = car.dead ? lin([44, 44, 48]) : lin(rgb(car.color));
  const bodyTop = car.dead ? body : lin(rgb(car.color).map((v) => Math.min(255, v * 1.2)));
  const bodyDark = car.dead ? body : lin(rgb(car.color).map((v) => v * 0.85));
  const bodyTopZ = isVan ? 10.2 : variant === 'suv' ? 9.3 : 8.2;
  const roofZ = isVan ? 11.6 : CAR_ROOF;
  disc(B.alpha, car.x, car.y, 0.25, L * 0.58, [...lin([8, 8, 10]), 0.32]);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const LP = (lx, ly, lz) => [car.x + lx * c - ly * s, car.y + lx * s + ly * c, lz];
  const M = mat4(car.x, 0, car.y, -yaw);
  const part = (batch, geom, local, color) => batch.push(geom, M.clone().multiply(local), color);
  // ---- Shaped body: one bevelled extrusion from the class profile.
  {
    const g = extrudeProfile(bodyProfile(variant, L, bodyTopZ), W - 1.2, 0.6);
    B.paint.push(g, M, body);
    g.dispose();
  }
  // Bumpers.
  part(B.flat, UNIT_BOX, mat4(L / 2 + 0.8, 3.6, 0, 0, 3.2, 4.4, W - 1.2), lin([30, 31, 36]));
  part(B.flat, UNIT_BOX, mat4(-L / 2 - 0.8, 3.6, 0, 0, 3.2, 4.4, W - 1.2), lin([30, 31, 36]));
  // ---- Glasshouse: a separate glossy shell in a painted frame. The
  // frame extrusion (paint, slightly wider) carries the pillars and roof
  // rails; the glass extrusion (glossy, narrower, proud of the frame's
  // flanks by a hair) is the reflective band. Roof cap on top lands the
  // silhouette exactly on the standing anchor (cap top = roofZ + 0.15,
  // as the previous build's roof slab measured).
  const cabBase = bodyTopZ - 0.4;
  const frameW = W - 3.4, glassW = W - 3.1;
  {
    const gf = extrudeProfile(cabinProfile(variant, L, cabBase, roofZ), frameW, 0.5);
    B.paint.push(gf, M, bodyDark);
    gf.dispose();
    const gg = extrudeProfile(cabinProfile(variant, L, cabBase + 0.5, roofZ - 0.35), glassW, 0.45);
    // Per-car glass tint jitter (seeded): panes vary subtly car to car.
    const jit = 0.85 + 0.30 * hash01((car.id || 1) * 7.31);
    B.glasspaint.push(gg, M, lin([52, 68, 88].map((v) => Math.min(255, v * jit))));
    gg.dispose();
  }
  const cabLen = isVan ? L * 0.52 : variant === 'coupe' ? L * 0.42 : variant === 'hatch' ? L * 0.60 : variant === 'suv' ? L * 0.56 : L * 0.46;
  const cabOff = isVan ? -L * 0.08 : variant === 'coupe' ? -L * 0.05 : variant === 'hatch' ? -L * 0.07 : variant === 'armored' ? L * 0.02 : L * 0.03;
  part(B.paint, UNIT_BOX, mat4(cabOff, roofZ - 0.4, 0, 0, cabLen - 4.4, 1.1, frameW - 3.8), bodyTop);
  // B-pillar split + chrome side trim + antenna fin + exhaust (surface
  // detail inside the standing silhouette).
  part(B.paint, UNIT_BOX, mat4(cabOff, (bodyTopZ + roofZ) / 2 - 0.2, 0, 0, 0.7, roofZ - bodyTopZ - 0.5, frameW + 0.45), bodyDark);
  for (const sy of [1, -1]) part(B.chrome, UNIT_BOX, mat4(-0.5, 4.6, sy * (W / 2 + 0.06), 0, L * 0.62, 0.55, 0.12), lin([198, 200, 205]));
  if (!isVan) part(B.flat, UNIT_BOX, mat4(cabOff - cabLen / 2 + 2.2, roofZ - 0.55, 0, 0, 2.6, 1.1, 0.5), lin([24, 25, 30]));
  part(B.chrome, UNIT_BOX, mat4(-L / 2 - 1.6, 2.2, W / 2 - 3.4, 0, 1.8, 0.9, 0.9), lin([120, 122, 128]));
  // Mirrors + door seams.
  for (const sy of [1, -1]) {
    const mp = LP(L * 0.26, sy * (W / 2 + 1.1), bodyTopZ + 1.6);
    box(B.flat, mp[0], mp[1], mp[2], 1.2, 2.0, 1.5, yaw, lin([22, 23, 28]));
    for (const lx of [-L * 0.08, L * 0.16]) {
      B.flat.quad(LP(lx, sy * (W / 2 + 0.14), 2.6), LP(lx + 0.8, sy * (W / 2 + 0.14), 2.6), LP(lx + 0.8, sy * (W / 2 + 0.14), bodyTopZ - 0.6), LP(lx, sy * (W / 2 + 0.14), bodyTopZ - 0.6), lin([16, 17, 21]));
    }
  }
  // Class trim: coupe spoiler/skirts/splitter; armored flank skirts;
  // SUV roof rails + side steps.
  if (variant === 'coupe') {
    part(B.flat, UNIT_BOX, mat4(-L / 2 + 0.9, bodyTopZ - 0.35, 0, 0, 2.4, 0.55, W - 5.2), bodyDark);
    for (const sy of [1, -1]) part(B.flat, UNIT_BOX, mat4(-0.5, 1.9, sy * (W / 2 + 0.05), 0, L * 0.6, 1.3, 0.3), lin([24, 24, 28]));
    part(B.flat, UNIT_BOX, mat4(L / 2 + 0.6, 1.6, 0, 0, 2.6, 0.7, W - 2), lin([24, 24, 28]));
  } else if (variant === 'armored') {
    for (const sy of [1, -1]) part(B.flat, UNIT_BOX, mat4(0, 2.4, sy * (W / 2 + 0.05), 0, L * 0.55, 2.0, 0.35), lin([34, 36, 40]));
  } else if (variant === 'suv') {
    for (const sy of [1, -1]) {
      part(B.flat, UNIT_BOX, mat4(cabOff, roofZ + 0.1, sy * (frameW / 2 - 1.6), 0, cabLen - 6, 0.5, 0.5), lin([30, 31, 36]));
      part(B.flat, UNIT_BOX, mat4(-0.5, 1.7, sy * (W / 2 + 0.05), 0, L * 0.58, 1.1, 0.3), lin([30, 31, 36]));
    }
  }
  // ---- Wheels with depth: tyre + shoulder ring + recessed rim barrel
  // + five spokes + hub + cap, all riding the spin/steer matrix.
  const spin = ((car.speed || 0) * (game.time || 0)) / 2.9;
  const steer = car.steer || 0;
  for (const [lx, lz, front] of [[L / 2 - 7.5, W / 2 - 0.35, 1], [L / 2 - 7.5, -W / 2 + 0.35, 1], [-L / 2 + 7.5, W / 2 - 0.35, 0], [-L / 2 + 7.5, -W / 2 + 0.35, 0]]) {
    part(B.flat, UNIT_BOX, mat4(lx, 6.9, Math.sign(lz) * (W / 2 + 0.15), 0, 9.4, 2.6, 1.5), lin([15, 15, 18]));
    const wm = new THREE.Matrix4().makeTranslation(lx, 2.9, lz)
      .multiply(new THREE.Matrix4().makeRotationY(front ? -steer : 0))
      .multiply(new THREE.Matrix4().makeRotationZ(spin));
    B.tyre.push(TYRE_G, M.clone().multiply(wm), lin(TYRE));
    const out = Math.sign(lz);
    B.tyre.push(SHOULDER_G, M.clone().multiply(wm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, out * 1.55))), lin([9, 9, 11]));
    B.chrome.push(RIM_G, M.clone().multiply(wm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, out * 1.62))), lin([62, 64, 70]));
    for (let k = 0; k < 5; k++) {
      const sm = wm.clone().multiply(new THREE.Matrix4().makeRotationZ((k * Math.PI * 2) / 5)).multiply(new THREE.Matrix4().makeTranslation(0, 1.02, out * 1.9));
      B.chrome.push(SPOKE_G, M.clone().multiply(sm), lin([172, 176, 184]));
    }
    B.chrome.push(HUB_G, M.clone().multiply(wm), lin([190, 194, 202]));
    B.flat.push(CAP_G, M.clone().multiply(wm), lin([38, 40, 46]));
  }
  // Lights: two lamp units per corner with a dark gap between them.
  const quadAt = (lx, ly, z, wHalf, hHalf, colLin) => {
    const px = car.x + c * lx - s * ly, py = car.y + s * lx + c * ly;
    const side = [-s * wHalf, c * wHalf];
    const out = [c * Math.sign(lx) * 0.55, s * Math.sign(lx) * 0.55];
    B.basic.quad([px + side[0] + out[0], py + side[1] + out[1], z - hHalf], [px - side[0] + out[0], py - side[1] + out[1], z - hHalf],
      [px - side[0] + out[0], py - side[1] + out[1], z + hHalf], [px + side[0] + out[0], py + side[1] + out[1], z + hHalf], colLin);
  };
  for (const sy of [1, -1]) {
    quadAt(-L / 2 - 0.4, sy * (W / 2 - 2.3), 5.6, 1.55, 1.35, lin([255, 52, 60]));
    quadAt(-L / 2 - 0.4, sy * (W / 2 - 5.6), 5.6, 1.35, 1.35, lin([226, 36, 46]));
    quadAt(L / 2 + 0.4, sy * (W / 2 - 2.3), 5.8, 1.55, 1.35, lin([255, 243, 190]));
    quadAt(L / 2 + 0.4, sy * (W / 2 - 5.6), 5.8, 1.35, 1.35, lin([240, 226, 168]));
  }
  if (!car.dead) {
    const hg1 = LP(L / 2 + 0.4, W / 2 - 3.4, 5.8), hg2 = LP(L / 2 + 0.4, -W / 2 + 3.4, 5.8);
    const glowR = car.isCop ? 3.5 : 5.5, glowA = car.isCop ? 0.05 : 0.15;
    R.addGlow(hg1[0], hg1[1], 5.8, glowR, lin([255, 243, 190]), glowA);
    R.addGlow(hg2[0], hg2[1], 5.8, glowR, lin([255, 243, 190]), glowA);
    if ((F.gradeEmissive || 0) > 0.5) {
      for (const sy of [1, -1]) {
        const hp = LP(L / 2 + 10, sy * (W / 2 - 3.4), 0);
        disc(B.alpha, hp[0], hp[1], 0.56, 7.5, [...lin([255, 226, 170]), 0.16]);
      }
      const pool = LP(L / 2 + 12, 0, 0);
      disc(B.alpha, pool[0], pool[1], 0.54, 11.5, [...lin([255, 226, 170]), 0.10]);
    }
  }
  // Rear LEONIDA plate in a dark recess.
  {
    const id = car.id || 1;
    R.ensurePlate(id);
    const uv = plateUV(id);
    const rec = LP(-L / 2 - 2.15, 0, 4.4);
    box(B.flat, rec[0], rec[1], rec[2], 0.55, 5.3, 2.05, yaw, lin([17, 17, 21]));
    const plx = -L / 2 - 2.78, pw2 = 4.3, pz = 4.4, ph2 = 1.35;
    B.plate.quad(LP(plx, -pw2, pz - ph2), LP(plx, pw2, pz - ph2), LP(plx, pw2, pz + ph2), LP(plx, -pw2, pz + ph2), [1, 1, 1], [uv.u0, uv.v0, uv.u1, uv.v1]);
  }
  if (car.isCop) {
    const copShade = 0.90 + hash01((car.id || 1) * 3.7) * 0.10;
    part(B.paint, UNIT_BOX, mat4(0, 5.4, 0, 0, L * 0.60, 6.8, W + 0.44), lin([236 * copShade, 239 * copShade, 243 * copShade]));
    // Push bar: the PIT variant wears the extended ram frame.
    const pit = copVariant === 'pit';
    part(B.flat, UNIT_BOX, mat4(L / 2 + 2.5, 4.5, 0, 0, pit ? 1.3 : 1.0, 1.1, W - 4.2), lin([26, 27, 32]));
    if (pit) part(B.flat, UNIT_BOX, mat4(L / 2 + 2.5, 6.4, 0, 0, 1.1, 0.9, W - 5.2), lin([26, 27, 32]));
    for (const sy of [1, -1]) {
      part(B.flat, UNIT_BOX, mat4(L / 2 + 2.5, 4.3, sy * (W / 2 - 3.6), 0, 1.0, 4.4, 1.0), lin([26, 27, 32]));
      part(B.flat, UNIT_BOX, mat4(L / 2 + 1.3, 3.9, sy * (W / 2 - 3.6), 0, 2.4, 0.8, 0.8), lin([26, 27, 32]));
    }
    const flash = Math.sin((game.time || 0) * 10 + (car.sirenPhase || 0)) > 0;
    // Light bar: dark housing on a slim tray, separate red/blue lenses.
    part(B.flat, UNIT_BOX, mat4(cabOff, roofZ + 0.2, 0, 0, 3.4, 0.4, frameW - 0.8), lin([24, 25, 30]));
    part(B.flat, UNIT_BOX, mat4(cabOff, roofZ + 0.62, 0, 0, 2.6, 0.85, frameW - 1.2), lin([20, 21, 26]));
    if (!car.dead) {
      for (const side of [1, -1]) {
        const on = side > 0 ? flash : !flash;
        const bright = side > 0 ? [255, 66, 60] : [70, 140, 255];
        const dim = side > 0 ? [128, 32, 32] : [36, 64, 128];
        for (const latC of [2.05, 4.55]) {
          const lp = LP(cabOff, side * latC, roofZ + 0.62);
          box(B.basic, lp[0], lp[1], lp[2], 1.6, 1.12, 0.46, yaw, lin(on ? bright : dim));
        }
        const gp = LP(cabOff, side * 3.3, roofZ + 1.15);
        R.addGlow(gp[0], gp[1], roofZ + 1.15, 9, lin(on ? bright : dim), on ? 0.26 : 0.10);
      }
      const cp2 = LP(cabOff, 0, roofZ + 0.62);
      box(B.basic, cp2[0], cp2[1], cp2[2], 1.6, 0.65, 0.46, yaw, lin([196, 202, 208]));
    }
  }
  if (isHero && !isVan) {
    const wing = LP(-L * 0.44, 0, roofZ - 0.6);
    box(B.flat, wing[0], wing[1], wing[2], 2.0, W / 2 - 0.8, 1.0, yaw, lin([24, 25, 30]));
    for (const sy of [6.4, -6.4]) { const st = LP(-L * 0.44, sy, roofZ - 3.4); box(B.flat, st[0], st[1], st[2], 1.3, 1.3, 2.4, yaw, lin([24, 25, 30])); }
    quadAt(-L / 2 - 0.5, 0, 7.6, W / 2 - 4.6, 0.8, lin([168, 30, 40]));
    if (!car.dead) { const tb = LP(-L / 2 - 0.5, 0, 7.6); R.addGlow(tb[0], tb[1], 7.6, 8, lin([200, 36, 46]), 0.09); }
  }
  // Damage states, read from the car's own hp ratio (deterministic):
  // crumple < 70%, engine smoke < 40%, burning at/below 22%.
  const maxHp = car.maxHp || 100;
  const ratio = car.dead ? 1 : (typeof car.hp === 'number' ? car.hp : maxHp) / maxHp;
  if (!car.dead && ratio < 0.70) {
    const dmgC = lin(rgb(car.color).map((v) => v * 0.52));
    const creaseC = lin([18, 18, 22]);
    if (isHero) {
      part(B.paint, UNIT_BOX, mat4(-L * 0.31, 5.0, -(W / 2 + 0.30), 0, 8.5, 4.4, 0.9), dmgC);
      part(B.flat, UNIT_BOX, mat4(-L * 0.31, 6.6, -(W / 2 + 0.42), 0, 7.0, 0.7, 0.5), creaseC);
    } else {
      const side = hash01((car.id || 1) * 7.7) < 0.5 ? 1 : -1;
      part(B.paint, UNIT_BOX, mat4(L * 0.30, 5.0, side * (W / 2 + 0.30), 0, 8.5, 4.4, 0.9), dmgC);
      part(B.flat, UNIT_BOX, mat4(L * 0.30, 6.6, side * (W / 2 + 0.42), 0, 7.0, 0.7, 0.5), creaseC);
      if (ratio < 0.40) part(B.paint, UNIT_BOX, mat4(-L * 0.02, 4.6, side * (W / 2 + 0.26), 0, 7.5, 3.6, 0.7), lin(rgb(car.color).map((v) => v * 0.62)));
    }
  }
  if (!car.dead && ratio <= 0.22) {
    const bp = LP(L * 0.30, 0, 0);
    R.addGlow(bp[0], bp[1], 9.5, 9, lin([255, 110, 30]), 0.30);
    R.addGlow(bp[0], bp[1], 10.5, 6, lin([255, 140, 40]), 0.55);
    R.addGlow(bp[0], bp[1], 11, 3.4, lin([255, 205, 95]), 0.80);
    R.addGlow(bp[0] + 1.5, bp[1] - 1, 13.5, 4.2, lin([255, 150, 50]), 0.42);
    R.addSmoke(bp[0], bp[1], 16, 6.5, 0.32, 0.32);
    R.addSmoke(bp[0] + 3, bp[1] - 2, 21.5, 9.5, 0.24, 0.32);
    R.addSmoke(bp[0] + 5, bp[1] - 3, 28, 13, 0.15, 0.32);
  } else if (!car.dead && ratio < 0.40) {
    const hp0 = LP(L * 0.26, 0, 0);
    if (isHero) {
      R.addSmoke(hp0[0], hp0[1], 13.5, 5.5, 0.15, 0.45);
      R.addSmoke(hp0[0] + 2, hp0[1] - 1, 17.5, 8, 0.08, 0.45);
    } else {
      R.addSmoke(hp0[0], hp0[1], 14.5, 7.5, 0.26, 0.45);
      R.addSmoke(hp0[0] + 3, hp0[1] - 2, 19, 10.5, 0.18, 0.45);
      R.addSmoke(hp0[0] + 5, hp0[1] - 3, 24, 13.5, 0.11, 0.45);
    }
  }
  idState.cat = null;
}

export function buildVehicles(R, game) {
  const all = [];
  for (const car of game.traffic) all.push(car);
  for (const car of game.specials || []) all.push(car);
  for (const cop of game.police.cops) all.push(cop);
  if (game.markedCarRef && !all.includes(game.markedCarRef)) all.push(game.markedCarRef);
  for (const car of all) {
    if (game.debugHideHeroCar && car === R.F.heroCar) continue;
    buildCar(R, car);
  }
}

// ONE helicopter builder: a smooth police airframe — fuselage + glass
// nose, tail boom + fin, main and tail rotors, skid gear — staged only
// as game.stagedHeli (mission atmosphere; never a police.cops unit).
// Its searchlight is two nested translucent cones + landing discs.
export function buildHeli(R, heli) {
  const { B, F } = R;
  const dx = heli.x - F.cam[0], dy = heli.y - F.cam[1];
  if (dx * dx + dy * dy > 1250 * 1250) return;
  idState.cat = null;
  const yaw = heli.angle || 0, alt = heli.z || 120;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const LP = (lx, ly, lz) => [heli.x + lx * c - ly * s, heli.y + lx * s + ly * c, (lz || 0) + alt];
  const BODY = lin([44, 54, 72]), BODY_D = lin([30, 38, 52]), GLASS_C = lin([24, 33, 48]);
  const BAND = lin([214, 216, 220]), DARK = lin([20, 21, 26]);
  disc(B.alpha, heli.x, heli.y, 0.25, 27, [...lin([8, 8, 10]), 0.20]);
  const fb = LP(0, 0, 0);
  box(B.flat, fb[0], fb[1], fb[2], 12.5, 4.6, 3.8, yaw, BODY);
  const nose = LP(11.5, 0, -0.3);
  box(B.flat, nose[0], nose[1], nose[2], 4.2, 4.0, 3.3, yaw, BODY);
  const gl1 = LP(14.8, 0, 0.7);
  box(B.glasspaint, gl1[0], gl1[1], gl1[2], 2.0, 3.3, 2.3, yaw, GLASS_C);
  const band = LP(1.5, 0, 1.1);
  box(B.flat, band[0], band[1], band[2], 9.5, 4.75, 1.1, yaw, BAND);
  const deck = LP(-2, 0, 4.6);
  box(B.flat, deck[0], deck[1], deck[2], 6, 3.4, 1.2, yaw, BODY_D);
  const boom = LP(-19, 0, 1.1);
  box(B.flat, boom[0], boom[1], boom[2], 8.5, 1.6, 1.6, yaw, BODY);
  const fin = LP(-27.5, 0, 3.2);
  box(B.flat, fin[0], fin[1], fin[2], 1.3, 0.45, 3.4, yaw, BODY_D);
  const tr = LP(-27.5, 1.4, 3.2);
  box(B.flat, tr[0], tr[1], tr[2], 0.35, 0.5, 3.1, yaw, DARK);
  box(B.flat, tr[0], tr[1], tr[2], 3.1, 0.5, 0.35, yaw, DARK);
  const stab = LP(-24, 0, 0.6);
  box(B.flat, stab[0], stab[1], stab[2], 1.6, 5.2, 0.5, yaw, BODY_D);
  const mast = LP(-2, 0, 6.0);
  box(B.flat, mast[0], mast[1], mast[2], 1.0, 1.0, 1.5, yaw, DARK);
  const hub = LP(-2, 0, 7.3);
  box(B.flat, hub[0], hub[1], hub[2], 23, 1.05, 0.32, yaw + 0.7, DARK);
  box(B.flat, hub[0], hub[1], hub[2], 1.05, 23, 0.32, yaw + 0.7, DARK);
  disc(B.alpha, hub[0], hub[1], hub[2], 23.5, [...lin([196, 206, 216]), 0.13]);
  for (const sy of [1, -1]) {
    limb(B.flat, LP(9.5, sy * 5.6, -6.4), LP(-9.5, sy * 5.6, -6.4), 0.55, 0.55, DARK, 6);
    limb(B.flat, LP(6.5, sy * 3.4, -3.6), LP(6.5, sy * 5.6, -6.4), 0.45, 0.45, DARK, 5);
    limb(B.flat, LP(-6.5, sy * 3.4, -3.6), LP(-6.5, sy * 5.6, -6.4), 0.45, 0.45, DARK, 5);
  }
  const lamp = LP(4.5, 0, -4.3);
  box(B.basic, lamp[0], lamp[1], lamp[2], 1.5, 1.5, 1.0, yaw, lin([255, 240, 200]));
  R.addGlow(lamp[0], lamp[1], lamp[2], 6, lin([255, 240, 200]), 0.5);
  if (typeof heli.spotX === 'number') {
    const from = new THREE.Vector3(lamp[0], lamp[2], lamp[1]);
    const to = new THREE.Vector3(heli.spotX, 0.8, heli.spotY);
    const dir = from.clone().sub(to);
    const len = dir.length() || 1;
    dir.normalize();
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    for (const [rad, al] of [[15, 0.10], [8, 0.09]]) {
      const cone = new THREE.ConeGeometry(rad, 1, 18, 1, true);
      B.alpha.push(cone, new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, len, 1)), [...lin([255, 238, 196]), al]);
      cone.dispose();
    }
    disc(B.alpha, heli.spotX, heli.spotY, 0.58, 16, [...lin([255, 238, 196]), 0.30]);
    disc(B.alpha, heli.spotX, heli.spotY, 0.60, 8, [...lin([255, 246, 214]), 0.38]);
    R.addGlow(heli.spotX, heli.spotY, 5, 17, lin([255, 238, 196]), 0.45);
  }
  idState.cat = null;
}

// ONE scooter builder: a small step-through scooter (two wheels, leg
// shield, floorboard, seat, handlebar) staged as game.stagedScooter with
// a seated rider from figures3d's 'ride' pose. The seat top (z 7.0)
// meets the rider's standing hip height; the bar meets the ride hands.
export function buildScooter(R, sc) {
  const { B, F } = R;
  const dx = sc.x - F.cam[0], dy = sc.y - F.cam[1];
  if (dx * dx + dy * dy > 820 * 820) return;
  idState.cat = null;
  const a = sc.angle, c = Math.cos(a), s = Math.sin(a);
  const LP = (lx, ly, lz) => [sc.x + lx * c - ly * s, sc.y + lx * s + ly * c, lz];
  const body = lin(rgb(sc.color || '#3f7f8c'));
  const bodyTop = lin(rgb(sc.color || '#3f7f8c').map((v) => Math.min(255, v * 1.18)));
  const DARK = lin([26, 26, 30]), SEAT = lin([34, 32, 34]);
  disc(B.alpha, sc.x, sc.y, 0.22, 11, [...lin([8, 8, 10]), 0.30]);
  for (const wx of [8.2, -7.8]) {
    limb(B.tyre, LP(wx, -1.0, 2.3), LP(wx, 1.0, 2.3), 2.3, 2.3, lin(TYRE), 12);
    ball(B.chrome, ...LP(wx, 0, 2.3), 0.85, lin([172, 176, 184]));
  }
  const fb = LP(2.2, 0, 2.55); box(B.flat, fb[0], fb[1], fb[2], 2.6, 2.1, 0.35, a, DARK);
  const sh1 = LP(6.35, 0, 5.2); box(B.paint, sh1[0], sh1[1], sh1[2], 0.55, 2.15, 3.4, a, body);
  limb(B.flat, LP(6.3, 0, 8.2), LP(5.9, 0, 12.2), 0.45, 0.4, DARK, 6);
  const bar = LP(5.85, 0, 12.35); box(B.flat, bar[0], bar[1], bar[2], 0.35, 2.5, 0.35, a, DARK);
  limb(B.flat, LP(8.2, 0, 2.3), LP(6.6, 0, 9.0), 0.4, 0.35, DARK, 6);
  const fen = LP(8.2, 0, 4.9); box(B.paint, fen[0], fen[1], fen[2], 1.6, 1.9, 0.35, a, bodyTop);
  const lamp = LP(7.0, 0, 9.4); box(B.basic, lamp[0], lamp[1], lamp[2], 0.3, 0.9, 0.7, a, lin([255, 243, 190]));
  const seat = LP(-1.6, 0, 6.3); box(B.flat, seat[0], seat[1], seat[2], 2.9, 2.0, 0.7, a, SEAT);
  const rb = LP(-6.4, 0, 4.6); box(B.paint, rb[0], rb[1], rb[2], 2.6, 2.3, 1.9, a, body);
  const ut = LP(-6.6, 0, 2.4); box(B.flat, ut[0], ut[1], ut[2], 2.2, 1.9, 0.6, a, DARK);
  const tail = LP(-9.15, 0, 5.6); box(B.basic, tail[0], tail[1], tail[2], 0.3, 0.8, 0.6, a, lin([226, 36, 46]));
  idState.cat = null;
}
