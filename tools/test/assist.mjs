// Steering assist check: a clumsy touch-screen player (late reactions, full presses,
// sometimes lets go of the steering, never brakes) races the same circuits with the
// assist off, soft and strong. Reports places, race times and barrier hits.
// Usage: node tools/test/assist.mjs [playerSkill=0.45] [races=8] [reaction=0.16]
import { buildTrack } from '../../js/sim/track.js';
import { trackById, SEASON } from '../../js/sim/tracks.js';
import { Race } from '../../js/sim/race.js';
import { AIDriver } from '../../js/sim/ai.js';
import { SteerAssist } from '../../js/sim/assist.js';
import { Session } from '../../js/game/session.js';
import { rng } from '../../js/sim/util.js';

const [skillArg = '0.45', racesArg = '8', reactArg = '0.16'] = process.argv.slice(2);
const SKILL = +skillArg, RACES = +racesArg, REACT = +reactArg;
const DT = 1 / 120;
const res = {};
for (const level of ['off', 'soft', 'strong']) {
  const out = { place: 0, time: 0, walls: 0, wallHard: 0, done: 0 };
  for (let n = 0; n < RACES; n++) {
    const [id, reverse] = SEASON[n % SEASON.length];
    const track = buildTrack(trackById(id), { reverse });
    const s = new Session([{ truckId: 'red' }], 'normal');
    s.raceNo = 6;
    s.players[0].upgrades = { tires: 2, shocks: 2, accel: 2, speed: 2 };
    const race = new Race(track, s.entries(), { seed: 500 + n, ...s.raceOpts() });
    const me = race.racers.find((r) => r.human);
    const brain = new AIDriver(me.truck, track, { skill: SKILL, aggression: 0.5, seed: 77 + n });
    const assist = new SteerAssist(me.truck, track, level);
    const r = rng(900 + n);
    const inp = { steer: 0, throttle: 1, brake: 0, nitro: false };
    const delay = []; // decisions arrive REACT seconds late
    let hold = 0, letGo = 0, t = 0;
    while (race.state !== 'done' && t < 420) {
      const a = race.state === 'race' ? brain.update(DT, race.trucks) : inp;
      delay.push(Math.abs(a.steer) < 0.3 ? 0 : Math.sign(a.steer));
      const late = delay.length > REACT / DT ? delay.shift() : 0;
      hold -= DT;
      if (hold <= 0) {
        hold = 0.05;
        if (letGo > 0) letGo -= 0.05; else if (r() < 0.012) letGo = 0.4 + r() * 0.8; // thumb slips off
        inp.steer = letGo > 0 ? 0 : late;
        inp.nitro = !!a.nitro && r() < 0.5;
      } else inp.nitro = false;
      const o = assist.apply(DT, inp);
      race.step(DT, [o]);
      for (const ev of race.events) if (ev[0] === 'wall' && ev[1] === me.i) { out.walls++; if (ev[2] > 7) out.wallHard++; }
      t += DT;
    }
    out.place += me.place;
    if (me.finished && !me.dnf) { out.time += me.finishTime; out.done++; }
  }
  res[level] = out;
  console.log(`${level.padEnd(7)} avg place ${(out.place / RACES).toFixed(2)} · avg time ${(out.time / Math.max(1, out.done)).toFixed(1)} s (${out.done}/${RACES} finished) · wall hits ${out.walls} (hard ${out.wallHard})`);
}
