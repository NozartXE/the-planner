// cars.js — the car factory (civilian types and the police interceptor) and the top-down car renderer.
import { CAR_LENGTH, CAR_WIDTH } from './config.js';
export const CIV_TYPES = [
  { kind: 'sedan', colors: ['#5b6b7a', '#6e5a52', '#54604f', '#62586e', '#715f43'], maxSpeed: 205, accel: 210, hp: 100 },
  { kind: 'hatch', colors: ['#68707c', '#7a6a58', '#5d7268', '#746a80'], maxSpeed: 180, accel: 195, hp: 85 },
  { kind: 'coupe', colors: ['#7a5a4e', '#4f6272', '#6b6f4e', '#5e5470'], maxSpeed: 245, accel: 250, hp: 90 },
  { kind: 'van', colors: ['#5c6068', '#6a6258', '#55606a'], maxSpeed: 160, accel: 170, hp: 130 },
  { kind: 'armored', colors: ['#3f444c', '#494540'], maxSpeed: 215, accel: 200, hp: 220 },
];
let nextCarId = 1;
export function makeCar(rng, typeIdx, x, y, angle) {
  const t = CIV_TYPES[typeIdx % CIV_TYPES.length];
  return {
    id: nextCarId++, kind: t.kind, isCop: false, isArmored: typeIdx === 4,
    x, y, angle: angle || 0, speed: 0, steer: 0,
    color: rng ? rng.pick(t.colors) : t.colors[0],
    maxSpeed: t.maxSpeed, accel: t.accel, hp: t.hp, maxHp: t.hp,
    len: t.kind === 'van' ? 44 : CAR_LENGTH, wid: t.kind === 'van' ? 21 : CAR_WIDTH,
    occupied: false, dead: false, sirenPhase: rng ? rng.range(0, 6) : 0,
  };
}
export function makeCopCar(x, y, angle) {
  return {
    id: nextCarId++, kind: 'interceptor', isCop: true, isArmored: false,
    x, y, angle: angle || 0, speed: 0, steer: 0, color: '#d8d8dc',
    maxSpeed: 268, accel: 265, hp: 150, maxHp: 150, len: CAR_LENGTH + 2, wid: CAR_WIDTH,
    occupied: true, dead: false, sirenPhase: (x % 6),
  };
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
export function drawCar(ctx, car, time) {
  const L = car.len, W = car.wid;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRectPath(ctx, -L / 2 + 2, -W / 2 + 3, L, W, 5); ctx.fill();
  // Body.
  ctx.fillStyle = car.dead ? '#2c2c30' : car.color;
  roundRectPath(ctx, -L / 2, -W / 2, L, W, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
  if (car.isCop) {
    ctx.fillStyle = '#23242a';
    roundRectPath(ctx, -L * 0.18, -W / 2 + 1, L * 0.36, W - 2, 3); ctx.fill();
    ctx.fillStyle = '#e8e8ec';
    ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('POLICE', 0, 0);
  }
  // Cabin and windshield.
  ctx.fillStyle = '#1b2027';
  roundRectPath(ctx, -L * 0.22, -W / 2 + 3, L * 0.4, W - 6, 3); ctx.fill();
  ctx.fillStyle = 'rgba(150,180,200,0.5)';
  ctx.fillRect(L * 0.1, -W / 2 + 4, 3, W - 8);
  // Wheels.
  ctx.fillStyle = '#101114';
  ctx.fillRect(-L / 2 + 4, -W / 2 - 1, 7, 3); ctx.fillRect(-L / 2 + 4, W / 2 - 2, 7, 3);
  ctx.fillRect(L / 2 - 11, -W / 2 - 1, 7, 3); ctx.fillRect(L / 2 - 11, W / 2 - 2, 7, 3);
  // Headlights and taillights.
  ctx.fillStyle = '#ffeec2';
  ctx.fillRect(L / 2 - 2, -W / 2 + 2, 2, 4); ctx.fillRect(L / 2 - 2, W / 2 - 6, 2, 4);
  ctx.fillStyle = '#e5484d';
  ctx.fillRect(-L / 2, -W / 2 + 2, 2, 4); ctx.fillRect(-L / 2, W / 2 - 6, 2, 4);
  // Cop light bar: alternating red and blue.
  if (car.isCop && !car.dead) {
    const phase = Math.sin(time * 10 + car.sirenPhase) > 0;
    ctx.fillStyle = phase ? '#ff3b30' : '#3b82f6';
    roundRectPath(ctx, -4, -W / 2 + 4, 8, 4, 2); ctx.fill();
    ctx.fillStyle = phase ? '#3b82f6' : '#ff3b30';
    roundRectPath(ctx, -4, W / 2 - 8, 8, 4, 2); ctx.fill();
  }
  // Damage smoke hint: a darker scorch patch when badly hurt.
  if (car.hp < car.maxHp * 0.35 && !car.dead) {
    ctx.fillStyle = 'rgba(20,20,20,0.5)';
    ctx.beginPath(); ctx.arc(L * 0.28, 0, 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
