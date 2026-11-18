// config.js — view, world and tuning constants plus the muted night palette for MERIDIAN NIGHTS.
export const VIEW_W = 1280;
export const VIEW_H = 800;
export const WORLD_SIZE = 3760;
export const BLOCK_PITCH = 470;
export const BLOCKS_PER_SIDE = 8;
export const ROAD_W = 92;
export const SIDEWALK_W = 16;
export const WORLD_SEED = 20261119;
export const CAMERA_ZOOM = 0.92;
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
  roofA: '#2a2e38',
  roofB: '#323642',
  roofC: '#262a33',
  wallLight: '#3d434f',
  wallDark: '#22252d',
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
