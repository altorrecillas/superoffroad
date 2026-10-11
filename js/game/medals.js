// Time trial medals. On every circuit and direction Ironman sets a time with the same
// vehicle and garage level as the player (a simulated run of the best CPU driver,
// deterministic, so it is the same on every device); his run races alongside as a
// golden ghost. Beat him for gold, stay within 5 % for silver and 12 % for bronze.

import { Race } from '../sim/race.js';
import { GhostRecorder } from './ghost.js';

export const MEDALS = ['bronze', 'silver', 'gold'];
export const MEDAL_NAME = { gold: 'ORO', silver: 'PLATA', bronze: 'BRONCE' };
const MARGIN = { gold: 1, silver: 1.05, bronze: 1.12 };
const LS = 'sor.medals.v1';
const DT = 1 / 120;

// Ironman's run: the ghost (same format as the player's) and its time
export function ironmanRun(track, vehicle = 'truck', laps = 3, upgrades = { tires: 2, shocks: 2, accel: 2, speed: 2 }) {
  const entries = [{ truckId: 'grey', vehicle, name: 'Ironman', human: true, player: 0, upgrades: { ...upgrades }, nitros: 10, slot: 0 }];
  const race = new Race(track, entries, { seed: 1, laps, pickups: false });
  race.autopilot = true;
  race.autopilotSkill = 1;
  const me = race.racers[0], rec = new GhostRecorder(me), lapT = [];
  for (let t = 0; race.state !== 'done' && t < 600; t += DT) {
    race.step(DT, []);
    rec.step(race);
    for (const ev of race.events) if ((ev[0] === 'lap' || ev[0] === 'finish') && ev[3]) lapT.push(ev[3]);
  }
  if (!me.finished || me.dnf) return null;
  return { t: me.finishTime, laps: lapT, v: vehicle, c: 'grey', s: rec.s, iron: true };
}

export function medalTimes(ironT) {
  const r = (x) => Math.round(x * 100) / 100;
  return { gold: r(ironT * MARGIN.gold), silver: r(ironT * MARGIN.silver), bronze: r(ironT * MARGIN.bronze) };
}
export function medalFor(t, ironT) {
  if (!t || !ironT) return null;
  const m = medalTimes(ironT);
  return t <= m.gold ? 'gold' : t <= m.silver ? 'silver' : t <= m.bronze ? 'bronze' : null;
}
export const medalRank = (m) => MEDALS.indexOf(m); // -1 for none

export function loadMedals() {
  try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; }
}
// keeps the best medal of each circuit and direction; returns true if it is a better one
export function saveMedal(key, medal, t, vehicle) {
  if (!medal) return false;
  const all = loadMedals(), cur = all[key];
  if (cur && medalRank(cur.m) >= medalRank(medal)) return false;
  all[key] = { m: medal, t, v: vehicle, at: Date.now() };
  try { localStorage.setItem(LS, JSON.stringify(all)); } catch (e) { /* storage unavailable */ }
  return true;
}
// a small round medal for the HUD, cards and results
export const medalIcon = (m, cls = '') => `<i class="medal ${m || 'none'} ${cls}"></i>`;
