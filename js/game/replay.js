// Race replays. The simulation is deterministic: the same circuit, entries, seed and
// per-step player inputs give exactly the same race, to the last bit. So a replay is
// just that: the recipe of the race plus what the players pressed (4 bytes per player
// per simulation step, ~30 KB a minute), played back through a new simulation. The
// recording also notes the moments worth watching (jumps, crashes, overtakes, the
// finish) for the replay director, who therefore knows what is about to happen.

import { Race } from '../sim/race.js';

const BYTES = 4;
const COAST = { steer: 0, throttle: 0, brake: 0, nitro: false };
const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);

// Inputs are rounded to what a replay can store BEFORE the live simulation uses them,
// so the race that is recorded is exactly the race that was driven.
export function quantize(src, dst) {
  const s = src.steer > 1 ? 1 : src.steer < -1 ? -1 : src.steer || 0;
  dst.steer = Math.round(s * 127) / 127;
  dst.throttle = Math.round(clamp01(src.throttle || 0) * 255) / 255;
  dst.brake = Math.round(clamp01(src.brake || 0) * 255) / 255;
  dst.nitro = !!src.nitro;
  return dst;
}

export class ReplayRecorder {
  // setup: { track, entries, opts, autopilot, autopilotSkill, meta }
  constructor(race, setup) {
    this.setup = { ...setup, entries: JSON.parse(JSON.stringify(setup.entries)) };
    this.live = race;         // the race being recorded (nothing else is)
    this.players = race.racers.filter((r) => r.human).map((r) => r.entry.player);
    this.n = 0;
    this.buf = new Uint8Array(BYTES * Math.max(1, this.players.length) * 120 * 90);
    this.marks = [];          // { s: step, k: kind, i: truck, j: other truck, v: value }
    this.lapSteps = [];       // step of each lap of the leader (timeline ticks)
    this.goStep = 0;
    this.doneStep = -1;
    this.closed = false;
    this._order = null;
  }

  // after race.step(): store the inputs it used and what happened
  step(inputs, race) {
    if (this.closed) return;
    const P = this.players.length;
    if ((this.n + 1) * BYTES * P > this.buf.length) {
      const b = new Uint8Array(this.buf.length * 2);
      b.set(this.buf);
      this.buf = b;
    }
    let o = this.n * BYTES * P;
    for (const p of this.players) {
      const u = inputs[p] || COAST;
      this.buf[o++] = Math.round(u.steer * 127) + 128;
      this.buf[o++] = Math.round(u.throttle * 255);
      this.buf[o++] = Math.round(u.brake * 255);
      this.buf[o++] = u.nitro ? 1 : 0;
    }
    const s = this.n;
    for (const ev of race.events) {
      switch (ev[0]) {
        case 'go': this.goStep = s; break;
        case 'land': if (ev[3] > 0.42) this.marks.push({ s, k: 'air', i: ev[1], v: ev[3] }); break;
        case 'bump': if (ev[3] > 5) this.marks.push({ s, k: 'bump', i: ev[1], j: ev[2], v: ev[3] }); break;
        case 'wall': if (ev[2] > 9) this.marks.push({ s, k: 'crash', i: ev[1], v: ev[2] }); break;
        case 'nitro': this.marks.push({ s, k: 'nitro', i: ev[1] }); break;
        case 'finish': this.marks.push({ s, k: 'finish', i: ev[1], v: ev[2] }); break;
        case 'lap': if (race.order[0] && race.order[0].i === ev[1]) this.lapSteps.push(s); break;
        case 'racedone': this.doneStep = s; break;
      }
    }
    // overtakes for a place in the top three
    if (race.state === 'race') {
      const ord = race.order;
      if (this._order) {
        for (let k = 0; k < Math.min(3, ord.length); k++) {
          const r = ord[k];
          if (this._order[k] !== r.i && this._order.indexOf(r.i) > k && !r.finished) {
            this.marks.push({ s, k: 'pass', i: r.i, j: this._order[k], v: k + 1 });
            break;
          }
        }
      }
      const o = this._order || (this._order = []);
      o.length = ord.length;
      for (let k = 0; k < ord.length; k++) o[k] = ord[k].i;
    }
    this.n++;
    // a few seconds after the end are enough (the finish, the celebration)
    if (this.doneStep >= 0 && s - this.doneStep > 120 * 3.5) this.closed = true;
  }

  get length() { return this.n; }
}

export class ReplayPlayer {
  constructor(rec) {
    this.rec = rec;
    this.inp = [0, 1, 2].map(() => ({ steer: 0, throttle: 0, brake: 0, nitro: false }));
  }

  // a fresh simulation at the start line
  makeRace() {
    const s = this.rec.setup;
    const race = new Race(s.track, JSON.parse(JSON.stringify(s.entries)), s.opts);
    race.autopilot = !!s.autopilot;
    race.autopilotSkill = s.autopilotSkill;
    return race;
  }

  // the players' inputs of step k, indexed by player like the live ones
  inputsAt(k) {
    const P = this.rec.players.length, buf = this.rec.buf;
    if (k >= this.rec.n) { for (const u of this.inp) { u.steer = 0; u.throttle = 0; u.brake = 0; u.nitro = false; } return this.inp; }
    let o = k * BYTES * P;
    for (const p of this.rec.players) {
      const u = this.inp[p];
      u.steer = (buf[o++] - 128) / 127;
      u.throttle = buf[o++] / 255;
      u.brake = buf[o++] / 255;
      u.nitro = buf[o++] === 1;
    }
    return this.inp;
  }
}
