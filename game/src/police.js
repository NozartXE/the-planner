// police.js — the wanted system: stars, crime reports, off-screen cop spawns, pursuit steering and heat decay.
import { COPS_PER_STAR, MAX_COPS, WANTED_DECAY_MS } from './config.js';
import { makeCopCar } from './cars.js';
import { DIRS, spawnOnRoad, stepRoadCar } from './traffic.js';
import { dist, clamp } from './rng.js';
export class Police {
  constructor() {
    this.stars = 0;
    this.cops = [];
    this.lastCrimeAt = -99999;
    this.lastSeenAt = -99999;
    this.decaying = false;
  }
  crime(level, now, game) {
    const before = this.stars;
    this.stars = clamp(Math.max(this.stars, level) + (level >= 3 && before >= level ? 0 : 0), 0, 5);
    if (level > this.stars) this.stars = level;
    // Repeated serious crimes can push one star higher, capped at five.
    this.lastCrimeAt = now;
    if (game && game.sfx) game.sfx.sting();
  }
  addStars(n, now) { this.stars = clamp(this.stars + n, 0, 5); this.lastCrimeAt = now; }
  setStars(n, now) { this.stars = clamp(n, 0, 5); this.lastCrimeAt = now; }
  clear() { this.stars = 0; this.decaying = false; }
  desiredCops() { return Math.min(MAX_COPS, this.stars * COPS_PER_STAR); }
  update(rng, dt, now, player, trafficCars, fx) {
    // Spawn cops off-screen until the wanted level is matched.
    while (this.cops.filter((c) => !c.dead).length < this.desiredCops()) {
      const s = spawnOnRoad(rng, player.x, player.y, 680, 1080);
      const cop = makeCopCar(s.x, s.y, DIRS[s.dir].angle);
      cop.dir = s.dir; cop.cruise = cop.maxSpeed * 0.94; cop.speed = cop.cruise * 0.7; cop.decidedFor = '';
      this.cops.push(cop);
    }
    // Decay: no crime recently and no cop close means the heat cools, one star at a time.
    let nearest = Infinity;
    for (const c of this.cops) nearest = Math.min(nearest, dist(c.x, c.y, player.x, player.y));
    if (nearest < 400) this.lastSeenAt = now;
    this.decaying = this.stars > 0 && now - this.lastCrimeAt > WANTED_DECAY_MS && now - this.lastSeenAt > 2600;
    if (this.decaying && now - (this._lastDecayAt || 0) > 2800) {
      this._lastDecayAt = now;
      this.stars = Math.max(0, this.stars - 1);
      if (this.stars === 0) this.lastCrimeAt = -99999;
    }
    if (this.stars === 0) {
      // Cops give up and merge back into ordinary traffic flow.
      for (const c of this.cops) stepRoadCar(rng, c, dt, trafficCars, null, (r, car) => car.dir);
      this.cops = this.cops.filter((c) => dist(c.x, c.y, player.x, player.y) < 1300);
      return;
    }
    const all = trafficCars.concat(this.cops);
    for (const cop of this.cops) {
      if (cop.dead) continue;
      const dPlayer = dist(cop.x, cop.y, player.x, player.y);
      if (dPlayer < 250) {
        // Direct pursuit: steer at the player and try to make contact.
        const want = Math.atan2(player.y - cop.y, player.x - cop.x);
        let diff = want - cop.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        cop.angle += clamp(diff, -2.6 * dt, 2.6 * dt);
        const target = cop.maxSpeed * (dPlayer > 90 ? 0.96 : 0.6);
        cop.speed = cop.speed < target ? Math.min(target, cop.speed + cop.accel * dt) : Math.max(target, cop.speed - 300 * dt);
        cop.x += Math.cos(cop.angle) * cop.speed * dt;
        cop.y += Math.sin(cop.angle) * cop.speed * dt;
        cop.dir = Math.abs(Math.cos(cop.angle)) > Math.abs(Math.sin(cop.angle)) ? (Math.cos(cop.angle) > 0 ? 0 : 2) : (Math.sin(cop.angle) > 0 ? 1 : 3);
      } else {
        cop.cruise = cop.maxSpeed * 0.95;
        stepRoadCar(rng, cop, dt, all, null, (r, car, cx, cy) => {
          // At each junction pick the heading that closes on the player; never reverse.
          let best = car.dir, bestScore = Infinity;
          for (const cand of [car.dir, (car.dir + 1) % 4, (car.dir + 3) % 4]) {
            const dd = DIRS[cand];
            const px = cx + dd.x * 180, py = cy + dd.y * 180;
            const score = dist(px, py, player.x, player.y);
            if (score < bestScore) { bestScore = score; best = cand; }
          }
          return best;
        });
      }
      // Contact: ram damage.
      const targetCar = player.inCar ? player.car : null;
      const hitDist = targetCar ? 30 : 24;
      if (dPlayer < hitDist && now - (cop._lastRamAt || 0) > 650) {
        cop._lastRamAt = now;
        if (fx) { fx.sparks(player.x, player.y); fx.addShake(6); }
        if (targetCar) targetCar.hp -= 9;
        else player.hp -= 11;
      }
    }
    this.cops = this.cops.filter((c) => !c.dead || dist(c.x, c.y, player.x, player.y) < 900);
  }
}
