// city.js — seeded generation of the Amber Coast street grid: blocks, buildings with heights, parks, palms, lamps and collision.
import { BLOCK_PITCH, BLOCKS_PER_SIDE, ROAD_W, WORLD_SIZE, PALETTE, DISTRICTS, DECO, districtIndexFor } from './config.js';
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
  const palms = [];
  const lamps = [];
  for (let by = 0; by < BLOCKS_PER_SIDE; by++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const district = DISTRICTS[districtIndexFor(bx, by)];
      const ox = bx * BLOCK_PITCH + ROAD_W;
      const oy = by * BLOCK_PITCH + ROAD_W;
      const inner = BLOCK_PITCH - ROAD_W;
      const idx = bx + by * BLOCKS_PER_SIDE;
      const isSite = (bx === 6 && by === 6) || (bx === 1 && by === 6);
      if (isSite) continue;
      const isPark = (idx % 11 === 3) || (idx === 27) || (idx === 44);
      if (isPark) {
        parks.push({ x: ox, y: oy, w: inner, h: inner, bx, by });
        const n = rng.int(7, 11);
        for (let i = 0; i < n; i++) trees.push({ x: ox + rng.range(28, inner - 28), y: oy + rng.range(28, inner - 28), r: rng.range(11, 17) });
        const np = rng.int(2, 4);
        for (let i = 0; i < np; i++) palms.push({ x: ox + rng.range(30, inner - 30), y: oy + rng.range(30, inner - 30), lean: rng.range(-3, 3), s: rng.range(0.9, 1.15) });
        continue;
      }
      // The eastern column is the beachfront: art-deco pastel facades on every block.
      const deco = bx === BLOCKS_PER_SIDE - 1;
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
            color: deco ? rng.pick(DECO.roofs) : rng.pick(district.roofs),
            wallLight: deco ? DECO.wallLight : district.wallLight, wallDark: deco ? DECO.wallDark : district.wallDark,
            windowColor: deco ? DECO.windowColor : district.windowColor, windowThreshold: deco ? DECO.windowThreshold : district.windowThreshold,
            district: districtIndexFor(bx, by),
            deco,
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
  // Palms line the streets: a seeded row on the sidewalk edge of every road,
  // kept clear of intersection corners, plus a promenade row on the sand east
  // of Ocean Drive (the far-edge road).
  for (let k = 0; k <= BLOCKS_PER_SIDE; k++) {
    const edge = k === BLOCKS_PER_SIDE ? WORLD_SIZE - ROAD_W : k * BLOCK_PITCH;
    for (let y = 170; y < WORLD_SIZE - 60; y += 148) {
      if (((y % BLOCK_PITCH) + BLOCK_PITCH) % BLOCK_PITCH < 130) continue;
      if (rng.chance(0.82)) palms.push({ x: edge - 9, y: y + rng.range(-14, 14), lean: rng.range(-3, 3), s: rng.range(0.9, 1.2) });
    }
    for (let x = 170; x < WORLD_SIZE - 60; x += 148) {
      if (((x % BLOCK_PITCH) + BLOCK_PITCH) % BLOCK_PITCH < 130) continue;
      if (rng.chance(0.82)) palms.push({ x: x + rng.range(-14, 14), y: edge - 9, lean: rng.range(-3, 3), s: rng.range(0.9, 1.2) });
    }
  }
  for (let y = 200; y < WORLD_SIZE - 40; y += 168) {
    palms.push({ x: WORLD_SIZE + 14, y: y + rng.range(-12, 12), lean: rng.range(-3, 3), s: rng.range(0.95, 1.25) });
  }
  // Marina boats anchored on the water east of the world edge.
  const boats = [
    { x: WORLD_SIZE + 150, y: 880, s: 1.1, sail: '#f2e8d8' },
    { x: WORLD_SIZE + 235, y: 1240, s: 0.9, sail: '#e8c9c4' },
    { x: WORLD_SIZE + 120, y: 1620, s: 1.0, sail: '#cfe0d4' },
    { x: WORLD_SIZE + 300, y: 640, s: 0.8, sail: '#f2e8d8' },
    { x: WORLD_SIZE + 190, y: 2240, s: 1.05, sail: '#e8c9c4' },
    { x: WORLD_SIZE + 260, y: 2980, s: 0.95, sail: '#f2e8d8' },
  ];
  const sites = [
    { kind: 'airport', x: 6 * BLOCK_PITCH + ROAD_W, y: 6 * BLOCK_PITCH + ROAD_W, w: BLOCK_PITCH - ROAD_W, h: BLOCK_PITCH - ROAD_W, name: 'AMBER FIELD' },
    { kind: 'base', x: 1 * BLOCK_PITCH + ROAD_W, y: 6 * BLOCK_PITCH + ROAD_W, w: BLOCK_PITCH - ROAD_W, h: BLOCK_PITCH - ROAD_W, name: 'FORT SABLE' },
  ];
  return { buildings, parks, trees, palms, boats, lamps, sites, minimap: null };
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
    // Vice City cartography pattern on OUR geography: teal ocean field,
    // pastel land blocks, a pale beach band on the east shore, a light
    // road network, mint parks. Original drawing, our own street grid.
    g.fillStyle = '#3d8fa3'; g.fillRect(0, 0, size, size); // teal ocean
    g.fillStyle = '#e9dcbc'; g.fillRect(0, 0, size, size); // pastel land base
    g.fillStyle = '#f2e3bb';
    for (let by = 0; by < BLOCKS_PER_SIDE; by++) for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const tints = ['#eed9b8', '#e6d3ae', '#f0dcbc', '#eadfc0'];
      g.fillStyle = tints[(bx + by * 3) % tints.length];
      g.fillRect((bx * BLOCK_PITCH + ROAD_W) * s, (by * BLOCK_PITCH + ROAD_W) * s, (BLOCK_PITCH - ROAD_W) * s, (BLOCK_PITCH - ROAD_W) * s);
    }
    g.fillStyle = '#a9c795'; // mint parks
    for (const pk of city.parks) g.fillRect(pk.x * s, pk.y * s, pk.w * s, pk.h * s);
    g.fillStyle = '#fdf6e0'; // light road network
    for (let k = 0; k < BLOCKS_PER_SIDE; k++) {
      g.fillRect(k * BLOCK_PITCH * s, 0, ROAD_W * s, size);
      g.fillRect(0, k * BLOCK_PITCH * s, size, ROAD_W * s);
    }
    g.fillRect(size - ROAD_W * s, 0, ROAD_W * s, size);
    g.fillRect(0, size - ROAD_W * s, size, ROAD_W * s);
    g.strokeStyle = 'rgba(120,100,70,0.35)'; g.lineWidth = 1;
    for (let k = 0; k < BLOCKS_PER_SIDE; k++) { g.strokeRect(k * BLOCK_PITCH * s, 0, ROAD_W * s, size); g.strokeRect(0, k * BLOCK_PITCH * s, size, ROAD_W * s); }
    for (const b of city.buildings) { g.fillStyle = 'rgba(178,148,110,0.55)'; g.fillRect(b.x * s, b.y * s, Math.max(1.5, b.w * s), Math.max(1.5, b.h * s)); }
    // Sites: airport tarmac + runway, base concrete.
    if (city.sites) for (const st of city.sites) {
      g.fillStyle = st.kind === 'airport' ? '#b9b4a6' : '#a8a894';
      g.fillRect(st.x * s, st.y * s, st.w * s, st.h * s);
      if (st.kind === 'airport') { g.fillStyle = '#5c5c60'; g.fillRect(st.x * s, (st.y + st.h / 2 - 14) * s, st.w * s, 28 * s); g.fillStyle = '#fdf6e0'; for (let dx = 8; dx < st.w - 8; dx += 30) g.fillRect((st.x + dx) * s, (st.y + st.h / 2 - 1) * s, 14 * s, 2 * s); }
    }
    // Beach band + ocean on the east edge (the world ends at the shore).
    g.fillStyle = '#f4e3ae'; g.fillRect(size - 3, 0, 3, size);
    return c;
  } catch (e) { return null; }
}
