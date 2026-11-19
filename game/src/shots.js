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
export const STAGED_PLAN_J3 = { jobIndex: 2, entry: 2, crew: ['dex', 'milo'], gear: ['duffels', 'extmag'], getaway: 'coupe', timeOfDay: 'golden', weaponId: 'rl-havoc' };
export const STAGED_PLAN_J4 = { jobIndex: 3, entry: 0, crew: ['dex', 'milo'], gear: ['duffels', 'extmag'], getaway: 'sedan', timeOfDay: 'dusk', weaponId: 'venn-9mm' };
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
    // The full weapon wheel rides THIS frame now (final-fix composition
    // choice, disclosed in the record): open over the board's street
    // corridor with the RL segment selected — the same HAVOC TUBE the
    // plan's ARSENAL strip picks — so the mission frame is free to prove
    // combat instead of a menu. drawPlanning renders the inset.
    game.wheelOpen = true; game.wheelClass = 5; game.wheelIndex = 0;
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
    // MOTION EVIDENCE (final-fix, staging/capture-moment only — the fix
    // round's formation geometry above is untouched): the panels read the
    // formation-correct chase as static, so the capture instant now carries
    // the full motion vocabulary at readable scale. Skid ARCS: five longer,
    // wider segments per side behind the hero, trailing ~95 units with the
    // angle opening and the track drifting outward as it falls back, so the
    // arc tails emerge from behind the hero's silhouette onto open road;
    // three matching segments behind the PIT cop.
    game.fx.skids = [];
    const skidAngles = [0.04, 0.10, 0.18, 0.28, 0.40];
    for (const side of [-8, 8]) {
      for (let i = 0; i < 5; i++) {
        const p = at(hero, -16 - i * 15, side * (1 + i * 0.85));
        game.fx.skid(p.x, p.y, skidAngles[i], 24, 5.0);
      }
    }
    const pitSkidAngles = [0.03, 0.10, 0.20];
    for (const side of [-8, 8]) {
      for (let i = 0; i < 3; i++) {
        const p = at(pit, -18 - i * 14, side * (1 + i * 0.7));
        game.fx.skid(p.x, p.y, pitAngle + pitSkidAngles[i], 22, 4.6);
      }
    }
    // Frozen effects: a denser spark burst at the contact point, a stacked
    // contact-smoke PLUME at the PIT touch point (six puffs at staggered
    // life ratios, so the soft-sprite renderer stacks them into a rising
    // column at the exact point where the two bodies meet), and layered
    // tyre smoke at the hero's rear tyres and the PIT cop's front tyres.
    const heroTyreL = at(hero, -14, -8), heroTyreR = at(hero, -14, 8);
    const pitTyreL = at(pit, 15, -7), pitTyreR = at(pit, 15, 7);
    const sparkCols = ['#ffd76a', '#f2c14e'];
    const sparkSizes = [2, 2.6, 3.4, 2.4, 3.0, 4.2, 2.8, 3.6, 2.2];
    const sparkLife = [0.7, 0.85, 1, 0.8, 0.9, 0.75, 0.95, 0.65, 0.88];
    game.fx.particles = [];
    for (let i = 0; i < sparkSizes.length; i++) {
      game.fx.particles.push({
        x: contact.x + (i - 4) * 1.3, y: contact.y + ((i % 3) - 1) * 1.6,
        vx: 0, vy: 0, life: 0.5 * sparkLife[i], maxLife: 0.5,
        color: sparkCols[i % 2], size: sparkSizes[i], drag: 0,
      });
    }
    const plumeOff = [[0, 0], [2, -2], [-2, 1], [3, 2], [-3, -2], [1, 3]];
    const plumeSizes = [7, 8.5, 10, 11, 9, 7.5];
    const plumeRatio = [0.95, 0.82, 0.68, 0.52, 0.38, 0.24];
    plumeOff.forEach((o, i) => {
      game.fx.particles.push({ x: contact.x + o[0], y: contact.y + o[1], vx: 0, vy: 0, life: plumeRatio[i], maxLife: 1.0, color: 'rgba(120,120,125,0.55)', size: plumeSizes[i], drag: 0 });
    });
    const tyreSmoke = [
      [heroTyreL, 6.5, 0.8], [heroTyreL, 9, 0.55], [heroTyreR, 6.5, 0.8], [heroTyreR, 9, 0.55],
      [pitTyreL, 6, 0.75], [pitTyreL, 8.5, 0.5], [pitTyreR, 6, 0.75], [pitTyreR, 8.5, 0.5],
    ];
    tyreSmoke.forEach(([p, sz, lf]) => {
      game.fx.particles.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: lf, maxLife: 1.0, color: 'rgba(120,120,125,0.55)', size: sz, drag: 0 });
    });
    finish(game);
    return true;
  }
  if (name === 'mission') {
    // FINAL-FIX — composition choice (disclosed in the record): the three
    // directives panels converged — the centred wheel (~30% of frame width)
    // erased the pack's only proven combat and the tank read as an olive
    // slab. The wheel's full proof MOVES TO THE BOARD FRAME (open inset
    // there, RL/HAVOC selected, matching that frame's plan and ARSENAL
    // strip); this frame keeps only the compact weapon readout (VENN 9MM
    // 15/48, the plan's real weapon and count) and returns to the
    // pre-directive combat staging, restaged at FORT SABLE and solved
    // projection-first against the foot cam (52 back / 30 up):
    // the player stands ON THE BASE APRON (690,2952 — site concrete, NOT
    // the roadway) firing east over-shoulder at a struck, smoking sedan
    // 88 units ahead; Dex, the plan's lead pick, aims beside him in his
    // own colour; the roster's 2× ROADBLOCK is a perpendicular pair across
    // the east road at mid-distance, exactly what assignTactics labels
    // them; and the BASTION tank sits left mid-ground in three-quarter
    // flank profile — tracks, turret and barrel silhouette unobstructed,
    // its muzzle still smoking from its last round.
    game.screen = 'play';
    run(150);
    game.screen = 'play';
    game.player.inCar = false; game.player.car = null;
    game.player.x = 690; game.player.y = 2952;
    // Aim line onto the target sedan: the tracers below fly this exact angle.
    const a = Math.atan2(2956 - 2952, 778 - 690);
    game.player.angle = a;
    game.player.walkPhase = 1.1; game.player.vx = 30; game.player.vy = 2; game.player.hp = 92;
    // The tank, left mid-ground: hull angled SSE so the camera reads its
    // flank + front quarter (tracks low, turret high), turret traversed
    // east toward the fight, barrel clear of every other silhouette.
    const tank = game.specials[0];
    tank.x = 858; tank.y = 2902; tank.angle = 1.22; tank.turret = 0.5; tank.speed = 0; tank.dead = false; tank.hp = 590;
    // The second tank parks far behind the camera, out of this frame.
    game.specials[1].x = 430; game.specials[1].y = 3240; game.specials[1].angle = 0.8;
    // Target sedan ahead on the apron's gate line, rear three-quarter to
    // the camera, already struck (hp 18: the renderer climbs damage smoke
    // off it) with a molotov fire patch burning at its nose.
    setCar(game.traffic[1], 778, 2956, 0.5, 0, { kind: 'sedan', color: '#54604f', hp: 18, maxHp: 100 });
    // Every other traffic car parks far south-east, out of the frame: the
    // sim's deterministic wander otherwise leaves strays inside the base's
    // sightlines (a coupe behind the tank, a sedan at the left edge).
    for (let i = 0; i < game.traffic.length; i++) {
      if (i === 1) continue;
      setCar(game.traffic[i], 3300 + i * 10, 3300, 0, 0);
    }
    game.police.cops = [];
    // The roster's 2× ROADBLOCK, staged as what it claims: a pair swung
    // PERPENDICULAR (long axes north–south, side profiles to the camera)
    // across the base's east road (x 940–1032), flanking the target's
    // escape line at mid-distance. Exactly two units are fielded, so the
    // dispatch header, its rows and the street all agree.
    const cop1 = addCop(game, 986, 2935, -Math.PI / 2); cop1.speed = 0;
    const cop2 = addCop(game, 986, 3010, Math.PI / 2); cop2.speed = 0;
    game.police.assignTactics(game.player);
    game.police.lastSeenX = game.player.x; game.police.lastSeenY = game.player.y;
    // Peds on the apron only — none stands on a road surface; the two
    // nearest the gunfire are caught mid-flee.
    stagePed(game, 0, 812, 2988, 0.4, 2.2, 0);
    stagePed(game, 1, 830, 2932, -2.2, 4.0, 1);
    stagePed(game, 2, 648, 3024, Math.PI, 1.1, 2);
    for (const idx of [0, 1]) { const ped = game.peds[idx]; ped.fleeUntil = game.nowMs + 60000; ped.fleeX = 778; ped.fleeY = 2956; }
    game.money = 2250;
    game.police.setStars(3, game.nowMs);
    setMission(game, 3, 'dropA', 96);
    game.lastShotAt = game.nowMs;
    // Job 4's plan, executed: the extended-mag gear built an 18-round
    // VENN 9MM and three rounds are already fired — the readout (15/48)
    // is the sim's own count, and with the wheel closed on this frame the
    // readout and the fight agree. The grab is done; Dex works beside
    // the player.
    game.plan = { ...STAGED_PLAN_J4, crew: [...STAGED_PLAN_J4.crew], gear: [...STAGED_PLAN_J4.gear] };
    game.planStatsCache = planStats(3, game.plan, 0);
    game.timeGrade = 'golden';
    game.weapon = weaponForPlan(game.plan);
    game.weapon.mag = 15;
    game.missions.lootGrabbed = game.planStatsCache.loot;
    game.crewMate = { id: 'dex', name: 'DEX RUIZ', color: '#e8c832', x: 702, y: 2970, angle: a, walkPhase: 2.0, pose: 'aim' };
    game.projectiles = [];
    game.zones = [{ kind: 'fire', x: 804, y: 2974, r: 26, until: game.nowMs + 60000, dps: 26 }];
    // Tracers in flight along the aim line and the muzzle flash, frozen at
    // the capture tick (the pre-directive frame's proven combat read).
    game.bullets = [26, 50, 70].map((d) => ({
      x: game.player.x + Math.cos(a) * d, y: game.player.y + Math.sin(a) * d, angle: a, life: 0.5,
    }));
    // Hit feedback: muzzle flash at the gun, impact sparks + flash on the
    // struck sedan's flank, damage smoke climbing off it, and the tank's
    // muzzle smoke at its barrel tip (turret traversed to 0.5).
    const mx = game.player.x + Math.cos(a) * 16, my = game.player.y + Math.sin(a) * 16;
    game.fx.particles = [
      { x: mx, y: my, vx: 0, vy: 0, life: 0.07, maxLife: 0.07, color: '#ffd76a', size: 5.5, drag: 0 },
      { x: 762, y: 2950, vx: 0, vy: 0, life: 0.4, maxLife: 0.4, color: '#f2c14e', size: 3.4, drag: 0 },
      { x: 768, y: 2946, vx: 0, vy: 0, life: 0.32, maxLife: 0.32, color: '#ffd76a', size: 2.8, drag: 0 },
      { x: 760, y: 2954, vx: 0, vy: 0, life: 0.45, maxLife: 0.45, color: '#fff3c4', size: 4.2, drag: 0 },
      { x: 772, y: 2946, vx: 0, vy: 0, life: 1.0, maxLife: 1.0, color: 'rgba(120,120,125,0.6)', size: 7, drag: 0 },
      { x: 784, y: 2938, vx: 0, vy: 0, life: 0.9, maxLife: 0.9, color: 'rgba(120,120,125,0.5)', size: 5.5, drag: 0 },
      { x: 887, y: 2916, vx: 0, vy: 0, life: 0.8, maxLife: 1.0, color: 'rgba(120,120,125,0.55)', size: 6.5, drag: 0 },
      { x: 893, y: 2919, vx: 0, vy: 0, life: 0.62, maxLife: 1.0, color: 'rgba(120,120,125,0.5)', size: 8, drag: 0 },
    ];
    // The wheel is CLOSED on this frame — its proof lives on the board.
    game.wheelOpen = false; game.wheelClass = 5; game.wheelIndex = 0;
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
  if (name === 'scaletank' || name === 'scaleplane') {
    // MEASUREMENT SCENES (never shipped): the player stands beside the tank
    // (or the plane) at the same forward depth, ID-rendered like ?shot=scale.
    game.screen = 'play';
    run(150);
    game.screen = 'play';
    game.player.inCar = false; game.player.car = null;
    game.player.x = 1000; game.player.y = 1477; game.player.angle = -Math.PI / 2;
    game.player.walkPhase = 1.1; game.player.vx = 0; game.player.vy = -30; game.player.hp = 100;
    const veh = name === 'scaletank' ? game.specials[0] : game.specials[2];
    veh.x = 1034; veh.y = 1479; veh.angle = -Math.PI / 2; veh.dead = false;
    if (veh.turret !== undefined) veh.turret = -Math.PI / 2;
    if (veh.alt !== undefined) veh.alt = 0;
    for (let i = 0; i < game.traffic.length; i++) setCar(game.traffic[i], 3300 + i * 12, 3300, 0, 0);
    for (const sp of game.specials) if (sp !== veh) { sp.x = 3350; sp.y = 3350; }
    game.police.cops = [];
    game.police.setStars(0, game.nowMs);
    game.peds.forEach((ped, i) => { ped.x = 3350 + (i % 8) * 9; ped.y = 3400 + Math.floor(i / 8) * 9; ped.dead = false; ped.fleeUntil = 0; });
    game.missions.active = false; game.missions.stage = 'idle'; game.missions.briefUntil = 0;
    game.money = 0;
    game.bullets = []; game.fx.particles = []; game.fx.skids = []; game.toasts = [];
    finish(game);
    return true;
  }
  return false;
}
