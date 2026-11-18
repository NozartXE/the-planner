// hud.js — in-world HUD: objective banner, wanted stars, health, cash, gadget
// icons with cooldown sweeps, bust meter, loot/alarm readouts, prompts.
import { formatMoney } from './economy.js';
import { drawMinimap, MM } from './minimap.js';

export function drawStars(ctx, stars, x, y, size = 26) {
  ctx.save();
  ctx.font = `${size}px system-ui, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < stars ? '#ffd60a' : 'rgba(255,255,255,0.22)';
    ctx.fillText('★', x + i * (size + 2), y);
  }
  ctx.restore();
}

export function drawHud(ctx, world, W, H) {
  const p = world.player;
  const save = world.save;
  // Objective banner (top centre).
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const obj = world.objective || '';
  ctx.font = '800 21px system-ui, sans-serif';
  const w = Math.min(860, ctx.measureText(obj).width + 44);
  ctx.fillStyle = 'rgba(10,12,22,0.82)';
  ctx.fillRect(W / 2 - w / 2, 12, w, 44);
  ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 2; ctx.strokeRect(W / 2 - w / 2, 12, w, 44);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(obj, W / 2, 35);
  ctx.restore();
  // Wanted stars top-right.
  if (world.stars > 0) drawStars(ctx, world.stars, W - 190, 84, 30);
  // Cash + REP top-left.
  ctx.save();
  ctx.fillStyle = 'rgba(10,12,22,0.78)'; ctx.fillRect(14, 12, 218, 64);
  ctx.fillStyle = '#06d6a0'; ctx.font = '900 24px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(save ? formatMoney(save.cash) : '$0', 26, 34);
  ctx.fillStyle = '#e9ecef'; ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillText(save ? `REP ${save.rep}` : 'REP 0', 26, 60);
  ctx.restore();
  // Health bar bottom-left.
  ctx.save();
  ctx.fillStyle = 'rgba(10,12,22,0.78)'; ctx.fillRect(14, H - 118, 218, 40);
  ctx.fillStyle = '#3a3f4a'; ctx.fillRect(24, H - 104, 198, 14);
  ctx.fillStyle = p.health > 30 ? '#06d6a0' : '#ef476f';
  ctx.fillRect(24, H - 104, 198 * Math.max(0, p.health) / 100, 14);
  ctx.fillStyle = '#fff'; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(p.car ? `CAR ${Math.ceil(p.car.health)}/${p.car.maxHealth} · ${p.car.spec.name}` : 'ON FOOT — E: enter car · mouse: aim · click: fire', 24, H - 84);
  ctx.restore();
  // Bust meter.
  if (p.bust > 0.02) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(10,12,22,0.85)'; ctx.fillRect(W / 2 - 130, H - 150, 260, 40);
    ctx.fillStyle = '#ef476f'; ctx.fillRect(W / 2 - 120, H - 138, 240 * Math.min(1, p.bust), 16);
    ctx.fillStyle = '#fff'; ctx.font = '900 15px system-ui, sans-serif';
    ctx.fillText('BUSTED?', W / 2, H - 100);
    ctx.restore();
  }
  // Gadget icons bottom-right.
  if (world.gadgets) {
    const items = [['cutPower', '1'], ['jam', '2'], ['decoy', '3'], ['spikes', '4']];
    ctx.save();
    items.forEach(([id, key], i) => {
      const g = world.gadgets[id];
      const x = W - 264 + i * 62, y = H - 76;
      ctx.fillStyle = g.cd > 0 ? 'rgba(30,34,48,0.85)' : 'rgba(16,40,34,0.9)';
      ctx.fillRect(x, y, 54, 54);
      ctx.strokeStyle = g.active > 0 ? '#06d6a0' : '#ffd60a'; ctx.lineWidth = 2; ctx.strokeRect(x, y, 54, 54);
      ctx.fillStyle = '#fff'; ctx.font = '900 17px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(key, x + 27, y + 17);
      ctx.font = '700 9.5px system-ui, sans-serif';
      ctx.fillText(g.name, x + 27, y + 33);
      if (g.cd > 0) { ctx.font = '900 14px system-ui, sans-serif'; ctx.fillStyle = '#ffd60a'; ctx.fillText(Math.ceil(g.cd) + 's', x + 27, y + 47); }
    });
    ctx.restore();
  }
  // Bribe prompt.
  if (world.bribeNear) {
    ctx.save(); ctx.textAlign = 'center'; ctx.font = '800 19px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(10,12,22,0.85)'; ctx.fillRect(W / 2 - 230, H - 200, 460, 38);
    ctx.fillStyle = '#06d6a0';
    ctx.fillText(`${world.bribeNear.label}: press E — bribe $${world.bribeNear.cost} to shed heat`, W / 2, H - 180);
    ctx.restore();
  }
  // Minimap bottom-right above gadgets? Place top-right under stars.
  drawMinimap(ctx, world, W - MM.w - 14, 118);
}
