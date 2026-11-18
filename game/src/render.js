// render.js — world rendering: city, roads with named streets, buildings with
// signage and shadows, props, river + docks, cars, pedestrians, crew, player,
// police, helicopter searchlight, mission markers, particles, day/night tint.
//
// Art direction (round 1): muted, varied ground per block instead of one flat
// green; worn asphalt with texture; buildings with parapets, varied rooflines
// and window patterns, awnings and neon sign glow; dusk sun glow + vignette;
// lamp/neon light pools at night; actors drawn larger so the frame reads at
// contact-sheet scale. All variation is a pure function of world coordinates
// or building id — no RNG state, no randomness in the render path.
import { WORLD_W, WORLD_H, ROAD_W, RIVER_Y, DAY_PHASES, VIEW_W, VIEW_H } from './config.js';
import { AVENUES, STREETS, PLAZA, PARK, streetNameAt } from './city.js';
import { carDamageLevel } from './vehicles.js';

// Deterministic 0..1 hash of integer coordinates (render-only variation).
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Lighten (f > 0) or darken (f < 0) a #rrggbb colour by a fraction.
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * (1 + f))));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * (1 + f))));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * (1 + f))));
  return `rgb(${r},${g},${b})`;
}

// Muted ground tones per city block: mostly varied greens, some paved yards.
const BLOCK_TONES = ['#3d8f4e', '#357f45', '#47975a', '#3a7d4c', '#418a52', '#6f7268', '#7a7d72'];

export function computeCamera(world) {
  const shakeX = world.shakeAmt ? Math.sin(world.time * 61) * world.shakeAmt * 0.6 : 0;
  const shakeY = world.shakeAmt ? Math.cos(world.time * 53) * world.shakeAmt * 0.6 : 0;
  return {
    x: Math.max(0, Math.min(WORLD_W - VIEW_W, world.camera.x - VIEW_W / 2 + shakeX)),
    y: Math.max(0, Math.min(WORLD_H - VIEW_H, world.camera.y - VIEW_H / 2 + shakeY)),
  };
}

function drawCar(ctx, car, time, night, dusk) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Visual scale-up only (1.3x): physics/collision sizes are untouched, the
  // car just reads at contact-sheet scale.
  ctx.scale(1.3, 1.3);
  const L = 46, Wd = 24;
  // Shadow.
  ctx.fillStyle = night ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)'; ctx.fillRect(-L / 2 + 3, -Wd / 2 + 5, L, Wd);
  // Body.
  ctx.fillStyle = car.disabled ? '#555b66' : car.color;
  ctx.beginPath(); ctx.roundRect(-L / 2, -Wd / 2, L, Wd, 6); ctx.fill();
  // Roof highlight / body shading: lighter top edge, darker lower edge.
  ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(-L / 2 + 3, -Wd / 2, L - 6, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(-L / 2 + 3, Wd / 2 - 4, L - 6, 4);
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
  // Headlight beams at dusk/night, taillight glow.
  if (night || dusk) {
    ctx.fillStyle = 'rgba(255,230,140,0.22)';
    ctx.beginPath(); ctx.moveTo(L / 2, -8); ctx.lineTo(L / 2 + 52, -20); ctx.lineTo(L / 2 + 52, 20); ctx.lineTo(L / 2, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffe98a'; ctx.fillRect(L / 2 - 2, -Wd / 2 + 3, 3, 5); ctx.fillRect(L / 2 - 2, Wd / 2 - 8, 3, 5);
    ctx.fillStyle = '#ff3b30'; ctx.fillRect(-L / 2 - 1, -Wd / 2 + 3, 3, 5); ctx.fillRect(-L / 2 - 1, Wd / 2 - 8, 3, 5);
  }
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
  // Bigger actors (visual scale-up only): a person reads at thumbnail scale.
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(3, 5, 13, 9, 0, 0, Math.PI * 2); ctx.fill();
  const bob = Math.sin((opts.phase || 0)) * 2;
  // Feet: two small steps that alternate with the walk phase.
  ctx.fillStyle = '#1d212b';
  const step = Math.sin(opts.phase || 0) * 4;
  ctx.beginPath(); ctx.arc(-4 + step * 0.4, 8, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(4 - step * 0.4, 8, 3.5, 0, Math.PI * 2); ctx.fill();
  // Body with a dark outline ring so the shirt colour pops against the ground.
  ctx.fillStyle = shirt;
  ctx.beginPath(); ctx.arc(0, bob * 0.3, 13, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(10,10,16,0.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, bob * 0.3, 13, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#f2c79b';
  ctx.beginPath(); ctx.arc(0, bob * 0.3, 7, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(angle);
  ctx.fillStyle = shirt;
  ctx.fillRect(8, -4, 9, 8); // facing nub / arm direction
  ctx.restore();
  if (opts.bag) {
    ctx.save(); ctx.translate(x + 13, y + 10);
    ctx.fillStyle = '#06d6a0'; ctx.fillRect(-10, -7, 20, 14);
    ctx.strokeStyle = 'rgba(10,10,16,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(-10, -7, 20, 14);
    ctx.fillStyle = '#ffd60a'; ctx.font = '900 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('$', 0, 5);
    ctx.restore();
  }
}

export function drawWorld(ctx, world, cam) {
  const phase = DAY_PHASES[(world.plan && world.plan.timeOfDay) || 'day'] || DAY_PHASES.day;
  const night = phase.dark > 0.4, dark = phase.dark;
  ctx.save();
  ctx.translate(-cam.x, -cam.y);
  const vx = cam.x - 40, vy = cam.y - 40, vw = VIEW_W + 80, vh = VIEW_H + 80;
  // Ground: one muted tone per city block (varied greens, some paved yards),
  // never one flat green. Blocks are 400px cells; the river strip stays water.
  ctx.fillStyle = '#357f45'; ctx.fillRect(vx, vy, vw, vh);
  const bx0 = Math.max(0, Math.floor(vx / 400)), bx1 = Math.min(7, Math.floor((vx + vw) / 400));
  const by0 = Math.max(0, Math.floor(vy / 400)), by1 = Math.min(5, Math.floor((vy + vh) / 400));
  for (let by = by0; by <= by1; by++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const tone = BLOCK_TONES[Math.floor(hash2(bx * 3 + 1, by * 5 + 2) * BLOCK_TONES.length) % BLOCK_TONES.length];
      ctx.fillStyle = tone;
      ctx.fillRect(bx * 400, by * 400, 400, Math.min(400, RIVER_Y - by * 400));
    }
  }
  // Central plaza (paved, tiled) and pocket park (lawns, trees, pond).
  ctx.fillStyle = '#8d8578'; ctx.fillRect(PLAZA.x, PLAZA.y, PLAZA.w, PLAZA.h);
  ctx.strokeStyle = 'rgba(60,50,40,0.35)'; ctx.lineWidth = 2;
  for (let gx = PLAZA.x + 30; gx < PLAZA.x + PLAZA.w; gx += 30) { ctx.beginPath(); ctx.moveTo(gx, PLAZA.y); ctx.lineTo(gx, PLAZA.y + PLAZA.h); ctx.stroke(); }
  for (let gy = PLAZA.y + 30; gy < PLAZA.y + PLAZA.h; gy += 30) { ctx.beginPath(); ctx.moveTo(PLAZA.x, gy); ctx.lineTo(PLAZA.x + PLAZA.w, gy); ctx.stroke(); }
  ctx.fillStyle = '#4a90c2'; ctx.beginPath(); ctx.arc(PLAZA.x + PLAZA.w / 2, PLAZA.y + PLAZA.h / 2, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#dfe9f2'; ctx.beginPath(); ctx.arc(PLAZA.x + PLAZA.w / 2, PLAZA.y + PLAZA.h / 2, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a90c2'; ctx.beginPath(); ctx.arc(PLAZA.x + PLAZA.w / 2, PLAZA.y + PLAZA.h / 2, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2f7d3a'; ctx.fillRect(PARK.x, PARK.y, PARK.w, PARK.h);
  ctx.fillStyle = '#35853f';
  for (let i = 0; i < 7; i++) { const tx = PARK.x + 24 + hash2(i, 11) * (PARK.w - 48), ty = PARK.y + 22 + hash2(i, 23) * (PARK.h - 44); ctx.beginPath(); ctx.arc(tx, ty, 16 + hash2(i, 7) * 8, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#1e7fb8'; ctx.beginPath(); ctx.ellipse(PARK.x + PARK.w * 0.62, PARK.y + PARK.h * 0.6, 42, 24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(PARK.x + PARK.w * 0.62, PARK.y + PARK.h * 0.6, 30, 16, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#e8cf8f'; ctx.fillRect(vx, RIVER_Y, vw, 60); // sand bank
  ctx.fillStyle = '#155a80'; ctx.fillRect(vx, RIVER_Y + 60, vw, WORLD_H - RIVER_Y);
  ctx.fillStyle = '#1e7fb8'; ctx.fillRect(vx, RIVER_Y + 60, vw, 26);
  // Water sparkle lines.
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const wy = RIVER_Y + 90 + i * 26;
    ctx.beginPath(); ctx.moveTo(vx + (i * 173) % 300, wy); ctx.lineTo(vx + (i * 173) % 300 + 90, wy); ctx.stroke();
  }
  // Docks.
  for (const d of world.city.docks) { ctx.fillStyle = '#8a5a33'; ctx.fillRect(d.x, d.y, d.w, d.h); ctx.fillStyle = '#a9713f'; ctx.fillRect(d.x, d.y, d.w, 5); }
  // Roads: worn asphalt with texture patches, faded edge lines.
  ctx.fillStyle = '#34373f';
  for (const a of AVENUES) ctx.fillRect(a.x - ROAD_W / 2, 0, ROAD_W, RIVER_Y + 60);
  for (const s of STREETS) ctx.fillRect(0, s.y - ROAD_W / 2, WORLD_W, ROAD_W);
  // Asphalt patches + cracks: deterministic per road segment.
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (const a of AVENUES) {
    if (a.x < vx - 60 || a.x > vx + vw + 60) continue;
    for (let y = Math.max(0, vy); y < Math.min(RIVER_Y, vy + vh); y += 64) {
      if (hash2(a.x, y) < 0.5) ctx.fillRect(a.x - ROAD_W / 2 + 8 + hash2(y, a.x) * 56, y + hash2(a.x, y + 9) * 30, 14 + hash2(y, 3) * 18, 8 + hash2(y, 5) * 10);
    }
  }
  for (const s of STREETS) {
    if (s.y < vy - 60 || s.y > vy + vh + 60) continue;
    for (let x = Math.max(0, vx); x < Math.min(WORLD_W, vx + vw); x += 64) {
      if (hash2(x, s.y) < 0.5) ctx.fillRect(x + hash2(s.y, x + 9) * 30, s.y - ROAD_W / 2 + 8 + hash2(x, s.y) * 56, 14 + hash2(x, 3) * 18, 8 + hash2(x, 5) * 10);
    }
  }
  ctx.strokeStyle = 'rgba(230,235,240,0.28)'; ctx.lineWidth = 2;
  for (const a of AVENUES) {
    ctx.beginPath(); ctx.moveTo(a.x - ROAD_W / 2 + 5, 0); ctx.lineTo(a.x - ROAD_W / 2 + 5, RIVER_Y + 60); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x + ROAD_W / 2 - 5, 0); ctx.lineTo(a.x + ROAD_W / 2 - 5, RIVER_Y + 60); ctx.stroke();
  }
  for (const s of STREETS) {
    ctx.beginPath(); ctx.moveTo(0, s.y - ROAD_W / 2 + 5); ctx.lineTo(WORLD_W, s.y - ROAD_W / 2 + 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, s.y + ROAD_W / 2 - 5); ctx.lineTo(WORLD_W, s.y + ROAD_W / 2 - 5); ctx.stroke();
  }
  // Sidewalk edges with tile seams.
  ctx.fillStyle = '#939aa1';
  for (const a of AVENUES) { ctx.fillRect(a.x - ROAD_W / 2 - 8, 0, 8, RIVER_Y + 60); ctx.fillRect(a.x + ROAD_W / 2, 0, 8, RIVER_Y + 60); }
  for (const s of STREETS) { ctx.fillRect(0, s.y - ROAD_W / 2 - 8, WORLD_W, 8); ctx.fillRect(0, s.y + ROAD_W / 2, WORLD_W, 8); }
  ctx.strokeStyle = 'rgba(40,44,54,0.35)'; ctx.lineWidth = 1;
  for (const a of AVENUES) {
    if (a.x < vx - 60 || a.x > vx + vw + 60) continue;
    for (let y = Math.max(0, vy - (vy % 26)); y < Math.min(RIVER_Y, vy + vh); y += 26) {
      ctx.beginPath(); ctx.moveTo(a.x - ROAD_W / 2 - 8, y); ctx.lineTo(a.x - ROAD_W / 2, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a.x + ROAD_W / 2, y); ctx.lineTo(a.x + ROAD_W / 2 + 8, y); ctx.stroke();
    }
  }
  for (const s of STREETS) {
    if (s.y < vy - 60 || s.y > vy + vh + 60) continue;
    for (let x = Math.max(0, vx - (vx % 26)); x < Math.min(WORLD_W, vx + vw); x += 26) {
      ctx.beginPath(); ctx.moveTo(x, s.y - ROAD_W / 2 - 8); ctx.lineTo(x, s.y - ROAD_W / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, s.y + ROAD_W / 2); ctx.lineTo(x, s.y + ROAD_W / 2 + 8); ctx.stroke();
    }
  }
  // Centre dashes, worn: some dashes missing, some faded.
  for (const a of AVENUES) for (let y = 14; y < RIVER_Y; y += 46) {
    const h = hash2(a.x, y);
    if (h < 0.22) continue;
    ctx.fillStyle = h < 0.45 ? 'rgba(245,215,110,0.45)' : '#f5d76e';
    ctx.fillRect(a.x - 2, y, 4, 24);
  }
  for (const s of STREETS) for (let x = 14; x < WORLD_W; x += 46) {
    const h = hash2(x, s.y);
    if (h < 0.22) continue;
    ctx.fillStyle = h < 0.45 ? 'rgba(245,215,110,0.45)' : '#f5d76e';
    ctx.fillRect(x, s.y - 2, 24, 4);
  }
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
      if (night) {
        // Warm light pool on the ground + halo, so streets read at night.
        ctx.fillStyle = 'rgba(255,214,10,0.14)'; ctx.beginPath(); ctx.arc(pr.x, pr.y - 6, 46, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,214,10,0.20)'; ctx.beginPath(); ctx.arc(pr.x, pr.y - 20, 12, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = night ? '#ffd60a' : '#ffe9a8'; ctx.beginPath(); ctx.arc(pr.x, pr.y - 20, 5, 0, Math.PI * 2); ctx.fill();
    } else if (pr.kind === 'crate') { ctx.fillStyle = '#a9713f'; ctx.fillRect(pr.x - 9, pr.y - 9, 18, 18); ctx.strokeStyle = '#7a4a21'; ctx.strokeRect(pr.x - 9, pr.y - 9, 18, 18); }
    else if (pr.kind === 'barrier') { ctx.fillStyle = '#e9ecef'; ctx.fillRect(pr.x - 13, pr.y - 5, 26, 10); ctx.fillStyle = '#ef476f'; ctx.fillRect(pr.x - 13, pr.y - 5, 8, 10); ctx.fillRect(pr.x + 5, pr.y - 5, 8, 10); }
    else if (pr.kind === 'bench') { ctx.fillStyle = '#6c4a2f'; ctx.fillRect(pr.x - 12, pr.y - 4, 24, 8); }
    else { ctx.fillStyle = '#d90429'; ctx.fillRect(pr.x - 4, pr.y - 8, 8, 14); ctx.fillStyle = '#e9ecef'; ctx.fillRect(pr.x - 4, pr.y - 8, 8, 4); }
  }
  // Buildings: deep shadow, body, parapet rim + varied roofline, roof props,
  // varied window patterns (lit at night), awning, glowing sign band.
  for (const b of world.city.buildings) {
    if (b.x + b.w < vx || b.x > vx + vw || b.y + b.h < vy || b.y > vy + vh) continue;
    const bDark = 0.30 + dark * 0.22;
    ctx.fillStyle = `rgba(0,0,0,${bDark.toFixed(2)})`; ctx.fillRect(b.x + 12, b.y + 14, b.w, b.h);
    ctx.fillStyle = b.color; ctx.fillRect(b.x, b.y, b.w, b.h);
    // Parapet rim (darker body tone) + roof panel; taller buildings get a
    // second setback tier for a varied skyline.
    ctx.fillStyle = shade(b.color, -0.25); ctx.fillRect(b.x, b.y, b.w, 7);
    ctx.fillStyle = b.roof; ctx.fillRect(b.x + 7, b.y + 7, b.w - 14, b.h - 14);
    ctx.fillStyle = shade(b.roof, 0.18); ctx.fillRect(b.x + 14, b.y + 14, b.w - 28, b.h - 28);
    if (hash2(b.id, 41) < 0.35) {
      ctx.fillStyle = shade(b.roof, -0.15);
      ctx.fillRect(b.x + b.w * 0.22, b.y + b.h * 0.2, b.w * 0.56, b.h * 0.5);
      ctx.fillStyle = shade(b.roof, 0.28); ctx.fillRect(b.x + b.w * 0.26, b.y + b.h * 0.24, b.w * 0.48, b.h * 0.42);
    }
    // Roof props: AC boxes + vents, placed by building id.
    ctx.fillStyle = '#3a3f4a';
    const nProps = 1 + Math.floor(hash2(b.id, 3) * 3);
    for (let i = 0; i < nProps; i++) {
      const px = b.x + 18 + hash2(b.id, 10 + i) * (b.w - 44);
      const py = b.y + 18 + hash2(b.id, 20 + i) * (b.h - 44);
      ctx.fillRect(px, py, 12, 9);
    }
    // Windows: spacing + lit ratio vary per building; night windows glow warm.
    const spacing = 24 + Math.floor(hash2(b.id, 1) * 3) * 4;
    for (let wx = b.x + 18; wx < b.x + b.w - 16; wx += spacing) {
      for (let wy = b.y + 18; wy < b.y + b.h - 16; wy += 24) {
        const lit = hash2(wx, wy) < 0.45;
        if (night) { if (lit) { ctx.fillStyle = 'rgba(255,214,10,0.85)'; ctx.fillRect(wx, wy, 11, 9); } else { ctx.fillStyle = 'rgba(12,18,30,0.85)'; ctx.fillRect(wx, wy, 11, 9); } }
        else if (hash2(wx, wy + 5) < 0.8) { ctx.fillStyle = 'rgba(190,225,245,0.8)'; ctx.fillRect(wx, wy, 11, 9); }
      }
    }
    // Awning over the entrance side on some fronts.
    if (hash2(b.id, 5) < 0.4) {
      ctx.fillStyle = shade(b.color, 0.25);
      ctx.fillRect(b.x + b.w * 0.3, b.y + b.h - 44, b.w * 0.4, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let ax = b.x + b.w * 0.3 + 6; ax < b.x + b.w * 0.7; ax += 12) ctx.fillRect(ax, b.y + b.h - 44, 3, 12);
    }
    // Sign band + neon glow at night (clubs/casinos glow their own colour).
    const neon = (b.kind === 'club' || b.kind === 'casino') ? '#f72585' : '#ffd60a';
    if (night) { ctx.fillStyle = neon === '#f72585' ? 'rgba(247,37,133,0.20)' : 'rgba(255,214,10,0.16)'; ctx.fillRect(b.x - 4, b.y + b.h - 34, b.w + 8, 38); }
    ctx.fillStyle = 'rgba(8,10,18,0.88)'; ctx.fillRect(b.x, b.y + b.h - 30, b.w, 30);
    ctx.fillStyle = night ? neon : '#ffffff';
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
  // Skid marks: bigger, darker, they sell the chase.
  ctx.fillStyle = 'rgba(15,15,20,0.55)';
  for (const car of world.cars) for (const s of car.skid) ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
  // Cars.
  for (const car of world.cars) {
    if (car.x < vx - 60 || car.x > vx + vw + 60 || car.y < vy - 60 || car.y > vy + vh + 60) continue;
    drawCar(ctx, car, world.time, night, phase.label === 'DUSK');
  }
  // Pedestrians.
  for (const ped of world.peds) {
    if (ped.x < vx || ped.x > vx + vw || ped.y < vy || ped.y > vy + vh) continue;
    if (ped.down > 0) { ctx.save(); ctx.translate(ped.x, ped.y); ctx.rotate(Math.PI / 2); ctx.fillStyle = ped.shirt; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill(); ctx.restore(); continue; }
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
    ctx.fillStyle = '#22242c'; ctx.fillRect(10, -3, 18, 6);
    ctx.restore();
    // Muzzle flash frozen on the frame right after a shot (lastShotT is 0
    // while staging holds the moment; in live play it lasts ~90 ms).
    if (world.lastShotT < 0.09) {
      const fa = p.aimAngle || p.angle;
      const fx = p.x + Math.cos(fa) * 30, fy = p.y + Math.sin(fa) * 30;
      ctx.fillStyle = 'rgba(255,214,10,0.45)'; ctx.beginPath(); ctx.arc(fx, fy, 30, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff7cc';
      ctx.beginPath();
      ctx.moveTo(fx - 20, fy); ctx.lineTo(fx, fy - 7); ctx.lineTo(fx + 22, fy); ctx.lineTo(fx, fy + 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.arc(fx, fy, 8, 0, Math.PI * 2); ctx.fill();
    }
    // Name tag.
    ctx.fillStyle = '#ffd23f'; ctx.font = '900 14px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('THE PLANNER', p.x, p.y - 28);
  }
  // Helicopter + searchlight (drawn above rooftops): a wide visible cone and
  // a hot pool where the light lands.
  const h = world.heli;
  if (h.active) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,240,170,0.12)';
    ctx.beginPath(); ctx.moveTo(h.x, h.y);
    ctx.arc(h.x, h.y, 230, h.lightAngle - 0.42, h.lightAngle + 0.42); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,170,0.30)';
    ctx.beginPath(); ctx.moveTo(h.x, h.y);
    ctx.arc(h.x, h.y, 165, h.lightAngle - 0.32, h.lightAngle + 0.32); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,244,190,0.42)';
    ctx.beginPath(); ctx.arc(h.lightX, h.lightY, 70, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,244,190,0.52)';
    ctx.beginPath(); ctx.arc(h.lightX, h.lightY, 34, 0, Math.PI * 2); ctx.fill();
    ctx.translate(h.x, h.y);
    ctx.scale(1.25, 1.25); // the helicopter must read at contact-sheet scale
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
  // Dusk sun glow (warm, low in the sky) + vignette: the frame must read as
  // dusk/night at a glance, not as a flat tint.
  if (phase.label === 'DUSK') {
    const sun = ctx.createRadialGradient(VIEW_W * 0.84, 70, 10, VIEW_W * 0.84, 70, 430);
    sun.addColorStop(0, 'rgba(255,158,79,0.42)');
    sun.addColorStop(0.5, 'rgba(255,120,70,0.16)');
    sun.addColorStop(1, 'rgba(255,120,70,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  } else if (phase.label === 'DAWN') {
    const sun = ctx.createRadialGradient(VIEW_W * 0.16, 80, 10, VIEW_W * 0.16, 80, 380);
    sun.addColorStop(0, 'rgba(242,166,90,0.20)');
    sun.addColorStop(1, 'rgba(242,166,90,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  const vigA = 0.10 + dark * 0.28;
  const vig = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.42, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.72);
  vig.addColorStop(0, 'rgba(6,8,18,0)');
  vig.addColorStop(1, `rgba(6,8,18,${vigA.toFixed(2)})`);
  ctx.fillStyle = vig; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // Day/night tint + power-cut darkness.
  if (dark > 0 || world.powerCut) {
    ctx.fillStyle = world.powerCut ? 'rgba(3,5,16,0.55)' : phase.tint;
    if (world.powerCut || dark > 0) ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  // Street name caption bottom-centre.
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '800 15px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(streetNameAt(world.camera.x, world.camera.y) + ' · MERIDIAN', VIEW_W / 2, VIEW_H - 12);
}
