// Headless AI race: node tools/test/simrace.mjs <trackId|all> [--rev] [--laps N] [--trace out.json]
import { buildTrack } from '../../js/sim/track.js';
import { TRACKS } from '../../js/sim/tracks.js';
import { Race } from '../../js/sim/race.js';

const args = process.argv.slice(2);
const rev = args.includes('--rev');
const lapsI = args.indexOf('--laps');
const laps = lapsI >= 0 ? +args[lapsI + 1] : 4;
const which = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--laps') || 'all';
const DT = 1 / 120;

for (const def of TRACKS) {
  if (which !== 'all' && def.id !== which) continue;
  const track = buildTrack(def, { reverse: rev });
  const entries = [
    { name: 'Ironman', ai: { skill: 1.0, aggression: 0.8 }, upgrades: { accel: 2, speed: 2, tires: 2, shocks: 2 } },
    { name: 'Red', ai: { skill: 0.85, aggression: 0.6, bias: -0.8 }, upgrades: {} },
    { name: 'Blue', ai: { skill: 0.8, aggression: 0.4, bias: 0.8 }, upgrades: {} },
    { name: 'Yellow', ai: { skill: 0.7, aggression: 0.5 }, upgrades: {} },
  ];
  const race = new Race(track, entries, { laps, seed: 7 });
  const stats = race.racers.map(() => ({ walls: 0, maxWall: 0, air: 0, maxAir: 0, stuck: 0, nitro: 0, bumps: 0, maxSpeed: 0, slowT: 0, wrong: 0 }));
  let t = 0;
  while (race.state !== 'done' && t < 400) {
    race.step(DT, []);
    t += DT;
    for (const ev of race.events) {
      const s = stats[ev[1]];
      if (!s) continue;
      if (ev[0] === 'wall') { s.walls++; s.maxWall = Math.max(s.maxWall, ev[2]); }
      if (ev[0] === 'land') { s.air++; s.maxAir = Math.max(s.maxAir, ev[3]); }
      if (ev[0] === 'nitro') s.nitro++;
      if (ev[0] === 'wrongway') s.wrong++;
    }
    race.racers.forEach((r, i) => {
      stats[i].maxSpeed = Math.max(stats[i].maxSpeed, r.truck.speed);
      if (race.state === 'race' && r.truck.speed < 2 && !r.finished) stats[i].slowT += DT;
    });
  }
  console.log(`== ${def.id}${rev ? ' (rev)' : ''}  L=${track.L.toFixed(0)}m  simT=${t.toFixed(1)}s state=${race.state}`);
  for (const r of race.order) {
    const s = stats[r.i];
    console.log(`  P${r.place} ${r.entry.name.padEnd(8)} time=${r.finishTime.toFixed(1)} best=${r.bestLap.toFixed(2)} walls=${s.walls} maxWall=${s.maxWall.toFixed(1)} jumps=${s.air} maxAir=${s.maxAir.toFixed(2)}s nitro=${s.nitro} vmax=${s.maxSpeed.toFixed(1)} slowT=${s.slowT.toFixed(1)} wrong=${s.wrong}${r.dnf ? ' DNF prog=' + r.prog.toFixed(0) : ''}`);
  }
}
