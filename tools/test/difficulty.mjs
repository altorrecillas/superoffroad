// Difficulty calibration: whole championships (real session rules: CPU skill ramp,
// catch-up, garage matching, prizes, shop) against several simulated players, and
// how CLOSE the races are, not just who wins: the gap at the line when the player
// wins (to the 2nd) or loses (to the winner).
//   good:   keyboard, quick reactions          avg:   keyboard, slower
//   touch:  touch screen, late reactions, the thumb slips off the buttons sometimes
// Usage: node tools/test/difficulty.mjs [difficulty=normal] [races=12] [models=good,avg,touch,touch+soft] [seeds=2]
import { buildTrack } from '../../js/sim/track.js';
import { trackById } from '../../js/sim/tracks.js';
import { Race } from '../../js/sim/race.js';
import { AIDriver } from '../../js/sim/ai.js';
import { SteerAssist } from '../../js/sim/assist.js';
import { Session } from '../../js/game/session.js';
import { rng } from '../../js/sim/util.js';

const [diff = 'normal', racesArg = '12', modelsArg = 'good,avg,touch,touch+soft', seedsArg = '2'] = process.argv.slice(2);
const RACES = +racesArg, SEEDS = +seedsArg;
const DT = 1 / 120;
const MODELS = {
  good: { skill: 0.88, react: 0.04, slip: 0 },
  avg: { skill: 0.7, react: 0.08, slip: 0.001 },
  touch: { skill: 0.6, react: 0.12, slip: 0.002 },
};
const cache = new Map();
const trackOf = (id, rev) => { const k = id + rev; if (!cache.has(k)) cache.set(k, buildTrack(trackById(id), { reverse: rev })); return cache.get(k); };

function season(model, assist, seed) {
  const M = MODELS[model];
  const s = new Session([{ truckId: 'red' }], diff, 'all');
  const p = s.players[0];
  p.credits = 99;
  const out = { wins: 0, lost: 0, places: [0, 0, 0, 0], margins: [], close: 0 };
  for (let n = 0; n < RACES; n++) {
    const { id, reverse } = s.currentTrack();
    const track = trackOf(id, reverse);
    const race = new Race(track, s.entries(), { seed: seed * 1000 + n, ...s.raceOpts() });
    const me = race.racers.find((r) => r.human);
    const brain = new AIDriver(me.truck, track, { skill: M.skill, aggression: 0.6, seed: seed * 7 + n });
    const help = assist ? new SteerAssist(me.truck, track, assist) : null;
    const r = rng(seed * 31 + n);
    const inp = { steer: 0, throttle: 1, brake: 0, nitro: false };
    const delay = [];
    let hold = 0, slip = 0, t = 0;
    while (race.state !== 'done' && t < 420) {
      const a = race.state === 'race' ? brain.update(DT, race.trucks) : inp;
      delay.push(Math.abs(a.steer) < 0.28 ? 0 : Math.sign(a.steer));
      const late = delay.length > M.react / DT ? delay.shift() : 0;
      hold -= DT;
      if (hold <= 0) {
        hold = 0.05;
        if (slip > 0) slip -= 0.05; else if (r() < M.slip * 6) slip = 0.3 + r() * 0.6;
        inp.steer = slip > 0 ? 0 : late;
        inp.throttle = a.brake > 0.5 ? 0 : 1;
        inp.brake = a.brake > 0.5 ? 1 : 0;
        inp.nitro = !!a.nitro;
      } else inp.nitro = false;
      race.step(DT, [help ? help.apply(DT, inp) : inp]);
      t += DT;
    }
    const fin = race.finishOrder;
    const time = (x) => (x.finished && !x.dnf ? x.finishTime : x.finishTime || race.time);
    const margin = me.place === 1 ? (fin[1] ? time(fin[1]) - time(me) : 0) : -(time(me) - time(fin[0]));
    out.margins.push(margin);
    if (Math.abs(margin) < 1.5) out.close++;
    const sum = s.applyResults(race, { assist: assist || 0 });
    const pl = sum.players[0];
    out.places[pl.place - 1]++;
    if (pl.place === 1) out.wins++;
    if (pl.lost) out.lost++;
    // shop: cheapest upgrade first, keep a few nitros
    let bought = true;
    while (bought) {
      bought = false;
      const ids = ['tires', 'accel', 'speed', 'shocks'].filter((u) => p.upgrades[u] < 5).sort((a, b) => p.upgrades[a] - p.upgrades[b]);
      for (const u of ids) if (s.buyUpgrade(p, u)) { bought = true; break; }
    }
    while (p.nitros < 6 && s.buyNitro(p, 1)) { /* top up */ }
  }
  return out;
}

const fmt = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);
for (const name of modelsArg.split(',')) {
  const [model, a] = name.split('+');
  const assist = a === 'soft' ? 1 : a === 'strong' ? 2 : 0;
  const all = { wins: 0, lost: 0, places: [0, 0, 0, 0], margins: [], close: 0 };
  for (let sd = 1; sd <= SEEDS; sd++) {
    const o = season(model, assist, sd);
    all.wins += o.wins; all.lost += o.lost; all.close += o.close;
    o.places.forEach((v, i) => (all.places[i] += v));
    all.margins.push(...o.margins);
  }
  const N = RACES * SEEDS, ms = all.margins.slice().sort((x, y) => x - y);
  const winM = all.margins.filter((m) => m > 0), med = ms[Math.floor(ms.length / 2)];
  console.log(`${diff.padEnd(6)} ${name.padEnd(11)} wins ${(100 * all.wins / N).toFixed(0).padStart(3)}% · places ${all.places.join('/')} · credits lost ${(all.lost / SEEDS).toFixed(1)}/${RACES} · median gap ${fmt(med)} s · avg winning gap ${winM.length ? fmt(winM.reduce((x, y) => x + y, 0) / winM.length) : ' —'} s · close finishes (<1.5 s) ${(100 * all.close / N).toFixed(0)}%`);
}
