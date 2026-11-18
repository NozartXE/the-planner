// config.js — THE PLANNER: shared tuning constants for the whole game.
export const VIEW_W = 1280;
export const VIEW_H = 800;
export const STEP = 1 / 60;
export const MAX_STEPS_PER_FRAME = 5;
export const WORLD_W = 3200;
export const WORLD_H = 2400;
export const BLOCK = 400;
export const ROAD_W = 96;
export const SIDEWALK = 18;
export const RIVER_Y = 2080; // river occupies the south strip below this y
export const PLAYER_SPEED = 150;
export const PLAYER_RUN = 240;
export const PLAYER_RADIUS = 13;
export const CAR_LENGTH = 46;
export const CAR_WIDTH = 24;
export const HEAT_MAX = 100;
export const HEAT_DECAY_PER_SEC = 1.7;
export const BUST_TIME = 2.2;
export const COLORS = {
  road: '#3a3f4a', roadLine: '#f5d76e', sidewalk: '#9aa3ad', grass: '#3fae5a',
  water: '#1e7fb8', sand: '#e8cf8f', player: '#ffd23f', police: '#2f6fed',
  danger: '#ef476f', loot: '#06d6a0', gold: '#ffb703',
};
export const HEIST_IDS = ['casino-vault','bank-vault','jewelry-exchange','museum-gem','port-container','data-centre','armored-ambush','racetrack-strongroom'];
export const SAVE_KEY = 'the-planner-save-v1';
export const TIMES_OF_DAY = ['dawn', 'day', 'dusk', 'night'];
// Per time-of-day: sky tint, traffic density, patrol multiplier, darkness.
export const DAY_PHASES = {
  dawn:  { sky: '#f2a65a', tint: 'rgba(242,140,60,0.10)', traffic: 0.7, patrols: 0.8, dark: 0.15, label: 'DAWN' },
  day:   { sky: '#7ec8e3', tint: 'rgba(0,0,0,0)', traffic: 1.0, patrols: 1.0, dark: 0, label: 'DAY' },
  dusk:  { sky: '#e76f51', tint: 'rgba(120,40,90,0.14)', traffic: 0.85, patrols: 1.0, dark: 0.3, label: 'DUSK' },
  night: { sky: '#14213d', tint: 'rgba(5,10,40,0.38)', traffic: 0.45, patrols: 1.25, dark: 0.62, label: 'NIGHT' },
};
