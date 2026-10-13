// The winner's donuts after the race, on every circuit in both directions: the winner
// must find room, spin for its 6.5 s and stop, without touching a barrier (from the
// moment it stops to spin), while the rest roll to a stop out of its way. And the race
// stays deterministic: the same race twice gives the same donuts to the last bit.
// Usage: node tools/test/donuts.mjs
import { buildTrack } from '../../js/sim/track.js';
import { TRACKS } from '../../js/sim/tracks.js';
import { Race } from '../../js/sim/race.js';

const DT = 1 / 120;
let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };
const entries = () => [
  { name: 'A', ai: { skill: 1.0, aggression: 0.8 }, upgrades: { accel: 2, speed: 2, tires: 2, shocks: 2 } },
  { name: 'B', ai: { skill: 0.85, aggression: 0.6, bias: -0.8 }, upgrades: {} },
  { name: 'C', ai: { skill: 0.8, aggression: 0.4, bias: 0.8 }, upgrades: {} },
  { name: 'D', ai: { skill: 0.7, aggression: 0.5 }, upgrades: {} },
];
const run = (def, rev) => {
  const race = new Race(buildTrack(def, { reverse: rev }), entries(), { laps: 2, seed: 7 });
  while (race.state !== 'done') race.step(DT, []);
  const w = race.finishOrder[0];
  let walls = 0, spin = 0, moving = 0;
  for (let k = 0; k < 120 * 12; k++) {
    race.step(DT, []);
    const ph = w.donut && w.donut.phase;
    for (const ev of race.events) if (ev[0] === 'wall' && ev[1] === w.i && ph !== 'seek') walls++;
    if (ph === 'spin') spin += DT;
    if (k > 120 * 10 && race.racers.some((r) => r !== w && r.truck.speed > 1.5)) moving++;
  }
  return { race, w, walls, spin, moving };
};
for (const rev of [false, true]) {
  for (const def of TRACKS) {
    const { w, walls, spin, moving } = run(def, rev);
    check(spin > 6 && walls === 0 && w.donut.phase === 'end' && w.truck.speed < 1 && !moving,
      `${def.id}${rev ? ' (inv.)' : ''}: ${spin.toFixed(1)} s of donuts, ${walls} barriers touched, then still; the rest stopped`);
  }
}
const a = run(TRACKS[0], false), b = run(TRACKS[0], false);
const sig = (r) => r.race.racers.map((x) => [x.truck.x, x.truck.z, x.truck.h].map((v) => v.toFixed(9)).join(',')).join('|');
check(sig(a) === sig(b), 'the same race twice: the same donuts, to the last bit (replays show them as they were)');
console.log(ok ? 'DONUTS OK' : 'DONUTS FAIL');
process.exit(ok ? 0 : 1);
