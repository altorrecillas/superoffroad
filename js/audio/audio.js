// Audio: synthesized engines and effects (WebAudio), streamed music and the
// stadium announcer.

import * as THREE from 'three';
import { engineLoop, noiseLoop, crowdLoop, oneShot } from './synth.js';

const ENGINE_RPM = [1000, 2800, 5200];
const BUGGY_REV = 1.3;
const GEARS = [7.5, 12.5, 18, 24.5, 33];
const VOICES = ['welcome', 'ready', 'go', 'final_lap', 'winner', 'ironman_wins', 'race_over', 'game_over', 'new_record', 'continue',
  'track_fandango', 'track_huevos', 'track_sidewinder', 'track_bigdukes', 'track_blaster', 'track_hurricane', 'track_cliffhanger', 'track_wipeout',
  'track_redoubt', 'track_riotrio', 'track_leapin', 'track_cutoff', 'track_boulder', 'track_pigbog', 'track_shortcut', 'track_volcano'];
const MUSIC = { title: ['title'], race: ['race1', 'race2', 'race3', 'race4'], shop: ['shop'], results: ['shop'] };
const _v = new THREE.Vector3();

export class Audio {
  constructor(opt) {
    this.opt = opt;
    this.muted = false;
    this.ready = false;
    this.buffers = {};
    this.trucks = [];
    this.raceMusicIdx = Math.floor(Math.random() * 4);
    this.excite = 0;
    this.lastCount = null;
  }

  async load(progress = () => {}) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 3.5; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master.connect(this.comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.voiceBus = ctx.createGain(); this.voiceBus.connect(this.master);
    this.setVolumes(this.opt);
    // synthesis (spread over frames so the loading bar moves)
    const jobs = [
      ...ENGINE_RPM.map((rpm, i) => () => (this.buffers['eng' + i] = engineLoop(ctx, rpm, 7))),
      // the buggy's boxer revs higher: same rpm model, loops recorded 30% up
      ...ENGINE_RPM.map((rpm, i) => () => (this.buffers['beng' + i] = engineLoop(ctx, rpm * BUGGY_REV, 11, 'flat4'))),
      () => (this.buffers.skid = noiseLoop(ctx, 'skid')), () => (this.buffers.roll = noiseLoop(ctx, 'roll')),
      () => (this.buffers.water = noiseLoop(ctx, 'water')), () => (this.buffers.flame = noiseLoop(ctx, 'flame', 1.5)),
      () => (this.buffers.crowd = crowdLoop(ctx)),
      ...['thud', 'clank', 'land', 'splash', 'nitro', 'pickup', 'cash', 'beep', 'go', 'lap', 'horn', 'boom', 'move', 'ok', 'back', 'deny']
        .map((k) => () => (this.buffers[k] = oneShot(ctx, k))),
    ];
    for (let i = 0; i < jobs.length; i++) {
      jobs[i]();
      progress((i + 1) / (jobs.length + 1) * 0.7);
      await new Promise((r) => setTimeout(r, 0));
    }
    // announcer clips
    await Promise.all(VOICES.map((k) => fetch(`assets/voice/${k}.mp3`).then((r) => r.arrayBuffer()).then((b) => new Promise((res) => ctx.decodeAudioData(b, res, () => res(null))))
      .then((buf) => { if (buf) this.buffers['v_' + k] = buf; }).catch(() => {})));
    progress(1);
    // crowd ambience bed
    this.crowd = this._loop(this.buffers.crowd, this.sfxBus, 0);
    this.ready = true;
  }

  unlock() {
    if (!this.ctx) return;
    // iPhone: play like a game/video even with the silent switch on (Safari 16.4+)
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { /* not available */ }
    // 'suspended' before the first tap, 'interrupted' on iOS after a call or an app switch
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    if (this.musicEl && this.musicName && this.musicEl.paused && !this.paused && !document.hidden) this.musicEl.play().catch(() => {});
    if (!this._unlocked) {
      this._unlocked = true;
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      if (this.pendingMusic) { const m = this.pendingMusic; this.pendingMusic = null; this.music(m); }
    }
  }
  suspend(hidden) {
    if (!this.ctx) return;
    if (hidden) { this.ctx.suspend(); if (this.musicEl) this.musicEl.pause(); }
    else if (this._unlocked) { this.ctx.resume().catch(() => {}); if (this.musicEl && this.musicName && !this.paused) this.musicEl.play().catch(() => {}); }
  }
  setVolumes(o) {
    if (!this.ctx) return;
    const m = this.muted ? 0 : 1;
    this.musicBus.gain.value = (o.music / 10) * 0.55 * m;
    this.sfxBus.gain.value = (o.sfx / 10) * 0.9 * m;
    this.voiceBus.gain.value = (o.voice === false ? 0 : 1) * (o.sfx / 10) * m;
  }
  toggleMute() { this.muted = !this.muted; this.setVolumes(this.opt); }
  pause(on) {
    this.paused = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const tr of this.trucks) tr.out.gain.setTargetAtTime(on ? 0 : 1, t, 0.05);
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(on ? 0.35 : 1, t, 0.2);
  }

  _loop(buf, dest, gain = 1, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(dest);
    s.start(0, Math.random() * buf.duration);
    return { s, g };
  }

  // ------------------------------------------------------------------ one-shots
  sfx(name, o = {}) {
    if (!this.ready || !this.buffers[name] || this.ctx.state !== 'running') return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffers[name];
    s.playbackRate.value = (o.rate || 1) * (1 + (Math.random() - 0.5) * (o.vary ?? 0.08));
    const g = this.ctx.createGain(); g.gain.value = o.vol ?? 1;
    let node = s.connect(g);
    if (o.pan) { const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); node = node.connect(p); }
    node.connect(o.bus || this.sfxBus);
    s.start(0);
  }
  ui(kind) { this.sfx(kind, { vol: 0.35, vary: 0 }); }
  announce(key) {
    if (!this.ready || this.opt.voice === false) return;
    const b = this.buffers['v_' + key];
    if (!b || this.ctx.state !== 'running') return;
    if (this.voiceSrc) try { this.voiceSrc.stop(); } catch (e) { /* */ }
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.voiceBus);
    s.start(this.ctx.currentTime + 0.05);
    this.voiceSrc = s;
  }

  // ------------------------------------------------------------------ music
  // One music element for the whole session: iOS lets a media element play only
  // after a tap, but once blessed the same element can change track later on its
  // own (a new element per track would stay silent until the next tap).
  music(kind) {
    if (!kind) return this._stopMusic();
    const list = MUSIC[kind];
    let name = list[0];
    if (kind === 'race') name = list[this.raceMusicIdx++ % list.length];
    if (this.musicName === name && this.musicEl && !this.musicEl.paused) return;
    if (!this._unlocked || !this.ctx) { this.pendingMusic = kind; return; }
    this._musicEl();
    const el = this.musicEl, g = this.musicGain;
    this.musicName = name;
    clearTimeout(this._musicSwap);
    const start = () => {
      const t = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(0, t);
      g.gain.setTargetAtTime(1, t + 0.05, 0.5);
      el.src = `assets/music/${name}.mp3`;
      // a newer track interrupts the previous play() (AbortError): only the latest counts
      const token = (this._musicToken = (this._musicToken || 0) + 1);
      el.play().catch((e) => {
        if (token !== this._musicToken || (e && e.name === 'AbortError')) return;
        this.pendingMusic = kind; this.musicName = null; // blocked: retry on the next tap
      });
    };
    if (!el.paused && el.currentSrc) {
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.14); // short fade out, then switch
      this._musicSwap = setTimeout(start, 420);
    } else start();
  }
  _musicEl() {
    if (this.musicEl) return;
    const el = new window.Audio();
    el.loop = true;
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
    const src = this.ctx.createMediaElementSource(el);
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.musicBus);
    this.musicEl = el; this.musicGain = g; this.musicSrc = src;
  }
  _stopMusic() {
    if (!this.musicEl) return;
    clearTimeout(this._musicSwap);
    this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
    this._musicSwap = setTimeout(() => this.musicEl.pause(), 1200);
    this.musicName = null;
  }

  // ------------------------------------------------------------------ race sounds
  startRace(race) {
    if (!this.ready) return;
    for (const t of this.trucks) this._killTruck(t);
    this.trucks = race.racers.map((r) => this._truckVoice(r));
    this.lastCount = null;
  }
  _truckVoice(r) {
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = 1;
    const pan = ctx.createStereoPanner();
    out.connect(pan).connect(this.sfxBus);
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 1500; filt.Q.value = 0.8;
    const eng = ctx.createGain(); eng.gain.value = 0;
    filt.connect(eng).connect(out);
    const pre = r.entry.vehicle === 'buggy' ? 'beng' : 'eng';
    const loops = ENGINE_RPM.map((rpm, i) => this._loop(this.buffers[pre + i] || this.buffers['eng' + i], filt, 0));
    const skid = this._loop(this.buffers.skid, out, 0);
    const roll = this._loop(this.buffers.roll, out, 0);
    const water = r.human ? this._loop(this.buffers.water, out, 0) : null;
    const flame = this._loop(this.buffers.flame, out, 0);
    return { r, out, pan, filt, eng, loops, skid, roll, water, flame, rpm: 900, gear: 0, human: r.human, wasWater: false, bright: pre === 'beng' ? 1.35 : 1 };
  }
  _killTruck(t) {
    const stop = (x) => { if (x) { try { x.s.stop(); } catch (e) { /* */ } x.s.disconnect(); x.g.disconnect(); } };
    t.loops.forEach(stop); stop(t.skid); stop(t.roll); stop(t.water); stop(t.flame);
    t.out.disconnect();
  }

  update(dt, race, camera, quiet) {
    if (!this.ready || !race || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const tc = 0.04;
    this.excite = Math.max(0, this.excite - dt * 0.25);
    if (this.crowd) this.crowd.g.gain.setTargetAtTime((quiet ? 0.05 : 0.09) + this.excite * 0.35, now, 0.3);
    // countdown beeps
    if (race.state === 'countdown') {
      const n = race.time < -3 ? 4 : race.time < -2 ? 3 : race.time < -1 ? 2 : race.time < 0 ? 1 : 0;
      if (n !== this.lastCount && n <= 3 && n >= 1) this.sfx('beep', { vol: 0.6, vary: 0 });
      this.lastCount = n;
    }
    const outGain = this.paused ? 0 : quiet ? 0.32 : 1;
    for (const tv of this.trucks) {
      const t = tv.r.truck;
      tv.out.gain.setTargetAtTime(outGain, now, 0.25);
      // gearbox model -> rpm
      const sp = Math.abs(t.vf);
      let ratio = sp / GEARS[tv.gear];
      if (ratio > 0.96 && tv.gear < GEARS.length - 1) { tv.gear++; ratio = sp / GEARS[tv.gear]; }
      else if (tv.gear > 0 && sp < GEARS[tv.gear - 1] * 0.62) { tv.gear--; ratio = sp / GEARS[tv.gear]; }
      let target = 1000 + 4900 * Math.min(1.04, ratio);
      const thr = race.state === 'countdown' ? t.throttle : t.throttle;
      if (t.air && t.hAbove > 0.3) target = thr > 0 ? 5900 : 1600;
      else if (t.slip > 4 && thr > 0) target = Math.min(6100, target + 1400);
      if (race.state === 'countdown') target = thr > 0 ? 3600 + Math.sin(now * 9 + tv.r.i) * 900 : 1000;
      if (thr <= 0) target = Math.max(1000, target * 0.82);
      tv.rpm = Math.max(700, Math.min(7000, tv.rpm + (target - tv.rpm) * Math.min(1, Math.max(0, dt) * (thr > 0 ? 7 : 4))));
      const rpm = tv.rpm;
      // crossfade the three loops
      const w = [0, 0, 0];
      if (rpm <= ENGINE_RPM[1]) { const k = (rpm - ENGINE_RPM[0]) / (ENGINE_RPM[1] - ENGINE_RPM[0]); w[0] = Math.cos(Math.max(0, k) * Math.PI / 2); w[1] = Math.sin(Math.max(0, k) * Math.PI / 2); }
      else { const k = Math.min(1, (rpm - ENGINE_RPM[1]) / (ENGINE_RPM[2] - ENGINE_RPM[1])); w[1] = Math.cos(k * Math.PI / 2); w[2] = Math.sin(k * Math.PI / 2); }
      tv.loops.forEach((l, i) => {
        l.g.gain.setTargetAtTime(w[i], now, tc);
        l.s.playbackRate.setTargetAtTime(Math.max(0.5, Math.min(2.2, rpm / ENGINE_RPM[i])), now, tc);
      });
      const boost = t.nitroT > 0 ? 1 : 0;
      const base = tv.human ? 0.62 : 0.34;
      tv.eng.gain.setTargetAtTime(base * (0.45 + 0.55 * Math.max(thr, 0.15)) * (1 + boost * 0.3), now, 0.06);
      // |thr|: the CPU reverses with negative throttle when it is stuck (still revving)
      tv.filt.frequency.setTargetAtTime((700 + Math.abs(thr) * 2600 + (rpm - 1000) * 0.35 + boost * 1500) * tv.bright, now, 0.05);
      // tyres and surface
      const grounded = !t.air || t.hAbove < 0.2;
      const wet = t.water > 0.04;
      tv.skid.g.gain.setTargetAtTime(grounded && !wet ? Math.min(0.5, Math.max(0, t.slip - 2) * 0.07) * (tv.human ? 1 : 0.6) : 0, now, 0.05);
      tv.skid.s.playbackRate.setTargetAtTime(0.8 + Math.min(0.5, sp / 40), now, 0.1);
      tv.roll.g.gain.setTargetAtTime(grounded ? Math.min(0.3, sp / 70) * (tv.human ? 1 : 0.5) : 0, now, 0.08);
      tv.roll.s.playbackRate.setTargetAtTime(0.6 + sp / 30, now, 0.1);
      if (tv.water) tv.water.g.gain.setTargetAtTime(wet ? Math.min(0.5, sp / 25) : 0, now, 0.05);
      tv.flame.g.gain.setTargetAtTime(boost * (tv.human ? 0.35 : 0.2), now, 0.04);
      if (wet && !tv.wasWater && sp > 3) this.sfx('splash', { vol: Math.min(1, sp / 18) * (tv.human ? 0.9 : 0.5), pan: this._pan(t, camera) });
      tv.wasWater = wet;
      // stereo position from the screen
      tv.pan.pan.setTargetAtTime(this._pan(t, camera), now, 0.08);
    }
  }
  _pan(t, camera) {
    _v.set(t.x, t.y, t.z).project(camera);
    return Math.max(-1, Math.min(1, _v.x * 0.75));
  }

  handle(events, race) {
    if (!this.ready) return;
    const cam = this.camera;
    for (const ev of events) {
      const r = race.racers[ev[1]];
      const human = r && r.human;
      const vol = human ? 1 : 0.55;
      const t = r && r.truck;
      switch (ev[0]) {
        case 'go': this.sfx('go', { vol: 0.7, vary: 0 }); this.announce('go'); this.excite = 1; break;
        case 'nitro': this.sfx('nitro', { vol: 0.7 * vol }); break;
        case 'wall': {
          const k = Math.min(1, ev[2] / 14);
          this.sfx('thud', { vol: (0.3 + k * 0.7) * vol });
          if (ev[2] > 6) this.sfx('clank', { vol: k * 0.5 * vol });
          break;
        }
        case 'bump': this.sfx('thud', { vol: Math.min(1, ev[3] / 10) * 0.8 }); this.sfx('clank', { vol: Math.min(1, ev[3] / 12) * 0.5, rate: 1.2 }); this.excite = Math.min(1, this.excite + 0.2); break;
        case 'land': if (ev[2] > 3.5) { this.sfx('land', { vol: Math.min(1, (ev[2] - 3) / 8) * vol }); if (ev[2] > 8) this.excite = Math.min(1, this.excite + 0.25); } break;
        case 'pickup': this.sfx(ev[2] === 'money' ? 'cash' : 'pickup', { vol: human ? 0.85 : 0.35, vary: 0 }); break;
        case 'lap': if (human) { this.sfx('lap', { vol: 0.5, vary: 0 }); if (ev[2] === race.laps - 1) this.announce('final_lap'); } break;
        case 'finish':
          this.excite = 1;
          if (ev[2] === 1) { this.sfx('horn', { vol: 0.6, vary: 0 }); if (r.entry.ironman && !race.racers.some((x) => x.human && x.finished)) this.announce('ironman_wins'); }
          break;
      }
    }
  }
}
