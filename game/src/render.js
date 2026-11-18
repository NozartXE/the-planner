// render.js — camera, culled world drawing, the night-lighting pass (darkness, light holes, additive glows) and vignette.
import { VIEW_W, VIEW_H, WORLD_SIZE, BLOCK_PITCH, ROAD_W, CAMERA_ZOOM, PALETTE } from './config.js';
import { isRoadCoord } from './city.js';
import { drawCar } from './cars.js';
import { drawFigure } from './people.js';
import { clamp } from './rng.js';
let lightCanvas = null;
function getLightCanvas() {
  if (lightCanvas) return lightCanvas;
  try {
    lightCanvas = document.createElement('canvas');
    lightCanvas.width = VIEW_W; lightCanvas.height = VIEW_H;
  } catch (e) { lightCanvas = null; }
  return lightCanvas;
}
export function makeCamera() { return { x: 1880, y: 1880, zoom: CAMERA_ZOOM }; }
export function updateCamera(cam, target, vx, vy, dt) {
  const lx = target.x + (vx || 0) * 0.42, ly = target.y + (vy || 0) * 0.42;
  const k = Math.min(1, dt * 5.5);
  cam.x += (lx - cam.x) * k; cam.y += (ly - cam.y) * k;
  const hw = VIEW_W / cam.zoom / 2, hh = VIEW_H / cam.zoom / 2;
  cam.x = clamp(cam.x, hw - 120, WORLD_SIZE - hw + 120);
  cam.y = clamp(cam.y, hh - 120, WORLD_SIZE - hh + 120);
}
function drawWorld(ctx, game, cam) {
  const hw = VIEW_W / cam.zoom / 2, hh = VIEW_H / cam.zoom / 2;
  const x0 = cam.x - hw - 90, x1 = cam.x + hw + 90, y0 = cam.y - hh - 90, y1 = cam.y + hh + 90;
  ctx.fillStyle = PALETTE.ground; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  // Roads: vertical and horizontal strips that cross the view.
  ctx.fillStyle = PALETTE.road;
  for (let wx = Math.floor(x0 / BLOCK_PITCH) * BLOCK_PITCH; wx < x1; wx += 1) {
    if (!isRoadCoord(wx)) continue;
    // draw contiguous strips efficiently by blocks below instead
    break;
  }
  for (let k = -1; k <= 9; k++) {
    const rx = k * BLOCK_PITCH;
    if (rx + ROAD_W >= x0 && rx <= x1) ctx.fillRect(rx, y0, ROAD_W, y1 - y0);
    if (rx >= x0 - ROAD_W && rx <= x1) ctx.fillRect(x0, rx, x1 - x0, ROAD_W);
    const fx = WORLD_SIZE - ROAD_W;
    if (k === 0) { ctx.fillRect(fx, y0, ROAD_W, y1 - y0); ctx.fillRect(x0, fx, x1 - x0, ROAD_W); }
  }
  // Centre dashes.
  ctx.fillStyle = PALETTE.dash;
  for (let k = -1; k <= 9; k++) {
    const cxr = k * BLOCK_PITCH + ROAD_W / 2;
    for (let y = Math.floor(y0 / 44) * 44; y < y1; y += 44) if (cxr >= x0 && cxr <= x1) ctx.fillRect(cxr - 1, y, 2, 22);
    for (let x = Math.floor(x0 / 44) * 44; x < x1; x += 44) if (cxr >= y0 && cxr <= y1) ctx.fillRect(x, cxr - 1, 22, 2);
  }
  const farC = WORLD_SIZE - ROAD_W / 2;
  for (let y = Math.floor(y0 / 44) * 44; y < y1; y += 44) ctx.fillRect(farC - 1, y, 2, 22);
  for (let x = Math.floor(x0 / 44) * 44; x < x1; x += 44) ctx.fillRect(x, farC - 1, 22, 2);
  // Crosswalks at intersections.
  ctx.fillStyle = 'rgba(190,196,204,0.35)';
  const centers = [];
  for (let k = 0; k < 8; k++) centers.push(k * BLOCK_PITCH + ROAD_W / 2);
  centers.push(farC);
  for (const cx of centers) for (const cy of centers) {
    if (cx < x0 - 80 || cx > x1 + 80 || cy < y0 - 80 || cy > y1 + 80) continue;
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(cx - ROAD_W / 2 + 4, cy + i * 9 - 2, 12, 4);
      ctx.fillRect(cx + ROAD_W / 2 - 16, cy + i * 9 - 2, 12, 4);
      ctx.fillRect(cx + i * 9 - 2, cy - ROAD_W / 2 + 4, 4, 12);
      ctx.fillRect(cx + i * 9 - 2, cy + ROAD_W / 2 - 16, 4, 12);
    }
  }
  // Sidewalk rims around blocks.
  ctx.strokeStyle = PALETTE.sidewalk; ctx.lineWidth = 10;
  for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) {
    const bx0 = bx * BLOCK_PITCH + ROAD_W, by0 = by * BLOCK_PITCH + ROAD_W, s = BLOCK_PITCH - ROAD_W;
    if (bx0 + s < x0 || bx0 > x1 || by0 + s < y0 || by0 > y1) continue;
    ctx.strokeRect(bx0 - 4, by0 - 4, s + 8, s + 8);
  }
  // Parks and trees.
  for (const p of game.city.parks) {
    if (p.x + p.w < x0 || p.x > x1 || p.y + p.h < y0 || p.y > y1) continue;
    ctx.fillStyle = PALETTE.parkGrass; ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = PALETTE.parkPath; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(p.x, p.y + p.h / 2); ctx.lineTo(p.x + p.w, p.y + p.h / 2); ctx.moveTo(p.x + p.w / 2, p.y); ctx.lineTo(p.x + p.w / 2, p.y + p.h); ctx.stroke();
  }
  for (const t of game.city.trees) {
    if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
    ctx.fillStyle = PALETTE.treeDark; ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PALETTE.treeLight; ctx.beginPath(); ctx.arc(t.x - 3, t.y - 3, t.r * 0.55, 0, Math.PI * 2); ctx.fill();
  }
  // Mission marker (under entities, with a pulsing ring drawn in screen-stable time).
  const marker = game.missions.marker();
  if (marker) {
    const pulse = 30 + Math.sin(game.time * 3.2) * 7;
    ctx.strokeStyle = marker.color === 'pickup' ? PALETTE.markerPickup : PALETTE.markerDeliver;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(marker.x, marker.y, pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.arc(marker.x, marker.y, 7, 0, Math.PI * 2); ctx.fill();
  }
  // Place labels for story locations when nearby. The plate is clamped fully inside the
  // visible view rect (the plate shifts, never the place) so no label can clip at an edge.
  ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center';
  const vx0 = cam.x - hw, vx1 = cam.x + hw, vy0 = cam.y - hh, vy1 = cam.y + hh;
  for (const key of Object.keys(game.places)) {
    const pl = game.places[key];
    if (pl.x < x0 || pl.x > x1 || pl.y < y0 || pl.y > y1) continue;
    const px = clamp(pl.x - 62, vx0 + 4, Math.max(vx0 + 4, vx1 - 128));
    const py = clamp(pl.y - 58, vy0 + 4, Math.max(vy0 + 4, vy1 - 23));
    ctx.fillStyle = 'rgba(10,12,16,0.55)'; ctx.fillRect(px, py, 124, 19);
    ctx.fillStyle = '#cfd3da'; ctx.fillText(pl.name, px + 62, py + 14);
  }
  // Buildings: pseudo-depth — walls extruded away from the camera focus, then the roof.
  const focusX = cam.x, focusY = cam.y + 260;
  const sorted = game.city.buildings;
  for (const b of sorted) {
    if (b.x + b.w < x0 - 80 || b.x > x1 + 80 || b.y + b.h < y0 - 80 || b.y > y1 + 80) continue;
    const ox = clamp((b.x + b.w / 2 - focusX) * 0.0016 * b.height, -26, 26);
    const oy = clamp((b.y + b.h / 2 - focusY) * 0.0016 * b.height, -26, 26) - b.height * 0.16;
    ctx.fillStyle = b.wallDark || PALETTE.wallDark;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y + b.h); ctx.lineTo(b.x + b.w, b.y + b.h);
    ctx.lineTo(b.x + b.w + ox, b.y + b.h + oy); ctx.lineTo(b.x + ox, b.y + b.h + oy);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = b.wallLight || PALETTE.wallLight;
    ctx.beginPath();
    ctx.moveTo(b.x + b.w, b.y); ctx.lineTo(b.x + b.w, b.y + b.h);
    ctx.lineTo(b.x + b.w + ox, b.y + b.h + oy); ctx.lineTo(b.x + b.w + ox, b.y + oy);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x + ox, b.y + oy, b.w, b.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(b.x + ox, b.y + oy, b.w, b.h);
    // Parapet: a lighter lip inside the roof edge so the slab reads as a built roof, not a tile.
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 2;
    ctx.strokeRect(b.x + ox + 3, b.y + oy + 3, b.w - 6, b.h - 6);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
    ctx.strokeRect(b.x + ox + 7, b.y + oy + 7, b.w - 14, b.h - 14);
    // Rooftop props stored at generation: AC boxes, vents, water-tower silhouettes.
    if (b.props) {
      for (const pr of b.props) {
        const rx = b.x + ox + pr.dx, ry = b.y + oy + pr.dy;
        if (pr.kind === 'ac') {
          ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(rx, ry, pr.w, pr.h);
          ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(rx, ry, pr.w, pr.h);
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.beginPath(); ctx.moveTo(rx + 2, ry + pr.h / 2); ctx.lineTo(rx + pr.w - 2, ry + pr.h / 2); ctx.stroke();
        } else if (pr.kind === 'vent') {
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.beginPath(); ctx.arc(rx, ry, pr.w / 2, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(rx, ry, pr.w / 2, 0, Math.PI * 2); ctx.stroke();
        } else {
          // Water tower: legs, a tank and a shallow cone cap.
          ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(rx + 1, ry + pr.h + 7); ctx.lineTo(rx + 3, ry + 4);
          ctx.moveTo(rx + pr.w - 1, ry + pr.h + 7); ctx.lineTo(rx + pr.w - 3, ry + 4);
          ctx.stroke();
          ctx.fillStyle = 'rgba(12,13,18,0.55)'; ctx.fillRect(rx, ry, pr.w, pr.h);
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.beginPath(); ctx.moveTo(rx - 1, ry); ctx.lineTo(rx + pr.w / 2, ry - 4); ctx.lineTo(rx + pr.w + 1, ry); ctx.closePath(); ctx.fill();
        }
      }
    }
    // Lit windows in the district's warmth and density.
    ctx.fillStyle = b.windowColor || 'rgba(255,205,120,0.62)';
    const step = 24;
    const wth = typeof b.windowThreshold === 'number' ? b.windowThreshold : 0.55;
    for (let wx = b.x + ox + 10; wx < b.x + ox + b.w - 8; wx += step) {
      for (let wy = b.y + oy + 10; wy < b.y + oy + b.h - 8; wy += step) {
        const h = Math.sin(wx * 12.9898 + wy * 78.233) * 43758.5453;
        if ((h - Math.floor(h)) > wth) ctx.fillRect(wx, wy, 5, 3);
      }
    }
    if (b.neon) {
      ctx.strokeStyle = b.neonColor; ctx.globalAlpha = 0.75; ctx.lineWidth = 2;
      ctx.strokeRect(b.x + ox + 4, b.y + oy + 4, b.w - 8, b.h - 8);
      ctx.globalAlpha = 1;
    }
  }
  // Parked feel: lamps as small posts (glow comes in the lighting pass).
  ctx.fillStyle = '#565b64';
  for (const l of game.city.lamps) {
    if (l.x < x0 || l.x > x1 || l.y < y0 || l.y > y1) continue;
    ctx.fillRect(l.x - 1.5, l.y - 1.5, 3, 3);
  }
  // Cars, peds, player, bullets, particles.
  for (const car of game.traffic) drawCar(ctx, car, game.time);
  for (const cop of game.police.cops) drawCar(ctx, cop, game.time);
  if (game.markedCarRef) drawCar(ctx, game.markedCarRef, game.time);
  for (const ped of game.peds) drawFigure(ctx, ped.x, ped.y, ped.angle, ped.shirt, ped.skin, false, {
    scale: 1, phase: ped.walkPhase || 0, gait: ped.gait, hairColor: ped.hairColor,
    hairStyle: ped.hairStyle, pants: ped.pants, dead: ped.dead,
  });
  const p = game.player;
  if (!p.inCar) drawFigure(ctx, p.x, p.y, p.angle, PALETTE.playerShirt, PALETTE.playerSkin, true, {
    scale: 1.12, phase: p.walkPhase || 0, gait: 'upright', hairColor: '#241a12',
    hairStyle: 0, pants: '#2e3440', idle: !(p.vx || p.vy),
  });
  else if (p.car) drawCar(ctx, p.car, game.time);
  // A small floating marker so the player always reads at a glance, on foot or driving.
  const bob = Math.sin(game.time * 3.4) * 2.2;
  ctx.fillStyle = 'rgba(245,245,240,0.92)';
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 24 + bob); ctx.lineTo(p.x - 6, p.y - 33 + bob); ctx.lineTo(p.x + 6, p.y - 33 + bob);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#f5d76a'; ctx.lineWidth = 2;
  for (const b of game.bullets) { ctx.beginPath(); ctx.moveTo(b.x - Math.cos(b.angle) * 12, b.y - Math.sin(b.angle) * 12); ctx.lineTo(b.x + Math.cos(b.angle) * 2, b.y + Math.sin(b.angle) * 2); ctx.stroke(); }
  game.fx.draw(ctx);
}
function drawLighting(ctx, game, cam) {
  const lc = getLightCanvas();
  if (!lc) return;
  const g = lc.getContext('2d');
  if (!g) return;
  const toScreen = (wx, wy) => ({ x: (wx - cam.x) * cam.zoom + VIEW_W / 2, y: (wy - cam.y) * cam.zoom + VIEW_H / 2 });
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, VIEW_W, VIEW_H);
  g.fillStyle = 'rgba(6,8,18,0.60)';
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.globalCompositeOperation = 'destination-out';
  const hole = (wx, wy, r, strength) => {
    const s = toScreen(wx, wy);
    if (s.x < -r || s.x > VIEW_W + r || s.y < -r || s.y > VIEW_H + r) return;
    const grad = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * cam.zoom);
    grad.addColorStop(0, `rgba(0,0,0,${strength})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(s.x, s.y, r * cam.zoom, 0, Math.PI * 2); g.fill();
  };
  for (const l of game.city.lamps) hole(l.x, l.y, 92, 0.62);
  const allCars = game.traffic.concat(game.police.cops);
  if (game.player.car && game.player.inCar) allCars.push(game.player.car);
  for (const car of allCars) {
    hole(car.x, car.y, 54, 0.5);
    const hx = car.x + Math.cos(car.angle) * 62, hy = car.y + Math.sin(car.angle) * 62;
    hole(hx, hy, 74, 0.55);
  }
  hole(game.player.x, game.player.y, 96, 0.66);
  const marker = game.missions.marker();
  if (marker) hole(marker.x, marker.y, 80, 0.5);
  ctx.drawImage(lc, 0, 0);
  // Additive glows.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = (wx, wy, r, color, alpha) => {
    const s = toScreen(wx, wy);
    if (s.x < -r || s.x > VIEW_W + r || s.y < -r || s.y > VIEW_H + r) return;
    const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * cam.zoom);
    grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha; ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(s.x, s.y, r * cam.zoom, 0, Math.PI * 2); ctx.fill();
  };
  for (const l of game.city.lamps) glow(l.x, l.y, 46, 'rgba(255,180,90,0.5)', 0.35);
  for (const car of allCars) {
    glow(car.x - Math.cos(car.angle) * 22, car.y - Math.sin(car.angle) * 22, 20, 'rgba(229,72,77,0.8)', 0.5);
    if (car.isCop && !car.dead) {
      const phase = Math.sin(game.time * 10 + car.sirenPhase) > 0;
      glow(car.x, car.y, 74, phase ? 'rgba(255,59,48,0.55)' : 'rgba(59,130,246,0.55)', 0.5);
    }
  }
  if (marker) glow(marker.x, marker.y, 52, marker.color === 'pickup' ? 'rgba(232,200,50,0.5)' : 'rgba(79,201,106,0.5)', 0.4 + Math.sin(game.time * 3.2) * 0.12);
  ctx.restore();
  ctx.globalAlpha = 1;
  // Vignette.
  const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.42, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.86);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}
export function renderGame(ctx, game) {
  const cam = game.camera;
  ctx.save();
  ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.translate(VIEW_W / 2, VIEW_H / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  const sh = game.fx.shakeOffset(game.rng);
  ctx.translate(sh.x, sh.y);
  drawWorld(ctx, game, cam);
  ctx.restore();
  drawLighting(ctx, game, cam);
}
