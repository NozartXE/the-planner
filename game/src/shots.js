// shots.js — deterministic screenshot staging: ?shot=cover|plan|combat|results
// (plus a legacy chase scene, no longer in the shipped set).
// Each scene builds a fresh world, applies a plan, steps the REAL simulation
// with a simple autopilot, and leaves the game on the requested screen.
// Cover is staged inside a car, so it renders in the raycast chase view;
// combat is the on-foot verb shot (firefight at the target, crew with loot
// bags, alarm running, police arriving, peds and traffic around, full HUD);
// plan is the planning-board feature shot; results restores the progression
// evidence (settlement, grade, run history, next teaser).
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
    // PHASE 2 restage (panel fix E1): the fight moves OFF the grass and
    // onto HARBOR AVE, on the street in front of the target's named
    // south facade (AURUM GRAND, door at 300,403; facade spans
    // x 180..421, y 212..389). The player stands in the avenue at
    // (215,520) aiming north: asphalt foreground, the facade filling
    // the background with its street-level sign, two police cars in an
    // echelon in front of the facade, a traffic car in the west lane,
    // crew at the player's shoulder, the getaway on AURUM WAY behind.
    plan.timeOfDay = 'dusk';
    world.beginHeist(heist, plan);
    const m = world.mission;
    m.phase = 'grab'; m.alarmStarted = true; m.alarmT = 31;
    m.lootGrabbed = Math.round(m.lootTotal * 0.45);
    world.player.x = 215; world.player.y = 520;
    world.player.car = null;
    world.heat = 60; world.stars = 3;
    world.forcePolice(2, 232, 452);
    const cops = world.cars.filter((c) => c.police);
    const aim = { x: 230, y: 446 };
    // Fire the REAL sim at the police line: shots, tracers, return fire.
    for (let i = 0; i < 80; i++) world.step(1 / 60, fakeInput([], [], { down: true }), aim);
    // Post-step freeze: exact placements (no further steps run).
    const p = world.player;
    p.x = 215; p.y = 520; p.car = null;
    m.phase = 'grab'; m.alarmStarted = true; m.alarmT = 30;
    m.lootGrabbed = Math.round(m.lootTotal * 0.45);
    world.heat = 60; world.stars = 3;
    world.heli.active = false;
    const copSlots = [[214, 436], [302, 466]];
    cops.forEach((cp, i) => {
      const sl = copSlots[i % copSlots.length];
      cp.x = sl[0]; cp.y = sl[1];
      cp.angle = Math.atan2(p.y - cp.y, p.x - cp.x);
      cp.speed = 0; cp.disabled = false;
    });
    p.bust = 0; // the frozen frame is mid-firefight, not mid-arrest
    // Traffic in frame: one southbound car in the avenue's west lane,
    // beside the aim lane, headlights toward the camera.
    const traffic = world.cars.filter((c) => !c.police && c !== world.getawayCar);
    if (traffic[0]) { traffic[0].x = 172; traffic[0].y = 482; traffic[0].angle = Math.PI / 2; traffic[0].speed = 0; }
    if (traffic[1]) { traffic[1].x = 356; traffic[1].y = 606; traffic[1].angle = Math.PI; traffic[1].speed = 0; }
    for (let i = 2; i < traffic.length; i++) {
      if (Math.hypot(traffic[i].x - p.x, traffic[i].y - p.y) < 260) { traffic[i].x = p.x + 520; traffic[i].y = p.y - 260; }
    }
    if (world.getawayCar) { world.getawayCar.x = 392; world.getawayCar.y = 588; world.getawayCar.angle = 0.3; }
    // Crew AHEAD of the player (north, toward the fight — never between
    // the low foot camera and the player, where they loom as giants),
    // east of the aim lane, one carrying the loot bag.
    world.crewMembers.forEach((c, i) => {
      c.x = 232 + i * 14; c.y = 505 - i * 10;
      c.hasBag = i === 0;
      c.angle = Math.atan2(446 - c.y, 230 - c.x);
      c.walkPhase = i * 1.3 + 0.5;
      c.down = 0;
    });
    // Bystanders on both avenue sidewalks, mid-stride, all in the
    // camera's forward half (nothing spawns on top of the lens).
    const pedSlots = [[142, 478], [260, 505], [268, 428], [138, 430]];
    world.peds.slice(0, 4).forEach((pd, i) => {
      pd.x = pedSlots[i][0]; pd.y = pedSlots[i][1];
      pd.down = 0; pd.walkPhase = i * 1.1 + 0.3;
      pd.angle = i % 2 === 0 ? -Math.PI / 2 : Math.PI / 2;
    });
    // Freeze one fresh exchange: aim exactly at the lead police car so
    // the tracer + HIT spark land on it in the still.
    const cop = cops[0];
    const a = Math.atan2((cop ? cop.y : 446) - p.y, (cop ? cop.x : 230) - p.x);
    p.aimAngle = a; p.angle = a;
    world.lastShotT = 0;
    world.particles.muzzle(p.x + Math.cos(a) * 24, p.y + Math.sin(a) * 24, a);
    world.particles.tracer(p.x + Math.cos(a) * 120, p.y + Math.sin(a) * 120, a, 110);
    if (cop) {
      const pa = Math.atan2(p.y - cop.y, p.x - cop.x);
      const d = Math.hypot(p.x - cop.x, p.y - cop.y);
      world.particles.muzzle(cop.x + Math.cos(pa) * 26, cop.y + Math.sin(pa) * 26, pa);
      world.particles.tracer((cop.x + p.x) / 2, (cop.y + p.y) / 2, pa, d / 2, '#ffb3c1', 0.14);
    }
    world.camera.x = p.x; world.camera.y = p.y;
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
  // player, a police roadblock across the road ahead, a PIT car on the
  // player's flank, dense traffic in both lanes, pursuers behind, and
  // the player's sports car at bottom-centre (~25% of the frame height).
  // After the drive steps, the frame is frozen around the car's final
  // position and recomposed onto measured slots (see the round-8 merger
  // recomposition below): nine police, seven traffic cars and sixteen
  // pavement pedestrians, every sprite fully visible and overlap-free
  // (no further steps run, so every placement is exact and
  // deterministic). The start point sits in the one downtown corridor
  // verified clear of building footprints (lots encroach on most road
  // edges in this city).
  plan.timeOfDay = 'dusk';
  world.beginHeist(heist, plan);
  const m = world.mission;
  m.phase = 'escape'; m.lootGrabbed = m.lootTotal;
  // Clear ambient traffic out of the whole camera view (staging only);
  // the staged actors below are the traffic this frame is composed
  // around. The box is wider than the view cone by more than an ambient
  // car can drive during the warm-up steps, so nothing uncontrolled can
  // wander into the composed frame.
  world.cars = world.cars.filter((c) => c === world.getawayCar || c.x > 1280 || c.y < 300 || c.y > 1230);
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
  for (let i = 0; i < 26; i++) world.step(1 / 60, fakeInput(['w']), { x: gw.x - 300, y: gw.y });
  // --- post-drive freeze: compose the hero frame around the car's final
  // position. No further steps run, so these placements are exact.
  // Near police at readable scale: a PIT car on the south flank trying to
  // turn the player, and two patrol cars ahead in the player's lane (the
  // roadblock SUVs above are the third element, at the block itself).
  const pit = makeCar(world.rng, 'sedan', gw.x - 118, gw.y + 46, Math.PI, { color: '#2f6fed', id: 6201 });
  pit.police = true; pit.driver = 'police'; pit.speed = gw.speed;
  world.cars.push(pit);
  const copAhead = makeCar(world.rng, 'sedan', gw.x - 145, gw.y - 12, Math.PI, { color: '#2f6fed', id: 6202 });
  copAhead.police = true; copAhead.driver = 'police'; copAhead.speed = gw.speed;
  world.cars.push(copAhead);
  const copAhead2 = makeCar(world.rng, 'suv', gw.x - 265, gw.y + 6, Math.PI, { color: '#2f6fed', id: 6203 });
  copAhead2.police = true; copAhead2.driver = 'police'; copAhead2.speed = gw.speed;
  world.cars.push(copAhead2);
  // Thirteen traffic cars are staged (the two ambient cars above plus
  // these eleven); the recomposition below deals them into the frame.
  const trafficStage = [
    ['compact', -225, 958, Math.PI, '#ffd60a', 6301],
    ['suv', -330, 962, Math.PI, '#90be6d', 6302],
    ['coupe', -375, 988, Math.PI, '#f72585', 6303],
    ['sedan', -480, 986, Math.PI, '#4cc9f0', 6304],
    ['compact', -560, 964, Math.PI, '#e9ecef', 6305],
    ['truck', -410, 956, Math.PI, '#bc6c25', 6306],
    ['sedan', -190, 1028, 0, '#ff9770', 6307],
    ['suv', -275, 1042, 0, '#adb5bd', 6308],
    ['coupe', -350, 1016, 0, '#7209b7', 6309],
    ['sedan', -440, 1034, 0, '#06d6a0', 6310],
    ['compact', -530, 1012, 0, '#fb8500', 6311],
  ];
  for (const [cls, dx, y, ang, color, id] of trafficStage) {
    const tc = makeCar(world.rng, cls, gw.x + dx, y, ang, { color, id });
    tc.driver = 'traffic';
    tc.traffic = { dir: ang === 0 ? 1 : -1, vertical: false, cruise: 150, waypoint: null };
    tc.speed = 150;
    world.cars.push(tc);
  }
  // --- round-8 merger recomposition. The old staging piled the police
  // into one clipped cluster (sprites interpenetrating, a yellow car
  // wedged inside, peds intersecting the pile). Every actor is now dealt
  // to a measured absolute slot: each position was verified against the
  // chase camera's building z-buffer (fully visible, never clipped by a
  // facade) and against every other sprite's screen rectangle (no two
  // vehicles overlap; the one south pursuer's rectangle grazes only the
  // hero sprite's empty top-left corner, so the cars never touch). The
  // three roadblock SUVs trade their side-on line for a west-facing
  // echelon across the lanes — same count, every outline traceable.
  // Police (9 in frame): echelon + flank PIT + verge and cross-street
  // units + the south pursuer. Traffic takes the remaining verified
  // slots in pastel colours; staged traffic beyond the slot count is
  // parked east of the camera, out of frame.
  const place = (car, x, y, ang) => { if (car) { car.x = x; car.y = y; car.angle = ang; } };
  const byId = (id) => world.cars.find((c) => c.id === id);
  place(byId(5999), 627, 992, Math.PI);
  place(byId(6000), 800, 936, Math.PI);
  place(byId(6001), 758, 1014, Math.PI);
  place(byId(6201), 872, 902, Math.PI);
  place(byId(6202), 658, 962, Math.PI);
  place(byId(6203), 500, 876, Math.PI);
  const pursuers = world.cars.filter((c) => c.police && c.id >= 5000 && c.id < 5100).sort((a, b) => a.id - b.id);
  place(pursuers[0], 716, 892, Math.PI);
  place(pursuers[1], 852, 1042, Math.PI);
  place(pursuers[2], 207, 808, -Math.PI / 2);
  const trafficSlots = [
    [6101, 938, 922, Math.PI, '#e8d5c4'],
    [6102, 772, 848, Math.PI, '#8fb8c8'],
    [6301, 640, 800, Math.PI / 2, '#d9a08a'],
    [6302, 614, 854, -Math.PI / 2, '#a8c8a0'],
    [6303, 196, 861, -Math.PI / 2, '#e6d9a8'],
    [6304, 275, 826, Math.PI, '#d8a8b8'],
    [6305, 460, 903, Math.PI, '#b8aed8'],
  ];
  for (const [id, x, y, ang, color] of trafficSlots) {
    const tc = byId(id);
    place(tc, x, y, ang);
    if (tc) tc.color = color;
  }
  [6306, 6307, 6308, 6309, 6310, 6311].forEach((id, i) => place(byId(id), 1500 + i * 70, 300, 0));
  // Sixteen pedestrians frozen on pavements and frontage strips
  // (existing sim entities, repositioned by staging) at the same
  // measured slots: every figure fully visible from the chase camera
  // and clear of every vehicle — nobody stands in the road, in the
  // hero car's space, or inside the police echelon.
  // PHASE 2 (panel fix E2): the right-side pavement crowd is THINNED
  // from 16 to 11 and spread along both pavements — phase 1 piled a
  // cluster under the minimap. The remaining staged peds park east of
  // the camera, out of frame.
  const pedSlots = [
    [810, 830], [726, 802], [552, 972], [447, 768], [735, 800],
    [156, 766], [453, 764], [147, 884], [561, 966], [672, 784], [141, 756],
  ];
  world.peds.slice(0, 16).forEach((pd, i) => {
    if (i < pedSlots.length) { pd.x = pedSlots[i][0]; pd.y = pedSlots[i][1]; }
    else { pd.x = 1500 + i * 60; pd.y = 300; }
    pd.down = 0;
    // Mid-stride, never a standing lineup: each figure gets its own
    // stride phase and walks along the street (east/west alternating).
    pd.walkPhase = i * 0.9 + 0.4;
    pd.angle = i % 2 === 0 ? 0 : Math.PI;
  });
  // Freeze the helicopter WHOLE in the upper frame (panel fix E2):
  // farther ahead and higher in the composition — with the pulled-back
  // low camera its rotor disc now fits inside the vertical FOV.
  world.heli.active = true;
  world.heli.x = gw.x - 365; world.heli.y = gw.y - 40;
  world.heli.lightAngle = Math.PI;
  world.heli.lightX = gw.x + 20; world.heli.lightY = gw.y + 10;
  world.heli.lightOnPlayer = true;
  game.screen = 'play';
}
