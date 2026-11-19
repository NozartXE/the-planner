// shots.js — deterministic staging for screenshots: ?shot=title|chase|mission|results runs the real
// simulation first, then sets one explicit, coherent mid-chain state per shot and freezes it.
// Everything that appears on screen (money, stars, mission, speeds, crowds, cops, effects) is set
// AFTER the run steps, so a re-capture is byte-identical and nothing drifts between frames.
// Staging is framed for the 3D CHASE CAM (view3d.js): the camera sits 72–84 units behind the
// hero looking along the hero's heading, so every actor that must be SEEN is placed ahead of
// the hero or beside it — never in the dead zone between the camera and the hero.
// A fifth staging, ?shot=scale, is a measurement scene only (figure beside the hero car at
// the same depth) used by the figure-vs-car scale acceptance check; it is never shipped.
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
  ped.fleeUntil = 0;
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
  // Render-test hooks reset on every staging (used only by ?shot=scale captures).
  game.shotHeroCar = null; game.debugHidePlayer = false; game.debugHideHeroCar = false; game.idRender = false;
  if (name === 'title') {
    // Hero cruising the beachfront at the east edge, heading NORTH in the chase cam:
    // art-deco facades front the sand on the left of the frame, the sand strip, teal
    // water and an anchored boat fill the right, palms line the promenade.
    // Staging note (measured from the generated city): Ocean Drive's east lane is
    // built over by the eastern column's east plots (their east edges reach
    // x ≈ 3742–3750 of the 3668–3760 road), so a car ON the asphalt there sits
    // inside a building footprint and the chase cam frames a wall. The hero is
    // therefore staged on the sand strip immediately east of Ocean Drive — the
    // only framing that holds deco facades one side and open ocean the other.
    // The drawTitle overlay owns the centre; the coast streams past behind it.
    game.screen = 'title';
    run(150);
    game.screen = 'title';
    putPlayerInCar(game, game.traffic[0], 3796, 1380, -Math.PI / 2, 55, { kind: 'coupe', color: '#b8523f' });
    setCar(game.traffic[1], 3770, 1050, -Math.PI / 2, 0);
    setCar(game.traffic[2], 3693, 2050, Math.PI / 2, 65);
    setCar(game.traffic[3], 3388, 965, 0, 60);
    setCar(game.traffic[4], 3222, 1007, 0, 80);
    stagePed(game, 0, 3778, 1330, -Math.PI / 2, 1.1, 0);
    stagePed(game, 1, 3812, 1200, Math.PI, 3.4, 1);
    stagePed(game, 2, 3776, 1240, -Math.PI / 2, 5.2, 2);
    stagePed(game, 3, 3652, 1290, Math.PI / 2, 2.2, 3);
    stagePed(game, 4, 3806, 1080, -Math.PI / 2, 4.1, 1);
    game.police.cops = [];
    game.police.setStars(0, game.nowMs);
    game.bullets = []; game.fx.particles = []; game.toasts = [];
    finish(game);
    return true;
  }
  if (name === 'chase') {
    // 5-star pursuit east along the Hotel Aurelia avenue (Old Town), frozen at the PIT
    // contact moment: an interceptor is on the hero's rear-left quarter, sparks and tyre
    // smoke at the contact, skid arcs behind both cars, a second cop cutting in ahead.
    // Jobs 1–2 are done ($1,350) and the current job is 3, "Front Page".
    // Displayed speed: round(225 * 0.62) = 140 km/h.
    // 3D framing: the chase cam sits ~84 units behind the hero, so the alongside cop
    // (south side, level with the hero) and the cutter ahead carry the pursuit read;
    // two more interceptors trail behind for the minimap's cop cluster.
    game.screen = 'play';
    run(150);
    game.screen = 'play';
    putPlayerInCar(game, game.traffic[0], 1100, 1477, 0.10, 225, { kind: 'coupe', color: '#7a4a3a', hp: 31, maxHp: 90 });
    const hero = game.traffic[0];
    const rot = (a, x, y) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
    const at = (car, x, y) => { const r = rot(car.angle, x, y); return { x: car.x + r.x, y: car.y + r.y }; };
    // Traffic: one car swerving ahead-right (kept clear of the converging cop),
    // one braking further ahead at an angle.
    setCar(game.traffic[1], hero.x + 330, hero.y + 82, 0.5, 0);
    setCar(game.traffic[2], hero.x + 430, hero.y, 0.30, 40);
    game.police.cops = [];
    // PIT cop ALONGSIDE the hero on the north side, nose swung into the hero's
    // rear-left quarter: at nearly the hero's own depth from the chase cam it reads
    // at the hero's scale, left of it, instead of looming between camera and hero
    // (the first 3D capture's failure: a rear-quarter cop sits ~30 units closer to
    // the lens and its light bar fills the foreground).
    const contact = at(hero, -13, -13);
    const pitAngle = 0.38;
    const pitPos = at(hero, -4, -28);
    const pit = addCop(game, pitPos.x, pitPos.y, pitAngle);
    pit.speed = 150;
    // Second cop cutting in ahead-left (north side).
    const cutter = addCop(game, hero.x + 300, hero.y - 38, -0.38); cutter.speed = 150;
    // Third cop converging ahead-right (south side), siren lit — the pursuit is
    // visible ahead of the hero as well as beside it.
    const wing = addCop(game, hero.x + 170, hero.y + 58, -0.30); wing.speed = 150;
    // Fourth cop converging far ahead-left; two more trail behind (minimap evidence).
    const far = addCop(game, hero.x + 520, hero.y - 55, -0.18); far.speed = 150;
    for (const [dx, dy, a] of [[-200, -6, 0.04], [-330, 10, -0.05]]) {
      const c = addCop(game, hero.x + dx, hero.y + dy, a); c.speed = 150;
    }
    stagePed(game, 0, 1150, 1406, 0, 0.7, 0);
    stagePed(game, 1, 1330, 1406, Math.PI, 2.4, 1);
    stagePed(game, 2, 1560, 1406, 0, 4.0, 2);
    stagePed(game, 3, 1210, 1506, Math.PI, 1.5, 3);
    stagePed(game, 4, 1480, 1506, 0, 5.3, 0);
    stagePed(game, 5, 1700, 1506, Math.PI, 3.1, 1);
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
    finish(game);
    return true;
  }
  if (name === 'mission') {
    // On-foot firefight at the Palm Market intersection (Solana uptown): the player
    // fires east along the avenue at a smoking sedan mid-stride, tracers in flight,
    // pedestrians fleeing, cops closing from ahead. Jobs 1–3 are done ($2,250);
    // the current job is 4, "Two Drops", first drop next.
    // 3D framing: the player stands IN the intersection (roads cross at
    // x 2350–2442 × y 940–1032) aiming east, so the foot chase cam ~72 units behind
    // at ≈ (2324, 1015) is also in open intersection — the first 3D capture staged
    // the player at a block edge and the camera landed inside a building, framing
    // two walls. Every staged actor stands ahead of the camera in the road cross.
    game.screen = 'play';
    run(150);
    game.screen = 'play';
    game.player.inCar = false; game.player.car = null;
    game.player.x = 2396; game.player.y = 1006;
    game.player.angle = Math.atan2(992 - 1006, 2510 - 2396);
    game.player.walkPhase = 1.1; game.player.vx = 30; game.player.vy = -4; game.player.hp = 88;
    const a = game.player.angle;
    setCar(game.traffic[1], 2510, 992, -0.35, 0, { kind: 'sedan', color: '#54604f', hp: 22, maxHp: 100 });
    setCar(game.traffic[2], 2680, 965, Math.PI, 0);
    setCar(game.traffic[3], 2790, 1007, 0, 55);
    game.police.cops = [];
    const cop1 = addCop(game, 2700, 1075, -2.7); cop1.speed = 40;
    const cop2 = addCop(game, 2900, 960, Math.PI); cop2.speed = 0;
    stagePed(game, 0, 2560, 1015, 0.3, 2.2, 0);
    stagePed(game, 1, 2540, 1085, 1.2, 4.4, 0);
    stagePed(game, 2, 2620, 1045, -2.4, 0.4, 0);
    stagePed(game, 3, 2480, 920, -1.2, 1.9, 1);
    stagePed(game, 4, 2470, 1095, 2.8, 3.6, 2);
    stagePed(game, 5, 2660, 930, -Math.PI / 2, 5.1, 3);
    stagePed(game, 6, 2720, 1090, Math.PI, 0.8, 1);
    stagePed(game, 7, 2580, 1120, 2.2, 2.9, 0);
    // The three peds nearest the gunfire are caught mid-flee (run pose in the renderer).
    for (const idx of [0, 1, 2]) {
      const ped = game.peds[idx];
      ped.fleeUntil = game.nowMs + 60000; ped.fleeX = game.player.x; ped.fleeY = game.player.y;
    }
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
      { x: 2490, y: 995, vx: 0, vy: 0, life: 0.4, maxLife: 0.4, color: '#f2c14e', size: 3.2, drag: 0 },
      { x: 2500, y: 990, vx: 0, vy: 0, life: 0.32, maxLife: 0.32, color: '#ffd76a', size: 2.6, drag: 0 },
      { x: 2505, y: 985, vx: 0, vy: 0, life: 1.0, maxLife: 1.0, color: 'rgba(120,120,125,0.6)', size: 7, drag: 0 },
      { x: 2515, y: 978, vx: 0, vy: 0, life: 0.9, maxLife: 0.9, color: 'rgba(120,120,125,0.5)', size: 5.5, drag: 0 },
    ];
    game.toasts = [];
    finish(game);
    return true;
  }
  if (name === 'results') {
    // End-of-chain outcome screen at the beachfront: job 5 ("Heavy Metal") has just been
    // delivered in the armored sedan, the whole chain is done and the summary panel is
    // up over Ocean Drive — deco facades to the left, sand and water to the right.
    // Money story: $250 start + 400 + 700 + 900 + 1,200 + 2,000
    // = $5,450 cash, $5,200 earned on this chain.
    game.screen = 'play';
    run(150);
    game.screen = 'play';
    // The hero parks on Ocean Drive beside the eastern park block (bx 7, by 5 —
    // a park, so no east-plot building covers the road there; verified against the
    // generated city). Camera south of the car looks north: park trees left,
    // sand + water + boats right, deco skyline ahead.
    putPlayerInCar(game, game.traffic[5], 3714, 2700, -Math.PI / 2, 0, { kind: 'armored', color: '#3f444c', hp: 150, maxHp: 220 });
    game.police.setStars(0, game.nowMs);
    game.police.cops = [];
    const parked = addCop(game, 3693, 2396, -Math.PI / 2); parked.speed = 0;
    stagePed(game, 0, 3655, 2580, -Math.PI / 2, 1.2, 1);
    stagePed(game, 1, 3782, 2560, Math.PI, 3.8, 2);
    stagePed(game, 2, 3500, 2620, 0, 5.6, 0);
    stagePed(game, 3, 3662, 2480, Math.PI / 2, 2.0, 3);
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
    finish(game);
    return true;
  }
  if (name === 'scale') {
    // MEASUREMENT SCENE (never shipped): the player stands mid-stride on the Hotel
    // Aurelia avenue beside the hero coupe, both at the same forward depth from the
    // foot chase cam, nothing else in frame. The capture harness re-renders this
    // state with game.idRender = true (flat ID colours: figure green, car blue) and
    // measures the rasterised pixel bboxes/areas for the scale acceptance check.
    game.screen = 'play';
    run(150);
    game.screen = 'play';
    game.player.inCar = false; game.player.car = null;
    // Both face NORTH on the vertical avenue: the car stands beside the player at
    // the same forward depth, fully inside the frame (an east-facing pair put the
    // car half out of frame and its rear corner ~20 units closer to the lens,
    // which corrupts the comparison this scene exists to make).
    game.player.x = 1000; game.player.y = 1477; game.player.angle = -Math.PI / 2;
    game.player.walkPhase = 1.1; game.player.vx = 0; game.player.vy = -30; game.player.hp = 100;
    const heroCar = setCar(game.traffic[0], 1018, 1479, -Math.PI / 2, 0, { kind: 'coupe', color: '#c22730' });
    heroCar.occupiedByPlayer = false;
    game.shotHeroCar = heroCar;
    // Everything else leaves the frame: traffic parked far south-east, peds gathered
    // in the far corner behind the camera, no cops, no mission, no effects.
    for (let i = 1; i < game.traffic.length; i++) setCar(game.traffic[i], 3300 + i * 12, 3300, 0, 0);
    game.police.cops = [];
    game.police.setStars(0, game.nowMs);
    game.peds.forEach((ped, i) => { ped.x = 3350 + (i % 8) * 9; ped.y = 3350 + Math.floor(i / 8) * 9; ped.dead = false; ped.fleeUntil = 0; });
    game.missions.active = false; game.missions.stage = 'idle'; game.missions.briefUntil = 0;
    game.money = 0;
    game.bullets = []; game.fx.particles = []; game.fx.skids = []; game.toasts = [];
    finish(game);
    return true;
  }
  return false;
}
