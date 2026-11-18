// hud.js — in-world HUD: objective banner, wanted stars, health, cash, gadget
// icons with cooldown sweeps, bust meter, loot/alarm readouts, prompts.
import { formatMoney } from './economy.js';
import { drawMinimap, MM, MM_SMALL } from './minimap.js';

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

export function drawHud(ctx, world, W, H, opts = {}) {
  const p = world.player;
  const save = world.save;
  // PHASE 2 minimal GTA-style HUD for the 3D play views (Rect's 20:49
  // directive): no wide banner, no big panels — stars + cash compact at
  // the top-right, one small objective line at the top-centre, minimap
  // small at the bottom-left, a thin health strip, small gadget chips
  // at the bottom-right. All core info stays available.
  if (opts.minimal && !world.results) {
    ctx.save();
    // Stars + cash, top-right, text only with a soft shadow.
    ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 5;
    if (world.stars > 0) drawStars(ctx, world.stars, W - 168, 26, 24);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#a8e063'; ctx.font = '900 23px system-ui, sans-serif';
    ctx.fillText(save ? formatMoney(save.cash) : '$0', W - 16, 58);
    ctx.fillStyle = 'rgba(238,241,245,0.92)'; ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText(save ? `REP ${save.rep}` : 'REP 0', W - 16, 80);
    // Objective: ONE small line, top-centre.
    const obj = world.objective || '';
    if (obj) {
      ctx.font = '700 14.5px system-ui, sans-serif';
      const label = obj.length > 72 ? obj.slice(0, 71) + '…' : obj;
      const w = Math.min(620, ctx.measureText(label).width + 26);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(8,10,16,0.55)';
      ctx.fillRect(W / 2 - w / 2, 10, w, 27);
      ctx.fillStyle = '#f2f4f6'; ctx.textAlign = 'center';
      ctx.fillText(label, W / 2, 24);
    }
    ctx.restore();
    // Minimap bottom-left (GTA position), muted border.
    drawMinimap(ctx, world, 14, H - MM_SMALL.h - 14, MM_SMALL.w, MM_SMALL.h, 'rgba(230,234,238,0.55)');
    // Thin health strip + status line above the minimap.
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,16,0.55)'; ctx.fillRect(14, H - MM_SMALL.h - 44, MM_SMALL.w, 20);
    ctx.fillStyle = '#2c313a'; ctx.fillRect(18, H - MM_SMALL.h - 38, MM_SMALL.w - 8, 5);
    ctx.fillStyle = p.health > 30 ? '#7fc97f' : '#ff6b81';
    ctx.fillRect(18, H - MM_SMALL.h - 38, (MM_SMALL.w - 8) * Math.max(0, p.health) / 100, 5);
    ctx.fillStyle = 'rgba(238,241,245,0.9)'; ctx.font = '700 9.5px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(p.car ? `CAR ${Math.ceil(p.car.health)}/${p.car.maxHealth} · ${p.car.spec.name}` : 'ON FOOT — E: enter car · mouse: aim · click: fire', 18, H - MM_SMALL.h - 29.5);
    ctx.restore();
    // Bust meter (small, centred low).
    if (p.bust > 0.02) {
      ctx.save(); ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,10,16,0.7)'; ctx.fillRect(W / 2 - 90, H - 120, 180, 26);
      ctx.fillStyle = '#ff6b81'; ctx.fillRect(W / 2 - 84, H - 114, 168 * Math.min(1, p.bust), 8);
      ctx.fillStyle = '#fff'; ctx.font = '900 11px system-ui, sans-serif';
      ctx.fillText('BUSTED?', W / 2, H - 84);
      ctx.restore();
    }
    // Gadget chips: small, bottom-right.
    if (world.gadgets) {
      const items = [['cutPower', '1'], ['jam', '2'], ['decoy', '3'], ['spikes', '4']];
      ctx.save();
      items.forEach(([id, key], i) => {
        const g = world.gadgets[id];
        const x = W - 14 - 4 * 40 + i * 40, y = H - 48;
        ctx.fillStyle = g.cd > 0 ? 'rgba(20,22,30,0.62)' : 'rgba(14,30,26,0.62)';
        ctx.fillRect(x, y, 34, 34);
        ctx.strokeStyle = g.active > 0 ? '#7deeff' : 'rgba(230,234,238,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(x, y, 34, 34);
        ctx.fillStyle = '#fff'; ctx.font = '900 12px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(g.cd > 0 ? Math.ceil(g.cd) + 's' : key, x + 17, y + 13);
        ctx.font = '700 6.5px system-ui, sans-serif';
        ctx.fillText(g.name, x + 17, y + 25);
      });
      ctx.restore();
    }
    if (world.bribeNear) {
      ctx.save(); ctx.textAlign = 'center'; ctx.font = '800 14px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(8,10,16,0.7)'; ctx.fillRect(W / 2 - 200, H - 170, 400, 30);
      ctx.fillStyle = '#7deeff';
      ctx.fillText(`${world.bribeNear.label}: press E — bribe $${world.bribeNear.cost} to shed heat`, W / 2, H - 154);
      ctx.restore();
    }
    return;
  }
  // Objective banner (top centre). Skipped on the results screen: the job
  // is over, so the live objective must not ghost through the panel.
  if (!world.results) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const obj = world.objective || '';
    ctx.font = '800 21px system-ui, sans-serif';
    const w = Math.min(860, ctx.measureText(obj).width + 44);
    ctx.fillStyle = 'rgba(10,12,22,0.82)';
    ctx.fillRect(W / 2 - w / 2, 12, w, 44);
    ctx.strokeStyle = '#ff71ce'; ctx.lineWidth = 2; ctx.strokeRect(W / 2 - w / 2, 12, w, 44);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(obj, W / 2, 35);
    ctx.restore();
  }
  // Wanted stars top-right.
  if (world.stars > 0) drawStars(ctx, world.stars, W - 190, 84, 30);
  // Cash + REP top-left.
  ctx.save();
  ctx.fillStyle = 'rgba(10,12,22,0.78)'; ctx.fillRect(14, 12, 218, 64);
  ctx.fillStyle = '#7deeff'; ctx.font = '900 24px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(save ? formatMoney(save.cash) : '$0', 26, 34);
  ctx.fillStyle = '#e9ecef'; ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillText(save ? `REP ${save.rep}` : 'REP 0', 26, 60);
  ctx.restore();
  // Health bar bottom-left.
  ctx.save();
  ctx.fillStyle = 'rgba(10,12,22,0.78)'; ctx.fillRect(14, H - 118, 218, 40);
  ctx.fillStyle = '#3a3f4a'; ctx.fillRect(24, H - 104, 198, 14);
  ctx.fillStyle = p.health > 30 ? '#01cdfe' : '#ff6b81';
  ctx.fillRect(24, H - 104, 198 * Math.max(0, p.health) / 100, 14);
  ctx.fillStyle = '#fff'; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(p.car ? `CAR ${Math.ceil(p.car.health)}/${p.car.maxHealth} · ${p.car.spec.name}` : 'ON FOOT — E: enter car · mouse: aim · click: fire', 24, H - 84);
  ctx.restore();
  // Bust meter.
  if (p.bust > 0.02) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(10,12,22,0.85)'; ctx.fillRect(W / 2 - 130, H - 150, 260, 40);
    ctx.fillStyle = '#ff6b81'; ctx.fillRect(W / 2 - 120, H - 138, 240 * Math.min(1, p.bust), 16);
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
      ctx.strokeStyle = g.active > 0 ? '#01cdfe' : '#ff71ce'; ctx.lineWidth = 2; ctx.strokeRect(x, y, 54, 54);
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
    ctx.fillStyle = '#7deeff';
    ctx.fillText(`${world.bribeNear.label}: press E — bribe $${world.bribeNear.cost} to shed heat`, W / 2, H - 180);
    ctx.restore();
  }
  // Minimap: full size top-right while driving. On foot (top-down combat
  // framing) it shrinks to the top-left, below the cash panel, so it never
  // sits on a named building's roof.
  if (p.car) drawMinimap(ctx, world, W - MM.w - 14, 118);
  else drawMinimap(ctx, world, 14, 84, MM_SMALL.w, MM_SMALL.h);
}
