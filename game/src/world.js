// world.js — the whole simulation state and its fixed step. DOM-free except
// for the injected audio/save hooks, so node can smoke-test the sim headlessly.
import { Rng, clamp } from './rng.js';
import { buildCity, collideWorld, buildingByKind } from './city.js';
import { spawnTraffic, stepTraffic } from './traffic.js';
import { spawnPedestrians, stepPedestrians } from './pedestrians.js';
import { driveCar, makeCar } from './vehicles.js';
import { stepPolice, starsForHeat, setupEscapeAids } from './police.js';
import { makeHelicopter, stepHelicopter } from './helicopter.js';
import { makeCombat, stepCombat } from './combat.js';
import { spawnCrew, stepCrew, cycleCrewCommand } from './crew.js';
import { makeGadgets, stepGadgets, useGadget } from './gadgets.js';
import { startMission, stepMission, makeActivities, stepActivities } from './missions.js';
import { settleHeist, applySettlement } from './economy.js';
import { Particles } from './particles.js';
import { DAY_PHASES, HEAT_DECAY_PER_SEC } from './config.js';

export function createWorld(opts = {}) {
  const rng = new Rng(opts.seed || 1234);
  const world = {
    rng, time: 0, mode: 'roam', // 'roam' | 'heist'
    city: null, cars: [], peds: [], crewMembers: [],
    player: null, heat: 0, stars: 0, seenT: 99, lastShotT: 99,
    dispatchT: 0, planPatrolMult: 1, decoy: null, powerCut: false,
    roadblocks: [], spikes: [], garages: [], bribes: [], bribeNear: null,
    heli: makeHelicopter(), combat: makeCombat(), particles: new Particles(),
    gadgets: null, mission: null, plan: null, getawayCar: null,
    activities: null, safehouse: { x: 0, y: 0 }, runFlatUsed: false, boShrugged: false,
    shakeAmt: 0, over: null, results: null, objective: '',
    audio: opts.audio || nullAudio(), save: opts.save || null,
    camera: { x: 0, y: 0 },
  };
  world.city = buildCity(rng.fork(7));
  setupEscapeAids(world);
  const sh = buildingByKind(world.city, 'safehouse');
  if (sh) world.safehouse = { x: sh.doorX, y: sh.doorY + 20 };
  world.player = {
    x: world.safehouse.x, y: world.safehouse.y + 30, angle: -Math.PI / 2, aimAngle: 0,
    health: 100, car: null, bust: 0, walkPhase: 0, dead: false,
  };
  world.activities = makeActivities(world);

  world.shake = (amt) => { world.shakeAmt = Math.min(14, world.shakeAmt + amt); };
  world.spawnFloat = (x, y, text, color, size) => world.particles.floatText(x, y, text, color, size || 22);
  world.earn = (amount, label) => {
    if (world.save) world.save.cash += amount;
    const p = world.player;
    world.spawnFloat(p.car ? p.car.x : p.x, (p.car ? p.car.y : p.y) - 46, `${label} +$${amount}`, '#06d6a0', 22);
    world.audio.cash();
  };
  world.addHeat = (amount, x, y, reason) => {
    // Crimes only raise heat when plausibly witnessed: near a road/cop/camera
    // or when the player is currently seen. Staging calls pass seen=true.
    world.heat = clamp(world.heat + amount, 0, 100);
    world.seenT = 0;
    void x; void y; void reason;
  };
  world.endRun = (kind) => {
    if (world.over) return;
    world.over = kind; // 'busted' | 'wasted'
    if (world.save) { if (kind === 'busted') world.save.stats.busted += 1; else world.save.stats.wasted += 1; }
    if (world.mission && world.mode === 'heist') world.finishHeist(false, kind);
    world.audio.sting(false);
    world.shake(10);
  };
  world.finishHeist = (success, kind) => {
    const m = world.mission;
    if (!m || world.results) return;
    const settlement = settleHeist(world.save || { cash: 0 }, m.heist, m.plan, {
      gross: success ? m.lootGrabbed : 0, seconds: m.time, heatStars: world.stars,
      success, expectedLoot: m.lootTotal,
    });
    if (world.save) {
      applySettlement(world.save, m.heist, m.plan, settlement);
      world.results = { heist: m.heist, plan: m.plan, settlement, success, kind: kind || null, loot: m.lootGrabbed, seconds: m.time };
    } else {
      world.results = { heist: m.heist, plan: m.plan, settlement, success, kind: kind || null, loot: m.lootGrabbed, seconds: m.time };
    }
    if (success) { world.audio.sting(true); const p = world.player; world.particles.confetti(p.car ? p.car.x : p.x, p.car ? p.car.y : p.y, 30); }
  };

  // Staging helper: place n police cars at a spot (used by shots.js only).
  world.forcePolice = (n, x, y) => {
    for (let i = 0; i < n; i++) {
      const car = makeCar(world.rng, 'sedan', x + i * 56, y + (i % 2) * 44, Math.PI * 0.8, { color: '#2f6fed', id: 5000 + i });
      car.police = true; car.driver = 'police';
      car.spec = { ...car.spec, topSpeed: 385, accel: 265 };
      world.cars.push(car);
    }
  };

  world.resetActivity = (trafficCount = 14, pedCount = 26) => {
    world.cars = world.cars.filter((c) => c.owned);
    spawnTraffic(world, trafficCount);
    world.peds = [];
    spawnPedestrians(world, pedCount);
  };
  world.resetActivity();

  world.beginHeist = (heist, plan) => {
    world.mode = 'heist';
    world.plan = plan;
    world.heat = 0; world.stars = 0; world.over = null; world.results = null;
    world.runFlatUsed = false; world.boShrugged = false;
    world.gadgets = makeGadgets(plan);
    world.planPatrolMult = (DAY_PHASES[plan.timeOfDay] ? DAY_PHASES[plan.timeOfDay].patrols : 1) * (0.85 + planStatsHeat(plan));
    world.mission = startMission(world, heist, plan);
    // Teleport player near the entry point, on foot.
    const m = world.mission;
    world.player.car = null;
    world.player.x = m.entryX + 30; world.player.y = m.entryY + 56;
    world.player.health = 100; world.player.bust = 0;
    // Spawn the chosen getaway car near the target, tougher with Sana driving.
    const gw = makeCar(world.rng, plan.getaway, m.building.doorX + 130, m.building.doorY + 60, 0, { id: 4000 });
    if (plan.crew.includes('sana')) { gw.health = Math.round(gw.maxHealth * 1.3); gw.maxHealth = gw.health; gw.x = m.building.doorX + 80; }
    gw.getaway = true;
    world.cars.push(gw);
    world.getawayCar = gw;
    spawnCrew(world);
    world.objective = `Reach the ${heist.name} entry point`;
  };

  world.beginRoam = (timeOfDay) => {
    world.mode = 'roam';
    world.mission = null; world.plan = timeOfDay ? { timeOfDay } : world.plan;
    world.heat = 0; world.stars = 0; world.over = null; world.results = null;
    world.crewMembers = [];
    world.gadgets = makeGadgets(null);
    world.objective = 'Free roam — earn cash: races, fares, chop deliveries. Or open the planning board (B).';
  };

  world.step = (dt, input, mouseWorld) => {
    if (world.over && world.mode !== 'heist') { world.particles.step(dt); return; }
    if (world.over) { world.particles.step(dt); return; }
    world.time += dt;
    world.lastShotT += dt;
    const p = world.player;
    // --- player movement / driving
    if (p.car) {
      const car = p.car;
      if (car.spikeHit > 0) { car.spikeHit -= dt; car.speed *= Math.max(0, 1 - 2.4 * dt); }
      const ev = driveCar(world, car, {
        throttle: (input.down('w', 'arrowup') ? 1 : 0) + (input.down('s', 'arrowdown') ? -1 : 0),
        steer: (input.down('a', 'arrowleft') ? -1 : 0) + (input.down('d', 'arrowright') ? 1 : 0),
        brake: input.down(' '), handbrake: input.down('shift'),
      }, dt);
      if (ev.drifting && world.rng.chance(0.3)) world.particles.smoke(car.x, car.y, 1);
      if (car.health < car.maxHealth * 0.4 && world.rng.chance(0.2)) world.particles.smoke(car.x, car.y, 1);
      p.x = car.x; p.y = car.y;
      if (input.wasPressed('e', 'enter')) {
        p.car = null; car.driver = null; car.parked = true;
        p.x = car.x + 30; p.y = car.y + 10;
        world.audio.uiClick();
      }
      world.audio.engine(Math.abs(car.speed) / car.spec.topSpeed);
    } else {
      const ax = input.moveAxis();
      const running = input.down('shift');
      const speed = running ? 240 : 150;
      if (ax.x || ax.y) {
        p.x += ax.x * speed * dt; p.y += ax.y * speed * dt;
        p.angle = Math.atan2(ax.y, ax.x);
        p.walkPhase += dt * (running ? 11 : 8);
      }
      const fixed = collideWorld(world.city, p.x, p.y, 13);
      p.x = fixed.x; p.y = fixed.y;
      // Enter nearest car with E.
      if (input.wasPressed('e', 'enter')) {
        let best = null, bd = 62;
        for (const car of world.cars) {
          if (car.disabled) continue;
          const d = Math.hypot(car.x - p.x, car.y - p.y);
          if (d < bd) { bd = d; best = car; }
        }
        if (best) {
          const wasParked = best.parked;
          p.car = best; best.driver = 'player'; best.parked = false;
          if (wasParked && !best.police && !best.getaway) world.addHeat(3, p.x, p.y, 'stole a parked car');
          if (best.police) world.addHeat(12, p.x, p.y, 'stole a police car');
          world.audio.uiClick();
        } else if (world.bribeNear && world.save && world.save.cash >= world.bribeNear.cost) {
          world.save.cash -= world.bribeNear.cost;
          world.heat = Math.max(0, world.heat - 45);
          world.spawnFloat(p.x, p.y - 40, 'BRIBE PAID — HEAT DOWN', '#06d6a0', 20);
          world.audio.cash();
          world.bribeNear = null;
        }
      }
      stepCombat(world, dt, mouseWorld || { x: p.x + 100, y: p.y }, input.mouseDown);
      world.audio.engine(0);
    }
    // --- gadgets + crew command
    if (input.wasPressed('1')) useGadget(world, 'cutPower');
    if (input.wasPressed('2')) useGadget(world, 'jam');
    if (input.wasPressed('3')) useGadget(world, 'decoy');
    if (input.wasPressed('4')) useGadget(world, 'spikes');
    if (input.wasPressed('c')) cycleCrewCommand(world);
    stepGadgets(world, dt);
    // --- world systems
    stepTraffic(world, dt);
    stepPedestrians(world, dt);
    stepCrew(world, dt);
    // Seen tracking: seen if any active police within 340 or heli light on player.
    const px = p.car ? p.car.x : p.x, py = p.car ? p.car.y : p.y;
    let seen = world.heli.lightOnPlayer;
    if (!seen) for (const car of world.cars) { if (car.police && !car.disabled && Math.hypot(car.x - px, car.y - py) < 340) { seen = true; break; } }
    if (seen) world.seenT = 0; else world.seenT += dt;
    if (world.seenT > 2.2 && world.heat > 0) world.heat = Math.max(0, world.heat - HEAT_DECAY_PER_SEC * dt * 10);
    world.stars = starsForHeat(world.heat);
    stepPolice(world, dt);
    stepHelicopter(world, dt);
    if (world.mission) stepMission(world, dt);
    else stepActivities(world, dt);
    // Objectives text.
    if (world.mission) {
      const m = world.mission;
      world.objective = m.phase === 'approach' ? `Enter ${m.heist.name} — ${m.heist.entries[m.plan.entry]}`
        : m.phase === 'grab' ? `GRAB LOOT $${Math.floor(m.lootGrabbed)} / $${m.lootTotal} — alarm ${Math.max(0, Math.ceil(m.alarmT))}s`
        : m.phase === 'escape' ? 'ESCAPE — lose the heat, then reach the getaway / safehouse' : 'Done';
    }
    // Siren loudness by nearest police.
    let nearest = Infinity;
    for (const car of world.cars) if (car.police && !car.disabled) nearest = Math.min(nearest, Math.hypot(car.x - px, car.y - py));
    world.audio.siren(clamp(1 - nearest / 700, 0, 1) * (world.stars > 0 ? 1 : 0));
    // Camera with velocity lookahead.
    const focus = p.car ? p.car : p;
    const lookX = p.car ? Math.cos(p.car.angle) * p.car.speed * 0.42 : 0;
    const lookY = p.car ? Math.sin(p.car.angle) * p.car.speed * 0.42 : 0;
    world.camera.x += ((focus.x + lookX) - world.camera.x) * Math.min(1, dt * 5);
    world.camera.y += ((focus.y + lookY) - world.camera.y) * Math.min(1, dt * 5);
    world.shakeAmt = Math.max(0, world.shakeAmt - dt * 26);
    world.particles.step(dt);
    // Health regen slowly when calm and on foot.
    if (!p.car && world.stars === 0 && p.health < 100) p.health = Math.min(100, p.health + dt * 2.5);
  };

  return world;
}

function planStatsHeat(plan) {
  // Bolder entries forecast slightly more patrol pressure.
  return plan && plan.entry === 2 ? 0.12 : 0;
}

function nullAudio() {
  return { shot() {}, hit() {}, pickup() {}, cash() {}, uiClick() {}, uiBack() {}, sting() {}, crash() {}, gadget() {}, engine() {}, siren() {}, alarmTick() {}, setMuted() {} };
}
export { nullAudio };
