// The player's best lap on each circuit and direction, kept in the browser.

const LS = 'sor.laps.v1';

export const lapKey = (id, reverse) => id + (reverse ? '-r' : '');

export function loadLaps() {
  try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; }
}
export function lapRecord(key) { return loadLaps()[key] || null; }

// returns the previous record (or null) when the time beats it, false otherwise
export function submitLap(key, t, info = {}) {
  const all = loadLaps();
  const cur = all[key] || null;
  if (cur && cur.t <= t) return false;
  all[key] = { t, ...info, at: Date.now() };
  try { localStorage.setItem(LS, JSON.stringify(all)); } catch (e) { /* storage unavailable */ }
  return cur || null;
}
