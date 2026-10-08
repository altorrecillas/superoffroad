// Finds moments when a truck is high in the air (for screenshots): node tools/test/findjump.mjs <track> <seed>
import { buildTrack } from '../../js/sim/track.js';
import { trackById } from '../../js/sim/tracks.js';
import { Race } from '../../js/sim/race.js';
import { Session } from '../../js/game/session.js';
import { TRUCKS } from '../../js/game/drivers.js';
const [id = 'blaster', seed = '5'] = process.argv.slice(2);
const track = buildTrack(trackById(id), { reverse: false });
const session = new Session([], 'normal');
const entries = TRUCKS.map((d, i) => ({ truckId: d.id, name: d.cpu.name, short: d.cpu.short, ironman: !!d.cpu.ironman, ...session.cpuSetup(d), slot: i }));
const race = new Race(track, entries, { seed: +seed, dpa: session.diff.dpa });
const DT = 1 / 120;
let t = 0, found = 0;
while (t < 40 && found < 8) {
  race.step(DT, []);
  t += DT;
  race.racers.forEach((r, i) => {
    const tr = r.truck;
    if (tr.air && tr.hAbove > 1.3 && (!r._last || t - r._last > 3)) {
      r._last = t;
      found++;
      console.log(`t=${(t).toFixed(2)} ff=${(t).toFixed(2)} truck=${i} (${r.entry.truckId}) h=${tr.hAbove.toFixed(2)} x=${tr.x.toFixed(1)} z=${tr.z.toFixed(1)}`);
    }
  });
}
