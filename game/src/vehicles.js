// vehicles.js — car classes, car state, arcade driving physics, damage.
// Cars are rectangles with a heading; physics is a simple bicycle-lite model:
// throttle accelerates along heading, steering scales with speed, handbrake
// breaks rear grip for drifts and leaves skid marks.
import { CAR_LENGTH, CAR_WIDTH } from './config.js';
import { clamp, angleDiff } from './rng.js';
import { collideWorld } from './city.js';

export const CAR_CLASSES = {
  compact: { name: 'KEEL PICO', topSpeed: 300, accel: 210, grip: 3.4, durability: 70, color: '#ffd60a', price: 0 },
  sedan:   { name: 'MERIDIAN SABLE', topSpeed: 340, accel: 230, grip: 3.1, durability: 90, color: '#4cc9f0', price: 4000 },
  coupe:   { name: 'VOSS COUPE', topSpeed: 390, accel: 270, grip: 3.3, durability: 80, color: '#f72585', price: 9000 },
  suv:     { name: 'BRINE HAULER', topSpeed: 320, accel: 200, grip: 2.7, durability: 130, color: '#90be6d', price: 7000 },
  truck:   { name: 'FOUNDRY MULE', topSpeed: 280, accel: 170, grip: 2.4, durability: 170, color: '#bc6c25', price: 11000 },
  sports:  { name: 'AURUM VIPER', topSpeed: 470, accel: 330, grip: 3.6, durability: 65, color: '#ef476f', price: 22000 },
};
export const CLASS_IDS = Object.keys(CAR_CLASSES);
const PALETTE = ['#ffd60a', '#4cc9f0', '#f72585', '#90be6d', '#ff9770', '#adb5bd', '#06d6a0', '#e9ecef', '#7209b7', '#fb8500'];

export function makeCar(rng, classId, x, y, angle, opts = {}) {
  const spec = CAR_CLASSES[classId];
  return {
    classId, spec, x, y, angle, speed: 0, steer: 0,
    health: spec.durability, maxHealth: spec.durability,
    color: opts.color || rng.pick(PALETTE), parked: !!opts.parked,
    driver: null, // 'player' | 'traffic' | 'police' | 'crew' | null
    disabled: false, smokeT: 0, skid: [], id: opts.id || 0,
    police: false, spikeHit: 0, owner: opts.owner || null,
  };
}

// Drive one car for dt. input: {throttle -1..1, steer -1..1, handbrake bool}.
// Mutates car; pushes skid points into car.skid when drifting. Returns events.
export function driveCar(world, car, input, dt) {
  const events = { crashed: 0, drifting: false };
  if (car.disabled) { car.speed *= Math.max(0, 1 - 3 * dt); moveCar(world, car, dt); return events; }
  const spec = car.spec;
  const target = input.throttle > 0 ? spec.topSpeed : input.throttle < 0 ? -spec.topSpeed * 0.42 : 0;
  if (input.throttle !== 0) {
    car.speed += Math.sign(target - car.speed) * spec.accel * dt * (input.throttle > 0 ? 1 : 0.8);
    if ((input.throttle > 0 && car.speed > target) || (input.throttle < 0 && car.speed < target)) car.speed = target;
  } else {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 130 * dt); // engine braking / drag
  }
  if (input.brake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 420 * dt);
  const speedRatio = clamp(Math.abs(car.speed) / spec.topSpeed, 0, 1);
  const steerAuthority = spec.grip * (0.35 + 0.65 * Math.min(1, Math.abs(car.speed) / 90));
  car.steer = input.steer;
  let turn = input.steer * steerAuthority * dt * (car.speed >= 0 ? 1 : -1);
  if (input.handbrake) {
    turn *= 1.7;
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 190 * dt);
    if (Math.abs(car.speed) > 120 && Math.abs(input.steer) > 0.2) events.drifting = true;
  }
  car.angle += turn * clamp(Math.abs(car.speed) / 140, 0, 1.15);
  moveCar(world, car, dt);
  // Damage smoke timer.
  if (car.health < car.maxHealth * 0.45) car.smokeT += dt;
  if (events.drifting) {
    car.skid.push({ x: car.x - Math.cos(car.angle) * 16, y: car.y - Math.sin(car.angle) * 16, life: 6 });
    if (car.skid.length > 220) car.skid.splice(0, car.skid.length - 220);
  }
  for (const s of car.skid) s.life -= dt;
  car.skid = car.skid.filter((s) => s.life > 0);
  return events;
}

function moveCar(world, car, dt) {
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  const before = Math.abs(car.speed);
  const fixed = collideWorld(world.city, nx, ny, CAR_WIDTH);
  if (Math.abs(fixed.x - nx) > 1 || Math.abs(fixed.y - ny) > 1) {
    if (before > 130) { car.health -= (before - 120) * 0.06; }
    car.speed *= 0.35;
  }
  car.x = fixed.x; car.y = fixed.y;
  // Car-vs-car soft collision.
  for (const other of world.cars) {
    if (other === car) continue;
    const dx = car.x - other.x, dy = car.y - other.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 42 * 42 && d2 > 0.01) {
      const d = Math.sqrt(d2), push = (42 - d) / 2;
      car.x += (dx / d) * push; car.y += (dy / d) * push;
      other.x -= (dx / d) * push; other.y -= (dy / d) * push;
      const rel = Math.abs(car.speed - other.speed);
      if (rel > 90) { car.health -= rel * 0.05; other.health -= rel * 0.05; }
      car.speed *= 0.8; other.speed *= 0.8;
    }
  }
  if (car.health <= 0 && !car.disabled) { car.disabled = true; car.health = 0; }
}

export function damageCar(car, amount) {
  car.health -= amount;
  if (car.health <= 0) { car.health = 0; car.disabled = true; }
}
export function carDamageLevel(car) {
  const r = car.health / car.maxHealth;
  return r > 0.7 ? 0 : r > 0.4 ? 1 : r > 0.15 ? 2 : 3;
}
