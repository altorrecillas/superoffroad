// On-screen controls for phones and tablets (player 1).
// 'buttons': left/right steering buttons, gas and nitro on the right.
// 'stick':   a joystick that points the truck where you push (gas included).
// 'tilt':    steer by turning the phone like a wheel; gas, brake and nitro buttons.

import { h } from './ui.js';
import { safeInsets } from '../core/device.js';

// crisp vector icons (font glyphs like ◀ vary from phone to phone)
const ICON = {
  left: '<svg viewBox="0 0 24 24"><path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 4l8 8-8 8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  nitro: '<svg viewBox="0 0 24 24"><path d="M13.5 2 4.5 13.5h6.5L9.5 22l9.5-12.5h-6.7z" fill="currentColor"/></svg>',
  gas: '<svg viewBox="0 0 24 24"><path d="M12 3 4.5 11.5h4.5V21h6v-9.5h4.5z" fill="currentColor"/></svg>',
  brake: '<svg viewBox="0 0 24 24"><path d="M12 21 4.5 12.5h4.5V3h6v9.5h4.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/></svg>',
};

export class Touch {
  constructor(input, opt) {
    this.input = input;
    this.opt = opt;
    this.state = { active: false, steer: 0, gas: 0, brake: 0, nitroLatch: false, targetHeading: null, analog: false };
    input.touch = this.state;
    this.root = h('<div id="touch"></div>');
    document.body.appendChild(this.root);
    this.rotate = h('<div id="rotate"><img class="rot-logo" src="assets/ui/logo.webp" alt=""><div class="phone-ic"></div><div class="rot-msg">Gira el móvil</div><div class="rot-sub">Super Off Road se juega en horizontal</div></div>');
    document.body.appendChild(this.rotate);
    this.enabled = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (this.enabled) this.rotate.classList.add('need');
    this.mode = opt.touch || 'buttons';
    this.visible = false;
    this.camera = null;
    this.onPause = null;
    window.addEventListener('resize', () => this.layout());
    // tilt: the gravity vector in screen coordinates gives the phone's roll. The sensor
    // is only listened to while INCLINAR is the control, chosen in the options
    this.tilt = { roll: 0, neutral: null, seen: false, t: 0 };
    this._onMotion = (e) => this._motion(e);
    this._listening = false;
    this.tiltLost = false;
    if (this.mode === 'tilt') this._resumeTilt();
  }

  // the motion sensor's permission (the iPhone's question; Chrome answers it with the
  // site's setting, without asking)
  get tiltAsks() { const D = window.DeviceMotionEvent; return !!(D && typeof D.requestPermission === 'function'); }

  // asked from the tap that chooses INCLINAR in the options: the only place the
  // iPhone shows its question
  requestTilt() {
    const D = window.DeviceMotionEvent;
    if (this.tiltAsks) return D.requestPermission().then((r) => r === 'granted').catch(() => false);
    return Promise.resolve(!!D);
  }

  // INCLINAR chosen on an earlier visit. Asked without a tap, the iPhone never shows
  // the question: it only says yes if it still remembers the permission. If it has
  // forgotten it, the race starts with the buttons and says where to turn it back on
  _resumeTilt() {
    if (!this.tiltAsks) { this._listen(true); return; }
    window.DeviceMotionEvent.requestPermission()
      .then((r) => { if (r === 'granted' && this.mode === 'tilt') this._listen(true); else this.tiltLost = this.mode === 'tilt'; })
      .catch(() => { this.tiltLost = this.mode === 'tilt'; });
  }

  _listen(on) {
    if (on === this._listening) return;
    this._listening = on;
    if (on) {
      Object.assign(this.tilt, { seen: false, neutral: null, t: 0, warned: false });
      window.addEventListener('devicemotion', this._onMotion);
    } else window.removeEventListener('devicemotion', this._onMotion);
  }

  _motion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null) return;
    const ang = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * Math.PI / 180;
    const sx = a.x * Math.cos(ang) - a.y * Math.sin(ang), sy = a.x * Math.sin(ang) + a.y * Math.cos(ang);
    if (Math.hypot(sx, sy) < 2.5) return; // lying almost flat: no clear roll
    const roll = Math.atan2(-sx, sy); // the phone turned clockwise -> positive (right)
    const T = this.tilt;
    // smooth the sensor noise a little (wrap-safe)
    const d = Math.atan2(Math.sin(roll - T.roll), Math.cos(roll - T.roll));
    T.roll = T.seen ? T.roll + d * 0.35 : roll;
    T.seen = true;
    if (T.neutral == null) T.neutral = T.roll;
  }
  // hold the phone as you like: this is the straight-ahead position (race countdown)
  calibrate() { if (this.tilt.seen) this.tilt.neutral = this.tilt.roll; }

  // INCLINAR with the permission just given (it may already be the mode, forgotten)
  tiltOn() { this.tiltLost = false; this._listen(true); this.setMode('tilt'); }

  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    this.tiltLost = false;
    this._listen(m === 'tilt');
    if (this.visible) { this.show(false); this.show(true); }
  }

  show(on) {
    // INCLINAR but the phone forgot the sensor's permission: the buttons for now (the
    // question only comes from the options)
    if (on && this.enabled && this.mode === 'tilt' && this.tiltLost) {
      this.mode = 'buttons'; this.tiltLost = false; this._listen(false);
      if (this.onNoTilt) this.onNoTilt('perm');
    }
    this.visible = on && this.enabled;
    this.root.classList.toggle('on', this.visible);
    this.state.active = this.visible;
    this.root.innerHTML = '';
    this.state.steer = 0; this.state.gas = 0; this.state.brake = 0; this.state.targetHeading = null;
    if (!this.visible) return;
    const btn = (cls, icon, label = '') => { const b = h(`<div class="tbtn ${cls}">${ICON[icon]}${label ? `<span>${label}</span>` : ''}</div>`); this.root.appendChild(b); return b; };
    this.els = {};
    if (this.mode === 'tilt') {
      // both thumbs free: gas and nitro on one side, brake and nitro on the other
      this.els.gas = this.opt.autoGas ? btn('nitro', 'nitro', 'NITRO') : btn('gas', 'gas', 'GAS');
      this.els.nitro = this.opt.autoGas ? null : btn('nitro', 'nitro', 'NITRO');
      this.els.brake = btn('brake', 'brake', 'FRENO');
      this.els.nitro2 = btn('nitro nitro2', 'nitro', 'NITRO');
      this.els.tilt = h('<div class="ttilt"><b></b><i></i></div>');
      this.root.appendChild(this.els.tilt);
      if (this.opt.autoGas) this._hold(this.els.gas, (v) => { if (v) this.state.nitroLatch = true; });
      else this._hold(this.els.gas, (v) => (this.state.gas = v));
      this._hold(this.els.brake, (v) => (this.state.brake = v));
      this.tilt.neutral = this.tilt.seen ? this.tilt.roll : null;
      this.tilt.t = 0;
    } else if (this.mode === 'stick') {
      const st = h('<div class="tstick"><i></i></div>');
      this.root.appendChild(st);
      this.els.stick = st;
      this._stick(st);
      this.els.nitro = btn('nitro', 'nitro', 'NITRO');
      this.els.brake = btn('brake', 'brake', 'FRENO');
      this._hold(this.els.brake, (v) => (this.state.brake = v));
    } else {
      this.els.left = btn('steer', 'left');
      this.els.right = btn('steer', 'right');
      this.els.gas = this.opt.autoGas ? btn('brake', 'brake', 'FRENO') : btn('gas', 'gas', 'GAS');
      // nitro next to the gas and/or over the steering pair (option BOTÓN DE NITRO):
      // the one over the steering lets that thumb fire it while the other stays on gas
      const where = this.opt.nitroPos || 'both';
      if (where !== 'steer') this.els.nitro = btn('nitro', 'nitro', 'NITRO');
      if (where !== 'gas') this.els.nitro2 = btn('nitro nitro2', 'nitro', 'NITRO');
      this._steerPad(this.els.left, this.els.right);
      if (this.opt.autoGas) this._hold(this.els.gas, (v) => (this.state.brake = v));
      else this._hold(this.els.gas, (v) => (this.state.gas = v));
    }
    for (const n of [this.els.nitro, this.els.nitro2]) if (n) this._hold(n, (v) => { if (v) this.state.nitroLatch = true; });
    const p = h(`<div class="tpause">${ICON.pause}</div>`);
    p.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onPause && this.onPause(); });
    this.root.appendChild(p);
    this.layout();
  }

  layout() {
    if (!this.visible || !this.els) return;
    // keep clear of the notch, the rounded corners and the home bar
    const si = safeInsets();
    const W = innerWidth - si.left - si.right, H = innerHeight - si.bottom;
    // button size option (CONTROLES: PEQUEÑOS / NORMALES / GRANDES)
    const k = { s: 0.84, m: 1, l: 1.18 }[this.opt.touchSize] || 1;
    const s = Math.max(56, Math.min(128, Math.min(W, H) * 0.2 * k));
    const pad = Math.max(14, s * 0.18);
    // left-handed: steering on the right, gas and nitro on the left
    const mirror = this.opt.touchSide === 'left';
    const place = (el, x, y, size) => {
      if (!el) return;
      Object.assign(el.style, { width: size + 'px', height: size + 'px', left: ((mirror ? W - x - size : x) + si.left) + 'px', top: y + 'px' });
    };
    if (this.mode === 'tilt') {
      place(this.els.brake, pad, H - s * 1.1 - pad, s * 1.1);
      const n2 = s * 0.86;
      place(this.els.nitro2, pad + (s * 1.1 - n2) / 2, H - s * 1.1 - pad - Math.max(10, pad * 0.75) - n2, n2);
      place(this.els.gas, W - s * 1.2 - pad, H - s * 1.2 - pad, s * 1.2);
      place(this.els.nitro, W - s * 2.15 - pad * 1.6, H - s * 0.95 - pad, s * 0.95);
      const tw = Math.min(W * 0.34, 260);
      Object.assign(this.els.tilt.style, { width: tw + 'px', left: (si.left + (W - tw) / 2) + 'px', top: (H - pad - 18) + 'px' });
    } else if (this.mode === 'stick') {
      const ss = s * 1.7;
      place(this.els.stick, pad + 10, H - ss - pad, ss);
      place(this.els.nitro, W - s * 1.15 - pad, H - s * 1.15 - pad, s * 1.15);
      place(this.els.brake, W - s * 2.2 - pad * 1.5, H - s * 0.9 - pad, s * 0.9);
    } else {
      // mirrored, the pair keeps ◀ on the left of ▶
      place(mirror ? this.els.right : this.els.left, pad, H - s - pad, s);
      place(mirror ? this.els.left : this.els.right, pad + s + pad * 0.8, H - s - pad, s);
      // centred over the pair, with a gap so a thumb on ◀ ▶ does not catch it
      const n2 = s * 0.86, pairMid = pad + s + pad * 0.4;
      place(this.els.nitro2, pairMid - n2 / 2, H - s - pad - Math.max(10, pad * 0.75) - n2, n2);
      place(this.els.gas, W - s * 1.2 - pad, H - s * 1.2 - pad, s * 1.2);
      place(this.els.nitro, W - s * 2.15 - pad * 1.6, H - s * 0.95 - pad, s * 0.95);
    }
  }

  _hold(el, fn) {
    const ids = new Set();
    const set = () => { el.classList.toggle('down', ids.size > 0); fn(ids.size > 0 ? 1 : 0); };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); ids.add(e.pointerId); try { el.setPointerCapture(e.pointerId); } catch (x) { /* */ } set(); });
    const up = (e) => { ids.delete(e.pointerId); set(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  // the two steering buttons act as one pad: a thumb can slide from one to the
  // other without lifting (each finger steers towards the side it is over)
  _steerPad(L, R) {
    const fingers = new Map(); // pointerId -> -1 | 1
    const side = (x) => {
      const a = L.getBoundingClientRect(), b = R.getBoundingClientRect();
      return x > (a.right + b.left) / 2 ? 1 : -1;
    };
    const apply = () => {
      let l = 0, r = 0;
      for (const v of fingers.values()) { if (v < 0) l = 1; else r = 1; }
      L.classList.toggle('down', l > 0); R.classList.toggle('down', r > 0);
      this.state.steer = r - l;
    };
    for (const el of [L, R]) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch (x) { /* */ }
        fingers.set(e.pointerId, side(e.clientX));
        apply();
      });
      el.addEventListener('pointermove', (e) => {
        if (!fingers.has(e.pointerId)) return;
        const v = side(e.clientX);
        if (v !== fingers.get(e.pointerId)) { fingers.set(e.pointerId, v); apply(); }
      });
      const up = (e) => { if (fingers.delete(e.pointerId)) apply(); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }
  }

  _stick(el) {
    const knob = el.querySelector('i');
    let id = null;
    const move = (e) => {
      const r = el.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      knob.style.transform = `translate(${dx * r.width * 0.3}px, ${dy * r.height * 0.3}px)`;
      const mag = Math.min(1, l);
      this.stickVec = mag > 0.25 ? [dx, dy, mag] : null;
    };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; try { el.setPointerCapture(id); } catch (x) { /* */ } move(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const up = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; this.stickVec = null; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // stick direction is relative to the screen: convert with the camera; tilt steering
  update(dt = 0) {
    if (!this.visible) return;
    if (this.mode === 'tilt') return this._tiltSteer(dt);
    if (this.mode !== 'stick') return;
    const v = this.stickVec;
    if (!v || !this.camera) { this.state.targetHeading = null; this.state.gas = 0; return; }
    const e = this.camera.matrixWorld.elements;
    let rx = e[0], rz = e[2], fx = -e[8], fz = -e[10];
    const rl = Math.hypot(rx, rz) || 1, fl = Math.hypot(fx, fz) || 1;
    rx /= rl; rz /= rl; fx /= fl; fz /= fl;
    const wx = rx * v[0] - fx * v[1], wz = rz * v[0] - fz * v[1];
    this.state.targetHeading = Math.atan2(wz, wx);
    this.state.gas = v[2] > 0.55 ? 1 : 0.6;
  }

  _tiltSteer(dt) {
    const T = this.tilt, el = this.els.tilt;
    T.t += dt;
    if (!T.seen) {
      this.state.steer = 0;
      // no sensor at all (a computer): say so, keep the buttons
      if (T.t > 2 && !T.warned && this.onNoTilt) { T.warned = true; this.onNoTilt('sensor'); }
      return;
    }
    if (T.neutral == null) T.neutral = T.roll;
    const deg = (Math.atan2(Math.sin(T.roll - T.neutral), Math.cos(T.roll - T.neutral)) * 180) / Math.PI;
    const dead = 2;
    const v = Math.abs(deg) < dead ? 0 : Math.max(-1, Math.min(1, (deg - Math.sign(deg) * dead) / 22));
    this.state.steer = v;
    this.state.analog = true;
    if (el) el.querySelector('i').style.left = `${50 + v * 46}%`;
  }
}
