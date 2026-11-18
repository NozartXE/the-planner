// economy.js — money maths: fence fees, crew cuts, REP awards, grades.
import { gradeFor } from './heists.js';
import { CREW_POOL } from './heists.js';

export function settleHeist(save, heist, plan, result) {
  // result: { gross, seconds, heatStars, success }
  const crew = CREW_POOL.filter((c) => plan.crew.includes(c.id));
  let fencePct = 18;
  if (crew.some((c) => c.id === 'ruth')) fencePct -= 4;
  if (plan.gear.includes('plates')) fencePct -= 1;
  const fence = Math.round(result.gross * fencePct / 100);
  const afterFence = result.gross - fence;
  const cuts = crew.map((c) => ({ name: c.name, pct: c.cut, amount: Math.round(afterFence * c.cut / 100) }));
  const cutTotal = cuts.reduce((s, c) => s + c.amount, 0);
  const net = result.success ? afterFence - cutTotal : 0;
  const ratio = result.gross / Math.max(1, result.expectedLoot || result.gross);
  const grade = result.success ? gradeFor(Math.min(1.2, ratio), result.seconds, result.heatStars) : 'FAIL';
  const repGain = result.success ? Math.round(30 + ratio * 60 + (grade === 'S' ? 40 : grade === 'A' ? 25 : 10)) : 5;
  return { fencePct, fence, cuts, cutTotal, net, grade, repGain };
}

export function applySettlement(save, heist, plan, settlement) {
  save.cash += settlement.net;
  save.rep += settlement.repGain;
  if (settlement.grade !== 'FAIL') {
    save.stats.heistsDone += 1;
    const idx = ['casino-vault','bank-vault','jewelry-exchange','museum-gem','port-container','data-centre','armored-ambush','racetrack-strongroom'].indexOf(heist.id);
    if (idx >= 0 && save.unlocked < idx + 2 && save.unlocked < 8) save.unlocked = idx + 2;
    const order = { S: 4, A: 3, B: 2, C: 1 };
    const prev = save.bestGrades[heist.id];
    if (!prev || order[settlement.grade] > order[prev]) save.bestGrades[heist.id] = settlement.grade;
  }
}

export function formatMoney(n) {
  return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
