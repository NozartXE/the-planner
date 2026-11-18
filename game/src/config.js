// config.js — view, world and tuning constants plus the muted night palette for MERIDIAN NIGHTS.
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
export const COPS_PER_STAR = 2;
export const WANTED_DECAY_MS = 7500;
export const SAVE_KEY = 'meridian-nights-save-v1';
export const PALETTE = {
  ground: '#171a21',
  road: '#23262e',
  roadEdge: '#2e323c',
  dash: '#8a8f7a',
  crosswalk: '#9aa0a8',
  sidewalk: '#33363d',
  sidewalkEdge: '#41454e',
  parkGrass: '#1d2b22',
  parkPath: '#2c2f28',
  treeDark: '#24382a',
  treeLight: '#314d36',
  roofA: '#3a404e',
  roofB: '#454b5c',
  roofC: '#343a46',
  wallLight: '#4a5160',
  wallDark: '#2b2f38',
  lampGlow: 'rgba(255,196,110,0.55)',
  lampCore: '#ffd9a0',
  headlight: 'rgba(255,240,200,0.5)',
  taillight: '#e5484d',
  neonColors: ['#57c7d4', '#d48ec2', '#8ecae6', '#e0a458', '#9db38a'],
  playerShirt: '#c9a86a',
  playerSkin: '#d9b48f',
  markerPickup: '#e8c832',
  markerDeliver: '#4fc96a',
  hudText: '#e8e6df',
  hudMuted: '#9aa0a8',
  money: '#8fd18b',
  danger: '#e5484d',
};
// Districts: four quadrants of the 8x8 block grid, each with its own roof family,
// wall tints, window warmth/density and neon bias, so neighbourhoods read as
// different places at a squint, without reading a single label.
// index = (bx >= 4 ? 1 : 0) + (by >= 4 ? 2 : 0) — NW, NE, SW (port), SE.
export const DISTRICTS = [
  { // NW — Old Town around Gazette Plaza: warm brick and terracotta, dense warm windows, little neon.
    roofs: ['#57453a', '#5f4c3e', '#4e3f35'],
    wallLight: '#6b5a48', wallDark: '#3d332a',
    windowColor: 'rgba(255,206,128,0.72)', windowThreshold: 0.42, neonChance: 0.10,
  },
  { // NE — Neon Uptown around the tower and hotel: cool slate-teal, pale windows, neon everywhere.
    roofs: ['#38525c', '#3f5c66', '#324a54'],
    wallLight: '#546e78', wallDark: '#2a3a42',
    windowColor: 'rgba(178,224,238,0.66)', windowThreshold: 0.52, neonChance: 0.46,
  },
  { // SW — Port Meridian industrial: olive-grey sheds and rust, sparse dim windows.
    roofs: ['#54543e', '#5c5c44', '#4a4a38'],
    wallLight: '#62624c', wallDark: '#36362a',
    windowColor: 'rgba(255,186,102,0.62)', windowThreshold: 0.60, neonChance: 0.16,
  },
  { // SE — Southside residential: dusky plum roofs, soft warm windows.
    roofs: ['#4d4763', '#554f6e', '#443f59'],
    wallLight: '#615a78', wallDark: '#332f47',
    windowColor: 'rgba(255,216,170,0.64)', windowThreshold: 0.50, neonChance: 0.22,
  },
];
export function districtIndexFor(bx, by) { return (bx >= 4 ? 1 : 0) + (by >= 4 ? 2 : 0); }
export const PLACES = {
  port: { name: 'Port Meridian', x: 516, y: 3336 },
  neonTower: { name: 'Neon Tower', x: 3336, y: 516 },
  garage: { name: "Venn's Garage", x: 1926, y: 1926 },
  gazette: { name: 'Gazette Plaza', x: 986, y: 986 },
  hotel: { name: 'Hotel Aurelia', x: 2866, y: 1456 },
  hospital: { name: 'St. Sable Hospital', x: 1456, y: 2396 },
  depot: { name: 'South Depot', x: 986, y: 2866 },
  market: { name: 'Low Market', x: 2396, y: 986 },
};
