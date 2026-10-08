// In-race HUD: arcade-style lap/nitro board, the player's position panel,
// countdown lights, event toasts, floating player tags and a minimap for the
// close cameras.

import * as THREE from 'three';
import { h } from './ui.js';
import { truckDef, TRUCKS } from '../game/drivers.js';
import { fmtMoney } from '../game/session.js';
import { ARENA } from '../sim/track.js';

const ORD = ['', 'º', 'º', 'º', 'º'];
const _v = new THREE.Vector3();

export function fmtTime(t) {
  if (t == null || t < 0) t = 0;
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

export class HUD {
  constructor(ui) {
    this.ui = ui;
    this.el = null;
  }

  build(race, session) {
    this.race = race;
    this.session = session;
    const cols = TRUCKS.map((d) => race.racers.find((r) => r.entry.truckId === d.id)).filter(Boolean);
    this.cols = cols;
    const cell = (r, kind) => `<div class="cell ${r.human ? 'me' : ''}" data-k="${kind}${r.i}" style="background:${truckDef(r.entry.truckId).css}${r.human ? '' : 'cc'};color:${r.entry.truckId === 'yellow' || r.entry.truckId === 'grey' ? '#111' : '#fff'}">0</div>`;
    const solo = race.racers.filter((r) => r.human).length === 1;
    const me = race.racers.find((r) => r.human);
    const html = `
      <div class="hud-top">
        <div class="hud-board${solo ? ' solo' : ''}">
          <div class="time" data-k="time">0:00.00</div>
          <div class="lbl">VUELTA</div>${cols.map((r) => cell(r, 'lap')).join('')}
          <div class="lbl nit">NITRO</div>${cols.map((r) => cell(r, 'nit')).join('')}
        </div>
      </div>
      ${solo && me ? `<div class="hud-me">
        <div class="pos" data-k="pos">1<sup>º</sup></div>
        <div class="line" data-k="lapme">VUELTA 1/4</div>
        <div class="line nitro">NITRO <b data-k="nitme">10</b></div>
        <div class="line money" data-k="money">$0</div>
      </div>` : ''}
      <div class="tags"></div>`;
    this.el = this.ui.show('hud', html, 'passive');
    this.map = solo ? this._mapBuild(race.track) : null;
    if (this.map) this.el.appendChild(this.map.c);
    // boxes that step aside (fade) when a truck drives underneath them
    this.fadeEls = [this.el.querySelector('.hud-board'), this.el.querySelector('.hud-me'), this.map && this.map.c]
      .filter(Boolean).map((el) => ({ el, rect: null, op: -1 }));
    this.rectT = 0;
    this.cells = {};
    this.el.querySelectorAll('[data-k]').forEach((e) => (this.cells[e.dataset.k] = e));
    this.me = solo ? me : null;
    // a marker over each human truck ("TÚ" alone, 1P/2P/3P when sharing the screen)
    const tags = this.el.querySelector('.tags');
    this.tags = race.racers.filter((r) => r.human).map((r) => {
      const d = truckDef(r.entry.truckId);
      const ink = r.entry.truckId === 'yellow' || r.entry.truckId === 'grey' ? '#111' : '#fff';
      const t = h(`<div class="ptag start" style="--c:${d.css};--t:${ink}"><b>${solo ? 'TÚ' : `${r.entry.player + 1}P`}</b></div>`);
      tags.appendChild(t);
      return { r, el: t, shown: null };
    });
    this.last = {};
  }

  set(k, v) {
    if (this.last[k] === v) return;
    this.last[k] = v;
    const e = this.cells[k];
    if (e) e.innerHTML = v;
  }

  update(dt, camera, world, intro = false) {
    const race = this.race;
    if (!race || !this.el) return;
    this._fade(camera, race, intro);
    this.set('time', fmtTime(Math.max(0, race.time)));
    for (const r of this.cols) {
      this.set('lap' + r.i, r.finished ? `<span style="font-size:.8em">${r.place}º</span>` : String(Math.min(race.laps, Math.max(1, r.lap + 1))));
      this.set('nit' + r.i, String(r.truck.nitros));
    }
    const me = this.me;
    if (me) {
      // the position number pops when it changes: green gaining a place, red losing one
      const pos = me.pos || 1;
      if (this.lastPos && pos !== this.lastPos && race.state === 'race' && this.cells.pos) {
        const el = this.cells.pos;
        el.classList.remove('up', 'down');
        void el.offsetWidth; // restart the animation
        el.classList.add(pos < this.lastPos ? 'up' : 'down');
      }
      this.lastPos = pos;
      this.set('pos', `${pos}<sup>${ORD[pos]}</sup>`);
      this.set('lapme', me.finished ? '¡META!' : `VUELTA ${Math.min(race.laps, Math.max(1, me.lap + 1))}/${race.laps}`);
      this.set('nitme', String(me.truck.nitros));
      const p = this.session ? this.session.players[me.entry.player] : null;
      this.set('money', fmtMoney((p ? p.money : 0) + me.money));
    }
    // tags (the HUD covers the viewport: reading its layout after the writes above
    // would force a synchronous reflow every frame)
    const w = innerWidth, hgt = innerHeight;
    // over-the-truck cameras only (in the chase view your truck is the one in front of you)
    const camOK = (world.camMode === 'classic' || world.camMode === 'zoom') && !intro;
    const starting = race.state === 'countdown' || race.time < 2.5;
    for (const t of this.tags) {
      const tr = t.r.truck;
      _v.set(tr.x, tr.y + 2.9, tr.z).project(camera);
      const vis = camOK && _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      if (vis !== t.shown) { t.shown = vis; t.el.style.display = vis ? '' : 'none'; }
      if (vis) t.el.style.transform = `translate(${((_v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-_v.y * 0.5 + 0.5) * hgt).toFixed(1)}px) translate(-50%, -100%)`;
      // it pulses on the grid so you find your truck, then settles down
      if (t.start !== starting) { t.start = starting; t.el.classList.toggle('start', starting); }
    }
    // minimap only with the close cameras (the classic one shows the whole arena)
    if (this.map) {
      const show = world.camMode === 'zoom' || world.camMode === 'follow';
      if (show !== this.map.on) { this.map.on = show; this.map.c.style.display = show ? '' : 'none'; }
      if (show) this._mapDraw(race);
    }
    // closing time after the winner crosses the line
    const tl = race.timeLeft;
    const showTl = tl != null && tl < 20 && race.racers.some((r) => r.human && !r.finished);
    if (showTl && !this.tlEl) { this.tlEl = h('<div class="toast small warn" style="position:absolute;left:50%;transform:translateX(-50%);bottom:12%;animation:none"></div>'); this.el.appendChild(this.tlEl); }
    if (this.tlEl) { if (showTl) this.tlEl.textContent = `FIN DE CARRERA EN ${Math.ceil(tl)}`; else { this.tlEl.remove(); this.tlEl = null; } }
    // wrong way warning for player 1
    const ww = me && me.wrongWay && !me.finished;
    if (ww && !this.wrongEl) { this.wrongEl = h('<div class="flag-wrong">¡SENTIDO CONTRARIO!</div>'); this.el.appendChild(this.wrongEl); }
    if (!ww && this.wrongEl) { this.wrongEl.remove(); this.wrongEl = null; }
  }

  // race events -> toasts
  handle(events) {
    const race = this.race;
    if (!race) return;
    const humans = race.racers.filter((r) => r.human);
    const multi = humans.length > 1;
    for (const ev of events) {
      const r = race.racers[ev[1]];
      if (!r) continue;
      const who = multi && r.human ? `${r.entry.player + 1}P ` : '';
      if (ev[0] === 'lap' && r.human) {
        // the lap just done, and whether it was the best of the race so far
        const lt = ev[3], best = lt && ev[2] >= 2 && Math.abs(lt - r.bestLap) < 1e-6;
        const tm = lt ? ` <span class="lt${best ? ' best' : ''}">${fmtTime(lt)}</span>` : '';
        if (ev[2] === race.laps - 1) this.ui.toast(`${who}¡Última vuelta!${tm}`, 'warn', 1900);
        else this.ui.toast(`${who}Vuelta ${ev[2] + 1}${tm}`, 'small', 1700);
      } else if (ev[0] === 'pickup' && r.human) {
        if (ev[2] === 'money') this.ui.toast(`${who}+${fmtMoney(ev[3])}`, 'money small', 1100);
        else this.ui.toast(`${who}Nitro +1`, 'nitro small', 1000);
      } else if (ev[0] === 'finish') {
        if (r.human && !multi) this._finishBanner(r, ev[2]);
        else if (r.human) this.ui.toast(ev[2] === 1 ? `${who}¡Ganador!` : `${who}${ev[2]}º puesto`, ev[2] === 1 ? 'money' : '', 2600);
        else if (ev[2] === 1 && !humans.some((x) => x.finished)) this.ui.toast(`${r.entry.short || r.entry.name} gana`, 'small warn', 2200);
      }
    }
  }

  countdown(race) {
    // lights: 3 red then green, driven by race.time (-COUNTDOWN..0)
    let el = this.ui.get('count');
    if (race.state !== 'countdown' && race.time > 1.2) { if (el) this.ui.hide('count'); return; }
    if (!el) {
      el = this.ui.show('count', `<div class="lights"><i></i><i></i><i></i><i></i></div><div class="n"></div>`, 'passive');
      this.cdLast = null;
    }
    const t = race.time;
    const lights = el.querySelectorAll('.lights i');
    const n = t < -3 ? 0 : t < -2 ? 1 : t < -1 ? 2 : t < 0 ? 3 : 4;
    lights.forEach((l, i) => { l.className = n === 4 ? 'green' : i < n ? 'on' : ''; });
    const label = n === 0 ? '' : n === 4 ? '¡YA!' : String(4 - n);
    if (label !== this.cdLast) {
      this.cdLast = label;
      const ne = el.querySelector('.n');
      ne.textContent = label;
      ne.className = 'n' + (n === 4 ? ' go' : '');
      void ne.offsetWidth;
      ne.style.animation = 'none'; void ne.offsetWidth; ne.style.animation = '';
    }
  }

  // A HUD box over the racing must never hide a truck: when one goes underneath,
  // the box fades almost out until the truck has passed. Hidden during the intro.
  _fade(camera, race, intro) {
    if (!this.fadeEls) return;
    const W = innerWidth, H = innerHeight;
    if (--this.rectT <= 0) { this.rectT = 30; for (const f of this.fadeEls) f.rect = f.el.getBoundingClientRect(); }
    const pts = this._pts || (this._pts = []);
    pts.length = 0;
    let rad = 0;
    for (const r of race.racers) {
      const t = r.truck;
      _v.set(t.x, t.y + 1, t.z).project(camera);
      if (_v.z > 1) continue;
      const x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
      if (!rad) { // on-screen size of a truck (half its length)
        _v.set(t.x + 2.4, t.y + 1, t.z).project(camera);
        rad = Math.max(14, Math.min(90, Math.hypot((_v.x * 0.5 + 0.5) * W - x, (-_v.y * 0.5 + 0.5) * H - y)));
      }
      pts.push(x, y);
    }
    for (const f of this.fadeEls) {
      const r = f.rect;
      if (!r || !r.width) continue;
      let hit = false;
      for (let k = 0; k < pts.length; k += 2) {
        if (pts[k] > r.left - rad && pts[k] < r.right + rad && pts[k + 1] > r.top - rad && pts[k + 1] < r.bottom + rad) { hit = true; break; }
      }
      const op = intro ? 0 : hit ? 0.15 : 1;
      if (op !== f.op) { f.op = op; f.el.style.opacity = String(op); }
    }
  }

  // arena plan drawn from the barrier distance field: track, water and barriers
  _mapBuild(track) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const AW = ARENA.x1 - ARENA.x0, AD = ARENA.z1 - ARENA.z0;
    const W = 150, H = Math.round((W * AD) / AW);
    const c = document.createElement('canvas');
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    c.className = 'hud-map';
    c.style.display = 'none';
    const base = document.createElement('canvas');
    base.width = c.width; base.height = c.height;
    const g = base.getContext('2d');
    const img = g.createImageData(base.width, base.height);
    const sx = AW / base.width, sz = AD / base.height;
    for (let py = 0; py < base.height; py++) {
      for (let px = 0; px < base.width; px++) {
        const x = ARENA.x0 + (px + 0.5) * sx, z = ARENA.z0 + (py + 0.5) * sz;
        const d = track.sdfAt(x, z);
        let col = null;
        if (d < 0.2) col = track.waterAt(x, z) > 0.05 ? [80, 140, 200, 235] : [205, 160, 112, 235];
        else if (d < 1.0) col = [246, 244, 240, 245];
        if (!col) continue;
        const i = (py * base.width + px) * 4;
        img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = col[3];
      }
    }
    g.putImageData(img, 0, 0);
    // start / finish line
    const sl = track.startLine, k = base.width / AW;
    const cx = (sl.x - ARENA.x0) * k, cz = (sl.z - ARENA.z0) * k;
    g.strokeStyle = '#111'; g.lineWidth = 2 * dpr;
    g.beginPath(); g.moveTo(cx - sl.tz * sl.hw * k, cz + sl.tx * sl.hw * k); g.lineTo(cx + sl.tz * sl.hw * k, cz - sl.tx * sl.hw * k); g.stroke();
    return { c, ctx: c.getContext('2d'), base, dpr, k, on: false };
  }

  _mapDraw(race) {
    const m = this.map, g = m.ctx, k = m.k, dpr = m.dpr;
    g.clearRect(0, 0, m.c.width, m.c.height);
    g.drawImage(m.base, 0, 0);
    for (const pk of race.pickups) {
      if (pk.taken) continue;
      g.fillStyle = pk.type === 'money' ? '#ffcf3a' : '#5aa8ff';
      g.beginPath(); g.arc((pk.x - ARENA.x0) * k, (pk.z - ARENA.z0) * k, 2.3 * dpr, 0, 7); g.fill();
    }
    // rivals as dots, the player on top as an arrow along the heading
    for (const pass of [0, 1]) {
      for (const r of race.racers) {
        if ((pass === 1) !== r.human) continue;
        const t = r.truck, x = (t.x - ARENA.x0) * k, y = (t.z - ARENA.z0) * k;
        g.fillStyle = truckDef(r.entry.truckId).css;
        g.lineWidth = (r.human ? 1.6 : 1) * dpr;
        if (r.human) {
          const s = 6 * dpr;
          g.save(); g.translate(x, y); g.rotate(t.h);
          g.beginPath(); g.moveTo(s, 0); g.lineTo(-s * 0.7, s * 0.7); g.lineTo(-s * 0.3, 0); g.lineTo(-s * 0.7, -s * 0.7); g.closePath();
          g.strokeStyle = '#fff'; g.fill(); g.stroke(); g.restore();
        } else {
          g.beginPath(); g.arc(x, y, 3.3 * dpr, 0, 7);
          g.strokeStyle = 'rgba(0, 0, 0, 0.7)'; g.fill(); g.stroke();
        }
      }
    }
  }

  // one player crossing the line: a big result banner over the track
  _finishBanner(r, place) {
    const big = place === 1 ? '¡VICTORIA!' : `${place}º PUESTO`;
    this.ui.show('finish', `<div class="banner finish${place === 1 ? ' win' : ''}"><div class="race">¡META!</div><div class="track">${big}</div>
      <div class="sub">TIEMPO ${fmtTime(r.finishTime)}${r.bestLap ? ` · MEJOR VUELTA ${fmtTime(r.bestLap)}` : ''}</div></div>`, 'passive');
    clearTimeout(this._finT);
    this._finT = setTimeout(() => this.ui.hide('finish'), 3400);
  }

  destroy() {
    clearTimeout(this._finT);
    this.ui.hide('finish'); this.ui.hide('hud'); this.ui.hide('count'); this.race = null; this.el = null; this.wrongEl = null; this.tlEl = null; }
}
