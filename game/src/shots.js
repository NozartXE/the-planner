// shots.js — deterministic staging for screenshots: ?shot=title|chase|mission|results runs the real
// simulation first, then sets one explicit, coherent mid-chain state per shot and freezes it.
// Everything that appears on screen (money, stars, mission, speeds, crowds, cops, effects) is set
// AFTER the run steps, so a re-capture is byte-identical and nothing drifts between frames.
import { makeCopCar } from './cars.js';
import { CHAIN } from './missions.js';
function snapCamera(game) {
  game.camera.x = game.player.x; game.camera.y = game.player.y;
}
function setCar(car, x, y, angle, speed, style) {
  car.x = x; car.y = y; car.angle = angle; car.speed = speed; car.dead = false;
  car.dir = angle === 0 ? 0 : angle === Math.PI ? 2 : angle > 0.2 ? 1 : angle < -0.2 ? 3 : car.dir;
  if (style) {
    if (style.kind) { car.kind = style.kind; car.len = style.kind === 'van' ? 44 : 38; car.wid = style.kind === 'van' ? 21 : 19; }
    if (style.color) car.color = style.color;
    if (style.hp) car.hp = style.hp;
    if (style.maxHp) car.maxHp = style.maxHp;
  }
  return car;
}
function putPlayerInCar(game, car, x, y, angle, speed, style) {
  setCar(car, x, y, angle, speed, style);
  car.occupiedByPlayer = true;
  game.player.inCar = true; game.player.car = car;
  game.player.x = x; game.player.y = y; game.player.angle = angle;
  game.player.vx = Math.cos(angle) * speed; game.player.vy = Math.sin(angle) * speed;
}
function addCop(game, x, y, angle) {
  const cop = makeCopCar(x, y, angle);
  cop.speed = 150; cop.cruise = 250;
  game.police.cops.push(cop);
  return cop;
}
const STAGE_GAITS = ['bouncy', 'relaxed', 'upright', 'dragging'];
function stagePed(game, idx, x, y, angle, phase, gaitIdx) {
  const ped = game.peds[idx % game.peds.length];
  ped.x = x; ped.y = y; ped.angle = angle; ped.dead = false;
  ped.walkPhase = phase; ped.phase = phase;
  if (typeof gaitIdx === 'number') ped.gait = STAGE_GAITS[gaitIdx % STAGE_GAITS.length];
  return ped;
}
function setMission(game, index, stage, timeLeft) {
  const m = game.missions;
  m.index = index; m.active = true; m.stage = stage; m.timeLeft = timeLeft;
  m.lastBrief = CHAIN[index % CHAIN.length].brief;
  m.briefUntil = game.nowMs + 6000;
}
function finish(game, camX, camY) {
  game.fx.shake = 0;
  if (typeof camX === 'number') { game.camera.x = camX; game.camera.y = camY; }
  else snapCamera(game);
  game.frozen = true;
}
export function applyShot(game, name, step) {
  const run = (n) => { for (let i = 0; i < n; i++) step(1 / 60); };
  if (name === 'title') {
    // A lively Gazette Plaza intersection behind the title: traffic flowing through,
    // upright pedestrians mid-crosswalk, the player in profile on the corner.
    game.screen = 'title';
    game.player.x = 1038; game.player.y = 1100; game.player.angle = 0;
    run(150);
    game.screen = 'title';
    game.player.inCar = false; game.player.car = null;
    game.player.x = 1038; game.player.y = 1100; game.player.angle = 0;
    game.player.walkPhase = 0.9; game.player.vx = 40; game.player.vy = 0; game.player.hp = 100;
    setCar(game.traffic[10], 872, 1007, 0, 92);
    setCar(game.traffic[11], 965, 852, Math.PI / 2, 80);
    setCar(game.traffic[12], 1185, 965, Math.PI, 84);
    setCar(game.traffic[13], 1007, 1190, -Math.PI / 2, 72);
    stagePed(game, 0, 962, 1006, 0, 1.1, 0);
    stagePed(game, 1, 1006, 1054, Math.PI, 3.4, 1);
    stagePed(game, 2, 1004, 958, Math.PI / 2, 5.2, 2);
    stagePed(game, 3, 958, 1058, 0, 2.2, 3);
    stagePed(game, 4, 1096, 1040, Math.PI / 2, 4.1, 1);
    game.bullets = []; game.fx.particles = []; game.toasts = [];
    game.camera.zoom = 1.05;
    finish(game);
    return true;
  }
  if (name === 'chase') {
    // 5-star pursuit east along the Hotel Aurelia avenue (Old Town), frozen at the PIT
    // contact moment: an interceptor is on the hero's rear-left quarter, sparks and tyre
    // smoke at the contact, skid arcs behind both cars, a second cop cutting in ahead.
    // Jobs 1–2 are done ($1,350) and the current job is 3, "Front Page".
    // Displayed speed: round(225 * 0.62) = 140 km/h.
    game.screen = 'play';
    run(150);
    game.screen = 'play';
    putPlayerInCar(game, game.traffic[0], 1100, 1477, 0.10, 225, { kind: 'coupe', color: '#7a4a3a', hp: 31, maxHp: 90 });
    const hero = game.traffic[0];
    const rot = (a, x, y) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
    const at = (car, x, y) => { const r = rot(car.angle, x, y); return { x: car.x + r.x, y: car.y + r.y }; };
    // Traffic: one car swerving just ahead-right, one braking further ahead at an angle.
    setCar(game.traffic[1], hero.x + 215, hero.y + 47, 0.85, 0);
    setCar(game.traffic[2], hero.x + 430, hero.y, 0.30, 40);
    game.police.cops = [];
    // PIT cop: nose on the hero's rear-left quarter, computed from the hero transform.
    const contact = at(hero, -14, -8);
    const pitAngle = 0.55;
    const pit = addCop(game, 0, 0, pitAngle);
    pit.x = contact.x - Math.cos(pitAngle) * 20; pit.y = contact.y - Math.sin(pitAngle) * 20;
    pit.angle = pitAngle; pit.speed = 150;
    // Second cop cutting in ahead-right.
    const cutter = addCop(game, hero.x + 300, hero.y - 38, -0.38); cutter.speed = 150;
    // Remaining cops staggered behind at varied angles and offsets — no parade line.
    for (const [dx, dy, a] of [[-200, -6, 0.04], [-330, 10, -0.05], [-95, 42, 0.22], [-430, -14, 0.02]]) {
      const c = addCop(game, hero.x + dx, hero.y + dy, a); c.speed = 150;
    }
    stagePed(game, 0, 730, 1406, 0, 0.7, 0);
    stagePed(game, 1, 990, 1406, Math.PI, 2.4, 1);
    stagePed(game, 2, 1440, 1406, 0, 4.0, 2);
    stagePed(game, 3, 800, 1506, Math.PI, 1.5, 3);
    stagePed(game, 4, 1170, 1506, 0, 5.3, 0);
    stagePed(game, 5, 1580, 1506, Math.PI, 3.1, 1);
    game.money = 1350;
    game.police.setStars(5, game.nowMs);
    setMission(game, 2, 'pickup', 78);
    game.player.hp = 100;
    game.bullets = []; game.toasts = [];
    // Skids: two curved-feeling tracks behind the hero (three short segments per side,
    // angle opening as they trail back) and one pair behind the PIT cop.
    game.fx.skids = [];
    const skidAngles = [0.02, 0.08, 0.14];
    for (const side of [-8, 8]) {
      for (let i = 0; i < 3; i++) {
        const p = at(hero, -14 - 6 - i * 16, side);
        game.fx.skid(p.x, p.y, skidAngles[i], 18, 3.2);
      }
    }
    for (const side of [-8, 8]) {
      const p = at(pit, -20, side);
      game.fx.skid(p.x, p.y, pitAngle, 18, 3.2);
    }
    // Frozen effects: sparks at the contact point, smoke at the hero's rear tyres and
    // the PIT cop's front tyres.
    const heroTyreL = at(hero, -14, -8), heroTyreR = at(hero, -14, 8);
    const pitTyreL = at(pit, 15, -7), pitTyreR = at(pit, 15, 7);
    const sparkCols = ['#ffd76a', '#f2c14e'];
    const sparkSizes = [2, 2.6, 3.4, 2.4, 3.0];
    const sparkLife = [0.7, 0.85, 1, 0.8, 0.9];
    game.fx.particles = [];
    for (let i = 0; i < 5; i++) {
      game.fx.particles.push({
        x: contact.x + (i - 2) * 1.6, y: contact.y + ((i % 3) - 1) * 1.6,
        vx: 0, vy: 0, life: 0.5 * sparkLife[i], maxLife: 0.5,
        color: sparkCols[i % 2], size: sparkSizes[i], drag: 0,
      });
    }
    const smokePts = [heroTyreL, heroTyreR, pitTyreL, pitTyreR];
    const smokeSizes = [5, 6.5, 8, 5.5];
    smokePts.forEach((p, i) => {
      game.fx.particles.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.75, maxLife: 1.0, color: 'rgba(120,120,125,0.55)', size: smokeSizes[i], drag: 0 });
    });
    game.camera.zoom = 1.55;
    finish(game);
    return true;
  }
  if (name === 'mission') {
    // On-foot firefight at Low Market (Neon Uptown): the player fires at a smoking sedan
    // mid-stride, tracers in flight, pedestrians fleeing, a crowd on the south sidewalk.
    // Jobs 1–3 are done ($2,250); the current job is 4, "Two Drops", first drop next.
    game.screen = 'play';
    run(150);
    game.screen = 'play';
    game.player.inCar = false; game.player.car = null;
    game.player.x = 2360; game.player.y = 1042;
    game.player.angle = Math.atan2(1002 - 1042, 2472 - 2360);
    game.player.walkPhase = 1.1; game.player.vx = 30; game.player.vy = -8; game.player.hp = 88;
    const a = game.player.angle;
    setCar(game.traffic[1], 2472, 1002, -0.5, 0, { kind: 'sedan', color: '#54604f', hp: 22, maxHp: 100 });
    setCar(game.traffic[2], 2625, 965, Math.PI, 0);
    setCar(game.traffic[3], 2705, 1007, 0, 70);
    game.police.cops = [];
    addCop(game, 2085, 965, 0);
    stagePed(game, 0, 2545, 1012, 0.2, 2.2, 0);
    stagePed(game, 1, 2505, 1082, 1.1, 4.4, 0);
    stagePed(game, 2, 2278, 1014, Math.PI, 0.4, 0);
    stagePed(game, 3, 2290, 1042, Math.PI / 2, 1.9, 1);
    stagePed(game, 4, 2335, 1040, 2.8, 3.6, 2);
    stagePed(game, 5, 2562, 1044, Math.PI / 2, 5.1, 3);
    stagePed(game, 6, 2612, 1040, -2.6, 0.8, 1);
    stagePed(game, 7, 2402, 934, -Math.PI / 2, 2.9, 0);
    game.money = 2250;
    game.police.setStars(3, game.nowMs);
    setMission(game, 3, 'dropA', 96);
    game.lastShotAt = game.nowMs;
    // Tracers in flight along the aim line and the muzzle flash, frozen at the capture tick.
    const mx = game.player.x + Math.cos(a) * 16, my = game.player.y + Math.sin(a) * 16;
    game.bullets = [34, 76, 118].map((d) => ({
      x: game.player.x + Math.cos(a) * d, y: game.player.y + Math.sin(a) * d, angle: a, life: 0.5,
    }));
    game.fx.particles = [
      { x: mx, y: my, vx: 0, vy: 0, life: 0.07, maxLife: 0.07, color: '#ffd76a', size: 5.5, drag: 0 },
      { x: 2452, y: 1006, vx: 0, vy: 0, life: 0.4, maxLife: 0.4, color: '#f2c14e', size: 3.2, drag: 0 },
      { x: 2462, y: 998, vx: 0, vy: 0, life: 0.32, maxLife: 0.32, color: '#ffd76a', size: 2.6, drag: 0 },
      { x: 2470, y: 988, vx: 0, vy: 0, life: 1.0, maxLife: 1.0, color: 'rgba(120,120,125,0.6)', size: 7, drag: 0 },
      { x: 2482, y: 982, vx: 0, vy: 0, life: 0.9, maxLife: 0.9, color: 'rgba(120,120,125,0.5)', size: 5.5, drag: 0 },
    ];
    game.toasts = [];
    game.camera.zoom = 1.5;
    // Camera framed north-west of the player so the Hotel Aurelia plate stays out of frame
    // instead of hiding behind the minimap. At zoom 1.5 the frame sits closer on the
    // player than the old 0.92 framing, so the firefight stays the frame's subject.
    finish(game, 2260, 950);
    return true;
  }
  if (name === 'results') {
    // End-of-chain outcome screen at Port Meridian: job 5 ("Heavy Metal") has just been
    // delivered in the armored sedan, the whole chain is done and the summary panel is
    // up over the live port. Money story: $250 start + 400 + 700 + 900 + 1,200 + 2,000
    // = $5,450 cash, $5,200 earned on this chain.
    game.screen = 'play';
    run(150);
    game.screen = 'play';
    putPlayerInCar(game, game.traffic[5], 700, 3357, 0, 0, { kind: 'armored', color: '#3f444c', hp: 150, maxHp: 220 });
    game.police.setStars(0, game.nowMs);
    game.police.cops = [];
    addCop(game, 330, 3315, Math.PI);
    stagePed(game, 0, 620, 3386, 0, 1.2, 1);
    stagePed(game, 1, 900, 3386, Math.PI, 3.8, 2);
    stagePed(game, 2, 760, 3286, 0, 5.6, 0);
    stagePed(game, 3, 1080, 3286, Math.PI, 2.0, 3);
    game.money = 5450;
    game.totalEarned = 5200;
    game.missionsCompleted = 5;
    game.chainsFinished = 1;
    game.jobsThisChain = 5;
    game.chainEarned = 5200;
    game.bestEscapeMs = 41000;
    game.carsStolen = 7;
    game.timesWasted = 1;
    game.missions.index = 0; game.missions.loop = 1;
    game.missions.active = false; game.missions.stage = 'idle';
    game.missions.briefUntil = 0; game.missions.lastBrief = '';
    game.player.hp = 100;
    game.bullets = []; game.fx.particles = []; game.fx.skids = [];
    game.showSummary();
    game.toasts = []; game.bullets = [];
    game.camera.zoom = 1.3;
    // Camera framed south-east of the delivery point: the South Depot plate stays out
    // of the top edge and the Port Meridian anchor falls outside the visible rect, so
    // its plate is skipped rather than half-hidden behind the summary panel.
    finish(game, 1020, 3440);
    return true;
  }
  return false;
}
