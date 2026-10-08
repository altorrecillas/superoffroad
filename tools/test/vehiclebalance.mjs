// Truck vs buggy time trials with the same AI driver on every circuit and
// direction: node tools/test/vehiclebalance.mjs [level] [skill]
import { buildTrack } from '../../js/sim/track.js';
import { TRACKS } from '../../js/sim/tracks.js';
import { Race } from '../../js/sim/race.js';

const level = +(process.argv[2] ?? 0);
const skill = +(process.argv[3] ?? 1);
const DT = 1 / 120;
const up = { accel: level, speed: level, tires: level, shocks: level };

function trial(track, vehicle) {
  const entries = [{ name: vehicle, vehicle, ai: { skill, aggression: 0 }, upgrades: up, nitros: 0 }];
  const race = new Race(track, entries, { laps: 3, seed: 3, pickups: false, dpa: 0 });
  let t = 0, walls = 0, air = 0;
  while (race.state !== 'done' && t < 300) {
    race.step(DT, []);
    t += DT;
    for (const ev of race.events) {
      if (ev[0] === 'wall') walls++;
      if (ev[0] === 'land' && ev[3] > 0.25) air++;
    }
  }
  const r = race.racers[0];
  return { time: r.finished ? r.finishTime : NaN, best: r.bestLap, walls, air };
}

let sumT = 0, sumB = 0, n = 0, wins = 0;
const rows = [];
for (const def of TRACKS) {
  for (const rev of [false, true]) {
    const track = buildTrack(def, { reverse: rev });
    const a = trial(track, 'truck'), b = trial(track, 'buggy');
    const ratio = b.time / a.time;
    sumT += a.time; sumB += b.time; n++;
    if (b.time < a.time) wins++;
    rows.push([`${def.id}${rev ? '-r' : ''}`, a, b, ratio]);
  }
}
for (const [id, a, b, ratio] of rows) {
  console.log(`${id.padEnd(14)} truck ${a.time.toFixed(1)}s (best ${a.best.toFixed(2)} w${a.walls} j${a.air})  buggy ${b.time.toFixed(1)}s (best ${b.best.toFixed(2)} w${b.walls} j${b.air})  ${((ratio - 1) * 100).toFixed(1)}%`);
}
console.log(`level ${level} skill ${skill}: buggy faster on ${wins}/${n}; total truck ${sumT.toFixed(0)}s buggy ${sumB.toFixed(0)}s (${((sumB / sumT - 1) * 100).toFixed(2)}%)`);
