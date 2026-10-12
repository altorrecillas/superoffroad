// The race state between two phones, without a browser: a real race packed on the
// "host", unpacked and written into a "guest" copy of the same race must give the
// same trucks, laps, positions and pickups; halfway between two snapshots, the
// halfway state; and the controls packet keeps steering, pedals and nitro presses.
// Usage: node tools/test/netstate.mjs
import { buildTrack } from '../../js/sim/track.js';
import { trackById } from '../../js/sim/tracks.js';
import { Race } from '../../js/sim/race.js';
import { Session } from '../../js/game/session.js';
import { packState, unpackState, applyState, packInput, unpackInput, kindOf, KIND_STATE, KIND_INPUT } from '../../js/net/state.js';

let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

const track = buildTrack(trackById('huevos'), { reverse: false });
const session = new Session([{ truckId: 'red' }, { truckId: 'blue', vehicle: 'buggy' }], 'normal');
const entries = session.entries();
const host = new Race(track, entries, { seed: 7, ...session.raceOpts(), rain: false });
host.autopilot = true; host.autopilotSkill = 0.9;
// the guest's copy: the same field, never stepped (the host's player is a rival there)
const guest = new Race(track, entries.map((e) => (e.human && e.player === 0 ? { ...e, human: false, remote: true } : e)), { seed: 1 });

const DT = 1 / 120;
let a = null, b = null, seq = 0, maxBytes = 0;
const snaps = [];
for (let t = 0; t < 26; t += DT) {
  host.step(DT, []);
  if (Math.round(t / DT) % 2 === 0) { // 60 a second
    const buf = packState(host, ++seq, t * 1000, seq * 3);
    maxBytes = Math.max(maxBytes, buf.byteLength);
    snaps.push({ buf, hostCopy: host.racers.map((r) => ({ x: r.truck.x, z: r.truck.z, h: r.truck.h, lap: r.lap, pos: r.pos, nitros: r.truck.nitros, prog: r.prog })), pick: host.pickups.length });
  }
}
check(kindOf(snaps[0].buf) === KIND_STATE, 'a state packet says what it is');
check(maxBytes < 1200, `small enough to send 60 a second (${maxBytes} bytes, ${(maxBytes * 60 / 1024).toFixed(1)} KB/s)`);
const last = snaps[snaps.length - 1];
b = unpackState(last.buf);
check(b && b.seq === seq && b.racers.length === 4 && b.state === host.state, `unpacked: seq ${b.seq}, ${b.racers.length} trucks, ${b.state}`);
applyState(guest, b, b, 0);
const same = host.racers.every((r, i) => near(guest.racers[i].truck.x, r.truck.x) && near(guest.racers[i].truck.z, r.truck.z) && near(guest.racers[i].truck.h, r.truck.h, 1e-4)
  && guest.racers[i].lap === r.lap && guest.racers[i].pos === r.pos && guest.racers[i].truck.nitros === r.truck.nitros && near(guest.racers[i].prog, r.prog, 1e-2));
check(same, 'the guest copy has the same trucks, laps, positions and nitros');
check(guest.pickups.length === host.pickups.filter((p) => !p.taken).length && guest.pickups.every((p, i) => near(p.x, host.pickups[i].x)), `the same pickups (${guest.pickups.length})`);
check(near(guest.time, host.time, 1e-3) && guest.order[0].i === host.order[0].i, `the same clock and leader (${guest.order[0].entry.name})`);
// halfway between two snapshots
const s1 = unpackState(snaps[100].buf), s2 = unpackState(snaps[101].buf);
applyState(guest, s1, s2, 0.5);
const mid = (i, k) => (snaps[100].hostCopy[i][k] + snaps[101].hostCopy[i][k]) / 2;
check(guest.racers.every((r, i) => near(r.truck.x, mid(i, 'x'), 1e-2) && near(r.truck.z, mid(i, 'z'), 1e-2)), 'halfway between two snapshots: halfway positions');
// the predicted truck is left alone
const before = guest.racers[1].truck.x;
guest.racers[1].truck.x = 12345;
applyState(guest, s1, s2, 0.5, 1);
check(guest.racers[1].truck.x === 12345 && near(guest.racers[0].truck.x, mid(0, 'x'), 1e-2), 'a skipped truck (the predicted one) is not touched');
guest.racers[1].truck.x = before;
// controls
const ib = packInput(77, { steer: -0.5, throttle: 1, brake: 0.25 }, 258);
const iu = unpackInput(ib);
check(kindOf(ib) === KIND_INPUT && iu.seq === 77 && near(iu.steer, -0.5, 0.01) && iu.throttle === 1 && near(iu.brake, 0.25, 0.01) && iu.nitroCount === 2, `controls packet (${ib.byteLength} bytes): steer, pedals, nitro count`);
check(unpackState(ib) === null && unpackInput(last.buf) === null, 'one kind of packet is never read as the other');

console.log(ok ? 'NETSTATE OK' : 'NETSTATE FAIL');
process.exit(ok ? 0 : 1);
