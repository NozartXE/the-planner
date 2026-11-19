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
import { makeCar } from './cars.js';
import { makeCamera, updateCamera, renderGame } from './render.js';
import { projectPoint } from './view3d.js';
import { drawHud, drawTitle, drawWasted, drawPause, drawSummary } from './hud.js';
import { applyShot } from './shots.js';
import { Radio } from './radio.js';

// The one weapon the player carries: a real magazine/reserve the shooting
// code decrements and reloads from, so the HUD readout is the sim's truth.
export function makeWeapon() {
  return { name: 'VENN 9MM', magSize: 12, mag: 12, reserve: 48 };
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
    weapon: makeWeapon(), radio: new Radio(), jobEarnings: [],
    police: new Police(), missions: new Missions(), fx: new Fx(rng),
    camera: makeCamera(), input: new Input(),
    screen: 'title', help: false,
    time: 0, nowMs: 0, playTime: 0, wastedUntil: 0, idleMissionTimer: 1.2,
    places: PLACES, markedCarRef: null, sfx,
    shotName: null,
  };
  game.traffic = populateTraffic(rng, player);
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
    };
    game.screen = 'summary';
  };
  return game;
}

function allCars(game) {
  const list = game.traffic.concat(game.police.cops);
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
  if (car.isCop) game.crime(3);
  else if (wasMoving) game.crime(1);
  if (game.missions.markedCar && car === game.missions.markedCar) game.toast('That is the sedan Venn wants — drive!');
}
function spawnMarkedCar(game) {
  const car = makeCar(game.rng, 4, PLACES.market.x + 60, PLACES.market.y + 21, 0);
  car.speed = 0; car.dir = 0; car.cruise = 0;
  game.markedCarRef = car;
  game.missions.markedCar = car;
}
function missionCtx(game) {
  return {
    player: game.player, now: game.nowMs,
    addMoney: (n) => { game.money += n; game.totalEarned += n; },
    setWanted: (n) => game.police.setStars(Math.max(game.police.stars, n), game.nowMs),
    toast: (t) => game.toast(t), sfx,
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
        game.chainEarned = 0; game.jobsThisChain = 0; game.jobEarnings = [];
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
  const def = game.missions.start(game.nowMs);
  if (def.stealMarked && !game.markedCarRef) spawnMarkedCar(game);
  // The briefing itself is shown by the HUD briefing panel; no duplicate toast.
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
  // Shooting: spends the weapon's magazine; an empty mag reloads from the
  // reserve (and with no reserve left, the trigger simply clicks dry).
  p.shootCd -= dt;
  const w = game.weapon;
  if (w && w.mag <= 0 && w.reserve > 0) {
    const take = Math.min(w.magSize, w.reserve);
    w.mag = take; w.reserve -= take;
  }
  if (game.input.isDown('Space') && p.shootCd <= 0 && w && w.mag > 0) {
    p.shootCd = 0.18;
    w.mag -= 1;
    game.bullets.push({ x: p.x + Math.cos(p.angle) * 12, y: p.y + Math.sin(p.angle) * 12, angle: p.angle, life: 0.55 });
    game.fx.muzzle(p.x, p.y, p.angle);
    sfx.shoot();
    game.lastShotAt = game.nowMs;
  }
}
function updatePlayerDriving(game, dt) {
  const p = game.player, car = p.car;
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
    b.x += Math.cos(b.angle) * 640 * dt;
    b.y += Math.sin(b.angle) * 640 * dt;
    b.life -= dt;
    for (const ped of game.peds) {
      if (!ped.dead && b.life > 0 && dist(b.x, b.y, ped.x, ped.y) < 10) {
        ped.dead = true; ped.respawnAt = game.nowMs + 9000;
        game.fx.blood(ped.x, ped.y);
        game.police.addStars(1, game.nowMs);
        b.life = 0;
      }
    }
    for (const car of allCars(game)) {
      if (b.life > 0 && !car.dead && dist(b.x, b.y, car.x, car.y) < 22) {
        car.hp -= 13; game.fx.sparks(b.x, b.y); b.life = 0;
        if (car.isCop) game.police.addStars(1, game.nowMs);
        if (car.hp <= 0) { car.dead = true; game.fx.explosion(car.x, car.y); }
      }
    }
  }
  game.bullets = game.bullets.filter((b) => b.life > 0);
}
function updateCarCollisions(game) {
  const cars = allCars(game).filter((c) => !c.dead);
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
  game.police.update(game.rng, dt, game.nowMs, game.player, game.traffic, game.fx);
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
