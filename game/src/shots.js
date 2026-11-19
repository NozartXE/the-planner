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
import { planStats, settlePlan, weaponForPlan, jobPlanData } from './planning.js';
// The staged plans: one coherent chain story. Jobs 1-2 are banked ($1,350),
// job 3 (Front Page) is planned on the board and executed in the chase with
// the SAME plan object values, job 4 runs at dusk with the extended mag,
// and the results ledger settles all five with the house crew (Dex + Milo).
export const STAGED_PLAN_J3 = { jobIndex: 2, entry: 2, crew: ['dex', 'milo'], gear: ['duffels', 'extmag'], getaway: 'coupe', timeOfDay: 'golden' };
export const STAGED_PLAN_J4 = { jobIndex: 3, entry: 0, crew: ['dex', 'milo'], gear: ['duffels', 'extmag'], getaway: 'sedan', timeOfDay: 'dusk' };
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
  if (name === 'board') {
    // The Planning Board for job 3 (Front Page), mid-planning: entry BOLD
    // chosen, Dex + Milo hired, duffels + extended mag packed, the Comet as
    // getaway at golden hour — and the live stats already forecast the 5-star
    // heat the chase shot then actually fields. The board floats over the
    // real target street: Gazette Plaza, camera down its east road canyon.
    game.screen = 'play';
    run(150);
    game.screen = 'planning';
    game.missions.index = 2; game.missions.active = false; game.missions.stage = 'idle';
    game.plan = { ...STAGED_PLAN_J3, crew: [...STAGED_PLAN_J3.crew], gear: [...STAGED_PLAN_J3.gear] };
    game.gearFocus = 1;
    game.planStatsCache = planStats(2, game.plan, 0);
    game.planTarget = { x: 986, y: 986 };
    game.planOrbitAngle = 0;
    game.timeGrade = 'golden';
    game.money = 1350;
    game.player.inCar = false; game.player.car = null;
    game.player.x = 1042; game.player.y = 1004; game.player.angle = Math.PI;
    game.player.hp = 100;
    // Backdrop traffic on the target street itself (the east–west road the
    // board looks down): a westbound car mid-ground, two eastbound cars at
    // far and foreground range, one more westbound car in the far distance —
    // four cars in the visible street area, none under a panel's text.
    setCar(game.traffic[1], 880, 963, Math.PI, 30);
    setCar(game.traffic[2], 700, 1009, 0, 35);
    setCar(game.traffic[3], 1090, 1009, 0, 30);
    setCar(game.traffic[4], 600, 963, Math.PI, 30);
    stagePed(game, 0, 920, 928, 0.4, 1.2, 0);
    stagePed(game, 1, 1060, 928, -0.6, 3.0, 1);
    stagePed(game, 2, 930, 1044, 2.6, 5.0, 2);
    stagePed(game, 3, 1080, 1044, -2.2, 2.2, 3);
    // Mid-ground pedestrians on the depth road's sidewalks (north side
    // y≈932, south side y≈1040 — both clear of the road surface 940–1032).
    stagePed(game, 4, 780, 932, -0.6, 4.2, 1);
    stagePed(game, 5, 850, 1040, 2.6, 1.4, 2);
    game.police.cops = [];
    game.police.setStars(0, game.nowMs);
    game.bullets = []; game.fx.particles = []; game.fx.skids = []; game.toasts = [];
    finish(game);
    return true;
  }
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
    // Re-staged ON Ocean Drive itself at the park block (bx 7, by 5 — the same
    // verified stretch the results shot uses): the hero drives the road, deco
    // facades and park trees to the west, sand, water and boats to the east,
    // traffic in both lanes and peds on both sidewalks in one lived-in frame.
    // Hero at the park's south edge: the camera (84 behind, in the open
    // block south of the park) looks down the whole clear park stretch —
    // trees sit 250+ units ahead at mid-ground size instead of filling the
    // foreground, and deco facades close the vanishing point.
    putPlayerInCar(game, game.traffic[0], 3714, 2791, -Math.PI / 2, 55, { kind: 'coupe', color: '#b8523f' });
    setCar(game.traffic[1], 3693, 2400, Math.PI / 2, 40);
    setCar(game.traffic[2], 3714, 2330, -Math.PI / 2, 50);
    setCar(game.traffic[3], 3693, 2050, Math.PI / 2, 0);
    setCar(game.traffic[4], 3222, 1007, 0, 80);
    stagePed(game, 0, 3660, 2650, -Math.PI / 2, 1.1, 0);
    stagePed(game, 1, 3786, 2600, Math.PI, 3.4, 1);
    stagePed(game, 2, 3662, 2500, -Math.PI / 2, 5.2, 2);
    stagePed(game, 3, 3792, 2450, Math.PI / 2, 2.2, 3);
    stagePed(game, 4, 3658, 2720, -Math.PI / 2, 4.1, 1);
    game.police.cops = [];
    game.police.setStars(0, game.nowMs);
    game.bullets = []; game.fx.particles = []; game.toasts = [];
    finish(game);
    return true;
  }
  if (name === 'chase') {
    // 5-star pursuit east along the Hotel Aurelia avenue (Old Town), frozen at the PIT
    // contact moment: an interceptor runs in the north lane with its front quarter
    // pressed into the hero's front-left quarter, sparks and smoke at the contact,
    // skid arcs behind both cars, pursuit units in echelon and a roadblock ahead.
    // Jobs 1–2 are done ($1,350) and the current job is 3, "Front Page".
    // Displayed speed: round(225 * 0.62) = 140 km/h.
    // 3D framing: the chase cam sits ~84 units behind the hero, so the alongside cop
    // (south side, level with the hero) and the cutter ahead carry the pursuit read;
    // two more interceptors trail behind for the minimap's cop cluster.
    game.screen = 'play';
    run(150);
    game.screen = 'play';
    // Hero frozen IN the intersection east of Gazette Plaza: the camera sits
    // in open crossing tarmac, so no building corner hugs the lens (the old
    // staging's camera stood beside a south-side plot and its face filled
    // the frame's right third).
    putPlayerInCar(game, game.traffic[0], 1456, 1477, 0, 225, { kind: 'coupe', color: '#7a4a3a', hp: 31, maxHp: 90 });
    const hero = game.traffic[0];
    const rot = (a, x, y) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
    const at = (car, x, y) => { const r = rot(car.angle, x, y); return { x: car.x + r.x, y: car.y + r.y }; };
    // Traffic on the road surface only: ONE distant westbound car stopped
    // behind the roadblock (a civilian halted by the block — it sits above
    // the roadblock pair in frame, clear of their silhouettes), and the
    // other traffic car staged behind the camera, out of the hunt's read.
    setCar(game.traffic[1], hero.x + 700, hero.y - 20, Math.PI, 0);
    setCar(game.traffic[2], hero.x - 380, hero.y + 15, 0, 40);
    game.police.cops = [];
    // Formation-true hunt, staged PROJECTION-FIRST (every placement was
    // solved against the chase cam's own projection before being written
    // here): EXACTLY five interceptors for the plan's forecast five stars.
    // The hero is the largest vehicle, centre-low and clear of the pack.
    // ONE interceptor runs near-parallel in the north lane with its front
    // quarter pressed into the hero's front-left quarter — the PIT contact,
    // sparked and smoked at the touch point. Two pursuit units follow in
    // echelon in the centre/south lanes at mid-ground. The roadblock pair
    // sits PERPENDICULAR across both lanes far ahead, silhouettes fully
    // separated. No cop exceeds a quarter of the frame width; none clips.
    const contact = at(hero, 15, -10);
    const pitAngle = 0.08;
    const pitPos = at(hero, 22, -19.5);
    const pit = addCop(game, pitPos.x, pitPos.y, pitAngle);
    pit.speed = 150;
    const pursuit1 = addCop(game, hero.x + 118, hero.y - 9, 0); pursuit1.speed = 150;
    const pursuit2 = addCop(game, hero.x + 128, hero.y + 13, 0); pursuit2.speed = 150;
    // Roadblock pair: across both lanes of the road ahead (the road spans
    // hero-relative −67…+25), noses pointing opposite ways, a car's width
    // of daylight between their inner ends.
    const block1 = addCop(game, hero.x + 268, hero.y - 40, -Math.PI / 2); block1.speed = 0;
    const block2 = addCop(game, hero.x + 276, hero.y + 2, Math.PI / 2); block2.speed = 0;
    game.police.assignTactics(game.player);
    game.police.lastSeenX = hero.x; game.police.lastSeenY = hero.y;
    // Peds clear of the roadway: two on the north sidewalk (y 1396, the
    // strip north of the road's 1410 edge), three in the park block south
    // of the road (y 1548+, on grass well clear of the 1502 road edge).
    stagePed(game, 0, 1720, 1396, 0, 0.7, 0);
    stagePed(game, 1, 1900, 1396, Math.PI, 2.4, 1);
    stagePed(game, 2, 1620, 1560, Math.PI, 4.0, 2);
    stagePed(game, 3, 1780, 1600, 0, 1.5, 3);
    stagePed(game, 4, 1860, 1548, Math.PI, 5.3, 0);
    game.money = 1350;
    game.radio.stationIdx = 1; game.radio.trackIdx = 0;
    // The plan from the board, executed: its forecast IS the wanted level
    // (5 stars, so 5 interceptors — one per star), its getaway IS the hero
    // car (VELOZ COMET), its gear built the weapon.
    game.plan = { ...STAGED_PLAN_J3, crew: [...STAGED_PLAN_J3.crew], gear: [...STAGED_PLAN_J3.gear] };
    game.planStatsCache = planStats(2, game.plan, 0);
    game.police.setStars(game.planStatsCache.heatStars, game.nowMs);
    hero.name = 'VELOZ COMET';
    game.weapon = weaponForPlan(game.plan);
    game.timeGrade = game.plan.timeOfDay;
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
    // Contact smoke at the PIT touch point itself: the impact reads as a
    // live scrape, not two parked cars — smoke + the sparks above at the
    // exact point where the two bodies meet.
    game.fx.particles.push({ x: contact.x, y: contact.y, vx: 0, vy: 0, life: 0.85, maxLife: 1.0, color: 'rgba(120,120,125,0.55)', size: 7, drag: 0 });
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
    // Closer mid-shot re-stage: the target sedan is 74 units ahead (was 114),
    // so the gun, muzzle, tracers and the struck car all read in one frame
    // and the empty road foreground shrinks to the player's own street slice.
    game.player.angle = Math.atan2(1000 - 1006, 2470 - 2396);
    game.player.walkPhase = 1.1; game.player.vx = 30; game.player.vy = -4; game.player.hp = 88;
    const a = game.player.angle;
    setCar(game.traffic[1], 2470, 1000, -0.35, 0, { kind: 'sedan', color: '#54604f', hp: 22, maxHp: 100 });
    setCar(game.traffic[2], 2735, 965, Math.PI, 0);
    setCar(game.traffic[3], 2866, 850, Math.PI / 2, 40);
    game.police.cops = [];
    // The roster's 2× ROADBLOCK, staged as what it claims: a pair swung
    // PERPENDICULAR across both lanes of the avenue ahead (the road spans
    // y 940–1032; unit A covers the north half, unit B the south half, a
    // small gap between their inner ends), both fully visible in frame at
    // mid-distance, flanking the target car's escape line.
    const cop1 = addCop(game, 2648, 968, -Math.PI / 2); cop1.speed = 0;
    const cop2 = addCop(game, 2662, 1012, Math.PI / 2); cop2.speed = 0;
    game.police.assignTactics(game.player);
    game.police.lastSeenX = game.player.x; game.police.lastSeenY = game.player.y;
    // Peds on sidewalks only — none stands on the road surface.
    stagePed(game, 0, 2480, 922, 0.3, 2.2, 0);
    stagePed(game, 1, 2560, 925, 1.2, 4.4, 0);
    stagePed(game, 2, 2500, 1048, -2.4, 0.4, 0);
    stagePed(game, 3, 2338, 960, -1.2, 1.9, 1);
    stagePed(game, 4, 2462, 1050, 2.8, 3.6, 2);
    stagePed(game, 5, 2660, 928, -Math.PI / 2, 5.1, 3);
    stagePed(game, 6, 2720, 1090, Math.PI, 0.8, 1);
    // (Was staged mid-roadway at the intersection's east edge; moved to the
    // north sidewalk strip, y 934 — no staged pedestrian stands on the road
    // surface in this frame.)
    stagePed(game, 7, 2536, 934, 0, 2.9, 0);
    // The three peds nearest the gunfire are caught mid-flee (run pose in the renderer).
    for (const idx of [0, 1, 2]) {
      const ped = game.peds[idx];
      ped.fleeUntil = game.nowMs + 60000; ped.fleeX = game.player.x; ped.fleeY = game.player.y;
    }
    game.money = 2250;
    game.police.setStars(3, game.nowMs);
    setMission(game, 3, 'dropA', 96);
    game.lastShotAt = game.nowMs;
    // Job 4's plan, executed at DUSK: the extended-mag gear built an
    // 18-round VENN 9MM and three rounds are already fired — the readout
    // (15 / 48) is the sim's own count. The grab is done (loot = the full
    // $1,829 estimate) and Dex, the plan's lead pick, works beside the
    // player in his own colour. The getaway sedan waits up the street.
    game.plan = { ...STAGED_PLAN_J4, crew: [...STAGED_PLAN_J4.crew], gear: [...STAGED_PLAN_J4.gear] };
    game.planStatsCache = planStats(3, game.plan, 0);
    game.timeGrade = game.plan.timeOfDay;
    game.weapon = weaponForPlan(game.plan);
    game.weapon.mag = 15;
    game.missions.lootGrabbed = game.planStatsCache.loot;
    game.crewMate = { id: 'dex', name: 'DEX RUIZ', color: '#e8c832', x: game.player.x + 16, y: game.player.y + 20, angle: a, walkPhase: 2.0, pose: 'aim' };
    game.traffic[2].name = 'VANTARO SEDAN';
    // Tracers in flight along the aim line and the muzzle flash, frozen at the capture tick.
    const mx = game.player.x + Math.cos(a) * 16, my = game.player.y + Math.sin(a) * 16;
    game.bullets = [26, 50, 70].map((d) => ({
      x: game.player.x + Math.cos(a) * d, y: game.player.y + Math.sin(a) * d, angle: a, life: 0.5,
    }));
    // Hit feedback on the struck sedan: impact sparks + a bright flash at its
    // flank, damage smoke (soft sprites) climbing off it.
    game.fx.particles = [
      { x: mx, y: my, vx: 0, vy: 0, life: 0.07, maxLife: 0.07, color: '#ffd76a', size: 5.5, drag: 0 },
      { x: 2452, y: 998, vx: 0, vy: 0, life: 0.4, maxLife: 0.4, color: '#f2c14e', size: 3.4, drag: 0 },
      { x: 2458, y: 994, vx: 0, vy: 0, life: 0.32, maxLife: 0.32, color: '#ffd76a', size: 2.8, drag: 0 },
      { x: 2450, y: 1002, vx: 0, vy: 0, life: 0.45, maxLife: 0.45, color: '#fff3c4', size: 4.2, drag: 0 },
      { x: 2462, y: 990, vx: 0, vy: 0, life: 1.0, maxLife: 1.0, color: 'rgba(120,120,125,0.6)', size: 7, drag: 0 },
      { x: 2472, y: 982, vx: 0, vy: 0, life: 0.9, maxLife: 0.9, color: 'rgba(120,120,125,0.5)', size: 5.5, drag: 0 },
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
    // The chain's real per-job payouts (400+700+900+1,200+2,000 = $5,200),
    // shown as the results breakdown.
    game.jobEarnings = [
      { title: 'First Run', pay: 400 }, { title: 'Borrowed Wheels', pay: 700 },
      { title: 'Front Page', pay: 900 }, { title: 'Two Drops', pay: 1200 },
      { title: 'Heavy Metal', pay: 2000 },
    ];
    // The full ledger: all five jobs settled from their plans (house crew
    // Dex + Milo, fence 18%) — gross to net per job, REP per job, and the
    // chain history above is these same settlements' nets.
    game.plan = { jobIndex: 4, entry: 0, crew: ['dex', 'milo'], gear: ['duffels'], getaway: 'armored', timeOfDay: 'golden' };
    game.timeGrade = 'golden';
    game.chainLedger = [0, 1, 2, 3, 4].map((i) => settlePlan(i, { entry: 0, crew: ['dex', 'milo'], gear: ['duffels'], getaway: 'armored', timeOfDay: 'golden' }, jobPlanData(i).gross));
    game.lastLedger = game.chainLedger[4];
    game.rep = game.chainLedger.reduce((s, l) => s + l.repGain, 0);
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
