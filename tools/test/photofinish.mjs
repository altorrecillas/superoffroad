// The photo finish without a browser: when it starts (a player's truck and another
// close together just before the line on the last lap) and when not, the slow motion,
// the picture only when they cross within 0.3 s, back to full speed, the messages the
// host sends to the other phones and a guest following them.
// Usage: node tools/test/photofinish.mjs
globalThis.location = { search: '' };
globalThis.document = { getElementById: () => null, createElement: () => ({ remove() {} }), body: { appendChild() {} } };
const { installPhotoFinish } = await import('../../js/game/photofinish.js');

let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };
class G {}
installPhotoFinish(G);
const L = 300, LAPS = 3, END = L * LAPS;
const racer = (i, human, prog, speed = 22) => ({ i, human, prog, progFine: prog, lap: Math.floor(prog / L), finished: false, place: 0, finishTime: 0, truck: { speed }, entry: { truckId: ['red', 'blue', 'yellow', 'grey'][i], livery: 'team', player: human ? 0 : undefined, short: 'CPU' + i } });
const game = (racers, extra = {}) => {
  const g = new G();
  const shown = [], sent = [];
  Object.assign(g, {
    race: { state: 'race', laps: LAPS, time: 80, track: { L }, racers }, state: 'race', attract: false, trial: null, tutorial: null, net: null, paused: false, opt: { haptics: false },
    audio: { timeScale: 1, hush: false, excite: 0, sfx() {}, announce(k) { shown.push('say:' + k); } },
    ui: { show(id) { shown.push(id); return {}; }, hide(id) { shown.push('-' + id); }, get() { return null; } },
    world: { camMode: 'zoom', setCamera(m) { this.camMode = m; }, showRings() {} },
    touch: { root: { classList: { add() {}, remove() {} } } },
    _raceCamera() { this.world.camMode = 'zoom'; },
    shown, sent,
  }, extra);
  return g;
};
const tick = (g, sec, dt = 1 / 60) => { for (let t = 0; t < sec; t += dt) g._photoTick(dt); };

// when it starts
const cases = [
  ['a player 4 m behind a rival, 12 m from the line', [racer(0, true, END - 12), racer(1, false, END - 8)], true],
  ['two CPU trucks close: not ours', [racer(0, true, END - 60), racer(1, false, END - 12), racer(2, false, END - 10)], false],
  ['a player 10 m clear of the rival', [racer(0, true, END - 5), racer(1, false, END - 15)], false],
  ['close, but 40 m from the line', [racer(0, true, END - 40), racer(1, false, END - 37)], false],
  ['close, but not on the last lap', [racer(0, true, END - L - 12), racer(1, false, END - L - 10)], false],
  ['two players close (same screen or several phones)', [racer(0, true, END - 10), Object.assign(racer(1, true, END - 13), { entry: { truckId: 'blue', livery: 'team', player: 1 } })], true],
];
for (const [what, racers, want] of cases) {
  const g = game(racers);
  g._photoCheck(g.race);
  check(!!g.photo === want, `${want ? 'starts' : 'no photo finish'}: ${what}`);
}
const gA = game([racer(0, true, END - 12), racer(1, false, END - 8)], { attract: true });
gA._photoCheck(gA.race);
check(!gA.photo, 'not in the demo race behind the menus');

// slow motion, then the picture when both are home within 0.3 s, then full speed
const net = { role: 'host', sent: [], send(m) { this.sent.push(m); } };
const g = game([racer(0, true, END - 12), racer(1, false, END - 8)], { net });
g._photoCheck(g.race);
tick(g, 1);
check(g._photoK() < 0.4 && g._photoK() > 0.25 && g.audio.timeScale < 0.5, `slow motion: the race at ×${g._photoK().toFixed(2)}, the sounds with it`);
const [A, B] = [g.race.racers[1], g.race.racers[0]];
Object.assign(A, { finished: true, place: 1, finishTime: 80.0, prog: END + 2, progFine: END + 2 });
Object.assign(B, { finished: true, place: 2, finishTime: 80.1, prog: END + 0.4, progFine: END + 0.4 });
g.race.time = 80.12;
tick(g, 0.05);
check(g.photo.phase === 'freeze' && g._photoK() === 0 && g.world.camMode === 'finish' && g.shown.includes('photofin'), 'both over the line 0.07 s apart: the race stops for the picture, seen from the line');
check(Math.abs(g.photo.info.gap - (2 - 0.4) / 22) < 0.01, `the gap measured finer than a simulation step (${g.photo.info.gap.toFixed(3)} s)`);
check(g.shown.includes('say:photo_finish') && g.audio.hush, 'the announcer calls it; the engines hush');
tick(g, 2);
check(g.photo && g.photo.phase === 'out' && g.world.camMode === 'zoom' && g.shown.includes('-photofin'), 'after the picture: the race camera again, the picture gone');
tick(g, 2);
check(!g.photo && g.audio.timeScale === 1 && !g.audio.hush && g._photoK() === 1, 'and back to full speed');
check(net.sent.map((m) => m.p).join(',') === 'slow,freeze,out' && net.sent.every((m) => m.t === 'photo' && m.ht > 0), `the other phones are told each step, with the host's clock (${net.sent.map((m) => m.p).join(', ')})`);
g._photoCheck(g.race);
check(!g.photo, 'once per race');

// close in the slow motion, but not at the line: no picture
const g2 = game([racer(0, true, END - 12), racer(1, false, END - 8)]);
g2._photoCheck(g2.race);
tick(g2, 0.5);
Object.assign(g2.race.racers[1], { finished: true, place: 1, finishTime: 80.0, prog: END + 9, progFine: END + 9 });
Object.assign(g2.race.racers[0], { finished: true, place: 2, finishTime: 80.4, prog: END + 0.5, progFine: END + 0.5 });
g2.race.time = 80.42;
tick(g2, 0.05);
check(g2.photo && g2.photo.phase === 'out' && !g2.shown.includes('photofin'), '0.4 s apart at the line: slow motion only, no picture');
const g3 = game([racer(0, true, END - 12), racer(1, false, END - 8)]);
g3._photoCheck(g3.race);
Object.assign(g3.race.racers[1], { finished: true, place: 1, finishTime: 80 });
g3.race.time = 80.5;
tick(g3, 0.05);
check(g3.photo && g3.photo.phase === 'out', 'the other one never gets there (a crash): no picture');

// a guest: the host's messages, at their moment
const guest = game([racer(0, true, END - 12), racer(1, false, END - 8)]);
guest.race.shadow = true;
guest._pred = { ready: true, hist: [1, 2] };
guest._photoRemote({ t: 'photo', p: 'slow', a: 1, b: 0 });
check(guest.photo && guest.photo.remote && guest._pred.ready === false && guest._pred.hist.length === 0, "a guest's slow motion: its own truck drawn as the host runs it (no prediction)");
tick(guest, 10);
check(guest.photo && guest.photo.phase === 'slow', 'a guest never ends it by itself');
guest._photoRemote({ t: 'photo', p: 'freeze', first: 1, second: 0, gap: 0.042 });
check(guest.photo.phase === 'freeze' && guest.shown.includes('photofin'), "a guest shows the host's picture");
guest._photoRemote({ t: 'photo', p: 'out' });
tick(guest, 2);
check(!guest.photo && guest.world.camMode === 'zoom', 'and goes back to the race when the host does');
const g4 = game([racer(0, true, END - 12), racer(1, false, END - 8)]);
g4._photoCheck(g4.race);
g4._photoClear();
check(!g4.photo && g4.audio.timeScale === 1 && !g4._photoDone, 'a new race clears it all');
console.log(ok ? 'PHOTOFINISH OK' : 'PHOTOFINISH FAIL');
process.exit(ok ? 0 : 1);
