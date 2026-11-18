// crew.js — crew members in execution: they follow, wait, or grab loot on
// command, visibly carry loot bags, add grab rate, and can be left behind.
import { collideWorld } from './city.js';
import { CREW_POOL } from './heists.js';

export function spawnCrew(world) {
  world.crewMembers = [];
  if (!world.plan) return;
  const target = world.mission ? world.mission.building : null;
  const sx = target ? target.doorX : world.player.x;
  const sy = target ? target.doorY : world.player.y;
  world.plan.crew.forEach((id, i) => {
    const def = CREW_POOL.find((c) => c.id === id);
    if (!def) return;
    world.crewMembers.push({
      def, x: sx + (i - 1) * 34, y: sy + 44, angle: 0, mode: 'follow',
      hasBag: false, walkPhase: i * 1.7, down: 0, grabBoost: 1 + def.skill / 500,
    });
  });
}

export function cycleCrewCommand(world) {
  const modes = ['follow', 'wait', 'grab'];
  const cur = world.crewMembers.length ? world.crewMembers[0].mode : 'follow';
  const next = modes[(modes.indexOf(cur) + 1) % modes.length];
  for (const m of world.crewMembers) m.mode = next;
  world.spawnFloat(world.player.x, world.player.y - 44, 'CREW: ' + next.toUpperCase(), '#4cc9f0', 20);
  world.audio.uiClick();
  return next;
}

export function stepCrew(world, dt) {
  const p = world.player;
  const m = world.mission;
  for (const member of world.crewMembers) {
    if (member.down > 0) { member.down -= dt; continue; }
    let tx, ty, speed = 150;
    if (member.mode === 'wait') { tx = member.x; ty = member.y; speed = 0; }
    else if (member.mode === 'grab' && m && m.phase === 'grab') { tx = m.building.doorX; ty = m.building.doorY - 10; speed = 165; }
    else {
      const anchor = p.car ? p.car : p;
      tx = anchor.x - 30 + (world.crewMembers.indexOf(member) - 1) * 30;
      ty = anchor.y + 34;
      speed = Math.hypot(tx - member.x, ty - member.y) > 130 ? 225 : 150;
    }
    const dx = tx - member.x, dy = ty - member.y, d = Math.hypot(dx, dy);
    if (d > 8 && speed > 0) {
      member.angle = Math.atan2(dy, dx);
      member.x += (dx / d) * Math.min(speed, d / dt) * dt;
      member.y += (dy / d) * Math.min(speed, d / dt) * dt;
      member.walkPhase += dt * 7;
    }
    const fixed = collideWorld(world.city, member.x, member.y, 11);
    member.x = fixed.x; member.y = fixed.y;
    // Carrying a bag once the grab is underway.
    member.hasBag = !!(m && m.phase !== 'approach' && m.lootGrabbed > 4000);
    // Risk: a crew member near police at high heat may be tackled (Bo shrugs once).
    if (world.stars >= 4 && world.rng.chance(0.0006)) {
      const nearCop = world.cars.some((c) => c.police && Math.hypot(c.x - member.x, c.y - member.y) < 90);
      if (nearCop) {
        if (member.def.id === 'bo' && !world.boShrugged) { world.boShrugged = true; world.spawnFloat(member.x, member.y - 26, 'BO SHRUGS IT OFF!', '#06d6a0', 18); }
        else { member.down = 6; world.spawnFloat(member.x, member.y - 26, 'CREW DOWN!', '#ef476f', 18); }
      }
    }
  }
}
