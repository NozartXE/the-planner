// combat.js — mouse-aim pistol on foot: hitscan shots, muzzle flash, shell and
// impact particles, hit reactions, player damage from police fire at high heat.
import { angleTo, clamp } from './rng.js';

export function makeCombat() {
  return { cooldown: 0, shells: [], policeFireT: 2 };
}

// Called each step while on foot. aim is world-space mouse position.
export function stepCombat(world, dt, aim, firing) {
  const c = world.combat;
  const p = world.player;
  c.cooldown -= dt;
  if (p.car) return;
  p.aimAngle = angleTo(p.x, p.y, aim.x, aim.y);
  if (firing && c.cooldown <= 0) {
    c.cooldown = 0.24;
    world.lastShotT = 0;
    world.audio.shot();
    const mx = p.x + Math.cos(p.aimAngle) * 20, my = p.y + Math.sin(p.aimAngle) * 20;
    world.particles.muzzle(mx, my, p.aimAngle);
    world.particles.spawn(p.x + 8, p.y + 6, { vx: 40, vy: -60, life: 0.5, size: 3, color: '#ffd60a', gravity: 300 });
    world.shake(2.2);
    // Hitscan: nearest police car or officer-zone within 420px in the aim cone.
    let best = null, bestD = 430;
    for (const car of world.cars) {
      if (!car.police || car.disabled) continue;
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      if (d < bestD) {
        const a = angleTo(p.x, p.y, car.x, car.y);
        let diff = Math.abs(a - p.aimAngle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff < 0.16) { best = car; bestD = d; }
      }
    }
    if (best) {
      best.health -= 16;
      world.particles.sparks(best.x, best.y, 7);
      world.audio.hit();
      world.spawnFloat(best.x, best.y - 30, 'HIT!', '#ffd60a', 18);
      if (best.health <= 0) { best.disabled = true; world.addHeat(10, p.x, p.y, 'disabled a police car'); world.particles.burst(best.x, best.y, 18, '#ef476f', 200, 0.7, 5); }
      else world.addHeat(4, p.x, p.y, 'shot at police');
    } else {
      // Impact dust where the shot lands.
      const lx = p.x + Math.cos(p.aimAngle) * 200, ly = p.y + Math.sin(p.aimAngle) * 200;
      world.particles.burst(lx, ly, 3, '#adb5bd', 70, 0.3, 3);
      world.addHeat(2, p.x, p.y, 'shots fired');
    }
  }
  // Police return fire at 3+ stars when the player is visible on foot.
  if (world.stars >= 3 && world.seenT < 0.5) {
    c.policeFireT -= dt;
    if (c.policeFireT <= 0) {
      c.policeFireT = world.rng.range(0.8, 1.5);
      const near = world.cars.some((car) => car.police && !car.disabled && Math.hypot(car.x - p.x, car.y - p.y) < 330);
      if (near) {
        const dmg = world.plan && world.plan.gear.includes('vests') ? 6 : 9;
        p.health -= dmg;
        world.particles.burst(p.x, p.y, 5, '#ef476f', 120, 0.4, 4);
        world.spawnFloat(p.x, p.y - 30, 'HIT!', '#ef476f', 18);
        world.shake(3.5);
        if (p.health <= 0) { p.health = 0; world.endRun('wasted'); }
      }
    }
  }
  void clamp;
}
