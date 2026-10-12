// Championship state: players, money, upgrades, credits, race rotation,
// CPU difficulty curve, prizes and the high-score table.

import { TRUCKS, truckDef } from './drivers.js';
import { paintOf } from './liveries.js';
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
// Four levels, as racing games present them:
//  dpaDown: the arcade's Dynamic Play Adjustment: how much a CPU truck eases off when
//    it is ahead of the best player (ironWait scales it for Ironman)
//  catchUp / dpaUp: a CPU truck more than 15 m behind the player drives sharper (later
//    braking, faster corners, fewer mistakes) and gets more engine
//  base + rampTop: the field's pace at the start of the championship and its growth;
//  adapt: Novato and Piloto follow the player's form (easy wins sharpen the rivals)
//  skill: driving precision; mistakes: how often they brake late or hesitate (0..1);
//  reserve: nitros kept for the last lap; match: CPU upgrades relative to the player's
//  average level (Ironman always one more); prize: money and score multiplier
export const DIFFICULTY = {
  easy: { name: 'Novato', tag: 'NOV', base: 0.84, skill: 0.95, rampTop: 0.08, dpaDown: 0.18, dpaUp: 0.06, catchUp: 1, upEvery: 5, rule: 'last', ironWait: 1, adapt: { win: 2, lose: 1.5, rate: 0.012, min: -0.08, max: 0.07 }, match: -2, mistakes: 0.8, reserve: 0, prize: 0.75,
    desc: 'Para aprender: los rivales te esperan y fallan a menudo.' },
  normal: { name: 'Piloto', tag: 'PIL', base: 0.9, skill: 0.98, rampTop: 0.1, dpaDown: 0.16, dpaUp: 0.1, catchUp: 1.3, upEvery: 4, rule: 'ironman', ironWait: 1, adapt: { win: 1, lose: 2, rate: 0.014, min: -0.06, max: 0.12 }, match: -1, mistakes: 0.5, reserve: 0, prize: 1,
    desc: 'La experiencia clásica: rivales que te plantan cara y se adaptan a tu ritmo.' },
  hard: { name: 'Experto', tag: 'EXP', base: 0.94, skill: 1.03, rampTop: 0.12, dpaDown: 0.06, dpaUp: 0.08, catchUp: 1, upEvery: 3, rule: 'ironman', match: 0, mistakes: 0.2, reserve: 1, prize: 1.25,
    desc: 'Rivales afilados que casi no fallan y guardan nitro para la última vuelta.' },
  arcade: { name: 'Arcade', tag: 'ARC', base: 0.97, skill: 1.08, rampTop: 0.12, dpaDown: 0.02, dpaUp: 0.09, catchUp: 1, upEvery: 3, rule: 'any', match: 0, mistakes: 0, reserve: 2, prize: 1.5,
    desc: 'La recreativa de 1989 sin concesiones: nadie te espera y tienes que ganar a todos.' },
};
export const DIFF_ORDER = ['easy', 'normal', 'hard', 'arcade'];

// The championship goes in cups of four races: points for all four drivers, and at
// the end of each cup a podium ceremony with a bonus for the players on it
export const CUP_SIZE = 4;
export const CUP_POINTS = [10, 6, 4, 3];
export const CUP_BONUS = [150000, 75000, 40000, 0];
const CUP_NAMES = ['COPA DEL POLVO', 'COPA DEL BARRO', 'COPA DE LOS SALTOS', 'COPA DE LOS FOCOS', 'COPA DEL DESIERTO', 'COPA DEL VOLCÁN', 'COPA DE LOS LAGARTOS', 'COPA IRONMAN'];
export const cupName = (n) => CUP_NAMES[n % CUP_NAMES.length] + (n >= CUP_NAMES.length ? ` ${Math.floor(n / CUP_NAMES.length) + 1}` : '');

const LS_SCORES = 'sor.highscores.v1';

export class Session {
  constructor(players, difficulty = 'normal', tracks = 'all', free = null) {
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'normal';
    this.pack = SEASONS[tracks] ? tracks : 'all';
    this.rotation = SEASONS[this.pack];
    this.free = free; // single race: { id, reverse, time, trial }
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.raceNo = 0;
    // adaptive levels (Novato, Piloto): the rivals follow the player's form, sharper
    // after easy wins, a little softer after heavy defeats
    this.form = 0;
    this.cup = { no: 0, race: 0, points: {} };
    this.players = players.map((p, i) => ({
      index: i,
      truckId: p.truckId,
      vehicle: p.vehicle || 'truck',
      livery: p.livery || 'team',
      name: p.name || `JUGADOR ${i + 1}`,
      money: 0,
      earned: 0,
      upgrades: { tires: 0, shocks: 0, accel: 0, speed: 0 },
      nitros: START_NITROS,
      credits: START_CREDITS,
      alive: true,
      wins: 0,
      streak: 0, // wins in a row
      continued: false, // went on with 3 more credits after a game over
    }));
  }

  get humans() { return this.players.filter((p) => p.alive); }

  currentTrack() {
    if (this.free) return { id: this.free.id, reverse: this.free.reverse, time: this.free.time, rain: !!this.free.rain };
    const [id, reverse] = this.rotation[this.raceNo % this.rotation.length];
    // it rains on one race in five: the 4th, the 9th, the 14th...
    return { id, reverse, rain: this.raceNo % 5 === 3 };
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

  // the options a race of this session needs
  raceOpts() { return { dpaDown: this.diff.dpaDown, dpaUp: this.diff.dpaUp, catchUp: this.diff.catchUp }; }

  cpuSetup(def) {
    const n = this.raceNo, d = this.diff;
    const ironman = !!def.cpu.ironman;
    const base = ironman && (this.difficulty === 'arcade' || this.difficulty === 'hard') ? 1 : 0;
    const scheduled = base + Math.floor((n + (ironman ? 1 : 0)) / d.upEvery) + this.lap;
    // the garage keeps the rivals in touch with the player's own upgrades
    const matched = this.players.length ? Math.floor(this.humanLevel() + (d.match ?? -1) + (ironman ? 1 : 0)) : 0;
    const lvl = Math.max(0, Math.min(MAX_LEVEL, Math.max(scheduled, matched)));
    const ramp = Math.min(1, n / 14);
    // the field gets sharper through the championship, up to a ceiling per level
    let skill = def.cpu.skill * d.skill * ((d.base ?? 0.86) + (d.rampTop ?? 0.16) * ramp) + this.lap * 0.03 + (this.form || 0);
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
      ai: { skill, aggression: def.cpu.aggression, bias: def.cpu.bias, dpaScale: ironman ? d.ironWait ?? 0.7 : 1,
        mistakes: d.mistakes * (ironman ? 0.5 : 1), reserve: d.reserve },
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
        truckId: def.id, vehicle: p.vehicle, livery: p.livery, name: p.name, short: p.name, human: true, player: p.index,
        upgrades: { ...p.upgrades }, nitros: p.nitros,
        ai: { skill: 0.5, aggression: 0 },
      });
    }
    if (this.free && (this.free.trial || this.free.tutorial)) { out.forEach((e, i) => (e.slot = i)); return out; } // time trial, tutorial: alone on the track
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

  // what a race pays at this level: harder levels more, the steering assist less
  // (soft -10 %, strong -20 %), like the driving assists of modern racing games
  prizeMult(assist = 0) { return Math.round((this.diff.prize || 1) * (1 - 0.1 * assist) * 100) / 100; }

  // apply a finished race; returns a summary for the results screen
  // opts.assist: the strongest steering assist used in the race (0..2), or one per
  // player (a two-phone race: each player's own choice sets their own prize)
  applyResults(race, opts = {}) {
    const assistOf = (i) => (Array.isArray(opts.assist) ? opts.assist[i] || 0 : opts.assist || 0);
    const rows = race.finishOrder.map((r) => ({
      truckId: r.entry.truckId, name: r.entry.name, short: r.entry.short, vehicle: r.entry.vehicle || 'truck', livery: r.entry.livery, css: paintOf(r.entry.truckId, r.entry.livery).css, human: r.human, player: r.entry.player,
      place: r.place, time: r.finished && !r.dnf ? r.finishTime : null, bestLap: r.bestLap, bags: r.money,
      ironman: !!r.entry.ironman,
    }));
    this.lastOrder = rows.map((r) => r.truckId);
    this._adapt(race);
    const cpuPlaces = rows.filter((r) => !r.human).map((r) => r.place);
    const ironPlace = rows.find((r) => r.ironman)?.place ?? 99;
    const out = { rows, players: [], raceNo: this.raceNo, mult: this.prizeMult(assistOf(0)), assist: assistOf(0) };
    for (const row of rows) {
      if (!row.human) continue;
      const p = this.players[row.player];
      const r = race.racers.find((x) => x.human && x.entry.player === p.index);
      // harder levels pay more (and score more in the records table)
      const k = this.prizeMult(assistOf(p.index));
      const prize = Math.round(((PRIZES[row.place - 1] || 0) * k) / 1000) * 1000;
      const bags = Math.round((row.bags * k) / 1000) * 1000;
      row.bags = bags;
      p.money += prize + bags;
      p.earned += prize + bags;
      p.nitros = r ? r.truck.nitros : p.nitros;
      if (row.place === 1) p.wins++;
      p.streak = row.place === 1 ? (p.streak || 0) + 1 : 0; // wins in a row
      let lost = false;
      if (this.diff.rule === 'last') lost = row.place === 4;
      else if (this.diff.rule === 'ironman') lost = ironPlace < row.place;
      else lost = cpuPlaces.some((c) => c < row.place);
      if (lost) p.credits--;
      out.players.push({ index: p.index, prize, bags, lost, credits: p.credits, place: row.place, mult: k, assist: assistOf(p.index) });
    }
    if (!this.free) out.cup = this._cupPoints(rows, (i) => this.prizeMult(assistOf(i)));
    this.raceNo++;
    return out;
  }

  // cup points of this race; at the end of the cup the standings and the bonuses
  // (mult(i): what player i's prizes are multiplied by)
  _cupPoints(rows, mult) {
    const C = this.cup;
    for (const r of rows) C.points[r.truckId] = (C.points[r.truckId] || 0) + (CUP_POINTS[r.place - 1] || 0);
    C.race++;
    const standings = rows.map((r) => ({ truckId: r.truckId, name: r.name, short: r.short, vehicle: r.vehicle, livery: r.livery, css: r.css, human: r.human, player: r.player, points: C.points[r.truckId] || 0, last: r.place }))
      .sort((a, b) => b.points - a.points || a.last - b.last);
    const cup = { no: C.no, name: cupName(C.no), race: C.race, of: CUP_SIZE, standings, done: C.race >= CUP_SIZE };
    if (cup.done) {
      standings.forEach((st, i) => {
        if (!st.human) return;
        const p = this.players[st.player];
        st.bonus = Math.round(((CUP_BONUS[i] || 0) * mult(st.player)) / 1000) * 1000;
        p.money += st.bonus;
        p.earned += st.bonus;
      });
      this.cup = { no: C.no + 1, race: 0, points: {} };
    }
    return cup;
  }

  // the best player's margin at the line moves the form: winning by more than
  // adapt.win seconds sharpens the rivals, losing by more than adapt.lose softens
  // them; close finishes leave it as it is (those are the races we want)
  _adapt(race) {
    const a = this.diff.adapt;
    if (!a || this.free) return;
    const fo = race.finishOrder, humans = fo.filter((r) => r.human);
    if (!humans.length) return;
    const me = humans[0];
    const t = (r) => (r.finished && !r.dnf ? r.finishTime : race.time + 4);
    const margin = me.place === 1 ? (fo[1] ? t(fo[1]) - t(me) : 4) : t(fo[0]) - t(me);
    const m = Math.max(-6, Math.min(6, margin));
    const step = m > a.win ? m - a.win : m < -a.lose ? m + a.lose : 0;
    this.form = Math.max(a.min, Math.min(a.max, this.form + step * a.rate));
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

  // the championship as plain data (the CONTINUAR of the main menu) and back
  snapshot() {
    return {
      difficulty: this.difficulty, pack: this.pack, raceNo: this.raceNo, form: this.form, streak: this.streak || 0,
      cup: this.cup, lastOrder: this.lastOrder || null,
      players: this.players.map((p) => ({ ...p, upgrades: { ...p.upgrades } })),
    };
  }
  // null when the data makes no sense (damaged, or from a format that no longer exists);
  // allowOver: a finished championship too (the guest's copy at the game over)
  static restore(d, allowOver = false) {
    const num = (v, min, max) => typeof v === 'number' && isFinite(v) && v >= min && v <= max;
    if (!d || !DIFFICULTY[d.difficulty] || !Array.isArray(d.players) || d.players.length < 1 || d.players.length > 3) return null;
    if (!Number.isInteger(d.raceNo) || d.raceNo < 0) return null;
    if (!d.players.every((p) => p && truckDef(p.truckId) && !truckDef(p.truckId).cpu.ironman && num(p.money, 0, 1e10) && num(p.earned, 0, 1e10)
      && num(p.credits, -9, 99) && num(p.nitros, 0, 99) && p.upgrades && UPGRADES.every((u) => num(p.upgrades[u.id], 0, MAX_LEVEL)))) return null;
    const s = new Session(d.players.map((p) => ({ truckId: p.truckId, vehicle: p.vehicle === 'buggy' ? 'buggy' : 'truck', livery: typeof p.livery === 'string' ? p.livery : 'team' })), d.difficulty, d.pack);
    d.players.forEach((p, i) => {
      const q = s.players[i];
      for (const u of UPGRADES) q.upgrades[u.id] = Math.round(p.upgrades[u.id]);
      Object.assign(q, { money: p.money, earned: p.earned, credits: Math.round(p.credits), nitros: Math.round(p.nitros), alive: p.alive !== false,
        wins: Math.max(0, p.wins | 0), streak: Math.max(0, p.streak | 0), continued: !!p.continued });
    });
    if (s.over && !allowOver) return null;
    s.raceNo = d.raceNo;
    if (num(d.form, -1, 1)) s.form = d.form;
    s.streak = d.streak | 0;
    const c = d.cup;
    if (c && Number.isInteger(c.no) && c.no >= 0 && Number.isInteger(c.race) && c.race >= 0 && c.race < CUP_SIZE && c.points && typeof c.points === 'object') {
      const points = {};
      for (const t of TRUCKS) if (num(c.points[t.id], 0, 1e4)) points[t.id] = c.points[t.id];
      s.cup = { no: c.no, race: c.race, points };
    }
    if (Array.isArray(d.lastOrder)) s.lastOrder = d.lastOrder.filter((id) => truckDef(id));
    return s;
  }
}

// ------------------------------------------------------------------ saved game
// The championship in progress is kept at every step so it can be continued after
// leaving the game: before each race (at: 'race', that race starts again from the
// grid), and once a race has counted and in the shop (at: 'shop', on to the shop; the
// podium first if the race closed a cup). Free races, time trials and the tutorial
// are single races and do not touch it.
const LS_RUN = 'sor.run.v1';

export function saveRun(session, at, podium = null) {
  try { localStorage.setItem(LS_RUN, JSON.stringify({ v: 1, at, t: Date.now(), s: session.snapshot(), podium })); } catch (e) { /* storage full or off */ }
}
export function loadRun() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(LS_RUN)); } catch (e) { /* damaged */ }
  if (!d) return null;
  const session = d.v === 1 && (d.at === 'race' || d.at === 'shop') ? Session.restore(d.s) : null;
  if (!session) { clearRun(); return null; }
  const pd = d.podium;
  const podium = d.at === 'shop' && pd && typeof pd.name === 'string' && Array.isArray(pd.standings) && pd.standings.length >= 3
    && pd.standings.every((x) => x && truckDef(x.truckId) && Number.isFinite(x.points)) ? pd : null;
  return { at: d.at, t: d.t, session, podium };
}
export function clearRun() { try { localStorage.removeItem(LS_RUN); } catch (e) { /* storage off */ } }

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
