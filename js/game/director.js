// The replay director: picks the shot and the truck to watch, like a TV producer.
// It reads the recording's notes, so it already knows when a big jump, a crash, an
// overtake or the finish is coming: it cuts there in time, and big jumps play in
// slow motion. Between highlights it rotates the shots, mostly on the player.

const SEC = 120; // simulation steps per second
const PRIO = { start: 4, air: 3, finish: 3, pass: 1, hit: 1 };
const ROTATION = ['tv', 'chase', 'heli', 'low', 'tv', 'side', 'classic', 'chase', 'low', 'heli'];

export class Director {
  constructor(rec, humans) {
    this.marks = rec.marks.slice().sort((a, b) => a.s - b.s);
    this.goStep = rec.goStep || Math.round(3.6 * SEC);
    this.humans = humans;      // truck indices of the players
    this.shot = null;
    this.rot = 0;
    this.seq = 0;              // a counter instead of randomness: the same replay cuts the same way
    this.lock = null;          // truck chosen by the viewer: only its moments
  }

  reset() { this.shot = null; this.rot = 0; this.seq = 0; }

  // the next noted moment of a kind (and truck) in a window of steps
  _find(from, to, test) {
    for (const m of this.marks) {
      if (m.s < from) continue;
      if (m.s > to) break;
      if (test(m)) return m;
    }
    return null;
  }

  // step: the replay's current step; race: the replay simulation. Returns the shot:
  // { mode, index, side, phase, slowFrom, slowTo, slow } (index = the truck to watch)
  update(step, race) {
    const s = this.shot;
    const mine = (i) => this.lock == null || i === this.lock;
    let fav = this.lock ?? (this.humans.length === 1 ? this.humans[0] : race.order[0].i);
    // the player is home and others are still racing: watch them come in
    if (this.lock == null && race.racers[fav].finished && race.state !== 'done') {
      const r = race.order.find((x) => !x.finished);
      if (r) fav = r.i;
    }
    // the start: the grid, then the field charging away
    if (step < this.goStep + SEC * 0.6) {
      if (!s || s.kind !== 'start') this.shot = { kind: 'start', mode: 'grid', index: fav, end: this.goStep + SEC * 0.6 };
      return this.shot;
    }
    if (s && s.kind === 'start') this.shot = { kind: 'go', mode: 'tv', index: race.order[0].i, end: step + SEC * 4 };
    const cur = this.shot && step < this.shot.end ? this.shot : null;
    const prio = cur ? PRIO[cur.kind] ?? 0 : -1;
    // a big jump about to happen (takeoff within 0.35-2 s): cut to it, in slow motion
    if (prio < 3) {
      const m = this._find(step, step + SEC * 3.2, (x) => x.k === 'air' && x.v >= 0.55 && mine(x.i));
      const take = m ? m.s - Math.round(m.v * SEC) : 0;
      if (m && take - step < SEC * 2 && take - step > SEC * 0.35) {
        const big = m.v >= 0.66;
        this.shot = {
          kind: 'air', index: m.i, mode: ['side', 'low', 'tv'][this.seq++ % 3], side: this.seq % 2 ? 1 : -1,
          slowFrom: take - SEC * 0.12, slowTo: m.s + SEC * 0.18, slow: big ? 0.3 : 0.5, end: m.s + SEC * 1.4,
        };
        return this.shot;
      }
    }
    // somebody is about to finish (the winner, or a player): the line from the side
    if (prio < 2) {
      const m = this._find(step + SEC * 1.2, step + SEC * 3, (x) => x.k === 'finish' && (x.v === 1 || this.humans.includes(x.i)) && mine(x.i));
      if (m) {
        this.shot = { kind: 'finish', index: m.i, mode: this.seq++ % 2 ? 'low' : 'tv', end: m.s + SEC * 2.6 };
        return this.shot;
      }
    }
    if (cur) return cur;
    // the shot is over: an overtake or a crash coming, or the next shot of the rotation
    const pass = this._find(step + SEC * 0.8, step + SEC * 3, (x) => x.k === 'pass' && (x.v === 1 || this.humans.includes(x.i) || this.humans.includes(x.j)) && (mine(x.i) || mine(x.j)));
    if (pass) {
      this.shot = { kind: 'pass', index: pass.i, mode: this.seq++ % 2 ? 'chase' : 'heli', phase: this.seq, end: pass.s + SEC * 2.2 };
      return this.shot;
    }
    const hit = this._find(step + SEC * 0.6, step + SEC * 2.2, (x) => (x.k === 'bump' || x.k === 'crash') && x.v > 8 && (mine(x.i) || (x.j != null && mine(x.j))));
    if (hit) {
      this.shot = { kind: 'hit', index: mine(hit.i) ? hit.i : hit.j, mode: 'tv', end: hit.s + SEC * 1.8 };
      return this.shot;
    }
    // after the race: the winner's lap of honour from above
    if (race.state === 'done' || race.finishOrder.length === race.racers.length) {
      const w = race.finishOrder[0] ? race.finishOrder[0].i : fav;
      this.shot = { kind: 'end', index: this.lock ?? w, mode: 'heli', phase: this.seq++, end: step + SEC * 30 };
      return this.shot;
    }
    // the rotation: mostly the player (or the leader), sometimes whoever is behind them
    let index = fav;
    const k = this.seq++;
    if (this.lock == null && k % 4 === 3) {
      const me = race.racers[fav];
      const near = race.order.find((r) => r !== me && Math.abs(r.prog - me.prog) < 25);
      if (near) index = near.i;
    }
    const mode = ROTATION[this.rot++ % ROTATION.length];
    const len = mode === 'classic' ? 4.5 : mode === 'heli' ? 5.5 : 4 + (k % 3);
    this.shot = { kind: 'free', index, mode, side: k % 2 ? 1 : -1, phase: k * 1.7, end: step + Math.round(len * SEC) };
    return this.shot;
  }
}
