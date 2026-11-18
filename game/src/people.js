// people.js — pedestrians who loop the sidewalks around blocks, flee danger, and can be harmed (which is a crime).
import { BLOCK_PITCH, ROAD_W, WORLD_SIZE } from './config.js';
import { dist } from './rng.js';
const SHIRTS = ['#7a6f5e', '#5e6e7a', '#6e5e6a', '#5a6e5a', '#77685a', '#5e5e72'];
let nextPedId = 1;
export function makePedestrians(rng, count) {
  const peds = [];
  for (let i = 0; i < count; i++) {
    const bx = rng.int(0, 7), by = rng.int(0, 7);
    peds.push({
      id: nextPedId++, bx, by, side: rng.int(0, 3), t: rng.range(0, 1),
      speed: rng.range(26, 44), dirSign: rng.chance(0.5) ? 1 : -1,
      x: 0, y: 0, angle: 0, shirt: rng.pick(SHIRTS), skin: '#d9b48f',
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
      ped.x = Math.max(8, Math.min(WORLD_SIZE - 8, ped.x));
      ped.y = Math.max(8, Math.min(WORLD_SIZE - 8, ped.y));
    }
    if (!fleeing) {
      const r = blockRect(ped.bx, ped.by);
      const span = (ped.side % 2 === 0) ? (r.x1 - r.x0) : (r.y1 - r.y0);
      ped.t += (ped.speed * ped.dirSign * dt) / Math.max(40, span);
      if (ped.t > 1) { ped.t = 0; ped.side = ped.dirSign > 0 ? (ped.side + 1) % 4 : (ped.side + 3) % 4; }
      if (ped.t < 0) { ped.t = 1; ped.side = ped.dirSign > 0 ? (ped.side + 3) % 4 : (ped.side + 1) % 4; }
      placePed(ped);
    }
  }
}
export function drawFigure(ctx, x, y, angle, shirt, skin, withGun) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(1, 2, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(angle);
  // Legs hint: two small dark marks behind the torso.
  ctx.fillStyle = '#2c2e33';
  ctx.fillRect(-6, -4, 4, 3); ctx.fillRect(-6, 1, 4, 3);
  // Torso: a rounded, tapered shape — never a plain box.
  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.moveTo(-5, -5.5);
  ctx.quadraticCurveTo(3, -6.5, 5, -3);
  ctx.quadraticCurveTo(7, 0, 5, 3);
  ctx.quadraticCurveTo(3, 6.5, -5, 5.5);
  ctx.quadraticCurveTo(-7, 0, -5, -5.5);
  ctx.closePath(); ctx.fill();
  // Head.
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(1, 0, 3.4, 0, Math.PI * 2); ctx.fill();
  if (withGun) {
    ctx.strokeStyle = '#c8c8cc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(4, 3); ctx.lineTo(12, 3); ctx.stroke();
  }
  ctx.restore();
}
