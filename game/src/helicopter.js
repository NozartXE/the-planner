// helicopter.js — police helicopter from 3 stars: hovers above the player,
// sweeps a searchlight cone; standing in the light stops heat decay.
import { clamp } from './rng.js';

export function makeHelicopter() {
  return { active: false, x: 0, y: 0, angle: 0, rotor: 0, lightAngle: 0, lightOnPlayer: false };
}

export function stepHelicopter(world, dt) {
  const h = world.heli;
  const p = world.player;
  const px = p.car ? p.car.x : p.x, py = p.car ? p.car.y : p.y;
  h.active = world.stars >= 3;
  if (!h.active) { h.lightOnPlayer = false; return; }
  if (h.x === 0 && h.y === 0) { h.x = px - 500; h.y = py - 380; }
  // Hover with lag so a fast car can outrun the light briefly.
  const tx = px - 90, ty = py - 120;
  h.x += clamp(tx - h.x, -260 * dt, 260 * dt);
  h.y += clamp(ty - h.y, -260 * dt, 260 * dt);
  h.rotor += dt * 40;
  h.lightAngle = Math.atan2(py - h.y, px - h.x) + Math.sin(world.time * 0.7) * 0.18;
  const lx = h.x + Math.cos(h.lightAngle) * 150, ly = h.y + Math.sin(h.lightAngle) * 150;
  h.lightX = lx; h.lightY = ly;
  h.lightOnPlayer = Math.hypot(lx - px, ly - py) < 95;
  if (h.lightOnPlayer) world.seenT = 0;
}
