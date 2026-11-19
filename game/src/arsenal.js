// arsenal.js — the full 56-weapon table for AMBER COAST (Rect's directive,
// 2026-11-19): 10 assault rifles, 10 SMGs, 5 machine guns, 7 shotguns,
// 8 sniper rifles, 6 rocket launchers (46) + 10 explosives (56 total).
// Every entry is an ORIGINAL fictional name (no real brands, no GTA names)
// with distinct stats the combat code actually consumes: damage per hit,
// fire rate (rounds per second), effective range (world units), spread
// (radians), magazine size, reserve and reload time. Explosives differ in
// BEHAVIOUR (see `behavior`), not just numbers: thrown arc, planted remote,
// sticky remote, proximity trigger, timer satchel, lingering fire patch,
// area-denial gas cloud, distraction flare and a concussion flash.
// The VENN 9MM the game shipped with is one entry of this table (SMG class);
// the plan's EXTENDED MAG gear multiplies the table magazine by 1.5, which
// is exactly its original 12 -> 18 coupling.
export const WEAPON_CLASSES = [
  { id: 'AR', label: 'ASSAULT RIFLES' },
  { id: 'SMG', label: 'SUBMACHINE GUNS' },
  { id: 'MG', label: 'MACHINE GUNS' },
  { id: 'SG', label: 'SHOTGUNS' },
  { id: 'SR', label: 'SNIPER RIFLES' },
  { id: 'RL', label: 'ROCKET LAUNCHERS' },
  { id: 'EXP', label: 'EXPLOSIVES' },
];
// dmg = damage per projectile/pellet, rps = rounds per second, rng = range
// in world units, spr = spread radians, mag/res = magazine / reserve,
// rel = reload ms, pel = pellets per shot (shotguns), beh = explosive behaviour.
const W = (id, cls, name, dmg, rps, rng, spr, mag, res, rel, extra) => Object.assign({ id, cls, name, damage: dmg, rps, range: rng, spread: spr, mag, reserve: res, reloadMs: rel }, extra || {});
export const WEAPONS = [
  // ---- Assault rifles (10) ----
  W('ar-kestrel', 'AR', 'KESTREL AR-7', 22, 9.0, 460, 0.020, 30, 180, 1900),
  W('ar-vandal', 'AR', 'VANDAL VK-4', 26, 7.5, 430, 0.026, 30, 180, 2000),
  W('ar-meridian', 'AR', 'MERIDIAN M9', 20, 10.5, 480, 0.018, 32, 192, 1800),
  W('ar-halcyon', 'AR', 'HALCYON H-2', 24, 8.2, 520, 0.016, 28, 168, 2100),
  W('ar-bramble', 'AR', 'BRAMBLE B-11', 29, 6.8, 410, 0.030, 26, 156, 2200),
  W('ar-solano', 'AR', 'SOLANO S-5', 21, 9.6, 450, 0.022, 30, 210, 1750),
  W('ar-cinder', 'AR', 'CINDER C-8', 27, 7.9, 440, 0.024, 24, 144, 2050),
  W('ar-talon', 'AR', 'TALON T-3', 19, 11.0, 470, 0.019, 36, 216, 1850),
  W('ar-onyx', 'AR', 'ONYX OX-6', 31, 6.2, 500, 0.021, 20, 120, 2300),
  W('ar-paloma', 'AR', 'PALOMA P-1', 23, 8.8, 465, 0.023, 30, 180, 1950),
  // ---- Submachine guns (10) — the VENN 9MM lives here ----
  W('venn-9mm', 'SMG', 'VENN 9MM', 13, 8.3, 300, 0.030, 12, 48, 1200),
  W('smg-wasp', 'SMG', 'WASP W-9', 11, 13.5, 260, 0.042, 24, 144, 1300),
  W('smg-drifter', 'SMG', 'DRIFTER D-4', 14, 10.0, 290, 0.036, 28, 168, 1400),
  W('smg-cobalt', 'SMG', 'COBALT C-6', 12, 12.2, 275, 0.038, 32, 192, 1250),
  W('smg-mire', 'SMG', 'MIRE M-2', 16, 8.8, 310, 0.033, 20, 120, 1500),
  W('smg-lumen', 'SMG', 'LUMEN L-7', 10, 15.0, 250, 0.048, 36, 216, 1350),
  W('smg-harbor', 'SMG', 'HARBOR H-5', 15, 9.4, 320, 0.031, 26, 156, 1450),
  W('smg-quill', 'SMG', 'QUILL Q-3', 13, 11.2, 285, 0.035, 30, 180, 1280),
  W('smg-sable', 'SMG', 'SABLE S-8', 17, 8.0, 330, 0.028, 18, 108, 1550),
  W('smg-tideline', 'SMG', 'TIDELINE T-6', 12, 12.8, 265, 0.040, 34, 204, 1320),
  // ---- Machine guns (5) ----
  W('mg-anvil', 'MG', 'ANVIL A-50', 24, 11.5, 470, 0.034, 75, 300, 4200),
  W('mg-granite', 'MG', 'GRANITE G-8', 28, 9.8, 490, 0.038, 90, 270, 4600),
  W('mg-tempest', 'MG', 'TEMPEST T-12', 21, 13.5, 450, 0.042, 60, 300, 3900),
  W('mg-bastion', 'MG', 'BASTION B-6', 32, 8.4, 510, 0.036, 100, 300, 5000),
  W('mg-hollowpoint', 'MG', 'HOLLOWAY HP-9', 26, 10.6, 480, 0.033, 80, 320, 4400),
  // ---- Shotguns (7) — damage is per pellet, pellets per shot in `pellets` ----
  W('sg-breaker', 'SG', 'BREAKER BK-12', 11, 1.6, 170, 0.085, 6, 36, 2600, { pellets: 7 }),
  W('sg-marsh', 'SG', 'MARSH M-870', 10, 1.3, 185, 0.078, 7, 42, 2800, { pellets: 8 }),
  W('sg-duet', 'SG', 'DUET D-2', 13, 1.1, 160, 0.095, 2, 30, 2400, { pellets: 8 }),
  W('sg-canal', 'SG', 'CANAL C-5', 9, 2.4, 175, 0.080, 8, 48, 2500, { pellets: 6 }),
  W('sg-warden', 'SG', 'WARDEN W-4', 12, 1.8, 180, 0.072, 6, 36, 2700, { pellets: 7 }),
  W('sg-flaregun', 'SG', 'EMBERLINE E-3', 14, 1.4, 165, 0.088, 5, 30, 2650, { pellets: 6 }),
  W('sg-tidewater', 'SG', 'TIDEWATER TW-6', 10, 2.0, 190, 0.075, 9, 54, 2550, { pellets: 7 }),
  // ---- Sniper rifles (8) ----
  W('sr-longbow', 'SR', 'LONGBOW L-1', 85, 0.9, 900, 0.002, 5, 30, 3200),
  W('sr-heron', 'SR', 'HERON H-7', 70, 1.3, 820, 0.003, 6, 36, 2900),
  W('sr-vesper', 'SR', 'VESPER V-4', 95, 0.7, 950, 0.0015, 4, 24, 3500),
  W('sr-cormorant', 'SR', 'CORMORANT C-2', 62, 1.7, 780, 0.004, 8, 48, 2700),
  W('sr-aldous', 'SR', 'ALDOUS A-9', 78, 1.1, 860, 0.0025, 5, 30, 3100),
  W('sr-nightjar', 'SR', 'NIGHTJAR N-5', 68, 1.5, 800, 0.0035, 7, 42, 2800),
  W('sr-pinnacle', 'SR', 'PINNACLE P-8', 105, 0.55, 1000, 0.001, 3, 18, 3800),
  W('sr-fathom', 'SR', 'FATHOM F-6', 74, 1.2, 840, 0.003, 6, 36, 3000),
  // ---- Rocket launchers (6) — damage is the warhead's blast damage ----
  W('rl-havoc', 'RL', 'HAVOC TUBE', 120, 0.8, 620, 0.006, 1, 8, 3600, { blast: 95 }),
  W('rl-maw', 'RL', 'MAW LAUNCHER', 140, 0.65, 580, 0.008, 1, 6, 3900, { blast: 110 }),
  W('rl-kite', 'RL', 'KITE K-1', 100, 1.0, 660, 0.005, 2, 8, 3400, { blast: 85 }),
  W('rl-breach', 'RL', 'BREACH B-3', 155, 0.55, 560, 0.009, 1, 5, 4200, { blast: 120 }),
  W('rl-sunder', 'RL', 'SUNDER S-7', 115, 0.85, 640, 0.006, 1, 7, 3700, { blast: 100 }),
  W('rl-cometfall', 'RL', 'COMETFALL CF-2', 130, 0.72, 600, 0.007, 2, 6, 3800, { blast: 105 }),
  // ---- Explosives (10) — each with a distinct behaviour ----
  W('exp-grenade', 'EXP', 'FRAG GRENADE', 90, 1.4, 240, 0.05, 1, 6, 600, { behavior: 'grenade', blast: 80 }),
  W('exp-c4', 'EXP', 'C4 CHARGE', 150, 1.0, 60, 0, 1, 4, 800, { behavior: 'remote', blast: 110 }),
  W('exp-molotov', 'EXP', 'MOLOTOV', 18, 1.6, 220, 0.05, 1, 6, 500, { behavior: 'molotov', blast: 40 }),
  W('exp-sticky', 'EXP', 'STICKY BOMB', 130, 1.2, 230, 0.04, 1, 5, 700, { behavior: 'sticky', blast: 100 }),
  W('exp-mine', 'EXP', 'PROXIMITY MINE', 110, 1.0, 40, 0, 1, 5, 700, { behavior: 'mine', blast: 85 }),
  W('exp-pipe', 'EXP', 'PIPE BOMB', 75, 1.5, 230, 0.05, 1, 6, 550, { behavior: 'pipe', blast: 70 }),
  W('exp-gas', 'EXP', 'TEAR GAS', 2, 1.6, 220, 0.05, 1, 5, 500, { behavior: 'gas', blast: 30 }),
  W('exp-flare', 'EXP', 'SIGNAL FLARE', 4, 1.8, 260, 0.04, 1, 6, 450, { behavior: 'flare', blast: 25 }),
  W('exp-satchel', 'EXP', 'SATCHEL CHARGE', 160, 0.9, 50, 0, 1, 3, 900, { behavior: 'satchel', blast: 120 }),
  W('exp-dazzler', 'EXP', 'DAZZLER POPPER', 6, 1.7, 235, 0.05, 1, 5, 500, { behavior: 'flash', blast: 45 }),
];
export function weaponById(id) { return WEAPONS.find((w) => w.id === id) || WEAPONS.find((w) => w.id === 'venn-9mm'); }
export function weaponsByClass(cls) { return WEAPONS.filter((w) => w.cls === cls); }
export function classCounts() { const c = {}; for (const w of WEAPONS) c[w.cls] = (c[w.cls] || 0) + 1; return c; }
// Build the live weapon object the shooting code spends. The table's
// magazine is the base; the plan's EXTENDED MAG gear multiplies it by 1.5
// (the VENN 9MM's original 12 -> 18 coupling, now table-driven).
export function buildWeapon(def, plan) {
  const ext = plan && plan.gear && plan.gear.includes('extmag');
  const magSize = def.cls === 'EXP' || def.cls === 'RL' ? def.mag : (ext ? Math.round(def.mag * 1.5) : def.mag);
  return {
    defId: def.id, cls: def.cls, name: def.name, behavior: def.behavior || null,
    damage: def.damage, rps: def.rps, range: def.range, spread: def.spread,
    blast: def.blast || 0, pellets: def.pellets || 1,
    magSize, mag: magSize, reserve: def.reserve, reloadMs: def.reloadMs, reloadUntil: 0,
  };
}
