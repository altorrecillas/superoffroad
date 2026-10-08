// Renders a top-down debug image of a track: node tools/test/trackviz.mjs <id|all> [--rev] [--out dir]
import { buildTrack, BARRIER_ISO } from '../../js/sim/track.js';
import { TRACKS } from '../../js/sim/tracks.js';
import { isoContours, smoothLine } from '../../js/sim/contour.js';
import { Canvas } from './png.mjs';

const args = process.argv.slice(2);
const rev = args.includes('--rev');
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : '.';
const which = args.find((a) => !a.startsWith('--') && a !== outDir) || 'all';
const PX = 8; // pixels per metre

for (const def of TRACKS) {
  if (which !== 'all' && def.id !== which) continue;
  const t = buildTrack(def, { reverse: rev });
  const W = Math.round((t.x1 - t.x0) * PX), H = Math.round((t.z1 - t.z0) * PX);
  const cv = new Canvas(W, H);
  const toPx = (x, z) => [(x - t.x0) * PX, (z - t.z0) * PX];
  // hillshade + drivable tint
  const n = [0, 0, 0];
  let hmin = Infinity, hmax = -Infinity;
  for (const v of t.height) { if (v < hmin) hmin = v; if (v > hmax) hmax = v; }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wx = t.x0 + x / PX, wz = t.z0 + y / PX;
      t.normalAt(wx, wz, n);
      const shade = Math.max(0, n[0] * -0.5 + n[1] * 0.7 + n[2] * -0.5);
      const h = t.heightAt(wx, wz);
      const e = (h - hmin) / Math.max(0.01, hmax - hmin);
      const s = t.sdfAt(wx, wz);
      let r, g, b;
      if (s < 0) { r = 170; g = 110; b = 60; } else { r = 110; g = 70; b = 40; }
      const k = 0.45 + 0.75 * shade;
      r = r * k + e * 40; g = g * k + e * 30; b = b * k + e * 10;
      const wd = t.waterAt(wx, wz);
      if (wd > 0.01) { r = 40; g = 90 + 0 * wd; b = 170; }
      cv.set(x, y, r, g, b);
    }
  }
  // barrier contours
  const lines = isoContours(t.bsdf, t.nx, t.nz, BARRIER_ISO, t.x0, t.z0, t.cell);
  let nb = 0;
  for (const raw of lines) {
    if (raw.length < 4) continue;
    const ln = smoothLine(raw, 2);
    let acc = 0;
    for (let i = 0; i + 1 < ln.length + (ln.closed ? 1 : 0); i++) {
      const a = ln[i], b = ln[(i + 1) % ln.length];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const red = Math.floor(acc / 2) % 2 === 0;
      acc += seg;
      const [x0, y0] = toPx(a[0], a[1]), [x1, y1] = toPx(b[0], b[1]);
      cv.line(x0, y0, x1, y1, red ? [220, 30, 30] : [240, 240, 240], 2);
    }
    nb++;
  }
  // centre line + racing line
  const p = t.path;
  for (let i = 0; i < p.n; i += 2) {
    const [x, y] = toPx(p.x[i], p.z[i]);
    cv.set(x, y, 255, 230, 0);
  }
  const ln = t.line;
  const vp = t.speedProfile(18, 12, 24);
  for (let k = 0; k < ln.m; k++) {
    const [x, y] = toPx(ln.x[k], ln.z[k]);
    const q = Math.min(1, vp[k] / 24);
    cv.dot(x, y, 1, [Math.round(255 * (1 - q)), Math.round(255 * q), 60]);
  }
  // direction arrows every 30 m
  for (let i = 0; i < p.n; i += 60) {
    const [x, y] = toPx(p.x[i], p.z[i]);
    const [x2, y2] = toPx(p.x[i] + p.tx[i] * 3, p.z[i] + p.tz[i] * 3);
    cv.line(x, y, x2, y2, [0, 0, 255], 1);
  }
  // start line and grid
  const sl = t.startLine;
  const [sx0, sy0] = toPx(sl.x - sl.tz * sl.hw, sl.z + sl.tx * sl.hw);
  const [sx1, sy1] = toPx(sl.x + sl.tz * sl.hw, sl.z - sl.tx * sl.hw);
  cv.line(sx0, sy0, sx1, sy1, [0, 0, 0], 2);
  for (const g of t.grid) {
    const [x, y] = toPx(g.x, g.z);
    cv.dot(x, y, 5, [255, 255, 255]);
    const [x2, y2] = toPx(g.x + Math.cos(g.h) * 3, g.z + Math.sin(g.h) * 3);
    cv.line(x, y, x2, y2, [0, 0, 0], 1);
  }
  for (const pr of t.props) {
    const [x, y] = toPx(pr.x, pr.z);
    cv.dot(x, y, pr.r * PX, [200, 200, 220]);
  }
  const file = `${outDir}/track_${def.id}${rev ? '_rev' : ''}.png`;
  cv.save(file);
  console.log(`${def.id}${rev ? ' (rev)' : ''}: L=${t.L.toFixed(1)}m barriers=${nb} build=${t.buildMs.toFixed(0)}ms h=[${hmin.toFixed(2)},${hmax.toFixed(2)}] -> ${file}`);
}
