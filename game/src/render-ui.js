// render-ui.js — full-screen UI: title, planning board, results, pause, help.
// The planning board draws the district map with the escape route and the
// live plan stats; every control is a labelled hit-rect returned to main.js.
import { HEISTS, CREW_POOL, GEAR_POOL, GETAWAY_CHOICES } from './heists.js';
import { formatMoney } from './economy.js';
import { FIXER, INTRO_LINES, NEXT_TEASER, RESULT_QUIPS, repTitle } from './story.js';
import { CAR_CLASSES } from './vehicles.js';
import { WORLD_W, WORLD_H } from './config.js';

function panel(ctx, x, y, w, h, title, accent = '#ffd60a') {
  ctx.fillStyle = 'rgba(11,14,24,0.94)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
  if (title) {
    ctx.fillStyle = accent; ctx.font = '900 19px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(title, x + 16, y + 24);
  }
}
function btn(ctx, rects, id, x, y, w, h, label, opts = {}) {
  ctx.fillStyle = opts.active ? '#ffd60a' : opts.disabled ? 'rgba(60,64,78,0.9)' : 'rgba(28,34,52,0.95)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = opts.active ? '#fff' : '#5b6478'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = opts.active ? '#14161c' : opts.disabled ? '#8b93a3' : '#eef1f5';
  ctx.font = `${opts.bold ? 900 : 700} ${opts.size || 15}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
  rects.push({ id, x, y, w, h });
}

export function drawTitle(ctx, W, H, save, time) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#14213d'); grad.addColorStop(0.55, '#7b2d8b'); grad.addColorStop(1, '#e76f51');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  // Skyline silhouettes along the bottom, lit windows inside each tower.
  const heights = [180, 260, 150, 300, 210, 340, 170, 280, 200, 320, 160, 240];
  heights.forEach((hh, i) => {
    const bx = i * 112 - 10, by = H - hh;
    ctx.fillStyle = 'rgba(8,10,20,0.88)';
    ctx.fillRect(bx, by, 96, hh);
    ctx.fillStyle = '#ffd60a';
    for (let wy = by + 16; wy < H - 18; wy += 30) for (let wx = bx + 12; wx < bx + 78; wx += 26) {
      if (((wx * 3 + wy * 7) % 4) !== 0) ctx.fillRect(wx, wy, 11, 8);
    }
  });
  ctx.fillStyle = 'rgba(8,10,20,0.92)'; ctx.fillRect(0, H - 46, W, 46);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd60a'; ctx.font = '900 92px system-ui, sans-serif';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 10;
  ctx.strokeText('THE PLANNER', W / 2, 128); ctx.fillText('THE PLANNER', W / 2, 128);
  ctx.fillStyle = '#ffffff'; ctx.font = '800 24px system-ui, sans-serif';
  ctx.fillText('PLAN THE HEIST. DRIVE THE GETAWAY. OWN THE MILE.', W / 2, 186);
  ctx.font = '600 17px system-ui, sans-serif'; ctx.fillStyle = '#ffe9a8';
  INTRO_LINES.forEach((line, i) => ctx.fillText(line, W / 2, 226 + i * 24));
  // Scope strip.
  ctx.fillStyle = 'rgba(10,12,22,0.9)'; ctx.fillRect(W / 2 - 430, 316, 860, 44);
  ctx.strokeStyle = '#06d6a0'; ctx.strokeRect(W / 2 - 430, 316, 860, 44);
  ctx.fillStyle = '#06d6a0'; ctx.font = '900 20px system-ui, sans-serif';
  ctx.fillText('8 HEISTS · 40+ VEHICLES · 5-STAR HEAT · FULL CAMPAIGN', W / 2, 339);
  const rects = [];
  const bw = 340, bx = W / 2 - bw / 2;
  btn(ctx, rects, 'new', bx, 392, bw, 54, save && save.history.length ? 'NEW CAMPAIGN' : 'NEW GAME', { active: true, size: 20, bold: true });
  btn(ctx, rects, 'continue', bx, 458, bw, 54, 'CONTINUE', { size: 20, bold: true, disabled: !(save && save.history.length) });
  btn(ctx, rects, 'roam', bx, 524, bw, 54, 'FREE ROAM', { size: 20, bold: true });
  // Controls list.
  ctx.fillStyle = 'rgba(10,12,22,0.85)'; ctx.fillRect(W / 2 - 430, 606, 860, 128);
  ctx.fillStyle = '#e9ecef'; ctx.font = '700 16px system-ui, sans-serif'; ctx.textAlign = 'left';
  const controls = [
    'WASD / arrows — move & drive      E — enter / exit car, bribe',
    'Mouse — aim · click — fire        SHIFT — run / handbrake drift',
    '1-4 — gadgets · C — crew orders   B — planning board · P/Esc — pause · H — help',
  ];
  controls.forEach((line, i) => ctx.fillText(line, W / 2 - 400, 636 + i * 28));
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffd60a'; ctx.font = '800 15px system-ui, sans-serif';
  ctx.fillText(save ? `CASH ${formatMoney(save.cash)} · REP ${save.rep} — ${repTitle(save.rep)} · ${save.unlocked}/8 HEISTS OPEN` : '', W / 2, 762);
  void time;
  return rects;
}

export function drawPlanning(ctx, W, H, board, world) {
  const rects = [];
  ctx.fillStyle = '#10131f'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffd60a'; ctx.font = '900 34px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('PLANNING BOARD', 28, 36);
  ctx.fillStyle = '#e9ecef'; ctx.font = '700 16px system-ui, sans-serif';
  ctx.fillText(`${FIXER.name} — ${FIXER.title}`, 30, 66);
  // Heist selector row.
  HEISTS.forEach((h, i) => {
    const locked = i >= board.save.unlocked;
    btn(ctx, rects, 'heist:' + i, 28 + i * 152, 84, 144, 40, locked ? '🔒 ' + (i + 1) : (i + 1) + ' ' + h.name.split(' ')[0], { active: i === board.heistIndex, disabled: locked, size: 12.5 });
  });
  // Briefing.
  panel(ctx, 28, 138, 560, 92, 'BRIEFING', '#4cc9f0');
  ctx.fillStyle = '#e9ecef'; ctx.font = '600 16.5px system-ui, sans-serif'; ctx.textAlign = 'left';
  wrapText(ctx, board.heist.brief, 44, 188, 528, 21);
  ctx.fillStyle = '#ffd60a'; ctx.font = '800 15px system-ui, sans-serif';
  ctx.fillText('Best grade: ' + (board.save.bestGrades[board.heist.id] || '—'), 380, 152);
  // Map panel with escape route.
  panel(ctx, 28, 244, 560, 400, 'DISTRICT MAP — ESCAPE ROUTE', '#06d6a0');
  drawBoardMap(ctx, 44, 286, 528, 330, board, world);
  // Live stats.
  const s = board.stats;
  panel(ctx, 28, 658, 560, 116, 'LIVE PLAN STATS', '#ffd60a');
  ctx.font = '900 19px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillStyle = '#06d6a0'; ctx.fillText(`LOOT ≈ ${formatMoney(s.loot)}`, 44, 706);
  ctx.fillStyle = '#ffd60a'; ctx.fillText(`ALARM ${s.alarm}s`, 300, 706);
  ctx.fillStyle = '#ef476f'; ctx.fillText(`HEAT FORECAST ${'★'.repeat(Math.round(s.heat))}${'☆'.repeat(5 - Math.round(s.heat))}`, 44, 736);
  ctx.fillStyle = '#4cc9f0'; ctx.fillText(`ESCAPE WINDOW ${s.escape}s`, 330, 736);
  ctx.fillStyle = '#e9ecef'; ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillText(`Grab rate $${s.grabRate}/s · crew cut ${s.totalCut}% · crew skill ${s.avgSkill}`, 44, 762);
  // Right column: entry / crew / gear / getaway / time.
  let y = 138;
  panel(ctx, 612, y, 640, 108, 'ENTRY POINT  (E)', '#f72585');
  board.heist.entries.forEach((e, i) => btn(ctx, rects, 'entry:' + i, 628 + i * 202, y + 44, 190, 44, e, { active: board.plan.entry === i, size: 13 }));
  y += 122;
  panel(ctx, 612, y, 640, 150, 'CREW — PICK UP TO 3  (keys 1-6)', '#ffd60a');
  CREW_POOL.forEach((c, i) => {
    const cx = 628 + (i % 3) * 208, cy = y + 40 + Math.floor(i / 3) * 52;
    btn(ctx, rects, 'crew:' + c.id, cx, cy, 196, 44, `${c.name.split(' ')[0]} ${c.role} ${c.skill} · ${c.cut}%`, { active: board.plan.crew.includes(c.id), size: 12 });
  });
  y += 164;
  panel(ctx, 612, y, 640, 150, 'GEAR — 3 SLOTS', '#4cc9f0');
  GEAR_POOL.forEach((g, i) => {
    const cx = 628 + (i % 5) * 124, cy = y + 40 + Math.floor(i / 5) * 52;
    btn(ctx, rects, 'gear:' + g.id, cx, cy, 116, 44, g.name, { active: board.plan.gear.includes(g.id), size: 10.5 });
  });
  const selGear = GEAR_POOL.find((g) => board.plan.gear.includes(g.id));
  ctx.fillStyle = '#9fd8ef'; ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'right';
  if (selGear) ctx.fillText(selGear.desc, 1236, y + 24);
  ctx.textAlign = 'left';
  y += 164;
  panel(ctx, 612, y, 640, 108, 'GETAWAY + TIME  (G / T)', '#06d6a0');
  GETAWAY_CHOICES.forEach((id, i) => {
    const owned = board.save.garage.includes(id);
    btn(ctx, rects, 'getaway:' + id, 628 + i * 104, y + 44, 98, 44, CAR_CLASSES[id].name.split(' ')[1] + (owned ? '' : ' 🔒'), { active: board.plan.getaway === id, disabled: !owned && id !== 'compact', size: 12 });
  });
  ['dawn', 'day', 'dusk', 'night'].forEach((t, i) => btn(ctx, rects, 'time:' + t, 1058 + i * 50, y + 44, 46, 44, t.toUpperCase(), { active: board.plan.timeOfDay === t, size: 10.5 }));
  // Execute / back.
  btn(ctx, rects, 'execute', 612, 694, 400, 62, 'EXECUTE THE PLAN →', { active: true, size: 21, bold: true });
  btn(ctx, rects, 'back', 1028, 694, 224, 62, 'BACK (Esc)', { size: 17 });
  if (board.message) {
    ctx.fillStyle = '#ef476f'; ctx.font = '800 16px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(board.message, W / 2, 676);
  }
  return rects;
}

function drawBoardMap(ctx, x, y, w, h, board, world) {
  const sx = w / WORLD_W, sy = h / WORLD_H;
  ctx.save();
  ctx.fillStyle = '#1c2b3a'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#5b6478'; ctx.lineWidth = 2;
  const AV = [200, 600, 1000, 1400, 1800, 2200, 2600, 3000], ST = [200, 600, 1000, 1400, 1800];
  for (const a of AV) { ctx.beginPath(); ctx.moveTo(x + a * sx, y); ctx.lineTo(x + a * sx, y + h); ctx.stroke(); }
  for (const s of ST) { ctx.beginPath(); ctx.moveTo(x, y + s * sy); ctx.lineTo(x + w, y + s * sy); ctx.stroke(); }
  ctx.fillStyle = '#1e7fb8'; ctx.fillRect(x, y + 2080 * sy, w, h - 2080 * sy);
  const target = world.city.buildings.find((b) => b.kind === board.heist.kind) || world.city.buildings[0];
  const tx = x + (target.x + target.w / 2) * sx, ty = y + (target.y + target.h / 2) * sy;
  const shx = x + world.safehouse.x * sx, shy = y + world.safehouse.y * sy;
  // Escape route: target → nearest avenue → riverwalk → safehouse (L-shaped, dashed gold).
  ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 4; ctx.setLineDash([10, 7]);
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx, y + 1800 * sy); ctx.lineTo(shx, y + 1800 * sy); ctx.lineTo(shx, shy); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ef476f'; ctx.beginPath(); ctx.arc(tx, ty, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '900 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('TARGET', tx, ty - 16);
  ctx.fillStyle = '#2ec4b6'; ctx.beginPath(); ctx.arc(shx, shy, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText('SAFEHOUSE', shx, shy + 22);
  ctx.fillStyle = '#fb8500'; ctx.font = '800 11px system-ui'; ctx.textAlign = 'left';
  ctx.fillText("GARAGES (heat shed): MURPHY'S · TURBO WASH", x + 8, y + h - 10);
  ctx.restore();
}

export function drawResults(ctx, W, H, world) {
  const rects = [];
  const r = world.results;
  ctx.fillStyle = 'rgba(8,10,18,0.92)'; ctx.fillRect(0, 0, W, H);
  panel(ctx, W / 2 - 430, 70, 860, 600, null);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = r.success ? '#06d6a0' : '#ef476f';
  ctx.font = '900 46px system-ui, sans-serif';
  ctx.fillText(r.success ? 'JOB DONE — ' + r.heist.name : (r.kind === 'busted' ? 'BUSTED' : 'WASTED'), W / 2, 118);
  ctx.fillStyle = '#ffd60a'; ctx.font = '900 74px system-ui, sans-serif';
  ctx.fillText('GRADE ' + r.settlement.grade, W / 2, 182);
  ctx.fillStyle = '#e9ecef'; ctx.font = '600 18px system-ui, sans-serif';
  ctx.fillText(RESULT_QUIPS[r.settlement.grade] || RESULT_QUIPS.FAIL, W / 2, 226);
  const rows = [
    ['Gross take', formatMoney(r.loot)],
    [`Fence fee (${r.settlement.fencePct}%)`, '−' + formatMoney(r.settlement.fence)],
    ...r.settlement.cuts.map((c) => [`Crew cut — ${c.name} (${c.pct}%)`, '−' + formatMoney(c.amount)]),
    ['YOUR NET', formatMoney(r.settlement.net)],
    ['REP gained', '+' + r.settlement.repGain],
    ['Time on job', Math.floor(r.seconds / 60) + ':' + String(Math.floor(r.seconds % 60)).padStart(2, '0')],
  ];
  ctx.textAlign = 'left'; ctx.font = '700 19px system-ui, sans-serif';
  rows.forEach((row, i) => {
    const yy = 262 + i * 32;
    ctx.fillStyle = row[0] === 'YOUR NET' ? '#06d6a0' : '#e9ecef';
    ctx.fillText(row[0], W / 2 - 380, yy);
    ctx.textAlign = 'right'; ctx.fillText(row[1], W / 2 + 380, yy); ctx.textAlign = 'left';
  });
  const afterY = 262 + rows.length * 32;
  ctx.fillStyle = '#9fd8ef'; ctx.font = '600 15.5px system-ui, sans-serif';
  ctx.fillText('Heat cools off-screen — garages and bribes shed stars faster next time.', W / 2 - 380, afterY + 4);
  ctx.fillStyle = '#ffd60a'; ctx.font = '800 17px system-ui, sans-serif';
  ctx.fillText(NEXT_TEASER[r.heist.id] || '', W / 2 - 380, afterY + 30);
  // Run history.
  ctx.fillStyle = '#e9ecef'; ctx.font = '900 16px system-ui, sans-serif';
  ctx.fillText('RUN HISTORY', W / 2 - 380, afterY + 62);
  ctx.font = '600 14.5px system-ui, sans-serif'; ctx.fillStyle = '#adb5bd';
  const hist = world.save ? world.save.history.slice(0, 3) : [];
  if (!hist.length) ctx.fillText('No previous runs yet.', W / 2 - 380, afterY + 86);
  hist.forEach((hh, i) => ctx.fillText(`${hh.name} — ${hh.grade} — net ${formatMoney(hh.net)} — ${hh.when}`, W / 2 - 380, afterY + 86 + i * 21));
  btn(ctx, rects, 'board', W / 2 - 320, 690, 300, 52, 'PLANNING BOARD (B)', { active: true, size: 16, bold: true });
  btn(ctx, rects, 'roam', W / 2 + 20, 690, 300, 52, 'FREE ROAM', { size: 16, bold: true });
  return rects;
}

export function drawPause(ctx, W, H, save) {
  const rects = [];
  ctx.fillStyle = 'rgba(6,8,14,0.78)'; ctx.fillRect(0, 0, W, H);
  panel(ctx, W / 2 - 260, 190, 520, 400, null);
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffd60a'; ctx.font = '900 40px system-ui, sans-serif';
  ctx.fillText('PAUSED', W / 2, 240);
  btn(ctx, rects, 'resume', W / 2 - 170, 286, 340, 50, 'RESUME (P)', { active: true, size: 18, bold: true });
  btn(ctx, rects, 'mute', W / 2 - 170, 348, 340, 50, save.settings.mute ? 'SOUND: OFF (M)' : 'SOUND: ON (M)', { size: 16 });
  btn(ctx, rects, 'shake', W / 2 - 170, 410, 340, 50, save.settings.shake ? 'SCREENSHAKE: ON' : 'SCREENSHAKE: OFF', { size: 16 });
  btn(ctx, rects, 'board', W / 2 - 170, 472, 340, 50, 'ABANDON TO BOARD', { size: 16 });
  btn(ctx, rects, 'title', W / 2 - 170, 534, 340, 50, 'QUIT TO TITLE', { size: 16 });
  return rects;
}

export function drawHelp(ctx, W, H) {
  const rects = [];
  ctx.fillStyle = 'rgba(6,8,14,0.9)'; ctx.fillRect(0, 0, W, H);
  panel(ctx, W / 2 - 430, 90, 860, 560, 'FIELD MANUAL', '#4cc9f0');
  ctx.fillStyle = '#e9ecef'; ctx.font = '600 17.5px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const lines = [
    'PLAN: pick a target, entry, up to 3 crew, 3 gear, a getaway you own, and a time of day.',
    'Every choice changes the job: alarm length, grab rate, camera coverage, patrol pressure.',
    '',
    'EXECUTE: reach the entry marker on foot, stand at the vault to grab loot (watch the ring).',
    'The alarm timer and cameras feed your wanted stars. Fill the bag, then ESCAPE.',
    'Escape = lose all stars in the getaway car, or reach the safehouse at 1 star or less.',
    '',
    'GADGETS: 1 CUT POWER (dark + cameras off) · 2 JAM (no new dispatch) · 3 DECOY · 4 SPIKES.',
    'CREW: press C to cycle FOLLOW / WAIT / GRAB. Bags show who is carrying.',
    "HEAT: garages (MURPHY'S, TURBO WASH) shed heat parked inside; $ fixers bribe it away on foot.",
    'BUSTED: two+ police within range while you are slow fills the bust meter. Do not stop.',
    '',
    'FREE ROAM: gold rings = street race · pink ! = taxi fare · blue-marked car = chop delivery.',
  ];
  lines.forEach((line, i) => ctx.fillText(line, W / 2 - 396, 140 + i * 30));
  btn(ctx, rects, 'close', W / 2 - 130, 580, 260, 50, 'CLOSE (H / Esc)', { active: true, size: 16, bold: true });
  return rects;
}

export function drawGameOver(ctx, W, H, world) {
  const rects = [];
  ctx.fillStyle = 'rgba(20,4,10,0.82)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ef476f'; ctx.font = '900 84px system-ui, sans-serif';
  ctx.fillText(world.over === 'busted' ? 'BUSTED' : 'WASTED', W / 2, 320);
  ctx.fillStyle = '#e9ecef'; ctx.font = '700 21px system-ui, sans-serif';
  ctx.fillText(world.over === 'busted' ? 'Precinct 9 thanks you for stopping.' : 'The Mile keeps your loot bag as a souvenir.', W / 2, 380);
  btn(ctx, rects, 'board', W / 2 - 320, 440, 300, 54, 'RE-PLAN (B)', { active: true, size: 17, bold: true });
  btn(ctx, rects, 'roam', W / 2 + 20, 440, 300, 54, 'FREE ROAM', { size: 17, bold: true });
  return rects;
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '', yy = y;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = word; yy += lineH; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}
