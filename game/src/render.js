// render.js — world rendering: city, roads with named streets, buildings with
// signage and shadows, props, river + docks, cars, pedestrians, crew, player,
// police, helicopter searchlight, mission markers, particles, day/night tint.
import { WORLD_W, WORLD_H, ROAD_W, RIVER_Y, DAY_PHASES, VIEW_W, VIEW_H } from './config.js';
import { AVENUES, STREETS, streetNameAt } from './city.js';
import { carDamageLevel } from './vehicles.js';

export function computeCamera(world) {
  const shakeX = world.shakeAmt ? Math.sin(world.time * 61) * world.shakeAmt * 0.6 : 0;
  const shakeY = world.shakeAmt ? Math.cos(world.time * 53) * world.shakeAmt * 0.6 : 0;
  return {
    x: Math.max(0, Math.min(WORLD_W - VIEW_W, world.camera.x - VIEW_W / 2 + shakeX)),
    y: Math.max(0, Math.min(WORLD_H - VIEW_H, world.camera.y - VIEW_H / 2 + shakeY)),
  };
}

function drawCar(ctx, car, time) {
  ctx.save();
  ctx.translate(car.x, car.y);
  // Skid marks first (in car space they trail behind; drawn in world by caller).
  ctx.rotate(car.angle);
  const L = 46, Wd = 24;
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-L / 2 + 3, -Wd / 2 + 5, L, Wd);
  // Body.
  ctx.fillStyle = car.disabled ? '#555b66' : car.color;
  ctx.beginPath(); ctx.roundRect(-L / 2, -Wd / 2, L, Wd, 6); ctx.fill();
  // Police livery.
  if (car.police) {
    ctx.fillStyle = '#eef1f5'; ctx.fillRect(-L / 2 + 6, -Wd / 2, L - 12, Wd);
    ctx.fillStyle = '#2f6fed'; ctx.fillRect(-4, -Wd / 2, 10, Wd);
    // Light bar flashing.
    const on = Math.floor(time * 6) % 2 === 0;
    ctx.fillStyle = on ? '#ef476f' : '#4cc9f0'; ctx.fillRect(-6, -7, 12, 5);
    ctx.fillStyle = on ? '#4cc9f0' : '#ef476f'; ctx.fillRect(-6, 2, 12, 5);
  }
  // Cabin + windows.
  ctx.fillStyle = 'rgba(16,24,40,0.9)';
  ctx.beginPath(); ctx.roundRect(-8, -Wd / 2 + 4, 20, Wd - 8, 4); ctx.fill();
  ctx.fillStyle = 'rgba(140,200,240,0.85)';
  ctx.fillRect(8, -Wd / 2 + 5, 4, Wd - 10);
  // Wheels.
  ctx.fillStyle = '#14161c';
  for (const [wx, wy] of [[-15, -Wd / 2 - 2], [15, -Wd / 2 - 2], [-15, Wd / 2 - 3], [15, Wd / 2 - 3]]) ctx.fillRect(wx - 5, wy, 10, 5);
  // Damage dents.
  const dmg = carDamageLevel(car);
  if (dmg >= 1) { ctx.fillStyle = 'rgba(20,20,26,0.55)'; ctx.fillRect(-L / 2 + 2, -6, 9, 12); }
  if (dmg >= 2) { ctx.fillStyle = 'rgba(20,20,26,0.6)'; ctx.fillRect(L / 2 - 11, -8, 9, 16); }
  if (car.getaway) { ctx.strokeStyle = '#06d6a0'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.roundRect(-L / 2 - 3, -Wd / 2 - 3, L + 6, Wd + 6, 8); ctx.stroke(); }
  if (car.chopMarked) { ctx.strokeStyle = '#4cc9f0'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.roundRect(-L / 2 - 3, -Wd / 2 - 3, L + 6, Wd + 6, 8); ctx.stroke(); }
  ctx.restore();
  // Smoke handled by particle system via world loop; draw a wisp if heavily damaged.
  if (car.smokeT > 0.4 && !car.disabled) {
    ctx.fillStyle = 'rgba(60,60,70,0.35)';
    ctx.beginPath(); ctx.arc(car.x + 14, car.y - 6, 8 + Math.sin(time * 9) * 2, 0, Math.PI * 2); ctx.fill();
  }
}

function drawPerson(ctx, x, y, angle, shirt, opts = {}) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(2, 4, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
  const bob = Math.sin((opts.phase || 0)) * 2;
  ctx.fillStyle = shirt;
  ctx.beginPath(); ctx.arc(0, bob * 0.3, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2c79b';
  ctx.beginPath(); ctx.arc(0, bob * 0.3, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(angle);
  ctx.fillStyle = shirt;
  ctx.fillRect(6, -3, 7, 6); // facing nub / arm direction
  ctx.restore();
  if (opts.bag) {
    ctx.save(); ctx.translate(x + 10, y + 8);
    ctx.fillStyle = '#06d6a0'; ctx.fillRect(-8, -6, 16, 12);
    ctx.fillStyle = '#ffd60a'; ctx.font = '900 10px system-ui'; ctx.textAlign = 'center'; ctx.fillText('$', 0, 4);
    ctx.restore();
  }
}

export function drawWorld(ctx, world, cam) {
  const phase = DAY_PHASES[(world.plan && world.plan.timeOfDay) || 'day'] || DAY_PHASES.day;
  const night = phase.dark > 0.4, dark = phase.dark;
  ctx.save();
  ctx.translate(-cam.x, -cam.y);
  const vx = cam.x - 40, vy = cam.y - 40, vw = VIEW_W + 80, vh = VIEW_H + 80;
  // Ground: blocks grass, then roads.
  ctx.fillStyle = '#2f9e4f'; ctx.fillRect(vx, vy, vw, vh);
  ctx.fillStyle = '#e8cf8f'; ctx.fillRect(vx, RIVER_Y, vw, 60); // sand bank
  ctx.fillStyle = '#1e7fb8'; ctx.fillRect(vx, RIVER_Y + 60, vw, WORLD_H - RIVER_Y);
  // Water sparkle lines.
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const wy = RIVER_Y + 90 + i * 26;
    ctx.beginPath(); ctx.moveTo(vx + (i * 173) % 300, wy); ctx.lineTo(vx + (i * 173) % 300 + 90, wy); ctx.stroke();
  }
  // Docks.
  for (const d of world.city.docks) { ctx.fillStyle = '#8a5a33'; ctx.fillRect(d.x, d.y, d.w, d.h); ctx.fillStyle = '#a9713f'; ctx.fillRect(d.x, d.y, d.w, 5); }
  // Roads.
  ctx.fillStyle = '#3a3f4a';
  for (const a of AVENUES) ctx.fillRect(a.x - ROAD_W / 2, 0, ROAD_W, RIVER_Y + 60);
  for (const s of STREETS) ctx.fillRect(0, s.y - ROAD_W / 2, WORLD_W, ROAD_W);
  // Sidewalk edges.
  ctx.fillStyle = '#9aa3ad';
  for (const a of AVENUES) { ctx.fillRect(a.x - ROAD_W / 2 - 8, 0, 8, RIVER_Y + 60); ctx.fillRect(a.x + ROAD_W / 2, 0, 8, RIVER_Y + 60); }
  for (const s of STREETS) { ctx.fillRect(0, s.y - ROAD_W / 2 - 8, WORLD_W, 8); ctx.fillRect(0, s.y + ROAD_W / 2, WORLD_W, 8); }
  // Centre dashes.
  ctx.fillStyle = '#f5d76e';
  for (const a of AVENUES) for (let y = 14; y < RIVER_Y; y += 46) ctx.fillRect(a.x - 2, y, 4, 24);
  for (const s of STREETS) for (let x = 14; x < WORLD_W; x += 46) ctx.fillRect(x, s.y - 2, 24, 4);
  // Street name labels at crossings.
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '800 15px system-ui, sans-serif'; ctx.textAlign = 'center';
  for (const a of AVENUES) for (const s of STREETS) {
    if (a.x > vx - 100 && a.x < vx + vw + 100 && s.y > vy - 60 && s.y < vy + vh + 60) ctx.fillText(a.name + ' × ' + s.name, a.x, s.y - ROAD_W / 2 - 14);
  }
  // Props.
  for (const pr of world.city.props) {
    if (pr.x < vx || pr.x > vx + vw || pr.y < vy || pr.y > vy + vh) continue;
    if (pr.kind === 'palm') {
      ctx.strokeStyle = '#7a4a21'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.x + 3, pr.y - 16); ctx.stroke();
      ctx.strokeStyle = '#2fbf71'; ctx.lineWidth = 4;
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.4; ctx.beginPath(); ctx.moveTo(pr.x + 3, pr.y - 16); ctx.lineTo(pr.x + 3 + Math.cos(a) * 15, pr.y - 16 + Math.sin(a) * 8 - 3); ctx.stroke(); }
    } else if (pr.kind === 'lamp') {
      ctx.fillStyle = '#22242c'; ctx.fillRect(pr.x - 2, pr.y - 18, 4, 18);
      ctx.fillStyle = night ? '#ffd60a' : '#ffe9a8'; ctx.beginPath(); ctx.arc(pr.x, pr.y - 20, 5, 0, Math.PI * 2); ctx.fill();
      if (night) { ctx.fillStyle = 'rgba(255,214,10,0.13)'; ctx.beginPath(); ctx.arc(pr.x, pr.y - 20, 26, 0, Math.PI * 2); ctx.fill(); }
    } else if (pr.kind === 'crate') { ctx.fillStyle = '#a9713f'; ctx.fillRect(pr.x - 9, pr.y - 9, 18, 18); ctx.strokeStyle = '#7a4a21'; ctx.strokeRect(pr.x - 9, pr.y - 9, 18, 18); }
    else if (pr.kind === 'barrier') { ctx.fillStyle = '#e9ecef'; ctx.fillRect(pr.x - 13, pr.y - 5, 26, 10); ctx.fillStyle = '#ef476f'; ctx.fillRect(pr.x - 13, pr.y - 5, 8, 10); ctx.fillRect(pr.x + 5, pr.y - 5, 8, 10); }
    else if (pr.kind === 'bench') { ctx.fillStyle = '#6c4a2f'; ctx.fillRect(pr.x - 12, pr.y - 4, 24, 8); }
    else { ctx.fillStyle = '#d90429'; ctx.fillRect(pr.x - 4, pr.y - 8, 8, 14); ctx.fillStyle = '#e9ecef'; ctx.fillRect(pr.x - 4, pr.y - 8, 8, 4); }
  }
  // Buildings: shadow, body, roof, sign.
  for (const b of world.city.buildings) {
    if (b.x + b.w < vx || b.x > vx + vw || b.y + b.h < vy || b.y > vy + vh) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(b.x + 10, b.y + 12, b.w, b.h);
    ctx.fillStyle = b.color; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof; ctx.fillRect(b.x + 8, b.y + 8, b.w - 16, b.h - 16);
    // Windows grid (lit at night).
    ctx.fillStyle = night ? 'rgba(255,214,10,0.75)' : 'rgba(190,225,245,0.8)';
    for (let wx = b.x + 18; wx < b.x + b.w - 16; wx += 26) for (let wy = b.y + 18; wy < b.y + b.h - 16; wy += 24) {
      if (((wx * 7 + wy * 13) % 5) !== 0) ctx.fillRect(wx, wy, 11, 9);
    }
    // Sign band.
    ctx.fillStyle = 'rgba(8,10,18,0.88)'; ctx.fillRect(b.x, b.y + b.h - 30, b.w, 30);
    ctx.fillStyle = night ? '#ffd60a' : '#ffffff';
    ctx.font = '900 16px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(b.name, b.x + b.w / 2, b.y + b.h - 10);
    ctx.font = '700 10px system-ui, sans-serif'; ctx.fillStyle = '#9fd8ef';
    ctx.fillText(b.sign, b.x + b.w / 2, b.y + 14);
    // Door marker.
    ctx.fillStyle = '#ffd60a'; ctx.fillRect(b.doorX - 7, b.doorY - 8, 14, 8);
  }
  // Garages / bribes / spikes / roadblock markers.
  for (const g of world.garages) { ctx.fillStyle = '#fb8500'; ctx.beginPath(); ctx.arc(g.x, g.y, 15, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#14161c'; ctx.font = '900 15px system-ui'; ctx.textAlign = 'center'; ctx.fillText('G', g.x, g.y + 5); }
  for (const br of world.bribes) { ctx.fillStyle = '#06d6a0'; ctx.beginPath(); ctx.arc(br.x, br.y, 14, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#0b2e23'; ctx.font = '900 15px system-ui'; ctx.textAlign = 'center'; ctx.fillText('$', br.x, br.y + 5); }
  for (const s of world.spikes) { ctx.fillStyle = '#22242c'; ctx.fillRect(s.x - 20, s.y - 4, 40, 8); ctx.fillStyle = '#e9ecef'; for (let i = -16; i <= 16; i += 8) { ctx.beginPath(); ctx.moveTo(s.x + i, s.y - 4); ctx.lineTo(s.x + i + 4, s.y - 11); ctx.lineTo(s.x + i + 8, s.y - 4); ctx.fill(); } }
  // Mission entry marker + loot ring.
  if (world.mission) {
    const m = world.mission;
    const pulse = 1 + Math.sin(world.time * 5) * 0.12;
    ctx.strokeStyle = '#ef476f'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(m.entryX, m.entryY, 30 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ef476f'; ctx.font = '900 15px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(m.phase === 'approach' ? 'ENTRY' : m.heist.sign || 'TARGET', m.entryX, m.entryY - 40);
    if (m.phase === 'grab') {
      // Loot progress ring at the door.
      const cx = m.building.doorX, cy = m.building.doorY - 16;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#06d6a0';
      ctx.beginPath(); ctx.arc(cx, cy, 30, -Math.PI / 2, -Math.PI / 2 + (m.lootGrabbed / m.lootTotal) * Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '900 16px system-ui';
      ctx.fillText('$' + Math.floor(m.lootGrabbed), cx, cy + 5);
      // Alarm timer bar.
      ctx.fillStyle = 'rgba(10,12,22,0.8)'; ctx.fillRect(cx - 60, cy - 66, 120, 16);
      ctx.fillStyle = m.alarmT < 12 ? '#ef476f' : '#ffd60a';
      ctx.fillRect(cx - 57, cy - 63, 114 * Math.max(0, m.alarmT) / m.stats.alarm, 10);
      ctx.fillStyle = '#fff'; ctx.font = '800 12px system-ui'; ctx.fillText('ALARM ' + Math.max(0, Math.ceil(m.alarmT)) + 's', cx, cy - 76);
    }
  }
  // Activity markers.
  const act = world.activities;
  if (act) {
    if (act.race) { const cp = act.race.checkpoints[act.race.idx]; if (cp) { ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(cp.x, cp.y, 40 + Math.sin(world.time * 5) * 5, 0, Math.PI * 2); ctx.stroke(); } }
    if (act.chop) { ctx.fillStyle = '#4cc9f0'; ctx.font = '900 15px system-ui'; ctx.textAlign = 'center'; ctx.fillText('CHOP TARGET', act.chop.car.x, act.chop.car.y - 34); }
  }
  // Skid marks.
  ctx.fillStyle = 'rgba(15,15,20,0.5)';
  for (const car of world.cars) for (const s of car.skid) ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
  // Cars.
  for (const car of world.cars) {
    if (car.x < vx - 60 || car.x > vx + vw + 60 || car.y < vy - 60 || car.y > vy + vh + 60) continue;
    drawCar(ctx, car, world.time);
  }
  // Pedestrians.
  for (const ped of world.peds) {
    if (ped.x < vx || ped.x > vx + vw || ped.y < vy || ped.y > vy + vh) continue;
    if (ped.down > 0) { ctx.save(); ctx.translate(ped.x, ped.y); ctx.rotate(Math.PI / 2); ctx.fillStyle = ped.shirt; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill(); ctx.restore(); continue; }
    if (ped.fare && !ped.fare.picked) { ctx.fillStyle = '#f72585'; ctx.font = '900 20px system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', ped.x, ped.y - 22); }
    drawPerson(ctx, ped.x, ped.y, ped.angle, ped.shirt, { phase: ped.walkPhase });
  }
  // Crew.
  for (const c of world.crewMembers) drawPerson(ctx, c.x, c.y, c.angle, c.def.color, { phase: c.walkPhase, bag: c.hasBag });
  // Player.
  const p = world.player;
  if (!p.car) {
    drawPerson(ctx, p.x, p.y, p.aimAngle || p.angle, '#ffd23f', { phase: p.walkPhase });
    // Gun.
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.aimAngle || p.angle);
    ctx.fillStyle = '#22242c'; ctx.fillRect(8, -2.5, 15, 5);
    ctx.restore();
    // Name tag.
    ctx.fillStyle = '#ffd23f'; ctx.font = '900 13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('THE PLANNER', p.x, p.y - 24);
  }
  // Helicopter + searchlight (drawn above rooftops).
  const h = world.heli;
  if (h.active) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,240,170,0.20)';
    ctx.beginPath(); ctx.moveTo(h.x, h.y);
    ctx.arc(h.x, h.y, 165, h.lightAngle - 0.32, h.lightAngle + 0.32); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,244,190,0.35)';
    ctx.beginPath(); ctx.arc(h.lightX, h.lightY, 62, 0, Math.PI * 2); ctx.fill();
    ctx.translate(h.x, h.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(6, 10, 30, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#22242c'; ctx.beginPath(); ctx.roundRect(-26, -10, 52, 20, 9); ctx.fill();
    ctx.fillStyle = '#2f6fed'; ctx.fillRect(-6, -10, 12, 20);
    ctx.strokeStyle = '#14161c'; ctx.lineWidth = 4;
    const r = Math.sin(h.rotor) * 34;
    ctx.beginPath(); ctx.moveTo(-36, -14); ctx.lineTo(36, -14 + r * 0.12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-44, 0); ctx.lineTo(-62, -4); ctx.stroke();
    ctx.restore();
  }
  // Particles in world space.
  world.particles.draw(ctx);
  ctx.restore();
  // Day/night tint + power-cut darkness.
  if (dark > 0 || world.powerCut) {
    ctx.fillStyle = world.powerCut ? 'rgba(3,5,16,0.55)' : phase.tint;
    if (world.powerCut || dark > 0) ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  // Street name caption bottom-centre.
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '800 15px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(streetNameAt(world.camera.x, world.camera.y) + ' · MERIDIAN', VIEW_W / 2, VIEW_H - 12);
}
