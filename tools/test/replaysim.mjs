// Replay determinism: races driven by a scripted, jittery "human" (with the steering
// assist in some of them) are recorded, then played back through a new simulation
// from the recording only. Every truck must be in exactly the same place at every
// step, with the same finishing order and times. Also times a full re-simulation
// (what seeking backwards in a replay costs).
// Usage: node tools/test/replaysim.mjs [races=6]
import { buildTrack } from '../../js/sim/track.js';
import { trackById, SEASON } from '../../js/sim/tracks.js';
import { Race } from '../../js/sim/race.js';
import { AIDriver } from '../../js/sim/ai.js';
import { SteerAssist } from '../../js/sim/assist.js';
import { Session } from '../../js/game/session.js';
import { ReplayRecorder, ReplayPlayer, quantize } from '../../js/game/replay.js';
import { rng } from '../../js/sim/util.js';

const RACES = +(process.argv[2] || 6);
const DT = 1 / 120;
let bad = 0;
const snap = (race) => race.racers.map((r) => [r.truck.x, r.truck.y, r.truck.z, r.truck.h, r.truck.vx, r.truck.vz, r.truck.nitros, r.prog]);
for (let n = 0; n < RACES; n++) {
  const [id, reverse] = SEASON[(n * 3) % SEASON.length];
  const track = buildTrack(trackById(id), { reverse });
  const humans = 1 + (n % 2); // one and two players
  const s = new Session([{ truckId: 'red' }, { truckId: 'blue', vehicle: 'buggy' }].slice(0, humans), ['easy', 'normal', 'hard', 'arcade'][n % 4]);
  s.raceNo = 3 + n;
  const entries = s.entries();
  const opts = { seed: 1000 + n * 17, ...s.raceOpts(), laps: 3 };
  const race = new Race(track, entries, opts);
  const rec = new ReplayRecorder(race, { track, entries, opts });
  const mine = race.racers.filter((r) => r.human);
  const brains = mine.map((r, k) => new AIDriver(r.truck, track, { skill: 0.5 + 0.2 * k, aggression: 0.6, seed: 5 + k }));
  const assists = mine.map((r, k) => (n % 3 ? new SteerAssist(r.truck, track, (n % 3)) : null));
  const r = rng(77 + n);
  const raw = [0, 1, 2].map(() => ({ steer: 0, throttle: 0, brake: 0, nitro: false }));
  const q = [0, 1, 2].map(() => ({ steer: 0, throttle: 0, brake: 0, nitro: false }));
  const trace = [];
  let steps = 0;
  while (!rec.closed && steps < 120 * 400) {
    mine.forEach((m, k) => {
      const p = m.entry.player;
      const a = race.state === 'race' ? brains[k].update(DT, race.trucks) : { steer: 0, throttle: 1, brake: 0, nitro: false };
      // a human: analog noise, late corrections, sometimes a full press
      raw[p].steer = r() < 0.1 ? Math.sign(a.steer) : a.steer + (r() - 0.5) * 0.3;
      raw[p].throttle = a.brake > 0.4 ? 0 : 0.7 + r() * 0.3;
      raw[p].brake = a.brake > 0.4 ? a.brake : 0;
      raw[p].nitro = !!a.nitro;
      const u = assists[k] ? assists[k].apply(DT, raw[p]) : raw[p];
      quantize(u, q[p]);
    });
    race.step(DT, q);
    rec.step(q, race);
    trace.push(snap(race));
    steps++;
  }
  // play it back from the recording alone
  const t0 = performance.now();
  const pl = new ReplayPlayer(rec);
  const rp = pl.makeRace();
  let firstDiff = -1;
  for (let k = 0; k < rec.length; k++) {
    rp.step(DT, pl.inputsAt(k));
    if (firstDiff < 0) {
      const a = trace[k], b = snap(rp);
      for (let i = 0; i < a.length && firstDiff < 0; i++) for (let j = 0; j < a[i].length; j++) if (a[i][j] !== b[i][j]) { firstDiff = k; break; }
    }
  }
  const ms = performance.now() - t0;
  const same = race.finishOrder.map((x) => `${x.i}:${x.finishTime.toFixed(4)}`).join(' ') === rp.finishOrder.map((x) => `${x.i}:${x.finishTime.toFixed(4)}`).join(' ');
  const ok = firstDiff < 0 && same;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}${reverse ? ' (inv.)' : ''} ${humans}P ${s.difficulty.padEnd(6)} assist ${assists[0] ? assists[0].level : 0} · ${rec.length} steps (${(rec.length / 120).toFixed(1)} s) · ${rec.marks.length} marks · resim ${ms.toFixed(0)} ms${firstDiff >= 0 ? ' · first difference at step ' + firstDiff : ''}${same ? '' : ' · different results'}`);
}
console.log(bad ? `REPLAY FAIL (${bad})` : 'REPLAY OK');
process.exit(bad ? 1 : 0);
