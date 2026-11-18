// police.js — wanted system: heat, dispatch, pursuit steering with PIT nudges,
// roadblocks, spike strips, bust logic, garages and bribe points that shed heat.
import { nextWaypoint, randomRoadPoint, AVENUES, STREETS } from './city.js';
import { driveCar, makeCar } from './vehicles.js';
import { clamp } from './rng.js';
import { HEAT_MAX } from './config.js';

export function starsForHeat(heat) { return heat <= 0 ? 0 : Math.min(5, Math.ceil(heat / 20)); }

// Desired active pursuers per star level.
export function desiredPolice(stars, planMult = 1) {
  const base = [0, 1, 2, 3, 4, 6][stars] || 0;
  return Math.round(base * planMult);
}

export function spawnPoliceCar(world, nearX, nearY) {
  const pt = randomRoadPoint(world.rng);
  // Spawn on a road at least 420px away but in the same district quadrant.
  let x = pt.x, y = pt.y;
  if (Math.hypot(x - nearX, y - nearY) < 420) { x = nearX + (x > nearX ? 460 : -460); y = nearY + (y > nearY ? 300 : -300); }
  const car = makeCar(world.rng, 'sedan', clamp(x, 80, 3120), clamp(y, 80, 2000), 0, { color: '#2f6fed', id: 3000 + world.cars.length });
  car.police = true; car.driver = 'police';
  car.spec = { ...car.spec, topSpeed: 385, accel: 265 };
  world.cars.push(car);
  return car;
}

export function setupEscapeAids(world) {
  // Garages shed heat when you stop inside; bribe points cost cash, shed more.
  world.garages = world.city.buildings.filter((b) => b.kind === 'garage').map((b) => ({ x: b.doorX, y: b.doorY + 26, name: b.name }));
  world.bribes = [
    { x: 620, y: 1830, cost: 600, label: 'DOCKSIDE FIXER' },
    { x: 2620, y: 230, cost: 600, label: 'NEON ROW FIXER' },
    { x: 1420, y: 1030, cost: 900, label: 'VAULT ST LAWYER' },
  ];
  world.roadblocks = [];
  world.spikes = [];
}

export function stepPolice(world, dt) {
  const p = world.player;
  const stars = world.stars;
  const px = p.car ? p.car.x : p.x, py = p.car ? p.car.y : p.y;
  // Dispatch: honour jam delay and dispatch timer.
  world.dispatchT -= dt;
  const active = world.cars.filter((c) => c.police && !c.disabled);
  const want = world.dispatchT > 0 ? active.length : desiredPolice(stars, world.planPatrolMult);
  if (active.length < want && world.dispatchT <= 0) {
    spawnPoliceCar(world, px, py);
    world.dispatchT = 1.2;
  }
  // Despawn far surplus cars quietly.
  if (active.length > want + 1) {
    const far = active.find((c) => Math.hypot(c.x - px, c.y - py) > 900);
    if (far) { far.police = false; far.driver = 'traffic'; far.traffic = { dir: 1, vertical: true, cruise: 140, waypoint: null }; }
  }
  // Roadblocks from 3 stars: a line of parked police cars across a road ahead.
  if (stars >= 3 && world.roadblocks.length < stars - 2 && world.rng.chance(0.004)) {
    const ave = world.rng.pick(AVENUES);
    const y = clamp(py + (py < 1200 ? 420 : -420), 160, 1950);
    const block = [];
    for (let i = -1; i <= 1; i++) {
      const car = makeCar(world.rng, 'suv', ave.x + i * 40, y, Math.PI / 2, { color: '#2f6fed', parked: true });
      car.police = true; car.driver = null; car.roadblock = true;
      world.cars.push(car); block.push(car);
    }
    world.roadblocks.push({ cars: block, t: 40 });
  }
  for (const rb of world.roadblocks) rb.t -= dt;
  world.roadblocks = world.roadblocks.filter((rb) => rb.t > 0);
  // Spike strips at 4 stars, dropped ahead of the player car.
  if (stars >= 4 && p.car && world.spikes.length < 2 && world.rng.chance(0.003)) {
    world.spikes.push({ x: p.car.x + Math.cos(p.car.angle) * 300, y: p.car.y + Math.sin(p.car.angle) * 300, t: 30 });
  }
  for (const s of world.spikes) s.t -= dt;
  world.spikes = world.spikes.filter((s) => s.t > 0);
  if (p.car && !world.runFlatUsed) {
    for (const s of world.spikes) {
      if (Math.hypot(s.x - p.car.x, s.y - p.car.y) < 30) {
        if (world.plan && world.plan.gear.includes('tires') && !world.runFlatUsed) {
          world.runFlatUsed = true; world.spawnFloat(p.car.x, p.car.y - 34, 'RUN-FLATS SAVED YOU!', '#06d6a0');
          s.t = 0;
        } else if (!p.car.spikeHit) {
          p.car.spikeHit = 6; world.spawnFloat(p.car.x, p.car.y - 34, 'TYRES SHREDDED!', '#ef476f');
          world.audio.crash(0.7);
        }
      }
    }
  }
  // Pursuit steering per police car.
  for (const car of world.cars) {
    if (!car.police || car.driver !== 'police' || car.disabled) continue;
    // If a decoy is active, divert to it.
    const decoy = world.decoy && world.decoy.t > 0 ? world.decoy : null;
    const tx = decoy ? decoy.x : px, ty = decoy ? decoy.y : py;
    const wp = nextWaypoint(car.x, car.y, tx, ty);
    // Aim at an intercept point slightly ahead of the target.
    const lead = p.car ? 0.45 : 0.1;
    const aimX = wp.x === tx ? tx + (p.car ? Math.cos(p.car.angle) * p.car.speed * lead : 0) : wp.x;
    const aimY = wp.y === ty ? ty + (p.car ? Math.sin(p.car.angle) * p.car.speed * lead : 0) : wp.y;
    const desired = Math.atan2(aimY - car.y, aimX - car.x);
    let diff = desired - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = clamp(diff * 1.9, -1, 1);
    const distT = Math.hypot(tx - car.x, ty - car.y);
    const throttle = distT > 60 ? 1 : 0.4;
    driveCar(world, car, { throttle, steer, brake: false, handbrake: Math.abs(diff) > 2.2 }, dt);
    if (car.spikeHit > 0) { car.spikeHit -= dt; car.speed *= 0.9; if (car.spikeHit <= 0) car.disabled = true; }
    // PIT nudge: when alongside the player car, shove toward it.
    if (p.car && distT < 64 && Math.abs(car.speed) > 120) {
      p.car.angle += clamp(diff, -1, 1) * 0.35 * dt;
      p.car.speed *= 1 - 0.25 * dt;
    }
  }
  // Bust meter: surrounded at low speed / on foot near police.
  const nearCops = active.filter((c) => Math.hypot(c.x - px, c.y - py) < 130).length;
  const slow = !p.car || Math.abs(p.car.speed) < 42;
  if (stars > 0 && nearCops >= 2 && slow && world.seenT < 1.2) {
    p.bust += dt / 2.2;
    if (p.bust >= 1) { world.endRun('busted'); return; }
  } else {
    p.bust = Math.max(0, p.bust - dt * 0.7);
  }
  // Escape aids.
  if (p.car && Math.abs(p.car.speed) < 25) {
    for (const g of world.garages) {
      if (Math.hypot(g.x - px, g.y - py) < 62 && world.heat > 0) {
        world.heat = Math.max(0, world.heat - 26 * dt);
        if (world.rng.chance(0.05)) world.spawnFloat(px, py - 40, 'LAYING LOW…', '#4cc9f0', 18);
      }
    }
  }
  if (!p.car) {
    for (const b of world.bribes) {
      if (Math.hypot(b.x - px, b.y - py) < 46 && world.heat > 4) {
        world.bribeNear = b;
        return;
      }
    }
  }
  world.bribeNear = null;
  void STREETS; void HEAT_MAX;
}
