// The daily challenge: one time trial a day, the same for everybody (it comes from the
// date): circuit, direction, light, the vehicle to use and a twist (no nitro, a single
// lap, five laps, a tank full of nitro). Medals against Ironman in the same conditions,
// the best run of the day kept as a ghost, and a streak of days with a medal.

import { TRACKS } from '../sim/tracks.js';
import { rng } from '../sim/util.js';

export const DAILY_MODS = [
  { id: 'std', name: '3 VUELTAS', laps: 3, nitros: 10, w: 3 },
  { id: 'nonitro', name: 'SIN NITRO', laps: 3, nitros: 0, w: 2 },
  { id: 'sprint', name: 'VUELTA ÚNICA', laps: 1, nitros: 3, w: 2 },
  { id: 'endurance', name: '5 VUELTAS', laps: 5, nitros: 10, w: 1 },
  { id: 'nitro', name: 'NITRO A TOPE', laps: 3, nitros: 30, w: 2 },
];
const TIMES = ['day', 'sunset', 'night'];
const LS = 'sor.daily.v1';

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function dailyChallenge(date = new Date()) {
  const key = dayKey(date);
  const seed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  const r = rng(seed * 7919 + 13);
  for (let i = 0; i < 5; i++) r(); // let the generator settle
  const def = TRACKS[Math.floor(r() * TRACKS.length)];
  const reverse = r() < 0.5, time = TIMES[Math.floor(r() * TIMES.length)], vehicle = r() < 0.5 ? 'truck' : 'buggy';
  let w = r() * DAILY_MODS.reduce((a, m) => a + m.w, 0), mod = DAILY_MODS[0];
  for (const m of DAILY_MODS) { if ((w -= m.w) < 0) { mod = m; break; } }
  const rain = r() < 0.25;
  return { key, id: def.id, name: def.name, reverse, time, vehicle, mod, laps: mod.laps, nitros: mod.nitros, rain };
}

function load() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } }
function save(all) { try { localStorage.setItem(LS, JSON.stringify(all)); } catch (e) { /* storage unavailable */ } }

// today's best (time and medal) and the streak of days in a row with a medal
export function dailyState(key) {
  const all = load(), days = all.days || {};
  return { best: days[key] || null, streak: all.streak || 0, last: all.last || null, medals: Object.values(days).filter((d) => d.m).length };
}

// a run of today's challenge; returns { improved, streak, newDay }
export function dailyResult(key, t, medal) {
  const all = load();
  all.days = all.days || {};
  const cur = all.days[key];
  const rank = (m) => ['bronze', 'silver', 'gold'].indexOf(m);
  const improved = !cur || t < cur.t;
  all.days[key] = { t: improved ? t : cur.t, m: rank(medal) > rank(cur && cur.m) ? medal : (cur && cur.m) || medal || null };
  let newDay = false;
  if (medal && all.last !== key) {
    // the streak goes on if the last medal was yesterday
    const y = new Date(key + 'T12:00:00'); y.setDate(y.getDate() - 1);
    all.streak = all.last === dayKey(y) ? (all.streak || 0) + 1 : 1;
    all.last = key;
    newDay = true;
  }
  // keep a month of days
  const keys = Object.keys(all.days).sort();
  while (keys.length > 31) delete all.days[keys.shift()];
  save(all);
  return { improved, streak: all.streak || 0, newDay, medals: Object.values(all.days).filter((d) => d.m).length };
}
