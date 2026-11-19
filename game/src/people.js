// people.js — pedestrians who loop the sidewalks around blocks, flee danger, and can be harmed (which is a crime).
// Figures are drawn as upright people anchored at their feet (x, y is the ground point), the classic
// open-world read in a top-down world: legs, torso, arms and a haired head, about 26 world units tall —
// clearly smaller than a car (38–44). Walk cycles are driven by a per-character phase and a seeded gait.
import { BLOCK_PITCH, ROAD_W, WORLD_SIZE } from './config.js';
import { dist } from './rng.js';
const SHIRTS = ['#c98a5e', '#7fa3a8', '#c48a9a', '#8aa87a', '#d9b48a', '#8a90b8'];
const HAIR_COLORS = ['#2b2118', '#3d2c1c', '#17171a', '#5a4632', '#77716a', '#41303e'];
const PANTS_COLORS = ['#2e3440', '#3a332a', '#2c3a34', '#40303a', '#333338', '#31404e'];
export const GAITS = {
  relaxed: { freq: 5.4, swing: 0.85, bob: 0.7, lean: 0.05, arm: 0.7 },
  upright: { freq: 6.4, swing: 0.9, bob: 0.5, lean: -0.02, arm: 0.55 },
  bouncy: { freq: 8.2, swing: 1.0, bob: 1.5, lean: 0.07, arm: 0.9 },
  dragging: { freq: 4.1, swing: 0.55, bob: 0.3, lean: 0.16, arm: 0.4 },
};
const GAIT_NAMES = Object.keys(GAITS);
let nextPedId = 1;
export function makePedestrians(rng, count) {
  const peds = [];
  for (let i = 0; i < count; i++) {
    const bx = rng.int(0, 7), by = rng.int(0, 7);
    const phase = rng.range(0, Math.PI * 2);
    peds.push({
      id: nextPedId++, bx, by, side: rng.int(0, 3), t: rng.range(0, 1),
      speed: rng.range(26, 44), dirSign: rng.chance(0.5) ? 1 : -1,
      x: 0, y: 0, angle: 0, shirt: rng.pick(SHIRTS), skin: '#d9b48f',
      hairColor: rng.pick(HAIR_COLORS), hairStyle: rng.int(0, 2),
      pants: rng.pick(PANTS_COLORS), gait: rng.pick(GAIT_NAMES),
      phase, walkPhase: phase,
      fleeUntil: 0, fleeX: 0, fleeY: 0, dead: false, respawnAt: 0,
    });
    placePed(peds[peds.length - 1]);
  }
  return peds;
}
function blockRect(bx, by) {
  // The sidewalk ring hugs the block's outer edge: just inside the road, just outside every building plot.
  const x0 = bx * BLOCK_PITCH + ROAD_W + 4, y0 = by * BLOCK_PITCH + ROAD_W + 4;
  const x1 = (bx + 1) * BLOCK_PITCH - 4, y1 = (by + 1) * BLOCK_PITCH - 4;
  return { x0, y0, x1, y1 };
}
export function placePed(ped) {
  const r = blockRect(ped.bx, ped.by);
  const spanX = r.x1 - r.x0, spanY = r.y1 - r.y0;
  if (ped.side === 0) { ped.x = r.x0 + ped.t * spanX; ped.y = r.y0; ped.angle = ped.dirSign > 0 ? 0 : Math.PI; }
  if (ped.side === 1) { ped.x = r.x1; ped.y = r.y0 + ped.t * spanY; ped.angle = ped.dirSign > 0 ? Math.PI / 2 : -Math.PI / 2; }
  if (ped.side === 2) { ped.x = r.x1 - ped.t * spanX; ped.y = r.y1; ped.angle = ped.dirSign > 0 ? Math.PI : 0; }
  if (ped.side === 3) { ped.x = r.x0; ped.y = r.y1 - ped.t * spanY; ped.angle = ped.dirSign > 0 ? -Math.PI / 2 : Math.PI / 2; }
}
export function updatePedestrians(peds, dt, now, danger) {
  for (const ped of peds) {
    if (ped.dead) {
      if (now > ped.respawnAt) { ped.dead = false; ped.t = 0.2; placePed(ped); }
      continue;
    }
    const gait = GAITS[ped.gait] || GAITS.relaxed;
    // Flee from a nearby danger source.
    let fleeing = false;
    if (danger) {
      for (const src of danger) {
        if (dist(ped.x, ped.y, src.x, src.y) < src.r) { ped.fleeUntil = now + 1600; ped.fleeX = src.x; ped.fleeY = src.y; }
      }
    }
    if (now < ped.fleeUntil) {
      fleeing = true;
      const a = Math.atan2(ped.y - ped.fleeY, ped.x - ped.fleeX);
      ped.x += Math.cos(a) * 118 * dt; ped.y += Math.sin(a) * 118 * dt;
      ped.angle = a;
      ped.walkPhase += dt * gait.freq * (118 / 38) * 0.62;
      ped.x = Math.max(8, Math.min(WORLD_SIZE - 8, ped.x));
      ped.y = Math.max(8, Math.min(WORLD_SIZE - 8, ped.y));
    }
    if (!fleeing) {
      ped.walkPhase += dt * gait.freq * (ped.speed / 38);
      const r = blockRect(ped.bx, ped.by);
      const span = (ped.side % 2 === 0) ? (r.x1 - r.x0) : (r.y1 - r.y0);
      ped.t += (ped.speed * ped.dirSign * dt) / Math.max(40, span);
      if (ped.t > 1) { ped.t = 0; ped.side = ped.dirSign > 0 ? (ped.side + 1) % 4 : (ped.side + 3) % 4; }
      if (ped.t < 0) { ped.t = 1; ped.side = ped.dirSign > 0 ? (ped.side + 3) % 4 : (ped.side + 1) % 4; }
      placePed(ped);
    }
  }
}
// ---- Upright figure renderer -------------------------------------------------
// Local space: origin at the feet, up is -y, total height ~26 * scale.
function limb(ctx, x0, y0, x1, y1, x2, y2, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}
function shoe(ctx, fx, fy, dirX, s) {
  // Shoe pointing along dirX (side view) or straight down-screen (front/back): sole, upper, two lace ticks.
  ctx.fillStyle = '#1d1d21';
  ctx.beginPath(); ctx.ellipse(fx + dirX * 1.1 * s, fy - 0.6 * s, 2.6 * s, 1.25 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(230,228,220,0.5)'; ctx.lineWidth = 0.55 * s;
  ctx.beginPath(); ctx.moveTo(fx - 1.6 * s, fy + 0.45 * s); ctx.lineTo(fx + dirX * 2.6 * s, fy + 0.45 * s); ctx.stroke();
  ctx.strokeStyle = 'rgba(230,228,220,0.65)';
  ctx.beginPath();
  ctx.moveTo(fx + dirX * 0.4 * s - 0.5 * s, fy - 1.5 * s); ctx.lineTo(fx + dirX * 0.4 * s + 0.3 * s, fy - 0.7 * s);
  ctx.moveTo(fx + dirX * 1.2 * s - 0.5 * s, fy - 1.4 * s); ctx.lineTo(fx + dirX * 1.2 * s + 0.3 * s, fy - 0.6 * s);
  ctx.stroke();
}
function drawFallen(ctx, shirt, skin, hair, pants, s) {
  // A body lying on the ground, stretched along the facing direction (already rotated by the caller).
  ctx.fillStyle = pants;
  ctx.beginPath(); ctx.ellipse(-6.5 * s, 0, 5.5 * s, 2.1 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shirt;
  ctx.beginPath(); ctx.ellipse(1.5 * s, 0, 5.8 * s, 2.7 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = shirt; ctx.lineWidth = 2 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(3 * s, 1.4 * s); ctx.lineTo(6.5 * s, 4.6 * s); ctx.stroke();
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(9.6 * s, 0, 3.1 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.arc(10.4 * s, -0.4 * s, 3.0 * s, Math.PI * 0.6, Math.PI * 1.9); ctx.fill();
  ctx.fillStyle = '#1d1d21';
  ctx.beginPath(); ctx.ellipse(-12.4 * s, -1 * s, 2.2 * s, 1.1 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-12.4 * s, 1.4 * s, 2.2 * s, 1.1 * s, 0, 0, Math.PI * 2); ctx.fill();
}
export function drawFigure(ctx, x, y, angle, shirt, skin, withGun, opts) {
  const o = opts || {};
  const s = o.scale || 1;
  const phase = o.phase || 0;
  const gait = GAITS[o.gait] || GAITS.relaxed;
  const hair = o.hairColor || '#2b2118';
  const hairStyle = o.hairStyle || 0;
  const pants = o.pants || '#2e3440';
  ctx.save();
  ctx.translate(x, y);
  // Soft ground shadow at the feet, always in world orientation.
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.beginPath(); ctx.ellipse(0, 1.2 * s, (o.dead ? 13 : 6.8) * s, 2.6 * s, 0, 0, Math.PI * 2); ctx.fill();
  if (o.dead) {
    ctx.save(); ctx.rotate(angle); drawFallen(ctx, shirt, skin, hair, pants, s); ctx.restore();
    ctx.restore();
    return;
  }
  const swing = (o.idle ? 0.25 : 1) * gait.swing;
  const stride = Math.sin(phase) * 4.3 * swing * s;
  const liftA = Math.max(0, Math.cos(phase)) * 1.5 * swing * s;
  const liftB = Math.max(0, -Math.cos(phase)) * 1.5 * swing * s;
  const bob = o.idle ? 0 : Math.abs(Math.sin(phase)) * gait.bob * s;
  const hipY = -10.6 * s;
  const shoulderY = -19.2 * s - bob;
  const headCY = -23.4 * s - bob;
  const leanX = gait.lean * 12 * s;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  let view = 'side';
  if (sinA > 0.45) view = 'front'; else if (sinA < -0.45) view = 'back';
  if (view === 'side') {
    const flip = cosA < 0 ? -1 : 1;
    ctx.scale(flip, 1);
    // Legs: hip -> knee -> foot, opposite swings; the far leg is shaded darker.
    const hipX = leanX * 0.4;
    limb(ctx, hipX, hipY, hipX + stride * 0.45 + 1.1 * s, hipY * 0.52, stride, -liftA, pants, 2.9 * s);
    limb(ctx, hipX, hipY, hipX - stride * 0.45 + 1.1 * s, hipY * 0.52, -stride, -liftB, pants, 2.9 * s);
    ctx.strokeStyle = 'rgba(255,255,255,0.20)'; ctx.lineWidth = 0.6 * s;
    ctx.beginPath(); ctx.moveTo(hipX + 0.5 * s, hipY + 1 * s); ctx.lineTo(hipX + stride * 0.5, hipY * 0.45); ctx.stroke();
    shoe(ctx, stride, -liftA, 1, s);
    shoe(ctx, -stride, -liftB, 1, s);
    // Far arm (behind the torso), swinging against the near leg.
    const armSwingFar = Math.sin(phase) * 2.6 * gait.arm * swing * s;
    limb(ctx, leanX, shoulderY + 0.8 * s, leanX + 1.2 * s, -14.4 * s - bob, leanX + armSwingFar, -10.2 * s - bob * 0.4, shirt, 2.2 * s);
    // Torso: tapered, rounded — shoulders forward of the hips by the gait's lean.
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.moveTo(hipX - 2.5 * s, hipY + 0.6 * s);
    ctx.quadraticCurveTo(leanX - 2.9 * s, (hipY + shoulderY) / 2, leanX - 2.2 * s, shoulderY);
    ctx.quadraticCurveTo(leanX, shoulderY - 1.5 * s, leanX + 2.6 * s, shoulderY + 0.4 * s);
    ctx.quadraticCurveTo(leanX + 3.1 * s, (hipY + shoulderY) / 2, hipX + 2.5 * s, hipY + 0.6 * s);
    ctx.quadraticCurveTo(hipX, hipY + 1.7 * s, hipX - 2.5 * s, hipY + 0.6 * s);
    ctx.closePath(); ctx.fill();
    // Clothing folds + warm rim light on the chest edge.
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.65 * s;
    ctx.beginPath(); ctx.moveTo(leanX - 0.6 * s, shoulderY + 2.6 * s); ctx.quadraticCurveTo(leanX + 0.7 * s, -15.6 * s - bob, leanX - 0.2 * s, hipY - 1.4 * s); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,196,130,0.6)';
    ctx.beginPath(); ctx.moveTo(leanX + 2.6 * s, shoulderY + 0.4 * s); ctx.quadraticCurveTo(leanX + 3.1 * s, (hipY + shoulderY) / 2, hipX + 2.5 * s, hipY + 0.6 * s); ctx.stroke();
    // Near arm: hangs and swings against the same-side leg — or levels the gun.
    if (withGun) {
      limb(ctx, leanX + 0.6 * s, shoulderY + 0.8 * s, leanX + 4.6 * s, shoulderY + 1.6 * s, leanX + 7.6 * s, shoulderY + 1.8 * s, shirt, 2.3 * s);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(leanX + 7.8 * s, shoulderY + 1.8 * s, 1.25 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#17181c'; ctx.lineWidth = 1.9 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(leanX + 7.4 * s, shoulderY + 1.8 * s); ctx.lineTo(leanX + 12.6 * s, shoulderY + 1.6 * s); ctx.stroke();
      ctx.fillStyle = '#3c3f46'; ctx.fillRect(leanX + 8.2 * s, shoulderY + 2.6 * s, 1.7 * s, 2.2 * s);
    } else {
      const armSwing = Math.sin(phase + Math.PI) * 2.9 * gait.arm * swing * s;
      limb(ctx, leanX + 0.4 * s, shoulderY + 0.8 * s, leanX + 1.5 * s, -14.2 * s - bob, leanX + armSwing, -9.8 * s - bob * 0.4, shirt, 2.3 * s);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(leanX + armSwing, -9.6 * s - bob * 0.4, 1.2 * s, 0, Math.PI * 2); ctx.fill();
    }
    // Chin shadow, head in profile, hair mass with a strand, one eye with a highlight.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(leanX + 0.6 * s, shoulderY + 0.6 * s, 2.5 * s, 1.1 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(leanX + 0.7 * s, headCY, 3.35 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hair;
    ctx.beginPath(); ctx.arc(leanX + 0.35 * s, headCY - 0.55 * s, 3.4 * s, Math.PI * 0.82, Math.PI * 2.02); ctx.fill();
    if (hairStyle === 1) { ctx.fillRect(leanX - 2.9 * s, headCY - 1.2 * s, 1.5 * s, 4.6 * s); }
    if (hairStyle !== 2) {
      ctx.strokeStyle = hair; ctx.lineWidth = 0.7 * s;
      ctx.beginPath(); ctx.moveTo(leanX - 1.4 * s, headCY - 3.1 * s); ctx.quadraticCurveTo(leanX - 0.4 * s, headCY - 1.8 * s, leanX - 1.1 * s, headCY - 0.6 * s); ctx.stroke();
    }
    ctx.fillStyle = '#221a14';
    ctx.beginPath(); ctx.arc(leanX + 2.6 * s, headCY + 0.1 * s, 0.52 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(leanX + 2.75 * s, headCY - 0.12 * s, 0.2 * s, 0, Math.PI * 2); ctx.fill();
  } else {
    // Front or back view: legs side by side with alternating lift, arms at the sides.
    const front = view === 'front';
    limb(ctx, -1.9 * s, hipY, -2.3 * s, hipY * 0.52, -2.5 * s, -liftA, pants, 2.9 * s);
    limb(ctx, 1.9 * s, hipY, 2.3 * s, hipY * 0.52, 2.5 * s, -liftB, pants, 2.9 * s);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.6 * s;
    ctx.beginPath(); ctx.moveTo(-1.7 * s, hipY + 1 * s); ctx.lineTo(-2.2 * s, hipY * 0.45); ctx.stroke();
    shoe(ctx, -2.5 * s, -liftA, 0.35, s);
    shoe(ctx, 2.5 * s, -liftB, 0.35, s);
    // Arms swing opposite to the same-side leg (shown as hand height).
    const handLA = Math.sin(phase + Math.PI) * 1.5 * gait.arm * swing * s;
    const handRA = Math.sin(phase) * 1.5 * gait.arm * swing * s;
    limb(ctx, -3.9 * s, shoulderY + 0.7 * s, -5.1 * s, -14.4 * s - bob, -5.2 * s, -10.4 * s - bob * 0.4 + handLA, shirt, 2.2 * s);
    if (withGun && front) {
      limb(ctx, 3.9 * s, shoulderY + 0.7 * s, 6.4 * s, -15.4 * s - bob, 8.6 * s, -14.6 * s - bob, shirt, 2.3 * s);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(8.8 * s, -14.6 * s - bob, 1.25 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#17181c'; ctx.lineWidth = 1.9 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(8.4 * s, -14.6 * s - bob); ctx.lineTo(12.8 * s, -14.2 * s - bob); ctx.stroke();
    } else {
      limb(ctx, 3.9 * s, shoulderY + 0.7 * s, 5.1 * s, -14.4 * s - bob, 5.2 * s, -10.4 * s - bob * 0.4 + handRA, shirt, 2.2 * s);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(5.2 * s, -10.2 * s - bob * 0.4 + handRA, 1.2 * s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(-5.2 * s, -10.2 * s - bob * 0.4 + handLA, 1.2 * s, 0, Math.PI * 2); ctx.fill();
    // Torso: wider than the side view, tapered to the waist.
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.moveTo(-2.9 * s, hipY + 0.6 * s);
    ctx.quadraticCurveTo(-4.6 * s, (hipY + shoulderY) / 2, -4.2 * s, shoulderY);
    ctx.quadraticCurveTo(0, shoulderY - 1.6 * s, 4.2 * s, shoulderY);
    ctx.quadraticCurveTo(4.6 * s, (hipY + shoulderY) / 2, 2.9 * s, hipY + 0.6 * s);
    ctx.quadraticCurveTo(0, hipY + 1.8 * s, -2.9 * s, hipY + 0.6 * s);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.65 * s;
    ctx.beginPath(); ctx.moveTo(-1.8 * s, shoulderY + 2.4 * s); ctx.quadraticCurveTo(-1.1 * s, -15.4 * s - bob, -1.6 * s, hipY - 1.2 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2 * s, shoulderY + 2.2 * s); ctx.quadraticCurveTo(1.4 * s, -15.8 * s - bob, 1.9 * s, hipY - 1.6 * s); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,196,130,0.55)';
    ctx.beginPath(); ctx.moveTo(4.2 * s, shoulderY + 0.4 * s); ctx.quadraticCurveTo(4.6 * s, (hipY + shoulderY) / 2, 2.9 * s, hipY + 0.4 * s); ctx.stroke();
    // Chin shadow and head. Front: face with eyes, highlights and eyelids. Back: hair covers the face.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, shoulderY + 0.7 * s, 2.7 * s, 1.1 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(0, headCY, 3.4 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hair;
    if (front) {
      ctx.beginPath(); ctx.arc(0, headCY - 0.7 * s, 3.45 * s, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
      if (hairStyle === 1) { ctx.fillRect(-3.6 * s, headCY - 1.6 * s, 1.5 * s, 5 * s); ctx.fillRect(2.1 * s, headCY - 1.6 * s, 1.5 * s, 5 * s); }
      if (hairStyle !== 2) {
        ctx.strokeStyle = hair; ctx.lineWidth = 0.7 * s;
        ctx.beginPath(); ctx.moveTo(-0.8 * s, headCY - 3.3 * s); ctx.quadraticCurveTo(0.1 * s, headCY - 2 * s, -0.5 * s, headCY - 1.1 * s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(1.5 * s, headCY - 3.1 * s); ctx.quadraticCurveTo(2 * s, headCY - 2 * s, 1.6 * s, headCY - 1.2 * s); ctx.stroke();
      }
      ctx.fillStyle = '#221a14';
      ctx.beginPath(); ctx.arc(-1.3 * s, headCY + 0.25 * s, 0.52 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(1.3 * s, headCY + 0.25 * s, 0.52 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(-1.15 * s, headCY + 0.05 * s, 0.2 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(1.45 * s, headCY + 0.05 * s, 0.2 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(34,26,20,0.7)'; ctx.lineWidth = 0.55 * s;
      ctx.beginPath(); ctx.moveTo(-1.95 * s, headCY - 0.55 * s); ctx.lineTo(-0.65 * s, headCY - 0.55 * s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.65 * s, headCY - 0.55 * s); ctx.lineTo(1.95 * s, headCY - 0.55 * s); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(0, headCY - 0.15 * s, 3.5 * s, 0, Math.PI * 2); ctx.fill();
      if (hairStyle === 1) { ctx.fillRect(-3.2 * s, headCY - 0.6 * s, 6.4 * s, 3.4 * s); }
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.7 * s;
      ctx.beginPath(); ctx.moveTo(-1.2 * s, headCY - 3.2 * s); ctx.quadraticCurveTo(-0.8 * s, headCY - 1 * s, -1.3 * s, headCY + 0.8 * s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(1.1 * s, headCY - 3.3 * s); ctx.quadraticCurveTo(1.5 * s, headCY - 1 * s, 1 * s, headCY + 0.9 * s); ctx.stroke();
    }
  }
  ctx.restore();
}
