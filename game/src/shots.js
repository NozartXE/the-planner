// shots.js — deterministic staging for screenshots: ?shot=title|chase|mission|roam builds a seeded scene and steps the real simulation.
import { makeCopCar } from './cars.js';
import { PLACES } from './config.js';
function putPlayerInCar(game, car, x, y, angle, speed) {
  car.x = x; car.y = y; car.angle = angle; car.speed = speed; car.occupiedByPlayer = true;
  if (typeof car.dir === 'number') car.dir = angle === 0 ? 0 : angle === Math.PI ? 2 : angle > 0 ? 1 : 3;
  game.player.inCar = true; game.player.car = car;
  game.player.x = x; game.player.y = y; game.player.angle = angle;
}
function addCop(game, x, y, angle) {
  const cop = makeCopCar(x, y, angle);
  cop.dir = angle === 0 ? 0 : angle === Math.PI ? 2 : angle > 0 ? 1 : 3;
  cop.cruise = cop.maxSpeed * 0.94; cop.speed = 150; cop.decidedFor = '';
  game.police.cops.push(cop);
  return cop;
}
function snapCamera(game) {
  game.camera.x = game.player.x; game.camera.y = game.player.y;
}
export function applyShot(game, name, step) {
  const run = (n) => { for (let i = 0; i < n; i++) step(1 / 60); };
  if (name === 'title') {
    game.screen = 'title';
    game.player.x = 1456; game.player.y = 1420; game.player.angle = -Math.PI / 2;
    snapCamera(game);
    run(40);
    game.screen = 'title';
    snapCamera(game);
    game.frozen = true;
    return true;
  }
  if (name === 'chase') {
    game.screen = 'play';
    game.missions.start(game.nowMs);
    const car = game.traffic[0];
    putPlayerInCar(game, car, 1120, 1947, 0, 235);
    // Traffic ahead on the same avenue, far enough to stay ahead of the chase.
    const ahead1 = game.traffic[1]; ahead1.x = 1620; ahead1.y = 1947; ahead1.dir = 0; ahead1.angle = 0; ahead1.speed = 95;
    const ahead2 = game.traffic[2]; ahead2.x = 1900; ahead2.y = 1905; ahead2.dir = 2; ahead2.angle = Math.PI; ahead2.speed = 80;
    game.police.setStars(4, game.nowMs);
    addCop(game, 940, 1947, 0);
    addCop(game, 790, 1947, 0);
    addCop(game, 660, 1905, 0);
    snapCamera(game);
    game.input.down.add('KeyW');
    run(58);
    game.input.down.delete('KeyW');
    game.police.setStars(4, game.nowMs);
    if (!game.missions.active) game.missions.start(game.nowMs);
    snapCamera(game);
    game.frozen = true;
    return true;
  }
  if (name === 'mission') {
    game.screen = 'play';
    const def = game.missions.start(game.nowMs);
    game.player.inCar = false; game.player.car = null;
    game.player.x = PLACES.port.x - 74; game.player.y = PLACES.port.y + 46; game.player.angle = 0.6;
    game.player.hp = 100;
    // A small crowd on the nearby block perimeter.
    for (let i = 0; i < 8 && i < game.peds.length; i++) {
      const ped = game.peds[i];
      ped.bx = 0; ped.by = 7; ped.side = i % 4; ped.t = 0.15 + i * 0.09; ped.dead = false;
    }
    game.police.setStars(2, game.nowMs);
    addCop(game, PLACES.port.x + 520, PLACES.port.y - 21, Math.PI);
    snapCamera(game);
    run(26);
    game.missions.briefUntil = game.nowMs + 6000;
    game.screen = 'play';
    snapCamera(game);
    game.frozen = true;
    return true;
  }
  if (name === 'roam') {
    game.screen = 'play';
    const car = game.traffic[0];
    putPlayerInCar(game, car, 330, 1477, 0, 130);
    const near1 = game.traffic[1]; near1.x = 860; near1.y = 1477; near1.dir = 0; near1.angle = 0; near1.speed = 85;
    const near2 = game.traffic[2]; near2.x = 537; near2.y = 1020; near2.dir = 1; near2.angle = Math.PI / 2; near2.speed = 85;
    const near3 = game.traffic[3]; near3.x = 180; near3.y = 1435; near3.dir = 2; near3.angle = Math.PI; near3.speed = 70;
    game.police.setStars(2, game.nowMs);
    addCop(game, 90, 1477, 0);
    snapCamera(game);
    game.input.down.add('KeyW');
    run(30);
    game.input.down.delete('KeyW');
    if (game.police.stars < 2) game.police.setStars(2, game.nowMs);
    snapCamera(game);
    game.frozen = true;
    return true;
  }
  return false;
}
