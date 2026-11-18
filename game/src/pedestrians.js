// pedestrians.js — sidewalk walkers who stroll, panic and flee danger,
// dive away from fast cars, and can be taxi customers.
import { AVENUES, STREETS, collideWorld } from './city.js';
import { clamp } from './rng.js';

const SHIRTS = ['#e9ecef', '#ffd60a', '#4cc9f0', '#f72585', '#90be6d', '#ff9770', '#06d6a0', '#7209b7', '#ef476f', '#ffd23f'];

export function spawnPedestrians(world, count) {
  const rng = world.rng;
  for (let i = 0; i < count; i++) {
    const vertical = rng.chance(0.5);
    const a = rng.pick(AVENUES), s = rng.pick(STREETS);
    const side = rng.chance(0.5) ? 1 : -1;
    world.peds.push({
      x: vertical ? a.x + side * 62 : rng.range(80, 3100),
      y: vertical ? rng.range(80, 1980) : s.y + side * 62,
      angle: rng.range(0, Math.PI * 2), speed: 0, walkPhase: rng.range(0, 6),
      shirt: rng.pick(SHIRTS), state: 'walk', panicT: 0, target: null,
      vertical, side, id: i, fare: null, down: 0,
    });
  }
}

export function stepPedestrians(world, dt) {
  const p = world.player;
  for (const ped of world.peds) {
    if (ped.down > 0) { ped.down -= dt; continue; }
    // Danger sensing: gunfire, fast nearby cars, high heat nearby.
    let dangerX = null, dangerY = null;
    if (world.lastShotT < 0.6 && Math.hypot(p.x - ped.x, p.y - ped.y) < 260) { dangerX = p.x; dangerY = p.y; }
    for (const car of world.cars) {
      if (Math.abs(car.speed) > 170 && Math.hypot(car.x - ped.x, car.y - ped.y) < 90) { dangerX = car.x; dangerY = car.y; break; }
    }
    if (dangerX !== null) { ped.state = 'flee'; ped.panicT = 2.4; ped.fleeFrom = { x: dangerX, y: dangerY }; }
    let tx, ty, speed;
    if (ped.state === 'flee') {
      ped.panicT -= dt;
      if (ped.panicT <= 0) ped.state = 'walk';
      const dx = ped.x - ped.fleeFrom.x, dy = ped.y - ped.fleeFrom.y;
      const d = Math.hypot(dx, dy) || 1;
      tx = ped.x + (dx / d) * 120; ty = ped.y + (dy / d) * 120; speed = 215;
    } else {
      // Stroll along the sidewalk: keep to the current avenue/street line.
      if (!ped.target || Math.hypot(ped.target.x - ped.x, ped.target.y - ped.y) < 24) {
        if (ped.vertical) ped.target = { x: ped.x, y: world.rng.range(80, 1980) };
        else ped.target = { x: world.rng.range(80, 3100), y: ped.y };
      }
      tx = ped.target.x; ty = ped.target.y; speed = 62;
    }
    const dx = tx - ped.x, dy = ty - ped.y, d = Math.hypot(dx, dy);
    if (d > 2) {
      ped.angle = Math.atan2(dy, dx);
      ped.x += (dx / d) * speed * dt; ped.y += (dy / d) * speed * dt;
      ped.walkPhase += dt * (speed / 22);
    }
    const fixed = collideWorld(world.city, ped.x, ped.y, 10);
    ped.x = fixed.x; ped.y = fixed.y;
    // Run over check (only fast cars, only while player is driving it counts as a crime).
    for (const car of world.cars) {
      if (Math.abs(car.speed) > 130 && Math.hypot(car.x - ped.x, car.y - ped.y) < 24) {
        ped.down = 4; ped.state = 'walk';
        if (car.driver === 'player') world.addHeat(9, ped.x, ped.y, 'hit a pedestrian');
        world.spawnFloat(ped.x, ped.y - 20, 'OUCH!', '#ef476f');
        break;
      }
    }
    ped.speed = speed;
    void clamp;
  }
}
