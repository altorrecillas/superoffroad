// The saved championship (CONTINUAR) without a browser: a session half way through a
// championship, turned into plain data and back, must be the same championship (same
// next circuit, same rivals with the same cars and pace, same money, upgrades, credits,
// cup and form); damaged or impossible data must be refused.
// Usage: node tools/test/savegame.mjs
import { Session, DIFF_ORDER } from '../../js/game/session.js';

let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };
const roundTrip = (s) => Session.restore(JSON.parse(JSON.stringify(s.snapshot())));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// a championship played for a while: money, upgrades, a lost credit, a cup under way
for (const diff of DIFF_ORDER) {
  for (const pack of ['all', 'classic', 'pak']) {
    const s = new Session([{ truckId: 'blue', vehicle: 'buggy', livery: 'flames' }, { truckId: 'red' }], diff, pack);
    s.raceNo = 9; s.form = 0.031; s.streak = 2;
    s.cup = { no: 2, race: 1, points: { red: 6, blue: 10, yellow: 3, grey: 4 } };
    s.lastOrder = ['blue', 'grey', 'red', 'yellow'];
    Object.assign(s.players[0], { money: 230000, earned: 910000, credits: 2, nitros: 14, wins: 4, streak: 1 });
    s.players[0].upgrades = { tires: 3, shocks: 2, accel: 4, speed: 1 };
    Object.assign(s.players[1], { money: 0, earned: 310000, credits: 0, alive: false });
    const r = roundTrip(s);
    const tag = `${diff}/${pack}`;
    if (!r) { check(false, `${tag}: restored`); continue; }
    check(same(r.snapshot(), s.snapshot()), `${tag}: the same data after saving and loading`);
    check(same(r.currentTrack(), s.currentTrack()) && r.rotation === s.rotation, `${tag}: the same next circuit (${r.currentTrack().id})`);
    check(same(r.entries(), s.entries()), `${tag}: the same grid, rivals, cars and pace`);
    check(same(r.raceOpts(), s.raceOpts()) && r.prizeMult(1) === s.prizeMult(1), `${tag}: the same race rules and prizes`);
  }
}

// what is refused
const base = () => { const s = new Session([{ truckId: 'red' }], 'normal'); s.raceNo = 3; return JSON.parse(JSON.stringify(s.snapshot())); };
const bad = {
  'no data': null,
  'unknown level': { ...base(), difficulty: 'zzz' },
  'no players': { ...base(), players: [] },
  'five players': (() => { const d = base(); d.players = [0, 1, 2, 3, 4].map(() => d.players[0]); return d; })(),
  'Ironman as a player (fewer than four)': (() => { const d = base(); d.players[0].truckId = 'grey'; return d; })(),
  'unknown truck': (() => { const d = base(); d.players[0].truckId = 'pink'; return d; })(),
  'negative money': (() => { const d = base(); d.players[0].money = -5; return d; })(),
  'money as text': (() => { const d = base(); d.players[0].money = '100'; return d; })(),
  'upgrade too high': (() => { const d = base(); d.players[0].upgrades.speed = 9; return d; })(),
  'missing upgrade': (() => { const d = base(); delete d.players[0].upgrades.tires; return d; })(),
  'race number not whole': { ...base(), raceNo: 2.5 },
  'everyone out': (() => { const d = base(); d.players[0].alive = false; return d; })(),
};
for (const [what, d] of Object.entries(bad)) check(Session.restore(d) === null, `refused: ${what}`);

// what is tolerated (older or partial data): sensible defaults
const d = base();
delete d.cup; delete d.form; delete d.lastOrder; delete d.pack; d.players[0].livery = 42;
const r = Session.restore(d);
check(r && r.cup.no === 0 && r.cup.race === 0 && r.form === 0 && r.pack === 'all' && r.players[0].livery === 'team', 'missing parts get their defaults');
const d2 = base(); d2.cup = { no: 1, race: 7, points: {} };
check(Session.restore(d2).cup.race === 0, 'an impossible cup position starts the cup over');

// four players on four phones: the fourth drives the grey truck; with no Ironman in the
// race the level's rule falls back to "the last loses a credit"
const four = new Session(['red', 'blue', 'yellow', 'grey'].map((truckId) => ({ truckId })), 'normal');
const f4 = roundTrip(four);
check(f4 && f4.players.length === 4 && f4.players[3].truckId === 'grey', 'four players (the grey truck the fourth\'s) kept');
check(four.entries().length === 4 && four.entries().every((e) => e.human), 'four players: no CPU on the grid');
const fakeRace = (order) => ({
  finishOrder: order.map((p, k) => ({ entry: { truckId: four.players[p].truckId, name: 'P', player: p }, human: true, place: k + 1, finished: true, finishTime: 60 + k, bestLap: 15, money: 0, truck: { nitros: 5 } })),
  racers: [], time: 64,
});
const res = four.applyResults(fakeRace([2, 0, 3, 1]));
check(res.players.filter((p) => p.lost).length === 1 && res.players.find((p) => p.lost).index === 1, 'four players, Piloto: only the last loses a credit');

// a quick race on several phones keeps its circuit and settings
const q = new Session([{ truckId: 'red' }, { truckId: 'blue' }], 'hard', 'all', { id: 'volcano', reverse: true, time: 'night', rain: true, laps: 3, quick: true, cpu: false });
const q2 = roundTrip(q);
check(q2 && same(q2.free, q.free) && same(q2.currentTrack(), q.currentTrack()), 'a quick race keeps its circuit, light, rain and laps');
check(q2.entries().length === 2, 'a quick race without the CPU: only the players on the grid');
const q3 = JSON.parse(JSON.stringify(q.snapshot())); q3.free.id = 'nowhere';
check(Session.restore(q3).free === null, 'an unknown circuit is not a quick race');

console.log(ok ? 'SAVEGAME OK' : 'SAVEGAME FAIL');
process.exit(ok ? 0 : 1);
