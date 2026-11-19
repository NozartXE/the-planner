// planning.js — THE MERGE: the planning/economy layer for AMBER COAST,
// written for this codebase's five-job Venn chain. A plan is chosen on the
// Planning Board before every job (entry, crew, gear, getaway, time of day)
// and every number the board shows is consumed by the execution that follows:
// the sim reads the same planStats the board renders, the weapon is built
// from the gear, the chase starts at the forecast heat, the getaway car is
// the car on the street, and the results ledger settles the plan's own crew.
// The model (live-recomputing plan stats + a gross-to-net ledger) is adapted
// from our own THE PLANNER design to this game's jobs, cars and police.
import { CHAIN } from './missions.js';

// Named crew: skill drives the grab rate, cut % is what the ledger deducts.
export const CREW_POOL = [
  { id: 'dex', name: 'DEX RUIZ', role: 'LOCKSMITH', skill: 82, cut: 12, color: '#e8c832' },
  { id: 'priya', name: 'PRIYA NAIR', role: 'HACKER', skill: 88, cut: 14, color: '#7fc4d8' },
  { id: 'bo', name: 'BO KOWALSKI', role: 'MUSCLE', skill: 74, cut: 10, color: '#e08a7a' },
  { id: 'sana', name: 'SANA IBRAHIM', role: 'DRIVER', skill: 90, cut: 15, color: '#8fc97f' },
  { id: 'milo', name: 'MILO VANCE', role: 'LOOKOUT', skill: 70, cut: 8, color: '#e8a06a' },
  { id: 'ruth', name: 'RUTH CALLAHAN', role: 'FENCE CONTACT', skill: 78, cut: 11, color: '#c9a2d8' },
];
// Gear over three slots; every item's effect is a real sim input below.
export const GEAR_POOL = [
  { id: 'duffels', name: 'BIG DUFFELS', desc: 'Grab rate +25%' },
  { id: 'extmag', name: 'EXTENDED MAG', desc: 'VENN 9MM magazine 12 to 18' },
  { id: 'quiet', name: 'QUIET KIT', desc: 'Heat -1 star, alarm +6 s' },
  { id: 'smoke', name: 'SMOKE POTS', desc: 'Escape window +6 s' },
  { id: 'plates', name: 'CLEAN PLATES', desc: 'Heat -1, fence fee -1%' },
  { id: 'tools', name: 'PRO TOOLS', desc: 'Alarm +5 s' },
  { id: 'scanner', name: 'POLICE SCANNER', desc: 'Escape window +3 s' },
  { id: 'lockpicks', name: 'PRO LOCKPICKS', desc: 'Grab rate +15%' },
];
// Getaway choices are this game's real car types (cars.js CIV_TYPES speeds).
export const GETAWAYS = [
  { id: 'coupe', name: 'VELOZ COMET', kind: 'coupe', topSpeed: 245 },
  { id: 'sedan', name: 'VANTARO SEDAN', kind: 'sedan', topSpeed: 205 },
  { id: 'hatch', name: 'SOLIS HATCH', kind: 'hatch', topSpeed: 180 },
  { id: 'van', name: 'PALMA HAULER', kind: 'van', topSpeed: 160 },
  { id: 'armored', name: 'AEGIS ARMORED', kind: 'armored', topSpeed: 215 },
];
export const TIMES = [
  { id: 'golden', label: 'GOLDEN HOUR' },
  { id: 'dusk', label: 'DUSK' },
];
// Per-job planning data for the Venn chain: the vault value (gross), the
// three ways in, and the bases the live stats are computed from. The gross
// figures are set so the staged house crew (Dex + Milo, fence 18%) settles
// to the chain's established nets: 400 / 700 / 900 / 1,200 / 2,000.
export const JOB_PLANS = [
  { gross: 610, alarmBase: 46, heatBase: 2.1, grabBase: 110, entries: ['MARINA GATE', 'SERVICE ROAD', 'BEACH APPROACH'] },
  { gross: 1067, alarmBase: 44, heatBase: 2.6, grabBase: 135, entries: ['STREET PARK', 'BACK ALLEY', 'SHOWROOM FRONT'] },
  { gross: 1372, alarmBase: 50, heatBase: 3.9, grabBase: 152, entries: ['PLAZA EAST', 'PRESS POOL', 'ROOF STAIR'] },
  { gross: 1829, alarmBase: 48, heatBase: 3.1, grabBase: 185, entries: ['MARKET DOOR', 'LOADING BAY', 'SIDE ALLEY'] },
  { gross: 3049, alarmBase: 52, heatBase: 3.8, grabBase: 240, entries: ['DEPOT GATE', 'YARD CRANE', 'FENCE CUT'] },
];
// Entry character: 0 standard, 1 quiet side way in, 2 bold and loud.
const ENTRY_MODS = [
  { alarm: 0, heat: 0 },
  { alarm: 4, heat: -0.2 },
  { alarm: -3, heat: 0.6 },
];
// Where an entry stages the crew relative to the job's target place.
const ENTRY_OFFSETS = [
  { x: 0, y: 0 },
  { x: -95, y: 60 },
  { x: 120, y: -75 },
];
export function crewById(id) { return CREW_POOL.find((c) => c.id === id) || null; }
export function getawayById(id) { return GETAWAYS.find((g) => g.id === id) || GETAWAYS[0]; }
export function jobPlanData(jobIndex) { return JOB_PLANS[((jobIndex % JOB_PLANS.length) + JOB_PLANS.length) % JOB_PLANS.length]; }

export function defaultPlan(jobIndex) {
  const cars = ['sedan', 'coupe', 'coupe', 'sedan', 'armored'];
  return {
    jobIndex, entry: 0, crew: ['dex', 'milo'], gear: ['duffels'],
    getaway: cars[((jobIndex % 5) + 5) % 5], timeOfDay: 'golden',
  };
}
// Live plan statistics — recomputed from the plan on every board change and
// read again by the execution, so board and street can never disagree.
export function planStats(jobIndex, plan, loop = 0) {
  const data = jobPlanData(jobIndex);
  const crew = CREW_POOL.filter((c) => plan.crew.includes(c.id));
  const totalCut = crew.reduce((s, c) => s + c.cut, 0);
  const avgSkill = crew.length ? Math.round(crew.reduce((s, c) => s + c.skill, 0) / crew.length) : 40;
  const fencePct = 18 - (plan.crew.includes('ruth') ? 4 : 0) - (plan.gear.includes('plates') ? 1 : 0);
  const loot = Math.round(data.gross * (1 + 0.25 * loop));
  const em = ENTRY_MODS[plan.entry] || ENTRY_MODS[0];
  let alarm = data.alarmBase + em.alarm + Math.round((avgSkill - 60) / 6);
  if (plan.gear.includes('tools')) alarm += 5;
  if (plan.gear.includes('quiet')) alarm += 6;
  if (plan.crew.includes('milo')) alarm += 4;
  let heat = data.heatBase + em.heat + (plan.timeOfDay === 'dusk' ? -0.3 : 0.2);
  if (plan.gear.includes('quiet')) heat -= 1.0;
  if (plan.gear.includes('plates')) heat -= 0.7;
  heat = Math.max(1, Math.min(5, heat));
  const gw = getawayById(plan.getaway);
  let escape = 20 + gw.topSpeed / 22;
  if (plan.gear.includes('smoke')) escape += 6;
  if (plan.gear.includes('scanner')) escape += 3;
  if (plan.crew.includes('sana')) escape += 5;
  let grab = data.grabBase * (1 + crew.length * 0.22);
  if (plan.gear.includes('duffels')) grab *= 1.25;
  if (plan.gear.includes('lockpicks')) grab *= 1.15;
  if (plan.crew.includes('dex')) grab *= 1.12;
  return {
    loot, alarm: Math.max(24, Math.round(alarm)), heat, heatStars: Math.round(heat),
    escape: Math.round(escape), grabRate: Math.round(grab),
    totalCut, avgSkill, fencePct,
  };
}
// The results ledger for one job: gross, the fence's fee, each named crew
// member's cut of what remains, the net the player banks, and REP. Every
// line is derived from the previous one, so the ledger always reconciles.
export function settlePlan(jobIndex, plan, gross) {
  const stats = planStats(jobIndex, plan);
  const fence = Math.round(gross * stats.fencePct / 100);
  const afterFence = gross - fence;
  const cuts = CREW_POOL.filter((c) => plan.crew.includes(c.id))
    .map((c) => ({ id: c.id, name: c.name, pct: c.cut, amount: Math.round(afterFence * c.cut / 100) }));
  const cutTotal = cuts.reduce((s, c) => s + c.amount, 0);
  const net = afterFence - cutTotal;
  const repGain = 20 + Math.round(net / 20);
  return { jobIndex, title: CHAIN[jobIndex % CHAIN.length].title, gross, fencePct: stats.fencePct, fence, cuts, cutTotal, net, repGain };
}
// The weapon the gear builds: the extended magazine is a real mag size the
// shooting code spends, not a caption.
export function weaponForPlan(plan) {
  const magSize = plan && plan.gear.includes('extmag') ? 18 : 12;
  return { name: 'VENN 9MM', magSize, mag: magSize, reserve: 48 };
}
// Wanted-decay pacing from the escape window: a longer window (faster car,
// smoke, Sana driving) cools the heat sooner. Returned in ms between star
// drops once the decay gate opens.
export function decayIntervalForPlan(plan, jobIndex) {
  const esc = planStats(jobIndex, plan).escape;
  return Math.round(Math.max(1700, Math.min(4200, 4600 - esc * 62)));
}
// The world position an entry stages the crew at, relative to the job target.
export function entrySpawn(def, plan) {
  const target = def.pickup || def.deliver;
  const off = ENTRY_OFFSETS[plan.entry] || ENTRY_OFFSETS[0];
  return { x: target.x + off.x, y: target.y + off.y };
}
// Board controls (shared by live keys and screenshot staging).
export function cycleEntry(plan, dir) { plan.entry = (plan.entry + dir + 3) % 3; }
export function cycleGetaway(plan, dir) {
  const i = GETAWAYS.findIndex((g) => g.id === plan.getaway);
  plan.getaway = GETAWAYS[(i + dir + GETAWAYS.length) % GETAWAYS.length].id;
}
export function cycleTime(plan, dir) {
  const i = TIMES.findIndex((t) => t.id === plan.timeOfDay);
  plan.timeOfDay = TIMES[(i + dir + TIMES.length) % TIMES.length].id;
}
export function toggleCrew(plan, id) {
  const i = plan.crew.indexOf(id);
  if (i >= 0) { plan.crew.splice(i, 1); return true; }
  if (plan.crew.length < 3) { plan.crew.push(id); return true; }
  return false;
}
export function toggleGear(plan, id) {
  const i = plan.gear.indexOf(id);
  if (i >= 0) { plan.gear.splice(i, 1); return true; }
  if (plan.gear.length < 3) { plan.gear.push(id); return true; }
  return false;
}
export function formatMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
