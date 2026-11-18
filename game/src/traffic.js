// traffic.js — ambient traffic that follows the road graph with lane offsets,
// braking for the car ahead and simple intersection turns.
import { AVENUES, STREETS, nextWaypoint } from './city.js';
import { driveCar, makeCar, CLASS_IDS } from './vehicles.js';
import { clamp } from './rng.js';

export function spawnTraffic(world, count) {
  const rng = world.rng;
  for (let i = 0; i < count; i++) {
    const vertical = rng.chance(0.5);
    const dir = rng.chance(0.5) ? 1 : -1;
    let x, y, angle;
    if (vertical) {
      const a = rng.pick(AVENUES);
      x = a.x + (dir > 0 ? 22 : -22); y = rng.range(120, 1950); angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      const s = rng.pick(STREETS);
      y = s.y + (dir > 0 ? -22 : 22); x = rng.range(120, 3050); angle = dir > 0 ? 0 : Math.PI;
    }
    const car = makeCar(rng, rng.pick(CLASS_IDS.slice(0, 5)), x, y, angle, { id: 1000 + i });
    car.driver = 'traffic';
    car.traffic = { dir, vertical, cruise: rng.range(120, 190), waypoint: null };
    world.cars.push(car);
  }
  // Parked, stealable cars near buildings.
  for (let i = 0; i < 26; i++) {
    const b = rng.pick(world.city.buildings);
    const car = makeCar(rng, rng.pick(CLASS_IDS), b.doorX + rng.range(-70, 70), b.doorY + rng.range(6, 30), rng.pick([0, Math.PI]), { parked: true, id: 2000 + i });
    world.cars.push(car);
  }
}

export function stepTraffic(world, dt) {
  for (const car of world.cars) {
    if (car.driver !== 'traffic') continue;
    const t = car.traffic;
    // Choose a waypoint ahead along the current road, turning at crossings.
    if (!t.waypoint || Math.hypot(t.waypoint.x - car.x, t.waypoint.y - car.y) < 60) {
      const ahead = 500;
      let wx = car.x + Math.cos(car.angle) * ahead, wy = car.y + Math.sin(car.angle) * ahead;
      // Occasionally decide to turn at the next crossing.
      if (world.rng.chance(0.3)) {
        const wp = nextWaypoint(car.x, car.y, wx + world.rng.range(-300, 300), wy + world.rng.range(-300, 300));
        wx = wp.x; wy = wp.y;
      }
      t.waypoint = { x: wx, y: wy };
    }
    // Brake for anything close ahead.
    let brake = false;
    const fx = car.x + Math.cos(car.angle) * 58, fy = car.y + Math.sin(car.angle) * 58;
    for (const other of world.cars) {
      if (other === car) continue;
      if (Math.hypot(other.x - fx, other.y - fy) < 34) { brake = true; break; }
    }
    if (!brake && world.player.car === null && Math.hypot(world.player.x - fx, world.player.y - fy) < 30) brake = true;
    const desired = Math.atan2(t.waypoint.y - car.y, t.waypoint.x - car.x);
    let diff = desired - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = clamp(diff * 1.6, -1, 1);
    driveCar(world, car, { throttle: brake ? 0 : 0.75, steer, brake, handbrake: false }, dt);
    if (Math.abs(car.speed) > t.cruise) car.speed = t.cruise;
  }
}
