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
  'four players': (() => { const d = base(); d.players = [0, 1, 2, 3].map(() => d.players[0]); return d; })(),
  'Ironman as a player': (() => { const d = base(); d.players[0].truckId = 'grey'; return d; })(),
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

console.log(ok ? 'SAVEGAME OK' : 'SAVEGAME FAIL');
process.exit(ok ? 0 : 1);
