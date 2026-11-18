// gadgets.js — in-round gadgets on number keys, each with a cooldown.
// CUT POWER (1): darkness + cameras off. JAM (2): delays police dispatch.
// DECOY (3): patrols divert to a fake call point. SPIKES (4): one pursuer disabled.
export function makeGadgets(plan) {
  const jammer = plan && plan.gear.includes('jammer');
  return {
    cutPower: { key: '1', name: 'CUT POWER', cd: 0, maxCd: 26, active: 0 },
    jam: { key: '2', name: 'JAM', cd: 0, maxCd: jammer ? 11 : 22, active: 0 },
    decoy: { key: '3', name: 'DECOY', cd: 0, maxCd: 24, active: 0 },
    spikes: { key: '4', name: 'SPIKES', cd: 0, maxCd: 20, active: 0 },
  };
}

export function stepGadgets(world, dt) {
  const g = world.gadgets;
  if (!g) return;
  for (const k of Object.keys(g)) { if (g[k].cd > 0) g[k].cd -= dt; if (g[k].active > 0) g[k].active -= dt; }
  if (world.decoy && world.decoy.t > 0) world.decoy.t -= dt;
  world.powerCut = g.cutPower.active > 0;
}

export function useGadget(world, id) {
  const g = world.gadgets;
  if (!g || !g[id] || g[id].cd > 0) return false;
  const item = g[id];
  const p = world.player;
  const px = p.car ? p.car.x : p.x, py = p.car ? p.car.y : p.y;
  item.cd = item.maxCd;
  world.audio.gadget();
  if (id === 'cutPower') {
    item.active = 9;
    world.spawnFloat(px, py - 46, 'POWER CUT — CAMERAS DARK', '#4cc9f0', 20);
    if (world.mission) world.mission.camBlindT = Math.max(world.mission.camBlindT, 9);
  } else if (id === 'jam') {
    item.active = 6;
    world.dispatchT = Math.max(world.dispatchT, 7);
    world.spawnFloat(px, py - 46, 'DISPATCH JAMMED', '#ffd60a', 20);
  } else if (id === 'decoy') {
    item.active = 8;
    world.decoy = { x: px + world.rng.range(-520, 520), y: py + world.rng.range(-380, 380), t: 8 };
    world.spawnFloat(px, py - 46, 'DECOY CALL PLACED', '#06d6a0', 20);
  } else if (id === 'spikes') {
    let best = null, bd = Infinity;
    for (const car of world.cars) {
      if (!car.police || car.disabled || car.driver !== 'police') continue;
      const d = Math.hypot(car.x - px, car.y - py);
      if (d < bd) { bd = d; best = car; }
    }
    if (best && bd < 560) {
      best.spikeHit = 0.1; best.disabled = true;
      world.particles.sparks(best.x, best.y, 12);
      world.spawnFloat(best.x, best.y - 34, 'PURSUER SPIKED!', '#ef476f', 20);
    } else {
      world.spawnFloat(px, py - 46, 'NO PURSUER IN RANGE', '#adb5bd', 18);
      item.cd = 3;
    }
  }
  return true;
}
