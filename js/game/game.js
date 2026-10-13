// Game flow: boot, attract mode, menus, championship races, results, the
// speed shop, pause, options, game over and high scores.

import * as THREE from 'three';
import { Scene3D } from '../render/scene.js';
import { RaceWorld } from '../render/world.js';
import { Garage } from '../render/garage.js';
import { Podium } from '../render/podium.js';
import { Race, COUNTDOWN, mine } from '../sim/race.js';
import { TRACKS, trackById, SEASON, SEASONS } from '../sim/tracks.js';
import { buildPath, buildTrack } from '../sim/track.js';
import { ellipsePoly } from '../sim/util.js';
import { Input } from '../core/input.js';
import { Haptics } from '../core/haptics.js';
import { UI, h, esc } from '../ui/ui.js';
import { ICONS, ACH_ICONS, CTRL_ICONS } from '../ui/icons.js';
import { Career, ACHIEVEMENTS } from './career.js';
import { LIVERIES, liveryById, paintOf } from './liveries.js';
import { dailyChallenge, dailyState, dailyResult } from './daily.js';
import { Tutorial } from './tutorial.js';
import { HUD, fmtTime } from '../ui/hud.js';
import { Touch } from '../ui/touch.js';
import { Audio } from '../audio/audio.js';
import { blockPageZoom, enterFullscreen, exitFullscreen, canFullscreen, needsHomeScreen, isIOS } from '../core/device.js';
import { TRUCKS, PLAYER_TRUCKS, truckDef } from './drivers.js';
import { lapKey, lapRecord, submitLap, loadLaps } from './records.js';
import { GhostRecorder, ghostKey, loadGhost, saveGhost, ghostTimes } from './ghost.js';
import { ReplayRecorder, quantize } from './replay.js';
import { ironmanRun, medalTimes, medalFor, medalRank, saveMedal, loadMedals, medalIcon, MEDALS, MEDAL_NAME } from './medals.js';
import { ReplayView } from './replayview.js';
import { SteerAssist, ASSIST_LEVELS } from '../sim/assist.js';
import {
  Session, UPGRADES, UPGRADE_COST, MAX_LEVEL, NITRO_COST, CREDIT_CASH, DIFFICULTY, DIFF_ORDER, CUP_SIZE, cupName,
  loadScores, qualifies, addScore, fmtMoney, saveRun, loadRun, clearRun,
} from './session.js';
import { VERSION } from '../version.js';
import { installNet, WORD } from './netgame.js';
import { VOICE_LINES } from '../audio/voicelines.js';
import { installPhotoFinish } from './photofinish.js';
import { LensDirt } from '../render/lens.js';

const DT = 1 / 120;
const COAST = { steer: 0, throttle: 0, brake: 0, nitro: false }; // a fourth player's place, on four phones
// a truck's colour from data that may have come from another phone: a colour or nothing
const cssOf = (c, truckId) => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : (truckDef(truckId) || truckDef('red')).css);
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
  // read back as an image: a CPU canvas (a GPU one would wait for the 3D frame)
  const g = c.getContext('2d', { willReadFrequently: true });
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

// The options a value must be one of. Saved options that are not (damaged, or from an
// older version) go back to their default instead of breaking the game.
const OPT_VALUES = {
  quality: ['auto', 'low', 'medium', 'high'], camera: ['classic', 'zoom', 'follow'], touch: ['buttons', 'stick', 'tilt'], touchSide: ['right', 'left'],
  touchSize: ['s', 'm', 'l'], nitroPos: ['both', 'gas', 'steer'], voice: ['es', 'en', false], assist: ['off', 'soft', 'strong'],
  pack: ['all', 'classic', 'pak'], vehicle: ['truck', 'buggy'], lastTruck: PLAYER_TRUCKS, netMode: ['champ', 'quick'],
};
const OPT_BOOL = ['autoGas', 'fps', 'haptics', 'fullscreen', 'guide', 'subs', 'cvd'];
const OPT_RANGE = { music: [0, 10, true], sfx: [0, 10, true], zoomLevel: [0.3, 1], followZoom: [0.6, 1.8] };

export class Game {
  constructor() {
    const defaults = {
      quality: 'auto', camera: isTouch() ? 'zoom' : 'classic', music: 7, sfx: 8, touch: 'buttons', touchSide: 'right', touchSize: 'm', nitroPos: 'both', autoGas: false, fps: false, voice: 'es', haptics: true, fullscreen: true,
      assist: isTouch() ? 'soft' : 'off', difficulty: 'normal', guide: true, subs: false, cvd: false,
    };
    this.opt = Object.assign({}, defaults, this._loadOpt());
    if (this.opt.voice === true) this.opt.voice = 'es'; // (before v0.70 the announcer was only on or off, in English)
    this._cleanOpt(defaults);
    if (!DIFFICULTY[this.opt.difficulty]) this.opt.difficulty = 'normal';
    if (ASSIST_LEVELS[this.opt.assist] == null) this.opt.assist = 'off';
    this.state = 'boot';
    this.warp = +(params.get('warp') || 1);
    this.paused = false;
    this.acc = 0;
    this.frameEvents = [];
    this.net = null; // a two-phone game (js/game/netgame.js)
  }
  _loadOpt() { try { const o = JSON.parse(localStorage.getItem(LS_OPT)); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } }
  // every saved option back within what the game understands
  _cleanOpt(defaults) {
    const o = this.opt;
    for (const [k, vals] of Object.entries(OPT_VALUES)) if (k in o && !vals.includes(o[k])) { if (k in defaults) o[k] = defaults[k]; else delete o[k]; }
    for (const k of OPT_BOOL) if (typeof o[k] !== 'boolean') o[k] = defaults[k];
    for (const [k, [lo, hi, int]] of Object.entries(OPT_RANGE)) {
      if (!(k in o)) continue;
      const v = o[k];
      if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi || (int && !Number.isInteger(v))) { if (k in defaults) o[k] = defaults[k]; else delete o[k]; }
    }
    if (o.liveries != null && !Array.isArray(o.liveries)) delete o.liveries;
    // COLOCAR BOTONES: only places with numbers that make sense
    const L = o.touchLayout;
    if (L != null && (typeof L !== 'object' || Array.isArray(L))) delete o.touchLayout;
    else if (L) {
      for (const [mode, M] of Object.entries(L)) {
        if (!['buttons', 'stick', 'tilt'].includes(mode) || !M || typeof M !== 'object') { delete L[mode]; continue; }
        for (const [slot, c] of Object.entries(M)) {
          const ok = c && [c.x, c.y].every((v) => typeof v === 'number' && v >= 0 && v <= 1) && typeof c.k === 'number' && c.k >= 0.5 && c.k <= 2;
          if (!ok) delete M[slot];
        }
      }
    }
  }
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
    this.audio.onsay = (key, lang, dur) => this._subtitle(key, lang, dur);
    this.ui = new UI(document.getElementById('ui'), this.input, (s) => {
      this.audio.ui(s);
      if ((s === 'ok' || s === 'back' || s === 'deny') && this.opt.haptics !== false && isTouch() && navigator.vibrate) { try { navigator.vibrate(s === 'deny' ? [8, 40, 8] : 8); } catch (e) { /* */ } }
    });
    this.hud = new HUD(this.ui);
    this.career = new Career((a) => this._achieved(a));
    this.touch = new Touch(this.input, this.opt);
    this.touch.camera = this.view.camera;
    this.touch.onPause = () => { if (this.state === 'race' || this.state === 'intro') (this.paused ? this.resume() : this.pause()); };
    this.touch.onNoTilt = (why) => {
      this.opt.touch = 'buttons'; this.saveOpt(); this.touch.setMode('buttons');
      // a permission the iPhone forgot shows up as a race starts: its banner says it
      if (why === 'perm') this._tiltNote = true;
      else this.ui.toast('Sin sensor de inclinación<br><span class="sub">Vuelvo a los botones</span>', 'small warn', 2200);
    };
    this.world = new RaceWorld(this.view);
    this.world.onThunder = () => this.audio.thunder();
    this.lens = new LensDirt();
    this._applyCvd();
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
      this.portraitsBuggy = this.garage.portraits([...PLAYER_TRUCKS, 'grey'], 'buggy'); // (grey: four players on four phones)
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
    document.addEventListener('pointerup', () => { if (this.state === 'intro' && !this.paused && this.introT != null && this.introT > 0.6) this._skipIntro(); });
    document.addEventListener('click', keepFull);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'race' && !this.paused) this.pause();
      if (document.hidden && this.replayView && this.replayView.playing) this.replayView.setPlaying(false);
      this.audio.suspend(document.hidden);
      if (!document.hidden && this.net) this._wake(true); // the browser lets the wake lock go when hidden
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
    this.startRace(id, params.get('rev') === '1', { skipIntro: true, time: params.get('time'), rain: params.get('rain') === '1' });
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
  // One frame of the game. An error anywhere in it is reported and the next frame comes
  // anyway: a page that stopped drawing would be the end of the game for the player.
  frame(now) {
    let go = true;
    try { go = this._frame(now) !== false; } catch (e) { this._frameError(e); }
    if (go) requestAnimationFrame((t) => this.frame(t));
  }
  _frameError(e) {
    // each different error once (one that repeats every frame would flood the console)
    const key = String((e && e.stack) || e).slice(0, 300);
    this._errSeen = this._errSeen || new Set();
    if (this._errSeen.has(key)) return;
    this._errSeen.add(key);
    console.error('[frame]', e);
  }
  _frame(now) {
    // rAF timestamps can be earlier than a performance.now() taken just before: never negative
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    this.input.update();
    this.touch.update(dt);
    this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; this._fpsShow(); }

    // a replay runs its own simulation (and its own clock: pause, slow motion)
    const rv = this.replayView ? this.replayView.frame(dt) : null;
    // a race off screen (behind the shop or the podium) waits: no sounds from it there
    const hidden = this.state === 'shop' || this.state === 'podium';
    if (!rv && this.race && !this.paused && !hidden) { if (this.race.shadow) this._guestFrame(dt); else this.stepRace(dt); }
    if (this.net) this._netPingTick(dt);
    if (this.photo) this._photoTick(dt);
    if (this.race && !hidden) {
      // (the photo finish: the world in slow motion too, still for the picture)
      const vdt = rv ? rv.dt : this.paused ? 0 : dt * this._photoK();
      this.world.update(vdt, rv ? rv.alpha : this.acc / DT);
      if (this.world.props && this.world.props.userData.update) this.world.props.userData.update(vdt, this.race);
      if (this.world.water && this.world.water.userData.update) this.world.water.userData.update(dt, this.world.terrain.userData.fieldTex);
      if (this.state === 'race' || this.state === 'intro') this.hud.update(dt, this.view.camera, this.world, this.state === 'intro');
      // mud and drops on the lens of the chase camera, on this device's truck
      // (not over the photo finish's picture)
      const chased = this.state === 'race' && !this.paused && !(this.photo && this.photo.shown) && this.world.camMode === 'follow' && this.race.racers[this.world.camOpts.index ?? 0];
      this.lens.update(dt, mine(chased) ? chased : null, this.race.racers);
      if (this.state === 'race') this.hud.countdown(this.race);
      this.audio.update(dt, this.race, this.view.camera, this.paused || this.attract || (this.state === 'intro' && this.introT < 1.5));
    }
    if (this.introT != null && !this.paused) this._introTick(dt);
    if (this.stateTick) this.stateTick(dt);
    if (this.attractTick) this.attractTick(dt);
    if (this.attract && this.attractCam) this.attractCam(dt);
    // a phone held upright only shows the "rotate" notice: no point drawing the 3D view
    // (?maxfps=N: tests running several browsers at once draw less often)
    const cap = +(params.get('maxfps') || 0);
    const draw = !cap || now - (this._drawn || 0) >= 1000 / cap;
    if (draw && !(this.portraitMQ && this.portraitMQ.matches && isTouch())) { this.view.render(dt); this._drawn = now; }
    // a new circuit built and drawn: the other phones can stop waiting for our silence
    if (draw && this._sendLoaded && --this._sendLoaded === 0 && this.net) this.net.send({ t: 'loaded' });
    if (this.testFrames && --this.testFrames <= 0) { window.__ready = true; this.testFrames = 0; window.__shotInfo = { fps: this.fps, build: this.world.buildMs }; return false; }
    return true;
  }

  stepRace(dt) {
    const race = this.race;
    if (this.state === 'intro' && this.introT < this.introHold) return; // race clock waits for the intro
    const warp = this.warp || 1;
    this.acc += dt * warp * this._photoK(); // the photo finish's slow motion
    let n = 0;
    this.frameEvents.length = 0;
    const inputs = [this.input.get(0), this.input.get(1), this.input.get(2), COAST];
    // a race on several phones: the other players' controls come from their phones
    if (this.net && this.net.role === 'host') for (let p = 1; p < 4; p++) { const ri = this.net.remoteInput(p); if (ri) inputs[p] = ri; }
    // touch "point to steer": convert a target heading into steering for player 1
    const p0 = inputs[0];
    if (p0.targetHeading != null && race) {
      const me = race.racers.find((r) => mine(r) && r.entry.player === 0);
      if (me) {
        let d = p0.targetHeading - me.truck.h;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        p0.steer = Math.max(-1, Math.min(1, d * 2.4));
      }
    }
    // what the simulation gets: the input after the steering assist, rounded to what the
    // replay stores (so the replay is exactly this race)
    const q = this._stepIn || (this._stepIn = [0, 1, 2, 3].map(() => ({ steer: 0, throttle: 0, brake: 0, nitro: false })));
    while (this.acc >= DT && n < 12 * warp) {
      this.world.savePrev();
      for (let p = 0; p < 4; p++) {
        const a = this.assists && this.assists[p];
        quantize(a && race.state === 'race' ? a.apply(DT, inputs[p]) : inputs[p], q[p]);
      }
      race.step(DT, q);
      if (this.replayRec && race === this.replayRec.live) this.replayRec.step(q, race);
      if (this.trial) this.trial.recorder.step(race);
      for (const ev of race.events) this.frameEvents.push(ev);
      this.input.consumeNitro();
      if (this.net) this.net.consumeNitro();
      this.acc -= DT; n++;
    }
    if (n >= 12 * warp) this.acc = 0;
    if (n) this._photoCheck(race);
    // the other phone gets the race as it is now and what happened in it (also while the
    // photo finish holds it still: an unchanged race, not silence)
    if ((n || this.photo) && this.net && this.net.role === 'host' && !this.attract) this.net.sendRace(race, this.frameEvents);
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
        if (this.raceLog && this.state === 'race' && ev[1] === this.raceLog.me.i) this._logEvent(ev);
      }
    }
    if (this.tutorial && this.state === 'race' && !this.paused) {
      const me = race.racers.find(mine);
      if (me) this.tutorial.update(dt, me, q[0]);
    }
    this._raceTick(race);
  }

  // every frame of a race, simulated here or drawn from the other phone's
  _raceTick(race) {
    // the announcer follows the lead (one player only: with several it would be noise)
    if (this.state === 'race' && !this.attract && race.state === 'race' && race.time > 4) {
      const humans = race.racers.filter(mine);
      const lead = race.order[0];
      if (humans.length === 1 && lead && lead !== this._leader) {
        if (this._leader) {
          if (mine(lead)) this.audio.announce('lead', true);
          else if (lead.entry.ironman && mine(this._leader)) this.audio.announce('ironman_lead', true);
        }
        this._leader = lead;
      }
    } else if (race.state === 'countdown') this._leader = null;
    // tilt steering: the way the phone is held just before the green light is straight ahead
    if (race.state === 'countdown' && race.time > -0.5 && !this._tiltCal && this.touch.mode === 'tilt') { this._tiltCal = true; this.touch.calibrate(); }
    if (race.state !== 'countdown') this._tiltCal = false;
    // last on the last lap (for the comeback achievement)
    const L = this.raceLog;
    if (L && this.state === 'race' && race.state === 'race' && !L.lastInFinal) {
      const me = L.me;
      if (!me.finished && me.lap === race.laps - 1 && me.pos === race.racers.length && race.racers.length > 1) L.lastInFinal = true;
    }
  }

  // a tap or OK during the fly-over: on to the race (both phones in a two-phone race)
  _skipIntro(fromOther = false) {
    if (this.state !== 'intro' || this.paused || this.introT == null || (!fromOther && this.introT <= 0.6)) return;
    if (this.net && this.net.role === 'guest') this.net.send({ t: 'skip' });
    this.introT = this.introHold;
  }

  _logEvent(ev) {
    const L = this.raceLog;
    if (ev[0] === 'nitro') L.nitro++;
    else if (ev[0] === 'wall' && ev[2] > 4) L.walls++;
    else if (ev[0] === 'land' && ev[3] > 0.35) this.career.jump(ev[3]);
  }

  // achievement unlocked: a banner in the corner, one after another
  _achieved(a) {
    (this._achQ = this._achQ || []).push(a);
    if (!this._achBusy) this._achNext();
  }
  _achNext() {
    const a = this._achQ.shift();
    if (!a) { this._achBusy = false; return; }
    this._achBusy = true;
    const el = h(`<div class="ach-toast"><i class="ic">${ACH_ICONS[a.icon] || ACH_ICONS.trophy}</i><div><small>LOGRO DESBLOQUEADO</small><b>${esc(a.name)}</b></div></div>`);
    if (this.state === 'race' || this.state === 'intro') el.classList.add('low'); // the scoreboard is at the top
    document.getElementById('ui').appendChild(el);
    this.audio.sfx('pickup', { vol: 0.5, vary: 0, rate: 0.8, ui: true });
    this.audio.sfx('cash', { vol: 0.35, vary: 0, ui: true });
    setTimeout(() => el.classList.add('out'), 3300);
    setTimeout(() => { el.remove(); this._achNext(); }, 3800);
  }

  // runs before the menus; return true to consume the action
  _globalUI(a, src) {
    const racing = this.state === 'race' || this.state === 'intro';
    if (racing && !this.paused && src === 'pad' && (a === 'back' || a === 'ok')) return true; // B brakes, A accelerates
    if (a === 'ok' && this.state === 'intro' && !this.paused && this.introT != null && this.introT > 0.6) { this._skipIntro(); return true; }
    if (racing && !this.paused && (a === 'pause' || a === 'back')) { this.pause(); return true; }
    if (racing && this.paused && a === 'pause') { this.resume(); return true; }
    if (a === 'mute') { this.audio.toggleMute(); this.ui.toast(this.audio.muted ? 'Sonido desactivado' : 'Sonido activado', 'small', 900); return true; }
    return false;
  }
  // the announcer's words at the bottom of the screen (option SUBTÍTULOS); null: away
  _subtitle(key, lang = 'es', dur = 1) {
    clearTimeout(this._subT);
    const el = this._subEl;
    if (!key || !this.opt.subs) { if (el) el.classList.remove('on'); return; }
    const lines = VOICE_LINES[lang] || VOICE_LINES.es;
    const text = key.startsWith('track_') ? `¡${(trackById(key.slice(6)) || {}).name || ''}!` : lines[key];
    if (!text) return;
    if (!el) { this._subEl = h('<div id="subs"><small>LOCUTOR</small><span></span></div>'); document.body.appendChild(this._subEl); }
    this._subEl.querySelector('span').textContent = text;
    this._subEl.classList.add('on');
    this._subT = setTimeout(() => this._subEl.classList.remove('on'), Math.max(1300, dur * 1000 + 900));
  }
  // option COLORES DALTONISMO: blue, yellow and orange where green and red say good and bad
  _applyCvd() {
    document.body.classList.toggle('cvd', !!this.opt.cvd);
    this.world.setPalette(this.opt.cvd ? 'cvd' : 'normal');
  }
  _fpsShow() {
    if (!this.opt.fps) { if (this.fpsEl) { this.fpsEl.remove(); this.fpsEl = null; } return; }
    if (!this.fpsEl) { this.fpsEl = h('<div style="position:fixed;left:8px;bottom:6px;z-index:40;font:16px monospace;color:#0f0;text-shadow:0 1px 2px #000"></div>'); document.body.appendChild(this.fpsEl); }
    this.fpsEl.textContent = `${Math.round(this.fps)} fps`;
  }

  // ------------------------------------------------------------------ races
  startRace(id, reverse, opts = {}) {
    // the other phones: a few busy seconds while a circuit is built and its first frames
    // drawn (also the demo race behind the menus, while they wait in a room)
    if (this.net) { this.net.send({ t: 'loading' }); this._sendLoaded = 3; }
    this._photoClear();
    const track = this.world.loadTrack(id, reverse, opts.time, !!opts.rain);
    this.audio.setRain(!!opts.rain);
    const bug = trackById(id).pak ? Math.floor(Math.random() * 3) : -1;
    const entries = this.attract
      ? TRUCKS.map((d, i) => ({ truckId: d.id, vehicle: i === bug ? 'buggy' : 'truck', name: d.cpu.name, short: d.cpu.short, ironman: !!d.cpu.ironman, ...this.session.cpuSetup(d), slot: i }))
      : this.session.entries();
    // a two-phone race: player 2 drives from the other phone (a human truck, shown here as a rival)
    if (this.net && !this.attract) for (const e of entries) if (e.human && e.player !== this.net.local) e.remote = true;
    this.input.solo = entries.filter((e) => e.human && !e.remote).length <= 1;
    for (let p = 0; p < 3; p++) this.input.autoGas[p] = !!this.opt.autoGas && p === 0;
    const seed = params.get('seed') ? +params.get('seed') : (Math.random() * 1e9) | 0;
    // time trial: alone, no pickups, 3 laps, against the ghost of the best run
    const trial = !this.attract && !!(this.session.free && this.session.free.trial);
    const daily = trial && this.session.free.daily;
    const tutorial = !this.attract && !!(this.session.free && this.session.free.tutorial);
    // (a quick race on several phones sets its own laps, like the time trials)
    const laps = opts.laps ?? (tutorial ? 9 : params.get('laps') ? +params.get('laps') : !this.attract && this.session.free && this.session.free.laps ? this.session.free.laps : trial ? 3 : undefined);
    const ropts = { seed, ...this.session.raceOpts(), laps, pickups: tutorial ? 'manual' : !trial, rain: !!opts.rain };
    this.race = new Race(track, entries, ropts);
    for (const r of this.race.racers) if (r.entry.remote) r.remote = true;
    this.race.autopilot = params.get('autopilot') === '1';
    this.lapRecordSet = false;
    this.race.autopilotSkill = params.get('apskill') ? +params.get('apskill') : 0.95;
    // the steering assist works on each player's input; the strongest level used in
    // the race sets the prize (it can be changed from the pause menu)
    this.assists = [];
    this.assistUsed = 0;
    this.replayRec = null;
    this.assistBy = [];
    if (!this.attract) {
      const lvl = ASSIST_LEVELS[this.opt.assist] || 0;
      // (the other phone's player brings their own choice: it sets their own prize)
      for (const r of this.race.racers) {
        if (!r.human) continue;
        const peer = r.remote && this.net.peerOf(r.entry.player);
        const l = r.remote ? ASSIST_LEVELS[peer && peer.prefs.assist] || 0 : lvl;
        this.assists[r.entry.player] = new SteerAssist(r.truck, track, l);
        this.assistBy[r.entry.player] = l;
      }
      this.assistUsed = lvl;
      // everything a replay needs: the recipe of the race and, step by step, the inputs
      this.replayRec = new ReplayRecorder(this.race, {
        track, entries, opts: ropts, autopilot: this.race.autopilot, autopilotSkill: this.race.autopilotSkill,
        meta: { id, reverse, trial, free: !!this.session.free, raceNo: this.session.raceNo },
      });
    }
    this.world.setRace(this.race);
    this._applyGuide();
    // what the career needs from this race (player 1's truck)
    const me1 = this.race.racers.find((r) => mine(r) && r.entry.player === 0);
    this.raceLog = !this.attract && me1 ? { me: me1, nitro: 0, walls: 0, lastInFinal: false } : null;
    this.trial = null;
    if (trial) {
      // other lap counts (tests) keep their own ghost; the daily challenge has one a day
      // (records in the wet are kept apart from the dry ones)
      const key = daily ? `daily-${daily}` : ghostKey(id, reverse) + (laps !== 3 ? `-${laps}` : '') + (ropts.rain ? '-wet' : '');
      const me = this.race.racers.find((r) => r.human);
      // Ironman's medal run, same vehicle, garage and nitros (computed while the screen is black)
      const iron = ironmanRun(track, me.entry.vehicle || 'truck', this.race.laps, me.entry.upgrades, me.entry.nitros ?? 10, ropts.rain);
      const got = loadMedals()[key];
      this.trial = { key, rec: loadGhost(key), recorder: new GhostRecorder(me), me, iron, medal: got ? got.m : null };
    }
    this.world.setGhosts(this.trial ? [{ g: this.trial.rec, kind: 'me' }, { g: this.trial.iron, kind: 'iron' }] : []);
    this.acc = 0;
    this.audio.startRace(this.race);
    if (this.attract) {
      this.world.setCamera('classic', { snap: true });
      return;
    }
    this.hud.trial = this.trial ? { rec: this.trial.rec, iron: this.trial.iron, medal: this.trial.medal } : null;
    this.hud.build(this.race, this.session);
    this._netHUD();
    this.world.refit(); // frame the arena below the board
    this.touch.root.classList.remove('intro');
    this._tiltNote = false;
    this.touch.show(this.race.racers.some(mine)); // a player out of credits only watches
    // the other phone builds the same race and draws what this one sends
    if (this.net && this.net.role === 'host') {
      const msg = { t: 'race', id, reverse, time: opts.time || null, rain: !!opts.rain, laps: this.race.laps, entries, sess: this.session.snapshot(), skipIntro: !!opts.skipIntro };
      this.net.raceMsg = msg; this.net.phaseMsg = null;
      this.net.send(msg);
    }
    const tiltNote = this._tiltNote ? 'INCLINAR NECESITA TU PERMISO: DE MOMENTO, BOTONES<br>VUELVE A ELEGIRLO EN OPCIONES → CONTROL TÁCTIL' : '';
    if (opts.skipIntro) {
      this.state = 'race'; this._raceCamera(true);
      if (tiltNote) this.ui.toast('INCLINAR necesita tu permiso<br><span class="sub">Vuelve a elegirlo en Opciones → Control táctil</span>', 'small warn', 3600);
      return;
    }
    this.tutorial = tutorial ? new Tutorial(this) : null;
    this._intro(id, reverse, opts, tutorial, tiltNote);
  }

  // the fly-over before a race, with the circuit's banner (on both phones of a two-phone race)
  _intro(id, reverse, opts, tutorial, tiltNote) {
    this.state = 'intro';
    this.introT = 0;
    this.introHold = 5.2;
    this.touch.root.classList.add('intro'); // the pad appears when the race camera takes over
    this.world.setCamera('intro', { duration: 5.0 });
    const def = trackById(id);
    const tr = this.trial;
    const C = this.session.cup;
    const F = this.session.free;
    this.ui.show('intro', `<div class="banner"><div class="race">${tutorial ? 'TUTORIAL' : tr ? 'CONTRARRELOJ' : F ? (F.quick ? 'CARRERA RÁPIDA' : 'CARRERA LIBRE') : `${cupName(C.no)} · CARRERA ${C.race + 1}/${CUP_SIZE}`}${def.pak ? ' · TRACK PAK' : ''}</div><div class="track">${esc(def.name)}</div>
      <div class="sub">${tutorial ? 'APRENDE LO BÁSICO EN UNA VUELTA' : `${opts.rain ? 'LLUVIA · ' : ''}${reverse ? 'SENTIDO INVERSO · ' : ''}${this.race.laps} ${this.race.laps === 1 ? 'VUELTA' : 'VUELTAS'} · ${tr ? (tr.rec ? `RÉCORD ${fmtTime(tr.rec.t)} · CON FANTASMA` : 'SIN RÉCORD AÚN') : F && F.cpu === false ? 'SIN CPU' : DIFFICULTY[this.session.difficulty].name.toUpperCase()}`}</div>
      ${tiltNote ? `<div class="howto no">${tiltNote}</div>` : this.session.raceNo === 0 && !this.session.free && (this.session.players.length === 1 || this.net) ? `<div class="howto">${this._controlsLine()}</div>` : ''}</div>`, 'passive');
    this.audio.music('race');
    this.audio.announce('track_' + id);
  }

  // the racing line ahead of the player (one player only: on a shared screen it would clutter)
  _applyGuide() {
    const humans = this.race ? this.race.racers.filter(mine) : [];
    const tut = this.session && this.session.free && this.session.free.tutorial; // the tutorial talks about the line
    this.world.setGuide(!this.attract && humans.length === 1 && (this.opt.guide !== false || tut) ? humans[0].i : -1);
  }

  // the announcer's calls on the player's own moments
  _callout(ev) {
    const r = this.race.racers[ev[1]];
    if (!mine(r) || this.race.racers.filter(mine).length !== 1) return;
    if (ev[0] === 'land' && this.world.camMode === 'follow') this.lens.land(Math.min(1, (ev[2] - 5) / 8)); // a hard landing splashes the lens
    if (ev[0] === 'land' && ev[3] > 0.68) this.audio.announce('big_air', true); // the longest jumps of the game last ~0.75 s
    else if (ev[0] === 'wrongway') this.audio.announce('wrong_way', true);
  }

  // a human lap: personal record for this circuit and direction?
  _lapDone(ev) {
    const r = this.race.racers[ev[1]];
    if (!mine(r) || this.race.autopilot) return;
    const key = lapKey(this.race.track.id, this.race.track.reverse);
    const prev = submitLap(key, ev[3], { v: r.entry.vehicle || 'truck', c: r.entry.truckId });
    if (prev === false) return;
    this.lapRecordSet = true;
    if (!prev) return; // first lap ever here: it becomes the record quietly
    const who = this.race.racers.filter(mine).length > 1 ? `${r.entry.player + 1}P ` : '';
    this.ui.toast(`${who}¡Récord de vuelta! ${fmtTime(ev[3])}`, 'money', 2400);
    this.audio.sfx('pickup', { vol: 0.6, vary: 0, rate: 1.25 });
    if (ev[0] === 'lap' && ev[2] !== this.race.laps - 1) this.audio.announce('lap_record', true);
  }

  // one line with the controls of the device in use (first race of a championship)
  _controlsLine() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
    if (isTouch() && !pads.length) {
      return this.opt.touch === 'stick' ? 'JOYSTICK: APUNTA Y ACELERA · NITRO: TURBO<br>PELLIZCA LA PISTA PARA ACERCAR O ALEJAR'
        : this.opt.touch === 'tilt' ? 'GIRA EL MÓVIL COMO UN VOLANTE · GAS · FRENO · NITRO<br>SUJÉTALO CÓMODO EN LA SALIDA: ESA ES LA POSICIÓN RECTA'
        : '◀ ▶ GIRAR · GAS · NITRO<br>PELLIZCA LA PISTA PARA ACERCAR O ALEJAR';
    }
    if (pads.length || this.input.lastDevice === 'pad') return 'STICK GIRAR · A ACELERAR · B FRENAR · X / RB NITRO · START PAUSA';
    return '← → GIRAR · ↑ ACELERAR · ↓ FRENAR · ESPACIO NITRO · RUEDA DEL RATÓN: ZOOM · ESC PAUSA';
  }

  // race camera from the options; multiplayer always uses the classic view
  _raceCamera(snap) {
    const humans = this.race.racers.filter(mine);
    const idx = Math.max(0, this.race.racers.findIndex(mine));
    const mode = humans.length !== 1 ? 'classic' : this.opt.camera;
    this.world.setCamera(mode === 'follow' ? 'follow' : mode === 'zoom' ? 'zoom' : 'classic',
      { snap, index: idx, zoom: mode === 'follow' ? (this.opt.followZoom ?? 1) : (this.opt.zoomLevel ?? 0.52) });
  }

  // Pinch (phones) or the mouse wheel: zoom the race camera. Zooming all the way out
  // of the close camera gives the classic view of the whole arena, and the other way.
  _zoomBy(f) {
    if (this.state !== 'race' || this.paused || !this.race || !isFinite(f)) return;
    const humans = this.race.racers.filter(mine);
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
        this.view.setTime(this.world.timeName || 'day', this.world.raining); // PMREM environment
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
      if (this.net && this.net.role === 'host') this.net.send({ t: 'introdone' });
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
    const summary = this.session.applyResults(this.race, { assist: this.net ? this.assistBy : this.assistUsed || 0 });
    summary.advice = this._advice(summary);
    this.lastSummary = summary;
    // the race has counted: leaving the game from here on goes on to the shop
    if (this._keepRun()) saveRun(this.session, 'shop', summary.cup && summary.cup.done ? summary.cup : null);
    // the other phone shows the same results
    if (this.net && this.net.role === 'host') {
      const msg = { t: 'done', summary, sess: this.session.snapshot() };
      this.net.phaseMsg = msg;
      this.net.send(msg);
    }
    const L = this.raceLog;
    if (L) {
      const me = L.me, sp = this.session.players[me.entry.player];
      this.career.race({
        place: me.place, finished: me.finished && !me.dnf, humans: this.race.racers.filter((r) => r.human).length,
        difficulty: this.session.difficulty, vehicle: me.entry.vehicle, night: this.world.timeName === 'night',
        nitro: L.nitro, walls: L.walls, bags: me.money, lastInFinal: L.lastInFinal, track: this.race.track.id,
        km: me.prog / 1000, streak: sp ? sp.streak : 0, free: !!this.session.free,
      });
      for (const p of this.session.players) if (!this.net || p.index === this.net.local) this.career.score(p.earned);
    }
    this.stateTick = this._delay(2.2, () => this.showResults(summary));
    const winner = this.race.finishOrder[0];
    this.world.setCamera('tv', { index: winner.i });
    this.audio.announce(mine(winner) ? 'winner' : 'race_over');
    // fireworks over the stadium
    this.fireworksT = 4;
  }

  // ------------------------------------------------------------------ time trial
  _trialDone() {
    const T = this.trial, me = T.me, prev = T.rec;
    const done = me.finished && !me.dnf;
    let saved = false;
    if (done) {
      saved = saveGhost(T.key, { t: me.finishTime, laps: T.laps || [], v: me.entry.vehicle || 'truck', c: me.entry.truckId, l: me.entry.livery, at: Date.now(), s: T.recorder.s });
      // the medal of this run, kept if it is better than the one already won here
      T.got = medalFor(me.finishTime, T.iron && T.iron.t);
      T.newMedal = saveMedal(T.key, T.got, me.finishTime, me.entry.vehicle || 'truck');
      this.career.trial({ medal: T.got, golds: this._golds() });
      if (this.session.free.daily) {
        T.daily = dailyResult(this.session.free.daily, me.finishTime, T.got);
        this.career.daily({ medal: T.got, medals: T.daily.medals });
      }
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
    // the three medal times (Ironman's run sets them) and the one won
    const mt = T.iron ? medalTimes(T.iron.t) : null;
    const got = T.got || null, bestEver = medalRank(T.medal) > medalRank(got) ? T.medal : got;
    const medalsRow = mt ? `<div class="medals">${MEDALS.slice().reverse().map((m) => `<div class="mt${m === got ? ' got' : ''}${medalRank(m) <= medalRank(bestEver) ? ' won' : ''}">${medalIcon(m)}<span>${MEDAL_NAME[m]}</span><b>${fmtTime(mt[m])}</b></div>`).join('')}</div>` : '';
    const medalLine = !done || !mt ? ''
      : got ? `<div class="medal-msg ${got}">${medalIcon(got, 'big')}¡MEDALLA DE ${MEDAL_NAME[got]}!${got === 'gold' ? ' Le has ganado a Ironman' : ` · el ${MEDAL_NAME[MEDALS[medalRank(got) + 1]].toLowerCase()} está a ${(me.finishTime - mt[MEDALS[medalRank(got) + 1]]).toFixed(2)} s`}</div>`
      : `<div class="medal-msg none">Sin medalla · el bronce está a ${(me.finishTime - mt.bronze).toFixed(2)} s</div>`;
    const el = this.ui.show('results', `
      <div class="panel fade-in" style="max-width:96vw">
        <div class="head">${this.session.free.daily ? 'DESAFÍO DEL DÍA' : 'CONTRARRELOJ'} · ${esc(def.name).toUpperCase()}${this.session.free.reverse ? ' (INVERSO)' : ''}</div>
        ${T.daily && T.daily.streak > 1 && T.daily.newDay ? `<div class="laprec advice">¡${T.daily.streak} DÍAS SEGUIDOS CON MEDALLA!</div>` : ''}
        ${medalsRow}
        <div class="table trial" style="padding:4px 18px 8px">
          <div class="hd">VUELTA</div><div class="hd">TIEMPO</div><div class="hd">VS. RÉCORD</div>
          ${rows}
        </div>
        <div class="verdict">${medalLine}${verdict}</div>
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

  // back to the menus with the attract race running behind (the caller shows the next
  // screen; until then this is the menus, not a race: ESC must not pause anything)
  toTitleQuiet() {
    this.state = 'menu';
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
    if (this.net) this.netLeave(true);
    this.tutorial = null;
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
    this.startRace(id, rev, { laps: 3, rain: Math.random() < 0.2 });
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
      <div class="foot"><span>1-4 JUGADORES</span><span>16 CIRCUITOS · 32 CONFIGURACIONES</span><span>RÉCORD ${fmtMoney(loadScores()[0].score)}</span></div>
      <div class="ver">v${VERSION}</div>`);
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
    const run = loadRun();
    const el = this.ui.show('menu', `
      <div class="panel fade-in">
        <div class="head">SUPER OFF ROAD</div>
        <div class="menu cols2">
          ${run ? `<div class="btn primary cont-btn" data-a="cont"><span>CONTINUAR</span><small>${this._runLine(run)}</small></div>` : ''}
          <div class="btn" data-a="p1">1 JUGADOR</div>
          <div class="btn" data-a="p2">2 JUGADORES</div>
          <div class="btn" data-a="p3">3 JUGADORES</div>
          <div class="btn" data-a="p4">4 JUGADORES</div>
          <div class="btn" data-a="free">CARRERA LIBRE</div>
          <div class="btn gold-btn" data-a="daily">DESAFÍO DEL DÍA</div>
          <div class="btn" data-a="pack" data-opt>CIRCUITOS <span class="val"></span></div>
          <div class="btn" data-a="opts">OPCIONES</div>
          <div class="btn" data-a="scores">RÉCORDS</div>
          <div class="btn" data-a="ach">LOGROS <span class="val">${this.career.count}/${ACHIEVEMENTS.length}</span></div>
          <div class="btn" data-a="help">CÓMO SE JUEGA</div>
          ${this.installPrompt ? '<div class="btn gold-btn" data-a="install">INSTALAR JUEGO</div>' : ''}
        </div>
        <div class="hint-keys">${isTouch() ? '' : '↑↓ ELEGIR · ENTER ACEPTAR · ESC VOLVER'}</div>
        <div class="ver">v${VERSION}</div>
      </div>`);
    const items = [...el.querySelectorAll('.btn')];
    const packs = ['all', 'classic', 'pak'], packName = { all: 'TODOS (16)', classic: 'ORIGINALES (8)', pak: 'TRACK PAK (8)' };
    let pack = this.opt.pack || 'all';
    const paintPack = () => { el.querySelector('[data-a=pack] .val').textContent = packName[pack]; };
    paintPack();
    const cyclePack = (d) => { pack = packs[(packs.indexOf(pack) + d + packs.length) % packs.length]; this.opt.pack = pack; this.saveOpt(); paintPack(); };
    // a new championship (the first time, the tutorial is offered before it)
    const fresh = (n) => (n === 1 && !this.opt.tutorialDone && !this.opt.tutorialAsked && this.career.stats.races === 0 ? this._tutorAsk() : this.toDifficulty(n));
    this.ui.navigate('menu', items, {
      onOk: (i, b) => {
        const a = b.dataset.a;
        if (a === 'cont') this.continueRun();
        else if (a === 'p2' || a === 'p3') { const n = +a[1]; this.toMultiPlayers(n, () => (run ? this._newRunAsk(run, () => fresh(n)) : fresh(n))); }
        else if (a === 'p4') { this.ui.hide('menu'); this.toNetMenu(4); } // four: only on four phones
        else if (a === 'p1') { if (run) this._newRunAsk(run, () => fresh(1)); else fresh(1); }
        else if (a === 'free') { this.ui.hide('menu'); this.toFreeRace(); }
        else if (a === 'daily') this.toDaily();
        else if (a === 'pack') cyclePack(1);
        else if (a === 'opts') this.toOptions(() => this.toMenu());
        else if (a === 'scores') this.toScores(() => this.toMenu());
        else if (a === 'ach') this.toAchievements(() => this.toMenu());
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

  // ------------------------------------------------------------------ saved championship
  // only a championship on this device is kept (not a single race, nor a two-phone game)
  _keepRun() { return !this.attract && !!this.session && !this.session.free && !this.session.net && this.session.players.length > 0; }

  // what a saved championship is: the next race of its cup and the level
  _runLine(run) {
    const s = run.session, n = s.players.length;
    return `${cupName(s.cup.no)} · CARRERA ${s.cup.race + 1}/${CUP_SIZE} · ${s.diff.name.toUpperCase()}${n > 1 ? ` · ${n}P` : ''}`;
  }

  // back to the championship left half way: the race that was being run starts again
  // from the grid; after a race that already counted, on to the shop (the podium first
  // if that race closed a cup, game over if the last credit went in it)
  continueRun() {
    const run = loadRun();
    if (!run) { this.toMenu(); return; }
    this._fade(() => {
      this.ui.hideAll();
      this.attract = false;
      this.attractTick = null;
      this.freeSetup = null;
      this.tutorial = null;
      this.session = run.session;
      if (run.at === 'race') return this.nextRace();
      this.audio.stopRace(); // the demo race behind the menus
      const go = () => {
        for (const p of this.session.players) if (p.alive && p.credits <= 0) this.session.eliminate(p.index);
        if (this.session.over) return this.toGameOver();
        this.toShop(0);
      };
      if (run.podium) this.toPodium(run.podium, go); else go();
    });
  }

  // a new championship would replace the saved one: ask first
  _newRunAsk(run, fresh) {
    this.ui.hide('menu');
    const s = run.session, solo = s.players.length === 1;
    const money = s.players.map((p) => `${solo ? '' : `${p.index + 1}P `}<span class="gold">${fmtMoney(p.earned)}</span>`).join(' · ');
    const el = this.ui.show('newrun', `<div class="panel fade-in"><div class="head">PARTIDA GUARDADA</div>
      <div class="verdict">Tienes un campeonato a medias:<br><b>${this._runLine(run)}</b><br>${money}${solo ? ` ganados · ${s.players[0].credits} ${s.players[0].credits === 1 ? 'crédito' : 'créditos'}` : ''}<br><span class="muted">Si empiezas otro, se borrará.</span></div>
      <div class="menu row-menu" style="padding-top:0"><div class="btn primary" data-a="cont">CONTINUAR</div><div class="btn" data-a="new">EMPEZAR OTRO</div><div class="btn" data-a="back">VOLVER</div></div></div>`);
    const back = () => { this.ui.hide('newrun'); this.toMenu(); };
    this.ui.navigate('newrun', [...el.querySelectorAll('.btn')], {
      axis: 'h',
      onOk: (i, b) => {
        if (b.dataset.a === 'back') return back();
        this.ui.hide('newrun');
        if (b.dataset.a === 'cont') this.continueRun(); else fresh();
      },
      onBack: back,
    });
  }

  // Championship difficulty, as modern racing games present it: four cards with what
  // each level means (rivals, when a credit is lost, what it pays)
  toDifficulty(n) {
    this.ui.hide('menu');
    const rule = { last: 'si llegas el último', ironman: 'si Ironman te gana', any: 'si cualquier rival te gana' };
    const power = { easy: 1, normal: 2, hard: 4, arcade: 5 };
    const rivals = { easy: 'Te esperan', normal: 'Se adaptan', hard: 'Aprietan', arcade: 'Implacables' };
    const assist = ASSIST_LEVELS[this.opt.assist] || 0;
    const full = n >= 4; // four players fill the grid: no CPU, so no Ironman to beat
    const el = this.ui.show('diff', `
      <div class="panel fade-in" style="max-width:min(1180px,98vw)">
        <div class="head">ELIGE LA DIFICULTAD <span class="gold" style="font-size:.6em">· ${n} ${n > 1 ? 'JUGADORES' : 'JUGADOR'}${this.net ? ` · EN ${WORD[n] || n} MÓVILES` : ''}</span></div>
        <div class="dcards">${DIFF_ORDER.map((k) => {
          const d = DIFFICULTY[k];
          return `<div class="dcard d-${k}" data-k="${k}">
            ${k === 'normal' ? '<div class="tag">RECOMENDADO</div>' : ''}
            <div class="dpips">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= power[k] ? 'on' : ''}"></i>`).join('')}</div>
            <div class="nm">${d.name.toUpperCase()}</div>
            <div class="ds">${d.desc}</div>
            <div class="facts">
              <div class="rule">Pierdes un crédito ${full ? rule.last : rule[d.rule]}</div>
              <div><span>Rivales</span><b>${full ? 'Sin CPU' : rivals[k]}</b></div>
              <div><span>Premios</span><b class="gold">×${String(d.prize).replace('.', ',')}</b></div>
            </div>
          </div>`;
        }).join('')}</div>
        <div class="hint-keys">${full ? 'Cuatro jugadores: sin camiones de la CPU, el nivel solo cambia los premios.<br>' : ''}${assist ? `Dirección asistida ${assist > 1 ? 'fuerte (premios −20 %)' : 'suave (premios −10 %)'}: cámbiala en Opciones.` : 'Sin dirección asistida: cámbiala en Opciones si juegas en el móvil.'}${isTouch() ? '' : '<br>← → ELEGIR · ENTER ACEPTAR · ESC VOLVER'}</div>
      </div>`);
    const cards = [...el.querySelectorAll('.dcard')];
    this.ui.navigate('diff', cards, {
      axis: 'h', start: Math.max(0, DIFF_ORDER.indexOf(this.opt.difficulty || 'normal')),
      onOk: (i, c) => {
        const k = c.dataset.k;
        this.opt.difficulty = k; this.saveOpt();
        this.ui.hide('diff');
        if (this.net) {
          this.toSelect(1, k, {
            title: 'JUGADOR 1: ELIGE TU VEHÍCULO', trucks: this._netTrucks(), done: (pick) => this._netHostPicked(pick, k),
            back: () => { this.net.send({ t: 'lobby', p: 'diff' }); this.toDifficulty(1 + this.net.guests.length); },
          });
        } else this.toSelect(n, k);
      },
      onBack: () => { this.ui.hide('diff'); if (this.net) this._netModePick(); else this.toMenu(); },
    });
  }

  // o (a game on several phones): taken (picks made on the other phones), title, trucks
  // (the ones to choose from), done(pick), back()
  toSelect(n, diff, o = {}) {
    this.ui.hide('menu');
    const picks = (o.taken || []).filter(Boolean).slice();
    const first = picks.length;
    if (first) n = first + 1;
    let vehicle = this.opt.vehicle === 'buggy' ? 'buggy' : 'truck';
    const ask = () => {
      const p = picks.length;
      const el = this.ui.show('select', `
        <div class="panel fade-in" style="max-width:96vw">
          <div class="head">${o.title || `${n > 1 ? `JUGADOR ${p + 1}: ` : ''}ELIGE TU VEHÍCULO`}</div>
          <div class="vpick">
            <div class="vtabs">${Object.keys(VEHICLE_INFO).map((v) => `<div class="vtab" data-v="${v}">${VEHICLE_INFO[v].name}</div>`).join('')}</div>
            <div class="vstats"></div>
          </div>
          <div class="cards${(o.trucks || PLAYER_TRUCKS).length > 3 ? ' four' : ''}" style="padding:0 18px">
            ${(o.trucks || PLAYER_TRUCKS).map((id) => {
              const d = truckDef(id), taken = picks.findIndex((q) => q.truckId === id);
              return `<div class="card ${taken >= 0 ? 'disabled taken' : ''}" data-id="${id}">
                ${taken >= 0 ? `<div class="tag">${taken + 1}P</div>` : ''}
                ${this.portraits && this.portraits[id] ? '<div class="pic"></div>' : `<div class="sw" style="background:${d.css}">${d.number}</div>`}
                <div class="nm">${d.name.toUpperCase()}</div>
                <div class="who">${taken >= 0 ? 'Elegido' : d.cpu.ironman ? 'El de Ironman' : 'Rival: ' + esc(d.cpu.name)}</div></div>`;
            }).join('')}
          </div>
          <div class="hint-keys">${isTouch() ? 'Toca CAMIÓN o BUGGY para cambiar de vehículo' : '← → COLOR · ↑ ↓ CAMIÓN / BUGGY · ENTER ACEPTAR'}<br>${(o.trucks || PLAYER_TRUCKS).includes('grey') ? 'Con cuatro jugadores, hasta el camión gris de Ironman tiene piloto.' : 'El camión gris es siempre de Ivan "Ironman" Stewart.'}${n > 1 && !o.done ? '<br>' + this._controlsHint(p) : ''}</div>
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
          if (o.done) return o.done(picks[picks.length - 1]);
          if (picks.length < n) ask();
          else if (this.freeSetup) this.startFreeRace(picks[0]);
          else this.startChampionship(picks, diff);
        },
        onBack: () => {
          if (picks.length > first) { picks.pop(); ask(); return; }
          // (o.back() false: the screen stays, e.g. the first of two backs that leave a game)
          if (o.back) { if (o.back() !== false) this.ui.hide('select'); return; }
          this.ui.hide('select');
          if (this.freeSetup) this.toFreeRace(); else this.toDifficulty(n);
        },
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
      this.session = new Session(picks.map((q, i) => ({ truckId: q.truckId, vehicle: q.vehicle, livery: q.livery || this._livery(i) })), diff, this.opt.pack || 'all');
      if (this.net) { this.session.net = true; this.net.started = true; }
      if (params.get('credits')) for (const p of this.session.players) p.credits = +params.get('credits');
      this.nextRace();
    });
  }

  nextRace() {
    this.ui.hideAll();
    // a championship is saved before each race: leaving during it, the race starts again
    if (this._keepRun()) saveRun(this.session, 'race');
    const { id, reverse, time, rain } = this.session.currentTrack();
    this.stateTick = null;
    this.startRace(id, reverse, { time, rain });
  }

  // ------------------------------------------------------------------ tutorial
  _tutorAsk() {
    this.ui.hide('menu');
    this.opt.tutorialAsked = true; this.saveOpt();
    const el = this.ui.show('ask', `<div class="panel fade-in"><div class="head">¿PRIMERA VEZ?</div>
      <div class="verdict">Aprende lo básico en una vuelta guiada:<br>acelerar, girar, frenar, nitro y objetos.</div>
      <div class="menu row-menu" style="padding-top:0"><div class="btn primary" data-a="go">HACER EL TUTORIAL</div><div class="btn" data-a="skip">IR A CORRER</div></div></div>`);
    this.ui.navigate('ask', [...el.querySelectorAll('.btn')], {
      onOk: (i, b) => { this.ui.hide('ask'); if (b.dataset.a === 'go') this.startTutorial(); else this.toDifficulty(1); },
      onBack: () => { this.ui.hide('ask'); this.toMenu(); },
    });
  }

  startTutorial() {
    this._fade(() => {
      this.ui.hideAll();
      this.attract = false;
      this.attractTick = null;
      this.freeSetup = null;
      this.session = new Session([{ truckId: this.opt.lastTruck || 'red', vehicle: this.opt.vehicle === 'buggy' ? 'buggy' : 'truck', livery: this._livery(0) }], 'easy', 'all', { id: 'fandango', reverse: false, time: 'day', tutorial: true });
      this.session.players[0].upgrades = { tires: 2, shocks: 2, accel: 2, speed: 2 };
      this.nextRace();
    });
  }

  // after the guided lap: straight on to choosing a difficulty (asking first if that
  // would replace a saved championship)
  endTutorial() {
    if (!this.tutorial) return;
    this._fade(() => {
      this.tutorial = null;
      this.ui.hide('tutor');
      this.toTitleQuiet();
      const run = loadRun();
      if (run) this._newRunAsk(run, () => this.toDifficulty(1)); else this.toDifficulty(1);
    });
  }

  // ------------------------------------------------------------------ daily challenge
  toDaily() {
    this.ui.hide('menu');
    const c = dailyChallenge(), st = dailyState(c.key);
    const timeName = { day: 'DE DÍA', sunset: 'AL ATARDECER', night: 'DE NOCHE' };
    const truckId = this.opt.lastTruck || 'red';
    const best = st.best;
    // Ironman's time for today's conditions (garage level 2 like every time trial), kept for the day
    let ironT = null;
    const ironKey = c.key + (c.rain ? '-wet' : '');
    try { const k = JSON.parse(localStorage.getItem('sor.daily.iron') || 'null'); if (k && k.key === ironKey) ironT = k.t; } catch (e) { /* */ }
    const medalsRow = (t) => { const mt = medalTimes(t); return `<div class="medals">${MEDALS.slice().reverse().map((m) => `<div class="mt${best && medalRank(best.m) >= medalRank(m) ? ' won' : ''}">${medalIcon(m)}<span>${MEDAL_NAME[m]}</span><b>${fmtTime(mt[m])}</b></div>`).join('')}</div>`; };
    const el = this.ui.show('daily', `
      <div class="panel fade-in daily-panel">
        <div class="head">DESAFÍO DEL DÍA <span class="gold" style="font-size:.6em">· ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}</span></div>
        <div class="daily-body">
          <img src="${this._thumb(c.id)}" alt="" class="daily-map">
          <div class="daily-info">
            <div class="daily-track">${esc(c.name).toUpperCase()}</div>
            <div class="chips"><span>${c.reverse ? 'SENTIDO INVERSO' : 'SENTIDO NORMAL'}</span><span>${timeName[c.time]}${c.rain ? ' · LLUVIA' : ''}</span><span>${VEHICLE_INFO[c.vehicle].name}</span><span class="mod">${c.mod.name}</span></div>
            <div class="daily-medals">${ironT ? medalsRow(ironT) : '<div class="muted" style="padding:8px 0">Calculando los tiempos de Ironman…</div>'}</div>
            <div class="daily-me">${best ? `TU MEJOR HOY <b>${fmtTime(best.t)}</b>${best.m ? ' · ' + medalIcon(best.m) + MEDAL_NAME[best.m] : ''}` : 'Aún no lo has corrido hoy'}${st.streak > 0 ? ` · RACHA <b>${st.streak} ${st.streak === 1 ? 'DÍA' : 'DÍAS'}</b>` : ''}</div>
          </div>
        </div>
        <div class="menu row-menu" style="padding-top:2px"><div class="btn primary" data-a="go">¡A CORRER!</div><div class="btn" data-a="back">VOLVER</div></div>
      </div>`);
    if (!ironT) {
      // building the circuit and running Ironman takes a moment: in a worker, so the
      // screen stays alive (or here, after the screen is up, where workers are missing)
      const done = (t) => {
        if (!t) return;
        try { localStorage.setItem('sor.daily.iron', JSON.stringify({ key: ironKey, t })); } catch (e) { /* */ }
        const box = el.isConnected && el.querySelector('.daily-medals');
        if (box) { box.innerHTML = medalsRow(t); this.ui.fit(el); }
      };
      const here = () => setTimeout(() => { const run = ironmanRun(buildTrack(trackById(c.id), { reverse: c.reverse }), c.vehicle, c.laps, undefined, c.nitros, c.rain); done(run && run.t); }, 60);
      try {
        const w = new Worker(new URL('./ironworker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => { done(e.data && e.data.t); w.terminate(); };
        w.onerror = () => { w.terminate(); here(); };
        w.postMessage({ id: c.id, reverse: c.reverse, vehicle: c.vehicle, laps: c.laps, nitros: c.nitros, rain: c.rain });
      } catch (e) { here(); }
    }
    const back = () => { this.ui.hide('daily'); this.toMenu(); };
    this.ui.navigate('daily', [...el.querySelectorAll('.btn')], {
      onOk: (i, b) => {
        if (b.dataset.a === 'back') return back();
        this.freeSetup = { id: c.id, reverse: c.reverse, time: c.time, trial: true, daily: c.key, laps: c.laps, nitros: c.nitros, rain: c.rain };
        this.startFreeRace({ truckId, vehicle: c.vehicle });
      },
      onBack: back,
    });
  }

  // ------------------------------------------------------------------ free race
  toFreeRace() {
    this.state = 'free';
    const sel = this.freeSetup || { id: 'fandango', reverse: false, time: 'auto', trial: false };
    if (!DIFFICULTY[sel.diff]) sel.diff = DIFFICULTY[this.opt.freeDiff] ? this.opt.freeDiff : this.opt.difficulty || 'normal';
    this.freeSetup = sel;
    const cycleDiff = (d) => { sel.diff = DIFF_ORDER[(DIFF_ORDER.indexOf(sel.diff) + d + DIFF_ORDER.length) % DIFF_ORDER.length]; this.opt.freeDiff = sel.diff; this.saveOpt(); };
    const times = ['auto', 'day', 'sunset', 'night'], timeName = { auto: 'DEL CIRCUITO', day: 'DÍA', sunset: 'ATARDECER', night: 'NOCHE' };
    const thumbs = Object.fromEntries(TRACKS.map((d) => [d.id, this._thumb(d.id)]));
    let first = true; // (only the first one fades in: a change of option repaints it at once)
    const render = (focusId) => {
      // cards show the best lap (race) or the best run with its ghost (time trial)
      const recs = loadLaps(), runs = ghostTimes(), medals = loadMedals();
      const rec = (d) => {
        if (sel.trial) {
          const k = ghostKey(d.id, sel.reverse), t = runs[k], m = medals[k];
          return t ? `${m ? medalIcon(m.m) : ''}${fmtTime(t)}` : 'SIN TIEMPO';
        }
        const r = recs[lapKey(d.id, sel.reverse)]; return r ? 'MEJOR ' + fmtTime(r.t) : '&nbsp;';
      };
      const el = this.ui.show('free', `
        <div class="panel${first ? ' fade-in' : ''}" style="max-width:min(1100px,98vw);max-height:100%;overflow:auto">
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
            <div class="btn" data-a="rain" data-opt>CLIMA <span class="val">${sel.rain ? 'LLUVIA' : 'SECO'}</span></div>
            <div class="btn primary" data-a="go">ELEGIR VEHÍCULO</div>
          </div>
        </div>`);
      first = false;
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
          else if (e.dataset.a === 'rain') { sel.rain = !sel.rain; render('rain'); }
          else if (e.dataset.a === 'go') { this.ui.hide('free'); this.toSelect(1, sel.diff); }
        },
        onRight: (i, e) => {
          if (e.dataset.a === 'mode') { sel.trial = !sel.trial; render('mode'); }
          else if (e.dataset.a === 'rivals') { cycleDiff(1); render('rivals'); }
          else if (e.dataset.a === 'dir') { sel.reverse = !sel.reverse; render('dir'); }
          else if (e.dataset.a === 'time') { sel.time = times[(times.indexOf(sel.time) + 1) % times.length]; render('time'); }
          else if (e.dataset.a === 'rain') { sel.rain = !sel.rain; render('rain'); }
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
      if (focusId === 'dir' || focusId === 'time' || focusId === 'mode' || focusId === 'rivals' || focusId === 'rain') { const k = all.findIndex((e) => e.dataset.a === focusId); if (k >= 0) this.ui.nav.focus(k, true); }
    };
    render();
  }

  startFreeRace(pick) {
    const f = this.freeSetup;
    this._fade(() => {
      this.ui.hideAll();
      this.attract = false;
      this.attractTick = null;
      this.session = new Session([{ truckId: pick.truckId, vehicle: pick.vehicle, livery: this._livery(0) }], f.diff || 'normal', 'all', { id: f.id, reverse: f.reverse, time: f.time === 'auto' ? null : f.time, trial: !!f.trial, daily: f.daily || null, laps: f.laps, rain: !!f.rain });
      const p = this.session.players[0];
      p.upgrades = { tires: 2, shocks: 2, accel: 2, speed: 2 };
      if (f.nitros != null) p.nitros = f.nitros;
      this.opt.lastTruck = pick.truckId; this.saveOpt();
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
    const net = this.net, me = (r) => r.human && (!net || r.player === net.local); // this phone's row
    // a single race pays nothing that lasts: the gap to the winner instead of the prize
    const single = !!this.session.free, wt = rows[0] && rows[0].time;
    const gapTo = (r) => (r.place === 1 || !r.time || !wt ? '—' : '+' + (r.time - wt).toFixed(2).replace('.', ','));
    const html = `
      <div class="panel fade-in" style="max-width:96vw">
        <div class="head">${this.session.free ? `${this.session.free.quick ? 'CARRERA RÁPIDA' : 'CARRERA LIBRE'} · ${esc(trackById(this.session.free.id).name).toUpperCase()}` : summary.cup ? `${esc(summary.cup.name)} · CARRERA ${summary.cup.race | 0}/${summary.cup.of | 0}` : `RESULTADOS · CARRERA ${(summary.raceNo | 0) + 1}`}</div>
        <div class="table" style="padding:4px 18px 8px">
          <div class="hd">POS</div><div class="hd">PILOTO</div><div class="hd">TIEMPO</div><div class="hd">MEJOR</div><div class="hd">${single ? 'DIF.' : 'PREMIO'}</div>
          ${rows.map((r) => {
            const d = { css: cssOf(r.css, r.truckId) }, pl = summary.players.find((x) => x.place === r.place && r.human);
            const fast = r.bestLap && r.bestLap === fastest;
            return `<div class="place ${me(r) ? 'me' : ''}">${r.place}º</div>
              <div class="${me(r) ? 'me' : ''}"><span class="chip" style="background:${d.css}"></span>${esc(r.name)}</div>
              <div class="${me(r) ? 'me' : ''}">${r.time ? fmtTime(r.time) : '—'}</div>
              <div class="${me(r) ? 'me' : ''}${fast ? ' fast' : ''}">${r.bestLap ? fmtTime(r.bestLap) : '—'}</div>
              ${single ? `<div class="${me(r) ? 'me' : 'muted'}">${gapTo(r)}</div>` : `<div class="${me(r) ? 'me gold' : r.human ? 'gold' : 'muted'}">${pl ? fmtMoney(pl.prize + pl.bags) : ''}</div>`}`;
          }).join('')}
        </div>
        ${this._cupHTML(summary)}${this._lapRecordHTML()}${this.session.free ? '' : this._multHTML(summary)}${summary.advice ? `<div class="laprec advice">${esc(summary.advice)}</div>` : ''}
        <div class="verdict">${this.session.free ? summary.players.filter((p) => !net || p.index === net.local).map((p) => `<div class="${p.place === 1 ? 'ok' : ''}"><span class="big">${p.place === 1 ? '¡Victoria!' : p.place + 'º puesto'}</span></div>`).join('') : summary.players.map((p) => {
          const pl = this.session.players[p.index];
          const tag = net ? (p.index === net.local ? 'TÚ · ' : `${p.index + 1}P · `) : this.session.players.length > 1 ? `${p.index + 1}P · ` : '';
          if (p.lost) return `<div class="bad"><span class="big">${tag}${p.credits > 0 ? '¡Pierdes un crédito!' : '¡Sin créditos!'}</span><br>${this._lostReason(summary.rule)} · Te ${p.credits === 1 ? 'queda 1 crédito' : `quedan ${p.credits} créditos`}</div>`;
          return `<div class="ok"><span class="big">${tag}${p.place === 1 ? '¡Victoria!' : 'Sigues en carrera'}</span><br>Premio ${fmtMoney(p.prize)}${p.bags ? ` + bolsas ${fmtMoney(p.bags)}` : ''} · Créditos ${p.credits}</div>`;
        }).join('')}</div>
        <div class="menu row-menu" style="padding-top:0">${this.session.free && net
          // a quick race on several phones: the rematch when everyone is ready; player 1 can change circuit
          ? `<div class="btn primary" data-a="again">REVANCHA</div>${net.role === 'host' ? `<div class="btn" data-a="other">OTRO CIRCUITO</div>${this._replayBtn()}` : ''}<div class="btn" data-a="quit">SALIR</div>`
          : this.session.free
          ? `<div class="btn primary" data-a="again">CORRER OTRA VEZ</div>${this._replayBtn()}<div class="btn" data-a="other">OTRO CIRCUITO</div><div class="btn" data-a="menu">MENÚ PRINCIPAL</div>`
          : `<div class="btn primary" data-a="cont">CONTINUAR</div>${this._replayBtn()}`}</div>
      </div>`;
    const free = !!this.session.free;
    const el = this.ui.show('results', html);
    this.audio.music('results');
    this._resultsAgain = () => this.showResults(summary);
    if (free && net) {
      this.ui.navigate('results', [...el.querySelectorAll('.btn')], {
        onOk: (i, b) => {
          const a = b.dataset.a;
          if (a === 'replay') { if (net.ready.again) net.ready.again.delete(0); return this.toReplay(); } // (not ready while watching it)
          if (a === 'quit') return this._netQuit();
          if (a === 'other') { net.ready.again = null; this.ui.hide('results'); return this._netQuickSetup(true); }
          if (a === 'again' && !b.classList.contains('waiting')) this._netReady('again', b);
        },
      });
      return;
    }
    if (free) {
      this.ui.navigate('results', [...el.querySelectorAll('.btn')], {
        onOk: (i, b) => {
          if (b.dataset.a === 'replay') return this.toReplay();
          this._fade(() => {
            this.ui.hide('results');
            // (a game that was on several phones goes on with player 1 alone)
            if (b.dataset.a === 'again') { const s = this.session; s.raceNo = 6; for (const p of s.players) if (!s.solo || p.index === 0) { p.credits = 3; p.alive = true; } this.nextRace(); }
            else if (b.dataset.a === 'other') { this.toTitleQuiet(); this.toFreeRace(); }
            else this.toTitle();
          });
        },
      });
      return;
    }
    // two phones: both press CONTINUAR, then the host decides what comes next
    const next = net ? () => this._netReady('results', el.querySelector('[data-a=cont]')) : () => this._fade(() => {
      this.ui.hide('results');
      const go = () => {
        // players without credits are out
        for (const p of summary.players) if (p.credits <= 0) this.session.eliminate(p.index);
        if (this.session.over) return this.toGameOver();
        this.toShop(0);
      };
      // the last race of a cup: the podium first
      if (summary.cup && summary.cup.done && !summary.cup.shown) { summary.cup.shown = true; this.toPodium(summary.cup, go); } else go();
    });
    this.ui.navigate('results', [...el.querySelectorAll('.btn')], { onOk: (i, b) => (b.dataset.a === 'replay' ? this.toReplay() : next()), onBack: next });
  }
  // the cup standings under the race results
  _cupHTML(summary) {
    const c = summary.cup;
    if (!c) return '';
    const solo = this.session.players.length === 1;
    const nm = (x) => (x.human ? (solo ? 'TÚ' : `${x.player + 1}P`) : (x.short || x.name));
    return `<div class="cupstand"><span class="cn">${c.done ? 'FINAL DE LA COPA' : 'COPA'}</span>${c.standings.map((x, i) => `<span class="cs${x.human ? ' me' : ''}"><i style="background:${cssOf(x.css, x.truckId)}"></i>${i + 1}º ${esc(nm(x))} <b>${x.points | 0}</b></span>`).join('')}</div>`;
  }

  // The end of a cup: the three best on the podium, the trophy and the bonus
  toPodium(cup, then) {
    this.ui.hideAll();
    this.hud.destroy();
    this.touch.show(false);
    this.state = 'podium';
    this.audio.stopRace();
    if (this.net) { this.net.send({ t: 'loading' }); this._sendLoaded = 3; } // a new scene to draw (busy a moment)
    if (!this.podium) this.podium = new Podium(this.view, this.world.templates);
    const st = cup.standings, solo = this.session.players.length === 1;
    const isMe = (x) => x.human && (!this.net || x.player === this.net.local); // this phone's player
    const nm = (x) => (x.human ? (solo || (this.net && isMe(x)) ? 'TÚ' : `JUGADOR ${x.player + 1}`) : x.name);
    const winner = st[0];
    this.podium.setup(st.slice(0, 3), cup.name, winner.human ? (solo || (this.net && isMe(winner)) ? '¡CAMPEÓN DE LA COPA!' : `¡${nm(winner)} GANA LA COPA!`) : `${(winner.short || winner.name).toUpperCase()} GANA LA COPA`);
    this.view.setActive(this.podium.scene, this.podium.camera);
    this.stateTick = (dt) => this.podium.update(dt);
    this.audio.music('title');
    this.audio.sfx('horn', { vol: 0.6, vary: 0 });
    this.audio.announce(isMe(winner) ? 'winner' : 'race_over');
    this.career.cup(isMe(winner));
    if (this._keepRun()) saveRun(this.session, 'shop'); // seen: continuing from here goes on to the shop
    const medal = ['gold', 'silver', 'bronze'];
    const ours = st.map((x, i) => ({ x, i })).filter((o) => o.x.human);
    const verdict = ours.map(({ x, i }) => {
      const who = solo ? '' : this.net && isMe(x) ? 'TÚ · ' : `${x.player + 1}P · `;
      return i < 3 ? `<div class="cup-won ${medal[i]}"><i class="ic">${ACH_ICONS.cup}</i><div><b>${who}${['¡CAMPEÓN!', 'SUBCAMPEÓN', 'TERCER PUESTO'][i]}</b><span>Premio de la copa ${fmtMoney(x.bonus || 0)}</span></div></div>`
        : `<div class="cup-won none"><div><b>${who}${i + 1}º EN LA COPA</b><span>Sin premio esta vez</span></div></div>`;
    }).join('');
    const el = this.ui.show('podium', `
      <div class="panel fade-in podium-panel">
        <div class="head">${esc(cup.name)}</div>
        ${verdict}
        <div class="table cup">${st.map((x, i) => `<div class="place ${isMe(x) ? 'me' : ''}">${i + 1}º</div><div class="${isMe(x) ? 'me' : ''}"><span class="chip" style="background:${cssOf(x.css, x.truckId)}"></span>${esc(nm(x))}</div><div class="${isMe(x) ? 'me' : ''} pts">${x.points | 0} PTS</div>`).join('')}</div>
        <div class="menu" style="padding-top:4px"><div class="btn primary">CONTINUAR</div></div>
      </div>`);
    const done = () => this._fade(() => {
      if (this._podiumOff) this._podiumOff();
      this.ui.hide('podium');
      this.view.setActive(null, null);
      this.stateTick = null;
      this.state = 'results';
      then();
    });
    this.ui.navigate('podium', [el.querySelector('.btn')], { onOk: done, onBack: done });
    // the panel comes in after a moment (CSS delay): the 3D shot makes room for it
    const measure = () => { const r = el.querySelector('.panel').getBoundingClientRect(); this.podium.panel = Math.min(0.62, (innerWidth - r.left + 8) / innerWidth); };
    requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    this._podiumOff = () => window.removeEventListener('resize', measure);
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
    this.career.replay();
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
    // (a two-phone race: this phone's player's own multiplier)
    const own = this.net && summary && summary.players.find((p) => p.index === this.net.local);
    const mult = own ? own.mult : summary && summary.mult, assist = own ? own.assist : summary && summary.assist;
    if (mult == null || mult === 1) return '';
    const d = this.session.diff;
    const as = assist ? ` · DIRECCIÓN ASISTIDA ${assist > 1 ? 'FUERTE' : 'SUAVE'} (−${assist * 10} %)` : '';
    return `<div class="laprec mult">PREMIOS <b>×${String(mult).replace('.', ',')}</b> · ${d.name.toUpperCase()}${as}</div>`;
  }
  _lapRecordHTML() {
    const tr = this.race && this.race.track;
    const rec = tr && lapRecord(lapKey(tr.id, tr.reverse));
    if (!rec) return '';
    const d = truckDef(rec.c);
    return `<div class="laprec">RÉCORD DE VUELTA <b>${fmtTime(rec.t)}</b>${d ? ` · ${VEHICLE_INFO[rec.v]?.name || 'CAMIÓN'} ${d.name.toUpperCase()}` : ''}${this.lapRecordSet ? ' · <b>¡NUEVO!</b>' : ''}</div>`;
  }
  _lostReason(rule) {
    return { last: 'Has llegado el último', ironman: 'Ironman ha llegado antes que tú', any: 'Un camión de la CPU ha llegado antes que tú' }[rule || this.session.diff.rule];
  }

  // ------------------------------------------------------------------ shop
  toShop(k) {
    const net = this.net;
    const alive = this.session.players.filter((p) => p.alive);
    if (!net && k >= alive.length) { this._fade(() => { this.ui.hide('shop'); this.view.setActive(null, null); this.stateTick = null; this.nextRace(); }); return; }
    // several phones: each one shops for its own player, at the same time (a guest's
    // copy of the championship is replaced after every purchase: read it afresh)
    let p = net ? this.session.players[net.local] : alive[k];
    this.state = 'shop';
    this.audio.stopRace();
    if (net) { net.send({ t: 'loading' }); this._sendLoaded = 3; } // the garage to draw (busy a moment)
    this._shopWaiting = false;
    if (net && (!p || !p.alive)) {
      this._netWait('SIN CRÉDITOS', 'Ahora miras las carreras. El otro jugador está en el taller…');
      this._netReadySend('shop');
      return;
    }
    const def = truckDef(p.truckId);
    this.garage.setTruck(p.truckId, p.vehicle, p.livery);
    this.garage.offsetX = innerHeight < 460 ? 330 : 210; // keep the truck clear of the (wider) phone panel
    this.view.setActive(this.garage.scene, this.garage.camera);
    this.stateTick = (dt) => this.garage.update(dt);
    this.audio.music('shop');
    const render = (focus = 0) => {
      if (net) p = this.session.players[net.local];
      if (this._keepRun()) saveRun(this.session, 'shop'); // each purchase is kept
      const items = [
        ...UPGRADES.map((u) => {
          const lvl = p.upgrades[u.id], maxed = lvl >= MAX_LEVEL, cost = maxed ? 0 : UPGRADE_COST[lvl];
          return { k: u.id, nm: u.name, ds: u.desc, pr: maxed ? 'MÁX.' : fmtMoney(cost), lv: lvl, dis: maxed || p.money < cost, maxed };
        }),
        { k: 'nitro1', nm: 'Nitro ×1', ds: `Tienes ${p.nitros}. Un acelerón de 1,6 s.`, pr: fmtMoney(NITRO_COST), dis: p.money < NITRO_COST || p.nitros >= 99 },
        { k: 'nitro5', nm: 'Nitro ×5', ds: 'Para usarlo en cada recta.', pr: fmtMoney(NITRO_COST * 5), dis: p.money < NITRO_COST * 5 || p.nitros > 94 },
        { k: 'credit', nm: 'Cambiar crédito', ds: `Un crédito por ${fmtMoney(CREDIT_CASH)} (tienes ${p.credits}).`, pr: '+' + fmtMoney(CREDIT_CASH), dis: p.credits <= 1 },
        { k: 'paint', nm: 'Pintura', ds: `${liveryById(p.livery).name} · ${LIVERIES.filter((l) => !l.unlock || this.career.has(l.unlock)).length} de ${LIVERIES.length} conseguidas.`, pr: liveryById(p.livery).name.toUpperCase(), dis: false },
        { k: 'done', nm: '¡A la siguiente carrera!', ds: '', pr: '', dis: false },
      ];
      const el = this.ui.show('shop', `
        <div class="panel fade-in" style="max-width:96vw;max-height:100%;overflow:auto">
          <div class="shop-head"><div><div class="muted" style="font-size:20px;letter-spacing:.2em">TALLER DE IRONMAN</div>
            <div class="who" style="color:${def.css}">${this.session.players.length > 1 ? (p.index + 1) + 'P · ' : ''}${VEHICLE_INFO[p.vehicle]?.name || 'CAMIÓN'} ${def.name.toUpperCase()}</div></div>
            <div style="text-align:right"><div class="muted" style="font-size:18px">DINERO</div><div class="cash">${fmtMoney(p.money)}</div></div></div>
          <div class="items">${items.map((it) => `
            <div class="item ${it.dis || (this._shopWaiting && it.k !== 'done') ? 'disabled' : ''} ${it.maxed ? 'maxed' : ''}" data-k="${it.k}">
              <div class="nm">${it.nm}</div><div class="pr">${it.pr}</div>
              <div class="ds">${it.ds}</div>
              <div class="lv">${it.lv != null ? Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < it.lv ? 'on' : ''}"></i>`).join('') : ''}</div>
            </div>`).join('')}</div>
        </div>`);
      const els = [...el.querySelectorAll('.item')];
      const done = el.querySelector('[data-k=done]');
      if (this._shopWaiting) { done.classList.add('waiting'); done.innerHTML = '<div class="nm"><i class="spin"></i>Esperando al otro jugador…</div>'; }
      this._shopRender = render;
      // allow focusing disabled items to read them, but not buying
      this.ui.navigate('shop', els, {
        start: Math.min(focus, els.length - 1),
        onOk: (i, it) => {
          const key = it.dataset.k;
          if (this._shopWaiting) return;
          if (key === 'done') { if (net) { this._shopWaiting = true; render(i); this._netReadySend('shop'); return; } return this.toShop(k + 1); }
          if (key === 'paint') return this._paintShop(p, () => render(i));
          // player 2's money lives on player 1's phone: it buys there and sends back the result
          if (net && net.role === 'guest') { this._shopFocus = i; net.send({ t: 'buy', key }); return; }
          let ok = false;
          if (key === 'nitro1') ok = this.session.buyNitro(p, 1) > 0;
          else if (key === 'nitro5') ok = this.session.buyNitro(p, 5) > 0;
          else if (key === 'credit') ok = this.session.convertCredit(p);
          else ok = this.session.buyUpgrade(p, key);
          if (ok) this.audio.sfx('cash');
          if (ok && UPGRADES.every((u) => p.upgrades[u.id] >= MAX_LEVEL)) this.career.maxed();
          render(i);
        },
        onBack: () => { if (!net) this.toShop(k + 1); },
      }).allowDisabled = true;
    };
    render(0);
  }

  // the mini map of a circuit (made the first time it is needed)
  _thumb(id) {
    this._thumbs = this._thumbs || {};
    return this._thumbs[id] || (this._thumbs[id] = trackThumb(trackById(id)));
  }

  // gold medals on the circuits (the daily challenges have their own)
  _golds() { return Object.entries(loadMedals()).filter(([k, m]) => !k.startsWith('daily-') && m.m === 'gold').length; }

  // the paint job of player i (kept between games)
  _livery(i) {
    const id = (this.opt.liveries || [])[i] || 'team', l = liveryById(id);
    return !l.unlock || this.career.has(l.unlock) ? l.id : 'team';
  }

  // Ironman's paint shop: the truck on the turntable shows each paint job as it is
  // picked; the locked ones say which achievement wins them
  _paintShop(p, back) {
    const ok = (l) => !l.unlock || this.career.has(l.unlock);
    const name = (id) => (ACHIEVEMENTS.find((a) => a.id === id) || {}).name || '';
    this.ui.hide('shop');
    const el = this.ui.show('paint', `
      <div class="panel fade-in paint-panel">
        <div class="shop-head"><div><div class="muted" style="font-size:20px;letter-spacing:.2em">PINTURA</div>
          <div class="who" data-k="nm"></div></div><div class="pdesc" data-k="ds"></div></div>
        <div class="swatches">${LIVERIES.map((l) => {
          const d = paintOf(p.truckId, l.id);
          return `<div class="sw-l${ok(l) ? '' : ' locked'}${l.id === p.livery ? ' cur' : ''}" data-id="${l.id}"><i style="--c:#${d.color.toString(16).padStart(6, '0')};--a:#${d.accent.toString(16).padStart(6, '0')}" class="fin-${d.finish}"></i><span>${l.name}</span></div>`;
        }).join('')}</div>
        <div class="menu" style="padding-top:2px"><div class="btn primary" data-k="back">LISTO</div></div>
      </div>`);
    const sw = [...el.querySelectorAll('.sw-l')];
    const show = (id) => {
      const l = liveryById(id);
      el.querySelector('[data-k=nm]').textContent = l.name.toUpperCase();
      el.querySelector('[data-k=ds]').textContent = ok(l) ? (l.id === p.livery ? 'Tu pintura' : 'Toca para pintar el camión') : `Se gana con el logro «${name(l.unlock)}»`;
      this.garage.setTruck(p.truckId, p.vehicle, id); // preview on the turntable
    };
    const close = () => { this.ui.hide('paint'); this.garage.setTruck(p.truckId, p.vehicle, p.livery); back(); };
    show(p.livery);
    this.ui.navigate('paint', [...sw, el.querySelector('[data-k=back]')], {
      start: Math.max(0, LIVERIES.findIndex((l) => l.id === p.livery)), grid: 4,
      onFocus: (i) => { if (sw[i]) show(sw[i].dataset.id); },
      onOk: (i, b) => {
        if (b.dataset.k === 'back') return close();
        const l = liveryById(b.dataset.id);
        if (!ok(l)) { this.audio.ui('deny'); this.ui.toast(`Se gana con «${name(l.unlock)}»`, 'small', 1600); return; }
        p.livery = l.id;
        const all = (this.opt.liveries || ['team', 'team', 'team']).slice();
        all[this.net ? 0 : p.index] = l.id; this.opt.liveries = all; this.saveOpt();
        if (this.net && this.net.role === 'guest') this.net.send({ t: 'paint', livery: l.id });
        sw.forEach((x) => x.classList.toggle('cur', x === b));
        this.audio.sfx('cash');
        show(l.id);
      },
      onBack: close,
    }).allowDisabled = true;
  }

  // ------------------------------------------------------------------ pause / options
  // a two-phone race stops on both phones: remote, the other one paused it (note: why)
  pause(remote = false, note = '') {
    if (this.paused) return;
    this.paused = true;
    this.audio.pause(true);
    this.touch.show(false); // the pad would cover the menu
    const net = this.net;
    if (net && !remote) net.send({ t: 'pause' });
    const msg = note || (remote ? 'El otro jugador ha parado la carrera.' : '');
    const el = this.ui.show('pause', `
      <div class="panel fade-in"><div class="head">PAUSA</div>${msg ? `<div class="nethelp">${msg}</div>` : ''}<div class="menu">
        <div class="btn" data-a="resume">CONTINUAR</div>
        ${!net || net.role === 'host' ? '<div class="btn" data-a="restart">REINICIAR CARRERA</div>' : ''}
        <div class="btn" data-a="opts">OPCIONES</div>
        <div class="btn" data-a="quit">${net ? 'SALIR DE LA PARTIDA' : this.session.free ? 'SALIR AL TÍTULO' : 'GUARDAR Y SALIR'}</div>
      </div></div>`);
    this.ui.navigate('pause', [...el.querySelectorAll('.btn')], {
      onOk: (i, b) => {
        const a = b.dataset.a;
        if (a === 'resume') this.resume();
        else if (a === 'restart') { this._fade(() => { this.resume(); this.nextRace(); }); }
        else if (a === 'opts') this.toOptions(() => { this.paused = false; this.pause(); });
        else if (a === 'quit') { this._fade(() => { this.resume(true); this.toTitle(); }); } // a championship stays saved: CONTINUAR
      },
      onBack: () => this.resume(),
    });
  }
  resume(remote = false) {
    if (this.net && this.paused && !remote) this.net.send({ t: 'resume' });
    this.paused = false;
    this._stallPause = false;
    this.audio.pause(false);
    // (another phone can resume the race while this one is in the options)
    if (this.touch.editing) { this.touch.edit(false); this.touch.onchange = null; this.saveOpt(); }
    this.ui.hide('pause');
    this.ui.hide('ctrlpick');
    this.ui.hide('padedit');
    this.ui.hide('options');
    if ((this.state === 'race' || this.state === 'intro') && this.race) this.touch.show(this.race.racers.some(mine)); // a player out of credits only watches
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
      { k: 'voice', name: 'LOCUTOR', vals: ['es', 'en', false], lab: { es: 'ESPAÑOL', en: 'INGLÉS', false: 'NO' } },
      { k: 'subs', name: 'SUBTÍTULOS', vals: [false, true], lab: { true: 'SÍ', false: 'NO' } },
      { k: 'haptics', name: 'VIBRACIÓN', vals: [true, false], lab: { true: 'SÍ', false: 'NO' } },
      ...(canFullscreen() ? [{ k: 'fullscreen', name: 'PANTALLA COMPLETA', short: 'P. COMPLETA', vals: [true, false], lab: { true: 'SÍ', false: 'NO' } }] : []),
      { k: 'touch', name: 'CONTROL TÁCTIL', short: 'TÁCTIL', pick: true, vals: ['buttons', 'stick', 'tilt'], lab: { buttons: 'BOTONES', stick: 'JOYSTICK', tilt: 'INCLINAR' } },
      ...(isTouch() ? [
        { k: 'touchSide', name: 'MANDOS', vals: ['right', 'left'], lab: { right: 'DIESTRO', left: 'ZURDO' } },
        { k: 'touchSize', name: 'TAMAÑO BOTONES', short: 'BOTONES', vals: ['s', 'm', 'l'], lab: { s: 'PEQUEÑO', m: 'NORMAL', l: 'GRANDE' } },
        { k: 'nitroPos', name: 'BOTÓN DE NITRO', short: 'NITRO', vals: ['both', 'gas', 'steer'], lab: { both: 'LOS DOS', gas: 'EN EL GAS', steer: 'EN EL GIRO' } },
        { k: 'padEdit', name: 'COLOCAR BOTONES', short: 'COLOCAR', pick: true, val: () => (this.touch.custom ? 'A TU GUSTO' : 'DE SERIE') },
      ] : []),
      { k: 'assist', name: 'DIRECCIÓN ASISTIDA', short: 'ASISTENCIA', vals: ['off', 'soft', 'strong'], lab: { off: 'NO', soft: 'SUAVE', strong: 'FUERTE' } },
      { k: 'guide', name: 'LÍNEA DE CARRERA', short: 'TRAZADA', vals: [true, false], lab: { true: 'SÍ', false: 'NO' } },
      { k: 'cvd', name: 'COLORES DALTONISMO', short: 'DALTONISMO', vals: [false, true], lab: { true: 'SÍ', false: 'NO' } },
      { k: 'autoGas', name: 'ACELERADOR AUTOMÁTICO', short: 'AUTO-GAS', vals: [false, true], lab: { true: 'SÍ', false: 'NO' } },
      { k: 'fps', name: 'MOSTRAR FPS', short: 'FPS', vals: [false, true], lab: { true: 'SÍ', false: 'NO' } },
    ];
    const qBefore = o.quality;
    const el = this.ui.show('options', `
      <div class="panel fade-in"><div class="head">OPCIONES</div><div class="menu cols2">
        ${defs.map((d) => `<div class="btn" data-k="${d.k}"${d.pick ? '' : ' data-opt'}><span class="ln">${d.name}</span><span class="sn">${d.short || d.name}</span> <span class="val"></span></div>`).join('')}
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
        el.querySelector(`[data-k=${d.k}] .val`).textContent = d.val ? d.val() : d.lab ? d.lab[String(v)] : String(v);
      });
      this.ui.fit(el); // the values can change the panel's size
    };
    paint();
    let nav = null;
    // the touch controls are chosen from the three, not cycled: INCLINAR is only ever
    // chosen on purpose, and the iPhone asks for the motion sensor from that very tap
    const pickTouch = () => {
      const asks = isIOS && this.touch.tiltAsks, lost = o.touch === 'tilt' && this.touch.tiltLost;
      const CH = [
        { k: 'buttons', nm: 'BOTONES', ds: 'Flechas para girar, gas y nitro.' },
        { k: 'stick', nm: 'JOYSTICK', ds: 'Apunta adonde quieres ir y el camión va solo.' },
        { k: 'tilt', nm: 'INCLINAR', ds: `Gira el móvil como un volante.${lost ? '<em>El móvil ha olvidado el permiso: tócalo para darlo otra vez.</em>' : asks ? '<em>Te pedirá permiso para usar el sensor de movimiento.</em>' : ''}` },
      ];
      el.style.visibility = 'hidden';
      const pk = this.ui.show('ctrlpick', `<div class="panel fade-in"><div class="head">CONTROL TÁCTIL</div>
        <div class="ccards">${CH.map((c) => `<div class="ccard${c.k === o.touch ? ' cur' : ''}" data-k="${c.k}">${CTRL_ICONS[c.k]}<div class="nm">${c.nm}</div><div class="ds">${c.ds}</div></div>`).join('')}</div>
        <div class="menu row-menu" style="padding-top:0"><div class="btn primary" data-k="back">VOLVER</div></div></div>`);
      const close = () => { this.ui.hide('ctrlpick'); el.style.visibility = ''; paint(); this.ui.resume(nav); };
      const choose = (k) => {
        o.touch = k; this.saveOpt();
        if (k === 'tilt') this.touch.tiltOn(); else this.touch.setMode(k);
        this.touch.layout();
        close();
      };
      this.ui.navigate('ctrlpick', [...pk.querySelectorAll('.ccard'), pk.querySelector('.btn')], {
        axis: 'h', grid: 1, start: Math.max(0, CH.findIndex((c) => c.k === o.touch)),
        onOk: (i, b) => {
          const k = b.dataset.k;
          if (k === 'back') return close();
          if (k !== 'tilt' || o.touch === 'tilt' && !this.touch.tiltLost) return choose(k);
          this.touch.requestTilt().then((granted) => {
            if (!this.ui.get('ctrlpick')) return;
            if (granted) return choose('tilt');
            // refused, on the card itself (a no is remembered: on the iPhone until the
            // browser is opened again, in Chrome in the site's settings)
            const card = pk.querySelector('.ccard[data-k=tilt]');
            card.querySelector('.ds').innerHTML = `Gira el móvil como un volante.<em class="no">Sin permiso para el sensor. ${isIOS ? 'Si dijiste que no, cierra el navegador y vuelve a abrirlo.' : 'Actívalo en los ajustes del sitio: sensores de movimiento.'}</em>`;
            card.classList.remove('refused'); void card.offsetWidth; card.classList.add('refused');
            this.ui.sound('deny');
          });
        },
        onBack: close,
      });
    };
    // the pad with its buttons loose, over the screen
    const padEdit = () => {
      el.style.visibility = 'hidden';
      this._padEditor(() => { el.style.visibility = ''; paint(); this.ui.resume(nav); });
    };
    const change = (i, b, dir) => {
      const d = defs.find((x) => x.k === b.dataset.k);
      if (!d) return;
      if (d.pick) return d.k === 'touch' ? pickTouch() : padEdit();
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
      if (d.k === 'guide' && this.race && !this.attract && !this.replayView) this._applyGuide();
      if (d.k === 'voice') this.audio.setVoice(o.voice);
      if (d.k === 'cvd') this._applyCvd();
      if (d.k === 'subs' && !o.subs) this._subtitle(null);
      if (d.k === 'assist') {
        // also in the middle of a race (pause menu); the prize follows the strongest level used
        const lvl = ASSIST_LEVELS[o.assist] || 0;
        const net = this.net, racing = this.race && !this.attract && this.race.state !== 'done';
        if (net && net.role === 'guest') { net.prefs.assist = o.assist; net.send({ t: 'prefs', assist: o.assist }); if (this._pred) this._pred.assist.level = lvl; } // the host applies it (and our prediction)
        else if (net) {
          const a = this.assists && this.assists[0];
          if (a) a.level = lvl;
          if (racing) this.assistBy[0] = Math.max(this.assistBy[0] || 0, lvl);
        } else {
          for (const a of this.assists || []) if (a) a.level = lvl;
          if (racing) this.assistUsed = Math.max(this.assistUsed || 0, lvl);
        }
        paintHint();
      }
    };
    const done = () => {
      this.ui.hide('options');
      if (o.quality !== qBefore) { this.ui.toast('Reiniciando para aplicar la calidad…', 'small', 1200); setTimeout(() => location.reload(), 900); return; }
      back();
    };
    nav = this.ui.navigate('options', [...el.querySelectorAll('.btn')], {
      onOk: (i, b) => (b.dataset.k === 'back' ? done() : change(i, b, 1)),
      onLeft: (i, b) => change(i, b, -1), onRight: (i, b) => change(i, b, 1), onBack: done,
    });
  }

  // COLOCAR BOTONES: each button of the race pad dragged where the thumbs want it, and
  // the one touched last made bigger or smaller (kept per kind of control)
  _padEditor(back) {
    const el = this.ui.show('padedit', `<div class="panel fade-in padedit"><div class="head">COLOCAR BOTONES</div>
      <div class="nethelp">Arrastra cada botón adonde te venga bien. El último que tocas crece o mengua con + y −.</div>
      <div class="menu row-menu" style="padding-top:2px"><div class="btn sq" data-a="minus">−</div><div class="btn sq" data-a="plus">+</div><div class="btn" data-a="reset">DE SERIE</div><div class="btn primary" data-a="done">LISTO</div></div></div>`, 'passive');
    this.touch.onchange = () => this.saveOpt();
    this.touch.edit(true);
    const close = () => { this.touch.edit(false); this.touch.onchange = null; this.saveOpt(); this.ui.hide('padedit'); back(); };
    this.ui.navigate('padedit', [...el.querySelectorAll('.btn')], {
      axis: 'h', start: 3,
      onOk: (i, b) => {
        const a = b.dataset.a;
        if (a === 'done') return close();
        if (a === 'reset') this.touch.resetLayout(); else this.touch.resize(a === 'plus' ? 1.12 : 1 / 1.12);
      },
      onBack: close,
    });
  }

  toScores(back, hi = -1) {
    const el = this.ui.show('scores', `<div class="panel fade-in"><div class="head">MEJORES PILOTOS</div>${this._scoresHTML(hi)}<div class="menu" style="padding-top:0"><div class="btn primary">VOLVER</div></div></div>`);
    this.ui.navigate('scores', [el.querySelector('.btn')], { onOk: () => { this.ui.hide('scores'); back(); }, onBack: () => { this.ui.hide('scores'); back(); } });
  }

  // the achievements and the career numbers
  toAchievements(back) {
    this.ui.hide('menu');
    const c = this.career, st = c.stats;
    const golds = this._golds();
    const num = (v, d = 0) => v.toLocaleString('es-ES', { maximumFractionDigits: d });
    const chips = [['CARRERAS', num(st.races)], ['VICTORIAS', num(st.wins)], ['PODIOS', num(st.podiums)], ['KM', num(st.km, 1)],
      ['SALTOS', num(st.jumps)], ['MEJOR VUELO', st.bestAir ? num(st.bestAir, 2) + ' s' : '—'], ['OROS', golds], ['MEJOR PARTIDA', fmtMoney(st.bestScore)]];
    const cards = ACHIEVEMENTS.map((a) => {
      const got = c.got[a.id], pr = got ? null : c.progress(a, { golds });
      const foot = got ? `<em>${new Date(got).toLocaleDateString('es-ES')}</em>`
        : pr ? `<u><i style="width:${Math.min(100, (100 * pr[0]) / pr[1]).toFixed(0)}%"></i></u><em>${num(Math.min(pr[0], pr[1]))}/${pr[1]}</em>` : '';
      return `<div class="ach${got ? ' got' : ''}"><i class="ic">${ACH_ICONS[a.icon] || ACH_ICONS.trophy}</i><div class="tx"><b>${a.name}</b><span>${a.desc}</span>${foot}</div></div>`;
    }).join('');
    const el = this.ui.show('achievements', `<div class="panel fade-in ach-panel" data-min-scale="0.82">
      <div class="head">LOGROS <span class="gold" style="font-size:.6em">· ${c.count}/${ACHIEVEMENTS.length}</span></div>
      <div class="ach-stats">${chips.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <div class="ach-grid">${cards}</div>
      <div class="menu" style="padding-top:0"><div class="btn primary">VOLVER</div></div></div>`);
    const body = el.querySelector('.ach-grid');
    const close = () => { this.ui.hide('achievements'); back(); };
    this.ui.navigate('achievements', [el.querySelector('.btn')], {
      axis: 'h', // up/down scroll the list (keyboard, pad)
      onUp: () => body.scrollBy({ top: -100, behavior: 'smooth' }), onDown: () => body.scrollBy({ top: 100, behavior: 'smooth' }),
      onOk: close, onBack: close,
    });
  }

  toHelp(back) {
    const el = this.ui.show('help', `<div class="panel fade-in help-panel" data-min-scale="0.86"><div class="head">CÓMO SE JUEGA</div>
      <div class="help-body">
        <p>Carreras de 4 vueltas contra los camiones de la CPU. El gris es <b class="gold">Ivan "Ironman" Stewart</b>. Hay cuatro dificultades: en <b>Novato</b> solo pierdes un crédito si llegas el último; en <b>Piloto</b> y <b>Experto</b>, si Ironman te gana; en <b>Arcade</b> tienes que ganar a todos, como en la recreativa de 1989. Cuanto más difícil, más pagan las carreras. Sin créditos, se acaba la partida.</p>
        <p>Los rivales pelean: si les sacas ventaja, conducen más afilados y te persiguen; si vas detrás, aflojan un poco. En Novato y Piloto además se adaptan a tu forma a lo largo del campeonato.</p>
        <p>Las <b>flechas pintadas</b> en la pista marcan el sentido de la carrera, y la <b>línea de carrera</b> (Opciones) te muestra la trazada por delante de tu camión: verde para acelerar, ámbar para levantar el pie y roja para frenar.</p>
        <p><b>Dirección asistida</b> (Opciones): <i>suave</i> corrige el volante antes de chocar con las vallas y <i>fuerte</i> te lleva por la trazada y levanta el pie antes de las curvas. Ayuda mucho en el móvil, a cambio de un 10 % o un 20 % menos de premio.</p>
        <p>Al acabar cada carrera puedes ver la <b>REPETICIÓN</b> con cámaras de televisión: el realizador automático no se pierde los saltos (a cámara lenta), los adelantamientos ni la meta. Elige cámara, camión y velocidad, salta por la línea de tiempo, y con el <b>MODO FOTO</b> congela la imagen, gira la cámara y guarda o comparte la foto.</p>
        <p><b>Teclado:</b> ← → girar · ↑ acelerar · ↓ frenar/marcha atrás · ENTER o ESPACIO nitro · ESC pausa.<br>
        <b>Mando:</b> stick o cruceta girar · A acelerar · B frenar · X/RB nitro · START pausa.<br>
        <b>Táctil:</b> botones de giro a la izquierda, acelerar y nitro a la derecha, y otro nitro encima del giro (en Opciones: zurdos, tamaño, qué nitros se ven o joystick). Con <b>COLOCAR BOTONES</b> arrastras cada botón adonde te venga bien y lo haces más grande o más pequeño.</p>
        <p><b>Accesibilidad</b> (Opciones): el <b>locutor</b> habla en español o en inglés, con <b>subtítulos</b> si quieres, y <b>COLORES DALTONISMO</b> cambia el verde y el rojo de la línea de carrera y de los marcadores por azul, amarillo y naranja.</p>
        <p>Si dos camiones llegan casi a la vez y uno es tuyo, la <b>FOTO FINISH</b> lo decide: los últimos metros a cámara lenta y la foto desde la línea de meta, con la diferencia. El ganador lo celebra con <b>trompos</b>, y el público enloquece y dispara sus cámaras con tus saltos más largos. En la cámara de persecución, el barro y el agua salpican la lente.</p>
        <p>Recoge <b style="color:#79c2ff">nitros</b> y <b class="gold">bolsas de dinero</b> en la pista. Con el dinero mejora tu camión en el taller: neumáticos, amortiguadores, aceleración y velocidad punta (5 niveles cada uno), o compra más nitro.</p>
        <p>El campeonato va por <b>copas</b> de 4 carreras con puntos: al final de cada una, los tres primeros suben al <b>podio</b> y los jugadores que suben cobran un premio. En <b>LOGROS</b> están los 26 retos y tus estadísticas; muchos logros desbloquean <b>pinturas</b> para tu camión en el taller. El <b>DESAFÍO DEL DÍA</b> es una contrarreloj distinta cada día, con medallas y racha. Una de cada cinco carreras es con <b>lluvia</b>: la pista agarra menos. En el móvil puedes conducir <b>inclinando</b> el teléfono (Opciones → Control táctil).</p>
        <p>El campeonato se guarda solo: si sales del juego, <b>CONTINUAR</b> en el menú principal lo retoma. Una carrera que se quedó a medias vuelve a empezar desde la parrilla; una que ya habías terminado cuenta y sigues en el taller.</p>
        <p><b>Cada uno en su móvil</b> (2, 3 o 4 JUGADORES → EN DOS, TRES o CUATRO MÓVILES; con cuatro, solo así): todos en la misma WiFi o en el punto de acceso de uno. Un móvil pulsa CREAR PARTIDA y a los demás, en esa pantalla, les aparece sola la partida de su WiFi (o UNIRSE CON CÓDIGO con el número que enseña); sin internet, CREAR CON QR y UNIRSE CON QR (cada uno escanea el QR del otro). El jugador 1 pulsa EMPEZAR cuando están todos y elige <b>CAMPEONATO</b> o <b>CARRERA RÁPIDA</b> (circuito, vueltas, luz, lluvia y si corre la CPU); al acabar, <b>REVANCHA</b> cuando todos estén listos u <b>OTRO CIRCUITO</b>. Con cuatro jugadores, el cuarto conduce el camión gris de Ironman. Una pausa para a todos; si alguien sale, su camión sigue para la CPU.</p>
        <p>Puedes correr con el <b>camión</b> (más agarre y velocidad punta, gana los empujones) o con el <b>buggy</b> del <i>Track Pak</i> (acelera más y aterriza mejor los saltos, pero es ligero y derrapa más).</p>
        <p>Hay 16 circuitos (los 8 de la recreativa y los 8 del <i>Track Pak</i>), cada uno en los dos sentidos. En <b>CARRERA LIBRE</b> puedes probar cualquiera, con el sentido y la luz que quieras.</p>
        <p>En <b>CONTRARRELOJ</b> (Carrera libre → Modo) corres contra el <b>fantasma</b> de tu mejor tiempo y el <b>fantasma dorado de Ironman</b>: gánale para la medalla de <b>oro</b>; a menos del 5 % es <b>plata</b> y a menos del 12 %, <b>bronce</b>. Pellizca la pista para acercar o alejar la cámara.</p>
        <p class="credits"><b>Créditos.</b> Remake de aficionado de <i>Ivan "Ironman" Stewart's Super Off Road</i> © 1989 Leland Corporation.
        Música: «Hotrock», «Exhilarate», «Cool Rock», «Ready Aim Fire», «Neolith» y «Twisted» de Kevin MacLeod (incompetech.com), licencia Creative Commons Atribución 4.0.
        Texturas de tierra: Poly Haven (CC0). Fuentes Russo One y Teko (SIL OFL). Locutor: Piper (voces es_ES-davefx, CC0, y en_US-ryan). Motor 3D: Three.js (MIT). Modelos 3D hechos con Blender.</p>
      </div><div class="menu row-menu" style="padding-top:0"><div class="btn primary" data-a="back">VOLVER</div><div class="btn" data-a="tutor">HACER EL TUTORIAL</div></div></div>`);
    const body = el.querySelector('.help-body');
    this.ui.navigate('help', [...el.querySelectorAll('.menu .btn')], {
      axis: 'h', // up/down scroll the text (keyboard, pad)
      onUp: () => body.scrollBy({ top: -90, behavior: 'smooth' }), onDown: () => body.scrollBy({ top: 90, behavior: 'smooth' }),
      onOk: (i, b) => { this.ui.hide('help'); if (b.dataset.a === 'tutor') { this.ui.hideAll(); this.startTutorial(); } else back(); },
      onBack: () => { this.ui.hide('help'); back(); },
    });
  }

  // ------------------------------------------------------------------ game over
  toGameOver() {
    this.state = 'gameover';
    const net = this.net;
    if (!this.session.net) clearRun(); // the championship ends here (CONTINUAR with 3 more credits saves it again in the shop)
    // two phones: the same screen on the other one (each enters its own initials there)
    if (net && net.role === 'host') { const msg = { t: 'gameover', sess: this.session.snapshot() }; net.phaseMsg = msg; net.send(msg); }
    this.ui.hideAll();
    this.hud.destroy();
    this.touch.show(false);
    this.audio.music('title');
    this.audio.announce('game_over');
    const best = this.session.players.slice().sort((a, b) => b.earned - a.earned);
    const queue = best.filter((p) => qualifies(p.earned) && p.earned > 0 && (!net || p.index === net.local));
    const continueScreen = () => {
      const tag = (p) => (net ? (p.index === net.local ? 'TÚ · ' : `${p.index + 1}P · `) : this.session.players.length > 1 ? (p.index + 1) + 'P · ' : '');
      const guest = net && net.role === 'guest';
      const el = this.ui.show('gameover', `
        <div class="panel fade-in"><div class="head">FIN DE LA PARTIDA</div>
          <div class="verdict">${best.map((p) => `${tag(p)}Ganado: <span class="gold">${fmtMoney(p.earned)}</span> · ${this.session.raceNo} ${this.session.raceNo === 1 ? 'carrera' : 'carreras'}`).join('<br>')}</div>
          ${guest ? '<div class="nethelp">El jugador 1 decide si seguís con 3 créditos más.</div>' : ''}
          <div class="menu" style="padding-top:0">
            ${guest ? '<div class="btn" data-a="quit">SALIR DE LA PARTIDA</div>' : `<div class="btn primary" data-a="cont">CONTINUAR (3 CRÉDITOS)</div>
            <div class="btn" data-a="end">TERMINAR</div>`}
          </div></div>`);
      this.ui.navigate('gameover', [...el.querySelectorAll('.btn')], {
        onOk: (i, b) => {
          if (b.dataset.a === 'quit') return this._netQuit();
          if (b.dataset.a === 'cont') {
            for (const p of this.session.players) { p.alive = true; p.credits = 3; p.continued = true; }
            if (this.net) { this.net.send({ t: 'cont' }); this._netShop(); return; }
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

installNet(Game);
installPhotoFinish(Game);
