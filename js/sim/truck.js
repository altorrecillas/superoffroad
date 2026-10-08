// Arcade off-road truck physics: 2D rigid body on a heightfield with jumps,
// grip/drift, nitro, water drag, wall and truck collisions.

import { clamp, lerp, wrapAngle } from './util.js';
import { WALL_FACE } from './track.js';

export const TRUCK = {
  length: 4.5, width: 2.3,
  wheelX: 1.42, wheelZ: 0.98, wheelR: 0.48,
  circleR: 1.16, circleOff: 1.2,
};

export const G_AIR = 23;     // gravity in the air (arcade: snappier than real)
export const G_SLOPE = 11;   // gravity felt along slopes when grounded
export const NITRO_TIME = 1.6;

// the two bodies of the Track Pak: the buggy has better shocks and
// acceleration, the truck better traction and top speed (and more weight)
export const VEHICLES = {
  truck: { accel: 1, vmax: 1, grip: 1, yaw: 1, shocks: 0, mass: 1 },
  buggy: { accel: 1.22, vmax: 0.955, grip: 0.93, yaw: 1.05, shocks: 0.4, mass: 0.72 },
};

// upgrade levels 0..5 -> handling numbers
export function truckStats(up = {}, kind = 'truck') {
  const a = up.accel || 0, s = up.speed || 0, t = up.tires || 0, k = up.shocks || 0;
  const m = VEHICLES[kind] || VEHICLES.truck;
  return {
    kind: VEHICLES[kind] ? kind : 'truck',
    accel: (12 + a * 1.6) * m.accel,
    vmax: (21.5 + s * 1.5) * m.vmax,
    grip: (21 + t * 2.4) * m.grip,
    yaw: (2.6 + t * 0.11) * m.yaw,
    shocks: k / 5 + (1 - k / 5) * m.shocks,
    mass: m.mass,
  };
}

const LOCAL_PTS = (() => {
  const L = TRUCK.length / 2, W = TRUCK.width / 2;
  return [[L, W], [L, -W], [-L, W], [-L, -W], [L, 0], [-L, 0], [0, W], [0, -W], [L * 0.5, W], [L * 0.5, -W], [-L * 0.5, W], [-L * 0.5, -W]];
})();

const WHEELS = [[TRUCK.wheelX, -TRUCK.wheelZ], [TRUCK.wheelX, TRUCK.wheelZ], [-TRUCK.wheelX, -TRUCK.wheelZ], [-TRUCK.wheelX, TRUCK.wheelZ]];

export class TruckSim {
  constructor(id, stats) {
    this.id = id;
    this.stats = stats;
    this.x = 0; this.z = 0; this.y = 0; this.h = 0;
    this.vx = 0; this.vz = 0; this.vy = 0; this.w = 0;
    this.air = false; this.airTime = 0;
    this.traction = 1;
    this.nitros = 0; this.nitroT = 0;
    this.slip = 0; this.speed = 0; this.vf = 0;
    this.water = 0;
    this.wheelH = new Float32Array(4);
    this.wheelGround = new Uint8Array(4);
    this.throttle = 0; this.steer = 0;
    this.landImpact = 0;
    this.wallHit = 0;
    this.events = [];
    this.n = [0, 1, 0];
    this.hAbove = 0;
    this.frozen = false;
  }

  place(x, z, h, track) {
    this.x = x; this.z = z; this.h = h;
    this.vx = this.vz = this.vy = this.w = 0;
    this.y = this.groundHeight(track);
    this.air = false;
  }

  groundHeight(track) {
    const c = Math.cos(this.h), s = Math.sin(this.h);
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const [lx, lz] = WHEELS[i];
      const wx = this.x + lx * c - lz * s, wz = this.z + lx * s + lz * c;
      const hh = track.heightAt(wx, wz);
      this.wheelH[i] = hh;
      sum += hh;
    }
    // centre sample keeps the body from sinking into a mound between the wheels
    const hc = track.heightAt(this.x, this.z);
    const avg = sum / 4;
    return Math.max(avg, hc - 0.15);
  }

  step(dt, inp, track) {
    const st = this.stats;
    this.events.length = 0;
    if (this.frozen) { inp = NO_INPUT; }
    const ch = Math.cos(this.h), sh = Math.sin(this.h);
    let vf = this.vx * ch + this.vz * sh;
    let vl = -this.vx * sh + this.vz * ch;

    // nitro trigger
    if (inp.nitro && this.nitroT <= 0 && this.nitros > 0) {
      this.nitros--;
      this.nitroT = NITRO_TIME;
      this.events.push(['nitro']);
    }
    const boost = this.nitroT > 0;
    if (boost) this.nitroT -= dt;

    const depth = track.waterAt(this.x, this.z);
    this.water = depth;
    this.throttle = inp.throttle; this.steer = inp.steer;

    if (!this.air || this.hAbove < 0.18) {
      track.normalAt(this.x, this.z, this.n);
      const sp = Math.abs(vf);
      // --- steering (rotational, like the arcade dial)
      let steerScale = clamp(0.32 + sp / 6.5, 0, 1);
      if (sp > 21) steerScale *= 1 - Math.min(0.25, (sp - 21) * 0.03);
      const dirSign = vf < -0.6 ? -1 : 1;
      const wTarget = inp.steer * st.yaw * steerScale * dirSign * (0.55 + 0.45 * this.traction);
      this.w += (wTarget - this.w) * Math.min(1, dt * 11);

      // --- drive
      const wet = depth > 0.04 ? clamp(depth / 0.4, 0, 1) : 0;
      const vmax = st.vmax * (1 - 0.38 * wet) * (boost ? 1.38 : 1);
      let a = 0;
      if (inp.throttle > 0) {
        if (vf < vmax) {
          const r = Math.max(0, vf) / vmax;
          a = st.accel * inp.throttle * (1 - r * r * r) * (boost ? 2.1 : 1);
          if (vf < 0) a += 6; // throttle while rolling back
        } else a = -(vf - vmax) * 1.2;
      } else if (boost && !(inp.brake > 0)) {
        a = vf < vmax ? st.accel * 1.4 : 0;
      }
      if (inp.brake > 0) {
        if (vf > 0.8) a -= 17 * inp.brake;
        else if (vf > -6.5) a -= 8 * inp.brake;
      }
      // rolling resistance and drag
      const roll = (inp.throttle > 0 ? 0.35 : 1.7) + 0.0035 * vf * vf;
      a -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, roll);
      // water drag
      if (wet > 0) a -= vf * (0.6 + 2.2 * wet);
      vf += a * dt * (0.45 + 0.55 * this.traction);

      // --- lateral grip
      const grip = st.grip * (0.35 + 0.65 * this.traction) * (1 - 0.3 * wet);
      const dv = Math.min(Math.abs(vl), grip * dt);
      vl -= Math.sign(vl) * dv;
      this.slip = Math.abs(vl);
      // sliding scrubs speed
      if (this.slip > 1) vf -= Math.sign(vf) * Math.min(Math.abs(vf), this.slip * 0.35 * dt);

      this.vx = vf * ch - vl * sh;
      this.vz = vf * sh + vl * ch;
      // slope gravity
      const ny = this.n[1];
      this.vx += G_SLOPE * this.n[0] * ny * dt;
      this.vz += G_SLOPE * this.n[2] * ny * dt;
    } else {
      // limited control in the air
      const wTarget = inp.steer * st.yaw * 0.45;
      this.w += (wTarget - this.w) * Math.min(1, dt * 3);
      this.vx *= 1 - 0.05 * dt; this.vz *= 1 - 0.05 * dt;
      if (boost) { this.vx += ch * 6 * dt; this.vz += sh * 6 * dt; }
      this.slip = 0;
    }

    // traction recovers after landings
    this.traction = Math.min(1, this.traction + dt * (1.4 + 2.2 * st.shocks));

    // integrate
    this.h = wrapAngle(this.h + this.w * dt);
    const px = this.x, pz = this.z;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // vertical
    const hg = this.groundHeight(track);
    if (this.air) {
      this.vy -= G_AIR * dt;
      this.y += this.vy * dt;
      this.airTime += dt;
      if (this.y <= hg) this._land(hg, dt, px, pz, track);
    } else {
      const vyG = clamp((hg - this.y) / dt, -30, 30);
      this.y = hg;
      this.vy = lerp(this.vy, vyG, 0.5);
      // take off when the ballistic path stays above the ground ahead
      if (this.speed > 5 && this.vy > -2 && this._willFly(track, st.shocks)) {
        this.air = true;
        this.airTime = 0;
        this.events.push(['takeoff', this.vy]);
      }
    }
    this.hAbove = this.y - hg;

    this.vf = this.vx * Math.cos(this.h) + this.vz * Math.sin(this.h);
    this.speed = Math.hypot(this.vx, this.vz);
    this._walls(track);
  }

  _willFly(track, shocks) {
    const margin = 0.05 + 0.08 * shocks;
    for (const t of PREDICT_T) {
      const yb = this.y + this.vy * t - 0.5 * G_AIR * t * t;
      const hx = this.x + this.vx * t, hz = this.z + this.vz * t;
      const hp = Math.max(track.heightAt(hx, hz), track.heightAt(hx + Math.cos(this.h) * 1.2, hz + Math.sin(this.h) * 1.2) - 0.1);
      if (yb < hp + margin) return false;
    }
    return true;
  }

  _land(hg, dt, px, pz, track) {
    // vertical speed of the ground along our motion at the landing spot
    const groundVy = ((track.heightAt(this.x, this.z) - track.heightAt(px, pz)) / dt) || 0;
    const impact = this.vy - groundVy; // negative
    this.y = hg;
    this.air = false;
    const sev = Math.max(0, -impact - 3.5);
    const shocks = this.stats.shocks;
    this.landImpact = Math.min(1, -impact / 12);
    if (sev > 0) {
      const loss = clamp(sev * 0.022 * (1 - 0.65 * shocks), 0, 0.3);
      this.vx *= 1 - loss; this.vz *= 1 - loss;
      this.traction = clamp(1 - sev * 0.07 * (1 - 0.6 * shocks), 0.25, 1);
      const bounce = sev * (0.3 - 0.22 * shocks);
      if (bounce > 1.4) {
        this.air = true; this.vy = bounce + groundVy * 0.5; this.airTime = 0;
      } else this.vy = groundVy;
      // unsettled landing: small yaw kick when landing sideways
      const ch = Math.cos(this.h), sh = Math.sin(this.h);
      const vl = -this.vx * sh + this.vz * ch;
      this.w += clamp(vl * 0.08, -1, 1) * (1 - shocks * 0.6);
    } else this.vy = groundVy;
    this.events.push(['land', -impact, this.airTime]);
  }

  _walls(track) {
    const c = Math.cos(this.h), s = Math.sin(this.h);
    let best = 0, bx = 0, bz = 0, blx = 0, blz = 0;
    for (const [lx, lz] of LOCAL_PTS) {
      const wx = this.x + lx * c - lz * s, wz = this.z + lx * s + lz * c;
      const d = track.sdfAt(wx, wz) - WALL_FACE;
      if (d > best) { best = d; bx = wx; bz = wz; blx = lx * c - lz * s; blz = lx * s + lz * c; }
    }
    this.wallHit = 0;
    if (best <= 0) return;
    const g = _g;
    track.sdfGrad(bx, bz, g);
    const nx = -g[0], nz = -g[1]; // into the track
    const pen = Math.min(best, 1.5);
    this.x += nx * pen; this.z += nz * pen;
    // contact point velocity
    const rx = blx, rz = blz;
    const vpx = this.vx - this.w * rz, vpz = this.vz + this.w * rx;
    const vn = vpx * nx + vpz * nz;
    if (vn < 0) {
      const e = 0.28;
      const I = 2.4;
      const rxn = rx * nz - rz * nx;
      const j = (-(1 + e) * vn) / (1 + (rxn * rxn) / I);
      this.vx += j * nx; this.vz += j * nz;
      this.w += (rxn * j) / I * 0.9;
      // friction along the wall
      const tx = -nz, tz = nx;
      const vt = vpx * tx + vpz * tz;
      const jt = clamp(-vt, -0.32 * j, 0.32 * j);
      this.vx += jt * tx; this.vz += jt * tz;
      this.wallHit = -vn;
      if (-vn > 2.5) this.events.push(['wall', -vn, bx, bz, nx, nz]);
    }
  }

  // world position of a local point (x forward, z right)
  local(lx, lz, out) {
    const c = Math.cos(this.h), s = Math.sin(this.h);
    out[0] = this.x + lx * c - lz * s;
    out[1] = this.z + lx * s + lz * c;
    return out;
  }
}

const _g = [0, 0];
const NO_INPUT = { steer: 0, throttle: 0, brake: 0, nitro: false };
const PREDICT_T = [0.05, 0.1, 0.16];

// truck vs truck: three circles along each body (the light buggy gets shoved more)
export function collideTrucks(A, B, events) {
  if (Math.abs(A.y - B.y) > 1.35) return; // one is flying over the other
  const R = TRUCK.circleR, off = TRUCK.circleOff;
  const ca = Math.cos(A.h), sa = Math.sin(A.h), cb = Math.cos(B.h), sb = Math.sin(B.h);
  // quick reject
  const dx0 = B.x - A.x, dz0 = B.z - A.z;
  if (dx0 * dx0 + dz0 * dz0 > (2 * off + 2 * R) ** 2) return;
  const ia = 1 / (A.stats.mass || 1), ib = 1 / (B.stats.mass || 1);
  const sa2 = ia / (ia + ib), sb2 = ib / (ia + ib);
  let hit = false, maxImp = 0, hx = 0, hz = 0;
  for (let i = -1; i <= 1; i++) {
    const ax = A.x + ca * off * i, az = A.z + sa * off * i;
    for (let k = -1; k <= 1; k++) {
      const bx = B.x + cb * off * k, bz = B.z + sb * off * k;
      let dx = bx - ax, dz = bz - az;
      const d = Math.hypot(dx, dz);
      if (d >= 2 * R || d < 1e-5) continue;
      const nx = dx / d, nz = dz / d;
      const pen = 2 * R - d;
      A.x -= nx * pen * sa2; A.z -= nz * pen * sa2;
      B.x += nx * pen * sb2; B.z += nz * pen * sb2;
      // contact point (midway), arms from each centre
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      const rax = cx - A.x, raz = cz - A.z, rbx = cx - B.x, rbz = cz - B.z;
      const vax = A.vx - A.w * raz, vaz = A.vz + A.w * rax;
      const vbx = B.vx - B.w * rbz, vbz = B.vz + B.w * rbx;
      const vrel = (vbx - vax) * nx + (vbz - vaz) * nz;
      if (vrel < 0) {
        const e = 0.38, I = 2.4;
        const ran = rax * nz - raz * nx, rbn = rbx * nz - rbz * nx;
        const j = (-(1 + e) * vrel) / (ia + ib + (ran * ran * ia) / I + (rbn * rbn * ib) / I);
        A.vx -= j * nx * ia; A.vz -= j * nz * ia; A.w -= (ran * j * ia) / I * 0.7;
        B.vx += j * nx * ib; B.vz += j * nz * ib; B.w += (rbn * j * ib) / I * 0.7;
        if (-vrel > maxImp) { maxImp = -vrel; hx = cx; hz = cz; }
      }
      hit = true;
    }
  }
  if (hit && maxImp > 2 && events) events.push(['bump', A.id, B.id, maxImp, hx, hz]);
}
