// city.js — the Meridian Mile district: road graph, named streets, buildings,
// props and points of interest. Pure data + geometry helpers, no DOM.
import { WORLD_W, WORLD_H, BLOCK, ROAD_W, RIVER_Y } from './config.js';
import { Rng } from './rng.js';

// Vertical avenues (x centres) and horizontal streets (y centres).
export const AVENUES = [
  { x: 200, name: 'HARBOR AVE' }, { x: 600, name: 'PALM AVE' }, { x: 1000, name: 'MERIDIAN BLVD' },
  { x: 1400, name: 'VAULT ST' }, { x: 1800, name: 'CIRCUIT AVE' }, { x: 2200, name: 'DOCKSIDE RD' },
  { x: 2600, name: 'NEON ROW' }, { x: 3000, name: 'EASTGATE AVE' },
];
export const STREETS = [
  { y: 200, name: 'SUNSET STRIP' }, { y: 600, name: 'AURUM WAY' }, { y: 1000, name: 'MARKET ST' },
  { y: 1400, name: 'FOUNDRY RD' }, { y: 1800, name: 'RIVERWALK' },
];

// Building templates: [name, sign, body colour, roof colour, kind]
const TEMPLATES = [
  ['AURUM GRAND', 'CASINO', '#a06bc9', '#6f4396', 'casino'],
  ['MERIDIAN TRUST', 'BANK', '#4a7fa5', '#2c4f6b', 'bank'],
  ['VELMARA EXCHANGE', 'JEWELS', '#c22a54', '#7e1a36', 'jewelry'],
  ['HALCYON MUSEUM', 'MUSEUM', '#e0aa3e', '#9c7422', 'museum'],
  ['PORTSIDE WAREHOUSE 7', 'CARGO', '#7a8a5a', '#4c5a38', 'warehouse'],
  ['PORTSIDE WAREHOUSE 9', 'CARGO', '#9aa3ab', '#626a72', 'warehouse'],
  ['NOVACORE DATA CENTRE', 'DATA', '#7f9ae8', '#4f68b8', 'data'],
  ['MERIDIAN CIRCUIT', 'RACING', '#e07a3f', '#9c4f22', 'racetrack'],
  ["MURPHY'S BODY SHOP", 'GARAGE', '#e8a04c', '#a96f28', 'garage'],
  ['THE SAFEHOUSE', 'HOTEL', '#3fb8a6', '#227a6c', 'safehouse'],
  ['PALM COURT HOTEL', 'HOTEL', '#f2a0c0', '#c06a8e', 'hotel'],
  ['SUNBAKED DINER', 'DINER', '#f2d24b', '#bfa02e', 'diner'],
  ['KITE & COFFEE', 'CAFE', '#8fbf6f', '#5d8143', 'cafe'],
  ['MERIDIAN PAWN', 'PAWN', '#ef6351', '#9c2b2b', 'pawn'],
  ['VOSS LOGISTICS', 'OFFICE', '#6b87a3', '#40586e', 'office'],
  ['TIDEWATER OFFICES', 'OFFICE', '#4fc9a2', '#2a7a5f', 'office'],
  ['BRINE & SONS', 'CHANDLERY', '#2f7ea6', '#256480', 'shop'],
  ['NEON LIQUOR', 'LIQUOR', '#e85d9e', '#a83268', 'shop'],
  ['GRAND PHARMACY', 'PHARMACY', '#6fc3e7', '#3a84a8', 'shop'],
  ['THE GILDED CAGE', 'CLUB', '#6a3fc9', '#452a80', 'club'],
  ['ORBIT ARCADE', 'ARCADE', '#5a54b8', '#37347e', 'club'],
  ['MERIDIAN LIBRARY', 'LIBRARY', '#c98a4b', '#8a5a28', 'civic'],
  ['CITY HALL ANNEX', 'CIVIC', '#c9ced4', '#8f959c', 'civic'],
  ['FIRE STATION 4', 'FIRE', '#d90429', '#9c1d1d', 'civic'],
  ['PRECINCT 9', 'POLICE', '#4a6a8a', '#2c4258', 'police'],
  ['HARBOUR CLINIC', 'CLINIC', '#eef1f3', '#b0b6bc', 'civic'],
  ['SOLAR TOWER', 'OFFICE', '#f0a832', '#b57a1e', 'office'],
  ['KEEL APARTMENTS', 'FLATS', '#ef8354', '#b85a30', 'flats'],
  ['MARINA FLATS', 'FLATS', '#8ecae6', '#5b93ad', 'flats'],
  ['THE FOUNDRY', 'GYM', '#7d6ba8', '#4e3f75', 'gym'],
  ['TURBO WASH', 'CAR WASH', '#38b6d8', '#1d7a96', 'garage'],
  ['PIER 9 TAVERN', 'TAVERN', '#c77dbb', '#8e4f88', 'club'],
  ['OLD CUSTOMS HOUSE', 'CUSTOMS', '#dda15e', '#96682f', 'civic'],
  ['FERRY TERMINAL', 'FERRY', '#2a9db8', '#17677c', 'civic'],
  ['CRANE & HOOK', 'SUPPLY', '#bc4749', '#77282a', 'shop'],
  ['MERIDIAN SCHOOL', 'SCHOOL', '#a7c957', '#74902f', 'civic'],
  ['PALM LAUNDRY', 'LAUNDRY', '#cfeef5', '#93b8c2', 'shop'],
  ['VISTA CINEMA', 'CINEMA', '#5e60ce', '#37397f', 'club'],
  ['THE LEDGER', 'NEWS', '#dee2e6', '#9aa0a6', 'office'],
  ['ANCHOR BOOKS', 'BOOKS', '#cb997e', '#876349', 'shop'],
  ['SLIPWAY BOATS', 'BOATS', '#4fd8b0', '#2a9678', 'shop'],
  ['TIDE POOL MOTEL', 'MOTEL', '#ff9770', '#bf6440', 'hotel'],
];

// Open spaces that break the arena grid: a paved plaza and a pocket park.
// Each replaces one first-lot building (template not consumed, so every kind
// still places and the building count stays 42); both sit clear of roads.
export const PLAZA = { x: 1350, y: 1050, w: 300, h: 180, name: 'MERIDIAN PLAZA' };
export const PARK = { x: 2180, y: 650, w: 290, h: 170, name: 'PALM POCKET PARK' };

// Lot positions: inside each block, up to 2 buildings. Blocks are the cells
// between roads. We generate deterministically from the template list.
export function buildCity(rng) {
  const buildings = [];
  let ti = 0;
  for (let by = 0; by < 5; by++) {
    for (let bx = 0; bx < 7; bx++) {
      if (ti >= TEMPLATES.length) break;
      const x0 = bx * BLOCK + ROAD_W / 2 + 26 + AVENUES[0].x - 200;
      // Simpler deterministic lot grid: two lots per block column band.
      const lotX = 400 * bx + 300 + (by % 2) * 40;
      const lotY = 400 * by + 300;
      if (lotY > RIVER_Y - 260) continue;
      // The plaza (bx 3, by 2) and park (bx 5, by 1) leave their first lot
      // open: skip without consuming the template, so the kind still places
      // in a later lot and the district keeps all 42 fronts.
      const openLot = (bx === 3 && by === 2) || (bx === 5 && by === 1);
      if (openLot) continue;
      const t = TEMPLATES[ti++];
      const w = 190 + rng.int(0, 60), h = 130 + rng.int(0, 50);
      buildings.push({
        id: buildings.length, name: t[0], sign: t[1], color: t[2], roof: t[3], kind: t[4],
        x: lotX - w / 2, y: lotY - h / 2, w, h,
        doorX: lotX, doorY: lotY + h / 2 + 14,
      });
      // Second, smaller lot on wider blocks keeps the district dense (~40 fronts).
      if (ti < TEMPLATES.length && bx % 2 === 0) {
        const t2 = TEMPLATES[ti++];
        const w2 = 130 + rng.int(0, 40), h2 = 100 + rng.int(0, 30);
        const lx2 = lotX + 150, ly2 = lotY - 110;
        if (ly2 > 130) buildings.push({
          id: buildings.length, name: t2[0], sign: t2[1], color: t2[2], roof: t2[3], kind: t2[4],
          x: lx2 - w2 / 2, y: ly2 - h2 / 2, w: w2, h: h2,
          doorX: lx2, doorY: ly2 + h2 / 2 + 12,
        });
      }
    }
  }
  // Landmark lots pinned to sensible places (casino/bank/etc. near centre).
  const props = [];
  const propKinds = ['lamp', 'palm', 'crate', 'barrier', 'bench', 'hydrant'];
  for (let i = 0; i < 260; i++) {
    const onAvenue = rng.chance(0.5);
    const a = onAvenue ? rng.pick(AVENUES) : null;
    const s = onAvenue ? null : rng.pick(STREETS);
    const along = onAvenue ? rng.range(60, WORLD_H - 340) : rng.range(60, WORLD_W - 60);
    const side = rng.chance(0.5) ? 1 : -1;
    props.push({
      kind: rng.pick(propKinds),
      x: onAvenue ? a.x + side * (ROAD_W / 2 + 12) : along,
      y: onAvenue ? along : s.y + side * (ROAD_W / 2 + 12),
    });
  }
  // Docks along the river edge.
  const docks = [];
  for (let i = 0; i < 6; i++) docks.push({ x: 300 + i * 480, y: RIVER_Y + 60, w: 150, h: 26 });
  return { buildings, props, docks };
}

export function buildingByKind(city, kind) { return city.buildings.find((b) => b.kind === kind) || null; }
export function nearestBuilding(city, x, y) {
  let best = null, bd = Infinity;
  for (const b of city.buildings) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
// Is a point inside any building footprint (with margin)?
export function insideBuilding(city, x, y, margin = 0) {
  for (const b of city.buildings) {
    if (x > b.x - margin && x < b.x + b.w + margin && y > b.y - margin && y < b.y + b.h + margin) return b;
  }
  return null;
}
// Push a circle at (x,y,r) out of all buildings and the river; returns corrected point.
export function collideWorld(city, x, y, r) {
  for (const b of city.buildings) {
    const nx = Math.max(b.x, Math.min(b.x + b.w, x));
    const ny = Math.max(b.y, Math.min(b.y + b.h, y));
    const dx = x - nx, dy = y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      if (d2 > 0.01) { const d = Math.sqrt(d2); x = nx + (dx / d) * r; y = ny + (dy / d) * r; }
      else { y = b.y - r; }
    }
  }
  if (y > RIVER_Y - r && x > 0) { /* river bank is walkable sand until RIVER_Y+40 */ }
  if (y > RIVER_Y + 120) y = RIVER_Y + 120;
  x = Math.max(r, Math.min(WORLD_W - r, x));
  y = Math.max(r, Math.min(WORLD_H - r, y));
  return { x, y };
}
// Road graph helpers: lanes run along avenues (vertical) and streets (horizontal).
export function onRoad(x, y) {
  for (const a of AVENUES) if (Math.abs(x - a.x) < ROAD_W / 2) return true;
  for (const s of STREETS) if (Math.abs(y - s.y) < ROAD_W / 2) return true;
  return false;
}
// A random point on a random road, used for spawns.
export function randomRoadPoint(rng) {
  if (rng.chance(0.5)) { const a = rng.pick(AVENUES); return { x: a.x + rng.range(-24, 24), y: rng.range(80, RIVER_Y - 60), vertical: true }; }
  const s = rng.pick(STREETS); return { x: rng.range(80, WORLD_W - 80), y: s.y + rng.range(-24, 24), vertical: false };
}
// Waypoint routing: go along current road to the crossing nearest the target,
// then along the crossing. Returns the next waypoint toward (tx,ty).
export function nextWaypoint(x, y, tx, ty) {
  const nearAvenue = AVENUES.reduce((p, a) => (Math.abs(a.x - x) < Math.abs(p.x - x) ? a : p), AVENUES[0]);
  const nearStreet = STREETS.reduce((p, s) => (Math.abs(s.y - y) < Math.abs(p.y - y) ? s : p), STREETS[0]);
  const onA = Math.abs(x - nearAvenue.x) < ROAD_W / 2 + 6;
  const onS = Math.abs(y - nearStreet.y) < ROAD_W / 2 + 6;
  if (Math.abs(tx - x) < 30 && Math.abs(ty - y) < 30) return { x: tx, y: ty };
  if (onA && Math.abs(tx - nearAvenue.x) > 40) {
    // ride the avenue to the street nearest the target's y
    const targetStreet = STREETS.reduce((p, s) => (Math.abs(s.y - ty) < Math.abs(p.y - ty) ? s : p), STREETS[0]);
    if (Math.abs(y - targetStreet.y) > 24) return { x: nearAvenue.x, y: targetStreet.y };
    return { x: tx, y: targetStreet.y };
  }
  if (onS && Math.abs(ty - nearStreet.y) > 40) {
    const targetAve = AVENUES.reduce((p, a) => (Math.abs(a.x - tx) < Math.abs(p.x - tx) ? a : p), AVENUES[0]);
    if (Math.abs(x - targetAve.x) > 24) return { x: targetAve.x, y: nearStreet.y };
    return { x: targetAve.x, y: ty };
  }
  if (!onA && !onS) return { x: nearAvenue.x, y: nearStreet.y };
  return { x: tx, y: ty };
}
export function streetNameAt(x, y) {
  const a = AVENUES.reduce((p, c) => (Math.abs(c.x - x) < Math.abs(p.x - x) ? c : p), AVENUES[0]);
  const s = STREETS.reduce((p, c) => (Math.abs(c.y - y) < Math.abs(p.y - y) ? c : p), STREETS[0]);
  return Math.abs(a.x - x) < Math.abs(s.y - y) ? a.name : s.name;
}
