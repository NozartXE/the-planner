// traffic.js — civilian traffic AI: right-hand lane following, intersection choices, braking and distance recycling.
import { roadCenters, isRoadCoord } from './city.js';
import { makeCar } from './cars.js';
import { CIVILIAN_TARGET, WORLD_SIZE } from './config.js';
import { dist, clamp } from './rng.js';
export const DIRS = [
  { x: 1, y: 0, angle: 0, ox: 0, oy: 21 },
  { x: 0, y: 1, angle: Math.PI / 2, ox: -21, oy: 0 },
  { x: -1, y: 0, angle: Math.PI, ox: 0, oy: -21 },
  { x: 0, y: -1, angle: -Math.PI / 2, ox: 21, oy: 0 },
];
export function spawnOnRoad(rng, nearX, nearY, minD, maxD) {
  const centers = roadCenters();
  for (let tries = 0; tries < 24; tries++) {
    const horizontal = rng.chance(0.5);
    const dir = horizontal ? (rng.chance(0.5) ? 0 : 2) : (rng.chance(0.5) ? 1 : 3);
    const d = DIRS[dir];
    const center = rng.pick(centers);
    const along = rng.range(0, WORLD_SIZE);
    const x = horizontal ? along : center + d.ox;
    const y = horizontal ? center + d.oy : along;
    const dd = dist(x, y, nearX, nearY);
    if (dd >= minD && dd <= maxD) return { x, y, dir };
    if (tries > 18 && dd > minD * 0.7) return { x, y, dir };
  }
  return { x: 300, y: 46 + 21, dir: 0 };
}
export function makeTrafficCar(rng, x, y, dir) {
  const car = makeCar(rng, rng.int(0, 3), x, y, DIRS[dir].angle);
  car.dir = dir;
  car.cruise = car.maxSpeed * rng.range(0.5, 0.78);
  car.speed = car.cruise * 0.7;
  car.decidedFor = '';
  return car;
}
export function populateTraffic(rng, player) {
  const cars = [];
  for (let i = 0; i < CIVILIAN_TARGET; i++) {
    const s = spawnOnRoad(rng, player.x, player.y, i < 8 ? 260 : 420, 1050);
    cars.push(makeTrafficCar(rng, s.x, s.y, s.dir));
  }
  return cars;
}
function obstacleAhead(car, others, player) {
  const d = DIRS[car.dir];
  const check = (ox, oy) => {
    const rx = ox - car.x, ry = oy - car.y;
    const ahead = rx * d.x + ry * d.y;
    const side = Math.abs(rx * d.y - ry * d.x);
    return ahead > 6 && ahead < 58 && side < 17;
  };
  for (const o of others) { if (o !== car && !o.dead && check(o.x, o.y)) return true; }
  if (player && !player.inCar && check(player.x, player.y)) return true;
  return false;
}
export function chooseTrafficDir(rng, car) {
  const r = rng.next();
  if (r < 0.62) return car.dir;
  if (r < 0.81) return (car.dir + 1) % 4; // right turn for dirs ordered E,S,W,N clockwise
  return (car.dir + 3) % 4; // left turn
}
export function applyTurn(car, newDir, cx, cy) {
  const old = DIRS[car.dir];
  const nd = DIRS[newDir];
  if (newDir === car.dir) return;
  if (nd.y !== 0) { car.x = cx + nd.ox; car.y = cy + old.oy + nd.y * 4; }
  else { car.y = cy + nd.oy; car.x = cx + old.ox + nd.x * 4; }
  car.dir = newDir;
  car.angle = nd.angle;
}
export function stepRoadCar(rng, car, dt, others, player, chooseDir) {
  const d = DIRS[car.dir];
  const blocked = obstacleAhead(car, others, player);
  const target = blocked ? 0 : (car.cruise || 120);
  if (car.speed < target) car.speed = Math.min(target, car.speed + car.accel * 0.55 * dt);
  else car.speed = Math.max(target, car.speed - 320 * dt);
  const prevX = car.x, prevY = car.y;
  car.x += d.x * car.speed * dt;
  car.y += d.y * car.speed * dt;
  car.x = clamp(car.x, 20, WORLD_SIZE - 20);
  car.y = clamp(car.y, 20, WORLD_SIZE - 20);
  // Intersection decision: crossing a perpendicular road centre.
  const centers = roadCenters();
  for (const c of centers) {
    const crossed = d.x !== 0 ? (prevX - c) * (car.x - c) <= 0 && prevX !== car.x : (prevY - c) * (car.y - c) <= 0 && prevY !== car.y;
    if (!crossed) continue;
    const perp = d.x !== 0 ? car.y : car.x;
    // Only a real intersection when the car's lane sits on a crossing road.
    const laneCenter = d.x !== 0 ? car.y - d.oy : car.x - d.ox;
    if (!isRoadCoord(laneCenter + (d.x !== 0 ? 0 : 0)) && Math.abs(laneCenter % 470) > 4 && !centers.includes(Math.round(laneCenter))) {
      // still allow: lane centres are exactly road centres by construction
    }
    const key = (d.x !== 0 ? 'v' : 'h') + c + ':' + Math.round(perp);
    if (car.decidedFor === key) continue;
    car.decidedFor = key;
    const cx = d.x !== 0 ? c : laneCenter;
    const cy = d.x !== 0 ? laneCenter : c;
    const nd = chooseDir(rng, car, cx, cy);
    if (nd !== car.dir) applyTurn(car, nd, cx, cy);
    break;
  }
  car.angle = DIRS[car.dir].angle;
}
export function updateTraffic(rng, cars, dt, player, allCars) {
  for (const car of cars) {
    if (car.dead || car.occupiedByPlayer) continue;
    stepRoadCar(rng, car, dt, allCars, player, (r, c) => chooseTrafficDir(r, c));
    const dd = dist(car.x, car.y, player.x, player.y);
    if (dd > 1250) {
      const s = spawnOnRoad(rng, player.x, player.y, 640, 1020);
      car.x = s.x; car.y = s.y; car.dir = s.dir; car.angle = DIRS[s.dir].angle; car.speed = car.cruise * 0.6; car.decidedFor = '';
    }
  }
}
