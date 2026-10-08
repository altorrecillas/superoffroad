// Simulates a keyboard player (digital left/right, gas held) against the CPU on every track.
import { buildTrack } from '../../js/sim/track.js';
import { TRACKS } from '../../js/sim/tracks.js';
import { Race } from '../../js/sim/race.js';
import { AIDriver } from '../../js/sim/ai.js';
import { wrapAngle } from '../../js/sim/util.js';

const DT = 1 / 120;
const rev = process.argv.includes('--rev');
for (const def of TRACKS) {
  const track = buildTrack(def, { reverse: rev });
  const entries = [
    { name: 'KEYS', human: true, player: 0, upgrades: {}, nitros: 10 },
    { name: 'Ironman', ai: { skill: 0.93, aggression: 0.8 }, upgrades: { accel: 1, speed: 1, tires: 1, shocks: 1 }, ironman: true },
    { name: 'Red', ai: { skill: 0.8, aggression: 0.6 }, upgrades: {} },
    { name: 'Blue', ai: { skill: 0.78, aggression: 0.5 }, upgrades: {} },
  ];
  const race = new Race(track, entries, { seed: 3, dpa: 0.07 });
  const me = race.racers[0];
  // a "player" that sees where to go (AI target) but only presses keys
  const brain = new AIDriver(me.truck, track, { skill: 0.85, aggression: 0.5 });
  const inp = { steer: 0, throttle: 1, brake: 0, nitro: false };
  let walls = 0, hold = 0, t = 0;
  while (race.state !== 'done' && t < 300) {
    const a = brain.update(DT, race.trucks);
    // human reaction: re-decide every 60 ms, dead zone, full key press
    hold -= DT;
    if (hold <= 0) {
      hold = 0.06;
      inp.steer = Math.abs(a.steer) < 0.25 ? 0 : Math.sign(a.steer);
      inp.throttle = a.brake > 0.5 ? 0 : 1;
      inp.brake = a.brake > 0.5 ? 1 : 0;
      inp.nitro = a.nitro;
    } else inp.nitro = false;
    race.step(DT, [inp]);
    for (const ev of race.events) if (ev[0] === 'wall' && ev[1] === 0) walls++;
    t += DT;
  }
  const ai = race.racers.find((r) => r.entry.ironman);
  console.log(`${def.id.padEnd(12)} keys: P${me.place} best ${me.bestLap.toFixed(2)} walls ${walls} | ironman P${ai.place} best ${ai.bestLap.toFixed(2)}`);
}
