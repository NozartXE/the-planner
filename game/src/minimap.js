// minimap.js — the corner minimap: roads, water, target, getaway, police,
// crew, activity blips and the player's heading wedge.
import { WORLD_W, WORLD_H, RIVER_Y } from './config.js';
import { AVENUES, STREETS } from './city.js';

export const MM = { w: 232, h: 174, pad: 14 };

export function drawMinimap(ctx, world, x, y) {
  const sx = MM.w / WORLD_W, sy = MM.h / WORLD_H;
  ctx.save();
  ctx.fillStyle = 'rgba(12,16,28,0.88)';
  ctx.fillRect(x, y, MM.w, MM.h);
  ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 2; ctx.strokeRect(x, y, MM.w, MM.h);
  // Water + land.
  ctx.fillStyle = '#274156'; ctx.fillRect(x, y, MM.w, RIVER_Y * sy);
  ctx.fillStyle = '#1e7fb8'; ctx.fillRect(x, y + RIVER_Y * sy, MM.w, MM.h - RIVER_Y * sy);
  // Roads.
  ctx.strokeStyle = '#8b93a3'; ctx.lineWidth = 2;
  for (const a of AVENUES) { ctx.beginPath(); ctx.moveTo(x + a.x * sx, y); ctx.lineTo(x + a.x * sx, y + MM.h); ctx.stroke(); }
  for (const s of STREETS) { ctx.beginPath(); ctx.moveTo(x, y + s.y * sy); ctx.lineTo(x + MM.w, y + s.y * sy); ctx.stroke(); }
  const blip = (wx, wy, color, r = 3.5) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + wx * sx, y + wy * sy, r, 0, Math.PI * 2); ctx.fill(); };
  // Garages + safehouse.
  for (const g of world.garages) blip(g.x, g.y, '#fb8500', 3);
  blip(world.safehouse.x, world.safehouse.y, '#2ec4b6', 4);
  // Mission markers.
  if (world.mission) {
    const m = world.mission;
    blip(m.building.x + m.building.w / 2, m.building.y + m.building.h / 2, '#ef476f', 6);
    if (world.getawayCar && m.phase === 'escape') blip(world.getawayCar.x, world.getawayCar.y, '#06d6a0', 5);
  }
  // Activities.
  const a = world.activities;
  if (a) {
    if (a.race) { const cp = a.race.checkpoints[a.race.idx]; if (cp) blip(cp.x, cp.y, '#ffd60a', 5); }
    if (a.fare) blip(a.fare.picked ? a.fare.destX : a.fare.ped.x, a.fare.picked ? a.fare.destY : a.fare.ped.y, '#f72585', 5);
    if (a.chop) blip(a.chop.car.x, a.chop.car.y, '#4cc9f0', 5);
  }
  // Crew.
  for (const c of world.crewMembers) blip(c.x, c.y, c.def.color, 3);
  // Police (always with scanner gear, else within range).
  const showAll = world.plan && world.plan.gear && world.plan.gear.includes('scanner');
  const p = world.player;
  for (const car of world.cars) {
    if (!car.police || car.disabled) continue;
    if (showAll || Math.hypot(car.x - p.x, car.y - p.y) < 800) blip(car.x, car.y, '#5b8cff', 3.5);
  }
  if (world.heli.active) blip(world.heli.x, world.heli.y, '#5b8cff', 4);
  // Player wedge.
  const px = x + p.x * sx, py = y + p.y * sy;
  const ang = p.car ? p.car.angle : p.angle;
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.moveTo(px + Math.cos(ang) * 8, py + Math.sin(ang) * 8);
  ctx.lineTo(px + Math.cos(ang + 2.5) * 6, py + Math.sin(ang + 2.5) * 6);
  ctx.lineTo(px + Math.cos(ang - 2.5) * 6, py + Math.sin(ang - 2.5) * 6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#eef1f5'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('MERIDIAN MILE', x + 8, y + 15);
  ctx.restore();
}
