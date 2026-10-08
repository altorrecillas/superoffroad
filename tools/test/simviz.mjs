// Runs an AI race and draws the trucks' trajectories + wall hits over the track:
// node tools/test/simviz.mjs <trackId> [--rev] [--out dir] [--laps N]
import { buildTrack, BARRIER_ISO } from '../../js/sim/track.js';
import { trackById } from '../../js/sim/tracks.js';
import { isoContours, smoothLine } from '../../js/sim/contour.js';
import { Race } from '../../js/sim/race.js';
import { Canvas } from './png.mjs';

const args = process.argv.slice(2);
const rev = args.includes('--rev');
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : '.';
const lapsI = args.indexOf('--laps');
const laps = lapsI >= 0 ? +args[lapsI + 1] : 2;
const id = args[0];
const PX = 8;
const def = trackById(id);
const t = buildTrack(def, { reverse: rev });
const W = Math.round((t.x1 - t.x0) * PX), H = Math.round((t.z1 - t.z0) * PX);
const cv = new Canvas(W, H);
const toPx = (x, z) => [(x - t.x0) * PX, (z - t.z0) * PX];
const n = [0, 0, 0];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const wx = t.x0 + x / PX, wz = t.z0 + y / PX;
  t.normalAt(wx, wz, n);
  const shade = Math.max(0, n[0] * -0.5 + n[1] * 0.7 + n[2] * -0.5);
  const s = t.sdfAt(wx, wz);
  const k = 0.5 + 0.7 * shade;
  let c = s < 0 ? [150, 120, 95] : [80, 64, 50];
  if (t.waterAt(wx, wz) > 0.01) c = [60, 90, 150];
  cv.set(x, y, c[0] * k, c[1] * k, c[2] * k);
}
for (const raw of isoContours(t.bsdf, t.nx, t.nz, BARRIER_ISO, t.x0, t.z0, t.cell)) {
  if (raw.length < 4) continue;
  const ln = smoothLine(raw, 2);
  for (let i = 0; i + 1 < ln.length; i++) {
    const [x0, y0] = toPx(ln[i][0], ln[i][1]), [x1, y1] = toPx(ln[i + 1][0], ln[i + 1][1]);
    cv.line(x0, y0, x1, y1, [230, 230, 230], 1);
  }
}
const ln = t.line;
for (let k = 0; k < ln.m; k++) { const [x, y] = toPx(ln.x[k], ln.z[k]); cv.dot(x, y, 1, [255, 255, 0]); }

const entries = [
  { name: 'Ironman', ai: { skill: 1.0, aggression: 0.8 }, upgrades: { accel: 2, speed: 2, tires: 2, shocks: 2 } },
  { name: 'Red', ai: { skill: 0.85, aggression: 0.6, bias: -0.8 }, upgrades: {} },
  { name: 'Blue', ai: { skill: 0.8, aggression: 0.4, bias: 0.8 }, upgrades: {} },
  { name: 'Yellow', ai: { skill: 0.7, aggression: 0.5 }, upgrades: {} },
];
const COLS = [[200, 200, 210], [230, 40, 40], [40, 90, 240], [240, 200, 20]];
const race = new Race(t, entries, { laps, seed: 7, pickups: false });
const DT = 1 / 120;
let time = 0, frame = 0;
while (race.state !== 'done' && time < 300) {
  race.step(DT, []);
  time += DT; frame++;
  if (frame % 6 === 0) race.racers.forEach((r, i) => {
    const tr = r.truck;
    const [x, y] = toPx(tr.x, tr.z);
    if (tr.air && tr.hAbove > 0.3) cv.dot(x, y, 2, [255, 255, 255]);
    else cv.set(x, y, ...COLS[i]);
  });
  for (const ev of race.events) {
    if (ev[0] === 'wall') {
      const [x, y] = toPx(ev[3], ev[4]);
      const r = Math.min(8, 2 + ev[2] / 2);
      cv.line(x - r, y - r, x + r, y + r, [255, 0, 255], 1); cv.line(x - r, y + r, x + r, y - r, [255, 0, 255], 1);
    }
  }
}
const file = `${outDir}/sim_${id}${rev ? '_rev' : ''}.png`;
cv.save(file);
console.log(file, race.order.map((r) => `${r.entry.name}:${r.bestLap.toFixed(1)}`).join(' '));
