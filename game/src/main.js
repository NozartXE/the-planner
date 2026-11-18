// main.js — boot, screen state machine, fixed-timestep loop, click routing.
// Screens: title → plan (planning board) → play (execution / free roam) →
// results / gameover, with pause and help overlays on top of play.
import { VIEW_W, VIEW_H, STEP, MAX_STEPS_PER_FRAME } from './config.js';
import { Input } from './input.js';
import { AudioSynth } from './audio.js';
import { createWorld } from './world.js';
import { loadSave, storeSave, recordRun } from './save.js';
import { PlanningBoard } from './planning.js';
import { drawWorld, computeCamera } from './render.js';
import { drawView3D } from './view3d.js';
import { drawHud } from './hud.js';
import { drawTitle, drawPlanning, drawResults, drawPause, drawHelp, drawGameOver } from './render-ui.js';
import { stageShot } from './shots.js';
import { HEISTS } from './heists.js';
import { CAR_CLASSES } from './vehicles.js';

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const ctx = canvas.getContext('2d');
canvas.width = VIEW_W; canvas.height = VIEW_H;

// Visible error banner: screenshot verification asserts this never appears.
window.addEventListener('error', (e) => {
  const el = document.getElementById('status');
  if (el) { el.className = 'error-banner'; el.textContent = 'ERROR: ' + (e.message || 'unknown'); }
});

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seed = Number.parseInt(params.get('seed') || '1234', 10) || 1234;

const audio = new AudioSynth();
const save = loadSave();
audio.setMuted(!!save.settings.mute);
const world = createWorld({ seed, audio, save });
const input = new Input(canvas);
const game = { world, save, board: new PlanningBoard(save), screen: 'title', overlay: null, rects: [] };
world.beginRoam('day');

function setStatus(msg) { if (statusEl && statusEl.className !== 'error-banner') statusEl.textContent = msg; }

function startHeist() {
  const board = game.board;
  world.beginHeist(board.heist, { ...board.plan, crew: [...board.plan.crew], gear: [...board.plan.gear] });
  game.screen = 'play';
  setStatus('Executing: ' + board.heist.name);
  audio.uiClick();
}

function finishToResultsIfReady() {
  if (world.results && game.screen === 'play') {
    const r = world.results;
    recordRun(save, { name: r.heist.name, grade: r.settlement.grade, net: r.settlement.net, when: 'run #' + (save.history.length + 1) });
    storeSave(save);
    game.screen = 'results';
    setStatus('Results: grade ' + r.settlement.grade);
  } else if (world.over && game.screen === 'play' && !world.results) {
    storeSave(save);
    game.screen = 'gameover';
  } else if (world.over && world.results && game.screen === 'play') {
    game.screen = 'gameover';
  }
}

function handleClick(x, y) {
  for (const r of game.rects) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { activate(r.id); return; }
  }
}

function activate(id) {
  audio.ensure(); audio.uiClick();
  const board = game.board;
  if (game.screen === 'title') {
    if (id === 'new') {
      const fresh = loadSave(); // keep settings, reset progress via defaults
      save.cash = 1500; save.rep = 0; save.unlocked = 1; save.garage = ['compact']; save.bestGrades = {}; save.history = [];
      void fresh;
      game.board = new PlanningBoard(save);
      game.screen = 'plan';
    } else if (id === 'continue') game.screen = 'plan';
    else if (id === 'roam') { world.beginRoam('day'); game.screen = 'play'; }
    return;
  }
  if (game.screen === 'plan') {
    if (id.startsWith('heist:')) board.selectHeist(Number(id.slice(6)));
    else if (id.startsWith('entry:')) board.plan.entry = Number(id.slice(6));
    else if (id.startsWith('crew:')) board.toggleCrew(id.slice(5));
    else if (id.startsWith('gear:')) board.toggleGear(id.slice(5));
    else if (id.startsWith('getaway:')) {
      const g = id.slice(8);
      if (save.garage.includes(g)) board.plan.getaway = g;
      else if (save.cash >= CAR_CLASSES[g].price) {
        save.cash -= CAR_CLASSES[g].price; save.garage.push(g); board.plan.getaway = g;
        board.message = 'Bought the ' + CAR_CLASSES[g].name + ' for the garage.';
        storeSave(save);
      } else board.message = 'Not enough cash to buy the ' + CAR_CLASSES[g].name + ' ($' + CAR_CLASSES[g].price + ').';
    }
    else if (id.startsWith('time:')) board.plan.timeOfDay = id.slice(5);
    else if (id === 'execute') startHeist();
    else if (id === 'back') game.screen = 'title';
    return;
  }
  if (game.screen === 'results' || game.screen === 'gameover') {
    if (id === 'board') { game.board = new PlanningBoard(save); game.screen = 'plan'; world.over = null; world.results = null; }
    else if (id === 'roam') { world.over = null; world.results = null; world.beginRoam('day'); game.screen = 'play'; }
    return;
  }
  if (game.overlay === 'pause') {
    if (id === 'resume') game.overlay = null;
    else if (id === 'mute') { save.settings.mute = !save.settings.mute; audio.setMuted(save.settings.mute); storeSave(save); }
    else if (id === 'shake') { save.settings.shake = !save.settings.shake; storeSave(save); }
    else if (id === 'board') { game.overlay = null; world.over = null; world.results = null; game.board = new PlanningBoard(save); game.screen = 'plan'; }
    else if (id === 'title') { game.overlay = null; game.screen = 'title'; }
    return;
  }
  if (game.overlay === 'help') { if (id === 'close') game.overlay = null; return; }
}

function handleKeys() {
  if (input.wasPressed('h')) { game.overlay = game.overlay === 'help' ? null : 'help'; return; }
  if (game.screen === 'play' && !game.overlay && (input.wasPressed('p') || input.wasPressed('escape'))) { game.overlay = 'pause'; return; }
  if (game.overlay === 'pause' && (input.wasPressed('p') || input.wasPressed('escape'))) { game.overlay = null; return; }
  if (game.overlay === 'help' && input.wasPressed('escape')) { game.overlay = null; return; }
  if (game.screen === 'plan') {
    for (const k of [...input.pressed]) game.board.handleKey(k);
    if (input.wasPressed('enter')) startHeist();
    if (input.wasPressed('escape')) game.screen = 'title';
    return;
  }
  if (game.screen === 'play' && !game.overlay && input.wasPressed('b')) {
    game.board = new PlanningBoard(save); game.screen = 'plan'; return;
  }
  if (game.screen === 'title' && input.wasPressed('enter')) { game.screen = 'plan'; return; }
  if ((game.screen === 'results' || game.screen === 'gameover') && input.wasPressed('b')) {
    world.over = null; world.results = null; game.board = new PlanningBoard(save); game.screen = 'plan'; return;
  }
  if (game.screen === 'results' && input.wasPressed('f')) {
    world.over = null; world.results = null; world.beginRoam('day'); game.screen = 'play'; return;
  }
}

function draw() {
  game.rects = [];
  if (game.screen === 'title') { game.rects = drawTitle(ctx, VIEW_W, VIEW_H, save, world.time); return; }
  if (game.screen === 'plan') { game.rects = drawPlanning(ctx, VIEW_W, VIEW_H, game.board, world); return; }
  // Playfield. While the player is driving, the true-3D view renders the
  // world from behind the car; on foot during an active mission it renders
  // from behind the player (aim camera); on-foot free roam keeps the
  // top-down renderer exactly as before. The HUD draws over every view.
  if (game.screen === 'play' && world.player && world.player.car) {
    drawView3D(ctx, world, 'drive');
  } else if (game.screen === 'play' && world.player && world.mission) {
    drawView3D(ctx, world, 'foot');
  } else {
    const cam = computeCamera(world);
    if (!save.settings.shake) { cam.x = Math.max(0, Math.min(3200 - VIEW_W, world.camera.x - VIEW_W / 2)); cam.y = Math.max(0, Math.min(2400 - VIEW_H, world.camera.y - VIEW_H / 2)); }
    drawWorld(ctx, world, cam);
  }
  drawHud(ctx, world, VIEW_W, VIEW_H);
  if (game.screen === 'results') { game.rects = drawResults(ctx, VIEW_W, VIEW_H, world); return; }
  if (game.screen === 'gameover') { game.rects = drawGameOver(ctx, VIEW_W, VIEW_H, world); return; }
  if (game.overlay === 'pause') game.rects = drawPause(ctx, VIEW_W, VIEW_H, save);
  else if (game.overlay === 'help') game.rects = drawHelp(ctx, VIEW_W, VIEW_H);
}

function mouseWorld() {
  const cam = computeCamera(world);
  return { x: cam.x + input.mouseX, y: cam.y + input.mouseY };
}

if (shotName) {
  stageShot(shotName, game);
  draw(); draw();
  window.__shotReady = true;
  setStatus('shot:' + shotName);
} else {
  let acc = 0, last = null;
  function frame(now) {
    requestAnimationFrame(frame);
    if (last === null) last = now;
    acc += Math.min(0.25, (now - last) / 1000); last = now;
    if (input.clicked) handleClick(input.clickX, input.clickY);
    handleKeys();
    let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
      if (game.screen === 'play' && !game.overlay) world.step(STEP, input, mouseWorld());
      acc -= STEP; steps++;
      input.endStep();
    }
    if (steps === 0) input.endStep();
    finishToResultsIfReady();
    draw();
  }
  requestAnimationFrame(frame);
  setStatus('THE PLANNER — title screen');
}
void HEISTS;
