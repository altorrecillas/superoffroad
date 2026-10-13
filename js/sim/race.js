// Race rules: grid, countdown, laps, positions, pickups (nitro / money bags),
// finishing order, CPU difficulty adjustment (the arcade's "DPA").

import { TruckSim, truckStats, collideTrucks } from './truck.js';
import { AIDriver } from './ai.js';
import { randomTrackSpot, WALL_FACE } from './track.js';
import { rng, clamp, wrapAngle } from './util.js';

export const LAPS = 4;
// a human truck driven from this device: in a two-phone race the other player's
// truck is a human one too (for the rules) but `remote` (shown like a rival)
export const mine = (r) => !!r && r.human && !r.remote;
export const COUNTDOWN = 3.6;
export const LATE_LIMIT = 30;   // seconds the field has to finish after the winner

export class Race {
  constructor(track, entries, opts = {}) {
    this.track = track;
    this.laps = opts.laps ?? LAPS;
    this.r = rng(opts.seed ?? 12345);
    this.pickupsOn = opts.pickups ?? true; // 'manual': none appear on their own (the tutorial places them)
    // catch-up (the arcade's DPA): ease off when ahead of the player / push when behind
    this.dpaDown = opts.dpaDown ?? opts.dpa ?? 0.07;
    this.dpaUp = opts.dpaUp ?? opts.dpa ?? 0.07;
    this.catchUp = opts.catchUp ?? 0;  // how much sharper a CPU driver gets behind the player (0..1)
    this.state = 'countdown';
    this.time = -COUNTDOWN;   // race clock (negative during the countdown)
    this.events = [];
    this.pickups = [];
    this.nextPickup = 3 + this.r() * 3;
    this.finishOrder = [];
    this.doneT = 0;
    this.rain = !!opts.rain;
    this.racers = entries.map((e, i) => {
      const truck = new TruckSim(i, truckStats(e.upgrades, e.vehicle));
      // a wet track: less grip and slower turning (the CPU drivers plan with these numbers)
      if (this.rain) { truck.stats.grip *= 0.86; truck.stats.yaw *= 0.96; }
      truck.nitros = e.nitros ?? 10;
      const slot = track.grid[e.slot ?? i];
      truck.place(slot.x, slot.z, slot.h, track);
      truck.frozen = true;
      const rc = {
        i, entry: e, truck, human: !!e.human,
        idx: track.nearestIndex(slot.x, slot.z),
        prog: slot.s, lap: 0, finished: false, place: 0, finishTime: 0,
        lapStart: 0, lastLap: 0, bestLap: 0,
        money: 0, nitrosCollected: 0,
        wrongT: 0, wrongWay: false,
        ai: null,
      };
      if (!rc.human) rc.ai = new AIDriver(truck, track, { ...e.ai, seed: (opts.seed ?? 1) * 31 + i * 7 });
      return rc;
    });
    this.order = this.racers.slice();
  }

  get trucks() { return this.racers.map((r) => r.truck); }

  step(dt, inputs = []) {
    this.events.length = 0;
    const tr = this.track;
    this.time += dt;
    if (this.state === 'countdown' && this.time >= 0) {
      this.state = 'race';
      for (const r of this.racers) r.truck.frozen = false;
      this.events.push(['go']);
    }
    const trucks = this.trucks;
    for (const r of this.racers) {
      const t = r.truck;
      let inp;
      if (this.state === 'countdown') {
        // engines rev on the grid; the CPU blips the throttle (no AI logic yet: it would think it is stuck)
        if (r.human && !this.autopilot) t.throttle = (inputs[r.entry.player] || COAST).throttle;
        else t.throttle = Math.sin(this.time * (5 + r.i) + r.i * 2) > 0.2 ? 1 : 0;
        continue;
      }
      // the race over: the winner celebrates, the rest roll to a stop out of its way
      if (this.state === 'done' && this.donuts !== false) inp = r === this.finishOrder[0] && !r.dnf ? this._donut(r, dt) : this._parking(r, dt, trucks);
      else if (r.finished && r.human) {
        // cool-down lap on autopilot
        if (!r.ai) r.ai = new AIDriver(t, tr, { skill: 0.35, aggression: 0, seed: 99 + r.i });
        inp = r.ai.update(dt, trucks);
        inp.nitro = false;
      }
      else if (r.human && (this.autopilot || r.bot)) {
        // autopilot (tests), or `bot`: a player who left a two-phone race, driven by the CPU
        if (!r.ai) r.ai = new AIDriver(t, tr, { skill: r.bot ? 0.9 : Math.max(0, this.autopilotSkill ?? 0.95), aggression: 0.7, seed: 7 + r.i });
        inp = r.ai.update(dt, trucks);
        if (this.autopilotSkill < 0) inp.throttle *= 0.45; // test: a hopeless driver
      } else if (r.human) inp = inputs[r.entry.player] || COAST;
      else { r.ai.lastLap = r.lap >= this.laps - 1; inp = r.ai.update(dt, trucks); }
      t.step(dt, inp, tr);
      for (const ev of t.events) this.events.push([ev[0], r.i, ...ev.slice(1)]);
    }
    if (this.state === 'countdown') return;

    // truck vs truck
    for (let a = 0; a < trucks.length; a++)
      for (let b = a + 1; b < trucks.length; b++) collideTrucks(trucks[a], trucks[b], this.events);

    // progress
    for (const r of this.racers) this._progress(r, dt);

    // positions
    this.order = this.racers.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.place - b.place;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.prog - a.prog;
    });
    this.order.forEach((r, i) => (r.pos = i + 1));

    this._dpa(dt);
    if (this.pickupsOn) this._pickups(dt);

    // end of race: everyone is done, or the humans are, or time runs out
    if (this.state === 'race') {
      const humans = this.racers.filter((r) => r.human);
      const allHumansDone = humans.length > 0 && humans.every((r) => r.finished);
      const allDone = this.racers.every((r) => r.finished);
      if (allHumansDone || allDone || (humans.length === 0 && this.finishOrder.length > 0)) this.doneT += dt;
      if (this.finishOrder.length) this.lateT = (this.lateT || 0) + dt;
      this.timeLeft = this.finishOrder.length ? Math.max(0, LATE_LIMIT - this.lateT) : null;
      if (allDone || this.doneT > 7 || this.lateT > LATE_LIMIT) this._finishRace();
    }
  }

  _progress(r, dt) {
    const tr = this.track, t = r.truck, p = tr.path;
    const i = tr.nearestIndex(t.x, t.z, r.idx);
    let d = (i - r.idx) * p.ds;
    if (d < -tr.L / 2) d += tr.L;
    if (d > tr.L / 2) d -= tr.L;
    r.idx = i;
    r.prog += d;
    // continuous progress inside a sample
    r.progFine = r.prog + ((t.x - p.x[i]) * p.tx[i] + (t.z - p.z[i]) * p.tz[i]);
    const lap = Math.floor(r.prog / tr.L);
    if (lap > r.lap && !r.finished) {
      r.lap = lap;
      const lt = this.time - r.lapStart;
      r.lapStart = this.time;
      if (lap >= 1) { r.lastLap = lt; if (!r.bestLap || lt < r.bestLap) r.bestLap = lt; }
      if (lap >= this.laps) {
        r.finished = true;
        this.finishOrder.push(r);
        r.place = this.finishOrder.length;
        r.finishTime = this.time;
        this.events.push(['finish', r.i, r.place, lt]);
      } else this.events.push(['lap', r.i, lap, lt]);
    }
    // wrong way: moving against the track direction
    const along = t.vx * p.tx[i] + t.vz * p.tz[i];
    if (along < -2.5 && !t.air) r.wrongT += dt; else r.wrongT = Math.max(0, r.wrongT - dt * 3);
    const ww = r.wrongT > 1.2;
    if (ww && !r.wrongWay) this.events.push(['wrongway', r.i]);
    r.wrongWay = ww;
  }

  // Catch-up, both ways: a CPU truck ahead of the best player eases off (its driver
  // aims for lower speeds), one behind gets more engine (real acceleration and top
  // speed, so it gains on the straights without taking the corners any faster)
  _dpa(dt) {
    const humans = this.racers.filter((r) => r.human && !r.finished);
    const k = Math.min(1, dt * 0.5);
    if (!humans.length) {
      for (const r of this.racers) if (r.ai) { r.ai.dpa += (1 - r.ai.dpa) * dt; r.ai.push += (0 - r.ai.push) * dt; r.truck.power += (1 - r.truck.power) * dt; }
      return;
    }
    const best = Math.max(...humans.map((h) => h.prog));
    for (const r of this.racers) {
      if (!r.ai || r.human) continue;
      const gap = r.prog - best; // + ahead of the best human
      const sc = r.entry.ai?.dpaScale ?? 1;
      // a short lead (under 15 m) is the player's to defend; beyond it the CPU fights back
      const behind = gap < -15 ? Math.min(1, (-gap - 15) / 40) : 0;
      const down = gap > 0 ? 1 - Math.min(1, gap / 35) * this.dpaDown * sc : 1;
      r.ai.dpa += (down - r.ai.dpa) * k;
      // the waiting is per driver (Ironman waits less), the fighting back is for everyone
      r.ai.push += (behind * this.catchUp - r.ai.push) * k;
      r.truck.power += (1 + behind * this.dpaUp - r.truck.power) * k;
    }
  }

  _pickups(dt) {
    if (this.state !== 'race') return;
    this.nextPickup -= dt;
    const live = this.pickups.filter((p) => !p.taken);
    if (this.pickupsOn !== 'manual' && this.nextPickup <= 0 && live.length < 3) {
      this.nextPickup = 3.5 + this.r() * 4.5;
      const spot = randomTrackSpot(this.track, this.r, [...live, ...this.trucks]);
      if (spot) {
        const money = this.r() < 0.42;
        const values = [10000, 10000, 20000, 20000, 30000, 50000];
        this.pickups.push({
          id: (this._pid = (this._pid || 0) + 1),
          type: money ? 'money' : 'nitro',
          value: money ? values[Math.floor(this.r() * values.length)] : 1,
          x: spot.x, z: spot.z, y: this.track.heightAt(spot.x, spot.z),
          age: 0, life: 11 + this.r() * 5, taken: false,
        });
        this.events.push(['pickupspawn', this.pickups[this.pickups.length - 1].id]);
      }
    }
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      pk.age += dt;
      if (pk.age > pk.life) { pk.taken = true; pk.expired = true; continue; }
      for (const r of this.racers) {
        const t = r.truck;
        if ((t.x - pk.x) ** 2 + (t.z - pk.z) ** 2 < 2.4 * 2.4 && Math.abs(t.y - pk.y) < 1.8) {
          pk.taken = true; pk.by = r.i;
          if (pk.type === 'nitro') { t.nitros = Math.min(99, t.nitros + 1); r.nitrosCollected++; }
          else r.money += pk.value;
          this.events.push(['pickup', r.i, pk.type, pk.value, pk.x, pk.z]);
          break;
        }
      }
    }
    this.pickups = this.pickups.filter((p) => !p.taken);
  }

  // The race over, the winner celebrates: donuts round a point where the barriers are
  // far enough (most circuits are a corridor of ten metres): it rolls on calmly along
  // the middle of the track, stops and spins a few turns, then stays put. The same in
  // every replay of the race (nothing random).
  _donut(r, dt) {
    const t = r.truck, tr = this.track, p = tr.path;
    const D = r.donut || (r.donut = { phase: 'seek', t: 0, spun: 0 });
    const roomAt = (x, z) => WALL_FACE - tr.sdfAt(x, z); // to the nearest barrier
    const flat = !t.air && t.hAbove < 0.1 && t.water < 0.05;
    // towards the middle of the track a few metres ahead
    const j = (r.idx + Math.round(7 / p.ds)) % p.n;
    const steer = clamp(wrapAngle(Math.atan2(p.z[j] - t.z, p.x[j] - t.x) - t.h) * 2.2, -1, 1);
    D.t += dt;
    if (D.phase === 'seek') {
      if (D.t > 0.8 && roomAt(t.x, t.z) > 4.1 && flat) { D.phase = 'stop'; D.t = 0; }
      else return { steer, throttle: t.speed < 6 ? 0.6 : 0, brake: t.speed > 9 ? 0.6 : 0, nitro: false };
    }
    if (D.phase === 'stop') {
      if (t.speed > 1.6) return { steer, throttle: 0, brake: t.vf > 0.8 ? 1 : 0, nitro: false }; // (the brake reverses below that)
      // the point to go round: beside the truck, on the side with more room (the truck
      // reaches 1 + 2.5 m from it)
      const R = 1, rx = -Math.sin(t.h), rz = Math.cos(t.h);
      let best = null;
      for (const s of [1, -1]) {
        const cx = t.x + rx * s * R, cz = t.z + rz * s * R, room = roomAt(cx, cz);
        if (!best || room > best.room) best = { cx, cz, room, s };
      }
      if (best.room < 3.8 || !flat) { D.phase = 'seek'; D.t = 0; return { steer, throttle: 0.6, brake: 0, nitro: false }; }
      Object.assign(D, { phase: 'spin', cx: best.cx, cz: best.cz, s: best.s, r: R });
    }
    if (D.phase === 'spin') {
      D.spun += dt;
      // the tail swings out, a few turns, and it slows to a stop
      if (D.spun < 6.5) return { steer: D.s, throttle: 1, brake: 0, nitro: false, spin: true, cx: D.cx, cz: D.cz, r: D.r, k: Math.min(1, D.spun / 0.6), wk: Math.min(1, (6.5 - D.spun) / 0.7) };
      D.phase = 'end';
      t.vx = t.vz = 0; t.w = 0;
    }
    return { steer: 0, throttle: 0, brake: t.vf > 0.8 ? 1 : 0, nitro: false };
  }

  _parking(r, dt, trucks) {
    if (!r.ai) r.ai = new AIDriver(r.truck, this.track, { skill: 0.35, aggression: 0, seed: 99 + r.i });
    const inp = r.ai.update(dt, trucks); // (its steering, along the track)
    inp.nitro = false; inp.throttle = 0; inp.brake = r.truck.vf > 0.8 ? 0.7 : 0; // (at a crawl the brake would reverse)
    return inp;
  }

  _finishRace() {
    if (this.state === 'done') return;
    this.state = 'done';
    // unfinished trucks take the remaining places by progress
    const rest = this.racers.filter((r) => !r.finished).sort((a, b) => b.prog - a.prog);
    for (const r of rest) {
      this.finishOrder.push(r);
      r.place = this.finishOrder.length;
      r.dnf = true;
    }
    this.events.push(['racedone']);
  }
}

const COAST = { steer: 0, throttle: 0, brake: 0, nitro: false };
