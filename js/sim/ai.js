// CPU drivers: follow the racing line with a speed profile, avoid trucks,
// use nitro on straights and recover when stuck.

import { clamp, wrapAngle, rng } from './util.js';

export class AIDriver {
  constructor(truck, track, opts = {}) {
    this.t = truck;
    this.track = track;
    this.skill = opts.skill ?? 0.8;          // 0..1.2
    this.aggr = opts.aggression ?? 0.5;      // 0..1 nitro and overtaking appetite
    this.bias = opts.bias ?? 0;              // preferred lateral offset (m)
    this.r = rng(opts.seed ?? 1);
    this.k = -1;
    this.stuckT = 0; this.revT = 0;
    this.nitroCd = 1.5 + this.r() * 2;
    this.wander = 0; this.wanderT = 0; this.wanderTarget = 0;
    this.dpa = 1;
    this.inp = { steer: 0, throttle: 0, brake: 0, nitro: false };
    this.rebuildProfile();
  }

  rebuildProfile() {
    const st = this.t.stats;
    this.profile = this.track.speedProfile(st.grip * (0.74 + 0.1 * this.skill), 10 + 3 * this.skill, st.vmax);
  }

  _lineIndex() {
    const ln = this.track.line, t = this.t;
    if (this.k < 0) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < ln.m; k++) {
        const d = (ln.x[k] - t.x) ** 2 + (ln.z[k] - t.z) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      this.k = best;
      return;
    }
    let best = this.k, bd = Infinity;
    for (let o = -4; o <= 10; o++) {
      const k = (this.k + o + ln.m) % ln.m;
      const d = (ln.x[k] - t.x) ** 2 + (ln.z[k] - t.z) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    this.k = best;
    if (bd > 400) this.k = -1; // lost: global search next time
  }

  update(dt, trucks) {
    const t = this.t, tr = this.track, ln = tr.line, p = tr.path;
    const inp = this.inp;
    this._lineIndex();
    if (this.k < 0) this._lineIndex();
    const k = this.k;
    const speed = Math.max(0, t.vf);

    // wandering lateral preference keeps the pack from driving in single file
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      this.wanderT = 1.5 + this.r() * 2.5;
      this.wanderTarget = (this.r() * 2 - 1) * 1.6 * (1.1 - this.skill * 0.5);
    }
    this.wander += (this.wanderTarget - this.wander) * Math.min(1, dt * 0.8);

    // look-ahead target on the line
    const look = 5.5 + speed * 0.3;
    const kt = (k + Math.max(2, Math.round(look / 2))) % ln.m;
    let extra = this.bias + this.wander;

    // avoid trucks ahead
    const ch = Math.cos(t.h), sh = Math.sin(t.h);
    const pi = ln.idx[kt];
    const nx = -p.tz[pi], nz = p.tx[pi];
    for (const o of trucks) {
      if (o === t) continue;
      const dx = o.x - t.x, dz = o.z - t.z;
      const ahead = dx * ch + dz * sh;
      if (ahead < 1 || ahead > 13) continue;
      const side = -dx * sh + dz * ch;
      if (Math.abs(side) > 3.6) continue;
      const closing = t.vf - (o.vx * ch + o.vz * sh);
      if (closing < -1) continue;
      // shift to the side away from the other truck
      const oLat = (o.x - ln.x[kt]) * nx + (o.z - ln.z[kt]) * nz;
      const myLat = ln.off[kt] + extra;
      const dir = myLat >= oLat ? 1 : -1;
      extra += dir * (3.4 - Math.abs(side)) * (1 - ahead / 14) * 1.4;
    }
    // steer around solid props (giant drums) close ahead
    for (const pr of tr.props) {
      const dx = pr.x - t.x, dz = pr.z - t.z;
      const ahead = dx * ch + dz * sh;
      if (ahead < 0 || ahead > 16) continue;
      const side = -dx * sh + dz * ch;
      const clear = pr.r + 2.6;
      if (Math.abs(side) > clear) continue;
      const pLat = (pr.x - ln.x[kt]) * nx + (pr.z - ln.z[kt]) * nz;
      const myLat = ln.off[kt] + extra;
      const dir = myLat >= pLat ? 1 : -1;
      extra += dir * (clear - Math.abs(side)) * (1 - ahead / 18);
    }
    const off = clamp(ln.off[kt] + extra, ln.lo[kt], ln.hi[kt]);
    const tx = p.x[pi] + nx * off, tz = p.z[pi] + nz * off;

    // steering towards the target
    const desired = Math.atan2(tz - t.z, tx - t.x);
    const err = wrapAngle(desired - t.h);
    let steer = clamp(err * 2.8 - t.w * 0.2, -1, 1);

    // speed control from the profile
    const mul = (0.84 + 0.16 * this.skill) * this.dpa;
    let vt = Infinity;
    for (let o = 0; o <= 3; o++) vt = Math.min(vt, this.profile[(k + o) % ln.m]);
    vt *= mul;
    let throttle = 1, brake = 0;
    if (speed > vt + 0.8) { throttle = 0; brake = clamp((speed - vt) / 5, 0.15, 1); }
    else if (speed > vt - 0.6) throttle = 0.55;
    if (Math.abs(err) > 1.2 && speed > 8) { throttle = 0; brake = 0.6; }

    // nitro on straights
    let nitro = false;
    this.nitroCd -= dt;
    if (t.nitros > 0 && t.nitroT <= 0 && this.nitroCd <= 0 && speed > 9 && !t.air) {
      let straight = true;
      // the boost lasts ~40 m: only fire it when the straight is long enough
      for (let o = 1; o < 19; o++) if (this.profile[(k + o) % ln.m] < t.stats.vmax * 0.82) { straight = false; break; }
      if (straight && this.r() < dt * (0.6 + 1.6 * this.aggr)) {
        nitro = true;
        this.nitroCd = 2.5 + this.r() * 3 * (1.2 - this.aggr);
      }
    }

    // stuck recovery
    if (this.revT > 0) {
      this.revT -= dt;
      inp.steer = -this.revSteer; inp.throttle = 0; inp.brake = 1; inp.nitro = false;
      return inp;
    }
    if (throttle > 0.5 && speed < 1.2 && !t.air) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 1.1) {
      this.stuckT = 0;
      this.revT = 0.9;
      this.revSteer = Math.sign(err) || 1;
    }

    inp.steer = steer; inp.throttle = throttle; inp.brake = brake; inp.nitro = nitro;
    return inp;
  }
}
