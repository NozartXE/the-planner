// shots.js — deterministic screenshot staging: ?shot=cover|plan|combat|heist.
// Each scene builds a fresh world, applies a plan, steps the REAL simulation
// with a simple autopilot, and leaves the game on the requested screen.
import { Rng } from './rng.js';
import { HEISTS, defaultPlan } from './heists.js';
import { PlanningBoard } from './planning.js';

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

  if (name === 'heist') {
    // A different heist + night, so this frame cannot be mistaken for the
    // combat shot: warehouse grab under lamps and lit windows, crew with
    // loot bags on a crowded street, police arriving.
    const heist2 = HEISTS[4];
    const plan2 = defaultPlan(heist2);
    plan2.crew = ['dex', 'priya', 'sana'];
    plan2.gear = ['duffels', 'jammer', 'scanner'];
    plan2.getaway = 'sports';
    plan2.entry = 0;
    plan2.timeOfDay = 'night';
    world.beginHeist(heist2, plan2);
    const m = world.mission;
    m.phase = 'grab'; m.alarmStarted = true; m.alarmT = 31;
    m.lootGrabbed = Math.round(m.lootTotal * 0.45);
    world.player.x = m.building.doorX + 18; world.player.y = m.building.doorY - 4;
    world.player.car = null;
    world.heat = 46; world.stars = 3;
    // Crew beside the player, one carrying a bag.
    world.crewMembers.forEach((c, i) => { c.x = world.player.x - 44 + i * 40; c.y = world.player.y + 30; c.hasBag = i === 0; });
    // Police arriving at the street.
    world.forcePolice(2, m.building.doorX + 190, m.building.doorY + 130);
    // Fleeing pedestrians nearby.
    for (let i = 0; i < 60; i++) world.step(1 / 60, fakeInput([], [], { down: false }), { x: world.player.x + 200, y: world.player.y });
    world.camera.x = world.player.x; world.camera.y = world.player.y;
    game.screen = 'play';
    return;
  }

  // cover (default): dusk chase downtown with 5 stars + helicopter.
  plan.timeOfDay = 'dusk';
  world.beginHeist(heist, plan);
  const m = world.mission;
  m.phase = 'escape'; m.lootGrabbed = m.lootTotal;
  const gw = world.getawayCar;
  gw.x = 1060; gw.y = 1010; gw.angle = 0.5; gw.speed = 240;
  world.player.car = gw; gw.driver = 'player';
  world.player.x = gw.x; world.player.y = gw.y;
  world.heat = 96; world.stars = 5;
  world.forcePolice(3, gw.x - 190, gw.y - 110);
  world.heli.active = true; world.heli.x = gw.x - 110; world.heli.y = gw.y - 130;
  world.heli.lightX = gw.x + 30; world.heli.lightY = gw.y + 20; world.heli.lightOnPlayer = true;
  const rng = new Rng(99);
  void rng;
  for (let i = 0; i < 50; i++) world.step(1 / 60, fakeInput(['w']), { x: gw.x + 300, y: gw.y });
  world.camera.x = gw.x + 60; world.camera.y = gw.y + 20;
  game.screen = 'play';
}
