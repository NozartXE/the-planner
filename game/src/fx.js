// fx.js — particles (sparks, smoke, muzzle flash, explosion, debris) and screen shake.
import { clamp } from './rng.js';
export class Fx {
  constructor(rng) { this.particles = []; this.skids = []; this.shake = 0; this.rng = rng; }
  skid(x, y, angle, len, w) { this.skids.push({ x, y, angle, len, w }); }
  drawSkids(ctx) {
    for (const s of this.skids) {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.angle);
      ctx.fillStyle = 'rgba(8,8,10,0.42)';
      ctx.fillRect(-s.len / 2, -s.w / 2, s.len, s.w);
      ctx.restore();
    }
  }
  burst(x, y, n, color, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(speed * 0.3, speed);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: this.rng.range(life * 0.5, life), maxLife: life, color, size: this.rng.range(size * 0.5, size), drag: 2.2 });
    }
  }
  sparks(x, y) { this.burst(x, y, 10, '#f2c14e', 190, 0.4, 2.4); }
  smoke(x, y) { this.burst(x, y, 5, 'rgba(120,120,125,0.6)', 34, 1.1, 5); }
  muzzle(x, y, angle) {
    this.particles.push({ x: x + Math.cos(angle) * 13, y: y + Math.sin(angle) * 13, vx: Math.cos(angle) * 60, vy: Math.sin(angle) * 60, life: 0.07, maxLife: 0.07, color: '#ffd76a', size: 4, drag: 0 });
  }
  explosion(x, y) { this.burst(x, y, 30, '#e07b39', 260, 0.7, 4); this.burst(x, y, 16, '#8a8a8a', 120, 1.2, 6); this.addShake(12); }
  debris(x, y) { this.burst(x, y, 8, '#6a6f78', 150, 0.6, 3); }
  blood(x, y) { this.burst(x, y, 7, '#8e2f35', 90, 0.45, 2.6); }
  addShake(amount) { this.shake = clamp(this.shake + amount, 0, 16); }
  update(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vy *= d;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.shake = Math.max(0, this.shake - dt * 26);
  }
  draw(ctx) {
    for (const p of this.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  shakeOffset(rng) {
    if (this.shake <= 0.1) return { x: 0, y: 0 };
    return { x: rng.range(-this.shake, this.shake) * 0.5, y: rng.range(-this.shake, this.shake) * 0.5 };
  }
}
