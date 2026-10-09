// A whole championship with the real session rules (CPU levels and skill per
// race, DPA, prizes, shop) against a simulated keyboard player who reacts every
// 60 ms with full key presses and buys upgrades between races.
// Usage: node tools/test/season.mjs [difficulty=normal] [playerSkill=0.85] [races=16] [vehicle=truck]
import { buildTrack } from '../../js/sim/track.js';
import { trackById } from '../../js/sim/tracks.js';
import { Race } from '../../js/sim/race.js';
import { AIDriver } from '../../js/sim/ai.js';
import { Session } from '../../js/game/session.js';

const [diff = 'normal', skillArg = '0.85', racesArg = '16', vehicle = 'truck', seedArg = '100'] = process.argv.slice(2);
const SKILL = +skillArg, RACES = +racesArg;
const DT = 1 / 120;
const s = new Session([{ truckId: 'red', vehicle }], diff, 'all');
const p = s.players[0];
p.credits = 99; // keep racing to see the whole curve; count losses instead
let lost = 0, wins = 0;
const cache = new Map();
for (let n = 0; n < RACES; n++) {
  const { id, reverse } = s.currentTrack();
  const key = id + (reverse ? '-r' : '');
  if (!cache.has(key)) cache.set(key, buildTrack(trackById(id), { reverse }));
  const track = cache.get(key);
  const entries = s.entries();
  const race = new Race(track, entries, { seed: +seedArg + n, ...s.raceOpts() });
  const me = race.racers.find((r) => r.human);
  const brain = new AIDriver(me.truck, track, { skill: SKILL, aggression: 0.6, seed: +seedArg + 5 + n });
  const inp = { steer: 0, throttle: 1, brake: 0, nitro: false };
  let hold = 0, t = 0;
  while (race.state !== 'done' && t < 400) {
    const a = race.state === 'race' ? brain.update(DT, race.trucks) : inp;
    hold -= DT;
    if (hold <= 0) {
      hold = 0.06;
      inp.steer = Math.abs(a.steer) < 0.25 ? 0 : Math.sign(a.steer);
      inp.throttle = a.brake > 0.5 ? 0 : 1;
      inp.brake = a.brake > 0.5 ? 1 : 0;
      inp.nitro = !!a.nitro;
    } else inp.nitro = false;
    race.step(DT, [inp]);
    t += DT;
  }
  const iron = race.racers.find((r) => r.entry.ironman);
  const sum = s.applyResults(race);
  const pl = sum.players[0];
  if (pl.lost) lost++;
  if (pl.place === 1) wins++;
  // shop: cheapest upgrade first, keep 3 nitros in stock
  let bought = true;
  while (bought) {
    bought = false;
    const ids = ['tires', 'accel', 'speed', 'shocks'].filter((u) => p.upgrades[u] < 5).sort((a, b) => p.upgrades[a] - p.upgrades[b]);
    for (const u of ids) if (s.buyUpgrade(p, u)) { bought = true; break; }
  }
  while (p.nitros < 6 && s.buyNitro(p, 1)) { /* top up */ }
  const lv = Object.values(p.upgrades).join('');
  console.log(`${String(n + 1).padStart(2)} ${key.padEnd(14)} P${pl.place} ${pl.lost ? 'LOST' : 'ok  '} ironman P${iron.place} (lv ${entries.find((e) => e.ironman).upgrades.speed}, sk ${entries.find((e) => e.ironman).ai.skill.toFixed(2)}) me lv ${lv} $${p.money}`);
}
console.log(`${diff} skill ${SKILL} ${vehicle}: ${wins} wins, ${lost} credits lost in ${RACES} races`);
