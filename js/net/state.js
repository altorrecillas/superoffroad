// The race as it travels between the two phones. The host runs the simulation and
// packs the state of every truck into a small binary message, 60 a second; the guest
// keeps the last ones and draws the race a few hundredths of a second in the past,
// between two of them, so it stays smooth when the WiFi hiccups. The guest sends
// its controls the other way. Pure functions: tested in Node (tools/test/netstate.mjs).

import { wrapAngle } from '../sim/util.js';

export const KIND_STATE = 1, KIND_INPUT = 2;
const STATES = ['countdown', 'race', 'done'];
const HEAD = 32, RACER = 80, PICK = 20, INPUT = 9;
// floats of each racer, in order (the last ones change seldom but cost little)
const F = ['x', 'y', 'z', 'h', 'vx', 'vz', 'vy', 'w', 'hAbove', 'airTime', 'traction', 'prog', 'finishTime', 'lastLap', 'bestLap', 'lapStart'];
const TRUCK_F = new Set(['x', 'y', 'z', 'h', 'vx', 'vz', 'vy', 'w', 'hAbove', 'airTime', 'traction']);
const LERP_F = ['x', 'y', 'z', 'vx', 'vz', 'vy', 'w', 'hAbove', 'prog'];

// host -> guest: seq (packet number), ht (host clock, ms), ack (last guest input used)
export function packState(race, seq, ht, ack, flags = 0) {
  const pk = race.pickups.filter((p) => !p.taken).slice(0, 8);
  const n = race.racers.length;
  const buf = new ArrayBuffer(HEAD + n * RACER + pk.length * PICK);
  const d = new DataView(buf);
  d.setUint8(0, KIND_STATE);
  d.setUint8(1, n);
  d.setUint8(2, Math.max(0, STATES.indexOf(race.state)));
  d.setUint8(3, pk.length);
  d.setUint32(4, seq >>> 0, true);
  d.setFloat64(8, ht, true);
  d.setFloat32(16, race.time, true);
  d.setFloat32(20, race.timeLeft ?? -1, true);
  d.setUint32(24, ack >>> 0, true);
  d.setUint8(28, flags);
  let o = HEAD;
  for (const r of race.racers) {
    const t = r.truck;
    for (const k of F) { d.setFloat32(o, TRUCK_F.has(k) ? t[k] : r[k] || 0, true); o += 4; }
    d.setInt8(o, Math.round(Math.max(-1, Math.min(1, t.steer || 0)) * 127));
    d.setUint8(o + 1, Math.round(Math.max(0, Math.min(1, t.throttle || 0)) * 255));
    d.setUint8(o + 2, Math.min(255, Math.round((t.slip || 0) * 10)));
    d.setUint8(o + 3, Math.min(255, Math.round((t.water || 0) * 255)));
    d.setUint8(o + 4, Math.min(255, Math.round(Math.max(0, t.nitroT) * 100)));
    d.setUint8(o + 5, Math.min(255, t.nitros));
    d.setUint8(o + 6, (t.air ? 1 : 0) | (r.finished ? 2 : 0) | (r.wrongWay ? 4 : 0) | (r.dnf ? 8 : 0) | (t.frozen ? 16 : 0));
    d.setUint8(o + 7, Math.min(255, Math.max(0, r.lap)));
    d.setUint8(o + 8, r.pos || 0);
    d.setUint8(o + 9, r.place || 0);
    d.setUint16(o + 10, Math.min(65535, Math.round((r.money || 0) / 1000)), true);
    d.setFloat32(o + 12, t.landImpact || 0, true);
    o += RACER - 64;
  }
  for (const p of pk) {
    d.setUint16(o, p.id & 0xffff, true);
    d.setUint8(o + 2, p.type === 'money' ? 1 : 0);
    d.setUint8(o + 3, Math.min(255, Math.round((p.value || 0) / 1000)));
    d.setFloat32(o + 4, p.x, true); d.setFloat32(o + 8, p.z, true); d.setFloat32(o + 12, p.y, true);
    d.setUint16(o + 16, Math.min(65535, Math.round(p.age * 100)), true);
    d.setUint16(o + 18, Math.min(65535, Math.round(p.life * 100)), true);
    o += PICK;
  }
  return buf;
}

export function unpackState(buf) {
  const d = new DataView(buf);
  if (buf.byteLength < HEAD || d.getUint8(0) !== KIND_STATE) return null;
  const n = d.getUint8(1), np = d.getUint8(3);
  if (buf.byteLength !== HEAD + n * RACER + np * PICK) return null;
  const s = {
    state: STATES[d.getUint8(2)] || 'race', seq: d.getUint32(4, true), ht: d.getFloat64(8, true),
    time: d.getFloat32(16, true), timeLeft: d.getFloat32(20, true), ack: d.getUint32(24, true), flags: d.getUint8(28),
    racers: [], pickups: [],
  };
  if (s.timeLeft < 0) s.timeLeft = null;
  let o = HEAD;
  for (let i = 0; i < n; i++) {
    const r = {};
    for (const k of F) { r[k] = d.getFloat32(o, true); o += 4; }
    r.steer = d.getInt8(o) / 127;
    r.throttle = d.getUint8(o + 1) / 255;
    r.slip = d.getUint8(o + 2) / 10;
    r.water = d.getUint8(o + 3) / 255;
    r.nitroT = d.getUint8(o + 4) / 100;
    r.nitros = d.getUint8(o + 5);
    const f = d.getUint8(o + 6);
    r.air = !!(f & 1); r.finished = !!(f & 2); r.wrongWay = !!(f & 4); r.dnf = !!(f & 8); r.frozen = !!(f & 16);
    r.lap = d.getUint8(o + 7);
    r.pos = d.getUint8(o + 8);
    r.place = d.getUint8(o + 9);
    r.money = d.getUint16(o + 10, true) * 1000;
    r.landImpact = d.getFloat32(o + 12, true);
    o += RACER - 64;
    s.racers.push(r);
  }
  for (let i = 0; i < np; i++) {
    s.pickups.push({
      id: d.getUint16(o, true), type: d.getUint8(o + 2) ? 'money' : 'nitro', value: d.getUint8(o + 3) * 1000,
      x: d.getFloat32(o + 4, true), z: d.getFloat32(o + 8, true), y: d.getFloat32(o + 12, true),
      age: d.getUint16(o + 16, true) / 100, life: d.getUint16(o + 18, true) / 100, taken: false,
    });
    o += PICK;
  }
  return s;
}

// Write the state between snapshots a and b (k: 0..1, past 1 a short extrapolation)
// into the guest's race: trucks, laps, positions, pickups. skip: racer indices left
// alone (the guest's own truck, when it is predicted).
export function applyState(race, a, b, k, skip = -1) {
  b = b || a;
  race.time = a.time + (b.time - a.time) * Math.min(1, k);
  race.state = (k < 1 ? a : b).state;
  race.timeLeft = b.timeLeft;
  race.racers.forEach((r, i) => {
    const A = a.racers[i], B = b.racers[i];
    if (!A || !B) return;
    const D = k < 1 ? A : B; // discrete values: the earlier one until the later is reached
    r.lap = D.lap; r.pos = D.pos; r.place = D.place; r.finished = D.finished; r.wrongWay = D.wrongWay; r.dnf = D.dnf;
    r.money = D.money; r.finishTime = D.finishTime; r.lastLap = D.lastLap; r.bestLap = D.bestLap; r.lapStart = D.lapStart;
    r.prog = A.prog + (B.prog - A.prog) * k; r.progFine = r.prog;
    if (i === skip) return;
    writeTruck(r.truck, A, B, k);
  });
  race.order = race.racers.slice().sort((p, q) => (p.pos || 9) - (q.pos || 9));
  race.finishOrder = race.racers.filter((r) => r.place > 0).sort((p, q) => p.place - q.place);
  race.pickups = (k < 1 ? a : b).pickups;
}

// one truck's state between two snapshots (also used for the predicted truck's start)
export function writeTruck(t, A, B, k = 0) {
  B = B || A;
  for (const f of LERP_F) if (f !== 'prog') t[f] = A[f] + (B[f] - A[f]) * k;
  t.h = wrapAngle(A.h + wrapAngle(B.h - A.h) * k);
  const D = k < 1 ? A : B;
  t.air = D.air; t.airTime = D.airTime; t.traction = D.traction; t.frozen = D.frozen;
  t.steer = D.steer; t.throttle = D.throttle; t.slip = D.slip; t.water = D.water;
  t.nitroT = D.nitroT; t.nitros = D.nitros; t.landImpact = D.landImpact;
  t.vf = t.vx * Math.cos(t.h) + t.vz * Math.sin(t.h);
  t.speed = Math.hypot(t.vx, t.vz);
}

// guest -> host: the controls, numbered; nitro travels as a count of presses so a
// lost packet never loses one
export function packInput(seq, inp, nitroCount) {
  const buf = new ArrayBuffer(INPUT), d = new DataView(buf);
  d.setUint8(0, KIND_INPUT);
  d.setUint32(1, seq >>> 0, true);
  d.setInt8(5, Math.round(Math.max(-1, Math.min(1, inp.steer || 0)) * 127));
  d.setUint8(6, Math.round(Math.max(0, Math.min(1, inp.throttle || 0)) * 255));
  d.setUint8(7, Math.round(Math.max(0, Math.min(1, inp.brake || 0)) * 255));
  d.setUint8(8, nitroCount & 255);
  return buf;
}
export function unpackInput(buf) {
  if (buf.byteLength !== INPUT) return null;
  const d = new DataView(buf);
  if (d.getUint8(0) !== KIND_INPUT) return null;
  return { seq: d.getUint32(1, true), steer: d.getInt8(5) / 127, throttle: d.getUint8(6) / 255, brake: d.getUint8(7) / 255, nitroCount: d.getUint8(8) };
}
export const kindOf = (buf) => (buf.byteLength ? new DataView(buf).getUint8(0) : 0);
