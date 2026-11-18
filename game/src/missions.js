// missions.js — heist execution flow (approach → grab → escape → done) and
// free-roam side activities: street races, taxi fares, chop-shop deliveries.
import { planStats } from './heists.js';
import { randomRoadPoint } from './city.js';

export function startMission(world, heist, plan) {
  const building = world.city.buildings.find((b) => b.kind === heist.kind) || world.city.buildings[0];
  const stats = planStats(heist, plan);
  // Entry point choice shifts the approach marker around the target.
  const offs = [{ x: 0, y: 66 }, { x: -building.w / 2 - 30, y: 0 }, { x: building.w / 2 + 30, y: -20 }];
  const off = offs[plan.entry] || offs[0];
  return {
    heist, plan, stats, building,
    entryX: building.x + building.w / 2 + off.x, entryY: building.y + building.h / 2 + off.y,
    phase: 'approach', lootGrabbed: 0, lootTotal: stats.loot,
    alarmT: stats.alarm, alarmStarted: false, camBlindT: 0,
    time: 0, escaped: false, escapeT: stats.escape,
  };
}

export function stepMission(world, dt) {
  const m = world.mission;
  if (!m) return;
  m.time += dt;
  if (m.camBlindT > 0) m.camBlindT -= dt;
  const p = world.player;
  const px = p.car ? p.car.x : p.x, py = p.car ? p.car.y : p.y;
  if (m.phase === 'approach') {
    if (!p.car && Math.hypot(p.x - m.entryX, p.y - m.entryY) < 40) {
      m.phase = 'grab';
      world.spawnFloat(p.x, p.y - 40, 'INSIDE — GRAB THE LOOT!', '#06d6a0', 24);
      world.audio.pickup();
    }
  } else if (m.phase === 'grab') {
    // Alarm starts on entry; cameras witness unless blind / power cut.
    if (!m.alarmStarted) { m.alarmStarted = true; world.addHeat(m.heist.guardHeat * 0.4, px, py, 'alarm tripped'); }
    m.alarmT -= dt;
    const crewBoost = 1 + world.crewMembers.filter((c) => c.mode !== 'wait' || true).length * 0.0 + world.crewMembers.reduce((s, c) => s + (c.hasBag || c.mode === 'grab' ? 0.1 : 0.04), 0);
    const nearLoot = Math.hypot(p.x - m.building.doorX, p.y - (m.building.doorY - 16)) < 130;
    if (!p.car && nearLoot) {
      const before = m.lootGrabbed;
      m.lootGrabbed = Math.min(m.lootTotal, m.lootGrabbed + m.stats.grabRate * crewBoost * dt);
      if (Math.floor(m.lootGrabbed / 4000) > Math.floor(before / 4000)) {
        world.audio.cash();
        world.particles.cashFlutter(p.x, p.y - 10, 6);
      }
      if (world.rng.chance(0.02)) world.particles.cashFlutter(p.x, p.y - 8, 2);
    }
    const witnessed = m.camBlindT <= 0 && !world.powerCut;
    if (witnessed && world.time % 1 < dt) world.addHeat(1.1 * m.heist.camDensity + 0.4, px, py, 'camera witnessed the grab');
    if (m.alarmT <= 0 && world.time % 1 < dt) world.addHeat(2.2, px, py, 'alarm expired — full response');
    if (m.lootGrabbed >= m.lootTotal) {
      m.phase = 'escape';
      world.spawnFloat(px, py - 46, 'VAULT EMPTY — GET TO THE GETAWAY!', '#ffd60a', 24);
      world.addHeat(14, px, py, 'vault emptied');
    }
  } else if (m.phase === 'escape') {
    // Escape succeeds by reaching the getaway marker with heat, or by fully
    // cooling heat anywhere (laying low). Escape window is a soft timer that
    // raises pressure when it lapses.
    m.escapeT -= dt;
    if (m.escapeT <= 0 && world.time % 1 < dt) world.addHeat(1.4, px, py, 'escape window lapsed');
    const gw = world.getawayCar;
    if (gw && p.car === gw && world.stars === 0) finishEscape(world);
    else if (!gw && world.stars === 0 && m.lootGrabbed > 0) finishEscape(world);
    else if (gw && Math.hypot(px - world.safehouse.x, py - world.safehouse.y) < 70 && world.stars <= 1) finishEscape(world);
  }
}

function finishEscape(world) {
  const m = world.mission;
  m.phase = 'done';
  world.finishHeist(true);
}

// ---------- Free-roam side activities ----------
export function makeActivities(world) {
  return { race: null, fare: null, chop: null, nextOfferT: 4 };
}

export function stepActivities(world, dt) {
  const a = world.activities;
  const p = world.player;
  const px = p.car ? p.car.x : p.x, py = p.car ? p.car.y : p.y;
  a.nextOfferT -= dt;
  if (a.nextOfferT <= 0) {
    a.nextOfferT = 9;
    if (!a.race && world.rng.chance(0.5)) {
      const start = randomRoadPoint(world.rng);
      const checkpoints = [];
      let cx = start.x, cy = start.y;
      for (let i = 0; i < 5; i++) { const pt = randomRoadPoint(world.rng); checkpoints.push({ x: pt.x, y: pt.y }); cx = pt.x; cy = pt.y; }
      void cx; void cy;
      a.race = { checkpoints, idx: 0, t: 0, par: 95, start };
      world.spawnFloat(px, py - 50, 'STREET RACE POSTED — FOLLOW THE GOLD RINGS', '#ffd60a', 18);
    } else if (!a.fare) {
      const ped = world.peds.find((pd) => pd.down <= 0);
      if (ped) {
        const dest = randomRoadPoint(world.rng);
        a.fare = { ped, destX: dest.x, destY: dest.y, picked: false, pay: world.rng.int(120, 320) };
        ped.fare = a.fare;
        world.spawnFloat(px, py - 50, 'TAXI FARE WAITING — PINK BLIP', '#f72585', 18);
      }
    } else if (!a.chop) {
      const car = world.cars.find((c) => c.parked && !c.disabled);
      if (car) {
        const shop = world.city.buildings.find((b) => b.name.includes('TURBO')) || world.city.buildings[8];
        a.chop = { car, destX: shop.doorX, destY: shop.doorY + 30, pay: 500 };
        car.chopMarked = true;
        world.spawnFloat(px, py - 50, 'CHOP SHOP WANTS THE MARKED CAR', '#4cc9f0', 18);
      }
    }
  }
  if (a.race) {
    a.race.t += dt;
    const cp = a.race.checkpoints[a.race.idx];
    if (cp && Math.hypot(px - cp.x, py - cp.y) < 74) {
      world.audio.pickup();
      world.particles.burst(cp.x, cp.y, 14, '#ffd60a', 170, 0.6, 5);
      a.race.idx += 1;
      if (a.race.idx >= a.race.checkpoints.length) {
        const won = a.race.t <= a.race.par;
        const pay = won ? 800 : 250;
        world.earn(pay, won ? 'RACE WON!' : 'RACE DONE');
        if (won) world.save.stats.racesWon += 1;
        a.race = null;
      }
    }
  }
  if (a.fare) {
    const f = a.fare;
    if (!f.picked && p.car && Math.hypot(f.ped.x - px, f.ped.y - py) < 52 && Math.abs(p.car.speed) < 30) {
      f.picked = true; f.ped.state = 'ride'; world.spawnFloat(px, py - 44, 'FARE ABOARD — GO!', '#f72585', 18);
    }
    if (f.picked) {
      f.ped.x = px; f.ped.y = py;
      if (Math.hypot(f.destX - px, f.destY - py) < 64 && Math.abs(p.car.speed) < 30) {
        world.earn(f.pay, 'FARE PAID');
        world.save.stats.fares += 1;
        f.ped.fare = null; f.ped.state = 'walk'; f.ped.target = null;
        a.fare = null;
      }
    }
  }
  if (a.chop) {
    const c = a.chop;
    if (p.car === c.car && Math.hypot(c.destX - px, c.destY - py) < 70 && Math.abs(p.car.speed) < 30) {
      const undamaged = c.car.health > c.car.maxHealth * 0.75;
      world.earn(undamaged ? c.pay : Math.round(c.pay * 0.4), undamaged ? 'CHOP DELIVERED CLEAN' : 'CHOP DELIVERED (DENTED)');
      world.save.stats.chops += 1;
      c.car.chopMarked = false; c.car.parked = true; p.car = null; p.x = px + 30; p.y = py + 30;
      a.chop = null;
    }
  }
}
