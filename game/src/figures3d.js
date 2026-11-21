// figures3d.js — TOTAL REBUILD Phase 1: the canonical smooth figure.
// One builder for player, crew and peds, rebuilt as smooth volumes —
// capsule limbs, sphere joints, ellipsoid torso/head, a close hair cap —
// on the PROVEN proportion contract, which does not move by a hair:
//   total head top 15.1, hair silhouette ≤ 15.45 (FIG_TOP),
//   hip at HIP_Z 7.6 → legs are 7.6 / 15.45 = 49.19% of height,
//   sedan roof 12.6 → figure/car ratio exactly 15.45 / 12.6 = 1.226.
// Pose joint positions are the standing ones (walk/run cycle, stand,
// flee, armsup, ride, down, dead), and the aim stance keeps its exact
// geometry: lean 1.5, two-handed shouldered gun, muzzle tip at
// lean + 15.2 forward / +0.28 lateral / SHO_Z + 0.42 — the point the
// staged tracers and qa/measure.mjs agree on.
import { PALETTE } from './config.js';
import { box, limb, capsule, ball, ellipsoid, disc, rgb, lin, idState } from './render3d.js';
import { buildScooter } from './vehicles3d.js';

export const FIG_H = 15.1;    // standing figure HEAD-TOP height, world units
export const FIG_TOP = 15.45; // hair silhouette top — the scale-audit anchor
export const HIP_Z = 7.6, SHO_Z = 13.1;

export function buildFigure(R, o) {
  const { B, F } = R;
  const dx = o.x - F.cam[0], dy = o.y - F.cam[1];
  if (dx * dx + dy * dy > 820 * 820) return;
  idState.cat = o.isPlayer ? 'fig' : null;
  const a = o.angle;
  const f = [Math.cos(a), Math.sin(a)], s = [-Math.sin(a), Math.cos(a)];
  const P = (fu, sv, z) => [o.x + f[0] * fu + s[0] * sv, o.y + f[1] * fu + s[1] * sv, z];
  disc(B.alpha, o.x, o.y, 0.22, 6.2, [...lin([8, 8, 10]), 0.30]);
  // Background peds (no tactical gear) get a value-contrast lift so the
  // shirt reads against the pants and the street at chase distance.
  const shirt = o.gear ? lin(o.shirt) : lin(o.shirt.map((v) => Math.min(255, v * 1.10 + 6)));
  const skin = lin(o.skin);
  const pants = o.gear ? lin(o.pants) : lin(o.pants.map((v) => v * 0.82));
  const hair = lin(o.hair);
  if (o.dead) {
    box(B.flat, o.x, o.y, 1.6, 8.6, 2.6, 1.6, a, shirt);
    const hc = P(10.4, 0, 1.4);
    ball(B.flat, hc[0], hc[1], hc[2], 1.45, skin);
    const hr = P(10.0, 0, 2.0);
    ball(B.flat, hr[0], hr[1], hr[2], 1.4, hair);
    idState.cat = null;
    return;
  }
  if (o.pose === 'down') {
    // Fallen figure: lying on its back along the facing axis, built from
    // the SAME segment lengths as the standing figure.
    for (const sideSign of [1, -1]) {
      const hipD = P(1.2, sideSign * 1.0, 1.15), kneeD = P(-3.4, sideSign * 1.05, 1.05), footD = P(-8.3, sideSign * 1.1, 0.9);
      capsule(B.flat, hipD, kneeD, 1.15, pants);
      ball(B.flat, kneeD[0], kneeD[1], kneeD[2], 1.0, pants);
      capsule(B.flat, kneeD, footD, 0.9, pants);
      ellipsoid(B.flat, footD[0] - f[0] * 0.7, footD[1] - f[1] * 0.7, 0.55, 1.6, 0.85, 0.55, a, lin([26, 22, 19]));
    }
    const torsoD = P(3.4, 0, 1.35);
    ellipsoid(B.flat, torsoD[0], torsoD[1], torsoD[2], 3.1, 1.95, 1.15, a, shirt);
    if (o.gear) { const vestD = P(3.6, 0, 2.3); box(B.flat, vestD[0], vestD[1], vestD[2], 2.2, 1.6, 0.35, a, lin([86, 93, 63])); }
    const headD = P(7.6, 0, 1.25);
    ball(B.flat, headD[0], headD[1], headD[2], 0.95, skin);
    const hairD = P(7.3, 0, 1.5);
    ball(B.flat, hairD[0], hairD[1], hairD[2], 1.0, hair);
    for (const sideSign of [1, -1]) {
      const shoD = P(5.6, sideSign * 1.9, 1.2), elbD = P(4.6, sideSign * 4.6, 0.95), handD = P(3.4, sideSign * 6.8, 0.8);
      capsule(B.flat, shoD, elbD, 0.72, shirt);
      capsule(B.flat, elbD, handD, 0.55, skin);
      ball(B.flat, handD[0], handD[1], handD[2], 0.52, skin);
    }
    idState.cat = null;
    return;
  }
  const pose = o.pose, ph = o.phase || 0;
  const lean = pose === 'flee' ? 2.8 : pose === 'run' ? 2.4 : pose === 'aim' ? 1.5 : pose === 'walk' ? 0.7 : pose === 'ride' ? 0.6 : 0;
  // Legs: thigh 3.89 + shin 3.71 (sum = HIP_Z), knee volume at the bend,
  // hip attachment at ±1.05, feet grounded at z 0.55.
  for (const sideSign of [1, -1]) {
    const hip = P(0, sideSign * 1.05, HIP_Z);
    let knee, foot;
    if (pose === 'walk' || pose === 'run') {
      const amp = pose === 'run' ? 0.82 : 0.52;
      const sw = Math.sin(ph + (sideSign > 0 ? 0 : Math.PI)) * amp;
      const sw2 = sw - (pose === 'run' ? 0.55 : 0.40);
      knee = P(Math.sin(sw) * 3.89, sideSign * 1.05, HIP_Z - Math.cos(sw) * 3.89);
      foot = P(Math.sin(sw) * 3.89 + Math.sin(sw2) * 3.71, sideSign * 1.05, Math.max(0.55, HIP_Z - Math.cos(sw) * 3.89 - Math.cos(sw2) * 3.71));
    } else if (pose === 'flee') {
      if (sideSign > 0) { knee = P(4.4, 1.02, HIP_Z - 3.1); foot = P(7.0, 1.05, 0.55); }
      else { knee = P(-3.6, -1.02, HIP_Z - 3.3); foot = P(-6.6, -1.05, 2.3); }
    } else if (pose === 'ride') {
      knee = P(3.5, sideSign * 1.05, HIP_Z - 0.7);
      foot = P(3.9, sideSign * 1.05, 3.4);
    } else if (pose === 'aim') {
      // Compact brace: front foot +5.66, back foot −4.95, lateral inside
      // the shoulder line, both soles flat on the ground.
      if (sideSign > 0) { knee = P(3.0, 1.1, HIP_Z - 3.71); foot = P(5.66, 1.22, 0.55); }
      else { knee = P(-2.3, -1.1, HIP_Z - 3.8); foot = P(-4.95, -1.22, 0.55); }
    } else {
      knee = P(0.3, sideSign * 1.05, HIP_Z - 3.89);
      foot = P(0.6, sideSign * 1.05, 0.55);
    }
    capsule(B.flat, hip, knee, 1.15, pants);
    ball(B.flat, knee[0], knee[1], knee[2], 1.0, pants);
    capsule(B.flat, knee, foot, 0.9, pants);
    // Shoe: an ellipsoid last elongated FORWARD of the ankle, sole at
    // z 0.55 in grounded poses.
    const shoeZ = pose === 'flee' || pose === 'ride' ? foot[2] : 0.55;
    ellipsoid(B.flat, foot[0] + f[0] * 1.05, foot[1] + f[1] * 1.05, shoeZ, 1.6, 0.85, 0.55, a, lin([26, 22, 19]));
  }
  // Torso: smooth volumes — pelvis ellipsoid, waist, chest ellipsoid at
  // SHO_Z; the pair leans with the pose. Spans are the slimmed standing
  // ones (chest lateral 4.0, depth 2.6; pelvis 3.6) as radii ×2.
  const hipC = P(0, 0, HIP_Z + 0.3);
  ellipsoid(B.flat, hipC[0], hipC[1], HIP_Z + 0.9, 1.3, 1.8, 1.35, a, pants);
  const chestZ = SHO_Z - 1.35, chestP = P(lean * 0.82, 0, chestZ);
  ellipsoid(B.flat, chestP[0], chestP[1], chestZ, 1.3, 2.0, 1.55, a, shirt);
  const waistP = P(lean * 0.4, 0, HIP_Z + 2.6);
  ellipsoid(B.flat, waistP[0], waistP[1], HIP_Z + 2.6, 1.22, 1.75, 1.2, a, shirt);
  // Clothing read: a lighter chest panel + a dark belt line (ungeared).
  if (!o.gear) {
    const panelP = P(lean * 0.82 + 1.34, 0, chestZ + 0.1);
    box(B.flat, panelP[0], panelP[1], panelP[2], 0.16, 1.5, 1.2, a, lin(o.shirt.map((v) => Math.min(255, v * 1.14 + 8))));
  }
  const beltP = P(lean * 0.35, 0, HIP_Z + 1.5);
  box(B.flat, beltP[0], beltP[1], beltP[2], 1.3, 1.86, 0.3, a, lin([30, 28, 30]));
  // Modular tactical gear (player + crew only).
  if (o.gear) {
    const OLIVE = lin([86, 93, 63]), OLIVE_D = lin([57, 64, 45]), KHAKI = lin([139, 138, 103]);
    const midZ = (HIP_Z + SHO_Z) / 2, midLean = lean * 0.55;
    const vf = P(midLean + 1.78, 0, midZ), vb = P(midLean - 1.78, 0, midZ);
    box(B.flat, vf[0], vf[1], vf[2], 0.30, 1.55, 1.85, a, OLIVE);
    box(B.flat, vb[0], vb[1], vb[2], 0.30, 1.55, 1.85, a, OLIVE);
    for (const px of [-1.05, 0, 1.05]) {
      const pp = P(midLean + 2.16, px, HIP_Z + 1.6);
      box(B.flat, pp[0], pp[1], pp[2], 0.34, 0.5, 0.7, a, KHAKI);
    }
    for (const sx of [1, -1]) {
      const st = P(lean * 0.85, sx * 1.35, SHO_Z - 0.3);
      box(B.flat, st[0], st[1], st[2], 1.7, 0.42, 0.28, a, OLIVE_D);
      const pd = P(lean, sx * 2.22, SHO_Z - 0.1);
      box(B.flat, pd[0], pd[1], pd[2], 1.5, 0.82, 0.48, a, lin(o.shirt.map((v) => v * 0.62)));
    }
    if (pose !== 'aim') {
      const sg = P(-2.3, 0, (HIP_Z + SHO_Z) / 2 + 0.5);
      box(B.flat, sg[0], sg[1], sg[2], 0.42, 0.52, (SHO_Z - HIP_Z) / 2 + 0.5, a, lin([37, 39, 45]));
    }
  }
  // Neck + shaped head: a short neck, a cranium ellipsoid (top exactly
  // 15.10), a jaw step, a lighter face plane, a small nose, and hair as
  // a CLOSE CAP — an ellipsoid seated back on the crown (silhouette top
  // 15.44 ≤ 15.45) plus back/side panels. No spikes.
  capsule(B.flat, P(lean, 0, SHO_Z - 0.2), P(lean + 0.12, 0, SHO_Z + 0.62), 0.55, skin);
  const headC = P(lean + 0.25, 0, 14.28);
  ellipsoid(B.flat, headC[0], headC[1], headC[2], 1.18, 1.08, 0.82, a, skin);
  const jawP = P(lean + 0.31, 0, 13.28);
  ellipsoid(B.flat, jawP[0], jawP[1], jawP[2], 0.98, 0.88, 0.28, a, skin);
  const faceP = P(lean + 0.25 + 1.2, 0, 13.95);
  box(B.flat, faceP[0], faceP[1], faceP[2], 0.14, 0.72, 0.52, a, lin(o.skin.map((v) => Math.min(255, v * 1.07 + 5))));
  const noseP = P(lean + 0.25 + 1.42, 0, 13.9);
  box(B.flat, noseP[0], noseP[1], noseP[2], 0.14, 0.16, 0.26, a, lin(o.skin.map((v) => v * 0.92)));
  if (o.gear) {
    const bandP = P(lean + 0.25 + 1.27, 0, 14.3);
    box(B.flat, bandP[0], bandP[1], bandP[2], 0.12, 0.95, 0.28, a, lin([24, 24, 28]));
  } else {
    for (const sx of [1, -1]) {
      const ep = P(lean + 0.25 + 1.36, sx * 0.42, 14.28);
      box(B.flat, ep[0], ep[1], ep[2], 0.08, 0.22, 0.3, a, lin([30, 26, 30]));
    }
  }
  const capC = P(lean - 0.05, 0, 14.44);
  ellipsoid(B.flat, capC[0], capC[1], capC[2], 1.02, 1.08, 1.0, a, hair);
  const backP = P(lean + 0.25 - 1.15, 0, 14.0);
  box(B.flat, backP[0], backP[1], backP[2], 0.3, 1.0, 0.8, a, hair);
  for (const sx of [1, -1]) {
    const lk = P(lean + 0.18, sx * 1.02, 14.15);
    box(B.flat, lk[0], lk[1], lk[2], 0.95, 0.2, 0.6, a, hair);
  }
  // Arms: upper 3.5 + forearm 3.3 as capsules, elbow volume at the bend,
  // ball hands.
  for (const sideSign of [1, -1]) {
    const sho = P(lean, sideSign * 2.02, SHO_Z - 0.2);
    let elbow, hand;
    if (pose === 'aim') {
      if (sideSign > 0) { elbow = P(lean + 1.0, 2.1, SHO_Z - 1.9); hand = P(lean + 4.4, 0.55, SHO_Z - 0.2); }
      else { elbow = P(lean + 4.6, -1.8, SHO_Z - 1.5); hand = P(lean + 7.6, 0.25, SHO_Z + 0.1); }
    } else if (pose === 'walk' || pose === 'run') {
      const amp = pose === 'run' ? 0.78 : 0.44;
      const sw = Math.sin(ph + (sideSign > 0 ? Math.PI : 0)) * amp;
      elbow = P(lean + Math.sin(sw) * 3.5, sideSign * 2.2, SHO_Z - 0.2 - Math.cos(sw) * 3.5);
      const sw2 = sw * 0.7 - 0.32;
      hand = P(lean + Math.sin(sw) * 3.5 + Math.sin(sw2) * 3.3, sideSign * 2.2, SHO_Z - 0.2 - Math.cos(sw) * 3.5 - Math.cos(sw2) * 3.3);
    } else if (pose === 'armsup') {
      elbow = P(lean + 0.7, sideSign * 3.05, SHO_Z + 2.4);
      hand = P(lean + 1.0, sideSign * 3.7, SHO_Z + 5.4);
    } else if (pose === 'flee') {
      elbow = P(lean - 2.4, sideSign * 2.25, SHO_Z - 2.4);
      hand = P(lean - 4.8, sideSign * 2.15, SHO_Z - 4.0);
    } else if (pose === 'ride') {
      elbow = P(lean + 3.2, sideSign * 2.15, SHO_Z - 1.6);
      hand = P(lean + 6.4, sideSign * 1.55, SHO_Z - 0.4);
    } else {
      elbow = P(lean + 0.5, sideSign * 2.2, SHO_Z - 3.7);
      hand = P(lean + 1.2, sideSign * 2.12, SHO_Z - 6.9);
    }
    capsule(B.flat, sho, elbow, 0.72, shirt);
    ball(B.flat, elbow[0], elbow[1], elbow[2], 0.64, shirt);
    capsule(B.flat, elbow, hand, 0.55, skin);
    ball(B.flat, hand[0], hand[1], hand[2], 0.52, skin);
    if (pose === 'aim' && sideSign > 0) {
      // TWO-HANDED FIREARM: stock, receiver, grip, magazine, handguard,
      // barrel and sights. INVARIANT: the muzzle tip stays EXACTLY at
      // lean + 15.2 fwd / +0.28 lat / SHO_Z + 0.42.
      const GUN = lin([37, 39, 45]), GUN_TIP = lin([52, 55, 63]);
      const stock = P(lean + 0.9, 0.5, SHO_Z + 0.2);
      box(B.flat, stock[0], stock[1], stock[2], 1.6, 0.52, 0.92, a, GUN);
      const recv = P(lean + 4.3, 0.38, SHO_Z + 0.35);
      box(B.flat, recv[0], recv[1], recv[2], 2.1, 0.55, 0.62, a, GUN);
      const grip = P(lean + 3.0, 0.45, SHO_Z - 0.72);
      box(B.flat, grip[0], grip[1], grip[2], 0.42, 0.4, 0.68, a, GUN);
      const mag = P(lean + 5.6, 0.36, SHO_Z - 1.12);
      box(B.flat, mag[0], mag[1], mag[2], 0.55, 0.42, 1.02, a, GUN);
      const fore = P(lean + 8.3, 0.32, SHO_Z + 0.35);
      box(B.flat, fore[0], fore[1], fore[2], 1.9, 0.48, 0.5, a, GUN);
      limb(B.flat, P(lean + 10.2, 0.3, SHO_Z + 0.38), P(lean + 14.6, 0.28, SHO_Z + 0.4), 0.3, 0.26, GUN, 6);
      limb(B.flat, P(lean + 14.6, 0.28, SHO_Z + 0.4), P(lean + 15.2, 0.28, SHO_Z + 0.42), 0.42, 0.38, GUN_TIP, 6);
      const rs = P(lean + 4.6, 0.34, SHO_Z + 1.12);
      box(B.flat, rs[0], rs[1], rs[2], 0.8, 0.36, 0.38, a, GUN_TIP);
      const fs = P(lean + 11.8, 0.3, SHO_Z + 0.95);
      box(B.flat, fs[0], fs[1], fs[2], 0.3, 0.22, 0.32, a, GUN_TIP);
    }
  }
  idState.cat = null;
}

export function buildFigures(R, game) {
  for (const ped of game.peds) {
    const fleeing = ped.fleeUntil && game.nowMs < ped.fleeUntil;
    buildFigure(R, {
      x: ped.x, y: ped.y, angle: ped.angle, phase: ped.walkPhase || 0,
      pose: ped.pose || (ped.dead ? 'stand' : fleeing ? 'run' : 'walk'), dead: !!ped.dead,
      shirt: rgb(ped.shirt), skin: rgb(ped.skin || '#d9b48f'), pants: rgb(ped.pants || '#2e3440'),
      hair: rgb(ped.hairColor || '#2b2118'), isPlayer: false, gear: false,
    });
  }
  if (game.stagedScooter) {
    const sc = game.stagedScooter, rd = sc.rider || {};
    buildScooter(R, sc);
    buildFigure(R, {
      x: sc.x, y: sc.y, angle: sc.angle, phase: 0,
      pose: 'ride', dead: false,
      shirt: rgb(rd.shirt || '#c94f38'), skin: rgb(rd.skin || '#8a5a34'), pants: rgb(rd.pants || '#2e3440'),
      hair: rgb(rd.hair || '#17171a'), isPlayer: false, gear: false,
    });
  }
  if (game.crewMate && !game.player.inCar) {
    const cm = game.crewMate;
    buildFigure(R, {
      x: cm.x, y: cm.y, angle: cm.angle, phase: cm.walkPhase || 0,
      pose: cm.pose || 'walk', dead: false,
      shirt: rgb(cm.color || '#e8c832'), skin: rgb('#d9b48f'), pants: [40, 38, 44],
      hair: [56, 38, 22], isPlayer: false, gear: true,
    });
  }
  if (!game.player.inCar && !game.debugHidePlayer) {
    const p = game.player;
    const aiming = (game.bullets && game.bullets.length > 0) || (game.lastShotAt && game.nowMs - game.lastShotAt < 700);
    const moving = Math.abs(p.vx || 0) + Math.abs(p.vy || 0) > 4;
    buildFigure(R, {
      x: p.x, y: p.y, angle: p.angle, phase: p.walkPhase || 0,
      pose: aiming ? 'aim' : moving ? 'walk' : 'stand', dead: false,
      shirt: rgb(PALETTE.playerShirt), skin: rgb(PALETTE.playerSkin), pants: [46, 52, 64],
      hair: [92, 60, 32], isPlayer: true, gear: true,
    });
  }
}
