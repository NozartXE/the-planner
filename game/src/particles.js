// particles.js — pooled particle system + floating text (capped, big, few).
export class Particles {
  constructor() { this.list = []; this.floats = []; }
  spawn(x, y, opts = {}) {
    if (this.list.length > 420) return;
    this.list.push({
      x, y, vx: opts.vx || 0, vy: opts.vy || 0, life: opts.life || 0.6, maxLife: opts.life || 0.6,
      size: opts.size || 4, color: opts.color || '#ffffff', gravity: opts.gravity || 0,
      drag: opts.drag || 0, shape: opts.shape || 'rect', spin: opts.spin || 0, angle: opts.angle || 0,
    });
  }
  burst(x, y, count, color, speed = 160, life = 0.6, size = 4, shape = 'rect') {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (i % 3) * 0.37;
      const sp = speed * (0.4 + ((i * 37) % 10) / 14);
      this.spawn(x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: life * (0.6 + ((i * 13) % 10) / 16), size, color, shape, drag: 2.2, spin: 3 });
    }
  }
  sparks(x, y, n = 8) { this.burst(x, y, n, '#ffd60a', 240, 0.35, 3); this.burst(x, y, Math.ceil(n / 2), '#ff9770', 150, 0.4, 3); }
  smoke(x, y, n = 3) { for (let i = 0; i < n; i++) this.spawn(x, y, { vx: (i - 1) * 14, vy: -46 - i * 9, life: 1.1, size: 12 + i * 4, color: 'rgba(70,70,80,0.55)', shape: 'circle' }); }
  cashFlutter(x, y, n = 10) { this.burst(x, y, n, '#06d6a0', 130, 1.0, 6, 'bill'); this.burst(x, y, 4, '#ffd60a', 110, 0.9, 5, 'bill'); }
  confetti(x, y, n = 26) {
    const cols = ['#ef476f', '#ffd60a', '#06d6a0', '#4cc9f0', '#f72585'];
    for (let i = 0; i < n; i++) this.spawn(x + (i % 9 - 4) * 16, y, { vx: (i % 7 - 3) * 42, vy: -60 - (i % 5) * 30, life: 1.6, size: 6, color: cols[i % cols.length], gravity: 130, shape: 'bill', spin: 6 });
  }
  muzzle(x, y, angle) {
    this.spawn(x, y, { vx: Math.cos(angle) * 60, vy: Math.sin(angle) * 60, life: 0.07, size: 18, color: '#ffd60a', shape: 'circle' });
    this.spawn(x, y, { vx: Math.cos(angle) * 30, vy: Math.sin(angle) * 30, life: 0.05, size: 9, color: '#fff7cc', shape: 'circle' });
  }
  // A tracer streak: a long thin rect, size = half-length, laid along angle.
  tracer(x, y, angle, halfLen, color = '#ffe9a8', life = 0.12) {
    this.spawn(x, y, { vx: 0, vy: 0, life, size: halfLen, color, shape: 'streak', angle, spin: 0 });
  }
  floatText(x, y, text, color = '#ffffff', size = 22) {
    // One readout per text: a fresh HIT! replaces the previous one
    // instead of stacking beside it (the old pile read as one smear).
    this.floats = this.floats.filter((f) => f.text !== text);
    if (this.floats.length >= 5) this.floats.shift(); // hard cap: big, few
    this.floats.push({ x, y, text, color, size, life: 1.5 });
  }
  step(dt) {
    for (const p of this.list) {
      p.life -= dt; p.vy += p.gravity * dt;
      p.vx -= p.vx * p.drag * dt; p.vy -= p.vy * p.drag * dt * 0.4;
      p.x += p.vx * dt; p.y += p.vy * dt; p.angle += p.spin * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
    for (const f of this.floats) { f.life -= dt; f.y -= 34 * dt; }
    this.floats = this.floats.filter((f) => f.life > 0);
  }
  draw(ctx) {
    for (const p of this.list) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y); ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.size * (0.5 + a * 0.5), 0, Math.PI * 2); ctx.fill(); }
      else if (p.shape === 'streak') ctx.fillRect(-p.size, -3, p.size * 2, 6);
      else if (p.shape === 'bill') ctx.fillRect(-p.size, -p.size * 0.45, p.size * 2, p.size * 0.9);
      else ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of this.floats) {
      ctx.globalAlpha = Math.min(1, f.life);
      ctx.font = `900 ${f.size}px system-ui, sans-serif`;
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,10,20,0.85)';
      ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }
}
