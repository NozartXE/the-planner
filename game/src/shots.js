// shots.js — deterministic screenshot staging: ?shot=cover|plan|combat|results
// (plus a legacy chase scene, no longer in the shipped set).
// Each scene builds a fresh world, applies a plan, steps the REAL simulation
// with a simple autopilot, and leaves the game on the requested screen.
// Cover is staged inside a car, so it renders in the raycast chase view;
// combat is the on-foot verb shot (firefight at the target, crew with loot
// bags, alarm running, police arriving, peds and traffic around, full HUD);
// plan is the planning-board feature shot; results restores the progression
// evidence (settlement, grade, run history, next teaser).
import { Rng } from './rng.js';
import { HEISTS, defaultPlan } from './heists.js';
import { PlanningBoard } from './planning.js';
import { makeCar } from './vehicles.js';

// A scripted input stand-in with the same interface the world consumes.
export function fakeInput(downKeys = [], pressedKeys = [], mouse = { down: false }) {
  const downSet = new Set(downKeys), pressedSet = new Set(pressedKeys);
  return {
    keys: downSet, pressed: pressedSet, mouseDown: mouse.down, mousePressed: false,
    clickX: 0, clickY: 0, clicked: false,
    down: (...n) => n.some((k) => downSet.has(k)),
    wasPressed: (...n) => n.some((k) => pressedSet.has(k)),
    moveAxis: () => ({ x: downSet.has('d') ? 1 : downSet.has('a') ? -1 : 0, y: downSet.has('s') ? 1 : downSet.has('w') ? -1 : 0 }),
    endStep: () => {},
  };
}

const IDLE = fakeInput();

export function stageShot(name, game) {
  const { world, save } = game;
  save.garage = ['compact', 'sedan', 'suv', 'sports'];
  save.unlocked = 8;
  save.cash = 48250; save.rep = 260;
  save.history = [
    { name: 'MERIDIAN TRUST VAULT', grade: 'A', net: 31240, when: 'run #3' },
    { name: 'VELMARA JEWELRY EXCHANGE', grade: 'S', net: 27410, when: 'run #2' },
    { name: 'AURUM GRAND VAULT', grade: 'B', net: 19880, when: 'run #1' },
  ];
  const heist = HEISTS[0];
  const plan = defaultPlan(heist);
  plan.crew = ['dex', 'priya', 'sana'];
  plan.gear = ['duffels', 'jammer', 'scanner'];
  plan.getaway = 'sports';
  plan.entry = 0;

  if (name === 'plan') {
    plan.timeOfDay = 'night';
    const board = new PlanningBoard(save);
    board.plan = plan;
    game.board = board;
    game.screen = 'plan';
    return;
  }

  if (name === 'combat') {
    plan.timeOfDay = 'dusk';
    world.beginHeist(heist, plan);
    const m = world.mission;
    m.phase = 'grab'; m.alarmStarted = true; m.alarmT = 31;
    m.lootGrabbed = Math.round(m.lootTotal * 0.45);
    world.player.x = m.building.doorX + 18; world.player.y = m.building.doorY - 4;
    world.player.car = null;
    world.heat = 60; world.stars = 3;
    // Crew beside the player, one carrying a bag.
    world.crewMembers.forEach((c, i) => { c.x = world.player.x - 44 + i * 40; c.y = world.player.y + 34; c.hasBag = i === 0; });
    // Bystander peds on the pavements around the target (existing sim
    // entities, repositioned by staging) so the street reads populated.
    world.peds.slice(0, 6).forEach((pd, i) => {
      pd.x = world.player.x - 150 + i * 58; pd.y = world.player.y + (i % 2 === 0 ? 92 : -86);
      pd.down = 0;
    });
    // Police arriving at the street.
    world.forcePolice(2, m.building.doorX + 210, m.building.doorY + 120);
    const cop = world.cars.find((c) => c.police);
    const aim = cop ? { x: cop.x, y: cop.y } : { x: world.player.x + 200, y: world.player.y };
    // Fire the REAL sim at the nearest police car: shots, muzzle flashes,
    // tracers, police return fire, fleeing pedestrians.
    for (let i = 0; i < 80; i++) world.step(1 / 60, fakeInput([], [], { down: true }), aim);
    // Freeze one fresh exchange on screen: the player's muzzle + tracer and
    // the nearest police car's return fire (the sim's zone-based rule).
    const p = world.player;
    const a = Math.atan2(aim.y - p.y, aim.x - p.x);
    world.lastShotT = 0;
    world.particles.muzzle(p.x + Math.cos(a) * 24, p.y + Math.sin(a) * 24, a);
    world.particles.tracer(p.x + Math.cos(a) * 120, p.y + Math.sin(a) * 120, a, 110);
    if (cop) {
      const pa = Math.atan2(p.y - cop.y, p.x - cop.x);
      const d = Math.hypot(p.x - cop.x, p.y - cop.y);
      world.particles.muzzle(cop.x + Math.cos(pa) * 26, cop.y + Math.sin(pa) * 26, pa);
      world.particles.tracer((cop.x + p.x) / 2, (cop.y + p.y) / 2, pa, d / 2, '#ffb3c1', 0.14);
    }
    world.camera.x = world.player.x; world.camera.y = world.player.y;
    game.screen = 'play';
    return;
  }

  if (name === 'results') {
    // Progression evidence: a completed heist's settlement screen — grade,
    // fence fee, crew cuts, net, REP, run history and the next-heist
    // teaser, with the buttons back to the board / free roam.
    plan.timeOfDay = 'dusk';
    world.beginHeist(heist, plan);
    const m = world.mission;
    m.phase = 'escape'; m.lootGrabbed = m.lootTotal; m.time = 196;
    world.heat = 38; world.stars = 2;
    world.finishHeist(true);
    game.screen = 'results';
    return;
  }

  if (name === 'chase') {
    // Peak pursuit in the chase view, staged distinctly from the cover:
    // NIGHT, a different heist and street (Aurum Way), heat maxed at 100 /
    // 5 stars, a spike strip on the road ahead, a patrol car pulling
    // alongside in the front quarter (PIT pressure), a roadblock beyond,
    // and the helicopter's searchlight sweeping the player.
    const heist3 = HEISTS[2];
    const plan3 = defaultPlan(heist3);
    plan3.crew = ['dex', 'priya', 'sana'];
    plan3.gear = ['duffels', 'jammer', 'scanner'];
    plan3.getaway = 'sports';
    plan3.entry = 0;
    plan3.timeOfDay = 'night';
    world.beginHeist(heist3, plan3);
    const m = world.mission;
    m.phase = 'escape'; m.lootGrabbed = m.lootTotal;
    // Clear ambient traffic out of the chase corridor (staging only).
    world.cars = world.cars.filter((c) => c === world.getawayCar || c.x < 480 || c.x > 1280 || c.y < 490 || c.y > 680);
    const gw = world.getawayCar;
    gw.x = 1150; gw.y = 578; gw.angle = Math.PI; gw.speed = 170;
    world.player.car = gw; gw.driver = 'player';
    world.player.x = gw.x; world.player.y = gw.y;
    world.heat = 100; world.stars = 5;
    // Roadblock across Aurum Way ahead: three police SUVs parked side-on.
    const block = [];
    for (let i = -1; i <= 1; i++) {
      const bc = makeCar(world.rng, 'suv', 740, 600 + i * 42, Math.PI / 2, { color: '#2f6fed', parked: true, id: 7000 + i });
      bc.police = true; bc.driver = null; bc.roadblock = true;
      world.cars.push(bc); block.push(bc);
    }
    world.roadblocks.push({ cars: block, t: 40 });
    // The crew is left behind by the escape: park them east of the
    // camera, out of frame, so the shot is purely the pursuit.
    world.crewMembers.forEach((c) => { c.mode = 'wait'; c.x = 1420; c.y = 420; });
    world.forcePolice(3, gw.x + 260, gw.y + 22);
    for (let i = 0; i < 26; i++) world.step(1 / 60, fakeInput(['w']), { x: gw.x - 300, y: gw.y });
    // Freeze the peak-pursuit dressing relative to the final position:
    // a spike strip across our lane just in front of the roadblock (far
    // enough ahead to clear the hero car's roofline in frame), a patrol
    // car alongside in the front quarter, and the helicopter in frame
    // with its light on us.
    world.spikes.push({ x: gw.x - 240, y: gw.y, t: 30 });
    const pit = makeCar(world.rng, 'sedan', gw.x - 125, gw.y + 44, Math.PI, { color: '#2f6fed', id: 7102 });
    pit.police = true; pit.driver = 'police'; pit.speed = gw.speed;
    world.cars.push(pit);
    world.heli.active = true;
    world.heli.x = gw.x - 330; world.heli.y = gw.y - 130;
    world.heli.lightX = gw.x + 20; world.heli.lightY = gw.y + 10;
    world.heli.lightOnPlayer = true;
    game.screen = 'play';
    return;
  }

  // cover (default): the busiest chase tick, staged in the raycast chase
  // view — dusk escape westbound down the Market St canyon into the
  // sunset, 5 stars, helicopter overhead with its searchlight on the
  // player, a police roadblock across the road ahead, a patrol car on
  // the shoulder, traffic in both lanes, pursuers behind, the player's
  // sports car large at bottom-centre. The start point sits in the one
  // downtown corridor verified clear of building footprints (lots
  // encroach on most road edges in this city).
  plan.timeOfDay = 'dusk';
  world.beginHeist(heist, plan);
  const m = world.mission;
  m.phase = 'escape'; m.lootGrabbed = m.lootTotal;
  // Clear ambient traffic out of the cover corridor (staging only); the
  // staged actors below are the traffic this frame is composed around.
  world.cars = world.cars.filter((c) => c === world.getawayCar || c.x < 420 || c.x > 1200 || c.y < 900 || c.y > 1060);
  const gw = world.getawayCar;
  gw.x = 1080; gw.y = 978; gw.angle = Math.PI; gw.speed = 170;
  world.player.car = gw; gw.driver = 'player';
  world.player.x = gw.x; world.player.y = gw.y;
  world.heat = 96; world.stars = 5;
  // Roadblock across Market St ahead: three police SUVs parked side-on.
  const block = [];
  for (let i = -1; i <= 1; i++) {
    const bc = makeCar(world.rng, 'suv', 700, 1000 + i * 42, Math.PI / 2, { color: '#2f6fed', parked: true, id: 6000 + i });
    bc.police = true; bc.driver = null; bc.roadblock = true;
    world.cars.push(bc); block.push(bc);
  }
  world.roadblocks.push({ cars: block, t: 40 });
  // Traffic ahead: one car in our lane pulling away, one oncoming car
  // beyond the roadblock for depth.
  const t1 = makeCar(world.rng, 'sedan', 950, 978, Math.PI, { id: 6101 });
  t1.driver = 'traffic'; t1.traffic = { dir: -1, vertical: false, cruise: 150, waypoint: null };
  t1.speed = 150;
  world.cars.push(t1);
  const t2 = makeCar(world.rng, 'coupe', 560, 1030, 0, { id: 6102 });
  t2.driver = 'traffic'; t2.traffic = { dir: 1, vertical: false, cruise: 150, waypoint: null };
  t2.speed = 150;
  world.cars.push(t2);
  // Pursuers on our tail (they converge during the drive steps).
  world.forcePolice(3, gw.x + 260, gw.y + 22);
  const rng = new Rng(99);
  void rng;
  for (let i = 0; i < 26; i++) world.step(1 / 60, fakeInput(['w']), { x: gw.x - 300, y: gw.y });
  // Pedestrians frozen on both Market St pavements ahead (existing sim
  // entities, repositioned by staging after the drive) so the canyon
  // reads lived-in without anyone standing in the hero car's bonnet.
  world.peds.slice(0, 6).forEach((pd, i) => {
    pd.x = gw.x - 150 - i * 82; pd.y = gw.y + (i % 2 === 0 ? -62 : 62);
    pd.down = 0;
  });
  // Freeze the helicopter in frame, ahead and above, light on the player
  // (its hover lag would otherwise leave it behind the camera).
  world.heli.active = true;
  world.heli.x = gw.x - 330; world.heli.y = gw.y - 130;
  world.heli.lightX = gw.x + 20; world.heli.lightY = gw.y + 10;
  world.heli.lightOnPlayer = true;
  game.screen = 'play';
}
