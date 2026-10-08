// Time trial ghosts: the best run on each circuit and direction, recorded as truck
// positions 20 times a second and kept in the browser.

const LS = 'sor.ghosts.v1';
export const GHOST_RATE = 20; // samples per second

export const ghostKey = (id, reverse) => id + (reverse ? '-r' : '');

function loadAll() {
  try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; }
}
export function loadGhost(key) {
  const g = loadAll()[key];
  return g && Array.isArray(g.s) && g.s.length >= 8 ? g : null;
}
export function ghostTimes() {
  const all = loadAll(), out = {};
  for (const k in all) if (all[k] && all[k].t) out[k] = all[k].t;
  return out;
}
// keeps the best run only; returns true when it was saved
export function saveGhost(key, ghost) {
  const all = loadAll();
  if (all[key] && all[key].t <= ghost.t) return false;
  all[key] = ghost;
  try { localStorage.setItem(LS, JSON.stringify(all)); return true; } catch (e) { return false; }
}

// records one truck from the green light: x, y, z, heading per sample
export class GhostRecorder {
  constructor(racer) { this.r = racer; this.s = []; }
  step(race) {
    if (race.state !== 'race' || race.time < 0 || this.r.finished) return;
    const t = this.r.truck, want = Math.floor(race.time * GHOST_RATE);
    while (this.s.length / 4 <= want) {
      this.s.push(Math.round(t.x * 100) / 100, Math.round(t.y * 100) / 100, Math.round(t.z * 100) / 100, Math.round(t.h * 1000) / 1000);
    }
  }
}

// state of a recorded run at race time t (seconds since the green light), or null
export function ghostAt(g, t, out) {
  const s = g.s, n = s.length / 4;
  const f = t * GHOST_RATE;
  if (f < 0 || f >= n - 1) return null;
  const i = Math.floor(f), a = f - i, j = i * 4, k = j + 4;
  out.x = s[j] + (s[k] - s[j]) * a;
  out.y = s[j + 1] + (s[k + 1] - s[j + 1]) * a;
  out.z = s[j + 2] + (s[k + 2] - s[j + 2]) * a;
  let dh = s[k + 3] - s[j + 3];
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  out.h = s[j + 3] + dh * a;
  out.vf = Math.hypot(s[k] - s[j], s[k + 2] - s[j + 2]) * GHOST_RATE;
  return out;
}
