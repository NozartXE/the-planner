// heists.js — the eight campaign heists, planning data (entries, crew, gear,
// getaway cars), and the plan-stat maths the planning board shows live.
import { CAR_CLASSES } from './vehicles.js';

export const CREW_POOL = [
  { id: 'dex', name: 'DEX "FINGERS" RUIZ', role: 'LOCKSMITH', skill: 82, cut: 12, perk: 'Faster loot grab on vaults', color: '#ffd60a' },
  { id: 'priya', name: 'PRIYA NAIR', role: 'HACKER', skill: 88, cut: 14, perk: 'Cameras blind for longer', color: '#4cc9f0' },
  { id: 'bo', name: 'BIG BO KOWALSKI', role: 'MUSCLE', skill: 74, cut: 10, perk: 'Crew shrugs off one takedown', color: '#ef476f' },
  { id: 'sana', name: 'SANA IBRAHIM', role: 'DRIVER', skill: 90, cut: 15, perk: 'Getaway car starts closer + tougher', color: '#06d6a0' },
  { id: 'milo', name: 'MILO VANCE', role: 'LOOKOUT', skill: 70, cut: 8, perk: 'Alarm delay +4 s', color: '#ff9770' },
  { id: 'ruth', name: 'RUTH CALLAHAN', role: 'FENCE CONTACT', skill: 78, cut: 11, perk: 'Fence fee 4% lower', color: '#c77dff' },
];

export const GEAR_POOL = [
  { id: 'cutters', name: 'BOLT CUTTERS', desc: 'Side entries open silently' },
  { id: 'jammer', name: 'SIGNAL JAMMER', desc: 'JAM gadget recharges twice as fast' },
  { id: 'vests', name: 'KEVLAR VESTS', desc: 'You and crew take 30% less damage' },
  { id: 'duffels', name: 'BIG DUFFELS', desc: 'Loot grab rate +25%' },
  { id: 'thermite', name: 'THERMITE', desc: 'Vault loot value +20%' },
  { id: 'plates', name: 'CLEAN PLATES', desc: 'Heat forecast −1 star of pressure' },
  { id: 'smoke', name: 'SMOKE POTS', desc: 'Escape window +6 s of low visibility' },
  { id: 'scanner', name: 'POLICE SCANNER', desc: 'Police blips always on minimap' },
  { id: 'tools', name: 'PRO TOOLS', desc: 'Alarm delay +5 s' },
  { id: 'tires', name: 'RUN-FLAT TYRES', desc: 'Getaway ignores the first spike strip' },
];

export const GETAWAY_CHOICES = ['compact', 'sedan', 'suv', 'sports'];

export const HEISTS = [
  { id: 'casino-vault', name: 'AURUM GRAND VAULT', kind: 'casino', baseLoot: 42000, grabRate: 2600, alarmBase: 55, camDensity: 0.8, guardHeat: 26,
    brief: 'Mara Voss: "The Aurum Grand launders river money through its vault. Hit it classy, hit it once."',
    entries: ['FRONT LOBBY', 'SERVICE CORRIDOR', 'ROOF SKYLIGHT'] },
  { id: 'bank-vault', name: 'MERIDIAN TRUST VAULT', kind: 'bank', baseLoot: 55000, grabRate: 3000, alarmBase: 50, camDensity: 0.9, guardHeat: 30,
    brief: 'Mara Voss: "Meridian Trust insures everything twice. The vault is the only honest room in the building."',
    entries: ['MAIN HALL', 'VAULT TUNNEL', 'LOADING BAY'] },
  { id: 'jewelry-exchange', name: 'VELMARA JEWELRY EXCHANGE', kind: 'jewelry', baseLoot: 36000, grabRate: 3400, alarmBase: 42, camDensity: 0.7, guardHeat: 22,
    brief: 'Mara Voss: "Small stones, big margins. Velmara keeps the good trays at the back — grab fast, smile for no one."',
    entries: ['SHOWROOM DOOR', 'BACK OFFICE', 'DISPLAY SMASH'] },
  { id: 'museum-gem', name: 'HALCYON MUSEUM — THE TIDE GEM', kind: 'museum', baseLoot: 48000, grabRate: 2400, alarmBase: 60, camDensity: 1.0, guardHeat: 24,
    brief: 'Mara Voss: "One gem, one glass box, forty cameras. The Tide Gem leaves Meridian tonight — with you."',
    entries: ['GRAND HALL', 'RESTORATION WING', 'SKYLIGHT RIG'] },
  { id: 'port-container', name: 'PORTSIDE CONTAINER 4417', kind: 'warehouse', baseLoot: 39000, grabRate: 3600, alarmBase: 46, camDensity: 0.4, guardHeat: 18,
    brief: 'Mara Voss: "Container 4417 holds untaxed electronics and exactly zero paperwork. The port sleeps early."',
    entries: ['GATE A', 'CRANE YARD', 'FENCE CUT'] },
  { id: 'data-centre', name: 'NOVACORE DATA CENTRE', kind: 'data', baseLoot: 51000, grabRate: 2800, alarmBase: 52, camDensity: 1.0, guardHeat: 28,
    brief: 'Mara Voss: "The client wants one cold-storage drive. Everything else in that vault is a bonus — and leverage."',
    entries: ['LOBBY AIRLOCK', 'COOLING PLANT', 'SERVICE LIFT'] },
  { id: 'armored-ambush', name: 'ARMORED TRUCK AMBUSH', kind: 'bank', baseLoot: 62000, grabRate: 3800, alarmBase: 38, camDensity: 0.5, guardHeat: 36,
    brief: 'Mara Voss: "The Foundry Mule runs AURUM WAY at shift change. Stop it, empty it, be a ghost before the escort wakes."',
    entries: ['RAMMING STOP', 'REAR DOORS', 'DRIVER CAB'] },
  { id: 'racetrack-strongroom', name: 'SOLACE CIRCUIT STRONGROOM', kind: 'racetrack', baseLoot: 70000, grabRate: 3200, alarmBase: 58, camDensity: 0.85, guardHeat: 32,
    brief: 'Mara Voss: "Derby day takings, one strongroom, every cop in the Mile on duty. This is the big one, planner."',
    entries: ['PADDOCK GATE', 'BETTING HALL', 'WINNERS TUNNEL'] },
];

export function heistById(id) { return HEISTS.find((h) => h.id === id) || HEISTS[0]; }

// A default plan for a heist.
export function defaultPlan(heist) {
  return { heistId: heist.id, entry: 0, crew: ['dex', 'priya'], gear: ['duffels'], getaway: 'sedan', timeOfDay: 'night' };
}

// Live plan statistics — every number here is consumed by execution.
export function planStats(heist, plan) {
  const crew = CREW_POOL.filter((c) => plan.crew.includes(c.id));
  const totalCut = crew.reduce((s, c) => s + c.cut, 0);
  const avgSkill = crew.length ? crew.reduce((s, c) => s + c.skill, 0) / crew.length : 40;
  let loot = heist.baseLoot;
  if (plan.gear.includes('thermite')) loot *= 1.2;
  if (plan.timeOfDay === 'night') loot *= 1.08; // night premium: fuller tills, quieter floors
  let alarm = heist.alarmBase;
  if (plan.gear.includes('tools')) alarm += 5;
  if (crew.some((c) => c.id === 'milo')) alarm += 4;
  alarm += Math.round((avgSkill - 60) / 6);
  if (plan.entry === 1) alarm += 4; // side entries are quieter
  if (plan.entry === 2) alarm -= 3; // bold entries trip alarms sooner
  let heat = 2 + heist.guardHeat / 22;
  if (plan.gear.includes('plates')) heat -= 0.7;
  if (plan.timeOfDay === 'night') heat -= 0.4;
  if (plan.timeOfDay === 'day') heat += 0.5;
  heat += plan.entry === 2 ? 0.5 : 0;
  let escape = 26 + CAR_CLASSES[plan.getaway].topSpeed / 22;
  if (plan.gear.includes('smoke')) escape += 6;
  if (crew.some((c) => c.id === 'sana')) escape += 5;
  let grab = heist.grabRate * (1 + crew.length * 0.22);
  if (plan.gear.includes('duffels')) grab *= 1.25;
  if (crew.some((c) => c.id === 'dex')) grab *= 1.12;
  const camBlind = crew.some((c) => c.id === 'priya') ? 1.6 : 1.0;
  return {
    loot: Math.round(loot), alarm: Math.max(24, Math.round(alarm)), heat: Math.max(1, Math.min(5, heat)),
    escape: Math.round(escape), grabRate: Math.round(grab), totalCut, avgSkill: Math.round(avgSkill), camBlind,
  };
}

export function gradeFor(takeRatio, seconds, heatStars) {
  let score = takeRatio * 60 - Math.max(0, seconds - 150) * 0.12 - heatStars * 4;
  if (score >= 52) return 'S';
  if (score >= 42) return 'A';
  if (score >= 30) return 'B';
  return 'C';
}
