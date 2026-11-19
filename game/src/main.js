// main.js — boot, screen state, the fixed-step loop and orchestration of every system in AMBER COAST.
import { VIEW_W, VIEW_H, WORLD_SEED, PLACES, PLAYER_SPEED_WALK, PLAYER_SPEED_SPRINT, WORLD_SIZE } from './config.js';
import { makeRng, clamp, dist } from './rng.js';
import { generateCity, buildMinimapBase, collideCircleBuildings } from './city.js';
import { makePedestrians, updatePedestrians } from './people.js';
import { Missions } from './missions.js';
import { Input } from './input.js';
import { sfx } from './audio.js';
import { loadSave, writeSave } from './save.js';
import { populateTraffic, updateTraffic } from './traffic.js';
import { Police } from './police.js';
import { Fx } from './fx.js';
import { makeCar, makeTank, makePlane } from './cars.js';
import { weaponById, buildWeapon, WEAPON_CLASSES, weaponsByClass } from './arsenal.js';
import { makeCamera, updateCamera, renderGame } from './render.js';
import { projectPoint } from './view3d.js';
import { drawHud, drawTitle, drawWasted, drawPause, drawSummary, drawPlanning, drawWeaponWheel } from './hud.js';
import { applyShot } from './shots.js';
import { Radio } from './radio.js';
import { defaultPlan, planStats, settlePlan, weaponForPlan, decayIntervalForPlan, entrySpawn, cycleEntry, cycleGetaway, cycleTime, toggleCrew, toggleGear, crewById, getawayById, GEAR_POOL, cycleWeapon } from './planning.js';
import { CIV_TYPES } from './cars.js';

// The one weapon the player carries: a real magazine/reserve the shooting
// code decrements and reloads from, so the HUD readout is the sim's truth.
// Its size is built from the plan's gear (planning.js weaponForPlan).
export function makeWeapon() {
  return buildWeapon(weaponById('venn-9mm'), null);
}

const statusEl = typeof document !== 'undefined' ? document.getElementById('status') : null;
function showError(msg) {
  if (statusEl) { statusEl.textContent = 'ERROR: ' + msg; statusEl.className = 'error-banner'; }
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('error', (ev) => showError(ev.message || 'unknown error'));
}

export function createGame() {
  const rng = makeRng(WORLD_SEED);
  const city = generateCity(WORLD_SEED);
  city.minimap = buildMinimapBase(city);
  const saveData = loadSave();
  const player = { x: PLACES.hospital.x, y: PLACES.hospital.y, angle: -Math.PI / 2, hp: 100, inCar: false, car: null, vx: 0, vy: 0, shootCd: 0, walkPhase: 0 };
  const game = {
    rng, city, saveData, player,
    money: saveData.money,
    missionsCompleted: saveData.missionsCompleted,
    totalEarned: saveData.totalEarned,
    chainsFinished: saveData.chainsFinished || 0,
    bestEscapeMs: saveData.bestEscapeMs || 0,
    timesWasted: saveData.timesWasted || 0,
    carsStolen: saveData.carsStolen || 0,
    chainEarned: 0, jobsThisChain: 0, lastSummary: null, _heatStart: 0, _chainJustDone: false,
    traffic: [], peds: [], bullets: [], toasts: [],
    specials: [], projectiles: [], placed: [], zones: [], distraction: null, wheelOpen: false, wheelClass: 1, wheelIndex: 0,
    weapon: makeWeapon(), radio: new Radio(), jobEarnings: [],
    police: new Police(), missions: new Missions(), fx: new Fx(rng),
    camera: makeCamera(), input: new Input(),
    screen: 'title', help: false,
    time: 0, nowMs: 0, playTime: 0, wastedUntil: 0, idleMissionTimer: 1.2,
    places: PLACES, markedCarRef: null, sfx,
    shotName: null,
    // The merge layer: the current job's plan, its board state, and the
    // economy it settles into (ledger history + REP).
    plan: null, gearFocus: 0, planTarget: null, planOrbitAngle: null,
    timeGrade: 'golden', rep: 0, chainLedger: [], lastLedger: null,
    crewMate: null, lootGrabbedTotal: 0,
  };
  game.traffic = populateTraffic(rng, player);
  // Vehicle variety, parked where they belong: tanks at Fort Sable, planes
  // on the Amber Field runway — all enterable through the same E path.
  game.specials = [
    makeTank(PLACES.base.x - 60, PLACES.base.y - 30, 0),
    makeTank(PLACES.base.x + 70, PLACES.base.y + 55, Math.PI),
    makePlane(PLACES.airport.x - 110, PLACES.airport.y, 0),
    makePlane(PLACES.airport.x + 90, PLACES.airport.y + 52, 0),
  ];
  game.peds = makePedestrians(rng, 64);
  game.camera.x = player.x; game.camera.y = player.y;
  game.toast = (text) => { game.toasts.push({ text, until: game.nowMs + 3800 }); if (game.toasts.length > 4) game.toasts.shift(); };
  game.crime = (level) => { game.police.crime(level, game.nowMs, game); };
  game.persist = () => writeSave({ money: Math.floor(game.money), missionsCompleted: game.missionsCompleted, totalEarned: Math.floor(game.totalEarned), chainsFinished: game.chainsFinished, bestEscapeMs: game.bestEscapeMs, timesWasted: game.timesWasted, carsStolen: game.carsStolen });
  game.showSummary = () => {
    game.lastSummary = {
      jobs: game.jobsThisChain, chainEarned: Math.floor(game.chainEarned),
      money: Math.floor(game.money), totalEarned: Math.floor(game.totalEarned),
      chains: game.chainsFinished, bestEscapeMs: game.bestEscapeMs,
      carsStolen: game.carsStolen, timesWasted: game.timesWasted,
      nextPayBonus: Math.round(game.missions.loop * 25),
      jobRows: game.jobEarnings.slice(-5),
      lastLedger: game.lastLedger,
      repTotal: game.chainLedger.reduce((s, l) => s + l.repGain, 0),
    };
    game.screen = 'summary';
  };
  return game;
}

function allCars(game) {
  const list = game.traffic.concat(game.police.cops).concat(game.specials || []);
  if (game.markedCarRef) list.push(game.markedCarRef);
  return list;
}
function nearestCar(game, maxD) {
  let best = null, bd = maxD;
  for (const car of allCars(game)) {
    if (car.dead) continue;
    const d = dist(game.player.x, game.player.y, car.x, car.y);
    if (d < bd) { bd = d; best = car; }
  }
  return best;
}
export function enterCar(game, car) {
  game.player.inCar = true; game.player.car = car;
  car.occupiedByPlayer = true;
  game.player.x = car.x; game.player.y = car.y; game.player.angle = car.angle;
  sfx.enterCar();
}
function exitCar(game) {
  const car = game.player.car;
  if (!car) return;
  if (car.kind === 'plane' && (car.alt || 0) > 10) { game.toast('Too high to climb out — descend first.'); return; }
  car.occupiedByPlayer = false;
  game.player.inCar = false; game.player.car = null;
  game.player.x = car.x + Math.cos(car.angle + Math.PI / 2) * 26;
  game.player.y = car.y + Math.sin(car.angle + Math.PI / 2) * 26;
  const fixed = collideCircleBuildings(game.city, game.player.x, game.player.y, 8);
  game.player.x = fixed.x; game.player.y = fixed.y;
  car.speed = 0;
}
function tryEnterExit(game) {
  if (game.player.inCar) { exitCar(game); return; }
  const car = nearestCar(game, 56);
  if (!car) return;
  const wasMoving = Math.abs(car.speed) > 24;
  enterCar(game, car);
  game.carsStolen += 1;
  if (car.kind === 'tank') { game.crime(3); game.toast('Military hardware — Fort Sable wants it back. Heat rising.'); }
  else if (car.kind === 'plane') { game.crime(2); game.toast('Aircraft taken from Amber Field. Heat rising.'); }
  else if (car.isCop) game.crime(3);
  else if (wasMoving) game.crime(1);
  if (game.missions.markedCar && car === game.missions.markedCar) game.toast('That is the sedan Venn wants — drive!');
}
function spawnMarkedCar(game) {
  const car = makeCar(game.rng, 4, PLACES.market.x + 60, PLACES.market.y + 21, 0);
  car.speed = 0; car.dir = 0; car.cruise = 0;
  game.markedCarRef = car;
  game.missions.markedCar = car;
}
// ------------------------------------------------------------ the merge
// Planning flow: when a job comes due the board opens over the live street
// (renderer orbits the target block). Executing the plan applies every
// coupling before the mission starts, so what the board promised is what
// the street does.
export function openPlanning(game) {
  const idx = game.missions.index % 5;
  game.plan = defaultPlan(idx);
  game.gearFocus = 0;
  const def = game.missions.current();
  const target = def.pickup || def.deliver;
  game.planTarget = { x: target.x, y: target.y };
  game.planOrbitAngle = null;
  game.screen = 'planning';
}
export function executePlan(game) {
  const plan = game.plan;
  const idx = game.missions.index % 5;
  const def = game.missions.current();
  const stats = planStats(idx, plan, game.missions.loop);
  // Gear builds the weapon; time-of-day grades the light; the escape window
  // paces wanted decay; the forecast is stored for the grab's alarm.
  game.weapon = weaponForPlan(plan);
  game.timeGrade = plan.timeOfDay;
  game.police.decayIntervalMs = decayIntervalForPlan(plan, idx);
  game.planStatsCache = stats;
  // Entry: the crew stages at the chosen way in, by the target.
  const spawn = entrySpawn(def, plan);
  const fixed = collideCircleBuildings(game.city, spawn.x, spawn.y, 8);
  game.player.x = fixed.x; game.player.y = fixed.y;
  game.player.inCar = false; game.player.car = null;
  // Getaway: a car of the chosen type is parked at the entry, engine ready.
  const gw = getawayById(plan.getaway);
  const typeIdx = Math.max(0, CIV_TYPES.findIndex((t) => t.kind === gw.kind));
  let car = game.traffic.find((c) => !c.dead && !c.occupiedByPlayer);
  if (car) {
    const t = CIV_TYPES[typeIdx];
    car.kind = t.kind; car.name = t.name; car.maxSpeed = t.maxSpeed; car.accel = t.accel;
    car.hp = t.hp; car.maxHp = t.hp; car.len = t.kind === 'van' ? 44 : 38; car.wid = t.kind === 'van' ? 21 : 19;
    car.x = fixed.x + 30; car.y = fixed.y + 10; car.angle = 0; car.speed = 0; car.dead = false;
    game.getawayCar = car;
  }
  // Crew: the first pick works the job on foot beside the player.
  const lead = plan.crew.length ? crewById(plan.crew[0]) : null;
  game.crewMate = lead ? { id: lead.id, name: lead.name, color: lead.color, x: fixed.x - 16, y: fixed.y + 14, angle: 0, walkPhase: 0, pose: 'walk' } : null;
  const started = game.missions.start(game.nowMs);
  if (started.stealMarked && !game.markedCarRef) spawnMarkedCar(game);
  game.missions.lootGrabbed = 0;
  game.screen = 'play';
  game.toast('Plan set — ' + def.title + '. Heat forecast ' + stats.heatStars + ' stars.');
}
export function updatePlanning(game, dt) {
  // The street stays alive behind the board.
  updateTraffic(game.rng, game.traffic, dt, game.player, allCars(game));
  updatePedestrians(game.peds, dt, game.nowMs, null);
  game.fx.update(dt);
  const input = game.input, plan = game.plan;
  if (!plan) { game.screen = 'play'; return; }
  if (input.wasPressed('ArrowLeft')) cycleEntry(plan, -1);
  if (input.wasPressed('ArrowRight')) cycleEntry(plan, 1);
  if (input.wasPressed('KeyG')) cycleGetaway(plan, 1);
  if (input.wasPressed('KeyT')) cycleTime(plan, 1);
  for (let i = 0; i < 6; i++) if (input.wasPressed('Digit' + (i + 1))) toggleCrew(plan, ['dex', 'priya', 'bo', 'sana', 'milo', 'ruth'][i]);
  if (input.wasPressed('KeyJ')) cycleWeapon(plan, -1);
  if (input.wasPressed('KeyK')) cycleWeapon(plan, 1);
  if (input.wasPressed('KeyF')) game.gearFocus = ((game.gearFocus || 0) + 1) % GEAR_POOL.length;
  if (input.wasPressed('Space')) toggleGear(plan, GEAR_POOL[game.gearFocus || 0].id);
  if (input.wasPressed('Enter')) executePlan(game);
}
function updateCrewMate(game, dt) {
  const cm = game.crewMate;
  if (!cm || game.player.inCar) return;
  const tx = game.player.x - Math.cos(game.player.angle) * 6 - 14, ty = game.player.y + 16;
  const dx = tx - cm.x, dy = ty - cm.y, d = Math.hypot(dx, dy);
  if (d > 10) {
    const sp = Math.min(d, 190 * dt);
    cm.x += (dx / d) * sp; cm.y += (dy / d) * sp;
    cm.angle = Math.atan2(dy, dx); cm.walkPhase += dt * 7; cm.pose = 'walk';
  } else cm.pose = game.missions.stage === 'grab' ? 'aim' : 'stand';
  const fixed = collideCircleBuildings(game.city, cm.x, cm.y, 8);
  cm.x = fixed.x; cm.y = fixed.y;
}
function missionCtx(game) {
  return {
    player: game.player, now: game.nowMs,
    addMoney: (n) => { game.money += n; game.totalEarned += n; },
    setWanted: (n) => game.police.setStars(Math.max(game.police.stars, n), game.nowMs),
    toast: (t) => game.toast(t), sfx,
    // The grab runs on the plan: its target is the board's loot estimate and
    // its pace is the board's grab rate; when it completes, the alarm trips
    // at exactly the forecast heat.
    grabTarget: () => (game.planStatsCache ? game.planStatsCache.loot : 0),
    grabRate: () => (game.planStatsCache ? game.planStatsCache.grabRate : 99999),
    onGrabDone: (loot) => {
      game.lootGrabbedTotal = loot;
      if (game.planStatsCache) game.police.setStars(Math.max(game.police.stars, game.planStatsCache.heatStars), game.nowMs);
    },
    // Settlement: the job's ledger is computed from the plan and the take
    // actually grabbed; the NET is what the player banks.
    payFor: (def, lootGrabbed) => {
      const idx = game.missions.index % 5;
      const gross = lootGrabbed > 0 ? Math.round(lootGrabbed) : planStats(idx, game.plan || defaultPlan(idx), game.missions.loop).loot;
      const led = settlePlan(idx, game.plan || defaultPlan(idx), gross);
      game.lastLedger = led;
      game.chainLedger.push(led);
      game.rep += led.repGain;
      return led.net;
    },
    onMissionComplete: (def, pay) => {
      game.missionsCompleted += 1;
      game.jobsThisChain += 1;
      game.chainEarned += pay || 0;
      game.jobEarnings.push({ title: def.title, pay: pay || 0 });
      game.persist();
      // missions.js calls onChainDone BEFORE onMissionComplete for the final job,
      // so the summary is shown here, once the last job's pay is counted.
      if (game._chainJustDone) {
        game._chainJustDone = false;
        game.showSummary();
        game.chainEarned = 0; game.jobsThisChain = 0; game.jobEarnings = []; game.chainLedger = [];
        game.persist();
      }
    },
    onChainDone: () => { game.chainsFinished += 1; game._chainJustDone = true; game.persist(); },
  };
}
function startNextMissionIfIdle(game, dt) {
  if (game.missions.active || game.screen !== 'play') return;
  game.idleMissionTimer -= dt;
  if (game.idleMissionTimer > 0) return;
  game.idleMissionTimer = 2.2;
  // Every job is planned first: the board opens over the target street.
  openPlanning(game);
}
function killPlayer(game) {
  game.timesWasted += 1;
  game.screen = 'wasted';
  game.wastedUntil = game.nowMs + 2600;
  sfx.sting();
}
function respawn(game) {
  game.money = Math.max(0, Math.floor(game.money * 0.9));
  if (game.player.inCar) exitCar(game);
  game.player.hp = 100;
  game.player.x = PLACES.hospital.x; game.player.y = PLACES.hospital.y;
  game.police.clear(); game.police.cops = [];
  game.missions.onPlayerDeath(game.nowMs);
  game.screen = 'play';
  game.persist();
}

// ------------------------------------------------------------ explosives
// One blast routine every explosive behaviour funnels into: real area
// damage to cars and peds, a scorch of fx, and heat for the player.
export function explodeAt(game, x, y, radius, damage) {
  game.fx.explosion(x, y);
  for (const car of allCars(game)) {
    if (car.dead) continue;
    const d = dist(x, y, car.x, car.y);
    if (d < radius + 20) { car.hp -= damage * (1 - d / (radius + 40)); if (car.hp <= 0) car.dead = true; }
  }
  for (const ped of game.peds) {
    if (!ped.dead && dist(x, y, ped.x, ped.y) < radius) { ped.dead = true; ped.respawnAt = game.nowMs + 9000; game.fx.blood(ped.x, ped.y); }
  }
  if (!game.player.inCar && dist(x, y, game.player.x, game.player.y) < radius * 0.7) game.player.hp -= damage * 0.35;
  game.police.addStars(1, game.nowMs);
}
function throwProjectile(game, w, behavior) {
  const p = game.player, a = p.angle;
  game.projectiles.push({
    behavior, defId: w.defId, name: w.name, damage: w.damage, blast: w.blast || 60,
    x: p.x + Math.cos(a) * 14, y: p.y + Math.sin(a) * 14, z: 9,
    vx: Math.cos(a) * 330, vy: Math.sin(a) * 330, vz: 130,
    fuse: behavior === 'grenade' ? 1.15 : behavior === 'pipe' ? 0.6 : 99, stuckTo: null, life: 6,
  });
}
function plantCharge(game, w, behavior) {
  const p = game.player;
  game.placed.push({ behavior, defId: w.defId, name: w.name, damage: w.damage, blast: w.blast || 90, x: p.x, y: p.y, armedAt: game.nowMs, timer: behavior === 'satchel' ? 5000 : 0 });
  game.toast(w.name + ' planted' + (behavior === 'satchel' ? ' — 5 seconds!' : ' — X or fire again to detonate.'));
}
function detonatePlaced(game, filter) {
  let n = 0;
  for (const pl of game.placed) {
    if (pl.dead) continue;
    if (filter && !filter(pl)) continue;
    pl.dead = true; n++; explodeAt(game, pl.x, pl.y, pl.blast, pl.damage);
  }
  game.placed = game.placed.filter((pl) => !pl.dead);
  // Stuck bombs ride their car: detonate those too.
  for (const pr of game.projectiles) {
    if (pr.stuckTo && !pr.dead) { pr.dead = true; explodeAt(game, pr.stuckTo.x, pr.stuckTo.y, pr.blast, pr.damage); n++; }
  }
  game.projectiles = game.projectiles.filter((pr) => !pr.dead);
  return n;
}
function fireExplosive(game, w) {
  const b = w.behavior;
  if (b === 'remote' || b === 'sticky') {
    // Second press with a live charge out = the detonator, not a new throw.
    const live = game.placed.some((pl) => pl.behavior === 'remote') || game.projectiles.some((pr) => pr.stuckTo);
    if (live) { detonatePlaced(game, (pl) => pl.behavior === 'remote'); return true; }
  }
  if (b === 'remote' || b === 'mine' || b === 'satchel') { plantCharge(game, w, b); return true; }
  throwProjectile(game, w, b);
  return true;
}
function updateExplosives(game, dt) {
  // Thrown projectiles: a real arc under gravity until they land or fuse out.
  for (const pr of game.projectiles) {
    if (pr.dead) continue;
    if (pr.stuckTo) { pr.x = pr.stuckTo.x; pr.y = pr.stuckTo.y; pr.z = 8; if (pr.stuckTo.dead) { pr.dead = true; explodeAt(game, pr.x, pr.y, pr.blast, pr.damage); } continue; }
    pr.life -= dt; pr.fuse -= dt;
    pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt; pr.vz -= 520 * dt;
    let landed = false;
    if (pr.z <= 1) { pr.z = 1; landed = true; }
    // Sticky bombs attach to the first car they touch.
    if (pr.behavior === 'sticky') {
      for (const car of allCars(game)) { if (!car.dead && dist(pr.x, pr.y, car.x, car.y) < 24) { pr.stuckTo = car; break; } }
      if (pr.stuckTo) continue;
    }
    if (pr.behavior === 'rocket' || pr.behavior === 'cannon') {
      for (const car of allCars(game)) { if (!car.dead && car !== game.player.car && dist(pr.x, pr.y, car.x, car.y) < 24) { pr.dead = true; explodeAt(game, pr.x, pr.y, pr.blast, pr.damage); break; } }
      if (pr.dead || landed || pr.life <= 0) { if (!pr.dead) { pr.dead = true; explodeAt(game, pr.x, pr.y, pr.blast, pr.damage); } }
      continue;
    }
    if (pr.fuse <= 0 || (landed && (pr.behavior === 'molotov' || pr.behavior === 'gas' || pr.behavior === 'flare' || pr.behavior === 'flash'))) {
      pr.dead = true;
      if (pr.behavior === 'grenade' || pr.behavior === 'pipe') explodeAt(game, pr.x, pr.y, pr.blast, pr.damage);
      else if (pr.behavior === 'molotov') { game.zones.push({ kind: 'fire', x: pr.x, y: pr.y, r: 34, until: game.nowMs + 6000, dps: 26 }); game.fx.explosion(pr.x, pr.y); }
      else if (pr.behavior === 'gas') { game.zones.push({ kind: 'gas', x: pr.x, y: pr.y, r: 52, until: game.nowMs + 8000, dps: 0 }); game.toast('Tear gas — the street clears its throat.'); }
      else if (pr.behavior === 'flare') { game.zones.push({ kind: 'flare', x: pr.x, y: pr.y, r: 60, until: game.nowMs + 10000, dps: 0 }); game.distraction = { x: pr.x, y: pr.y, until: game.nowMs + 8000 }; }
      else if (pr.behavior === 'flash') {
        game.fx.explosion(pr.x, pr.y);
        for (const cop of game.police.cops) if (dist(pr.x, pr.y, cop.x, cop.y) < pr.blast + 40) cop.stunUntil = game.nowMs + 3000;
        for (const ped of game.peds) if (dist(pr.x, pr.y, ped.x, ped.y) < 120) { ped.fleeUntil = game.nowMs + 2200; ped.fleeX = pr.x; ped.fleeY = pr.y; }
      }
      continue;
    }
    if (landed) { pr.vx *= 0.4; pr.vy *= 0.4; pr.vz = 0; }
    if (pr.life <= 0) pr.dead = true;
  }
  game.projectiles = game.projectiles.filter((pr) => !pr.dead);
  // Planted charges: satchel timers run down; mines wait for a trigger.
  for (const pl of game.placed) {
    if (pl.dead) continue;
    if (pl.behavior === 'satchel' && game.nowMs - pl.armedAt >= pl.timer) { pl.dead = true; explodeAt(game, pl.x, pl.y, pl.blast, pl.damage); continue; }
    if (pl.behavior === 'mine') {
      const trig = allCars(game).some((c) => !c.dead && c !== game.player.car && dist(pl.x, pl.y, c.x, c.y) < 27) || game.peds.some((pd) => !pd.dead && dist(pl.x, pl.y, pd.x, pd.y) < 18);
      if (trig && game.nowMs - pl.armedAt > 700) { pl.dead = true; explodeAt(game, pl.x, pl.y, pl.blast, pl.damage); }
    }
  }
  game.placed = game.placed.filter((pl) => !pl.dead);
  // Lingering zones: fire patches burn what stands in them; gas slows the law.
  game.zones = game.zones.filter((z) => game.nowMs < z.until);
  for (const z of game.zones) {
    if (z.kind === 'fire') {
      if (game.rng.chance(0.3)) game.fx.smoke(z.x + game.rng.range(-14, 14), z.y + game.rng.range(-14, 14));
      for (const car of allCars(game)) if (!car.dead && dist(z.x, z.y, car.x, car.y) < z.r) { car.hp -= z.dps * dt; if (car.hp <= 0) { car.dead = true; game.fx.explosion(car.x, car.y); } }
      for (const ped of game.peds) if (!ped.dead && dist(z.x, z.y, ped.x, ped.y) < z.r) { ped.fleeUntil = game.nowMs + 900; ped.fleeX = z.x; ped.fleeY = z.y; }
    }
    if (z.kind === 'gas') for (const cop of game.police.cops) if (dist(z.x, z.y, cop.x, cop.y) < z.r) cop.gassedUntil = game.nowMs + 400;
  }
  if (game.distraction && game.nowMs > game.distraction.until) game.distraction = null;
}
// ------------------------------------------------------------ weapon wheel
export function cycleWheel(game, dClass, dIndex) {
  if (dClass) { game.wheelClass = (game.wheelClass + dClass + WEAPON_CLASSES.length) % WEAPON_CLASSES.length; game.wheelIndex = 0; }
  if (dIndex) { const n = weaponsByClass(WEAPON_CLASSES[game.wheelClass].id).length; game.wheelIndex = (game.wheelIndex + dIndex + n) % n; }
}
export function equipWheelSelection(game) {
  const def = weaponsByClass(WEAPON_CLASSES[game.wheelClass].id)[game.wheelIndex];
  if (def) game.weapon = buildWeapon(def, game.plan);
  return def;
}

function updatePlayerOnFoot(game, dt) {
  const p = game.player;
  const ix = game.input.axisX(), iy = game.input.axisY();
  const sprint = game.input.isDown('ShiftLeft') || game.input.isDown('ShiftRight');
  const speed = sprint ? PLAYER_SPEED_SPRINT : PLAYER_SPEED_WALK;
  let vx = 0, vy = 0;
  if (ix !== 0 || iy !== 0) {
    const len = Math.sqrt(ix * ix + iy * iy);
    vx = (ix / len) * speed; vy = (iy / len) * speed;
    p.angle = Math.atan2(vy, vx);
    p.walkPhase = (p.walkPhase || 0) + dt * 6.4 * (speed / PLAYER_SPEED_WALK);
  }
  p.vx = vx; p.vy = vy;
  const fixed = collideCircleBuildings(game.city, p.x + vx * dt, p.y + vy * dt, 8);
  p.x = fixed.x; p.y = fixed.y;
  // Shooting: the arsenal table drives everything — interval from rps,
  // spread fanned per pellet, bullet life from range, damage per hit.
  // Reload is timed from the table; an empty mag refills after reloadMs.
  p.shootCd -= dt;
  const w = game.weapon;
  if (w && w.mag <= 0 && w.reserve > 0 && !w.reloadUntil) w.reloadUntil = game.nowMs + (w.reloadMs || 1200);
  if (w && w.reloadUntil && game.nowMs >= w.reloadUntil) {
    const take = Math.min(w.magSize, w.reserve);
    w.mag = take; w.reserve -= take; w.reloadUntil = 0;
  }
  if (game.input.wasPressed('KeyX')) detonatePlaced(game, null);
  if (game.input.isDown('Space') && p.shootCd <= 0 && w && w.mag > 0 && !w.reloadUntil) {
    p.shootCd = 1 / Math.max(0.2, w.rps || 8);
    w.mag -= 1;
    if (w.cls === 'EXP') { fireExplosive(game, w); }
    else if (w.cls === 'RL') {
      game.projectiles.push({ behavior: 'rocket', defId: w.defId, name: w.name, damage: w.damage, blast: w.blast || 90, x: p.x + Math.cos(p.angle) * 16, y: p.y + Math.sin(p.angle) * 16, z: 10, vx: Math.cos(p.angle) * 560, vy: Math.sin(p.angle) * 560, vz: 0, fuse: 99, stuckTo: null, life: 1.4 });
      game.fx.smoke(p.x, p.y); game.police.addStars(1, game.nowMs);
    } else {
      const pellets = w.pellets || 1;
      for (let i = 0; i < pellets; i++) {
        const ang = p.angle + game.rng.range(-(w.spread || 0.02), (w.spread || 0.02)) + (pellets > 1 ? (i - (pellets - 1) / 2) * 0.03 : 0);
        game.bullets.push({ x: p.x + Math.cos(ang) * 12, y: p.y + Math.sin(ang) * 12, angle: ang, life: (w.range || 340) / 720, damage: w.damage || 13, speed: 720 });
      }
      game.fx.muzzle(p.x, p.y, p.angle);
      sfx.shoot();
    }
    game.lastShotAt = game.nowMs;
  }
}
function updatePlayerDriving(game, dt) {
  const p = game.player, car = p.car;
  if (car.kind === 'tank') {
    // Tank: heavy tracked drive; the turret traverses toward the nearest
    // hostile and Space fires the cannon (a real explosive shell).
    const fwdT = game.input.isDown('KeyW') || game.input.isDown('ArrowUp');
    const backT = game.input.isDown('KeyS') || game.input.isDown('ArrowDown');
    const leftT = game.input.isDown('KeyA') || game.input.isDown('ArrowLeft');
    const rightT = game.input.isDown('KeyD') || game.input.isDown('ArrowRight');
    if (fwdT) car.speed += car.accel * dt; else if (backT) car.speed -= car.accel * 0.7 * dt;
    else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 60 * dt);
    car.speed = clamp(car.speed, -55, car.maxSpeed);
    car.angle += ((leftT ? -1 : 0) + (rightT ? 1 : 0)) * 0.85 * dt * (car.speed < 0 ? -1 : 1) * clamp(Math.abs(car.speed) / 40 + 0.35, 0, 1);
    const nx = car.x + Math.cos(car.angle) * car.speed * dt, ny = car.y + Math.sin(car.angle) * car.speed * dt;
    const fixedT = collideCircleBuildings(game.city, nx, ny, 17);
    car.x = clamp(fixedT.x, 20, WORLD_SIZE - 20); car.y = clamp(fixedT.y, 20, WORLD_SIZE - 20);
    p.x = car.x; p.y = car.y; p.angle = car.angle;
    p.vx = Math.cos(car.angle) * car.speed; p.vy = Math.sin(car.angle) * car.speed;
    let tgt = null, bd = 620;
    for (const c of game.police.cops) { if (c.dead) continue; const d = dist(car.x, car.y, c.x, c.y); if (d < bd) { bd = d; tgt = c; } }
    const want = tgt ? Math.atan2(tgt.y - car.y, tgt.x - car.x) : car.angle;
    let diff = want - (car.turret || 0);
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.turret = (car.turret || 0) + clamp(diff, -1.5 * dt, 1.5 * dt);
    car.cannonCd = (car.cannonCd || 0) - dt;
    if (game.input.isDown('Space') && car.cannonCd <= 0) {
      car.cannonCd = 1.4;
      game.projectiles.push({ behavior: 'cannon', defId: 'tank-cannon', name: 'TANK CANNON', damage: 130, blast: 95, x: car.x + Math.cos(car.turret) * 34, y: car.y + Math.sin(car.turret) * 34, z: 11, vx: Math.cos(car.turret) * 620, vy: Math.sin(car.turret) * 620, vz: 0, fuse: 99, stuckTo: null, life: 1.1 });
      game.fx.addShake(5); game.police.addStars(1, game.nowMs); sfx.shoot();
    }
    return;
  }
  if (car.kind === 'plane') {
    // Plane: throttle with W/S, steer with A/D; past take-off speed the
    // airframe lifts, buildings stop colliding, and it settles back when
    // slow. Take-off itself draws heat — the roster reacts to air use.
    const fwdP = game.input.isDown('KeyW') || game.input.isDown('ArrowUp');
    const backP = game.input.isDown('KeyS') || game.input.isDown('ArrowDown');
    const leftP = game.input.isDown('KeyA') || game.input.isDown('ArrowLeft');
    const rightP = game.input.isDown('KeyD') || game.input.isDown('ArrowRight');
    if (fwdP) car.speed += car.accel * dt; else if (backP) car.speed -= 240 * dt;
    else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 18 * dt);
    car.speed = clamp(car.speed, 0, car.maxSpeed + 60);
    car.angle += ((leftP ? -1 : 0) + (rightP ? 1 : 0)) * (0.55 + (car.alt || 0) / 160) * dt * clamp(Math.abs(car.speed) / 90, 0, 1);
    const wasAir = (car.alt || 0) > 10;
    if (car.speed > 175) car.alt = Math.min(130, (car.alt || 0) + (car.speed - 175) * dt * 0.42);
    else if (car.speed < 150) car.alt = Math.max(0, (car.alt || 0) - 55 * dt);
    car.airborne = (car.alt || 0) > 10;
    if (car.airborne && !wasAir) { game.police.setStars(Math.max(game.police.stars, 3), game.nowMs); game.toast('Airborne — ACPD is scrambling. 3 stars.'); }
    const nx = car.x + Math.cos(car.angle) * car.speed * dt, ny = car.y + Math.sin(car.angle) * car.speed * dt;
    if ((car.alt || 0) > 10) { car.x = clamp(nx, 24, WORLD_SIZE - 24); car.y = clamp(ny, 24, WORLD_SIZE - 24); }
    else { const fx2 = collideCircleBuildings(game.city, nx, ny, 16); car.x = clamp(fx2.x, 24, WORLD_SIZE - 24); car.y = clamp(fx2.y, 24, WORLD_SIZE - 24); }
    p.x = car.x; p.y = car.y; p.angle = car.angle;
    p.vx = Math.cos(car.angle) * car.speed; p.vy = Math.sin(car.angle) * car.speed;
    return;
  }
  const fwd = game.input.isDown('KeyW') || game.input.isDown('ArrowUp');
  const back = game.input.isDown('KeyS') || game.input.isDown('ArrowDown');
  const left = game.input.isDown('KeyA') || game.input.isDown('ArrowLeft');
  const right = game.input.isDown('KeyD') || game.input.isDown('ArrowRight');
  const brake = game.input.isDown('Space');
  const maxFwd = Math.min(360, Math.max(230, car.maxSpeed + 30));
  if (fwd) car.speed += 300 * dt;
  else if (back) car.speed -= (car.speed > 4 ? 330 : 190) * dt;
  else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 42 * dt);
  if (brake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 430 * dt);
  car.speed = clamp(car.speed, -130, maxFwd);
  const steer = (left ? -1 : 0) + (right ? 1 : 0);
  const steerAuthority = clamp(Math.abs(car.speed) / 120, 0, 1) * (brake ? 1.5 : 1);
  car.angle += steer * 1.85 * steerAuthority * dt * (car.speed < 0 ? -1 : 1);
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  const fixed = collideCircleBuildings(game.city, nx, ny, 15);
  if (Math.abs(fixed.x - nx) > 0.6 || Math.abs(fixed.y - ny) > 0.6) {
    const impact = Math.abs(car.speed);
    if (impact > 55) {
      car.hp -= impact * 0.09;
      game.fx.sparks(car.x, car.y); game.fx.addShake(clamp(impact / 26, 2, 9));
      sfx.crash();
    }
    car.speed = -car.speed * 0.28;
  }
  car.x = clamp(fixed.x, 18, WORLD_SIZE - 18); car.y = clamp(fixed.y, 18, WORLD_SIZE - 18);
  p.x = car.x; p.y = car.y; p.angle = car.angle;
  p.vx = Math.cos(car.angle) * car.speed; p.vy = Math.sin(car.angle) * car.speed;
  if (car.hp < car.maxHp * 0.3 && Math.abs(car.speed) > 10 && game.rng.chance(0.12)) game.fx.smoke(car.x, car.y);
  if (car.hp <= 0 && !car.dead) {
    car.dead = true;
    game.fx.explosion(car.x, car.y);
    p.hp -= 42;
    exitCar(game);
    game.toast('Vehicle destroyed!');
    if (p.hp <= 0) killPlayer(game);
  }
}
function updateBullets(game, dt) {
  for (const b of game.bullets) {
    b.x += Math.cos(b.angle) * (b.speed || 640) * dt;
    b.y += Math.sin(b.angle) * (b.speed || 640) * dt;
    b.life -= dt;
    for (const ped of game.peds) {
      if (!ped.dead && b.life > 0 && dist(b.x, b.y, ped.x, ped.y) < 10) {
        ped.hp = (ped.hp === undefined ? 30 : ped.hp) - (b.damage || 13);
        game.fx.blood(ped.x, ped.y);
        if (ped.hp <= 0) { ped.dead = true; ped.respawnAt = game.nowMs + 9000; game.police.addStars(1, game.nowMs); }
        else { ped.fleeUntil = game.nowMs + 1600; ped.fleeX = b.x; ped.fleeY = b.y; }
        b.life = 0;
      }
    }
    for (const car of allCars(game)) {
      if (b.life > 0 && !car.dead && dist(b.x, b.y, car.x, car.y) < 22) {
        car.hp -= (b.damage || 13); game.fx.sparks(b.x, b.y); b.life = 0;
        if (car.isCop) game.police.addStars(1, game.nowMs);
        if (car.hp <= 0) { car.dead = true; game.fx.explosion(car.x, car.y); }
      }
    }
  }
  game.bullets = game.bullets.filter((b) => b.life > 0);
}
function updateCarCollisions(game) {
  const cars = allCars(game).filter((c) => !c.dead && !(c.kind === 'plane' && (c.alt || 0) > 10));
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const d = dist(a.x, a.y, b.x, b.y);
      if (d > 0 && d < 32) {
        const push = (32 - d) / 2;
        const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
        if (!a.occupiedByPlayer) { a.x -= ux * push; a.y -= uy * push; }
        if (!b.occupiedByPlayer) { b.x += ux * push; b.y += uy * push; }
        const rel = Math.abs(a.speed - b.speed);
        if (rel > 70 && game.nowMs - (game._lastCrashAt || 0) > 300) {
          game._lastCrashAt = game.nowMs;
          a.hp -= 5; b.hp -= 5;
          game.fx.sparks((a.x + b.x) / 2, (a.y + b.y) / 2);
          game.fx.addShake(4); sfx.crash();
          a.speed *= 0.55; b.speed *= 0.55;
        }
      }
    }
  }
  // Running over a pedestrian is a crime and slows the car.
  const p = game.player;
  if (p.inCar && p.car && Math.abs(p.car.speed) > 55) {
    for (const ped of game.peds) {
      if (!ped.dead && dist(p.x, p.y, ped.x, ped.y) < 17) {
        ped.dead = true; ped.respawnAt = game.nowMs + 9000;
        game.fx.blood(ped.x, ped.y);
        game.police.addStars(1, game.nowMs);
        p.car.speed *= 0.72;
      }
    }
  }
}
export function updateGame(game, dt) {
  if (game.frozen) { game.input.endFrame(); return; }
  game.time += dt; game.nowMs = game.time * 1000;
  const input = game.input;
  if (game.screen === 'title') {
    if (input.wasPressed('Enter')) { game.screen = 'play'; sfx.unlock(); game.toast('Welcome to the Amber Coast. Venn has work for you.'); }
    updateTraffic(game.rng, game.traffic, dt, game.player, allCars(game));
    updatePedestrians(game.peds, dt, game.nowMs, null);
    game.fx.update(dt);
    updateCamera(game.camera, game.player, 0, 0, dt);
    input.endFrame();
    return;
  }
  if (game.screen === 'wasted') {
    game.fx.update(dt);
    if (game.nowMs >= game.wastedUntil) respawn(game);
    input.endFrame();
    return;
  }
  if (game.screen === 'paused') {
    if (input.wasPressed('KeyP')) { game.screen = 'play'; game.help = false; }
    input.endFrame();
    return;
  }
  if (game.screen === 'summary') {
    updateTraffic(game.rng, game.traffic, dt, game.player, allCars(game));
    updatePedestrians(game.peds, dt, game.nowMs, null);
    game.fx.update(dt);
    updateCamera(game.camera, game.player, 0, 0, dt);
    if (input.wasPressed('Enter')) {
      game.screen = 'play';
      game.toast('Venn: chain ' + (game.missions.loop + 1) + ' pays +25% a job.');
    }
    input.endFrame();
    return;
  }
  if (game.screen === 'planning') {
    updatePlanning(game, dt);
    input.endFrame();
    return;
  }
  // Play.
  game.playTime += dt;
  if (input.wasPressed('KeyP')) { game.screen = 'paused'; game.help = false; input.endFrame(); return; }
  if (input.wasPressed('KeyH')) { game.screen = 'paused'; game.help = true; input.endFrame(); return; }
  if (input.wasPressed('KeyE')) tryEnterExit(game);
  if (input.wasPressed('KeyR')) { game.radio.cycle(); game.toast('Radio: ' + game.radio.label()); }
  if (game.player.inCar) updatePlayerDriving(game, dt); else updatePlayerOnFoot(game, dt);
  if (game.player.hp <= 0) { killPlayer(game); input.endFrame(); return; }
  updateBullets(game, dt);
  updateTraffic(game.rng, game.traffic, dt, game.player, allCars(game));
  game.police.update(game.rng, dt, game.nowMs, game.player, game.traffic, game.fx, game.distraction);
  updateExplosives(game, dt);
  // Weapon wheel (transient): Q opens, arrows/A-D pick the class segment,
  // W/S pick within the class, Q or Enter equips and closes.
  if (input.wasPressed('KeyQ')) {
    game.wheelOpen = !game.wheelOpen;
    if (!game.wheelOpen) equipWheelSelection(game);
  }
  if (game.wheelOpen) {
    if (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA')) cycleWheel(game, -1, 0);
    if (input.wasPressed('ArrowRight') || input.wasPressed('KeyD')) cycleWheel(game, 1, 0);
    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) cycleWheel(game, 0, -1);
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) cycleWheel(game, 0, 1);
    if (input.wasPressed('Enter')) { equipWheelSelection(game); game.wheelOpen = false; }
  }
  if (game.police.stars >= 2 && !game._heatStart) game._heatStart = game.nowMs;
  if (game.police.stars === 0 && game._heatStart) {
    const esc = game.nowMs - game._heatStart;
    if (!game.bestEscapeMs || esc < game.bestEscapeMs) { game.bestEscapeMs = esc; game.persist(); }
    game._heatStart = 0;
  }
  if (game.player.hp <= 0) { killPlayer(game); input.endFrame(); return; }
  const danger = [];
  if (game.lastShotAt && game.nowMs - game.lastShotAt < 500) danger.push({ x: game.player.x, y: game.player.y, r: 130 });
  if (game.player.inCar && game.player.car && Math.abs(game.player.car.speed) > 165) danger.push({ x: game.player.x, y: game.player.y, r: 95 });
  updatePedestrians(game.peds, dt, game.nowMs, danger.length ? danger : null);
  updateCrewMate(game, dt);
  updateCarCollisions(game);
  startNextMissionIfIdle(game, dt);
  game.missions.update(dt, missionCtx(game));
  if (game.markedCarRef && game.markedCarRef.dead) { game.markedCarRef = null; game.missions.markedCar = null; if (game.missions.stage === 'stealMarked') spawnMarkedCar(game); }
  game.fx.update(dt);
  const tvx = game.player.inCar && game.player.car ? game.player.vx : game.player.vx;
  updateCamera(game.camera, game.player, tvx, game.player.vy, dt);
  game.toasts = game.toasts.filter((t) => game.nowMs < t.until + 400);
  input.endFrame();
}

function boot() {
  const canvas = typeof document !== 'undefined' ? document.getElementById('game') : null;
  const game = createGame();
  game.canvas = canvas;
  const step = (dt) => updateGame(game, dt || 1 / 60);
  // Deterministic screenshot staging.
  try {
    const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    const shot = params.get('shot');
    if (shot) { game.shotName = shot; applyShot(game, shot, step); }
  } catch (e) { showError(e.message || String(e)); }
  if (typeof window !== 'undefined') window.__MN = { game, step, project: projectPoint, render: renderGame };
  if (!canvas || !canvas.getContext) return game;
  const ctx = canvas.getContext('2d');
  let last = 0, acc = 0;
  const frame = (ts) => {
    try {
      if (!last) last = ts;
      let elapsed = Math.min(0.12, (ts - last) / 1000); last = ts; acc += elapsed;
      while (acc >= 1 / 60) { updateGame(game, 1 / 60); acc -= 1 / 60; }
      ctx.clearRect(0, 0, VIEW_W, VIEW_H);
      renderGame(ctx, game);
      if (game.screen === 'play' || game.screen === 'paused') drawHud(ctx, game);
      if (game.wheelOpen && game.screen === 'play') drawWeaponWheel(ctx, game);
      if (game.screen === 'planning') drawPlanning(ctx, game);
      if (game.screen === 'summary') drawSummary(ctx, game);
      if (game.screen === 'title') { drawHudTitleSafe(ctx, game); }
      if (game.screen === 'wasted') drawWasted(ctx, game);
      if (game.screen === 'paused') drawPause(ctx, game, game.help);
    } catch (e) { showError(e.message || String(e)); }
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(frame);
  };
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(frame);
  return game;
}
function drawHudTitleSafe(ctx, game) {
  // Title shows the live city plus its own overlay; the HUD's minimap stays off the title.
  drawTitle(ctx, game);
}
try { boot(); } catch (e) { showError(e.message || String(e)); throw e; }
