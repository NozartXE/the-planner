// save.js — localStorage persistence for money, completed missions and lifetime earnings.
import { SAVE_KEY } from './config.js';
export function loadSave() {
  const fallback = { money: 250, missionsCompleted: 0, totalEarned: 0, chainsFinished: 0, bestEscapeMs: 0, timesWasted: 0, carsStolen: 0 };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SAVE_KEY) : null;
    if (!raw) return { ...fallback };
    const parsed = JSON.parse(raw);
    return {
      money: typeof parsed.money === 'number' ? parsed.money : fallback.money,
      missionsCompleted: parsed.missionsCompleted | 0,
      totalEarned: typeof parsed.totalEarned === 'number' ? parsed.totalEarned : 0,
      chainsFinished: parsed.chainsFinished | 0,
      bestEscapeMs: typeof parsed.bestEscapeMs === 'number' ? parsed.bestEscapeMs : 0,
      timesWasted: parsed.timesWasted | 0,
      carsStolen: parsed.carsStolen | 0,
    };
  } catch (e) { return { ...fallback }; }
}
export function writeSave(data) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) {}
}
