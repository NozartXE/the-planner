// shots.js — deterministic screenshot staging: ?shot=cover|plan|heist|results.
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

  if (name === 'results') {
    plan.timeOfDay = 'dusk';
    world.beginHeist(heist, plan);
    const m = world.mission;
    m.lootGrabbed = m.lootTotal; m.time = 214; m.phase = 'done';
    world.heat = 40;
    world.finishHeist(true);
    game.screen = 'results';
    return;
  }

  if (name === 'heist') {
    plan.timeOfDay = 'dusk';
    world.beginHeist(heist, plan);
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
