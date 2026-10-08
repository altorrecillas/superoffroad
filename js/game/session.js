// Championship state: players, money, upgrades, credits, race rotation,
// CPU difficulty curve, prizes and the high-score table.

import { TRUCKS, truckDef } from './drivers.js';
import { SEASONS } from '../sim/tracks.js';

export const PRIZES = [100000, 90000, 80000, 70000];
export const UPGRADES = [
  { id: 'tires', name: 'Neumáticos', desc: 'Más agarre en las curvas y giros más rápidos.' },
  { id: 'shocks', name: 'Amortiguadores', desc: 'Aterrizajes y baches sin perder el control.' },
  { id: 'accel', name: 'Aceleración', desc: 'Sales disparado de cada curva.' },
  { id: 'speed', name: 'Velocidad punta', desc: 'Más velocidad en las rectas.' },
];
export const UPGRADE_COST = [20000, 40000, 60000, 80000, 100000];
export const MAX_LEVEL = 5;
export const NITRO_COST = 5000;
export const CREDIT_CASH = 200000;
export const START_CREDITS = 3;
export const START_NITROS = 10;
// match: how the CPU keeps up with the player's shopping (levels relative to the
// best human's average upgrade level; Ironman always one more)
export const DIFFICULTY = {
  easy: { name: 'Fácil', dpa: 0.12, skill: 0.9, upEvery: 5, rule: 'last', match: -2 },
  normal: { name: 'Normal', dpa: 0.07, skill: 1.0, upEvery: 4, rule: 'ironman', match: -1 },
  arcade: { name: 'Arcade', dpa: 0.045, skill: 1.06, upEvery: 3, rule: 'any', match: 0 },
};

const LS_SCORES = 'sor.highscores.v1';

export class Session {
  constructor(players, difficulty = 'normal', tracks = 'all', free = null) {
    this.difficulty = difficulty;
    this.rotation = SEASONS[tracks] || SEASONS.all;
    this.free = free; // single race: { id, reverse, time, trial }
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.raceNo = 0;
    this.players = players.map((p, i) => ({
      index: i,
      truckId: p.truckId,
      vehicle: p.vehicle || 'truck',
      name: p.name || `JUGADOR ${i + 1}`,
      money: 0,
      earned: 0,
      upgrades: { tires: 0, shocks: 0, accel: 0, speed: 0 },
      nitros: START_NITROS,
      credits: START_CREDITS,
      alive: true,
      wins: 0,
    }));
  }

  get humans() { return this.players.filter((p) => p.alive); }

  currentTrack() {
    if (this.free) return { id: this.free.id, reverse: this.free.reverse, time: this.free.time };
    const [id, reverse] = this.rotation[this.raceNo % this.rotation.length];
    return { id, reverse };
  }
  get lap() { return Math.floor(this.raceNo / this.rotation.length); } // completed seasons

  // CPU upgrade levels and skill grow through the championship
  // the human trucks' equipment: average upgrade level of the best equipped player
  humanLevel() {
    let best = 0;
    for (const p of this.players) {
      if (!p.alive) continue;
      const u = p.upgrades;
      best = Math.max(best, (u.tires + u.shocks + u.accel + u.speed) / 4);
    }
    return best;
  }

  cpuSetup(def) {
    const n = this.raceNo, d = this.diff;
    const ironman = !!def.cpu.ironman;
    const base = ironman && this.difficulty === 'arcade' ? 1 : 0;
    const scheduled = base + Math.floor((n + (ironman ? 1 : 0)) / d.upEvery) + this.lap;
    // the garage keeps the rivals in touch with the player's own upgrades
    const matched = this.players.length ? Math.floor(this.humanLevel() + (d.match ?? -1) + (ironman ? 1 : 0)) : 0;
    const lvl = Math.max(0, Math.min(MAX_LEVEL, Math.max(scheduled, matched)));
    const ramp = Math.min(1, n / 14);
    let skill = def.cpu.skill * d.skill * (0.86 + 0.16 * ramp) + this.lap * 0.03;
    skill = Math.min(1.2, skill);
    const ups = { tires: lvl, shocks: lvl, accel: lvl, speed: lvl };
    if (!ironman && lvl > 0) {
      // the staff drivers each favour something
      const fav = { red: 'speed', blue: 'tires', yellow: 'accel' }[def.id];
      ups[fav] = Math.min(MAX_LEVEL, lvl + 1);
    }
    return {
      upgrades: ups,
      nitros: 4 + Math.min(8, Math.floor(n / 2)) + (ironman ? 2 : 0),
      ai: { skill, aggression: def.cpu.aggression, bias: def.cpu.bias, dpaScale: ironman ? 0.7 : 1 },
    };
  }

  // race entries for all four trucks, human players first in grid order
  entries() {
    const out = [];
    const used = new Set();
    for (const p of this.players) {
      if (!p.alive) continue;
      const def = truckDef(p.truckId);
      used.add(def.id);
      out.push({
        truckId: def.id, vehicle: p.vehicle, name: p.name, short: p.name, human: true, player: p.index,
        upgrades: { ...p.upgrades }, nitros: p.nitros,
        ai: { skill: 0.5, aggression: 0 },
      });
    }
    if (this.free && this.free.trial) { out.forEach((e, i) => (e.slot = i)); return out; } // time trial: alone on the track
    for (const def of TRUCKS) {
      if (used.has(def.id)) continue;
      const s = this.cpuSetup(def);
      out.push({ truckId: def.id, name: def.cpu.name, short: def.cpu.short, human: false, ironman: !!def.cpu.ironman, ...s });
    }
    // grid: losers of the previous race start at the front, like a reverse grid
    const order = this.lastOrder || [];
    out.sort((a, b) => (order.indexOf(b.truckId) - order.indexOf(a.truckId)));
    out.forEach((e, i) => (e.slot = i));
    return out;
  }

  // apply a finished race; returns a summary for the results screen
  applyResults(race) {
    const rows = race.finishOrder.map((r) => ({
      truckId: r.entry.truckId, name: r.entry.name, human: r.human, player: r.entry.player,
      place: r.place, time: r.finished && !r.dnf ? r.finishTime : null, bestLap: r.bestLap, bags: r.money,
      ironman: !!r.entry.ironman,
    }));
    this.lastOrder = rows.map((r) => r.truckId);
    const cpuPlaces = rows.filter((r) => !r.human).map((r) => r.place);
    const ironPlace = rows.find((r) => r.ironman)?.place ?? 99;
    const out = { rows, players: [], raceNo: this.raceNo };
    for (const row of rows) {
      if (!row.human) continue;
      const p = this.players[row.player];
      const r = race.racers.find((x) => x.human && x.entry.player === p.index);
      const prize = PRIZES[row.place - 1] || 0;
      p.money += prize + row.bags;
      p.earned += prize + row.bags;
      p.nitros = r ? r.truck.nitros : p.nitros;
      if (row.place === 1) p.wins++;
      let lost = false;
      if (this.diff.rule === 'last') lost = row.place === 4;
      else if (this.diff.rule === 'ironman') lost = ironPlace < row.place;
      else lost = cpuPlaces.some((c) => c < row.place);
      if (lost) p.credits--;
      out.players.push({ index: p.index, prize, bags: row.bags, lost, credits: p.credits, place: row.place });
    }
    this.raceNo++;
    return out;
  }

  // a player without credits is out (their truck goes back to the CPU)
  eliminate(index) { this.players[index].alive = false; }
  get over() { return this.players.every((p) => !p.alive); }

  buyUpgrade(p, id) {
    const lvl = p.upgrades[id];
    if (lvl >= MAX_LEVEL) return false;
    const cost = UPGRADE_COST[lvl];
    if (p.money < cost) return false;
    p.money -= cost;
    p.upgrades[id] = lvl + 1;
    return true;
  }
  buyNitro(p, n = 1) {
    const k = Math.min(n, 99 - p.nitros, Math.floor(p.money / NITRO_COST));
    if (k <= 0) return 0;
    p.money -= k * NITRO_COST;
    p.nitros += k;
    return k;
  }
  // the arcade's convert-a-credit: trade a credit for cash
  convertCredit(p) {
    if (p.credits <= 1) return false;
    p.credits--;
    p.money += CREDIT_CASH;
    return true;
  }
}

// ------------------------------------------------------------------ high scores
const DEFAULT_SCORES = [
  ['IVN', 2400000, 16], ['SAM', 1800000, 12], ['ERL', 1500000, 10], ['JON', 1200000, 9], ['LEL', 900000, 7],
  ['TOY', 700000, 5], ['RCE', 500000, 4], ['MUD', 400000, 3], ['NTR', 300000, 2], ['DRT', 200000, 1],
].map(([name, score, races]) => ({ name, score, races }));

export function loadScores() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SCORES));
    if (Array.isArray(s) && s.length) return s;
  } catch (e) { /* storage unavailable */ }
  return DEFAULT_SCORES.map((x) => ({ ...x }));
}
export function qualifies(score) {
  const s = loadScores();
  return s.length < 10 || score > s[s.length - 1].score;
}
export function addScore(entry) {
  const s = loadScores();
  s.push(entry);
  s.sort((a, b) => b.score - a.score);
  const top = s.slice(0, 10);
  try { localStorage.setItem(LS_SCORES, JSON.stringify(top)); } catch (e) { /* ignore */ }
  return top.indexOf(entry);
}

export function fmtMoney(v) {
  return '$' + Math.round(v).toLocaleString('es-ES');
}
