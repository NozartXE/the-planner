// smoke.mjs — stubbed-DOM smoke test (13 checks). Run: node qa/smoke.mjs
// Stubs document/canvas/localStorage just enough for the game's ES modules to
// boot and render headlessly, then exercises the real systems.
const grad = { addColorStop() {} };
function makeCtx() {
  return new Proxy({
    canvas: null, fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
    lineWidth: 1, globalAlpha: 1, shadowBlur: 0, shadowColor: '',
    measureText: (t) => ({ width: String(t).length * 7 }),
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  }, {
    get(t, k) { if (k in t) return t[k]; return () => {}; },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function makeCanvas() {
  const c = { width: 376, height: 376, getContext: () => makeCtx(), style: {} };
  return c;
}
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.document = {
  getElementById: (id) => (id === 'game' ? makeCanvas() : { textContent: '', className: '' }),
  createElement: () => makeCanvas(),
};
globalThis.location = { search: '' };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
delete globalThis.requestAnimationFrame;

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } }

const main = await import('../game/src/main.js');
const { createGame, updateGame } = main;
const hud = await import('../game/src/hud.js');
const { applyShot } = await import('../game/src/shots.js');
const { renderGame } = await import('../game/src/render.js');
const { STATIONS } = await import('../game/src/radio.js');
const { CHAIN } = await import('../game/src/missions.js');

const game = createGame();
check('1 boot: game created with city, traffic, peds', game.city.buildings.length > 100 && game.traffic.length === 26 && game.peds.length === 64);
check('2 city: palms, lamps, boats present', game.city.palms.length > 50 && game.city.lamps.length > 50 && game.city.boats.length === 6);
const step = (dt) => updateGame(game, dt || 1 / 60);
game.screen = 'play';
for (let i = 0; i < 30; i++) step(1 / 60);
check('3 sim: 30 play steps advance time without error', game.time > 0.4 && game.player.hp > 0);
// Mission phases
const def = game.missions.start(game.nowMs);
const ph = game.missions.phaseInfo();
check('4 missions: chain of 5, phase info sane', CHAIN.length === 5 && ph.total >= 2 && ph.index === 1 && game.missions.nextText().length > 3);
// Police tactics + wanted state
game.police.setStars(5, game.nowMs);
game.police.cops = [];
const { makeCopCar } = await import('../game/src/cars.js');
for (let i = 0; i < 5; i++) { const c = makeCopCar(game.player.x + 60 + i * 90, game.player.y + (i % 2 ? 40 : -40), 0); c.dir = 0; c.cruise = 200; game.police.cops.push(c); }
game.police.assignTactics(game.player);
const states = new Set(game.police.cops.map((c) => c.tactical));
check('5 police: tactics assigned from real positions', [...states].every((s) => ['PIT', 'PURSUIT', 'ROADBLOCK'].includes(s)) && game.police.cops[0].tactical === 'PIT' && !!game.police.cops[0].callsign);
check('6 police: wantedState IN SIGHT when a unit is close', game.police.wantedState(game.player) === 'IN SIGHT');
game.police.cops.forEach((c) => { c.x += 3000; });
check('7 police: wantedState SEARCHING when unseen', game.police.wantedState(game.player) === 'SEARCHING');
// Radio
const before = game.radio.label();
game.radio.cycle();
check('8 radio: 4 real stations, cycle changes the readout', STATIONS.length === 4 && STATIONS.every((s) => s.tracks.length >= 3) && game.radio.label() !== before);
// Weapon: firing spends the magazine
game.player.inCar = false; game.player.car = null;
game.weapon.mag = 12; game.weapon.reserve = 48;
game.input.setKey('Space', true);
const mag0 = game.weapon.mag;
for (let i = 0; i < 12; i++) step(1 / 60);
game.input.setKey('Space', false);
check('9 weapon: shots fired spend real magazine rounds', game.weapon.mag < mag0 && game.bullets.length >= 0);
// Shot staging + 3D render under the stub ctx (all four shipped shots)
let renderOk = true;
for (const name of ['title', 'chase', 'mission', 'results']) {
  const g2 = createGame();
  try { applyShot(g2, name, (dt) => updateGame(g2, dt || 1 / 60)); renderGame(makeCtx(), g2); hud.drawHud(makeCtx(), g2); }
  catch (e) { renderOk = false; console.log('  render error in', name, e.message); }
}
check('10 shots: all 4 stagings render + HUD without error', renderOk);
// ID render (scale measurement mode) under the stub
let idOk = true;
try { const g3 = createGame(); applyShot(g3, 'scale', (dt) => updateGame(g3, dt || 1 / 60)); g3.idRender = true; renderGame(makeCtx(), g3); } catch (e) { idOk = false; console.log('  id error', e.message); }
check('11 renderer: idRender scale scene renders', idOk);
// Chase staging invariants: exactly 5 cops for 5 stars, hero named car
const g4 = createGame();
applyShot(g4, 'chase', (dt) => updateGame(g4, dt || 1 / 60));
check('12 chase staging: 5 live cops == 5 stars, hero car has a name', g4.police.cops.filter((c) => !c.dead).length === 5 && g4.police.stars === 5 && typeof g4.player.car.name === 'string' && g4.player.car.name.length > 3);
// Summary breakdown rows come from real job earnings
const g5 = createGame();
applyShot(g5, 'results', (dt) => updateGame(g5, dt || 1 / 60));
hud.drawSummary(makeCtx(), g5);
check('13 results: summary carries 5 job rows totalling the chain pay', g5.lastSummary && g5.lastSummary.jobRows.length === 5 && g5.lastSummary.jobRows.reduce((a, r) => a + r.pay, 0) === 5200);
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
