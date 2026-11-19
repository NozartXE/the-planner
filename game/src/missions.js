// missions.js — Dario Venn's five-job story chain: briefings, markers, timers, forced heat and looped replays.
import { PLACES } from './config.js';
import { dist } from './rng.js';
export const CHAIN = [
  { title: 'First Run', brief: 'Dario Venn: Take the package at Marina del Sol to Solana Tower.', pickup: PLACES.port, deliver: PLACES.neonTower, time: 110, pay: 400, forcedOnPickup: 0 },
  { title: 'Borrowed Wheels', brief: "Dario Venn: Steal any car and bring it to Venn's Garage.", pickup: null, deliver: PLACES.garage, time: 85, pay: 700, requiresCar: true, forcedOnPickup: 0 },
  { title: 'Front Page', brief: 'Dario Venn: Pick up the reporter at Gazette Plaza. Heat will follow — reach Hotel Aurelia.', pickup: PLACES.gazette, deliver: PLACES.hotel, time: 95, pay: 900, forcedOnPickup: 2 },
  { title: 'Two Drops', brief: 'Dario Venn: Collect at Palm Market, drop at Gazette Plaza, then finish at Marina del Sol.', pickup: PLACES.market, drops: [PLACES.gazette, PLACES.port], time: 130, pay: 1200, forcedOnPickup: 0 },
  { title: 'Heavy Metal', brief: 'Dario Venn: Steal the marked armored sedan and deliver it to Marina del Sol.', pickup: null, deliver: PLACES.port, time: 120, pay: 2000, stealMarked: true, forcedOnPickup: 3 },
];
export class Missions {
  constructor() {
    this.index = 0;
    this.stage = 'idle'; // idle | pickup | deliver | dropA | dropB | steal | stealMarked | done
    this.timeLeft = 0;
    this.active = false;
    this.loop = 0;
    this.markedCar = null;
    this.briefUntil = 0;
    this.lastBrief = '';
    this.lootGrabbed = 0;
  }
  current() { return CHAIN[this.index % CHAIN.length]; }
  payFor(def) { return Math.round(def.pay * (1 + 0.25 * this.loop)); }
  start(now) {
    const def = this.current();
    this.active = true;
    this.timeLeft = def.time;
    this.lastBrief = def.brief;
    this.briefUntil = now + 6000;
    if (def.stealMarked) this.stage = 'stealMarked';
    else if (def.requiresCar) this.stage = 'steal';
    else if (def.pickup) this.stage = 'pickup';
    else this.stage = 'deliver';
    return def;
  }
  marker() {
    const def = this.current();
    if (!this.active) return null;
    if ((this.stage === 'pickup' || this.stage === 'grab') && def.pickup) return { x: def.pickup.x, y: def.pickup.y, color: 'pickup', label: def.pickup.name };
    if (this.stage === 'stealMarked' && this.markedCar) return { x: this.markedCar.x, y: this.markedCar.y, color: 'pickup', label: 'Armored sedan' };
    if (this.stage === 'steal') return { x: def.deliver.x, y: def.deliver.y, color: 'deliver', label: def.deliver.name, needsCar: true };
    if (this.stage === 'dropA' && def.drops) return { x: def.drops[0].x, y: def.drops[0].y, color: 'deliver', label: def.drops[0].name };
    if (this.stage === 'dropB' && def.drops) return { x: def.drops[1].x, y: def.drops[1].y, color: 'deliver', label: def.drops[1].name };
    if ((this.stage === 'deliver' || this.stage === 'steal') && def.deliver) return { x: def.deliver.x, y: def.deliver.y, color: 'deliver', label: def.deliver.name };
    if (this.stage === 'deliver' && def.drops) return { x: def.drops[0].x, y: def.drops[0].y, color: 'deliver', label: def.drops[0].name };
    return null;
  }
  // Ordered phase list for the current job definition, so the HUD's stage
  // pips count real stages of the chain the sim actually walks. Pickup jobs
  // walk a GRAB stage: the take accumulates at the plan's grab rate before
  // the run to the drop — the planning layer made visible in the chain.
  phases() {
    const def = this.current();
    if (def.stealMarked) return ['stealMarked', 'deliver'];
    if (def.requiresCar) return ['steal', 'deliver'];
    if (def.drops) return ['pickup', 'grab', 'dropA', 'dropB'];
    if (def.pickup) return ['pickup', 'grab', 'deliver'];
    return ['deliver'];
  }
  phaseInfo() {
    const ph = this.phases();
    const idx = Math.max(0, ph.indexOf(this.stage));
    return { index: this.active ? idx + 1 : 0, total: ph.length };
  }
  nextText() {
    if (!this.active) return '';
    const m = this.marker();
    if (this.stage === 'grab') return 'Grab the take at ' + this.current().pickup.name;
    if (this.stage === 'pickup') return 'Reach ' + this.current().pickup.name;
    if (this.stage === 'steal') return 'Steal a car, then reach ' + this.current().deliver.name;
    if (this.stage === 'stealMarked') return 'Steal the marked armored sedan';
    if (m) return 'Reach ' + m.label;
    return this.current().title;
  }
  headline() {
    if (!this.active) return '';
    const def = this.current();
    const m = this.marker();
    if (this.stage === 'grab') return `${def.title}: grabbing the take`;
    if (this.stage === 'pickup') return `${def.title}: reach ${def.pickup.name}`;
    if (this.stage === 'steal') return `${def.title}: steal a car, deliver to ${def.deliver.name}`;
    if (this.stage === 'stealMarked') return `${def.title}: steal the marked sedan`;
    if (m) return `${def.title}: reach ${m.label}`;
    return def.title;
  }
  onPlayerDeath(now) {
    if (!this.active) return;
    const def = this.current();
    this.timeLeft = def.time;
    if (def.stealMarked) this.stage = 'stealMarked';
    else if (def.requiresCar) this.stage = 'steal';
    else if (def.pickup) this.stage = 'pickup';
    else this.stage = 'deliver';
    this.lastBrief = 'Back up. ' + def.brief;
    this.briefUntil = now + 4500;
  }
  // ctx: { player, now, addMoney(n), setWanted(n), toast(msg), sfx, onChainDone() }
  update(dt, ctx) {
    if (!this.active) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.active = false; this.stage = 'idle';
      if (ctx.toast) ctx.toast('Mission failed — out of time. See Venn to retry.');
      if (ctx.sfx) ctx.sfx.fail();
      return;
    }
    const def = this.current();
    const p = ctx.player;
    const at = (place, r) => place && dist(p.x, p.y, place.x, place.y) < (r || 44);
    if (this.stage === 'pickup' && at(def.pickup)) {
      if (ctx.sfx) ctx.sfx.pickup();
      // The grab: loot accumulates at the plan's crew-driven grab rate; when
      // the take is full the alarm trips at the plan's forecast heat (which
      // replaces the old fixed forced heat for planned jobs).
      this.stage = 'grab';
      this.lootGrabbed = 0;
      if (ctx.toast) ctx.toast('Grabbing the take…');
      return;
    }
    if (this.stage === 'grab') {
      const target = ctx.grabTarget ? ctx.grabTarget() : 0;
      const rate = ctx.grabRate ? ctx.grabRate() : 99999;
      this.lootGrabbed = Math.min(target, (this.lootGrabbed || 0) + rate * dt);
      if (this.lootGrabbed >= target) {
        if (ctx.onGrabDone) ctx.onGrabDone(this.lootGrabbed);
        if (def.drops) { this.stage = 'dropA'; if (ctx.toast) ctx.toast('Take secured — first drop: ' + def.drops[0].name); }
        else { this.stage = 'deliver'; if (ctx.toast) ctx.toast('Take secured — deliver to ' + def.deliver.name); }
      }
      return;
    }
    if (this.stage === 'stealMarked') {
      if (this.markedCar && p.inCar && p.car === this.markedCar) {
        this.stage = 'deliver';
        ctx.setWanted(def.forcedOnPickup || 3);
        if (ctx.toast) ctx.toast('Sedan secured — get it to Marina del Sol.');
      }
      return;
    }
    if (this.stage === 'steal') {
      if (p.inCar) this.stage = 'deliver';
      return;
    }
    if (this.stage === 'dropA' && at(def.drops[0])) { this.stage = 'dropB'; if (ctx.sfx) ctx.sfx.deliver(); if (ctx.toast) ctx.toast('First drop done — final drop: ' + def.drops[1].name); return; }
    const finalPlace = this.stage === 'dropB' ? def.drops[1] : def.deliver;
    if ((this.stage === 'deliver' || this.stage === 'dropB') && at(finalPlace)) {
      if (def.requiresCar && !p.inCar) { if (ctx.toast && Math.random() < 0.01) ctx.toast('You need to arrive in a car.'); return; }
      // The context settles the plan's ledger (gross to net) when it can;
      // the plain payFor path remains for unplanned (legacy) runs.
      const pay = ctx.payFor ? ctx.payFor(def, this.lootGrabbed || 0) : this.payFor(def);
      ctx.addMoney(pay);
      if (ctx.sfx) ctx.sfx.jingle();
      if (ctx.toast) ctx.toast(`Job done: ${def.title} — $${pay}`);
      this.active = false; this.stage = 'idle';
      this.index += 1;
      if (this.index >= CHAIN.length) { this.index = 0; this.loop += 1; if (ctx.onChainDone) ctx.onChainDone(); }
      if (ctx.onMissionComplete) ctx.onMissionComplete(def, pay);
    }
  }
}
