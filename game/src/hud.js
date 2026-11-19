// hud.js — money, wanted stars, health, mission line and timer, circular minimap, toasts and the menu screens.
import { VIEW_W, VIEW_H, WORLD_SIZE, PALETTE } from './config.js';
import { clamp } from './rng.js';
function panel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(26,14,12,0.66)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(255,214,170,0.18)'; ctx.lineWidth = 1; ctx.stroke();
}
function drawStars(ctx, game) {
  const stars = game.police.stars;
  const flash = game.police.decaying && Math.sin(game.time * 7) > 0;
  ctx.font = '22px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  let label = '';
  for (let i = 0; i < 5; i++) label += i < stars ? '★' : '☆';
  panel(ctx, VIEW_W - 168, 14, 154, 40);
  ctx.fillStyle = flash ? '#8a8f98' : (stars > 0 ? '#f2c14e' : '#5c626c');
  ctx.fillText(label, VIEW_W - 24, 22);
}
export function drawHud(ctx, game) {
  ctx.save();
  // Money, top-left.
  panel(ctx, 14, 14, 168, 40);
  ctx.fillStyle = PALETTE.money; ctx.font = '700 20px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('$' + Math.floor(game.money).toLocaleString('en-US'), 26, 23);
  drawStars(ctx, game);
  // Mission line and timer, top-centre.
  if (game.missions.active) {
    const text = game.missions.headline();
    ctx.font = '600 15px system-ui, sans-serif';
    const w = Math.min(560, ctx.measureText(text).width + 90);
    panel(ctx, VIEW_W / 2 - w / 2, 14, w, 40);
    ctx.fillStyle = PALETTE.hudText; ctx.textAlign = 'center';
    ctx.fillText(text, VIEW_W / 2 - 18, 26);
    const t = Math.max(0, Math.ceil(game.missions.timeLeft));
    ctx.fillStyle = t <= 15 ? PALETTE.danger : '#f2c14e';
    ctx.font = '700 15px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(t + 's', VIEW_W / 2 + w / 2 - 12, 26);
  } else if (game.time > 2) {
    ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(232,230,223,0.75)';
    ctx.fillText('Free roam — visit the yellow marker when a job is offered, or press Enter near Venn jobs', VIEW_W / 2, 20);
  }
  // Briefing toast under the mission line.
  if (game.nowMs < game.missions.briefUntil && game.missions.lastBrief) {
    ctx.font = '600 14px system-ui, sans-serif';
    const w = Math.min(680, ctx.measureText(game.missions.lastBrief).width + 36);
    panel(ctx, VIEW_W / 2 - w / 2, 62, w, 34);
    ctx.fillStyle = '#f0d9a0'; ctx.textAlign = 'center';
    ctx.fillText(game.missions.lastBrief, VIEW_W / 2, 71);
  }
  // Toasts (centre-lower, never over the minimap).
  ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center';
  game.toasts.filter((t) => game.nowMs < t.until).slice(-2).forEach((t, i) => {
    const w = Math.min(620, ctx.measureText(t.text).width + 36);
    panel(ctx, VIEW_W / 2 - w / 2, VIEW_H - 148 - i * 40, w, 34);
    ctx.fillStyle = PALETTE.hudText; ctx.fillText(t.text, VIEW_W / 2, VIEW_H - 139 - i * 40);
  });
  // Health, bottom-left; car health and speed while driving.
  panel(ctx, 14, VIEW_H - 62, 208, 48);
  ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('HEALTH', 26, VIEW_H - 54);
  ctx.fillStyle = '#4a3628'; ctx.fillRect(26, VIEW_H - 38, 184, 10);
  ctx.fillStyle = game.player.hp > 30 ? '#8fc97f' : PALETTE.danger;
  ctx.fillRect(26, VIEW_H - 38, 184 * clamp(game.player.hp / 100, 0, 1), 10);
  if (game.player.inCar && game.player.car) {
    // Speed lives on the VEHICLE label line (right-aligned); the bar owns its own line
    // at full panel width, so text and bar can never overlap.
    panel(ctx, 14, VIEW_H - 116, 208, 48);
    ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('VEHICLE', 26, VIEW_H - 108);
    ctx.fillStyle = PALETTE.hudText; ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(Math.abs(game.player.car.speed) * 0.62) + ' km/h', 210, VIEW_H - 109);
    ctx.fillStyle = '#4a3628'; ctx.fillRect(26, VIEW_H - 92, 184, 10);
    ctx.fillStyle = '#e8a06a'; ctx.fillRect(26, VIEW_H - 92, 184 * clamp(game.player.car.hp / game.player.car.maxHp, 0, 1), 10);
  }
  // Control hints for the first seconds of play.
  if (game.playTime < 9 && game.screen === 'play') {
    ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(232,230,223,0.8)';
    ctx.fillText(game.player.inCar ? 'WASD drive · Space handbrake · E exit · P pause' : 'WASD move · Shift sprint · E enter car · Space shoot · P pause · H help', 16, VIEW_H - 128);
  }
  drawMinimap(ctx, game);
  ctx.restore();
}
export function drawMinimap(ctx, game) {
  const cx = VIEW_W - 92, cy = VIEW_H - 92, r = 74;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#2e2118'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  const scale = (r * 2) / 1500;
  const drawDot = (wx, wy, color, size) => {
    let dx = (wx - game.player.x) * scale, dy = (wy - game.player.y) * scale;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > r - 7) { dx = dx / d * (r - 7); dy = dy / d * (r - 7); }
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx + dx, cy + dy, size, 0, Math.PI * 2); ctx.fill();
  };
  if (game.city.minimap) {
    try {
      const srcSize = 1500 / WORLD_SIZE * game.city.minimap.width;
      const sx = clamp((game.player.x / WORLD_SIZE) * game.city.minimap.width - srcSize / 2, 0, game.city.minimap.width - srcSize);
      const sy = clamp((game.player.y / WORLD_SIZE) * game.city.minimap.height - srcSize / 2, 0, game.city.minimap.height - srcSize);
      ctx.drawImage(game.city.minimap, sx, sy, srcSize, srcSize, cx - r, cy - r, r * 2, r * 2);
    } catch (e) {}
  }
  ctx.fillStyle = 'rgba(26,14,12,0.25)'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  for (const cop of game.police.cops) if (!cop.dead) drawDot(cop.x, cop.y, Math.sin(game.time * 8) > 0 ? '#ff5040' : '#4f8ef7', 3.4);
  const marker = game.missions.marker();
  if (marker) drawDot(marker.x, marker.y, marker.color === 'pickup' ? '#e8c832' : '#4fc96a', 4.4);
  // Player arrow at the centre.
  ctx.translate(cx, cy); ctx.rotate(game.player.inCar && game.player.car ? game.player.car.angle : game.player.angle);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -4.4); ctx.lineTo(-5, 4.4); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(245,234,216,0.8)'; ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('AMBER COAST', cx, cy + r + 4);
}
export function drawTitle(ctx, game) {
  ctx.fillStyle = 'rgba(30,12,10,0.40)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffb37a'; ctx.font = '700 58px system-ui, sans-serif';
  ctx.shadowColor = '#ff8a5c'; ctx.shadowBlur = 18;
  ctx.fillText('A M B E R', VIEW_W / 2, 238);
  ctx.fillStyle = '#f28bb4'; ctx.shadowColor = '#f28bb4';
  ctx.fillText('C O A S T', VIEW_W / 2, 302);
  ctx.shadowBlur = 0;
  ctx.fillStyle = PALETTE.hudText; ctx.font = '16px system-ui, sans-serif';
  ctx.fillText('A palm-lined coastal city at golden hour: steal cars, run jobs for fixer Dario Venn, outrun the law.', VIEW_W / 2, 344);
  ctx.font = '15px system-ui, sans-serif'; ctx.fillStyle = '#e8d9c4';
  ctx.fillText('WASD / arrows — move & drive      E — enter / exit car      Space — shoot / handbrake', VIEW_W / 2, 402);
  ctx.fillText('Shift — sprint      P — pause      H — help', VIEW_W / 2, 428);
  ctx.fillStyle = '#f2c14e'; ctx.font = '700 19px system-ui, sans-serif';
  ctx.fillText('Press ENTER to start', VIEW_W / 2, 486);
  ctx.fillStyle = PALETTE.hudMuted; ctx.font = '14px system-ui, sans-serif';
  const s = game.saveData;
  ctx.fillText(s.missionsCompleted > 0 ? `Saved progress: $${Math.floor(s.money)} · ${s.missionsCompleted} jobs done · $${Math.floor(s.totalEarned)} earned` : 'No saved progress yet — your first sunset on the Amber Coast.', VIEW_W / 2, 524);
}
export function drawSummary(ctx, game) {
  const s = game.lastSummary || {
    jobs: game.jobsThisChain || 0, chainEarned: Math.floor(game.chainEarned || 0),
    money: Math.floor(game.money), totalEarned: Math.floor(game.totalEarned),
    chains: game.chainsFinished || 0, bestEscapeMs: game.bestEscapeMs || 0,
    carsStolen: game.carsStolen || 0, timesWasted: game.timesWasted || 0,
  };
  ctx.save();
  ctx.fillStyle = 'rgba(30,12,10,0.5)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const px = VIEW_W / 2 - 300, py = VIEW_H / 2 - 220;
  panel(ctx, px, py, 600, 440);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f28bb4'; ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText('A M B E R   C O A S T', VIEW_W / 2, py + 14);
  ctx.fillStyle = '#f2c14e'; ctx.font = '700 30px system-ui, sans-serif';
  ctx.fillText('CHAIN COMPLETE', VIEW_W / 2, py + 36);
  ctx.fillStyle = PALETTE.hudText; ctx.font = '15px system-ui, sans-serif';
  ctx.fillText('Dario Venn — all five jobs delivered.', VIEW_W / 2, py + 72);
  const esc = s.bestEscapeMs > 0
    ? `${Math.floor(s.bestEscapeMs / 60000)}:${String(Math.floor((s.bestEscapeMs % 60000) / 1000)).padStart(2, '0')}`
    : '—';
  const rows = [
    ['JOBS DONE', `${s.jobs} / 5`],
    ['CHAIN EARNINGS', '$' + Math.floor(s.chainEarned).toLocaleString('en-US')],
    ['CASH', '$' + Math.floor(s.money).toLocaleString('en-US')],
    ['LIFETIME EARNED', '$' + Math.floor(s.totalEarned).toLocaleString('en-US')],
    ['BEST ESCAPE', esc],
    ['CARS STOLEN', String(s.carsStolen)],
    ['TIMES WASTED', String(s.timesWasted)],
    ['CHAINS FINISHED', String(s.chains)],
  ];
  rows.forEach((row, i) => {
    const y = py + 122 + i * 34;
    ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(row[0], px + 36, y + 3);
    ctx.fillStyle = PALETTE.hudText; ctx.font = '700 17px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(row[1], px + 600 - 36, y);
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2c14e'; ctx.font = '15px system-ui, sans-serif';
  ctx.fillText('The chain restarts at +25% pay per loop — press ENTER to keep driving', VIEW_W / 2, py + 440 - 40);
  ctx.restore();
}
export function drawWasted(ctx, game) {
  ctx.fillStyle = 'rgba(20,4,6,0.55)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center'; ctx.fillStyle = '#e5484d';
  ctx.font = '700 54px system-ui, sans-serif'; ctx.fillText('WASTED', VIEW_W / 2, 380);
  ctx.fillStyle = PALETTE.hudText; ctx.font = '16px system-ui, sans-serif';
  ctx.fillText('You wake at St. Sable Hospital. The bill is 10% of your cash.', VIEW_W / 2, 422);
}
export function drawPause(ctx, game, help) {
  ctx.fillStyle = 'rgba(30,12,10,0.6)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center'; ctx.fillStyle = PALETTE.hudText;
  ctx.font = '700 34px system-ui, sans-serif'; ctx.fillText(help ? 'HELP' : 'PAUSED', VIEW_W / 2, 268);
  ctx.font = '16px system-ui, sans-serif'; ctx.fillStyle = '#e8d9c4';
  const lines = [
    'WASD / arrows — move on foot, drive in a car',
    'E — enter or exit the nearest car (stealing brings heat)',
    'Space — shoot on foot · handbrake in a car',
    'Shift — sprint · P — pause · H — help',
    'Yellow marker: pickup · Green marker: deliver',
    'Stars fade when you break line of sight and stay clean.',
  ];
  lines.forEach((l, i) => ctx.fillText(l, VIEW_W / 2, 322 + i * 28));
  ctx.fillStyle = '#f2c14e'; ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText('Press P to resume', VIEW_W / 2, 322 + lines.length * 28 + 12);
}
