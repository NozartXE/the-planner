// city.js — seeded generation of the Meridian street grid: blocks, buildings with heights, parks, lamps and collision.
import { BLOCK_PITCH, BLOCKS_PER_SIDE, ROAD_W, WORLD_SIZE, PALETTE, DISTRICTS, districtIndexFor } from './config.js';
import { makeRng, clamp } from './rng.js';

export function roadCenters() {
  const centers = [];
  for (let i = 0; i <= BLOCKS_PER_SIDE; i++) centers.push(i * BLOCK_PITCH + ROAD_W / 2 - (i === BLOCKS_PER_SIDE ? BLOCK_PITCH - ROAD_W : 0) * 0 + (i === BLOCKS_PER_SIDE ? -0 : 0));
  // Simpler explicit grid: roads occupy [k*PITCH, k*PITCH+ROAD_W) plus a closing road at the far edge.
  const list = [];
  for (let k = 0; k < BLOCKS_PER_SIDE; k++) list.push(k * BLOCK_PITCH + ROAD_W / 2);
  list.push(WORLD_SIZE - ROAD_W / 2);
  return list;
}
export function isRoadCoord(c) {
  if (c >= WORLD_SIZE - ROAD_W) return true;
  const m = ((c % BLOCK_PITCH) + BLOCK_PITCH) % BLOCK_PITCH;
  return m < ROAD_W;
}
export function isOnRoad(x, y) { return isRoadCoord(x) || isRoadCoord(y); }
export function nearestRoadCenter(c) {
  const centers = roadCenters();
  let best = centers[0], bd = Infinity;
  for (const cc of centers) { const d = Math.abs(cc - c); if (d < bd) { bd = d; best = cc; } }
  return best;
}

export function generateCity(seed) {
  const rng = makeRng(seed);
  const buildings = [];
  const parks = [];
  const trees = [];
  const lamps = [];
  for (let by = 0; by < BLOCKS_PER_SIDE; by++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const district = DISTRICTS[districtIndexFor(bx, by)];
      const ox = bx * BLOCK_PITCH + ROAD_W;
      const oy = by * BLOCK_PITCH + ROAD_W;
      const inner = BLOCK_PITCH - ROAD_W;
      const idx = bx + by * BLOCKS_PER_SIDE;
      const isPark = (idx % 11 === 3) || (idx === 27) || (idx === 44);
      if (isPark) {
        parks.push({ x: ox, y: oy, w: inner, h: inner, bx, by });
        const n = rng.int(7, 11);
        for (let i = 0; i < n; i++) trees.push({ x: ox + rng.range(28, inner - 28), y: oy + rng.range(28, inner - 28), r: rng.range(11, 17) });
        continue;
      }
      const plot = inner / 2;
      for (let py = 0; py < 2; py++) {
        for (let px = 0; px < 2; px++) {
          if (rng.chance(0.16)) continue;
          const inset = rng.range(10, 18);
          const bw = plot - inset * 2;
          const bh = plot - inset * 2;
          const bw2 = ox + px * plot + inset, bh2 = oy + py * plot + inset;
          const hasNeon = rng.chance(district.neonChance);
          // Sparse rooftop props, fixed at generation so every frame (and screenshot) agrees.
          const props = [];
          const nProps = rng.int(0, 2);
          for (let pi = 0; pi < nProps; pi++) {
            const kind = rng.pick(['ac', 'ac', 'vent', 'tower']);
            props.push({
              kind,
              dx: rng.range(12, Math.max(13, bw - 26)), dy: rng.range(12, Math.max(13, bh - 26)),
              w: kind === 'ac' ? rng.range(11, 17) : kind === 'tower' ? 13 : 7,
              h: kind === 'ac' ? rng.range(8, 12) : kind === 'tower' ? 11 : 7,
            });
          }
          buildings.push({
            x: bw2, y: bh2, w: bw, h: bh,
            height: rng.range(18, 64),
            color: rng.pick(district.roofs),
            wallLight: district.wallLight, wallDark: district.wallDark,
            windowColor: district.windowColor, windowThreshold: district.windowThreshold,
            district: districtIndexFor(bx, by),
            props,
            neon: hasNeon, neonColor: rng.pick(PALETTE.neonColors),
          });
        }
      }
    }
  }
  // Lamps: at every intersection corner plus mid-block points along each road.
  const centers = roadCenters();
  for (const cx of centers) {
    for (const cy of centers) {
      lamps.push({ x: cx + ROAD_W / 2 + 6, y: cy + ROAD_W / 2 + 6 });
      lamps.push({ x: cx - ROAD_W / 2 - 6, y: cy - ROAD_W / 2 - 6 });
    }
  }
  for (let k = 0; k < BLOCKS_PER_SIDE; k++) {
    const mid = k * BLOCK_PITCH + ROAD_W + (BLOCK_PITCH - ROAD_W) / 2;
    for (const c of centers) {
      lamps.push({ x: mid, y: c + ROAD_W / 2 + 6 });
      lamps.push({ x: c + ROAD_W / 2 + 6, y: mid });
    }
  }
  return { buildings, parks, trees, lamps, minimap: null };
}

export function collideCircleBuildings(city, x, y, r) {
  let nx = x, ny = y;
  for (const b of city.buildings) {
    const cx = clamp(nx, b.x, b.x + b.w);
    const cy = clamp(ny, b.y, b.y + b.h);
    const dx = nx - cx, dy = ny - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        nx = cx + (dx / d) * r; ny = cy + (dy / d) * r;
      } else {
        // Inside the rect: push out along the smallest penetration axis.
        const left = nx - b.x, right = b.x + b.w - nx, top = ny - b.y, bot = b.y + b.h - ny;
        const m = Math.min(left, right, top, bot);
        if (m === left) nx = b.x - r; else if (m === right) nx = b.x + b.w + r;
        else if (m === top) ny = b.y - r; else ny = b.y + b.h + r;
      }
    }
  }
  return { x: clamp(nx, r, WORLD_SIZE - r), y: clamp(ny, r, WORLD_SIZE - r) };
}
export function pointInBuilding(city, x, y) {
  for (const b of city.buildings) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  return null;
}

export function buildMinimapBase(city) {
  try {
    if (typeof document === 'undefined') return null;
    const size = 376;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    if (!g) return null;
    const s = size / WORLD_SIZE;
    g.fillStyle = '#14161c'; g.fillRect(0, 0, size, size);
    g.fillStyle = '#23262e';
    for (let k = 0; k < BLOCKS_PER_SIDE; k++) {
      g.fillRect(k * BLOCK_PITCH * s, 0, ROAD_W * s, size);
      g.fillRect(0, k * BLOCK_PITCH * s, size, ROAD_W * s);
    }
    g.fillRect(size - ROAD_W * s, 0, ROAD_W * s, size);
    g.fillRect(0, size - ROAD_W * s, size, ROAD_W * s);
    g.fillStyle = '#1d2b22';
    for (const p of city.parks) g.fillRect(p.x * s, p.y * s, p.w * s, p.h * s);
    for (const b of city.buildings) { g.fillStyle = b.color || '#3a3f4a'; g.fillRect(b.x * s, b.y * s, Math.max(2, b.w * s), Math.max(2, b.h * s)); }
    return c;
  } catch (e) { return null; }
}
