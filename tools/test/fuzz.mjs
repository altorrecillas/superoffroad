// Physics/race fuzzing: "monkey" players with random inputs on every circuit and
// direction, plus the CPU field. Flags NaN, trucks leaving the arena, trucks
// stuck inside barriers, impossible laps and races that never end.
// Usage: node tools/test/fuzz.mjs [seeds=3]
import { buildTrack, ARENA, WALL_FACE } from '../../js/sim/track.js';
import { TRACKS } from '../../js/sim/tracks.js';
import { Race } from '../../js/sim/race.js';
import { rng } from '../../js/sim/util.js';

const seeds = +(process.argv[2] || 3);
const DT = 1 / 120;
let problems = 0, races = 0;
const report = (msg) => { problems++; console.log('  !', msg); };

for (const def of TRACKS) {
  for (const reverse of [false, true]) {
    const track = buildTrack(def, { reverse });
    for (let seed = 1; seed <= seeds; seed++) {
      const r = rng(seed * 7919 + def.id.length);
      const vehicle = seed % 2 ? 'buggy' : 'truck';
      const entries = [
        { name: 'MONKEY', human: true, player: 0, vehicle, upgrades: { accel: seed % 6, speed: (seed * 2) % 6, tires: 0, shocks: 5 }, nitros: 30 },
        { name: 'CPU1', ai: { skill: 1.1, aggression: 1 }, upgrades: { accel: 5, speed: 5, tires: 5, shocks: 5 }, nitros: 20 },
        { name: 'CPU2', ai: { skill: 0.6, aggression: 0.3 }, vehicle: 'buggy', upgrades: {}, nitros: 5 },
        { name: 'CPU3', ai: { skill: 0.9, aggression: 0.7 }, upgrades: { accel: 2, speed: 2, tires: 2, shocks: 2 }, nitros: 10 },
      ];
      const race = new Race(track, entries, { seed, laps: 3 });
      races++;
      // monkey: holds random inputs for random durations (lots of steering, reversing, nitro spam)
      const inp = { steer: 0, throttle: 0, brake: 0, nitro: false };
      let hold = 0, t = 0;
      const inWall = [0, 0, 0, 0];
      const minLap = track.L / 40; // faster than 40 m/s average is impossible
      const seenLap = race.racers.map(() => 0);
      while (race.state !== 'done' && t < 420) {
        hold -= DT;
        if (hold <= 0) {
          hold = 0.1 + r() * 0.9;
          inp.steer = [-1, -1, 0, 1, 1][Math.floor(r() * 5)];
          inp.throttle = r() < 0.8 ? 1 : 0;
          inp.brake = inp.throttle ? 0 : (r() < 0.6 ? 1 : 0);
          inp.nitro = r() < 0.15;
        } else inp.nitro = false;
        race.step(DT, [inp]);
        t += DT;
        for (const ev of race.events) {
          if (ev[0] === 'lap' || ev[0] === 'finish') {
            const rc = race.racers[ev[1]];
            if (ev[3] < minLap) report(`${def.id}${reverse ? '-r' : ''} seed ${seed}: ${rc.entry.name} lap of ${ev[3].toFixed(2)}s (< ${minLap.toFixed(1)}s)`);
            seenLap[ev[1]]++;
          }
        }
        for (const rc of race.racers) {
          const k = rc.truck;
          if (![k.x, k.z, k.y, k.vx, k.vz, k.vy, k.h, k.w].every(Number.isFinite)) { report(`${def.id}${reverse ? '-r' : ''} seed ${seed}: NaN on ${rc.entry.name} at t=${t.toFixed(2)}`); t = 1e9; break; }
          if (k.x < ARENA.x0 || k.x > ARENA.x1 || k.z < ARENA.z0 || k.z > ARENA.z1) { report(`${def.id}${reverse ? '-r' : ''} seed ${seed}: ${rc.entry.name} left the arena (${k.x.toFixed(1)}, ${k.z.toFixed(1)})`); t = 1e9; break; }
          const d = track.sdfAt(k.x, k.z);
          inWall[rc.i] = d > WALL_FACE + 0.6 ? inWall[rc.i] + DT : 0;
          if (inWall[rc.i] > 1.5) { report(`${def.id}${reverse ? '-r' : ''} seed ${seed}: ${rc.entry.name} stuck inside a barrier at (${k.x.toFixed(1)}, ${k.z.toFixed(1)}) sdf ${d.toFixed(2)}`); inWall[rc.i] = -1e9; }
          if (k.y < -3 || k.y > 40) { report(`${def.id}${reverse ? '-r' : ''} seed ${seed}: ${rc.entry.name} height ${k.y.toFixed(1)}`); t = 1e9; break; }
        }
      }
      if (t < 1e8 && race.state !== 'done') report(`${def.id}${reverse ? '-r' : ''} seed ${seed}: race not finished after ${t.toFixed(0)}s (state ${race.state})`);
      const cpuDone = race.racers.filter((x) => !x.human && x.finished).length;
      if (cpuDone === 0) report(`${def.id}${reverse ? '-r' : ''} seed ${seed}: no CPU finished`);
    }
  }
}
console.log(`${races} races, ${problems} problems`);
