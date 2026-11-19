// hud.js — money, wanted stars, health, mission line and timer, rectangular
// GTA-style minimap stack, toasts and the menu screens.
import { VIEW_W, VIEW_H, WORLD_SIZE, PALETTE, BLOCK_PITCH, ROAD_W } from './config.js';
import { roadCenters, nearestRoadCenter } from './city.js';
import { clamp } from './rng.js';
import { CHAIN } from './missions.js';
import { CREW_POOL, GEAR_POOL, GETAWAYS, TIMES, jobPlanData, planStats, formatMoney } from './planning.js';
import { WEAPON_CLASSES, WEAPONS, weaponsByClass, weaponById } from './arsenal.js';
function panel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(26,14,12,0.66)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(255,214,170,0.18)'; ctx.lineWidth = 1; ctx.stroke();
}
// Opaque variant for the Planning Board (HUD debt fix): board panels sit
// over the live street, and at 66% alpha the city and its signage ghosted
// through the PLAN STATS text. Board panels are fully opaque — the street
// stays visible only in the open corridor between them.
function panelSolid(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgb(26,14,12)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(255,214,170,0.18)'; ctx.lineWidth = 1; ctx.stroke();
}
function drawStars(ctx, game) {
  const stars = game.police.stars;
  const flash = game.police.decaying && Math.sin(game.time * 7) > 0;
  const wanted = game.police.wantedState ? game.police.wantedState(game.player) : '';
  ctx.font = '22px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  let label = '';
  for (let i = 0; i < 5; i++) label += i < stars ? '★' : '☆';
  panel(ctx, VIEW_W - 252, 14, 238, 40);
  ctx.fillStyle = flash ? '#8a8f98' : (stars > 0 ? '#f2c14e' : '#5c626c');
  ctx.fillText(label, VIEW_W - 24, 22);
  if (wanted) {
    ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = wanted === 'IN SIGHT' ? '#ff9a5c' : '#c9b8a2';
    ctx.fillText(wanted, VIEW_W - 240, 27);
  }
}
// Dispatch roster, on a diet: the THREE nearest live units — callsign,
// distance band from the real gap, and the tactical state the sim assigned —
// plus one "+N more" line for the rest. The header count is the true live
// total, so the panel never claims a unit the street does not hold.
function distBand(d) { return d < 150 ? 'CLOSE' : d < 400 ? 'MID' : 'FAR'; }
export function drawDispatch(ctx, game) {
  const live = game.police.cops.filter((c) => !c.dead);
  if (!live.length || game.police.stars <= 0) return;
  if (game.police.assignTactics) game.police.assignTactics(game.player);
  const sorted = live.map((c) => ({ c, d: Math.hypot(c.x - game.player.x, c.y - game.player.y) }))
    .sort((a, b) => a.d - b.d);
  const rows = sorted.slice(0, 3);
  const more = sorted.length - rows.length;
  const h = 24 + rows.length * 17 + (more > 0 ? 15 : 0);
  // HUD debt fix: dispatch lives in the empty bottom-right quadrant of
  // action frames (stacked above the radio strip when that is showing),
  // not under the wanted stars where it crowded the top-right cluster.
  const radioOn = !!(game.player.inCar && game.radio);
  const x = VIEW_W - 252, y = VIEW_H - 14 - (radioOn ? 32 : 0) - h;
  panel(ctx, x, y, 238, h);
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillStyle = '#f0d9a0'; ctx.font = '700 10px system-ui, sans-serif';
  ctx.fillText('ACPD DISPATCH — ' + live.length + ' UNIT' + (live.length === 1 ? '' : 'S'), x + 10, y + 7);
  rows.forEach((r, i) => {
    const ry = y + 24 + i * 17;
    ctx.fillStyle = PALETTE.hudText; ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(r.c.callsign || ('UNIT-' + r.c.id), x + 10, ry);
    ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText(distBand(r.d), x + 92, ry + 1);
    ctx.fillStyle = r.c.tactical === 'PIT' ? '#ff9a5c' : r.c.tactical === 'ROADBLOCK' ? '#f2c14e' : '#c9b8a2';
    ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(r.c.tactical || 'PURSUIT', x + 228, ry + 1);
    ctx.textAlign = 'left';
  });
  if (more > 0) {
    ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText('+ ' + more + ' more unit' + (more === 1 ? '' : 's') + ' in the hunt', x + 10, y + 24 + rows.length * 17);
  }
}
// Dario Venn portrait card: the fixer drawn in the game's own figure style
// (round head, hair mass, shirt) beside ONE live line — the mission's actual
// current briefing text.
export function drawDialogue(ctx, game) {
  if (!game.missions.active || !game.missions.lastBrief) return;
  const x = 14, y = 128, w = 342, h = 62;
  panel(ctx, x, y, w, h);
  // Portrait: head + hair + shoulders, figure-style flat shapes.
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x + 6, y + 6, 50, 50, 6); ctx.clip();
  ctx.fillStyle = '#3a2c22'; ctx.fillRect(x + 6, y + 6, 50, 50);
  ctx.fillStyle = '#c98a5e'; ctx.beginPath(); ctx.moveTo(x + 14, y + 56); ctx.quadraticCurveTo(x + 31, y + 38, x + 48, y + 56); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d9b48f'; ctx.beginPath(); ctx.arc(x + 31, y + 30, 10.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b2118'; ctx.beginPath(); ctx.arc(x + 30, y + 26.5, 10.8, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
  ctx.fillRect(x + 20.5, y + 19, 3.4, 10);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,214,170,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x + 6, y + 6, 50, 50, 6); ctx.stroke();
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillStyle = '#f0d9a0'; ctx.font = '700 11px system-ui, sans-serif';
  ctx.fillText('DARIO VENN', x + 66, y + 8);
  ctx.fillStyle = PALETTE.hudText; ctx.font = '600 11px system-ui, sans-serif';
  const line = game.missions.lastBrief.replace(/^Dario Venn:\s*/, '');
  const words = line.split(' ');
  const lines = [''];
  for (const wd of words) {
    const cur = lines[lines.length - 1];
    if ((cur + ' ' + wd).trim().length <= 38 || !cur) lines[lines.length - 1] = (cur + ' ' + wd).trim();
    else if (lines.length < 3) lines.push(wd);
    else { lines[2] = lines[2].replace(/…?$/, '') + '…'; break; }
  }
  lines.forEach((l, i) => ctx.fillText(l, x + 66, y + 24 + i * 13));
}
export function drawHud(ctx, game) {
  ctx.save();
  // Money, top-left.
  panel(ctx, 14, 14, 168, 40);
  ctx.fillStyle = PALETTE.money; ctx.font = '700 20px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('$' + Math.floor(game.money).toLocaleString('en-US'), 26, 23);
  drawStars(ctx, game);
  // Mission line, timer, stage pips and NEXT objective, top-centre.
  if (game.missions.active) {
    const text = game.missions.headline();
    const ph = game.missions.phaseInfo ? game.missions.phaseInfo() : { index: 1, total: 1 };
    const nextLine = 'NEXT: ' + (game.missions.nextText ? game.missions.nextText() : text);
    ctx.font = '600 15px system-ui, sans-serif';
    const w = Math.min(600, Math.max(ctx.measureText(text).width + 90, ctx.measureText(nextLine).width + 30));
    panel(ctx, VIEW_W / 2 - w / 2, 14, w, 58);
    ctx.fillStyle = PALETTE.hudText; ctx.textAlign = 'center';
    ctx.fillText(text, VIEW_W / 2 - 18, 21);
    const t = Math.max(0, Math.ceil(game.missions.timeLeft));
    ctx.fillStyle = t <= 15 ? PALETTE.danger : '#f2c14e';
    ctx.font = '700 15px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(t + 's', VIEW_W / 2 + w / 2 - 12, 21);
    // Stage pips: one per real phase of this job, filled up to the current.
    ctx.textAlign = 'left'; ctx.font = '11px system-ui, sans-serif';
    let pips = '';
    for (let i = 0; i < ph.total; i++) pips += i < ph.index ? '●' : '○';
    ctx.fillStyle = '#f2c14e';
    ctx.fillText(pips + '  ' + ph.index + '/' + ph.total, VIEW_W / 2 - w / 2 + 12, 44);
    ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(nextLine, VIEW_W / 2 - w / 2 + 12 + ctx.measureText(pips + '  ' + ph.index + '/' + ph.total).width + 14, 44);
  } else if (game.time > 2) {
    ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(232,230,223,0.75)';
    ctx.fillText('Free roam — visit the yellow marker when a job is offered, or press Enter near Venn jobs', VIEW_W / 2, 20);
  }
  // Grab progress while the take accumulates: the plan's loot target and
  // grab rate against what the crew has actually pulled so far.
  if (game.missions.active && game.missions.stage === 'grab' && game.plan) {
    const st = planStats(game.missions.index, game.plan, game.missions.loop);
    const got = Math.floor(game.missions.lootGrabbed || 0);
    panel(ctx, VIEW_W / 2 - 170, 80, 340, 40);
    ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('GRABBING — ' + st.grabRate + '$/s CREW RATE', VIEW_W / 2 - 158, 87);
    ctx.fillStyle = PALETTE.money; ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(formatMoney(got) + ' / ' + formatMoney(st.loot), VIEW_W / 2 + 158, 86);
    ctx.fillStyle = '#4a3628'; ctx.fillRect(VIEW_W / 2 - 158, 106, 316, 7);
    ctx.fillStyle = '#a8d18b'; ctx.fillRect(VIEW_W / 2 - 158, 106, 316 * clamp(got / Math.max(1, st.loot), 0, 1), 7);
  }
  // (No separate briefing toast: the Dario Venn dialogue card below carries
  // the same live briefing line — showing both duplicated the text.)
  // Toasts (centre-lower, never over the minimap).
  ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center';
  game.toasts.filter((t) => game.nowMs < t.until).slice(-2).forEach((t, i) => {
    const w = Math.min(620, ctx.measureText(t.text).width + 36);
    panel(ctx, VIEW_W / 2 - w / 2, VIEW_H - 148 - i * 40, w, 34);
    ctx.fillStyle = PALETTE.hudText; ctx.fillText(t.text, VIEW_W / 2, VIEW_H - 139 - i * 40);
  });
  // (The old bottom-left HEALTH / vehicle / weapon panels are gone: their
  // real values now live in the minimap stack — thin bars under the map and
  // one compact text line — drawn by drawMinimap below.)
  // GTA free-aim reticle: drawn while on foot in play and the aim predicate
  // holds (bullets in flight or a shot inside the last 700 ms — the same
  // predicate that switches view3d to the over-the-shoulder camera).
  // EXACT reference geometry: two horizontal ticks and one tick below the
  // centre — NO top tick, NO centre dot, NO circle — static, no sway, no
  // pulse, no target highlight (free aim).
  if (game.screen === 'play' && !game.player.inCar
    && ((game.bullets && game.bullets.length > 0) || (game.lastShotAt && game.nowMs - game.lastShotAt < 700))) {
    const cx = VIEW_W * 0.536, cy = VIEW_H * 0.5;
    const reticlePath = () => {
      ctx.beginPath();
      ctx.moveTo(cx - 25, cy); ctx.lineTo(cx - 10, cy);
      ctx.moveTo(cx + 10, cy); ctx.lineTo(cx + 25, cy);
      ctx.moveTo(cx, cy + 10); ctx.lineTo(cx, cy + 23);
    };
    // Dark halo pass first (same geometry, wider): a thin dark outline
    // around the white ticks keeps the aim point findable on any
    // background — the standard GTA reticle treatment.
    ctx.strokeStyle = 'rgba(10,10,12,0.85)'; ctx.lineWidth = 5;
    reticlePath(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 2;
    reticlePath(); ctx.stroke();
  }
  if (game.screen === 'play') { drawDispatch(ctx, game); drawDialogue(ctx, game); }
  // Control hints for the first seconds of play: key caps only, no prose —
  // centred under the mission bar, clear of every bottom-edge cluster.
  if (game.playTime < 9 && game.screen === 'play') {
    ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(232,230,223,0.75)';
    ctx.fillText(game.player.inCar ? '[WASD]  [SPACE]  [E]  [R]  [P]' : '[WASD]  [SHIFT]  [E]  [SPACE]  [P]  [H]', VIEW_W / 2, 88);
  }
  drawMinimap(ctx, game);
  ctx.restore();
}
export function drawMinimap(ctx, game) {
  // GTA-style bottom-left stack (play frames only — drawHud never runs on
  // the Planning Board or the results screen, whose maps stay their own):
  // a RECTANGULAR grey road minimap, a yellow GPS route to the live
  // objective with its REAL distance printed under the map, thin state
  // bars directly beneath the map, and one compact text line under the
  // bars. (The radio line lives bottom-right with dispatch now.) The
  // whole stack keeps roughly the old bottom-left panels' footprint.
  const mapX = 14, mapW = 176, mapH = 104;
  const textY = VIEW_H - 27;   // compact text line row
  const barY = textY - 19;     // first bar top (two 6 px bars, 3 px gap)
  const distY = barY - 15;     // distance row top
  const mapY = distY - mapH - 3;
  const px = game.player.x, py = game.player.y;
  const inCar = !!(game.player.inCar && game.player.car);
  // Radio strip: the real station + track. HUD debt fix — it rides in the
  // bottom-right quadrant with the dispatch panel now, not on top of the
  // minimap stack, so the bottom-left stays map + bars + one text line.
  if (inCar && game.radio) {
    panel(ctx, VIEW_W - 246, VIEW_H - 38, 232, 22);
    ctx.fillStyle = '#9fc9b8'; ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('♪ ' + game.radio.label(), VIEW_W - 234, VIEW_H - 32);
  }
  const scale = mapW / 1500; // the old circular map's 1,500-unit window, kept
  const cx = mapX + mapW / 2, cy = mapY + mapH / 2;
  const clampPt = (wx, wy, inset) => [
    clamp(cx + (wx - px) * scale, mapX + inset, mapX + mapW - inset),
    clamp(cy + (wy - py) * scale, mapY + inset, mapY + mapH - inset),
  ];
  ctx.save();
  ctx.beginPath(); ctx.rect(mapX, mapY, mapW, mapH); ctx.clip();
  ctx.fillStyle = '#7e8287'; ctx.fillRect(mapX, mapY, mapW, mapH); // grey land
  ctx.fillStyle = 'rgba(96,128,78,0.55)'; // parks, muted green
  for (const pk of game.city.parks) {
    const [x0, y0] = [cx + (pk.x - px) * scale, cy + (pk.y - py) * scale];
    ctx.fillRect(x0, y0, pk.w * scale, pk.h * scale);
  }
  // The sea at the world's east edge, when the window reaches it.
  const seaX = cx + (WORLD_SIZE - px) * scale;
  if (seaX < mapX + mapW) { ctx.fillStyle = 'rgba(61,143,163,0.75)'; ctx.fillRect(Math.max(mapX, seaX), mapY, mapW, mapH); }
  // White road lines from the same street-grid data the old map drew:
  // every road centre in the window, at true road width.
  ctx.fillStyle = '#e9e9e4';
  const rw = Math.max(3, ROAD_W * scale);
  for (const rc of roadCenters()) {
    const vx = cx + (rc - px) * scale;
    if (vx + rw / 2 > mapX && vx - rw / 2 < mapX + mapW) ctx.fillRect(vx - rw / 2, mapY, rw, mapH);
    const hy = cy + (rc - py) * scale;
    if (hy + rw / 2 > mapY && hy - rw / 2 < mapY + mapH) ctx.fillRect(mapX, hy - rw / 2, mapW, rw);
  }
  const marker = game.missions.marker ? game.missions.marker() : null;
  // GPS route: a yellow polyline along the road grid from the player to
  // the objective — out to the nearest road, across to the objective's
  // road, then straight to the marker.
  if (marker) {
    const gx = nearestRoadCenter(marker.x), gy = nearestRoadCenter(py);
    const pts = [[px, py], [px, gy], [gx, gy], [gx, marker.y], [marker.x, marker.y]]
      .map(([wx, wy]) => [cx + (wx - px) * scale, cy + (wy - py) * scale]);
    ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  // Search zone: while SEARCHING, a ring around the last sighting position
  // (the spot the sim's decay logic is actually counting from).
  if (game.police.stars > 0 && game.police.wantedState && game.police.wantedState(game.player) === 'SEARCHING') {
    const [sx, sy] = clampPt(game.police.lastSeenX, game.police.lastSeenY, 10);
    ctx.strokeStyle = 'rgba(242,193,78,0.9)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.stroke();
  }
  for (const cop of game.police.cops) {
    if (cop.dead) continue;
    const [dx, dy] = clampPt(cop.x, cop.y, 5);
    ctx.fillStyle = Math.sin(game.time * 8) > 0 ? '#ff5040' : '#4f8ef7';
    ctx.beginPath(); ctx.arc(dx, dy, 3, 0, Math.PI * 2); ctx.fill();
  }
  // Objective icon: a small diamond in the marker's own colour.
  if (marker) {
    const [ox, oy] = clampPt(marker.x, marker.y, 8);
    ctx.beginPath(); ctx.moveTo(ox, oy - 5.5); ctx.lineTo(ox + 5.5, oy); ctx.lineTo(ox, oy + 5.5); ctx.lineTo(ox - 5.5, oy); ctx.closePath();
    ctx.fillStyle = marker.color === 'pickup' ? '#e8c832' : '#4fc96a'; ctx.fill();
    ctx.strokeStyle = 'rgba(20,18,14,0.8)'; ctx.lineWidth = 1; ctx.stroke();
  }
  // Player arrow at the centre, white with a dark edge so it reads on the
  // pale roads.
  ctx.translate(cx, cy); ctx.rotate(inCar ? game.player.car.angle : game.player.angle);
  ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -4.4); ctx.lineTo(-5, 4.4); ctx.closePath();
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.strokeStyle = 'rgba(20,20,22,0.7)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(18,16,14,0.9)'; ctx.lineWidth = 2;
  ctx.strokeRect(mapX, mapY, mapW, mapH);
  ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(18,16,14,0.55)'; ctx.fillText('N', mapX + mapW - 4, mapY + 4);
  ctx.fillStyle = '#ffffff'; ctx.fillText('N', mapX + mapW - 5, mapY + 3);
  // Distance under the map: the REAL sim distance to the objective. The
  // world runs ≈8.6 units per metre (view3d's scale contract), so short
  // hops print in metres and long ones in miles — never a fixed number.
  ctx.textAlign = 'left';
  if (marker) {
    const metres = Math.hypot(marker.x - px, marker.y - py) / 8.6;
    const distText = metres >= 1000 ? (metres / 1609.34).toFixed(2) + 'mi' : Math.round(metres) + 'm';
    ctx.fillStyle = PALETTE.hudText; ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText(distText, mapX + 2, distY);
    ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText('· ' + (marker.label || '').toUpperCase(), mapX + 4 + ctx.measureText(distText).width + 2, distY + 2);
  }
  // Thin bars directly beneath the map, from REAL state only: green is
  // health; blue is vehicle integrity while driving, or the carried
  // weapon's magazine on foot. (No yellow bar: the sim holds no fractional
  // heat-progress value — police.stars is an integer level and the plan's
  // fractional heat is a board forecast, not live progress — so no bar is
  // drawn rather than inventing one.)
  // HUD debt fix: the health bar carries its HEALTH label in the stack —
  // a small label column on the left, both bars indented to match.
  ctx.fillStyle = PALETTE.hudMuted; ctx.font = '700 9px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('HEALTH', mapX + 2, barY - 1);
  const barX = mapX + 46, barW = mapW - 46;
  const bar = (y, frac, col) => {
    ctx.fillStyle = 'rgba(16,13,11,0.55)'; ctx.fillRect(barX, y, barW, 6);
    ctx.fillStyle = col; ctx.fillRect(barX, y, barW * clamp(frac, 0, 1), 6);
  };
  bar(barY, game.player.hp / 100, game.player.hp > 30 ? '#63b06a' : PALETTE.danger);
  if (inCar) bar(barY + 9, game.player.car.hp / game.player.car.maxHp, '#5f88c4');
  else if (game.weapon && game.weapon.magSize) bar(barY + 9, game.weapon.mag / game.weapon.magSize, '#5f88c4');
  // Compact text line under the bars: vehicle name + integrity % + speed
  // while driving; the carried weapon and its real count on foot.
  ctx.textBaseline = 'top';
  if (inCar) {
    const car = game.player.car;
    const cond = Math.max(0, Math.round((car.hp / car.maxHp) * 100));
    ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(car.name || 'VEHICLE', mapX + 2, textY + 2);
    ctx.fillStyle = PALETTE.hudText; ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(cond + '% · ' + Math.round(Math.abs(car.speed) * 0.62) + ' km/h', mapX + mapW - 2, textY + 2);
  } else if (game.weapon && game.screen === 'play') {
    ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(game.weapon.name, mapX + 2, textY + 2);
    ctx.fillStyle = PALETTE.hudText; ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(game.weapon.mag + ' / ' + game.weapon.reserve, mapX + mapW - 2, textY + 2);
  }
}

// The board's district map: Vice City cartography pattern (pastel land,
// teal ocean, pale beach band, light road network) drawn over OUR OWN city
// geography — the real road grid, the job's target, and the escape route
// from target to delivery as a dashed amber line. Airport + base marked.
export function drawDistrictMap(ctx, game, x, y, w, h) {
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.clip();
  ctx.fillStyle = '#3d8fa3'; ctx.fillRect(x, y, w, h); // teal ocean field
  const sx = (wx) => x + (wx / WORLD_SIZE) * w, sy = (wy) => y + (wy / WORLD_SIZE) * h;
  ctx.fillStyle = '#e9dcbc'; ctx.fillRect(x, y, w * 0.985, h); // pastel land
  const tints = ['#eed9b8', '#e6d3ae', '#f0dcbc', '#eadfc0'];
  for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) {
    ctx.fillStyle = tints[(bx + by * 3) % 4];
    ctx.fillRect(sx(bx * BLOCK_PITCH + ROAD_W), sy(by * BLOCK_PITCH + ROAD_W), (BLOCK_PITCH - ROAD_W) / WORLD_SIZE * w, (BLOCK_PITCH - ROAD_W) / WORLD_SIZE * h);
  }
  ctx.fillStyle = '#a9c795';
  for (const pk of game.city.parks) ctx.fillRect(sx(pk.x), sy(pk.y), pk.w / WORLD_SIZE * w, pk.h / WORLD_SIZE * h);
  if (game.city.sites) for (const st of game.city.sites) {
    ctx.fillStyle = st.kind === 'airport' ? '#b9b4a6' : '#a8a894';
    ctx.fillRect(sx(st.x), sy(st.y), st.w / WORLD_SIZE * w, st.h / WORLD_SIZE * h);
    if (st.kind === 'airport') { ctx.fillStyle = '#5c5c60'; ctx.fillRect(sx(st.x), sy(st.y + st.h / 2 - 14), st.w / WORLD_SIZE * w, 28 / WORLD_SIZE * h); }
  }
  ctx.strokeStyle = '#fdf6e0'; ctx.lineWidth = 1.4;
  for (let k = 0; k <= 8; k++) {
    const rxp = sx(k === 8 ? WORLD_SIZE - ROAD_W / 2 : k * BLOCK_PITCH + ROAD_W / 2);
    ctx.beginPath(); ctx.moveTo(rxp, y); ctx.lineTo(rxp, y + h); ctx.stroke();
    const ryp = sy(k === 8 ? WORLD_SIZE - ROAD_W / 2 : k * BLOCK_PITCH + ROAD_W / 2);
    ctx.beginPath(); ctx.moveTo(x, ryp); ctx.lineTo(x + w, ryp); ctx.stroke();
  }
  ctx.fillStyle = '#f4e3ae'; ctx.fillRect(x + w * 0.985 - 3, y, 3, h); // beach band
  // Escape route: target (pickup) -> delivery, dashed amber over the grid.
  const def = CHAIN[game.missions.index % CHAIN.length];
  const from = def.pickup || def.deliver, to = def.deliver || def.pickup;
  if (from && to) {
    ctx.strokeStyle = '#e8930c'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(sx(from.x), sy(from.y)); ctx.lineTo(sx(to.x), sy(to.y)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#e8c832'; ctx.beginPath(); ctx.arc(sx(from.x), sy(from.y), 4.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7a5c10'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = '#4fc96a'; ctx.beginPath(); ctx.arc(sx(to.x), sy(to.y), 4.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1d5c2e'; ctx.stroke();
  }
  ctx.fillStyle = 'rgba(38,30,18,0.85)'; ctx.font = '700 8.5px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('AMBER FIELD', sx(2912) + 2, sy(2912) + 2);
  ctx.fillText('FORT SABLE', sx(562) + 2, sy(2912) + 2);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,214,170,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.stroke();
}
// ------------------------------------------------------------ weapon wheel
// GTA-style radial selection: a TRANSIENT overlay while open — seven class
// segments with their counts around a hub that shows the highlighted
// weapon's real table stats. The world stays visible around it. Placement
// is a parameter: live play uses the centred full-size wheel (the default);
// the Planning Board carries the same wheel as a smaller inset over its
// street corridor, so the arsenal proof lives on the board frame and the
// mission frame can stay a live firefight (final-fix composition choice).
export function drawWeaponWheel(ctx, game, cx = VIEW_W / 2, cy = VIEW_H / 2, R = 196) {
  const k = R / 196, r0 = 74 * k;
  ctx.save();
  if (R >= 190) { ctx.fillStyle = 'rgba(16,8,8,0.30)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
  else { ctx.beginPath(); ctx.arc(cx, cy, R + 12, 0, Math.PI * 2); ctx.fillStyle = 'rgba(12,6,6,0.38)'; ctx.fill(); }
  const selCls = WEAPON_CLASSES[game.wheelClass || 0];
  WEAPON_CLASSES.forEach((cls, i) => {
    const a0 = -Math.PI / 2 + (i / WEAPON_CLASSES.length) * Math.PI * 2 + 0.03;
    const a1 = -Math.PI / 2 + ((i + 1) / WEAPON_CLASSES.length) * Math.PI * 2 - 0.03;
    const sel = cls.id === selCls.id;
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0, a1); ctx.arc(cx, cy, r0, a1, a0, true); ctx.closePath();
    ctx.fillStyle = sel ? 'rgba(242,193,78,0.88)' : 'rgba(26,16,14,0.82)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,170,0.5)'; ctx.lineWidth = 1.4; ctx.stroke();
    const am = (a0 + a1) / 2, lx = cx + Math.cos(am) * (R + r0) / 2, ly = cy + Math.sin(am) * (R + r0) / 2;
    ctx.fillStyle = sel ? '#2a1a08' : PALETTE.hudText; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 ' + (12 * k).toFixed(1) + 'px system-ui, sans-serif';
    const short = { AR: 'AR', SMG: 'SMG', MG: 'MG', SG: 'SG', SR: 'SR', RL: 'RL', EXP: 'EXP' }[cls.id];
    ctx.fillText(short + ' · ' + weaponsByClass(cls.id).length, lx, ly - 8 * k);
    ctx.font = '600 ' + (8.5 * k).toFixed(1) + 'px system-ui, sans-serif'; ctx.fillStyle = sel ? '#4a3410' : PALETTE.hudMuted;
    ctx.fillText(cls.label, lx, ly + 7 * k);
  });
  // Hub: the highlighted weapon and its real stats.
  const list = weaponsByClass(selCls.id);
  const def = list[(game.wheelIndex || 0) % list.length];
  ctx.beginPath(); ctx.arc(cx, cy, r0 - 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(22,12,10,0.92)'; ctx.fill();
  ctx.strokeStyle = 'rgba(242,193,78,0.7)'; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f2c14e'; ctx.font = '700 ' + (13 * k).toFixed(1) + 'px system-ui, sans-serif';
  ctx.fillText(def.name, cx, cy - 26 * k);
  ctx.fillStyle = PALETTE.hudText; ctx.font = '600 ' + (10.5 * k).toFixed(1) + 'px system-ui, sans-serif';
  ctx.fillText('DMG ' + def.damage + ' · ROF ' + def.rps + '/s', cx, cy - 8 * k);
  ctx.fillText('RNG ' + def.range + ' · MAG ' + def.mag + (def.behavior ? ' · ' + def.behavior.toUpperCase() : ''), cx, cy + 7 * k);
  ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 ' + (9.5 * k).toFixed(1) + 'px system-ui, sans-serif';
  ctx.fillText(((game.wheelIndex || 0) + 1) + ' / ' + list.length + ' · ▲▼ · ◀▶', cx, cy + 24 * k);
  ctx.fillStyle = '#f2c14e'; ctx.font = '700 ' + (11 * k).toFixed(1) + 'px system-ui, sans-serif';
  ctx.fillText('WEAPON WHEEL — Q / ENTER equips', cx, cy + R + 22 * k);
  ctx.restore();
}

export function drawTitle(ctx, game) {
  ctx.fillStyle = 'rgba(30,12,10,0.26)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
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
  ctx.fillText('Shift — sprint      P — pause      H — help      R — radio', VIEW_W / 2, 428);
  ctx.fillStyle = '#f2c14e'; ctx.font = '700 19px system-ui, sans-serif';
  ctx.fillText('Press ENTER to start', VIEW_W / 2, 486);
  ctx.fillStyle = PALETTE.hudMuted; ctx.font = '14px system-ui, sans-serif';
  const s = game.saveData;
  ctx.fillText(s.missionsCompleted > 0 ? `Saved progress: $${Math.floor(s.money)} · ${s.missionsCompleted} jobs done · $${Math.floor(s.totalEarned)} earned` : 'No saved progress yet — your first sunset on the Amber Coast.', VIEW_W / 2, 524);
}
// ---------------------------------------------------------------- planning
// The Planning Board: a layer over the live 3D street (the renderer orbits
// the job's target block behind it), in the amber identity — compact muted
// panels, no wall of boxes. Every figure on it is planStats() output, the
// same numbers the execution consumes, recomputed on every change.
function wrapText(ctx, text, maxChars) {
  const words = text.split(' '); const lines = [''];
  for (const wd of words) {
    const cur = lines[lines.length - 1];
    if ((cur + ' ' + wd).trim().length <= maxChars || !cur) lines[lines.length - 1] = (cur + ' ' + wd).trim();
    else lines.push(wd);
  }
  return lines;
}
export function drawPlanning(ctx, game) {
  const plan = game.plan;
  if (!plan) return;
  const idx = game.missions.index % CHAIN.length;
  const def = CHAIN[idx];
  const data = jobPlanData(idx);
  const st = planStats(idx, plan, game.missions.loop);
  ctx.save();
  ctx.textBaseline = 'top';
  // Top strip: what is being planned + the chain's five tabs.
  panelSolid(ctx, 14, 14, VIEW_W - 28, 40);
  ctx.textAlign = 'left'; ctx.fillStyle = '#f2c14e'; ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillText('PLANNING — JOB ' + (idx + 1) + '/5 · ' + def.title.toUpperCase(), 26, 26);
  ctx.textAlign = 'right'; ctx.font = '600 11px system-ui, sans-serif';
  let tabX = VIEW_W - 26;
  for (let i = CHAIN.length - 1; i >= 0; i--) {
    const label = (i < idx ? '✓ ' : i === idx ? '▸ ' : '· ') + CHAIN[i].title.toUpperCase();
    const w = ctx.measureText(label).width;
    ctx.fillStyle = i === idx ? '#f2c14e' : i < idx ? '#8fc97f' : PALETTE.hudMuted;
    ctx.fillText(label, tabX, 28); tabX -= w + 18;
  }
  // Left column: briefing, entry, getaway, time.
  const lx = 14, lw = 330;
  panelSolid(ctx, lx, 66, lw, 436);
  let y = 80;
  ctx.textAlign = 'left'; ctx.fillStyle = '#f0d9a0'; ctx.font = '700 11px system-ui, sans-serif';
  ctx.fillText('BRIEFING — DARIO VENN', lx + 14, y); y += 18;
  ctx.fillStyle = PALETTE.hudText; ctx.font = '600 12px system-ui, sans-serif';
  for (const line of wrapText(ctx, def.brief.replace(/^Dario Venn:\s*/, ''), 44)) { ctx.fillText(line, lx + 14, y); y += 16; }
  y += 12;
  ctx.fillStyle = '#f0d9a0'; ctx.font = '700 11px system-ui, sans-serif';
  ctx.fillText('ENTRY — ◀ ▶', lx + 14, y); y += 18;
  const entryTags = ['STANDARD', 'QUIET · ALARM +4s', 'BOLD · HEAT +'];
  data.entries.forEach((name, i) => {
    if (i === plan.entry) { ctx.fillStyle = 'rgba(242,193,78,0.16)'; ctx.fillRect(lx + 8, y - 3, lw - 16, 24); ctx.fillStyle = '#f2c14e'; ctx.fillRect(lx + 8, y - 3, 3, 24); }
    ctx.fillStyle = i === plan.entry ? PALETTE.hudText : PALETTE.hudMuted; ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText((i === plan.entry ? '▸ ' : '  ') + name, lx + 14, y);
    ctx.textAlign = 'right'; ctx.font = '600 10px system-ui, sans-serif'; ctx.fillStyle = PALETTE.hudMuted;
    ctx.fillText(entryTags[i], lx + lw - 14, y + 1); ctx.textAlign = 'left';
    y += 26;
  });
  y += 8;
  ctx.fillStyle = '#f0d9a0'; ctx.font = '700 11px system-ui, sans-serif';
  ctx.fillText('GETAWAY — G', lx + 14, y); y += 18;
  const gw = GETAWAYS.find((g) => g.id === plan.getaway) || GETAWAYS[0];
  ctx.fillStyle = PALETTE.hudText; ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillText(gw.name, lx + 14, y);
  ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText('top ' + gw.topSpeed + ' · escape window ' + st.escape + ' s', lx + 14, y + 19); y += 48;
  ctx.fillStyle = '#f0d9a0'; ctx.font = '700 11px system-ui, sans-serif';
  ctx.fillText('TIME — T', lx + 14, y); y += 18;
  TIMES.forEach((t) => {
    if (t.id === plan.timeOfDay) { ctx.fillStyle = 'rgba(242,193,78,0.16)'; ctx.fillRect(lx + 8, y - 3, lw - 16, 24); }
    ctx.fillStyle = t.id === plan.timeOfDay ? PALETTE.hudText : PALETTE.hudMuted; ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText((t.id === plan.timeOfDay ? '▸ ' : '  ') + t.label, lx + 14, y); y += 26;
  });
  // Right column: the live plan stats.
  const rx = VIEW_W - 284, rw = 270;
  panelSolid(ctx, rx, 66, rw, 296);
  y = 80;
  ctx.fillStyle = '#f0d9a0'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('PLAN STATS — LIVE', rx + 14, y); y += 24;
  const statRows = [
    ['LOOT ESTIMATE', formatMoney(st.loot)],
    ['ALARM', st.alarm + ' s'],
    ['ESCAPE WINDOW', st.escape + ' s'],
    ['GRAB RATE', '$' + st.grabRate + '/s'],
    ['CREW CUT', st.totalCut + '%'],
    ['CREW SKILL', String(st.avgSkill)],
    ['FENCE FEE', st.fencePct + '%'],
  ];
  for (const [k, v] of statRows) {
    ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(k, rx + 14, y + 2);
    ctx.fillStyle = PALETTE.hudText; ctx.font = '700 14px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(v, rx + rw - 14, y); y += 25;
  }
  ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('HEAT FORECAST', rx + 14, y + 2);
  ctx.font = '16px sans-serif'; ctx.textAlign = 'right';
  let stars = '';
  for (let i = 0; i < 5; i++) stars += i < st.heatStars ? '★' : '☆';
  ctx.fillStyle = '#f2c14e'; ctx.fillText(stars, rx + rw - 14, y);
  // District map (VC-style cartography, our geography) under the stats.
  panelSolid(ctx, rx, 374, rw, 180);
  ctx.fillStyle = '#f0d9a0'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('DISTRICT MAP — TARGET + ESCAPE ROUTE', rx + 14, 386);
  drawDistrictMap(ctx, game, rx + 12, 406, rw - 24, 136);
  // Arsenal strip: the mission weapon picked from the full 56-weapon table.
  panelSolid(ctx, rx, 566, rw, 62);
  const wdef = weaponById(plan.weaponId || 'venn-9mm');
  ctx.fillStyle = '#f0d9a0'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('ARSENAL — J / K · 56 WEAPONS', rx + 14, 576);
  ctx.fillStyle = PALETTE.hudText; ctx.font = '700 13.5px system-ui, sans-serif';
  ctx.fillText(wdef.name, rx + 14, 594);
  ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 10.5px system-ui, sans-serif'; ctx.textAlign = 'right';
  ctx.fillText('DMG ' + wdef.damage + ' · MAG ' + (plan.gear.includes('extmag') && wdef.cls !== 'EXP' && wdef.cls !== 'RL' ? Math.round(wdef.mag * 1.5) : wdef.mag), rx + rw - 14, 596);
  ctx.textAlign = 'left';
  // Bottom centre: crew and gear over their slots.
  const bx = 356, bw = 568;
  panelSolid(ctx, bx, 640, bw, 146);
  y = 652;
  ctx.textAlign = 'left'; ctx.fillStyle = '#f0d9a0'; ctx.font = '700 11px system-ui, sans-serif';
  ctx.fillText('CREW — 1-6 · ' + plan.crew.length + '/3', bx + 14, y); y += 18;
  CREW_POOL.forEach((c, i) => {
    const cxp = bx + 14 + (i % 3) * 182, cyp = y + Math.floor(i / 3) * 26;
    const sel = plan.crew.includes(c.id);
    if (sel) { ctx.fillStyle = 'rgba(242,193,78,0.14)'; ctx.fillRect(cxp - 4, cyp - 2, 176, 22); }
    ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(cxp + 5, cyp + 8, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = sel ? PALETTE.hudText : PALETTE.hudMuted; ctx.font = '600 10.5px system-ui, sans-serif';
    ctx.fillText((i + 1) + ' ' + c.name, cxp + 14, cyp);
    ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 9.5px system-ui, sans-serif';
    ctx.fillText('SK ' + c.skill + ' · CUT ' + c.cut + '%', cxp + 14, cyp + 11);
  });
  y += 58;
  ctx.fillStyle = '#f0d9a0'; ctx.font = '700 11px system-ui, sans-serif';
  ctx.fillText('GEAR — F + SPACE · ' + plan.gear.length + '/3 SLOTS', bx + 14, y); y += 18;
  GEAR_POOL.forEach((g, i) => {
    const cxp = bx + 14 + (i % 4) * 138, cyp = y + Math.floor(i / 4) * 20;
    const sel = plan.gear.includes(g.id);
    const foc = (game.gearFocus || 0) === i;
    if (sel) { ctx.fillStyle = 'rgba(143,201,127,0.16)'; ctx.fillRect(cxp - 4, cyp - 2, 132, 17); }
    if (foc) { ctx.strokeStyle = 'rgba(245,234,216,0.8)'; ctx.lineWidth = 1; ctx.strokeRect(cxp - 4, cyp - 2, 132, 17); }
    ctx.fillStyle = sel ? PALETTE.hudText : PALETTE.hudMuted; ctx.font = '600 9.5px system-ui, sans-serif';
    ctx.fillText(g.name, cxp, cyp + 1);
  });
  // Execute corner.
  panelSolid(ctx, VIEW_W - 284, 640, 270, 62);
  ctx.fillStyle = '#f2c14e'; ctx.font = '700 15px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('ENTER — EXECUTE PLAN', VIEW_W - 270, 652);
  ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 10.5px system-ui, sans-serif';
  const entryName = data.entries[plan.entry];
  ctx.fillText(entryName + ' · ' + gw.name + ' · ' + (TIMES.find((t) => t.id === plan.timeOfDay) || TIMES[0]).label, VIEW_W - 270, 674);
  ctx.restore();
  // The wheel as the board's inset (staged captures open it here): the full
  // 7-segment arsenal proof — counts 10/10/5/7/8/6/10, the plan's launcher
  // highlighted, hub stats — over the street corridor, clear of every panel,
  // so the mission frame never has to spend itself on a menu again.
  if (game.wheelOpen) drawWeaponWheel(ctx, game, 676, 338, 158);
}
export function drawSummary(ctx, game) {
  const s = game.lastSummary || {
    jobs: game.jobsThisChain || 0, chainEarned: Math.floor(game.chainEarned || 0),
    money: Math.floor(game.money), totalEarned: Math.floor(game.totalEarned),
    chains: game.chainsFinished || 0, bestEscapeMs: game.bestEscapeMs || 0,
    carsStolen: game.carsStolen || 0, timesWasted: game.timesWasted || 0,
  };
  ctx.save();
  ctx.fillStyle = 'rgba(30,12,10,0.30)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const jobRows = (s.jobRows && s.jobRows.length) ? s.jobRows : [];
  const PH = jobRows.length ? 668 : 520;
  const px = VIEW_W / 2 - 310, py = VIEW_H / 2 - PH / 2;
  // Backing raised to near-opaque (final-fix): at 0.52 the backdrop hero
  // car's silhouette — dark body + red tail strip — ghosted through the
  // ledger's centre rows. 0.95 under the panel's own 0.66 leaves ~1% of
  // the backdrop, under the pixel-check threshold (verified in-browser).
  ctx.fillStyle = 'rgba(14,6,6,0.95)'; ctx.beginPath(); ctx.roundRect(px, py, 620, PH, 8); ctx.fill();
  panel(ctx, px, py, 620, PH);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f28bb4'; ctx.font = '700 11px system-ui, sans-serif';
  ctx.fillText('A M B E R   C O A S T — CHAIN COMPLETE', VIEW_W / 2, py + 12);
  // MISSION PASSED — the San Andreas results pattern, rendered originally:
  // oversized condensed bold lettering (our own canvas type, horizontally
  // squeezed), a RESPECT + line and the cash reward, over the full ledger.
  const led0 = s.lastLedger;
  ctx.save();
  ctx.translate(VIEW_W / 2, py + 96); ctx.scale(0.60, 1);
  ctx.font = '900 82px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 5;
  ctx.fillStyle = '#f5f2ea';
  ctx.fillText('MISSION PASSED', 0, 0);
  ctx.restore();
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#f2c14e'; ctx.font = '700 21px system-ui, sans-serif';
  ctx.fillText('RESPECT +', VIEW_W / 2, py + 128);
  ctx.fillStyle = PALETTE.money; ctx.font = '700 19px system-ui, sans-serif';
  ctx.fillText((led0 ? '+' + formatMoney(led0.net) : '') + '   ·   REP +' + (led0 ? led0.repGain : 0), VIEW_W / 2, py + 154);
  ctx.fillStyle = PALETTE.hudText; ctx.font = '13.5px system-ui, sans-serif';
  ctx.fillText('Dario Venn — all five jobs delivered. Full ledger below.', VIEW_W / 2, py + 180);
  let statsY = py + 208;
  // THE LEDGER for the chain's last job: gross, the fence's fee, each named
  // crew member's cut, the net banked and the REP earned — every line is
  // the previous line's arithmetic, so the column reconciles exactly.
  const led = s.lastLedger;
  if (led) {
    ctx.fillStyle = '#f0d9a0'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('LEDGER — ' + led.title.toUpperCase() + ' (LAST JOB)', px + 36, statsY);
    const lrows = [['GROSS TAKE', formatMoney(led.gross)], ['FENCE FEE ' + led.fencePct + '%', '−' + formatMoney(led.fence)]];
    for (const c of led.cuts) lrows.push([c.name + ' CUT ' + c.pct + '%', '−' + formatMoney(c.amount)]);
    lrows.push(['NET BANKED', '+' + formatMoney(led.net)]);
    lrows.push(['REP GAIN', '+' + led.repGain + ' REP']);
    lrows.forEach((row, i) => {
      const y = statsY + 19 + i * 19;
      const isNet = row[0] === 'NET BANKED';
      ctx.fillStyle = isNet ? PALETTE.hudText : PALETTE.hudMuted; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(row[0], px + 36, y);
      ctx.fillStyle = isNet ? PALETTE.money : PALETTE.hudText; ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(row[1], px + 620 - 36, y);
    });
    statsY += 19 + lrows.length * 19 + 10;
  }
  // Chain history: every job's net, in order — the chain total below is
  // these five numbers added up.
  if (jobRows.length) {
    ctx.fillStyle = '#f0d9a0'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('CHAIN HISTORY — NET PER JOB', px + 36, statsY);
    jobRows.forEach((jr, i) => {
      const y = statsY + 19 + i * 18;
      ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 11.5px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText((i + 1) + '. ' + jr.title, px + 36, y);
      ctx.fillStyle = PALETTE.money; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('+' + formatMoney(jr.pay), px + 620 - 36, y);
    });
    statsY += 19 + jobRows.length * 18 + 10;
  }
  const esc = s.bestEscapeMs > 0
    ? `${Math.floor(s.bestEscapeMs / 60000)}:${String(Math.floor((s.bestEscapeMs % 60000) / 1000)).padStart(2, '0')}`
    : '—';
  const rows = [
    ['CHAIN NET', formatMoney(s.chainEarned)],
    ['CASH', formatMoney(s.money)],
    ['REP (CHAIN)', '+' + (s.repTotal || 0)],
    ['BEST ESCAPE', esc],
    ['CARS STOLEN', String(s.carsStolen)],
    ['CHAINS FINISHED', String(s.chains)],
  ];
  rows.forEach((row, i) => {
    const y = statsY + i * 24;
    ctx.fillStyle = PALETTE.hudMuted; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(row[0], px + 36, y + 3);
    ctx.fillStyle = PALETTE.hudText; ctx.font = '700 14px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(row[1], px + 620 - 36, y);
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2c14e'; ctx.font = '15px system-ui, sans-serif';
  ctx.fillText('The chain restarts at +25% pay per loop — press ENTER to keep driving', VIEW_W / 2, py + PH - 30);
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
    'Shift — sprint · P — pause · H — help · R — radio station/track',
    'Yellow marker: pickup · Green marker: deliver',
    'Stars fade when you break line of sight and stay clean.',
  ];
  lines.forEach((l, i) => ctx.fillText(l, VIEW_W / 2, 322 + i * 28));
  ctx.fillStyle = '#f2c14e'; ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText('Press P to resume', VIEW_W / 2, 322 + lines.length * 28 + 12);
}
