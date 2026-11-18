// save.js — localStorage persistence: cash, REP, unlocks, garage, best grades,
// run history and settings. Defensive: storage failures degrade to memory.
import { SAVE_KEY } from './config.js';

export function defaultSave() {
  return {
    cash: 1500, rep: 0, unlocked: 1, // number of heists unlocked (campaign order)
    garage: ['compact'], bestGrades: {}, history: [],
    settings: { mute: false, shake: true },
    stats: { heistsDone: 0, busted: 0, wasted: 0, racesWon: 0, fares: 0, chops: 0 },
  };
}

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw);
    const base = defaultSave();
    return { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) }, stats: { ...base.stats, ...(data.stats || {}) } };
  } catch { return defaultSave(); }
}

export function storeSave(save) {
  try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode */ }
}

export function recordRun(save, entry) {
  save.history.unshift(entry);
  if (save.history.length > 12) save.history.length = 12;
}
