// config.js — view, world and tuning constants plus the muted golden-hour palette for AMBER COAST.
export const VIEW_W = 1280;
export const VIEW_H = 800;
export const WORLD_SIZE = 3760;
export const BLOCK_PITCH = 470;
export const BLOCKS_PER_SIDE = 8;
export const ROAD_W = 92;
export const SIDEWALK_W = 16;
export const WORLD_SEED = 20261119;
export const CAMERA_ZOOM = 1.18;
export const PLAYER_SPEED_WALK = 148;
export const PLAYER_SPEED_SPRINT = 228;
export const PLAYER_RADIUS = 8;
export const CAR_LENGTH = 38;
export const CAR_WIDTH = 19;
export const PED_W = 11;
export const PED_H = 15;
export const CIVILIAN_TARGET = 26;
export const MAX_COPS = 8;
export const COPS_PER_STAR = 1; // one interceptor per star: the board's heat forecast, the star count and the live unit count are the same number
export const WANTED_DECAY_MS = 7500;
export const SAVE_KEY = 'meridian-nights-save-v1';
export const PALETTE = {
  ground: '#4a3a2e',
  road: '#3e3436',
  roadEdge: '#4c4038',
  dash: '#cbb98a',
  crosswalk: '#d8cfc0',
  sidewalk: '#77644e',
  sidewalkEdge: '#8a7660',
  parkGrass: '#51603a',
  parkPath: '#7a6a50',
  treeDark: '#3d5230',
  treeLight: '#5d7a42',
  palmTrunk: '#7a5c40',
  palmDark: '#476b35',
  palmLight: '#6f9450',
  sand: '#d9bd8f',
  sandShade: '#c8a878',
  water: '#2e7f8c',
  waterDeep: '#256b7d',
  waterSparkle: 'rgba(255,214,150,0.5)',
  roofA: '#cbb59a',
  roofB: '#d3bda6',
  roofC: '#bf9f88',
  wallLight: '#a68a6c',
  wallDark: '#6e5844',
  lampGlow: 'rgba(255,178,102,0.55)',
  lampCore: '#ffd9a0',
  headlight: 'rgba(255,240,200,0.5)',
  taillight: '#e5484d',
  neonColors: ['#e8a0a8', '#f0b269', '#9fc9b8', '#e8c9a0', '#d98a7a'],
  playerShirt: '#e0a458',
  playerSkin: '#d9b48f',
  markerPickup: '#e8c832',
  markerDeliver: '#4fc96a',
  hudText: '#f5ead8',
  hudMuted: '#c9b8a2',
  money: '#a8d18b',
  danger: '#e5484d',
};
// Districts: four quadrants of the 8x8 block grid, each with its own roof family,
// wall tints, window warmth/density and neon bias, so neighbourhoods read as
// different places at a squint, without reading a single label.
// index = (bx >= 4 ? 1 : 0) + (by >= 4 ? 2 : 0) — NW, NE, SW (port), SE.
export const DISTRICTS = [
  { // NW — Old Quarter around Gazette Plaza: cream and peach brick, dense warm windows, little signage.
    roofs: ['#c9a189', '#d4b096', '#bd927c'],
    wallLight: '#a8836a', wallDark: '#6e5240',
    windowColor: 'rgba(255,214,140,0.72)', windowThreshold: 0.42, neonChance: 0.08,
  },
  { // NE — Solana beachfront and uptown: pastel art-deco mint, coral and cream, glass catching the sunset.
    roofs: ['#a8c3b2', '#e0b49c', '#d9c9a3'],
    wallLight: '#b3a58e', wallDark: '#77694f',
    windowColor: 'rgba(255,226,170,0.66)', windowThreshold: 0.50, neonChance: 0.20,
  },
  { // SW — Marina del Sol docks: warm sand and weathered rust sheds, sparse windows.
    roofs: ['#c2a878', '#b98d68', '#cbb59a'],
    wallLight: '#a08a64', wallDark: '#66543a',
    windowColor: 'rgba(255,196,120,0.62)', windowThreshold: 0.60, neonChance: 0.12,
  },
  { // SE — Palma suburbs: soft peach and dusty plum houses under the palms.
    roofs: ['#cfa3a0', '#bfa6c4', '#d9b48f'],
    wallLight: '#ad9683', wallDark: '#6f5c50',
    windowColor: 'rgba(255,220,175,0.64)', windowThreshold: 0.50, neonChance: 0.16,
  },
];
// Art-deco beachfront palette for the eastern column (bx = 7): pastel facades
// with a coral stripe, whatever quadrant the block sits in.
export const DECO = {
  roofs: ['#e6d3b3', '#dfc2ae', '#cfe0d4', '#e8c9c4'],
  wallLight: '#cbb493', wallDark: '#8a7357',
  windowColor: 'rgba(255,230,180,0.7)', windowThreshold: 0.48,
};
export function districtIndexFor(bx, by) { return (bx >= 4 ? 1 : 0) + (by >= 4 ? 2 : 0); }
export const PLACES = {
  port: { name: 'Marina del Sol', x: 516, y: 3336 },
  neonTower: { name: 'Solana Tower', x: 3336, y: 516 },
  garage: { name: "Venn's Garage", x: 1926, y: 1926 },
  gazette: { name: 'Gazette Plaza', x: 986, y: 986 },
  hotel: { name: 'Hotel Aurelia', x: 2866, y: 1456 },
  hospital: { name: 'St. Sable Hospital', x: 1456, y: 2396 },
  depot: { name: 'Palma Depot', x: 986, y: 2866 },
  market: { name: 'Palm Market', x: 2396, y: 986 },
};
