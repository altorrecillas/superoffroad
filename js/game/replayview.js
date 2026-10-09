// The replay theatre. The last race plays again through a new simulation (replay.js)
// with TV cameras: an automatic director that cuts to the jumps, crashes, overtakes
// and the finish (the big jumps in slow motion), or the viewer's own choice of camera
// and truck. A timeline jumps around the race, and the photo mode freezes it for a
// picture to keep or share.

import { ReplayPlayer } from './replay.js';
import { Director } from './director.js';
import { truckDef } from './drivers.js';
import { trackById } from '../sim/tracks.js';
import { fmtTime } from '../ui/hud.js';
import { esc } from '../ui/ui.js';
import { ICONS } from '../ui/icons.js';

const DT = 1 / 120;
const SEEK_STEP = 120 * 5;
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const SPEED_NAME = { 0.25: '×¼', 0.5: '×½', 1: '×1', 2: '×2', 4: '×4' };
const CAMS = ['auto', 'tv', 'chase', 'heli', 'side', 'low', 'classic'];
const CAM_NAME = { auto: 'AUTO', tv: 'TV', chase: 'PERSECUCIÓN', heli: 'AÉREA', side: 'LATERAL', low: 'PISTA', classic: 'CLÁSICA', grid: 'SALIDA' };
const LENSES = [{ n: 'GRAN ANGULAR', fov: 68 }, { n: 'NORMAL', fov: 40 }, { n: 'TELE', fov: 22 }];
const FILTERS = ['none', 'bw', 'old', 'vivid'];
const FILTER_NAME = { none: 'NATURAL', bw: 'BLANCO Y NEGRO', old: 'ANTIGUA', vivid: 'VIVA' };
const FILTER_CSS = { none: '', bw: 'grayscale(1) contrast(1.12)', old: 'sepia(0.75) contrast(1.05) saturate(0.9)', vivid: 'saturate(1.45) contrast(1.06)' };
const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class ReplayView {
  constructor(game, rec, onExit) {
    this.g = game;
    this.rec = rec;
    this.onExit = onExit;
    this.player = new ReplayPlayer(rec);
    this.speed = 1; this.cur = 1;   // chosen and current playback speed (slow motion eases in and out)
    this.playing = true;
    this.cam = 'auto';
    this.lock = null;               // the truck the viewer wants to watch (null: the director decides)
    this.step = 0; this.acc = 0;
    this.seekTo = null;
    this.idleT = 0; this.idle = false;
    this.photo = null;
    this.paintT = 1;
  }

  // ------------------------------------------------------------------ start / exit
  start() {
    const g = this.g;
    this.race = this.player.makeRace();
    this.humans = this.race.racers.filter((r) => r.human).map((r) => r.i);
    this.director = new Director(this.rec, this.humans);
    // the trucks to cycle through: the players first, then the rest in grid order
    this.order = [...this.humans, ...this.race.racers.filter((r) => !r.human).map((r) => r.i)];
    g.race = this.race;
    g.world.setRace(this.race);
    g.world.showRings(false); // TV pictures: the names go in the caption instead
    g.audio.startRace(this.race);
    g.audio.voiceOff = true;
    g.audio.pause(false);
    g.audio.music('race');
    g.state = 'replay';
    this._ui();
    this._input(true);
    this.shot = this.director.update(0, this.race);
    this._applyCam(true);
  }

  exit() {
    if (this.exiting) return;
    this.exiting = true;
    const g = this.g;
    g._fade(() => {
      this._input(false);
      this._photoClose(true);
      g.ui.hide('replay');
      g.audio.voiceOff = false;
      g.audio.timeScale = 1;
      g.world.showRings(true);
      g.replayView = null;
      this.onExit();
    });
  }

  // ------------------------------------------------------------------ per frame
  // returns the visual time step and the interpolation factor for the world
  frame(dt) {
    const g = this.g, w = g.world;
    if (this.photo) { this._photoInput(dt); return { dt: 0, alpha: this.acc / DT }; }
    if (this.seekTo != null) { this._seekWork(); this._paint(dt, true); return { dt: 0, alpha: 0 }; }
    this.director.lock = this.lock;
    if (this.cam === 'auto') this.shot = this.director.update(this.step, this.race);
    // the director's slow motion (only at normal speed with the automatic camera)
    const s = this.shot;
    let target = this.speed;
    if (this.cam === 'auto' && this.speed === 1 && s && s.slow && this.step >= s.slowFrom && this.step <= s.slowTo) target = s.slow;
    this.cur += (target - this.cur) * Math.min(1, dt * (target < this.cur ? 9 : 3.5));
    if (Math.abs(this.cur - target) < 0.01) this.cur = target;
    g.audio.timeScale = this.cur;
    if (this.playing) {
      this.acc += dt * this.cur;
      const evs = this._evs || (this._evs = []);
      evs.length = 0;
      let n = 0;
      while (this.acc >= DT && n < 60) {
        if (this.step >= this.rec.length) { this._ended(); break; }
        w.savePrev();
        this.race.step(DT, this.player.inputsAt(this.step));
        this.step++;
        for (const ev of this.race.events) evs.push(ev);
        this.acc -= DT; n++;
      }
      if (n >= 60) this.acc = 0;
      if (evs.length) {
        w.handleEvents(evs);
        g.audio.handle(evs, this.race);
        if (this.shotMode !== 'chase') w.shake = 0; // a shaking TV camera looks broken
      }
      if (!this.idle && (this.idleT += dt) > 3.5) this._setIdle(true);
    }
    this._applyCam(false);
    this._paint(dt, false);
    return { dt: this.playing ? dt * this.cur : 0, alpha: Math.min(1, this.acc / DT) };
  }

  _ended() {
    this.playing = false;
    this.ended = true;
    this.acc = 0;
    this.g.audio.pause(true);
    this._setIdle(false);
    this._paint(0, true);
  }

  // the truck shown in the caption and followed by the manual cameras
  _focus() { return this.lock ?? (this.humans[0] ?? this.race.order[0].i); }

  _applyCam(force) {
    const w = this.g.world;
    let mode, opts, key;
    if (this.cam === 'auto') {
      const s = this.shot;
      if (!s) return;
      key = s;
      mode = s.mode; opts = { index: s.index, side: s.side ?? 1, phase: s.phase ?? 0 };
    } else {
      const idx = this._focus();
      key = this.cam + ':' + idx;
      mode = this.cam; opts = { index: idx, side: 1, phase: 0.6 };
    }
    if (!force && key === this._applied) return;
    this._applied = key;
    if (mode === 'chase') w.setCamera('follow', { index: opts.index, zoom: 0.85 });
    else if (mode === 'classic') w.setCamera('classic', {});
    else w.setCamera(mode, opts);
    this.shotMode = mode;
    this.shotIndex = mode === 'grid' || mode === 'classic' ? null : opts.index;
  }

  // ------------------------------------------------------------------ seeking
  seek(target) {
    target = clamp(Math.round(target), 0, Math.max(0, this.rec.length - 1));
    const g = this.g;
    if (target < this.step) {
      // backwards: the simulation starts again and runs up to there
      this.race = this.player.makeRace();
      g.race = this.race;
      g.world.swapRace(this.race);
      g.audio.rebind(this.race);
      this.step = 0;
      this._back = true;
    }
    this.ended = false;
    this.seekTo = target;
    this.acc = 0;
    this.director.reset();
    this._applied = null;
    this._paint(0, true);
  }
  _seekWork() {
    const t0 = performance.now(), w = this.g.world;
    while (this.step < this.seekTo && performance.now() - t0 < 14) {
      for (let k = 0; k < 120 && this.step < this.seekTo; k++) { this.race.step(DT, this.player.inputsAt(this.step)); this.step++; }
    }
    w.savePrev();
    w._skipMarks = true;
    if (this.step >= this.seekTo) {
      this.seekTo = null;
      w.resync(this._back);
      this._back = false;
      this.director.lock = this.lock;
      if (this.cam === 'auto') this.shot = this.director.update(this.step, this.race);
      this._applyCam(true);
    }
  }

  // ------------------------------------------------------------------ controls
  setPlaying(on) {
    if (on && this.ended) { this.seek(0); this.ended = false; }
    this.playing = on;
    this.g.audio.pause(!on);
    this._paint(0, true);
  }
  _act(a) {
    this._setIdle(false);
    if (a === 'play') this.setPlaying(!this.playing);
    else if (a === 'restart') { this.seek(0); this.setPlaying(true); }
    else if (a === 'back') this.seek(this.step - SEEK_STEP);
    else if (a === 'fwd') this.seek(this.step + SEEK_STEP);
    else if (a === 'speed') { this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length]; this.cur = this.speed; }
    else if (a === 'cam') { this.cam = CAMS[(CAMS.indexOf(this.cam) + 1) % CAMS.length]; this._applied = null; if (this.cam === 'auto') { this.director.reset(); this.shot = this.director.update(this.step, this.race); } }
    else if (a === 'truck') this._cycleTruck(1);
    else if (a === 'photo') this._photoOpen();
    else if (a === 'exit') this.exit();
    this._applyCam(false);
    this._paint(0, true);
  }
  _cycleTruck(d) {
    // null = everybody (the director picks) — only with the automatic camera
    const list = this.cam === 'auto' ? [null, ...this.order] : this.order;
    let k = list.indexOf(this.lock);
    if (k < 0) k = list.indexOf(this._focus());
    this.lock = list[(k + d + list.length) % list.length];
    this.director.lock = this.lock;
    if (this.cam === 'auto') { this.director.reset(); this.shot = this.director.update(this.step, this.race); }
    this._applied = null;
    this._applyCam(false);
    this._paint(0, true);
  }

  _setIdle(on) {
    if (on === this.idle) { if (!on) this.idleT = 0; return; }
    this.idle = on;
    this.idleT = 0;
    const el = this.g.ui.get('replay');
    if (el) el.classList.toggle('idle', on);
  }

  _input(on) {
    const g = this.g;
    if (on) {
      this._offUI = g.input.onUI((a) => this._onUI(a), 15);
      this._kd = (e) => { if (!e.repeat) this._onKey(e); };
      this._wake = (e) => { if (!this.photo && (e.type !== 'pointermove' || e.pointerType === 'mouse')) this._setIdle(false); };
      window.addEventListener('keydown', this._kd);
      window.addEventListener('pointerdown', this._wake, true);
      window.addEventListener('pointermove', this._wake, true);
    } else {
      if (this._offUI) this._offUI();
      window.removeEventListener('keydown', this._kd);
      window.removeEventListener('pointerdown', this._wake, true);
      window.removeEventListener('pointermove', this._wake, true);
    }
  }
  _onUI(a) {
    if (this.exiting) return true;
    if (this.g.ui.get('photoprev')) return false; // the preview's own buttons
    if (this.photo) {
      if (a === 'ok') { this._shoot(); return true; }
      if (a === 'back') { this._photoClose(); return true; }
      return a !== 'mute'; // arrows / stick orbit the camera (read every frame)
    }
    if (this.idle && a !== 'mute') { this._setIdle(false); return true; } // the first press only shows the controls
    this._setIdle(false);
    if (a === 'pause') { this.setPlaying(!this.playing); return true; }
    if (a === 'up' || a === 'down') { this._cycleTruck(a === 'down' ? 1 : -1); return true; }
    return false; // left / right / ok / back: the controls bar
  }
  _onKey(e) {
    if (this.exiting || this.g.ui.get('photoprev')) return;
    const c = e.code;
    if (this.photo) {
      if (c === 'KeyT') this._photoAct('truck');
      else if (c === 'KeyL') this._photoAct('lens');
      else if (c === 'KeyF') this._photoAct('filter');
      return;
    }
    const map = { KeyC: 'cam', KeyV: 'speed', KeyF: 'photo', KeyR: 'restart', KeyT: 'truck', KeyK: 'play', PageUp: 'back', PageDown: 'fwd' };
    if (map[c]) { this._setIdle(false); this._act(map[c]); }
  }

  // ------------------------------------------------------------------ the screen
  _ui() {
    const g = this.g, meta = this.rec.setup.meta || {}, def = trackById(meta.id);
    const L = Math.max(1, this.rec.length);
    const pct = (s) => (100 * clamp(s / L, 0, 1)).toFixed(2) + '%';
    const ticks = [
      ...this.rec.lapSteps.map((s) => `<i class="tk lap" style="left:${pct(s)}"></i>`),
      ...this.rec.marks.filter((m) => m.k === 'air' && m.v >= 0.55).map((m) => `<i class="tk air" style="left:${pct(m.s)}"></i>`),
      ...this.rec.marks.filter((m) => m.k === 'finish' && m.v === 1).map((m) => `<i class="tk fin" style="left:${pct(m.s)}"></i>`),
    ].join('');
    const el = g.ui.show('replay', `
      <div class="rp-lb top"></div><div class="rp-lb bot"></div>
      <div class="rp-top">
        <div class="rp-rec"><i></i>REPETICIÓN</div>
        <div class="rp-info"><b>${esc(def ? def.name : '')}${meta.reverse ? ' · INVERSO' : ''}</b><span class="rp-lap"></span></div>
      </div>
      <div class="rp-third"><span class="chip"></span><span class="rp-pos"></span><span class="rp-name"></span><span class="rp-shot"></span></div>
      <div class="rp-slow">CÁMARA LENTA</div>
      <div class="rp-bar">
        <div class="rp-line"><div class="rp-rail"><i class="rp-fill"></i>${ticks}</div><i class="rp-head"></i></div>
        <div class="rp-btns">
          <div class="rbtn" data-a="restart" title="Desde el principio (R)">${ICONS.restart}</div>
          <div class="rbtn" data-a="back" title="−5 s">${ICONS.back}</div>
          <div class="rbtn big" data-a="play" title="Pausa (P)">${ICONS.pause}</div>
          <div class="rbtn" data-a="fwd" title="+5 s">${ICONS.fwd}</div>
          <div class="rbtn txt" data-a="speed" title="Velocidad (V)"><b>×1</b></div>
          <div class="rbtn txt" data-a="cam" title="Cámara (C)">${ICONS.cam}<b>AUTO</b></div>
          <div class="rbtn txt" data-a="truck" title="Camión (↑ ↓)"><span class="chip"></span><b></b></div>
          <div class="rbtn" data-a="photo" title="Modo foto (F)">${ICONS.photo}</div>
          <div class="rbtn" data-a="exit" title="Salir (Esc)">${ICONS.close}</div>
        </div>
        <div class="rp-hint">${isTouch() ? '' : '← → BOTONES · ENTER PULSAR · ↑ ↓ CAMIÓN · C CÁMARA · V VELOCIDAD · F FOTO · ESC SALIR'}</div>
      </div>`, 'passive');
    this.el = el;
    const btns = [...el.querySelectorAll('.rp-btns .rbtn')];
    g.ui.navigate('replay', btns, {
      axis: 'h', start: 2,
      onOk: (i, b) => this._act(b.dataset.a),
      onBack: () => this.exit(),
    });
    // the timeline: tap or drag to jump there
    const line = el.querySelector('.rp-line');
    const at = (e) => { const r = line.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
    let drag = false;
    line.addEventListener('pointerdown', (e) => { drag = true; line.setPointerCapture(e.pointerId); this._drag = at(e); this._paint(0, true); e.preventDefault(); });
    line.addEventListener('pointermove', (e) => { if (drag) { this._drag = at(e); this._paint(0, true); } });
    const up = (e) => { if (!drag) return; drag = false; const f = at(e); this._drag = null; this.seek(f * this.rec.length); };
    line.addEventListener('pointerup', up);
    line.addEventListener('pointercancel', () => { drag = false; this._drag = null; });
  }

  _name(r) {
    if (r.human) return this.humans.length > 1 ? `JUGADOR ${r.entry.player + 1}` : 'TÚ';
    return (r.entry.name || '').toUpperCase();
  }

  _paint(dt, now) {
    const el = this.el;
    if (!el || !el.isConnected) return;
    const L = Math.max(1, this.rec.length);
    const f = this._drag != null ? this._drag : (this.seekTo != null ? this.seekTo : this.step) / L;
    el.querySelector('.rp-fill').style.transform = `scaleX(${clamp(f, 0, 1).toFixed(4)})`;
    el.querySelector('.rp-head').style.left = (clamp(f, 0, 1) * 100).toFixed(2) + '%';
    el.querySelector('.rp-slow').classList.toggle('on', this.cur < 0.9 && this.playing && this.seekTo == null);
    this.paintT += dt;
    if (!now && this.paintT < 0.12) return;
    this.paintT = 0;
    const race = this.race;
    // top: lap and race clock
    const idx = this.shotIndex ?? this._focus();
    const r = race.racers[idx];
    const lap = r.finished ? 'META' : `VUELTA ${Math.min(race.laps, r.lap + 1)}/${race.laps}`;
    el.querySelector('.rp-lap').textContent = race.state === 'countdown' ? 'SALIDA' : `${lap} · ${fmtTime(Math.max(0, race.time))}`;
    // caption: who the camera is on
    const third = el.querySelector('.rp-third');
    if (this.shotIndex == null) third.classList.add('off');
    else {
      third.classList.remove('off');
      const d = truckDef(r.entry.truckId);
      third.querySelector('.chip').style.background = d.css;
      third.querySelector('.rp-pos').textContent = race.state === 'countdown' ? '' : `${r.finished ? r.place : r.pos || 1}º`;
      third.querySelector('.rp-name').textContent = this._name(r);
      third.classList.toggle('me', r.human);
    }
    third.querySelector('.rp-shot').textContent = CAM_NAME[this.shotMode] || '';
    // buttons
    const play = el.querySelector('[data-a=play]');
    const icon = this.ended ? ICONS.replay : this.playing ? ICONS.pause : ICONS.play;
    if (play._icon !== icon) { play.innerHTML = icon; play._icon = icon; }
    el.querySelector('[data-a=speed] b').textContent = SPEED_NAME[this.speed];
    el.querySelector('[data-a=cam] b').textContent = CAM_NAME[this.cam];
    const tb = el.querySelector('[data-a=truck]');
    const lk = this.lock != null ? race.racers[this.lock] : (this.cam === 'auto' ? null : race.racers[this._focus()]);
    tb.querySelector('b').textContent = lk ? this._name(lk) : 'TODOS';
    tb.querySelector('.chip').style.background = lk ? truckDef(lk.entry.truckId).css : 'linear-gradient(90deg,#e3261f,#2a63f0,#f7c21b,#b9c1ca)';
    el.classList.toggle('seeking', this.seekTo != null);
  }

  // ------------------------------------------------------------------ photo mode
  _photoOpen() {
    if (this.photo) return;
    const g = this.g, w = g.world;
    this.wasPlaying = this.playing;
    this.playing = false;
    g.audio.pause(true);
    g.audio.timeScale = 1;
    const idx = this._focus();
    const cam = g.view.camera, tp = w.views[idx].root.position;
    const dx = cam.position.x - tp.x, dy = cam.position.y - tp.y - 1, dz = cam.position.z - tp.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    this.photo = { index: idx, yaw: Math.atan2(dz, dx), pitch: clamp(Math.asin(clamp(dy / d, -1, 1)), 0.04, 1.35), dist: clamp(d, 5, 22), fov: 40, lens: 1, filter: 'none' };
    w.setCamera('photo', this.photo);
    g.state = 'photo';
    this.el.classList.add('photo');
    // full resolution while the picture is still
    this._dyn = g.view.dynamic;
    g.view.dynamic = false;
    if (g.view.dpr < g.view.maxDpr) { g.view.dpr = g.view.maxDpr; g.view.renderer.setPixelRatio(g.view.dpr); g.view.resize(); }
    const el = g.ui.show('photo', `
      <div class="ph-top"><b>MODO FOTO</b><span>${isTouch() ? 'Arrastra para girar · pellizca para acercar' : 'Flechas o arrastrar: girar · rueda o + −: acercar · ENTER: foto'}</span></div>
      <div class="ph-bar">
        <div class="rbtn txt" data-a="truck"><span class="chip"></span><b></b></div>
        <div class="rbtn txt" data-a="lens">${ICONS.lens}<b></b></div>
        <div class="rbtn txt" data-a="filter">${ICONS.filter}<b></b></div>
        <div class="rbtn txt shoot" data-a="shoot">${ICONS.photo}<b>HACER FOTO</b></div>
        <div class="rbtn" data-a="back" title="Volver">${ICONS.close}</div>
      </div>`, 'passive');
    g.ui.navigate('photo', [...el.querySelectorAll('.rbtn')], { axis: 'h', start: 3, onOk: (i, b) => this._photoAct(b.dataset.a), onBack: () => this._photoClose() });
    this._photoPaint();
    // orbit with a finger or the mouse, pinch or wheel to zoom
    const app = document.getElementById('app');
    const pts = new Map();
    let span = 0;
    const sp = () => { const [a, b] = [...pts.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    const down = (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) span = sp(); };
    const move = (e) => {
      const p = pts.get(e.pointerId);
      if (!p || !this.photo) return;
      const ph = this.photo;
      if (pts.size === 1) {
        ph.yaw += (e.clientX - p[0]) * 0.008;
        ph.pitch = clamp(ph.pitch + (e.clientY - p[1]) * 0.006, 0.04, 1.4);
      }
      p[0] = e.clientX; p[1] = e.clientY;
      if (pts.size === 2) { const s = sp(); if (span > 20 && s > 20) ph.dist = clamp(ph.dist * span / s, 3.2, 40); span = s; }
    };
    const up = (e) => pts.delete(e.pointerId);
    const wheel = (e) => { e.preventDefault(); if (this.photo) this.photo.dist = clamp(this.photo.dist * Math.exp(clamp(e.deltaY, -60, 60) * 0.004), 3.2, 40); };
    app.addEventListener('pointerdown', down); app.addEventListener('pointermove', move);
    app.addEventListener('pointerup', up); app.addEventListener('pointercancel', up);
    app.addEventListener('wheel', wheel, { passive: false });
    this._photoOff = () => {
      app.removeEventListener('pointerdown', down); app.removeEventListener('pointermove', move);
      app.removeEventListener('pointerup', up); app.removeEventListener('pointercancel', up);
      app.removeEventListener('wheel', wheel);
    };
  }

  _photoClose(silent) {
    if (!this.photo) return;
    const g = this.g;
    if (this._photoOff) this._photoOff();
    g.ui.hide('photo');
    g.ui.hide('photoprev');
    if (this._photoUrl) { URL.revokeObjectURL(this._photoUrl); this._photoUrl = null; }
    document.getElementById('gl').style.filter = '';
    g.view.dynamic = this._dyn;
    this.photo = null;
    if (silent) return;
    g.state = 'replay';
    this.el.classList.remove('photo');
    this._applied = null;
    this._applyCam(true);
    // back to the controls bar
    g.ui.navigate('replay', [...this.el.querySelectorAll('.rp-btns .rbtn')], {
      axis: 'h', start: 7, onOk: (i, b) => this._act(b.dataset.a), onBack: () => this.exit(),
    });
    this.setPlaying(!!this.wasPlaying);
  }

  _photoAct(a) {
    const ph = this.photo;
    if (!ph) return;
    if (a === 'truck') {
      ph.index = this.order[(this.order.indexOf(ph.index) + 1) % this.order.length];
      this.lock = ph.index;
    } else if (a === 'lens') { ph.lens = (ph.lens + 1) % LENSES.length; ph.fov = LENSES[ph.lens].fov; }
    else if (a === 'filter') { ph.filter = FILTERS[(FILTERS.indexOf(ph.filter) + 1) % FILTERS.length]; }
    else if (a === 'shoot') return this._shoot();
    else if (a === 'back') return this._photoClose();
    this._photoPaint();
  }

  _photoPaint() {
    const el = this.g.ui.get('photo'), ph = this.photo;
    if (!el || !ph) return;
    const r = this.race.racers[ph.index];
    const t = el.querySelector('[data-a=truck]');
    t.querySelector('.chip').style.background = truckDef(r.entry.truckId).css;
    t.querySelector('b').textContent = this._name(r);
    el.querySelector('[data-a=lens] b').textContent = LENSES[ph.lens].n;
    el.querySelector('[data-a=filter] b').textContent = FILTER_NAME[ph.filter];
    document.getElementById('gl').style.filter = FILTER_CSS[ph.filter]; // the live preview of the filter
  }

  // keyboard and gamepad orbit (held keys, sticks)
  _photoInput(dt) {
    const ph = this.photo, down = this.g.input.down;
    if (!ph || this.g.ui.get('photoprev')) return;
    let yaw = (down.has('ArrowRight') || down.has('KeyD') ? 1 : 0) - (down.has('ArrowLeft') || down.has('KeyA') ? 1 : 0);
    let pitch = (down.has('ArrowUp') || down.has('KeyW') ? 1 : 0) - (down.has('ArrowDown') || down.has('KeyS') ? 1 : 0);
    let zoom = (down.has('Minus') || down.has('NumpadSubtract') ? 1 : 0) - (down.has('Equal') || down.has('NumpadAdd') || down.has('BracketRight') ? 1 : 0);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = (i) => (Math.abs(p.axes[i] || 0) > 0.2 ? p.axes[i] : 0);
      yaw += ax(0); pitch -= ax(1); zoom += ax(3);
    }
    ph.yaw += yaw * dt * 1.6;
    ph.pitch = clamp(ph.pitch + pitch * dt * 0.9, 0.04, 1.4);
    ph.dist = clamp(ph.dist * Math.exp(zoom * dt * 1.4), 3.2, 40);
  }

  // the picture: a fresh frame of the 3D view, the filter, a signature; then a preview
  // to share it (phones) or save it
  _shoot() {
    const g = this.g, view = g.view, src = view.renderer.domElement;
    if (g.ui.get('photoprev')) return;
    let c;
    try {
      g.world.update(0, this.acc / DT); // the photo camera, this instant
      view.render(0);                   // read back within the same task: no preserveDrawingBuffer needed
      c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const x = c.getContext('2d');
      x.drawImage(src, 0, 0);
      this._filterPixels(x, c.width, c.height, this.photo.filter);
      this._signature(x, c.width, c.height);
    } catch (e) { console.warn('photo', e); g.ui.toast('No se ha podido hacer la foto', 'small warn', 1600); return; }
    g.audio.sfx('clank', { vol: 0.35, rate: 2.4, vary: 0 });
    const flash = document.createElement('div');
    flash.className = 'ph-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 600);
    c.toBlob((blob) => this._preview(blob), 'image/jpeg', 0.92);
  }

  _filterPixels(x, W, H, f) {
    if (f === 'none') return;
    const img = x.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (f === 'bw') { const v = (l - 128) * 1.12 + 128; d[i] = d[i + 1] = d[i + 2] = v; }
      else if (f === 'old') {
        const sr = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b;
        d[i] = ((r + (sr - r) * 0.75) - 128) * 1.05 + 128; d[i + 1] = ((g + (sg - g) * 0.75) - 128) * 1.05 + 128; d[i + 2] = ((b + (sb - b) * 0.75) - 128) * 1.05 + 128;
      } else { d[i] = (l + (r - l) * 1.45 - 128) * 1.06 + 128; d[i + 1] = (l + (g - l) * 1.45 - 128) * 1.06 + 128; d[i + 2] = (l + (b - l) * 1.45 - 128) * 1.06 + 128; }
    }
    x.putImageData(img, 0, 0);
  }

  _signature(x, W, H) {
    const s = H / 720, meta = this.rec.setup.meta || {}, def = trackById(meta.id);
    const gr = x.createLinearGradient(0, H * 0.74, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
    x.fillStyle = gr; x.fillRect(0, H * 0.74, W, H * 0.26);
    const logo = this.g.logoImg;
    if (logo && logo.complete && logo.naturalWidth) {
      const lh = 70 * s, lw = lh * logo.naturalWidth / logo.naturalHeight;
      x.drawImage(logo, W - lw - 22 * s, H - lh - 16 * s, lw, lh);
    }
    x.shadowColor = 'rgba(0,0,0,0.85)'; x.shadowBlur = 6 * s; x.shadowOffsetY = 2 * s;
    x.fillStyle = '#fff'; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.font = `italic ${Math.round(34 * s)}px Russo, sans-serif`;
    x.fillText((def ? def.name : '').toUpperCase() + (meta.reverse ? ' · INVERSO' : ''), 24 * s, H - 52 * s);
    x.font = `${Math.round(27 * s)}px Teko, sans-serif`;
    x.fillStyle = 'rgba(255,255,255,0.88)';
    const r = this.race.racers[this.photo.index];
    const when = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    x.fillText(`${this._name(r) === 'TÚ' ? 'SUPER OFF ROAD' : this._name(r)} · ${meta.trial ? 'CONTRARRELOJ' : meta.free ? 'CARRERA LIBRE' : `CARRERA ${(meta.raceNo || 0) + 1}`} · ${when}`, 24 * s, H - 22 * s);
    x.shadowBlur = 0; x.shadowOffsetY = 0;
  }

  _preview(blob) {
    const g = this.g;
    if (!blob || !this.photo) { if (!blob) g.ui.toast('No se ha podido hacer la foto', 'small warn', 1600); return; }
    const meta = this.rec.setup.meta || {};
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const name = `superoffroad-${meta.id || 'foto'}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`;
    const url = URL.createObjectURL(blob);
    this._photoUrl = url;
    let file = null;
    try { file = new File([blob], name, { type: 'image/jpeg' }); } catch (e) { /* old browsers */ }
    const canShare = !!(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    const el = g.ui.show('photoprev', `
      <div class="panel fade-in photo-prev">
        <img src="${url}" alt="Foto de la repetición">
        <div class="menu row-menu" style="padding-top:8px">
          ${canShare ? `<div class="btn primary" data-a="share"><span class="ric">${ICONS.share}</span>COMPARTIR</div>` : ''}
          <div class="btn ${canShare ? '' : 'primary'}" data-a="save"><span class="ric">${ICONS.save}</span>GUARDAR</div>
          <div class="btn" data-a="more"><span class="ric">${ICONS.photo}</span>OTRA FOTO</div>
        </div>
      </div>`);
    const close = () => { g.ui.hide('photoprev'); setTimeout(() => URL.revokeObjectURL(url), 1000); const p = g.ui.get('photo'); if (p) g.ui.navigate('photo', [...p.querySelectorAll('.rbtn')], { axis: 'h', start: 3, onOk: (i, b) => this._photoAct(b.dataset.a), onBack: () => this._photoClose() }); };
    g.ui.navigate('photoprev', [...el.querySelectorAll('.btn')], {
      onOk: (i, b) => {
        if (b.dataset.a === 'share') {
          navigator.share({ files: [file], title: 'Super Off Road', text: 'Mi foto de Super Off Road Remastered' }).catch(() => {});
        } else if (b.dataset.a === 'save') {
          const a = document.createElement('a');
          a.href = url; a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          g.ui.toast('Foto guardada', 'small money', 1400);
        } else close();
      },
      onBack: close,
    });
    this.lastPhoto = { name, size: blob.size, share: canShare };
  }
}
