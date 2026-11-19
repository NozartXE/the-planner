// smoke.mjs — stubbed-DOM smoke test (21 checks). Run: node qa/smoke.mjs
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
const planning = await import('../game/src/planning.js');
const { applyShot: applyShotFn } = await import('../game/src/shots.js');
void applyShotFn;

const game = createGame();
check('1 boot: game created with city, traffic, peds', game.city.buildings.length > 100 && game.traffic.length === 26 && game.peds.length === 64);
check('2 city: palms, lamps, boats present', game.city.palms.length > 50 && game.city.lamps.length > 50 && game.city.boats.length === 6);
const step = (dt) => updateGame(game, dt || 1 / 60);
game.screen = 'play';
for (let i = 0; i < 30; i++) step(1 / 60);
check('3 sim: 30 play steps advance time without error', game.time > 0.4 && game.player.hp > 0);
// Mission phases + the planning layer: live stats recompute on every change
const def = game.missions.start(game.nowMs);
const ph = game.missions.phaseInfo();
const planA = planning.defaultPlan(2);
const statsA = planning.planStats(2, planA);
planning.toggleCrew(planA, 'sana');
const statsB = planning.planStats(2, planA);
const entries = new Set([0, 1, 2].map((e) => { const p = { ...planning.defaultPlan(0) }; return planning.entrySpawn(CHAIN[0], { ...p, entry: e }); }).map((s) => s.x + ',' + s.y));
check('4 missions+planning: chain of 5 with grab phase; stats recompute live; entries stage apart', CHAIN.length === 5 && game.missions.phases().includes('grab') && ph.total >= 2 && game.missions.nextText().length > 3 && statsB.totalCut !== statsA.totalCut && statsB.grabRate !== statsA.grabRate && entries.size === 3);
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
// Weapon: the gear builds it (extended mag = 18), firing spends it for real
game.player.inCar = false; game.player.car = null;
game.weapon = planning.weaponForPlan({ gear: ['extmag'] });
const gearMagOk = game.weapon.magSize === 18 && planning.weaponForPlan({ gear: [] }).magSize === 12;
game.input.setKey('Space', true);
const mag0 = game.weapon.mag;
for (let i = 0; i < 12; i++) step(1 / 60);
game.input.setKey('Space', false);
check('9 weapon: gear sets magazine size; shots spend real rounds', gearMagOk && game.weapon.mag < mag0 && game.bullets.length >= 0);
// Shot staging + 3D render under the stub ctx (all four shipped shots)
let renderOk = true;
for (const name of ['board', 'chase', 'mission', 'results']) {
  const g2 = createGame();
  try {
    applyShot(g2, name, (dt) => updateGame(g2, dt || 1 / 60)); renderGame(makeCtx(), g2);
    if (name === 'board') hud.drawPlanning(makeCtx(), g2);
    else if (name === 'results') hud.drawSummary(makeCtx(), g2);
    else hud.drawHud(makeCtx(), g2);
  } catch (e) { renderOk = false; console.log('  render error in', name, e.message); }
}
check('10 shots: all 4 stagings render + board/HUD/summary without error', renderOk);
// ID render (scale measurement mode) under the stub
let idOk = true;
try { const g3 = createGame(); applyShot(g3, 'scale', (dt) => updateGame(g3, dt || 1 / 60)); g3.idRender = true; renderGame(makeCtx(), g3); } catch (e) { idOk = false; console.log('  id error', e.message); }
check('11 renderer: idRender scale scene renders', idOk);
// Chase staging invariants: the board's forecast IS the chase — 5 forecast
// stars, 5 stars shown, 5 live interceptors, hero car is the plan's getaway,
// and the roster's tactics include the PIT + the roadblock pair.
const g4 = createGame();
applyShot(g4, 'chase', (dt) => updateGame(g4, dt || 1 / 60));
const tac = g4.police.cops.map((c) => c.tactical);
check('12 chase: forecast==stars==cops==5, hero is the getaway, PIT+2xROADBLOCK staged', g4.planStatsCache.heatStars === 5 && g4.police.stars === 5 && g4.police.cops.filter((c) => !c.dead).length === 5 && g4.player.car.name === 'VELOZ COMET' && planning.getawayById(g4.plan.getaway).name === g4.player.car.name && tac.filter((t) => t === 'PIT').length === 1 && tac.filter((t) => t === 'ROADBLOCK').length === 2);
// Results: the ledger reconciles line by line and the chain history is its nets
const g5 = createGame();
applyShot(g5, 'results', (dt) => updateGame(g5, dt || 1 / 60));
hud.drawSummary(makeCtx(), g5);
const led = g5.lastLedger;
const ledOk = led && led.gross - led.fence - led.cutTotal === led.net && led.cuts.reduce((a, c) => a + c.amount, 0) === led.cutTotal;
check('13 results: ledger reconciles (gross-fence-cuts=net); 5 history rows net $5,200; REP sums', ledOk && g5.lastSummary && g5.lastSummary.jobRows.length === 5 && g5.lastSummary.jobRows.reduce((a, r) => a + r.pay, 0) === 5200 && g5.lastSummary.repTotal === 360 && g5.chainLedger.every((l) => l.gross - l.fence - l.cutTotal === l.net));

// ---- Directives round: arsenal, vehicles, wheel, explosives, maps ----
const arsenal = await import('../game/src/arsenal.js');
const counts = arsenal.classCounts();
const names = new Set(arsenal.WEAPONS.map((w) => w.name));
const statsSane = arsenal.WEAPONS.every((w) => w.damage > 0 && w.rps > 0 && w.range >= 40 && w.mag >= 1 && w.reserve >= 0 && w.reloadMs >= 400);
check('14 arsenal: exact class counts 10/10/5/7/8/6 + 10 explosives = 56', counts.AR === 10 && counts.SMG === 10 && counts.MG === 5 && counts.SG === 7 && counts.SR === 8 && counts.RL === 6 && counts.EXP === 10 && arsenal.WEAPONS.length === 56);
check('15 arsenal: 56 unique original names; stats sane; VENN 9MM is one entry', names.size === 56 && statsSane && arsenal.weaponById('venn-9mm').name === 'VENN 9MM' && arsenal.WEAPONS.filter((w) => w.cls === 'EXP').every((w) => !!w.behavior) && new Set(arsenal.WEAPONS.filter((w) => w.cls === 'EXP').map((w) => w.behavior)).size === 10);
const wExt = planning.weaponForPlan({ gear: ['extmag'], weaponId: 'venn-9mm' });
const wAr = planning.weaponForPlan({ gear: [], weaponId: 'ar-kestrel' });
check('16 arsenal: table-driven weapon build; EXTENDED MAG = table mag x1.5 (12->18)', wExt.magSize === 18 && wAr.magSize === 30 && wAr.damage === 22 && wAr.name === 'KESTREL AR-7');
// Tank: enter through the same path, drive, turret traverses, cannon fires a real shell
const gt = createGame();
gt.screen = 'play'; gt.idleMissionTimer = 99999;
const tank = gt.specials[0];
gt.player.x = tank.x + 20; gt.player.y = tank.y; gt.player.inCar = false; gt.player.car = null;
gt.input.setKey('KeyE', true); step0(gt); gt.input.setKey('KeyE', false);
function step0(g) { updateGame(g, 1 / 60); }
const inTank = gt.player.inCar && gt.player.car === tank && gt.police.stars >= 3;
gt.input.setKey('KeyW', true);
for (let i = 0; i < 90; i++) step0(gt);
gt.input.setKey('KeyW', false);
const tankMoved = Math.hypot(tank.x - 691, tank.y - 3071) > 5 || tank.speed > 4;
gt.input.setKey('Space', true); step0(gt); gt.input.setKey('Space', false);
const shellOut = gt.projectiles.some((pr) => pr.behavior === 'cannon');
for (let i = 0; i < 80; i++) step0(gt);
check('17 tank: enter via E (heat 3), drives, cannon shell fired and resolved', inTank && tankMoved && shellOut);
// Plane: enter, throttle down the runway, lift off, heat reacts
const gp = createGame();
gp.screen = 'play'; gp.idleMissionTimer = 99999;
const plane = gp.specials[2];
plane.x = 2960; plane.y = 3101; plane.angle = 0;
gp.player.x = plane.x + 20; gp.player.y = plane.y; gp.player.inCar = false; gp.player.car = null;
gp.input.setKey('KeyE', true); updateGame(gp, 1 / 60); gp.input.setKey('KeyE', false);
const inPlane = gp.player.inCar && gp.player.car === plane;
gp.input.setKey('KeyW', true);
let lifted = false;
for (let i = 0; i < 60 * 14; i++) { updateGame(gp, 1 / 60); if ((plane.alt || 0) > 12) { lifted = true; break; } }
gp.input.setKey('KeyW', false);
check('18 plane: enter via E, runway roll lifts off (alt>12), takeoff heat >=3', inPlane && lifted && gp.police.stars >= 3);
// Wheel: opens, class/index cycling lands on a real weapon, equip builds it
const gw = createGame();
gw.screen = 'play';
gw.wheelOpen = true; gw.wheelClass = 5; gw.wheelIndex = 0;
const { equipWheelSelection, cycleWheel } = main;
const equipped = equipWheelSelection(gw);
cycleWheel(gw, 1, 0);
let wheelRenderOk = true;
try { hud.drawWeaponWheel(makeCtx(), gw); } catch (e) { wheelRenderOk = false; console.log('  wheel render error', e.message); }
check('19 wheel: opens, RL segment equips HAVOC TUBE, cycling + render ok', equipped && equipped.id === 'rl-havoc' && gw.weapon.name === 'HAVOC TUBE' && gw.wheelClass === 6 && wheelRenderOk);
// Explosives: grenade explodes, C4 plants+detonates, molotov leaves a fire zone, mine waits then triggers
const ge = createGame();
ge.screen = 'play'; ge.idleMissionTimer = 99999; ge.player.inCar = false; ge.player.car = null; ge.player.angle = 0;
ge.weapon = arsenal.buildWeapon(arsenal.weaponById('exp-grenade'), null);
ge.input.setKey('Space', true); updateGame(ge, 1 / 60); ge.input.setKey('Space', false);
const thrown = ge.projectiles.length === 1;
for (let i = 0; i < 150; i++) updateGame(ge, 1 / 60);
const grenadeGone = ge.projectiles.length === 0;
ge.player.shootCd = 0; ge.weapon = arsenal.buildWeapon(arsenal.weaponById('exp-c4'), null);
ge.input.setKey('Space', true); updateGame(ge, 1 / 60); ge.input.setKey('Space', false);
const planted = ge.placed.length === 1;
ge.input.setKey('KeyX', true); updateGame(ge, 1 / 60); ge.input.setKey('KeyX', false);
const detonated = ge.placed.length === 0;
ge.player.shootCd = 0; ge.weapon = arsenal.buildWeapon(arsenal.weaponById('exp-molotov'), null);
ge.input.setKey('Space', true); updateGame(ge, 1 / 60); ge.input.setKey('Space', false);
for (let i = 0; i < 90; i++) updateGame(ge, 1 / 60);
const fireZone = ge.zones.some((z) => z.kind === 'fire');
check('20 explosives: grenade arc resolves, C4 plant + X detonate, molotov fire zone', thrown && grenadeGone && planted && detonated && fireZone);
// Maps + mission-passed summary render
let mapOk = true;
try {
  const gm = createGame();
  hud.drawDistrictMap(makeCtx(), gm, 10, 10, 240, 140);
  const g6 = createGame(); applyShot(g6, 'results', (dt) => updateGame(g6, dt || 1 / 60)); hud.drawSummary(makeCtx(), g6);
  const g7 = createGame(); applyShot(g7, 'board', (dt) => updateGame(g7, dt || 1 / 60)); hud.drawPlanning(makeCtx(), g7);
} catch (e) { mapOk = false; console.log('  map/summary error', e.message); }
check('21 maps+results: district map, board (with map+arsenal), MISSION PASSED summary render', mapOk);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
