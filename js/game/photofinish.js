// The photo finish: two trucks reaching the line together, one of them a player's. The
// last metres go in slow motion (the engines and the music slow down with it), then the
// picture: the race stops for a moment, seen from the side of the line, with the gap
// between the two; then it goes on at full speed. In a game on several phones the host
// decides and the others show the same moment at the same point of the race (the
// messages travel with the host's clock, like the race events).

import { esc } from '../ui/ui.js';
import { mine } from '../sim/race.js';
import { paintOf } from './liveries.js';

const NEAR = 16;   // metres from the line where the slow motion starts
const GAP = 6;     // metres between the two trucks, at most
const PHOTO = 0.3; // seconds between them at the line, at most, for the picture
const SLOW = 0.32; // slow motion speed
const HOLD = 1.8;  // seconds the picture stays
const COVER = ['hud', 'finish', 'count']; // screens hidden while it shows

export function installPhotoFinish(Game) {
  Object.assign(Game.prototype, {
    // the race's speed now: 1 normally, less in the slow motion, 0 while the picture shows
    _photoK() { return this.photo ? this.photo.k : 1; },

    // a new race (or the menus): nothing of the last one's photo finish
    _photoClear() {
      if (this.photo && this.photo.shown) this._photoHide();
      this.photo = null;
      this._photoDone = false;
      if (this.audio) { this.audio.timeScale = 1; this.audio.hush = false; }
    },

    // the host or a single device, after each step of a race: a photo finish coming?
    _photoCheck(race) {
      if (this.photo || this._photoDone || this.attract || this.trial || this.tutorial || race.shadow) return;
      if (this.state !== 'race' || race.state !== 'race' || params().has('nophoto')) return;
      const end = race.laps * race.track.L;
      for (const r of race.racers) {
        if (!r.human || r.finished || r.lap < race.laps - 1) continue;
        for (const o of race.racers) {
          if (o === r || o.finished || o.lap < race.laps - 1) continue;
          const lead = Math.max(r.prog, o.prog);
          if (Math.abs(r.prog - o.prog) < GAP && end - lead < NEAR && end - lead > 1 && r.truck.speed > 6 && o.truck.speed > 6) {
            this._photoStart(r.prog >= o.prog ? r.i : o.i, r.prog >= o.prog ? o.i : r.i);
            return;
          }
        }
      }
    },
    _photoStart(a, b, remote = false) {
      this._photoDone = true;
      this.photo = { phase: 'slow', a, b, k: 1, t: 0, remote };
      if (!remote && this.net && this.net.role === 'host') this.net.send({ t: 'photo', p: 'slow', a, b, ht: performance.now() });
      // a guest's own truck: the host's from now on (the prediction runs at full speed)
      if (this._pred) { this._pred.ready = false; this._pred.hist.length = 0; }
    },

    // every frame: ease into the slow motion, the picture once both are home, back to speed
    _photoTick(dt) {
      const P = this.photo, race = this.race;
      if (!P || this.paused) return;
      if (!race) { this._photoClear(); return; }
      P.t += dt;
      if (P.phase === 'slow') {
        P.k += (SLOW - P.k) * Math.min(1, dt * 6);
        const A = race.racers[P.a], B = race.racers[P.b];
        if (!P.remote && A && B) {
          if (A.finished && B.finished) this._photoFreeze();
          // the other one never got there in time (a crash, a spin): no picture after all
          else if ((A.finished || B.finished) && race.time - (A.finished ? A.finishTime : B.finishTime) > PHOTO + 0.1 || P.t > 7 || race.state === 'done') this._photoOut();
        }
      } else if (P.phase === 'freeze') {
        P.k = 0;
        if (!P.remote && P.t > HOLD) this._photoOut();
      } else {
        P.k += (1 - P.k) * Math.min(1, dt * 5);
        if (P.k > 0.985) { this.photo = null; this.audio.timeScale = 1; this.audio.hush = false; return; }
      }
      this.audio.timeScale = Math.max(SLOW, P.k);
      this.audio.hush = P.phase === 'freeze';
    },

    // both over the line: the race stops for the picture
    _photoFreeze() {
      const P = this.photo, race = this.race;
      const A = race.racers[P.a], B = race.racers[P.b];
      const [first, second] = A.place < B.place ? [A, B] : [B, A];
      // when each one crossed, finer than the simulation step: back from where it is now
      const end = race.laps * race.track.L;
      const cross = (r) => race.time - Math.max(0, (r.progFine ?? r.prog) - end) / Math.max(4, r.truck.speed);
      let gap = cross(second) - cross(first);
      if (!(gap > 0.004)) gap = Math.max(0.004, second.finishTime - first.finishTime);
      if (gap > PHOTO) { this._photoOut(); return; } // close, but not that close
      P.phase = 'freeze'; P.t = 0; P.k = 0;
      P.info = { first: first.i, second: second.i, gap, places: [first.place, second.place] };
      if (this.net && this.net.role === 'host') this.net.send({ t: 'photo', p: 'freeze', ...P.info, ht: performance.now() });
      this._photoShow(P.info);
    },
    _photoOut() {
      const P = this.photo;
      if (!P) return;
      if (P.shown) this._photoHide();
      if (P.phase === 'out') return;
      P.phase = 'out'; P.t = 0;
      if (!P.remote && this.net && this.net.role === 'host') this.net.send({ t: 'photo', p: 'out', ht: performance.now() });
    },

    // a guest: the host's photo finish, when the race on this screen gets there
    _photoRemote(m) {
      if (!this.race || !this.race.shadow) return;
      if (m.p === 'slow') { if (!this.photo) this._photoStart(m.a, m.b, true); return; }
      if (m.p === 'freeze') {
        if (!this.photo) this._photoStart(m.first, m.second, true);
        const P = this.photo;
        P.phase = 'freeze'; P.t = 0; P.k = 0;
        P.info = { first: m.first | 0, second: m.second | 0, gap: +m.gap || 0, places: Array.isArray(m.places) ? m.places.slice(0, 2).map((x) => x | 0) : null };
        this._photoShow(P.info);
        return;
      }
      if (m.p === 'out') this._photoOut();
    },

    // the picture: the side of the line, the two names and the gap, a flash
    _photoShow(info) {
      const race = this.race, P = this.photo;
      const A = race.racers[info.first], B = race.racers[info.second];
      if (!A || !B) return;
      P.shown = true;
      this.world.setCamera('finish', {});
      const solo = race.racers.filter(mine).length === 1;
      // (on another phone the other players' trucks are rivals there, but still players)
      const name = (r) => (mine(r) && solo ? 'TÚ' : r.human || r.remote ? `${r.entry.player + 1}P` : r.entry.short || r.entry.name);
      const places = info.places || [A.place, B.place];
      const row = (r, gap) => `<div class="pf-row${mine(r) ? ' me' : ''}"><b>${places[r === A ? 0 : 1] || (r === A ? 1 : 2)}º</b><i style="background:${paintOf(r.entry.truckId, r.entry.livery).css}"></i><span>${esc(name(r))}</span>${gap ? `<em>+${gap.toFixed(gap < 0.1 ? 3 : 2).replace('.', ',')} s</em>` : ''}</div>`;
      this.ui.show('photofin', `<div class="pf-line"></div><div class="pf-card"><div class="pf-title">FOTO FINISH</div>${row(A)}${row(B, info.gap)}</div>`, 'passive');
      // the picture alone: no scoreboard, finish banner or pad over it
      for (const id of COVER) { const el = this.ui.get(id); if (el) el.classList.add('pf-hide'); }
      this.touch.root.classList.add('pf-hide');
      this.world.showRings(false);
      const app = document.getElementById('app');
      if (app) app.classList.add('photo-look');
      const flash = document.createElement('div');
      flash.className = 'ph-flash';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 600);
      this.audio.sfx('clank', { vol: 0.5, rate: 2.4, vary: 0, ui: true }); // the shutter
      this.audio.excite = 1;
      this.audio.announce('photo_finish');
      if (this.opt.haptics !== false && navigator.vibrate) { try { navigator.vibrate(25); } catch (e) { /* */ } }
    },
    _photoHide() {
      if (this.photo) this.photo.shown = false;
      this.ui.hide('photofin');
      for (const id of COVER) { const el = this.ui.get(id); if (el) el.classList.remove('pf-hide'); }
      this.touch.root.classList.remove('pf-hide');
      this.world.showRings(true);
      const app = document.getElementById('app');
      if (app) app.classList.remove('photo-look');
      if (this.world.camMode === 'finish' && this.race && (this.state === 'race' || this.state === 'intro')) this._raceCamera(false);
    },
  });
}

let _params = null;
const params = () => _params || (_params = new URLSearchParams(location.search));
