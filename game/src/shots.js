// shots.js — deterministic staging for screenshots: ?shot=title|chase|mission|results|map
// (plus board, and the measurement-only scale scenes) runs the real simulation first,
// then sets one explicit, coherent mid-chain state per shot and freezes it. Everything
// that appears on screen (money, stars, mission, speeds, crowds, cops, effects) is set
// AFTER the run steps, so a re-capture is byte-identical and nothing drifts between
// frames. Staging is framed for the 3D CHASE CAM (view3d.js): the camera sits 72–84
// units behind the hero looking along the hero's heading, so every actor that must be
// SEEN is placed ahead of the hero or beside it — never in the dead zone between the
// camera and the hero.
//
// HOW THIS FILE IS ORGANISED (re-authorship round, 2026-11-22): the staging used to be
// seven hand-written blocks inside one long function. It is now a declarative table,
// SHOT_STAGES: each shot is a list of step rows, and one small interpreter (runSteps)
// walks the rows and applies them through the primitive setters below (setCar,
// stagePed, addCop, putPlayerInCar, setMission, finish). A row is data — a screen
// change, a run length, a field assignment, a car/ped/cop placement, a bulk clear —
// and the few stagings that genuinely COMPUTE their values from other staged values
// (the chase formation is hero-relative, the mission shot line is solved from the
// player's aim angle, the ledgers settle real plans) are 'do' rows holding that
// computation, in the same position in the sequence as the values they produce.
// Every staged value is carried in the table exactly as the old blocks set it; the
// byte-identical captures are the proof (see qa/verification-2026-11-22.md).
import { makeCopCar } from './cars.js';
import { CHAIN } from './missions.js';
import { planStats, settlePlan, weaponForPlan, jobPlanData } from './planning.js';

// The staged plans: one coherent chain story. Jobs 1-2 are banked ($1,350),
// job 3 (Front Page) is planned on the board and executed in the chase with
// the SAME plan object values, job 4 runs at dusk with the extended mag,
// and the results ledger settles all five with the house crew (Dex + Milo).
export const STAGED_PLAN_J3 = { jobIndex: 2, entry: 2, crew: ['dex', 'milo'], gear: ['duffels', 'extmag'], getaway: 'coupe', timeOfDay: 'golden', weaponId: 'rl-havoc' };
export const STAGED_PLAN_J4 = { jobIndex: 3, entry: 0, crew: ['dex', 'milo'], gear: ['duffels', 'extmag'], getaway: 'sedan', timeOfDay: 'dusk', weaponId: 'venn-9mm' };

// ------------------------------------------------------------ primitives
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
function stagePed(game, idx, x, y, angle, phase, gaitIdx, style) {
  const ped = game.peds[idx % game.peds.length];
  ped.x = x; ped.y = y; ped.angle = angle; ped.dead = false;
  ped.walkPhase = phase; ped.phase = phase;
  ped.fleeUntil = 0;
  if (typeof gaitIdx === 'number') ped.gait = STAGE_GAITS[gaitIdx % STAGE_GAITS.length];
  // A staged POSE (routed by view3d's buildFigures ahead of the sim-derived
  // default) and deterministic clothing colours. Calls without a style keep
  // the standing behaviour exactly — pose cleared, colours untouched.
  ped.pose = style && style.pose ? style.pose : null;
  if (style) {
    if (style.shirt) ped.shirt = style.shirt;
    if (style.pants) ped.pants = style.pants;
    if (style.skin) ped.skin = style.skin;
    if (style.hair) ped.hairColor = style.hair;
  }
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

// ------------------------------------------------------------ interpreter
// Step rows (first element is the op):
//   ['screen', v]                      game.screen = v
//   ['run', n]                         step the real simulation n frames at 1/60
//   ['set', path, value]               assign one field by dot path ('player.x')
//   ['sets', [[path, value], ...]]     assign several fields, in order
//   ['setNow', path]                   assign game.nowMs (a staging timestamp)
//   ['plan', planObj, statsJob|null]   game.plan = a crew/gear-copying clone of
//                                      planObj; when statsJob is a number, also
//                                      game.planStatsCache = planStats(statsJob, plan, 0)
//   ['weaponFromPlan']                 game.weapon = weaponForPlan(game.plan)
//   ['stars', n] / ['starsFromPlan']   police.setStars(n | planStatsCache.heatStars)
//   ['car', t, x, y, angle, speed, style?]        setCar on game.traffic[t]
//   ['cars', [carRow, ...]]                       several 'car' rows
//   ['heroCar', t, x, y, angle, speed, style?, extra?]  putPlayerInCar on
//                                      game.traffic[t], then extra fields (steer, name)
//   ['cop', x, y, angle, extra?]       addCop, then extra fields (speed, steer, hp)
//   ['tactics']                        assignTactics + lastSeen at the player
//   ['ped', i, x, y, angle, phase, gait, style?]  stagePed
//   ['peds', [pedRow, ...]]                       several 'ped' rows
//   ['parkFar', from, dx, skip?]       every traffic car from index `from` (minus
//                                      the skipped indices) parked in the far
//                                      south-east corner: (3300 + i*dx, 3300)
//   ['mission', index, stage, timeLeft]           setMission
//   ['clear', {cops, bullets, particles, skids, toasts}]  empty the named lists
//   ['call', method]                   game[method]()
//   ['do', fn]                         fn(game, ctx) — a computed staging step;
//                                      ctx carries values between 'do' rows of
//                                      one shot (the chase hero, the aim solve)
//   ['finish'] / ['finishCam', x, y]   freeze the frame (finish primitive)
function cloneData(value) {
  if (Array.isArray(value)) return value.map(cloneData);
  if (value && typeof value === 'object') {
    const o = {};
    for (const k of Object.keys(value)) o[k] = cloneData(value[k]);
    return o;
  }
  return value;
}
function setPath(game, path, value) {
  const parts = path.split('.');
  let node = game;
  for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]];
  // Plain-data values are cloned: the table's literals are definitions, and
  // each staging run must hand the game its own fresh object, exactly as the
  // old blocks' inline literals did.
  node[parts[parts.length - 1]] = cloneData(value);
}
function clonePlan(plan) {
  return { ...plan, crew: [...plan.crew], gear: [...plan.gear] };
}
const OPS = {
  screen: (game, step, row) => { game.screen = row[1]; },
  run: (game, step, row) => { for (let i = 0; i < row[1]; i++) step(1 / 60); },
  set: (game, step, row) => setPath(game, row[1], row[2]),
  sets: (game, step, row) => { for (const [path, value] of row[1]) setPath(game, path, value); },
  setNow: (game, step, row) => setPath(game, row[1], game.nowMs),
  plan: (game, step, row) => {
    game.plan = clonePlan(row[1]);
    if (typeof row[2] === 'number') game.planStatsCache = planStats(row[2], game.plan, 0);
  },
  planStats: (game, step, row) => { game.planStatsCache = planStats(row[1], game.plan, 0); },
  weaponFromPlan: (game) => { game.weapon = weaponForPlan(game.plan); },
  stars: (game, step, row) => game.police.setStars(row[1], game.nowMs),
  starsFromPlan: (game) => game.police.setStars(game.planStatsCache.heatStars, game.nowMs),
  car: (game, step, row) => setCar(game.traffic[row[1]], row[2], row[3], row[4], row[5], row[6]),
  cars: (game, step, row) => { for (const r of row[1]) OPS.car(game, step, ['car', ...r]); },
  heroCar: (game, step, row) => {
    const car = game.traffic[row[1]];
    putPlayerInCar(game, car, row[2], row[3], row[4], row[5], row[6]);
    if (row[7]) for (const k of Object.keys(row[7])) car[k] = row[7][k];
    return car;
  },
  cop: (game, step, row) => {
    const cop = addCop(game, row[1], row[2], row[3]);
    if (row[4]) for (const k of Object.keys(row[4])) cop[k] = row[4][k];
    return cop;
  },
  tactics: (game) => {
    game.police.assignTactics(game.player);
    game.police.lastSeenX = game.player.x; game.police.lastSeenY = game.player.y;
  },
  ped: (game, step, row) => stagePed(game, row[1], row[2], row[3], row[4], row[5], row[6], row[7]),
  peds: (game, step, row) => { for (const r of row[1]) OPS.ped(game, step, ['ped', ...r]); },
  parkFar: (game, step, row) => {
    const skip = row[3] || [];
    for (let i = row[1]; i < game.traffic.length; i++) {
      if (skip.includes(i)) continue;
      setCar(game.traffic[i], 3300 + i * row[2], 3300, 0, 0);
    }
  },
  mission: (game, step, row) => setMission(game, row[1], row[2], row[3]),
  clear: (game, step, row) => {
    const f = row[1];
    if (f.cops) game.police.cops = [];
    if (f.bullets) game.bullets = [];
    if (f.particles) game.fx.particles = [];
    if (f.skids) game.fx.skids = [];
    if (f.toasts) game.toasts = [];
  },
  call: (game, step, row) => game[row[1]](),
  do: (game, step, row, ctx) => row[1](game, ctx),
  finish: (game) => finish(game),
  finishCam: (game, step, row) => finish(game, row[1], row[2]),
};
function runSteps(game, step, steps) {
  const ctx = {};
  for (const row of steps) {
    const op = OPS[row[0]];
    if (!op) throw new Error('shots.js: unknown staging op ' + row[0]);
    op(game, step, row, ctx);
  }
}

// Reset rows applied to every shot except the board (the board staging predates
// these hooks and never carried them): render-test hooks, the staged scooter
// (chase only), the title vista flag (title only), the staged helicopter
// (mission only).
const PROLOGUE = [
  ['set', 'shotHeroCar', null],
  ['set', 'debugHidePlayer', false],
  ['set', 'debugHideHeroCar', false],
  ['set', 'idRender', false],
  ['set', 'stagedScooter', null],
  ['set', 'titleVista', false],
  ['set', 'stagedHeli', null],
];

// ------------------------------------------------------------ computed steps
// Chase formation: every placement is hero-relative through at(), so the whole
// hunt rotates with the hero's heading. The hero runs MID-BLOCK EAST along the
// Gazette avenue (it was frozen IN the intersection, where the road grammar has
// its designed gap and the formation read as a parked queue). Displayed speed:
// round(150 * 0.62) = 93 km/h — the staged hero speed was 225 (a 140 km/h
// readout over a formation that read as queued traffic at a cordon); 150
// matches the pursuit units' own staged speed. Exactly five interceptors for
// the plan's forecast five stars: a PIT unit crossing the hero's front-north
// quarter at a mid-PIT angle (0.52 rad, wheels cut back, contact damage
// smoking), two pursuit units echeloned at varied gaps (124 / 96 — inside the
// sim's own tactical bands, so assignTactics honestly labels them PURSUIT) and
// lateral offsets (−27 / +24), and a roadblock pair PERPENDICULAR across both
// lanes far ahead, silhouettes fully separated.
function chaseFormation(game, ctx) {
  const hero = game.traffic[0];
  ctx.hero = hero;
  const rot = (a, x, y) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
  const at = (car, x, y) => { const r = rot(car.angle, x, y); return { x: car.x + r.x, y: car.y + r.y }; };
  ctx.at = at;
  // Traffic on the road surface only: ONE distant eastbound car stopped short
  // of the roadblock, the other traffic car staged behind the camera, a second
  // civilian rolling up the opposing lane behind the roadblock, one car PARKED
  // at the south curb mid-block, and TWO civilian cars running EAST in the
  // hero's own lane direction at mid-distance beyond the roadblock (traffic
  // that was already fleeing the cordon). Kinds are set EXPLICITLY so the
  // frame shows at least three distinct civilian kinds.
  const civ = at(hero, 700, -8);
  setCar(game.traffic[1], civ.x, civ.y, Math.PI, 0, { kind: 'coupe', color: '#8a4a5a' });
  const behind = at(hero, -380, 15);
  setCar(game.traffic[2], behind.x, behind.y, 0, 40);
  const civ2 = at(hero, 560, -21);
  setCar(game.traffic[3], civ2.x, civ2.y, Math.PI, 55, { kind: 'sedan', color: '#5f7a6a' });
  const curb = at(hero, 430, 37);
  setCar(game.traffic[4], curb.x, curb.y, 0, 0);
  const flee1 = at(hero, 470, 12);
  setCar(game.traffic[5], flee1.x, flee1.y, 0, 45, { kind: 'sedan', color: '#6a7a8a' });
  const flee2 = at(hero, 585, 16);
  setCar(game.traffic[6], flee2.x, flee2.y, 0, 45, { kind: 'hatch', color: '#a8835a' });
  game.police.cops = [];
  const contact = at(hero, 16, -14);
  ctx.contact = contact;
  const pitAngle = 0.52;
  ctx.pitAngle = pitAngle;
  const pitPos = at(hero, 30, -30);
  const pit = addCop(game, pitPos.x, pitPos.y, pitAngle);
  pit.speed = 150; pit.steer = -0.42; pit.hp = 44; // contact damage: smokes at the touch point
  ctx.pit = pit;
  const pu1 = at(hero, 124, 14);
  const pursuit1 = addCop(game, pu1.x, pu1.y, 0.06); pursuit1.speed = 150; pursuit1.steer = 0.14;
  const pu2 = at(hero, 96, -37);
  const pursuit2 = addCop(game, pu2.x, pu2.y, -0.05); pursuit2.speed = 150; pursuit2.steer = -0.10;
  const bl1 = at(hero, 268, -42);
  const block1 = addCop(game, bl1.x, bl1.y, Math.PI / 2); block1.speed = 0;
  const bl2 = at(hero, 276, 8);
  const block2 = addCop(game, bl2.x, bl2.y, -Math.PI / 2); block2.speed = 0;
  game.police.assignTactics(game.player);
  game.police.lastSeenX = hero.x; game.police.lastSeenY = hero.y;
}
// Chase motion evidence (staging/capture-moment only — the formation geometry
// above is untouched): skid ARCS, five longer, wider segments per side behind
// the hero, trailing ~95 units with the angle opening and the track drifting
// outward as it falls back; three matching segments behind the PIT cop. Then
// the frozen effects: a denser spark burst at the contact point, a stacked
// contact-smoke PLUME at the PIT touch point (six puffs at staggered life
// ratios, stacked into a rising column), and layered tyre smoke at the hero's
// rear tyres and the PIT cop's front tyres.
function chaseEffects(game, ctx) {
  const { hero, pit, contact, at } = ctx;
  const pitAngle = ctx.pitAngle;
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
}
// Mission shot line (aim coherence, solved — not eyeballed): the staged shot's
// actual first contact with the target sedan is the point where the reticle
// ray strikes the cabin's rear glass — the Phase 3 impact point (992.3, 1070)
// slid TOWARD THE CAMERA along that same ray, 18 units for the impact sparks
// (renderer height z 10.5) and 19.5 units for the final tracer (z 11.5, one
// unit higher, so its glow lands exactly ON the cross). The train flies the
// REAL shot line from the gun tip (figure build: lean 1.5 + 15.2 forward,
// +0.28 lateral — the point qa/measure.mjs mirrors as the muzzle) to that
// contact point as TWELVE rounds at even t = k/12 steps: each tracer's bar is
// ~16 units long against a ~5.4-unit step, so the bars and their glows overlap
// into ONE continuous streak from muzzle to impact (the earlier 4-round burst
// read as segmented streaks with a stray muzzle-side glow). Hit feedback: a
// tight stack of nine impact sparks within ±1.8 units of the contact point
// (offsets sum to zero, so the measure's centroid is the contact point
// itself), the muzzle flash, damage smoke off the sedan, and the tank's
// muzzle smoke at its barrel tip.
function missionShotLine(game, ctx) {
  const a = game.player.angle;
  const flank = { x: 992.3, y: 1070 };
  const camX = game.player.x - Math.cos(a) * 40 - Math.sin(a) * 26;
  const camY = game.player.y - Math.sin(a) * 40 + Math.cos(a) * 26;
  const rayX = flank.x - camX, rayY = flank.y - camY;
  const rayL = Math.hypot(rayX, rayY);
  const slide = (k) => ({ x: flank.x - (rayX / rayL) * k, y: flank.y - (rayY / rayL) * k });
  const impact = slide(18);
  const bulletEnd = slide(19.5);
  const muzX = game.player.x + Math.cos(a) * 16.7 - Math.sin(a) * 0.28;
  const muzY = game.player.y + Math.sin(a) * 16.7 + Math.cos(a) * 0.28;
  const segA = Math.atan2(bulletEnd.y - muzY, bulletEnd.x - muzX);
  game.bullets = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((k) => {
    const t = k / 12;
    return {
      x: muzX + (bulletEnd.x - muzX) * t, y: muzY + (bulletEnd.y - muzY) * t, angle: segA, life: 0.5,
    };
  });
  const sparkOff = [[1.2, 0.6], [-1.2, -0.6], [0.6, -1.2], [-0.6, 1.2], [1.8, 1.4], [-1.8, -1.4], [0, 0], [-1.5, 1.0], [1.5, -1.0]];
  const sparkCols = ['#f2c14e', '#ffd76a', '#fff3c4'];
  const sparkLife = [0.4, 0.32, 0.45, 0.38, 0.42, 0.34, 0.44, 0.36, 0.41];
  const sparks = sparkOff.map((o, i) => ({
    x: impact.x + o[0], y: impact.y + o[1], vx: 0, vy: 0,
    life: sparkLife[i], maxLife: sparkLife[i], color: sparkCols[i % 3], size: 2.8 + (i % 4) * 0.5, drag: 0,
  }));
  const mx = game.player.x + Math.cos(a) * 16, my = game.player.y + Math.sin(a) * 16;
  game.fx.particles = [
    { x: mx, y: my, vx: 0, vy: 0, life: 0.07, maxLife: 0.07, color: '#ffd76a', size: 5.5, drag: 0 },
    ...sparks,
    { x: 1001, y: 1066, vx: 0, vy: 0, life: 1.0, maxLife: 1.0, color: 'rgba(120,120,125,0.6)', size: 7, drag: 0 },
    { x: 1013, y: 1058, vx: 0, vy: 0, life: 0.9, maxLife: 0.9, color: 'rgba(120,120,125,0.5)', size: 5.5, drag: 0 },
    { x: 986, y: 834, vx: 0, vy: 0, life: 0.8, maxLife: 1.0, color: 'rgba(120,120,125,0.55)', size: 6.5, drag: 0 },
    { x: 992, y: 837, vx: 0, vy: 0, life: 0.62, maxLife: 1.0, color: 'rgba(120,120,125,0.5)', size: 8, drag: 0 },
  ];
}
// The chain ledgers: real settlements of real plans (house crew Dex + Milo,
// fence 18%) — gross to net per job, REP per job. Map settles jobs 1-3,
// results settles all five.
const LEDGER_PLAN = { entry: 0, crew: ['dex', 'milo'], gear: ['duffels'], getaway: 'armored', timeOfDay: 'golden' };
function settleJobs(game, ctx, jobs) {
  game.chainLedger = jobs.map((i) => settlePlan(i, { ...LEDGER_PLAN, crew: [...LEDGER_PLAN.crew], gear: [...LEDGER_PLAN.gear] }, jobPlanData(i).gross));
  game.rep = game.chainLedger.reduce((s, l) => s + l.repGain, 0);
}
// Measurement-scene crowd control: every ped gathered in the far corner
// behind the camera, alive and calm. Row pitch differs per scene (9 in a
// 8-wide grid at two different corner rows), so it is a computed step.
function gatherPeds(x0, y0) {
  return (game) => {
    game.peds.forEach((ped, i) => { ped.x = x0 + (i % 8) * 9; ped.y = y0 + Math.floor(i / 8) * 9; ped.dead = false; ped.fleeUntil = 0; });
  };
}

// ------------------------------------------------------------ the shot table
const SHOT_STAGES = {
  // The Planning Board for job 3 (Front Page), mid-planning: entry BOLD
  // chosen, Dex + Milo hired, duffels + extended mag packed, the Comet as
  // getaway at golden hour — and the live stats already forecast the 5-star
  // heat the chase shot then actually fields. The board floats over the real
  // target street: Gazette Plaza, camera down its east road canyon. The full
  // weapon wheel rides THIS frame (open over the board's street corridor
  // with the RL segment selected — the same HAVOC TUBE the plan's ARSENAL
  // strip picks), so the mission frame is free to prove combat instead of a
  // menu. boardStage is NOT set, so hud.js takes its unstaged path; the
  // capture stages the FULL board — drawn district map, full PLAN STATS
  // rows, full CREW + GEAR lists — exactly the live-play layout.
  board: [
    ['screen', 'play'],
    ['run', 150],
    ['screen', 'planning'],
    ['sets', [['missions.index', 2], ['missions.active', false], ['missions.stage', 'idle']]],
    ['plan', STAGED_PLAN_J3, null],
    ['set', 'gearFocus', 1],
    ['sets', [['wheelOpen', true], ['wheelClass', 5], ['wheelIndex', 0]]],
    ['planStats', 2],
    ['sets', [
      ['planTarget', { x: 986, y: 986 }], ['planOrbitAngle', 0], ['timeGrade', 'golden'], ['money', 1350],
      ['player.inCar', false], ['player.car', null],
      ['player.x', 1042], ['player.y', 1004], ['player.angle', Math.PI], ['player.hp', 100],
    ]],
    // Backdrop traffic on the target street itself (the east–west road the
    // board looks down) plus the density rounds: a car ROLLING through the
    // revealed centre, one PARKED at the north curb, and one CROSSING the
    // foreground intersection northbound on the cross street's east lane —
    // moving vs parked poses, all in lane discipline, none under a panel.
    ['cars', [
      [1, 880, 963, Math.PI, 30],
      [2, 700, 1009, 0, 35],
      [3, 1090, 1009, 0, 30],
      [4, 600, 963, Math.PI, 30],
      [5, 740, 963, Math.PI, 30],
      [6, 880, 924, 0, 0],
      [7, 1009, 1040, -Math.PI / 2, 30, { kind: 'sedan', color: '#7a8a99' }],
    ]],
    ['peds', [
      [0, 920, 928, 0.4, 1.2, 0],
      [1, 1060, 928, -0.6, 3.0, 1],
      [2, 930, 1044, 2.6, 5.0, 2],
      [3, 1080, 1044, -2.2, 2.2, 3],
      [4, 780, 932, -0.6, 4.2, 1],
      [5, 850, 1040, 2.6, 1.4, 2],
      [6, 760, 932, -0.6, 2.8, 1],
      [7, 700, 1040, 2.6, 0.9, 3],
      [8, 640, 928, 0.4, 4.6, 2],
      [9, 968, 975, -Math.PI / 2, 2.0, 0],
      [10, 995, 1015, Math.PI / 2, 4.4, 1],
    ]],
    ['clear', { cops: true }],
    ['stars', 0],
    ['clear', { bullets: true, particles: true, skids: true, toasts: true }],
    ['finish'],
  ],
  // A TITLE VISTA at NIGHT, not a street frame. The renderer has exactly one
  // elevated camera — the planning orbit (235 units out, 105 up, looking at
  // planTarget) — so the staging raises titleVista and main.js renders the
  // title's world pass through that framing; the drawTitle overlay owns the
  // centre. Current framing (fix round, both panel seats' #1 defect on the
  // previous frame): MID-BLOCK on the St Sable avenue (x 1456), camera at
  // (1456, 2274) looking SOUTH at planTarget (1456, 2509) with
  // planOrbitAngle −PI/2 — no intersection at the target, so no zebra arm
  // projects into the text zone; the hero coupe (1432, 2409, facing south) +
  // player figure (1472, 2402) stand 135 / 128 units out in the foreground,
  // their silhouettes topping out BELOW the save line; far traffic rides the
  // avenue at 600+ units as horizon silhouettes above the logotype; two
  // foreground peds stand on the avenue sidewalks. (The coast framing this
  // vista wants is PROVEN still blocked — see qa/verification-2026-11-22.md.)
  title: [
    ['screen', 'title'],
    ['run', 150],
    ['screen', 'title'],
    ['sets', [
      ['timeGrade', 'night'], ['titleVista', true],
      ['planTarget', { x: 1456, y: 2509 }], ['planOrbitAngle', -Math.PI / 2],
      ['player.inCar', false], ['player.car', null],
      ['player.x', 1472], ['player.y', 2402], ['player.angle', Math.PI / 2],
      ['player.walkPhase', 1.1], ['player.vx', 0], ['player.vy', 0], ['player.hp', 100],
    ]],
    ['car', 0, 1432, 2409, Math.PI / 2, 0, { kind: 'coupe', color: '#b8523f' }],
    ['set', 'traffic.0.occupiedByPlayer', false],
    ['cars', [
      [1, 1476, 2874, Math.PI / 2, 40, { kind: 'sedan', color: '#5f7a6a' }],
      [2, 1436, 2954, Math.PI / 2, 40, { kind: 'hatch', color: '#a8835a' }],
      [3, 1476, 3034, Math.PI / 2, 40, { kind: 'sedan', color: '#7a8a99' }],
    ]],
    ['parkFar', 4, 10],
    ['peds', [
      [0, 1404, 2404, 0.4, 1.2, 0],
      [1, 1508, 2399, -0.6, 3.0, 1],
      [2, 1404, 2800, 2.6, 5.0, 2],
      [3, 1508, 2800, -2.2, 2.2, 3],
    ]],
    ['clear', { cops: true }],
    ['stars', 0],
    ['clear', { bullets: true, particles: true, skids: true, toasts: true }],
    ['finish'],
  ],
  // 5-star pursuit east along the Gazette avenue, frozen at the PIT contact
  // moment. Jobs 1–2 are done ($1,350) and the current job is 3, "Front
  // Page". The plan from the board, executed: its forecast IS the wanted
  // level (5 stars, so 5 interceptors — one per star), its getaway IS the
  // hero car (VELOZ COMET), its gear built the weapon. The frame's grade is
  // bright DAY; the plan object itself keeps its golden timeOfDay — its
  // heat forecast is computed from it and must not move.
  chase: [
    ['screen', 'play'],
    ['run', 150],
    ['screen', 'play'],
    ['heroCar', 0, 1200, 1477, 0, 150, { kind: 'coupe', color: '#7a4a3a', hp: 31, maxHp: 90 }, { steer: 0.30 }],
    ['do', chaseFormation],
    // Peds clear of the roadway: three on the park-side south sidewalk
    // (y 1512), two on the north sidewalk (y 1396), two far figures toward
    // the vanishing point.
    ['peds', [
      [0, 1500, 1396, 0, 0.7, 0],
      [1, 1750, 1396, Math.PI, 2.4, 1],
      [2, 1600, 1512, Math.PI, 4.0, 2],
      [3, 1850, 1512, 0, 1.5, 3],
      [4, 1400, 1396, Math.PI, 5.3, 0],
      [5, 1900, 1512, 0, 2.9, 1],
      [6, 1980, 1396, Math.PI, 1.7, 2],
      // The boulevard CROWD: 14 more figures spread over BOTH sidewalks,
      // the planted median (y 1456, on the median strip runs, clear of
      // every vehicle) and the zebra crossing at the intersection ahead
      // (x ≈1518–1522, the east arm). None stands in a traffic lane, none
      // blocks the hero or the pursuit formation, and every one wears
      // deterministic varied clothing / skin / hair with its own gait and
      // walk phase. [i, x, y, angle, phase, gait, style]
      [7, 1280, 1396, Math.PI, 0.9, 1, { shirt: '#b8452e', pants: '#2e3440', skin: '#8a5a34', hair: '#17171a' }],
      [8, 1320, 1396, 0, 3.4, 2, { shirt: '#2e6f8e', pants: '#3a332a', skin: '#d9b48f', hair: '#3d2c1c' }],
      [9, 1560, 1396, Math.PI, 5.1, 0, { shirt: '#d9a441', pants: '#2c3a34', skin: '#e8c39a', hair: '#5a4632' }],
      [10, 1720, 1396, 0, 1.8, 3, { shirt: '#5f8a4a', pants: '#40303a', skin: '#b87f56', hair: '#2b2118' }],
      [11, 1880, 1396, Math.PI, 4.2, 1, { shirt: '#7a4a8e', pants: '#333338', skin: '#6e4526', hair: '#41303e' }],
      [12, 1290, 1512, 0, 2.6, 2, { shirt: '#3f7f8c', pants: '#31404e', skin: '#d9b48f', hair: '#77716a' }],
      [13, 1350, 1512, Math.PI, 0.4, 3, { shirt: '#c9742e', pants: '#2e3440', skin: '#8a5a34', hair: '#17171a' }],
      [14, 1580, 1512, 0, 5.7, 0, { shirt: '#8e2e4a', pants: '#3a332a', skin: '#e8c39a', hair: '#3d2c1c' }],
      [15, 1780, 1512, Math.PI, 2.1, 1, { shirt: '#4a6fa5', pants: '#2c3a34', skin: '#b87f56', hair: '#5a4632' }],
      [16, 1950, 1512, 0, 3.9, 2, { shirt: '#a5b83f', pants: '#40303a', skin: '#d9b48f', hair: '#2b2118' }],
      [17, 1370, 1456, 0, 1.3, 0, { shirt: '#e0e0d8', pants: '#333338', skin: '#6e4526', hair: '#17171a' }],
      [18, 1650, 1456, Math.PI, 4.8, 3, { shirt: '#2e8e6f', pants: '#31404e', skin: '#e8c39a', hair: '#41303e' }],
      [19, 1518, 1438, Math.PI / 2, 2.9, 1, { shirt: '#b83f6f', pants: '#2e3440', skin: '#8a5a34', hair: '#3d2c1c' }],
      [20, 1522, 1472, -Math.PI / 2, 0.2, 2, { shirt: '#416fa5', pants: '#3a332a', skin: '#d9b48f', hair: '#5a4632' }],
    ]],
    // The scooter beat: a step-through scooter PARKED at the NORTH kerb in
    // the chase mid-field (1440, 1413), its rider still seated, hands on
    // the bar, in the 'ride' pose. Built by view3d's buildScooter.
    ['set', 'stagedScooter', {
      x: 1440, y: 1413, angle: 0, color: '#3f7f8c',
      rider: { shirt: '#c94f38', pants: '#2e3440', skin: '#8a5a34', hair: '#17171a' },
    }],
    ['sets', [['money', 1350], ['radio.stationIdx', 1], ['radio.trackIdx', 0]]],
    ['plan', STAGED_PLAN_J3, 2],
    ['starsFromPlan'],
    ['set', 'traffic.0.name', 'VELOZ COMET'],
    ['weaponFromPlan'],
    ['set', 'timeGrade', 'day'],
    ['mission', 2, 'pickup', 78],
    ['set', 'player.hp', 100],
    ['clear', { bullets: true, toasts: true }],
    ['do', chaseEffects],
    ['finish'],
  ],
  // The aim frame: a single over-the-shoulder-RIGHT shooter on the Gazette
  // Plaza streets — the job's own drop point. The player stands on the east
  // sidewalk of the north–south avenue south of the Gazette intersection,
  // firing NNW over-shoulder at a struck, smoking sedan on the avenue ~88
  // units ahead; the OTS aim cam puts him ALONE in the lower-left
  // foreground — Dex is backgrounded to the west sidewalk in a stand pose.
  // FIVE interceptors (== the 5 wanted stars == the board's 5-star
  // forecast, claim-aligned) cordon the intersection: a perpendicular
  // roadblock pair across the avenue north of the crossing, one unit
  // angled behind them, and two pursuit units angled in at the southern
  // corners. The BASTION tank holds the avenue beyond the roadblock,
  // barrel pointing back down the street, muzzle still smoking. ONE police
  // helicopter hovers over the intersection just north of the roadblock at
  // altitude 65, its spotlight pool on the road at the struck sedan's
  // south-east flank — staged ATMOSPHERE only, not a police.cops unit, so
  // the dispatch claim stays exactly cops 5 == stars 5 == roster 5. Job 4's
  // plan, executed: the extended-mag gear built an 18-round VENN 9MM and
  // three rounds are already fired — the readout (15/48) is the sim's own
  // count. The frame renders at DUSK, job 4's plan timeOfDay. The wheel is
  // CLOSED on this frame — its proof lives on the board.
  mission: [
    ['screen', 'play'],
    ['run', 150],
    ['screen', 'play'],
    ['sets', [
      ['player.inCar', false], ['player.car', null],
      ['player.x', 1040], ['player.y', 1158],
    ]],
    // Aim line onto the target sedan: the tracers fly this exact angle. The
    // sedan stands at (1008, 1076), ≈88 units ahead.
    ['do', (game) => { game.player.angle = Math.atan2(1076 - 1158, 1008 - 1040); }],
    ['sets', [['player.walkPhase', 1.1], ['player.vx', 30], ['player.vy', 2], ['player.hp', 92]]],
    // The tank on the avenue beyond the roadblock, on the aim axis: hull
    // angled so the camera reads front quarter + flank, turret traversed
    // back toward the fight. The second tank parks far behind the camera.
    ['sets', [
      ['specials.0.x', 986], ['specials.0.y', 800], ['specials.0.angle', 1.35],
      ['specials.0.turret', 1.57], ['specials.0.speed', 0], ['specials.0.dead', false], ['specials.0.hp', 590],
      ['specials.1.x', 430], ['specials.1.y', 3240], ['specials.1.angle', 0.8],
    ]],
    ['cars', [
      [1, 1008, 1076, -1.45, 0, { kind: 'sedan', color: '#54604f', hp: 18, maxHp: 100 }],
      [2, 790, 965, Math.PI, 0, { kind: 'sedan', color: '#8a6a4a' }],
      [3, 1180, 1007, 0, 0, { kind: 'hatch', color: '#5a7a8a' }],
    ]],
    ['parkFar', 0, 10, [1, 2, 3]],
    ['clear', { cops: true }],
    ['cop', 962, 940, 0, { speed: 0 }],
    ['cop', 1014, 940, Math.PI, { speed: 0 }],
    ['cop', 982, 886, 0.35, { speed: 0 }],
    ['cop', 1108, 1064, 2.75, { speed: 120 }],
    ['cop', 872, 1078, -0.5, { speed: 120 }],
    ['tactics'],
    ['peds', [
      [0, 1052, 1080, 0.4, 2.2, 0],
      [1, 928, 1100, -2.2, 4.0, 1],
      [2, 1120, 1004, Math.PI, 1.1, 2],
      [3, 900, 986, 0.8, 3.1, 3],
      [4, 1150, 1085, -2.4, 3.3, 1],
      [5, 860, 1040, 0.9, 1.8, 2],
    ]],
    ['do', (game) => {
      for (const idx of [0, 1]) { const ped = game.peds[idx]; ped.fleeUntil = game.nowMs + 60000; ped.fleeX = 1008; ped.fleeY = 1076; }
    }],
    // The shootout's human consequence — the staged crowd REACTS: six
    // civilians on BOTH sidewalks in 'flee' / 'armsup' poses, every one
    // oriented AWAY from the gunfire (its angle is the direction from the
    // struck sedan at (1008, 1076) to the ped); one figure DOWN on the
    // road's east edge just south-east of the sedan; and the target's own
    // crew beside the sedan, hands up, facing the shooter. The aim corridor
    // (player (1040, 1158) → sedan) stays clear of every one of them.
    ['peds', [
      [6, 1050, 1110, 0.68, 2.0, 0, { pose: 'armsup', shirt: '#b8452e', pants: '#2e3440', skin: '#8a5a34', hair: '#17171a' }],
      [7, 1045, 1050, -0.61, 3.6, 1, { pose: 'armsup', shirt: '#2e6f8e', pants: '#3a332a', skin: '#d9b48f', hair: '#3d2c1c' }],
      [8, 1062, 1095, 0.34, 1.1, 2, { pose: 'flee', shirt: '#d9a441', pants: '#2c3a34', skin: '#e8c39a', hair: '#5a4632' }],
      [9, 930, 1120, 2.63, 4.4, 3, { pose: 'flee', shirt: '#5f8a4a', pants: '#40303a', skin: '#b87f56', hair: '#2b2118' }],
      [10, 934, 1020, -2.50, 0.6, 0, { pose: 'armsup', shirt: '#7a4a8e', pants: '#333338', skin: '#6e4526', hair: '#41303e' }],
      [11, 924, 1080, 3.09, 5.2, 1, { pose: 'flee', shirt: '#3f7f8c', pants: '#31404e', skin: '#d9b48f', hair: '#77716a' }],
      [12, 1031, 1114, Math.PI / 2, 0, 0, { pose: 'down', shirt: '#8e2e4a', pants: '#3a332a', skin: '#e8c39a', hair: '#3d2c1c' }],
      [13, 1022, 1082, 1.34, 0, 0, { pose: 'armsup', shirt: '#54604f', pants: '#2e3440', skin: '#b87f56', hair: '#17171a' }],
      [14, 993, 1062, 1.12, 0, 1, { pose: 'armsup', shirt: '#c9742e', pants: '#31404e', skin: '#d9b48f', hair: '#5a4632' }],
    ]],
    ['set', 'money', 2250],
    ['stars', 5],
    ['mission', 3, 'dropA', 96],
    ['setNow', 'lastShotAt'],
    ['plan', STAGED_PLAN_J4, 3],
    // The frame's grade follows the plan (J4's timeOfDay is 'dusk') instead
    // of overriding it, so streetlight pools carry the shootout's low light.
    ['do', (game) => { game.timeGrade = game.plan.timeOfDay; }],
    ['weaponFromPlan'],
    ['set', 'weapon.mag', 15],
    ['do', (game) => { game.missions.lootGrabbed = game.planStatsCache.loot; }],
    ['set', 'crewMate', { id: 'dex', name: 'DEX RUIZ', color: '#e8c832', x: 934, y: 1112, angle: -0.4, walkPhase: 0.6, pose: 'stand' }],
    ['set', 'projectiles', []],
    // The molotov patch tightens onto the sedan's hood point (1010, 1057 —
    // its nose at angle −1.45) at r 15, so with the renderer's burning-engine
    // state for the sedan's staged hp 18 the fire reads as the CAR burning
    // at its engine, not a ground pool burning beside it.
    ['do', (game) => { game.zones = [{ kind: 'fire', x: 1010, y: 1057, r: 15, until: game.nowMs + 60000, dps: 26 }]; }],
    ['set', 'stagedHeli', { x: 960, y: 985, z: 65, angle: 2.25, spotX: 1026, spotY: 1092 }],
    ['do', missionShotLine],
    ['sets', [['wheelOpen', false], ['wheelClass', 5], ['wheelIndex', 0]]],
    ['clear', { toasts: true }],
    ['finish'],
  ],
  // The pause Map screen over a staged mid-chain DUSK scene — the same
  // chain story the other frames tell, one job later than the mission
  // frame's street moment: jobs 1-3 are banked (their established nets
  // 400 + 700 + 900 = $2,000 on top of the $250 start = $2,250 cash), job 4
  // (Two Drops) is under way at dropA with its plan executed — the grab is
  // done, Dex is on the street, and the wanted level IS that plan's
  // forecast (planStats heat 2.8 -> 3 stars, 3 units staged). Every number
  // the Map screen prints is this state's own field.
  map: [
    ['screen', 'play'],
    ['run', 150],
    ['screen', 'play'],
    ['set', 'timeGrade', 'dusk'],
    ['plan', STAGED_PLAN_J4, 3],
    ['heroCar', 0, 1200, 1477, 0, 120, { kind: 'sedan', color: '#7a4a3a' }, { name: 'VANTARO SEDAN' }],
    ['cars', [
      [1, 1650, 1468, 0, 40, { kind: 'sedan', color: '#5f7a6a' }],
      [2, 1850, 1490, Math.PI, 0, { kind: 'hatch', color: '#a8835a' }],
    ]],
    ['parkFar', 3, 10],
    ['clear', { cops: true }],
    ['cop', 1080, 1460, 0, { speed: 120 }],
    ['cop', 1112, 1505, 0.1, { speed: 120 }],
    ['cop', 1018, 1477, -0.05, { speed: 120 }],
    ['tactics'],
    ['starsFromPlan'],
    ['peds', [
      [0, 1500, 1512, Math.PI, 2.4, 1],
      [1, 1600, 1396, 0, 1.5, 3],
      [2, 1350, 1512, 0, 4.0, 2],
    ]],
    ['sets', [
      ['money', 2250], ['totalEarned', 2000], ['missionsCompleted', 3], ['chainsFinished', 0],
      ['jobsThisChain', 3], ['chainEarned', 2000], ['carsStolen', 3], ['timesWasted', 0], ['bestEscapeMs', 52000],
    ]],
    ['set', 'jobEarnings', [
      { title: 'First Run', pay: 400 }, { title: 'Borrowed Wheels', pay: 700 },
      { title: 'Front Page', pay: 900 },
    ]],
    ['do', (game, ctx) => settleJobs(game, ctx, [0, 1, 2])],
    ['mission', 3, 'dropA', 96],
    ['do', (game) => { game.missions.lootGrabbed = game.planStatsCache.loot; }],
    ['weaponFromPlan'],
    ['set', 'crewMate', { id: 'dex', name: 'DEX RUIZ', color: '#e8c832', x: 1150, y: 1512, angle: 0.4, walkPhase: 0.6, pose: 'stand' }],
    ['set', 'player.hp', 100],
    ['clear', { bullets: true, particles: true, toasts: true }],
    ['screen', 'map'],
    ['finish'],
  ],
  // End-of-chain outcome screen at the beachfront: job 5 ("Heavy Metal")
  // has just been delivered in the armored sedan, the whole chain is done
  // and the summary panel is up over Ocean Drive — deco facades to the
  // left, sand and water to the right. Money story: $250 start + 400 + 700
  // + 900 + 1,200 + 2,000 = $5,450 cash, $5,200 earned on this chain. The
  // hero parks on Ocean Drive beside the eastern park block (bx 7, by 5 —
  // a park, so no east-plot building covers the road there; verified
  // against the generated city). Camera south of the car looks north: park
  // trees left, sand + water + boats right, deco skyline ahead. The frame
  // settles at DUSK — the chain's last light, streetlight pools on Ocean
  // Drive behind the panel; the plan record keeps its own timeOfDay.
  results: [
    ['screen', 'play'],
    ['run', 150],
    ['screen', 'play'],
    ['heroCar', 5, 3714, 2700, -Math.PI / 2, 0, { kind: 'armored', color: '#3f444c', hp: 150, maxHp: 220 }],
    ['stars', 0],
    ['clear', { cops: true }],
    ['cop', 3693, 2396, -Math.PI / 2, { speed: 0 }],
    ['cars', [
      [6, 3714, 2460, -Math.PI / 2, 0, { kind: 'sedan', color: '#7a8a99' }],
      [7, 3693, 2210, Math.PI / 2, 0, { kind: 'hatch', color: '#a8835a' }],
    ]],
    ['peds', [
      [0, 3655, 2580, -Math.PI / 2, 1.2, 1],
      [1, 3782, 2560, Math.PI, 3.8, 2],
      [2, 3500, 2620, 0, 5.6, 0],
      [3, 3662, 2480, Math.PI / 2, 2.0, 3],
      [4, 3796, 2860, Math.PI, 4.4, 1],
      [5, 3650, 2920, -Math.PI / 2, 0.8, 2],
      [6, 3796, 2620, Math.PI, 2.6, 3],
      [7, 3652, 2600, -Math.PI / 2, 5.1, 0],
    ]],
    ['sets', [
      ['money', 5450], ['totalEarned', 5200], ['missionsCompleted', 5], ['chainsFinished', 1],
      ['jobsThisChain', 5], ['chainEarned', 5200], ['bestEscapeMs', 41000], ['carsStolen', 7], ['timesWasted', 1],
    ]],
    ['set', 'jobEarnings', [
      { title: 'First Run', pay: 400 }, { title: 'Borrowed Wheels', pay: 700 },
      { title: 'Front Page', pay: 900 }, { title: 'Two Drops', pay: 1200 },
      { title: 'Heavy Metal', pay: 2000 },
    ]],
    ['set', 'plan', { jobIndex: 4, entry: 0, crew: ['dex', 'milo'], gear: ['duffels'], getaway: 'armored', timeOfDay: 'golden' }],
    ['set', 'timeGrade', 'dusk'],
    ['do', (game, ctx) => settleJobs(game, ctx, [0, 1, 2, 3, 4])],
    ['do', (game) => { game.lastLedger = game.chainLedger[4]; }],
    ['sets', [
      ['missions.index', 0], ['missions.loop', 1], ['missions.active', false], ['missions.stage', 'idle'],
      ['missions.briefUntil', 0], ['missions.lastBrief', ''], ['player.hp', 100],
    ]],
    ['clear', { bullets: true, particles: true, skids: true }],
    ['call', 'showSummary'],
    ['clear', { toasts: true, bullets: true }],
    ['finish'],
  ],
  // MEASUREMENT SCENE (never shipped): the player stands mid-stride on the
  // Hotel Aurelia avenue beside the hero coupe, both at the same forward
  // depth from the foot chase cam, nothing else in frame. The capture
  // harness re-renders this state with game.idRender = true (flat ID
  // colours: figure green, car blue) and measures the rasterised pixel
  // bboxes/areas for the scale acceptance check. Both face NORTH on the
  // vertical avenue: an east-facing pair put the car half out of frame and
  // its rear corner ~20 units closer to the lens, which corrupts the
  // comparison this scene exists to make.
  scale: [
    ['screen', 'play'],
    ['run', 150],
    ['screen', 'play'],
    ['sets', [
      ['player.inCar', false], ['player.car', null],
      ['player.x', 1000], ['player.y', 1477], ['player.angle', -Math.PI / 2],
      ['player.walkPhase', 1.1], ['player.vx', 0], ['player.vy', -30], ['player.hp', 100],
    ]],
    ['car', 0, 1018, 1479, -Math.PI / 2, 0, { kind: 'coupe', color: '#c22730' }],
    ['set', 'traffic.0.occupiedByPlayer', false],
    ['do', (game) => { game.shotHeroCar = game.traffic[0]; }],
    ['parkFar', 1, 12],
    ['clear', { cops: true }],
    ['stars', 0],
    ['do', gatherPeds(3350, 3350)],
    ['sets', [['missions.active', false], ['missions.stage', 'idle'], ['missions.briefUntil', 0], ['money', 0]]],
    ['clear', { bullets: true, particles: true, skids: true, toasts: true }],
    ['finish'],
  ],
  // MEASUREMENT SCENES (never shipped): the player stands beside the tank
  // (or the plane) at the same forward depth, ID-rendered like ?shot=scale.
  scaletank: [
    ['screen', 'play'],
    ['run', 150],
    ['screen', 'play'],
    ['sets', [
      ['player.inCar', false], ['player.car', null],
      ['player.x', 1000], ['player.y', 1477], ['player.angle', -Math.PI / 2],
      ['player.walkPhase', 1.1], ['player.vx', 0], ['player.vy', -30], ['player.hp', 100],
    ]],
    ['do', scaleVehicle(0)],
    ['parkFar', 0, 12],
    ['do', parkOtherSpecials(0)],
    ['clear', { cops: true }],
    ['stars', 0],
    ['do', gatherPeds(3350, 3400)],
    ['sets', [['missions.active', false], ['missions.stage', 'idle'], ['missions.briefUntil', 0], ['money', 0]]],
    ['clear', { bullets: true, particles: true, skids: true, toasts: true }],
    ['finish'],
  ],
  scaleplane: [
    ['screen', 'play'],
    ['run', 150],
    ['screen', 'play'],
    ['sets', [
      ['player.inCar', false], ['player.car', null],
      ['player.x', 1000], ['player.y', 1477], ['player.angle', -Math.PI / 2],
      ['player.walkPhase', 1.1], ['player.vx', 0], ['player.vy', -30], ['player.hp', 100],
    ]],
    ['do', scaleVehicle(2)],
    ['parkFar', 0, 12],
    ['do', parkOtherSpecials(2)],
    ['clear', { cops: true }],
    ['stars', 0],
    ['do', gatherPeds(3350, 3400)],
    ['sets', [['missions.active', false], ['missions.stage', 'idle'], ['missions.briefUntil', 0], ['money', 0]]],
    ['clear', { bullets: true, particles: true, skids: true, toasts: true }],
    ['finish'],
  ],
};
// The measured vehicle beside the player in the scale scenes, and every
// other special parked in the far corner. (Defined after the table because
// the table references them as 'do' rows; they are only invoked when a
// staging runs, by which time both are initialised.)
function scaleVehicle(idx) {
  return (game) => {
    const veh = game.specials[idx];
    veh.x = 1034; veh.y = 1479; veh.angle = -Math.PI / 2; veh.dead = false;
    if (veh.turret !== undefined) veh.turret = -Math.PI / 2;
    if (veh.alt !== undefined) veh.alt = 0;
  };
}
function parkOtherSpecials(idx) {
  return (game) => {
    const veh = game.specials[idx];
    for (const sp of game.specials) if (sp !== veh) { sp.x = 3350; sp.y = 3350; }
  };
}

export function applyShot(game, name, step) {
  if (name === 'board') {
    runSteps(game, step, SHOT_STAGES.board);
    return true;
  }
  runSteps(game, step, PROLOGUE);
  const stages = SHOT_STAGES[name];
  if (!stages) return false;
  runSteps(game, step, stages);
  return true;
}
