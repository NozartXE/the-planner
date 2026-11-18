// planning.js — the planning board state machine: which heist, entry, crew,
// gear, getaway and time of day. Pure state + hit-rect layout shared with the
// renderer, so clicks and drawing always agree.
import { HEISTS, CREW_POOL, GEAR_POOL, GETAWAY_CHOICES, defaultPlan, planStats } from './heists.js';
import { TIMES_OF_DAY } from './config.js';

export class PlanningBoard {
  constructor(save) {
    this.save = save;
    this.heistIndex = 0;
    this.plan = defaultPlan(HEISTS[0]);
    this.message = '';
  }
  get heist() { return HEISTS[this.heistIndex]; }
  get stats() { return planStats(this.heist, this.plan); }
  selectHeist(i) {
    if (i < 0 || i >= HEISTS.length) return;
    if (i >= this.save.unlocked) { this.message = 'LOCKED — finish the previous job first.'; return; }
    this.heistIndex = i;
    const keep = { timeOfDay: this.plan.timeOfDay };
    this.plan = { ...defaultPlan(this.heist), ...keep };
    this.message = '';
  }
  cycleEntry(dir) { this.plan.entry = (this.plan.entry + dir + 3) % 3; }
  toggleCrew(id) {
    const i = this.plan.crew.indexOf(id);
    if (i >= 0) this.plan.crew.splice(i, 1);
    else if (this.plan.crew.length < 3) this.plan.crew.push(id);
    else this.message = 'Crew is full — three roles max.';
  }
  toggleGear(id) {
    const i = this.plan.gear.indexOf(id);
    if (i >= 0) this.plan.gear.splice(i, 1);
    else if (this.plan.gear.length < 3) this.plan.gear.push(id);
    else this.message = 'Gear bag is full — three slots max.';
  }
  cycleGetaway(dir) {
    const cur = GETAWAY_CHOICES.indexOf(this.plan.getaway);
    // Only owned cars can be picked beyond the starter compact.
    for (let step = 1; step <= GETAWAY_CHOICES.length; step++) {
      const cand = GETAWAY_CHOICES[(cur + dir * step + GETAWAY_CHOICES.length * 2) % GETAWAY_CHOICES.length];
      if (this.save.garage.includes(cand) || cand === 'compact') { this.plan.getaway = cand; return; }
    }
  }
  cycleTime(dir) {
    const cur = TIMES_OF_DAY.indexOf(this.plan.timeOfDay);
    this.plan.timeOfDay = TIMES_OF_DAY[(cur + dir + TIMES_OF_DAY.length) % TIMES_OF_DAY.length];
  }
  // Keyboard control of the board (also used by screenshot staging).
  handleKey(key) {
    if (key === 'arrowleft') this.selectHeist(this.heistIndex - 1);
    else if (key === 'arrowright') this.selectHeist(this.heistIndex + 1);
    else if (key === 'e') this.cycleEntry(1);
    else if (key === 'g') this.cycleGetaway(1);
    else if (key === 't') this.cycleTime(1);
    else if (key >= '1' && key <= '6') { const c = CREW_POOL[Number(key) - 1]; if (c) this.toggleCrew(c.id); }
  }
  summaryLines() {
    const s = this.stats;
    return [
      `TARGET  ${this.heist.name}`,
      `ENTRY   ${this.heist.entries[this.plan.entry]}`,
      `CREW    ${this.plan.crew.length}/3  (cut ${s.totalCut}%)`,
      `GEAR    ${this.plan.gear.length}/3`,
      `GETAWAY ${this.plan.getaway.toUpperCase()} · ${this.plan.timeOfDay.toUpperCase()}`,
    ];
  }
}
export { CREW_POOL, GEAR_POOL, GETAWAY_CHOICES };
