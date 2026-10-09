// Game flow: boot, attract mode, menus, championship races, results, the
// speed shop, pause, options, game over and high scores.

import * as THREE from 'three';
import { Scene3D } from '../render/scene.js';
import { RaceWorld } from '../render/world.js';
import { Garage } from '../render/garage.js';
import { Race, COUNTDOWN } from '../sim/race.js';
import { TRACKS, trackById, SEASON, SEASONS } from '../sim/tracks.js';
import { buildPath } from '../sim/track.js';
import { ellipsePoly } from '../sim/util.js';
import { Input } from '../core/input.js';
import { Haptics } from '../core/haptics.js';
import { UI, h, esc } from '../ui/ui.js';
import { ICONS } from '../ui/icons.js';
import { HUD, fmtTime } from '../ui/hud.js';
import { Touch } from '../ui/touch.js';
import { Audio } from '../audio/audio.js';
import { blockPageZoom, enterFullscreen, exitFullscreen, canFullscreen, needsHomeScreen } from '../core/device.js';
import { TRUCKS, PLAYER_TRUCKS, truckDef } from './drivers.js';
import { lapKey, lapRecord, submitLap, loadLaps } from './records.js';
import { GhostRecorder, ghostKey, loadGhost, saveGhost, ghostTimes } from './ghost.js';
import { ReplayRecorder, quantize } from './replay.js';
import { ReplayView } from './replayview.js';
import { SteerAssist, ASSIST_LEVELS } from '../sim/assist.js';
import {
  Session, UPGRADES, UPGRADE_COST, MAX_LEVEL, NITRO_COST, CREDIT_CASH, DIFFICULTY, DIFF_ORDER,
  loadScores, qualifies, addScore, fmtMoney,
} from './session.js';

const DT = 1 / 120;
// the Track Pak let you pick the body: bars are relative (ACEL, VEL, AGARRE, AMORT)
const VEHICLE_INFO = {
  truck: { name: 'CAMIÓN', bars: [3, 4, 4, 2], desc: 'Pesado: más agarre y velocidad punta, y gana los empujones.' },
  buggy: { name: 'BUGGY', bars: [4, 3, 3, 4], desc: 'Ligero: acelera más y vuela mejor sobre los baches, pero lo empujan.' },
};
const LS_OPT = 'sor.options.v1';
const params = new URLSearchParams(location.search);

function isTouch() { return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; }
function defaultQuality() {
  if (params.get('q')) return params.get('q');
  const small = Math.min(screen.width, screen.height) < 520;
  // weak GPUs (older mobile chips, old integrated graphics) start lower
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || '').toLowerCase();
  } catch (e) { /* ignore */ }
  const weak = /mali-g[4-5]\d\b|mali-t|adreno \(tm\) [3-5]\d\d|adreno [3-5]\d\d|powervr|intel.*hd graphics [2-5]|swiftshader|llvmpipe/.test(gpu);
  const mem = navigator.deviceMemory || 8;
  if (weak || mem <= 2) return 'low';
  // phones start at medium (iPhones with 2-3 GB can lose the page to big GPU buffers);
  // tablets and computers at high. Dynamic resolution adjusts from there.
  return isTouch() && small ? 'medium' : 'high';
}

// mini map of a circuit for the free race cards
function trackThumb(def) {
  const W = 220, H = 136;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#3a2215'); grd.addColorStop(1, '#24150d');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const k = W / 132, tx = (x) => (x + 66) * k, tz = (z) => (z + 41) * k;
  for (const w of def.water || []) {
    const poly = w.poly || ellipsePoly(w.x, w.z, w.rx, w.rz, w.rot || 0, 20, w.wobble ?? 0.12, 3);
    g.fillStyle = '#2f5f8f'; g.beginPath();
    poly.forEach(([x, z], i) => (i ? g.lineTo(tx(x), tz(z)) : g.moveTo(tx(x), tz(z)))); g.closePath(); g.fill();
  }
  for (const a of def.areas || []) {
    g.fillStyle = '#a8794e'; g.beginPath();
    a.poly.forEach(([x, z], i) => (i ? g.lineTo(tx(x), tz(z)) : g.moveTo(tx(x), tz(z)))); g.closePath(); g.fill();
  }
  const p = buildPath(def, false);
  const line = (w, col) => {
    g.strokeStyle = col; g.lineWidth = w; g.lineJoin = 'round'; g.beginPath();
    for (let i = 0; i <= p.n; i += 2) { const j = i % p.n; i ? g.lineTo(tx(p.x[j]), tz(p.z[j])) : g.moveTo(tx(p.x[j]), tz(p.z[j])); }
    g.closePath(); g.stroke();
  };
  line((def.width ?? 9.5) * k + 3, '#e8e2d8');
  line((def.width ?? 9.5) * k, '#b8834f');
  for (const is of def.islands || []) {
    g.fillStyle = is.circle ? '#d9d4ca' : '#3a2215';
    g.beginPath();
    if (is.circle) g.arc(tx(is.circle[0]), tz(is.circle[1]), Math.max(2, is.circle[2] * k), 0, 7);
    else is.poly.forEach(([x, z], i) => (i ? g.lineTo(tx(x), tz(z)) : g.moveTo(tx(x), tz(z))));
    g.fill();
  }
  // start marker
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(tx(def.start[0]), tz(def.start[1]), 3.5, 0, 7); g.fill();
  return c.toDataURL('image/png');
}

export class Game {
  constructor() {
    this.opt = Object.assign({
      quality: 'auto', camera: isTouch() ? 'zoom' : 'classic', music: 7, sfx: 8, touch: 'buttons', touchSide: 'right', touchSize: 'm', nitroPos: 'both', autoGas: false, fps: false, voice: true, haptics: true, fullscreen: true,
      assist: isTouch() ? 'soft' : 'off', difficulty: 'normal',
    }, this._loadOpt());
    if (!DIFFICULTY[this.opt.difficulty]) this.opt.difficulty = 'normal';
    if (ASSIST_LEVELS[this.opt.assist] == null) this.opt.assist = 'off';
    this.state = 'boot';
    this.warp = +(params.get('warp') || 1);
    this.paused = false;
    this.acc = 0;
    this.frameEvents = [];
  }
  _loadOpt() { try { return JSON.parse(localStorage.getItem(LS_OPT)) || {}; } catch (e) { return {}; } }
  saveOpt() { try { localStorage.setItem(LS_OPT, JSON.stringify(this.opt)); } catch (e) { /* ignore */ } }

  // ------------------------------------------------------------------ boot
  async boot() {
    const prog = (p, msg) => {
      const bar = document.querySelector('#loading .bar i');
      if (bar) bar.style.width = Math.round(p * 100) + '%';
      const hint = document.querySelector('#loading .hint');
      if (hint && msg) hint.textContent = msg;
    };
    prog(0.05, 'Preparando el estadio…');
    blockPageZoom();
    const q = this.opt.quality === 'auto' ? defaultQuality() : this.opt.quality;
    this.view = new Scene3D(document.getElementById('app'), q);
    this.view.dynamic = !params.get('frames');
    this.input = new Input();
    this.haptics = new Haptics(this.input, this.opt);
    this.audio = new Audio(this.opt);
    this.ui = new UI(document.getElementById('ui'), this.input, (s) => {
      this.audio.ui(s);
      if ((s === 'ok' || s === 'back' || s === 'deny') && this.opt.haptics !== false && isTouch() && navigator.vibrate) { try { navigator.vibrate(s === 'deny' ? [8, 40, 8] : 8); } catch (e) { /* */ } }
    });
    this.hud = new HUD(this.ui);
    this.touch = new Touch(this.input, this.opt);
    this.touch.camera = this.view.camera;
    this.touch.onPause = () => { if (this.state === 'race' || this.state === 'intro') (this.paused ? this.resume() : this.pause()); };
    this.world = new RaceWorld(this.view);
    this.logoImg = new Image(); // signs the replay photos
    this.logoImg.src = 'assets/ui/logo.webp';
    // the classic view keeps the strip under the HUD board free of track
    this.world.hudInset = () => {
      const b = this.hud && this.hud.el && this.hud.el.querySelector('.hud-board');
      if (!b) return 0;
      const r = b.getBoundingClientRect();
      return r.height ? Math.min(0.2, (r.bottom + 4) / innerHeight) : 0;
    };
    this.view.onResize = () => { if (this.world.track) this.world.refit(); this.touch && this.touch.layout(); };
    prog(0.2, 'Cargando camiones…');
    await this.world.init();
    this.garage = new Garage(this.view, this.world.templates);
    try {
      this.portraits = this.garage.portraits(['red', 'blue', 'yellow', 'grey']);
      this.portraitsBuggy = this.garage.portraits(PLAYER_TRUCKS, 'buggy');
    } catch (e) { console.warn('portraits', e); this.portraits = {}; this.portraitsBuggy = {}; }
    prog(0.6, 'Cargando sonido…');
    await this.audio.load((p) => prog(0.6 + p * 0.3));
    prog(0.92, 'Nivelando la tierra…');
    // first user gesture unlocks audio
    const unlock = () => { this.audio.unlock(); };
    // a finger lifting is what browsers count as permission for sound (iPhone above all)
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { passive: true });
    this.input.onUI((a, src) => this._globalUI(a, src), 10);
    this._setupZoomGestures();
    this._watchContext();
    this._trapBack();
    // phones: stay in fullscreen (a tap that lifts the finger is a valid user activation)
    const keepFull = () => { if (this.opt.fullscreen !== false && isTouch()) enterFullscreen(); };
    document.addEventListener('pointerup', keepFull);
    // a tap skips the intro fly-over (the keyboard and pads already can)
    document.addEventListener('pointerup', () => { if (this.state === 'intro' && !this.paused && this.introT != null && this.introT > 0.6) this.introT = this.introHold; });
    document.addEventListener('click', keepFull);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'race' && !this.paused) this.pause();
      if (document.hidden && this.replayView && this.replayView.playing) this.replayView.setPlaying(false);
      this.audio.suspend(document.hidden);
    });
    // a phone turned to portrait shows the "rotate" overlay: do not keep racing behind it
    const portrait = (this.portraitMQ = matchMedia('(orientation: portrait)'));
    const onRotate = () => {
      if (!portrait.matches || !isTouch()) return;
      if ((this.state === 'race' || this.state === 'intro') && !this.paused) this.pause();
      if (this.replayView && this.replayView.playing) this.replayView.setPlaying(false);
    };
    if (portrait.addEventListener) portrait.addEventListener('change', onRotate); else if (portrait.addListener) portrait.addListener(onRotate);

    if (params.get('demo') === '1' || params.get('shot')) this._testMode();
    else this.toTitle();
    document.getElementById('loading').remove();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // test hooks for headless captures: ?demo=1&track=id&rev=1&ff=sec&frames=n
  _testMode() {
    const id = params.get('track') || 'fandango';
    const vehicle = params.get('vehicle') || 'truck';
    if (params.get('vehicle')) this.opt.vehicle = vehicle; // select screen tab (not saved)
    const players = params.get('player') === '1' ? [{ truckId: 'red', vehicle }] : [];
    if (params.get('pitch')) this.world.pitch = +params.get('pitch');
    this.session = new Session(players, 'normal');
    this.attract = players.length === 0;
    this.startRace(id, params.get('rev') === '1', { skipIntro: true, time: params.get('time') });
    const ff = +(params.get('ff') || 0);
    for (let t = 0; t < ff; t += DT) { this.world.savePrev(); this.race.step(DT, []); }
    if (params.get('cam') === 'tv') this.world.setCamera('tv', { index: +(params.get('focus') || 0) });
    else if (params.get('cam') === 'fixed') this.world.setCamera('fixed', { pos: params.get('cp').split(',').map(Number), look: params.get('cl').split(',').map(Number) });
    else if (params.get('cam')) this.world.setCamera(params.get('cam'), { index: +(params.get('focus') || 0), target: () => this._truckPos(+(params.get('focus') || 0)), radius: +(params.get('dist') || 10), height: 4, speed: 0 });
    this.testFrames = +(params.get('frames') || 0);
    if (params.get('screen') === 'title') { this.attract = true; this._showTitle(); }
    if (params.get('screen') === 'menu') { this.attract = true; this.toMenu(); }
    if (params.get('screen') === 'select') { this.attract = true; this.toSelect(+(params.get('n') || 1), 'normal'); }
    if (params.get('screen') === 'options') { this.attract = true; this.toOptions(() => {}); }
    if (params.get('screen') === 'free') { this.attract = true; this.toFreeRace(); }
    if (params.get('screen') === 'shop') { this.session = new Session([{ truckId: 'red', vehicle }], 'normal'); this.session.players[0].money = 180000; this.toShop(0); }
    if (params.get('screen') === 'results') {
      for (let t = 0; t < 200 && this.race.state !== 'done'; t += DT) this.race.step(DT, []);
      this.session = new Session([{ truckId: 'red' }], 'normal');
      this.race.racers[0].human = true; this.race.racers[0].entry.human = true; this.race.racers[0].entry.player = 0;
      this.showResults(this.session.applyResults(this.race));
    }
  }
  _truckPos(i) { const t = this.race.racers[i].truck; return new THREE.Vector3(t.x, t.y, t.z); }

  // ------------------------------------------------------------------ main loop
  frame(now) {
    // rAF timestamps can be earlier than a performance.now() taken just before: never negative
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    this.input.update();
    this.touch.update(dt);
    this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; this._fpsShow(); }

    // a replay runs its own simulation (and its own clock: pause, slow motion)
    const rv = this.replayView ? this.replayView.frame(dt) : null;
    if (!rv && this.race && !this.paused) this.stepRace(dt);
    if (this.race && this.state !== 'shop') {
      const vdt = rv ? rv.dt : this.paused ? 0 : dt;
      this.world.update(vdt, rv ? rv.alpha : this.acc / DT);
      if (this.world.props && this.world.props.userData.update) this.world.props.userData.update(vdt, this.race);
      if (this.world.water && this.world.water.userData.update) this.world.water.userData.update(dt, this.world.terrain.userData.fieldTex);
      if (this.state === 'race' || this.state === 'intro') this.hud.update(dt, this.view.camera, this.world, this.state === 'intro');
      if (this.state === 'race') this.hud.countdown(this.race);
      this.audio.update(dt, this.race, this.view.camera, this.paused || this.attract || (this.state === 'intro' && this.introT < 1.5));
    }
    if (this.introT != null && !this.paused) this._introTick(dt);
    if (this.stateTick) this.stateTick(dt);
    if (this.attractTick) this.attractTick(dt);
    if (this.attract && this.attractCam) this.attractCam(dt);
    // a phone held upright only shows the "rotate" notice: no point drawing the 3D view
    if (!(this.portraitMQ && this.portraitMQ.matches && isTouch())) this.view.render(dt);
    if (this.testFrames && --this.testFrames <= 0) { window.__ready = true; this.testFrames = 0; window.__shotInfo = { fps: this.fps, build: this.world.buildMs }; return; }
    requestAnimationFrame((t) => this.frame(t));
  }

  stepRace(dt) {
    const race = this.race;
    if (this.state === 'intro' && this.introT < this.introHold) return; // race clock waits for the intro
    const warp = this.warp || 1;
    this.acc += dt * warp;
    let n = 0;
    this.frameEvents.length = 0;
    const inputs = [this.input.get(0), this.input.get(1), this.input.get(2)];
    // touch "point to steer": convert a target heading into steering for player 1
    const p0 = inputs[0];
    if (p0.targetHeading != null && race) {
      const me = race.racers.find((r) => r.human && r.entry.player === 0);
      if (me) {
        let d = p0.targetHeading - me.truck.h;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        p0.steer = Math.max(-1, Math.min(1, d * 2.4));
      }
    }
    // what the simulation gets: the input after the steering assist, rounded to what the
    // replay stores (so the replay is exactly this race)
    const q = this._stepIn || (this._stepIn = [0, 1, 2].map(() => ({ steer: 0, throttle: 0, brake: 0, nitro: false })));
    while (this.acc >= DT && n < 12 * warp) {
      this.world.savePrev();
      for (let p = 0; p < 3; p++) {
        const a = this.assists && this.assists[p];
        quantize(a && race.state === 'race' ? a.apply(DT, inputs[p]) : inputs[p], q[p]);
      }
      race.step(DT, q);
      if (this.replayRec && race === this.replayRec.live) this.replayRec.step(q, race);
      if (this.trial) this.trial.recorder.step(race);
      for (const ev of race.events) this.frameEvents.push(ev);
      this.input.consumeNitro();
      this.acc -= DT; n++;
    }
    if (n >= 12 * warp) this.acc = 0;
    // the announcer follows the lead (one player only: with several it would be noise)
    if (this.state === 'race' && !this.attract && race.state === 'race' && race.time > 4) {
      const humans = race.racers.filter((r) => r.human);
      const lead = race.order[0];
      if (humans.length === 1 && lead && lead !== this._leader) {
        if (this._leader) {
          if (lead.human) this.audio.announce('lead', true);
          else if (lead.entry.ironman && this._leader.human) this.audio.announce('ironman_lead', true);
        }
        this._leader = lead;
      }
    } else if (race.state === 'countdown') this._leader = null;
    if (this.frameEvents.length) {
      this.world.handleEvents(this.frameEvents);
      this.audio.handle(this.frameEvents, race);
      if (!this.attract) this.haptics.handle(this.frameEvents, race);
      if (this.state === 'race') this.hud.handle(this.frameEvents);
      for (const ev of this.frameEvents) {
        if (ev[0] === 'racedone' && (this.state === 'race' || this.attract)) this.onRaceDone();
        if ((ev[0] === 'lap' || ev[0] === 'finish') && ev[3] && this.state === 'race') this._lapDone(ev);
        if (this.trial && this.state === 'race' && (ev[0] === 'lap' || ev[0] === 'finish') && ev[1] === this.trial.me.i && ev[3]) (this.trial.laps = this.trial.laps || []).push(ev[3]);
        if (this.state === 'race' && !this.attract) this._callout(ev);
      }
    }
  }

  // runs before the menus; return true to consume the action
  _globalUI(a, src) {
    const racing = this.state === 'race' || this.state === 'intro';
    if (racing && !this.paused && src === 'pad' && (a === 'back' || a === 'ok')) return true; // B brakes, A accelerates
    if (a === 'ok' && this.state === 'intro' && !this.paused && this.introT != null && this.introT > 0.6) { this.introT = this.introHold; return true; }
    if (racing && !this.paused && (a === 'pause' || a === 'back')) { this.pause(); return true; }
    if (racing && this.paused && a === 'pause') { this.resume(); return true; }
    if (a === 'mute') { this.audio.toggleMute(); this.ui.toast(this.audio.muted ? 'Sonido desactivado' : 'Sonido activado', 'small', 900); return true; }
    return false;
  }
  _fpsShow() {
    if (!this.opt.fps) { if (this.fpsEl) { this.fpsEl.remove(); this.fpsEl = null; } return; }
    if (!this.fpsEl) { this.fpsEl = h('<div style="position:fixed;left:8px;bottom:6px;z-index:40;font:16px monospace;color:#0f0;text-shadow:0 1px 2px #000"></div>'); document.body.appendChild(this.fpsEl); }
    this.fpsEl.textContent = `${Math.round(this.fps)} fps`;
  }

  // ------------------------------------------------------------------ races
  startRace(id, reverse, opts = {}) {
    const track = this.world.loadTrack(id, reverse, opts.time);
    const bug = trackById(id).pak ? Math.floor(Math.random() * 3) : -1;
    const entries = this.attract
      ? TRUCKS.map((d, i) => ({ truckId: d.id, vehicle: i === bug ? 'buggy' : 'truck', name: d.cpu.name, short: d.cpu.short, ironman: !!d.cpu.ironman, ...this.session.cpuSetup(d), slot: i }))
      : this.session.entries();
    this.input.solo = entries.filter((e) => e.human).length <= 1;
    for (let p = 0; p < 3; p++) this.input.autoGas[p] = !!this.opt.autoGas && p === 0;
    const seed = params.get('seed') ? +params.get('seed') : (Math.random() * 1e9) | 0;
    // time trial: alone, no pickups, 3 laps, against the ghost of the best run
    const trial = !this.attract && !!(this.session.free && this.session.free.trial);
    const laps = opts.laps ?? (params.get('laps') ? +params.get('laps') : trial ? 3 : undefined);
    const ropts = { seed, ...this.session.raceOpts(), laps, pickups: !trial };
    this.race = new Race(track, entries, ropts);
    this.race.autopilot = params.get('autopilot') === '1';
    this.lapRecordSet = false;
    this.race.autopilotSkill = params.get('apskill') ? +params.get('apskill') : 0.95;
    // the steering assist works on each player's input; the strongest level used in
    // the race sets the prize (it can be changed from the pause menu)
    this.assists = [];
    this.assistUsed = 0;
    this.replayRec = null;
    if (!this.attract) {
      const lvl = ASSIST_LEVELS[this.opt.assist] || 0;
      for (const r of this.race.racers) if (r.human) this.assists[r.entry.player] = new SteerAssist(r.truck, track, lvl);
      this.assistUsed = lvl;
      // everything a replay needs: the recipe of the race and, step by step, the inputs
      this.replayRec = new ReplayRecorder(this.race, {
        track, entries, opts: ropts, autopilot: this.race.autopilot, autopilotSkill: this.race.autopilotSkill,
        meta: { id, reverse, trial, free: !!this.session.free, raceNo: this.session.raceNo },
      });
    }
    this.world.setRace(this.race);
    this.trial = null;
    if (trial) {
      const key = ghostKey(id, reverse) + (laps !== 3 ? `-${laps}` : ''); // other lap counts (tests) keep their own ghost
      const me = this.race.racers.find((r) => r.human);
      this.trial = { key, rec: loadGhost(key), recorder: new GhostRecorder(me), me };
    }
    this.world.setGhost(this.trial && this.trial.rec);
    this.acc = 0;
    this.audio.startRace(this.race);
    if (this.attract) {
      this.world.setCamera('classic', { snap: true });
      return;
    }
    this.hud.trial = this.trial ? { rec: this.trial.rec } : null;
    this.hud.build(this.race, this.session);
    this.world.refit(); // frame the arena below the board
    this.touch.root.classList.remove('intro');
    this.touch.show(true);
    if (opts.skipIntro) { this.state = 'race'; this._raceCamera(true); return; }
    this.state = 'intro';
    this.introT = 0;
    this.introHold = 5.2;
    this.touch.root.classList.add('intro'); // the pad appears when the race camera takes over
    this.world.setCamera('intro', { duration: 5.0 });
    const def = trackById(id);
    const no = this.session.raceNo + 1;
    const tr = this.trial;
    this.ui.show('intro', `<div class="banner"><div class="race">${tr ? 'CONTRARRELOJ' : this.session.free ? 'CARRERA LIBRE' : `CARRERA ${no}`}${def.pak ? ' · TRACK PAK' : ''}</div><div class="track">${esc(def.name)}</div>
      <div class="sub">${reverse ? 'SENTIDO INVERSO · ' : ''}${this.race.laps} ${this.race.laps === 1 ? 'VUELTA' : 'VUELTAS'} · ${tr ? (tr.rec ? `RÉCORD ${fmtTime(tr.rec.t)} · CON FANTASMA` : 'SIN RÉCORD AÚN') : DIFFICULTY[this.session.difficulty].name.toUpperCase()}</div>
      ${this.session.raceNo === 0 && !this.session.free && this.session.players.length === 1 ? `<div class="howto">${this._controlsLine()}</div>` : ''}</div>`, 'passive');
    this.audio.music('race');
    this.audio.announce('track_' + id);
  }

  // the announcer's calls on the player's own moments
  _callout(ev) {
    const r = this.race.racers[ev[1]];
    if (!r || !r.human || this.race.racers.filter((x) => x.human).length !== 1) return;
    if (ev[0] === 'land' && ev[3] > 0.68) this.audio.announce('big_air', true); // the longest jumps of the game last ~0.75 s
    else if (ev[0] === 'wrongway') this.audio.announce('wrong_way', true);
  }

  // a human lap: personal record for this circuit and direction?
  _lapDone(ev) {
    const r = this.race.racers[ev[1]];
    if (!r || !r.human || this.race.autopilot) return;
    const key = lapKey(this.race.track.id, this.race.track.reverse);
    const prev = submitLap(key, ev[3], { v: r.entry.vehicle || 'truck', c: r.entry.truckId });
    if (prev === false) return;
    this.lapRecordSet = true;
    if (!prev) return; // first lap ever here: it becomes the record quietly
    const who = this.race.racers.filter((x) => x.human).length > 1 ? `${r.entry.player + 1}P ` : '';
    this.ui.toast(`${who}¡Récord de vuelta! ${fmtTime(ev[3])}`, 'money', 2400);
    this.audio.sfx('pickup', { vol: 0.6, vary: 0, rate: 1.25 });
    if (ev[0] === 'lap' && ev[2] !== this.race.laps - 1) this.audio.announce('lap_record', true);
  }

  // one line with the controls of the device in use (first race of a championship)
  _controlsLine() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
    if (isTouch() && !pads.length) {
      return this.opt.touch === 'stick' ? 'JOYSTICK: APUNTA Y ACELERA · NITRO: TURBO<br>PELLIZCA LA PISTA PARA ACERCAR O ALEJAR' : '◀ ▶ GIRAR · GAS · NITRO<br>PELLIZCA LA PISTA PARA ACERCAR O ALEJAR';
    }
    if (pads.length || this.input.lastDevice === 'pad') return 'STICK GIRAR · A ACELERAR · B FRENAR · X / RB NITRO · START PAUSA';
    return '← → GIRAR · ↑ ACELERAR · ↓ FRENAR · ESPACIO NITRO · RUEDA DEL RATÓN: ZOOM · ESC PAUSA';
  }

  // race camera from the options; multiplayer always uses the classic view
  _raceCamera(snap) {
    const humans = this.race.racers.filter((r) => r.human);
    const idx = Math.max(0, this.race.racers.findIndex((r) => r.human));
    const mode = humans.length !== 1 ? 'classic' : this.opt.camera;
    this.world.setCamera(mode === 'follow' ? 'follow' : mode === 'zoom' ? 'zoom' : 'classic',
      { snap, index: idx, zoom: mode === 'follow' ? (this.opt.followZoom ?? 1) : (this.opt.zoomLevel ?? 0.52) });
  }

  // Pinch (phones) or the mouse wheel: zoom the race camera. Zooming all the way out
  // of the close camera gives the classic view of the whole arena, and the other way.
  _zoomBy(f) {
    if (this.state !== 'race' || this.paused || !this.race || !isFinite(f)) return;
    const humans = this.race.racers.filter((r) => r.human);
    if (humans.length !== 1) return; // shared screen: the classic view stays
    const w = this.world;
    if (w.camMode === 'follow') {
      const z = Math.min(1.8, Math.max(0.6, (w.camOpts.zoom ?? 1) * f));
      w.camOpts.zoom = z; this.opt.followZoom = z;
    } else if (w.camMode === 'zoom' || w.camMode === 'classic') {
      const cur = w.camMode === 'zoom' ? (w.camOpts.zoom ?? 0.52) : 1;
      const z = Math.min(1, Math.max(0.3, cur * f));
      if (z >= 0.985) {
        if (w.camMode !== 'classic') w.setCamera('classic', {});
        this.opt.camera = 'classic';
      } else {
        if (w.camMode !== 'zoom') w.setCamera('zoom', { index: humans[0].i, zoom: z }); else w.camOpts.zoom = z;
        this.opt.camera = 'zoom'; this.opt.zoomLevel = z;
      }
    } else return;
    clearTimeout(this._zoomSave);
    this._zoomSave = setTimeout(() => this.saveOpt(), 600);
  }

  // Android back button / swipe back: it must not leave the game. A history entry is
  // pushed on a tap (browsers ignore entries added without one); going back pops it and
  // acts like the game's own back key (pause in a race, previous screen in menus). On
  // the title screen a second back press does leave.
  _trapBack() {
    if (params.get('demo')) return;
    let armed = false;
    const arm = () => { if (armed) return; armed = true; try { history.pushState({ sor: 1 }, ''); } catch (e) { armed = false; } };
    window.addEventListener('pointerup', arm);
    window.addEventListener('keydown', arm);
    window.addEventListener('popstate', () => {
      armed = false;
      if ((this.state === 'race' || this.state === 'intro') && !this.paused) this.pause();
      else if (this.state === 'title') this.ui.toast('Pulsa ATRÁS otra vez para salir', 'small', 1600);
      else this.input._ui('back', 'keys');
    });
  }

  // The phone can take the graphics memory back (memory pressure, a long time in the
  // background): pause, wait for WebGL to come back, rebuild what lived only on the
  // GPU (sky lighting, tyre marks), and offer a reload if it never returns.
  _watchContext() {
    const cv = this.view.renderer.domElement;
    let timer = 0;
    cv.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // allow the restore
      if ((this.state === 'race' || this.state === 'intro') && !this.paused) this.pause();
      this.ui.show('ctxlost', `<div class="panel fade-in"><div class="head">RECUPERANDO LOS GRÁFICOS…</div>
        <div class="verdict">El teléfono ha liberado la memoria gráfica.<br>Un momento…</div>
        <div class="menu" style="padding-top:0"><div class="btn primary" data-a="reload" style="display:none">RECARGAR EL JUEGO</div></div></div>`);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const el = this.ui.get('ctxlost');
        const b = el && el.querySelector('[data-a=reload]');
        if (!b) return;
        b.style.display = '';
        el.querySelector('.verdict').innerHTML = 'Los gráficos no han vuelto.<br>Recarga el juego para seguir.';
        this.ui.navigate('ctxlost', [b], { onOk: () => location.reload() });
      }, 5000);
    });
    cv.addEventListener('webglcontextrestored', () => {
      clearTimeout(timer);
      try {
        // the old environment map and the PMREM generator's buffers died with the lost
        // context: drop them (deleting them now would touch a dead context) and rebuild
        this.view.envRT = null;
        this.view.pmrem = new THREE.PMREMGenerator(this.view.renderer);
        this.view.setTime(this.world.timeName || 'day');           // PMREM environment
        if (this.world.terrain) this.world.terrain.userData.marks.clear(); // tyre-mark target
        // the baked ground noise was GPU-only: compute it live until the next circuit
        if (this.world.terrain && this.world.terrain.userData.uniforms.uBaked) this.world.terrain.userData.uniforms.uBaked.value = 0;
      } catch (err) { console.warn('restore', err); }
      this.ui.hide('ctxlost');
      if (this.paused) this.ui.toast('Gráficos recuperados', 'small', 1400);
    });
  }

  _setupZoomGestures() {
    const app = document.getElementById('app');
    const pts = new Map();
    let last = 0;
    const span = () => { const [a, b] = [...pts.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    app.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) last = span();
    });
    app.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size !== 2) return;
      const d = span();
      if (last > 20 && d > 20) this._zoomBy(last / d); // fingers apart: closer
      last = d;
    });
    const up = (e) => { pts.delete(e.pointerId); };
    app.addEventListener('pointerup', up);
    app.addEventListener('pointercancel', up);
    app.addEventListener('wheel', (e) => {
      if (this.state !== 'race') return;
      e.preventDefault();
      this._zoomBy(Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.004));
    }, { passive: false });
  }

  _introTick(dt) {
    this.introT += dt * (this.warp || 1);
    if (this.state !== 'intro') { this.introT = null; return; }
    if (this.introT >= this.introHold) {
      this.ui.hide('intro');
      this.touch.root.classList.remove('intro');
      this.state = 'race';
      this.introT = null;
      this._raceCamera(false);
      this.audio.announce(this.trial ? 'time_trial' : 'ready');
    }
  }

  onRaceDone() {
    if (this.attract) {
      // attract mode: next track after a short pause (own timer, the title uses stateTick)
      let t = 0;
      this.attractTick = (dt) => { t += dt; if (t > 3) { this.attractTick = null; this._fade(() => this._attractNext(), 380, true); } };
      return;
    }
    this.state = 'post';
    if (this.trial) return this._trialDone();
    const summary = this.session.applyResults(this.race, { assist: this.assistUsed || 0 });
    summary.advice = this._advice(summary);
    this.lastSummary = summary;
    this.stateTick = this._delay(2.2, () => this.showResults(summary));
    const winner = this.race.finishOrder[0];
    this.world.setCamera('tv', { index: winner.i });
    this.audio.announce(winner.human ? 'winner' : 'race_over');
    // fireworks over the stadium
    this.fireworksT = 4;
  }

  // ------------------------------------------------------------------ time trial
  _trialDone() {
    const T = this.trial, me = T.me, prev = T.rec;
    const done = me.finished && !me.dnf;
    let saved = false;
    if (done) {
      saved = saveGhost(T.key, { t: me.finishTime, laps: T.laps || [], v: me.entry.vehicle || 'truck', c: me.entry.truckId, at: Date.now(), s: T.recorder.s });
    }
    this.world.setCamera('tv', { index: me.i });
    this.audio.announce(saved && prev ? 'new_record' : 'race_over');
    if (saved) this.fireworksT = 4;
    this.stateTick = this._delay(2.2, () => this._trialResults(done, saved, prev));
  }

  _trialResults(done, saved, prev) {
    this.hud.destroy();
    this.touch.show(false);
    this.state = 'results';
    const T = this.trial, me = T.me, def = trackById(this.session.free.id);
    const laps = T.laps || [];
    const best = laps.length ? Math.min(...laps) : 0;
    const recLaps = prev && prev.laps ? prev.laps : [];
    let cum = 0, recCum = 0;
    const rows = laps.map((t, i) => {
      cum += t; recCum += recLaps[i] || 0;
      const d = recLaps[i] != null ? cum - recCum : null; // ahead/behind the record at that point
      return `<div class="place">${i + 1}</div><div class="${t === best ? 'fast' : ''}">${fmtTime(t)}</div>
        <div class="${d == null || Math.abs(d) < 0.005 ? 'muted' : d < 0 ? 'ok' : 'bad'}">${d == null ? '—' : Math.abs(d) < 0.005 ? '±0.00' : (d < 0 ? '−' : '+') + Math.abs(d).toFixed(2)}</div>`;
    }).join('');
    const verdict = !done ? '<div class="bad"><span class="big">Sin tiempo</span></div>'
      : saved && prev ? `<div class="ok"><span class="big">¡Nuevo récord!</span><br>${fmtTime(me.finishTime)} · ${(prev.t - me.finishTime).toFixed(2)} s mejor que tu fantasma</div>`
      : saved ? `<div class="ok"><span class="big">${fmtTime(me.finishTime)}</span><br>Primer tiempo: desde ahora correrás contra este fantasma</div>`
      : Math.abs(me.finishTime - prev.t) < 0.005 ? `<div><span class="big">${fmtTime(me.finishTime)}</span><br>¡Empate exacto con tu récord!</div>`
      : `<div><span class="big">${fmtTime(me.finishTime)}</span><br><span class="bad">+${(me.finishTime - prev.t).toFixed(2)} s</span> sobre tu récord (${fmtTime(prev.t)})</div>`;
    const el = this.ui.show('results', `
      <div class="panel fade-in" style="max-width:96vw">
        <div class="head">CONTRARRELOJ · ${esc(def.name).toUpperCase()}${this.session.free.reverse ? ' (INVERSO)' : ''}</div>
        <div class="table trial" style="padding:4px 18px 8px">
          <div class="hd">VUELTA</div><div class="hd">TIEMPO</div><div class="hd">VS. RÉCORD</div>
          ${rows}
        </div>
        <div class="verdict">${verdict}</div>
        <div class="menu row-menu" style="padding-top:0"><div class="btn primary" data-a="again">OTRA VEZ</div>${this._replayBtn()}<div class="btn" data-a="other">OTRO CIRCUITO</div><div class="btn" data-a="menu">MENÚ PRINCIPAL</div></div>
      </div>`);
    this.audio.music('results');
    this._resultsAgain = () => this._trialResults(done, saved, prev);
    this.ui.navigate('results', [...el.querySelectorAll('.btn')], {
      onOk: (i, b) => (b.dataset.a === 'replay' ? this.toReplay() : this._fade(() => {
        this.ui.hide('results');
        if (b.dataset.a === 'again') this.nextRace();
        else if (b.dataset.a === 'other') { this.toTitleQuiet(); this.toFreeRace(); }
        else this.toTitle();
      })),
    });
  }

  // Scene changes go through black (menus <-> race <-> garage) instead of cutting,
  // which also hides the circuit being built. Menu input is off while it runs and a
  // second request during a fade is dropped. sceneOnly: only the 3D view fades (the
  // attract mode changing circuit behind the menus, which stay usable).
  _fade(fn, ms = 230, sceneOnly = false) {
    if (params.get('nofade')) return fn();
    const key = sceneOnly ? '_sceneFading' : '_fading';
    if (this[key]) { if (sceneOnly) fn(); return; }
    this[key] = true;
    const id = sceneOnly ? 'scenefader' : 'fader';
    const el = document.getElementById(id) || document.body.appendChild(h(`<div id="${id}"></div>`));
    if (!sceneOnly) this.ui.nav = null;
    el.classList.add('on');
    setTimeout(() => {
      try { fn(); } finally {
        // let the new scene render a frame before revealing it
        requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.remove('on'); this[key] = false; }));
      }
    }, ms);
  }

  _delay(sec, fn) {
    let t = 0;
    return (dt) => {
      t += dt;
      if (this.fireworksT > 0) {
        this.fireworksT -= dt;
        if (Math.random() < dt * 3) {
          const cols = [[1, 0.3, 0.2], [0.3, 0.6, 1], [1, 0.85, 0.2], [0.4, 1, 0.5], [1, 1, 1]];
          this.world.fx.firework((Math.random() - 0.5) * 140, 34 + Math.random() * 18, -60 - Math.random() * 20, cols[(Math.random() * 5) | 0]);
          this.audio.sfx('boom', { vol: 0.45 });
        }
      }
      if (t >= sec) { this.stateTick = null; fn(); }
    };
  }

  // back to the menus with the attract race running behind
  toTitleQuiet() {
    this.hud.destroy();
    this.touch.show(false);
    this.session = new Session([], 'normal');
    this.attract = true;
    this._attractIdx = Math.floor(Math.random() * SEASON.length);
    this._attractNext();
    this.audio.music('title');
  }

  // ------------------------------------------------------------------ attract / title
  toTitle() {
    this.ui.hideAll();
    this.hud.destroy();
    this.touch.show(false);
    this.paused = false;
    this.session = new Session([], 'normal');
    this.attract = true;
    this.attractTick = null;
    this._attractIdx = Math.floor(Math.random() * SEASON.length);
    this._attractNext();
    this._showTitle();
    this.audio.music('title');
  }
  _attractNext() {
    const [id, rev] = SEASON[this._attractIdx++ % SEASON.length];
    this.session.raceNo = 4 + Math.floor(Math.random() * 8);
    this.startRace(id, rev, { laps: 3 });
    // like a TV broadcast behind the menus: the overhead view of the arcade between
    // pole cameras, the helicopter, trackside and onboard shots of the front runners
    const SHOTS = [['classic', 12], ['tv', 7], ['heli', 6], ['low', 6], ['classic', 10], ['follow', 6], ['side', 5], ['tv', 7]];
    let t = 0, k = 0;
    this.attractCam = (dt) => {
      if (!this.attract || !this.race || this.race.state === 'countdown') return;
      t += dt;
      if (t > SHOTS[k][1]) {
        t = 0; k = (k + 1) % SHOTS.length;
        const mode = SHOTS[k][0], r = this.race.order[(Math.random() * 3) | 0] || this.race.racers[0];
        if (mode === 'classic') this.world.setCamera('classic', { snap: true });
        else this.world.setCamera(mode, { index: r.i, zoom: 0.9, side: Math.random() < 0.5 ? 1 : -1, phase: Math.random() * 6 });
      }
    };
  }
  _showTitle() {
    this.state = 'title';
    const el = this.ui.show('title', `
      <div class="logo fade-in" style="margin-top:2vh">
        <div class="logo-img"><img src="assets/ui/logo.webp" alt="Super Off Road" onerror="this.parentNode.remove();document.querySelector('#title .txtlogo').style.display=''"><i class="shine"></i></div>
        <div class="txtlogo" style="display:none"><div class="l1">IVAN "IRONMAN" STEWART'S</div><div class="l2 chrome">SUPER OFF ROAD</div></div>
        <div class="l3">REMASTERED</div>
      </div>
      <div class="press blink">${isTouch() ? 'TOCA PARA EMPEZAR' : 'PULSA ENTER PARA EMPEZAR'}</div>
      ${needsHomeScreen() ? '<div class="ios-tip">Para jugar a pantalla completa en el iPhone: <b>Compartir</b> → <b>Añadir a pantalla de inicio</b></div>' : ''}
      <div class="foot"><span>1-3 JUGADORES</span><span>16 CIRCUITOS · 32 CONFIGURACIONES</span><span>RÉCORD ${fmtMoney(loadScores()[0].score)}</span></div>`);
    const go = (e) => { if (e) e.preventDefault(); this.audio.unlock(); this.audio.ui('ok'); if (this.opt.fullscreen !== false) enterFullscreen(); this.toMenu(); };
    el.addEventListener('click', go, { once: true });
    this.ui.navigate('title', [el], { onOk: () => go() });
    // alternate with the high score table
    let t = 0, showing = false;
    this.stateTick = (dt) => {
      t += dt;
      if (this.state !== 'title') return;
      if (t > 9) {
        t = 0; showing = !showing;
        const logo = el.querySelector('.logo');
        if (showing) {
          logo.style.display = 'none';
          const sc = h(`<div class="panel fade-in hs-panel"><div class="head">MEJORES PILOTOS</div>${this._scoresHTML()}</div>`);
          el.insertBefore(sc, el.querySelector('.press'));
          this.ui.fit(el);
        } else {
          logo.style.display = '';
          el.querySelector('.hs-panel')?.remove();
        }
      }
    };
  }
  _scoresHTML(hiIndex = -1) {
    const s = loadScores();
    // the level each score was made at (the scores before the four levels have none)
    const tag = (x) => (DIFFICULTY[x.d] ? `<span class="dtag d-${x.d}">${DIFFICULTY[x.d].tag}</span>` : '');
    const row = (x, i) => `<div class="r ${i === hiIndex ? 'new' : ''}">${i + 1}.</div><div class="${i === hiIndex ? 'new' : ''}">${esc(x.name)}${tag(x)}</div><div class="${i === hiIndex ? 'new' : ''}">${fmtMoney(x.score)}</div><div class="r">C.${x.races}</div>`;
    // two blocks of five: side by side on landscape screens, stacked otherwise
    return `<div class="scores-wrap"><div class="scores">${s.slice(0, 5).map((x, i) => row(x, i)).join('')}</div><div class="scores">${s.slice(5).map((x, i) => row(x, i + 5)).join('')}</div></div>`;
  }

  // ------------------------------------------------------------------ menus
  toMenu() {
    this.state = 'menu';
    this.stateTick = null;
    this.ui.hide('title');
    const el = this.ui.show('menu', `
      <div class="panel fade-in">
        <div class="head">SUPER OFF ROAD</div>
        <div class="menu cols2">
          <div class="btn" data-a="p1">1 JUGADOR</div>
          <div class="btn" data-a="p2">2 JUGADORES</div>
          <div class="btn" data-a="p3">3 JUGADORES</div>
          <div class="btn" data-a="free">CARRERA LIBRE</div>
          <div class="btn" data-a="pack" data-opt>CIRCUITOS <span class="val"></span></div>
          <div class="btn" data-a="opts">OPCIONES</div>
          <div class="btn" data-a="scores">RÉCORDS</div>
          <div class="btn" data-a="help">CÓMO SE JUEGA</div>
          ${this.installPrompt ? '<div class="btn gold-btn" data-a="install">INSTALAR JUEGO</div>' : ''}
        </div>
        <div class="hint-keys">${isTouch() ? '' : '↑↓ ELEGIR · ENTER ACEPTAR · ESC VOLVER'}</div>
      </div>`);
    const items = [...el.querySelectorAll('.btn')];
    const packs = ['all', 'classic', 'pak'], packName = { all: 'TODOS (16)', classic: 'ORIGINALES (8)', pak: 'TRACK PAK (8)' };
    let pack = this.opt.pack || 'all';
    const paintPack = () => { el.querySelector('[data-a=pack] .val').textContent = packName[pack]; };
    paintPack();
    const cyclePack = (d) => { pack = packs[(packs.indexOf(pack) + d + packs.length) % packs.length]; this.opt.pack = pack; this.saveOpt(); paintPack(); };
    this.ui.navigate('menu', items, {
      onOk: (i, b) => {
        const a = b.dataset.a;
        if (a === 'p1' || a === 'p2' || a === 'p3') this.toDifficulty(+a[1]);
        else if (a === 'free') { this.ui.hide('menu'); this.toFreeRace(); }
        else if (a === 'pack') cyclePack(1);
        else if (a === 'opts') this.toOptions(() => this.toMenu());
        else if (a === 'scores') this.toScores(() => this.toMenu());
        else if (a === 'help') this.toHelp(() => this.toMenu());
        else if (a === 'install' && this.installPrompt) {
          // the browser's own "install app" dialog (then it opens like an app, full screen)
          const p = this.installPrompt;
          this.installPrompt = null;
          p.prompt();
          p.userChoice.then((c) => { if (c && c.outcome === 'accepted') this.ui.toast('¡Instalado! Ábrelo desde su icono', 'money', 2600); }).catch(() => {}).finally(() => { if (this.state === 'menu') this.toMenu(); });
        }
      },
      onLeft: (i, b) => { if (b.dataset.a === 'pack') cyclePack(-1); },
      onRight: (i, b) => { if (b.dataset.a === 'pack') cyclePack(1); },
      onBack: () => { this.ui.hide('menu'); this._showTitle(); },
    });
  }

  // Championship difficulty, as modern racing games present it: four cards with what
  // each level means (rivals, when a credit is lost, what it pays)
  toDifficulty(n) {
    this.ui.hide('menu');
    const rule = { last: 'si llegas el último', ironman: 'si Ironman te gana', any: 'si cualquier rival te gana' };
    const power = { easy: 1, normal: 2, hard: 4, arcade: 5 };
    const wait = { easy: 'Mucho', normal: 'Algo', hard: 'Poco', arcade: 'Nada' };
    const assist = ASSIST_LEVELS[this.opt.assist] || 0;
    const el = this.ui.show('diff', `
      <div class="panel fade-in" style="max-width:min(1180px,98vw)">
        <div class="head">ELIGE LA DIFICULTAD <span class="gold" style="font-size:.6em">· ${n} ${n > 1 ? 'JUGADORES' : 'JUGADOR'}</span></div>
        <div class="dcards">${DIFF_ORDER.map((k) => {
          const d = DIFFICULTY[k];
          return `<div class="dcard d-${k}" data-k="${k}">
            ${k === 'normal' ? '<div class="tag">RECOMENDADO</div>' : ''}
            <div class="dpips">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= power[k] ? 'on' : ''}"></i>`).join('')}</div>
            <div class="nm">${d.name.toUpperCase()}</div>
            <div class="ds">${d.desc}</div>
            <div class="facts">
              <div class="rule">Pierdes un crédito ${rule[d.rule]}</div>
              <div><span>Te esperan</span><b>${wait[k]}</b></div>
              <div><span>Premios</span><b class="gold">×${String(d.prize).replace('.', ',')}</b></div>
            </div>
          </div>`;
        }).join('')}</div>
        <div class="hint-keys">${assist ? `Dirección asistida ${assist > 1 ? 'fuerte (premios −20 %)' : 'suave (premios −10 %)'}: cámbiala en Opciones.` : 'Sin dirección asistida: cámbiala en Opciones si juegas en el móvil.'}${isTouch() ? '' : '<br>← → ELEGIR · ENTER ACEPTAR · ESC VOLVER'}</div>
      </div>`);
    const cards = [...el.querySelectorAll('.dcard')];
    this.ui.navigate('diff', cards, {
      axis: 'h', start: Math.max(0, DIFF_ORDER.indexOf(this.opt.difficulty || 'normal')),
      onOk: (i, c) => {
        this.opt.difficulty = c.dataset.k; this.saveOpt();
        this.ui.hide('diff');
        this.toSelect(n, c.dataset.k);
      },
      onBack: () => { this.ui.hide('diff'); this.toMenu(); },
    });
  }

  toSelect(n, diff) {
    this.ui.hide('menu');
    const picks = [];
    let vehicle = this.opt.vehicle === 'buggy' ? 'buggy' : 'truck';
    const ask = () => {
      const p = picks.length;
      const el = this.ui.show('select', `
        <div class="panel fade-in" style="max-width:96vw">
          <div class="head">${n > 1 ? `JUGADOR ${p + 1}: ` : ''}ELIGE TU VEHÍCULO</div>
          <div class="vpick">
            <div class="vtabs">${Object.keys(VEHICLE_INFO).map((v) => `<div class="vtab" data-v="${v}">${VEHICLE_INFO[v].name}</div>`).join('')}</div>
            <div class="vstats"></div>
          </div>
          <div class="cards" style="padding:0 18px">
            ${PLAYER_TRUCKS.map((id) => {
              const d = truckDef(id), taken = picks.findIndex((q) => q.truckId === id);
              return `<div class="card ${taken >= 0 ? 'disabled taken' : ''}" data-id="${id}">
                ${taken >= 0 ? `<div class="tag">${taken + 1}P</div>` : ''}
                ${this.portraits && this.portraits[id] ? '<div class="pic"></div>' : `<div class="sw" style="background:${d.css}">${d.number}</div>`}
                <div class="nm">${d.name.toUpperCase()}</div>
                <div class="who">${taken >= 0 ? 'Elegido' : 'Rival: ' + esc(d.cpu.name)}</div></div>`;
            }).join('')}
          </div>
          <div class="hint-keys">${isTouch() ? 'Toca CAMIÓN o BUGGY para cambiar de vehículo' : '← → COLOR · ↑ ↓ CAMIÓN / BUGGY · ENTER ACEPTAR'}<br>El camión gris es siempre de Ivan "Ironman" Stewart.${n > 1 ? '<br>' + this._controlsHint(p) : ''}</div>
        </div>`);
      const cards = [...el.querySelectorAll('.card')];
      const paint = () => {
        const pics = (vehicle === 'buggy' && this.portraitsBuggy) || this.portraits || {};
        el.querySelectorAll('.vtab').forEach((t) => t.classList.toggle('on', t.dataset.v === vehicle));
        el.querySelector('.vstats').innerHTML = this._vehicleStats(vehicle);
        for (const c of cards) { const pic = c.querySelector('.pic'); if (pic && pics[c.dataset.id]) pic.style.backgroundImage = `url(${pics[c.dataset.id]})`; }
      };
      const setVehicle = (v) => {
        if (v === vehicle) return;
        vehicle = v; this.opt.vehicle = v; this.saveOpt();
        this.audio.ui('move');
        paint();
      };
      el.querySelectorAll('.vtab').forEach((t) => t.addEventListener('click', (e) => { e.preventDefault(); setVehicle(t.dataset.v); }));
      paint();
      this.ui.fit(el);
      this.ui.navigate('select', cards, {
        axis: 'h',
        onUp: () => setVehicle('truck'), onDown: () => setVehicle('buggy'),
        onOk: (i, c) => {
          picks.push({ truckId: c.dataset.id, vehicle });
          if (picks.length < n) ask();
          else if (this.freeSetup) this.startFreeRace(picks[0]);
          else this.startChampionship(picks, diff);
        },
        onBack: () => { if (picks.length) { picks.pop(); ask(); } else { this.ui.hide('select'); if (this.freeSetup) this.toFreeRace(); else this.toDifficulty(n); } },
      });
    };
    ask();
  }
  _vehicleStats(v) {
    const info = VEHICLE_INFO[v];
    return `<div class="vdesc">${info.desc}</div><div class="vbars">${['ACELERACIÓN', 'VELOCIDAD', 'AGARRE', 'AMORTIGUACIÓN'].map((nm, i) =>
      `<div class="vbar"><span>${nm}</span><b>${Array.from({ length: 5 }, (_, k) => `<i class="${k < info.bars[i] ? 'on' : ''}"></i>`).join('')}</b></div>`).join('')}</div>`;
  }
  _controlsHint(p) {
    return ['Jugador 1: flechas + ENTER (nitro) o mando 1', 'Jugador 2: W A S D + MAYÚS IZQ. (nitro) o mando 2', 'Jugador 3: I J K L + U (nitro) o mando 3'][p];
  }

  // the demo race behind the menus keeps running (as a demo) until the screen is black
  startChampionship(picks, diff) {
    this._fade(() => {
      this.ui.hideAll();
      this.attract = false;
      this.attractTick = null;
      this.freeSetup = null;
      this.session = new Session(picks.map((q) => ({ truckId: q.truckId, vehicle: q.vehicle })), diff, this.opt.pack || 'all');
      if (params.get('credits')) for (const p of this.session.players) p.credits = +params.get('credits');
      this.nextRace();
    });
  }

  nextRace() {
    this.ui.hideAll();
    const { id, reverse, time } = this.session.currentTrack();
    this.stateTick = null;
    this.startRace(id, reverse, { time });
  }

  // ------------------------------------------------------------------ free race
  toFreeRace() {
    this.state = 'free';
    const sel = this.freeSetup || { id: 'fandango', reverse: false, time: 'auto', trial: false };
    if (!DIFFICULTY[sel.diff]) sel.diff = DIFFICULTY[this.opt.freeDiff] ? this.opt.freeDiff : this.opt.difficulty || 'normal';
    this.freeSetup = sel;
    const cycleDiff = (d) => { sel.diff = DIFF_ORDER[(DIFF_ORDER.indexOf(sel.diff) + d + DIFF_ORDER.length) % DIFF_ORDER.length]; this.opt.freeDiff = sel.diff; this.saveOpt(); };
    const times = ['auto', 'day', 'sunset', 'night'], timeName = { auto: 'DEL CIRCUITO', day: 'DÍA', sunset: 'ATARDECER', night: 'NOCHE' };
    const thumbs = this._thumbs || (this._thumbs = Object.fromEntries(TRACKS.map((d) => [d.id, trackThumb(d)])));
    const render = (focusId) => {
      // cards show the best lap (race) or the best run with its ghost (time trial)
      const recs = loadLaps(), runs = ghostTimes();
      const rec = (d) => {
        if (sel.trial) { const t = runs[ghostKey(d.id, sel.reverse)]; return t ? 'RÉCORD ' + fmtTime(t) : '&nbsp;'; }
        const r = recs[lapKey(d.id, sel.reverse)]; return r ? 'MEJOR ' + fmtTime(r.t) : '&nbsp;';
      };
      const el = this.ui.show('free', `
        <div class="panel fade-in" style="max-width:min(1100px,98vw);max-height:100%;overflow:auto">
          <div class="head">${sel.trial ? 'CONTRARRELOJ' : 'CARRERA LIBRE'} <span class="gold" style="font-size:.72em">· ${esc(trackById(sel.id).name)}</span></div>
          <div class="tracks">${TRACKS.map((d) => `
            <div class="tcard ${d.id === sel.id ? 'sel' : ''}" data-id="${d.id}">
              <img src="${thumbs[d.id]}" alt=""><div class="tn">${esc(d.name)}</div><div class="tp">${d.pak ? 'TRACK PAK' : 'ORIGINAL'}</div>
              <div class="trec">${rec(d)}</div>
            </div>`).join('')}</div>
          <div class="menu" style="flex-direction:row;flex-wrap:wrap;justify-content:center;padding-top:4px">
            <div class="btn" data-a="mode" data-opt>MODO <span class="val">${sel.trial ? 'CONTRARRELOJ' : 'CARRERA'}</span></div>
            ${sel.trial ? '' : `<div class="btn" data-a="rivals" data-opt>RIVALES <span class="val">${DIFFICULTY[sel.diff].name.toUpperCase()}</span></div>`}
            <div class="btn" data-a="dir" data-opt>SENTIDO <span class="val">${sel.reverse ? 'INVERSO' : 'NORMAL'}</span></div>
            <div class="btn" data-a="time" data-opt>LUZ <span class="val">${timeName[sel.time]}</span></div>
            <div class="btn primary" data-a="go">ELEGIR VEHÍCULO</div>
          </div>
        </div>`);
      const cards = [...el.querySelectorAll('.tcard')], btns = [...el.querySelectorAll('.btn')];
      const all = [...cards, ...btns];
      const start = Math.max(0, all.findIndex((e) => e.dataset.id === (focusId || sel.id)));
      const cols = getComputedStyle(el.querySelector('.tracks')).gridTemplateColumns.split(' ').length || 4;
      this.ui.navigate('free', all, {
        start, grid: cols,
        onOk: (i, e) => {
          if (e.dataset.id) { sel.id = e.dataset.id; render(sel.id); return; }
          if (e.dataset.a === 'mode') { sel.trial = !sel.trial; render('mode'); }
          else if (e.dataset.a === 'rivals') { cycleDiff(1); render('rivals'); }
          else if (e.dataset.a === 'dir') { sel.reverse = !sel.reverse; render('dir'); }
          else if (e.dataset.a === 'time') { sel.time = times[(times.indexOf(sel.time) + 1) % times.length]; render('time'); }
          else if (e.dataset.a === 'go') { this.ui.hide('free'); this.toSelect(1, sel.diff); }
        },
        onRight: (i, e) => {
          if (e.dataset.a === 'mode') { sel.trial = !sel.trial; render('mode'); }
          else if (e.dataset.a === 'rivals') { cycleDiff(1); render('rivals'); }
          else if (e.dataset.a === 'dir') { sel.reverse = !sel.reverse; render('dir'); }
          else if (e.dataset.a === 'time') { sel.time = times[(times.indexOf(sel.time) + 1) % times.length]; render('time'); }
        },
        onLeft: (i, e) => {
          if (e.dataset.a === 'mode') { sel.trial = !sel.trial; render('mode'); }
          else if (e.dataset.a === 'rivals') { cycleDiff(-1); render('rivals'); }
          else if (e.dataset.a === 'dir') { sel.reverse = !sel.reverse; render('dir'); }
          else if (e.dataset.a === 'time') { sel.time = times[(times.indexOf(sel.time) + times.length - 1) % times.length]; render('time'); }
        },
        onBack: () => { this.ui.hide('free'); this.freeSetup = null; this.toMenu(); },
      });
      // restore focus on option buttons after a re-render
      if (focusId === 'dir' || focusId === 'time' || focusId === 'mode' || focusId === 'rivals') { const k = all.findIndex((e) => e.dataset.a === focusId); if (k >= 0) this.ui.nav.focus(k, true); }
    };
    render();
  }

  startFreeRace(pick) {
    const f = this.freeSetup;
    this._fade(() => {
      this.ui.hideAll();
      this.attract = false;
      this.attractTick = null;
      this.session = new Session([{ truckId: pick.truckId, vehicle: pick.vehicle }], f.diff || 'normal', 'all', { id: f.id, reverse: f.reverse, time: f.time === 'auto' ? null : f.time, trial: !!f.trial });
      const p = this.session.players[0];
      p.upgrades = { tires: 2, shocks: 2, accel: 2, speed: 2 };
      this.session.raceNo = 6; // a mid-season field
      this.nextRace();
    });
  }

  // ------------------------------------------------------------------ results
  showResults(summary) {
    this.hud.destroy();
    this.touch.show(false);
    this.state = 'results';
    const rows = summary.rows;
    const fastest = Math.min(...rows.map((r) => r.bestLap || Infinity)); // the race's fastest lap
    const html = `
      <div class="panel fade-in" style="max-width:96vw">
        <div class="head">${this.session.free ? `CARRERA LIBRE · ${esc(trackById(this.session.free.id).name).toUpperCase()}` : `RESULTADOS · CARRERA ${summary.raceNo + 1}`}</div>
        <div class="table" style="padding:4px 18px 8px">
          <div class="hd">POS</div><div class="hd">PILOTO</div><div class="hd">TIEMPO</div><div class="hd">MEJOR</div><div class="hd">PREMIO</div>
          ${rows.map((r) => {
            const d = truckDef(r.truckId), pl = summary.players.find((x) => x.place === r.place && r.human);
            const fast = r.bestLap && r.bestLap === fastest;
            return `<div class="place ${r.human ? 'me' : ''}">${r.place}º</div>
              <div class="${r.human ? 'me' : ''}"><span class="chip" style="background:${d.css}"></span>${esc(r.human ? r.name : r.name)}</div>
              <div class="${r.human ? 'me' : ''}">${r.time ? fmtTime(r.time) : '—'}</div>
              <div class="${r.human ? 'me' : ''}${fast ? ' fast' : ''}">${r.bestLap ? fmtTime(r.bestLap) : '—'}</div>
              <div class="${r.human ? 'me gold' : 'muted'}">${pl ? fmtMoney(pl.prize + pl.bags) : ''}</div>`;
          }).join('')}
        </div>
        ${this._lapRecordHTML()}${this.session.free ? '' : this._multHTML(summary)}${summary.advice ? `<div class="laprec advice">${summary.advice}</div>` : ''}
        <div class="verdict">${this.session.free ? summary.players.map((p) => `<div class="${p.place === 1 ? 'ok' : ''}"><span class="big">${p.place === 1 ? '¡Victoria!' : p.place + 'º puesto'}</span></div>`).join('') : summary.players.map((p) => {
          const pl = this.session.players[p.index];
          const tag = this.session.players.length > 1 ? `${p.index + 1}P · ` : '';
          if (p.lost) return `<div class="bad"><span class="big">${tag}${p.credits > 0 ? '¡Pierdes un crédito!' : '¡Sin créditos!'}</span><br>${this._lostReason()} · Te ${p.credits === 1 ? 'queda 1 crédito' : `quedan ${p.credits} créditos`}</div>`;
          return `<div class="ok"><span class="big">${tag}${p.place === 1 ? '¡Victoria!' : 'Sigues en carrera'}</span><br>Premio ${fmtMoney(p.prize)}${p.bags ? ` + bolsas ${fmtMoney(p.bags)}` : ''} · Créditos ${p.credits}</div>`;
        }).join('')}</div>
        <div class="menu row-menu" style="padding-top:0">${this.session.free
          ? `<div class="btn primary" data-a="again">CORRER OTRA VEZ</div>${this._replayBtn()}<div class="btn" data-a="other">OTRO CIRCUITO</div><div class="btn" data-a="menu">MENÚ PRINCIPAL</div>`
          : `<div class="btn primary" data-a="cont">CONTINUAR</div>${this._replayBtn()}`}</div>
      </div>`;
    const free = !!this.session.free;
    const el = this.ui.show('results', html);
    this.audio.music('results');
    this._resultsAgain = () => this.showResults(summary);
    if (free) {
      this.ui.navigate('results', [...el.querySelectorAll('.btn')], {
        onOk: (i, b) => {
          if (b.dataset.a === 'replay') return this.toReplay();
          this._fade(() => {
            this.ui.hide('results');
            if (b.dataset.a === 'again') { const s = this.session; s.raceNo = 6; for (const p of s.players) { p.credits = 3; p.alive = true; } this.nextRace(); }
            else if (b.dataset.a === 'other') { this.toTitleQuiet(); this.toFreeRace(); }
            else this.toTitle();
          });
        },
      });
      return;
    }
    const next = () => this._fade(() => {
      this.ui.hide('results');
      // players without credits are out
      for (const p of summary.players) if (p.credits <= 0) this.session.eliminate(p.index);
      if (this.session.over) return this.toGameOver();
      this.toShop(0);
    });
    this.ui.navigate('results', [...el.querySelectorAll('.btn')], { onOk: (i, b) => (b.dataset.a === 'replay' ? this.toReplay() : next()), onBack: next });
  }
  // the replay of the race just run (also offered after time trials)
  _replayBtn() {
    return this.replayRec && this.replayRec.length > 200 ? `<div class="btn" data-a="replay"><span class="ric">${ICONS.replay}</span>VER REPETICIÓN</div>` : '';
  }
  // the replay theatre over the results; back to the same results afterwards
  toReplay() {
    const rec = this.replayRec;
    if (!rec || this.replayView || rec.length < 200) return;
    rec.closed = true; // the race goes on behind the results: not part of the replay
    this._fade(() => {
      this.ui.hide('results');
      this.stateTick = null;
      this.liveRace = this.race;
      this.replayView = new ReplayView(this, rec, () => {
        // the real race, as it was left, behind the results again
        this.race = this.liveRace;
        this.liveRace = null;
        this.world.setRace(this.race);
        this.audio.startRace(this.race);
        const w = this.race.finishOrder[0];
        this.world.setCamera('tv', { index: w ? w.i : 0 });
        this.state = 'results';
        if (this._resultsAgain) this._resultsAgain(); else this.toTitle();
      });
      this.replayView.start();
    });
  }

  // Like modern games: a hint for the next championship when this level is clearly too
  // easy (several wins in a row) or too hard (credits lost race after race)
  // (once per race: the results screen can be shown again after the replay)
  _advice(summary) {
    const s = this.session;
    if (s.free || s.players.length !== 1 || !summary.players[0]) return '';
    const me = summary.players[0];
    s.streak = me.place === 1 ? Math.max(1, (s.streak || 0) + 1) : me.lost ? Math.min(-1, (s.streak || 0) - 1) : 0;
    const i = DIFF_ORDER.indexOf(s.difficulty);
    let tip = '';
    if (s.streak >= 4 && i < DIFF_ORDER.length - 1) {
      const n = DIFFICULTY[DIFF_ORDER[i + 1]];
      tip = `¿Vas sobrado? En tu próxima partida prueba ${n.name.toUpperCase()}: premios ×${String(n.prize).replace('.', ',')}`;
    } else if (s.streak <= -2 && i > 0) {
      const n = DIFFICULTY[DIFF_ORDER[i - 1]];
      tip = `¿Muy difícil? En ${n.name.toUpperCase()} pierdes un crédito solo ${{ last: 'si llegas el último', ironman: 'si Ironman te gana', any: 'si alguien te gana' }[n.rule]}${(ASSIST_LEVELS[this.opt.assist] || 0) < 2 && isTouch() ? '. También ayuda la dirección asistida (Opciones)' : ''}`;
    }
    return tip;
  }

  // what this race paid, when it is not the plain ×1
  _multHTML(summary) {
    if (!summary || summary.mult == null || summary.mult === 1) return '';
    const d = this.session.diff;
    const as = summary.assist ? ` · DIRECCIÓN ASISTIDA ${summary.assist > 1 ? 'FUERTE' : 'SUAVE'} (−${summary.assist * 10} %)` : '';
    return `<div class="laprec mult">PREMIOS <b>×${String(summary.mult).replace('.', ',')}</b> · ${d.name.toUpperCase()}${as}</div>`;
  }
  _lapRecordHTML() {
    const tr = this.race && this.race.track;
    const rec = tr && lapRecord(lapKey(tr.id, tr.reverse));
    if (!rec) return '';
    const d = truckDef(rec.c);
    return `<div class="laprec">RÉCORD DE VUELTA <b>${fmtTime(rec.t)}</b>${d ? ` · ${VEHICLE_INFO[rec.v]?.name || 'CAMIÓN'} ${d.name.toUpperCase()}` : ''}${this.lapRecordSet ? ' · <b>¡NUEVO!</b>' : ''}</div>`;
  }
  _lostReason() {
    return { last: 'Has llegado el último', ironman: 'Ironman ha llegado antes que tú', any: 'Un camión de la CPU ha llegado antes que tú' }[this.session.diff.rule];
  }

  // ------------------------------------------------------------------ shop
  toShop(k) {
    const alive = this.session.players.filter((p) => p.alive);
    if (k >= alive.length) { this._fade(() => { this.ui.hide('shop'); this.view.setActive(null, null); this.stateTick = null; this.nextRace(); }); return; }
    const p = alive[k];
    this.state = 'shop';
    const def = truckDef(p.truckId);
    this.garage.setTruck(p.truckId, p.vehicle);
    this.garage.offsetX = innerHeight < 460 ? 330 : 210; // keep the truck clear of the (wider) phone panel
    this.view.setActive(this.garage.scene, this.garage.camera);
    this.stateTick = (dt) => this.garage.update(dt);
    this.audio.music('shop');
    const render = (focus = 0) => {
      const items = [
        ...UPGRADES.map((u) => {
          const lvl = p.upgrades[u.id], maxed = lvl >= MAX_LEVEL, cost = maxed ? 0 : UPGRADE_COST[lvl];
          return { k: u.id, nm: u.name, ds: u.desc, pr: maxed ? 'MÁX.' : fmtMoney(cost), lv: lvl, dis: maxed || p.money < cost, maxed };
        }),
        { k: 'nitro1', nm: 'Nitro ×1', ds: `Tienes ${p.nitros}. Un acelerón de 1,6 s.`, pr: fmtMoney(NITRO_COST), dis: p.money < NITRO_COST || p.nitros >= 99 },
        { k: 'nitro5', nm: 'Nitro ×5', ds: 'Para usarlo en cada recta.', pr: fmtMoney(NITRO_COST * 5), dis: p.money < NITRO_COST * 5 || p.nitros > 94 },
        { k: 'credit', nm: 'Cambiar crédito', ds: `Un crédito por ${fmtMoney(CREDIT_CASH)} (tienes ${p.credits}).`, pr: '+' + fmtMoney(CREDIT_CASH), dis: p.credits <= 1 },
        { k: 'done', nm: '¡A la siguiente carrera!', ds: '', pr: '', dis: false },
      ];
      const el = this.ui.show('shop', `
        <div class="panel fade-in" style="max-width:96vw;max-height:100%;overflow:auto">
          <div class="shop-head"><div><div class="muted" style="font-size:20px;letter-spacing:.2em">TALLER DE IRONMAN</div>
            <div class="who" style="color:${def.css}">${this.session.players.length > 1 ? (p.index + 1) + 'P · ' : ''}${VEHICLE_INFO[p.vehicle]?.name || 'CAMIÓN'} ${def.name.toUpperCase()}</div></div>
            <div style="text-align:right"><div class="muted" style="font-size:18px">DINERO</div><div class="cash">${fmtMoney(p.money)}</div></div></div>
          <div class="items">${items.map((it) => `
            <div class="item ${it.dis ? 'disabled' : ''} ${it.maxed ? 'maxed' : ''}" data-k="${it.k}">
              <div class="nm">${it.nm}</div><div class="pr">${it.pr}</div>
              <div class="ds">${it.ds}</div>
              <div class="lv">${it.lv != null ? Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < it.lv ? 'on' : ''}"></i>`).join('') : ''}</div>
            </div>`).join('')}</div>
        </div>`);
      const els = [...el.querySelectorAll('.item')];
      // allow focusing disabled items to read them, but not buying
      this.ui.navigate('shop', els, {
        start: Math.min(focus, els.length - 1),
        onOk: (i, it) => {
          const key = it.dataset.k;
          if (key === 'done') return this.toShop(k + 1);
          let ok = false;
          if (key === 'nitro1') ok = this.session.buyNitro(p, 1) > 0;
          else if (key === 'nitro5') ok = this.session.buyNitro(p, 5) > 0;
          else if (key === 'credit') ok = this.session.convertCredit(p);
          else ok = this.session.buyUpgrade(p, key);
          if (ok) this.audio.sfx('cash');
          render(i);
        },
        onBack: () => this.toShop(k + 1),
      }).allowDisabled = true;
    };
    render(0);
  }

  // ------------------------------------------------------------------ pause / options
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.audio.pause(true);
    this.touch.show(false); // the pad would cover the menu
    const el = this.ui.show('pause', `
      <div class="panel fade-in"><div class="head">PAUSA</div><div class="menu">
        <div class="btn" data-a="resume">CONTINUAR</div>
        <div class="btn" data-a="restart">REINICIAR CARRERA</div>
        <div class="btn" data-a="opts">OPCIONES</div>
        <div class="btn" data-a="quit">SALIR AL TÍTULO</div>
      </div></div>`);
    this.ui.navigate('pause', [...el.querySelectorAll('.btn')], {
      onOk: (i, b) => {
        const a = b.dataset.a;
        if (a === 'resume') this.resume();
        else if (a === 'restart') { this._fade(() => { this.resume(); this.nextRace(); }); }
        else if (a === 'opts') this.toOptions(() => { this.paused = false; this.pause(); });
        else if (a === 'quit') { this._fade(() => { this.resume(); this.toTitle(); }); }
      },
      onBack: () => this.resume(),
    });
  }
  resume() {
    this.paused = false;
    this.audio.pause(false);
    this.ui.hide('pause');
    this.ui.hide('options');
    if (this.state === 'race' || this.state === 'intro') this.touch.show(true);
    this.last = performance.now();
  }

  toOptions(back) {
    this.ui.hide('pause');
    const o = this.opt;
    const defs = [
      { k: 'quality', name: 'CALIDAD GRÁFICA', short: 'CALIDAD', vals: ['auto', 'low', 'medium', 'high'], lab: { auto: 'AUTO', low: 'BAJA', medium: 'MEDIA', high: 'ALTA' } },
      { k: 'camera', name: 'CÁMARA', vals: ['classic', 'zoom', 'follow'], lab: { classic: 'CLÁSICA', zoom: 'DINÁMICA', follow: 'PERSECUCIÓN' } },
      { k: 'music', name: 'MÚSICA', vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      { k: 'sfx', name: 'EFECTOS', vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      { k: 'voice', name: 'LOCUTOR', vals: [true, false], lab: { true: 'SÍ', false: 'NO' } },
      { k: 'haptics', name: 'VIBRACIÓN', vals: [true, false], lab: { true: 'SÍ', false: 'NO' } },
      ...(canFullscreen() ? [{ k: 'fullscreen', name: 'PANTALLA COMPLETA', short: 'P. COMPLETA', vals: [true, false], lab: { true: 'SÍ', false: 'NO' } }] : []),
      { k: 'touch', name: 'CONTROL TÁCTIL', short: 'TÁCTIL', vals: ['buttons', 'stick'], lab: { buttons: 'BOTONES', stick: 'JOYSTICK' } },
      ...(isTouch() ? [
        { k: 'touchSide', name: 'MANDOS', vals: ['right', 'left'], lab: { right: 'DIESTRO', left: 'ZURDO' } },
        { k: 'touchSize', name: 'TAMAÑO BOTONES', short: 'BOTONES', vals: ['s', 'm', 'l'], lab: { s: 'PEQUEÑO', m: 'NORMAL', l: 'GRANDE' } },
        { k: 'nitroPos', name: 'BOTÓN DE NITRO', short: 'NITRO', vals: ['both', 'gas', 'steer'], lab: { both: 'LOS DOS', gas: 'EN EL GAS', steer: 'EN EL GIRO' } },
      ] : []),
      { k: 'assist', name: 'DIRECCIÓN ASISTIDA', short: 'ASISTENCIA', vals: ['off', 'soft', 'strong'], lab: { off: 'NO', soft: 'SUAVE', strong: 'FUERTE' } },
      { k: 'autoGas', name: 'ACELERADOR AUTOMÁTICO', short: 'AUTO-GAS', vals: [false, true], lab: { true: 'SÍ', false: 'NO' } },
      { k: 'fps', name: 'MOSTRAR FPS', short: 'FPS', vals: [false, true], lab: { true: 'SÍ', false: 'NO' } },
    ];
    const qBefore = o.quality;
    const el = this.ui.show('options', `
      <div class="panel fade-in"><div class="head">OPCIONES</div><div class="menu cols2">
        ${defs.map((d) => `<div class="btn" data-k="${d.k}" data-opt><span class="ln">${d.name}</span><span class="sn">${d.short || d.name}</span> <span class="val"></span></div>`).join('')}
        <div class="btn primary" data-k="back">VOLVER</div>
      </div><div class="hint-keys"><span class="ohint"></span>${isTouch() ? 'Toca una opción para cambiarla' : '← → CAMBIAR'}</div></div>`);
    const paintHint = () => {
      const lvl = ASSIST_LEVELS[o.assist] || 0;
      el.querySelector('.ohint').textContent = lvl ? `Dirección asistida ${lvl > 1 ? 'fuerte' : 'suave'}: premios −${lvl * 10} %. ` : '';
    };
    paintHint();
    const paint = () => {
      defs.forEach((d) => {
        const v = o[d.k];
        el.querySelector(`[data-k=${d.k}] .val`).textContent = d.lab ? d.lab[String(v)] : String(v);
      });
      this.ui.fit(el); // the values can change the panel's size
    };
    paint();
    const change = (i, b, dir) => {
      const d = defs.find((x) => x.k === b.dataset.k);
      if (!d) return;
      const idx = d.vals.indexOf(o[d.k]);
      o[d.k] = d.vals[(idx + dir + d.vals.length) % d.vals.length];
      paint();
      this.saveOpt();
      this.audio.setVolumes(o);
      this.touch.setMode(o.touch);
      if (d.k === 'nitroPos' && this.touch.visible) { this.touch.show(false); this.touch.show(true); } // rebuild the pad
      this.touch.layout();
      if (d.k === 'camera' && this.race && this.state === 'race') this._raceCamera(false);
      if (d.k === 'fullscreen') { if (o.fullscreen) enterFullscreen(true); else exitFullscreen(); }
      if (d.k === 'assist') {
        // also in the middle of a race (pause menu); the prize follows the strongest level used
        const lvl = ASSIST_LEVELS[o.assist] || 0;
        for (const a of this.assists || []) if (a) a.level = lvl;
        if (this.race && !this.attract && this.race.state !== 'done') this.assistUsed = Math.max(this.assistUsed || 0, lvl);
        paintHint();
      }
    };
    const done = () => {
      this.ui.hide('options');
      if (o.quality !== qBefore) { this.ui.toast('Reiniciando para aplicar la calidad…', 'small', 1200); setTimeout(() => location.reload(), 900); return; }
      back();
    };
    this.ui.navigate('options', [...el.querySelectorAll('.btn')], {
      onOk: (i, b) => (b.dataset.k === 'back' ? done() : change(i, b, 1)),
      onLeft: (i, b) => change(i, b, -1), onRight: (i, b) => change(i, b, 1), onBack: done,
    });
  }

  toScores(back, hi = -1) {
    const el = this.ui.show('scores', `<div class="panel fade-in"><div class="head">MEJORES PILOTOS</div>${this._scoresHTML(hi)}<div class="menu" style="padding-top:0"><div class="btn primary">VOLVER</div></div></div>`);
    this.ui.navigate('scores', [el.querySelector('.btn')], { onOk: () => { this.ui.hide('scores'); back(); }, onBack: () => { this.ui.hide('scores'); back(); } });
  }

  toHelp(back) {
    const el = this.ui.show('help', `<div class="panel fade-in help-panel" data-min-scale="0.86"><div class="head">CÓMO SE JUEGA</div>
      <div class="help-body">
        <p>Carreras de 4 vueltas contra los camiones de la CPU. El gris es <b class="gold">Ivan "Ironman" Stewart</b>. Hay cuatro dificultades: en <b>Novato</b> solo pierdes un crédito si llegas el último; en <b>Piloto</b> y <b>Experto</b>, si Ironman te gana; en <b>Arcade</b> tienes que ganar a todos, como en la recreativa de 1989. Cuanto más difícil, más pagan las carreras. Sin créditos, se acaba la partida.</p>
        <p><b>Dirección asistida</b> (Opciones): <i>suave</i> corrige el volante antes de chocar con las vallas y <i>fuerte</i> te lleva por la trazada y levanta el pie antes de las curvas. Ayuda mucho en el móvil, a cambio de un 10 % o un 20 % menos de premio.</p>
        <p>Al acabar cada carrera puedes ver la <b>REPETICIÓN</b> con cámaras de televisión: el realizador automático no se pierde los saltos (a cámara lenta), los adelantamientos ni la meta. Elige cámara, camión y velocidad, salta por la línea de tiempo, y con el <b>MODO FOTO</b> congela la imagen, gira la cámara y guarda o comparte la foto.</p>
        <p><b>Teclado:</b> ← → girar · ↑ acelerar · ↓ frenar/marcha atrás · ENTER o ESPACIO nitro · ESC pausa.<br>
        <b>Mando:</b> stick o cruceta girar · A acelerar · B frenar · X/RB nitro · START pausa.<br>
        <b>Táctil:</b> botones de giro a la izquierda, acelerar y nitro a la derecha, y otro nitro encima del giro (en Opciones: zurdos, tamaño, qué nitros se ven o joystick).</p>
        <p>Recoge <b style="color:#79c2ff">nitros</b> y <b class="gold">bolsas de dinero</b> en la pista. Con el dinero mejora tu camión en el taller: neumáticos, amortiguadores, aceleración y velocidad punta (5 niveles cada uno), o compra más nitro.</p>
        <p>Puedes correr con el <b>camión</b> (más agarre y velocidad punta, gana los empujones) o con el <b>buggy</b> del <i>Track Pak</i> (acelera más y aterriza mejor los saltos, pero es ligero y derrapa más).</p>
        <p>Hay 16 circuitos (los 8 de la recreativa y los 8 del <i>Track Pak</i>), cada uno en los dos sentidos. En <b>CARRERA LIBRE</b> puedes probar cualquiera, con el sentido y la luz que quieras.</p>
        <p>En <b>CONTRARRELOJ</b> (Carrera libre → Modo) corres solo contra el <b>fantasma</b> de tu mejor tiempo en cada circuito. Pellizca la pista para acercar o alejar la cámara.</p>
        <p class="credits"><b>Créditos.</b> Remake de aficionado de <i>Ivan "Ironman" Stewart's Super Off Road</i> © 1989 Leland Corporation.
        Música: «Hotrock», «Exhilarate», «Cool Rock», «Ready Aim Fire», «Neolith» y «Twisted» de Kevin MacLeod (incompetech.com), licencia Creative Commons Atribución 4.0.
        Texturas de tierra: Poly Haven (CC0). Fuentes Russo One y Teko (SIL OFL). Locutor: Piper (voz en_US-ryan). Motor 3D: Three.js (MIT). Modelos 3D hechos con Blender.</p>
      </div><div class="menu" style="padding-top:0"><div class="btn primary">VOLVER</div></div></div>`);
    const body = el.querySelector('.help-body');
    this.ui.navigate('help', [el.querySelector('.btn')], {
      axis: 'h', // up/down scroll the text (keyboard, pad)
      onUp: () => body.scrollBy({ top: -90, behavior: 'smooth' }), onDown: () => body.scrollBy({ top: 90, behavior: 'smooth' }),
      onOk: () => { this.ui.hide('help'); back(); }, onBack: () => { this.ui.hide('help'); back(); },
    });
  }

  // ------------------------------------------------------------------ game over
  toGameOver() {
    this.state = 'gameover';
    this.ui.hideAll();
    this.hud.destroy();
    this.touch.show(false);
    this.audio.music('title');
    this.audio.announce('game_over');
    const best = this.session.players.slice().sort((a, b) => b.earned - a.earned);
    const queue = best.filter((p) => qualifies(p.earned) && p.earned > 0);
    const continueScreen = () => {
      const el = this.ui.show('gameover', `
        <div class="panel fade-in"><div class="head">FIN DE LA PARTIDA</div>
          <div class="verdict">${best.map((p) => `${this.session.players.length > 1 ? (p.index + 1) + 'P · ' : ''}Ganado: <span class="gold">${fmtMoney(p.earned)}</span> · ${this.session.raceNo} ${this.session.raceNo === 1 ? 'carrera' : 'carreras'}`).join('<br>')}</div>
          <div class="menu" style="padding-top:0">
            <div class="btn primary" data-a="cont">CONTINUAR (3 CRÉDITOS)</div>
            <div class="btn" data-a="end">TERMINAR</div>
          </div></div>`);
      this.ui.navigate('gameover', [...el.querySelectorAll('.btn')], {
        onOk: (i, b) => {
          if (b.dataset.a === 'cont') {
            for (const p of this.session.players) { p.alive = true; p.credits = 3; p.continued = true; }
            this._fade(() => { this.ui.hide('gameover'); this.toShop(0); });
          } else this._fade(() => { this.ui.hide('gameover'); this.toTitle(); });
        },
      });
    };
    const nextEntry = () => {
      const p = queue.shift();
      if (!p) return continueScreen();
      this.enterInitials(p, (name) => {
        const idx = addScore({ name, score: p.earned, races: this.session.raceNo, d: this.session.difficulty });
        this.toScores(() => nextEntry(), idx);
      });
    };
    nextEntry();
  }

  enterInitials(p, done) {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.'.split('');
    const name = [0, 0, 0];
    let pos = 0;
    const el = this.ui.show('initials', `
      <div class="panel fade-in"><div class="head">¡NUEVO RÉCORD! ${this.session.players.length > 1 ? (p.index + 1) + 'P' : ''}</div>
        <div class="verdict">Ganado: <span class="gold">${fmtMoney(p.earned)}</span><br><span class="muted">${isTouch() ? 'Toca las letras para cambiarlas' : '↑↓ letra · ← → posición · ENTER aceptar'}</span></div>
        <div class="initials"><span></span><span></span><span></span></div>
        <div class="menu" style="padding-top:0"><div class="btn primary">ACEPTAR</div></div></div>`);
    const spans = [...el.querySelectorAll('.initials span')];
    const paint = () => spans.forEach((s, i) => { s.textContent = letters[name[i]]; s.className = i === pos ? 'cur' : ''; });
    paint();
    spans.forEach((s, i) => s.addEventListener('pointerdown', (e) => { e.preventDefault(); pos = i; name[i] = (name[i] + 1) % letters.length; paint(); this.audio.ui('move'); }));
    const finish = () => { this.ui.hide('initials'); off(); done(name.map((i) => letters[i]).join('')); };
    const off = this.input.onUI((a) => {
      if (!this.ui.get('initials')) return;
      if (a === 'up') name[pos] = (name[pos] + 1) % letters.length;
      else if (a === 'down') name[pos] = (name[pos] - 1 + letters.length) % letters.length;
      else if (a === 'left') pos = Math.max(0, pos - 1);
      else if (a === 'right') pos = Math.min(2, pos + 1);
      else if (a === 'ok') { if (pos < 2) pos++; else return finish(); }
      paint();
      this.audio.ui('move');
    });
    el.querySelector('.btn').addEventListener('click', finish);
  }
}
